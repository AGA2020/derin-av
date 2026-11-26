// İKİ İTEMLİ OYUN — Studio-Grade 3D Maritime Renderer v5.3
// Real Kenney CC0 .glb 3D models (ships, wrecks, rocks, palms, chests, barrels, piers, buoys),
// PBR RoomEnvironment IBL lighting, Fresnel + Specular reflective GLSL ocean shader (NO spiderweb!),
// soft radial mist clouds, flowing translucent currents, and 3D sinking ship animations!

import * as THREE from '../vendor/three.module.min.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { WORLD_W, WORLD_H, CHAR_MAP, ALL_ITEMS, POWERUP_MAP, BOAT_SKIN_MAP, SEA_MAPS } from './data.js?v=5.33';
import { hasLineOfSight } from './sim.js?v=5.33';

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

// ============================================================
// 🌊 REAL PBR FRESNEL + SPECULAR OCEAN SHADER (Zero Spiderweb!)
// ============================================================
const OCEAN_VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying float vElev;

  float waveHeight(vec2 p, float t) {
    float h = 0.0;
    h += sin(p.x * 0.015 + p.y * 0.008 + t * 1.6) * 2.2;
    h += cos(p.y * 0.019 - p.x * 0.007 - t * 1.35) * 1.7;
    h += sin((p.x - p.y) * 0.026 + t * 2.1) * 0.8;
    return h;
  }

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float h = waveHeight(wp.xz, uTime);
    wp.y += h;
    vElev = h;
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const OCEAN_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSkyColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform vec2 uWorldCenter;

  varying vec3 vWorldPos;
  varying float vElev;

  // Smooth value noise for organic micro-ripples & soft whitecaps (NO hard polygon lines!)
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    v += 0.55 * noise(p);
    v += 0.30 * noise(p * 2.13 + vec2(4.2, 1.7));
    v += 0.15 * noise(p * 4.21 - vec2(2.1, 5.3));
    return v;
  }

  // Analytic wave surface normal (smooth liquid reflections!)
  vec3 getOceanNormal(vec2 p, float t) {
    float eps = 1.6;
    float h0 = fbm(p * 0.016 + vec2(t * 0.22, t * 0.14)) * 3.8
             + fbm(p * 0.036 - vec2(t * 0.18, -t * 0.26)) * 1.9;
    float hx = fbm((p + vec2(eps, 0.0)) * 0.016 + vec2(t * 0.22, t * 0.14)) * 3.8
             + fbm((p + vec2(eps, 0.0)) * 0.036 - vec2(t * 0.18, -t * 0.26)) * 1.9;
    float hz = fbm((p + vec2(0.0, eps)) * 0.016 + vec2(t * 0.22, t * 0.14)) * 3.8
             + fbm((p + vec2(0.0, eps)) * 0.036 - vec2(t * 0.18, -t * 0.26)) * 1.9;

    // Combine large swell slope + smooth FBM liquid ripples
    float swellX = cos(p.x * 0.015 + p.y * 0.008 + t * 1.6) * 0.055;
    float swellZ = -sin(p.y * 0.019 - p.x * 0.007 - t * 1.35) * 0.048;
    vec3 n = normalize(vec3(-(hx - h0) * 0.32 - swellX, 1.0, -(hz - h0) * 0.32 - swellZ));
    return n;
  }

  void main() {
    vec3 N = getOceanNormal(vWorldPos.xz, uTime);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDir);

    // Rich marine depth gradient from center to outer sea
    vec2 rel = (vWorldPos.xz - uWorldCenter) / vec2(980.0, 700.0);
    float dEdge = clamp(length(rel), 0.0, 1.0);
    vec3 waterCol = mix(uShallowColor, uDeepColor, smoothstep(0.0, 1.0, dEdge));

    // Subsurface turquoise scattering on sunlit wave crests!
    float crest = smoothstep(-0.8, 3.6, vElev);
    float sss = pow(max(0.0, dot(V, -L + N * 0.5)), 2.0) * 0.35 + crest * 0.22;
    waterCol += uShallowColor * sss * 0.45;

    // Diffuse lighting across liquid waves
    float ndl = max(0.0, dot(N, L));
    waterCol *= (0.72 + ndl * 0.42);

    // Schlick Fresnel sky reflection (realistic liquid ocean sheen!)
    float fresnel = pow(1.0 - max(0.0, dot(N, V)), 3.2);
    waterCol = mix(waterCol, uSkyColor, clamp(fresnel * 0.62, 0.0, 0.62));

    // Crisp golden sun specular glints (yakamoz!)
    vec3 H = normalize(L + V);
    float specBroad = pow(max(0.0, dot(N, H)), 28.0) * 0.26;
    float specSharp = pow(max(0.0, dot(N, H)), 140.0) * 0.95;
    waterCol += uSunColor * (specBroad + specSharp);

    // Subtle organic foamy whitecaps ONLY on highest wave ridges
    float foamNoise = fbm(vWorldPos.xz * 0.042 + vec2(uTime * 0.28, -uTime * 0.18));
    float whitecap = smoothstep(2.4, 4.2, vElev) * smoothstep(0.54, 0.78, foamNoise);
    waterCol = mix(waterCol, vec3(0.92, 0.98, 1.0), whitecap * 0.35);

    // Smooth horizon fog
    float distCam = length(cameraPosition - vWorldPos);
    float fogAmt = 1.0 - exp(-pow(distCam * uFogDensity, 2.0));
    waterCol = mix(waterCol, uFogColor, clamp(fogAmt, 0.0, 0.85));

    gl_FragColor = vec4(waterCol, 1.0);
  }
`;

// ============================================================
// 🎨 SOFT PROCEDURAL TEXTURES (Zero Hard Plastic Edges!)
// ============================================================
function createSoftMistTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  // Soft layered billowing cloud puffs with completely feathered alpha edges
  const puffs = [
    [128, 128, 118, 0.34],
    [92, 110, 82, 0.28],
    [164, 118, 86, 0.28],
    [124, 160, 80, 0.25],
    [138, 92, 74, 0.26]
  ];
  for (const [x, y, r, a] of puffs) {
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    g.addColorStop(0, `rgba(226, 244, 255, ${a})`);
    g.addColorStop(0.55, `rgba(200, 232, 250, ${a * 0.45})`);
    g.addColorStop(1, 'rgba(200, 232, 250, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function createSoftLagoonTexture(hexCol = '#2dd4bf', foamHex = '#e0f7ff') {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  const col = new THREE.Color(hexCol);
  const fcol = new THREE.Color(foamHex);
  const r1 = Math.round(col.r * 255), g1 = Math.round(col.g * 255), b1 = Math.round(col.b * 255);
  const r2 = Math.round(fcol.r * 255), g2 = Math.round(fcol.g * 255), b2 = Math.round(fcol.b * 255);

  const grad = ctx.createRadialGradient(128, 128, 42, 128, 128, 126);
  grad.addColorStop(0.0, `rgba(${r2}, ${g2}, ${b2}, 0.55)`);
  grad.addColorStop(0.45, `rgba(${r2}, ${g2}, ${b2}, 0.36)`);
  grad.addColorStop(0.62, `rgba(${r1}, ${g1}, ${b1}, 0.34)`);
  grad.addColorStop(0.84, `rgba(${r1}, ${g1}, ${b1}, 0.12)`);
  grad.addColorStop(1.0, `rgba(${r1}, ${g1}, ${b1}, 0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);

  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function createCurrentFlowTexture() {
  const w = 256, h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  // Soft translucent aqua flow streaks + sleek directional water chevrons (NO zebra crossing!)
  for (let i = 0; i < 6; i++) {
    const y = 16 + i * 19;
    const g = ctx.createLinearGradient(0, y, w, y);
    g.addColorStop(0, 'rgba(125, 245, 255, 0)');
    g.addColorStop(0.45, 'rgba(165, 248, 255, 0.42)');
    g.addColorStop(0.75, 'rgba(224, 252, 255, 0.55)');
    g.addColorStop(1, 'rgba(125, 245, 255, 0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = i % 2 === 0 ? 3.5 : 2.2;
    ctx.beginPath();
    ctx.moveTo(10, y);
    ctx.quadraticCurveTo(w * 0.5, y + (i % 2 === 0 ? 6 : -6), w - 10, y);
    ctx.stroke();
  }
  // Subtle sleek glowing chevron in center
  ctx.strokeStyle = 'rgba(224, 252, 255, 0.58)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(108, 36);
  ctx.lineTo(148, 64);
  ctx.lineTo(108, 92);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// Smooth sculpted shark & octopus for non-ship marine creatures
function createSmoothSharkGeometry() {
  const pts = [
    new THREE.Vector2(0.01, -21),
    new THREE.Vector2(3.2, -14),
    new THREE.Vector2(6.8, -5),
    new THREE.Vector2(10.5, 4),
    new THREE.Vector2(10.8, 11),
    new THREE.Vector2(7.6, 18),
    new THREE.Vector2(3.2, 23),
    new THREE.Vector2(0.01, 26)
  ];
  const geo = new THREE.LatheGeometry(pts, 18);
  geo.rotateZ(-Math.PI / 2);
  geo.scale(1.0, 0.78, 0.92);
  geo.computeVertexNormals();
  return geo;
}

function createSmoothTentacleGeometry(length = 26, baseR = 3.5) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-length * 0.38, -2.2, 2.5),
    new THREE.Vector3(-length * 0.74, 2.2, -1.8),
    new THREE.Vector3(-length, -1.0, 1.2)
  ]);
  return new THREE.TubeGeometry(curve, 12, baseR * 0.62, 10, false);
}

// Rich bright daytime / sunset / moonlight lighting palettes per map!
const MAP_PALETTES = {
  firtina_bogazi: {
    sunCol: '#e0f2fe', sunInt: 2.1, hemiSky: '#bae6fd', hemiGround: '#104569',
    deep: '#0f3c63', shallow: '#1d7aa8', sky: '#70b3de', bg: '#0e3252', lagoon: '#38bdf8'
  },
  korsan_enkazi: {
    sunCol: '#fef08a', sunInt: 2.25, hemiSky: '#e0f2fe', hemiGround: '#114a66',
    deep: '#0c3554', shallow: '#18759e', sky: '#6cb4dc', bg: '#0e324d', lagoon: '#38bdf8'
  },
  akinti_koyu: {
    sunCol: '#fffbeb', sunInt: 2.35, hemiSky: '#bae6fd', hemiGround: '#0e5b73',
    deep: '#093c59', shallow: '#148ea8', sky: '#7cd4f0', bg: '#0b3852', lagoon: '#2dd4bf'
  },
  mercan_plaji: {
    sunCol: '#fffbeb', sunInt: 2.5, hemiSky: '#e0f7ff', hemiGround: '#147a87',
    deep: '#0c4e6e', shallow: '#16a3b5', sky: '#8be0f5', bg: '#0e4966', lagoon: '#5eead4'
  },
  volkanik_resif: {
    sunCol: '#fdba74', sunInt: 2.2, hemiSky: '#fed7aa', hemiGround: '#4a1c17',
    deep: '#241219', shallow: '#5e2422', sky: '#b85a3a', bg: '#1e1016', lagoon: '#fb923c'
  },
  hayalet_sis: {
    sunCol: '#d1fae5', sunInt: 1.75, hemiSky: '#99f6e4', hemiGround: '#093332',
    deep: '#072224', shallow: '#125957', sky: '#3d8f8a', bg: '#071f21', lagoon: '#2dd4bf'
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
    this._curCamH = this.camMode === 'sinematik' ? 305 : 465;
    this._curCamB = this.camMode === 'sinematik' ? 405 : 335;
    this.viewW = 0;
    this.viewH = 0;
    this.time = 0;
    this.shake = 0;
    this.lightningAlpha = 0;
    this.nextLightning = 6.5;
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
    this.sinkingRigs = [];

    // Loaded CC0 Kenney .glb templates
    this.models = {};
    this.modelsReady = false;
    this._needsMapRebuild = false;

    // Three.js WebGLRenderer with rich PBR tone mapping
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
    this.renderer.toneMappingExposure = 1.18;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0c2f4a');
    this.scene.fog = new THREE.FogExp2('#0c2f4a', 0.00032);

    // Studio PBR Image-Based Lighting (RoomEnvironment) — makes every GLB wood/metal/sail glow naturally!
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this._envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
      this.scene.environment = this._envRT.texture;
      this.scene.environmentIntensity = 0.65;
      pmrem.dispose();
    } catch (_) {}

    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 15, 4200);
    this._raycaster = new THREE.Raycaster();
    this._waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._tmpVec = new THREE.Vector3();
    this._tmpNdc = new THREE.Vector2();

    // Warm Maritime Lighting
    this.hemiLight = new THREE.HemisphereLight('#e0f2fe', '#0e4f6e', 1.35);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#fff8e6', 2.2);
    this.sunLight.position.set(WORLD_W * 0.5 + 380, 760, WORLD_H * 0.5 + 260);
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
    this.sunLight.shadow.bias = -0.0006;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Groups
    this.mapGroup = new THREE.Group();
    this.dynamicGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();
    this.scene.add(this.mapGroup);
    this.scene.add(this.dynamicGroup);
    this.scene.add(this.fxGroup);

    // Soft procedural textures (zero hard plastic rings/blocks!)
    this.mistTex = createSoftMistTexture();
    this.currentTex = createCurrentFlowTexture();
    this.lagoonTexCache = new Map();

    // Real PBR Fresnel + Specular Ocean Shader
    this.oceanUniforms = {
      uTime: { value: 0 },
      uDeepColor: { value: new THREE.Color('#0c3554') },
      uShallowColor: { value: new THREE.Color('#18759e') },
      uSkyColor: { value: new THREE.Color('#6cb4dc') },
      uSunColor: { value: new THREE.Color('#fff4cc') },
      uSunDir: { value: new THREE.Vector3(0.45, 0.78, 0.35).normalize() },
      uFogColor: { value: new THREE.Color('#0e324d') },
      uFogDensity: { value: 0.00032 },
      uWorldCenter: { value: new THREE.Vector2(WORLD_W / 2, WORLD_H / 2) }
    };
    this.oceanMat = new THREE.ShaderMaterial({
      vertexShader: OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
      uniforms: this.oceanUniforms
    });

    this.oceanMesh = null;
    this.beachSurfMesh = null;
    this.currentPlanes = [];
    this.fogGroups = [];
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

    this.particles = [];
    this._sharedGeo = {
      sphere: new THREE.SphereGeometry(1, 10, 8),
      plane: new THREE.PlaneGeometry(1, 1),
      ring: new THREE.RingGeometry(0.8, 1, 32),
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
      cone: new THREE.ConeGeometry(1, 1, 8),
      sharkBody: createSmoothSharkGeometry(),
      tentacle: createSmoothTentacleGeometry(25, 3.5)
    };
    this._sharedGeo.ring.rotateX(-Math.PI / 2);
    this._sharedGeo.plane.rotateX(-Math.PI / 2);

    this._initPersistentHelpers();
    this.resize();
    this._loadAllModels();
  }

  // ============================================================
  // 📦 PARALLEL ASYNC KENNEY CC0 GLB MODEL LOADER
  // ============================================================
  _loadAllModels() {
    const loader = new GLTFLoader();
    const manifest = [
      ['shipPirate', './vendor/models/pirate/ship-pirate.glb'],
      ['shipGhost', './vendor/models/pirate/ship-ghost.glb'],
      ['shipWreck', './vendor/models/pirate/ship-wreck.glb'],
      ['boatSpeed', './vendor/models/watercraft/boat-speed.glb'],
      ['boatTug', './vendor/models/watercraft/boat-tug.glb'],
      ['rocksA', './vendor/models/pirate/rocks-a.glb'],
      ['rocksB', './vendor/models/pirate/rocks-b.glb'],
      ['rocksSand', './vendor/models/pirate/rocks-sand.glb'],
      ['palm', './vendor/models/pirate/palm.glb'],
      ['chest', './vendor/models/pirate/chest.glb'],
      ['barrel', './vendor/models/pirate/barrel.glb'],
      ['barricade', './vendor/models/pirate/barricade.glb'],
      ['dock', './vendor/models/pirate/dock.glb'],
      ['buoy', './vendor/models/watercraft/buoy.glb']
    ];

    Promise.all(manifest.map(([key, url]) => new Promise((resolve) => {
      loader.load(url, (gltf) => {
        const root = gltf.scene;
        root.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.material) {
              o.material.roughness = Math.min(0.85, (o.material.roughness ?? 0.7));
              o.material.envMapIntensity = 0.85;
            }
          }
        });
        this.models[key] = root;
        resolve();
      }, undefined, () => resolve());
    }))).then(() => {
      this.modelsReady = true;
      this._needsMapRebuild = true;
      // Clear cached dynamic props so they respawn using crisp GLB models immediately!
      for (const mapPool of [this.playerRigs, this.barrelMeshes, this.powerupMeshes, this.breakableMeshes, this.buoyMeshes]) {
        for (const v of mapPool.values()) {
          this.dynamicGroup.remove(v.root || v);
        }
        mapPool.clear();
      }
    });
  }

  // Clone & normalize a Kenney GLB model to exact target world size and facing!
  _cloneGLB(key, targetMaxDim, yOffset = 0, rotY = 0, tintHex = null) {
    const src = this.models[key];
    if (!src) return null;
    const wrapper = new THREE.Group();
    const clone = src.clone(true);

    // Clone materials if tinting so we never mutate the template
    if (tintHex) {
      const tintCol = new THREE.Color(tintHex);
      clone.traverse((o) => {
        if (o.isMesh && o.material) {
          o.material = o.material.clone();
          // Gently blend skin color into bright sail/hull accents
          o.material.color.lerp(tintCol, 0.35);
        }
      });
    }

    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxD = Math.max(size.x, size.y, size.z, 0.001);
    const s = targetMaxDim / maxD;
    clone.scale.setScalar(s);
    clone.position.set(-center.x * s, -box.min.y * s + yOffset, -center.z * s);

    const rotWrap = new THREE.Group();
    rotWrap.rotation.y = rotY;
    rotWrap.add(clone);
    wrapper.add(rotWrap);
    return wrapper;
  }

  _getLagoonTex(hexCol) {
    if (!this.lagoonTexCache.has(hexCol)) {
      this.lagoonTexCache.set(hexCol, createSoftLagoonTexture(hexCol, '#e8fbff'));
    }
    return this.lagoonTexCache.get(hexCol);
  }

  toggleCameraMode() {
    this.camMode = this.camMode === 'sinematik' ? 'taktik' : 'sinematik';
    try { localStorage.setItem('derinav_cam3d', this.camMode); } catch (_) {}
    return this.camMode;
  }

  _initPersistentHelpers() {
    const aimGeo = new THREE.PlaneGeometry(1, 2.8);
    aimGeo.rotateX(-Math.PI / 2);
    aimGeo.translate(0.5, 0, 0);
    this.aimGuideMesh = new THREE.Mesh(
      aimGeo,
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.42, depthWrite: false })
    );
    this.aimGuideMesh.position.y = 2.4;
    this.aimGuideMesh.visible = false;
    this.fxGroup.add(this.aimGuideMesh);

    const diveRingGeo = new THREE.RingGeometry(67, 71, 40);
    diveRingGeo.rotateX(-Math.PI / 2);
    this.diveRingMesh = new THREE.Mesh(
      diveRingGeo,
      new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
    );
    this.diveRingMesh.position.y = 2.6;
    this.diveRingMesh.visible = false;
    this.fxGroup.add(this.diveRingMesh);

    const stormGeo = new THREE.CylinderGeometry(1, 1, 130, 56, 1, true);
    this.stormRing = new THREE.Mesh(
      stormGeo,
      new THREE.MeshBasicMaterial({
        color: '#ef476f',
        transparent: true,
        opacity: 0.24,
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
  // 🏝️ MAP BUILDER (GLB Rocks, Wrecks, Palms, Soft Lagoons, Soft Mist!)
  // ============================================================
  _clearGroup(group) {
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }
  }

  _buildMap(map) {
    this.currentMapId = map.id;
    this._needsMapRebuild = false;
    this._clearGroup(this.mapGroup);
    this.currentPlanes = [];
    this.fogGroups = [];
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
    this.oceanUniforms.uShallowColor.value.set(pal.shallow);
    this.oceanUniforms.uSkyColor.value.set(pal.sky);
    this.oceanUniforms.uSunColor.value.set(pal.sunCol);
    this.oceanUniforms.uFogColor.value.set(pal.bg);

    // 1. Reflective PBR Fresnel GLSL Ocean
    const oceanGeo = new THREE.PlaneGeometry(WORLD_W + 1100, WORLD_H + 1100, 60, 42);
    oceanGeo.rotateX(-Math.PI / 2);
    this.oceanMesh = new THREE.Mesh(oceanGeo, this.oceanMat);
    this.oceanMesh.position.set(WORLD_W / 2, 0, WORLD_H / 2);
    this.mapGroup.add(this.oceanMesh);

    // Subtle soft shadow catcher on water surface
    const shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_W + 200, WORLD_H + 200),
      new THREE.ShadowMaterial({ opacity: 0.24 })
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.set(WORLD_W / 2, 1.5, WORLD_H / 2);
    shadowCatcher.receiveShadow = true;
    this.mapGroup.add(shadowCatcher);

    // Nautical floating perimeter buoys (replaces harsh CAD wireframe border line!)
    const buoyColMat = new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.45 });
    const buoyCapMat = new THREE.MeshBasicMaterial({ color: '#fef08a' });
    const addBorderBuoy = (bx, bz) => {
      const bg = new THREE.Group();
      bg.position.set(bx, 1.5, bz);
      const b1 = new THREE.Mesh(this._sharedGeo.cyl, buoyColMat);
      b1.scale.set(3.2, 7, 3.2);
      b1.position.y = 3;
      const cap = new THREE.Mesh(this._sharedGeo.sphere, buoyCapMat);
      cap.scale.setScalar(2.2);
      cap.position.y = 7.5;
      bg.add(b1, cap);
      this.mapGroup.add(bg);
    };
    for (let x = 20; x <= WORLD_W - 20; x += 170) {
      addBorderBuoy(x, 14);
      addBorderBuoy(x, WORLD_H - 14);
    }
    for (let z = 140; z <= WORLD_H - 140; z += 170) {
      addBorderBuoy(14, z);
      addBorderBuoy(WORLD_W - 14, z);
    }

    // 2. Mercan Plajı Beach + Feathered Lagoon + Real GLB Palm Trees!
    if (map.beach) {
      const b = map.beach;
      const sand = new THREE.Mesh(
        new THREE.BoxGeometry(WORLD_W + 500, 14, b.sandY + 300),
        new THREE.MeshStandardMaterial({ color: '#efd397', roughness: 0.88 })
      );
      sand.position.set(WORLD_W / 2, 5.5, (b.sandY - 300) / 2);
      sand.receiveShadow = true;
      this.mapGroup.add(sand);

      // Soft white surf strip
      const surfGeo = new THREE.PlaneGeometry(WORLD_W + 200, 22);
      surfGeo.rotateX(-Math.PI / 2);
      const surf = new THREE.Mesh(
        surfGeo,
        new THREE.MeshBasicMaterial({ color: '#f0fdff', transparent: true, opacity: 0.48, depthWrite: false })
      );
      surf.position.set(WORLD_W / 2, 1.9, b.sandY + 9);
      this.mapGroup.add(surf);
      this.beachSurfMesh = { mesh: surf, baseZ: b.sandY + 9 };

      // Feathered turquoise shallow water band
      const lagGeo = new THREE.PlaneGeometry(WORLD_W, b.shallowY - b.sandY);
      lagGeo.rotateX(-Math.PI / 2);
      const lag = new THREE.Mesh(
        lagGeo,
        new THREE.MeshBasicMaterial({ color: '#5eead4', transparent: true, opacity: 0.24, depthWrite: false })
      );
      lag.position.set(WORLD_W / 2, 1.6, (b.sandY + b.shallowY) / 2);
      this.mapGroup.add(lag);

      for (const palm of b.palms || []) {
        const pm = this._cloneGLB('palm', 86, 11, (palm.x * 0.03) % 6.28);
        if (pm) {
          pm.position.set(palm.x, 0, palm.y);
          this.mapGroup.add(pm);
        }
      }
    }

    // 3. Real GLB Rocks, Islands, Shipwrecks & Wooden Docks!
    const lagoonTex = this._getLagoonTex(pal.lagoon);
    const lagoonMat = new THREE.MeshBasicMaterial({
      map: lagoonTex,
      transparent: true,
      opacity: 0.78,
      depthWrite: false
    });

    let rockIdx = 0;
    for (const obs of map.rocks || []) {
      if (obs.type === 'rock') {
        rockIdx++;
        const rg = new THREE.Group();
        rg.position.set(obs.x, 0, obs.y);

        // Soft feathered lagoon + seafoam glow under the island (NO hard plastic plate!)
        const shPlane = new THREE.Mesh(new THREE.PlaneGeometry(obs.r * 3.1, obs.r * 3.1), lagoonMat);
        shPlane.rotation.x = -Math.PI / 2;
        shPlane.position.y = 1.65;
        rg.add(shPlane);

        const rockKey = (map.id === 'mercan_plaji' || rockIdx % 3 === 0) ? 'rocksSand' : (rockIdx % 2 === 0 ? 'rocksA' : 'rocksB');
        const rockTint = map.id === 'volkanik_resif' ? '#6b2314' : (map.id === 'mercan_plaji' ? null : '#52606d');
        const glbRock = this._cloneGLB(rockKey, obs.r * 2.15, -4, (obs.x * 0.017 + obs.y * 0.011) % 6.28, rockTint);

        if (glbRock) {
          rg.add(glbRock);
          // Add a real GLB curved palm on sandy/large sunlit islands!
          if (obs.r >= 44 && rockIdx % 2 === 0 && map.id !== 'volkanik_resif' && map.id !== 'hayalet_sis') {
            const islandPalm = this._cloneGLB('palm', 58, obs.r * 0.75, rockIdx * 1.4);
            if (islandPalm) rg.add(islandPalm);
          }
        } else {
          // Clean smooth fallback while GLB loads (~100ms)
          const fallback = new THREE.Mesh(
            new THREE.DodecahedronGeometry(obs.r * 0.9, 1),
            new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.85 })
          );
          fallback.scale.set(1, 0.7, 1);
          fallback.position.y = obs.r * 0.3;
          rg.add(fallback);
        }
        this.mapGroup.add(rg);
      } else if (obs.type === 'pier') {
        // Real GLB Wooden Docks tiled cleanly along the pier length!
        const pg = new THREE.Group();
        const tiles = Math.max(1, Math.round(obs.h / Math.max(24, obs.w)));
        for (let t = 0; t < tiles; t++) {
          const tileH = obs.h / tiles;
          const dock = this._cloneGLB('dock', Math.max(obs.w, tileH) * 1.08, -2, 0);
          if (dock) {
            dock.position.set(obs.x + obs.w / 2, 0, obs.y + tileH * (t + 0.5));
            pg.add(dock);
          }
        }
        if (pg.children.length === 0) {
          const fb = new THREE.Mesh(
            new THREE.BoxGeometry(obs.w, 6, obs.h),
            new THREE.MeshStandardMaterial({ color: '#7c4a21', roughness: 0.85 })
          );
          fb.position.set(obs.x + obs.w / 2, 9, obs.y + obs.h / 2);
          pg.add(fb);
        }
        this.mapGroup.add(pg);
      } else {
        // Real GLB Shattered Pirate Shipwreck!
        const sg = new THREE.Group();
        sg.position.set(obs.x + obs.w / 2, 0, obs.y + obs.h / 2);

        const shPlane = new THREE.Mesh(new THREE.PlaneGeometry(obs.w * 1.55, obs.h * 2.1), lagoonMat);
        shPlane.rotation.x = -Math.PI / 2;
        shPlane.position.y = 1.65;
        sg.add(shPlane);

        const wreckKey = obs.label === 'HAYALET' ? 'shipGhost' : 'shipWreck';
        const rot = obs.w >= obs.h ? Math.PI / 2 : 0;
        const glbWreck = this._cloneGLB(wreckKey, Math.max(obs.w, obs.h) * 1.05, -8, rot);
        if (glbWreck) {
          glbWreck.rotation.z = 0.08;
          sg.add(glbWreck);
        }
        this.mapGroup.add(sg);
      }
    }

    // 4. Flowing Translucent Aqua Sea Currents (NO MORE ZEBRA CROSSING!)
    for (const cur of map.currents || []) {
      const horizontal = Math.abs(cur.dirX) >= Math.abs(cur.dirY);
      const tex = this.currentTex.clone();
      tex.needsUpdate = true;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      const len = horizontal ? cur.w : cur.h;
      const wid = horizontal ? cur.h : cur.w;
      tex.repeat.set(Math.max(1.5, len / 150), 1);

      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(len, wid),
        new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: 0.55,
          depthWrite: false
        })
      );
      plane.rotation.x = -Math.PI / 2;
      if (!horizontal) plane.rotation.z = cur.dirY > 0 ? -Math.PI / 2 : Math.PI / 2;
      else if (cur.dirX < 0) plane.rotation.z = Math.PI;
      plane.position.set(cur.x + cur.w / 2, 1.85, cur.y + cur.h / 2);
      this.mapGroup.add(plane);
      this.currentPlanes.push({ tex, speed: 0.72 });
    }

    // 5. Feathered Soft Sea Mist Clouds (NO MORE HARD GREY BALLOONS!)
    for (const fg of map.fogs || []) {
      const fGroup = new THREE.Group();
      fGroup.position.set(fg.x, 0, fg.y);

      for (let k = 0; k < 3; k++) {
        const mistMat = new THREE.MeshBasicMaterial({
          map: this.mistTex,
          color: map.id === 'hayalet_sis' ? '#99f6e4' : '#cbd5e1',
          transparent: true,
          opacity: 0.34 - k * 0.06,
          depthWrite: false
        });
        const layer = new THREE.Mesh(new THREE.PlaneGeometry(fg.r * (2.35 - k * 0.25), fg.r * (2.35 - k * 0.25)), mistMat);
        layer.rotation.x = -Math.PI / 2;
        layer.rotation.z = k * 2.1;
        layer.position.y = 8 + k * 9;
        fGroup.add(layer);
      }
      this.mapGroup.add(fGroup);
      this.fogGroups.push(fGroup);
    }

    // 6. Rotating Lighthouse Tower
    if (map.lighthouse) {
      const lh = map.lighthouse;
      const lg = new THREE.Group();
      lg.position.set(lh.x, 0, lh.y);

      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(11, 16, 78, 16),
        new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.55 })
      );
      tower.position.y = 39;
      tower.castShadow = true;
      lg.add(tower);

      const stripe = new THREE.Mesh(
        new THREE.CylinderGeometry(12.8, 14.5, 22, 16),
        new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.55 })
      );
      stripe.position.y = 42;
      lg.add(stripe);

      const lantern = new THREE.Mesh(
        new THREE.CylinderGeometry(10, 10, 14, 14),
        new THREE.MeshBasicMaterial({ color: '#fde047' })
      );
      lantern.position.y = 84;
      lg.add(lantern);

      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(14, 17, 16),
        new THREE.MeshStandardMaterial({ color: '#b91c1c', roughness: 0.5 })
      );
      roof.position.y = 99;
      lg.add(roof);

      const beamGroup = new THREE.Group();
      beamGroup.position.y = 4.5;
      const beamGeo = new THREE.CircleGeometry(lh.range, 24, -lh.halfAngle, lh.halfAngle * 2);
      beamGeo.rotateX(-Math.PI / 2);
      const beam = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({
          color: '#fef08a',
          transparent: true,
          opacity: 0.16,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      );
      beamGroup.add(beam);
      lg.add(beamGroup);

      this.mapGroup.add(lg);
      this.lighthouseRig = { group: lg, beamGroup };
    }

    // 7. Ambient Embers / Ghost Wisps (clean glowing orbs — NO ugly matchstick birds!)
    if (map.id === 'volkanik_resif') {
      const emberMat = new THREE.MeshBasicMaterial({ color: '#fb923c' });
      for (let i = 0; i < 18; i++) {
        const m = new THREE.Mesh(this._sharedGeo.sphere, emberMat);
        m.scale.setScalar(2.0 + (i % 2));
        const bx = 220 + ((i * 197) % (WORLD_W - 440));
        const bz = 140 + ((i * 131) % (WORLD_H - 280));
        m.position.set(bx, 10 + (i * 19) % 120, bz);
        this.mapGroup.add(m);
        this.ambientSprites.push({ kind: 'ember', mesh: m, bx, bz, phase: i * 0.7 });
      }
    } else if (map.id === 'hayalet_sis') {
      const wispMat = new THREE.MeshBasicMaterial({ color: '#5eead4', transparent: true, opacity: 0.72 });
      for (let i = 0; i < 14; i++) {
        const m = new THREE.Mesh(this._sharedGeo.sphere, wispMat);
        m.scale.setScalar(2.8);
        const bx = 200 + ((i * 211) % (WORLD_W - 400));
        const bz = 150 + ((i * 157) % (WORLD_H - 300));
        m.position.set(bx, 28, bz);
        this.mapGroup.add(m);
        this.ambientSprites.push({ kind: 'wisp', mesh: m, bx, bz, phase: i * 1.1 });
      }
    }
  }

  // ============================================================
  // 🚢 6 DISTINCT 3D CHARACTERS (Real Kenney GLB Ships + Smooth Marine Creatures!)
  // ============================================================
  _createCharRig(charId, hullHex, roleHex, hasCustomSkin = false) {
    const root = new THREE.Group();

    // Subtle crisp role ring right on the water surface for competitive clarity
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(21, 23.8, 32),
      new THREE.MeshBasicMaterial({ color: roleHex, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 2.0;
    root.add(ring);

    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(28, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.24, depthWrite: false })
    );
    shield.position.y = 14;
    shield.visible = false;
    root.add(shield);

    const aura = new THREE.Mesh(
      new THREE.RingGeometry(27, 32, 32),
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 2.2;
    aura.visible = false;
    root.add(aura);

    const body = new THREE.Group();
    root.add(body);

    const skinTint = hasCustomSkin ? hullHex : null;
    let animParts = {};

    if (charId === 'kaptan' && this.models.shipPirate) {
      // ⚓ KAPTAN KARA — Real Kenney Pirate Galleon GLB!
      const glb = this._cloneGLB('shipPirate', 66, -3, Math.PI / 2, skinTint);
      if (glb) body.add(glb);
    } else if (charId === 'hayalet' && this.models.shipGhost) {
      // 👻 SİS HAYALETİ — Real Kenney Ghost Ship GLB!
      const glb = this._cloneGLB('shipGhost', 66, -3, Math.PI / 2, skinTint || '#67e8f9');
      if (glb) body.add(glb);
    } else if (charId === 'fenerci' && this.models.boatTug) {
      // 🔦 FENERCİ — Real Kenney Lighthouse Tender Tugboat GLB + Glowing Beacon!
      const glb = this._cloneGLB('boatTug', 56, -2, Math.PI / 2, skinTint);
      if (glb) body.add(glb);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(4.5, 10, 8), new THREE.MeshBasicMaterial({ color: '#fde047' }));
      lamp.position.set(2, 39, 0);
      body.add(lamp);
      animParts.lamp = lamp;
    } else if (charId === 'dalgabinici' && this.models.boatSpeed) {
      // 🌊 DALGA BİNİCİSİ — Real Kenney Racing Speedboat GLB!
      const glb = this._cloneGLB('boatSpeed', 54, -2, Math.PI / 2, skinTint);
      if (glb) body.add(glb);
    } else if (charId === 'kopekbaligi') {
      // 🦈 KÖPEKBALIĞI — Smooth Glossy Wet-Skin Great White Shark!
      const sharkMat = new THREE.MeshStandardMaterial({
        color: hullHex,
        roughness: 0.25,
        metalness: 0.12
      });
      const torso = new THREE.Mesh(this._sharedGeo.sharkBody, sharkMat);
      torso.position.set(2, 7, 0);
      torso.castShadow = true;
      body.add(torso);

      const eyeMat = new THREE.MeshBasicMaterial({ color: '#fef08a' });
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(1.8, 8, 8), eyeMat);
        eye.position.set(17.5, 9.8, s * 5.6);
        body.add(eye);
      }

      const dorsal = new THREE.Mesh(new THREE.ConeGeometry(4.5, 18, 8), sharkMat);
      dorsal.position.set(1, 17.5, 0);
      dorsal.rotation.z = 0.34;
      dorsal.scale.set(1.2, 1, 0.4);
      dorsal.castShadow = true;
      body.add(dorsal);

      for (const s of [-1, 1]) {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(5.2, 15, 8), sharkMat);
        fin.position.set(5, 5.5, s * 12.5);
        fin.rotation.x = s * Math.PI * 0.45;
        fin.rotation.z = 0.45;
        fin.scale.set(0.7, 1, 0.32);
        body.add(fin);
      }

      const tailGroup = new THREE.Group();
      tailGroup.position.set(-15, 7, 0);
      const tailTop = new THREE.Mesh(new THREE.ConeGeometry(4.4, 16, 8), sharkMat);
      tailTop.position.set(-6, 5.5, 0);
      tailTop.rotation.z = 0.7;
      tailTop.scale.set(0.8, 1, 0.32);
      tailGroup.add(tailTop);
      const tailBot = new THREE.Mesh(new THREE.ConeGeometry(3.6, 12, 8), sharkMat);
      tailBot.position.set(-5, -3.5, 0);
      tailBot.rotation.z = 2.3;
      tailBot.scale.set(0.8, 1, 0.32);
      tailGroup.add(tailBot);
      body.add(tailGroup);
      animParts.tail = tailGroup;
    } else if (charId === 'ahtapot') {
      // 🐙 AHTAPOT — Smooth Glossy Octopus with 6 Waving Curved Tentacles!
      const octoMat = new THREE.MeshStandardMaterial({
        color: hullHex,
        roughness: 0.28,
        metalness: 0.1
      });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(14.5, 18, 14), octoMat);
      dome.scale.set(1.15, 0.94, 0.98);
      dome.position.set(3, 13.5, 0);
      dome.castShadow = true;
      body.add(dome);

      const eyeMat = new THREE.MeshBasicMaterial({ color: '#fef08a' });
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(3.2, 10, 10), eyeMat);
        eye.position.set(14.5, 14.5, s * 6.5);
        body.add(eye);
      }

      animParts.tentacles = [];
      for (let k = 0; k < 6; k++) {
        const a = ((k - 2.5) / 5.5) * Math.PI * 1.2;
        const tg = new THREE.Group();
        tg.position.set(-3, 7, 0);
        tg.rotation.y = a;
        const arm = new THREE.Mesh(this._sharedGeo.tentacle, octoMat);
        arm.castShadow = true;
        tg.add(arm);
        body.add(tg);
        animParts.tentacles.push({ group: tg, baseA: a, idx: k });
      }
    } else {
      // Smooth clean temporary hull during initial ~100ms GLB preload
      const tmp = new THREE.Mesh(
        new THREE.ConeGeometry(12, 38, 12),
        new THREE.MeshStandardMaterial({ color: hullHex, roughness: 0.45 })
      );
      tmp.rotation.z = -Math.PI / 2;
      tmp.position.y = 8;
      body.add(tmp);
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
      hasCustomSkin,
      modelsReady: this.modelsReady,
      diveY: 0
    };
  }

  _createKrakenRig() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#9333ea', roughness: 0.3, metalness: 0.15 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(36, 18, 14), bodyMat);
    head.scale.set(1, 0.92, 1);
    head.position.y = 24;
    head.castShadow = true;
    g.add(head);

    const eyeMat = new THREE.MeshBasicMaterial({ color: '#fde047' });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(6.8, 10, 8), eyeMat);
      eye.position.set(s * 14, 30, 28);
      g.add(eye);
    }

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(48, 54, 36),
      new THREE.MeshBasicMaterial({ color: '#d946ef', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 2.0;
    g.add(ring);

    const tentacles = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const tg = new THREE.Group();
      tg.rotation.y = a;
      const arm = new THREE.Mesh(new THREE.ConeGeometry(8.5, 68, 10), bodyMat);
      arm.position.set(52, 24, 0);
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
      metalness: 0.85,
      roughness: 0.18
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(14, 12, 10, 14), goldMat);
    base.position.y = 23;
    g.add(base);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(4, 13, 8), goldMat);
      spike.position.set(Math.cos(a) * 11, 32, Math.sin(a) * 11);
      g.add(spike);
    }
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(12, 22, 145, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
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
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
      );
      const sz = 2.4 + Math.random() * 3.4;
      m.scale.setScalar(sz);
      m.position.set(x, 7 + Math.random() * 6, z);
      this.fxGroup.add(m);
      this.particles.push({
        mesh: m,
        vx: Math.cos(a) * spd,
        vy: upBoost + Math.random() * 70,
        vz: Math.sin(a) * spd,
        gravity: 240,
        life: 0.44 + Math.random() * 0.25,
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
        new THREE.MeshBasicMaterial({ color: '#f1f5f9', transparent: true, opacity: 0.55, depthWrite: false })
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
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false })
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

  _spawnVWake(x, z, aim) {
    if (this.particles.length >= 145) return;
    // Silky feathered seafoam wake planes (NO overlapping hard grey circles!)
    for (const side of [-1, 1]) {
      const a = aim + Math.PI + side * 0.42;
      const m = new THREE.Mesh(
        this._sharedGeo.plane,
        new THREE.MeshBasicMaterial({ map: this.mistTex, color: '#e6f9ff', transparent: true, opacity: 0.42, depthWrite: false })
      );
      m.scale.setScalar(18);
      m.position.set(x - Math.cos(aim) * 18 + Math.cos(a) * 8, 1.85, z - Math.sin(aim) * 18 + Math.sin(a) * 8);
      this.fxGroup.add(m);
      this.particles.push({
        mesh: m,
        vx: Math.cos(a) * 26,
        vy: 0,
        vz: Math.sin(a) * 26,
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
    const sinkRig = this._createCharRig(p.charId, hullHex, roleHex, Boolean(skin.hull));
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
        pt.mesh.material.opacity = ratio * 0.75;
      } else if (pt.kind === 'foam') {
        pt.mesh.position.x += pt.vx * dt;
        pt.mesh.position.z += pt.vz * dt;
        const sc = 18 + (1 - ratio) * 24;
        pt.mesh.scale.setScalar(sc);
        pt.mesh.material.opacity = ratio * 0.36;
      } else if (pt.kind === 'smoke') {
        pt.mesh.position.x += pt.vx * dt;
        pt.mesh.position.y += pt.vy * dt;
        pt.mesh.position.z += pt.vz * dt;
        const sc = 6 + (1 - ratio) * 11;
        pt.mesh.scale.setScalar(sc);
        pt.mesh.material.opacity = ratio * 0.52;
      } else {
        pt.vy -= pt.gravity * dt;
        pt.mesh.position.x += pt.vx * dt;
        pt.mesh.position.y = Math.max(1.5, pt.mesh.position.y + pt.vy * dt);
        pt.mesh.position.z += pt.vz * dt;
        pt.mesh.material.opacity = ratio;
      }
    }

    for (let i = this.sinkingRigs.length - 1; i >= 0; i--) {
      const sr = this.sinkingRigs[i];
      sr.life -= dt;
      if (sr.life <= 0) {
        this.fxGroup.remove(sr.rig.root);
        this.sinkingRigs.splice(i, 1);
        continue;
      }
      const prog = 1 - sr.life / sr.maxLife;
      sr.rig.body.position.y = -prog * 36;
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
    if (this.currentMapId !== map.id || this._needsMapRebuild) {
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

    // Update GPU PBR Ocean Shader uniforms
    const fogDens = state.roundEvent === 'gece_sisi' ? 0.00088 : 0.0003;
    this.scene.fog.density = fogDens;
    this.oceanUniforms.uTime.value = this.time;
    this.oceanUniforms.uFogDensity.value = fogDens;

    // Mercan Plajı surf
    if (this.beachSurfMesh) {
      this.beachSurfMesh.mesh.position.z = this.beachSurfMesh.baseZ + Math.sin(this.time * 2.4) * 6;
      this.beachSurfMesh.mesh.material.opacity = 0.38 + Math.sin(this.time * 2.4) * 0.18;
    }

    // Smooth scrolling translucent currents
    for (const cp of this.currentPlanes) {
      cp.tex.offset.x = -(this.time * cp.speed) % 1;
    }

    // Slowly swirl soft mist clouds
    for (let i = 0; i < this.fogGroups.length; i++) {
      const fg = this.fogGroups[i];
      if (fg.children[0]) fg.children[0].rotation.z += dt * 0.06;
      if (fg.children[1]) fg.children[1].rotation.z -= dt * 0.04;
    }

    // Animate ambient wisps/embers
    for (const sp of this.ambientSprites) {
      if (sp.kind === 'ember') {
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
        this.lightningAlpha = 0.2;
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

      const wasAlive = this.prevAlive.get(p.id);
      if (wasAlive === true && !p.alive) this._spawnSinkingVessel(p, sp);
      this.prevAlive.set(p.id, Boolean(p.alive));

      const wasSub = this.prevSubmerged.get(p.id);
      if (p.alive && wasSub !== undefined && wasSub !== Boolean(p.submerged)) {
        if (this._canViewerSee(me, p, map, state.roundEvent) || p.id === myId) {
          this._spawnBurst(sp.x, sp.y, '#e0f2fe', 10, 75, 95);
          this._spawnShockRing(sp.x, sp.y, p.submerged ? '#38bdf8' : '#ffd166', 10, p.submerged ? 55 : 75, 0.45);
        }
      }
      this.prevSubmerged.set(p.id, Boolean(p.submerged));

      const curTot = (p.hp || 0) + (p.breath || 0) + (p.shield || 0);
      const prevTot = this.prevHpTotal.get(p.id);
      if (p.alive && prevTot !== undefined && prevTot - curTot >= 8) {
        this.hitFlash.set(p.id, 0.16);
        this._spawnBurst(sp.x, sp.y, '#ffd166', 7, 100);
        if (p.id === myId) this.triggerShake(Math.min(10, (prevTot - curTot) * 0.12));
      }
      this.prevHpTotal.set(p.id, curTot);

      if (p.alive && !p.submerged && Math.hypot(p.vx || 0, p.vy || 0) > 42 && Math.random() < dt * 12) {
        this._spawnVWake(sp.x, sp.y, sp.aim);
      }
    }

    for (const [id, hf] of this.hitFlash.entries()) {
      if (hf - dt <= 0) this.hitFlash.delete(id);
      else this.hitFlash.set(id, hf - dt);
    }

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

    // Smooth follow camera
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
    const wantH = this.camMode === 'sinematik' ? (isNarrow ? 390 : 300) : (isNarrow ? 590 : 465);
    const wantB = this.camMode === 'sinematik' ? (isNarrow ? 470 : 405) : (isNarrow ? 420 : 335);
    this._curCamH += (wantH - this._curCamH) * Math.min(1, dt * 6);
    this._curCamB += (wantB - this._curCamB) * Math.min(1, dt * 6);

    this.camera.position.set(this.camX + sxOff, this._curCamH, this.camY + this._curCamB + szOff);
    this.camera.lookAt(this.camX + sxOff * 0.4, 8, this.camY + 10 + szOff * 0.4);

    this.sunLight.position.set(this.camX + 360, 740, this.camY + 260);
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

    this.renderer.render(this.scene, this.camera);
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
      if (!rig || rig.charId !== p.charId || rig.hullHex !== hullHex || rig.roleHex !== roleHex || rig.modelsReady !== this.modelsReady) {
        if (rig) this.dynamicGroup.remove(rig.root);
        rig = this._createCharRig(p.charId, hullHex, roleHex, Boolean(skin.hull));
        this.dynamicGroup.add(rig.root);
        this.playerRigs.set(p.id, rig);
      }

      const sp = this.smoothPos.get(p.id) || p;
      rig.root.visible = true;
      rig.root.position.set(sp.x, 0, sp.y);

      const targetY = p.submerged ? -16 : (Math.sin(this.time * 3.8 + sp.x * 0.02) * 1.6);
      rig.diveY += (targetY - rig.diveY) * 0.22;
      rig.body.position.y = rig.diveY;
      rig.body.rotation.y = -sp.aim;

      const spd = Math.hypot(p.vx || 0, p.vy || 0);
      rig.body.rotation.x = Math.sin(this.time * 4.5 + sp.y * 0.02) * 0.05;
      rig.body.rotation.z = Math.min(0.14, spd * 0.00045);

      if (rig.animParts.tail) rig.animParts.tail.rotation.y = Math.sin(this.time * (8 + spd * 0.035)) * 0.44;
      if (rig.animParts.tentacles) {
        for (const t of rig.animParts.tentacles) {
          t.group.rotation.y = t.baseA + Math.sin(this.time * 5 + t.idx) * 0.24;
          t.group.rotation.z = Math.cos(this.time * 4 + t.idx) * 0.18;
        }
      }

      rig.shield.visible = (p.shield || 0) > 0 || (p.mirrorTimer || 0) > 0;
      if (rig.shield.visible) rig.shield.material.color.set(p.mirrorTimer > 0 ? '#e0f2fe' : '#38bdf8');
      rig.aura.visible = Boolean(p.hasCrown || p.bounty);
      if (rig.aura.visible) rig.aura.scale.setScalar(1 + Math.sin(this.time * 7) * 0.08);

      const hf = this.hitFlash.get(p.id) || 0;
      rig.body.traverse((obj) => {
        if (obj.isMesh && obj.material && obj.material.emissive) {
          if (hf > 0) {
            obj.material.emissive.set('#ffffff');
            obj.material.emissiveIntensity = 0.85;
          } else {
            obj.material.emissive.set('#000000');
            obj.material.emissiveIntensity = 0;
          }
        }
      });

      if (me && p.id === me.id) {
        if (p.submerged) {
          showDiveRing = true;
          this.diveRingMesh.position.set(sp.x, 2.5, sp.y);
          this.diveRingMesh.material.color.set(p.diveTime >= 1.0 ? '#ffd166' : '#38bdf8');
        } else {
          const it0 = p.items?.[0];
          const maxR = (it0 && it0.usesLeft > 0 && ALL_ITEMS[it0.id]?.range) ? Math.min(310, ALL_ITEMS[it0.id].range * 0.5) : 135;
          // Clip aim laser cleanly at rocks/ships so it never pierces through solid islands!
          let range = maxR;
          const cosA = Math.cos(sp.aim);
          const sinA = Math.sin(sp.aim);
          for (let d = 28; d <= maxR; d += 14) {
            const tx = sp.x + cosA * d;
            const ty = sp.y + sinA * d;
            let hit = false;
            for (const obs of map.rocks || []) {
              if (obs.type === 'rock') {
                if (dist(tx, ty, obs.x, obs.y) <= obs.r + 3) { hit = true; break; }
              } else if (tx >= obs.x && tx <= obs.x + obs.w && ty >= obs.y && ty <= obs.y + obs.h) {
                hit = true; break;
              }
            }
            if (hit) { range = d; break; }
          }
          showAim = true;
          this.aimGuideMesh.position.set(sp.x, 2.3, sp.y);
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
        rig = this._createCharRig(d.charId, ch.color, d.role === 'hunter' ? '#ffb703' : '#06d6a0', false);
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
            new THREE.CylinderGeometry(2.4, 3.6, 28, 8),
            new THREE.MeshBasicMaterial({ color: col })
          );
          head.rotation.z = Math.PI / 2;
        } else if (pr.kind === 'net' || pr.kind === 'electric_net') {
          head = new THREE.Mesh(
            new THREE.TorusGeometry(12, 2.6, 8, 16),
            new THREE.MeshBasicMaterial({ color: col })
          );
          head.rotation.x = Math.PI / 2;
        } else {
          head = new THREE.Mesh(
            new THREE.SphereGeometry(pr.r ? pr.r * 1.05 : 7, 10, 8),
            new THREE.MeshBasicMaterial({ color: col })
          );
        }
        g.add(head);

        const trailLen = pr.firearm ? 56 : 34;
        const trail = new THREE.Mesh(
          new THREE.ConeGeometry(pr.firearm ? 5.0 : 3.6, trailLen, 8),
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
        const glb = this._cloneGLB('barrel', 18.5, -1, (b.id * 1.3) % 6.28, '#b91c1c');
        if (glb) {
          g.add(glb);
        } else {
          const fb = new THREE.Mesh(
            new THREE.CylinderGeometry(8.5, 8.5, 16, 12),
            new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.55 })
          );
          fb.position.y = 8;
          g.add(fb);
        }
        const fuse = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 8), new THREE.MeshBasicMaterial({ color: '#fde047' }));
        fuse.position.y = 18.5;
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
        const spinWrap = new THREE.Group();
        const glb = this._cloneGLB('chest', 20, 3, 0, null);
        if (glb) {
          spinWrap.add(glb);
        } else {
          const fb = new THREE.Mesh(
            new THREE.BoxGeometry(15, 11, 11),
            new THREE.MeshStandardMaterial({ color: col, roughness: 0.4 })
          );
          fb.position.y = 9;
          spinWrap.add(fb);
        }
        g.add(spinWrap);

        const ring = new THREE.Mesh(
          new THREE.RingGeometry(15, 18.2, 28),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 2.0;
        g.add(ring);

        this.dynamicGroup.add(g);
        this.powerupMeshes.set(pu.id, g);
        m = g;
      }
      m.position.set(pu.x, Math.sin(this.time * 3.5 + pu.id) * 3.2, pu.y);
      m.children[0].rotation.y = this.time * 1.4;
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
        const g = new THREE.Group();
        const rad = br.r || 28;
        // Real crossed wooden pirate palisade barricade (NOT giant rum bottles!)
        const glb1 = this._cloneGLB('barricade', rad * 1.7, -2, (br.id * 1.1) % 6.28);
        const glb2 = this._cloneGLB('barricade', rad * 1.7, -2, ((br.id * 1.1) + Math.PI / 2) % 6.28);
        if (glb1) {
          g.add(glb1);
          if (glb2) g.add(glb2);
        } else {
          const fb = new THREE.Mesh(
            new THREE.BoxGeometry(rad * 1.4, 22, rad * 1.4),
            new THREE.MeshStandardMaterial({ color: '#92400e', roughness: 0.8 })
          );
          fb.position.y = 11;
          g.add(fb);
        }
        this.dynamicGroup.add(g);
        this.breakableMeshes.set(br.id, g);
        m = g;
      }
      const hpRatio = Math.max(0.48, (br.hp || 1) / (br.maxHp || 100));
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
          new THREE.OctahedronGeometry(9.5, 0),
          new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.35 })
        );
        orb.position.y = 6.5;
        g.add(orb);
        const r = new THREE.Mesh(
          new THREE.RingGeometry((tr.r || 38) - 2, tr.r || 38, 28),
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
        let col = '#0f172a';
        let op = 0.72;
        if (z.kind === 'flare') { col = '#fb7185'; op = 0.25; }
        else if (z.kind === 'gravity') { col = '#a855f7'; op = 0.34; }
        else if (z.kind === 'kelp') { col = '#10b981'; op = 0.44; }
        m = new THREE.Mesh(
          new THREE.PlaneGeometry(z.r * 2.25, z.r * 2.25),
          new THREE.MeshBasicMaterial({
            map: this.mistTex,
            color: col,
            transparent: true,
            opacity: op,
            depthWrite: false
          })
        );
        m.rotation.x = -Math.PI / 2;
        this.dynamicGroup.add(m);
        this.zoneMeshes.set(z.id, m);
      }
      m.position.set(z.x, z.kind === 'ink' ? 10 : 2.3, z.y);
      if (z.kind === 'gravity' || z.kind === 'ink') m.rotation.z += 0.025;
    }
    for (const [id, m] of this.zoneMeshes.entries()) {
      if (!seen.has(id)) {
        this.dynamicGroup.remove(m);
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
        const glb = this._cloneGLB('buoy', 38, -2, 0);
        if (glb) {
          g.add(glb);
        } else {
          const torus = new THREE.Mesh(
            new THREE.TorusGeometry(13.5, 4.2, 10, 20),
            new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.35 })
          );
          torus.rotation.x = Math.PI / 2;
          torus.position.y = 5.5;
          g.add(torus);
        }
        const ring = new THREE.Mesh(
          new THREE.RingGeometry((rb.r || 66) - 3, rb.r || 66, 32),
          new THREE.MeshBasicMaterial({ color: '#06d6a0', transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 2.0;
        g.add(ring);
        this.dynamicGroup.add(g);
        this.buoyMeshes.set(rb.id, g);
        m = g;
      }
      m.position.set(rb.x, Math.sin(this.time * 4) * 1.8, rb.y);
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
          new THREE.RingGeometry(gz.r - 4, gz.r, 28),
          new THREE.MeshBasicMaterial({ color: '#ff6b35', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 2.0;
        g.add(ring);
        const col = new THREE.Mesh(
          new THREE.CylinderGeometry(gz.r * 0.55, gz.r * 0.78, 95, 14),
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
      const innerR = Math.min(this.viewW, this.viewH) * (isNight ? 0.26 : 0.44);
      const outerR = Math.max(this.viewW, this.viewH) * (isNight ? 0.64 : 0.84);
      const vig = ctx.createRadialGradient(center.x, center.y, innerR, center.x, center.y, outerR);
      vig.addColorStop(0, 'rgba(2, 10, 20, 0)');
      vig.addColorStop(1, isNight ? 'rgba(1, 6, 14, 0.72)' : 'rgba(2, 10, 20, 0.26)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }

    // 0b. ⛈️ Fırtına Boğazı animated rain & subtle lightning
    if (map.id === 'firtina_bogazi') {
      ctx.save();
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.14)';
      ctx.lineWidth = 1.1;
      const t = this.time * 540;
      const drops = this.viewW < 640 ? 24 : 42;
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
      const scr = this._worldToScreen(sp.x, p.submerged ? 14 : 52, sp.y);
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
      const scr = this._worldToScreen(rb.x, 34, rb.y);
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
      const scr = this._worldToScreen(ft.x, 42 + (1 - ft.life / ft.maxLife) * 24, ft.y);
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
    this.mistTex?.dispose?.();
    this.currentTex?.dispose?.();
    this._envRT?.dispose?.();
    this.renderer.dispose();
  }
}
