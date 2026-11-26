// İKİ İTEMLİ OYUN — Kalıcı Regresyon + 100 Maçlık Kaos & Stres Test Paketi
// Çalıştırma: node tests/run_tests.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  GAME_VERSION,
  WORLD_W,
  WORLD_H,
  CHARACTERS,
  HUNTER_ITEMS,
  PREY_ITEMS,
  FFA_ITEMS,
  ALL_ITEMS,
  ROUND_EVENTS,
  SKILL_TREE,
  SKILL_NODE_MAP,
  SEA_MAPS
} from '../js/data.js';
import { GameSim } from '../js/sim.js';
import { SeaRenderer } from '../js/render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const failures = [];
let checksPassed = 0;

function check(cond, msg) {
  if (!cond) {
    failures.push(msg);
  } else {
    checksPassed++;
  }
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// ============================================================
// 1. SÜRÜM & ÖNBELLEK TUTARLILIĞI + HARİTA GEOMETRİ DENETİMİ
// ============================================================
console.log('=== 1/4: Sürüm, Veri ve Harita Geometri Denetimi ===');

const verNum = GAME_VERSION.replace(/^v/, '');
const versionFiles = ['index.html', 'js/main.js', 'js/sim.js', 'js/render.js', 'js/render3d.js'];
for (const rel of versionFiles) {
  const txt = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const matches = [...txt.matchAll(/\?v=([0-9.a-z]+)/g)].map(m => m[1]);
  for (const m of matches) {
    check(m === verNum, `[SÜRÜM] ${rel} içinde eski '?v=${m}' bulundu (beklenen: ${verNum})`);
  }
}
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
check(indexHtml.includes(`>${GAME_VERSION}</button>`), `[SÜRÜM] index.html versiyon rozeti ${GAME_VERSION} ile eşleşmiyor`);

check(CHARACTERS.length === 6, `[VERİ] 6 çar bekleniyor, bulunan: ${CHARACTERS.length}`);
check(HUNTER_ITEMS.length === 10 && PREY_ITEMS.length === 10 && FFA_ITEMS.length === 20, `[VERİ] İtem sayıları hatalı`);
check(ROUND_EVENTS.length === 8, `[VERİ] 8 tur olayı bekleniyor, bulunan: ${ROUND_EVENTS.length}`);
check(SEA_MAPS.length === 6, `[VERİ] 6 harita bekleniyor, bulunan: ${SEA_MAPS.length}`);

// Harita geometri denetimi: spawn, barrel, powerup, breakable kayaya veya kumsala gömülü mü?
const geoSim = new GameSim();
for (const map of SEA_MAPS) {
  geoSim.breakables = [];
  const minY = map.beach ? map.beach.sandY + 20 : 25;
  for (const [label, list, rad] of [
    ['hunterSpawns', map.hunterSpawns, 20],
    ['preySpawns', map.preySpawns, 20],
    ['powerupSpots', map.powerupSpots, 18],
    ['barrelSpots', map.barrelSpots || [], 17],
    ['breakables', map.breakables || [], 28]
  ]) {
    for (let idx = 0; idx < list.length; idx++) {
      const pt = list[idx];
      const inBounds = pt.x >= 24 && pt.x <= WORLD_W - 24 && pt.y >= minY && pt.y <= WORLD_H - 24;
      check(inBounds, `[HARİTA] ${map.id}.${label}[${idx}] (${pt.x},${pt.y}) sınır/kumsal dışında!`);
      const hitsRock = geoSim._hitsObstacle(pt.x, pt.y, rad, map);
      check(!hitsRock, `[HARİTA] ${map.id}.${label}[${idx}] (${pt.x},${pt.y}) bir kaya/geminin içine gömülü!`);
    }
  }
}

// ============================================================
// 2. TÜM 20 İTEM + AYNA + DALIŞ + KRAKEN + BARİKAT MATRİSİ
// ============================================================
console.log('=== 2/4: Tüm 20 İtem Etkileşim Matrisi ===');

for (const itemDef of FFA_ITEMS) {
  try {
    const sim = new GameSim();
    sim.addHuman('p1', 'Tester1');
    sim.addHuman('p2', 'Tester2');
    sim.switchTeam('p2');
    sim.updateSettings({ mode: 'ffa', mapMode: '0', lives: 2, skillTree: true, roundEvents: true });
    sim.startMatch();
    sim.roundEvent = 'kraken_uyanisi';
    const slot1 = sim.slots.find(s => s.id === 'p1');
    slot1.skills = ['atk1', 'atk2', 'atk3', 'deep1', 'deep2', 'deep3', 'def1', 'def2', 'def3'];
    sim.setPlayerItems('p1', [itemDef.id, 'electric_net'], true);
    sim.setPlayerItems('p2', ['mirror_shield', 'kelp_trail'], true);
    for (let i = 0; i < 85; i++) sim.step(0.05);
    sim.krakenSpawnTimer = 0.01;
    sim.step(0.05);

    const p1 = sim.players.find(p => p.id === 'p1');
    const p2 = sim.players.find(p => p.id === 'p2');
    p1.x = 350; p1.y = 360;
    p2.x = 480; p2.y = 360;
    p1.items[0] = { id: itemDef.id, usesLeft: 2, maxUses: 2, firearm: Boolean(itemDef.firearm), longCd: false, cd: 0 };

    // Normal atış
    sim.triggerItem('p1', 0, 0);
    for (let i = 0; i < 25; i++) sim.step(0.02);

    // Ayna kalkanına karşı atış
    p2.alive = true; p2.hp = p2.maxHp; p2.breath = p2.maxBreath; p2.mirrorTimer = 2.0;
    p1.items[0].usesLeft = 2; p1.items[0].cd = 0;
    sim.triggerItem('p1', 0, 0);
    for (let i = 0; i < 25; i++) sim.step(0.02);

    // Su altındaki hedefe karşı atış
    p2.alive = true; p2.mirrorTimer = 0; p2.submerged = true; p2.breath = 70;
    p1.items[0].usesLeft = 2; p1.items[0].cd = 0;
    sim.triggerItem('p1', 0, 0);
    for (let i = 0; i < 20; i++) sim.step(0.02);

    for (const p of sim.players) {
      check(isNum(p.x) && isNum(p.y) && isNum(p.hp) && isNum(p.breath), `[İTEM:${itemDef.id}] Oyuncu NaN değer üretti!`);
    }
    JSON.stringify(sim.getStateSnapshot());
    checksPassed++;
  } catch (err) {
    failures.push(`[İTEM:${itemDef.id}] Çöktü: ${err.stack || err.message}`);
  }
}

// 2b. Host Tur Olayı Seçici (eventMode) doğrulama
{
  const evSim = new GameSim();
  evSim.addHuman('p1', 'Host');
  evSim.updateSettings({ eventMode: 'off' });
  evSim.startMatch();
  check(evSim.settings.eventMode === 'off' && evSim.settings.roundEvents === false && evSim.roundEvent === null, '[EVENT_MODE] off ayarında olay null olmalı!');
  evSim.backToLobby();
  evSim.updateSettings({ roundEvents: true });
  evSim.startDraft();
  check(evSim.settings.eventMode === 'random' && evSim.roundEvent !== null, '[EVENT_MODE] roundEvents:true geriye uyumluluğu random olmalı!');
  for (const ev of ROUND_EVENTS) {
    evSim.backToLobby();
    evSim.updateSettings({ eventMode: ev.id });
    evSim.startDraft();
    check(evSim.roundEvent === ev.id && evSim.settings.roundEvents === true, `[EVENT_MODE] ${ev.id} sabitlendiğinde doğrudan seçilmeli!`);
  }
}

// 2c. 🌊 Tsunami (8. Tur Olayı) mekanik doğrulama (Açıkta hasar, SHIFT dalış, Kaya siperi, Fıçı sürükleme)
{
  const tSim = new GameSim();
  tSim.addHuman('p1', 'Exposed');
  tSim.addHuman('p2', 'Diver');
  tSim.switchTeam('p2');
  tSim.updateSettings({ mode: 'ffa', mapMode: '0', eventMode: 'tsunami', lives: 2, barrels: true });
  tSim.startMatch();
  tSim.setPlayerItems('p1', ['electric_net', 'kelp_trail'], true);
  tSim.setPlayerItems('p2', ['mirror_shield', 'kelp_trail'], true);
  for (let i = 0; i < 125; i++) tSim.step(0.05);

  const p1 = tSim.players.find(p => p.id === 'p1');
  const p2 = tSim.players.find(p => p.id === 'p2');
  // Open water spot (no rock directly west within 220px)
  p1.x = 260; p1.y = 200; p1.submerged = false; p1.charId = 'kaptan';
  p2.x = 260; p2.y = 800; p2.submerged = true; p2.breath = 70;
  const p1Before = p1.hp + p1.breath;
  const p2Before = p2.hp + p2.breath;

  tSim.tsunami = { id: 9999, dir: 'E', dx: 1, dy: 0, state: 'sweeping', timer: 0, maxTelegraph: 2.3, pos: 210, speed: 435, thickness: 78, hitIds: [] };
  tSim.barrels = [{ id: 8888, x: 260, y: 260, vx: 0, vy: 0, r: 19, hp: 30, maxHp: 30 }];
  for (let i = 0; i < 10; i++) tSim.step(0.03);

  check(p1.hp + p1.breath < p1Before && p1.x > 290, '[TSUNAMI] Açıkta yakalanan oyuncu hasar ve savrulma almalı!');
  check(p2.hp === p2.maxHp, '[TSUNAMI] Su altında (SHIFT) olan oyuncu hasar almamalı!');
  check((tSim.barrels[0]?.vx || 0) > 40, '[TSUNAMI] Barut fıçısı dalgayla sürüklenmeli!');

  // Rock shelter check: pick first circular rock on map 0 and stand right east of it
  const rock = tSim.currentMap.rocks.find(r => r.type === 'rock');
  if (rock) {
    p1.alive = true; p1.hp = p1.maxHp; p1.breath = p1.maxBreath; p1.vx = 0; p1.vy = 0; p1.submerged = false;
    p1.x = rock.x + rock.r + 30;
    p1.y = rock.y;
    const shBefore = p1.hp + p1.breath;
    tSim.tsunami = { id: 10000, dir: 'E', dx: 1, dy: 0, state: 'sweeping', timer: 0, maxTelegraph: 2.3, pos: p1.x - 45, speed: 435, thickness: 78, hitIds: [] };
    for (let i = 0; i < 10; i++) tSim.step(0.03);
    check(p1.hp + p1.breath >= shBefore - 0.1, '[TSUNAMI] Kaya arkasında siperde olan oyuncu hasar almamalı!');
  }
}

// ============================================================
// 3. 80 TAM MAÇLIK KAOS / STRES SİMÜLASYONU (HEADLESS FUZZ)
// ============================================================
console.log('=== 3/4: 80 Tam Maçlık Kaos & Stres Simülasyonu ===');

const MODES = ['2v2', '1v1', 'ffa', 'crown'];
const LIVES_OPTS = [1, 2, 3];
const DUR_OPTS = [45, 60, 85, 120, 180];
let totalMatchesDone = 0;
let totalRoundsDone = 0;
let totalTicks = 0;
let chaosErrors = 0;
const MAX_CHAOS_ERRS = 20;

function recordChaosErr(msg) {
  if (chaosErrors < MAX_CHAOS_ERRS) failures.push(msg);
  chaosErrors++;
}

for (let m = 0; m < 80; m++) {
  const mode = MODES[m % MODES.length];
  const mapIdx = m % SEA_MAPS.length;
  const lives = LIVES_OPTS[m % LIVES_OPTS.length];
  const dur = DUR_OPTS[m % DUR_OPTS.length];
  const evDef = ROUND_EVENTS[m % ROUND_EVENTS.length];

  try {
    const sim = new GameSim();
    sim.addHuman('h1', 'AGA');
    if (m % 2 === 0) {
      sim.addHuman('h2', 'Arkadas');
      if (mode === '2v2' || mode === '1v1') sim.switchTeam('h2');
    }
    sim.updateSettings({
      mode,
      mapMode: String(mapIdx),
      lives,
      roundDuration: dur,
      totalRounds: 2,
      skillTree: m % 3 !== 0,
      roundEvents: true,
      firearmMode: m % 4 === 0 ? 'long_cd' : 'single',
      powerups: true,
      barrels: true,
      storm: true,
      rescue: true
    });
    sim.fillEmptyWithBots();
    sim.startMatch();

    let ticks = 0;
    let lastRound = 0;
    let disconnectedOnce = false;
    const maxMatchTicks = 22000; // ~1100s simülasyon süresi tavanı -> sonsuz döngü tespiti!

    while (sim.phase !== 'match_end' && ticks < maxMatchTicks) {
      ticks++;
      totalTicks++;

      if (sim.phase === 'draft') {
        if (sim.round !== lastRound) {
          lastRound = sim.round;
          sim.roundEvent = evDef.id;
        }
        // İnsan oyuncular rastgele yetenek & 2 item seçip onaylasın
        for (const s of sim.getActiveSlots(true)) {
          if (s.id && !s.isBot && !s.readyItems) {
            if (s.skillPoints > 0) {
              const avail = Object.values(SKILL_NODE_MAP).filter(n => !s.skills.includes(n.id) && (!n.prereq || s.skills.includes(n.prereq)));
              if (avail.length > 0) sim.unlockSkill(s.id, avail[Math.floor(Math.random() * avail.length)].id);
            }
            const role = sim.getTeamRole(s.team);
            sim.setPlayerItems(s.id, sim._botPickItems(role), true);
          }
        }
      } else if (sim.phase === 'playing') {
        // Rastgele insan girdileri + dalış + space + item + emote + rastgele kopma!
        for (const p of sim.players) {
          if (!p.isBot && p.alive) {
            if (ticks % 12 === 0) {
              sim.setInput(p.id, {
                mx: (Math.random() - 0.5) * 2,
                my: (Math.random() - 0.5) * 2,
                aim: Math.random() * Math.PI * 2
              });
            }
            if (ticks % 23 === 0) sim.triggerItem(p.id, Math.random() < 0.5 ? 0 : 1, Math.random() * Math.PI * 2);
            if (ticks % 31 === 0) sim.triggerSpace(p.id, Math.random() * Math.PI * 2);
            if (ticks % 47 === 0) sim.toggleDive(p.id);
            if (ticks % 89 === 0) sim.triggerEmote(p.id, ticks % 4);
          }
        }
        // Her 10. maçta ortada bir insan oyuncuyu düşür (bot dönüşümünü stres test et!)
        if (m % 10 === 5 && !disconnectedOnce && ticks === 300) {
          disconnectedOnce = true;
          sim.removeHuman('h2');
        }
      }

      sim.step(0.05);

      if (sim.phase === 'round_end' && ticks % 20 === 0) {
        totalRoundsDone++;
      }

      // Her 25 karede katı değişmez (invariant) denetimi!
      if (ticks % 25 === 0) {
        const map = sim.currentMap;
        const minY = map.beach ? map.beach.sandY : 0;
        for (const p of sim.players) {
          if (!isNum(p.x) || !isNum(p.y) || !isNum(p.vx) || !isNum(p.vy) || !isNum(p.hp) || !isNum(p.breath)) {
            recordChaosErr(`[KAOS m=${m} ${mode}/${map.id}] Oyuncu NaN: ${p.name}`);
          }
          if (p.alive && (p.x < 0 || p.x > WORLD_W || p.y < minY - 4 || p.y > WORLD_H + 4)) {
            recordChaosErr(`[KAOS m=${m} ${mode}/${map.id}] Oyuncu sınır/kumsal dışında: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) minY=${minY}`);
          }
        }
        for (const pr of sim.projectiles) {
          if (!isNum(pr.x) || !isNum(pr.y) || !isNum(pr.vx) || !isNum(pr.vy)) {
            recordChaosErr(`[KAOS m=${m}] Mermi NaN!`);
          }
        }
        if (sim.crown && (!isNum(sim.crown.x) || !isNum(sim.crown.y))) {
          recordChaosErr(`[KAOS m=${m}] Altın Taç NaN!`);
        }
        if (sim.crown && !sim.crown.holderId && sim._hitsObstacle(sim.crown.x, sim.crown.y, 10, map)) {
          recordChaosErr(`[KAOS m=${m} ${map.id}] Düşen Altın Taç engelin içinde kaldı! (${sim.crown.x.toFixed(1)}, ${sim.crown.y.toFixed(1)})`);
        }
        if (sim.kraken && (!isNum(sim.kraken.x) || !isNum(sim.kraken.y) || !isNum(sim.kraken.hp))) {
          recordChaosErr(`[KAOS m=${m}] Kraken NaN!`);
        }
      }
    }

    check(sim.phase === 'match_end', `[KAOS m=${m} ${mode}/${SEA_MAPS[mapIdx].id}/lives=${lives}/ev=${evDef.id}] Maç bitmedi (takılı kaldı! phase=${sim.phase}, round=${sim.round})`);
    // Snapshot serileştirme + Rematch + backToLobby stres testi
    JSON.stringify(sim.getStateSnapshot());
    JSON.stringify(sim.getLobbySnapshot());
    if (m % 5 === 0) {
      sim.startMatch(); // Rematch
      sim.step(0.05);
      sim.backToLobby();
      check(sim.phase === 'lobby' && sim.kraken === null && sim.crown === null, `[KAOS m=${m}] backToLobby temizlenmedi!`);
    }
    totalMatchesDone++;
  } catch (err) {
    recordChaosErr(`[KAOS m=${m} ${mode}/map=${mapIdx}/ev=${evDef.id}] Çöktü: ${err.stack || err.message}`);
  }
}

// ============================================================
// 4. RENDERER DUMAN TESTİ (6 HARİTA × 6 ÇAR × KRAKEN × TAÇ × FENER)
// ============================================================
console.log('=== 4/4: Renderer Duman Testi (Tüm Haritalar & Efektler) ===');

try {
  globalThis.window = { devicePixelRatio: 1, innerWidth: 1920, innerHeight: 1080 };
  const noop = () => {};
  const fakeGrad = { addColorStop: noop };
  const fakeCtx = new Proxy({}, {
    get(_, prop) {
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => fakeGrad;
      if (prop === 'globalAlpha') return 1;
      return noop;
    },
    set() { return true; }
  });
  const fakeCanvas = { getContext: () => fakeCtx, clientWidth: 1920, clientHeight: 1080, width: 1920, height: 1080 };
  const renderer = new SeaRenderer(fakeCanvas);

  for (let mi = 0; mi < SEA_MAPS.length; mi++) {
    const sim = new GameSim();
    sim.addHuman('h1', 'AGA');
    sim.updateSettings({ mode: mi === 0 ? 'crown' : '2v2', mapMode: String(mi), lives: 3 });
    sim.fillEmptyWithBots();
    sim.startMatch();
    sim.roundEvent = mi === 1 ? 'kraken_uyanisi' : 'gece_sisi';
    sim.setPlayerItems('h1', ['harpoon_cannon', 'electric_net'], true);
    for (let i = 0; i < 85; i++) sim.step(0.05);
    if (sim.roundEvent === 'kraken_uyanisi') { sim.krakenSpawnTimer = 0.01; sim.step(0.05); }
    const snap = sim.getStateSnapshot();
    renderer.render(snap, 'h1', 0.016, 0.5, { x: snap.players[0].x, y: snap.players[0].y, vx: 0, vy: 0, round: 1 });
    checksPassed++;
  }
  renderer.renderHomeBg(fakeCanvas, 0.016);
  checksPassed++;
} catch (err) {
  failures.push(`[RENDERER] Çöktü: ${err.stack || err.message}`);
}

console.log('\n========================================');
console.log(`Toplam Kontrol: ${checksPassed} geçti | ${failures.length} hata`);
console.log(`Kaos İstatistiği: ${totalMatchesDone}/80 maç, ${totalTicks} simülasyon karesi`);
console.log('========================================');
if (failures.length > 0) {
  console.log('\n❌ BULUNAN BUGLAR:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
console.log('\n✅ TÜM TESTLER TEMİZ GEÇTİ — SIFIR HATA!');
