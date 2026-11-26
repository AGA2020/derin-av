// İKİ İTEMLİ OYUN — Stylized Wind Waker / Brawl Stars 3D Renderer v5.2
// Real GLSL Ocean Shader (Voronoi caustics + yakamoz + GPU waves), sculpted curved 3D hulls/creatures,
// toon outlines, tropical turquoise island shallows, map lighting palettes, muzzle smoke & 3D sinking animation!

import * as THREE from '../vendor/three.module.min.js';
import { WORLD_W, WORLD_H, CHAR_MAP, ALL_ITEMS, POWERUP_MAP, BOAT_SKIN_MAP, SEA_MAPS } from './data.js?v=5.2';
import { hasLineOfSight } from './sim.js?v=5.2';

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

// ============================================================
// 🌊 WIND WAKER STYLE GLSL OCEAN SHADER (100% GPU!)
// ============================================================
const OCEAN_VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying float vWaveH;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float w1 = sin(wp.x * 0.017 + uTime * 1.9 + wp.z * 0.008) * 2.4;
    float w2 = cos(wp.z * 0.022 - uTime * 1.45 + wp.x * 0.006) * 1.9;
    float w3 = sin((wp.x - wp.z) * 0.032 + uTime * 2.5) * 0.85;
    float h = w1 + w2 + w3;
    wp.y += h;
    vWaveH = h;
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const OCEAN_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeepColor;
  uniform vec3 uMidColor;
  uniform vec3 uFoamColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform vec2 uWorldCenter;

  varying vec3 vWorldPos;
  varying float vWaveH;

  // Fast stylized cellular caustic pattern (Wind Waker organic water web!)
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  float voronoiEdge(vec2 x, float t) {
    vec2 n = floor(x);
    vec2 f = fract(x);
    float md = 8.0;
    float md2 = 8.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = hash2(n + g);
        o = 0.5 + 0.42 * sin(t + 6.2831 * o);
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < md) {
          md2 = md;
          md = d;
        } else if (d < md2) {
          md2 = d;
        }
      }
    }
    return sqrt(md2) - sqrt(md);
  }

  void main() {
    // Radial ocean depth gradient
    vec2 rel = (vWorldPos.xz - uWorldCenter) / vec2(960.0, 680.0);
    float edgeFactor = clamp(length(rel), 0.0, 1.0);
    vec3 col = mix(uMidColor, uDeepColor, edgeFactor * 0.82);

    // Stylized 2-step wave crest brightening
    float crest = smoothstep(0.6, 3.6, vWaveH);
    col = mix(col, uMidColor * 1.24 + vec3(0.03, 0.09, 0.12), crest * 0.55);

    // Organic dual-layer Wind Waker water caustic web (zero repeating dots!)
    vec2 uv1 = vWorldPos.xz * 0.011 + vec2(uTime * 0.14, uTime * 0.08);
    vec2 uv2 = vWorldPos.xz * 0.018 - vec2(uTime * 0.11, -uTime * 0.09);
    float e1 = voronoiEdge(uv1, uTime * 0.75);
    float e2 = voronoiEdge(uv2, uTime * 0.65);

    float web1 = 1.0 - smoothstep(0.02, 0.11, e1);
    float web2 = 1.0 - smoothstep(0.015, 0.09, e2);
    float foam = clamp(web1 * 0.55 + web2 * 0.32, 0.0, 1.0);
    col = mix(col, uFoamColor, foam * 0.24);

    // Dynamic sparkling sunlit wave glints (yakamoz!)
    float sparkle = smoothstep(2.6, 4.3, vWaveH) * smoothstep(0.08, 0.0, e2);
    col += vec3(0.95, 0.98, 1.0) * sparkle * 0.38;

    // Exponential distance fog matching scene horizon
    float distCam = length(cameraPosition - vWorldPos);
    float fogAmt = 1.0 - exp(-pow(distCam * uFogDensity, 2.0));
    col = mix(col, uFogColor, clamp(fogAmt, 0.0, 0.88));

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ============================================================
// 🎨 SCULPTED GEOMETRY & TOON OUTLINE HELPERS
// ============================================================
function createBoatHullGeometry(length = 42, width = 22, depth = 11) {
  const hw = width * 0.5;
  const hl = length * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(hl, 0); // Pointed bow (+X)
  shape.quadraticCurveTo(hl * 0.52, hw * 0.95, 0, hw);
  shape.quadraticCurveTo(-hl * 0.65, hw * 0.92, -hl, hw * 0.64);
  shape.lineTo(-hl, -hw * 0.64);
  shape.quadraticCurveTo(-hl * 0.65, -hw * 0.92, 0, -hw);
  shape.quadraticCurveTo(hl * 0.52, -hw * 0.95, hl, 0);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 2.0,
    bevelSize: 1.4,
    bevelSegments: 2,
    curveSegments: 10
  });
  // Extrude is in XY extruded along +Z; rotate so XY lies in XZ plane and thickness goes along +Y
  geo.rotateX(Math.PI / 2);
  geo.translate(0, depth, 0);
  return geo;
}

function createCurvedSailGeometry(width = 25, height = 20) {
  // Billowing curved square sail using partial cylinder shell
  const geo = new THREE.CylinderGeometry(width * 0.58, width * 0.58, height, 10, 1, true, -0.78, 1.56);
  geo.rotateY(Math.PI / 2);
  return geo;
}

function createSharkBodyGeometry() {
  // Sculpted torpedo shark profile via LatheGeometry (axis Y -> rotated to +X)
  const pts = [
    new THREE.Vector2(0.01, -20),
    new THREE.Vector2(3.0, -14),
    new THREE.Vector2(6.5, -6),
    new THREE.Vector2(10.2, 3),
    new THREE.Vector2(10.8, 10),
    new THREE.Vector2(8.0, 17),
    new THREE.Vector2(3.5, 22),
    new THREE.Vector2(0.01, 25)
  ];
  const geo = new THREE.LatheGeometry(pts, 10);
  geo.rotateZ(-Math.PI / 2);
  geo.scale(1.0, 0.78, 0.92);
  return geo;
}

function createCurvedTentacleGeometry(length = 26, baseR = 3.6) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-length * 0.38, -2.5, 2.5),
    new THREE.Vector3(-length * 0.74, 2.2, -1.8),
    new THREE.Vector3(-length, -1.0, 1.2)
  ]);
  return new THREE.TubeGeometry(curve, 8, baseR * 0.65, 6, false);
}

const SHARED_OUTLINE_MAT = new THREE.MeshBasicMaterial({
  color: '#040d18',
  side: THREE.BackSide
});

function addToonOutline(mesh, scale = 1.075) {
  const out = new THREE.Mesh(mesh.geometry, SHARED_OUTLINE_MAT);
  out.scale.setScalar(scale);
  mesh.add(out);
  return out;
}

// Map-specific lighting & mood palettes
const MAP_PALETTES = {
  firtina_bogazi: {
    sunCol: '#dbeafe', sunInt: 1.55, hemiSky: '#93c5fd', hemiGround: '#0a2540',
    deep: '#071b30', mid: '#0d3b66', foam: '#bae6fd', bg: '#051526', shallow: '#22d3ee'
  },
  korsan_enkazi: {
    sunCol: '#fde68a', sunInt: 1.85, hemiSky: '#fef3c7', hemiGround: '#0c3547',
    deep: '#072133', mid: '#0e4c6b', foam: '#e0f2fe', bg: '#061a29', shallow: '#38bdf8'
  },
  akinti_koyu: {
    sunCol: '#fff8db', sunInt: 1.9, hemiSky: '#bae6fd', hemiGround: '#0b455e',
    deep: '#06263d', mid: '#0b607c', foam: '#e0f7ff', bg: '#051d30', shallow: '#2dd4bf'
  },
  mercan_plaji: {
    sunCol: '#fffbeb', sunInt: 2.05, hemiSky: '#e0f7ff', hemiGround: '#0d6e7a',
    deep: '#073b56', mid: '#0f8699', foam: '#ffffff', bg: '#072e44', shallow: '#5eead4'
  },
  volkanik_resif: {
    sunCol: '#fdba74', sunInt: 1.85, hemiSky: '#fed7aa', hemiGround: '#3b1414',
    deep: '#1e0d12', mid: '#451a1d', foam: '#fdba74', bg: '#16090d', shallow: '#f97316'
  },
  hayalet_sis: {
    sunCol: '#cbd5e1', sunInt: 1.45, hemiSky: '#99f6e4', hemiGround: '#062424',
    deep: '#041819', mid: '#0b3d3c', foam: '#99f6e4', bg: '#031213', shallow: '#2dd4bf'
  }
};

export class SeaRenderer3D {
  constructor(webglCanvas, overlayCanvas) {
    this.canvas = webglCanvas;
    this.overlayCanvas = overlayCanvas;
    this.octx = overlayCanvas.getContext('2d');

    this.camX = WORLD_W / 2;
    this.camY = WORLD_H / 2;
    this.camMode = localStorage.getItem('derinav_cam3d') === 'sinematik' ? 'sinematik' : 'taktik';
    this._curCamH = this.camMode === 'sinematik' ? 310 : 475;
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
    this.prevAlive = new Map();
    this.seenPulses = new Set();
    this.seenSinks = new Set();
    this.sinkingRigs = []; // 3D Dramatic sinking vessels!

    // Three.js WebGLRenderer
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
    this.scene.background = new THREE.Color('#051829');
    this.scene.fog = new THREE.FogExp2('#062038', 0.00035);

    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 15, 4200);
    this._raycaster = new THREE.Raycaster();
    this._waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._tmpVec = new THREE.Vector3();
    this._tmpNdc = new THREE.Vector2();

    // Lighting — tuned dynamically per map!
    this.hemiLight = new THREE.HemisphereLight('#e0f2fe', '#0e4f6e', 1.55);
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

    this.rimLight = new THREE.DirectionalLight('#38bdf8', 0.55);
    this.rimLight.position.set(-420, 340, -400);
    this.scene.add(this.rimLight);

    // Groups
    this.mapGroup = new THREE.Group();
    this.dynamicGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();
    this.scene.add(this.mapGroup);
    this.scene.add(this.dynamicGroup);
    this.scene.add(this.fxGroup);

    // Ocean Shader Material
    this.oceanUniforms = {
      uTime: { value: 0 },
      uDeepColor: { value: new THREE.Color('#072133') },
      uMidColor: { value: new THREE.Color('#0e5a7d') },
      uFoamColor: { value: new THREE.Color('#e0f7ff') },
      uFogColor: { value: new THREE.Color('#061a29') },
      uFogDensity: { value: 0.00035 },
      uWorldCenter: { value: new THREE.Vector2(WORLD_W / 2, WORLD_H / 2) }
    };
    this.oceanMat = new THREE.ShaderMaterial({
      vertexShader: OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
      uniforms: this.oceanUniforms
    });

    this.oceanMesh = null;
    this.beachSurfMesh = null;
    this.currentStrips = [];
    this.fogMeshes = [];
    this.ambientSprites = [];
    this.lighthouseRig = null;

    // Entity pools
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

    // Shared geometries (never disposed per entity)
    this.particles = [];
    this._sharedGeo = {
      sphere: new THREE.SphereGeometry(1, 8, 6),
      ring: new THREE.RingGeometry(0.78, 1, 28),
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
      cone: new THREE.ConeGeometry(1, 1, 7),
      galleonHull: createBoatHullGeometry(44, 23, 11),
      ghostHull: createBoatHullGeometry(44, 21, 10),
      pontoonHull: createBoatHullGeometry(42, 7.5, 7),
      jetskiHull: createBoatHullGeometry(38, 15, 6),
      curvedSail: createCurvedSailGeometry(25, 20),
      sharkBody: createSharkBodyGeometry(),
      tentacle: createCurvedTentacleGeometry(25, 3.6)
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
    const aimGeo = new THREE.PlaneGeometry(1, 3.2);
    aimGeo.rotateX(-Math.PI / 2);
    aimGeo.translate(0.5, 0, 0);
    this.aimGuideMesh = new THREE.Mesh(
      aimGeo,
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.45, depthWrite: false })
    );
    this.aimGuideMesh.position.y = 2.2;
    this.aimGuideMesh.visible = false;
    this.fxGroup.add(this.aimGuideMesh);

    const diveRingGeo = new THREE.RingGeometry(67, 71, 36);
    diveRingGeo.rotateX(-Math.PI / 2);
    this.diveRingMesh = new THREE.Mesh(
      diveRingGeo,
      new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
    );
    this.diveRingMesh.position.y = 2.4;
    this.diveRingMesh.visible = false;
    this.fxGroup.add(this.diveRingMesh);

    const stormGeo = new THREE.CylinderGeometry(1, 1, 130, 56, 1, true);
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
    this.stormRing.position.y = 62;
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
    if (hit) return { x: hit.x, y: hit.z };
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
  // 🏝️ MAP BUILDER (GLSL Ocean, Layered Islands, Turquoise Shallows, Props)
  // ============================================================
  _clearGroup(group) {
    const sharedSet = new Set(Object.values(this._sharedGeo));
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      child.traverse?.((obj) => {
        if (obj.geometry && !sharedSet.has(obj.geometry)) obj.geometry.dispose?.();
        if (obj.material && obj.material !== this.oceanMat && obj.material !== SHARED_OUTLINE_MAT) {
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

    const pal = MAP_PALETTES[map.id] || MAP_PALETTES.korsan_enkazi;
    this.sunLight.color.set(pal.sunCol);
    this.sunLight.intensity = pal.sunInt;
    this.hemiLight.color.set(pal.hemiSky);
    this.hemiLight.groundColor.set(pal.hemiGround);
    this.scene.background.set(pal.bg);
    this.scene.fog.color.set(pal.bg);

    this.oceanUniforms.uDeepColor.value.set(pal.deep);
    this.oceanUniforms.uMidColor.value.set(pal.mid);
    this.oceanUniforms.uFoamColor.value.set(pal.foam);
    this.oceanUniforms.uFogColor.value.set(pal.bg);

    // 1. GPU GLSL Ocean Plane (56x38 vertex wave grid, 100% GPU animated!)
    const oceanGeo = new THREE.PlaneGeometry(WORLD_W + 1000, WORLD_H + 1000, 56, 38);
    oceanGeo.rotateX(-Math.PI / 2);
    this.oceanMesh = new THREE.Mesh(oceanGeo, this.oceanMat);
    this.oceanMesh.position.set(WORLD_W / 2, 0, WORLD_H / 2);
    this.mapGroup.add(this.oceanMesh);

    // Shadow-catching invisible water receiver plane (gives crisp boat/island shadows on GLSL ocean!)
    const shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_W + 200, WORLD_H + 200),
      new THREE.ShadowMaterial({ opacity: 0.28 })
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.set(WORLD_W / 2, 1.4, WORLD_H / 2);
    shadowCatcher.receiveShadow = true;
    this.mapGroup.add(shadowCatcher);

    // Arena golden maritime rope border + corner buoys
    const borderMat = new THREE.MeshBasicMaterial({ color: '#ffb703', transparent: true, opacity: 0.45 });
    const borders = [
      [WORLD_W / 2, 2.0, 8, WORLD_W - 16, 4],
      [WORLD_W / 2, 2.0, WORLD_H - 8, WORLD_W - 16, 4],
      [8, 2.0, WORLD_H / 2, 4, WORLD_H - 16],
      [WORLD_W - 8, 2.0, WORLD_H / 2, 4, WORLD_H - 16]
    ];
    for (const [bx, by, bz, bw, bd] of borders) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, 2, bd), borderMat);
      m.position.set(bx, by, bz);
      this.mapGroup.add(m);
    }

    // 2. Mercan Plajı Beach + Turquoise Lagoon + Animated Surf Line + Palm Trees
    if (map.beach) {
      const b = map.beach;
      const sand = new THREE.Mesh(
        new THREE.BoxGeometry(WORLD_W + 400, 15, b.sandY + 260),
        new THREE.MeshStandardMaterial({ color: '#ecc982', roughness: 0.85, flatShading: true })
      );
      sand.position.set(WORLD_W / 2, 6, (b.sandY - 260) / 2);
      sand.receiveShadow = true;
      this.mapGroup.add(sand);

      // Animated white shoreline surf wave
      const surfGeo = new THREE.PlaneGeometry(WORLD_W + 200, 18);
      surfGeo.rotateX(-Math.PI / 2);
      const surf = new THREE.Mesh(
        surfGeo,
        new THREE.MeshBasicMaterial({ color: '#f0f9ff', transparent: true, opacity: 0.68, depthWrite: false })
      );
      surf.position.set(WORLD_W / 2, 2.1, b.sandY + 8);
      this.mapGroup.add(surf);
      this.beachSurfMesh = { mesh: surf, baseZ: b.sandY + 8 };

      // Crystal turquoise lagoon shelf
      const lagGeo = new THREE.PlaneGeometry(WORLD_W, b.shallowY - b.sandY);
      lagGeo.rotateX(-Math.PI / 2);
      const lag = new THREE.Mesh(
        lagGeo,
        new THREE.MeshBasicMaterial({ color: '#5eead4', transparent: true, opacity: 0.38, depthWrite: false })
      );
      lag.position.set(WORLD_W / 2, 1.6, (b.sandY + b.shallowY) / 2);
      this.mapGroup.add(lag);

      for (const palm of b.palms || []) {
        this._addPalmTree(this.mapGroup, palm.x, 12, palm.y, 1.0);
      }
    }

    // 3. Sculpted Layered Islands, Rocks, Sunken Ships & Wooden Piers
    const rockMat = new THREE.MeshStandardMaterial({
      color: map.id === 'volkanik_resif' ? '#3b262c' : '#576574',
      roughness: 0.85,
      flatShading: true
    });
    const rockTopMat = new THREE.MeshStandardMaterial({
      color: map.id === 'volkanik_resif' ? '#9a3412' : '#788999',
      emissive: map.id === 'volkanik_resif' ? '#f97316' : '#000000',
      emissiveIntensity: map.id === 'volkanik_resif' ? 0.6 : 0,
      roughness: 0.8,
      flatShading: true
    });
    const grassMat = new THREE.MeshStandardMaterial({ color: '#22c55e', roughness: 0.8, flatShading: true });
    const bushMat = new THREE.MeshStandardMaterial({ color: '#15803d', roughness: 0.78, flatShading: true });
    const shallowMat = new THREE.MeshBasicMaterial({ color: pal.shallow, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
    const foamMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.52, side: THREE.DoubleSide, depthWrite: false });
    const woodMat = new THREE.MeshStandardMaterial({ color: '#7c4a21', roughness: 0.82, flatShading: true });
    const woodDarkMat = new THREE.MeshStandardMaterial({ color: '#4a2c14', roughness: 0.88, flatShading: true });

    let rockIdx = 0;
    for (const obs of map.rocks || []) {
      if (obs.type === 'rock') {
        rockIdx++;
        const rg = new THREE.Group();
        rg.position.set(obs.x, 0, obs.y);

        // Turquoise shallow water lagoon disc around island!
        const shallowDisc = new THREE.Mesh(new THREE.CircleGeometry(obs.r * 1.42, 24), shallowMat);
        shallowDisc.rotation.x = -Math.PI / 2;
        shallowDisc.position.y = 1.5;
        rg.add(shallowDisc);

        // Pulsing white foam collar
        const foam = new THREE.Mesh(
          new THREE.RingGeometry(obs.r * 0.96, obs.r * 1.15, 24),
          map.id === 'volkanik_resif'
            ? new THREE.MeshBasicMaterial({ color: '#ff6b35', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
            : foamMat
        );
        foam.rotation.x = -Math.PI / 2;
        foam.position.y = 1.9;
        rg.add(foam);

        // Main jagged rock spire + toon outline!
        const mainRock = new THREE.Mesh(new THREE.DodecahedronGeometry(obs.r * 0.94, 0), rockMat);
        mainRock.scale.set(1.0, 0.74, 1.0);
        mainRock.position.y = obs.r * 0.34;
        mainRock.rotation.set(0.2, (obs.x * 0.013) % 6, 0.15);
        mainRock.castShadow = true;
        mainRock.receiveShadow = true;
        addToonOutline(mainRock, 1.055);
        rg.add(mainRock);

        // Secondary shoulder rock
        const peak = new THREE.Mesh(new THREE.DodecahedronGeometry(obs.r * 0.56, 0), rockTopMat);
        peak.position.set(obs.r * 0.24, obs.r * 0.62, -obs.r * 0.16);
        peak.castShadow = true;
        addToonOutline(peak, 1.06);
        rg.add(peak);

        // Island environmental props (lush grass, mini palms, bushes, or glowing magma cracks!)
        if (map.id === 'volkanik_resif') {
          const lavaCore = new THREE.Mesh(
            new THREE.DodecahedronGeometry(obs.r * 0.3, 0),
            new THREE.MeshBasicMaterial({ color: '#ff5500' })
          );
          lavaCore.position.set(-obs.r * 0.15, obs.r * 0.72, obs.r * 0.12);
          rg.add(lavaCore);
        } else if (obs.r >= 40) {
          const grass = new THREE.Mesh(new THREE.DodecahedronGeometry(obs.r * 0.44, 0), grassMat);
          grass.scale.set(1.2, 0.38, 1.15);
          grass.position.set(-obs.r * 0.12, obs.r * 0.7, obs.r * 0.1);
          rg.add(grass);

          // Tiny tropical palm or coastal bush on bigger islands
          if (rockIdx % 2 === 0 && map.id !== 'hayalet_sis') {
            this._addPalmTree(rg, -obs.r * 0.1, obs.r * 0.72, obs.r * 0.08, 0.62);
          } else {
            const bush = new THREE.Mesh(new THREE.DodecahedronGeometry(obs.r * 0.22, 0), bushMat);
            bush.position.set(obs.r * 0.18, obs.r * 0.86, obs.r * 0.14);
            rg.add(bush);
          }
        }
        this.mapGroup.add(rg);
      } else if (obs.type === 'pier') {
        const pg = new THREE.Group();
        const deck = new THREE.Mesh(new THREE.BoxGeometry(obs.w, 6, obs.h), woodMat);
        deck.position.set(obs.x + obs.w / 2, 11, obs.y + obs.h / 2);
        deck.castShadow = true;
        deck.receiveShadow = true;
        addToonOutline(deck, 1.03);
        pg.add(deck);
        for (const px of [obs.x + 8, obs.x + obs.w - 8]) {
          for (const py of [obs.y + 12, obs.y + obs.h / 2, obs.y + obs.h - 12]) {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 20, 6), woodDarkMat);
            post.position.set(px, 6, py);
            post.castShadow = true;
            pg.add(post);
          }
        }
        this.mapGroup.add(pg);
      } else {
        // Sculpted Sunken Pirate Shipwreck!
        const sg = new THREE.Group();
        sg.position.set(obs.x + obs.w / 2, 0, obs.y + obs.h / 2);

        const wreckShallow = new THREE.Mesh(
          new THREE.PlaneGeometry(obs.w * 1.25, obs.h * 1.4),
          shallowMat
        );
        wreckShallow.rotation.x = -Math.PI / 2;
        wreckShallow.position.y = 1.5;
        sg.add(wreckShallow);

        const shipGeo = createBoatHullGeometry(obs.w * 0.98, obs.h * 0.92, 22);
        const hull = new THREE.Mesh(shipGeo, woodMat);
        hull.position.y = -2;
        hull.rotation.z = 0.08;
        hull.castShadow = true;
        hull.receiveShadow = true;
        addToonOutline(hull, 1.035);
        sg.add(hull);

        const cabin = new THREE.Mesh(new THREE.BoxGeometry(obs.w * 0.28, 16, obs.h * 0.65), woodDarkMat);
        cabin.position.set(-obs.w * 0.26, 22, 0);
        cabin.castShadow = true;
        addToonOutline(cabin, 1.04);
        sg.add(cabin);

        const mast = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 5.2, 66, 7), woodDarkMat);
        mast.position.set(obs.w * 0.02, 46, 0);
        mast.rotation.z = 0.16;
        mast.castShadow = true;
        sg.add(mast);

        const sail = new THREE.Mesh(
          createCurvedSailGeometry(Math.min(54, obs.h * 0.8), 32),
          new THREE.MeshStandardMaterial({
            color: obs.label === 'HAYALET' ? '#67e8f9' : '#f1f5f9',
            emissive: obs.label === 'HAYALET' ? '#2dd4bf' : '#000000',
            emissiveIntensity: obs.label === 'HAYALET' ? 0.35 : 0,
            transparent: obs.label === 'HAYALET',
            opacity: obs.label === 'HAYALET' ? 0.65 : 0.95,
            side: THREE.DoubleSide,
            roughness: 0.72
          })
        );
        sail.position.set(obs.w * 0.08, 52, 0);
        sail.castShadow = true;
        sg.add(sail);

        // Warm shipwreck lantern glow
        const lantern = new THREE.Mesh(
          new THREE.OctahedronGeometry(4.5, 0),
          new THREE.MeshBasicMaterial({ color: obs.label === 'HAYALET' ? '#5eead4' : '#fde047' })
        );
        lantern.position.set(-obs.w * 0.4, 34, 0);
        sg.add(lantern);

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
      base.position.set(cur.x + cur.w / 2, 1.8, cur.y + cur.h / 2);
      cg.add(base);

      const horizontal = Math.abs(cur.dirX) >= Math.abs(cur.dirY);
      const count = Math.max(3, Math.floor((horizontal ? cur.w : cur.h) / 68));
      const stripMat = new THREE.MeshBasicMaterial({ color: '#a5f3fc', transparent: true, opacity: 0.65, depthWrite: false });
      for (let i = 0; i < count; i++) {
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(horizontal ? 14 : cur.w * 0.55, 1.5, horizontal ? cur.h * 0.55 : 14),
          stripMat
        );
        bar.position.set(cur.x + cur.w / 2, 2.2, cur.y + cur.h / 2);
        cg.add(bar);
        this.currentStrips.push({ mesh: bar, cur, idx: i, count, horizontal });
      }
      this.mapGroup.add(cg);
    }

    // 5. Sea Fogs (fluffy layered low-poly clouds)
    const fogCloudMat = new THREE.MeshStandardMaterial({
      color: map.id === 'hayalet_sis' ? '#ccfbf1' : '#e2f1ff',
      emissive: map.id === 'hayalet_sis' ? '#14b8a6' : '#38bdf8',
      emissiveIntensity: 0.14,
      transparent: true,
      opacity: 0.25,
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
      ring.position.y = 1.8;
      fGroup.add(ring);

      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        const distOff = k === 0 ? 0 : fg.r * 0.42;
        const rad = k === 0 ? fg.r * 0.62 : fg.r * 0.48;
        const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(rad, 1), fogCloudMat);
        puff.scale.set(1, 0.25, 1);
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
        new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.65, flatShading: true })
      );
      tower.position.y = 39;
      tower.castShadow = true;
      addToonOutline(tower, 1.05);
      lg.add(tower);

      const stripe = new THREE.Mesh(
        new THREE.CylinderGeometry(12.8, 14.5, 22, 10),
        new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.65, flatShading: true })
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
        new THREE.ConeGeometry(14, 17, 10),
        new THREE.MeshStandardMaterial({ color: '#b91c1c', roughness: 0.6, flatShading: true })
      );
      roof.position.y = 99;
      addToonOutline(roof, 1.06);
      lg.add(roof);

      const beamGroup = new THREE.Group();
      beamGroup.position.y = 4.5;
      const beamGeo = new THREE.CircleGeometry(lh.range, 20, -lh.halfAngle, lh.halfAngle * 2);
      beamGeo.rotateX(-Math.PI / 2);
      const beam = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({
          color: '#fde047',
          transparent: true,
          opacity: 0.2,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      );
      beamGroup.add(beam);
      lg.add(beamGroup);

      this.mapGroup.add(lg);
      this.lighthouseRig = { group: lg, beamGroup };
    }

    // 7. Ambient 3D Life (Seagulls, Volcanic Embers, Ghost Wisps)
    if (map.id === 'volkanik_resif') {
      const emberMat = new THREE.MeshBasicMaterial({ color: '#fb923c' });
      for (let i = 0; i < 18; i++) {
        const m = new THREE.Mesh(this._sharedGeo.sphere, emberMat);
        m.scale.setScalar(2.4 + (i % 3));
        const bx = 220 + ((i * 197) % (WORLD_W - 440));
        const bz = 140 + ((i * 131) % (WORLD_H - 280));
        m.position.set(bx, 10 + (i * 19) % 120, bz);
        this.mapGroup.add(m);
        this.ambientSprites.push({ kind: 'ember', mesh: m, bx, bz, phase: i * 0.7 });
      }
    } else if (map.id === 'hayalet_sis') {
      const wispMat = new THREE.MeshBasicMaterial({ color: '#5eead4', transparent: true, opacity: 0.8 });
      for (let i = 0; i < 14; i++) {
        const m = new THREE.Mesh(this._sharedGeo.sphere, wispMat);
        m.scale.setScalar(3.6);
        const bx = 200 + ((i * 211) % (WORLD_W - 400));
        const bz = 150 + ((i * 157) % (WORLD_H - 300));
        m.position.set(bx, 30, bz);
        this.mapGroup.add(m);
        this.ambientSprites.push({ kind: 'wisp', mesh: m, bx, bz, phase: i * 1.1 });
      }
    } else {
      const gullMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
      const gullCount = map.id === 'mercan_plaji' ? 5 : 3;
      for (let i = 0; i < gullCount; i++) {
        const gg = new THREE.Group();
        const wingL = new THREE.Mesh(new THREE.BoxGeometry(15, 1.5, 4.5), gullMat);
        wingL.position.x = -7.5;
        const wingR = new THREE.Mesh(new THREE.BoxGeometry(15, 1.5, 4.5), gullMat);
        wingR.position.x = 7.5;
        gg.add(wingL, wingR);
        gg.position.set(WORLD_W / 2, 138 + i * 18, WORLD_H / 2);
        this.mapGroup.add(gg);
        this.ambientSprites.push({
          kind: 'gull',
          mesh: gg,
          wingL,
          wingR,
          cx: 420 + i * 210,
          cz: 260 + (i % 2) * 340,
          rad: 185 + i * 45,
          spd: 0.35 + i * 0.08,
          phase: i * 2.1
        });
      }
    }
  }

  _addPalmTree(parent, x, y, z, scale = 1.0) {
    const pg = new THREE.Group();
    pg.position.set(x, y, z);
    pg.scale.setScalar(scale);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(3.0, 5.4, 42, 6),
      new THREE.MeshStandardMaterial({ color: '#925425', roughness: 0.88, flatShading: true })
    );
    trunk.position.y = 20;
    trunk.rotation.z = 0.15;
    trunk.castShadow = true;
    pg.add(trunk);

    const leafMat = new THREE.MeshStandardMaterial({ color: '#22c55e', roughness: 0.68, flatShading: true });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(7.2, 27, 4), leafMat);
      leaf.position.set(Math.cos(a) * 11 - 3, 41, Math.sin(a) * 11);
      leaf.rotation.z = -Math.PI * 0.42;
      leaf.rotation.y = -a;
      leaf.castShadow = true;
      pg.add(leaf);
    }
    parent.add(pg);
  }

  // ============================================================
  // 🚢 6 SCULPTED CURVED LOW-POLY 3D CHARACTERS + TOON OUTLINES!
  // ============================================================
  _createCharRig(charId, hullHex, roleHex) {
    const root = new THREE.Group();

    // Competitive water-surface hitbox ring (exact 22px radius!)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(20.5, 24, 28),
      new THREE.MeshBasicMaterial({ color: roleHex, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 2.0;
    root.add(ring);

    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(27, 14, 10),
      new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.26, depthWrite: false })
    );
    shield.position.y = 14;
    shield.visible = false;
    root.add(shield);

    const aura = new THREE.Mesh(
      new THREE.RingGeometry(27, 33, 28),
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false })
    );
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 2.2;
    aura.visible = false;
    root.add(aura);

    const body = new THREE.Group();
    root.add(body);

    const mainMat = new THREE.MeshStandardMaterial({
      color: hullHex,
      roughness: 0.4,
      metalness: 0.14,
      flatShading: true
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.72, flatShading: true });
    const woodMat = new THREE.MeshStandardMaterial({ color: '#854d0e', roughness: 0.76, flatShading: true });
    const deckMat = new THREE.MeshStandardMaterial({ color: '#a16207', roughness: 0.8, flatShading: true });
    const accentMat = new THREE.MeshStandardMaterial({ color: '#fef3c7', roughness: 0.48, flatShading: true });
    const steelMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.55, roughness: 0.3, flatShading: true });

    let animParts = {};

    switch (charId) {
      case 'kaptan': {
        // ⚓ KAPTAN KARA — Gerçek Kavisli Korsan Kalyonu + Yan Toplar + Şişkin Yelken + Bayrak!
        const hull = new THREE.Mesh(this._sharedGeo.galleonHull, woodMat);
        hull.position.set(2, 0.5, 0);
        hull.castShadow = true;
        addToonOutline(hull, 1.055);
        body.add(hull);

        // Raised stern quarterdeck cabin with glowing warm captain's window
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(13, 10, 17), mainMat);
        cabin.position.set(-12, 14, 0);
        cabin.castShadow = true;
        addToonOutline(cabin, 1.06);
        body.add(cabin);

        const win = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 11), new THREE.MeshBasicMaterial({ color: '#fde047' }));
        win.position.set(-18.6, 15, 0);
        body.add(win);

        // Pointed bowsprit & iron ramming prow
        const bowsprit = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 2.2, 16, 6), steelMat);
        bowsprit.rotation.z = -Math.PI * 0.42;
        bowsprit.position.set(26, 12, 0);
        body.add(bowsprit);

        // 4 protruding side cannons!
        for (const s of [-1, 1]) {
          for (const cx of [-2, 8]) {
            const cannon = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.9, 6, 6), darkMat);
            cannon.rotation.x = Math.PI / 2;
            cannon.position.set(cx, 9, s * 12);
            body.add(cannon);
          }
        }

        // Tall mast + crow's nest + curved billowing sail + flapping pirate flag!
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.2, 38, 6), darkMat);
        mast.position.set(3, 25, 0);
        mast.castShadow = true;
        body.add(mast);

        const sail = new THREE.Mesh(
          this._sharedGeo.curvedSail,
          new THREE.MeshStandardMaterial({ color: hullHex, roughness: 0.55, side: THREE.DoubleSide, flatShading: true })
        );
        sail.position.set(-1, 27, 0);
        sail.castShadow = true;
        body.add(sail);
        animParts.sail = sail;

        const flag = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 1.2), new THREE.MeshBasicMaterial({ color: '#111827' }));
        flag.position.set(-2, 42, 0);
        body.add(flag);
        animParts.flag = flag;
        break;
      }

      case 'kopekbaligi': {
        // 🦈 KÖPEKBALIĞI — Organik Torpido Gövde + Beyaz Karın + Çift Göz + Sallanan Hilal Kuyruk!
        const torso = new THREE.Mesh(this._sharedGeo.sharkBody, mainMat);
        torso.position.set(2, 7.5, 0);
        torso.castShadow = true;
        addToonOutline(torso, 1.06);
        body.add(torso);

        // Bright fierce shark eyes
        const eyeMat = new THREE.MeshBasicMaterial({ color: '#fef08a' });
        for (const s of [-1, 1]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(2.0, 6, 6), eyeMat);
          eye.position.set(17, 10, s * 5.8);
          body.add(eye);
        }

        // Swept sickle dorsal fin
        const dorsal = new THREE.Mesh(new THREE.ConeGeometry(4.8, 19, 4), mainMat);
        dorsal.position.set(1, 18.5, 0);
        dorsal.rotation.z = 0.34;
        dorsal.scale.set(1.2, 1, 0.45);
        dorsal.castShadow = true;
        addToonOutline(dorsal, 1.07);
        body.add(dorsal);

        // Swept pectoral fins
        for (const s of [-1, 1]) {
          const fin = new THREE.Mesh(new THREE.ConeGeometry(5.5, 15, 4), mainMat);
          fin.position.set(5, 5.5, s * 13);
          fin.rotation.x = s * Math.PI * 0.45;
          fin.rotation.z = 0.45;
          fin.scale.set(0.7, 1, 0.35);
          body.add(fin);
        }

        // Animated crescent tail fin
        const tailGroup = new THREE.Group();
        tailGroup.position.set(-15, 7.5, 0);
        const tailTop = new THREE.Mesh(new THREE.ConeGeometry(4.5, 16, 4), mainMat);
        tailTop.position.set(-6, 5.5, 0);
        tailTop.rotation.z = 0.7;
        tailTop.scale.set(0.8, 1, 0.35);
        tailTop.castShadow = true;
        tailGroup.add(tailTop);
        const tailBot = new THREE.Mesh(new THREE.ConeGeometry(3.8, 12, 4), mainMat);
        tailBot.position.set(-5, -3.5, 0);
        tailBot.rotation.z = 2.3;
        tailBot.scale.set(0.8, 1, 0.35);
        tailGroup.add(tailBot);
        body.add(tailGroup);
        animParts.tail = tailGroup;
        break;
      }

      case 'hayalet': {
        // 👻 SİS HAYALETİ — Kavisli Hayalet Kalyon + Parlayan Ektplazma Yelken + Fener!
        const ghostMat = new THREE.MeshStandardMaterial({
          color: hullHex,
          emissive: '#38bdf8',
          emissiveIntensity: 0.45,
          transparent: true,
          opacity: 0.82,
          roughness: 0.25,
          flatShading: true
        });
        const hull = new THREE.Mesh(this._sharedGeo.ghostHull, ghostMat);
        hull.position.set(2, 1.5, 0);
        addToonOutline(hull, 1.055);
        body.add(hull);

        const sail = new THREE.Mesh(
          this._sharedGeo.curvedSail,
          new THREE.MeshStandardMaterial({
            color: '#bae6fd',
            emissive: '#a855f7',
            emissiveIntensity: 0.4,
            transparent: true,
            opacity: 0.72,
            side: THREE.DoubleSide
          })
        );
        sail.position.set(-1, 25, 0);
        body.add(sail);

        const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(5.2, 0), new THREE.MeshBasicMaterial({ color: '#c084fc' }));
        lantern.position.set(24, 15, 0);
        body.add(lantern);
        animParts.lantern = lantern;
        animParts.sail = sail;
        break;
      }

      case 'fenerci': {
        // 🔦 FENERCİ — Çift Kavisli Katamaran + Şeritli Deniz Feneri Kulesi + Dönen Işın!
        for (const s of [-1, 1]) {
          const pontoon = new THREE.Mesh(this._sharedGeo.pontoonHull, mainMat);
          pontoon.position.set(1, 0.5, s * 10);
          pontoon.castShadow = true;
          addToonOutline(pontoon, 1.06);
          body.add(pontoon);
        }
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(20, 5.5, 22), deckMat);
        bridge.position.set(-2, 9.5, 0);
        bridge.castShadow = true;
        addToonOutline(bridge, 1.05);
        body.add(bridge);

        const turret = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 7.5, 18, 8), accentMat);
        turret.position.set(0, 20, 0);
        turret.castShadow = true;
        addToonOutline(turret, 1.06);
        body.add(turret);

        const lamp = new THREE.Mesh(new THREE.SphereGeometry(5.8, 8, 6), new THREE.MeshBasicMaterial({ color: '#fde047' }));
        lamp.position.set(0, 31, 0);
        body.add(lamp);
        animParts.lamp = lamp;
        break;
      }

      case 'ahtapot': {
        // 🐙 AHTAPOT — Kubbeli Baş + Parlak Gözler + 6 Kıvrımlı TubeGeometry Dokunaç!
        const dome = new THREE.Mesh(new THREE.SphereGeometry(14.5, 11, 9), mainMat);
        dome.scale.set(1.15, 0.94, 0.98);
        dome.position.set(3, 14, 0);
        dome.castShadow = true;
        addToonOutline(dome, 1.06);
        body.add(dome);

        const eyeMat = new THREE.MeshBasicMaterial({ color: '#fef08a' });
        for (const s of [-1, 1]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(3.4, 7, 7), eyeMat);
          eye.position.set(14.5, 14.5, s * 6.8);
          body.add(eye);
        }

        animParts.tentacles = [];
        for (let k = 0; k < 6; k++) {
          const a = ((k - 2.5) / 5.5) * Math.PI * 1.2;
          const tg = new THREE.Group();
          tg.position.set(-3, 7, 0);
          tg.rotation.y = a;
          const arm = new THREE.Mesh(this._sharedGeo.tentacle, mainMat);
          arm.castShadow = true;
          addToonOutline(arm, 1.07);
          tg.add(arm);
          body.add(tg);
          animParts.tentacles.push({ group: tg, baseA: a, idx: k });
        }
        break;
      }

      default: {
        // 🌊 DALGA BİNİCİSİ — Kavisli Aerodinamik Jet-Ski + Rüzgarlık + İkiz Turkuaz Türbin!
        const board = new THREE.Mesh(this._sharedGeo.jetskiHull, mainMat);
        board.position.set(1, 0.5, 0);
        board.castShadow = true;
        addToonOutline(board, 1.06);
        body.add(board);

        const cowl = new THREE.Mesh(new THREE.ConeGeometry(6.5, 14, 4), accentMat);
        cowl.rotation.z = -Math.PI * 0.42;
        cowl.position.set(7, 10, 0);
        cowl.castShadow = true;
        body.add(cowl);

        const seat = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 8), darkMat);
        seat.position.set(-5, 9.5, 0);
        body.add(seat);

        const thrusterMat = new THREE.MeshBasicMaterial({ color: '#38bdf8' });
        for (const s of [-1, 1]) {
          const jet = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.3, 8, 6), thrusterMat);
          jet.rotation.z = Math.PI / 2;
          jet.position.set(-19, 5.5, s * 4.8);
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
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#9333ea', roughness: 0.42, flatShading: true });
    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(37, 1), bodyMat);
    head.scale.set(1, 0.92, 1);
    head.position.y = 25;
    head.castShadow = true;
    addToonOutline(head, 1.055);
    g.add(head);

    const eyeMat = new THREE.MeshBasicMaterial({ color: '#fde047' });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(7, 8, 6), eyeMat);
      eye.position.set(s * 14, 31, 27);
      g.add(eye);
    }

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(48, 55, 32),
      new THREE.MeshBasicMaterial({ color: '#d946ef', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 2.0;
    g.add(ring);

    const tentacles = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const tg = new THREE.Group();
      tg.rotation.y = a;
      const arm = new THREE.Mesh(new THREE.ConeGeometry(8.5, 68, 6), bodyMat);
      arm.position.set(52, 24, 0);
      arm.rotation.z = -0.35;
      arm.castShadow = true;
      addToonOutline(arm, 1.06);
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
      emissiveIntensity: 0.55,
      metalness: 0.75,
      roughness: 0.2,
      flatShading: true
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(14, 12, 10, 7), goldMat);
    base.position.y = 23;
    addToonOutline(base, 1.07);
    g.add(base);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(4, 13, 4), goldMat);
      spike.position.set(Math.cos(a) * 11, 32, Math.sin(a) * 11);
      g.add(spike);
    }
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(12, 22, 145, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
    );
    beam.position.y = 72;
    g.add(beam);
    this.dynamicGroup.add(g);
    return g;
  }

  // ============================================================
  // 👁️ VISIBILITY LOGIC (100% Parity with 2D!)
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
  // 🎆 3D PARTICLES: V-WAKES, MUZZLE SMOKE, SPLASHES & SINKING SHIPS!
  // ============================================================
  _spawnBurst(x, z, color, count = 8, spread = 90, upBoost = 65) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= 145) break;
      const a = Math.random() * Math.PI * 2;
      const spd = spread * (0.35 + Math.random() * 0.85);
      const m = new THREE.Mesh(
        this._sharedGeo.sphere,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 })
      );
      const sz = 2.6 + Math.random() * 3.6;
      m.scale.setScalar(sz);
      m.position.set(x, 7 + Math.random() * 6, z);
      this.fxGroup.add(m);
      this.particles.push({
        mesh: m,
        vx: Math.cos(a) * spd,
        vy: upBoost + Math.random() * 70,
        vz: Math.sin(a) * spd,
        gravity: 240,
        life: 0.44 + Math.random() * 0.26,
        maxLife: 0.68,
        kind: 'spark'
      });
    }
  }

  _spawnSmoke(x, z, count = 5) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= 145) break;
      const a = Math.random() * Math.PI * 2;
      const m = new THREE.Mesh(
        this._sharedGeo.sphere,
        new THREE.MeshBasicMaterial({ color: '#f1f5f9', transparent: true, opacity: 0.68, depthWrite: false })
      );
      m.scale.setScalar(5 + Math.random() * 4);
      m.position.set(x + Math.cos(a) * 6, 12, z + Math.sin(a) * 6);
      this.fxGroup.add(m);
      this.particles.push({
        mesh: m,
        vx: Math.cos(a) * 26,
        vy: 34 + Math.random() * 24,
        vz: Math.sin(a) * 26,
        gravity: -12,
        life: 0.62,
        maxLife: 0.62,
        kind: 'smoke'
      });
    }
  }

  _spawnShockRing(x, z, color = '#ffffff', startR = 12, endR = 95, dur = 0.5) {
    if (this.particles.length >= 145) return;
    const m = new THREE.Mesh(
      this._sharedGeo.ring,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false })
    );
    m.position.set(x, 2.2, z);
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
    if (this.particles.length >= 145) return;
    for (const side of [-1, 1]) {
      const a = aim + Math.PI + side * 0.46;
      const m = new THREE.Mesh(
        this._sharedGeo.sphere,
        new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.58, depthWrite: false })
      );
      m.scale.set(5.5, 1.4, 5.5);
      m.position.set(x - Math.cos(aim) * 17 + Math.cos(a) * 8, 2.0, z - Math.sin(aim) * 17 + Math.sin(a) * 8);
      this.fxGroup.add(m);
      this.particles.push({
        mesh: m,
        vx: Math.cos(a) * 32,
        vy: 0,
        vz: Math.sin(a) * 32,
        gravity: 0,
        life: 0.56,
        maxLife: 0.56,
        kind: 'foam'
      });
    }
  }

  _spawnSinkingVessel(p, sp) {
    const ch = CHAR_MAP[p.charId] || { color: '#38bdf8' };
    const skin = BOAT_SKIN_MAP[p.skinId] || BOAT_SKIN_MAP.auto;
    const hullHex = skin.hull || ch.color;
    const roleHex = p.role === 'hunter' ? '#ffb703' : (p.role === 'ffa' ? '#ff6b6b' : '#06d6a0');
    const sinkRig = this._createCharRig(p.charId, hullHex, roleHex);
    sinkRig.ring.visible = false;
    sinkRig.root.position.set(sp.x, 0, sp.y);
    sinkRig.body.rotation.y = -sp.aim;
    this.fxGroup.add(sinkRig.root);
    this.sinkingRigs.push({
      rig: sinkRig,
      life: 2.1,
      maxLife: 2.1,
      rollDir: Math.random() < 0.5 ? 1 : -1
    });
    this._spawnBurst(sp.x, sp.y, '#e0f2fe', 16, 115, 110);
    this._spawnShockRing(sp.x, sp.y, '#bae6fd', 14, 115, 0.7);
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
        pt.mesh.material.opacity = ratio * 0.8;
      } else if (pt.kind === 'foam') {
        pt.mesh.position.x += pt.vx * dt;
        pt.mesh.position.z += pt.vz * dt;
        const sc = 5.5 + (1 - ratio) * 9.5;
        pt.mesh.scale.set(sc, 1.2, sc);
        pt.mesh.material.opacity = ratio * 0.5;
      } else if (pt.kind === 'smoke') {
        pt.mesh.position.x += pt.vx * dt;
        pt.mesh.position.y += pt.vy * dt;
        pt.mesh.position.z += pt.vz * dt;
        const sc = 6 + (1 - ratio) * 11;
        pt.mesh.scale.setScalar(sc);
        pt.mesh.material.opacity = ratio * 0.62;
      } else {
        pt.vy -= pt.gravity * dt;
        pt.mesh.position.x += pt.vx * dt;
        pt.mesh.position.y = Math.max(1.5, pt.mesh.position.y + pt.vy * dt);
        pt.mesh.position.z += pt.vz * dt;
        pt.mesh.material.opacity = ratio;
      }
    }

    // Step dramatic 3D sinking ships (capsize + pitch nose-up + sink below ocean!)
    for (let i = this.sinkingRigs.length - 1; i >= 0; i--) {
      const sr = this.sinkingRigs[i];
      sr.life -= dt;
      if (sr.life <= 0) {
        this.fxGroup.remove(sr.rig.root);
        this.sinkingRigs.splice(i, 1);
        continue;
      }
      const prog = 1 - sr.life / sr.maxLife;
      sr.rig.body.position.y = -prog * 34;
      sr.rig.body.rotation.x = sr.rollDir * prog * 0.95;
      sr.rig.body.rotation.z = prog * 0.62;
      if (Math.random() < dt * 10) {
        this._spawnBurst(sr.rig.root.position.x, sr.rig.root.position.z, '#e0f2fe', 1, 28, 35);
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
      this.prevAlive.clear();
      this.seenPulses.clear();
      this.seenSinks.clear();
    }

    // Update GPU Ocean Shader uniforms (100% GPU waves + caustics!)
    const fogDens = state.roundEvent === 'gece_sisi' ? 0.00095 : 0.00034;
    this.scene.fog.density = fogDens;
    this.oceanUniforms.uTime.value = this.time;
    this.oceanUniforms.uFogDensity.value = fogDens;

    // Mercan Plajı animated shoreline surf
    if (this.beachSurfMesh) {
      this.beachSurfMesh.mesh.position.z = this.beachSurfMesh.baseZ + Math.sin(this.time * 2.4) * 6;
      this.beachSurfMesh.mesh.material.opacity = 0.45 + Math.sin(this.time * 2.4) * 0.22;
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

    // Animate ambient map life
    for (const sp of this.ambientSprites) {
      if (sp.kind === 'gull') {
        const a = this.time * sp.spd + sp.phase;
        sp.mesh.position.x = sp.cx + Math.cos(a) * sp.rad;
        sp.mesh.position.z = sp.cz + Math.sin(a) * sp.rad * 0.72;
        sp.mesh.rotation.y = -a;
        const flap = Math.sin(this.time * 8 + sp.phase) * 0.36;
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

    if (this.lighthouseRig && state.lighthouse) {
      this.lighthouseRig.beamGroup.rotation.y = -state.lighthouse.angle;
    }

    const players = state.players || [];
    const me = players.find(p => p.id === myId) || players[0];

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

      // Dramatic 3D sinking animation when a boat is sunk!
      const wasAlive = this.prevAlive.get(p.id);
      if (wasAlive === true && !p.alive) {
        this._spawnSinkingVessel(p, sp);
      }
      this.prevAlive.set(p.id, Boolean(p.alive));

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

    // Pulse explosions, muzzle flashes + gunpowder smoke, sonar & shockwaves!
    for (const pu of state.pulses || []) {
      if (this.seenPulses.has(pu.id)) continue;
      this.seenPulses.add(pu.id);
      if (pu.kind === 'muzzle') {
        this._spawnBurst(pu.x, pu.y, '#fde047', 6, 65, 35);
        this._spawnSmoke(pu.x, pu.y, 4);
      } else if (pu.kind === 'boom' || pu.kind === 'barrel') {
        this._spawnBurst(pu.x, pu.y, '#ff6b35', 16, 160, 110);
        this._spawnSmoke(pu.x, pu.y, 6);
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

    // Follow camera smoothly on player
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
    const wantH = this.camMode === 'sinematik' ? (isNarrow ? 390 : 305) : (isNarrow ? 590 : 470);
    const wantB = this.camMode === 'sinematik' ? (isNarrow ? 470 : 405) : (isNarrow ? 420 : 335);
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
      this.stormRing.position.set(state.storm.cx, 62, state.storm.cy);
      this.stormRing.scale.set(Math.max(10, state.storm.r), 1, Math.max(10, state.storm.r));
    } else {
      this.stormRing.visible = false;
    }

    this._stepParticles(dt);

    // Render WebGL 3D scene!
    this.renderer.render(this.scene, this.camera);

    // Render crisp 2D Overlay
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

      const targetY = p.submerged ? -14 : (Math.sin(this.time * 4 + sp.x * 0.02) * 1.6);
      rig.diveY += (targetY - rig.diveY) * 0.22;
      rig.body.position.y = rig.diveY;
      rig.body.rotation.y = -sp.aim;

      const spd = Math.hypot(p.vx || 0, p.vy || 0);
      rig.body.rotation.x = Math.sin(this.time * 5 + sp.y * 0.02) * 0.05;
      rig.body.rotation.z = Math.min(0.14, spd * 0.00045);

      if (rig.animParts.tail) rig.animParts.tail.rotation.y = Math.sin(this.time * (8 + spd * 0.035)) * 0.44;
      if (rig.animParts.sail) rig.animParts.sail.scale.x = 1 + Math.sin(this.time * 4.5) * 0.14;
      if (rig.animParts.flag) rig.animParts.flag.rotation.y = Math.sin(this.time * 9 + sp.x * 0.03) * 0.35;
      if (rig.animParts.tentacles) {
        for (const t of rig.animParts.tentacles) {
          t.group.rotation.y = t.baseA + Math.sin(this.time * 5 + t.idx) * 0.24;
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
        if (obj.isMesh && obj.material && obj.material !== SHARED_OUTLINE_MAT && obj.material.emissive) {
          if (hf > 0) obj.material.emissive.set('#ffffff');
          else if (p.charId === 'hayalet') obj.material.emissive.set('#38bdf8');
          else obj.material.emissive.set('#000000');
          obj.material.emissiveIntensity = hf > 0 ? 0.85 : (p.charId === 'hayalet' ? 0.45 : 0);
        }
      });

      if (me && p.id === me.id) {
        if (p.submerged) {
          showDiveRing = true;
          this.diveRingMesh.position.set(sp.x, 2.4, sp.y);
          this.diveRingMesh.material.color.set(p.diveTime >= 1.0 ? '#ffd166' : '#38bdf8');
        } else {
          const it0 = p.items?.[0];
          const range = (it0 && it0.usesLeft > 0 && ALL_ITEMS[it0.id]?.range) ? Math.min(340, ALL_ITEMS[it0.id].range * 0.55) : 140;
          showAim = true;
          this.aimGuideMesh.position.set(sp.x, 2.2, sp.y);
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

        let head;
        if (pr.kind === 'harpoon' || pr.kind === 'hook') {
          head = new THREE.Mesh(
            new THREE.CylinderGeometry(2.5, 3.8, 28, 6),
            new THREE.MeshBasicMaterial({ color: col })
          );
          head.rotation.z = Math.PI / 2;
        } else if (pr.kind === 'net' || pr.kind === 'electric_net') {
          head = new THREE.Mesh(
            new THREE.TorusGeometry(12, 2.8, 6, 12),
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

        const trailLen = pr.firearm ? 56 : 34;
        const trail = new THREE.Mesh(
          new THREE.ConeGeometry(pr.firearm ? 5.2 : 3.8, trailLen, 6),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.48, depthWrite: false })
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
          new THREE.CylinderGeometry(11.5, 11.5, 21, 10),
          new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.6, flatShading: true })
        );
        cyl.position.y = 10.5;
        cyl.castShadow = true;
        addToonOutline(cyl, 1.07);
        g.add(cyl);

        for (const by of [6, 15]) {
          const band = new THREE.Mesh(
            new THREE.CylinderGeometry(12.2, 12.2, 2.8, 10),
            new THREE.MeshStandardMaterial({ color: '#fbbf24', metalness: 0.4, roughness: 0.4 })
          );
          band.position.y = by;
          g.add(band);
        }
        // Top fuse spark!
        const fuse = new THREE.Mesh(new THREE.SphereGeometry(2.6, 6, 6), new THREE.MeshBasicMaterial({ color: '#fde047' }));
        fuse.position.y = 22.5;
        g.add(fuse);

        this.dynamicGroup.add(g);
        this.barrelMeshes.set(b.id, g);
        m = g;
      }
      m.position.set(b.x, Math.sin(this.time * 4 + b.id) * 1.8, b.y);
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
        const chest = new THREE.Group();

        // Sculpted Treasure Chest (wooden base + vaulted lid + gold trim + glowing lock!)
        const base = new THREE.Mesh(
          new THREE.BoxGeometry(20, 11, 14),
          new THREE.MeshStandardMaterial({ color: '#854d0e', roughness: 0.72, flatShading: true })
        );
        base.position.y = 9.5;
        base.castShadow = true;
        addToonOutline(base, 1.07);
        chest.add(base);

        const lid = new THREE.Mesh(
          new THREE.CylinderGeometry(7, 7, 20, 8, 1, false, 0, Math.PI),
          new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, roughness: 0.38, flatShading: true })
        );
        lid.rotation.z = Math.PI / 2;
        lid.position.y = 15;
        lid.castShadow = true;
        chest.add(lid);

        const clasp = new THREE.Mesh(
          new THREE.BoxGeometry(4, 5, 15.2),
          new THREE.MeshBasicMaterial({ color: '#fef08a' })
        );
        clasp.position.y = 13;
        chest.add(clasp);

        g.add(chest);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(17, 21.5, 22),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 2.0;
        g.add(ring);

        this.dynamicGroup.add(g);
        this.powerupMeshes.set(pu.id, g);
        m = g;
      }
      m.position.set(pu.x, Math.sin(this.time * 3.5 + pu.id) * 3.5, pu.y);
      m.children[0].rotation.y = this.time * 1.5;
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
        // Crossed wooden palisade logs + rope lashings (NOT a plain cylinder!)
        const g = new THREE.Group();
        const logMat = new THREE.MeshStandardMaterial({ color: '#92400e', roughness: 0.85, flatShading: true });
        const ropeMat = new THREE.MeshStandardMaterial({ color: '#eab308', roughness: 0.9 });
        const rad = br.r || 28;
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          const post = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.8, 28 + (k % 2) * 6, 6), logMat);
          post.position.set(Math.cos(a) * rad * 0.45, 13, Math.sin(a) * rad * 0.45);
          post.rotation.z = Math.cos(a) * 0.14;
          post.rotation.x = Math.sin(a) * 0.14;
          post.castShadow = true;
          addToonOutline(post, 1.07);
          g.add(post);
        }
        const rope = new THREE.Mesh(new THREE.TorusGeometry(rad * 0.56, 2.2, 6, 14), ropeMat);
        rope.rotation.x = Math.PI / 2;
        rope.position.y = 14;
        g.add(rope);

        this.dynamicGroup.add(g);
        this.breakableMeshes.set(br.id, g);
        m = g;
      }
      const hpRatio = Math.max(0.45, (br.hp || 1) / (br.maxHp || 100));
      m.position.set(br.x, (hpRatio - 1) * 6, br.y);
      m.scale.set(1, hpRatio, 1);
    }
    for (const [id, m] of this.breakableMeshes.entries()) {
      if (!seen.has(id)) {
        this.dynamicGroup.remove(m);
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
          new THREE.MeshStandardMaterial({ color: col, roughness: 0.45, flatShading: true })
        );
        orb.position.y = 6.5;
        addToonOutline(orb, 1.08);
        g.add(orb);
        const r = new THREE.Mesh(
          new THREE.RingGeometry((tr.r || 38) - 2, tr.r || 38, 24),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: isAlly ? 0.42 : 0.68, side: THREE.DoubleSide, depthWrite: false })
        );
        r.rotation.x = -Math.PI / 2;
        r.position.y = 2.0;
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
        let op = 0.64;
        let h = 18;
        if (z.kind === 'flare') { col = '#fb7185'; op = 0.24; h = 4; }
        else if (z.kind === 'gravity') { col = '#a855f7'; op = 0.32; h = 6; }
        else if (z.kind === 'kelp') { col = '#10b981'; op = 0.44; h = 4; }
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
          new THREE.TorusGeometry(13.5, 4.4, 8, 16),
          new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.38 })
        );
        torus.rotation.x = Math.PI / 2;
        torus.position.y = 5.5;
        addToonOutline(torus, 1.07);
        g.add(torus);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry((rb.r || 66) - 3, rb.r || 66, 28),
          new THREE.MeshBasicMaterial({ color: '#06d6a0', transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 2.0;
        g.add(ring);
        this.dynamicGroup.add(g);
        this.buoyMeshes.set(rb.id, g);
        m = g;
      }
      m.position.set(rb.x, Math.sin(this.time * 4) * 1.6, rb.y);
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
          new THREE.MeshBasicMaterial({ color: '#ff6b35', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 2.0;
        g.add(ring);
        const col = new THREE.Mesh(
          new THREE.CylinderGeometry(gz.r * 0.55, gz.r * 0.78, 95, 12),
          new THREE.MeshBasicMaterial({ color: '#ff5500', transparent: true, opacity: 0.8, depthWrite: false })
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
      t.arm.position.y = 24 + Math.cos(this.time * 3.5 + t.idx) * 7;
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

    // 0. Atmospheric Vision Vignette
    if (me && me.alive) {
      const sp = this.smoothPos.get(me.id) || me;
      const center = this._worldToScreen(sp.x, 8, sp.y);
      const isNight = state.roundEvent === 'gece_sisi';
      const innerR = Math.min(this.viewW, this.viewH) * (isNight ? 0.25 : 0.4);
      const outerR = Math.max(this.viewW, this.viewH) * (isNight ? 0.62 : 0.8);
      const vig = ctx.createRadialGradient(center.x, center.y, innerR, center.x, center.y, outerR);
      vig.addColorStop(0, 'rgba(2, 10, 20, 0)');
      vig.addColorStop(1, isNight ? 'rgba(1, 6, 14, 0.72)' : 'rgba(2, 10, 20, 0.36)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }

    // 0b. ⛈️ Fırtına Boğazı animated rain & subtle lightning flash
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
      const scr = this._worldToScreen(sp.x, p.submerged ? 14 : 48, sp.y);
      if (!scr.inFront) continue;

      const x = scr.x;
      const y = scr.y;
      const ch = CHAR_MAP[p.charId] || { accent: '#e0f2fe' };

      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '800 12px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(2, 12, 24, 0.74)';
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
      const scr = this._worldToScreen(k.x, 66, k.y);
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

    // 3. Rescue Buoy Progress
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
    this.oceanMat?.dispose?.();
    this.renderer.dispose();
  }
}
