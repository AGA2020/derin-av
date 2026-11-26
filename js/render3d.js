// İKİ İTEMLİ OYUN — Stylized Low-Poly Isometric 3D Renderer v5.1 (Three.js + Crisp 2D HUD Overlay)
// Wind Waker / Brawl Stars tarzı canlı okyanus, V-köpük izleri, mermi kuyrukları, dalış sıçraması,
// haritaya özel 3D atmosfer (yağmur/şimşek, lav kıvılcımı, hayalet ateşi, martılar) ve 2 kamera açısı!

import * as THREE from '../vendor/three.module.min.js';
import { WORLD_W, WORLD_H, CHAR_MAP, ALL_ITEMS, POWERUP_MAP, BOAT_SKIN_MAP, SEA_MAPS } from './data.js?v=5.1';
import { hasLineOfSight } from './sim.js?v=5.1';

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

// Procedural tileable water-foam / caustic texture (zero external HTTP requests!)
function createOceanFoamTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Subtle nautical aqua caustics & stylized Wind Waker wave streaks
  ctx.strokeStyle = 'rgba(205, 245, 255, 0.24)';
  ctx.lineWidth = 3;
  for (let y = 16; y < size; y += 32) {
    for (let x = 0; x < size; x += 64) {
      const ox = (y % 64 === 16) ? 0 : 32;
      ctx.beginPath();
      ctx.moveTo(x + ox - 18, y);
      ctx.quadraticCurveTo(x + ox, y - 7, x + ox + 18, y);
      ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  for (let i = 0; i < 28; i++) {
    const px = ((i * 73) % size);
    const py = ((i * 41) % size);
    ctx.beginPath();
    ctx.ellipse(px, py, 10 + (i % 8), 3, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 11);
  return tex;
}

export class SeaRenderer3D {
  constructor(webglCanvas, overlayCanvas) {
    this.canvas = webglCanvas;
    this.overlayCanvas = overlayCanvas;
    this.octx = overlayCanvas.getContext('2d');

    this.camX = WORLD_W / 2;
    this.camY = WORLD_H / 2;
    this.camMode = localStorage.getItem('derinav_cam3d') === 'sinematik' ? 'sinematik' : 'taktik';
    this._curCamH = this.camMode === 'sinematik' ? 315 : 475;
    this._curCamB = this.camMode === 'sinematik' ? 405 : 340;
    this.viewW = 0;
    this.viewH = 0;
    this.time = 0;
    this.shake = 0;
    this.lightningAlpha = 0;
    this.nextLightning = 5.5;
    this.lastRoundSeen = -1;
    this.currentMapId = null;

    this.smoothPos = new Map();
    this.smoothProj = new Map();
    this.hitFlash = new Map();
    this.prevHpTotal = new Map();
    this.prevSubmerged = new Map();
    this.seenPulses = new Set();
    this.seenSinks = new Set();

    // Three.js core
    this.renderer = new THREE.WebGLRenderer({
      canvas: webglCanvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#041525');
    this.scene.fog = new THREE.FogExp2('#062038', 0.00038);

    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 15, 4200);
    this._raycaster = new THREE.Raycaster();
    this._waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._tmpVec = new THREE.Vector3();
    this._tmpNdc = new THREE.Vector2();

    // Lighting — vibrant Wind Waker maritime daylight + turquoise ocean bounce
    this.hemiLight = new THREE.HemisphereLight('#e0f2fe', '#0e4f6e', 1.65);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#fff8e6', 1.85);
    this.sunLight.position.set(WORLD_W * 0.5 + 360, 760, WORLD_H * 0.5 + 260);
    this.sunLight.castShadow = true;
    const shSize = window.innerWidth < 720 ? 512 : 1024;
    this.sunLight.shadow.mapSize.set(shSize, shSize);
    this.sunLight.shadow.camera.near = 100;
    this.sunLight.shadow.camera.far = 2200;
    const shExtent = 780;
    this.sunLight.shadow.camera.left = -shExtent;
    this.sunLight.shadow.camera.right = shExtent;
    this.sunLight.shadow.camera.top = shExtent;
    this.sunLight.shadow.camera.bottom = -shExtent;
    this.sunLight.shadow.bias = -0.0008;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Subtle fill rim light from north-west
    const rim = new THREE.DirectionalLight('#38bdf8', 0.5);
    rim.position.set(-400, 320, -400);
    this.scene.add(rim);

    // Groups
    this.mapGroup = new THREE.Group();
    this.dynamicGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();
    this.scene.add(this.mapGroup);
    this.scene.add(this.dynamicGroup);
    this.scene.add(this.fxGroup);

    // Reusable procedural water foam texture
    this.oceanTex = createOceanFoamTexture();
    this.oceanMesh = null;
    this.beachSurfMesh = null;
    this.currentStrips = [];
    this.fogMeshes = [];
    this.ambientSprites = []; // seagulls, volcanic embers, ghost wisps
    this.lighthouseRig = null;

    // Entity pools/maps (id -> Object3D)
    this.playerRigs = new Map();
    this.decoyRigs = new Map();
    this.projMeshes = new Map();
    this.barrelMeshes = new Map();
    this.powerupMeshes = new Map();
    this.breakableMeshes = new Map();
    this.trapMeshes = new Map();
    this.zoneMeshes = new Map();
    this.buoyMeshes = new Map();
    this.geyserMeshes = new Map();
    this.krakenRig = null;
    this.crownRig = null;
    this.stormRing = null;
    this.aimGuideMesh = null;
    this.diveRingMesh = null;

    // Lightweight 3D FX particles (wakes, splashes, explosions, shockwaves)
    this.particles = [];
    this._sharedGeo = {
      sphere: new THREE.SphereGeometry(1, 8, 6),
      ring: new THREE.RingGeometry(0.78, 1, 28),
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
      cone: new THREE.ConeGeometry(1, 1, 7)
    };
    this._sharedGeo.ring.rotateX(-Math.PI / 2);

    this._initPersistentHelpers();
    this.resize();
  }

  toggleCameraMode() {
    this.camMode = this.camMode === 'sinematik' ? 'taktik' : 'sinematik';
    try { localStorage.setItem('derinav_cam3d', this.camMode); } catch (_) {}
    return this.camMode;
  }

  _initPersistentHelpers() {
    // Local player aiming guide line on water surface
    const aimGeo = new THREE.PlaneGeometry(1, 3.2);
    aimGeo.rotateX(-Math.PI / 2);
    aimGeo.translate(0.5, 0, 0);
    this.aimGuideMesh = new THREE.Mesh(
      aimGeo,
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.44, depthWrite: false })
    );
    this.aimGuideMesh.position.y = 1.6;
    this.aimGuideMesh.visible = false;
    this.fxGroup.add(this.aimGuideMesh);

    // Local player underwater ambush radius ring (70px)
    const diveRingGeo = new THREE.RingGeometry(67, 71, 36);
    diveRingGeo.rotateX(-Math.PI / 2);
    this.diveRingMesh = new THREE.Mesh(
      diveRingGeo,
      new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.52, side: THREE.DoubleSide, depthWrite: false })
    );
    this.diveRingMesh.position.y = 1.8;
    this.diveRingMesh.visible = false;
    this.fxGroup.add(this.diveRingMesh);

    // Red storm cylinder wall
    const stormGeo = new THREE.CylinderGeometry(1, 1, 125, 56, 1, true);
    this.stormRing = new THREE.Mesh(
      stormGeo,
      new THREE.MeshBasicMaterial({
        color: '#ef476f',
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    this.stormRing.position.y = 60;
    this.stormRing.visible = false;
    this.fxGroup.add(this.stormRing);
  }

  triggerShake(amount = 8) {
    this.shake = Math.max(this.shake, amount);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w === this.viewW && h === this.viewH) return;
    this.viewW = w;
    this.viewH = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlayCanvas.width = Math.floor(w * dpr);
    this.overlayCanvas.height = Math.floor(h * dpr);
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  screenToWorld(sx, sy) {
    const nx = (sx / Math.max(1, this.viewW)) * 2 - 1;
    const ny = -(sy / Math.max(1, this.viewH)) * 2 + 1;
    this._tmpNdc.set(nx, ny);
    this._raycaster.setFromCamera(this._tmpNdc, this.camera);
    const hit = this._raycaster.ray.intersectPlane(this._waterPlane, this._tmpVec);
    if (hit) {
      return { x: hit.x, y: hit.z };
    }
    return { x: this.camX, y: this.camY };
  }

  _worldToScreen(wx, wy, wz) {
    this._tmpVec.set(wx, wy, wz);
    this._tmpVec.project(this.camera);
    return {
      x: (this._tmpVec.x * 0.5 + 0.5) * this.viewW,
      y: (-this._tmpVec.y * 0.5 + 0.5) * this.viewH,
      inFront: this._tmpVec.z < 1
    };
  }

  // ============================================================
  // 🏝️ MAP BUILDER (Animated Foam Ocean, Rocks, Ships, Beach, Map VFX)
  // ============================================================
  _clearGroup(group) {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      child.traverse?.((obj) => {
        if (obj.geometry && !Object.values(this._sharedGeo).includes(obj.geometry)) {
          obj.geometry.dispose?.();
        }
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose?.());
          else obj.material.dispose?.();
        }
      });
    }
  }

  _buildMap(map) {
    this.currentMapId = map.id;
    this._clearGroup(this.mapGroup);
    this.currentStrips = [];
    this.fogMeshes = [];
    this.ambientSprites = [];
    this.beachSurfMesh = null;
    this.lighthouseRig = null;

    const deepCol = new THREE.Color(map.theme.deep || '#041a2e').offsetHSL(0, 0.08, 0.07);
    const midCol = new THREE.Color(map.theme.mid || '#0a3352').offsetHSL(0, 0.14, 0.12);
    this.scene.background = deepCol.clone().multiplyScalar(0.8);
    this.scene.fog.color.copy(deepCol);

    // 1. Lightweight low-poly ocean (32x22 = super smooth on mobile + crisp wave facets + scrolling foam texture!)
    const oceanGeo = new THREE.PlaneGeometry(WORLD_W + 900, WORLD_H + 900, 32, 22);
    oceanGeo.rotateX(-Math.PI / 2);
    const pos = oceanGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const tmpC = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + WORLD_W / 2;
      const z = pos.getZ(i) + WORLD_H / 2;
      const d = Math.min(1, Math.hypot((x - WORLD_W / 2) / 920, (z - WORLD_H / 2) / 640));
      tmpC.copy(midCol).lerp(deepCol, d * 0.85);
      colors[i * 3] = tmpC.r;
      colors[i * 3 + 1] = tmpC.g;
      colors[i * 3 + 2] = tmpC.b;
    }
    oceanGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const oceanMat = new THREE.MeshStandardMaterial({
      map: this.oceanTex,
      vertexColors: true,
      roughness: 0.26,
      metalness: 0.16,
      emissive: midCol.clone().multiplyScalar(0.28),
      flatShading: true
    });
    this.oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
    this.oceanMesh.position.set(WORLD_W / 2, 0, WORLD_H / 2);
    this.oceanMesh.receiveShadow = true;
    this.mapGroup.add(this.oceanMesh);

    // Arena boundary rope / glowing golden border
    const borderMat = new THREE.MeshBasicMaterial({ color: '#ffb703', transparent: true, opacity: 0.48 });
    const borders = [
      [WORLD_W / 2, 1.4, 8, WORLD_W - 16, 4],
      [WORLD_W / 2, 1.4, WORLD_H - 8, WORLD_W - 16, 4],
      [8, 1.4, WORLD_H / 2, 4, WORLD_H - 16],
      [WORLD_W - 8, 1.4, WORLD_H / 2, 4, WORLD_H - 16]
    ];
    for (const [bx, by, bz, bw, bd] of borders) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, 2, bd), borderMat);
      m.position.set(bx, by, bz);
      this.mapGroup.add(m);
    }

    // 2. Mercan Plajı Beach + Turquoise Lagoon + Animated Surf Line + Palm Trees
    if (map.beach) {
      const b = map.beach;
      const sandGeo = new THREE.BoxGeometry(WORLD_W + 400, 14, b.sandY + 260);
      const sandMat = new THREE.MeshStandardMaterial({ color: '#e6c280', roughness: 0.88, flatShading: true });
      const sand = new THREE.Mesh(sandGeo, sandMat);
      sand.position.set(WORLD_W / 2, 5.5, (b.sandY - 260) / 2);
      sand.receiveShadow = true;
      this.mapGroup.add(sand);

      // Animated white shoreline surf wave
      const surfGeo = new THREE.PlaneGeometry(WORLD_W + 200, 18);
      surfGeo.rotateX(-Math.PI / 2);
      const surf = new THREE.Mesh(
        surfGeo,
        new THREE.MeshBasicMaterial({ color: '#f0f9ff', transparent: true, opacity: 0.62, depthWrite: false })
      );
      surf.position.set(WORLD_W / 2, 1.5, b.sandY + 8);
      this.mapGroup.add(surf);
      this.beachSurfMesh = { mesh: surf, baseZ: b.sandY + 8 };

      // Shallow turquoise lagoon band
      const lagGeo = new THREE.PlaneGeometry(WORLD_W, b.shallowY - b.sandY);
      lagGeo.rotateX(-Math.PI / 2);
      const lagMat = new THREE.MeshBasicMaterial({ color: '#2dd4bf', transparent: true, opacity: 0.36, depthWrite: false });
      const lag = new THREE.Mesh(lagGeo, lagMat);
      lag.position.set(WORLD_W / 2, 1.0, (b.sandY + b.shallowY) / 2);
      this.mapGroup.add(lag);

      // Stylized low-poly palm trees on beach
      for (const palm of b.palms || []) {
        const pg = new THREE.Group();
        pg.position.set(palm.x, 11, palm.y);
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(3.2, 5.5, 42, 6),
          new THREE.MeshStandardMaterial({ color: '#8d5524', roughness: 0.9, flatShading: true })
        );
        trunk.position.y = 20;
        trunk.rotation.z = 0.14;
        trunk.castShadow = true;
        pg.add(trunk);

        const leafMat = new THREE.MeshStandardMaterial({ color: '#22c55e', roughness: 0.7, flatShading: true });
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          const leaf = new THREE.Mesh(new THREE.ConeGeometry(7, 26, 4), leafMat);
          leaf.position.set(Math.cos(a) * 11 - 3, 41, Math.sin(a) * 11);
          leaf.rotation.z = -Math.PI * 0.42;
          leaf.rotation.y = -a;
          leaf.castShadow = true;
          pg.add(leaf);
        }
        this.mapGroup.add(pg);
      }
    }

    // 3. Rocks, Sunken Ships & Wooden Piers
    const rockMat = new THREE.MeshStandardMaterial({
      color: map.id === 'volkanik_resif' ? '#3f2e34' : '#475569',
      roughness: 0.88,
      flatShading: true
    });
    const rockTopMat = new THREE.MeshStandardMaterial({
      color: map.id === 'volkanik_resif' ? '#9a3412' : '#64748b',
      emissive: map.id === 'volkanik_resif' ? '#ea580c' : '#000000',
      emissiveIntensity: map.id === 'volkanik_resif' ? 0.45 : 0,
      roughness: 0.82,
      flatShading: true
    });
    const mossMat = new THREE.MeshStandardMaterial({ color: '#15803d', roughness: 0.85, flatShading: true });
    const foamMat = new THREE.MeshBasicMaterial({ color: '#e0f2fe', transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false });
    const woodMat = new THREE.MeshStandardMaterial({ color: '#6b4423', roughness: 0.85, flatShading: true });
    const woodDarkMat = new THREE.MeshStandardMaterial({ color: '#472d16', roughness: 0.9, flatShading: true });

    for (const obs of map.rocks || []) {
      if (obs.type === 'rock') {
        const rg = new THREE.Group();
        rg.position.set(obs.x, 0, obs.y);
        const mainRock = new THREE.Mesh(new THREE.DodecahedronGeometry(obs.r * 0.96, 0), rockMat);
        mainRock.scale.set(1.0, 0.72, 1.0);
        mainRock.position.y = obs.r * 0.34;
        mainRock.rotation.set(0.2, (obs.x * 0.013) % 6, 0.15);
        mainRock.castShadow = true;
        mainRock.receiveShadow = true;
        rg.add(mainRock);

        const peak = new THREE.Mesh(new THREE.DodecahedronGeometry(obs.r * 0.56, 0), rockTopMat);
        peak.position.set(obs.r * 0.14, obs.r * 0.68, -obs.r * 0.1);
        peak.castShadow = true;
        rg.add(peak);

        if (map.id === 'volkanik_resif') {
          // Glowing magma vein & molten collar on volcanic reefs
          const lavaRing = new THREE.Mesh(
            new THREE.RingGeometry(obs.r * 0.96, obs.r * 1.15, 22),
            new THREE.MeshBasicMaterial({ color: '#ff6b35', transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false })
          );
          lavaRing.rotation.x = -Math.PI / 2;
          lavaRing.position.y = 1.3;
          rg.add(lavaRing);
        } else {
          // Subtle green coastal moss cap on non-volcanic islands
          if (obs.r >= 44) {
            const moss = new THREE.Mesh(new THREE.DodecahedronGeometry(obs.r * 0.34, 0), mossMat);
            moss.scale.set(1.2, 0.4, 1.1);
            moss.position.set(-obs.r * 0.16, obs.r * 0.72, obs.r * 0.14);
            rg.add(moss);
          }
          const foam = new THREE.Mesh(new THREE.RingGeometry(obs.r * 0.95, obs.r * 1.16, 22), foamMat);
          foam.rotation.x = -Math.PI / 2;
          foam.position.y = 1.2;
          rg.add(foam);
        }
        this.mapGroup.add(rg);
      } else if (obs.type === 'pier') {
        const pg = new THREE.Group();
        const deck = new THREE.Mesh(new THREE.BoxGeometry(obs.w, 6, obs.h), woodMat);
        deck.position.set(obs.x + obs.w / 2, 11, obs.y + obs.h / 2);
        deck.castShadow = true;
        deck.receiveShadow = true;
        pg.add(deck);
        for (const px of [obs.x + 8, obs.x + obs.w - 8]) {
          for (const py of [obs.y + 12, obs.y + obs.h / 2, obs.y + obs.h - 12]) {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 18, 6), woodDarkMat);
            post.position.set(px, 5, py);
            post.castShadow = true;
            pg.add(post);
          }
        }
        this.mapGroup.add(pg);
      } else {
        // Sunken Pirate Ship wreck
        const sg = new THREE.Group();
        sg.position.set(obs.x + obs.w / 2, 0, obs.y + obs.h / 2);
        const hull = new THREE.Mesh(new THREE.BoxGeometry(obs.w * 0.96, 24, obs.h * 0.9), woodMat);
        hull.position.y = 10;
        hull.rotation.z = 0.05;
        hull.castShadow = true;
        hull.receiveShadow = true;
        sg.add(hull);

        const deck = new THREE.Mesh(new THREE.BoxGeometry(obs.w * 0.82, 6, obs.h * 0.72), woodDarkMat);
        deck.position.y = 22;
        deck.castShadow = true;
        sg.add(deck);

        const mast = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 5, 58, 7), woodDarkMat);
        mast.position.set(-obs.w * 0.12, 42, 0);
        mast.rotation.z = 0.14;
        mast.castShadow = true;
        sg.add(mast);

        const sail = new THREE.Mesh(
          new THREE.BoxGeometry(4, 28, Math.min(44, obs.h * 0.75)),
          new THREE.MeshStandardMaterial({
            color: obs.label === 'HAYALET' ? '#67e8f9' : '#e2e8f0',
            transparent: obs.label === 'HAYALET',
            opacity: obs.label === 'HAYALET' ? 0.6 : 0.92,
            roughness: 0.75
          })
        );
        sail.position.set(-obs.w * 0.08, 48, 0);
        sail.castShadow = true;
        sg.add(sail);
        this.mapGroup.add(sg);
      }
    }

    // 4. Turbo Sea Currents
    for (const cur of map.currents || []) {
      const cg = new THREE.Group();
      const base = new THREE.Mesh(
        new THREE.PlaneGeometry(cur.w, cur.h),
        new THREE.MeshBasicMaterial({ color: '#06b6d4', transparent: true, opacity: 0.22, depthWrite: false })
      );
      base.rotation.x = -Math.PI / 2;
      base.position.set(cur.x + cur.w / 2, 1.1, cur.y + cur.h / 2);
      cg.add(base);

      const horizontal = Math.abs(cur.dirX) >= Math.abs(cur.dirY);
      const count = Math.max(3, Math.floor((horizontal ? cur.w : cur.h) / 68));
      const stripMat = new THREE.MeshBasicMaterial({ color: '#67e8f9', transparent: true, opacity: 0.6, depthWrite: false });
      for (let i = 0; i < count; i++) {
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(horizontal ? 14 : cur.w * 0.55, 1.5, horizontal ? cur.h * 0.55 : 14),
          stripMat
        );
        bar.position.set(cur.x + cur.w / 2, 1.5, cur.y + cur.h / 2);
        cg.add(bar);
        this.currentStrips.push({ mesh: bar, cur, idx: i, count, horizontal });
      }
      this.mapGroup.add(cg);
    }

    // 5. Sea Fogs (fluffy layered low-poly mist clouds + soft edge ring)
    const fogCloudMat = new THREE.MeshStandardMaterial({
      color: '#e2f1ff',
      emissive: '#38bdf8',
      emissiveIntensity: 0.12,
      transparent: true,
      opacity: 0.24,
      roughness: 1,
      flatShading: true,
      depthWrite: false
    });
    const fogRingMat = new THREE.MeshBasicMaterial({
      color: '#bae6fd',
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    for (const fg of map.fogs || []) {
      const fGroup = new THREE.Group();
      fGroup.position.set(fg.x, 0, fg.y);
      const ring = new THREE.Mesh(new THREE.RingGeometry(fg.r - 3, fg.r, 28), fogRingMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 1.1;
      fGroup.add(ring);

      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        const distOff = k === 0 ? 0 : fg.r * 0.42;
        const rad = k === 0 ? fg.r * 0.62 : fg.r * 0.48;
        const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(rad, 1), fogCloudMat);
        puff.scale.set(1, 0.26, 1);
        puff.position.set(Math.cos(a) * distOff, 14 + (k % 2) * 5, Math.sin(a) * distOff);
        fGroup.add(puff);
      }
      this.mapGroup.add(fGroup);
      this.fogMeshes.push({ mesh: fGroup, baseX: fg.x, baseZ: fg.y });
    }

    // 6. Rotating Lighthouse Tower
    if (map.lighthouse) {
      const lh = map.lighthouse;
      const lg = new THREE.Group();
      lg.position.set(lh.x, 0, lh.y);

      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(11, 16, 78, 10),
        new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.7, flatShading: true })
      );
      tower.position.y = 39;
      tower.castShadow = true;
      lg.add(tower);

      const stripe = new THREE.Mesh(
        new THREE.CylinderGeometry(12.8, 14.5, 22, 10),
        new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.7, flatShading: true })
      );
      stripe.position.y = 42;
      lg.add(stripe);

      const lantern = new THREE.Mesh(
        new THREE.CylinderGeometry(10, 10, 14, 10),
        new THREE.MeshBasicMaterial({ color: '#fde047' })
      );
      lantern.position.y = 84;
      lg.add(lantern);

      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(13, 16, 10),
        new THREE.MeshStandardMaterial({ color: '#b91c1c', roughness: 0.6, flatShading: true })
      );
      roof.position.y = 98;
      lg.add(roof);

      const beamGroup = new THREE.Group();
      beamGroup.position.y = 4;
      const beamGeo = new THREE.CircleGeometry(lh.range, 20, -lh.halfAngle, lh.halfAngle * 2);
      beamGeo.rotateX(-Math.PI / 2);
      const beam = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({
          color: '#fde047',
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      );
      beamGroup.add(beam);
      lg.add(beamGroup);

      this.mapGroup.add(lg);
      this.lighthouseRig = { group: lg, beamGroup };
    }

    // 7. 🐦🔥👻 Map-Specific Signature Ambient 3D Life!
    if (map.id === 'volkanik_resif') {
      // Rising glowing volcanic embers
      const emberMat = new THREE.MeshBasicMaterial({ color: '#fb923c' });
      for (let i = 0; i < 18; i++) {
        const m = new THREE.Mesh(this._sharedGeo.sphere, emberMat);
        m.scale.setScalar(2.2 + (i % 3));
        const bx = 220 + ((i * 197) % (WORLD_W - 440));
        const bz = 140 + ((i * 131) % (WORLD_H - 280));
        m.position.set(bx, 10 + (i * 19) % 120, bz);
        this.mapGroup.add(m);
        this.ambientSprites.push({ kind: 'ember', mesh: m, bx, bz, phase: i * 0.7 });
      }
    } else if (map.id === 'hayalet_sis') {
      // Eerie floating turquoise ghost wisps drifting over fogs
      const wispMat = new THREE.MeshBasicMaterial({ color: '#5eead4', transparent: true, opacity: 0.75 });
      for (let i = 0; i < 14; i++) {
        const m = new THREE.Mesh(this._sharedGeo.sphere, wispMat);
        m.scale.setScalar(3.4);
        const bx = 200 + ((i * 211) % (WORLD_W - 400));
        const bz = 150 + ((i * 157) % (WORLD_H - 300));
        m.position.set(bx, 30, bz);
        this.mapGroup.add(m);
        this.ambientSprites.push({ kind: 'wisp', mesh: m, bx, bz, phase: i * 1.1 });
      }
    } else {
      // Gliding white low-poly seagulls soaring over sunlit seas & beaches!
      const gullMat = new THREE.MeshBasicMaterial({ color: '#f8fafc' });
      const gullCount = map.id === 'mercan_plaji' ? 5 : 3;
      for (let i = 0; i < gullCount; i++) {
        const gg = new THREE.Group();
        const wingL = new THREE.Mesh(new THREE.BoxGeometry(14, 1.5, 4.5), gullMat);
        wingL.position.x = -7;
        const wingR = new THREE.Mesh(new THREE.BoxGeometry(14, 1.5, 4.5), gullMat);
        wingR.position.x = 7;
        gg.add(wingL, wingR);
        gg.position.set(WORLD_W / 2, 135 + i * 18, WORLD_H / 2);
        this.mapGroup.add(gg);
        this.ambientSprites.push({
          kind: 'gull',
          mesh: gg,
          wingL,
          wingR,
          cx: 420 + i * 210,
          cz: 260 + (i % 2) * 340,
          rad: 180 + i * 45,
          spd: 0.35 + i * 0.08,
          phase: i * 2.1
        });
      }
    }
  }

  // ============================================================
  // 🚢 6 DISTINCT STYLIZED LOW-POLY 3D CHARACTER MODELS
  // ============================================================
  _createCharRig(charId, hullHex, roleHex) {
    const root = new THREE.Group();

    // Competitive water-surface hitbox ring (22px radius — matches 2D exactly!)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(20, 23.5, 28),
      new THREE.MeshBasicMaterial({ color: roleHex, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1.2;
    root.add(ring);

    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(26, 14, 10),
      new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.25, depthWrite: false })
    );
    shield.position.y = 12;
    shield.visible = false;
    root.add(shield);

    const aura = new THREE.Mesh(
      new THREE.RingGeometry(27, 32, 28),
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 1.4;
    aura.visible = false;
    root.add(aura);

    const body = new THREE.Group();
    root.add(body);

    const mainMat = new THREE.MeshStandardMaterial({
      color: hullHex,
      roughness: 0.42,
      metalness: 0.14,
      flatShading: true
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.75, flatShading: true });
    const woodMat = new THREE.MeshStandardMaterial({ color: '#78350f', roughness: 0.8, flatShading: true });
    const accentMat = new THREE.MeshStandardMaterial({ color: '#fef3c7', roughness: 0.5, flatShading: true });

    let animParts = {};

    switch (charId) {
      case 'kaptan': {
        const hull = new THREE.Mesh(new THREE.BoxGeometry(38, 12, 22), woodMat);
        hull.position.set(-2, 6, 0);
        hull.castShadow = true;
        body.add(hull);

        const prow = new THREE.Mesh(new THREE.ConeGeometry(11.5, 16, 4), new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.5, roughness: 0.35, flatShading: true }));
        prow.rotation.z = -Math.PI / 2;
        prow.rotation.x = Math.PI / 4;
        prow.position.set(24, 6.5, 0);
        prow.castShadow = true;
        body.add(prow);

        const cabin = new THREE.Mesh(new THREE.BoxGeometry(13, 10, 19), mainMat);
        cabin.position.set(-14, 15, 0);
        cabin.castShadow = true;
        body.add(cabin);

        const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 34, 6), darkMat);
        mast.position.set(2, 23, 0);
        mast.castShadow = true;
        body.add(mast);

        const sail = new THREE.Mesh(new THREE.BoxGeometry(4, 18, 26), mainMat);
        sail.position.set(6, 26, 0);
        sail.castShadow = true;
        body.add(sail);
        animParts.sail = sail;
        break;
      }

      case 'kopekbaligi': {
        const torso = new THREE.Mesh(new THREE.ConeGeometry(11.5, 38, 7), mainMat);
        torso.rotation.z = -Math.PI / 2;
        torso.scale.set(0.85, 1, 1.0);
        torso.position.set(6, 7, 0);
        torso.castShadow = true;
        body.add(torso);

        const belly = new THREE.Mesh(new THREE.SphereGeometry(10.5, 7, 6), accentMat);
        belly.scale.set(1.4, 0.55, 0.85);
        belly.position.set(2, 4.5, 0);
        body.add(belly);

        const dorsal = new THREE.Mesh(new THREE.ConeGeometry(4.5, 17, 4), mainMat);
        dorsal.position.set(-1, 17, 0);
        dorsal.rotation.z = 0.28;
        dorsal.castShadow = true;
        body.add(dorsal);

        for (const s of [-1, 1]) {
          const fin = new THREE.Mesh(new THREE.BoxGeometry(10, 2.2, 13), mainMat);
          fin.position.set(3, 5, s * 12);
          fin.rotation.y = s * -0.4;
          body.add(fin);
        }

        const tailGroup = new THREE.Group();
        tailGroup.position.set(-13, 7, 0);
        const tail = new THREE.Mesh(new THREE.ConeGeometry(8.5, 16, 4), mainMat);
        tail.rotation.z = Math.PI / 2;
        tail.scale.set(0.35, 1, 1.25);
        tail.position.set(-7, 2, 0);
        tail.castShadow = true;
        tailGroup.add(tail);
        body.add(tailGroup);
        animParts.tail = tailGroup;
        break;
      }

      case 'hayalet': {
        const ghostMat = new THREE.MeshStandardMaterial({
          color: hullHex,
          emissive: '#38bdf8',
          emissiveIntensity: 0.35,
          transparent: true,
          opacity: 0.8,
          roughness: 0.3,
          flatShading: true
        });
        const hull = new THREE.Mesh(new THREE.ConeGeometry(13, 44, 5), ghostMat);
        hull.rotation.z = -Math.PI / 2;
        hull.scale.set(0.75, 1, 1.0);
        hull.position.set(4, 8, 0);
        body.add(hull);

        const sail = new THREE.Mesh(new THREE.BoxGeometry(3.5, 22, 22), ghostMat);
        sail.position.set(2, 24, 0);
        body.add(sail);

        const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(5, 0), new THREE.MeshBasicMaterial({ color: '#a855f7' }));
        lantern.position.set(20, 14, 0);
        body.add(lantern);
        animParts.lantern = lantern;
        animParts.sail = sail;
        break;
      }

      case 'fenerci': {
        for (const s of [-1, 1]) {
          const pontoon = new THREE.Mesh(new THREE.BoxGeometry(40, 8, 7), mainMat);
          pontoon.position.set(0, 5, s * 10);
          pontoon.castShadow = true;
          body.add(pontoon);
        }
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(22, 6, 22), darkMat);
        bridge.position.set(-2, 10, 0);
        bridge.castShadow = true;
        body.add(bridge);

        const turret = new THREE.Mesh(new THREE.CylinderGeometry(6, 7.5, 16, 8), accentMat);
        turret.position.set(0, 20, 0);
        turret.castShadow = true;
        body.add(turret);

        const lamp = new THREE.Mesh(new THREE.SphereGeometry(5.5, 8, 6), new THREE.MeshBasicMaterial({ color: '#fde047' }));
        lamp.position.set(0, 30, 0);
        body.add(lamp);
        animParts.lamp = lamp;
        break;
      }

      case 'ahtapot': {
        const dome = new THREE.Mesh(new THREE.SphereGeometry(14, 10, 8), mainMat);
        dome.scale.set(1.12, 0.92, 0.95);
        dome.position.set(2, 13, 0);
        dome.castShadow = true;
        body.add(dome);

        const eyeMat = new THREE.MeshBasicMaterial({ color: '#fef08a' });
        for (const s of [-1, 1]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(3.2, 6, 6), eyeMat);
          eye.position.set(13, 14, s * 6.5);
          body.add(eye);
        }

        animParts.tentacles = [];
        for (let k = 0; k < 6; k++) {
          const a = ((k - 2.5) / 5.5) * Math.PI * 1.15;
          const tg = new THREE.Group();
          tg.position.set(-4, 6, 0);
          tg.rotation.y = a;
          const arm = new THREE.Mesh(new THREE.ConeGeometry(3.6, 24, 5), mainMat);
          arm.rotation.z = Math.PI / 2;
          arm.position.set(-11, 0, 0);
          arm.castShadow = true;
          tg.add(arm);
          body.add(tg);
          animParts.tentacles.push({ group: tg, baseA: a, idx: k });
        }
        break;
      }

      default: {
        const board = new THREE.Mesh(new THREE.BoxGeometry(38, 6.5, 16), mainMat);
        board.position.set(0, 4.5, 0);
        board.castShadow = true;
        body.add(board);

        const nose = new THREE.Mesh(new THREE.ConeGeometry(8.5, 14, 4), accentMat);
        nose.rotation.z = -Math.PI / 2;
        nose.rotation.x = Math.PI / 4;
        nose.position.set(24, 5, 0);
        nose.castShadow = true;
        body.add(nose);

        const cockpit = new THREE.Mesh(new THREE.BoxGeometry(14, 9, 10), darkMat);
        cockpit.position.set(-2, 11, 0);
        cockpit.castShadow = true;
        body.add(cockpit);

        const thrusterMat = new THREE.MeshBasicMaterial({ color: '#38bdf8' });
        for (const s of [-1, 1]) {
          const jet = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.2, 7, 6), thrusterMat);
          jet.rotation.z = Math.PI / 2;
          jet.position.set(-21, 5.5, s * 5);
          body.add(jet);
        }
        break;
      }
    }

    return {
      root,
      body,
      ring,
      shield,
      aura,
      animParts,
      charId,
      hullHex,
      roleHex,
      diveY: 0
    };
  }

  _createKrakenRig() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#9333ea', roughness: 0.45, flatShading: true });
    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(36, 1), bodyMat);
    head.scale.set(1, 0.9, 1);
    head.position.y = 24;
    head.castShadow = true;
    g.add(head);

    const eyeMat = new THREE.MeshBasicMaterial({ color: '#fde047' });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(6.5, 8, 6), eyeMat);
      eye.position.set(s * 14, 30, 26);
      g.add(eye);
    }

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(46, 52, 32),
      new THREE.MeshBasicMaterial({ color: '#d946ef', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1.4;
    g.add(ring);

    const tentacles = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const tg = new THREE.Group();
      tg.rotation.y = a;
      const arm = new THREE.Mesh(new THREE.ConeGeometry(8, 66, 6), bodyMat);
      arm.position.set(52, 22, 0);
      arm.rotation.z = -0.35;
      arm.castShadow = true;
      tg.add(arm);
      g.add(tg);
      tentacles.push({ group: tg, arm, idx: i });
    }
    this.dynamicGroup.add(g);
    return { group: g, head, tentacles };
  }

  _createCrownRig() {
    const g = new THREE.Group();
    const goldMat = new THREE.MeshStandardMaterial({
      color: '#ffd166',
      emissive: '#f59e0b',
      emissiveIntensity: 0.5,
      metalness: 0.75,
      roughness: 0.2,
      flatShading: true
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(14, 12, 10, 7), goldMat);
    base.position.y = 22;
    g.add(base);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(4, 12, 4), goldMat);
      spike.position.set(Math.cos(a) * 11, 31, Math.sin(a) * 11);
      g.add(spike);
    }
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(12, 22, 140, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
    );
    beam.position.y = 70;
    g.add(beam);
    this.dynamicGroup.add(g);
    return g;
  }

  // ============================================================
  // 👁️ VISIBILITY LOGIC (100% Parity with 2D SeaRenderer!)
  // ============================================================
  _canViewerSee(me, target, map, roundEvent = null) {
    if (!me || !me.alive) return true;
    if (me.id === target.id) return true;
    if (target.team === me.team) return true;
    if (target.revealTimer && target.revealTimer > 0) return true;
    if (target.hasCrown || target.bounty) return true;
    const ch = CHAR_MAP[me.charId];
    const tch = CHAR_MAP[target.charId];
    const myPos = this.smoothPos.get(me.id) || me;
    const tPos = this.smoothPos.get(target.id) || target;
    const d = dist(myPos.x, myPos.y, tPos.x, tPos.y);
    if (target.submerged) return false;
    if (target.inInk && d > 75) return false;
    if (target.inFog) {
      const fogDetect = tch?.stealthBonus ? 88 : 138;
      if (d > fogDetect) return false;
    }
    const visMult = roundEvent === 'gece_sisi' ? 0.7 : 1.0;
    if (d > (ch?.vision || 390) * visMult) return false;
    return hasLineOfSight(map, myPos.x, myPos.y, tPos.x, tPos.y);
  }

  // ============================================================
  // 🎆 3D PARTICLES: V-WAKES, SPLASH COLUMNS & SHOCKWAVE RINGS
  // ============================================================
  _spawnBurst(x, z, color, count = 8, spread = 90, upBoost = 65) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= 130) break;
      const a = Math.random() * Math.PI * 2;
      const spd = spread * (0.35 + Math.random() * 0.85);
      const m = new THREE.Mesh(
        this._sharedGeo.sphere,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 })
      );
      const sz = 2.5 + Math.random() * 3.5;
      m.scale.setScalar(sz);
      m.position.set(x, 6 + Math.random() * 6, z);
      this.fxGroup.add(m);
      this.particles.push({
        mesh: m,
        vx: Math.cos(a) * spd,
        vy: upBoost + Math.random() * 70,
        vz: Math.sin(a) * spd,
        gravity: 240,
        life: 0.42 + Math.random() * 0.25,
        maxLife: 0.65,
        kind: 'spark'
      });
    }
  }

  _spawnShockRing(x, z, color = '#ffffff', startR = 12, endR = 95, dur = 0.5) {
    if (this.particles.length >= 130) return;
    const m = new THREE.Mesh(
      this._sharedGeo.ring,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
    );
    m.position.set(x, 1.7, z);
    m.scale.setScalar(startR);
    this.fxGroup.add(m);
    this.particles.push({
      mesh: m,
      startR,
      endR,
      life: dur,
      maxLife: dur,
      kind: 'shock'
    });
  }

  _spawnVWake(x, z, aim, colorHex = '#e0f2fe') {
    if (this.particles.length >= 130) return;
    // Dual V-shaped stern wake puffs + gentle trailing ring
    for (const side of [-1, 1]) {
      const a = aim + Math.PI + side * 0.45;
      const m = new THREE.Mesh(
        this._sharedGeo.sphere,
        new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.55, depthWrite: false })
      );
      m.scale.set(5.5, 1.4, 5.5);
      m.position.set(x - Math.cos(aim) * 16 + Math.cos(a) * 8, 1.3, z - Math.sin(aim) * 16 + Math.sin(a) * 8);
      this.fxGroup.add(m);
      this.particles.push({
        mesh: m,
        vx: Math.cos(a) * 32,
        vy: 0,
        vz: Math.sin(a) * 32,
        gravity: 0,
        life: 0.55,
        maxLife: 0.55,
        kind: 'foam'
      });
    }
  }

  _stepParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.fxGroup.remove(pt.mesh);
        pt.mesh.material.dispose?.();
        this.particles.splice(i, 1);
        continue;
      }
      const ratio = pt.life / pt.maxLife;
      if (pt.kind === 'shock') {
        const prog = 1 - ratio;
        pt.mesh.scale.setScalar(pt.startR + (pt.endR - pt.startR) * prog);
        pt.mesh.material.opacity = ratio * 0.78;
      } else if (pt.kind === 'foam') {
        pt.mesh.position.x += pt.vx * dt;
        pt.mesh.position.z += pt.vz * dt;
        const sc = 5.5 + (1 - ratio) * 9;
        pt.mesh.scale.set(sc, 1.2, sc);
        pt.mesh.material.opacity = ratio * 0.48;
      } else {
        pt.vy -= pt.gravity * dt;
        pt.mesh.position.x += pt.vx * dt;
        pt.mesh.position.y = Math.max(1, pt.mesh.position.y + pt.vy * dt);
        pt.mesh.position.z += pt.vz * dt;
        pt.mesh.material.opacity = ratio;
      }
    }
  }

  // ============================================================
  // 🎬 MAIN RENDER LOOP
  // ============================================================
  render(state, myId, dt, localAim, localPred, touchJoy = null) {
    this.resize();
    this.time += dt;
    if (!state) return;

    const map = SEA_MAPS[(state.mapIndex || 0) % SEA_MAPS.length];
    if (this.currentMapId !== map.id) {
      this._buildMap(map);
    }

    if (state.round !== this.lastRoundSeen) {
      this.lastRoundSeen = state.round;
      this.smoothPos.clear();
      this.smoothProj.clear();
      this.hitFlash.clear();
      this.prevHpTotal.clear();
      this.prevSubmerged.clear();
      this.seenPulses.clear();
      this.seenSinks.clear();
    }

    // Dynamic fog intensity for Gece Sisi
    this.scene.fog.density = state.roundEvent === 'gece_sisi' ? 0.00095 : 0.00036;

    // Scroll procedural water foam texture + gentle low-poly wave ripples
    this.oceanTex.offset.x = (this.time * 0.035) % 1;
    this.oceanTex.offset.y = (this.time * 0.022) % 1;
    if (this.oceanMesh) {
      const pos = this.oceanMesh.geometry.attributes.position;
      const t = this.time * 2.0;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        pos.setY(i, Math.sin(x * 0.02 + t) * 2.2 + Math.cos(z * 0.024 + t * 0.85) * 1.8);
      }
      pos.needsUpdate = true;
    }

    // Mercan Plajı animated shoreline surf
    if (this.beachSurfMesh) {
      this.beachSurfMesh.mesh.position.z = this.beachSurfMesh.baseZ + Math.sin(this.time * 2.4) * 6;
      this.beachSurfMesh.mesh.material.opacity = 0.45 + Math.sin(this.time * 2.4) * 0.2;
    }

    // Animate turbo current chevrons
    for (const st of this.currentStrips) {
      const { cur, idx, count, horizontal } = st;
      const span = horizontal ? cur.w : cur.h;
      const dir = horizontal ? Math.sign(cur.dirX || 1) : Math.sign(cur.dirY || 1);
      let offset = ((idx / count) * span + this.time * 115 * dir) % span;
      if (offset < 0) offset += span;
      if (horizontal) st.mesh.position.x = cur.x + offset;
      else st.mesh.position.z = cur.y + offset;
    }

    // Animate ambient map life (seagulls, volcanic embers, ghost wisps)
    for (const sp of this.ambientSprites) {
      if (sp.kind === 'gull') {
        const a = this.time * sp.spd + sp.phase;
        sp.mesh.position.x = sp.cx + Math.cos(a) * sp.rad;
        sp.mesh.position.z = sp.cz + Math.sin(a) * sp.rad * 0.72;
        sp.mesh.rotation.y = -a;
        const flap = Math.sin(this.time * 8 + sp.phase) * 0.35;
        sp.wingL.rotation.z = flap;
        sp.wingR.rotation.z = -flap;
      } else if (sp.kind === 'ember') {
        sp.mesh.position.y = ((sp.mesh.position.y + dt * 28) % 125) + 4;
        sp.mesh.position.x = sp.bx + Math.sin(this.time * 2 + sp.phase) * 16;
      } else if (sp.kind === 'wisp') {
        sp.mesh.position.y = 26 + Math.sin(this.time * 2.2 + sp.phase) * 11;
        sp.mesh.position.x = sp.bx + Math.cos(this.time * 0.9 + sp.phase) * 28;
        sp.mesh.position.z = sp.bz + Math.sin(this.time * 1.1 + sp.phase) * 22;
      }
    }

    // Fırtına Boğazı occasional subtle lightning flash
    if (map.id === 'firtina_bogazi') {
      this.nextLightning -= dt;
      if (this.nextLightning <= 0) {
        this.lightningAlpha = 0.22;
        this.nextLightning = 6 + Math.random() * 8;
      }
      this.lightningAlpha = Math.max(0, this.lightningAlpha - dt * 1.1);
    } else {
      this.lightningAlpha = 0;
    }

    // Animate lighthouse rotation
    if (this.lighthouseRig && state.lighthouse) {
      this.lighthouseRig.beamGroup.rotation.y = -state.lighthouse.angle;
    }

    const players = state.players || [];
    const me = players.find(p => p.id === myId) || players[0];

    // Smooth positions, damage juice, V-wakes & dive/emerge splashes!
    for (const p of players) {
      let sp = this.smoothPos.get(p.id);
      if (!sp) {
        sp = { x: p.x, y: p.y, aim: p.aim };
        this.smoothPos.set(p.id, sp);
      } else if (p.id === myId && localPred) {
        sp.x = localPred.x;
        sp.y = localPred.y;
        sp.aim = Number.isFinite(localAim) ? localAim : p.aim;
      } else {
        const err = Math.hypot(p.x - sp.x, p.y - sp.y);
        if (err > 180) {
          sp.x = p.x;
          sp.y = p.y;
        } else {
          sp.x += (p.vx || 0) * dt * 0.65;
          sp.y += (p.vy || 0) * dt * 0.65;
          const k = Math.min(1, dt * 16);
          sp.x += (p.x - sp.x) * k;
          sp.y += (p.y - sp.y) * k;
        }
        sp.aim = p.id === myId && Number.isFinite(localAim) ? localAim : p.aim;
      }

      // Dive & Surprise-Surface 3D water spray!
      const wasSub = this.prevSubmerged.get(p.id);
      if (p.alive && wasSub !== undefined && wasSub !== Boolean(p.submerged)) {
        if (this._canViewerSee(me, p, map, state.roundEvent) || p.id === myId) {
          this._spawnBurst(sp.x, sp.y, '#e0f2fe', 10, 75, 95);
          this._spawnShockRing(sp.x, sp.y, p.submerged ? '#38bdf8' : '#ffd166', 10, p.submerged ? 55 : 75, 0.45);
        }
      }
      this.prevSubmerged.set(p.id, Boolean(p.submerged));

      // Hit flash + burst on damage
      const curTot = (p.hp || 0) + (p.breath || 0) + (p.shield || 0);
      const prevTot = this.prevHpTotal.get(p.id);
      if (p.alive && prevTot !== undefined && prevTot - curTot >= 8) {
        this.hitFlash.set(p.id, 0.16);
        this._spawnBurst(sp.x, sp.y, '#ffd166', 7, 100);
        if (p.id === myId) this.triggerShake(Math.min(10, (prevTot - curTot) * 0.12));
      }
      this.prevHpTotal.set(p.id, curTot);

      // V-shaped surface wake trail
      if (p.alive && !p.submerged && Math.hypot(p.vx || 0, p.vy || 0) > 42 && Math.random() < dt * 13) {
        this._spawnVWake(sp.x, sp.y, sp.aim);
      }
    }

    for (const [id, hf] of this.hitFlash.entries()) {
      if (hf - dt <= 0) this.hitFlash.delete(id);
      else this.hitFlash.set(id, hf - dt);
    }

    // Pulse explosions & shockwaves
    for (const pu of state.pulses || []) {
      if (this.seenPulses.has(pu.id)) continue;
      this.seenPulses.add(pu.id);
      if (pu.kind === 'boom' || pu.kind === 'barrel') {
        this._spawnBurst(pu.x, pu.y, '#ff6b35', 16, 160, 110);
        this._spawnShockRing(pu.x, pu.y, '#fb923c', 16, Math.min(165, pu.maxR || 130), 0.52);
        this.triggerShake(10);
      } else if (pu.kind === 'electric') {
        this._spawnBurst(pu.x, pu.y, '#38bdf8', 10, 120);
        this._spawnShockRing(pu.x, pu.y, '#38bdf8', 12, 95, 0.42);
      } else if (pu.kind === 'sonar') {
        this._spawnShockRing(pu.x, pu.y, '#38bdf8', 22, 320, 0.85);
      } else if (pu.kind === 'flash') {
        this._spawnShockRing(pu.x, pu.y, '#fef08a', 14, 150, 0.45);
      } else if (pu.kind === 'heal') {
        this._spawnShockRing(pu.x, pu.y, '#06d6a0', 10, 72, 0.45);
      }
    }

    // Follow camera smoothly on player + smooth transition between Taktik & Sinematik angles
    let targetX = WORLD_W / 2;
    let targetZ = WORLD_H / 2;
    if (me) {
      if (me.alive) {
        const sp = this.smoothPos.get(me.id) || me;
        targetX = sp.x;
        targetZ = sp.y;
      } else {
        const spectate = players.find(p => p.alive && p.team === me.team) || players.find(p => p.alive);
        if (spectate) {
          const sp = this.smoothPos.get(spectate.id) || spectate;
          targetX = sp.x;
          targetZ = sp.y;
        }
      }
    }
    this.camX += (targetX - this.camX) * Math.min(1, dt * 8.5);
    this.camY += (targetZ - this.camY) * Math.min(1, dt * 8.5);

    this.shake = Math.max(0, this.shake - dt * 28);
    const sxOff = (Math.random() - 0.5) * this.shake * 1.4;
    const szOff = (Math.random() - 0.5) * this.shake * 1.4;

    const isNarrow = this.viewW < 640;
    const wantH = this.camMode === 'sinematik' ? (isNarrow ? 390 : 310) : (isNarrow ? 590 : 475);
    const wantB = this.camMode === 'sinematik' ? (isNarrow ? 470 : 405) : (isNarrow ? 420 : 340);
    this._curCamH += (wantH - this._curCamH) * Math.min(1, dt * 6);
    this._curCamB += (wantB - this._curCamB) * Math.min(1, dt * 6);

    this.camera.position.set(this.camX + sxOff, this._curCamH, this.camY + this._curCamB + szOff);
    this.camera.lookAt(this.camX + sxOff * 0.4, 8, this.camY + 10 + szOff * 0.4);

    this.sunLight.position.set(this.camX + 340, 740, this.camY + 240);
    this.sunLight.target.position.set(this.camX, 0, this.camY);

    // Sync all 3D entities
    this._syncPlayers(state, players, me, map);
    this._syncDecoys(state.decoys || [], me, map);
    this._syncProjectiles(state.projectiles || []);
    this._syncBarrels(state.barrels || []);
    this._syncPowerups(state.powerups || []);
    this._syncBreakables(state.breakables || []);
    this._syncTraps(state.traps || [], me);
    this._syncZones(state.zones || []);
    this._syncBuoys(state.rescueBuoys || []);
    this._syncGeysers(state.geysers || []);
    this._syncKraken(state.kraken);
    this._syncCrown(state.crown);

    if (state.storm && state.storm.active) {
      this.stormRing.visible = true;
      this.stormRing.position.set(state.storm.cx, 60, state.storm.cy);
      this.stormRing.scale.set(Math.max(10, state.storm.r), 1, Math.max(10, state.storm.r));
    } else {
      this.stormRing.visible = false;
    }

    this._stepParticles(dt);

    // Render WebGL 3D scene!
    this.renderer.render(this.scene, this.camera);

    // Render crisp 2D Overlay (vision vignette, storm rain, nameplates, HP/Breath, minimap, touch joystick!)
    this._renderOverlay2D(state, players, me, map, touchJoy);
  }

  _syncPlayers(state, players, me, map) {
    const aliveIds = new Set();
    let showAim = false;
    let showDiveRing = false;

    for (const p of players) {
      if (!p.alive) continue;
      if (!this._canViewerSee(me, p, map, state.roundEvent)) continue;
      aliveIds.add(p.id);

      const ch = CHAR_MAP[p.charId] || { color: '#38bdf8' };
      const skin = BOAT_SKIN_MAP[p.skinId] || BOAT_SKIN_MAP.auto;
      const hullHex = skin.hull || ch.color;
      const roleHex = p.role === 'hunter' ? '#ffb703' : (p.role === 'ffa' ? '#ff6b6b' : '#06d6a0');

      let rig = this.playerRigs.get(p.id);
      if (!rig || rig.charId !== p.charId || rig.hullHex !== hullHex || rig.roleHex !== roleHex) {
        if (rig) this.dynamicGroup.remove(rig.root);
        rig = this._createCharRig(p.charId, hullHex, roleHex);
        this.dynamicGroup.add(rig.root);
        this.playerRigs.set(p.id, rig);
      }

      const sp = this.smoothPos.get(p.id) || p;
      rig.root.visible = true;
      rig.root.position.set(sp.x, 0, sp.y);

      const targetY = p.submerged ? -14 : (Math.sin(this.time * 4 + sp.x * 0.02) * 1.4);
      rig.diveY += (targetY - rig.diveY) * 0.22;
      rig.body.position.y = rig.diveY;
      rig.body.rotation.y = -sp.aim;

      const spd = Math.hypot(p.vx || 0, p.vy || 0);
      rig.body.rotation.x = Math.sin(this.time * 5 + sp.y * 0.02) * 0.045;
      rig.body.rotation.z = Math.min(0.14, spd * 0.0004);

      if (rig.animParts.tail) rig.animParts.tail.rotation.y = Math.sin(this.time * (8 + spd * 0.03)) * 0.42;
      if (rig.animParts.sail) rig.animParts.sail.scale.x = 1 + Math.sin(this.time * 4.5) * 0.14;
      if (rig.animParts.tentacles) {
        for (const t of rig.animParts.tentacles) {
          t.group.rotation.y = t.baseA + Math.sin(this.time * 5 + t.idx) * 0.22;
          t.group.rotation.z = Math.cos(this.time * 4 + t.idx) * 0.18;
        }
      }
      if (rig.animParts.lantern) rig.animParts.lantern.rotation.y = this.time * 3;

      rig.shield.visible = (p.shield || 0) > 0 || (p.mirrorTimer || 0) > 0;
      if (rig.shield.visible) rig.shield.material.color.set(p.mirrorTimer > 0 ? '#e0f2fe' : '#38bdf8');
      rig.aura.visible = Boolean(p.hasCrown || p.bounty);
      if (rig.aura.visible) rig.aura.scale.setScalar(1 + Math.sin(this.time * 7) * 0.08);

      const hf = this.hitFlash.get(p.id) || 0;
      rig.body.traverse((obj) => {
        if (obj.isMesh && obj.material && obj.material.emissive) {
          if (hf > 0) obj.material.emissive.set('#ffffff');
          else if (p.charId === 'hayalet') obj.material.emissive.set('#38bdf8');
          else obj.material.emissive.set('#000000');
          obj.material.emissiveIntensity = hf > 0 ? 0.85 : (p.charId === 'hayalet' ? 0.35 : 0);
        }
      });

      if (me && p.id === me.id) {
        if (p.submerged) {
          showDiveRing = true;
          this.diveRingMesh.position.set(sp.x, 1.8, sp.y);
          this.diveRingMesh.material.color.set(p.diveTime >= 1.0 ? '#ffd166' : '#38bdf8');
        } else {
          const it0 = p.items?.[0];
          const range = (it0 && it0.usesLeft > 0 && ALL_ITEMS[it0.id]?.range) ? Math.min(340, ALL_ITEMS[it0.id].range * 0.55) : 140;
          showAim = true;
          this.aimGuideMesh.position.set(sp.x, 1.7, sp.y);
          this.aimGuideMesh.rotation.y = -sp.aim;
          this.aimGuideMesh.scale.set(range, 1, 1);
          this.aimGuideMesh.material.color.set(p.role === 'hunter' ? '#ffd166' : '#80ffdb');
        }
      }
    }

    this.aimGuideMesh.visible = showAim;
    this.diveRingMesh.visible = showDiveRing;

    for (const [id, rig] of this.playerRigs.entries()) {
      if (!aliveIds.has(id)) rig.root.visible = false;
    }
  }

  _syncDecoys(decoys, me, map) {
    const seen = new Set();
    for (const d of decoys) {
      if (me && me.team !== d.team) {
        const myPos = this.smoothPos.get(me.id) || me;
        if (dist(myPos.x, myPos.y, d.x, d.y) > 420 || !hasLineOfSight(map, myPos.x, myPos.y, d.x, d.y)) continue;
      }
      seen.add(d.id);
      let rig = this.decoyRigs.get(d.id);
      if (!rig) {
        const ch = CHAR_MAP[d.charId] || { color: '#38bdf8' };
        rig = this._createCharRig(d.charId, ch.color, d.role === 'hunter' ? '#ffb703' : '#06d6a0');
        this.dynamicGroup.add(rig.root);
        this.decoyRigs.set(d.id, rig);
      }
      rig.root.position.set(d.x, 0, d.y);
      rig.body.rotation.y = -d.aim;
    }
    for (const [id, rig] of this.decoyRigs.entries()) {
      if (!seen.has(id)) {
        this.dynamicGroup.remove(rig.root);
        this.decoyRigs.delete(id);
      }
    }
  }

  _syncProjectiles(projectiles) {
    const seen = new Set();
    for (const pr of projectiles) {
      seen.add(pr.id);
      let m = this.projMeshes.get(pr.id);
      if (!m) {
        const col = pr.color || '#ffd166';
        const g = new THREE.Group();

        // Projectile head
        let head;
        if (pr.kind === 'harpoon' || pr.kind === 'hook') {
          head = new THREE.Mesh(
            new THREE.CylinderGeometry(2.4, 3.6, 26, 6),
            new THREE.MeshBasicMaterial({ color: col })
          );
          head.rotation.z = Math.PI / 2;
        } else if (pr.kind === 'net' || pr.kind === 'electric_net') {
          head = new THREE.Mesh(
            new THREE.TorusGeometry(11.5, 2.8, 6, 12),
            new THREE.MeshBasicMaterial({ color: col })
          );
          head.rotation.x = Math.PI / 2;
        } else {
          head = new THREE.Mesh(
            new THREE.SphereGeometry(pr.r ? pr.r * 1.05 : 7, 8, 6),
            new THREE.MeshBasicMaterial({ color: col })
          );
        }
        g.add(head);

        // Glowing elongated 3D tracer tail (makes every projectile super crisp & dodgeable!)
        const trailLen = pr.firearm ? 54 : 32;
        const trail = new THREE.Mesh(
          new THREE.ConeGeometry(pr.firearm ? 5.2 : 3.8, trailLen, 6),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, depthWrite: false })
        );
        trail.rotation.z = Math.PI / 2;
        trail.position.x = -trailLen * 0.55;
        g.add(trail);

        this.dynamicGroup.add(g);
        this.projMeshes.set(pr.id, g);
        m = g;
      }
      m.position.set(pr.x, 11, pr.y);
      m.rotation.y = -Math.atan2(pr.vy || 0, pr.vx || 1);
    }
    for (const [id, m] of this.projMeshes.entries()) {
      if (!seen.has(id)) {
        this.dynamicGroup.remove(m);
        m.traverse?.((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
        this.projMeshes.delete(id);
      }
    }
  }

  _syncBarrels(barrels) {
    const seen = new Set();
    for (const b of barrels) {
      seen.add(b.id);
      let m = this.barrelMeshes.get(b.id);
      if (!m) {
        const g = new THREE.Group();
        const cyl = new THREE.Mesh(
          new THREE.CylinderGeometry(12, 12, 20, 10),
          new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.65, flatShading: true })
        );
        cyl.position.y = 10;
        cyl.castShadow = true;
        g.add(cyl);
        const band = new THREE.Mesh(
          new THREE.CylinderGeometry(12.6, 12.6, 4.5, 10),
          new THREE.MeshStandardMaterial({ color: '#fbbf24', roughness: 0.5 })
        );
        band.position.y = 10;
        g.add(band);
        this.dynamicGroup.add(g);
        this.barrelMeshes.set(b.id, g);
        m = g;
      }
      m.position.set(b.x, Math.sin(this.time * 4 + b.id) * 1.6, b.y);
    }
    for (const [id, m] of this.barrelMeshes.entries()) {
      if (!seen.has(id)) {
        this.dynamicGroup.remove(m);
        this.barrelMeshes.delete(id);
      }
    }
  }

  _syncPowerups(powerups) {
    const seen = new Set();
    for (const pu of powerups) {
      seen.add(pu.id);
      let m = this.powerupMeshes.get(pu.id);
      if (!m) {
        const def = POWERUP_MAP[pu.kind];
        const col = def?.color || '#ffd166';
        const g = new THREE.Group();
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(18, 15, 18),
          new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.25, roughness: 0.4, flatShading: true })
        );
        box.position.y = 12;
        box.castShadow = true;
        g.add(box);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(16, 20, 20),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 1.4;
        g.add(ring);
        this.dynamicGroup.add(g);
        this.powerupMeshes.set(pu.id, g);
        m = g;
      }
      m.position.set(pu.x, Math.sin(this.time * 3.5 + pu.id) * 3.5, pu.y);
      m.children[0].rotation.y = this.time * 1.6;
    }
    for (const [id, m] of this.powerupMeshes.entries()) {
      if (!seen.has(id)) {
        this.dynamicGroup.remove(m);
        this.powerupMeshes.delete(id);
      }
    }
  }

  _syncBreakables(breakables) {
    const seen = new Set();
    for (const br of breakables) {
      seen.add(br.id);
      let m = this.breakableMeshes.get(br.id);
      if (!m) {
        m = new THREE.Mesh(
          new THREE.CylinderGeometry(br.r * 0.9, br.r, 22, 7),
          new THREE.MeshStandardMaterial({ color: '#92400e', roughness: 0.85, flatShading: true })
        );
        m.castShadow = true;
        this.dynamicGroup.add(m);
        this.breakableMeshes.set(br.id, m);
      }
      const hpRatio = Math.max(0.4, (br.hp || 1) / (br.maxHp || 100));
      m.position.set(br.x, 10 * hpRatio, br.y);
      m.scale.set(1, hpRatio, 1);
    }
    for (const [id, m] of this.breakableMeshes.entries()) {
      if (!seen.has(id)) {
        this.dynamicGroup.remove(m);
        m.geometry?.dispose?.();
        m.material?.dispose?.();
        this.breakableMeshes.delete(id);
      }
    }
  }

  _syncTraps(traps, me) {
    const seen = new Set();
    for (const tr of traps) {
      const isAlly = me && tr.team === me.team;
      if (!isAlly && tr.armed && !tr.revealed) continue;
      seen.add(tr.id);
      let m = this.trapMeshes.get(tr.id);
      if (!m) {
        const col = tr.kind === 'mine' ? '#ef476f' : '#ffb703';
        const g = new THREE.Group();
        const orb = new THREE.Mesh(
          new THREE.OctahedronGeometry(10, 0),
          new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, flatShading: true })
        );
        orb.position.y = 6;
        g.add(orb);
        const r = new THREE.Mesh(
          new THREE.RingGeometry((tr.r || 38) - 2, tr.r || 38, 24),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: isAlly ? 0.4 : 0.65, side: THREE.DoubleSide, depthWrite: false })
        );
        r.rotation.x = -Math.PI / 2;
        r.position.y = 1.4;
        g.add(r);
        this.dynamicGroup.add(g);
        this.trapMeshes.set(tr.id, g);
        m = g;
      }
      m.position.set(tr.x, 0, tr.y);
    }
    for (const [id, m] of this.trapMeshes.entries()) {
      if (!seen.has(id)) {
        this.dynamicGroup.remove(m);
        this.trapMeshes.delete(id);
      }
    }
  }

  _syncZones(zones) {
    const seen = new Set();
    for (const z of zones) {
      seen.add(z.id);
      let m = this.zoneMeshes.get(z.id);
      if (!m) {
        let col = '#1e293b';
        let op = 0.62;
        let h = 18;
        if (z.kind === 'flare') { col = '#fb7185'; op = 0.22; h = 4; }
        else if (z.kind === 'gravity') { col = '#a855f7'; op = 0.3; h = 6; }
        else if (z.kind === 'kelp') { col = '#10b981'; op = 0.42; h = 4; }
        m = new THREE.Mesh(
          new THREE.CylinderGeometry(z.r, z.r, h, 24),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false })
        );
        this.dynamicGroup.add(m);
        this.zoneMeshes.set(z.id, m);
      }
      m.position.set(z.x, z.kind === 'ink' ? 12 : 2.5, z.y);
      if (z.kind === 'gravity') m.rotation.y = this.time * 4;
    }
    for (const [id, m] of this.zoneMeshes.entries()) {
      if (!seen.has(id)) {
        this.dynamicGroup.remove(m);
        m.geometry?.dispose?.();
        m.material?.dispose?.();
        this.zoneMeshes.delete(id);
      }
    }
  }

  _syncBuoys(buoys) {
    const seen = new Set();
    for (const rb of buoys) {
      seen.add(rb.id);
      let m = this.buoyMeshes.get(rb.id);
      if (!m) {
        const g = new THREE.Group();
        const torus = new THREE.Mesh(
          new THREE.TorusGeometry(13, 4.2, 8, 16),
          new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.4 })
        );
        torus.rotation.x = Math.PI / 2;
        torus.position.y = 5;
        g.add(torus);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry((rb.r || 66) - 3, rb.r || 66, 28),
          new THREE.MeshBasicMaterial({ color: '#06d6a0', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 1.4;
        g.add(ring);
        this.dynamicGroup.add(g);
        this.buoyMeshes.set(rb.id, g);
        m = g;
      }
      m.position.set(rb.x, Math.sin(this.time * 4) * 1.5, rb.y);
    }
    for (const [id, m] of this.buoyMeshes.entries()) {
      if (!seen.has(id)) {
        this.dynamicGroup.remove(m);
        this.buoyMeshes.delete(id);
      }
    }
  }

  _syncGeysers(geysers) {
    const seen = new Set();
    for (let i = 0; i < geysers.length; i++) {
      const gz = geysers[i];
      const key = `g_${i}`;
      seen.add(key);
      let m = this.geyserMeshes.get(key);
      if (!m) {
        const g = new THREE.Group();
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(gz.r - 4, gz.r, 24),
          new THREE.MeshBasicMaterial({ color: '#ff6b35', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 1.3;
        g.add(ring);
        const col = new THREE.Mesh(
          new THREE.CylinderGeometry(gz.r * 0.55, gz.r * 0.78, 95, 12),
          new THREE.MeshBasicMaterial({ color: '#ff5500', transparent: true, opacity: 0.78, depthWrite: false })
        );
        col.position.y = 48;
        col.visible = false;
        g.add(col);
        this.dynamicGroup.add(g);
        this.geyserMeshes.set(key, g);
        m = g;
      }
      m.position.set(gz.x, 0, gz.y);
      const erupting = gz.phase === 'erupt';
      const warning = gz.phase === 'warn';
      m.children[0].visible = warning || erupting;
      m.children[0].material.color.set(erupting ? '#ff3b30' : '#fbbf24');
      m.children[1].visible = erupting;
      if (erupting) m.children[1].scale.y = 0.8 + Math.sin(this.time * 24) * 0.2;
    }
    for (const [k, m] of this.geyserMeshes.entries()) {
      if (!seen.has(k)) {
        this.dynamicGroup.remove(m);
        this.geyserMeshes.delete(k);
      }
    }
  }

  _syncKraken(kraken) {
    if (!kraken) {
      if (this.krakenRig) this.krakenRig.group.visible = false;
      return;
    }
    if (!this.krakenRig) this.krakenRig = this._createKrakenRig();
    this.krakenRig.group.visible = true;
    this.krakenRig.group.position.set(kraken.x, Math.sin(this.time * 2.5) * 4, kraken.y);
    this.krakenRig.head.rotation.y = Math.sin(this.time * 1.4) * 0.25;
    for (const t of this.krakenRig.tentacles) {
      const wave = Math.sin(this.time * 4.2 + t.idx * 0.85);
      t.arm.rotation.z = -0.35 + wave * 0.28;
      t.arm.position.y = 22 + Math.cos(this.time * 3.5 + t.idx) * 7;
    }
  }

  _syncCrown(crown) {
    if (!crown || crown.holderId) {
      if (this.crownRig) this.crownRig.visible = false;
      return;
    }
    if (!this.crownRig) this.crownRig = this._createCrownRig();
    this.crownRig.visible = true;
    this.crownRig.position.set(crown.x, Math.sin(this.time * 4) * 5, crown.y);
    this.crownRig.rotation.y = this.time * 2.1;
  }

  // ============================================================
  // 🎯 CRISP 2D OVERLAY (Vision Vignette, Storm Rain, Nameplates, Minimap)
  // ============================================================
  _renderOverlay2D(state, players, me, map, touchJoy) {
    const ctx = this.octx;
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    // 0. Atmospheric Vision Vignette centered on local player (matches 2D stealth tension!)
    if (me && me.alive) {
      const sp = this.smoothPos.get(me.id) || me;
      const center = this._worldToScreen(sp.x, 8, sp.y);
      const isNight = state.roundEvent === 'gece_sisi';
      const innerR = Math.min(this.viewW, this.viewH) * (isNight ? 0.25 : 0.38);
      const outerR = Math.max(this.viewW, this.viewH) * (isNight ? 0.62 : 0.78);
      const vig = ctx.createRadialGradient(center.x, center.y, innerR, center.x, center.y, outerR);
      vig.addColorStop(0, 'rgba(2, 10, 20, 0)');
      vig.addColorStop(1, isNight ? 'rgba(1, 6, 14, 0.72)' : 'rgba(2, 10, 20, 0.42)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }

    // 0b. ⛈️ Fırtına Boğazı animated rain & subtle lightning flash!
    if (map.id === 'firtina_bogazi') {
      ctx.save();
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.16)';
      ctx.lineWidth = 1.2;
      const t = this.time * 540;
      const drops = this.viewW < 640 ? 28 : 48;
      ctx.beginPath();
      for (let i = 0; i < drops; i++) {
        const rx = ((i * 97 + t * 0.35) % (this.viewW + 80)) - 40;
        const ry = ((i * 131 + t) % (this.viewH + 60)) - 30;
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 7, ry + 18);
      }
      ctx.stroke();
      if (this.lightningAlpha > 0.01) {
        ctx.fillStyle = `rgba(224, 242, 254, ${this.lightningAlpha})`;
        ctx.fillRect(0, 0, this.viewW, this.viewH);
      }
      ctx.restore();
    }

    // 1. Player Nameplates, Bars, Mario Hearts, Status Badges & Emotes
    for (const p of players) {
      if (!p.alive) continue;
      if (!this._canViewerSee(me, p, map, state.roundEvent)) continue;
      const sp = this.smoothPos.get(p.id) || p;
      const scr = this._worldToScreen(sp.x, p.submerged ? 14 : 44, sp.y);
      if (!scr.inFront) continue;

      const x = scr.x;
      const y = scr.y;
      const ch = CHAR_MAP[p.charId] || { accent: '#e0f2fe' };

      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '800 12px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(2, 12, 24, 0.72)';
      const nameTxt = `${p.hasCrown ? '👑 ' : (p.bounty ? '💰 ' : '')}${p.name}`;
      const tw = ctx.measureText(nameTxt).width + 10;
      ctx.beginPath();
      ctx.roundRect(x - tw / 2, y - 34, tw, 17, 6);
      ctx.fill();
      ctx.fillStyle = p.hasCrown ? '#ffd166' : (p.role === 'hunter' ? '#ffd166' : p.role === 'ffa' ? ch.accent : '#80ffdb');
      ctx.fillText(nameTxt, x, y - 21);

      if ((p.maxLives || 1) > 1) {
        const heartsStr = '❤️'.repeat(p.lives || 0) + '🖤'.repeat(Math.max(0, (p.maxLives || 1) - (p.lives || 0)));
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.fillText(heartsStr, x, y - 40);
      }

      const badgeY = (p.maxLives || 1) > 1 ? y - 55 : y - 40;
      ctx.font = '800 10.5px system-ui, sans-serif';
      if (p.rootTimer) { ctx.fillStyle = '#ffb703'; ctx.fillText('⚓ ÇAPALANDI', x, badgeY); }
      else if (p.stunTimer) { ctx.fillStyle = '#f43f5e'; ctx.fillText('⚡ SERSEMLEDİ', x, badgeY); }
      else if (p.submerged) { ctx.fillStyle = '#7dd3fc'; ctx.fillText('🤿 SU ALTI', x, badgeY); }
      else if (p.inStorm) { ctx.fillStyle = '#ff4d6d'; ctx.fillText('🌪️ FIRTINA!', x, badgeY); }

      const bw = 48;
      const bx = x - bw / 2;
      const by = y - 14;
      const brRatio = Math.max(0, Math.min(1, (p.breath || 0) / (p.maxBreath || 70)));
      const hpRatio = Math.max(0, Math.min(1, (p.hp || 0) / (p.maxHp || 120)));

      ctx.fillStyle = 'rgba(3, 12, 24, 0.85)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, 11);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(bx, by, bw * brRatio, 3.5);
      ctx.fillStyle = hpRatio > 0.45 ? '#06d6a0' : (hpRatio > 0.22 ? '#ffb703' : '#ef476f');
      ctx.fillRect(bx, by + 4.5, bw * hpRatio, 4.5);

      if (p.shield > 0) {
        const shRatio = Math.min(1, p.shield / 60);
        ctx.fillStyle = '#bae6fd';
        ctx.fillRect(bx, by - 3, bw * shRatio, 2);
      }

      if (p.emote && p.emoteTimer > 0) {
        ctx.font = '24px system-ui, sans-serif';
        ctx.fillText(p.emote, x, y - 62);
      }
      ctx.restore();
    }

    // 2. Kraken HP Bar
    if (state.kraken) {
      const k = state.kraken;
      const scr = this._worldToScreen(k.x, 62, k.y);
      if (scr.inFront) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = '900 12px system-ui, sans-serif';
        ctx.fillStyle = '#f0abfc';
        ctx.fillText(`🐙 KRAKEN (${Math.ceil(k.hp)}/${k.maxHp})`, scr.x, scr.y - 12);
        const bw = 90;
        ctx.fillStyle = 'rgba(2, 10, 22, 0.85)';
        ctx.fillRect(scr.x - bw / 2, scr.y - 7, bw, 7);
        ctx.fillStyle = '#d946ef';
        ctx.fillRect(scr.x - bw / 2, scr.y - 7, bw * Math.max(0, k.hp / k.maxHp), 7);
        ctx.restore();
      }
    }

    // 3. Rescue Buoy Progress labels
    for (const rb of state.rescueBuoys || []) {
      const scr = this._worldToScreen(rb.x, 22, rb.y);
      if (!scr.inFront) continue;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '800 11px system-ui, sans-serif';
      ctx.fillStyle = '#80ffdb';
      const pct = Math.round(((rb.progress || 0) / (rb.duration || 3)) * 100);
      ctx.fillText(`🛟 ${rb.name} (${pct}%)`, scr.x, scr.y - 8);
      ctx.restore();
    }

    // 4. Floating damage / event texts
    for (const ft of state.floatTexts || []) {
      const scr = this._worldToScreen(ft.x, 38 + (1 - ft.life / ft.maxLife) * 24, ft.y);
      if (!scr.inFront) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, ft.life / ft.maxLife));
      ctx.textAlign = 'center';
      ctx.font = '900 14px system-ui, sans-serif';
      ctx.strokeStyle = 'rgba(2, 10, 20, 0.85)';
      ctx.lineWidth = 3;
      ctx.strokeText(ft.text, scr.x, scr.y);
      ctx.fillStyle = ft.color || '#ffffff';
      ctx.fillText(ft.text, scr.x, scr.y);
      ctx.restore();
    }

    // 5. Screen-edge Flashbang, Underwater & Storm Overlays
    if (me && me.alive) {
      if (me.blindTimer > 0) {
        ctx.fillStyle = `rgba(240, 250, 255, ${Math.min(0.92, me.blindTimer * 0.75)})`;
        ctx.fillRect(0, 0, this.viewW, this.viewH);
      }
      if (me.submerged) {
        ctx.fillStyle = 'rgba(3, 38, 66, 0.34)';
        ctx.fillRect(0, 0, this.viewW, this.viewH);
        const isNarrow = this.viewW < 640;
        ctx.textAlign = 'center';
        ctx.font = isNarrow ? '900 12px system-ui, sans-serif' : '900 15px system-ui, sans-serif';
        ctx.fillStyle = me.diveTime >= 1.0 ? '#ffd166' : '#7dd3fc';
        ctx.fillText(
          me.diveTime >= 1.0
            ? (isNarrow ? '🦈 SÜRPRİZ ÇIKIŞ HAZIR! Dalış butonuna bas!' : '🦈 SÜRPRİZ ÇIKIŞ HAZIR! Düşmanın dibinde [SHIFT / E] bas!')
            : (isNarrow ? '🤿 SU ALTINDASIN — Gizleniyorsun' : '🤿 SU ALTINDASIN — Gizleniyorsun (Çıkış: SHIFT / E)'),
          this.viewW / 2,
          isNarrow ? 82 : 112
        );
      }
      if (me.inStorm) {
        const isNarrow = this.viewW < 640;
        ctx.fillStyle = '#ff8fa3';
        ctx.font = isNarrow ? '900 12.5px system-ui, sans-serif' : '900 16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🌪️ FIRTINA DIŞINDASIN! ÇEMBERE GİR!', this.viewW / 2, isNarrow ? 100 : 118);
      }
    }

    // 6. Minimap
    this._drawMinimap(ctx, state, map, me);

    // 7. Mobile Virtual Joystick
    if (touchJoy) {
      ctx.save();
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.42)';
      ctx.fillStyle = 'rgba(4, 18, 34, 0.34)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(touchJoy.bx, touchJoy.by, 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.72)';
      ctx.strokeStyle = 'rgba(224, 242, 254, 0.9)';
      ctx.beginPath();
      ctx.arc(touchJoy.cx, touchJoy.cy, 19, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawMinimap(ctx, state, map, me) {
    const isNarrow = this.viewW < 640;
    const mw = isNarrow ? 104 : 176;
    const mh = Math.round(mw * (WORLD_H / WORLD_W));
    const mx = this.viewW - mw - (isNarrow ? 8 : 16);
    const my = isNarrow ? 56 : 72;
    const sx = mw / WORLD_W;
    const sy = mh / WORLD_H;

    ctx.save();
    ctx.translate(mx, my);
    ctx.fillStyle = 'rgba(4, 18, 32, 0.82)';
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(0, 0, mw, mh, 10);
    ctx.fill();
    ctx.stroke();

    if (map.beach) {
      ctx.fillStyle = 'rgba(226, 190, 121, 0.72)';
      ctx.fillRect(0, 0, mw, map.beach.sandY * sy);
    }
    ctx.fillStyle = '#475569';
    for (const obs of map.rocks || []) {
      if (obs.type === 'rock') {
        ctx.beginPath();
        ctx.arc(obs.x * sx, obs.y * sy, Math.max(3, obs.r * sx), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(obs.x * sx, obs.y * sy, obs.w * sx, obs.h * sy);
      }
    }
    for (const pu of state.powerups || []) {
      ctx.fillStyle = POWERUP_MAP[pu.kind]?.color || '#ffd166';
      ctx.beginPath();
      ctx.arc(pu.x * sx, pu.y * sy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (state.kraken) {
      ctx.fillStyle = '#d946ef';
      ctx.beginPath();
      ctx.arc(state.kraken.x * sx, state.kraken.y * sy, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (state.crown) {
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(state.crown.x * sx, state.crown.y * sy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (state.storm && state.storm.active) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(0, 0, mw, mh, 10);
      ctx.clip();
      ctx.strokeStyle = '#ff4d6d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(state.storm.cx * sx, state.storm.cy * sy, Math.max(4, state.storm.r * sx), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const p of state.players || []) {
      if (!p.alive || !this._canViewerSee(me, p, map, state.roundEvent)) continue;
      ctx.fillStyle = p.hasCrown ? '#ffd166' : (p.id === me?.id ? '#ffffff' : p.role === 'hunter' ? '#ffb703' : p.role === 'ffa' ? '#ff6b6b' : '#06d6a0');
      ctx.beginPath();
      ctx.arc(p.x * sx, p.y * sy, p.id === me?.id ? 4.5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  dispose() {
    this._clearGroup(this.mapGroup);
    this._clearGroup(this.dynamicGroup);
    this._clearGroup(this.fxGroup);
    this.oceanTex?.dispose?.();
    this.renderer.dispose();
  }
}
