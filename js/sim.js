// DERİN AV — Authoritative 60Hz Denizde Av-Avcı Simülasyon Motoru

import {
  WORLD_W,
  WORLD_H,
  ROUND_DURATION,
  DRAFT_DURATION,
  CHARACTERS,
  CHAR_MAP,
  HUNTER_ITEMS,
  PREY_ITEMS,
  ALL_ITEMS,
  SEA_MAPS
} from './data.js';

const BOT_NAMES = ['Korsan Bot', 'Reis Bot', 'Yunus Bot', 'Martı Bot', 'Tayfa Bot', 'Fırtına Bot'];

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function angleBetween(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

export function lineIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
  // Liang-Barsky segment-rect intersection
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const checks = [
    [-dx, x1 - rx],
    [dx, rx + rw - x1],
    [-dy, y1 - ry],
    [dy, ry + rh - y1]
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-8) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 <= t1;
}

export function lineIntersectsCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return dist(x1, y1, cx, cy) <= r;
  let t = ((cx - x1) * dx + (cy - y1) * dy) / lenSq;
  t = clamp(t, 0, 1);
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return dist(px, py, cx, cy) <= r;
}

export function hasLineOfSight(map, x1, y1, x2, y2) {
  for (const obs of map.rocks) {
    if (obs.type === 'rock') {
      if (lineIntersectsCircle(x1, y1, x2, y2, obs.x, obs.y, obs.r - 4)) return false;
    } else {
      if (lineIntersectsRect(x1, y1, x2, y2, obs.x + 3, obs.y + 3, obs.w - 6, obs.h - 6)) return false;
    }
  }
  return true;
}

export class GameSim {
  constructor(onEvent) {
    this.onEvent = onEvent || (() => {});
    this.phase = 'lobby'; // lobby | draft | playing | round_end | match_end
    this.totalRounds = 4; // Her takım 2 Avcı + 2 Av (beraberlikte 5. Final Turu)
    this.round = 1;
    this.mapIndex = 0;
    this.scores = { A: 0, B: 0 };
    this.phaseTimer = 0;
    this.roundWinnerRole = null;
    this.roundWinnerTeam = null;
    this.roundReason = '';
    this.matchWinnerTeam = null;
    this.matchTime = 0;

    // 4 Lobby Slots: 0,1 = Takım A | 2,3 = Takım B
    this.slots = [
      { idx: 0, team: 'A', id: null, name: '', isBot: false, charId: 'kaptan', items: [], readyItems: false },
      { idx: 1, team: 'A', id: null, name: '', isBot: false, charId: 'kopekbaligi', items: [], readyItems: false },
      { idx: 2, team: 'B', id: null, name: '', isBot: false, charId: 'hayalet', items: [], readyItems: false },
      { idx: 3, team: 'B', id: null, name: '', isBot: false, charId: 'fenerci', items: [], readyItems: false }
    ];

    // Live match entities
    this.players = [];
    this.projectiles = [];
    this.traps = [];
    this.zones = []; // ink clouds, flares
    this.decoys = [];
    this.pulses = []; // sonar rings, sound pings, splash rings
    this.sinkEffects = []; // dramatic "SUYA GÖMÜLDÜ" vortexes
    this.feed = []; // kill/event feed
    this.inputs = {}; // playerId -> { mx, my, aim }
    this._nextEntityId = 1;
  }

  get currentMap() {
    return SEA_MAPS[this.mapIndex % SEA_MAPS.length];
  }

  getTeamRole(team) {
    // HER TUR ROLLER DEĞİŞİR!
    // Tek turlar (1, 3, 5): Takım A = Avcı, Takım B = Av
    // Çift turlar (2, 4, 6): Takım B = Avcı, Takım A = Av
    const teamAIsHunter = this.round % 2 === 1;
    if (team === 'A') return teamAIsHunter ? 'hunter' : 'prey';
    return teamAIsHunter ? 'prey' : 'hunter';
  }

  addHuman(id, name) {
    const existing = this.slots.find(s => s.id === id);
    if (existing) {
      existing.name = name || existing.name;
      return existing.idx;
    }
    // Prefer empty slot; if full, replace a bot slot
    let slot = this.slots.find(s => !s.id);
    if (!slot) slot = this.slots.find(s => s.isBot);
    if (!slot) return -1;

    slot.id = id;
    slot.name = (name || 'Denizci').slice(0, 14);
    slot.isBot = false;
    slot.charId = this._pickUnusedChar(slot.idx);
    slot.items = [];
    slot.readyItems = false;
    return slot.idx;
  }

  removeHuman(id) {
    const slot = this.slots.find(s => s.id === id && !s.isBot);
    if (!slot) return;
    if (this.phase === 'lobby') {
      slot.id = null;
      slot.name = '';
      slot.isBot = false;
    } else {
      // Mid-match disconnect -> convert to Bot so match continues smoothly!
      slot.isBot = true;
      slot.name = slot.name + ' (Bot)';
    }
  }

  addBot(slotIdx) {
    const slot = this.slots[slotIdx];
    if (!slot || slot.id) return false;
    slot.id = `bot_${slotIdx}_${Math.floor(Math.random() * 999)}`;
    slot.name = BOT_NAMES[slotIdx % BOT_NAMES.length];
    slot.isBot = true;
    slot.charId = this._pickUnusedChar(slotIdx);
    return true;
  }

  removeBot(slotIdx) {
    const slot = this.slots[slotIdx];
    if (!slot || !slot.isBot) return false;
    slot.id = null;
    slot.name = '';
    slot.isBot = false;
    return true;
  }

  fillEmptyWithBots() {
    for (const s of this.slots) {
      if (!s.id) this.addBot(s.idx);
    }
  }

  switchTeam(playerId) {
    if (this.phase !== 'lobby') return false;
    const cur = this.slots.find(s => s.id === playerId);
    if (!cur) return false;
    const targetTeam = cur.team === 'A' ? 'B' : 'A';
    const dest = this.slots.find(s => s.team === targetTeam && !s.id);
    if (!dest) return false;

    dest.id = cur.id;
    dest.name = cur.name;
    dest.isBot = cur.isBot;
    dest.charId = cur.charId;

    cur.id = null;
    cur.name = '';
    cur.isBot = false;
    return true;
  }

  pickCharacter(playerId, charId) {
    if (!CHAR_MAP[charId]) return false;
    const slot = this.slots.find(s => s.id === playerId);
    if (!slot) return false;
    slot.charId = charId;
    return true;
  }

  _pickUnusedChar(slotIdx) {
    const used = new Set(this.slots.filter(s => s.id && s.idx !== slotIdx).map(s => s.charId));
    const free = CHARACTERS.find(c => !used.has(c.id));
    return free ? free.id : CHARACTERS[slotIdx % CHARACTERS.length].id;
  }

  setTotalRounds(n) {
    if (this.phase !== 'lobby') return;
    this.totalRounds = n === 6 ? 6 : 4;
  }

  startMatch() {
    this.fillEmptyWithBots();
    this.round = 1;
    this.scores = { A: 0, B: 0 };
    this.matchWinnerTeam = null;
    this.feed = [];
    this.startDraft();
  }

  backToLobby() {
    this.phase = 'lobby';
    this.players = [];
    this.projectiles = [];
    this.traps = [];
    this.zones = [];
    this.decoys = [];
    this.pulses = [];
    this.sinkEffects = [];
  }

  startDraft() {
    this.phase = 'draft';
    this.mapIndex = (this.round - 1) % SEA_MAPS.length;
    this.phaseTimer = DRAFT_DURATION;
    this.roundWinnerRole = null;
    this.roundWinnerTeam = null;

    for (const s of this.slots) {
      const role = this.getTeamRole(s.team);
      if (s.isBot) {
        s.items = this._botPickItems(role);
        s.readyItems = true;
      } else {
        s.items = [];
        s.readyItems = false;
      }
    }
    this.onEvent({ type: 'phase', phase: 'draft', round: this.round });
  }

  _botPickItems(role) {
    const pool = role === 'hunter' ? HUNTER_ITEMS : PREY_ITEMS;
    const firearms = pool.filter(i => i.firearm);
    const utils = pool.filter(i => !i.firearm);
    // Bots usually pick 1 single-use firearm + 1 utility/trap
    const f = firearms[Math.floor(Math.random() * firearms.length)];
    const u = utils[Math.floor(Math.random() * utils.length)];
    return [f.id, u.id];
  }

  setPlayerItems(playerId, items, ready = true) {
    if (this.phase !== 'draft') return false;
    const slot = this.slots.find(s => s.id === playerId);
    if (!slot) return false;
    const role = this.getTeamRole(slot.team);
    const validIds = new Set((role === 'hunter' ? HUNTER_ITEMS : PREY_ITEMS).map(i => i.id));
    const cleaned = (items || []).filter(id => validIds.has(id)).slice(0, 2);
    slot.items = cleaned;
    slot.readyItems = ready && cleaned.length === 2;

    // Eğer tüm oyuncular 2 itemini seçtiyse hemen turu başlat!
    if (this.slots.every(s => s.readyItems && s.items.length === 2)) {
      this.startRound();
    }
    return true;
  }

  startRound() {
    // Eksik seçimi olanlara otomatik 2 item tamamla
    for (const s of this.slots) {
      const role = this.getTeamRole(s.team);
      const pool = role === 'hunter' ? HUNTER_ITEMS : PREY_ITEMS;
      while (s.items.length < 2) {
        const pick = pool.find(i => !s.items.includes(i.id)) || pool[0];
        s.items.push(pick.id);
      }
      s.readyItems = true;
    }

    this.phase = 'playing';
    this.phaseTimer = ROUND_DURATION;
    this.projectiles = [];
    this.traps = [];
    this.zones = [];
    this.decoys = [];
    this.pulses = [];
    this.sinkEffects = [];
    this.feed = [];

    const map = this.currentMap;
    let hIdx = 0;
    let pIdx = 0;

    this.players = this.slots.map(s => {
      const role = this.getTeamRole(s.team);
      const ch = CHAR_MAP[s.charId] || CHARACTERS[0];
      const sp = role === 'hunter' ? map.hunterSpawns[hIdx++ % 2] : map.preySpawns[pIdx++ % 2];
      const itemStates = s.items.map(itemId => {
        const def = ALL_ITEMS[itemId];
        return {
          id: def.id,
          usesLeft: def.uses,
          maxUses: def.uses,
          firearm: def.firearm,
          cd: 0
        };
      });

      return {
        id: s.id,
        slotIdx: s.idx,
        name: s.name,
        team: s.team,
        role,
        isBot: s.isBot,
        charId: ch.id,
        x: sp.x,
        y: sp.y,
        vx: 0,
        vy: 0,
        aim: role === 'hunter' ? 0 : Math.PI,
        r: 20,
        hp: ch.hp,
        maxHp: ch.hp,
        alive: true,
        sinkingAnim: 0,
        firstHitAvail: Boolean(ch.firstHitReduction),
        items: itemStates,
        spaceCd: 0,
        dashTimer: 0,
        ramActive: 0,
        ramHitIds: new Set(),
        // Status effects
        speedBoost: 0,
        speedMult: 1,
        stealthBoost: 0,
        slowTimer: 0,
        slowFactor: 1,
        rootTimer: 0,
        stunTimer: 0,
        blindTimer: 0,
        revealTimer: 0,
        inFog: false,
        inInk: false,
        inWhirlpool: false,
        wakeTimer: 0,
        sinks: 0,
        botState: {
          tx: WORLD_W / 2,
          ty: WORLD_H / 2,
          repath: 0,
          strafeDir: Math.random() < 0.5 ? 1 : -1,
          thinkCd: 0.2
        }
      };
    });

    this._pushFeed(`TUR ${this.round} BAŞLADI — ${map.name}!`, 'info');
    this.onEvent({ type: 'sfx', name: 'round_start' });
    this.onEvent({ type: 'phase', phase: 'playing', round: this.round });
  }

  setInput(playerId, input) {
    this.inputs[playerId] = {
      mx: clamp(Number(input.mx) || 0, -1, 1),
      my: clamp(Number(input.my) || 0, -1, 1),
      aim: Number.isFinite(input.aim) ? input.aim : 0
    };
  }

  triggerItem(playerId, slotIndex, aimAngle) {
    if (this.phase !== 'playing') return;
    const p = this.players.find(pl => pl.id === playerId);
    if (!p || !p.alive || p.stunTimer > 0) return;
    if (slotIndex !== 0 && slotIndex !== 1) return;

    const itemState = p.items[slotIndex];
    if (!itemState) return;
    if (itemState.usesLeft <= 0) {
      this.onEvent({ type: 'sfx', name: 'empty', targetId: p.id });
      return;
    }
    if (itemState.cd > 0) return;

    const def = ALL_ITEMS[itemState.id];
    const ch = CHAR_MAP[p.charId] || CHARACTERS[0];
    const angle = Number.isFinite(aimAngle) ? aimAngle : p.aim;
    p.aim = angle;

    // Tüketim: Ateşli silahlar KESİNLİKLE TEK KULLANIMLIK (uses: 1 -> 0)
    itemState.usesLeft -= 1;
    itemState.cd = def.cooldown * (ch.cdMult || 1);

    const trapBonus = ch.trapBonus || 1;
    const pSpeedMult = ch.projSpeedMult || 1;

    switch (def.id) {
      case 'harpoon_cannon': {
        this._spawnProjectile(p, {
          kind: 'harpoon',
          x: p.x + Math.cos(angle) * 24,
          y: p.y + Math.sin(angle) * 24,
          vx: Math.cos(angle) * def.speed * pSpeedMult,
          vy: Math.sin(angle) * def.speed * pSpeedMult,
          r: 7,
          maxDist: def.range,
          damage: def.damage,
          knockback: def.knockback,
          slowDur: def.slowDur,
          slowFactor: 0.45,
          color: '#ffb703'
        });
        this._addPulse(p.x, p.y, 460, 'sound', p.team);
        this.onEvent({ type: 'sfx', name: 'shot_heavy' });
        this._pushFeed(`${p.name} Zıpkın Topu ateşledi! (Tek Atım Tükendi)`, 'firearm');
        break;
      }
      case 'blunderbuss': {
        for (let i = 0; i < def.pellets; i++) {
          const t = (i / (def.pellets - 1)) - 0.5;
          const a = angle + t * def.spread + (Math.random() - 0.5) * 0.05;
          this._spawnProjectile(p, {
            kind: 'pellet',
            x: p.x + Math.cos(a) * 22,
            y: p.y + Math.sin(a) * 22,
            vx: Math.cos(a) * def.speed * pSpeedMult,
            vy: Math.sin(a) * def.speed * pSpeedMult,
            r: 5,
            maxDist: def.range,
            damage: def.damage,
            knockback: def.knockback,
            color: '#fb8500'
          });
        }
        this._addPulse(p.x, p.y, 490, 'sound', p.team);
        this.onEvent({ type: 'sfx', name: 'shot_heavy' });
        this._pushFeed(`${p.name} Gemi Pompalısını ateşledi! (Tek Atım Tükendi)`, 'firearm');
        break;
      }
      case 'flare_gun': {
        this._spawnProjectile(p, {
          kind: 'flare',
          x: p.x + Math.cos(angle) * 22,
          y: p.y + Math.sin(angle) * 22,
          vx: Math.cos(angle) * def.speed * pSpeedMult,
          vy: Math.sin(angle) * def.speed * pSpeedMult,
          r: 7,
          maxDist: def.range,
          damage: def.damage,
          knockback: def.knockback,
          flareRadius: def.flareRadius * trapBonus,
          flareDur: def.flareDur,
          color: '#ff4d6d'
        });
        this._addPulse(p.x, p.y, 450, 'sound', p.team);
        this.onEvent({ type: 'sfx', name: 'shot_pistol' });
        this._pushFeed(`${p.name} İşaret Tabancası ateşledi! (Tek Atım Tükendi)`, 'firearm');
        break;
      }
      case 'flintlock': {
        this._spawnProjectile(p, {
          kind: 'bullet',
          x: p.x + Math.cos(angle) * 22,
          y: p.y + Math.sin(angle) * 22,
          vx: Math.cos(angle) * def.speed * pSpeedMult,
          vy: Math.sin(angle) * def.speed * pSpeedMult,
          r: 6,
          maxDist: def.range,
          damage: def.damage,
          knockback: def.knockback,
          stunDur: def.stunDur,
          color: '#4cc9f0'
        });
        this._addPulse(p.x, p.y, 440, 'sound', p.team);
        this.onEvent({ type: 'sfx', name: 'shot_pistol' });
        this._pushFeed(`${p.name} Korsan Tabancasını ateşledi! (Tek Atım Tükendi)`, 'firearm');
        break;
      }
      case 'hand_mortar': {
        for (let i = 0; i < def.pellets; i++) {
          const t = (i / (def.pellets - 1)) - 0.5;
          const a = angle + t * def.spread;
          this._spawnProjectile(p, {
            kind: 'pellet',
            x: p.x + Math.cos(a) * 22,
            y: p.y + Math.sin(a) * 22,
            vx: Math.cos(a) * def.speed * pSpeedMult,
            vy: Math.sin(a) * def.speed * pSpeedMult,
            r: 6,
            maxDist: def.range,
            damage: def.damage,
            knockback: def.knockback,
            color: '#06d6a0'
          });
        }
        // Recoil propels Prey slightly backward!
        p.vx -= Math.cos(angle) * 140;
        p.vy -= Math.sin(angle) * 140;
        this._addPulse(p.x, p.y, 460, 'sound', p.team);
        this.onEvent({ type: 'sfx', name: 'shot_heavy' });
        this._pushFeed(`${p.name} Kısa Namlu Top ateşledi! (Tek Atım Tükendi)`, 'firearm');
        break;
      }
      case 'sonar': {
        this._addPulse(p.x, p.y, 1250, 'sonar', p.team);
        for (const other of this.players) {
          if (other.alive && other.team !== p.team && !other.inInk) {
            other.revealTimer = Math.max(other.revealTimer, def.revealDur * trapBonus);
          }
        }
        this.onEvent({ type: 'sfx', name: 'sonar' });
        break;
      }
      case 'anchor_trap': {
        this.traps.push({
          id: this._nextEntityId++,
          kind: 'anchor',
          ownerId: p.id,
          team: p.team,
          x: p.x + Math.cos(angle) * 28,
          y: p.y + Math.sin(angle) * 28,
          r: def.trapRadius * trapBonus,
          damage: def.damage,
          rootDur: def.rootDur,
          armTimer: 0.45,
          life: 32
        });
        this.onEvent({ type: 'sfx', name: 'trap' });
        break;
      }
      case 'capture_net': {
        this._spawnProjectile(p, {
          kind: 'net',
          x: p.x + Math.cos(angle) * 24,
          y: p.y + Math.sin(angle) * 24,
          vx: Math.cos(angle) * def.speed,
          vy: Math.sin(angle) * def.speed,
          r: 16 * trapBonus,
          maxDist: def.range * trapBonus,
          damage: def.damage,
          knockback: 80,
          slowDur: def.slowDur,
          slowFactor: def.slowFactor,
          color: '#e9c46a'
        });
        this.onEvent({ type: 'sfx', name: 'splash' });
        break;
      }
      case 'storm_surge': {
        p.speedBoost = Math.max(p.speedBoost, def.dur);
        p.speedMult = def.speedMult;
        this._addPulse(p.x, p.y, 120, 'splash', p.team);
        this.onEvent({ type: 'sfx', name: 'boost' });
        break;
      }
      case 'grapple_hook': {
        this._spawnProjectile(p, {
          kind: 'hook',
          x: p.x + Math.cos(angle) * 24,
          y: p.y + Math.sin(angle) * 24,
          vx: Math.cos(angle) * def.speed,
          vy: Math.sin(angle) * def.speed,
          r: 10,
          maxDist: def.range * trapBonus,
          damage: def.damage,
          pullToOwner: true,
          color: '#cbd5e1'
        });
        this.onEvent({ type: 'sfx', name: 'trap' });
        break;
      }
      case 'ink_cloud': {
        this.zones.push({
          id: this._nextEntityId++,
          kind: 'ink',
          team: p.team,
          x: p.x,
          y: p.y,
          r: def.radius * trapBonus,
          life: def.dur,
          maxLife: def.dur
        });
        p.revealTimer = 0;
        this.onEvent({ type: 'sfx', name: 'splash' });
        break;
      }
      case 'flash_flare': {
        const tx = clamp(p.x + Math.cos(angle) * Math.min(260, def.range), 40, WORLD_W - 40);
        const ty = clamp(p.y + Math.sin(angle) * Math.min(260, def.range), 40, WORLD_H - 40);
        const blastR = def.blastRadius * trapBonus;
        this._addPulse(tx, ty, blastR, 'flash', p.team);
        for (const other of this.players) {
          if (other.alive && other.team !== p.team && dist(tx, ty, other.x, other.y) <= blastR) {
            other.blindTimer = Math.max(other.blindTimer, def.blindDur);
            other.slowTimer = Math.max(other.slowTimer, 1.5);
            other.slowFactor = Math.min(other.slowFactor, 0.55);
          }
        }
        this.onEvent({ type: 'sfx', name: 'flash' });
        break;
      }
      case 'decoy_buoy': {
        this.decoys.push({
          id: this._nextEntityId++,
          ownerId: p.id,
          team: p.team,
          role: p.role,
          charId: p.charId,
          name: p.name,
          x: p.x + Math.cos(angle) * 20,
          y: p.y + Math.sin(angle) * 20,
          vx: Math.cos(angle) * def.speed,
          vy: Math.sin(angle) * def.speed,
          aim: angle,
          life: def.dur,
          wakeTimer: 0
        });
        this.onEvent({ type: 'sfx', name: 'splash' });
        break;
      }
      case 'jet_stream': {
        p.speedBoost = Math.max(p.speedBoost, def.dur);
        p.speedMult = def.speedMult;
        p.stealthBoost = Math.max(p.stealthBoost, def.dur);
        p.slowTimer = 0;
        p.rootTimer = 0;
        this._addPulse(p.x, p.y, 110, 'splash', p.team);
        this.onEvent({ type: 'sfx', name: 'boost' });
        break;
      }
      case 'sea_mine': {
        this.traps.push({
          id: this._nextEntityId++,
          kind: 'mine',
          ownerId: p.id,
          team: p.team,
          x: p.x - Math.cos(angle) * 24,
          y: p.y - Math.sin(angle) * 24,
          r: def.trapRadius * trapBonus,
          damage: def.damage,
          stunDur: def.stunDur,
          armTimer: 0.5,
          life: 32
        });
        this.onEvent({ type: 'sfx', name: 'trap' });
        break;
      }
      case 'buoyancy_kit': {
        p.hp = Math.min(p.maxHp, p.hp + def.healSelf);
        this._addPulse(p.x, p.y, 95, 'heal', p.team);
        for (const ally of this.players) {
          if (ally.alive && ally.id !== p.id && ally.team === p.team) {
            if (dist(p.x, p.y, ally.x, ally.y) <= def.allyRadius) {
              ally.hp = Math.min(ally.maxHp, ally.hp + def.healAlly);
              this._addPulse(ally.x, ally.y, 80, 'heal', ally.team);
            }
          }
        }
        this.onEvent({ type: 'sfx', name: 'boost' });
        break;
      }
    }
  }

  triggerSpace(playerId, aimAngle) {
    if (this.phase !== 'playing') return;
    const p = this.players.find(pl => pl.id === playerId);
    if (!p || !p.alive || p.stunTimer > 0 || p.rootTimer > 0 || p.spaceCd > 0) return;

    const ch = CHAR_MAP[p.charId] || CHARACTERS[0];
    const angle = Number.isFinite(aimAngle) ? aimAngle : p.aim;
    p.aim = angle;
    const boost = ch.dashBoost || 1.0;

    if (p.role === 'hunter') {
      // AVCI: DALGA HAMLESİ / SUYA BASTIRMA (Ram & Submerge)
      p.spaceCd = 1.9 * (ch.turnBonus ? 0.8 : 1);
      p.ramActive = 0.28;
      p.ramHitIds = new Set();
      const power = (540 + (p.speedBoost > 0 ? 110 : 0)) * boost;
      p.vx = Math.cos(angle) * power;
      p.vy = Math.sin(angle) * power;
      this._addPulse(p.x, p.y, 130, 'splash', p.team);
      this.onEvent({ type: 'sfx', name: 'splash' });
    } else {
      // AV: DALGA SIÇRAMASI / KAÇIŞ (Wave Dash)
      p.spaceCd = 4.6 * (ch.turnBonus ? 0.78 : 1);
      p.dashTimer = 0.24;
      const power = 620 * boost;
      p.vx = Math.cos(angle) * power;
      p.vy = Math.sin(angle) * power;
      this._addPulse(p.x, p.y, 110, 'splash', p.team);
      this.onEvent({ type: 'sfx', name: 'boost' });
    }
  }

  _spawnProjectile(owner, cfg) {
    this.projectiles.push({
      id: this._nextEntityId++,
      ownerId: owner.id,
      team: owner.team,
      traveled: 0,
      ...cfg
    });
  }

  _addPulse(x, y, maxR, kind, team) {
    this.pulses.push({
      id: this._nextEntityId++,
      x,
      y,
      r: 12,
      maxR,
      kind,
      team,
      life: kind === 'sonar' ? 1.15 : kind === 'flash' ? 0.55 : 0.48,
      maxLife: kind === 'sonar' ? 1.15 : kind === 'flash' ? 0.55 : 0.48
    });
  }

  _pushFeed(text, kind = 'info') {
    this.feed.unshift({ id: this._nextEntityId++, text, kind, ttl: 6.5 });
    if (this.feed.length > 5) this.feed.pop();
  }

  _applyDamage(target, amount, attackerId, knockVx = 0, knockVy = 0, sourceLabel = '') {
    if (!target.alive) return;
    let dmg = amount;
    if (target.firstHitAvail) {
      const ch = CHAR_MAP[target.charId];
      dmg = Math.round(dmg * (1 - (ch?.firstHitReduction || 0)));
      target.firstHitAvail = false;
    }
    target.hp = Math.max(0, target.hp - dmg);
    target.vx += knockVx;
    target.vy += knockVy;
    this._addPulse(target.x, target.y, 65, 'splash', target.team);
    this.onEvent({ type: 'sfx', name: 'hit' });

    if (target.hp <= 0) {
      target.alive = false;
      target.sinkingAnim = 1.0;
      const attacker = this.players.find(p => p.id === attackerId);
      if (attacker) attacker.sinks += 1;
      this.sinkEffects.push({
        id: this._nextEntityId++,
        x: target.x,
        y: target.y,
        name: target.name,
        role: target.role,
        life: 3.2,
        maxLife: 3.2
      });
      this.onEvent({ type: 'sfx', name: 'sink' });
      const byText = attacker ? `${attacker.name} tarafından` : (sourceLabel || 'Derin girdap');
      this._pushFeed(`🌊 ${target.name} SUYA GÖMÜLDÜ! (${byText})`, 'sink');
    }
  }

  step(dt) {
    this.matchTime += dt;

    if (this.phase === 'draft') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.startRound();
      }
      return;
    }

    if (this.phase === 'round_end') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this._advanceAfterRound();
      }
      return;
    }

    if (this.phase !== 'playing') return;

    this.phaseTimer -= dt;

    // Update feed TTL
    for (let i = this.feed.length - 1; i >= 0; i--) {
      this.feed[i].ttl -= dt;
      if (this.feed[i].ttl <= 0) this.feed.splice(i, 1);
    }

    // Update zones (ink clouds & flares)
    for (let i = this.zones.length - 1; i >= 0; i--) {
      this.zones[i].life -= dt;
      if (this.zones[i].life <= 0) this.zones.splice(i, 1);
    }

    // Update pulses
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pu = this.pulses[i];
      pu.life -= dt;
      const prog = 1 - Math.max(0, pu.life / pu.maxLife);
      pu.r = 12 + (pu.maxR - 12) * prog;
      if (pu.life <= 0) this.pulses.splice(i, 1);
    }

    // Update sink effects
    for (let i = this.sinkEffects.length - 1; i >= 0; i--) {
      this.sinkEffects[i].life -= dt;
      if (this.sinkEffects[i].life <= 0) this.sinkEffects.splice(i, 1);
    }

    // Update decoys
    const map = this.currentMap;
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      const d = this.decoys[i];
      d.life -= dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.x < 30 || d.x > WORLD_W - 30) d.vx *= -1;
      if (d.y < 30 || d.y > WORLD_H - 30) d.vy *= -1;
      d.aim = Math.atan2(d.vy, d.vx);
      this._resolveObstacleCollision(d, 18, map, true);
      if (d.life <= 0) this.decoys.splice(i, 1);
    }

    // Update players
    for (const p of this.players) {
      if (!p.alive) {
        if (p.sinkingAnim > 0) p.sinkingAnim = Math.max(0, p.sinkingAnim - dt * 0.65);
        continue;
      }

      // Tick cooldowns & statuses
      p.spaceCd = Math.max(0, p.spaceCd - dt);
      p.dashTimer = Math.max(0, p.dashTimer - dt);
      p.ramActive = Math.max(0, p.ramActive - dt);
      p.speedBoost = Math.max(0, p.speedBoost - dt);
      if (p.speedBoost <= 0) p.speedMult = 1;
      p.stealthBoost = Math.max(0, p.stealthBoost - dt);
      p.slowTimer = Math.max(0, p.slowTimer - dt);
      if (p.slowTimer <= 0) p.slowFactor = 1;
      p.rootTimer = Math.max(0, p.rootTimer - dt);
      p.stunTimer = Math.max(0, p.stunTimer - dt);
      p.blindTimer = Math.max(0, p.blindTimer - dt);
      p.revealTimer = Math.max(0, p.revealTimer - dt);
      for (const it of p.items) {
        it.cd = Math.max(0, it.cd - dt);
      }

      // Check fog & ink
      p.inFog = map.fogs.some(f => dist(p.x, p.y, f.x, f.y) <= f.r - 6);
      p.inInk = this.zones.some(z => z.kind === 'ink' && dist(p.x, p.y, z.x, z.y) <= z.r - 6);
      // Flare dispels fog hiding!
      const inFlare = this.zones.some(z => z.kind === 'flare' && dist(p.x, p.y, z.x, z.y) <= z.r);
      if (inFlare) {
        p.inFog = false;
        p.revealTimer = Math.max(p.revealTimer, 0.35);
      }

      // Bot AI
      if (p.isBot) {
        this._stepBot(p, dt, map);
      }

      const inp = this.inputs[p.id] || { mx: 0, my: 0, aim: p.aim };
      const ch = CHAR_MAP[p.charId] || CHARACTERS[0];

      if (p.stunTimer <= 0 && !p.isBot) {
        p.aim = inp.aim;
      }

      // Desired velocity
      let mx = inp.mx;
      let my = inp.my;
      const mlen = Math.hypot(mx, my);
      if (mlen > 1) {
        mx /= mlen;
        my /= mlen;
      }

      let maxSpd = ch.speed * p.speedMult * p.slowFactor;
      if (p.role === 'hunter') maxSpd *= 1.03; // Hafif avcı takip hızı avantajı
      if (p.rootTimer > 0 || p.stunTimer > 0) maxSpd = 0;

      // Smooth sea-gliding physics (su üstünde akıcı kayma + çarpışma/itme koruma)
      if (p.ramActive <= 0 && p.dashTimer <= 0) {
        const accel = ch.turnBonus ? 11.5 : 8.5;
        const targetVx = mx * maxSpd;
        const targetVy = my * maxSpd;
        p.vx += (targetVx - p.vx) * Math.min(1, accel * dt);
        p.vy += (targetVy - p.vy) * Math.min(1, accel * dt);
      } else {
        // Friction during dash/ram
        p.vx *= Math.pow(0.18, dt);
        p.vy *= Math.pow(0.18, dt);
      }

      // Whirlpools (Derin Girdaplar — içine çekip suya gömer!)
      p.inWhirlpool = false;
      for (const wp of map.whirlpools) {
        const d = dist(p.x, p.y, wp.x, wp.y);
        if (d < wp.r * 1.45) {
          const pullStrength = (1 - d / (wp.r * 1.45)) * wp.pull * (1 - (ch.whirlpoolResist || 0));
          const a = angleBetween(p.x, p.y, wp.x, wp.y);
          // Spiral inward pull
          p.vx += (Math.cos(a) * pullStrength + Math.cos(a + Math.PI / 2) * pullStrength * 0.45) * dt * 3.2;
          p.vy += (Math.sin(a) * pullStrength + Math.sin(a + Math.PI / 2) * pullStrength * 0.45) * dt * 3.2;
          if (d < wp.r * 0.72) {
            p.inWhirlpool = true;
            this._applyDamage(p, wp.dps * dt, null, 0, 0, 'Derin Girdap');
            if (!p.alive) break;
          }
        }
      }
      if (!p.alive) continue;

      // Integrate position
      p.x = clamp(p.x + p.vx * dt, p.r + 12, WORLD_W - p.r - 12);
      p.y = clamp(p.y + p.vy * dt, p.r + 12, WORLD_H - p.r - 12);
      this._resolveObstacleCollision(p, p.r, map, false);

      // Wake / sound ripple when moving fast
      const spd = Math.hypot(p.vx, p.vy);
      if (spd > 130 && p.stealthBoost <= 0) {
        p.wakeTimer -= dt;
        if (p.wakeTimer <= 0) {
          p.wakeTimer = 0.65;
          const wakeR = 145 * (ch.wakeMult || 1);
          if (wakeR > 75) {
            this._addPulse(p.x, p.y, wakeR, 'wake', p.team);
          }
        }
      }

      // Hunter Ram (Suya Bastırma) collision check
      if (p.role === 'hunter' && p.ramActive > 0) {
        for (const other of this.players) {
          if (!other.alive || other.team === p.team || p.ramHitIds.has(other.id)) continue;
          if (dist(p.x, p.y, other.x, other.y) <= p.r + other.r + 14) {
            p.ramHitIds.add(other.id);
            const pushA = angleBetween(p.x, p.y, other.x, other.y);
            const dmg = p.speedBoost > 0 ? 44 : 34;
            const kb = p.speedBoost > 0 ? 440 : 340;
            this._applyDamage(other, dmg, p.id, Math.cos(pushA) * kb, Math.sin(pushA) * kb, 'Suya Bastırma');
            other.slowTimer = Math.max(other.slowTimer, 0.85);
            other.slowFactor = Math.min(other.slowFactor, 0.62);
          }
        }
      }
    }

    // Player-to-player soft bump separation
    for (let i = 0; i < this.players.length; i++) {
      const a = this.players[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.players.length; j++) {
        const b = this.players[j];
        if (!b.alive) continue;
        const d = dist(a.x, a.y, b.x, b.y);
        const minD = a.r + b.r;
        if (d > 0.01 && d < minD) {
          const ov = (minD - d) * 0.5;
          const nx = (b.x - a.x) / d;
          const ny = (b.y - a.y) / d;
          a.x -= nx * ov;
          a.y -= ny * ov;
          b.x += nx * ov;
          b.y += ny * ov;
        }
      }
    }

    // Update traps (Anchor Trap & Sea Mine)
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const tr = this.traps[i];
      tr.life -= dt;
      if (tr.armTimer > 0) {
        tr.armTimer -= dt;
        continue;
      }
      let triggered = false;
      for (const p of this.players) {
        if (!p.alive || p.team === tr.team) continue;
        if (dist(tr.x, tr.y, p.x, p.y) <= tr.r + p.r * 0.55) {
          triggered = true;
          if (tr.kind === 'anchor') {
            p.rootTimer = Math.max(p.rootTimer, tr.rootDur);
            p.revealTimer = Math.max(p.revealTimer, 3.0);
            this._applyDamage(p, tr.damage, tr.ownerId, 0, 0, 'Ağır Çapa');
            this._addPulse(tr.x, tr.y, 120, 'splash', tr.team);
            this.onEvent({ type: 'sfx', name: 'trap' });
          } else if (tr.kind === 'mine') {
            const pushA = angleBetween(tr.x, tr.y, p.x, p.y);
            p.stunTimer = Math.max(p.stunTimer, tr.stunDur);
            this._applyDamage(p, tr.damage, tr.ownerId, Math.cos(pushA) * 380, Math.sin(pushA) * 380, 'Su Altı Mayını');
            this._addPulse(tr.x, tr.y, 145, 'flash', tr.team);
            this.onEvent({ type: 'sfx', name: 'shot_heavy' });
          }
          break;
        }
      }
      if (triggered || tr.life <= 0) {
        this.traps.splice(i, 1);
      }
    }

    // Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      const stepX = pr.vx * dt;
      const stepY = pr.vy * dt;
      pr.x += stepX;
      pr.y += stepY;
      pr.traveled += Math.hypot(stepX, stepY);

      let dead = pr.traveled >= pr.maxDist || pr.x < 10 || pr.x > WORLD_W - 10 || pr.y < 10 || pr.y > WORLD_H - 10;

      // Obstacle hit
      if (!dead && this._hitsObstacle(pr.x, pr.y, pr.r, map)) {
        dead = true;
      }

      // Player hit
      if (!dead) {
        for (const p of this.players) {
          if (!p.alive || p.team === pr.team) continue;
          if (dist(pr.x, pr.y, p.x, p.y) <= pr.r + p.r) {
            dead = true;
            const a = Math.atan2(pr.vy, pr.vx);
            let kx = Math.cos(a) * (pr.knockback || 0);
            let ky = Math.sin(a) * (pr.knockback || 0);
            if (pr.pullToOwner) {
              const owner = this.players.find(o => o.id === pr.ownerId);
              if (owner && owner.alive) {
                const pa = angleBetween(p.x, p.y, owner.x, owner.y);
                kx = Math.cos(pa) * 520;
                ky = Math.sin(pa) * 520;
              }
            }
            if (pr.slowDur) {
              p.slowTimer = Math.max(p.slowTimer, pr.slowDur);
              p.slowFactor = Math.min(p.slowFactor, pr.slowFactor || 0.45);
            }
            if (pr.stunDur) {
              p.stunTimer = Math.max(p.stunTimer, pr.stunDur);
            }
            this._applyDamage(p, pr.damage || 0, pr.ownerId, kx, ky);
            break;
          }
        }
      }

      if (dead) {
        if (pr.kind === 'flare') {
          this.zones.push({
            id: this._nextEntityId++,
            kind: 'flare',
            team: pr.team,
            x: clamp(pr.x, 30, WORLD_W - 30),
            y: clamp(pr.y, 30, WORLD_H - 30),
            r: pr.flareRadius || 240,
            life: pr.flareDur || 9,
            maxLife: pr.flareDur || 9
          });
        }
        this.projectiles.splice(i, 1);
      }
    }

    // Check Round Win Conditions
    const aliveHunters = this.players.filter(p => p.role === 'hunter' && p.alive);
    const alivePrey = this.players.filter(p => p.role === 'prey' && p.alive);

    if (alivePrey.length === 0) {
      const hunterTeam = this.players.find(p => p.role === 'hunter').team;
      this._endRound('hunter', hunterTeam, 'Tüm Avlar suya gömüldü!');
    } else if (aliveHunters.length === 0) {
      const preyTeam = this.players.find(p => p.role === 'prey').team;
      this._endRound('prey', preyTeam, 'Avlar tüm Avcıları suya gömdü!');
    } else if (this.phaseTimer <= 0) {
      const preyTeam = this.players.find(p => p.role === 'prey').team;
      this._endRound('prey', preyTeam, 'Süre doldu — Avlar su üstünde kaldı!');
    }
  }

  _endRound(winnerRole, winnerTeam, reason) {
    this.phase = 'round_end';
    this.phaseTimer = 5.2;
    this.roundWinnerRole = winnerRole;
    this.roundWinnerTeam = winnerTeam;
    this.roundReason = reason;
    this.scores[winnerTeam] += 1;
    this.onEvent({ type: 'sfx', name: 'round_end' });
    this.onEvent({ type: 'phase', phase: 'round_end', round: this.round });
  }

  _advanceAfterRound() {
    // Check if match is over
    if (this.round >= this.totalRounds) {
      if (this.scores.A !== this.scores.B) {
        this.phase = 'match_end';
        this.matchWinnerTeam = this.scores.A > this.scores.B ? 'A' : 'B';
        this.onEvent({ type: 'phase', phase: 'match_end', round: this.round });
        return;
      }
      // Beraberlik! Uzatma Final Turu
      this.totalRounds = this.round + 1;
    }
    this.round += 1;
    this.startDraft();
  }

  _hitsObstacle(x, y, r, map) {
    for (const obs of map.rocks) {
      if (obs.type === 'rock') {
        if (dist(x, y, obs.x, obs.y) < obs.r + r) return true;
      } else {
        const cx = clamp(x, obs.x, obs.x + obs.w);
        const cy = clamp(y, obs.y, obs.y + obs.h);
        if (dist(x, y, cx, cy) < r) return true;
      }
    }
    return false;
  }

  _resolveObstacleCollision(ent, r, map, bounce = false) {
    for (const obs of map.rocks) {
      if (obs.type === 'rock') {
        const d = dist(ent.x, ent.y, obs.x, obs.y);
        const minD = obs.r + r;
        if (d < minD && d > 0.001) {
          const nx = (ent.x - obs.x) / d;
          const ny = (ent.y - obs.y) / d;
          ent.x = obs.x + nx * minD;
          ent.y = obs.y + ny * minD;
          if (bounce) {
            const dot = ent.vx * nx + ent.vy * ny;
            ent.vx -= 2 * dot * nx;
            ent.vy -= 2 * dot * ny;
          }
        }
      } else {
        const cx = clamp(ent.x, obs.x, obs.x + obs.w);
        const cy = clamp(ent.y, obs.y, obs.y + obs.h);
        const d = dist(ent.x, ent.y, cx, cy);
        if (d < r) {
          if (d > 0.001) {
            const nx = (ent.x - cx) / d;
            const ny = (ent.y - cy) / d;
            ent.x = cx + nx * r;
            ent.y = cy + ny * r;
            if (bounce) {
              const dot = ent.vx * nx + ent.vy * ny;
              ent.vx -= 2 * dot * nx;
              ent.vy -= 2 * dot * ny;
            }
          } else {
            ent.y = obs.y - r;
          }
        }
      }
    }
  }

  _canSee(viewer, target, map) {
    if (!target.alive) return false;
    if (viewer.team === target.team) return true;
    if (viewer.blindTimer > 0) return false;
    if (target.revealTimer > 0) return true;

    const ch = CHAR_MAP[viewer.charId] || CHARACTERS[0];
    const tch = CHAR_MAP[target.charId] || CHARACTERS[0];
    const d = dist(viewer.x, viewer.y, target.x, target.y);

    if (target.inInk && d > 70) return false;
    if (target.inFog) {
      const fogDetect = tch.stealthBonus ? 85 : 135;
      if (d > fogDetect) return false;
    }
    if (d > ch.vision) return false;
    return hasLineOfSight(map, viewer.x, viewer.y, target.x, target.y);
  }

  _stepBot(bot, dt, map) {
    const st = bot.botState;
    st.thinkCd -= dt;
    st.repath -= dt;

    // Find visible enemies
    const enemies = this.players.filter(o => o.alive && o.team !== bot.team);
    const visible = enemies.filter(e => this._canSee(bot, e, map));

    // Decoys can fool Hunter bots!
    let target = null;
    let bestD = Infinity;
    for (const e of visible) {
      const d = dist(bot.x, bot.y, e.x, e.y);
      if (d < bestD) { bestD = d; target = e; }
    }
    if (bot.role === 'hunter' && !target) {
      for (const dec of this.decoys) {
        if (dec.team !== bot.team && dist(bot.x, bot.y, dec.x, dec.y) < 340) {
          target = dec;
          bestD = dist(bot.x, bot.y, dec.x, dec.y);
        }
      }
    }

    let mx = 0;
    let my = 0;

    if (bot.role === 'hunter') {
      if (target) {
        const a = angleBetween(bot.x, bot.y, target.x, target.y);
        bot.aim = a;
        mx = Math.cos(a);
        my = Math.sin(a);

        if (st.thinkCd <= 0) {
          st.thinkCd = 0.28;
          // Use items smartly
          for (let i = 0; i < 2; i++) {
            const it = bot.items[i];
            if (!it || it.usesLeft <= 0 || it.cd > 0) continue;
            const def = ALL_ITEMS[it.id];
            if (def.firearm) {
              const idealRange = def.id === 'blunderbuss' ? 235 : 520;
              if (bestD < idealRange && hasLineOfSight(map, bot.x, bot.y, target.x, target.y)) {
                this.triggerItem(bot.id, i, a + (Math.random() - 0.5) * 0.08);
                break;
              }
            } else if ((def.id === 'capture_net' || def.id === 'grapple_hook') && bestD < 360 && hasLineOfSight(map, bot.x, bot.y, target.x, target.y)) {
              this.triggerItem(bot.id, i, a);
              break;
            } else if (def.id === 'storm_surge' && bestD < 340 && bestD > 110) {
              this.triggerItem(bot.id, i, a);
              break;
            }
          }
          // Close range: Suya Bastır Ram!
          if (bestD < 155 && bot.spaceCd <= 0) {
            this.triggerSpace(bot.id, a);
          }
        }
      } else {
        // Patrol toward fog banks or random points
        if (st.repath <= 0 || dist(bot.x, bot.y, st.tx, st.ty) < 60) {
          st.repath = 2.6;
          const fog = map.fogs[Math.floor(Math.random() * map.fogs.length)];
          st.tx = clamp(fog.x + (Math.random() - 0.5) * 260, 120, WORLD_W - 120);
          st.ty = clamp(fog.y + (Math.random() - 0.5) * 260, 120, WORLD_H - 120);
        }
        const a = angleBetween(bot.x, bot.y, st.tx, st.ty);
        bot.aim = a;
        mx = Math.cos(a);
        my = Math.sin(a);

        // Use sonar or drop anchor while patrolling
        if (st.thinkCd <= 0) {
          st.thinkCd = 1.2;
          for (let i = 0; i < 2; i++) {
            const it = bot.items[i];
            if (!it || it.usesLeft <= 0 || it.cd > 0) continue;
            if (it.id === 'sonar' && Math.random() < 0.4) {
              this.triggerItem(bot.id, i, a);
              break;
            }
            if (it.id === 'anchor_trap' && Math.random() < 0.25) {
              this.triggerItem(bot.id, i, a);
              break;
            }
          }
        }
      }
    } else {
      // PREY BOT AI: Flee hunters, hide in fog, use defensive items!
      if (target && bestD < 410) {
        const away = angleBetween(target.x, target.y, bot.x, bot.y);
        const toward = angleBetween(bot.x, bot.y, target.x, target.y);
        bot.aim = toward;
        // Blend flee + slight strafe away from edges
        mx = Math.cos(away) + Math.cos(away + Math.PI / 2 * st.strafeDir) * 0.35;
        my = Math.sin(away) + Math.sin(away + Math.PI / 2 * st.strafeDir) * 0.35;
        if (bot.x < 160) mx += 0.9;
        if (bot.x > WORLD_W - 160) mx -= 0.9;
        if (bot.y < 160) my += 0.9;
        if (bot.y > WORLD_H - 160) my -= 0.9;

        if (st.thinkCd <= 0) {
          st.thinkCd = 0.35;
          if (bestD < 150 && bot.spaceCd <= 0) {
            this.triggerSpace(bot.id, away);
          }
          for (let i = 0; i < 2; i++) {
            const it = bot.items[i];
            if (!it || it.usesLeft <= 0 || it.cd > 0) continue;
            const def = ALL_ITEMS[it.id];
            if (def.id === 'buoyancy_kit' && bot.hp < bot.maxHp * 0.55) {
              this.triggerItem(bot.id, i, away);
              break;
            }
            if (def.firearm && bestD < 250 && hasLineOfSight(map, bot.x, bot.y, target.x, target.y)) {
              this.triggerItem(bot.id, i, toward);
              break;
            }
            if ((def.id === 'ink_cloud' || def.id === 'jet_stream' || def.id === 'decoy_buoy' || def.id === 'sea_mine') && bestD < 240) {
              this.triggerItem(bot.id, i, away);
              break;
            }
            if (def.id === 'flash_flare' && bestD < 260) {
              this.triggerItem(bot.id, i, toward);
              break;
            }
          }
        }
      } else {
        // Seek nearest fog bank & stay hidden
        if (st.repath <= 0 || dist(bot.x, bot.y, st.tx, st.ty) < 40) {
          st.repath = 4.0;
          const fog = map.fogs[Math.floor(Math.random() * map.fogs.length)];
          st.tx = fog.x + (Math.random() - 0.5) * 40;
          st.ty = fog.y + (Math.random() - 0.5) * 40;
        }
        const dGoal = dist(bot.x, bot.y, st.tx, st.ty);
        if (dGoal > 28) {
          const a = angleBetween(bot.x, bot.y, st.tx, st.ty);
          bot.aim = a;
          mx = Math.cos(a) * 0.7;
          my = Math.sin(a) * 0.7;
        }
        if (bot.hp < bot.maxHp * 0.65 && st.thinkCd <= 0) {
          st.thinkCd = 1.0;
          const kIdx = bot.items.findIndex(it => it.id === 'buoyancy_kit' && it.usesLeft > 0);
          if (kIdx >= 0) this.triggerItem(bot.id, kIdx, bot.aim);
        }
      }
    }

    // Avoid whirlpools!
    for (const wp of map.whirlpools) {
      const d = dist(bot.x, bot.y, wp.x, wp.y);
      if (d < wp.r * 1.6) {
        const away = angleBetween(wp.x, wp.y, bot.x, bot.y);
        mx += Math.cos(away) * 1.4;
        my += Math.sin(away) * 1.4;
      }
    }

    this.inputs[bot.id] = { mx: clamp(mx, -1, 1), my: clamp(my, -1, 1), aim: bot.aim };
  }

  getLobbySnapshot() {
    return {
      phase: this.phase,
      totalRounds: this.totalRounds,
      round: this.round,
      mapIndex: this.mapIndex,
      scores: { ...this.scores },
      phaseTimer: Math.ceil(this.phaseTimer),
      slots: this.slots.map(s => ({
        idx: s.idx,
        team: s.team,
        id: s.id,
        name: s.name,
        isBot: s.isBot,
        charId: s.charId,
        items: [...s.items],
        readyItems: s.readyItems
      }))
    };
  }

  getStateSnapshot() {
    return {
      phase: this.phase,
      round: this.round,
      totalRounds: this.totalRounds,
      mapIndex: this.mapIndex,
      scores: { ...this.scores },
      phaseTimer: Number(this.phaseTimer.toFixed(1)),
      roundWinnerRole: this.roundWinnerRole,
      roundWinnerTeam: this.roundWinnerTeam,
      roundReason: this.roundReason,
      matchWinnerTeam: this.matchWinnerTeam,
      players: this.players.map(p => ({
        id: p.id,
        slotIdx: p.slotIdx,
        name: p.name,
        team: p.team,
        role: p.role,
        isBot: p.isBot,
        charId: p.charId,
        x: Math.round(p.x),
        y: Math.round(p.y),
        vx: Math.round(p.vx),
        vy: Math.round(p.vy),
        aim: Number(p.aim.toFixed(2)),
        hp: Math.round(p.hp),
        maxHp: p.maxHp,
        alive: p.alive,
        sinkingAnim: Number(p.sinkingAnim.toFixed(2)),
        items: p.items.map(it => ({
          id: it.id,
          usesLeft: it.usesLeft,
          maxUses: it.maxUses,
          firearm: it.firearm,
          cd: Number(it.cd.toFixed(1))
        })),
        spaceCd: Number(p.spaceCd.toFixed(1)),
        ramActive: p.ramActive > 0,
        speedBoost: p.speedBoost > 0,
        slowTimer: p.slowTimer > 0,
        rootTimer: p.rootTimer > 0,
        stunTimer: p.stunTimer > 0,
        blindTimer: Number(p.blindTimer.toFixed(2)),
        revealTimer: p.revealTimer > 0,
        inFog: p.inFog,
        inInk: p.inInk,
        inWhirlpool: p.inWhirlpool,
        sinks: p.sinks
      })),
      projectiles: this.projectiles.map(pr => ({
        id: pr.id,
        kind: pr.kind,
        team: pr.team,
        x: Math.round(pr.x),
        y: Math.round(pr.y),
        vx: Math.round(pr.vx),
        vy: Math.round(pr.vy),
        r: pr.r,
        color: pr.color
      })),
      traps: this.traps.map(tr => ({
        id: tr.id,
        kind: tr.kind,
        team: tr.team,
        x: Math.round(tr.x),
        y: Math.round(tr.y),
        r: Math.round(tr.r),
        armed: tr.armTimer <= 0
      })),
      zones: this.zones.map(z => ({
        id: z.id,
        kind: z.kind,
        team: z.team,
        x: Math.round(z.x),
        y: Math.round(z.y),
        r: Math.round(z.r),
        life: Number(z.life.toFixed(1)),
        maxLife: z.maxLife
      })),
      decoys: this.decoys.map(d => ({
        id: d.id,
        team: d.team,
        role: d.role,
        charId: d.charId,
        name: d.name,
        x: Math.round(d.x),
        y: Math.round(d.y),
        aim: Number(d.aim.toFixed(2))
      })),
      pulses: this.pulses.map(pu => ({
        id: pu.id,
        x: Math.round(pu.x),
        y: Math.round(pu.y),
        r: Math.round(pu.r),
        maxR: pu.maxR,
        kind: pu.kind,
        team: pu.team,
        alpha: Number(clamp(pu.life / pu.maxLife, 0, 1).toFixed(2))
      })),
      sinkEffects: this.sinkEffects.map(se => ({
        id: se.id,
        x: Math.round(se.x),
        y: Math.round(se.y),
        name: se.name,
        life: Number(se.life.toFixed(2)),
        maxLife: se.maxLife
      })),
      feed: this.feed.map(f => ({ id: f.id, text: f.text, kind: f.kind }))
    };
  }
}
