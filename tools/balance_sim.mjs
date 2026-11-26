// İKİ İTEMLİ OYUN — Denge Simülasyonu (bot maçlarından çar / item / harita / olay istatistiği)
// Çalıştırma: node tools/balance_sim.mjs [--matches2v2 300] [--matches1v1 300] [--out tools/out/balance.json]
//
// Oyunun kendi GameSim'i ile tamamen bot maçları oynatır. Her maçta çarlar rastgele (tekrarsız) dağıtılır,
// botlar itemlerini kendileri seçer (1 ateşli silah + 1 yardımcı). Oyun koduna dokunmaz, sadece ölçer.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CHARACTERS, HUNTER_ITEMS, PREY_ITEMS, ROUND_EVENTS, SEA_MAPS, GAME_VERSION } from '../js/data.js';
import { GameSim } from '../js/sim.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const N2 = Number(arg('matches2v2', 300));
const N1 = Number(arg('matches1v1', 300));
const OUT = path.resolve(process.cwd(), arg('out', path.join(__dirname, 'out', 'balance.json')));
const DT = 0.05;
const MAX_STEPS = 60000; // takılı maç koruması (~50 dk oyun süresi)

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function reasonKey(winnerRole, reason) {
  if (winnerRole === 'hunter') return 'hunter_sank_all';
  if (/Süre doldu/.test(reason)) return 'prey_timeout';
  return 'prey_sank_hunters';
}

function runMatch(mode, matchIdx) {
  const rows = [];
  let roundStartTime = 0;
  let prevStats = {};
  const sim = new GameSim((ev) => {
    if (ev.type === 'phase' && ev.phase === 'playing') roundStartTime = sim.matchTime;
    if (ev.type !== 'phase' || ev.phase !== 'round_end') return;
    const reason = reasonKey(sim.roundWinnerRole, sim.roundReason);
    const dur = sim.matchTime - roundStartTime;
    for (const p of sim.players) {
      const st = sim.matchStats[p.id] || {};
      const pv = prevStats[p.id] || {};
      rows.push({
        mode,
        match: matchIdx,
        round: sim.round,
        map: sim.currentMap.id,
        event: sim.roundEvent || 'none',
        team: p.team,
        role: p.role,
        char: p.charId,
        items: p.items.map(i => i.id),
        won: p.team === sim.roundWinnerTeam ? 1 : 0,
        reason,
        dur: Math.round(dur * 10) / 10,
        sinks: (st.sinks || 0) - (pv.sinks || 0),
        damage: Math.round((st.damage || 0) - (pv.damage || 0)),
        deaths: (st.deaths || 0) - (pv.deaths || 0),
        alive: p.alive ? 1 : 0
      });
      prevStats[p.id] = { ...st };
    }
  });
  sim.updateSettings({ mode });
  const chars = shuffle(CHARACTERS.map(c => c.id));
  sim.fillEmptyWithBots();
  sim.getActiveSlots().forEach((s, i) => { s.charId = chars[i]; });
  sim.startMatch();
  // 'playing' fazına geçişi yakalamak için _beginPlay'i sar
  const origBegin = sim._beginPlay.bind(sim);
  sim._beginPlay = () => { origBegin(); roundStartTime = sim.matchTime; };
  let steps = 0;
  while (sim.phase !== 'match_end' && steps < MAX_STEPS) {
    sim.step(DT);
    steps++;
  }
  return { rows, finished: sim.phase === 'match_end', steps };
}

const t0 = Date.now();
const all = [];
let stuck = 0;
let totalSteps = 0;
const plan = [['2v2', N2], ['1v1', N1]];
for (const [mode, n] of plan) {
  for (let m = 0; m < n; m++) {
    const r = runMatch(mode, m);
    all.push(...r.rows);
    totalSteps += r.steps;
    if (!r.finished) stuck++;
    if ((m + 1) % 25 === 0) {
      const sec = ((Date.now() - t0) / 1000).toFixed(0);
      process.stdout.write(`[${mode}] ${m + 1}/${n} maç — ${all.length} satır — ${sec}s\n`);
    }
  }
}

const meta = {
  version: GAME_VERSION,
  generatedAt: new Date().toISOString(),
  matches: { '2v2': N2, '1v1': N1 },
  stuckMatches: stuck,
  simSeconds: Math.round(totalSteps * DT),
  wallSeconds: Math.round((Date.now() - t0) / 1000),
  characters: CHARACTERS.map(c => ({ id: c.id, name: c.name, icon: c.icon, color: c.color })),
  hunterItems: HUNTER_ITEMS.map(i => ({ id: i.id, name: i.name, icon: i.icon, firearm: Boolean(i.firearm) })),
  preyItems: PREY_ITEMS.map(i => ({ id: i.id, name: i.name, icon: i.icon, firearm: Boolean(i.firearm) })),
  events: ROUND_EVENTS.map(e => ({ id: e.id, name: e.name, icon: e.icon })),
  maps: SEA_MAPS.map(m => ({ id: m.id, name: m.name }))
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ meta, rows: all }));
console.log(`\nBitti: ${all.length} oyuncu-tur satırı, ${stuck} takılı maç, ${meta.wallSeconds}s → ${OUT}`);
