// İKİ İTEMLİ OYUN — Denge analizi: balance_sim.mjs çıktısını özet istatistiğe çevirir.
// Çalıştırma: node tools/balance_analyze.mjs [girdi.json] [çıktı.json]
//
// Not: Botların hiç kullanmadığı itemler (BOT_UNUSED, simülasyonun saydığı kullanımlardan) raporda ayrıca işaretlenir.
// 1v1 en temiz çar sinyalidir: tur süresi = avın hayatta kalma süresi (avcı kazandıysa).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN = path.resolve(process.argv[2] || path.join(__dirname, 'out', 'balance.json'));
const OUT = path.resolve(process.argv[3] || path.join(__dirname, 'out', 'balance_summary.json'));
const { meta, rows } = JSON.parse(fs.readFileSync(IN, 'utf8'));
// v8.9 öncesi çıktılarda kullanım sayısı yok: o sürümlerde botlar bu 4 itemi hiç kullanmıyordu
const BOT_UNUSED = meta.itemUses
  ? [...meta.hunterItems, ...meta.preyItems].map(i => i.id).filter(id => !meta.itemUses[id])
  : ['electric_net', 'gravity_bomb', 'mirror_shield', 'kelp_trail'];

function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function stats(a) {
  const n = a.length;
  const m = mean(a);
  const sd = n > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1)) : 0;
  const ci = n > 1 ? 1.96 * sd / Math.sqrt(n) : 0;
  return { n, mean: +m.toFixed(2), ci: +ci.toFixed(2) };
}
function rate(wins, n) {
  // Wilson %95 aralığı
  if (!n) return { n: 0, rate: 0, lo: 0, hi: 0 };
  const z = 1.96, p = wins / n;
  const den = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / den;
  const h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / den;
  return { n, rate: +(p * 100).toFixed(1), lo: +((c - h) * 100).toFixed(1), hi: +((c + h) * 100).toFixed(1) };
}
const groupBy = (arr, keyFn) => arr.reduce((m, r) => { const k = keyFn(r); (m[k] ||= []).push(r); return m; }, {});

// Tur seviyesinde tekilleştir (her tur için bir satır)
function roundsOf(rs) {
  const g = groupBy(rs, r => `${r.mode}|${r.match}|${r.round}`);
  return Object.values(g).map(list => ({
    mode: list[0].mode, map: list[0].map, event: list[0].event, dur: list[0].dur, reason: list[0].reason,
    hunterWon: list.find(r => r.role === 'hunter')?.won ?? 0
  }));
}

const summary = { meta: { ...meta, botUnusedItems: BOT_UNUSED, rows: rows.length } };

for (const mode of ['2v2', '1v1']) {
  const mr = rows.filter(r => r.mode === mode);
  const rounds = roundsOf(mr);
  const sec = {};
  sec.rounds = rounds.length;
  sec.hunterWin = rate(rounds.filter(r => r.hunterWon).length, rounds.length);
  sec.duration = stats(rounds.map(r => r.dur));
  sec.reasons = Object.fromEntries(Object.entries(groupBy(rounds, r => r.reason)).map(([k, v]) => [k, +(v.length / rounds.length * 100).toFixed(1)]));
  sec.byMap = Object.entries(groupBy(rounds, r => r.map)).map(([k, v]) => ({ id: k, hunterWin: rate(v.filter(r => r.hunterWon).length, v.length), dur: stats(v.map(r => r.dur)) }));
  sec.byEvent = Object.entries(groupBy(rounds, r => r.event)).map(([k, v]) => ({ id: k, hunterWin: rate(v.filter(r => r.hunterWon).length, v.length), dur: stats(v.map(r => r.dur)) }));

  // Çarlar — rol bazında
  sec.chars = {};
  for (const role of ['hunter', 'prey']) {
    const rr = mr.filter(r => r.role === role);
    sec.chars[role] = Object.entries(groupBy(rr, r => r.char)).map(([k, v]) => ({
      id: k,
      win: rate(v.reduce((s, r) => s + r.won, 0), v.length),
      // Avcı: kazandığı turlarda bitirme süresi (düşük = iyi). Av: tur süresi (yüksek = iyi)
      dur: stats((role === 'hunter' ? v.filter(r => r.won) : v).map(r => r.dur)),
      damage: stats(v.map(r => r.damage)),
      sinks: stats(v.map(r => r.sinks)),
      alive: rate(v.reduce((s, r) => s + r.alive, 0), v.length)
    }));
  }

  // İtemler — rol bazında (sahip olunan tur)
  sec.items = {};
  for (const role of ['hunter', 'prey']) {
    const rr = mr.filter(r => r.role === role);
    const byItem = {};
    for (const r of rr) for (const id of r.items) (byItem[id] ||= []).push(r);
    sec.items[role] = Object.entries(byItem).map(([k, v]) => ({
      id: k,
      botUnused: BOT_UNUSED.includes(k),
      win: rate(v.reduce((s, r) => s + r.won, 0), v.length),
      dur: stats((role === 'hunter' ? v.filter(r => r.won) : v).map(r => r.dur)),
      damage: stats(v.map(r => r.damage)),
      alive: rate(v.reduce((s, r) => s + r.alive, 0), v.length)
    }));
    // Kombolar (ateşli × yardımcı)
    const byCombo = groupBy(rr, r => [...r.items].sort().join('+'));
    sec.combos = sec.combos || {};
    sec.combos[role] = Object.entries(byCombo).map(([k, v]) => ({
      id: k, n: v.length,
      dur: stats((role === 'hunter' ? v.filter(r => r.won) : v).map(r => r.dur)),
      win: rate(v.reduce((s, r) => s + r.won, 0), v.length)
    })).filter(c => c.n >= 40);
  }

  // 1v1 eşleşme matrisi: avcı çarı × av çarı → ortalama tur süresi
  if (mode === '1v1') {
    const pairs = groupBy(Object.values(groupBy(mr, r => `${r.match}|${r.round}`)), list => {
      const h = list.find(r => r.role === 'hunter');
      const p = list.find(r => r.role === 'prey');
      return `${h?.char}|${p?.char}`;
    });
    sec.matchups = Object.entries(pairs).map(([k, lists]) => {
      const [h, p] = k.split('|');
      return { hunter: h, prey: p, dur: stats(lists.map(l => l[0].dur)), hunterWin: rate(lists.filter(l => l.find(r => r.role === 'hunter')?.won).length, lists.length) };
    });
  }
  summary[mode] = sec;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(summary, null, 1));
console.log(`Özet yazıldı → ${OUT}`);

// 📦 Rapor sayfası için düz tablolar: her biri {rows, meta}; meta, sayıları üreten kodu taşır
const nameOf = (list, id) => (list.find(x => x.id === id) || {}).name || id;
const iconOf = (list, id) => (list.find(x => x.id === id) || {}).icon || '';
const allItems = [...meta.hunterItems, ...meta.preyItems];
const codeMeta = [
  { label: 'balance_sim.mjs', value: fs.readFileSync(path.join(__dirname, 'balance_sim.mjs'), 'utf8'), type: 'code', lang: 'javascript' },
  { label: 'balance_analyze.mjs', value: fs.readFileSync(fileURLToPath(import.meta.url), 'utf8'), type: 'code', lang: 'javascript' },
  { label: 'Girdi', value: `${meta.matches['2v2']} adet 2v2 + ${meta.matches['1v1']} adet 1v1 bot maçı (bot zorluğu: ${meta.botLevel || 'tek seviye'}), oyun sürümü ${meta.version}, ${meta.generatedAt.slice(0, 10)}` }
];
const tables = {
  overview: ['2v2', '1v1'].map(mode => {
    const s = summary[mode];
    return {
      mode, rounds: s.rounds, hunter_win: s.hunterWin.rate, hunter_win_lo: s.hunterWin.lo, hunter_win_hi: s.hunterWin.hi,
      avg_round_s: s.duration.mean,
      ended_hunter_sank_all: s.reasons.hunter_sank_all || 0,
      ended_prey_timeout: s.reasons.prey_timeout || 0,
      ended_prey_sank_hunters: s.reasons.prey_sank_hunters || 0
    };
  }),
  chars: ['2v2', '1v1'].flatMap(mode => ['hunter', 'prey'].flatMap(role => summary[mode].chars[role].map(c => ({
    key: `${mode}-${role}-${c.id}`, mode, role, char: c.id, name: nameOf(meta.characters, c.id), icon: iconOf(meta.characters, c.id),
    rounds: c.win.n, win: c.win.rate, win_lo: c.win.lo, win_hi: c.win.hi,
    time_s: c.dur.mean, time_ci: c.dur.ci, damage: c.damage.mean, sinks: c.sinks.mean, survived: c.alive.rate
  })))),
  items: ['2v2', '1v1'].flatMap(mode => ['hunter', 'prey'].flatMap(role => summary[mode].items[role].map(it => ({
    key: `${mode}-${role}-${it.id}`, mode, role, item: it.id, name: nameOf(allItems, it.id), icon: iconOf(allItems, it.id),
    firearm: (allItems.find(x => x.id === it.id) || {}).firearm ? 'evet' : 'hayır',
    bot_uses: it.botUnused ? 'hayır' : 'evet',
    rounds: it.win.n, win: it.win.rate, time_s: it.dur.mean, time_ci: it.dur.ci, damage: it.damage.mean, survived: it.alive.rate
  })))),
  matchups: (summary['1v1'].matchups || []).map(m => ({
    key: `${m.hunter}-${m.prey}`, hunter: m.hunter, prey: m.prey,
    hunter_name: nameOf(meta.characters, m.hunter), prey_name: nameOf(meta.characters, m.prey),
    rounds: m.dur.n, time_s: m.dur.mean, hunter_win: m.hunterWin.rate
  })),
  // Hiç oynanmayan haritalar da 0 turla listelenir (döngü 4 turda 6. haritaya hiç ulaşmaz)
  maps: ['2v2', '1v1'].flatMap(mode => meta.maps.map(mp => {
    const m = summary[mode].byMap.find(x => x.id === mp.id);
    return {
      key: `${mode}-${mp.id}`, mode, map: mp.id, name: mp.name, rounds: m ? m.hunterWin.n : 0,
      hunter_win: m ? m.hunterWin.rate : null, avg_round_s: m ? m.dur.mean : null, time_ci: m ? m.dur.ci : null
    };
  })),
  // Maç sonucu: hangi takım kazandı, kaç maç uzatmaya (5. tur) gitti
  match_winners: ['2v2', '1v1'].map(mode => {
    const byMatch = groupBy(rows.filter(r => r.mode === mode), r => r.match);
    let a = 0, b = 0, ot = 0;
    for (const list of Object.values(byMatch)) {
      const sc = { A: 0, B: 0 };
      const rounds = new Set();
      for (const r of list) { if (r.won) sc[r.team] += 1 / list.filter(x => x.round === r.round && x.team === r.team).length; rounds.add(r.round); }
      if (sc.A > sc.B) a++; else if (sc.B > sc.A) b++;
      if (Math.max(...rounds) > 4) ot++;
    }
    const n = Object.keys(byMatch).length;
    return { mode, matches: n, team_a_wins: a, team_b_wins: b, team_a_share: +(a / n * 100).toFixed(1), overtime_share: +(ot / n * 100).toFixed(1) };
  }),
  events: ['2v2', '1v1'].flatMap(mode => summary[mode].byEvent.map(e => ({
    key: `${mode}-${e.id}`, mode, event: e.id, name: e.id === 'none' ? 'Olay yok' : nameOf(meta.events, e.id), icon: iconOf(meta.events, e.id),
    rounds: e.hunterWin.n, hunter_win: e.hunterWin.rate, avg_round_s: e.dur.mean, time_ci: e.dur.ci
  })))
};
for (const [name, rowsOut] of Object.entries(tables)) {
  const p = path.join(path.dirname(OUT), `ds_${name}.json`);
  fs.writeFileSync(p, JSON.stringify({ rows: rowsOut, meta: codeMeta }));
}
console.log(`Rapor tabloları: ${Object.keys(tables).map(n => 'ds_' + n + '.json').join(', ')}`);
for (const mode of ['2v2', '1v1']) {
  const s = summary[mode];
  console.log(`\n=== ${mode}: ${s.rounds} tur | Avcı kazanma %${s.hunterWin.rate} [${s.hunterWin.lo}-${s.hunterWin.hi}] | ort. tur ${s.duration.mean}s`);
  console.log('Bitiş nedenleri:', s.reasons);
  for (const role of ['hunter', 'prey']) {
    console.log(`-- Çarlar (${role}) — kazanma%, ${role === 'hunter' ? 'bitirme süresi' : 'hayatta kalma'}(s), hasar/tur`);
    for (const c of [...s.chars[role]].sort((a, b) => b.dur.mean - a.dur.mean)) {
      console.log(`   ${c.id.padEnd(12)} %${String(c.win.rate).padStart(5)}  ${String(c.dur.mean).padStart(6)}±${c.dur.ci}  dmg ${c.damage.mean}  n=${c.win.n}`);
    }
  }
}
