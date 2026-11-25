// DERİN AV — Main Controller (Lobby, Online 2v2 Room Sync, 6-Char Picker, 2-Item Draft, Live Match Loop)

import {
  CHARACTERS,
  CHAR_MAP,
  HUNTER_ITEMS,
  PREY_ITEMS,
  ALL_ITEMS,
  SEA_MAPS
} from './data.js';
import { sfx } from './audio.js';
import { NetClient, generateRoomCode } from './net.js';
import { GameSim } from './sim.js';
import { SeaRenderer } from './render.js';

const $ = (id) => document.getElementById(id);

const app = {
  mode: 'menu', // menu | host | client | offline
  myName: localStorage.getItem('derinav_name') || '',
  myId: null,
  roomCode: null,
  net: null,
  sim: null, // only populated when Host or Offline
  lobbyState: null,
  liveState: null,
  renderer: null,
  keys: new Set(),
  mouseX: 0,
  mouseY: 0,
  localAim: 0,
  draftPicks: [],
  draftRoundSeen: -1,
  lastBroadcast: 0,
  lastInputSend: 0,
  lastLobbyPing: 0,
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

  app.mode = 'client';
  app.sim = null;
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
  if (app.net) app.net.disconnect();
  app.mode = 'menu';
  app.sim = null;
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
  }
}

function handleClientReceive(msg) {
  switch (msg.type) {
    case 'lobby': {
      app.lobbyState = msg.data;
      syncPhaseScreens(app.lobbyState.phase);
      if (app.lobbyState.phase === 'lobby') renderLobby();
      else if (app.lobbyState.phase === 'draft') renderDraftUI();
      break;
    }
    case 'state': {
      app.liveState = msg.data;
      syncPhaseScreens(app.liveState.phase);
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
  $('round-select-wrap').style.display = isHostLike ? '' : 'none';
  $('btn-copy-link').style.display = app.mode === 'offline' ? 'none' : '';
  $('client-wait-msg').style.display = isHostLike ? 'none' : '';

  const st = app.lobbyState;
  if (!st) {
    $('team-a-slots').innerHTML = '<div class="slot-card empty">Oda bilgisi bekleniyor...</div>';
    $('team-b-slots').innerHTML = '<div class="slot-card empty">Oda bilgisi bekleniyor...</div>';
    return;
  }

  $('round-count-val').textContent = `${st.totalRounds} Tur`;

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

  // Bind bot buttons
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

  // Render 6 Characters Grid
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
          <span>❤️ ${c.hp}</span>
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

  const teamAIsHunter = st.round % 2 === 1;
  const myRole = (mySlot.team === 'A') ? (teamAIsHunter ? 'hunter' : 'prey') : (teamAIsHunter ? 'prey' : 'hunter');
  const pool = myRole === 'hunter' ? HUNTER_ITEMS : PREY_ITEMS;
  const map = SEA_MAPS[(st.mapIndex || 0) % SEA_MAPS.length];

  $('draft-round-badge').textContent = `TUR ${st.round} / ${st.totalRounds} · ${map.name.toUpperCase()}`;
  $('draft-timer').textContent = `${Math.max(0, st.phaseTimer)}s`;

  const roleBox = $('draft-role-banner');
  roleBox.className = `role-banner ${myRole}`;
  roleBox.innerHTML = myRole === 'hunter'
    ? `<strong>🎯 BU TUR AVCISIN!</strong> — Görevin: İki Avı da <b>suya gömmek</b>! 2 item seç (Ateşli silahlar <b>TEK KULLANIMLIKTIR</b>).`
    : `<strong>🌊 BU TUR AVSIN!</strong> — Görevin: <b>Suya gömülmeden</b> süreyi tamamla veya Avcıları batır! 2 item seç (Ateşli silahlar <b>TEK KULLANIMLIKTIR</b>).`;

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
              ? '<span class="badge-firearm">🔥 ATEŞLİ · TEK KULLANIM</span>'
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

  // Show who is ready
  $('draft-ready-list').innerHTML = st.slots.map(s => {
    const r = (s.team === 'A') ? (teamAIsHunter ? 'Avcı' : 'Av') : (teamAIsHunter ? 'Av' : 'Avcı');
    return `<span class="ready-pill ${s.readyItems ? 'ok' : ''}">${s.name} (${r}) ${s.readyItems ? '✓' : '...'}</span>`;
  }).join('');
}

// ============================================================
// LIVE HUD & ROUND/MATCH OVERLAYS
// ============================================================

function updateHudFromState(st) {
  if (!st) return;
  const map = SEA_MAPS[(st.mapIndex || 0) % SEA_MAPS.length];
  $('hud-round').textContent = `TUR ${st.round}/${st.totalRounds} · ${map.name}`;
  $('hud-score-a').textContent = st.scores.A;
  $('hud-score-b').textContent = st.scores.B;

  const secs = Math.max(0, Math.ceil(st.phaseTimer));
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  $('hud-timer').textContent = `${mm}:${ss}`;
  $('hud-timer').classList.toggle('urgent', secs <= 15);

  const me = st.players?.find(p => p.id === app.myId);
  if (me) {
    const ch = CHAR_MAP[me.charId] || CHARACTERS[0];
    $('hud-role-pill').textContent = me.alive
      ? (me.role === 'hunter' ? '🎯 AVCISIN — AVI SUYA GÖM!' : '🌊 AVSIN — SU ÜSTÜNDE KAL!')
      : '🌊 SUYA GÖMÜLDÜN (İZLEYİCİ)';
    $('hud-role-pill').className = `hud-role-pill ${me.role} ${me.alive ? '' : 'dead'}`;

    const pct = Math.max(0, Math.round((me.hp / me.maxHp) * 100));
    $('hud-hp-fill').style.width = `${pct}%`;
    $('hud-hp-text').textContent = `${ch.icon} ${ch.name} · Su Üstü Direnci: ${me.hp}/${me.maxHp}`;

    // 2 Item Slots
    for (let i = 0; i < 2; i++) {
      const slotEl = $(`hud-slot-${i}`);
      const it = me.items[i];
      if (!it) continue;
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
              : it.firearm
                ? '<span class="txt-firearm">1/1 TEK ATIM</span>'
                : onCd
                  ? `<span>${it.cd.toFixed(1)}s</span>`
                  : `<span>${it.usesLeft}/${it.maxUses} HAZIR</span>`}
          </div>
        </div>
      `;
    }

    // Space Ability Slot
    const spEl = $('hud-slot-space');
    const spReady = me.spaceCd <= 0;
    spEl.className = `hud-item-slot space ${spReady ? '' : 'cooldown'}`;
    spEl.innerHTML = `
      <div class="slot-key">SPACE</div>
      <div class="slot-ico">${me.role === 'hunter' ? '🌊' : '💨'}</div>
      <div class="slot-meta">
        <div class="slot-title">${me.role === 'hunter' ? 'Suya Bastır' : 'Dalga Kaçışı'}</div>
        <div class="slot-uses">${spReady ? 'HAZIR' : `${me.spaceCd.toFixed(1)}s`}</div>
      </div>
    `;
  }

  // Team alive indicators
  const teamA = (st.players || []).filter(p => p.team === 'A');
  const teamB = (st.players || []).filter(p => p.team === 'B');
  $('hud-team-a').innerHTML = teamA.map(p => `<span class="mini-p ${p.alive ? 'alive' : 'sunk'}" title="${p.name}">${p.role === 'hunter' ? '🎯' : '🌊'} ${p.name}</span>`).join('');
  $('hud-team-b').innerHTML = teamB.map(p => `<span class="mini-p ${p.alive ? 'alive' : 'sunk'}" title="${p.name}">${p.role === 'hunter' ? '🎯' : '🌊'} ${p.name}</span>`).join('');

  // Feed
  $('hud-feed').innerHTML = (st.feed || []).map(f => `<div class="feed-item ${f.kind}">${f.text}</div>`).join('');
}

function renderRoundEnd(st) {
  const winTeamLabel = st.roundWinnerTeam === 'A' ? 'TAKIM A (ALTIN)' : 'TAKIM B (TURKUAZ)';
  const winRoleLabel = st.roundWinnerRole === 'hunter' ? 'AVCILAR KAZANDI!' : 'AVLAR KAZANDI!';
  $('round-end-title').textContent = `${winTeamLabel} — ${winRoleLabel}`;
  $('round-end-reason').textContent = st.roundReason;
  $('round-end-score').textContent = `TAKIM A  ${st.scores.A}  -  ${st.scores.B}  TAKIM B`;
  $('round-end-next').textContent = `Sonraki turda ROLLER DEĞİŞİYOR! (${Math.max(0, Math.ceil(st.phaseTimer))}s)`;
}

function renderMatchEnd(st) {
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

  const isHostLike = app.mode === 'host' || app.mode === 'offline';
  $('btn-rematch').style.display = isHostLike ? '' : 'none';
  $('btn-back-lobby').style.display = isHostLike ? '' : 'none';
}

// ============================================================
// INPUT & MAIN ANIMATION LOOP
// ============================================================

function useSlot(slotIdx) {
  const st = app.liveState;
  if (!st || st.phase !== 'playing') return;
  sfx.unlock();
  if (app.sim) {
    app.sim.triggerItem(app.myId, slotIdx, app.localAim);
  } else {
    app.net?.send({ type: 'useItem', slot: slotIdx, aim: app.localAim });
  }
  // Subtle camera shake on firearm shot
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
    app.net?.send({ type: 'space', aim: app.localAim });
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

let lastFrameTime = performance.now();

function tick(now) {
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  // Compute local aim angle relative to player screen position
  if (app.renderer && app.liveState && app.liveState.phase === 'playing') {
    const me = app.liveState.players?.find(p => p.id === app.myId);
    if (me) {
      const worldMouse = app.renderer.screenToWorld(app.mouseX, app.mouseY);
      const sp = app.renderer.smoothPos.get(me.id) || me;
      app.localAim = Math.atan2(worldMouse.y - sp.y, worldMouse.x - sp.x);
    }

    const mv = getMoveVector();
    const input = { mx: mv.mx, my: mv.my, aim: Number(app.localAim.toFixed(2)) };
    if (app.sim) {
      app.sim.setInput(app.myId, input);
    } else if (now - app.lastInputSend >= 45) {
      app.lastInputSend = now;
      app.net?.send({ type: 'input', input });
    }
  }

  // Host simulation step
  if (app.sim) {
    app.sim.step(dt);

    if (app.sim.phase === 'playing' || app.sim.phase === 'round_end' || app.sim.phase === 'match_end') {
      if (now - app.lastBroadcast >= 50) {
        app.lastBroadcast = now;
        broadcastState();
      }
      // Update local state smoothly every frame for host
      app.liveState = app.sim.getStateSnapshot();
      updateHudFromState(app.liveState);
    } else if (app.sim.phase === 'draft') {
      if (now - app.lastBroadcast >= 500) {
        app.lastBroadcast = now;
        broadcastLobby();
        renderDraftUI();
      }
    } else if (app.sim.phase === 'lobby' && app.mode === 'host') {
      if (now - app.lastLobbyPing >= 1800) {
        app.lastLobbyPing = now;
        broadcastLobby();
      }
    }
  }

  // Render canvas
  if (app.renderer && app.liveState && $('screen-game').classList.contains('active')) {
    app.renderer.render(app.liveState, app.myId, dt, app.localAim);
  }

  requestAnimationFrame(tick);
}

// ============================================================
// EVENT WIRING & INITIALIZATION
// ============================================================

function init() {
  app.renderer = new SeaRenderer($('game-canvas'));

  if (app.myName) $('input-name').value = app.myName;

  // Check invite link ?room=XXXX
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

  $('btn-toggle-rounds').onclick = () => {
    if (!app.sim) return;
    app.sim.setTotalRounds(app.sim.totalRounds === 4 ? 6 : 4);
    broadcastLobby();
    renderLobby();
    sfx.play('ui');
  };

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

  // Clickable HUD item slots
  $('hud-slot-0').onclick = () => useSlot(0);
  $('hud-slot-1').onclick = () => useSlot(1);
  $('hud-slot-space').onclick = () => useSpace();

  // Keyboard & Mouse
  window.addEventListener('keydown', (e) => {
    if (document.activeElement?.tagName === 'INPUT') return;
    app.keys.add(e.code);
    if (e.code === 'Digit1') useSlot(0);
    if (e.code === 'Digit2') useSlot(1);
    if (e.code === 'Space') {
      e.preventDefault();
      useSpace();
    }
  });

  window.addEventListener('keyup', (e) => {
    app.keys.delete(e.code);
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

  // Simple mobile touch joystick on left half of canvas
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

  requestAnimationFrame(tick);
}

window.addEventListener('DOMContentLoaded', init);
