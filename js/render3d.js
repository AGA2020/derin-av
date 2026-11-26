// İKİ İTEMLİ OYUN — Studio-Grade 3D Maritime Renderer v7.0
// Real Kenney CC0 .glb 3D models, PBR RoomEnvironment IBL, Fresnel + Caustics Ocean Shader,
// Per-Map Sky Dome, 3-Tier Live Graphics Quality (Performans / Dengeli / Ultra),
// Waving 3D Ship Flags & Lanterns, Dynamic Explosion PointLight, Signature Item VFX
// (Grapple Rope, 3D Whirlpool, Electric Arcs, Crystal Mirror Dome), Floating Wreckage & Speed FOV!

import * as THREE from '../vendor/three.module.min.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { WORLD_W, WORLD_H, CHAR_MAP, ALL_ITEMS, POWERUP_MAP, BOAT_SKIN_MAP, SEA_MAPS } from './data.js?v=8.0';
import { hasLineOfSight } from './sim.js?v=8.0';

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
  uniform float uCaustics;

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

    // Sunlit shallow-water Caustics shimmer (zero extra draw calls!)
    if (uCaustics > 0.01) {
      float c1 = noise(vWorldPos.xz * 0.048 + vec2(uTime * 0.35, uTime * 0.24));
      float c2 = noise(vWorldPos.xz * 0.062 - vec2(uTime * 0.28, -uTime * 0.31));
      float caust = smoothstep(0.58, 0.88, 1.0 - abs(c1 - c2) * 2.1);
      float shallowMask = 1.0 - smoothstep(0.15, 0.95, dEdge);
      waterCol += uShallowColor * caust * shallowMask * uCaustics * 0.42;
    }

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
// ☀️ PER-MAP GRADIENT 3D SKY DOME SHADER (Horizon Glow, Sun/Moon & Soft Clouds!)
// ============================================================
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform float uTime;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y * 1.45, 0.0, 1.0);
    vec3 col = mix(uSkyHorizon, uSkyTop, pow(h, 0.55));
    // Soft sun / moon halo in sky
    float sunAmt = max(0.0, dot(d, normalize(uSunDir)));
    col += uSunCol * (pow(sunAmt, 14.0) * 0.35 + pow(sunAmt, 180.0) * 0.95);
    // Gentle horizon cloud wisps
    if (d.y > 0.02) {
      vec2 uv = d.xz / (d.y + 0.25) * 1.6 + vec2(uTime * 0.015, uTime * 0.008);
      float cl = smoothstep(0.48, 0.82, noise(uv) * 0.65 + noise(uv * 2.3) * 0.35);
      col = mix(col, mix(uSkyHorizon, vec3(1.0), 0.38), cl * smoothstep(0.02, 0.28, d.y) * 0.32);
    }
    gl_FragColor = vec4(col, 1.0);
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

// Soft radial additive glow texture (lightweight zero-FPS-cost "Bloom" for shots, beacons & chests!)
function createGlowTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  g.addColorStop(0.28, 'rgba(255, 255, 255, 0.55)');
  g.addColorStop(0.65, 'rgba(255, 255, 255, 0.14)');
  g.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// Soft underwater contact blob shadow so boats, barrels & chests sit solidly in the ocean
function createContactShadowTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
  g.addColorStop(0.0, 'rgba(1, 10, 22, 0.56)');
  g.addColorStop(0.55, 'rgba(1, 10, 22, 0.24)');
  g.addColorStop(1.0, 'rgba(1, 10, 22, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// Animated organic shoreline foam ring texture (breaks gently around every island rock!)
function createShoreFoamTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  ctx.translate(128, 128);
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    const baseR = pass === 0 ? 86 : 98;
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const wobble = Math.sin(a * 7 + pass * 2.1) * 5 + Math.cos(a * 11 - pass) * 3;
      const r = baseR + wobble;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = pass === 0 ? 'rgba(232, 250, 255, 0.72)' : 'rgba(186, 236, 255, 0.32)';
    ctx.lineWidth = pass === 0 ? 7.5 : 13;
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// Sleek feathered directional wake streak texture for crisp V-wakes & bow spray
function createWakeStreakTexture() {
  const w = 128, h = 64;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(w * 0.55, h * 0.5, 4, w * 0.5, h * 0.5, w * 0.48);
  g.addColorStop(0.0, 'rgba(240, 252, 255, 0.85)');
  g.addColorStop(0.42, 'rgba(205, 242, 255, 0.44)');
  g.addColorStop(1.0, 'rgba(180, 235, 255, 0.0)');
  ctx.save();
  ctx.scale(1.0, 0.46);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 1.08, w * 0.46, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// Sleek glowing tactical dashed-arrow aim sight texture
function createAimSightTexture() {
  const w = 256, h = 32;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.0)');
  grad.addColorStop(0.15, 'rgba(255, 255, 255, 0.72)');
  grad.addColorStop(0.82, 'rgba(255, 255, 255, 0.88)');
  grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = grad;
  // Crisp tapered dashes
  for (let x = 18; x < w - 34; x += 26) {
    ctx.beginPath();
    ctx.roundRect(x, 12.5, 15, 7, 3.5);
    ctx.fill();
  }
  // Sleek arrowhead at tip
  ctx.beginPath();
  ctx.moveTo(w - 28, 6);
  ctx.lineTo(w - 6, 16);
  ctx.lineTo(w - 28, 26);
  ctx.lineTo(w - 21, 16);
  ctx.closePath();
  ctx.fill();
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

// Procedural weathered sea-cliff stone albedo + bump texture (replaces flat 1-pixel clay!)
function createStoneTextures() {
  const s = 256;
  const colCanvas = document.createElement('canvas');
  colCanvas.width = s; colCanvas.height = s;
  const cctx = colCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = s; bumpCanvas.height = s;
  const bctx = bumpCanvas.getContext('2d');

  // Base warm neutral stone canvas (tinted via vertexColors per map/height!)
  cctx.fillStyle = '#dcd7cc';
  cctx.fillRect(0, 0, s, s);
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, s, s);

  // Horizontal weathered geological strata bands
  for (let y = 0; y < s; y += 14) {
    const shade = 205 + ((y * 37) % 38);
    cctx.fillStyle = `rgba(${shade}, ${shade - 4}, ${shade - 10}, 0.28)`;
    cctx.fillRect(0, y, s, 6 + (y % 5));
    const bShade = 100 + ((y * 53) % 60);
    bctx.fillStyle = `rgba(${bShade}, ${bShade}, ${bShade}, 0.35)`;
    bctx.fillRect(0, y, s, 5 + (y % 4));
  }

  // Organic mineral speckles, pockmarks & micro-cracks
  let seed = 1337;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 480; i++) {
    const x = rand() * s;
    const y = rand() * s;
    const rx = 2 + rand() * 8;
    const ry = 1.5 + rand() * 5;
    const dark = rand() < 0.55;
    cctx.fillStyle = dark ? 'rgba(62, 58, 52, 0.16)' : 'rgba(255, 250, 240, 0.18)';
    cctx.beginPath();
    cctx.ellipse(x, y, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
    cctx.fill();

    bctx.fillStyle = dark ? 'rgba(40, 40, 40, 0.35)' : 'rgba(220, 220, 220, 0.32)';
    bctx.beginPath();
    bctx.ellipse(x, y, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
    bctx.fill();
  }

  // Subtle dark rock crevices / fractures
  cctx.strokeStyle = 'rgba(45, 42, 38, 0.24)';
  bctx.strokeStyle = 'rgba(20, 20, 20, 0.65)';
  cctx.lineWidth = 1.5;
  bctx.lineWidth = 2.0;
  for (let i = 0; i < 22; i++) {
    let cx = rand() * s;
    let cy = rand() * s;
    cctx.beginPath(); bctx.beginPath();
    cctx.moveTo(cx, cy); bctx.moveTo(cx, cy);
    for (let k = 0; k < 4; k++) {
      cx += (rand() - 0.5) * 34;
      cy += (rand() - 0.5) * 20;
      cctx.lineTo(cx, cy); bctx.lineTo(cx, cy);
    }
    cctx.stroke(); bctx.stroke();
  }

  const mapTex = new THREE.CanvasTexture(colCanvas);
  mapTex.wrapS = THREE.RepeatWrapping;
  mapTex.wrapT = THREE.RepeatWrapping;
  mapTex.colorSpace = THREE.SRGBColorSpace;

  const bumpTex = new THREE.CanvasTexture(bumpCanvas);
  bumpTex.wrapS = THREE.RepeatWrapping;
  bumpTex.wrapT = THREE.RepeatWrapping;

  return { mapTex, bumpTex };
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

// Distinct per-map lighting, sun angle, sky dome, caustics & ocean palettes!
const MAP_PALETTES = {
  firtina_bogazi: {
    sunCol: '#cfe9ff', sunInt: 1.95, hemiSky: '#93c5fd', hemiGround: '#0a3352',
    deep: '#0a2b4a', shallow: '#155e8a', sky: '#528db8', bg: '#09233d', lagoon: '#38bdf8',
    sunDir: [0.35, 0.72, 0.55], fogDens: 0.00036, skyTop: '#0b1e36', skyHorizon: '#234a6b', caustics: 0.25
  },
  korsan_enkazi: {
    sunCol: '#ffd89b', sunInt: 2.45, hemiSky: '#fde68a', hemiGround: '#16425b',
    deep: '#0d314d', shallow: '#1b6d8f', sky: '#d4956a', bg: '#162d42', lagoon: '#5eead4',
    sunDir: [0.68, 0.45, -0.35], fogDens: 0.00028, skyTop: '#1c2b4a', skyHorizon: '#c97b52', caustics: 0.48
  },
  akinti_koyu: {
    sunCol: '#fffbeb', sunInt: 2.4, hemiSky: '#bae6fd', hemiGround: '#0e6178',
    deep: '#07405e', shallow: '#1298b3', sky: '#86dcf5', bg: '#0a3b54', lagoon: '#2dd4bf',
    sunDir: [0.45, 0.85, 0.3], fogDens: 0.00025, skyTop: '#16659e', skyHorizon: '#67d2eb', caustics: 0.82
  },
  mercan_plaji: {
    sunCol: '#fff7d6', sunInt: 2.7, hemiSky: '#e0fbff', hemiGround: '#168a91',
    deep: '#0b5878', shallow: '#19bdd1', sky: '#9beaf7', bg: '#0f5675', lagoon: '#67f5e0',
    sunDir: [0.3, 0.92, 0.25], fogDens: 0.00022, skyTop: '#1e88c9', skyHorizon: '#8be9f5', caustics: 1.0
  },
  volkanik_resif: {
    sunCol: '#ffad66', sunInt: 2.35, hemiSky: '#fdba74', hemiGround: '#541b14',
    deep: '#210e15', shallow: '#6b221e', sky: '#cc5b33', bg: '#1c0d12', lagoon: '#fb923c',
    sunDir: [-0.55, 0.48, 0.45], fogDens: 0.00034, skyTop: '#240c14', skyHorizon: '#9c341d', caustics: 0.15
  },
  hayalet_sis: {
    sunCol: '#a7f3d0', sunInt: 1.85, hemiSky: '#6ee7b7', hemiGround: '#072e2d',
    deep: '#051f22', shallow: '#0e5955', sky: '#358c85', bg: '#061c1f', lagoon: '#2dd4bf',
    sunDir: [-0.4, 0.58, -0.5], fogDens: 0.00042, skyTop: '#05191c', skyHorizon: '#1d5452', caustics: 0.28
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
    const savedQ = localStorage.getItem('derinav_gfx_quality');
    this.quality = (savedQ === 'low' || savedQ === 'medium' || savedQ === 'ultra')
      ? savedQ
      : (window.innerWidth < 760 ? 'medium' : 'ultra');
    this._curFov = 42;
    this.maxParticles = 200;
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
    this.ultraDecorGroup = new THREE.Group();
    this.dynamicGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();
    this.scene.add(this.mapGroup);
    this.scene.add(this.ultraDecorGroup);
    this.scene.add(this.dynamicGroup);
    this.scene.add(this.fxGroup);

    // ☀️ Per-Map 3D Sky Dome
    this.skyUniforms = {
      uSkyTop: { value: new THREE.Color('#16659e') },
      uSkyHorizon: { value: new THREE.Color('#67d2eb') },
      uSunDir: { value: new THREE.Vector3(0.45, 0.78, 0.35).normalize() },
      uSunCol: { value: new THREE.Color('#fff4cc') },
      uTime: { value: 0 }
    };
    this.skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(2600, 24, 14),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: this.skyUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false
      })
    );
    this.scene.add(this.skyDome);

    // 💥 Dynamic Explosion PointLight (illuminates surrounding water, rocks & hulls for 0.38s!)
    this.blastLight = new THREE.PointLight('#ff8c38', 0, 340, 1.5);
    this.blastLight.position.set(WORLD_W / 2, 26, WORLD_H / 2);
    this.scene.add(this.blastLight);
    this.blastLightTimer = 0;

    // Soft procedural textures (zero hard plastic rings/blocks!)
    this.mistTex = createSoftMistTexture();
    this.currentTex = createCurrentFlowTexture();
    this.stoneTex = createStoneTextures();
    this.glowTex = createGlowTexture();
    this.shadowTex = createContactShadowTexture();
    this.shoreFoamTex = createShoreFoamTexture();
    this.wakeTex = createWakeStreakTexture();
    this.aimTex = createAimSightTexture();
    this.lagoonTexCache = new Map();
    this._baseSunInt = 2.2;
    this._baseFogDens = 0.00032;
    this._mapCaustics = 0.6;
    this.shorelineRings = [];
    this.horizonBirds = [];
    this.islandFires = [];
    this.debrisPlanks = [];
    this.hookRopes = [];
    this.deepShadow = null;
    this.prevAim = new Map();
    this.shipRecoil = new Map();

    // Real PBR Fresnel + Caustics Ocean Shader
    this.oceanUniforms = {
      uTime: { value: 0 },
      uDeepColor: { value: new THREE.Color('#0c3554') },
      uShallowColor: { value: new THREE.Color('#18759e') },
      uSkyColor: { value: new THREE.Color('#6cb4dc') },
      uSunColor: { value: new THREE.Color('#fff4cc') },
      uSunDir: { value: new THREE.Vector3(0.45, 0.78, 0.35).normalize() },
      uFogColor: { value: new THREE.Color('#0e324d') },
      uFogDensity: { value: 0.00032 },
      uWorldCenter: { value: new THREE.Vector2(WORLD_W / 2, WORLD_H / 2) },
      uCaustics: { value: 0.6 }
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
    this.edgeTentMeshes = new Map();
    this.krakenRig = null;
    this.crownRig = null;
    this.megaChestRig = null;
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
    this.setQuality(this.quality, true);
    this.resize();
    this._loadAllModels();
  }

  // ============================================================
  // 🎚️ LIVE 3-TIER GRAPHICS QUALITY (Performans / Dengeli / Ultra)
  // ============================================================
  setQuality(level, silent = false) {
    const q = (level === 'low' || level === 'medium' || level === 'ultra') ? level : 'ultra';
    this.quality = q;
    if (!silent) {
      try { localStorage.setItem('derinav_gfx_quality', q); } catch (_) {}
    }
    const dpr = window.devicePixelRatio || 1;
    if (q === 'low') {
      this.renderer.setPixelRatio(1.0);
      this.renderer.shadowMap.enabled = false;
      this.sunLight.castShadow = false;
      this.maxParticles = 64;
      this.skyDome.visible = false;
      this.ultraDecorGroup.visible = false;
      this.oceanUniforms.uCaustics.value = 0;
    } else if (q === 'medium') {
      this.renderer.setPixelRatio(Math.min(dpr, 1.3));
      this.renderer.shadowMap.enabled = true;
      this.sunLight.castShadow = true;
      this.maxParticles = 135;
      this.skyDome.visible = true;
      this.ultraDecorGroup.visible = true;
      this.oceanUniforms.uCaustics.value = (this._mapCaustics || 0.5) * 0.65;
    } else {
      this.renderer.setPixelRatio(Math.min(dpr, 1.85));
      this.renderer.shadowMap.enabled = true;
      this.sunLight.castShadow = true;
      this.maxParticles = 220;
      this.skyDome.visible = true;
      this.ultraDecorGroup.visible = true;
      this.oceanUniforms.uCaustics.value = this._mapCaustics || 0.7;
    }
    this.renderer.shadowMap.needsUpdate = true;
    if (this.viewW > 0 && this.viewH > 0) {
      this.renderer.setSize(this.viewW, this.viewH, false);
    }
    return q;
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
      ['grassPatch', './vendor/models/pirate/grass-patch.glb'],
      ['chest', './vendor/models/pirate/chest.glb?v=8.0'],
      ['barrel', './vendor/models/pirate/barrel.glb?v=8.0'],
      ['barricade', './vendor/models/pirate/crate.glb?v=8.0'],
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

  // Apply real weathered stone bump texture + height/slope vertex coloring (wet tide base + stone cliff + moss/sand top!)
  _styleTexturedRock(group, mapId) {
    const palettes = {
      firtina_bogazi: { wet: '#2a3942', mid: '#7d8a96', light: '#b3bdc4', top: '#4b7352', rough: 0.86 },
      korsan_enkazi:  { wet: '#364147', mid: '#9e9788', light: '#d1c8b6', top: '#57854d', rough: 0.84 },
      akinti_koyu:    { wet: '#2c474d', mid: '#a89f8e', light: '#ded5c3', top: '#599153', rough: 0.82 },
      mercan_plaji:   { wet: '#4c6664', mid: '#c4b89f', light: '#eae0ca', top: '#e2c483', rough: 0.8 },
      volkanik_resif: { wet: '#4a1b12', mid: '#3a2a2e', light: '#5c4347', top: '#2b2024', rough: 0.9 },
      hayalet_sis:    { wet: '#1c3333', mid: '#566e6d', light: '#8ea8a4', top: '#3c6e63', rough: 0.88 }
    };
    const p = palettes[mapId] || palettes.korsan_enkazi;
    const cWet = new THREE.Color(p.wet);
    const cMid = new THREE.Color(p.mid);
    const cLight = new THREE.Color(p.light);
    const cTop = new THREE.Color(p.top);
    const tmp = new THREE.Color();

    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const minY = box.min.y;
    const spanY = Math.max(0.01, box.max.y - minY);

    group.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const geo = o.geometry.clone();
      geo.computeVertexNormals();
      const pos = geo.attributes.position;
      const norm = geo.attributes.normal;
      const count = pos.count;

      // Box-projected world-ish UVs so the weathered stone texture wraps cleanly without stretching!
      const uvs = new Float32Array(count * 2);
      const colors = new Float32Array(count * 3);
      const wp = new THREE.Vector3();
      const wn = new THREE.Vector3();
      const normalMat = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);

      for (let i = 0; i < count; i++) {
        wp.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        wn.fromBufferAttribute(norm, i).applyMatrix3(normalMat).normalize();

        const ax = Math.abs(wn.x), ay = Math.abs(wn.y), az = Math.abs(wn.z);
        if (ay >= ax && ay >= az) {
          uvs[i * 2] = wp.x * 0.025;
          uvs[i * 2 + 1] = wp.z * 0.025;
        } else if (ax >= az) {
          uvs[i * 2] = wp.z * 0.025;
          uvs[i * 2 + 1] = wp.y * 0.025;
        } else {
          uvs[i * 2] = wp.x * 0.025;
          uvs[i * 2 + 1] = wp.y * 0.025;
        }

        const h = Math.max(0, Math.min(1, (wp.y - minY) / spanY));
        // Subtle organic strata & rock variation
        const strata = Math.sin(wp.y * 0.24 + wp.x * 0.05) * 0.08;
        if (h < 0.24) {
          // Wet dark tide line where ocean waves hit the base!
          tmp.copy(cWet).lerp(cMid, h / 0.24);
        } else {
          const t = Math.min(1, (h - 0.24) / 0.76 + strata);
          tmp.copy(cMid).lerp(cLight, Math.max(0, t));
        }
        // Upward-facing ledges get natural coastal moss / grass / sand cap!
        if (wn.y > 0.62 && h > 0.32) {
          const capBlend = Math.min(1, (wn.y - 0.62) / 0.28) * Math.min(1, (h - 0.32) / 0.35);
          tmp.lerp(cTop, capBlend * 0.78);
        }
        colors[i * 3] = tmp.r;
        colors[i * 3 + 1] = tmp.g;
        colors[i * 3 + 2] = tmp.b;
      }

      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      o.geometry = geo;
      o.material = new THREE.MeshStandardMaterial({
        map: this.stoneTex.mapTex,
        bumpMap: this.stoneTex.bumpTex,
        bumpScale: 1.8,
        vertexColors: true,
        roughness: p.rough,
        metalness: 0.04,
        envMapIntensity: 0.55
      });
    });
  }

  _getLagoonTex(hexCol) {
    if (!this.lagoonTexCache.has(hexCol)) {
      this.lagoonTexCache.set(hexCol, createSoftLagoonTexture(hexCol, '#e8fbff'));
    }
    return this.lagoonTexCache.get(hexCol);
  }

  _makeGlowSprite(color = '#ffd166', size = 42, opacity = 0.72) {
    const mat = new THREE.SpriteMaterial({
      map: this.glowTex,
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(size, size, 1);
    return sp;
  }

  _makeContactShadow(radius = 28, opacity = 0.65) {
    const m = new THREE.Mesh(
      this._sharedGeo.plane,
      new THREE.MeshBasicMaterial({
        map: this.shadowTex,
        transparent: true,
        opacity,
        depthWrite: false
      })
    );
    m.scale.setScalar(radius * 2);
    m.position.y = 1.75;
    return m;
  }

  toggleCameraMode() {
    this.camMode = this.camMode === 'sinematik' ? 'taktik' : 'sinematik';
    try { localStorage.setItem('derinav_cam3d', this.camMode); } catch (_) {}
    return this.camMode;
  }

  _initPersistentHelpers() {
    const aimGeo = new THREE.PlaneGeometry(1, 13);
    aimGeo.rotateX(-Math.PI / 2);
    aimGeo.translate(0.5, 0, 0);
    this.aimGuideMesh = new THREE.Mesh(
      aimGeo,
      new THREE.MeshBasicMaterial({
        map: this.aimTex,
        color: '#ffd166',
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    this.aimGuideMesh.position.y = 3.2;
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
    this._clearGroup(this.ultraDecorGroup);
    this.currentPlanes = [];
    this.fogGroups = [];
    this.ambientSprites = [];
    this.shorelineRings = [];
    this.horizonBirds = [];
    this.islandFires = [];
    this.deepShadow = null;
    this.beachSurfMesh = null;
    this.lighthouseRig = null;

    const pal = MAP_PALETTES[map.id] || MAP_PALETTES.korsan_enkazi;
    this._baseSunInt = pal.sunInt;
    this._baseFogDens = pal.fogDens || 0.00032;
    this._mapCaustics = pal.caustics ?? 0.5;
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
    const sd = pal.sunDir || [0.45, 0.78, 0.35];
    this.oceanUniforms.uSunDir.value.set(sd[0], sd[1], sd[2]).normalize();
    this.oceanUniforms.uFogColor.value.set(pal.bg);
    this.oceanUniforms.uCaustics.value = this.quality === 'low' ? 0 : (this.quality === 'medium' ? this._mapCaustics * 0.65 : this._mapCaustics);

    // Sync Per-Map 3D Sky Dome
    this.skyUniforms.uSkyTop.value.set(pal.skyTop || pal.bg);
    this.skyUniforms.uSkyHorizon.value.set(pal.skyHorizon || pal.sky);
    this.skyUniforms.uSunDir.value.set(sd[0], sd[1], sd[2]).normalize();
    this.skyUniforms.uSunCol.value.set(pal.sunCol);

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

    // Clean nautical dashed sea boundary + 4 corner sea buoys (NO stray floating yellow pills!)
    const dashTex = (() => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 8;
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(255, 209, 102, 0.55)';
      g.fillRect(4, 1, 30, 6);
      const t = new THREE.CanvasTexture(c);
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    })();
    const addEdge = (bx, bz, len, horiz) => {
      const t = dashTex.clone();
      t.needsUpdate = true;
      t.repeat.set(Math.round(len / 44), 1);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(len, 4.5),
        new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.42, depthWrite: false })
      );
      m.rotation.x = -Math.PI / 2;
      if (!horiz) m.rotation.z = Math.PI / 2;
      m.position.set(bx, 3.0, bz);
      this.mapGroup.add(m);
    };
    addEdge(WORLD_W / 2, 10, WORLD_W - 20, true);
    addEdge(WORLD_W / 2, WORLD_H - 10, WORLD_W - 20, true);
    addEdge(10, WORLD_H / 2, WORLD_H - 20, false);
    addEdge(WORLD_W - 10, WORLD_H / 2, WORLD_H - 20, false);

    // 4 real maritime buoys at arena corners
    for (const [cx, cz] of [[24, 24], [WORLD_W - 24, 24], [24, WORLD_H - 24], [WORLD_W - 24, WORLD_H - 24]]) {
      const cb = this._cloneGLB('buoy', 32, -2, 0);
      if (cb) {
        cb.position.set(cx, 0, cz);
        this.mapGroup.add(cb);
      }
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

        // Soft feathered lagoon + animated breathing shoreline foam ring under every island!
        const shPlane = new THREE.Mesh(new THREE.PlaneGeometry(obs.r * 3.1, obs.r * 3.1), lagoonMat);
        shPlane.rotation.x = -Math.PI / 2;
        shPlane.position.y = 1.65;
        rg.add(shPlane);

        const foamRing = new THREE.Mesh(
          new THREE.PlaneGeometry(obs.r * 2.55, obs.r * 2.55),
          new THREE.MeshBasicMaterial({
            map: this.shoreFoamTex,
            color: map.id === 'volkanik_resif' ? '#fdba74' : '#e6fbff',
            transparent: true,
            opacity: 0.42,
            depthWrite: false
          })
        );
        foamRing.rotation.x = -Math.PI / 2;
        foamRing.rotation.z = rockIdx * 1.1;
        foamRing.position.y = 2.05;
        rg.add(foamRing);
        this.shorelineRings.push({ mesh: foamRing, phase: rockIdx * 1.35 });

        const rockKey = (map.id === 'mercan_plaji' || rockIdx % 3 === 0) ? 'rocksSand' : (rockIdx % 2 === 0 ? 'rocksA' : 'rocksB');
        const glbRock = this._cloneGLB(rockKey, obs.r * 2.15, -4, (obs.x * 0.017 + obs.y * 0.011) % 6.28, null);

        if (glbRock) {
          // Gerçek aşınmış deniz taşı dokusu + ıslak kıyı tabanı + doğal yosun/kum tepe geçişi!
          this._styleTexturedRock(glbRock, map.id);
          rg.add(glbRock);
          // Büyük kayaların tepesine doğal palmiye, kıyı çimi veya hikâye propları (kamp ateşi / lav damarı) serpiştir!
          if (obs.r >= 44 && rockIdx % 2 === 0 && map.id !== 'volkanik_resif' && map.id !== 'hayalet_sis') {
            const islandPalm = this._cloneGLB('palm', 58, obs.r * 0.72, rockIdx * 1.4);
            if (islandPalm) rg.add(islandPalm);
          } else if (obs.r >= 38 && map.id !== 'volkanik_resif') {
            const tuft = this._cloneGLB('grassPatch', 26, obs.r * 0.72, rockIdx * 2.1);
            if (tuft) rg.add(tuft);
          }
          // 🌋 Volkanik Resif: Parlayan sıcak lav damarı parıltısı!
          if (map.id === 'volkanik_resif') {
            const lavaGlow = this._makeGlowSprite('#ff4d00', obs.r * 2.1, 0.44);
            lavaGlow.position.set(0, obs.r * 0.35, 0);
            this.ultraDecorGroup.add(lavaGlow);
            lavaGlow.position.set(obs.x, obs.r * 0.35, obs.y);
          }
          // 🔥 Korsan Enkazı & Fırtına Boğazı: Büyük adalarda titreyen sıcak kamp ateşi / meşale!
          if ((map.id === 'korsan_enkazi' || map.id === 'firtina_bogazi') && obs.r >= 42 && this.islandFires.length < 3) {
            const fg = new THREE.Group();
            fg.position.set(obs.x + obs.r * 0.22, obs.r * 0.76, obs.y - obs.r * 0.14);
            const flame = new THREE.Mesh(
              new THREE.ConeGeometry(4.5, 13, 6),
              new THREE.MeshBasicMaterial({ color: '#fb923c' })
            );
            flame.position.y = 6.5;
            fg.add(flame);
            const core = new THREE.Mesh(
              new THREE.ConeGeometry(2.4, 8, 6),
              new THREE.MeshBasicMaterial({ color: '#fef08a' })
            );
            core.position.y = 4.5;
            fg.add(core);
            const fireGlow = this._makeGlowSprite('#ff8c38', 48, 0.65);
            fireGlow.position.y = 8;
            fg.add(fireGlow);
            this.ultraDecorGroup.add(fg);
            this.islandFires.push({ group: fg, flame, core, glow: fireGlow, phase: rockIdx * 1.9 });
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

      const lanternGlow = this._makeGlowSprite('#fef08a', 76, 0.72);
      lanternGlow.position.y = 84;
      lg.add(lanternGlow);

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

    // 8. 🏝️ Living Horizon Outside Arena (distant rocky islets fading into fog — zero gameplay interference!)
    const distantSpots = [
      [-230, 180, 150], [-270, WORLD_H - 220, 175],
      [WORLD_W + 240, 210, 165], [WORLD_W + 260, WORLD_H - 190, 145],
      [WORLD_W * 0.25, -240, 160], [WORLD_W * 0.78, -230, 180],
      [WORLD_W * 0.35, WORLD_H + 260, 155], [WORLD_W * 0.72, WORLD_H + 240, 170]
    ];
    for (let i = 0; i < distantSpots.length; i++) {
      const [dx, dz, sz] = distantSpots[i];
      if (map.beach && dz < 0) continue; // Keep Mercan Plajı sandy beach clean
      const rk = this._cloneGLB(i % 2 === 0 ? 'rocksA' : 'rocksB', sz, -8, i * 1.7);
      if (rk) {
        this._styleTexturedRock(rk, map.id);
        rk.position.set(dx, 0, dz);
        this.ultraDecorGroup.add(rk);
      }
    }

    // 🪸 Mercan Plajı: Colorful translucent underwater coral reef patches peeking through crystal water!
    if (map.id === 'mercan_plaji') {
      const coralCols = ['#fb7185', '#fb923c', '#c084fc', '#2dd4bf', '#f472b6'];
      for (let i = 0; i < 16; i++) {
        const cx = 130 + ((i * 239) % (WORLD_W - 260));
        const cz = (map.beach ? map.beach.sandY + 55 : 140) + ((i * 157) % 340);
        const cm = new THREE.Mesh(
          this._sharedGeo.plane,
          new THREE.MeshBasicMaterial({
            map: this.mistTex,
            color: coralCols[i % coralCols.length],
            transparent: true,
            opacity: 0.34,
            depthWrite: false
          })
        );
        cm.scale.setScalar(42 + (i % 3) * 18);
        cm.position.set(cx, 1.52, cz);
        this.ultraDecorGroup.add(cm);
      }
    }

    // 9. 🕊️ Circling Coastal Seabirds high above sunny/breezy arenas (clean curved V-wings!)
    if (map.id !== 'volkanik_resif' && map.id !== 'hayalet_sis') {
      const wingMat = new THREE.MeshBasicMaterial({ color: '#f8fafc', side: THREE.DoubleSide });
      const wingGeo = new THREE.PlaneGeometry(11, 3.2);
      wingGeo.rotateX(-Math.PI / 2);
      for (let b = 0; b < 4; b++) {
        const bg = new THREE.Group();
        const lw = new THREE.Mesh(wingGeo, wingMat);
        lw.position.x = -5.2;
        const rw = new THREE.Mesh(wingGeo, wingMat);
        rw.position.x = 5.2;
        bg.add(lw);
        bg.add(rw);
        this.ultraDecorGroup.add(bg);
        this.horizonBirds.push({
          group: bg,
          lw,
          rw,
          cx: WORLD_W * (0.25 + (b % 2) * 0.5),
          cz: WORLD_H * (0.28 + Math.floor(b / 2) * 0.44),
          rx: 260 + b * 65,
          rz: 170 + b * 45,
          alt: 125 + b * 18,
          speed: (b % 2 === 0 ? 1 : -1) * (0.22 + b * 0.04),
          phase: b * 1.9
        });
      }
    }

    // 10. 🐋 Deep Underwater Leviathan Silhouette gliding slowly beneath the waves
    const levTex = (() => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 128;
      const ctx = c.getContext('2d');
      ctx.fillStyle = 'rgba(2, 14, 28, 0.34)';
      ctx.beginPath();
      ctx.ellipse(135, 64, 72, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(64, 64);
      ctx.lineTo(18, 36);
      ctx.lineTo(34, 64);
      ctx.lineTo(18, 92);
      ctx.closePath();
      ctx.fill();
      // Pectoral fins
      ctx.beginPath();
      ctx.ellipse(152, 34, 14, 26, -0.45, 0, Math.PI * 2);
      ctx.ellipse(152, 94, 14, 26, 0.45, 0, Math.PI * 2);
      ctx.fill();
      const t = new THREE.CanvasTexture(c);
      t.needsUpdate = true;
      return t;
    })();
    const levMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(170, 85),
      new THREE.MeshBasicMaterial({ map: levTex, transparent: true, opacity: 0.42, depthWrite: false })
    );
    levMesh.rotation.x = -Math.PI / 2;
    levMesh.position.set(WORLD_W * 0.5, 1.45, WORLD_H * 0.5);
    this.ultraDecorGroup.add(levMesh);
    this.deepShadow = { mesh: levMesh, angle: 0.4 };
  }

  // ============================================================
  // 🏊‍♂️ 6 DISTINCT 3D SWIMMING HUMANS HOLDING THEIR REAL 2 ITEMS!
  // ============================================================
  _createHandheldItem3D(itemId) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: '#7c3f17', roughness: 0.72 });
    const steel = new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.28, metalness: 0.72 });
    const darkIron = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.38, metalness: 0.65 });
    const gold = new THREE.MeshStandardMaterial({ color: '#fbbf24', roughness: 0.25, metalness: 0.8 });

    switch (itemId) {
      case 'harpoon_cannon': {
        // 🎯 Zıpkın Topu: Uzun çelik zıpkın + parlayan mızrak ucu!
        const stock = new THREE.Mesh(new THREE.BoxGeometry(10, 3.2, 3.2), wood);
        stock.position.x = 3;
        g.add(stock);
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 22, 8), steel);
        rail.rotation.z = -Math.PI / 2;
        rail.position.x = 13;
        g.add(rail);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(3.6, 8, 6), new THREE.MeshBasicMaterial({ color: '#38bdf8' }));
        tip.rotation.z = -Math.PI / 2;
        tip.position.x = 26;
        g.add(tip);
        break;
      }
      case 'blunderbuss': {
        // 💥 Gemi Pompalısı: Geniş ağızlı pirinç korsan pompalısı!
        const stock = new THREE.Mesh(new THREE.BoxGeometry(10, 3.8, 3.5), wood);
        stock.position.x = 3;
        g.add(stock);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 2.2, 16, 10), gold);
        barrel.rotation.z = -Math.PI / 2;
        barrel.position.x = 13;
        g.add(barrel);
        break;
      }
      case 'flare_gun': {
        // 🔥 İşaret Tabancası: Parlak kırmızı kalın fişek tabancası!
        const red = new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.4 });
        const grip = new THREE.Mesh(new THREE.BoxGeometry(3.5, 6.5, 3), darkIron);
        grip.position.set(2, -2, 0);
        g.add(grip);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.4, 13, 10), red);
        barrel.rotation.z = -Math.PI / 2;
        barrel.position.set(8, 1.2, 0);
        g.add(barrel);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(2.4, 8, 8), new THREE.MeshBasicMaterial({ color: '#fde047' }));
        tip.position.set(15, 1.2, 0);
        g.add(tip);
        break;
      }
      case 'flintlock': {
        // 🔫 Korsan Tabancası: Klasik ahşap + altın şeritli çakmaklı tabanca!
        const grip = new THREE.Mesh(new THREE.BoxGeometry(5, 4.5, 2.6), wood);
        grip.position.set(2, -1.2, 0);
        g.add(grip);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.0, 15, 8), steel);
        barrel.rotation.z = -Math.PI / 2;
        barrel.position.set(9.5, 1, 0);
        g.add(barrel);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 2.5, 8), gold);
        band.rotation.z = -Math.PI / 2;
        band.position.set(13, 1, 0);
        g.add(band);
        break;
      }
      case 'hand_cannon': {
        // 💣 Kısa Namlu Top: İri demir el topu + parlayan fitil!
        const body = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 3.6, 15, 10), darkIron);
        body.rotation.z = -Math.PI / 2;
        body.position.x = 9;
        g.add(body);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.9, 6, 12), gold);
        ring.rotation.y = Math.PI / 2;
        ring.position.x = 15.5;
        g.add(ring);
        const spark = new THREE.Mesh(new THREE.SphereGeometry(2.0, 8, 8), new THREE.MeshBasicMaterial({ color: '#fb923c' }));
        spark.position.set(3, 5.2, 0);
        g.add(spark);
        break;
      }
      case 'grapple_hook': {
        // 🪝 Çekiş Kancası: 3 çengelli çelik fırlatma kancası!
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 16, 8), steel);
        shaft.rotation.z = -Math.PI / 2;
        shaft.position.x = 9;
        g.add(shaft);
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2;
          const prong = new THREE.Mesh(new THREE.ConeGeometry(1.8, 8.5, 6), gold);
          prong.position.set(15, Math.sin(a) * 4.2, Math.cos(a) * 4.2);
          prong.rotation.z = 0.85;
          prong.rotation.x = a;
          g.add(prong);
        }
        break;
      }
      case 'sonar': {
        // 📡 Denizaltı Sonarı: Parlayan mavi radar çanağı!
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 9, 8), darkIron);
        handle.rotation.z = -Math.PI / 2;
        handle.position.x = 4;
        g.add(handle);
        const dish = new THREE.Mesh(new THREE.ConeGeometry(6.5, 5, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#38bdf8', side: THREE.DoubleSide }));
        dish.rotation.z = Math.PI / 2;
        dish.position.x = 10;
        g.add(dish);
        const core = new THREE.Mesh(new THREE.SphereGeometry(2.5, 8, 8), new THREE.MeshBasicMaterial({ color: '#e0f2fe' }));
        core.position.x = 11.5;
        g.add(core);
        break;
      }
      case 'net_launcher':
      case 'electric_net': {
        // 🕸️/⚡ Ağ Fırlatıcı / Elektrik Ağı: Geniş namlulu ağ tüfeği!
        const col = itemId === 'electric_net' ? '#38bdf8' : '#2dd4bf';
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 2.2, 15, 10), darkIron);
        tube.rotation.z = -Math.PI / 2;
        tube.position.x = 9;
        g.add(tube);
        const coil = new THREE.Mesh(new THREE.TorusGeometry(4.2, 1.0, 8, 12), new THREE.MeshBasicMaterial({ color: col }));
        coil.rotation.y = Math.PI / 2;
        coil.position.x = 15.5;
        g.add(coil);
        break;
      }
      case 'anchor_trap': {
        // ⚓ Ağır Çapa: Çelik gemi çapası!
        const shank = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 17, 8), darkIron);
        shank.rotation.z = -Math.PI / 2;
        shank.position.x = 9;
        g.add(shank);
        const fluke = new THREE.Mesh(new THREE.TorusGeometry(6.5, 1.8, 8, 12, Math.PI), steel);
        fluke.rotation.z = -Math.PI / 2;
        fluke.position.x = 16;
        g.add(fluke);
        break;
      }
      case 'storm_surge': {
        // ⚡ Fırtına Hızı: Şimşekli enerji asası / şişesi!
        const bolt = new THREE.Mesh(new THREE.OctahedronGeometry(5.2, 0), new THREE.MeshBasicMaterial({ color: '#fde047' }));
        bolt.scale.set(1.6, 0.85, 0.85);
        bolt.position.x = 9;
        g.add(bolt);
        const glow = this._makeGlowSprite('#38bdf8', 22, 0.65);
        glow.position.x = 9;
        g.add(glow);
        break;
      }
      case 'gravity_bomb': {
        // 🌀 Çekim Bombası: Parlayan mor girdap küresi!
        const orb = new THREE.Mesh(new THREE.SphereGeometry(5.2, 10, 8), new THREE.MeshBasicMaterial({ color: '#c084fc' }));
        orb.position.x = 8;
        g.add(orb);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(7.2, 0.9, 6, 14), new THREE.MeshBasicMaterial({ color: '#e879f9' }));
        ring.rotation.x = Math.PI / 3;
        ring.position.x = 8;
        g.add(ring);
        break;
      }
      case 'ink_cloud': {
        // 🦑 Mürekkep Bulutu: Mor mürekkep şişesi!
        const flask = new THREE.Mesh(new THREE.SphereGeometry(5.2, 10, 8), new THREE.MeshStandardMaterial({ color: '#4c1d95', roughness: 0.25 }));
        flask.position.x = 7.5;
        g.add(flask);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.2, 4.5, 8), new THREE.MeshBasicMaterial({ color: '#c084fc' }));
        neck.position.set(7.5, 5.5, 0);
        g.add(neck);
        break;
      }
      case 'flash_flare': {
        // ✨ Kör Edici Fişek: Parlayan parlak sarı-beyaz flaş çubuğu!
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 14, 8), new THREE.MeshBasicMaterial({ color: '#fef08a' }));
        stick.rotation.z = -Math.PI / 2;
        stick.position.x = 9;
        g.add(stick);
        const gl = this._makeGlowSprite('#ffffff', 22, 0.72);
        gl.position.x = 15;
        g.add(gl);
        break;
      }
      case 'decoy_buoy': {
        // 🛟 Sahte Şamandıra: Turuncu-beyaz can simidi / şamandıra!
        const torus = new THREE.Mesh(new THREE.TorusGeometry(5.5, 2.1, 8, 14), new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.4 }));
        torus.rotation.x = Math.PI / 2;
        torus.position.x = 8;
        g.add(torus);
        break;
      }
      case 'jet_stream': {
        // 🚀 Jet Akıntısı: Parlak su altı jet motoru!
        const jet = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.8, 15, 10), new THREE.MeshStandardMaterial({ color: '#06d6a0', roughness: 0.3, metalness: 0.4 }));
        jet.rotation.z = -Math.PI / 2;
        jet.position.x = 9;
        g.add(jet);
        const noz = new THREE.Mesh(new THREE.ConeGeometry(3.4, 6, 8), new THREE.MeshBasicMaterial({ color: '#7dd3fc' }));
        noz.rotation.z = Math.PI / 2;
        noz.position.x = 1;
        g.add(noz);
        break;
      }
      case 'sea_mine': {
        // 💣 Su Altı Mayını: Dikenli kızıl deniz mayını!
        const mine = new THREE.Mesh(new THREE.OctahedronGeometry(5.8, 0), new THREE.MeshStandardMaterial({ color: '#e11d48', roughness: 0.35, metalness: 0.4 }));
        mine.position.x = 8;
        g.add(mine);
        break;
      }
      case 'buoyancy_kit': {
        // 🩹 Can Yeleği Kiti: Zümrüt yeşil ilk yardım çantası!
        const box = new THREE.Mesh(new THREE.BoxGeometry(9, 7, 5), new THREE.MeshStandardMaterial({ color: '#10b981', roughness: 0.4 }));
        box.position.x = 7.5;
        g.add(box);
        const cross1 = new THREE.Mesh(new THREE.BoxGeometry(5, 1.8, 5.4), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
        cross1.position.x = 7.5;
        g.add(cross1);
        const cross2 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 5, 5.4), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
        cross2.position.x = 7.5;
        g.add(cross2);
        break;
      }
      case 'mirror_shield': {
        // 🪞 Ayna Kalkanı: Parlayan altıgen ayna kalkan!
        const sh = new THREE.Mesh(
          new THREE.CylinderGeometry(8.5, 8.5, 2.2, 6),
          new THREE.MeshStandardMaterial({ color: '#e0f2fe', emissive: '#38bdf8', emissiveIntensity: 0.35, metalness: 0.9, roughness: 0.12 })
        );
        sh.rotation.z = Math.PI / 2;
        sh.position.x = 9;
        g.add(sh);
        break;
      }
      case 'kelp_trail': {
        // 🌿 Yosun İzi: Parlak yeşil deniz yosunu demeti!
        const kelpMat = new THREE.MeshStandardMaterial({ color: '#22c55e', roughness: 0.65 });
        for (let k = -1; k <= 1; k++) {
          const leaf = new THREE.Mesh(new THREE.ConeGeometry(2.6, 13, 6), kelpMat);
          leaf.rotation.z = -Math.PI / 2 + k * 0.25;
          leaf.position.set(9, k * 2, k * 2.5);
          g.add(leaf);
        }
        break;
      }
      default: {
        const orb = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 8), gold);
        orb.position.x = 8;
        g.add(orb);
      }
    }
    return g;
  }

  _syncHandheldItems(rig, p) {
    const items = p.items || [];
    const slots = [
      { idx: 0, hand: rig.rightHand, key: 'handItem0' },
      { idx: 1, hand: rig.leftHand, key: 'handItem1' }
    ];
    for (const s of slots) {
      const it = items[s.idx];
      const wantId = it ? it.id : null;
      if (rig[s.key]?.id !== wantId) {
        while (s.hand.children.length > 0) s.hand.remove(s.hand.children[0]);
        if (wantId) {
          const mesh = this._createHandheldItem3D(wantId);
          s.hand.add(mesh);
          rig[s.key] = { id: wantId, mesh };
        } else {
          rig[s.key] = null;
        }
      }
      if (rig[s.key]?.mesh) {
        rig[s.key].mesh.visible = Boolean(it && it.usesLeft > 0);
      }
    }
  }

  _createCharRig(charId, hullHex, roleHex, hasCustomSkin = false) {
    const root = new THREE.Group();

    // Soft underwater contact shadow + lively white swimming ripple collar
    const shadow = this._makeContactShadow(27, 0.56);
    root.add(shadow);

    const swimCollar = new THREE.Mesh(
      new THREE.PlaneGeometry(54, 54),
      new THREE.MeshBasicMaterial({ map: this.shoreFoamTex, color: '#e6fbff', transparent: true, opacity: 0.44, depthWrite: false })
    );
    swimCollar.rotation.x = -Math.PI / 2;
    swimCollar.position.y = 2.05;
    root.add(swimCollar);

    // Subtle crisp role ring right above wave crests for instant team readability
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(21, 24.2, 32),
      new THREE.MeshBasicMaterial({ color: roleHex, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 3.5;
    root.add(ring);

    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(28, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.24, depthWrite: false })
    );
    shield.position.y = 14;
    shield.visible = false;
    root.add(shield);

    const mirrorDome = new THREE.Mesh(
      new THREE.IcosahedronGeometry(30, 1),
      new THREE.MeshBasicMaterial({ color: '#e0f2fe', wireframe: true, transparent: true, opacity: 0.78, depthWrite: false })
    );
    mirrorDome.position.y = 14;
    mirrorDome.visible = false;
    root.add(mirrorDome);

    const shockCage = new THREE.Mesh(
      new THREE.IcosahedronGeometry(26, 0),
      new THREE.MeshBasicMaterial({ color: '#38bdf8', wireframe: true, transparent: true, opacity: 0.85, depthWrite: false })
    );
    shockCage.position.y = 14;
    shockCage.visible = false;
    root.add(shockCage);

    const aura = new THREE.Mesh(
      new THREE.RingGeometry(27, 32, 32),
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 3.8;
    aura.visible = false;
    root.add(aura);

    const body = new THREE.Group();
    root.add(body);

    const suitColor = hasCustomSkin ? hullHex : (charId === 'fenerci' ? '#eab308' : hullHex);
    const suitMat = new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.45, metalness: 0.08 });
    const skinTone = charId === 'hayalet' ? '#a5f3fc' : '#f6c39b';
    const skinMat = new THREE.MeshStandardMaterial({
      color: skinTone,
      roughness: 0.55,
      emissive: charId === 'hayalet' ? '#0891b2' : '#000000',
      emissiveIntensity: charId === 'hayalet' ? 0.35 : 0
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.5 });

    // 🏊‍♂️ Swimmer Upper Torso & Broad Shoulders (treading/swimming in water!)
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(10.5, 9.2, 16, 12), suitMat);
    torso.scale.set(0.86, 1, 1.32);
    torso.position.set(0, 7.5, 0);
    torso.castShadow = true;
    body.add(torso);

    // Life-vest / Wetsuit chest stripe
    const vest = new THREE.Mesh(
      new THREE.BoxGeometry(11.5, 8.5, 22),
      new THREE.MeshStandardMaterial({ color: roleHex, roughness: 0.45 })
    );
    vest.position.set(0.5, 9.5, 0);
    body.add(vest);

    // Expressive Stylized Head (facing +X!)
    const headGroup = new THREE.Group();
    headGroup.position.set(2, 23, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(9.4, 16, 14), skinMat);
    head.castShadow = true;
    headGroup.add(head);

    // Cartoon Eyes facing +X
    const eyeCol = charId === 'hayalet' ? '#67e8f9' : '#0f172a';
    const eyeMat = new THREE.MeshBasicMaterial({ color: eyeCol });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(1.75, 8, 8), eyeMat);
      eye.position.set(8.2, 1.2, s * 3.4);
      headGroup.add(eye);
    }

    // Snorkel tube (pops visibly when diving underwater!)
    const snorkel = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 15, 8),
      new THREE.MeshBasicMaterial({ color: '#38bdf8' })
    );
    snorkel.position.set(2, 11, -7.5);
    snorkel.visible = false;
    headGroup.add(snorkel);

    const animParts = { swimCollar, snorkel };

    // 🎭 6 ICONIC SWIMMER COSTUMES & HEADPIECES!
    if (charId === 'kaptan') {
      // ⚓ Kaptan Kara: Korsan tricorn şapka + altın şerit + gür sakal + göz bandı!
      const hatMat = new THREE.MeshStandardMaterial({ color: '#1c1917', roughness: 0.65 });
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(14.5, 15, 2.8, 3), hatMat);
      brim.position.set(0, 8.2, 0);
      brim.rotation.y = Math.PI;
      brim.castShadow = true;
      headGroup.add(brim);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 10, 7.5, 10), hatMat);
      crown.position.set(0, 12.2, 0);
      headGroup.add(crown);
      const badge = new THREE.Mesh(new THREE.SphereGeometry(2.6, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffd166' }));
      badge.position.set(9.2, 11.5, 0);
      headGroup.add(badge);
      const beard = new THREE.Mesh(new THREE.SphereGeometry(6.5, 10, 8), hatMat);
      beard.scale.set(0.85, 0.9, 1.1);
      beard.position.set(5.5, -5.2, 0);
      headGroup.add(beard);
    } else if (charId === 'kopekbaligi') {
      // 🦈 Köpekbalığı: Köpekbalığı kapüşonu + sırt yüzgeci + beyaz dişler!
      const hoodMat = new THREE.MeshStandardMaterial({ color: hasCustomSkin ? hullHex : '#2563eb', roughness: 0.35 });
      const hood = new THREE.Mesh(new THREE.SphereGeometry(10.3, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.68), hoodMat);
      hood.rotation.z = 0.25;
      headGroup.add(hood);
      const dorsal = new THREE.Mesh(new THREE.ConeGeometry(4.2, 14, 8), hoodMat);
      dorsal.position.set(-4.5, 12.5, 0);
      dorsal.rotation.z = 0.45;
      dorsal.scale.set(1.2, 1, 0.36);
      headGroup.add(dorsal);
      const tailFin = new THREE.Mesh(new THREE.ConeGeometry(4.5, 14, 8), hoodMat);
      tailFin.position.set(-14, 8, 0);
      tailFin.rotation.z = 1.1;
      tailFin.scale.set(0.8, 1, 0.35);
      body.add(tailFin);
      animParts.tail = tailFin;
    } else if (charId === 'hayalet') {
      // 👻 Sis Hayaleti: Gizemli hayalet dalgıç kapüşonu + parlayan gözler!
      const cloakMat = new THREE.MeshStandardMaterial({ color: hasCustomSkin ? hullHex : '#0f766e', roughness: 0.5, transparent: true, opacity: 0.9 });
      const hood = new THREE.Mesh(new THREE.ConeGeometry(12.2, 16, 10), cloakMat);
      hood.position.set(-1.5, 9.5, 0);
      hood.rotation.z = 0.28;
      headGroup.add(hood);
      const gHalo = this._makeGlowSprite('#67e8f9', 26, 0.55);
      gHalo.position.set(7, 2, 0);
      headGroup.add(gHalo);
    } else if (charId === 'fenerci') {
      // 🔦 Fenerci: Sarı yağmurluk şapkası + alında parlayan kafa feneri!
      const rainMat = new THREE.MeshStandardMaterial({ color: '#facc15', roughness: 0.38 });
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(13.5, 14.5, 2.4, 14), rainMat);
      brim.position.set(-0.5, 7.5, 0);
      headGroup.add(brim);
      const top = new THREE.Mesh(new THREE.SphereGeometry(9.2, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), rainMat);
      top.position.set(0, 7.8, 0);
      headGroup.add(top);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(3.4, 10, 8), new THREE.MeshBasicMaterial({ color: '#fef08a' }));
      lamp.position.set(9.5, 5.5, 0);
      headGroup.add(lamp);
      const lampGlow = this._makeGlowSprite('#fde047', 34, 0.8);
      lampGlow.position.set(11, 5.5, 0);
      headGroup.add(lampGlow);
      animParts.lamp = lamp;
    } else if (charId === 'ahtapot') {
      // 🐙 Ahtapot: Mor ahtapot şapkası + sırtta sallanan 4 dokunaç!
      const octoMat = new THREE.MeshStandardMaterial({ color: hasCustomSkin ? hullHex : '#9333ea', roughness: 0.32 });
      const cap = new THREE.Mesh(new THREE.SphereGeometry(10.8, 14, 12), octoMat);
      cap.scale.set(1.05, 0.85, 1.05);
      cap.position.set(-0.5, 8.2, 0);
      headGroup.add(cap);
      for (const s of [-1, 1]) {
        const ce = new THREE.Mesh(new THREE.SphereGeometry(2.1, 8, 8), new THREE.MeshBasicMaterial({ color: '#fef08a' }));
        ce.position.set(8.5, 9.2, s * 4.2);
        headGroup.add(ce);
      }
      animParts.tentacles = [];
      for (let k = 0; k < 4; k++) {
        const a = ((k - 1.5) / 3) * 1.1;
        const tg = new THREE.Group();
        tg.position.set(-7, 8, 0);
        tg.rotation.y = a;
        const arm = new THREE.Mesh(this._sharedGeo.tentacle, octoMat);
        arm.scale.setScalar(0.72);
        tg.add(arm);
        body.add(tg);
        animParts.tentacles.push({ group: tg, baseA: a, idx: k });
      }
    } else {
      // 🌊 Dalga Binicisi: Sörf gözlüğü + dalgalanan bandana!
      const bandMat = new THREE.MeshBasicMaterial({ color: hasCustomSkin ? hullHex : '#06d6a0' });
      const band = new THREE.Mesh(new THREE.TorusGeometry(9.2, 1.9, 8, 16), bandMat);
      band.rotation.x = Math.PI / 2;
      band.position.set(0, 4.5, 0);
      headGroup.add(band);
      const goggles = new THREE.Mesh(new THREE.BoxGeometry(4.5, 4.2, 12.5), new THREE.MeshBasicMaterial({ color: '#38bdf8' }));
      goggles.position.set(8.2, 4.2, 0);
      headGroup.add(goggles);
    }
    body.add(headGroup);

    // 💪 Articulated RIGHT & LEFT ARMS holding Slot 0 (Right) & Slot 1 (Left) 3D Items!
    const makeArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(2, 12, side * 14.5);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.8, 12, 8), skinMat);
      upper.rotation.z = -Math.PI / 2;
      upper.position.x = 6;
      upper.castShadow = true;
      shoulder.add(upper);
      const fist = new THREE.Mesh(new THREE.SphereGeometry(3.5, 8, 8), skinMat);
      fist.position.x = 12.5;
      shoulder.add(fist);
      const handSocket = new THREE.Group();
      handSocket.position.set(13, 0, 0);
      shoulder.add(handSocket);
      body.add(shoulder);
      return { shoulder, handSocket };
    };
    const rArm = makeArm(1);
    const lArm = makeArm(-1);

    // 🦵 Kicking swimmer legs trailing just beneath the surface!
    const makeLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(-8, 3.5, side * 5.2);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.2, 14, 8), skinMat);
      leg.rotation.z = Math.PI / 2;
      leg.position.x = -7;
      hip.add(leg);
      const flipper = new THREE.Mesh(new THREE.BoxGeometry(7.5, 1.4, 4.8), darkMat);
      flipper.position.set(-15, 0, 0);
      hip.add(flipper);
      body.add(hip);
      return hip;
    };
    const rightLeg = makeLeg(1);
    const leftLeg = makeLeg(-1);

    // 🚩 Mini Waving Role/Crown Pennant Flag behind shoulder for clear team ID!
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.7, 15, 6),
      new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.4 })
    );
    pole.position.set(-9, 22, -7);
    body.add(pole);
    const flagGeo = new THREE.PlaneGeometry(13, 6.2, 4, 1);
    flagGeo.translate(-6.5, 0, 0);
    const flagMesh = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ color: roleHex, side: THREE.DoubleSide }));
    flagMesh.position.set(-9, 28, -7);
    body.add(flagMesh);
    animParts.flag = flagMesh;
    animParts.rightArm = rArm.shoulder;
    animParts.leftArm = lArm.shoulder;
    animParts.rightLeg = rightLeg;
    animParts.leftLeg = leftLeg;
    animParts.head = headGroup;

    return {
      root,
      body,
      ring,
      shield,
      mirrorDome,
      shockCage,
      aura,
      rightHand: rArm.handSocket,
      leftHand: lArm.handSocket,
      handItem0: null,
      handItem1: null,
      animParts,
      charId,
      hullHex,
      roleHex,
      hasCustomSkin,
      modelsReady: this.modelsReady,
      diveY: 0,
      bankAngle: 0
    };
  }

  _createKrakenRig() {
    const g = new THREE.Group();

    // 🌀 Abyssal dark spinning whirlpool + churning seafoam base
    const vortex = new THREE.Mesh(
      new THREE.PlaneGeometry(175, 175),
      new THREE.MeshBasicMaterial({ map: this.mistTex, color: '#4c1d95', transparent: true, opacity: 0.72, depthWrite: false })
    );
    vortex.rotation.x = -Math.PI / 2;
    vortex.position.y = 1.8;
    g.add(vortex);

    const foamRing = new THREE.Mesh(
      new THREE.PlaneGeometry(145, 145),
      new THREE.MeshBasicMaterial({ map: this.shoreFoamTex, color: '#e879f9', transparent: true, opacity: 0.55, depthWrite: false })
    );
    foamRing.rotation.x = -Math.PI / 2;
    foamRing.position.y = 2.15;
    g.add(foamRing);

    // ⚠️ 3D Slam Telegraph Danger Ring + Expanding Red-Magenta Fill Disc!
    const warnOuter = new THREE.Mesh(
      new THREE.RingGeometry(143, 151, 48),
      new THREE.MeshBasicMaterial({ color: '#f0abfc', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    warnOuter.rotation.x = -Math.PI / 2;
    warnOuter.position.y = 2.9;
    warnOuter.visible = false;
    g.add(warnOuter);

    const warnFill = new THREE.Mesh(
      new THREE.CircleGeometry(1, 40),
      new THREE.MeshBasicMaterial({ color: '#f43f5e', transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })
    );
    warnFill.rotation.x = -Math.PI / 2;
    warnFill.position.y = 2.7;
    warnFill.visible = false;
    g.add(warnFill);

    // 🔥 Enraged Vortex Pull Boundary Ring (245px)
    const rageRing = new THREE.Mesh(
      new THREE.RingGeometry(239, 245, 52),
      new THREE.MeshBasicMaterial({ color: '#fb7185', transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false })
    );
    rageRing.rotation.x = -Math.PI / 2;
    rageRing.position.y = 2.35;
    rageRing.visible = false;
    g.add(rageRing);

    // 🐙 Sculpted Armored Kraken Head Group (rotates toward nearest ship!)
    const headGroup = new THREE.Group();
    const skinMat = new THREE.MeshStandardMaterial({ color: '#581c87', roughness: 0.28, metalness: 0.18 });
    const ridgeMat = new THREE.MeshStandardMaterial({ color: '#86198f', roughness: 0.32, metalness: 0.22 });
    const suckerMat = new THREE.MeshStandardMaterial({ color: '#f5d0fe', roughness: 0.4, emissive: '#a21caf', emissiveIntensity: 0.25 });

    // Lower bulbous head + upper towering ridged mantle crown
    const mainHead = new THREE.Mesh(new THREE.SphereGeometry(32, 18, 14), skinMat);
    mainHead.scale.set(1.06, 0.88, 1.08);
    mainHead.position.y = 22;
    mainHead.castShadow = true;
    headGroup.add(mainHead);

    const mantle = new THREE.Mesh(new THREE.SphereGeometry(26, 16, 12), ridgeMat);
    mantle.scale.set(0.92, 1.35, 1.18);
    mantle.position.set(-7, 42, 0);
    mantle.rotation.z = 0.28;
    mantle.castShadow = true;
    headGroup.add(mantle);

    // Lateral armored ear-fins & dorsal spikes
    for (const s of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(12, 34, 8), ridgeMat);
      fin.position.set(-6, 42, s * 22);
      fin.rotation.x = s * 0.72;
      fin.rotation.z = 0.35;
      fin.scale.set(0.65, 1, 0.35);
      headGroup.add(fin);
    }
    for (let k = 0; k < 4; k++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(4.5 - k * 0.5, 14 - k * 1.2, 6), suckerMat);
      sp.position.set(-14 - k * 5, 58 - k * 6, 0);
      sp.rotation.z = 0.5 + k * 0.18;
      headGroup.add(sp);
    }

    // Fierce glowing boss eyes + dark angled brow ridges + additive eye halos!
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#fde047' });
    const browMat = new THREE.MeshStandardMaterial({ color: '#3b0764', roughness: 0.4 });
    const eyeGlows = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(6.8, 12, 10), eyeMat);
      eye.scale.set(0.75, 0.9, 1.15);
      eye.position.set(25, 29, s * 13);
      headGroup.add(eye);

      const pupil = new THREE.Mesh(new THREE.BoxGeometry(2.4, 7.5, 2.2), new THREE.MeshBasicMaterial({ color: '#180526' }));
      pupil.position.set(29.8, 29, s * 13);
      headGroup.add(pupil);

      const brow = new THREE.Mesh(new THREE.BoxGeometry(11, 3.6, 13), browMat);
      brow.position.set(25, 35.5, s * 13.5);
      brow.rotation.x = -s * 0.34;
      brow.rotation.y = s * 0.18;
      headGroup.add(brow);

      const eg = this._makeGlowSprite('#fde047', 32, 0.78);
      eg.position.set(28, 29, s * 13.5);
      headGroup.add(eg);
      eyeGlows.push(eg);
    }
    g.add(headGroup);

    // 🐙 8 Sculpted S-Curved Giant Tentacles with Glowing Suction Cups!
    const tentCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(24, 2, 0),
      new THREE.Vector3(46, 30, 5),
      new THREE.Vector3(64, 48, -6),
      new THREE.Vector3(78, 30, 4),
      new THREE.Vector3(88, 12, -2)
    ]);
    const tentGeo = new THREE.TubeGeometry(tentCurve, 18, 5.4, 10, false);
    // Taper radius cleanly toward the tip!
    const tPos = tentGeo.attributes.position;
    for (let vi = 0; vi < tPos.count; vi++) {
      const vx = tPos.getX(vi);
      const frac = Math.max(0, Math.min(1, (vx - 24) / 64));
      const center = tentCurve.getPoint(frac);
      const taper = 1.25 - frac * 0.92;
      tPos.setXYZ(
        vi,
        center.x + (tPos.getX(vi) - center.x) * taper,
        center.y + (tPos.getY(vi) - center.y) * taper,
        center.z + (tPos.getZ(vi) - center.z) * taper
      );
    }
    tentGeo.computeVertexNormals();

    const tentacles = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const tg = new THREE.Group();
      tg.rotation.y = a;

      const armGroup = new THREE.Group();
      const arm = new THREE.Mesh(tentGeo, i % 2 === 0 ? skinMat : ridgeMat);
      arm.castShadow = true;
      armGroup.add(arm);

      // 3 glowing suction cups along the curved underside
      for (const f of [0.28, 0.52, 0.74]) {
        const pt = tentCurve.getPoint(f);
        const cup = new THREE.Mesh(this._sharedGeo.sphere, suckerMat);
        cup.scale.setScalar(3.4 - f * 1.6);
        cup.position.set(pt.x, pt.y - 3.5, pt.z);
        armGroup.add(cup);
      }

      tg.add(armGroup);
      g.add(tg);
      tentacles.push({ group: tg, arm: armGroup, baseA: a, idx: i });
    }

    this.dynamicGroup.add(g);
    return { group: g, head: headGroup, vortex, foamRing, warnOuter, warnFill, rageRing, eyeMat, eyeGlows, tentacles, wasWarn: false };
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
    const crownGlow = this._makeGlowSprite('#ffd166', 68, 0.75);
    crownGlow.position.y = 26;
    g.add(crownGlow);
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
      if (this.particles.length >= this.maxParticles) break;
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
      if (this.particles.length >= this.maxParticles) break;
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
    if (this.particles.length >= this.maxParticles) return;
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

  _spawnVWake(x, z, aim, spd = 160) {
    if (this.particles.length >= this.maxParticles) return;
    // Sleek elongated V-wake foam ribbons oriented cleanly along the stern trails!
    const fast = Math.min(1.45, Math.max(0.75, spd / 185));
    for (const side of [-1, 1]) {
      const a = aim + Math.PI + side * 0.36;
      const m = new THREE.Mesh(
        this._sharedGeo.plane,
        new THREE.MeshBasicMaterial({ map: this.wakeTex, color: '#e8fbff', transparent: true, opacity: 0.48, depthWrite: false })
      );
      m.rotation.y = -a;
      m.scale.set(22 * fast, 1, 11 * fast);
      m.position.set(x - Math.cos(aim) * 19 + Math.cos(a) * 6, 1.9, z - Math.sin(aim) * 19 + Math.sin(a) * 6);
      this.fxGroup.add(m);
      this.particles.push({
        mesh: m,
        vx: Math.cos(a) * 28,
        vy: 0,
        vz: Math.sin(a) * 28,
        gravity: 0,
        baseSx: 22 * fast,
        baseSz: 11 * fast,
        life: 0.62,
        maxLife: 0.62,
        kind: 'foam'
      });
    }
  }

  _spawnDamageSmoke(x, z, critical = false) {
    if (this.particles.length >= this.maxParticles) return;
    const m = new THREE.Mesh(
      this._sharedGeo.sphere,
      new THREE.MeshBasicMaterial({
        color: critical ? '#334155' : '#64748b',
        transparent: true,
        opacity: critical ? 0.56 : 0.42,
        depthWrite: false
      })
    );
    m.scale.setScalar(critical ? 5.2 : 3.8);
    m.position.set(x + (Math.random() - 0.5) * 10, 14, z + (Math.random() - 0.5) * 10);
    this.fxGroup.add(m);
    this.particles.push({
      mesh: m,
      vx: (Math.random() - 0.5) * 16,
      vy: 28 + Math.random() * 18,
      vz: (Math.random() - 0.5) * 16,
      gravity: -8,
      life: 0.72,
      maxLife: 0.72,
      kind: 'smoke'
    });
    if (critical && Math.random() < 0.42) {
      this._spawnBurst(x, z, '#fb923c', 1, 35, 65);
    }
  }

  _triggerBlastLight(x, z, color = '#ff8c38', intensity = 6.2) {
    if (this.quality === 'low') return;
    this.blastLight.color.set(color);
    this.blastLight.position.set(x, 28, z);
    this.blastLight.intensity = intensity;
    this.blastLightTimer = 0.42;
  }

  // 🌊 Wind-Waker style rising 3D splash plume cone!
  _spawnSplashPlume(x, z, color = '#e0f7ff', scale = 1.0) {
    if (this.particles.length >= this.maxParticles) return;
    const m = new THREE.Mesh(
      this._sharedGeo.cone,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72, depthWrite: false })
    );
    m.position.set(x, 6, z);
    m.scale.set(10 * scale, 16 * scale, 10 * scale);
    this.fxGroup.add(m);
    this.particles.push({
      mesh: m,
      baseScale: scale,
      life: 0.42,
      maxLife: 0.42,
      kind: 'plume'
    });
  }

  // 🪵 Floating shattered wooden planks bobbing on the ocean after a sink or broken crate!
  _spawnWoodDebris(x, z, count = 4) {
    if (this.quality === 'low') return;
    for (let i = 0; i < count; i++) {
      if (this.debrisPlanks.length >= 26) {
        const old = this.debrisPlanks.shift();
        this.fxGroup.remove(old.mesh);
        old.mesh.material.dispose?.();
      }
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.8;
      const spd = 45 + Math.random() * 55;
      const m = new THREE.Mesh(
        this._sharedGeo.box,
        new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? '#92400e' : '#b45309', roughness: 0.82 })
      );
      m.scale.set(11 + Math.random() * 6, 2.2, 3.6 + Math.random() * 2);
      m.position.set(x + Math.cos(a) * 10, 2.2, z + Math.sin(a) * 10);
      m.rotation.y = Math.random() * Math.PI * 2;
      this.fxGroup.add(m);
      this.debrisPlanks.push({
        mesh: m,
        vx: Math.cos(a) * spd,
        vz: Math.sin(a) * spd,
        spin: (Math.random() - 0.5) * 2.5,
        phase: Math.random() * 6.28,
        life: 4.5 + Math.random() * 1.5,
        maxLife: 6.0
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
    this._spawnSplashPlume(sp.x, sp.y, '#e0f7ff', 1.35);
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
      } else if (pt.kind === 'plume') {
        const prog = 1 - ratio;
        const sc = pt.baseScale || 1;
        const h = (14 + Math.sin(prog * Math.PI) * 26) * sc;
        const r = (9 + prog * 16) * sc;
        pt.mesh.scale.set(r, h, r);
        pt.mesh.position.y = h * 0.45;
        pt.mesh.material.opacity = ratio * 0.72;
      } else if (pt.kind === 'foam') {
        pt.mesh.position.x += pt.vx * dt;
        pt.mesh.position.z += pt.vz * dt;
        const grow = 1 + (1 - ratio) * 1.15;
        pt.mesh.scale.set((pt.baseSx || 20) * grow, 1, (pt.baseSz || 11) * grow);
        pt.mesh.material.opacity = ratio * 0.42;
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
      sr.rig.body.position.y = -prog * 34;
      sr.rig.body.rotation.y += dt * 2.2 * sr.rollDir;
      // 🏊‍♂️ Frantically wave both arms above head while bubbling down into the sea!
      if (sr.rig.animParts?.rightArm && sr.rig.animParts?.leftArm) {
        sr.rig.animParts.rightArm.rotation.z = 1.25 + Math.sin(this.time * 24) * 0.35;
        sr.rig.animParts.leftArm.rotation.z = 1.25 - Math.sin(this.time * 24) * 0.35;
      }
      if (Math.random() < dt * 14) {
        this._spawnBurst(sr.rig.root.position.x + (Math.random() - 0.5) * 14, sr.rig.root.position.z + (Math.random() - 0.5) * 14, '#e0f2fe', 1, 24, 42);
      }
    }

    // Floating wooden wreckage planks bobbing & slowly sinking
    for (let i = this.debrisPlanks.length - 1; i >= 0; i--) {
      const dp = this.debrisPlanks[i];
      dp.life -= dt;
      if (dp.life <= 0) {
        this.fxGroup.remove(dp.mesh);
        dp.mesh.material.dispose?.();
        this.debrisPlanks.splice(i, 1);
        continue;
      }
      dp.vx *= Math.pow(0.25, dt);
      dp.vz *= Math.pow(0.25, dt);
      dp.mesh.position.x += dp.vx * dt;
      dp.mesh.position.z += dp.vz * dt;
      const sinkY = dp.life < 1.2 ? -(1.2 - dp.life) * 5.5 : 0;
      dp.mesh.position.y = 2.0 + Math.sin(this.time * 4.2 + dp.phase) * 1.1 + sinkY;
      dp.mesh.rotation.y += dp.spin * dt;
      dp.mesh.rotation.z = Math.sin(this.time * 3.6 + dp.phase) * 0.16;
    }

    // Dynamic explosion PointLight decay
    if (this.blastLightTimer > 0) {
      this.blastLightTimer = Math.max(0, this.blastLightTimer - dt);
      this.blastLight.intensity = (this.blastLightTimer / 0.42) * 6.2;
    } else if (this.blastLight.intensity > 0) {
      this.blastLight.intensity = 0;
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

    // Update GPU PBR Ocean Shader + Sky Dome uniforms
    const fogDens = state.roundEvent === 'gece_sisi' ? 0.00088 : (this._baseFogDens || 0.00032);
    this.scene.fog.density = fogDens;
    this.oceanUniforms.uTime.value = this.time;
    this.oceanUniforms.uFogDensity.value = fogDens;
    this.skyUniforms.uTime.value = this.time;
    this.skyDome.position.set(this.camX, 0, this.camY);

    // Flickering warm island campfires / braziers
    for (const f of this.islandFires) {
      const fl = 0.85 + Math.sin(this.time * 16 + f.phase) * 0.22 + Math.cos(this.time * 23 + f.phase) * 0.12;
      f.flame.scale.set(1, fl, 1);
      f.core.scale.set(1, fl * 0.9, 1);
      f.glow.material.opacity = 0.48 + fl * 0.22;
    }

    // Breathing animated shoreline foam rings around every rock/island!
    for (const sr of this.shorelineRings) {
      const wave = Math.sin(this.time * 2.1 + sr.phase);
      const s = 0.96 + wave * 0.075;
      sr.mesh.scale.set(s, s, 1);
      sr.mesh.material.opacity = 0.24 + (wave * 0.5 + 0.5) * 0.28;
    }

    // Circling coastal seabirds high above the ocean
    for (const b of this.horizonBirds) {
      const ang = this.time * b.speed + b.phase;
      const nx = b.cx + Math.cos(ang) * b.rx;
      const nz = b.cz + Math.sin(ang) * b.rz;
      const dx = -Math.sin(ang) * b.rx * b.speed;
      const dz = Math.cos(ang) * b.rz * b.speed;
      b.group.position.set(nx, b.alt + Math.sin(this.time * 1.4 + b.phase) * 7, nz);
      b.group.rotation.y = Math.atan2(dx, dz);
      const flap = Math.sin(this.time * 7.5 + b.phase) * 0.38;
      b.lw.rotation.z = flap;
      b.rw.rotation.z = -flap;
    }

    // Deep underwater leviathan silhouette gliding gently below the waves
    if (this.deepShadow) {
      const t = this.time * 0.065;
      const lx = WORLD_W * 0.5 + Math.cos(t) * (WORLD_W * 0.34);
      const lz = WORLD_H * 0.5 + Math.sin(t * 1.3) * (WORLD_H * 0.32);
      const vx = -Math.sin(t) * (WORLD_W * 0.34);
      const vz = Math.cos(t * 1.3) * (WORLD_H * 0.32) * 1.3;
      this.deepShadow.mesh.position.set(lx, 1.45, lz);
      this.deepShadow.mesh.rotation.z = -Math.atan2(vz, vx);
    }

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
        this.lightningAlpha = 0.22;
        this.nextLightning = 6 + Math.random() * 8;
      }
      this.lightningAlpha = Math.max(0, this.lightningAlpha - dt * 1.15);
      // Real 3D storm lightning flash brightens ocean, ships & cliffs!
      this.sunLight.intensity = this._baseSunInt + this.lightningAlpha * 6.5;
    } else {
      this.lightningAlpha = 0;
      this.sunLight.intensity = this._baseSunInt;
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
          this._spawnSplashPlume(sp.x, sp.y, p.submerged ? '#bae6fd' : '#e0f7ff', p.submerged ? 0.95 : 1.25);
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

      if (p.alive && p.submerged && (this._canViewerSee(me, p, map, state.roundEvent) || p.id === myId) && Math.random() < dt * 11) {
        // Rising white air bubbles while prowling underwater!
        this._spawnBurst(sp.x + (Math.random() - 0.5) * 14, sp.y + (Math.random() - 0.5) * 14, '#bae6fd', 1, 14, 28);
      } else if (p.alive && !p.submerged) {
        const curSpd = Math.hypot(p.vx || 0, p.vy || 0);
        if (curSpd > 42 && Math.random() < dt * 14) {
          this._spawnVWake(sp.x, sp.y, sp.aim, curSpd);
        }
        // Low-HP exhausted swimmer panic splashes (<40% HP)
        const hpRatio = (p.hp || 0) / Math.max(1, p.maxHp || 120);
        if (hpRatio < 0.4 && (this._canViewerSee(me, p, map, state.roundEvent) || p.id === myId) && Math.random() < dt * (hpRatio < 0.22 ? 8 : 4)) {
          this._spawnBurst(sp.x, sp.y, hpRatio < 0.22 ? '#fda4af' : '#bae6fd', 1, 32, 52);
        }
      }
    }

    for (const [id, rc] of this.shipRecoil.entries()) {
      if (rc - dt <= 0) this.shipRecoil.delete(id);
      else this.shipRecoil.set(id, rc - dt);
    }

    for (const [id, hf] of this.hitFlash.entries()) {
      if (hf - dt <= 0) this.hitFlash.delete(id);
      else this.hitFlash.set(id, hf - dt);
    }

    for (const pu of state.pulses || []) {
      if (this.seenPulses.has(pu.id)) continue;
      this.seenPulses.add(pu.id);
      if (pu.kind === 'muzzle') {
        this._spawnBurst(pu.x, pu.y, '#fde047', 7, 72, 42);
        this._spawnSmoke(pu.x, pu.y, 4);
        this._spawnShockRing(pu.x, pu.y, '#fef08a', 6, 36, 0.2);
        this._triggerBlastLight(pu.x, pu.y, '#fde047', 3.4);
        // Kick back the nearest firing ship for crisp tactile recoil!
        for (const pl of players) {
          if (pl.alive && dist(pl.x, pl.y, pu.x, pu.y) < 42) {
            this.shipRecoil.set(pl.id, 0.16);
          }
        }
      } else if (pu.kind === 'boom' || pu.kind === 'barrel') {
        this._spawnSplashPlume(pu.x, pu.y, '#ff9f43', 1.4);
        this._spawnBurst(pu.x, pu.y, '#ff6b35', 16, 160, 110);
        this._spawnSmoke(pu.x, pu.y, 6);
        this._spawnShockRing(pu.x, pu.y, '#fb923c', 16, Math.min(165, pu.maxR || 130), 0.52);
        this._triggerBlastLight(pu.x, pu.y, '#ff6b35', 7.2);
        this.triggerShake(10);
      } else if (pu.kind === 'electric') {
        this._spawnBurst(pu.x, pu.y, '#38bdf8', 10, 120);
        this._spawnShockRing(pu.x, pu.y, '#38bdf8', 12, 95, 0.42);
        this._triggerBlastLight(pu.x, pu.y, '#38bdf8', 4.5);
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
    const slowZoom = state.slowMo ? 0.78 : 1.0;
    const wantH = (this.camMode === 'sinematik' ? (isNarrow ? 390 : 300) : (isNarrow ? 590 : 465)) * slowZoom;
    const wantB = (this.camMode === 'sinematik' ? (isNarrow ? 470 : 405) : (isNarrow ? 420 : 335)) * slowZoom;
    this._curCamH += (wantH - this._curCamH) * Math.min(1, dt * 6);
    this._curCamB += (wantB - this._curCamB) * Math.min(1, dt * 6);

    // 💨 Dynamic Speed FOV Kick (widens gently during boost / turbo current / dash!)
    const meSpd = (me && me.alive) ? Math.hypot(me.vx || 0, me.vy || 0) : 0;
    const isFast = this.quality !== 'low' && me && me.alive && ((me.speedBoostSec || 0) > 0 || me.inCurrent || meSpd > 285);
    const wantFov = isFast ? 47.0 : 42.0;
    if (Math.abs(wantFov - this._curFov) > 0.05) {
      this._curFov += (wantFov - this._curFov) * Math.min(1, dt * 6.5);
      this.camera.fov = this._curFov;
      this.camera.updateProjectionMatrix();
    }

    this.camera.position.set(this.camX + sxOff, this._curCamH, this.camY + this._curCamB + szOff);
    this.camera.lookAt(this.camX + sxOff * 0.4, 8, this.camY + 10 + szOff * 0.4);

    this.sunLight.position.set(this.camX + 360, 740, this.camY + 260);
    this.sunLight.target.position.set(this.camX, 0, this.camY);

    // Sync all 3D entities
    this._syncPlayers(state, players, me, map);
    this._syncDecoys(state.decoys || [], me, map);
    this._syncProjectiles(state.projectiles || [], players);
    this._syncBarrels(state.barrels || []);
    this._syncPowerups(state.powerups || []);
    this._syncBreakables(state.breakables || []);
    this._syncTraps(state.traps || [], me);
    this._syncZones(state.zones || []);
    this._syncBuoys(state.rescueBuoys || []);
    this._syncGeysers(state.geysers || []);
    this._syncKraken(state.kraken);
    this._syncEdgeTentacles(state.edgeTentacles || []);
    this._syncCrown(state.crown);
    this._syncMegaChest(state.megaChest);

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

      // When submerged, keep a recognizable shadowy silhouette skimming just under the waves (NEVER vanish under opaque water!)
      const targetY = p.submerged ? -5.5 : (Math.sin(this.time * 3.8 + sp.x * 0.02) * 1.6);
      rig.diveY += (targetY - rig.diveY) * 0.22;
      rig.body.position.y = rig.diveY;
      const targetSy = p.submerged ? 0.45 : 1.0;
      rig.body.scale.y += (targetSy - rig.body.scale.y) * 0.2;
      rig.body.rotation.y = -sp.aim;
      rig.ring.material.opacity = p.submerged ? 0.92 : 0.78;
      rig.ring.material.color.set(p.submerged ? '#38bdf8' : rig.roleHex);

      // Sync the real 2 items held in the swimmer's right & left hands!
      this._syncHandheldItems(rig, p);

      const spd = Math.hypot(p.vx || 0, p.vy || 0);
      // Dynamic swimmer stroke, flutter-kick legs, lunge arms & weapon recoil!
      const prevA = this.prevAim.get(p.id);
      let dAim = 0;
      if (prevA !== undefined) {
        dAim = Math.atan2(Math.sin(sp.aim - prevA), Math.cos(sp.aim - prevA));
      }
      this.prevAim.set(p.id, sp.aim);
      const targetBank = Math.max(-0.24, Math.min(0.24, dAim * 3.2));
      rig.bankAngle = (rig.bankAngle || 0) + (targetBank - (rig.bankAngle || 0)) * 0.18;
      const recoil = this.shipRecoil.get(p.id) || 0;
      const recoilPush = recoil > 0 ? -(recoil / 0.16) * 6.5 : 0;
      rig.body.position.x = Math.cos(sp.aim) * recoilPush;
      rig.body.position.z = Math.sin(sp.aim) * recoilPush;
      rig.body.rotation.x = Math.sin(this.time * 4.5 + sp.y * 0.02) * 0.05 + rig.bankAngle;
      // Forward swim lean (flatter when diving underwater!)
      rig.body.rotation.z = p.submerged ? -0.35 : (-Math.min(0.22, spd * 0.00075) + (recoil > 0 ? 0.14 : 0));

      const kickSpd = 6 + spd * 0.055;
      const stroke = Math.sin(this.time * kickSpd + (p.id?.length || 0));
      const isLunge = spd > 330;
      if (rig.animParts.rightArm && rig.animParts.leftArm) {
        const recPitch = recoil > 0 ? 0.45 : 0;
        if (isLunge) {
          // SPACE Suya Bastır / Dalga Kaçışı: reach both arms forward!
          rig.animParts.rightArm.rotation.y = 0.25;
          rig.animParts.leftArm.rotation.y = -0.25;
          rig.animParts.rightArm.rotation.z = 0.15;
          rig.animParts.leftArm.rotation.z = 0.15;
        } else {
          rig.animParts.rightArm.rotation.y = 0.12 + stroke * (spd > 35 ? 0.24 : 0.06);
          rig.animParts.leftArm.rotation.y = -0.12 - stroke * (spd > 35 ? 0.24 : 0.06);
          rig.animParts.rightArm.rotation.z = recPitch + stroke * (spd > 35 ? 0.18 : 0.05);
          rig.animParts.leftArm.rotation.z = recPitch - stroke * (spd > 35 ? 0.18 : 0.05);
        }
      }
      if (rig.animParts.rightLeg && rig.animParts.leftLeg) {
        const legAmp = spd > 35 ? 0.42 : 0.12;
        rig.animParts.rightLeg.rotation.z = Math.sin(this.time * kickSpd * 1.35) * legAmp;
        rig.animParts.leftLeg.rotation.z = -Math.sin(this.time * kickSpd * 1.35) * legAmp;
      }
      if (rig.animParts.swimCollar) {
        const sc = 0.94 + Math.sin(this.time * 4.5 + sp.x * 0.02) * 0.08 + Math.min(0.14, spd * 0.0004);
        rig.animParts.swimCollar.scale.set(sc, sc, 1);
        rig.animParts.swimCollar.rotation.z += 0.015;
        rig.animParts.swimCollar.visible = !p.submerged;
      }
      if (rig.animParts.snorkel) {
        rig.animParts.snorkel.visible = Boolean(p.submerged);
      }

      if (rig.animParts.tail) rig.animParts.tail.rotation.y = Math.sin(this.time * (8 + spd * 0.035)) * 0.44;
      if (rig.animParts.tentacles) {
        for (const t of rig.animParts.tentacles) {
          t.group.rotation.y = t.baseA + Math.sin(this.time * 5 + t.idx) * 0.24;
          t.group.rotation.z = Math.cos(this.time * 4 + t.idx) * 0.18;
        }
      }

      if (rig.animParts.flag) {
        const flag = rig.animParts.flag;
        flag.material.color.set(p.hasCrown ? '#fde047' : rig.roleHex);
        const pos = flag.geometry.attributes.position;
        const flutter = 8.5 + spd * 0.03;
        for (let vi = 0; vi < pos.count; vi++) {
          const lx = pos.getX(vi); // 0 at pole, -16 at tip
          const factor = Math.abs(lx) / 16;
          pos.setZ(vi, Math.sin(this.time * flutter + lx * 0.35 + sp.x * 0.05) * 2.8 * factor);
        }
        pos.needsUpdate = true;
      }

      rig.shield.visible = (p.shield || 0) > 0 && !(p.mirrorTimer > 0);
      if (rig.mirrorDome) {
        rig.mirrorDome.visible = (p.mirrorTimer || 0) > 0;
        if (rig.mirrorDome.visible) {
          rig.mirrorDome.rotation.y = this.time * 2.6;
          rig.mirrorDome.rotation.x = this.time * 1.4;
        }
      }
      if (rig.shockCage) {
        rig.shockCage.visible = (p.stunTimer || 0) > 0 || (p.stunSec || 0) > 0;
        if (rig.shockCage.visible) {
          rig.shockCage.rotation.y = this.time * 9;
          rig.shockCage.rotation.z = this.time * 7;
          const sc = 0.92 + Math.sin(this.time * 32) * 0.14;
          rig.shockCage.scale.setScalar(sc);
        }
      }
      rig.aura.visible = Boolean(p.hasCrown || p.bounty);
      if (rig.aura.visible) rig.aura.scale.setScalar(1 + Math.sin(this.time * 7) * 0.08);

      const hf = this.hitFlash.get(p.id) || 0;
      rig.body.traverse((obj) => {
        if (obj.isMesh && obj.material && obj.material.emissive) {
          if (hf > 0) {
            obj.material.emissive.set('#ffffff');
            obj.material.emissiveIntensity = 0.85;
          } else if (p.submerged) {
            obj.material.emissive.set('#0284c7');
            obj.material.emissiveIntensity = 0.55;
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
          this.aimGuideMesh.position.set(sp.x, 3.6, sp.y);
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

  _syncProjectiles(projectiles, players = []) {
    const seen = new Set();
    // Clear previous frame grapple ropes
    for (const r of this.hookRopes) {
      this.dynamicGroup.remove(r);
      r.geometry?.dispose?.();
      r.material?.dispose?.();
    }
    this.hookRopes = [];

    for (const pr of projectiles) {
      seen.add(pr.id);
      // 🪝 Grapple Hook 3D taut rope connecting hook to its firing ship!
      if (pr.kind === 'hook' && pr.ownerId) {
        const ownerPos = this.smoothPos.get(pr.ownerId) || players.find(pl => pl.id === pr.ownerId);
        if (ownerPos) {
          const pts = [
            new THREE.Vector3(ownerPos.x, 12, ownerPos.y),
            new THREE.Vector3(pr.x, 11, pr.y)
          ];
          const rGeo = new THREE.BufferGeometry().setFromPoints(pts);
          const rMat = new THREE.LineBasicMaterial({ color: '#fde68a', transparent: true, opacity: 0.85 });
          const line = new THREE.Line(rGeo, rMat);
          this.dynamicGroup.add(line);
          this.hookRopes.push(line);
        }
      }
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

        const glow = this._makeGlowSprite(col, pr.firearm ? 44 : 30, pr.firearm ? 0.85 : 0.65);
        g.add(glow);

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
        const fuseGlow = this._makeGlowSprite('#fb923c', 18, 0.7);
        fuseGlow.position.y = 18.5;
        g.add(fuseGlow);
        g.add(this._makeContactShadow(14, 0.52));

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
        ring.position.y = 3.6;
        g.add(ring);
        g.add(this._makeContactShadow(16, 0.5));
        const puGlow = this._makeGlowSprite(col, 34, 0.5);
        puGlow.position.y = 12;
        g.add(puGlow);

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
        // Realistic floating wooden sea-barricade cluster (3 tilted pirate crates lashed together — NO giant dining table!)
        const offsets = [
          [-rad * 0.34, -rad * 0.2, 0.25, 22],
          [rad * 0.32, -rad * 0.14, 1.4, 20],
          [0, rad * 0.32, 0.8, 21]
        ];
        let added = 0;
        for (const [ox, oz, rot, sz] of offsets) {
          const c = this._cloneGLB('barricade', sz, -3, rot + (br.id % 4));
          if (c) {
            c.position.set(ox, 0, oz);
            c.rotation.z = (added - 1) * 0.12;
            g.add(c);
            added++;
          }
        }
        if (added === 0) {
          const fb = new THREE.Mesh(
            new THREE.BoxGeometry(rad * 1.2, 14, rad * 1.2),
            new THREE.MeshStandardMaterial({ color: '#92400e', roughness: 0.8 })
          );
          fb.position.y = 6;
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
        // Shattered wooden crate barricade -> scatter bobbing 3D wood planks!
        this._spawnWoodDebris(m.position.x, m.position.z, 4);
        this._spawnBurst(m.position.x, m.position.z, '#d97706', 8, 95, 70);
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
        if (z.kind === 'gravity') {
          // 🌀 3D Spinning Whirlpool Vortex Funnel + glowing concentric rings!
          const g = new THREE.Group();
          const base = new THREE.Mesh(
            new THREE.PlaneGeometry(z.r * 2.25, z.r * 2.25),
            new THREE.MeshBasicMaterial({ map: this.mistTex, color: '#a855f7', transparent: true, opacity: 0.42, depthWrite: false })
          );
          base.rotation.x = -Math.PI / 2;
          g.add(base);
          const funnel = new THREE.Mesh(
            new THREE.ConeGeometry(z.r * 0.72, 26, 20, 1, true),
            new THREE.MeshBasicMaterial({ color: '#c084fc', wireframe: true, transparent: true, opacity: 0.52, depthWrite: false })
          );
          funnel.rotation.x = Math.PI;
          funnel.position.y = 6;
          g.add(funnel);
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(z.r * 0.85, z.r, 32),
            new THREE.MeshBasicMaterial({ color: '#e879f9', transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false })
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 2.6;
          g.add(ring);
          this.dynamicGroup.add(g);
          this.zoneMeshes.set(z.id, g);
          m = g;
        } else {
          let col = '#0f172a';
          let op = 0.72;
          if (z.kind === 'flare') { col = '#fb7185'; op = 0.25; }
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
      }
      m.position.set(z.x, z.kind === 'ink' ? 10 : 2.3, z.y);
      if (z.kind === 'gravity') m.rotation.y += 0.065;
      else if (z.kind === 'ink') m.rotation.z += 0.025;
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
    const kr = this.krakenRig;
    kr.group.visible = true;
    const enraged = Boolean(kraken.enraged);
    const warn = Boolean(kraken.warn);
    const wp = kraken.warnPct || 0;

    // Slam impact splash & violet blast light the moment warning fires!
    if (kr.wasWarn && !warn) {
      this._spawnSplashPlume(kraken.x, kraken.y, enraged ? '#fb7185' : '#e879f9', 1.8);
      this._triggerBlastLight(kraken.x, kraken.y, enraged ? '#f43f5e' : '#d946ef', 7.5);
    }
    kr.wasWarn = warn;

    const bob = Math.sin(this.time * (enraged ? 5.2 : 2.8)) * (warn ? 6.5 : 3.8);
    kr.group.position.set(kraken.x, 0, kraken.y);
    kr.head.position.y = bob + (warn ? wp * 12 : 0);
    kr.head.rotation.y = -(kraken.aim || 0);
    kr.head.rotation.z = Math.sin(this.time * 3.1) * 0.08 + (warn ? -wp * 0.18 : 0);

    // Spinning whirlpool & churning foam
    kr.vortex.rotation.z += enraged ? 0.055 : 0.024;
    kr.foamRing.rotation.z -= enraged ? 0.042 : 0.018;
    const fSc = 0.96 + Math.sin(this.time * 3.2) * 0.08;
    kr.foamRing.scale.set(fSc, fSc, 1);

    // 3D Slam Telegraph Danger Ring!
    kr.warnOuter.visible = warn;
    kr.warnFill.visible = warn;
    if (warn) {
      const rScale = Math.max(16, (kraken.slamR || 150) * wp);
      kr.warnFill.scale.set(rScale, rScale, 1);
      kr.warnOuter.material.color.set(enraged ? '#ff4d6d' : '#f0abfc');
      kr.warnFill.material.opacity = 0.18 + wp * 0.24;
    }

    // Enraged Vortex Boundary Ring + Fiery Red Eyes + Rising Purple Sparks!
    kr.rageRing.visible = enraged;
    if (enraged) {
      kr.rageRing.material.opacity = 0.24 + Math.sin(this.time * 8) * 0.12;
      if (Math.random() < 0.25) {
        this._spawnBurst(kraken.x + (Math.random() - 0.5) * 80, kraken.y + (Math.random() - 0.5) * 80, '#f43f5e', 1, 35, 85);
      }
    }
    const eyeCol = enraged ? '#ff2a55' : '#fde047';
    kr.eyeMat.color.set(eyeCol);
    for (const eg of kr.eyeGlows) {
      eg.material.color.set(eyeCol);
      eg.scale.setScalar(enraged ? 40 + Math.sin(this.time * 14) * 6 : 32);
    }

    // Choreographed 8 S-Curved Tentacles (rear up dramatically during slam warning!)
    const spd = warn ? 11.5 : (enraged ? 6.5 : 3.8);
    for (const t of kr.tentacles) {
      const wave = Math.sin(this.time * spd + t.idx * 0.85);
      t.group.rotation.y = t.baseA + Math.sin(this.time * 1.4 + t.idx) * 0.16;
      // Rear high into the air during telegraph, lash out wildly when enraged!
      t.arm.rotation.z = warn ? (0.36 + wp * 0.42 + wave * 0.12) : (wave * (enraged ? 0.26 : 0.16));
      t.arm.position.y = bob * 0.6 + (warn ? wp * 14 : Math.cos(this.time * spd * 0.8 + t.idx) * 5);
    }
  }

  // 🐙 Perimeter Edge Tentacles erupting from map borders and slamming inward!
  _syncEdgeTentacles(list) {
    const seen = new Set();
    if (!this._edgeTentGeo) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-12, -8, 0),
        new THREE.Vector3(24, 58, 6),
        new THREE.Vector3(74, 88, -6),
        new THREE.Vector3(122, 54, 4),
        new THREE.Vector3(148, 18, 0)
      ]);
      const geo = new THREE.TubeGeometry(curve, 20, 8.5, 10, false);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const frac = Math.max(0, Math.min(1, (pos.getX(i) + 12) / 160));
        const c = curve.getPoint(frac);
        const taper = 1.3 - frac * 0.92;
        pos.setXYZ(
          i,
          c.x + (pos.getX(i) - c.x) * taper,
          c.y + (pos.getY(i) - c.y) * taper,
          c.z + (pos.getZ(i) - c.z) * taper
        );
      }
      geo.computeVertexNormals();
      this._edgeTentGeo = geo;
      this._edgeTentCurve = curve;
    }

    for (const et of list) {
      seen.add(et.id);
      let rig = this.edgeTentMeshes.get(et.id);
      if (!rig) {
        const root = new THREE.Group();
        const skinMat = new THREE.MeshStandardMaterial({ color: '#6b21a8', roughness: 0.3, metalness: 0.18 });
        const cupMat = new THREE.MeshStandardMaterial({ color: '#f5d0fe', roughness: 0.4, emissive: '#c026d3', emissiveIntensity: 0.3 });

        const pivot = new THREE.Group();
        const arm = new THREE.Mesh(this._edgeTentGeo, skinMat);
        arm.castShadow = true;
        pivot.add(arm);
        for (const f of [0.22, 0.42, 0.62, 0.8]) {
          const pt = this._edgeTentCurve.getPoint(f);
          const cup = new THREE.Mesh(this._sharedGeo.sphere, cupMat);
          cup.scale.setScalar(4.4 - f * 2.2);
          cup.position.set(pt.x, pt.y - 4.5, pt.z);
          pivot.add(cup);
        }
        root.add(pivot);

        // Telegraph danger ring + growing red fill at inward impact zone
        const warnOuter = new THREE.Mesh(
          new THREE.RingGeometry(et.r - 5, et.r, 36),
          new THREE.MeshBasicMaterial({ color: '#f0abfc', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
        );
        warnOuter.rotation.x = -Math.PI / 2;
        warnOuter.position.set(74, 2.8, 0);
        root.add(warnOuter);

        const warnFill = new THREE.Mesh(
          new THREE.CircleGeometry(1, 32),
          new THREE.MeshBasicMaterial({ color: '#f43f5e', transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })
        );
        warnFill.rotation.x = -Math.PI / 2;
        warnFill.position.set(74, 2.6, 0);
        root.add(warnFill);

        // Churning purple surf foam at border eruption anchor
        const baseFoam = new THREE.Mesh(
          new THREE.PlaneGeometry(76, 76),
          new THREE.MeshBasicMaterial({ map: this.shoreFoamTex, color: '#e879f9', transparent: true, opacity: 0.6, depthWrite: false })
        );
        baseFoam.rotation.x = -Math.PI / 2;
        baseFoam.position.set(0, 2.1, 0);
        root.add(baseFoam);

        this.dynamicGroup.add(root);
        rig = { root, pivot, warnOuter, warnFill, baseFoam, slammed: false };
        this.edgeTentMeshes.set(et.id, rig);
      }

      rig.root.position.set(et.x, 0, et.y);
      rig.root.rotation.y = -et.angle;
      rig.baseFoam.rotation.z += 0.04;

      if (et.phase === 'warn') {
        const p = et.pct || 0;
        rig.warnOuter.visible = true;
        rig.warnFill.visible = true;
        const sc = Math.max(12, et.r * p);
        rig.warnFill.scale.set(sc, sc, 1);
        rig.warnFill.material.opacity = 0.16 + p * 0.28;
        // Rise menacingly from border water & rear back!
        rig.pivot.position.y = -72 + p * 74;
        rig.pivot.rotation.z = 0.45 + p * 0.35 + Math.sin(this.time * 16 + et.id) * 0.06;
      } else {
        rig.warnOuter.visible = false;
        rig.warnFill.visible = false;
        const p = et.pct || 0;
        if (!rig.slammed) {
          rig.slammed = true;
          const ix = et.x + et.nx * 74;
          const iy = et.y + et.ny * 74;
          this._spawnSplashPlume(ix, iy, '#e879f9', 1.45);
          this._triggerBlastLight(ix, iy, '#d946ef', 5.5);
        }
        if (p < 0.22) {
          // Whip forward and SLAM flat into the ocean!
          const slamT = p / 0.22;
          rig.pivot.rotation.z = 0.8 - slamT * 1.15;
          rig.pivot.position.y = 2 - slamT * 12;
        } else {
          // Submerge smoothly back into the abyssal waves
          const sinkT = (p - 0.22) / 0.78;
          rig.pivot.rotation.z = -0.35 - sinkT * 0.25;
          rig.pivot.position.y = -10 - sinkT * 95;
        }
      }
    }

    for (const [id, rig] of this.edgeTentMeshes.entries()) {
      if (!seen.has(id)) {
        this.dynamicGroup.remove(rig.root);
        this.edgeTentMeshes.delete(id);
      }
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

  _syncMegaChest(mc) {
    if (!mc) {
      if (this.megaChestRig) this.megaChestRig.group.visible = false;
      return;
    }
    if (!this.megaChestRig) {
      const g = new THREE.Group();
      const spin = new THREE.Group();
      const glb = this._cloneGLB('chest', 36, 4, 0, '#ffd166');
      if (glb) spin.add(glb);
      else {
        const fb = new THREE.Mesh(new THREE.BoxGeometry(26, 20, 20), new THREE.MeshStandardMaterial({ color: '#ffd166', roughness: 0.3 }));
        fb.position.y = 14;
        spin.add(fb);
      }
      g.add(spin);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(18, 28, 180, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
      );
      beam.position.y = 90;
      g.add(beam);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(mc.r - 4, mc.r, 36),
        new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 3.6;
      g.add(ring);
      g.add(this._makeContactShadow(26, 0.55));
      const mcGlow = this._makeGlowSprite('#ffd166', 78, 0.72);
      mcGlow.position.y = 20;
      g.add(mcGlow);
      this.dynamicGroup.add(g);
      this.megaChestRig = { group: g, spin, ring };
    }
    this.megaChestRig.group.visible = true;
    this.megaChestRig.group.position.set(mc.x, 0, mc.y);
    this.megaChestRig.spin.position.y = Math.sin(this.time * 3.5) * 3.5;
    this.megaChestRig.spin.rotation.y = this.time * 1.2;
    this.megaChestRig.ring.material.color.set(mc.contested ? '#ef476f' : '#ffd166');
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
      const scr = this._worldToScreen(k.x, 86, k.y);
      if (scr.inFront) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = '900 12.5px system-ui, sans-serif';
        ctx.fillStyle = k.enraged ? '#fda4af' : '#f0abfc';
        ctx.fillText(k.enraged ? `🔥 ÖFKELİ KRAKEN (${Math.ceil(k.hp)}/${k.maxHp})` : `🐙 KRAKEN (${Math.ceil(k.hp)}/${k.maxHp})`, scr.x, scr.y - 12);
        const bw = 104;
        ctx.fillStyle = 'rgba(2, 10, 22, 0.85)';
        ctx.fillRect(scr.x - bw / 2, scr.y - 7, bw, 8);
        ctx.fillStyle = k.enraged ? '#f43f5e' : '#d946ef';
        ctx.fillRect(scr.x - bw / 2, scr.y - 7, bw * Math.max(0, k.hp / k.maxHp), 8);
        ctx.restore();
      }
    }

    // 3. Rescue Buoy & Mega Chest Progress + 2v2 Team Pings!
    if (state.megaChest) {
      const mc = state.megaChest;
      const scr = this._worldToScreen(mc.x, 52, mc.y);
      if (scr.inFront) {
        const pct = Math.round(((mc.progress || 0) / (mc.duration || 2.5)) * 100);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = '900 12.5px system-ui, sans-serif';
        ctx.fillStyle = mc.contested ? '#fda4af' : '#fef08a';
        ctx.fillText(mc.contested ? '⚔️ ÇEKİŞMELİ SANDIK!' : `💎 BÜYÜK SANDIK ${pct}%`, scr.x, scr.y - 12);
        const bw = 82;
        ctx.fillStyle = 'rgba(2, 10, 22, 0.85)';
        ctx.fillRect(scr.x - bw / 2, scr.y - 6, bw, 6);
        ctx.fillStyle = mc.contested ? '#ef476f' : '#ffd166';
        ctx.fillRect(scr.x - bw / 2, scr.y - 6, bw * (pct / 100), 6);
        ctx.restore();
      }
    }
    for (const pg of state.pings || []) {
      if (me && pg.team !== me.team) continue;
      const scr = this._worldToScreen(pg.x, 12, pg.y);
      if (!scr.inFront) continue;
      const alpha = Math.max(0, Math.min(1, pg.life / 1.2));
      const wave = (this.time * 2.2) % 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.arc(scr.x, scr.y, 12 + wave * 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = '900 12px system-ui, sans-serif';
      ctx.fillStyle = '#ffd166';
      ctx.fillText(`📍 ${pg.by}`, scr.x, scr.y - 18);
      ctx.restore();
    }
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
      // 💨 Speed Wind Lines around screen edges when boosted / surfing turbo currents!
      const spdNow = Math.hypot(me.vx || 0, me.vy || 0);
      if (this.quality !== 'low' && ((me.speedBoostSec || 0) > 0 || me.inCurrent || spdNow > 285)) {
        ctx.save();
        ctx.strokeStyle = me.inCurrent ? 'rgba(125, 245, 255, 0.28)' : 'rgba(255, 244, 204, 0.24)';
        ctx.lineWidth = 1.6;
        const cx = this.viewW / 2;
        const cy = this.viewH / 2;
        const baseR = Math.min(this.viewW, this.viewH) * 0.42;
        const maxR = Math.hypot(cx, cy);
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2 + Math.sin(this.time * 6 + i) * 0.05;
          const phase = ((this.time * 3.8 + i * 0.37) % 1);
          const r0 = baseR + phase * (maxR - baseR) * 0.55;
          const r1 = r0 + 55 + phase * 45;
          ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        }
        ctx.stroke();
        ctx.restore();
      }
      // 🩸 Low-HP heartbeat crimson edge vignette (<34% HP)
      const hpRatio = (me.hp || 0) / Math.max(1, me.maxHp || 120);
      if (hpRatio < 0.34) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 7.5);
        const alpha = (1 - hpRatio / 0.34) * (0.2 + pulse * 0.16);
        const rVig = ctx.createRadialGradient(
          this.viewW / 2, this.viewH / 2, Math.min(this.viewW, this.viewH) * 0.32,
          this.viewW / 2, this.viewH / 2, Math.max(this.viewW, this.viewH) * 0.72
        );
        rVig.addColorStop(0, 'rgba(220, 38, 38, 0)');
        rVig.addColorStop(1, `rgba(220, 38, 38, ${alpha.toFixed(3)})`);
        ctx.fillStyle = rVig;
        ctx.fillRect(0, 0, this.viewW, this.viewH);
      }
    }

    // 6. Minimap
    this._drawMinimap(ctx, state, map, me);

    // 6b. 🎬 Son Vuruş Ağır Çekim sinematik çerçeve!
    if (state.slowMo) {
      ctx.save();
      ctx.fillStyle = 'rgba(2, 8, 16, 0.72)';
      ctx.fillRect(0, 0, this.viewW, 38);
      ctx.fillRect(0, this.viewH - 38, this.viewW, 38);
      ctx.textAlign = 'center';
      ctx.font = '900 18px system-ui, sans-serif';
      ctx.fillStyle = '#ffd166';
      ctx.fillText('🎬 SON VURUŞ!', this.viewW / 2, 26);
      ctx.restore();
    }

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
    if (state.megaChest) {
      const mx0 = state.megaChest.x * sx;
      const my0 = state.megaChest.y * sy;
      ctx.fillStyle = '#ffd166';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(mx0, my0 - 5.5);
      ctx.lineTo(mx0 + 5.5, my0);
      ctx.lineTo(mx0, my0 + 5.5);
      ctx.lineTo(mx0 - 5.5, my0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    for (const pg of state.pings || []) {
      if (me && pg.team !== me.team) continue;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(pg.x * sx, pg.y * sy, 4.5 + Math.sin(this.time * 10) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
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
    this._clearGroup(this.ultraDecorGroup);
    this._clearGroup(this.dynamicGroup);
    this._clearGroup(this.fxGroup);
    this.skyDome?.geometry?.dispose?.();
    this.skyDome?.material?.dispose?.();
    this.oceanMat?.dispose?.();
    this.mistTex?.dispose?.();
    this.currentTex?.dispose?.();
    this.glowTex?.dispose?.();
    this.shadowTex?.dispose?.();
    this.shoreFoamTex?.dispose?.();
    this.wakeTex?.dispose?.();
    this.aimTex?.dispose?.();
    this._envRT?.dispose?.();
    this.renderer.dispose();
  }
}
