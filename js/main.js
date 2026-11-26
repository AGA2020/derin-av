// DERİN AV — Main Controller (Web Worker Host Loop for Alt-Tab Safety, Client-Side Prediction for Zero-Lag Feel)

import {
  GAME_VERSION,
  CHANGELOG,
  ROUND_EVENT_MAP,
  BOAT_SKINS,
  SKILL_TREE,
  SKILL_NODE_MAP,
  WORLD_W,
  WORLD_H,
  CHARACTERS,
  CHAR_MAP,
  HUNTER_ITEMS,
  PREY_ITEMS,
  FFA_ITEMS,
  ALL_ITEMS,
  SEA_MAPS
} from './data.js?v=5.1';
import { sfx } from './audio.js?v=5.1';
import { NetClient, generateRoomCode, fetchCloudTelemetry, checkRoomAlive } from './net.js?v=5.1';
import { GameSim } from './sim.js?v=5.1';
import { SeaRenderer } from './render.js?v=5.1';

const $ = (id) => document.getElementById(id);

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Inline Web Worker timer: tarayıcı sekmesi arka plana atılsa / Alt+Tab yapılsa bile
// host simülasyonunu 60Hz'de DURMADAN çalıştırır!
function createBackgroundTicker(intervalMs, onTick) {
  try {
    const code = `setInterval(() => postMessage(Date.now()), ${intervalMs});`;
    const blob = new Blob([code], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    worker.onmessage = (e) => onTick(e.data);
    return {
      stop() {
        worker.terminate();
        URL.revokeObjectURL(url);
      }
    };
  } catch (_) {
    const id = setInterval(() => onTick(Date.now()), intervalMs);
    return { stop() { clearInterval(id); } };
  }
}

const app = {
  mode: 'menu', // menu | host | client | offline
  myName: localStorage.getItem('derinav_name') || '',
  mySkin: localStorage.getItem('derinav_skin') || 'auto',
  myId: null,
  roomCode: null,
  net: null,
  sim: null,
  hostTicker: null,
  lastSimNow: Date.now(),
  lobbyState: null,
  liveState: null,
  renderer: null,
  renderer3d: null,
  loading3d: false,
  viewMode: localStorage.getItem('derinav_view_mode') === '2d' ? '2d' : '3d',
  keys: new Set(),
  mouseX: 0,
  mouseY: 0,
  localAim: 0,
  // Client-side prediction state (istemci lagını sıfırlar!)
  pred: null, // { x, y, vx, vy, round }
  lastSentMoveKey: '',
  draftPicks: [],
  draftFilter: 'all',
  draftRoundSeen: -1,
  lastBroadcast: 0,
  lastInputSend: 0,
  lastLobbyPing: 0,
  hudCache: {},
  matchRecordedKey: '',
  verClicks: 0,
  verClickTimer: null,
  joinTimeout: null,
  lastHostPacketAt: 0,
  exitArmTimer: null,
  touchMove: { mx: 0, my: 0 },
  touchAimMode: false,
  touchAimActive: false,
  lastTouchAt: 0,
  touchJoy: null
};

// ============================================================
// 📊 KİŞİSEL KARİYER & 🔒 GİZLİ DENGE TELEMETRİ LOGU
// ============================================================

const CAREER_KEY = 'derinav_career_v1';
const TELEM_KEY = 'derinav_telemetry_pvp_v2'; // ☁️ Sadece online PvP (≥2 gerçek oyuncu) — buluta gider
const TELEM_SOLO_KEY = 'derinav_telemetry_solo_v2'; // 🤖 Solo/bot testleri — sadece bu tarayıcıda kalır
const HOST_UID_KEY = 'derinav_uid_v1';
const TELEM_PREFIX = 'derinav2v2/telemetry/aga2020/v4';

function getHostUid() {
  let uid = localStorage.getItem(HOST_UID_KEY);
  if (!uid) {
    uid = 'u_' + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem(HOST_UID_KEY, uid); } catch (_) {}
  }
  return uid;
}

function mergeTelemetryList(list) {
  const out = { version: GAME_VERSION, updatedAt: '', rounds: 0, roles: { hunterWins: 0, preyWins: 0, ffaRounds: 0 }, items: {}, chars: {}, maps: {}, skills: {} };
  for (const t of list) {
    if (!t || !t.items) continue;
    out.rounds += t.rounds || 0;
    if ((t.updatedAt || '') > out.updatedAt) out.updatedAt = t.updatedAt;
    out.roles.hunterWins += t.roles?.hunterWins || 0;
    out.roles.preyWins += t.roles?.preyWins || 0;
    out.roles.ffaRounds += t.roles?.ffaRounds || 0;
    for (const [k, v] of Object.entries(t.items || {})) {
      if (!out.items[k]) out.items[k] = { picks: 0, wins: 0 };
      out.items[k].picks += v.picks || 0;
      out.items[k].wins += v.wins || 0;
    }
    for (const [k, v] of Object.entries(t.chars || {})) {
      if (!out.chars[k]) out.chars[k] = { picks: 0, wins: 0 };
      out.chars[k].picks += v.picks || 0;
      out.chars[k].wins += v.wins || 0;
    }
    for (const [k, v] of Object.entries(t.maps || {})) {
      out.maps[k] = (out.maps[k] || 0) + (v || 0);
    }
    for (const [k, v] of Object.entries(t.skills || {})) {
      out.skills[k] = (out.skills[k] || 0) + (v || 0);
    }
  }
  return out;
}

function loadCareer() {
  try {
    const raw = JSON.parse(localStorage.getItem(CAREER_KEY) || 'null');
    if (raw && typeof raw === 'object') return raw;
  } catch (_) {}
  return { matches: 0, wins: 0, sinks: 0, damage: 0, bestDmg: 0, mvps: 0, ambushes: 0, rescues: 0, chars: {} };
}

function recordCareerMatch(st, awards) {
  const key = `${app.roomCode}_${st.round}_${st.scores?.A}_${st.scores?.B}_${st.matchWinnerTeam}`;
  if (app.matchRecordedKey === key) return;
  app.matchRecordedKey = key;

  const meStat = awards.find(a => a.id === app.myId);
  if (!meStat) return;
  const c = loadCareer();
  c.matches += 1;
  const iWon = (st.mode === 'ffa' || st.mode === 'crown') ? st.matchWinnerTeam === app.myId : meStat.team === st.matchWinnerTeam;
  if (iWon) c.wins += 1;
  c.sinks += meStat.sinks || 0;
  c.damage += meStat.damage || 0;
  c.bestDmg = Math.max(c.bestDmg || 0, meStat.damage || 0);
  if (awards[0]?.id === app.myId) c.mvps += 1;
  c.ambushes += meStat.ambushes || 0;
  c.rescues += meStat.rescues || 0;
  c.chars = c.chars || {};
  c.chars[meStat.charId] = (c.chars[meStat.charId] || 0) + 1;
  try { localStorage.setItem(CAREER_KEY, JSON.stringify(c)); } catch (_) {}
}

function loadTelemetry(key = TELEM_KEY) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if (raw && raw.items) return raw;
  } catch (_) {}
  return { version: GAME_VERSION, updatedAt: '', rounds: 0, roles: { hunterWins: 0, preyWins: 0, ffaRounds: 0 }, items: {}, chars: {}, maps: {}, skills: {} };
}

function recordRoundTelemetry(ev) {
  if (!ev || !ev.humans || ev.humans.length === 0) return;
  // Gerçek PvP = online oda + en az 2 gerçek oyuncu. Diğer her şey solo test sayılır ve buluta GİTMEZ.
  const isPvp = app.mode === 'host' && ev.humans.length >= 2;
  const key = isPvp ? TELEM_KEY : TELEM_SOLO_KEY;
  const t = loadTelemetry(key);
  t.version = GAME_VERSION;
  t.updatedAt = new Date().toISOString();
  t.rounds += 1;
  if (ev.mode === 'ffa' || ev.mode === 'crown') t.roles.ffaRounds += 1;
  else if (ev.winnerRole === 'hunter') t.roles.hunterWins += 1;
  else if (ev.winnerRole === 'prey') t.roles.preyWins += 1;

  t.maps[ev.mapId] = (t.maps[ev.mapId] || 0) + 1;
  for (const h of ev.humans) {
    if (!t.chars[h.charId]) t.chars[h.charId] = { picks: 0, wins: 0 };
    t.chars[h.charId].picks += 1;
    if (h.won) t.chars[h.charId].wins += 1;

    for (const itemId of h.items || []) {
      if (!t.items[itemId]) t.items[itemId] = { picks: 0, wins: 0 };
      t.items[itemId].picks += 1;
      if (h.won) t.items[itemId].wins += 1;
    }
    for (const skId of h.skills || []) {
      t.skills[skId] = (t.skills[skId] || 0) + 1;
    }
  }
  try { localStorage.setItem(key, JSON.stringify(t)); } catch (_) {}
  // Cloud retained MQTT sync — SADECE gerçek PvP (host başına ayrı kanal, kimse başkasının verisini ezmez!)
  if (isPvp) app.net?.publishRetained(`${TELEM_PREFIX}/${getHostUid()}`, t);
}

function openCareerModal() {
  const c = loadCareer();
  const wr = c.matches > 0 ? Math.round((c.wins / c.matches) * 100) : 0;
  let favChar = '—';
  let favMax = 0;
  for (const [cid, cnt] of Object.entries(c.chars || {})) {
    if (cnt > favMax) { favMax = cnt; favChar = CHAR_MAP[cid]?.name || cid; }
  }
  $('career-body').innerHTML = `
    <div class="career-grid">
      <div class="career-box"><span>Oynanan Maç</span><b>${c.matches}</b></div>
      <div class="career-box"><span>Galibiyet</span><b>${c.wins} (%${wr})</b></div>
      <div class="career-box"><span>👑 MVP Sayısı</span><b>${c.mvps}</b></div>
      <div class="career-box"><span>🌊 Toplam Batırma</span><b>${c.sinks}</b></div>
      <div class="career-box"><span>💥 En Yüksek Hasar</span><b>${c.bestDmg}</b></div>
      <div class="career-box"><span>🦈 Sürpriz Çıkış</span><b>${c.ambushes}</b></div>
      <div class="career-box"><span>🛟 Kurtarma</span><b>${c.rescues}</b></div>
      <div class="career-box"><span>⚓ Favori Çar</span><b>${favChar}</b></div>
    </div>
  `;
  $('overlay-career').classList.add('active');
  sfx.play('ui');
}

function renderTelemetryBody(t, cloudStatus) {
  const hW = t.roles.hunterWins || 0;
  const pW = t.roles.preyWins || 0;
  const totHP = hW + pW;
  const hPct = totHP > 0 ? Math.round((hW / totHP) * 100) : 0;

  const itemRows = FFA_ITEMS.map(it => {
    const d = t.items[it.id] || { picks: 0, wins: 0 };
    const wr = d.picks > 0 ? Math.round((d.wins / d.picks) * 100) : 0;
    return { name: `${it.icon} ${it.name}`, picks: d.picks, wins: d.wins, wr };
  }).sort((a, b) => a.picks - b.picks);

  const charRows = CHARACTERS.map(c => {
    const d = t.chars[c.id] || { picks: 0, wins: 0 };
    const wr = d.picks > 0 ? Math.round((d.wins / d.picks) * 100) : 0;
    return { name: `${c.icon} ${c.name}`, picks: d.picks, wins: d.wins, wr };
  }).sort((a, b) => b.picks - a.picks);

  $('admin-telem-body').innerHTML = `
    <div class="telem-summary">
      <span>Kaynak: <b>${cloudStatus}</b></span>
      <span>Toplam İnsan Turu: <b>${t.rounds}</b></span>
      <span>Avcı Kazanma: <b>${hW} (%${hPct})</b></span>
      <span>Av Kazanma: <b>${pW} (%${totHP > 0 ? 100 - hPct : 0})</b></span>
      <span>FFA Turu: <b>${t.roles.ffaRounds || 0}</b></span>
    </div>
    <h4 class="telem-h">📦 İtem Seçilme Sıralaması (En Az Seçilenler Üstte!)</h4>
    <div class="telem-list">
      ${itemRows.map(r => `<div class="telem-row ${r.picks === 0 ? 'zero' : ''}"><span>${r.name}</span><span>${r.picks} seçim · %${r.wr} WR</span></div>`).join('')}
    </div>
    <h4 class="telem-h">⚓ 6 Çar İstatistikleri</h4>
    <div class="telem-list">
      ${charRows.map(r => `<div class="telem-row ${r.picks === 0 ? 'zero' : ''}"><span>${r.name}</span><span>${r.picks} seçim · %${r.wr} WR</span></div>`).join('')}
    </div>
  `;
}

let lastDisplayedTelem = null;
let telemTab = 'pvp'; // 'pvp' | 'solo'
let cloudTelemCache = null; // { merged, hosts } | { error: true }

function renderTelemetryTabs() {
  const pvpLabel = cloudTelemCache === null
    ? '☁️ Online PvP (yükleniyor...)'
    : cloudTelemCache.error
      ? '☁️ Online PvP (bulut okunamadı)'
      : `☁️ Online PvP (${cloudTelemCache.merged.rounds} tur · ${cloudTelemCache.hosts} host)`;
  const solo = loadTelemetry(TELEM_SOLO_KEY);
  return `
    <div class="telem-tabs">
      <button class="telem-tab ${telemTab === 'pvp' ? 'active' : ''}" data-telem-tab="pvp">${pvpLabel}</button>
      <button class="telem-tab ${telemTab === 'solo' ? 'active' : ''}" data-telem-tab="solo">🤖 Solo Testler (${solo.rounds} tur · sadece bu tarayıcı)</button>
    </div>
  `;
}

function refreshTelemetryView() {
  if (!$('overlay-admin').classList.contains('active')) return;
  let data;
  let source;
  if (telemTab === 'solo') {
    data = loadTelemetry(TELEM_SOLO_KEY);
    source = '🤖 Solo / Bot Testleri (buluta gönderilmez)';
  } else if (cloudTelemCache && !cloudTelemCache.error && cloudTelemCache.merged.rounds > 0) {
    data = cloudTelemCache.merged;
    source = `☁️ Bulut — ${cloudTelemCache.hosts} host birleşik`;
  } else {
    // Bulut boş/okunamadı: bu tarayıcının kendi PvP kaydını göster
    data = loadTelemetry(TELEM_KEY);
    source = cloudTelemCache === null
      ? '⏳ Bulut okunuyor...'
      : cloudTelemCache.error
        ? '⚠️ Bulut okunamadı — bu tarayıcının PvP kaydı'
        : 'ℹ️ Henüz online PvP turu yok (en az 2 gerçek oyuncu gerekir)';
  }
  lastDisplayedTelem = data;
  renderTelemetryBody(data, source);
  $('admin-telem-body').insertAdjacentHTML('afterbegin', renderTelemetryTabs());
  document.querySelectorAll('[data-telem-tab]').forEach(btn => {
    btn.onclick = () => { telemTab = btn.dataset.telemTab; refreshTelemetryView(); };
  });
}

function openTelemetryAdmin() {
  cloudTelemCache = null;
  $('overlay-admin').classList.add('active');
  refreshTelemetryView();
  fetchCloudTelemetry(TELEM_PREFIX, 3200).then((cloudList) => {
    cloudTelemCache = { merged: mergeTelemetryList(cloudList), hosts: cloudList.length };
    refreshTelemetryView();
  }).catch(() => {
    cloudTelemCache = { error: true };
    refreshTelemetryView();
  });
}

function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function setScreen(name) {
  ['screen-home', 'screen-lobby', 'screen-game'].forEach(id => {
    $(id).classList.toggle('active', id === `screen-${name}`);
  });
}

function updateUrlRoom(code) {
  try {
    const u = new URL(window.location.href);
    if (code) u.searchParams.set('room', code);
    else u.searchParams.delete('room');
    window.history.replaceState({}, '', u.toString());
  } catch (_) {}
}

function getInviteUrl() {
  const u = new URL(window.location.href);
  u.searchParams.set('room', app.roomCode);
  return u.toString();
}

// ============================================================
// HOST BACKGROUND SIMULATION LOOP (ALT+TAB DONMA SORUNU ÇÖZÜMÜ)
// ============================================================

function startHostTicker() {
  stopHostTicker();
  app.lastSimNow = Date.now();
  app.hostTicker = createBackgroundTicker(16, (now) => {
    if (!app.sim) return;
    const rawDt = (now - app.lastSimNow) / 1000;
    app.lastSimNow = now;
    // Clamp step to keep physics rock-solid even after micro-hiccups
    const dt = Math.min(0.05, Math.max(0.004, rawDt));

    if (app.sim.phase === 'playing') {
      const mv = getMoveVector();
      app.sim.setInput(app.myId, {
        mx: mv.mx,
        my: mv.my,
        aim: Number(app.localAim.toFixed(2))
      });
    }

    app.sim.step(dt);

    if (app.sim.phase === 'playing' || app.sim.phase === 'intro' || app.sim.phase === 'round_end' || app.sim.phase === 'match_end') {
      // 28Hz (35ms) network broadcast -> düşük gecikme + akıcı hareket
      if (now - app.lastBroadcast >= 35) {
        app.lastBroadcast = now;
        broadcastState();
      } else {
        app.liveState = app.sim.getStateSnapshot();
      }
    } else if (app.sim.phase === 'draft') {
      if (now - app.lastBroadcast >= 450) {
        app.lastBroadcast = now;
        broadcastLobby();
        renderDraftUI();
      }
    } else if (app.sim.phase === 'lobby' && app.mode === 'host') {
      if (now - app.lastLobbyPing >= 1500) {
        app.lastLobbyPing = now;
        broadcastLobby();
      }
    }
  });
}

function stopHostTicker() {
  if (app.hostTicker) {
    app.hostTicker.stop();
    app.hostTicker = null;
  }
}

// ============================================================
// LOBBY & MULTIPLAYER ROOM LIFECYCLE
// ============================================================

function initNet(isHost, roomCode) {
  if (app.net) app.net.disconnect();
  app.net = new NetClient({
    onStatus: (status, text) => {
      $('net-status').textContent = text;
      $('net-status').dataset.state = status;
      if (status === 'connected') {
        if (!isHost) {
          app.net.send({ type: 'join', name: app.myName, skinId: app.mySkin });
          // ⏱️ Sunucu bağlandıktan sonra 4.5 sn içinde Host'tan yanıt gelmezse oda kapanmıştır!
          clearTimeout(app.joinTimeout);
          app.joinTimeout = setTimeout(() => {
            if (app.mode === 'client' && !app.lobbyState && !app.liveState) {
              const deadCode = app.roomCode || '';
              leaveRoom();
              $('input-code').value = '';
              showToast(`⚠️ ${deadCode} odası artık aktif değil veya kurucu çıkmış!`);
            }
          }, 4500);
        } else {
          broadcastLobby();
        }
      }
    },
    onMessage: (msg) => {
      if (app.mode === 'host') handleHostReceive(msg);
      else if (app.mode === 'client') handleClientReceive(msg);
    }
  });
  app.myId = app.net.clientId;
  app.roomCode = roomCode;
  app.net.connect(roomCode, isHost);
}

function createHostSim() {
  app.sim = new GameSim((ev) => {
    if (ev.type === 'sfx') {
      if (!ev.targetId || ev.targetId === app.myId) sfx.play(ev.name);
      if (app.mode === 'host') app.net?.send({ type: 'sfx', name: ev.name, targetId: ev.targetId || null });
    } else if (ev.type === 'round_telemetry') {
      recordRoundTelemetry(ev);
    } else if (ev.type === 'phase') {
      broadcastLobby();
      if (ev.phase === 'playing' || ev.phase === 'intro') broadcastState();
    }
  });
  app.sim.addHuman(app.myId, app.myName);
  if (app.mySkin) app.sim.pickSkin(app.myId, app.mySkin);
  startHostTicker();
}

function startHostOnline() {
  const name = ($('input-name').value || '').trim() || `Kaptan${Math.floor(10 + Math.random() * 89)}`;
  app.myName = name.slice(0, 14);
  localStorage.setItem('derinav_name', app.myName);

  const code = generateRoomCode();
  app.mode = 'host';
  initNet(true, code);
  createHostSim();
  updateUrlRoom(code);

  app.lobbyState = app.sim.getLobbySnapshot();
  setScreen('lobby');
  renderLobby();
  sfx.play('ui');
}

function startQuickSolo() {
  const name = ($('input-name').value || '').trim() || 'Kaptan';
  app.myName = name.slice(0, 14);
  localStorage.setItem('derinav_name', app.myName);

  if (app.net) app.net.disconnect();
  app.mode = 'offline';
  app.myId = 'local_host';
  app.roomCode = 'SOLO';
  createHostSim();
  app.sim.fillEmptyWithBots();
  $('net-status').textContent = 'Çevrimdışı Hızlı Maç (Botlarla)';
  $('net-status').dataset.state = 'connected';
  app.lobbyState = app.sim.getLobbySnapshot();
  setScreen('lobby');
  renderLobby();
  sfx.play('ui');
}

function joinOnlineRoom(rawCode) {
  const code = (rawCode || $('input-code').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (code.length < 3) {
    showToast('Lütfen geçerli bir oda kodu girin!');
    return;
  }
  const name = ($('input-name').value || '').trim() || `Tayfa${Math.floor(10 + Math.random() * 89)}`;
  app.myName = name.slice(0, 14);
  localStorage.setItem('derinav_name', app.myName);

  stopHostTicker();
  clearTimeout(app.joinTimeout);
  app.mode = 'client';
  app.sim = null;
  app.pred = null;
  app.lobbyState = null;
  app.liveState = null;
  initNet(false, code);
  updateUrlRoom(code);
  setScreen('lobby');
  renderLobby();
  sfx.play('ui');
}

function leaveRoom() {
  clearTimeout(app.joinTimeout);
  app.joinTimeout = null;
  app.lastHostPacketAt = 0;
  if (app.mode === 'client' && app.net?.connected) {
    app.net.send({ type: 'leave' });
  } else if (app.mode === 'host' && app.net?.connected) {
    app.net.send({ type: 'hostClosed' });
  }
  stopHostTicker();
  if (app.net) app.net.disconnect();
  app.mode = 'menu';
  app.sim = null;
  app.pred = null;
  app.lobbyState = null;
  app.liveState = null;
  app.roomCode = null;
  app.hudCache = {};
  $('invite-banner').style.display = 'none';
  updateUrlRoom(null);
  setScreen('home');
}

function handleHostReceive(msg) {
  if (!app.sim) return;
  const sender = msg.from;
  switch (msg.type) {
    case 'pingRoom': {
      app.net?.send({ type: 'pongRoom', room: app.roomCode });
      break;
    }
    case 'join': {
      app.sim.addHuman(sender, msg.name);
      if (msg.skinId) app.sim.pickSkin(sender, msg.skinId);
      broadcastLobby();
      if (app.sim.phase !== 'lobby') broadcastState();
      renderLobby();
      break;
    }
    case 'pickSkin': {
      app.sim.pickSkin(sender, msg.skinId);
      broadcastLobby();
      renderLobby();
      break;
    }
    case 'leave': {
      app.sim.removeHuman(sender);
      broadcastLobby();
      renderLobby();
      break;
    }
    case 'pickChar': {
      app.sim.pickCharacter(sender, msg.charId);
      broadcastLobby();
      renderLobby();
      break;
    }
    case 'switchTeam': {
      app.sim.switchTeam(sender);
      broadcastLobby();
      renderLobby();
      break;
    }
    case 'pickItems': {
      app.sim.setPlayerItems(sender, msg.items, msg.ready);
      broadcastLobby();
      renderDraftUI();
      break;
    }
    case 'unlockSkill': {
      if (app.sim.unlockSkill(sender, msg.skillId)) {
        broadcastLobby();
        renderDraftUI();
      }
      break;
    }
    case 'input': {
      app.sim.setInput(sender, msg.input);
      break;
    }
    case 'useItem': {
      app.sim.triggerItem(sender, msg.slot, msg.aim);
      break;
    }
    case 'space': {
      app.sim.triggerSpace(sender, msg.aim);
      break;
    }
    case 'dive': {
      app.sim.toggleDive(sender);
      break;
    }
    case 'emote': {
      app.sim.triggerEmote(sender, msg.idx);
      break;
    }
  }
}

function handleClientReceive(msg) {
  app.lastHostPacketAt = performance.now();
  switch (msg.type) {
    case 'hostClosed': {
      leaveRoom();
      showToast('ℹ️ Oda kurucusu odadan ayrıldı.');
      break;
    }
    case 'lobby': {
      if (app.joinTimeout) { clearTimeout(app.joinTimeout); app.joinTimeout = null; }
      const prevJson = app.lobbyState ? JSON.stringify(app.lobbyState) : '';
      app.lobbyState = msg.data;
      checkVersionMismatch(app.lobbyState?.version);
      syncPhaseScreens(app.lobbyState.phase);
      if (app.lobbyState.phase === 'lobby') {
        if (JSON.stringify(app.lobbyState) !== prevJson) renderLobby();
      } else if (app.lobbyState.phase === 'draft') {
        renderDraftUI();
      }
      break;
    }
    case 'state': {
      if (app.joinTimeout) { clearTimeout(app.joinTimeout); app.joinTimeout = null; }
      app.liveState = msg.data;
      syncPhaseScreens(app.liveState.phase);
      reconcileClientPrediction(app.liveState);
      updateHudFromState(app.liveState);
      break;
    }
    case 'sfx': {
      if (!msg.targetId || msg.targetId === app.myId) {
        sfx.play(msg.name);
      }
      break;
    }
  }
}

// ============================================================
// CLIENT-SIDE PREDICTION & SMOOTH RECONCILIATION (ZERO-LAG)
// ============================================================

function reconcileClientPrediction(st) {
  if (app.mode !== 'client' || st.phase !== 'playing') {
    app.pred = null;
    return;
  }
  const me = st.players?.find(p => p.id === app.myId);
  if (!me || !me.alive) {
    app.pred = null;
    return;
  }
  if (!app.pred || app.pred.round !== st.round) {
    app.pred = { x: me.x, y: me.y, vx: me.vx || 0, vy: me.vy || 0, round: st.round };
    return;
  }
  const err = Math.hypot(me.x - app.pred.x, me.y - app.pred.y);
  if (err > 125) {
    // Büyük knockback / kanca / respawn durumunda anında hizala
    app.pred.x = me.x;
    app.pred.y = me.y;
    app.pred.vx = me.vx || 0;
    app.pred.vy = me.vy || 0;
  } else if (err > 4) {
    // Yumuşak düzeltme: asla zıplama / rubberbanding hissi vermez
    const blend = err > 50 ? 0.28 : 0.14;
    app.pred.x += (me.x - app.pred.x) * blend;
    app.pred.y += (me.y - app.pred.y) * blend;
  }
}

function stepClientPrediction(dt) {
  if (app.mode !== 'client' || !app.pred || !app.liveState || app.liveState.phase !== 'playing') return;
  const me = app.liveState.players?.find(p => p.id === app.myId);
  if (!me || !me.alive) return;

  const ch = CHAR_MAP[me.charId] || CHARACTERS[0];
  const mv = getMoveVector();
  let mx = mv.mx;
  let my = mv.my;
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }

  let maxSpd = ch.speed * (me.speedBoost ? 1.38 : 1) * (me.slowTimer ? 0.45 : 1);
  if (app.liveState.roundEvent === 'kasirga_hizi') maxSpd *= 1.2;
  if (me.role === 'hunter') maxSpd *= 1.03;
  if (me.hasCrown) maxSpd *= 0.87;
  if (me.submerged) maxSpd *= 0.66;
  maxSpd = Math.min(maxSpd, ch.speed * 1.62);
  if (me.rootTimer || me.stunTimer) maxSpd = 0;

  const accel = ch.turnBonus ? 11.5 : 8.5;
  app.pred.vx += (mx * maxSpd - app.pred.vx) * Math.min(1, accel * dt);
  app.pred.vy += (my * maxSpd - app.pred.vy) * Math.min(1, accel * dt);

  const map = SEA_MAPS[(app.liveState.mapIndex || 0) % SEA_MAPS.length];
  for (const cur of map.currents || []) {
    if (app.pred.x >= cur.x && app.pred.x <= cur.x + cur.w && app.pred.y >= cur.y && app.pred.y <= cur.y + cur.h) {
      const dot = mx * cur.dirX + my * cur.dirY;
      if (dot >= -0.15) {
        const bonus = ch.currentBonus ? 1.25 : 1.0;
        const push = maxSpd * (cur.boost - 1.0) * bonus;
        app.pred.vx += cur.dirX * push * Math.min(1, 10 * dt);
        app.pred.vy += cur.dirY * push * Math.min(1, 10 * dt);
      } else if (!ch.currentBonus) {
        app.pred.vx += cur.dirX * 55 * dt * 6;
        app.pred.vy += cur.dirY * 55 * dt * 6;
      }
    }
  }

  const minY = map.beach ? map.beach.sandY + 22 : 32;
  app.pred.x = clamp(app.pred.x + app.pred.vx * dt, 32, WORLD_W - 32);
  app.pred.y = clamp(app.pred.y + app.pred.vy * dt, minY, WORLD_H - 32);

  // Local obstacle collision so prediction never walks through rocks or live breakables
  const r = 20;
  for (const br of app.liveState.breakables || []) {
    const d = Math.hypot(app.pred.x - br.x, app.pred.y - br.y);
    const minD = br.r + r;
    if (d < minD && d > 0.01) {
      app.pred.x = br.x + ((app.pred.x - br.x) / d) * minD;
      app.pred.y = br.y + ((app.pred.y - br.y) / d) * minD;
    }
  }
  for (const obs of map.rocks) {
    if (obs.type === 'rock') {
      const d = Math.hypot(app.pred.x - obs.x, app.pred.y - obs.y);
      const minD = obs.r + r;
      if (d < minD && d > 0.01) {
        app.pred.x = obs.x + ((app.pred.x - obs.x) / d) * minD;
        app.pred.y = obs.y + ((app.pred.y - obs.y) / d) * minD;
      }
    } else {
      const cx = clamp(app.pred.x, obs.x, obs.x + obs.w);
      const cy = clamp(app.pred.y, obs.y, obs.y + obs.h);
      const d = Math.hypot(app.pred.x - cx, app.pred.y - cy);
      if (d < r && d > 0.01) {
        app.pred.x = cx + ((app.pred.x - cx) / d) * r;
        app.pred.y = cy + ((app.pred.y - cy) / d) * r;
      }
    }
  }
}

function broadcastLobby() {
  if (!app.sim) return;
  app.lobbyState = app.sim.getLobbySnapshot();
  if (app.mode === 'host' && app.net?.connected) {
    app.net.send({ type: 'lobby', data: app.lobbyState });
  }
  syncPhaseScreens(app.lobbyState.phase);
}

function broadcastState() {
  if (!app.sim) return;
  app.liveState = app.sim.getStateSnapshot();
  if (app.mode === 'host' && app.net?.connected) {
    app.net.send({ type: 'state', data: app.liveState });
  }
  syncPhaseScreens(app.liveState.phase);
  updateHudFromState(app.liveState);
}

function syncPhaseScreens(phase) {
  if (phase === 'lobby') {
    app.hudCache = {};
    setScreen('lobby');
    $('overlay-draft').classList.remove('active');
    $('overlay-intro').classList.remove('active');
    $('overlay-round').classList.remove('active');
    $('overlay-match').classList.remove('active');
  } else {
    setScreen('game');
    $('overlay-draft').classList.toggle('active', phase === 'draft');
    $('overlay-intro').classList.toggle('active', phase === 'intro');
    $('overlay-round').classList.toggle('active', phase === 'round_end');
    $('overlay-match').classList.toggle('active', phase === 'match_end');

    if (phase === 'draft') {
      const roundNum = (app.lobbyState?.round || app.liveState?.round || 1);
      if (app.draftRoundSeen !== roundNum) {
        if (roundNum === 1) {
          // 🔄 Yeni maç / Rematch başlarken önbellek ve kariyer kilidini sıfırla!
          app.hudCache = {};
          app.matchRecordedKey = '';
        }
        app.draftRoundSeen = roundNum;
        app.draftPicks = [];
      }
      renderDraftUI();
    } else if (phase === 'intro' && app.liveState) {
      renderIntroVS(app.liveState);
    } else if (phase === 'round_end' && app.liveState) {
      renderRoundEnd(app.liveState);
    } else if (phase === 'match_end' && app.liveState) {
      renderMatchEnd(app.liveState);
    }
  }
}

// ============================================================
// LOBBY RENDERING (2v2 TEAMS + 6 CHARACTERS)
// ============================================================

function renderLobby() {
  $('lobby-code').textContent = app.roomCode || '----';
  const isHostLike = app.mode === 'host' || app.mode === 'offline';
  $('btn-start-match').style.display = isHostLike ? '' : 'none';
  $('btn-fill-bots').style.display = isHostLike ? '' : 'none';
  $('btn-open-settings').style.display = isHostLike ? '' : 'none';
  $('btn-copy-link').style.display = app.mode === 'offline' ? 'none' : '';
  $('client-wait-msg').style.display = isHostLike ? 'none' : '';

  const st = app.lobbyState;
  if (!st) {
    $('team-a-slots').innerHTML = '<div class="slot-card empty">Oda bilgisi bekleniyor...</div>';
    $('team-b-slots').innerHTML = '<div class="slot-card empty">Oda bilgisi bekleniyor...</div>';
    $('lobby-rules-summary').innerHTML = '';
    return;
  }

  const mode = st.settings?.mode || '2v2';
  const isFfa = mode === 'ffa' || mode === 'crown';
  const isCrown = mode === 'crown';
  $('lobby-mode-kicker').textContent = mode === '1v1'
    ? 'İKİ İTEMLİ OYUN · 1v1 DÜELLO'
    : isCrown
      ? 'İKİ İTEMLİ OYUN · 👑 ALTIN TAÇ'
      : isFfa
        ? 'İKİ İTEMLİ OYUN · HERKES TEK'
        : 'İKİ İTEMLİ OYUN · 2v2 TAKIM LOBİSİ';
  $('btn-switch-team').style.display = isFfa ? 'none' : '';
  $('team-a-title').textContent = isFfa ? 'OYUNCULAR (1-2)' : 'TAKIM A (ALTIN)';
  $('team-a-role').textContent = isCrown ? '👑 100 Puan Kazanır' : isFfa ? '💀 Herkes Tek' : '1. Tur: Avcılar 🎯';
  $('team-b-title').textContent = isFfa ? 'OYUNCULAR (3-4)' : 'TAKIM B (TURKUAZ)';
  $('team-b-role').textContent = isCrown ? '👑 Tacı Kap & Koru!' : isFfa ? '💀 Son Kalan Kazanır' : '1. Tur: Avlar 🌊';
  document.querySelectorAll('[data-qmode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.qmode === mode);
    btn.disabled = !isHostLike;
  });
  const curLives = String(st.settings?.lives || 1);
  document.querySelectorAll('[data-qlives]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.qlives === curLives);
    btn.disabled = !isHostLike;
  });
  renderLobbyRulesSummary(st);

  const renderSlot = (s) => {
    const ch = CHAR_MAP[s.charId] || CHARACTERS[0];
    const isMe = s.id === app.myId;
    if (!s.id) {
      return `
        <div class="slot-card empty">
          <span>Boş Oyuncu Yeri</span>
          ${isHostLike ? `<button class="btn-mini" data-add-bot="${s.idx}">+ Bot Ekle</button>` : ''}
        </div>
      `;
    }
    return `
      <div class="slot-card ${isMe ? 'me' : ''}">
        <div class="slot-avatar" style="background:${ch.color}22;border-color:${ch.color}">${ch.icon}</div>
        <div class="slot-info">
          <div class="slot-name">${s.name} ${isMe ? '<span class="tag-me">SEN</span>' : ''} ${s.isBot ? '<span class="tag-bot">BOT</span>' : ''} ${(s.wins || 0) > 0 ? `<span class="tag-wins" title="Bu akşamki maç galibiyeti">🏆 ${s.wins}</span>` : ''}</div>
          <div class="slot-char">${ch.name} · ${ch.roleTag}</div>
        </div>
        ${isHostLike && s.isBot ? `<button class="btn-mini danger" data-del-bot="${s.idx}">Çıkar</button>` : ''}
      </div>
    `;
  };

  $('team-a-slots').innerHTML = st.slots.filter(s => s.team === 'A').map(renderSlot).join('');
  $('team-b-slots').innerHTML = st.slots.filter(s => s.team === 'B').map(renderSlot).join('');

  document.querySelectorAll('[data-add-bot]').forEach(btn => {
    btn.onclick = () => {
      if (!app.sim) return;
      app.sim.addBot(Number(btn.dataset.addBot));
      broadcastLobby();
      renderLobby();
      sfx.play('ui');
    };
  });
  document.querySelectorAll('[data-del-bot]').forEach(btn => {
    btn.onclick = () => {
      if (!app.sim) return;
      app.sim.removeBot(Number(btn.dataset.delBot));
      broadcastLobby();
      renderLobby();
      sfx.play('ui');
    };
  });

  const mySlot = st.slots.find(s => s.id === app.myId);
  const myCharId = mySlot?.charId || 'kaptan';
  const mySkinId = mySlot?.skinId || app.mySkin || 'auto';

  // 🚩 Tekne Rengi & Köpük İzi Seçici
  const skinRow = $('skin-picker-row');
  if (skinRow) {
    skinRow.innerHTML = BOAT_SKINS.map(sk => `
      <button class="skin-chip ${sk.id === mySkinId ? 'selected' : ''}" data-skin="${sk.id}" style="--sk-col:${sk.hull || '#38bdf8'}">
        <span class="skin-dot"></span>${sk.icon} ${sk.name}
      </button>
    `).join('');
    document.querySelectorAll('[data-skin]').forEach(btn => {
      btn.onclick = () => {
        const skinId = btn.dataset.skin;
        app.mySkin = skinId;
        localStorage.setItem('derinav_skin', skinId);
        sfx.play('ui');
        if (app.sim) {
          app.sim.pickSkin(app.myId, skinId);
          broadcastLobby();
          renderLobby();
        } else {
          app.net?.send({ type: 'pickSkin', skinId });
        }
      };
    });
  }

  $('char-grid').innerHTML = CHARACTERS.map(c => {
    const selected = c.id === myCharId;
    return `
      <button class="char-card ${selected ? 'selected' : ''}" data-char="${c.id}" style="--char-color:${c.color}">
        <div class="char-head">
          <span class="char-ico">${c.icon}</span>
          <div>
            <div class="char-title">${c.name}</div>
            <div class="char-sub">${c.roleTag}</div>
          </div>
        </div>
        <p class="char-passive">${c.passive}</p>
        <div class="char-stats">
          <span>🫁 ${c.breath} · 🌊 ${c.hp}</span>
          <span>⚡ ${'★'.repeat(c.stats.speed)}</span>
        </div>
      </button>
    `;
  }).join('');

  document.querySelectorAll('[data-char]').forEach(btn => {
    btn.onclick = () => {
      const charId = btn.dataset.char;
      sfx.play('ui');
      if (app.sim) {
        app.sim.pickCharacter(app.myId, charId);
        broadcastLobby();
        renderLobby();
      } else {
        app.net?.send({ type: 'pickChar', charId });
      }
    };
  });
}

// ============================================================
// PRE-ROUND 2-ITEM DRAFT UI
// ============================================================

function renderDraftUI() {
  const st = app.lobbyState;
  if (!st || st.phase !== 'draft') return;

  const mySlot = st.slots.find(s => s.id === app.myId);
  if (!mySlot) return;

  const isCrown = st.settings?.mode === 'crown';
  const isFfa = st.settings?.mode === 'ffa' || isCrown;
  const teamAIsHunter = st.round % 2 === 1;
  const myRole = isFfa
    ? 'ffa'
    : ((mySlot.team === 'A') ? (teamAIsHunter ? 'hunter' : 'prey') : (teamAIsHunter ? 'prey' : 'hunter'));
  const pool = isFfa ? FFA_ITEMS : (myRole === 'hunter' ? HUNTER_ITEMS : PREY_ITEMS);
  const map = SEA_MAPS[(st.mapIndex || 0) % SEA_MAPS.length];

  $('draft-round-badge').textContent = `TUR ${st.round} / ${st.totalRounds} · ${map.name.toUpperCase()}`;
  $('draft-timer').textContent = `${Math.max(0, st.phaseTimer)}s`;

  const bannerKey = `${st.round}_${st.settings?.mode}_${myRole}_${st.roundEvent || ''}`;
  setIfChanged('draftBanner', bannerKey, () => {
    const ev = st.roundEvent ? ROUND_EVENT_MAP[st.roundEvent] : null;
    const evHtml = ev ? `<div class="event-pill-inline" style="border-color:${ev.color};color:${ev.color}">🎲 TUR OLAYI: ${ev.icon} <b>${ev.name}</b> — ${ev.desc}</div>` : '';
    const roleBox = $('draft-role-banner');
    roleBox.className = `role-banner ${isFfa ? 'hunter' : myRole}`;
    roleBox.innerHTML = (isCrown
      ? `<strong>👑 ALTIN TAÇ</strong> — Tacı kap, <b>100 puana</b> ilk ulaşan kazanır.`
      : isFfa
        ? `<strong>💀 HERKES TEK</strong> — Son ayakta kalan kazanır.`
        : myRole === 'hunter'
          ? `<strong>🎯 AVCISIN</strong> — ${st.settings?.mode === '1v1' ? 'Avı' : 'Avları'} suya göm!`
          : `<strong>🌊 AVSIN</strong> — Süreyi tamamla veya ${st.settings?.mode === '1v1' ? 'Avcıyı' : 'Avcıları'} batır!`) + evHtml;
  });

  // 🌿 Yetenek Ağacı (Skill Tree) paneli — sadece puan/yetenek değiştiğinde yeniden çiz (sıfır titreşim!)
  const mySkills = mySlot.skills || [];
  const pts = mySlot.skillPoints || 0;
  const treeKey = `${st.round}_${Boolean(st.settings?.skillTree)}_${pts}_${mySkills.join(',')}`;
  setIfChanged('draftTree', treeKey, () => {
    const treeWrap = $('draft-skill-tree');
    if (!treeWrap) return;
    if (st.settings?.skillTree) {
      treeWrap.style.display = 'block';
      treeWrap.innerHTML = `
        <div class="skill-tree-head">
          <span>🌿 <b>Yetenek Ağacı</b></span>
          <span class="skill-pts-pill ${pts > 0 ? 'has-pts' : ''}">${pts > 0 ? `✨ ${pts} Puan` : 'Kullanıldı ✓'}</span>
        </div>
        <div class="skill-branches">
          ${SKILL_TREE.map(br => `
            <div class="skill-branch" style="--br-col:${br.color}">
              <div class="branch-title">${br.title}</div>
              <div class="branch-nodes">
                ${br.nodes.map((n, idx) => {
                  const owned = mySkills.includes(n.id);
                  const prereqOk = idx === 0 || mySkills.includes(br.nodes[idx - 1].id);
                  const canBuy = !owned && prereqOk && pts > 0;
                  return `
                    <button class="skill-node ${owned ? 'owned' : canBuy ? 'avail' : 'locked'}"
                      data-skill="${n.id}" ${canBuy ? '' : 'disabled'} title="${n.name}: ${n.desc}">
                      <span class="sk-ico">${n.icon}</span>
                      <span class="sk-txt"><b>${n.name}</b><small>${n.desc}</small></span>
                      ${owned ? '<span class="sk-check">✓</span>' : ''}
                    </button>
                  `;
                }).join('<span class="sk-arrow">→</span>')}
              </div>
            </div>
          `).join('')}
        </div>
      `;
      document.querySelectorAll('[data-skill]').forEach(btn => {
        btn.onclick = () => {
          const skillId = btn.dataset.skill;
          if (app.sim) {
            if (app.sim.unlockSkill(app.myId, skillId)) {
              broadcastLobby();
              renderDraftUI();
            }
          } else {
            app.net?.send({ type: 'unlockSkill', skillId });
          }
        };
      });
    } else {
      treeWrap.style.display = 'none';
    }
  });

  const locked = mySlot.readyItems && mySlot.items.length === 2;
  const picks = locked ? mySlot.items : app.draftPicks;

  // İtem kartları & önizleme çubuğu: sadece seçim/filtre/rol değiştiğinde yeniden çiz (hover asla titremez!)
  const gridKey = `${st.round}_${myRole}_${app.draftFilter}_${locked}_${picks.join(',')}`;
  setIfChanged('draftGrid', gridKey, () => {
    const renderSlotChip = (slotNum) => {
      const id = picks[slotNum];
      if (!id) return `<div class="preview-slot empty">SLOT ${slotNum + 1}: Boş</div>`;
      const def = ALL_ITEMS[id];
      return `
        <div class="preview-slot filled ${def.firearm ? 'firearm' : ''}">
          <span><b>${slotNum + 1}.</b> ${def.icon} ${def.name}</span>
          ${!locked ? `<button class="preview-x" data-rm-slot="${slotNum}" title="Kaldır">✕</button>` : ''}
        </div>
      `;
    };
    $('draft-loadout-preview').innerHTML = renderSlotChip(0) + renderSlotChip(1);
    document.querySelectorAll('[data-rm-slot]').forEach(btn => {
      btn.onclick = () => {
        app.draftPicks.splice(Number(btn.dataset.rmSlot), 1);
        sfx.play('ui');
        renderDraftUI();
      };
    });

    document.querySelectorAll('[data-dfilter]').forEach(b => {
      b.classList.toggle('active', b.dataset.dfilter === app.draftFilter);
    });
    const visiblePool = pool.filter(it => {
      if (app.draftFilter === 'firearm') return it.firearm;
      if (app.draftFilter === 'util') return !it.firearm;
      return true;
    });

    $('draft-grid').innerHTML = visiblePool.map(it => {
      const idx = picks.indexOf(it.id);
      const isPicked = idx >= 0;
      return `
        <button class="item-card ${isPicked ? 'picked' : ''} ${it.firearm ? 'firearm' : ''}" data-item="${it.id}" ${locked ? 'disabled' : ''}>
          <div class="item-top">
            <span class="item-ico">${it.icon}</span>
            <div class="item-badges">
              ${it.firearm
                ? '<span class="badge-firearm">🔥 TEK KULLANIM</span>'
                : `<span class="badge-util">${it.category} · ${it.uses}x</span>`}
            </div>
          </div>
          <div class="item-name">${it.name}</div>
          <p class="item-desc">${it.desc}</p>
          ${isPicked ? `<div class="slot-badge">SLOT ${idx + 1} (${idx === 0 ? 'Sol Tık / 1' : 'Sağ Tık / 2'})</div>` : ''}
        </button>
      `;
    }).join('');

    document.querySelectorAll('[data-item]').forEach(btn => {
      btn.onclick = () => {
        if (locked) return;
        const id = btn.dataset.item;
        const idx = app.draftPicks.indexOf(id);
        if (idx >= 0) {
          app.draftPicks.splice(idx, 1);
        } else if (app.draftPicks.length < 2) {
          app.draftPicks.push(id);
        } else {
          app.draftPicks[1] = id;
        }
        sfx.play('ui');
        renderDraftUI();
      };
    });

    const btnLock = $('btn-lock-items');
    if (locked) {
      btnLock.disabled = true;
      btnLock.textContent = '✓ Onaylandı — Bekleniyor...';
    } else {
      btnLock.disabled = app.draftPicks.length !== 2;
      btnLock.textContent = app.draftPicks.length === 2
        ? '✓ Onayla ve Başla'
        : `2 İtem Seç (${app.draftPicks.length}/2)`;
    }
  });

  const readyKey = st.slots.map(s => `${s.id}:${s.readyItems}`).join('|') + `_${st.round}`;
  setIfChanged('draftReady', readyKey, () => {
    $('draft-ready-list').innerHTML = st.slots.map(s => {
      const r = isFfa ? 'FFA' : ((s.team === 'A') ? (teamAIsHunter ? 'Avcı' : 'Av') : (teamAIsHunter ? 'Av' : 'Avcı'));
      return `<span class="ready-pill ${s.readyItems ? 'ok' : ''}">${s.name} (${r}) ${s.readyItems ? '✓' : '...'}</span>`;
    }).join('');
  });
}

// ============================================================
// LIVE HUD (DIRTY-CHECKED — ZERO DOM THRASHING!)
// ============================================================

function setIfChanged(key, val, applyFn) {
  if (app.hudCache[key] !== val) {
    app.hudCache[key] = val;
    applyFn();
  }
}

function updateHudFromState(st) {
  if (!st) return;
  const map = SEA_MAPS[(st.mapIndex || 0) % SEA_MAPS.length];
  const ev = st.roundEvent ? ROUND_EVENT_MAP[st.roundEvent] : null;
  const roundStr = `TUR ${st.round}/${st.totalRounds} · ${map.name}${ev ? ` · ${ev.icon} ${ev.name}` : ''}`;
  setIfChanged('round', roundStr, () => { $('hud-round').textContent = roundStr; });

  // 🔥 Seri / Özel Anons Bannerı
  const bKey = st.banner ? `${st.banner.id}` : 'none';
  setIfChanged('banner', bKey, () => {
    const el = $('hud-banner');
    if (!el) return;
    if (st.banner) {
      el.style.borderColor = st.banner.color || '#ffb703';
      el.innerHTML = `<div class="hb-title" style="color:${st.banner.color}">${st.banner.text}</div><div class="hb-sub">${st.banner.sub || ''}</div>`;
      el.classList.add('show');
    } else {
      el.classList.remove('show');
    }
  });
  const isCrown = st.mode === 'crown';
  const isFfa = st.mode === 'ffa' || isCrown;
  setIfChanged('scoreMode', isFfa, () => {
    $('hud-score-badge-a').style.display = isFfa ? 'none' : '';
    $('hud-score-badge-b').style.display = isFfa ? 'none' : '';
  });
  setIfChanged('scoreA', st.scores.A, () => { $('hud-score-a').textContent = st.scores.A; });
  setIfChanged('scoreB', st.scores.B, () => { $('hud-score-b').textContent = st.scores.B; });

  const secs = Math.max(0, Math.ceil(st.phaseTimer));
  setIfChanged('timer', secs, () => {
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    $('hud-timer').textContent = `${mm}:${ss}`;
    $('hud-timer').classList.toggle('urgent', secs <= 15);
  });

  const me = st.players?.find(p => p.id === app.myId);
  if (me) {
    const ch = CHAR_MAP[me.charId] || CHARACTERS[0];
    const roleKey = `${st.mode}_${me.role}_${me.alive}_${me.lives}_${me.respawnTimer}_${me.hasCrown}`;
    setIfChanged('role', roleKey, () => {
      $('hud-role-pill').textContent = me.alive
        ? (isCrown
          ? (me.hasCrown ? '👑 TAÇ SENDE!' : '👑 ALTIN TAÇ')
          : me.role === 'ffa'
            ? '💀 HERKES TEK'
            : me.role === 'hunter'
              ? '🎯 AVCISIN'
              : '🌊 AVSIN')
        : ((me.lives > 0 || isCrown)
          ? `❤️ DOĞUYOR (${me.respawnTimer.toFixed(1)}s)`
          : '🌊 İZLEYİCİ');
      $('hud-role-pill').className = `hud-role-pill ${me.role === 'ffa' ? 'hunter' : me.role} ${me.alive ? '' : 'dead'}`;
    });

    // ❤️ BÜYÜK MARİO KALP ÇUBUĞU (maxLives > 1 olduğunda daima net görünür!)
    const maxL = me.maxLives || 1;
    const curL = Math.max(0, me.lives ?? 1);
    const heartsKey = `${curL}_${maxL}`;
    setIfChanged('marioHearts', heartsKey, () => {
      const hEl = $('hud-hearts');
      if (!hEl) return;
      if (maxL > 1) {
        let html = '<span class="m-heart-lbl">CAN</span>';
        for (let i = 0; i < maxL; i++) {
          html += i < curL
            ? '<span class="m-heart">❤️</span>'
            : '<span class="m-heart lost">🖤</span>';
        }
        hEl.innerHTML = html;
        hEl.style.display = 'inline-flex';
        if (app.prevLives !== undefined && curL < app.prevLives) {
          hEl.classList.remove('shake');
          void hEl.offsetWidth;
          hEl.classList.add('shake');
        }
        app.prevLives = curL;
      } else {
        hEl.style.display = 'none';
        app.prevLives = undefined;
      }
    });

    const hpKey = `${me.hp}_${me.maxHp}_${me.breath}_${me.maxBreath}_${me.breathRegen}_${me.shield || 0}_${me.lives}_${me.maxLives}`;
    setIfChanged('hp', hpKey, () => {
      const pct = Math.max(0, Math.round((me.hp / me.maxHp) * 100));
      const bPct = Math.max(0, Math.round(((me.breath || 0) / (me.maxBreath || 70)) * 100));
      $('hud-hp-fill').style.width = `${pct}%`;
      $('hud-breath-fill').style.width = `${bPct}%`;
      $('hud-breath-fill').classList.toggle('regen', Boolean(me.breathRegen));
      const shTxt = me.shield > 0 ? ` (+${me.shield} 🛡️)` : '';
      const bStatus = me.breath <= 0 ? ' (KESİLDİ!)' : (me.breathRegen ? ' ↑' : '');
      $('hud-breath-text').textContent = `🫁 Nefes: ${me.breath}/${me.maxBreath}${bStatus}`;
      $('hud-hp-text').textContent = `${ch.icon} ${ch.name} · 🌊 ${me.hp}/${me.maxHp}${shTxt}`;
    });

    // Active Buff / Debuff Status Pills!
    const effList = [];
    if (me.alive) {
      if (me.hasCrown) effList.push({ cls: 'buff', txt: `👑 TAÇ (${st.crownScores?.[me.id] || 0}/100)` });
      if (me.bounty) effList.push({ cls: 'debuff', txt: '💰 KELLE ÖDÜLÜN VAR!' });
      if (me.mirrorTimer > 0) effList.push({ cls: 'shield', txt: `🪞 AYNA ${me.mirrorTimer.toFixed(1)}s` });
      if (me.inShallow) effList.push({ cls: 'buff', txt: '🏖️ SIĞ SU (DALIŞ YOK)' });
      if (me.submerged) effList.push({ cls: 'dive', txt: me.diveTime >= 1.0 ? '🦈 SÜRPRİZ HAZIR' : '🤿 SU ALTINDA' });
      if (me.shield > 0) effList.push({ cls: 'shield', txt: `🛡️ KALKAN ${me.shield}` });
      if (me.speedBoostSec > 0) effList.push({ cls: 'buff', txt: `⚡ HIZ ${me.speedBoostSec.toFixed(1)}s` });
      if (me.slowSec > 0) effList.push({ cls: 'debuff', txt: `🕸️ YAVAŞ ${me.slowSec.toFixed(1)}s` });
      if (me.rootSec > 0) effList.push({ cls: 'debuff', txt: `⚓ ÇAPA ${me.rootSec.toFixed(1)}s` });
      if (me.stunSec > 0) effList.push({ cls: 'debuff', txt: `⚡ SERSEM ${me.stunSec.toFixed(1)}s` });
    }
    const effKey = effList.map(e => e.txt).join('|');
    setIfChanged('effects', effKey, () => {
      $('hud-effects').innerHTML = effList.map(e => `<span class="eff-pill ${e.cls}">${e.txt}</span>`).join('');
    });

    for (let i = 0; i < 2; i++) {
      const it = me.items[i];
      if (!it) continue;
      const slotKey = `${it.id}_${it.usesLeft}_${it.cd.toFixed(1)}`;
      setIfChanged(`slot_${i}`, slotKey, () => {
        const slotEl = $(`hud-slot-${i}`);
        const def = ALL_ITEMS[it.id];
        const depleted = it.usesLeft <= 0;
        const onCd = it.cd > 0 && !depleted;
        const cdPct = onCd ? Math.min(100, Math.round((it.cd / (it.maxCd || 1)) * 100)) : 0;
        slotEl.className = `hud-item-slot ${depleted ? 'depleted' : ''} ${it.firearm ? 'firearm' : ''} ${onCd ? 'cooldown' : ''}`;
        slotEl.innerHTML = `
          ${onCd ? `<div class="cd-sweep" style="height:${cdPct}%"></div>` : ''}
          <div class="slot-key">${i === 0 ? '1 / SOL' : '2 / SAĞ'}</div>
          <div class="slot-ico">${def.icon}</div>
          <div class="slot-meta">
            <div class="slot-title">${def.name}</div>
            <div class="slot-uses">
              ${depleted
                ? '<span class="txt-spent">TÜKENDİ</span>'
                : onCd
                  ? `<span>${it.cd.toFixed(1)}s</span>`
                  : it.longCd
                    ? '<span class="txt-firearm">🔥 HAZIR</span>'
                    : it.firearm
                      ? `<span class="txt-firearm">${it.usesLeft}/1 TEK ATIM</span>`
                      : `<span>${it.usesLeft}/${it.maxUses} HAZIR</span>`}
            </div>
          </div>
        `;
      });
    }

    const spKey = `${me.role}_${me.spaceCd.toFixed(1)}`;
    setIfChanged('space', spKey, () => {
      const spEl = $('hud-slot-space');
      const spReady = me.spaceCd <= 0;
      const spPct = spReady ? 0 : Math.min(100, Math.round((me.spaceCd / (me.spaceMaxCd || 2.3)) * 100));
      const isRam = me.role === 'hunter' || me.role === 'ffa';
      spEl.className = `hud-item-slot space ${spReady ? '' : 'cooldown'}`;
      spEl.innerHTML = `
        ${!spReady ? `<div class="cd-sweep" style="height:${spPct}%"></div>` : ''}
        <div class="slot-key">SPACE</div>
        <div class="slot-ico">${isRam ? '🌊' : '💨'}</div>
        <div class="slot-meta">
          <div class="slot-title">${isRam ? 'Suya Bastır' : 'Dalga Kaçışı'}</div>
          <div class="slot-uses">${spReady ? 'HAZIR' : `${me.spaceCd.toFixed(1)}s`}</div>
        </div>
      `;
    });

    const diveKey = `${me.submerged}_${me.diveTime >= 1.0}_${(me.diveCd || 0).toFixed(1)}_${me.breath < 15}`;
    setIfChanged('dive', diveKey, () => {
      const dEl = $('hud-slot-dive');
      if (!dEl) return;
      const ready = !me.submerged && (me.diveCd || 0) <= 0 && me.breath >= 15;
      const dPct = (!me.submerged && (me.diveCd || 0) > 0) ? Math.min(100, Math.round((me.diveCd / 3.5) * 100)) : 0;
      dEl.className = `hud-item-slot dive ${me.submerged ? 'active-dive' : (ready ? '' : 'cooldown')}`;
      dEl.innerHTML = `
        ${dPct > 0 ? `<div class="cd-sweep" style="height:${dPct}%"></div>` : ''}
        <div class="slot-key">SHIFT/E</div>
        <div class="slot-ico">${me.submerged ? (me.diveTime >= 1.0 ? '🦈' : '🤿') : '🤿'}</div>
        <div class="slot-meta">
          <div class="slot-title">${me.submerged ? 'Yüzeye Çık' : 'Su Altı Dal'}</div>
          <div class="slot-uses">${me.submerged
            ? (me.diveTime >= 1.0 ? '<span class="txt-firearm">SÜRPRİZ HAZIR!</span>' : 'GİZLİ')
            : ((me.diveCd || 0) > 0 ? `${me.diveCd.toFixed(1)}s` : (me.breath < 15 ? 'NEFES AZ' : 'HAZIR'))}</div>
        </div>
      `;
    });
  }

  const teamKey = (st.players || []).map(p => `${p.id}:${p.alive}:${p.lives}:${p.hasCrown}:${p.bounty}:${st.ffaScores?.[p.id] || 0}:${st.crownScores?.[p.id] || 0}`).join('|') + `_${st.mode}`;
  setIfChanged('teams', teamKey, () => {
    const hIcons = (p) => (p.maxLives || 1) > 1 ? ` ${'❤️'.repeat(Math.max(0, p.lives || 0))}` : '';
    const isOut = (p) => !p.alive && (p.lives || 0) <= 0 && !isCrown;
    if (isCrown) {
      const all = (st.players || []).slice().sort((a, b) => (st.crownScores?.[b.id] || 0) - (st.crownScores?.[a.id] || 0));
      $('hud-team-a').innerHTML = all.map(p => `<span class="mini-p ${p.hasCrown ? 'alive' : ''}">${p.hasCrown ? '👑' : '⚓'} ${p.name}${hIcons(p)}: <b>${st.crownScores?.[p.id] || 0}/100</b> (${st.ffaScores?.[p.id] || 0}🏆)</span>`).join('');
      $('hud-team-b').innerHTML = '';
    } else if (isFfa) {
      const all = (st.players || []).slice().sort((a, b) => (st.ffaScores?.[b.id] || 0) - (st.ffaScores?.[a.id] || 0));
      $('hud-team-a').innerHTML = all.map(p => `<span class="mini-p ${isOut(p) ? 'sunk' : 'alive'}">${p.bounty ? '💰' : '💀'} ${p.name}${hIcons(p)}: <b>${st.ffaScores?.[p.id] || 0}</b></span>`).join('');
      $('hud-team-b').innerHTML = '';
    } else {
      const teamA = (st.players || []).filter(p => p.team === 'A');
      const teamB = (st.players || []).filter(p => p.team === 'B');
      $('hud-team-a').innerHTML = teamA.map(p => `<span class="mini-p ${isOut(p) ? 'sunk' : 'alive'}" title="${p.name}">${p.bounty ? '💰' : (p.role === 'hunter' ? '🎯' : '🌊')} ${p.name}${hIcons(p)}</span>`).join('');
      $('hud-team-b').innerHTML = teamB.map(p => `<span class="mini-p ${isOut(p) ? 'sunk' : 'alive'}" title="${p.name}">${p.bounty ? '💰' : (p.role === 'hunter' ? '🎯' : '🌊')} ${p.name}${hIcons(p)}</span>`).join('');
    }
  });

  const feedKey = (st.feed || []).map(f => f.id).join(',');
  setIfChanged('feed', feedKey, () => {
    $('hud-feed').innerHTML = (st.feed || []).map(f => `<div class="feed-item ${f.kind}">${f.text}</div>`).join('');
  });
}

function renderIntroVS(st) {
  const map = SEA_MAPS[(st.mapIndex || 0) % SEA_MAPS.length];
  const secs = Math.max(0, Math.ceil(st.phaseTimer));
  setIfChanged('introTimer', secs, () => {
    $('intro-countdown').textContent = secs > 0 ? String(secs) : 'BAŞLA!';
  });

  const rosterKey = `${st.round}_${st.mode}_${(st.players || []).map(p => p.id + ':' + (p.items || []).map(i => i.id).join(',')).join('|')}`;
  setIfChanged('introRoster', rosterKey, () => {
    const ev = st.roundEvent ? ROUND_EVENT_MAP[st.roundEvent] : null;
    $('intro-map-title').textContent = `TUR ${st.round}/${st.totalRounds} · ${map.name.toUpperCase()}${ev ? ` · ${ev.icon} ${ev.name.toUpperCase()}` : ''}`;

    const renderCard = (p) => {
      const ch = CHAR_MAP[p.charId] || CHARACTERS[0];
      const isMe = p.id === app.myId;
      const itemChips = (p.items || []).map(it => {
        const def = ALL_ITEMS[it.id];
        if (!def) return '';
        return `<span class="vs-item ${def.firearm ? 'firearm' : ''}">${def.icon} ${def.name}</span>`;
      }).join('');
      return `
        <div class="vs-card ${isMe ? 'me' : ''}" style="--char-color:${ch.color}">
          <div class="vs-card-top">
            <div class="vs-avatar">${ch.icon}</div>
            <div class="vs-meta">
              <div class="vs-name">${p.name} ${isMe ? '<span class="tag-me">SEN</span>' : ''}</div>
              <div class="vs-char">${ch.name} · ${ch.roleTag}</div>
            </div>
          </div>
          <div class="vs-items">${itemChips}</div>
        </div>
      `;
    };

    const body = $('intro-vs-body');
    if (st.mode === 'ffa' || st.mode === 'crown') {
      body.className = 'vs-body ffa';
      body.innerHTML = `
        <div class="vs-ffa-title">${st.mode === 'crown' ? '👑 ALTIN TAÇ — 100 PUANA İLK ULAŞAN KAZANIR!' : '💀 HERKES TEK — SON AYAKTA KALAN KAZANIR!'}</div>
        <div class="vs-ffa-grid">${(st.players || []).map(renderCard).join('')}</div>
      `;
    } else {
      const hunters = (st.players || []).filter(p => p.role === 'hunter');
      const prey = (st.players || []).filter(p => p.role === 'prey');
      body.className = 'vs-body teams';
      body.innerHTML = `
        <div class="vs-side hunter">
          <div class="vs-side-head">🎯 AVCILAR</div>
          <div class="vs-side-cards">${hunters.map(renderCard).join('')}</div>
        </div>
        <div class="vs-center-emblem">VS</div>
        <div class="vs-side prey">
          <div class="vs-side-head">🌊 AVLAR</div>
          <div class="vs-side-cards">${prey.map(renderCard).join('')}</div>
        </div>
      `;
    }
  });
}

function renderRoundEnd(st) {
  if (st.mode === 'ffa' || st.mode === 'crown') {
    const ico = st.mode === 'crown' ? '👑' : '💀';
    $('round-end-title').textContent = `${ico} ${st.roundWinnerName || 'TUR BİTTİ'} KAZANDI!`;
    $('round-end-reason').textContent = st.roundReason;
    const board = (st.players || [])
      .map(p => `${p.name}: ${st.ffaScores?.[p.id] || 0}`)
      .join('  ·  ');
    $('round-end-score').textContent = board;
    $('round-end-next').textContent = `${st.mode === 'crown' ? 'Yeni Altın Taç turu' : 'Yeni Deathmatch turu'} başlıyor! (${Math.max(0, Math.ceil(st.phaseTimer))}s)`;
    return;
  }
  const winTeamLabel = st.roundWinnerTeam === 'A' ? 'TAKIM A (ALTIN)' : 'TAKIM B (TURKUAZ)';
  const winRoleLabel = st.roundWinnerRole === 'hunter' ? 'AVCILAR KAZANDI!' : 'AVLAR KAZANDI!';
  $('round-end-title').textContent = `${winTeamLabel} — ${winRoleLabel}`;
  $('round-end-reason').textContent = st.roundReason;
  $('round-end-score').textContent = `TAKIM A  ${st.scores.A}  -  ${st.scores.B}  TAKIM B`;
  $('round-end-next').textContent = `Sonraki turda ROLLER DEĞİŞİYOR! (${Math.max(0, Math.ceil(st.phaseTimer))}s)`;
}

function computeMatchAwards(st) {
  const list = (st.matchStats && st.matchStats.length)
    ? st.matchStats.map(s => ({ ...s }))
    : (st.players || []).map(p => ({
        id: p.id, name: p.name, team: p.team, charId: p.charId,
        sinks: p.sinks || 0, damage: 0, ambushes: 0, rescues: 0, barrels: 0, powerups: 0, survived: 0, deaths: 0
      }));

  // Calculate MVP score for each player
  for (const s of list) {
    const ffaBonus = (st.mode === 'ffa' || st.mode === 'crown') ? (st.ffaScores?.[s.id] || 0) * 140 : 0;
    s.mvpScore = ffaBonus + s.sinks * 120 + s.rescues * 95 + s.ambushes * 55 + s.barrels * 40 + s.survived * 50 + s.powerups * 20 + Math.round(s.damage * 0.45);
  }
  list.sort((a, b) => b.mvpScore - a.mvpScore);

  const used = new Set();
  const assignTitle = (s) => {
    const candidates = [
      { ok: s.rescues >= 1, title: '🛟 Can Kurtaran' },
      { ok: s.ambushes >= 1, title: '🦈 Köpekbalığı Pusucusu' },
      { ok: s.barrels >= 2, title: '🧨 Barut Delisi' },
      { ok: s.sinks >= 2, title: '🌊 Derinlerin Katili' },
      { ok: s.powerups >= 3, title: '📦 Hazine Avcısı' },
      { ok: s.damage >= 300, title: '💥 Topçu Başı' },
      { ok: s.survived >= 2 && s.deaths <= 1, title: '👻 Batmaz Gemi' },
      { ok: s.deaths >= 3, title: '⚓ Çapa Magneti' }
    ];
    for (const c of candidates) {
      if (c.ok && !used.has(c.title)) {
        used.add(c.title);
        return c.title;
      }
    }
    const fallbacks = ['⛵ Açık Deniz Kurdu', '🧭 Fırtına Kaptanı', '🌊 Dalga Savaşçısı', '🔱 Usta Denizci'];
    const pick = fallbacks.find(t => !used.has(t)) || '⛵ Denizci';
    used.add(pick);
    return pick;
  };

  for (const s of list) {
    s.title = assignTitle(s);
  }
  return list;
}

function renderMatchEnd(st) {
  const meKey = `${st.mode}_${st.round}_${st.scores?.A}_${st.scores?.B}_${st.matchWinnerTeam}_${st.matchWinnerName}`;
  setIfChanged('matchEnd', meKey, () => {
    const isSolo = st.mode === 'ffa' || st.mode === 'crown';
    if (isSolo) {
      $('match-end-title').textContent = `🏆 ${st.matchWinnerName || 'ŞAMPİYON'} KAZANDI!`;
      $('match-end-score').textContent = st.mode === 'crown' ? 'ALTIN TAÇ FİNAL SIRALAMASI' : 'DEATHMATCH FİNAL SIRALAMASI';
    } else {
      const winTeamLabel = st.matchWinnerTeam === 'A' ? 'TAKIM A (ALTIN)' : 'TAKIM B (TURKUAZ)';
      $('match-end-title').textContent = `🏆 ${winTeamLabel} ŞAMPİYON!`;
      $('match-end-score').textContent = `FİNAL SKORU: TAKIM A ${st.scores.A} - ${st.scores.B} TAKIM B`;
    }

    const awards = computeMatchAwards(st);
    recordCareerMatch(st, awards);
    const mvp = awards[0];
    if (mvp) {
      const mch = CHAR_MAP[mvp.charId] || CHARACTERS[0];
      $('match-mvp-banner').innerHTML = `
        <div class="mvp-crown">👑 MAÇIN MVP'Sİ</div>
        <div class="mvp-main">
          <span class="mvp-ico">${mch.icon}</span>
          <div>
            <div class="mvp-name">${mvp.name} <span class="mvp-title-badge">${mvp.title}</span></div>
            <div class="mvp-sub">🌊 ${mvp.sinks} Batırma · 💥 ${mvp.damage} Hasar · 🦈 ${mvp.ambushes} Pusu · 🛟 ${mvp.rescues} Kurtarma</div>
          </div>
        </div>
      `;
      $('match-mvp-banner').style.display = 'block';
    }

    const rows = awards.map((s, idx) => {
      const ch = CHAR_MAP[s.charId] || CHARACTERS[0];
      const teamTag = isSolo
        ? `🏆 ${st.ffaScores?.[s.id] || 0} Tur`
        : `Takım ${s.team}`;
      return `
        <div class="stat-card ${idx === 0 ? 'mvp' : ''}">
          <div class="stat-card-top">
            <div class="stat-player">
              <span class="stat-rank">#${idx + 1}</span>
              <span class="stat-ico">${ch.icon}</span>
              <div>
                <div class="stat-name">${s.name} <span class="stat-team">${teamTag}</span></div>
                <div class="stat-award">${s.title}</div>
              </div>
            </div>
            <div class="stat-pts">${s.mvpScore} Puan</div>
          </div>
          <div class="stat-pills">
            <span>🌊 Batırma: <b>${s.sinks}</b></span>
            <span>💥 Hasar: <b>${s.damage}</b></span>
            <span>🦈 Sürpriz: <b>${s.ambushes}</b></span>
            <span>🛟 Kurtarma: <b>${s.rescues}</b></span>
            <span>🧨 Fıçı: <b>${s.barrels}</b></span>
            <span>📦 Sandık: <b>${s.powerups}</b></span>
          </div>
        </div>
      `;
    }).join('');
    $('match-end-stats').innerHTML = rows;

    const isHostLike = app.mode === 'host' || app.mode === 'offline';
    $('btn-rematch').style.display = isHostLike ? '' : 'none';
    $('btn-back-lobby').style.display = isHostLike ? '' : 'none';
  });
}

// ============================================================
// INPUT & RENDER LOOP
// ============================================================

function useSlot(slotIdx) {
  const st = app.liveState;
  if (!st || st.phase !== 'playing') return;
  sfx.unlock();
  if (app.sim) {
    app.sim.triggerItem(app.myId, slotIdx, app.localAim);
  } else {
    app.net?.send({ type: 'useItem', slot: slotIdx, aim: Number(app.localAim.toFixed(2)) });
  }
  const me = st.players?.find(p => p.id === app.myId);
  const it = me?.items?.[slotIdx];
  if (it?.firearm && it.usesLeft > 0) {
    getActiveRenderer()?.triggerShake(9);
  }
}

function getActiveRenderer() {
  return (app.viewMode === '3d' && app.renderer3d) ? app.renderer3d : app.renderer;
}

function updateViewToggleButtons() {
  const is3d = app.viewMode === '3d';
  const pairs = [
    ['btn-view-home', is3d ? '🧊 3D Açık' : '🎨 2D'],
    ['btn-view-lobby', is3d ? '🧊 3D Açık' : '🎨 2D'],
    ['btn-view-game', is3d ? '🧊 3D' : '2D']
  ];
  for (const [id, label] of pairs) {
    const el = $(id);
    if (!el) continue;
    el.textContent = label;
    el.classList.toggle('is-3d', is3d);
  }
  const c2 = $('game-canvas');
  const c3 = $('game-canvas-3d');
  const ov = $('game-overlay-2d');
  const camBtn = $('btn-cam-3d');
  const use3dCanvas = is3d && Boolean(app.renderer3d);
  if (c2) c2.style.display = use3dCanvas ? 'none' : 'block';
  if (c3) c3.style.display = use3dCanvas ? 'block' : 'none';
  if (ov) ov.style.display = use3dCanvas ? 'block' : 'none';
  if (camBtn) camBtn.style.display = use3dCanvas ? '' : 'none';
}

async function setViewMode(mode, silent = false) {
  const target = mode === '3d' ? '3d' : '2d';
  if (target === '3d') {
    if (!app.renderer3d) {
      if (app.loading3d) return;
      app.loading3d = true;
      if (!silent) showToast('🧊 3D motoru yükleniyor...');
      try {
        const mod = await import('./render3d.js?v=5.1');
        app.renderer3d = new mod.SeaRenderer3D($('game-canvas-3d'), $('game-overlay-2d'));
      } catch (err) {
        console.warn('3D WebGL init error:', err);
        app.viewMode = '2d';
        try { localStorage.setItem('derinav_view_mode', '2d'); } catch (_) {}
        updateViewToggleButtons();
        if (!silent) showToast('⚠️ Bu cihazda 3D WebGL açılamadı, 2D devam ediliyor.');
        app.loading3d = false;
        return;
      }
      app.loading3d = false;
    }
    app.viewMode = '3d';
    try { localStorage.setItem('derinav_view_mode', '3d'); } catch (_) {}
    updateViewToggleButtons();
    app.renderer3d?.resize();
    if (!silent) showToast('🧊 3D Görünüm aktif! (İstediğin an 2D’ye dönebilirsin)');
  } else {
    app.viewMode = '2d';
    try { localStorage.setItem('derinav_view_mode', '2d'); } catch (_) {}
    updateViewToggleButtons();
    if (!silent) showToast('🎨 Klasik 2D Görünüm aktif!');
  }
}

function useSpace() {
  const st = app.liveState;
  if (!st || st.phase !== 'playing') return;
  sfx.unlock();
  if (app.sim) {
    app.sim.triggerSpace(app.myId, app.localAim);
  } else {
    app.net?.send({ type: 'space', aim: Number(app.localAim.toFixed(2)) });
    // Instant dash prediction feel on client!
    if (app.pred) {
      app.pred.vx = Math.cos(app.localAim) * 520;
      app.pred.vy = Math.sin(app.localAim) * 520;
    }
  }
}

function useDive() {
  const st = app.liveState;
  if (!st || st.phase !== 'playing') return;
  sfx.unlock();
  if (app.sim) {
    app.sim.toggleDive(app.myId);
  } else {
    app.net?.send({ type: 'dive' });
  }
}

function useEmote(idx) {
  const st = app.liveState;
  if (!st || st.phase !== 'playing') return;
  sfx.unlock();
  if (app.sim) {
    app.sim.triggerEmote(app.myId, idx);
  } else {
    app.net?.send({ type: 'emote', idx });
  }
}

function getMoveVector() {
  let mx = app.touchMove.mx;
  let my = app.touchMove.my;
  if (app.keys.has('KeyW') || app.keys.has('ArrowUp')) my -= 1;
  if (app.keys.has('KeyS') || app.keys.has('ArrowDown')) my += 1;
  if (app.keys.has('KeyA') || app.keys.has('ArrowLeft')) mx -= 1;
  if (app.keys.has('KeyD') || app.keys.has('ArrowRight')) mx += 1;
  return { mx, my };
}

function sendClientInputNow() {
  if (app.mode !== 'client' || !app.liveState || app.liveState.phase !== 'playing') return;
  const mv = getMoveVector();
  app.lastInputSend = performance.now();
  app.lastSentMoveKey = `${mv.mx.toFixed(2)}_${mv.my.toFixed(2)}`;
  app.net?.send({
    type: 'input',
    input: { mx: mv.mx, my: mv.my, aim: Number(app.localAim.toFixed(2)) }
  });
}

let lastFrameTime = performance.now();

function renderLoop(now) {
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  // 🔌 Host bağlantı kopması kontrolü (9.5 sn hiç paket gelmezse bekletmeden çık!)
  if (app.mode === 'client' && (app.lobbyState || app.liveState) && app.lastHostPacketAt > 0 && now - app.lastHostPacketAt > 9500) {
    leaveRoom();
    showToast('⚠️ Oda kurucusuyla bağlantı kesildi!');
  }

  const activeR = getActiveRenderer();
  if (activeR && app.liveState && app.liveState.phase === 'playing') {
    const me = app.liveState.players?.find(p => p.id === app.myId);
    if (me && (!app.touchAimMode || app.touchAimActive)) {
      const worldMouse = activeR.screenToWorld(app.mouseX, app.mouseY);
      const sp = app.pred || activeR.smoothPos.get(me.id) || me;
      app.localAim = Math.atan2(worldMouse.y - sp.y, worldMouse.x - sp.x);
    }

    if (app.mode === 'client') {
      stepClientPrediction(dt);
      const mv = getMoveVector();
      const moveKey = `${mv.mx.toFixed(2)}_${mv.my.toFixed(2)}`;
      // Hareket tuşu değiştiği an ANINDA gönder, yoksa 38ms'de bir aim güncelle
      if (moveKey !== app.lastSentMoveKey || now - app.lastInputSend >= 38) {
        sendClientInputNow();
      }
    }
  }

  // Render canvas & HUD when tab is visible
  if (app.renderer && $('screen-home').classList.contains('active')) {
    app.renderer.renderHomeBg($('home-canvas'), dt);
  } else if (app.renderer && $('screen-lobby').classList.contains('active')) {
    app.renderer.renderHomeBg($('lobby-canvas'), dt);
  } else if (activeR && app.liveState && $('screen-game').classList.contains('active')) {
    if (app.sim) {
      updateHudFromState(app.liveState);
    }
    activeR.render(app.liveState, app.myId, dt, app.localAim, app.pred, app.touchJoy);
  }

  requestAnimationFrame(renderLoop);
}

// ============================================================
// EVENT WIRING & INITIALIZATION
// ============================================================

function renderLobbyRulesSummary(st) {
  const s = st.settings || {
    mode: '2v2',
    totalRounds: st.totalRounds || 4,
    roundDuration: 85,
    hpMult: 1,
    mapMode: 'rotate',
    firearmMode: 'single',
    powerups: true,
    barrels: true,
    storm: true,
    rescue: true
  };
  const mapLabel = s.mapMode === 'rotate'
    ? '🔄 Dönüşümlü'
    : (SEA_MAPS[Number(s.mapMode)]?.name || 'Harita');
  const hpLabel = `%${Math.round((s.hpMult || 1) * 100)} Can`;
  const gunLabel = s.firearmMode === 'long_cd' ? '⏳ Silah 30s CD' : '🔥 Tek Atım (Ağır)';
  const modeLabel = s.mode === '1v1' ? '⚔️ 1v1' : s.mode === 'crown' ? '👑 Altın Taç' : s.mode === 'ffa' ? '💀 FFA' : '👥 2v2';
  const livesVal = s.lives || 1;
  const pills = [
    modeLabel,
    `🏁 ${s.totalRounds} Tur`,
    `⏱️ ${s.roundDuration}sn`,
    `${'❤️'.repeat(livesVal)} ${livesVal} Kalp`,
    ...(s.hpMult && s.hpMult !== 1 ? [`🛡️ ${hpLabel}`] : []),
    `🗺️ ${mapLabel}`,
    s.firearmMode === 'long_cd' ? '⏳ Silah 30s CD' : '🔥 Tek Atım',
    ...(s.skillTree === false ? ['🌿 Ağaç Kapalı'] : []),
    ...(s.roundEvents === false ? ['🎲 Olay Kapalı'] : []),
    ...(s.powerups === false ? ['📦 Sandık Kapalı'] : []),
    ...(s.barrels === false ? ['🧨 Fıçı Kapalı'] : []),
    ...(s.storm === false ? ['🌪️ Fırtına Kapalı'] : []),
    ...(s.mode === '2v2' && s.rescue === false ? ['🛟 Kurtarma Kapalı'] : [])
  ];
  $('lobby-rules-summary').innerHTML = pills.map(p => `<span class="rule-chip">${p}</span>`).join('');
}

function renderSettingsModal() {
  if (!app.sim) return;
  const s = app.sim.settings;
  document.querySelectorAll('.seg-group').forEach(grp => {
    const key = grp.dataset.setting;
    const cur = String(s[key]);
    grp.querySelectorAll('.seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === cur);
    });
  });
  document.querySelectorAll('.toggle-chip').forEach(btn => {
    const key = btn.dataset.toggle;
    const on = Boolean(s[key]);
    btn.classList.toggle('on', on);
  });
}

function checkVersionMismatch(hostVersion) {
  const banner = $('version-mismatch');
  if (!banner) return;
  if (hostVersion && hostVersion !== GAME_VERSION) {
    $('version-mismatch-text').textContent = `⚠️ Sürüm farklı! Host: ${hostVersion} · Sende: ${GAME_VERSION}`;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

function initVersionUI() {
  const btn = $('btn-version');
  if (btn) {
    btn.textContent = GAME_VERSION;
    btn.onclick = () => {
      // 🔒 Gizli 5 tıkla Denge Telemetri Panelini aç (normal 1 tık Yama Notları açar!)
      app.verClicks += 1;
      clearTimeout(app.verClickTimer);
      app.verClickTimer = setTimeout(() => { app.verClicks = 0; }, 1200);
      if (app.verClicks >= 5) {
        app.verClicks = 0;
        $('overlay-changelog').classList.remove('active');
        openTelemetryAdmin();
        return;
      }
      $('changelog-title').textContent = `Yama Notları (${GAME_VERSION})`;
      $('changelog-body').innerHTML = CHANGELOG.map(entry => `
        <div class="cl-entry">
          <div class="cl-ver">${entry.ver}</div>
          <ul>${entry.notes.map(n => `<li>${n}</li>`).join('')}</ul>
        </div>
      `).join('');
      $('overlay-changelog').classList.add('active');
      sfx.play('ui');
    };
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get('admin') === '1') {
    setTimeout(openTelemetryAdmin, 250);
  }
  const closeBtn = $('btn-close-changelog');
  if (closeBtn) {
    closeBtn.onclick = () => $('overlay-changelog').classList.remove('active');
  }
  const overlay = $('overlay-changelog');
  if (overlay) {
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.classList.remove('active');
    };
  }
  const reloadBtn = $('btn-reload-ver');
  if (reloadBtn) {
    reloadBtn.onclick = () => {
      const u = new URL(window.location.href);
      u.searchParams.set('_r', Date.now());
      window.location.replace(u.toString());
    };
  }
}

function init() {
  window.__DERINAV_BOOTED = true;
  app.renderer = new SeaRenderer($('game-canvas'));
  initVersionUI();

  if (app.myName) $('input-name').value = app.myName;

  const params = new URLSearchParams(window.location.search);
  const urlRoom = params.get('room');
  if (urlRoom) {
    const cleanCode = urlRoom.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    // Ölü davet linkini körü körüne gösterme — önce Host hâlâ canlı mı kontrol et!
    checkRoomAlive(cleanCode, 2600).then((alive) => {
      if (app.mode !== 'menu') return;
      if (alive) {
        $('input-code').value = cleanCode;
        $('invite-banner').style.display = 'flex';
        $('invite-banner-code').textContent = cleanCode;
      } else {
        $('invite-banner').style.display = 'none';
        $('input-code').value = '';
        updateUrlRoom(null);
        showToast(`ℹ️ ${cleanCode} odası artık kapalı.`);
      }
    });
  }

  $('btn-host').onclick = startHostOnline;
  $('btn-join').onclick = () => joinOnlineRoom();
  $('btn-quick-solo').onclick = startQuickSolo;
  $('btn-invite-go').onclick = () => joinOnlineRoom(urlRoom);
  $('btn-career-home').onclick = openCareerModal;
  $('btn-close-career').onclick = () => $('overlay-career').classList.remove('active');
  $('overlay-career').onclick = (e) => { if (e.target === $('overlay-career')) $('overlay-career').classList.remove('active'); };

  $('btn-close-admin').onclick = () => $('overlay-admin').classList.remove('active');
  $('overlay-admin').onclick = (e) => { if (e.target === $('overlay-admin')) $('overlay-admin').classList.remove('active'); };
  $('btn-copy-telem').onclick = async () => {
    const json = JSON.stringify(lastDisplayedTelem || loadTelemetry(), null, 2);
    try { await navigator.clipboard.writeText(json); showToast('Telemetri JSON kopyalandı!'); }
    catch (_) { prompt('Telemetri JSON:', json); }
  };
  $('btn-reset-telem').onclick = () => {
    if (telemTab === 'solo') {
      localStorage.removeItem(TELEM_SOLO_KEY);
      showToast('Solo test kayıtları sıfırlandı');
    } else {
      localStorage.removeItem(TELEM_KEY);
      showToast('Bu tarayıcının PvP kaydı sıfırlandı (bulut verisi korunur)');
    }
    refreshTelemetryView();
  };

  $('btn-copy-link').onclick = async () => {
    const link = getInviteUrl();
    try {
      await navigator.clipboard.writeText(link);
      showToast('Davet linki kopyalandı! Arkadaşlarına gönder.');
    } catch (_) {
      prompt('Davet linkini kopyala:', link);
    }
    sfx.play('ui');
  };

  $('btn-switch-team').onclick = () => {
    sfx.play('ui');
    if (app.sim) {
      app.sim.switchTeam(app.myId);
      broadcastLobby();
      renderLobby();
    } else {
      app.net?.send({ type: 'switchTeam' });
    }
  };

  $('btn-fill-bots').onclick = () => {
    if (!app.sim) return;
    app.sim.fillEmptyWithBots();
    broadcastLobby();
    renderLobby();
    sfx.play('ui');
  };

  $('btn-open-settings').onclick = () => {
    if (!app.sim) return;
    renderSettingsModal();
    $('overlay-settings').classList.add('active');
    sfx.play('ui');
  };

  $('btn-close-settings').onclick = () => {
    $('overlay-settings').classList.remove('active');
    sfx.play('ui');
  };

  $('overlay-settings').onclick = (e) => {
    if (e.target === $('overlay-settings')) $('overlay-settings').classList.remove('active');
  };

  $('btn-preset-std').onclick = () => {
    if (!app.sim) return;
    app.sim.updateSettings({
      mode: app.sim.settings.mode, totalRounds: 4, roundDuration: 85, hpMult: 1, lives: 1, skillTree: true,
      mapMode: 'rotate', firearmMode: 'single', powerups: true, barrels: true, storm: true, rescue: true
    });
    broadcastLobby();
    renderLobby();
    renderSettingsModal();
    sfx.play('ui');
  };

  $('btn-preset-chaos').onclick = () => {
    if (!app.sim) return;
    app.sim.updateSettings({
      mode: 'ffa', totalRounds: 4, roundDuration: 85, hpMult: 1, lives: 3, skillTree: true,
      mapMode: '4', firearmMode: 'long_cd', powerups: true, barrels: true, storm: true, rescue: true
    });
    broadcastLobby();
    renderLobby();
    renderSettingsModal();
    sfx.play('ui');
  };

  document.querySelectorAll('.seg-group').forEach(grp => {
    const key = grp.dataset.setting;
    grp.querySelectorAll('.seg-btn').forEach(btn => {
      btn.onclick = () => {
        if (!app.sim) return;
        const raw = btn.dataset.val;
        const val = (key === 'mapMode' || key === 'firearmMode' || key === 'mode') ? raw : Number(raw);
        app.sim.updateSettings({ [key]: val });
        broadcastLobby();
        renderLobby();
        renderSettingsModal();
        sfx.play('ui');
      };
    });
  });

  document.querySelectorAll('.toggle-chip').forEach(btn => {
    const key = btn.dataset.toggle;
    btn.onclick = () => {
      if (!app.sim) return;
      app.sim.updateSettings({ [key]: !app.sim.settings[key] });
      broadcastLobby();
      renderLobby();
      renderSettingsModal();
      sfx.play('ui');
    };
  });

  $('btn-start-match').onclick = () => {
    if (!app.sim) return;
    sfx.unlock();
    app.sim.startMatch();
    broadcastLobby();
  };

  $('btn-leave-lobby').onclick = leaveRoom;

  $('btn-lock-items').onclick = () => {
    if (app.draftPicks.length !== 2) return;
    sfx.play('ui');
    if (app.sim) {
      app.sim.setPlayerItems(app.myId, [...app.draftPicks], true);
      broadcastLobby();
      renderDraftUI();
    } else {
      app.net?.send({ type: 'pickItems', items: [...app.draftPicks], ready: true });
      $('btn-lock-items').disabled = true;
      $('btn-lock-items').textContent = '✓ Gönderildi...';
    }
  };

  $('btn-rematch').onclick = () => {
    if (!app.sim) return;
    app.hudCache = {};
    app.matchRecordedKey = '';
    app.draftRoundSeen = -1;
    app.sim.startMatch();
    broadcastLobby();
  };

  $('btn-back-lobby').onclick = () => {
    if (!app.sim) return;
    app.sim.backToLobby();
    broadcastLobby();
    renderLobby();
  };

  const toggleMute = () => {
    const next = !sfx.muted;
    sfx.setMuted(next);
    const ico = next ? '🔇' : '🔊';
    $('btn-mute').textContent = ico;
    if ($('btn-home-mute')) $('btn-home-mute').textContent = ico;
  };
  $('btn-mute').onclick = toggleMute;
  if ($('btn-home-mute')) $('btn-home-mute').onclick = toggleMute;

  const ambBtn = $('btn-ambient');
  if (ambBtn) {
    ambBtn.onclick = () => {
      const next = !sfx.ambientOn;
      sfx.setAmbient(next);
      ambBtn.style.opacity = next ? '1' : '0.45';
      showToast(next ? '🌊 Okyanus dalga sesi açıldı' : '🌊 Okyanus dalga sesi kapatıldı');
    };
  }

  // ⛶ Tam Ekran Butonları (Ana Menü & Oyun İçi)
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
    sfx.play('ui');
  };
  if ($('btn-fullscreen')) $('btn-fullscreen').onclick = toggleFullscreen;
  if ($('btn-home-fs')) $('btn-home-fs').onclick = toggleFullscreen;
  if ($('btn-lobby-fs')) $('btn-lobby-fs').onclick = toggleFullscreen;

  // 🚪 Maç içinden güvenli çift-tıkla Lobiye Dön / Çık!
  const exitBtn = $('btn-game-exit');
  if (exitBtn) {
    exitBtn.onclick = () => {
      if (exitBtn.dataset.armed === '1') {
        clearTimeout(app.exitArmTimer);
        exitBtn.dataset.armed = '0';
        exitBtn.style.borderColor = '';
        if (app.sim) {
          app.sim.backToLobby();
          broadcastLobby();
          renderLobby();
        } else {
          leaveRoom();
        }
        sfx.play('ui');
      } else {
        exitBtn.dataset.armed = '1';
        exitBtn.style.borderColor = '#ef4444';
        showToast(app.sim ? '🚪 Lobiye dönmek için tekrar tıkla!' : '🚪 Odadan çıkmak için tekrar tıkla!');
        clearTimeout(app.exitArmTimer);
        app.exitArmTimer = setTimeout(() => {
          exitBtn.dataset.armed = '0';
          exitBtn.style.borderColor = '';
        }, 3000);
      }
    };
  }

  // ⌨️ Oda kodunda Enter'a basınca direkt katıl!
  $('input-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      joinOnlineRoom();
    }
  });

  // Lobide 1-tıkla Hızlı Mod Seçici (2v2 / 1v1 / Herkes Tek / Altın Taç)
  document.querySelectorAll('[data-qmode]').forEach(btn => {
    btn.onclick = () => {
      if (!app.sim) return;
      app.sim.updateSettings({ mode: btn.dataset.qmode });
      broadcastLobby();
      renderLobby();
      sfx.play('ui');
    };
  });

  // Lobide 1-tıkla Mario Kalp Seçici (❤️ 1 / ❤️❤️ 2 / ❤️❤️❤️ 3)
  document.querySelectorAll('[data-qlives]').forEach(btn => {
    btn.onclick = () => {
      if (!app.sim) return;
      app.sim.updateSettings({ lives: Number(btn.dataset.qlives) });
      broadcastLobby();
      renderLobby();
      sfx.play('ui');
    };
  });

  // Draft kategori filtreleri
  document.querySelectorAll('[data-dfilter]').forEach(btn => {
    btn.onclick = () => {
      app.draftFilter = btn.dataset.dfilter;
      sfx.play('ui');
      renderDraftUI();
    };
  });

  // 📖 Oyun İçi Rehber Modalı (Ana menü, lobi ve oyun içinden açılır)
  const openGuide = () => {
    $('overlay-guide').classList.add('active');
    sfx.play('ui');
  };
  const closeGuide = () => {
    $('overlay-guide').classList.remove('active');
  };
  ['btn-guide-home', 'btn-guide-lobby', 'btn-guide-game'].forEach(id => {
    const el = $(id);
    if (el) el.onclick = openGuide;
  });
  $('btn-close-guide').onclick = closeGuide;
  $('overlay-guide').onclick = (e) => {
    if (e.target === $('overlay-guide')) closeGuide();
  };
  document.querySelectorAll('[data-guide-tab]').forEach(tabBtn => {
    tabBtn.onclick = () => {
      const target = tabBtn.dataset.guideTab;
      document.querySelectorAll('[data-guide-tab]').forEach(b => b.classList.toggle('active', b === tabBtn));
      document.querySelectorAll('[data-guide-panel]').forEach(p => p.classList.toggle('active', p.dataset.guidePanel === target));
      sfx.play('ui');
    };
  });

  $('hud-slot-0').onclick = () => useSlot(0);
  $('hud-slot-1').onclick = () => useSlot(1);
  $('hud-slot-space').onclick = () => useSpace();
  $('hud-slot-dive').onclick = () => useDive();
  document.querySelectorAll('[data-emote]').forEach(btn => {
    btn.onclick = () => useEmote(Number(btn.dataset.emote));
  });

  const INFO_MODALS = ['overlay-guide', 'overlay-settings', 'overlay-career', 'overlay-admin', 'overlay-changelog'];
  const isInfoModalOpen = () => INFO_MODALS.some(id => $(id)?.classList.contains('active'));

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      let closed = false;
      for (const id of INFO_MODALS) {
        const el = $(id);
        if (el?.classList.contains('active')) {
          el.classList.remove('active');
          closed = true;
        }
      }
      if (closed) { sfx.play('ui'); return; }
    }
    if (document.activeElement?.tagName === 'INPUT') return;
    if (isInfoModalOpen()) return;
    const had = app.keys.has(e.code);
    app.keys.add(e.code);
    if (!had && app.mode === 'client') sendClientInputNow();
    if (e.code === 'Digit1') useSlot(0);
    if (e.code === 'Digit2') useSlot(1);
    if (e.code === 'Digit3' && !e.repeat) useEmote(0);
    if (e.code === 'Digit4' && !e.repeat) useEmote(1);
    if (e.code === 'Digit5' && !e.repeat) useEmote(2);
    if (e.code === 'Digit6' && !e.repeat) useEmote(3);
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE') && !e.repeat) {
      e.preventDefault();
      useDive();
    }
    if (e.code === 'Space') {
      e.preventDefault();
      useSpace();
    }
    if (e.code === 'KeyC' && !e.repeat && app.viewMode === '3d' && app.renderer3d && $('screen-game').classList.contains('active')) {
      const cm = app.renderer3d.toggleCameraMode();
      sfx.play('ui');
      showToast(cm === 'sinematik' ? '🎥 Sinematik Alçak 3D Kamera' : '🎥 Taktiksel Yüksek 3D Kamera');
    }
  });

  window.addEventListener('keyup', (e) => {
    app.keys.delete(e.code);
    if (app.mode === 'client') sendClientInputNow();
  });

  // Clear stuck keys if player Alt+Tabs away
  window.addEventListener('blur', () => {
    app.keys.clear();
    if (app.mode === 'client') sendClientInputNow();
  });

  // 🎨 2D ↔ 🧊 3D Görünüm Anahtarları (Ana Menü, Lobi & Maç İçi — anında geçiş!)
  updateViewToggleButtons();
  if (app.viewMode === '3d') {
    setViewMode('3d', true);
  }
  ['btn-view-home', 'btn-view-lobby', 'btn-view-game'].forEach(id => {
    const el = $(id);
    if (el) {
      el.onclick = () => {
        sfx.play('ui');
        setViewMode(app.viewMode === '3d' ? '2d' : '3d');
      };
    }
  });
  const cam3dBtn = $('btn-cam-3d');
  if (cam3dBtn) {
    cam3dBtn.onclick = () => {
      if (!app.renderer3d) return;
      const cm = app.renderer3d.toggleCameraMode();
      sfx.play('ui');
      showToast(cm === 'sinematik' ? '🎥 Sinematik Alçak 3D Kamera' : '🎥 Taktiksel Yüksek 3D Kamera');
    };
  }

  let moveTouch = null;
  let aimTouchId = null;

  const bindGameCanvas = (canvas) => {
    if (!canvas) return;
    canvas.addEventListener('mousemove', (e) => {
      if (performance.now() - app.lastTouchAt < 700) return;
      app.touchAimMode = false;
      app.touchAimActive = false;
      const rect = canvas.getBoundingClientRect();
      app.mouseX = e.clientX - rect.left;
      app.mouseY = e.clientY - rect.top;
    });

    canvas.addEventListener('mousedown', (e) => {
      // Mobilde dokunma sonrası gelen sentetik mousedown tek atımlık silahı yanlışlıkla harcamasın!
      if (performance.now() - app.lastTouchAt < 700) return;
      if (isInfoModalOpen()) return;
      if (e.button === 0) useSlot(0);
      if (e.button === 2) useSlot(1);
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('touchstart', (e) => {
      if (isInfoModalOpen()) return;
      e.preventDefault();
      app.lastTouchAt = performance.now();
      app.touchAimMode = true;
      const rect = canvas.getBoundingClientRect();
      for (const t of e.changedTouches) {
        const lx = t.clientX - rect.left;
        const ly = t.clientY - rect.top;
        if (moveTouch === null && lx < rect.width * 0.55) {
          moveTouch = { id: t.identifier, x: lx, y: ly };
          app.touchJoy = { bx: lx, by: ly, cx: lx, cy: ly };
        } else if (aimTouchId === null) {
          aimTouchId = t.identifier;
          app.mouseX = lx;
          app.mouseY = ly;
          app.touchAimActive = true;
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      if (!moveTouch && aimTouchId === null) return;
      e.preventDefault();
      app.lastTouchAt = performance.now();
      const rect = canvas.getBoundingClientRect();
      for (const t of e.touches) {
        const lx = t.clientX - rect.left;
        const ly = t.clientY - rect.top;
        if (moveTouch && t.identifier === moveTouch.id) {
          const dx = lx - moveTouch.x;
          const dy = ly - moveTouch.y;
          const len = Math.hypot(dx, dy) || 1;
          const maxR = 46;
          const mag = Math.min(1, len / maxR);
          app.touchMove.mx = (dx / len) * mag;
          app.touchMove.my = (dy / len) * mag;
          app.touchJoy = {
            bx: moveTouch.x,
            by: moveTouch.y,
            cx: moveTouch.x + (dx / len) * Math.min(len, maxR),
            cy: moveTouch.y + (dy / len) * Math.min(len, maxR)
          };
          if (aimTouchId === null && mag > 0.16) {
            app.touchAimActive = false;
            app.localAim = Math.atan2(dy, dx);
          }
        } else if (aimTouchId !== null && t.identifier === aimTouchId) {
          app.mouseX = lx;
          app.mouseY = ly;
          app.touchAimActive = true;
        }
      }
    }, { passive: false });

    const endTouches = (e) => {
      app.lastTouchAt = performance.now();
      const activeIds = new Set([...e.touches].map(t => t.identifier));
      if (moveTouch && !activeIds.has(moveTouch.id)) {
        moveTouch = null;
        app.touchMove = { mx: 0, my: 0 };
        app.touchJoy = null;
        if (app.mode === 'client') sendClientInputNow();
      }
      if (aimTouchId !== null && !activeIds.has(aimTouchId)) {
        aimTouchId = null;
        app.touchAimActive = false;
      }
    };
    canvas.addEventListener('touchend', endTouches, { passive: true });
    canvas.addEventListener('touchcancel', endTouches, { passive: true });
  };

  bindGameCanvas($('game-canvas'));
  bindGameCanvas($('game-canvas-3d'));

  requestAnimationFrame(renderLoop);
}

window.addEventListener('DOMContentLoaded', init);
