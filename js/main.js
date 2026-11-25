// DERİN AV — Main Controller (Web Worker Host Loop for Alt-Tab Safety, Client-Side Prediction for Zero-Lag Feel)

import {
  GAME_VERSION,
  CHANGELOG,
  WORLD_W,
  WORLD_H,
  CHARACTERS,
  CHAR_MAP,
  HUNTER_ITEMS,
  PREY_ITEMS,
  FFA_ITEMS,
  ALL_ITEMS,
  SEA_MAPS
} from './data.js?v=3.3';
import { sfx } from './audio.js?v=3.3';
import { NetClient, generateRoomCode } from './net.js?v=3.3';
import { GameSim } from './sim.js?v=3.3';
import { SeaRenderer } from './render.js?v=3.3';

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
  myId: null,
  roomCode: null,
  net: null,
  sim: null,
  hostTicker: null,
  lastSimNow: Date.now(),
  lobbyState: null,
  liveState: null,
  renderer: null,
  keys: new Set(),
  mouseX: 0,
  mouseY: 0,
  localAim: 0,
  // Client-side prediction state (istemci lagını sıfırlar!)
  pred: null, // { x, y, vx, vy, round }
  lastSentMoveKey: '',
  draftPicks: [],
  draftRoundSeen: -1,
  lastBroadcast: 0,
  lastInputSend: 0,
  lastLobbyPing: 0,
  hudCache: {},
  touchMove: { mx: 0, my: 0 }
};

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

    if (app.sim.phase === 'playing' || app.sim.phase === 'round_end' || app.sim.phase === 'match_end') {
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
          app.net.send({ type: 'join', name: app.myName });
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
    } else if (ev.type === 'phase') {
      broadcastLobby();
      if (ev.phase === 'playing') broadcastState();
    }
  });
  app.sim.addHuman(app.myId, app.myName);
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
  if (app.mode === 'client' && app.net?.connected) {
    app.net.send({ type: 'leave' });
  }
  stopHostTicker();
  if (app.net) app.net.disconnect();
  app.mode = 'menu';
  app.sim = null;
  app.pred = null;
  app.lobbyState = null;
  app.liveState = null;
  app.roomCode = null;
  updateUrlRoom(null);
  setScreen('home');
}

function handleHostReceive(msg) {
  if (!app.sim) return;
  const sender = msg.from;
  switch (msg.type) {
    case 'join': {
      app.sim.addHuman(sender, msg.name);
      broadcastLobby();
      if (app.sim.phase !== 'lobby') broadcastState();
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
  }
}

function handleClientReceive(msg) {
  switch (msg.type) {
    case 'lobby': {
      app.lobbyState = msg.data;
      checkVersionMismatch(app.lobbyState?.version);
      syncPhaseScreens(app.lobbyState.phase);
      if (app.lobbyState.phase === 'lobby') renderLobby();
      else if (app.lobbyState.phase === 'draft') renderDraftUI();
      break;
    }
    case 'state': {
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
  if (me.role === 'hunter') maxSpd *= 1.03;
  if (me.submerged) maxSpd *= 0.66;
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

  app.pred.x = clamp(app.pred.x + app.pred.vx * dt, 32, WORLD_W - 32);
  app.pred.y = clamp(app.pred.y + app.pred.vy * dt, 32, WORLD_H - 32);

  // Local obstacle collision so prediction never walks through rocks
  const r = 20;
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
    setScreen('lobby');
    $('overlay-draft').classList.remove('active');
    $('overlay-round').classList.remove('active');
    $('overlay-match').classList.remove('active');
  } else {
    setScreen('game');
    $('overlay-draft').classList.toggle('active', phase === 'draft');
    $('overlay-round').classList.toggle('active', phase === 'round_end');
    $('overlay-match').classList.toggle('active', phase === 'match_end');

    if (phase === 'draft') {
      const roundNum = (app.lobbyState?.round || app.liveState?.round || 1);
      if (app.draftRoundSeen !== roundNum) {
        app.draftRoundSeen = roundNum;
        app.draftPicks = [];
      }
      renderDraftUI();
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
  const isFfa = mode === 'ffa';
  $('lobby-mode-kicker').textContent = mode === '1v1'
    ? 'DERİN AV · 1v1 DÜELLO LOBİSİ'
    : isFfa
      ? 'DERİN AV · HERKES TEK (DEATHMATCH)'
      : 'DERİN AV · 2v2 TAKIM LOBİSİ';
  $('btn-switch-team').style.display = isFfa ? 'none' : '';
  $('team-a-title').textContent = isFfa ? 'OYUNCULAR (1-2)' : 'TAKIM A (ALTIN)';
  $('team-a-role').textContent = isFfa ? '💀 Herkes Tek' : '1. Tur: Avcılar 🎯';
  $('team-b-title').textContent = isFfa ? 'OYUNCULAR (3-4)' : 'TAKIM B (TURKUAZ)';
  $('team-b-role').textContent = isFfa ? '💀 Son Kalan Kazanır' : '1. Tur: Avlar 🌊';
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
          <div class="slot-name">${s.name} ${isMe ? '<span class="tag-me">SEN</span>' : ''} ${s.isBot ? '<span class="tag-bot">BOT</span>' : ''}</div>
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

  const isFfa = st.settings?.mode === 'ffa';
  const teamAIsHunter = st.round % 2 === 1;
  const myRole = isFfa
    ? 'ffa'
    : ((mySlot.team === 'A') ? (teamAIsHunter ? 'hunter' : 'prey') : (teamAIsHunter ? 'prey' : 'hunter'));
  const pool = isFfa ? FFA_ITEMS : (myRole === 'hunter' ? HUNTER_ITEMS : PREY_ITEMS);
  const map = SEA_MAPS[(st.mapIndex || 0) % SEA_MAPS.length];

  $('draft-round-badge').textContent = `TUR ${st.round} / ${st.totalRounds} · ${map.name.toUpperCase()}`;
  $('draft-timer').textContent = `${Math.max(0, st.phaseTimer)}s`;

  const roleBox = $('draft-role-banner');
  roleBox.className = `role-banner ${isFfa ? 'hunter' : myRole}`;
  roleBox.innerHTML = isFfa
    ? `<strong>💀 HERKES TEK (DEATHMATCH)!</strong> — Herkes rakip! Ortak cephanelikten istediğin <b>2 itemi</b> seç, son ayakta kalan turu kazanır! (Batırma ödülü: +40 Can &amp; Tam Nefes)`
    : myRole === 'hunter'
      ? `<strong>🎯 BU TUR AVCISIN!</strong> — Görevin: ${st.settings?.mode === '1v1' ? 'Avı' : 'İki Avı da'} <b>suya gömmek</b>! 2 item seç (Ateşli silahlar <b>TEK KULLANIMLIKTIR</b>).`
      : `<strong>🌊 BU TUR AVSIN!</strong> — Görevin: <b>Suya gömülmeden</b> süreyi tamamla veya ${st.settings?.mode === '1v1' ? 'Avcıyı' : 'Avcıları'} batır! 2 item seç.`;

  const locked = mySlot.readyItems && mySlot.items.length === 2;
  const picks = locked ? mySlot.items : app.draftPicks;

  $('draft-grid').innerHTML = pool.map(it => {
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
    btnLock.textContent = '✓ 2 İtem Onaylandı — Diğerleri Bekleniyor...';
  } else {
    btnLock.disabled = app.draftPicks.length !== 2;
    btnLock.textContent = app.draftPicks.length === 2
      ? '✓ 2 İtemi Onayla ve Denize Açıl!'
      : `2 İtem Seç (${app.draftPicks.length}/2)`;
  }

  $('draft-ready-list').innerHTML = st.slots.map(s => {
    const r = isFfa ? 'FFA' : ((s.team === 'A') ? (teamAIsHunter ? 'Avcı' : 'Av') : (teamAIsHunter ? 'Av' : 'Avcı'));
    return `<span class="ready-pill ${s.readyItems ? 'ok' : ''}">${s.name} (${r}) ${s.readyItems ? '✓' : '...'}</span>`;
  }).join('');
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
  const roundStr = `TUR ${st.round}/${st.totalRounds} · ${map.name}`;
  setIfChanged('round', roundStr, () => { $('hud-round').textContent = roundStr; });
  const isFfa = st.mode === 'ffa';
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
    const roleKey = `${me.role}_${me.alive}`;
    setIfChanged('role', roleKey, () => {
      $('hud-role-pill').textContent = me.alive
        ? (me.role === 'ffa'
          ? '💀 HERKES TEK — SON KALAN KAZANIR!'
          : me.role === 'hunter'
            ? '🎯 AVCISIN — AVI SUYA GÖM!'
            : '🌊 AVSIN — SU ÜSTÜNDE KAL!')
        : '🌊 SUYA GÖMÜLDÜN (İZLEYİCİ)';
      $('hud-role-pill').className = `hud-role-pill ${me.role === 'ffa' ? 'hunter' : me.role} ${me.alive ? '' : 'dead'}`;
    });

    const hpKey = `${me.hp}_${me.maxHp}_${me.breath}_${me.maxBreath}_${me.breathRegen}_${me.shield || 0}`;
    setIfChanged('hp', hpKey, () => {
      const pct = Math.max(0, Math.round((me.hp / me.maxHp) * 100));
      const bPct = Math.max(0, Math.round(((me.breath || 0) / (me.maxBreath || 70)) * 100));
      $('hud-hp-fill').style.width = `${pct}%`;
      $('hud-breath-fill').style.width = `${bPct}%`;
      $('hud-breath-fill').classList.toggle('regen', Boolean(me.breathRegen));
      const shTxt = me.shield > 0 ? ` (+${me.shield} 🛡️)` : '';
      const bStatus = me.breath <= 0 ? ' (KESİLDİ!)' : (me.breathRegen ? ' ↑' : '');
      $('hud-breath-text').textContent = `🫁 Nefes: ${me.breath}/${me.maxBreath}${bStatus}`;
      $('hud-hp-text').textContent = `${ch.icon} ${ch.name} · 🌊 Batma Direnci: ${me.hp}/${me.maxHp}${shTxt}`;
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
        slotEl.className = `hud-item-slot ${depleted ? 'depleted' : ''} ${it.firearm ? 'firearm' : ''} ${onCd ? 'cooldown' : ''}`;
        slotEl.innerHTML = `
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
                    ? '<span class="txt-firearm">🔥 HAZIR (30s CD)</span>'
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
      const isRam = me.role === 'hunter' || me.role === 'ffa';
      spEl.className = `hud-item-slot space ${spReady ? '' : 'cooldown'}`;
      spEl.innerHTML = `
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
      dEl.className = `hud-item-slot dive ${me.submerged ? 'active-dive' : (ready ? '' : 'cooldown')}`;
      dEl.innerHTML = `
        <div class="slot-key">SHIFT / E</div>
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

  const teamKey = (st.players || []).map(p => `${p.id}:${p.alive}:${st.ffaScores?.[p.id] || 0}`).join('|') + `_${isFfa}`;
  setIfChanged('teams', teamKey, () => {
    if (isFfa) {
      const all = (st.players || []).slice().sort((a, b) => (st.ffaScores?.[b.id] || 0) - (st.ffaScores?.[a.id] || 0));
      $('hud-team-a').innerHTML = all.map(p => `<span class="mini-p ${p.alive ? 'alive' : 'sunk'}">💀 ${p.name}: <b>${st.ffaScores?.[p.id] || 0}</b></span>`).join('');
      $('hud-team-b').innerHTML = '';
    } else {
      const teamA = (st.players || []).filter(p => p.team === 'A');
      const teamB = (st.players || []).filter(p => p.team === 'B');
      $('hud-team-a').innerHTML = teamA.map(p => `<span class="mini-p ${p.alive ? 'alive' : 'sunk'}" title="${p.name}">${p.role === 'hunter' ? '🎯' : '🌊'} ${p.name}</span>`).join('');
      $('hud-team-b').innerHTML = teamB.map(p => `<span class="mini-p ${p.alive ? 'alive' : 'sunk'}" title="${p.name}">${p.role === 'hunter' ? '🎯' : '🌊'} ${p.name}</span>`).join('');
    }
  });

  const feedKey = (st.feed || []).map(f => f.id).join(',');
  setIfChanged('feed', feedKey, () => {
    $('hud-feed').innerHTML = (st.feed || []).map(f => `<div class="feed-item ${f.kind}">${f.text}</div>`).join('');
  });
}

function renderRoundEnd(st) {
  if (st.mode === 'ffa') {
    $('round-end-title').textContent = `💀 ${st.roundWinnerName || 'TUR BİTTİ'} KAZANDI!`;
    $('round-end-reason').textContent = st.roundReason;
    const board = (st.players || [])
      .map(p => `${p.name}: ${st.ffaScores?.[p.id] || 0}`)
      .join('  ·  ');
    $('round-end-score').textContent = board;
    $('round-end-next').textContent = `Yeni Deathmatch turu başlıyor! (${Math.max(0, Math.ceil(st.phaseTimer))}s)`;
    return;
  }
  const winTeamLabel = st.roundWinnerTeam === 'A' ? 'TAKIM A (ALTIN)' : 'TAKIM B (TURKUAZ)';
  const winRoleLabel = st.roundWinnerRole === 'hunter' ? 'AVCILAR KAZANDI!' : 'AVLAR KAZANDI!';
  $('round-end-title').textContent = `${winTeamLabel} — ${winRoleLabel}`;
  $('round-end-reason').textContent = st.roundReason;
  $('round-end-score').textContent = `TAKIM A  ${st.scores.A}  -  ${st.scores.B}  TAKIM B`;
  $('round-end-next').textContent = `Sonraki turda ROLLER DEĞİŞİYOR! (${Math.max(0, Math.ceil(st.phaseTimer))}s)`;
}

function renderMatchEnd(st) {
  if (st.mode === 'ffa') {
    $('match-end-title').textContent = `🏆 ${st.matchWinnerName || 'ŞAMPİYON'} KAZANDI!`;
    $('match-end-score').textContent = 'DEATHMATCH SIRALAMASI';
    const rows = (st.players || [])
      .slice()
      .sort((a, b) => (st.ffaScores?.[b.id] || 0) - (st.ffaScores?.[a.id] || 0))
      .map((p, idx) => {
        const ch = CHAR_MAP[p.charId] || CHARACTERS[0];
        return `
          <div class="stat-row">
            <span>#${idx + 1} ${ch.icon} <b>${p.name}</b></span>
            <span>🏆 <b>${st.ffaScores?.[p.id] || 0}</b> Tur · 🌊 <b>${p.sinks}</b> Batırma</span>
          </div>
        `;
      }).join('');
    $('match-end-stats').innerHTML = rows;
  } else {
    const winTeamLabel = st.matchWinnerTeam === 'A' ? 'TAKIM A (ALTIN)' : 'TAKIM B (TURKUAZ)';
    $('match-end-title').textContent = `🏆 ${winTeamLabel} ŞAMPİYON!`;
    $('match-end-score').textContent = `FİNAL SKORU: TAKIM A ${st.scores.A} - ${st.scores.B} TAKIM B`;

    const rows = (st.players || []).map(p => {
      const ch = CHAR_MAP[p.charId] || CHARACTERS[0];
      return `
        <div class="stat-row">
          <span>${ch.icon} <b>${p.name}</b> (Takım ${p.team})</span>
          <span>🌊 Suya Gömme: <b>${p.sinks}</b></span>
        </div>
      `;
    }).join('');
    $('match-end-stats').innerHTML = rows;
  }

  const isHostLike = app.mode === 'host' || app.mode === 'offline';
  $('btn-rematch').style.display = isHostLike ? '' : 'none';
  $('btn-back-lobby').style.display = isHostLike ? '' : 'none';
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
    app.renderer?.triggerShake(9);
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

  if (app.renderer && app.liveState && app.liveState.phase === 'playing') {
    const me = app.liveState.players?.find(p => p.id === app.myId);
    if (me) {
      const worldMouse = app.renderer.screenToWorld(app.mouseX, app.mouseY);
      const sp = app.pred || app.renderer.smoothPos.get(me.id) || me;
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
  if (app.renderer && app.liveState && $('screen-game').classList.contains('active')) {
    if (app.sim) {
      updateHudFromState(app.liveState);
    }
    app.renderer.render(app.liveState, app.myId, dt, app.localAim, app.pred);
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
  const modeLabel = s.mode === '1v1' ? '⚔️ 1v1 Düello' : s.mode === 'ffa' ? '💀 Herkes Tek (FFA)' : '👥 2v2 Takım';
  const pills = [
    modeLabel,
    `🏁 ${s.totalRounds} Tur`,
    `⏱️ ${s.roundDuration}sn`,
    `❤️ ${hpLabel}`,
    `🗺️ ${mapLabel}`,
    gunLabel,
    `📦 Sandık ${s.powerups ? '✓' : '✕'}`,
    `🧨 Fıçı ${s.barrels ? '✓' : '✕'}`,
    `🌪️ Fırtına ${s.storm ? '✓' : '✕'}`,
    ...(s.mode !== '2v2' ? [] : [`🛟 Kurtarma ${s.rescue ? '✓' : '✕'}`])
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
    $('input-code').value = urlRoom.toUpperCase();
    $('invite-banner').style.display = 'flex';
    $('invite-banner-code').textContent = urlRoom.toUpperCase();
  }

  $('btn-host').onclick = startHostOnline;
  $('btn-join').onclick = () => joinOnlineRoom();
  $('btn-quick-solo').onclick = startQuickSolo;
  $('btn-invite-go').onclick = () => joinOnlineRoom(urlRoom);

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
      mode: app.sim.settings.mode, totalRounds: 4, roundDuration: 85, hpMult: 1, mapMode: 'rotate', firearmMode: 'single',
      powerups: true, barrels: true, storm: true, rescue: true
    });
    broadcastLobby();
    renderLobby();
    renderSettingsModal();
    sfx.play('ui');
  };

  $('btn-preset-chaos').onclick = () => {
    if (!app.sim) return;
    app.sim.updateSettings({
      mode: app.sim.settings.mode, totalRounds: 6, roundDuration: 60, hpMult: 0.75, mapMode: '2', firearmMode: 'long_cd',
      powerups: true, barrels: true, storm: true, rescue: true
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
    app.sim.startMatch();
    broadcastLobby();
  };

  $('btn-back-lobby').onclick = () => {
    if (!app.sim) return;
    app.sim.backToLobby();
    broadcastLobby();
    renderLobby();
  };

  $('btn-mute').onclick = () => {
    const next = !sfx.muted;
    sfx.setMuted(next);
    $('btn-mute').textContent = next ? '🔇' : '🔊';
  };

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

  window.addEventListener('keydown', (e) => {
    if (document.activeElement?.tagName === 'INPUT') return;
    const had = app.keys.has(e.code);
    app.keys.add(e.code);
    if (!had && app.mode === 'client') sendClientInputNow();
    if (e.code === 'Digit1') useSlot(0);
    if (e.code === 'Digit2') useSlot(1);
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE') && !e.repeat) {
      e.preventDefault();
      useDive();
    }
    if (e.code === 'Space') {
      e.preventDefault();
      useSpace();
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

  const canvas = $('game-canvas');
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    app.mouseX = e.clientX - rect.left;
    app.mouseY = e.clientY - rect.top;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) useSlot(0);
    if (e.button === 2) useSlot(1);
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  let touchStart = null;
  canvas.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (t.clientX < window.innerWidth * 0.55) {
      touchStart = { id: t.identifier, x: t.clientX, y: t.clientY };
    } else {
      const rect = canvas.getBoundingClientRect();
      app.mouseX = t.clientX - rect.left;
      app.mouseY = t.clientY - rect.top;
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.touches) {
      if (touchStart && t.identifier === touchStart.id) {
        const dx = t.clientX - touchStart.x;
        const dy = t.clientY - touchStart.y;
        const len = Math.hypot(dx, dy) || 1;
        const mag = Math.min(1, len / 45);
        app.touchMove.mx = (dx / len) * mag;
        app.touchMove.my = (dy / len) * mag;
        if (mag > 0.2) app.localAim = Math.atan2(dy, dx);
      }
    }
  }, { passive: true });

  canvas.addEventListener('touchend', (e) => {
    if (touchStart && ![...e.touches].some(t => t.identifier === touchStart.id)) {
      touchStart = null;
      app.touchMove = { mx: 0, my: 0 };
    }
  }, { passive: true });

  requestAnimationFrame(renderLoop);
}

window.addEventListener('DOMContentLoaded', init);
