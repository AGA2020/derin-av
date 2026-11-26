// DERİN AV — Authoritative 60Hz Denizde Av-Avcı Simülasyon Motoru

import {
  GAME_VERSION,
  EMOTES,
  ROUND_EVENTS,
  ROUND_EVENT_MAP,
  BOAT_SKIN_MAP,
  SKILL_TREE,
  SKILL_NODE_MAP,
  WORLD_W,
  WORLD_H,
  ROUND_DURATION,
  DRAFT_DURATION,
  CHARACTERS,
  CHAR_MAP,
  HUNTER_ITEMS,
  PREY_ITEMS,
  FFA_ITEMS,
  ALL_ITEMS,
  POWERUP_TYPES,
  POWERUP_MAP,
  SEA_MAPS
} from './data.js?v=4.68';

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
    this.phase = 'lobby'; // lobby | draft | intro | playing | round_end | match_end
    this.settings = {
      mode: '2v2', // '2v2' | '1v1' | 'ffa'
      totalRounds: 4,
      roundDuration: ROUND_DURATION,
      hpMult: 1.0,
      lives: 1, // 1 | 2 | 3 (Mario Kalp Sistemi ❤️❤️❤️)
      skillTree: true, // 🌿 Maç içi 3 dallı yetenek ağacı
      roundEvents: true, // 🎲 Rastgele tur olayları
      mapMode: 'rotate', // 'rotate' | '0'..'5'
      firearmMode: 'single', // 'single' | 'long_cd'
      powerups: true,
      barrels: true,
      storm: true,
      rescue: true
    };
    this.totalRounds = 4; // Her takım 2 Avcı + 2 Av (beraberlikte Final Turu)
    this.round = 1;
    this.mapIndex = 0;
    this.roundEvent = null; // 🎲 Aktif rastgele tur olayı id
    this.banner = null; // 🔥 Seri / özel anons bannerı
    this.scores = { A: 0, B: 0 };
    this.ffaScores = {}; // playerId -> round wins in FFA / Crown
    this.sessionWins = {}; // 🏆 Bu akşamki oda içi maç galibiyetleri (playerId -> count)
    this.crown = null; // 👑 Altın Taç modu objesi { x, y, holderId, dropGrace }
    this.crownScores = {}; // playerId -> 0..100 puan
    this.breakables = []; // 🪵 Kırılabilir deniz barikatları
    this.lighthouseAngle = 0; // 🗼 Dönen deniz feneri açısı
    this.geyserTimer = 4.5; // 🌋 Lav gayzeri sayacı
    this.kraken = null; // 🐙 Kraken Boss (7. Tur Olayı)
    this.krakenSpawnTimer = 0;
    this.matchStats = {}; // playerId -> cumulative match stats across all rounds!
    this.phaseTimer = 0;
    this.roundWinnerRole = null;
    this.roundWinnerTeam = null;
    this.roundWinnerName = '';
    this.roundReason = '';
    this.matchWinnerTeam = null;
    this.matchWinnerName = '';
    this.matchTime = 0;

    // 4 Lobby Slots: 0,1 = Takım A | 2,3 = Takım B
    this.slots = [
      { idx: 0, team: 'A', id: null, name: '', isBot: false, charId: 'kaptan', skinId: 'auto', items: [], readyItems: false, skills: [], skillPoints: 0 },
      { idx: 1, team: 'A', id: null, name: '', isBot: false, charId: 'kopekbaligi', skinId: 'auto', items: [], readyItems: false, skills: [], skillPoints: 0 },
      { idx: 2, team: 'B', id: null, name: '', isBot: false, charId: 'hayalet', skinId: 'auto', items: [], readyItems: false, skills: [], skillPoints: 0 },
      { idx: 3, team: 'B', id: null, name: '', isBot: false, charId: 'fenerci', skinId: 'auto', items: [], readyItems: false, skills: [], skillPoints: 0 }
    ];

    // Live match entities
    this.players = [];
    this.projectiles = [];
    this.traps = [];
    this.zones = []; // ink clouds, flares
    this.decoys = [];
    this.powerups = []; // denizde beliren power-up sandıkları!
    this.powerupSpawnTimer = 4.5;
    this.barrels = []; // itilebilir & patlatılabilir barut fıçıları!
    this.barrelSpawnTimer = 20;
    this.rescueBuoys = []; // suya gömülen takım arkadaşını kurtarma şamandıraları!
    this.storm = { active: false, cx: WORLD_W / 2, cy: WORLD_H / 2, r: 1000, announced: false };
    this.pulses = []; // sonar rings, sound pings, splash rings
    this.sinkEffects = []; // dramatic "SUYA GÖMÜLDÜ" vortexes
    this.floatTexts = []; // power-up / kalkan / batma metinleri
    this.feed = []; // kill/event feed
    this.inputs = {}; // playerId -> { mx, my, aim }
    this._nextEntityId = 1;
  }

  get currentMap() {
    return SEA_MAPS[this.mapIndex % SEA_MAPS.length];
  }

  isSoloMode() {
    return this.settings.mode === 'ffa' || this.settings.mode === 'crown';
  }

  getActiveSlots(forMatch = false) {
    if (this.settings.mode === '1v1') {
      return [this.slots[0], this.slots[2]];
    }
    if (this.isSoloMode() && forMatch) {
      return this.slots.filter(s => Boolean(s.id));
    }
    return this.slots;
  }

  getTeamRole(team) {
    if (this.isSoloMode()) return 'ffa';
    // HER TUR ROLLER DEĞİŞİR!
    // Tek turlar (1, 3, 5): Takım A = Avcı, Takım B = Av
    // Çift turlar (2, 4, 6): Takım B = Avcı, Takım A = Av
    const teamAIsHunter = this.round % 2 === 1;
    if (team === 'A') return teamAIsHunter ? 'hunter' : 'prey';
    return teamAIsHunter ? 'prey' : 'hunter';
  }

  addHuman(id, name) {
    const active = this.getActiveSlots();
    const existing = this.slots.find(s => s.id === id);
    if (existing) {
      existing.name = name || existing.name;
      return existing.idx;
    }
    // Prefer empty active slot; if full, replace a bot in active slots
    let slot = active.find(s => !s.id);
    if (!slot) slot = active.find(s => s.isBot);
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
    for (const s of this.getActiveSlots()) {
      if (!s.id) this.addBot(s.idx);
    }
  }

  switchTeam(playerId) {
    if (this.phase !== 'lobby') return false;
    const cur = this.slots.find(s => s.id === playerId);
    if (!cur) return false;
    const targetTeam = cur.team === 'A' ? 'B' : 'A';
    const dest = this.getActiveSlots().find(s => s.team === targetTeam && !s.id);
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

  pickSkin(playerId, skinId) {
    if (!BOAT_SKIN_MAP[skinId]) return false;
    const slot = this.slots.find(s => s.id === playerId);
    if (!slot) return false;
    slot.skinId = skinId;
    return true;
  }

  _pickUnusedChar(slotIdx) {
    const used = new Set(this.slots.filter(s => s.id && s.idx !== slotIdx).map(s => s.charId));
    const free = CHARACTERS.find(c => !used.has(c.id));
    return free ? free.id : CHARACTERS[slotIdx % CHARACTERS.length].id;
  }

  setTotalRounds(n) {
    if (this.phase !== 'lobby') return;
    const valid = [2, 4, 6, 8];
    this.settings.totalRounds = valid.includes(n) ? n : 4;
    this.totalRounds = this.settings.totalRounds;
  }

  updateSettings(patch) {
    if (this.phase !== 'lobby' || !patch) return;
    if (['2v2', '1v1', 'ffa', 'crown'].includes(String(patch.mode))) {
      this.settings.mode = String(patch.mode);
      if (this.settings.mode === '1v1') {
        // 1v1'e geçince 2. slotlardaki (idx 1,3) botları temizle, insan varsa boş 0/2 slotuna taşı
        for (const extraIdx of [1, 3]) {
          const ex = this.slots[extraIdx];
          if (!ex.id) continue;
          if (!ex.isBot) {
            const free = [this.slots[0], this.slots[2]].find(s => !s.id || s.isBot);
            if (free) {
              free.id = ex.id;
              free.name = ex.name;
              free.isBot = false;
              free.charId = ex.charId;
            }
          }
          ex.id = null;
          ex.name = '';
          ex.isBot = false;
        }
      }
    }
    if ([2, 4, 6, 8].includes(Number(patch.totalRounds))) {
      this.settings.totalRounds = Number(patch.totalRounds);
      this.totalRounds = this.settings.totalRounds;
    }
    if ([45, 60, 85, 120, 180].includes(Number(patch.roundDuration))) {
      this.settings.roundDuration = Number(patch.roundDuration);
    }
    if ([0.75, 1, 1.4].includes(Number(patch.hpMult))) {
      this.settings.hpMult = Number(patch.hpMult);
    }
    if ([1, 2, 3].includes(Number(patch.lives))) {
      this.settings.lives = Number(patch.lives);
    }
    if (['rotate', '0', '1', '2', '3', '4', '5'].includes(String(patch.mapMode))) {
      this.settings.mapMode = String(patch.mapMode);
    }
    if (['single', 'long_cd'].includes(String(patch.firearmMode))) {
      this.settings.firearmMode = String(patch.firearmMode);
    }
    for (const k of ['powerups', 'barrels', 'storm', 'rescue', 'skillTree', 'roundEvents']) {
      if (typeof patch[k] === 'boolean') this.settings[k] = patch[k];
    }
  }

  startMatch() {
    if (this.isSoloMode()) {
      // FFA / Altın Taç'ta 2-4 arkadaş botsuz direkt oynayabilir; sadece tek kişi varsa botlarla 4'e tamamla!
      const occupied = this.slots.filter(s => Boolean(s.id)).length;
      if (occupied < 2) this.fillEmptyWithBots();
    } else {
      this.fillEmptyWithBots();
    }
    this.totalRounds = this.settings.totalRounds;
    this.round = 1;
    this.scores = { A: 0, B: 0 };
    this.ffaScores = {};
    this.matchStats = {};
    for (const s of this.getActiveSlots(true)) {
      s.skills = [];
      s.skillPoints = 0;
      if (s.id) {
        this.ffaScores[s.id] = 0;
        this.matchStats[s.id] = this._blankStat(s);
      }
    }
    this.matchWinnerTeam = null;
    this.matchWinnerName = '';
    this.feed = [];
    this.startDraft();
  }

  _blankStat(s) {
    return {
      id: s.id,
      name: s.name,
      team: s.team,
      charId: s.charId,
      sinks: 0,
      damage: 0,
      ambushes: 0,
      rescues: 0,
      barrels: 0,
      powerups: 0,
      survived: 0,
      deaths: 0
    };
  }

  _stat(id) {
    if (!id) return null;
    if (!this.matchStats[id]) {
      const p = this.players.find(pl => pl.id === id) || this.slots.find(sl => sl.id === id);
      if (!p) return null;
      this.matchStats[id] = this._blankStat(p);
    }
    return this.matchStats[id];
  }

  backToLobby() {
    this.phase = 'lobby';
    this.players = [];
    this.projectiles = [];
    this.traps = [];
    this.zones = [];
    this.decoys = [];
    this.barrels = [];
    this.powerups = [];
    this.rescueBuoys = [];
    this.breakables = [];
    this.crown = null;
    this.kraken = null;
    this.banner = null;
    this.pulses = [];
    this.sinkEffects = [];
  }

  startDraft() {
    this.phase = 'draft';
    this.mapIndex = this.settings.mapMode === 'rotate'
      ? (this.round - 1) % SEA_MAPS.length
      : Number(this.settings.mapMode) % SEA_MAPS.length;
    this.phaseTimer = DRAFT_DURATION;
    this.roundWinnerRole = null;
    this.roundWinnerTeam = null;
    this.banner = null;

    // 🎲 Rastgele Tur Olayı seç (önceki turun aynısı gelmesin!)
    if (this.settings.roundEvents) {
      const prev = this.roundEvent;
      const pool = ROUND_EVENTS.filter(e => e.id !== prev);
      this.roundEvent = pool[Math.floor(Math.random() * pool.length)].id;
    } else {
      this.roundEvent = null;
    }

    for (const s of this.getActiveSlots(true)) {
      const role = this.getTeamRole(s.team);
      // 🌿 Her tur başında herkese eşit +1 Yetenek Puanı!
      if (this.settings.skillTree) {
        s.skillPoints = (s.skillPoints || 0) + 1;
      }
      if (s.isBot) {
        if (this.settings.skillTree) this._botSpendSkills(s);
        s.items = this._botPickItems(role);
        s.readyItems = true;
      } else {
        s.items = [];
        s.readyItems = false;
      }
    }
    this.onEvent({ type: 'phase', phase: 'draft', round: this.round });
  }

  _botSpendSkills(slot) {
    while ((slot.skillPoints || 0) > 0) {
      const avail = Object.values(SKILL_NODE_MAP).filter(n =>
        !slot.skills.includes(n.id) && (!n.prereq || slot.skills.includes(n.prereq))
      );
      if (avail.length === 0) break;
      const pick = avail[Math.floor(Math.random() * avail.length)];
      slot.skills.push(pick.id);
      slot.skillPoints -= 1;
    }
  }

  unlockSkill(playerId, skillId) {
    if (!this.settings.skillTree) return false;
    const slot = this.slots.find(s => s.id === playerId);
    const node = SKILL_NODE_MAP[skillId];
    if (!slot || !node) return false;
    if ((slot.skillPoints || 0) <= 0) return false;
    if (slot.skills.includes(skillId)) return false;
    if (node.prereq && !slot.skills.includes(node.prereq)) return false;
    slot.skills.push(skillId);
    slot.skillPoints -= 1;
    this.onEvent({ type: 'sfx', name: 'boost', targetId: playerId });
    return true;
  }

  _computeSkillBonuses(skills = []) {
    const has = (id) => skills.includes(id);
    return {
      dmgMult: has('atk1') ? 1.12 : 1.0,
      spaceCdMult: has('atk2') ? 0.78 : 1.0,
      projSpeedMult: has('atk3') ? 1.15 : 1.0,
      kbMult: has('atk3') ? 1.15 : 1.0,
      sniperRefund: has('atk3'),
      bonusBreath: has('deep1') ? 22 : 0,
      subSpeedBonus: has('deep2') ? 1.14 : 1.0,
      breathDrainMult: has('deep2') ? 0.85 : 1.0,
      ambushExtraSlow: has('deep3') ? 0.7 : 0,
      ambushExtraDmg: has('deep3') ? 15 : 0,
      bonusHp: has('def1') ? 28 : 0,
      regenSpeedMult: has('def2') ? 1.3 : 1.0,
      regenDelayReduce: has('def2') ? 0.7 : 0,
      utilCdMult: has('def3') ? 0.8 : 1.0,
      speedMult: has('def3') ? 1.06 : 1.0
    };
  }

  _botPickItems(role) {
    const pool = role === 'ffa' ? FFA_ITEMS : (role === 'hunter' ? HUNTER_ITEMS : PREY_ITEMS);
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
    const pool = role === 'ffa' ? FFA_ITEMS : (role === 'hunter' ? HUNTER_ITEMS : PREY_ITEMS);
    const validIds = new Set(pool.map(i => i.id));
    const cleaned = (items || []).filter(id => validIds.has(id)).slice(0, 2);
    slot.items = cleaned;
    slot.readyItems = ready && cleaned.length === 2;

    // Eğer tüm aktif oyuncular 2 itemini seçtiyse VS Karşılaşma ekranına geç!
    if (this.getActiveSlots(true).every(s => s.readyItems && s.items.length === 2)) {
      this.startRound();
    }
    return true;
  }

  startRound() {
    const activeSlots = this.getActiveSlots(true);
    // Eksik seçimi olanlara otomatik 2 item tamamla
    for (const s of activeSlots) {
      const role = this.getTeamRole(s.team);
      const pool = role === 'ffa' ? FFA_ITEMS : (role === 'hunter' ? HUNTER_ITEMS : PREY_ITEMS);
      while (s.items.length < 2) {
        const pick = pool.find(i => !s.items.includes(i.id)) || pool[0];
        s.items.push(pick.id);
      }
      s.readyItems = true;
    }

    // ⚔️ Önce 3.8 sn VS / Karşılaşma Ekranı (herkesin çarı & 2 itemi görünür!)
    this.phase = 'intro';
    this.phaseTimer = 3.8;
    this.projectiles = [];
    this.traps = [];
    this.zones = [];
    this.decoys = [];
    this.powerups = [];
    this.powerupSpawnTimer = 5.0;
    this.barrels = [];
    this.barrelSpawnTimer = 22.0;
    this.rescueBuoys = [];
    this.storm = {
      active: false,
      cx: WORLD_W / 2 + Math.round((Math.random() - 0.5) * 220),
      cy: WORLD_H / 2 + Math.round((Math.random() - 0.5) * 160),
      r: 980,
      announced: false
    };
    this.pulses = [];
    this.sinkEffects = [];
    this.floatTexts = [];
    this.feed = [];

    const map = this.currentMap;
    // 🪵 Harita kırılabilir barikatlarını başlat
    this.breakables = (map.breakables || []).map(br => ({
      id: this._nextEntityId++,
      x: br.x,
      y: br.y,
      r: br.r || 34,
      hp: 55,
      maxHp: 55
    }));
    this.lighthouseAngle = 0;
    this.geyserTimer = 4.2;
    this.kraken = null;
    this.krakenSpawnTimer = this.roundEvent === 'kraken_uyanisi' ? 16.0 : 0;

    // 👑 Altın Taç Modu: Tacı merkezdeki en yakın açık suya yerleştir!
    this.crownScores = {};
    if (this.settings.mode === 'crown') {
      let cx = WORLD_W / 2;
      let cy = WORLD_H / 2;
      const offsets = [[0, 0], [0, -110], [0, 110], [-110, 0], [110, 0], [0, -180]];
      for (const [ox, oy] of offsets) {
        if (!this._hitsObstacle(cx + ox, cy + oy, 26, map)) {
          cx += ox;
          cy += oy;
          break;
        }
      }
      this.crown = { x: cx, y: cy, holderId: null, dropGrace: 0 };
      for (const s of activeSlots) this.crownScores[s.id] = 0;
    } else {
      this.crown = null;
    }

    const ffaSpawns = [
      map.hunterSpawns[0],
      map.preySpawns[0],
      map.hunterSpawns[1],
      map.preySpawns[1]
    ];
    let hIdx = 0;
    let pIdx = 0;
    let fIdx = 0;

    this.players = activeSlots.map(s => {
      const isFfa = this.isSoloMode();
      const role = isFfa ? 'ffa' : this.getTeamRole(s.team);
      const teamId = isFfa ? `F${s.idx}` : s.team;
      const ch = CHAR_MAP[s.charId] || CHARACTERS[0];
      const sp = isFfa
        ? ffaSpawns[fIdx++ % ffaSpawns.length]
        : (role === 'hunter' ? map.hunterSpawns[hIdx++ % 2] : map.preySpawns[pIdx++ % 2]);
      const itemStates = s.items.map(itemId => {
        const def = ALL_ITEMS[itemId];
        const longCdMode = def.firearm && this.settings.firearmMode === 'long_cd';
        const maxU = longCdMode ? 99 : def.uses;
        return {
          id: def.id,
          usesLeft: maxU,
          maxUses: maxU,
          firearm: def.firearm,
          longCd: longCdMode,
          cd: 0
        };
      });

      const sk = this._computeSkillBonuses(this.settings.skillTree ? (s.skills || []) : []);
      const maxBreath = Math.round(((ch.breath || 70) + sk.bonusBreath) * (this.settings.hpMult || 1));
      const maxHp = Math.round((ch.hp + sk.bonusHp) * (this.settings.hpMult || 1));
      const startLives = this.settings.lives || 1;

      return {
        id: s.id,
        slotIdx: s.idx,
        name: s.name,
        team: teamId,
        role,
        isBot: s.isBot,
        charId: ch.id,
        skinId: s.skinId || 'auto',
        skills: [...(s.skills || [])],
        sk,
        x: sp.x,
        y: sp.y,
        vx: 0,
        vy: 0,
        aim: role === 'hunter' ? 0 : Math.PI,
        r: 20,
        breath: maxBreath,
        maxBreath,
        breathRegenDelay: 0,
        hp: maxHp,
        maxHp,
        lives: startLives,
        maxLives: startLives,
        respawnTimer: 0,
        shield: 0,
        shieldTimer: 0,
        alive: true,
        rescuedOnce: false,
        sinkingAnim: 0,
        firstHitAvail: Boolean(ch.firstHitReduction),
        sniperRefundUsed: false,
        items: itemStates,
        spaceCd: 0,
        dashTimer: 0,
        ramActive: 0,
        ramHitIds: new Set(),
        // 🤿 Su altına dalma & Sürpriz çıkış durumu
        submerged: false,
        diveTime: 0,
        diveCd: 0,
        emote: null,
        emoteTimer: 0,
        emoteCd: 0,
        // Status effects
        mirrorTimer: 0,
        kelpTimer: 0,
        kelpDropCd: 0,
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
        inCurrent: false,
        inShallow: false,
        inStorm: false,
        wakeTimer: 0,
        sinks: 0,
        streak: 0,
        bounty: false,
        botState: {
          tx: WORLD_W / 2,
          ty: WORLD_H / 2,
          repath: 0,
          strafeDir: Math.random() < 0.5 ? 1 : -1,
          thinkCd: 0.2
        }
      };
    });

    if (this.settings.powerups) {
      const puCount = this.roundEvent === 'hazine_firtinasi' ? 4 : 2;
      for (let i = 0; i < puCount; i++) this._spawnPowerup();
    }
    if (this.settings.barrels) {
      this._spawnInitialBarrels();
    }
    this.onEvent({ type: 'sfx', name: 'ui' });
    this.onEvent({ type: 'phase', phase: 'intro', round: this.round });
  }

  _triggerBanner(text, sub = '', color = '#ffd166') {
    this.banner = { id: this._nextEntityId++, text, sub, color, life: 2.6 };
  }

  _beginPlay() {
    const map = this.currentMap;
    this.phase = 'playing';
    this.phaseTimer = this.settings.roundDuration || ROUND_DURATION;
    this._pushFeed(`TUR ${this.round} BAŞLADI — ${map.name}!`, 'info');
    this.onEvent({ type: 'sfx', name: 'round_start' });
    this.onEvent({ type: 'phase', phase: 'playing', round: this.round });
  }

  _spawnInitialBarrels() {
    const map = this.currentMap;
    const isRain = this.roundEvent === 'barut_yagmuru';
    const spots = isRain ? (map.barrelSpots || []) : (map.barrelSpots || []).slice(0, 5);
    const makeBarrel = (x, y) => ({
      id: this._nextEntityId++,
      x, y, vx: 0, vy: 0, r: 17, fuse: 0,
      lastTouchId: null, lastTouchTeam: null
    });
    for (const sp of spots) {
      if (!this._hitsObstacle(sp.x, sp.y, 20, map)) {
        this.barrels.push(makeBarrel(sp.x, sp.y));
        if (isRain) {
          const ox = clamp(sp.x + 56, 80, WORLD_W - 80);
          const oy = clamp(sp.y + 34, map.beach ? map.beach.sandY + 45 : 80, WORLD_H - 80);
          if (!this._hitsObstacle(ox, oy, 20, map)) this.barrels.push(makeBarrel(ox, oy));
        }
      }
    }
  }

  _spawnOneBarrel() {
    const map = this.currentMap;
    if (this.barrels.length >= 4) return;
    const spots = (map.barrelSpots || []).filter(sp =>
      !this.barrels.some(b => dist(b.x, b.y, sp.x, sp.y) < 100) &&
      !this._hitsObstacle(sp.x, sp.y, 20, map)
    );
    if (spots.length === 0) return;
    const sp = spots[Math.floor(Math.random() * spots.length)];
    this.barrels.push({
      id: this._nextEntityId++,
      x: sp.x,
      y: sp.y,
      vx: 0,
      vy: 0,
      r: 17,
      fuse: 0,
      lastTouchId: null,
      lastTouchTeam: null
    });
    this._addPulse(sp.x, sp.y, 70, 'splash', 'N');
  }

  _detonateBarrel(barrel, attackerId, attackerTeam) {
    const idx = this.barrels.indexOf(barrel);
    if (idx < 0) return;
    this.barrels.splice(idx, 1);

    const blastR = 160;
    const bStat = this._stat(attackerId);
    if (bStat) bStat.barrels += 1;
    this._addPulse(barrel.x, barrel.y, blastR, 'boom', attackerTeam || 'N');
    this._addFloatText(barrel.x, barrel.y - 18, '💥 BUM!', '#ff6b35');
    this.onEvent({ type: 'sfx', name: 'shot_heavy' });

    // Damage & knockback nearby players
    if (this.kraken && dist(barrel.x, barrel.y, this.kraken.x, this.kraken.y) <= blastR + this.kraken.r) {
      this._damageKraken(75, attackerId);
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      const d = dist(barrel.x, barrel.y, p.x, p.y);
      if (d <= blastR + p.r) {
        const falloff = clamp(1 - d / (blastR + p.r + 30), 0.45, 1);
        const isFriendly = attackerTeam && p.team === attackerTeam;
        const dmg = Math.round(78 * falloff * (isFriendly ? 0.35 : 1.0));
        const a = d > 1 ? angleBetween(barrel.x, barrel.y, p.x, p.y) : Math.random() * Math.PI * 2;
        const kb = (isFriendly ? 260 : 470) * falloff;
        if (!isFriendly) {
          p.slowTimer = Math.max(p.slowTimer, 0.9);
          p.slowFactor = Math.min(p.slowFactor, 0.55);
        }
        this._applyDamage(p, dmg, attackerId, Math.cos(a) * kb, Math.sin(a) * kb, 'Barut Fıçısı');
      }
    }

    // Chain-detonate nearby barrels with a juicy 0.18s domino fuse!
    for (const other of this.barrels) {
      if (other.fuse <= 0 && dist(barrel.x, barrel.y, other.x, other.y) <= blastR + 24) {
        other.fuse = 0.18;
        other.lastTouchId = attackerId || other.lastTouchId;
        other.lastTouchTeam = attackerTeam || other.lastTouchTeam;
      }
    }
  }

  _spawnPowerup() {
    const map = this.currentMap;
    if (this.powerups.length >= 4) return;
    const spots = map.powerupSpots || [{ x: 800, y: 500 }];
    // Pick a spot that doesn't already have a powerup nearby & doesn't overlap a rock
    const freeSpots = spots.filter(sp =>
      !this.powerups.some(pu => dist(pu.x, pu.y, sp.x, sp.y) < 90) &&
      !this._hitsObstacle(sp.x, sp.y, 24, map)
    );
    if (freeSpots.length === 0) return;
    const spot = freeSpots[Math.floor(Math.random() * freeSpots.length)];
    const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    this.powerups.push({
      id: this._nextEntityId++,
      kind: type.id,
      x: spot.x,
      y: spot.y,
      r: 20,
      life: 24
    });
    this._addPulse(spot.x, spot.y, 85, 'heal', 'N');
  }

  _addFloatText(x, y, text, color = '#7dd3fc') {
    this.floatTexts.push({
      id: this._nextEntityId++,
      x: Math.round(x),
      y: Math.round(y),
      text,
      color,
      life: 1.8,
      maxLife: 1.8
    });
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

    // Su altındayken item kullanmaya çalışırsa anında yüzeye çıkar!
    if (p.submerged) {
      this._surfacePlayer(p, false);
    }

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

    // Tüketim: Varsayılan TEK KULLANIMLIK (uses: 1 -> 0); Lobi ayarı 'long_cd' ise 30 sn bekleme
    const sk = p.sk || this._computeSkillBonuses([]);
    if (def.firearm && itemState.longCd) {
      itemState.cd = 30.0 * (ch.cdMult || 1);
    } else {
      itemState.usesLeft -= 1;
      const utilMult = def.firearm ? 1.0 : sk.utilCdMult;
      itemState.cd = def.cooldown * (ch.cdMult || 1) * utilMult;
    }

    if (def.firearm) {
      this._addPulse(p.x + Math.cos(angle) * 26, p.y + Math.sin(angle) * 26, 68, 'muzzle', p.team);
    }

    const trapBonus = ch.trapBonus || 1;
    const pSpeedMult = (ch.projSpeedMult || 1) * (def.firearm ? sk.projSpeedMult : 1.0);
    const dmgMult = sk.dmgMult;
    const kbMult = def.firearm ? sk.kbMult : 1.0;

    switch (def.id) {
      case 'harpoon_cannon': {
        this._spawnProjectile(p, {
          kind: 'harpoon',
          firearm: true,
          itemId: def.id,
          x: p.x + Math.cos(angle) * 24,
          y: p.y + Math.sin(angle) * 24,
          vx: Math.cos(angle) * def.speed * pSpeedMult,
          vy: Math.sin(angle) * def.speed * pSpeedMult,
          r: 8,
          maxDist: def.range,
          damage: def.damage,
          knockback: def.knockback,
          slowDur: def.slowDur,
          slowFactor: 0.42,
          revealHitDur: def.revealHitDur || 0,
          color: '#ffb703'
        });
        this._addPulse(p.x, p.y, 480, 'sound', p.team);
        this.onEvent({ type: 'sfx', name: 'shot_heavy' });
        this._pushFeed(`${p.name} Zıpkın Topu ateşledi!${itemState.longCd ? ' (30s Bekleme)' : ' (Tek Atım Tükendi)'}`, 'firearm');
        break;
      }
      case 'blunderbuss': {
        for (let i = 0; i < def.pellets; i++) {
          const t = (i / (def.pellets - 1)) - 0.5;
          const a = angle + t * def.spread + (Math.random() - 0.5) * 0.05;
          this._spawnProjectile(p, {
            kind: 'pellet',
            firearm: true,
            itemId: def.id,
            x: p.x + Math.cos(a) * 22,
            y: p.y + Math.sin(a) * 22,
            vx: Math.cos(a) * def.speed * pSpeedMult,
            vy: Math.sin(a) * def.speed * pSpeedMult,
            r: 6,
            maxDist: def.range,
            damage: def.damage,
            knockback: def.knockback,
            slowDur: def.slowDur || 0,
            slowFactor: 0.55,
            color: '#fb8500'
          });
        }
        this._addPulse(p.x, p.y, 500, 'sound', p.team);
        this.onEvent({ type: 'sfx', name: 'shot_heavy' });
        this._pushFeed(`${p.name} Gemi Pompalısını ateşledi!${itemState.longCd ? ' (30s Bekleme)' : ' (Tek Atım Tükendi)'}`, 'firearm');
        break;
      }
      case 'flare_gun': {
        this._spawnProjectile(p, {
          kind: 'flare',
          firearm: true,
          itemId: def.id,
          x: p.x + Math.cos(angle) * 22,
          y: p.y + Math.sin(angle) * 22,
          vx: Math.cos(angle) * def.speed * pSpeedMult,
          vy: Math.sin(angle) * def.speed * pSpeedMult,
          r: 8,
          maxDist: def.range,
          damage: def.damage,
          knockback: def.knockback,
          revealHitDur: def.revealHitDur || 0,
          flareRadius: def.flareRadius * trapBonus,
          flareDur: def.flareDur,
          color: '#ff4d6d'
        });
        this._addPulse(p.x, p.y, 460, 'sound', p.team);
        this.onEvent({ type: 'sfx', name: 'shot_pistol' });
        this._pushFeed(`${p.name} İşaret Tabancası ateşledi!${itemState.longCd ? ' (30s Bekleme)' : ' (Tek Atım Tükendi)'}`, 'firearm');
        break;
      }
      case 'flintlock': {
        this._spawnProjectile(p, {
          kind: 'bullet',
          firearm: true,
          itemId: def.id,
          x: p.x + Math.cos(angle) * 22,
          y: p.y + Math.sin(angle) * 22,
          vx: Math.cos(angle) * def.speed * pSpeedMult,
          vy: Math.sin(angle) * def.speed * pSpeedMult,
          r: 7,
          maxDist: def.range,
          damage: def.damage,
          knockback: def.knockback,
          stunDur: def.stunDur,
          color: '#4cc9f0'
        });
        this._addPulse(p.x, p.y, 450, 'sound', p.team);
        this.onEvent({ type: 'sfx', name: 'shot_pistol' });
        this._pushFeed(`${p.name} Korsan Tabancasını ateşledi!${itemState.longCd ? ' (30s Bekleme)' : ' (Tek Atım Tükendi)'}`, 'firearm');
        break;
      }
      case 'hand_mortar': {
        for (let i = 0; i < def.pellets; i++) {
          const t = (i / (def.pellets - 1)) - 0.5;
          const a = angle + t * def.spread;
          this._spawnProjectile(p, {
            kind: 'pellet',
            firearm: true,
            itemId: def.id,
            x: p.x + Math.cos(a) * 22,
            y: p.y + Math.sin(a) * 22,
            vx: Math.cos(a) * def.speed * pSpeedMult,
            vy: Math.sin(a) * def.speed * pSpeedMult,
            r: 7,
            maxDist: def.range,
            damage: def.damage,
            knockback: def.knockback,
            slowDur: def.slowDur || 0,
            slowFactor: 0.55,
            color: '#06d6a0'
          });
        }
        p.vx -= Math.cos(angle) * 165;
        p.vy -= Math.sin(angle) * 165;
        this._addPulse(p.x, p.y, 480, 'sound', p.team);
        this.onEvent({ type: 'sfx', name: 'shot_heavy' });
        this._pushFeed(`${p.name} Kısa Namlu Top ateşledi!${itemState.longCd ? ' (30s Bekleme)' : ' (Tek Atım Tükendi)'}`, 'firearm');
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
      case 'electric_net': {
        this._spawnProjectile(p, {
          kind: 'shock',
          x: p.x + Math.cos(angle) * 24,
          y: p.y + Math.sin(angle) * 24,
          vx: Math.cos(angle) * def.speed,
          vy: Math.sin(angle) * def.speed,
          r: 12 * trapBonus,
          maxDist: def.range * trapBonus,
          damage: def.damage,
          chainDamage: def.chainDamage,
          chainRange: def.chainRange * trapBonus,
          slowDur: def.slowDur,
          slowFactor: 0.45,
          color: '#38bdf8'
        });
        this.onEvent({ type: 'sfx', name: 'flash' });
        break;
      }
      case 'gravity_bomb': {
        const tx = clamp(p.x + Math.cos(angle) * Math.min(280, def.range), 50, WORLD_W - 50);
        const ty = clamp(p.y + Math.sin(angle) * Math.min(280, def.range), this.currentMap.beach ? this.currentMap.beach.sandY + 45 : 50, WORLD_H - 50);
        this.zones.push({
          id: this._nextEntityId++,
          kind: 'gravity',
          team: p.team,
          ownerId: p.id,
          x: tx,
          y: ty,
          r: def.radius * trapBonus,
          life: def.dur,
          maxLife: def.dur
        });
        this._addPulse(tx, ty, def.radius * trapBonus, 'sonar', p.team);
        this.onEvent({ type: 'sfx', name: 'sonar' });
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
      case 'mirror_shield': {
        p.mirrorTimer = Math.max(p.mirrorTimer, def.dur);
        this._addPulse(p.x, p.y, 75, 'heal', p.team);
        this._addFloatText(p.x, p.y - 28, '🪞 AYNA KALKANI!', '#e0f2fe');
        this.onEvent({ type: 'sfx', name: 'boost' });
        break;
      }
      case 'kelp_trail': {
        p.kelpTimer = Math.max(p.kelpTimer, def.dur);
        p.kelpDropCd = 0;
        p.speedBoost = Math.max(p.speedBoost, def.dur);
        p.speedMult = Math.max(p.speedMult, def.speedMult);
        this._addPulse(p.x, p.y, 90, 'splash', p.team);
        this.onEvent({ type: 'sfx', name: 'splash' });
        break;
      }
    }
  }

  triggerSpace(playerId, aimAngle) {
    if (this.phase !== 'playing') return;
    const p = this.players.find(pl => pl.id === playerId);
    if (!p || !p.alive || p.stunTimer > 0 || p.rootTimer > 0 || p.spaceCd > 0) return;

    if (p.submerged) {
      this._surfacePlayer(p, false);
    }

    const ch = CHAR_MAP[p.charId] || CHARACTERS[0];
    const sk = p.sk || this._computeSkillBonuses([]);
    const angle = Number.isFinite(aimAngle) ? aimAngle : p.aim;
    p.aim = angle;
    const boost = ch.dashBoost || 1.0;

    if (p.role === 'hunter' || p.role === 'ffa') {
      // AVCI / DEATHMATCH: DALGA HAMLESİ / SUYA BASTIRMA (Ram & Submerge)
      p.spaceCd = 2.3 * (ch.turnBonus ? 0.8 : 1) * sk.spaceCdMult;
      p.ramActive = 0.28;
      p.ramHitIds = new Set();
      const power = (530 + (p.speedBoost > 0 ? 105 : 0)) * boost;
      p.vx = Math.cos(angle) * power;
      p.vy = Math.sin(angle) * power;
      this._addPulse(p.x, p.y, 130, 'splash', p.team);
      this.onEvent({ type: 'sfx', name: 'splash' });
    } else {
      // AV: DALGA SIÇRAMASI / KAÇIŞ (Wave Dash)
      p.spaceCd = 4.4 * (ch.turnBonus ? 0.78 : 1) * sk.spaceCdMult;
      p.dashTimer = 0.24;
      const power = 620 * boost;
      p.vx = Math.cos(angle) * power;
      p.vy = Math.sin(angle) * power;
      this._addPulse(p.x, p.y, 110, 'splash', p.team);
      this.onEvent({ type: 'sfx', name: 'boost' });
    }
  }

  toggleDive(playerId) {
    if (this.phase !== 'playing') return;
    const p = this.players.find(pl => pl.id === playerId);
    if (!p || !p.alive) return;

    if (p.submerged) {
      this._surfacePlayer(p, false);
      return;
    }

    // Dalma şartları: taç taşımıyor, sersem/çapalı değil, sığ suda değil, bekleme yok, en az 15 nefes var!
    if (this.crown && this.crown.holderId === p.id) {
      this._addFloatText(p.x, p.y - 28, '👑 TAÇLA DALINMAZ!', '#ffd166');
      this.onEvent({ type: 'sfx', name: 'empty', targetId: p.id });
      return;
    }
    if (p.inShallow) {
      this._addFloatText(p.x, p.y - 28, '🏖️ SIĞ SUDA DALINMAZ!', '#ffd166');
      this.onEvent({ type: 'sfx', name: 'empty', targetId: p.id });
      return;
    }
    if (p.stunTimer > 0 || p.rootTimer > 0 || p.diveCd > 0 || p.breath < 15) {
      this.onEvent({ type: 'sfx', name: 'empty', targetId: p.id });
      return;
    }
    p.submerged = true;
    p.diveTime = 0;
    p.ramActive = 0;
    this._addPulse(p.x, p.y, 82, 'splash', p.team);
    this.onEvent({ type: 'sfx', name: 'splash' });
  }

  triggerEmote(playerId, emoteIdx) {
    if (this.phase !== 'playing') return;
    const p = this.players.find(pl => pl.id === playerId);
    if (!p || !p.alive || p.emoteCd > 0) return;
    const icon = EMOTES[Number(emoteIdx)];
    if (!icon) return;
    p.emote = icon;
    p.emoteTimer = 2.2;
    p.emoteCd = 2.0;
    this.onEvent({ type: 'sfx', name: 'ui', targetId: p.id });
  }

  _surfacePlayer(p, forced = false) {
    if (!p.submerged) return;
    const wasDeepEnough = p.diveTime >= 1.0;
    p.submerged = false;
    p.diveTime = 0;
    p.diveCd = 3.5;
    if (forced) {
      p.breathRegenDelay = 3.6;
    }

    this._addPulse(p.x, p.y, wasDeepEnough ? 115 : 80, 'splash', p.team);
    this.onEvent({ type: 'sfx', name: 'splash' });

    // 🦈 SÜRPRİZ ÇIKIŞ (en az 1 sn su altında kalıp düşmanın dibinde 70px'te çıkınca!)
    if (wasDeepEnough && !forced) {
      const sk = p.sk || this._computeSkillBonuses([]);
      let ambushHits = 0;
      for (const other of this.players) {
        if (!other.alive || other.team === p.team || other.submerged) continue;
        const d = dist(p.x, p.y, other.x, other.y);
        if (d <= 70) {
          ambushHits++;
          const a = d > 1 ? angleBetween(p.x, p.y, other.x, other.y) : Math.random() * Math.PI * 2;
          other.slowTimer = Math.max(other.slowTimer, 2.0 + sk.ambushExtraSlow);
          other.slowFactor = Math.min(other.slowFactor, 0.35); // %65 slow!
          this._applyDamage(other, 15 + sk.ambushExtraDmg, p.id, Math.cos(a) * 185, Math.sin(a) * 185, 'Sürpriz Çıkış');
        }
      }
      if (ambushHits > 0) {
        const aStat = this._stat(p.id);
        if (aStat) aStat.ambushes += ambushHits;
        this._addPulse(p.x, p.y, 125, 'heal', p.team);
        this._addFloatText(p.x, p.y - 34, '🦈 SÜRPRİZ ÇIKIŞ!', '#ffd166');
        this._pushFeed(`🦈 ${p.name} su altından SÜRPRİZ ÇIKIŞ yaptı! (2sn %65 Yavaşlatma)`, 'firearm');
        this.onEvent({ type: 'sfx', name: 'boost' });
      }
    }
  }

  _spawnProjectile(owner, cfg) {
    this.projectiles.push({
      id: this._nextEntityId++,
      ownerId: owner.id,
      team: owner.team,
      traveled: 0,
      bouncesLeft: this.roundEvent === 'seken_mermiler' ? 2 : 0,
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

  _applyDamage(target, amount, attackerId, knockVx = 0, knockVy = 0, sourceLabel = '', isHeavy = false) {
    if (!target.alive) return;
    const attackerObj = attackerId ? this.players.find(pl => pl.id === attackerId) : null;
    const atkDmgMult = (attackerObj && attackerObj.id !== target.id && attackerObj.sk) ? attackerObj.sk.dmgMult : 1.0;
    const atkKbMult = (attackerObj && attackerObj.id !== target.id && attackerObj.sk && isHeavy) ? attackerObj.sk.kbMult : 1.0;
    let dmg = amount * atkDmgMult;
    knockVx *= atkKbMult;
    knockVy *= atkKbMult;
    if (dmg > 0) {
      // Hasar alınca nefes yenilenmesi 3.6 sn durur (Derin Soluk ile 2.9 sn!)
      const tSk = target.sk || this._computeSkillBonuses([]);
      target.breathRegenDelay = Math.max(1.5, 3.6 - tSk.regenDelayReduce);
    }
    if (target.firstHitAvail && dmg >= 5) {
      const ch = CHAR_MAP[target.charId];
      dmg = Math.round(dmg * (1 - (ch?.firstHitReduction || 0)));
      target.firstHitAvail = false;
    }
    const rawShown = Math.round(dmg);
    if (attackerId && attackerId !== target.id && rawShown > 0) {
      const aStat = this._stat(attackerId);
      if (aStat) aStat.damage += rawShown;
    }

    // 1. Geçici kalkan (Çelik Gövde / Kurtarma kalkanı) önce emer
    if (target.shield > 0 && dmg > 0) {
      const absorbed = Math.min(target.shield, dmg);
      target.shield -= absorbed;
      dmg -= absorbed;
    }

    // 2. 🫁 NEFES BARI: Batma hasarından önce nefes barından gider!
    let breathBroken = false;
    if (target.breath > 0 && dmg > 0) {
      const absorbedBreath = Math.min(target.breath, dmg);
      target.breath -= absorbedBreath;
      dmg -= absorbedBreath;
      if (target.breath <= 0) {
        target.breath = 0;
        breathBroken = true;
      }
    }

    // 3. 🌊 Nefes bittiğinde kalan tüm hasar Batma Direncine (hp) vurur!
    if (dmg > 0) {
      target.hp = Math.max(0, target.hp - dmg);
    }

    target.vx += knockVx;
    target.vy += knockVy;
    this._addPulse(target.x, target.y, isHeavy ? 105 : 65, isHeavy ? 'boom' : 'splash', target.team);
    if (breathBroken && target.hp > 0) {
      this._addFloatText(target.x, target.y - 38, '🫁 NEFESİ KESİLDİ!', '#38bdf8');
    }
    if (rawShown >= 15) {
      this._addFloatText(
        target.x + (Math.random() - 0.5) * 22,
        target.y - 22,
        isHeavy ? `-${rawShown} 💥` : `-${rawShown}`,
        isHeavy ? '#ffd166' : (dmg > 0 ? '#f87171' : '#7dd3fc')
      );
    }
    this.onEvent({ type: 'sfx', name: isHeavy ? 'shot_heavy' : 'hit' });

    if (target.hp <= 0) {
      target.alive = false;
      target.submerged = false;
      target.diveTime = 0;
      target.sinkingAnim = 1.0;
      const hadBounty = Boolean(target.bounty);
      target.streak = 0;
      target.bounty = false;
      target.lives = Math.max(0, (target.lives || 1) - 1);
      // 👑 Taç taşıyıcısı battıysa taç suya düşer!
      if (this.crown && this.crown.holderId === target.id) {
        this.crown.holderId = null;
        this.crown.x = clamp(target.x, 70, WORLD_W - 70);
        this.crown.y = clamp(target.y, this.currentMap.beach ? this.currentMap.beach.sandY + 45 : 70, WORLD_H - 70);
        this.crown.dropGrace = 0.5;
        this._addPulse(this.crown.x, this.crown.y, 130, 'flash', 'N');
        this._pushFeed(`👑 ${target.name} battı — ALTIN TAÇ SUYA DÜŞTÜ!`, 'firearm');
      }
      const tStat = this._stat(target.id);
      if (tStat) tStat.deaths += 1;
      const attacker = this.players.find(p => p.id === attackerId);
      if (attacker) {
        attacker.sinks += 1;
        const aStat = this._stat(attacker.id);
        if (aStat && attacker.id !== target.id) aStat.sinks += 1;

        if (attacker.id !== target.id) {
          attacker.streak = (attacker.streak || 0) + 1;
          // 💰 KELLE ÖDÜLÜ AVLANDI!
          if (hadBounty && attacker.alive) {
            attacker.hp = Math.min(attacker.maxHp, attacker.hp + 40);
            attacker.shield = Math.min(65, (attacker.shield || 0) + 35);
            attacker.shieldTimer = Math.max(attacker.shieldTimer, 8.0);
            if (this.settings.skillTree) {
              const aSlot = this.slots.find(s => s.id === attacker.id);
              if (aSlot) aSlot.skillPoints = (aSlot.skillPoints || 0) + 1;
            }
            this._addPulse(attacker.x, attacker.y, 130, 'heal', attacker.team);
            this._addFloatText(attacker.x, attacker.y - 36, '💰 ÖDÜL KAPILDI! +40 CAN +35 KALKAN', '#ffd166');
            this._triggerBanner('💰 ÖDÜL AVLANDI!', `${attacker.name}, ${target.name}'in kellesini aldı! (+1 Yetenek Puanı)`, '#ffd166');
            this._pushFeed(`💰 ${attacker.name}, ${target.name} üzerindeki Kelle Ödülünü kaptı!`, 'firearm');
          } else if (attacker.streak >= 2 && !attacker.bounty) {
            // 💰 Yeni Kelle Ödülü Açıldı!
            attacker.bounty = true;
            this._triggerBanner('💰 KELLE ÖDÜLÜ!', `${attacker.name} seri yaptı — onu batıran büyük ödül alır!`, '#ffd166');
            this._pushFeed(`💰 ${attacker.name} üzerinde Kelle Ödülü açıldı!`, 'firearm');
          } else if (attacker.sinks >= 3) {
            this._triggerBanner('👑 DURDURULAMAZ!', `${attacker.name} (${attacker.sinks} Batırma!)`, '#ff4d6d');
          } else if (attacker.sinks === 2) {
            this._triggerBanner('🔥 ÇİFTE BATIRMA!', `${attacker.name} ortalığı süpürüyor!`, '#ffb703');
          } else if (sourceLabel === 'Barut Fıçısı') {
            this._triggerBanner('🧨 BARUT USTASI!', `${attacker.name}, ${target.name}'i fıçıyla uçurdu!`, '#ff6b35');
          } else if (sourceLabel === 'Sürpriz Çıkış') {
            this._triggerBanner('🦈 KÖPEKBALIĞI PUSUSU!', `${attacker.name} su altından bitirdi!`, '#38bdf8');
          }
        }
        // 💀 Deathmatch / Altın Taç Kill Ödülü: third-party dengesini korur!
        if (this.isSoloMode() && attacker.alive && attacker.id !== target.id && !hadBounty) {
          attacker.hp = Math.min(attacker.maxHp, attacker.hp + 40);
          attacker.breath = attacker.maxBreath;
          attacker.breathRegenDelay = 0;
          this._addPulse(attacker.x, attacker.y, 95, 'heal', attacker.team);
          this._addFloatText(attacker.x, attacker.y - 30, '💀 ÖDÜL: +40 CAN & NEFES!', '#06d6a0');
        }
      }
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

      // ❤️ MARIO KALP SİSTEMİ & 👑 ALTIN TAÇ YENİDEN DOĞMA!
      if (target.lives > 0 || this.settings.mode === 'crown') {
        target.respawnTimer = 2.6;
        if (this.settings.mode === 'crown' && target.lives <= 0) {
          target.lives = target.maxLives;
        }
        const heartsTxt = target.maxLives > 1
          ? ` (${'❤️'.repeat(target.lives)}${'🖤'.repeat(Math.max(0, target.maxLives - target.lives))} — 2.6s)`
          : ' (2.6s sonra yeniden doğacak)';
        this._pushFeed(`💔 ${target.name} suya gömüldü!${heartsTxt}`, 'sink');
      } else {
        this._pushFeed(`🌊 ${target.name} SUYA GÖMÜLDÜ! (${byText})`, 'sink');

        // 🛟 Takım arkadaşı hâlâ hayattaysa ve oyuncu bu tur henüz kurtarılmadıysa Kurtarma Şamandırası bırak!
        const aliveAlly = this.players.find(o => (o.alive || o.lives > 0) && o.team === target.team && o.id !== target.id);
        if (this.settings.rescue && aliveAlly && !target.rescuedOnce) {
          const bx = clamp(target.x, 70, WORLD_W - 70);
          const by = clamp(target.y, 70, WORLD_H - 70);
          this.rescueBuoys.push({
            id: this._nextEntityId++,
            playerId: target.id,
            name: target.name,
            team: target.team,
            role: target.role,
            x: bx,
            y: by,
            r: 76,
            progress: 0,
            duration: 3.0,
            life: 15.0,
            maxLife: 15.0
          });
          this._pushFeed(`🛟 ${target.name} için Kurtarma Şamandırası açıldı (15 sn)!`, 'info');
        }
      }
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

    if (this.phase === 'intro') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this._beginPlay();
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

    // 🌪️ Son bölümde Dev Fırtına Çemberi daralır! (süreye göre dengeli: 14sn–40sn arası)
    const stormWindow = Math.min(40, Math.round((this.settings.roundDuration || ROUND_DURATION) * 0.30));
    if (this.settings.storm && this.phaseTimer <= stormWindow) {
      if (!this.storm.announced) {
        this.storm.announced = true;
        this.storm.active = true;
        this._pushFeed('🌪️ DEV FIRTINA BAŞLADI! Güvenli çember daralıyor!', 'firearm');
        this.onEvent({ type: 'sfx', name: 'round_start' });
      }
      const prog = clamp((stormWindow - this.phaseTimer) / stormWindow, 0, 1);
      this.storm.r = 980 - (980 - 255) * prog;
    }

    // Update feed TTL & announcement banner
    if (this.banner) {
      this.banner.life -= dt;
      if (this.banner.life <= 0) this.banner = null;
    }
    for (let i = this.feed.length - 1; i >= 0; i--) {
      this.feed[i].ttl -= dt;
      if (this.feed[i].ttl <= 0) this.feed.splice(i, 1);
    }

    // Update zones (ink clouds, flares, gravity, kelp & lava geyser warnings!)
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.life -= dt;
      if (z.life <= 0) {
        this.zones.splice(i, 1);
        if (z.kind === 'geyser_warn') {
          this._eruptGeyser(z);
        }
      }
    }

    // 🗺️ HARİTA ÖZEL CANLI MEKANİKLERİ!
    const curMap = this.currentMap;
    // 1) 🗼 Dönen Deniz Feneri (Korsan Enkazı & Hayalet Sis)
    if (curMap.lighthouse) {
      const lh = curMap.lighthouse;
      this.lighthouseAngle = (this.lighthouseAngle + lh.speed * dt) % (Math.PI * 2);
      for (const p of this.players) {
        if (!p.alive) continue;
        const d = dist(lh.x, lh.y, p.x, p.y);
        if (d <= lh.range) {
          let diff = Math.abs(angleBetween(lh.x, lh.y, p.x, p.y) - this.lighthouseAngle) % (Math.PI * 2);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          if (diff <= lh.halfAngle) {
            p.revealTimer = Math.max(p.revealTimer, 1.0);
            p.inFog = false;
          }
        }
      }
    }
    // 2) 🌋 Su Altı Lav Gayzerleri (Volkanik Resif)
    if (curMap.geysers) {
      this.geyserTimer -= dt;
      if (this.geyserTimer <= 0) {
        this.geyserTimer = 6.4;
        const count = 2 + (Math.random() < 0.45 ? 1 : 0);
        for (let g = 0; g < count; g++) {
          for (let tries = 0; tries < 10; tries++) {
            const gx = 200 + Math.random() * (WORLD_W - 400);
            const gy = 170 + Math.random() * (WORLD_H - 340);
            if (!this._hitsObstacle(gx, gy, 55, curMap)) {
              this.zones.push({
                id: this._nextEntityId++,
                kind: 'geyser_warn',
                team: 'N',
                x: gx,
                y: gy,
                r: 68,
                life: 1.6,
                maxLife: 1.6
              });
              break;
            }
          }
        }
      }
    }

    // 🐙 7. TUR OLAYI — KRAKEN UYANIŞI!
    if (this.roundEvent === 'kraken_uyanisi' && !this.kraken && this.krakenSpawnTimer > 0) {
      this.krakenSpawnTimer -= dt;
      if (this.krakenSpawnTimer <= 0) {
        let kx = WORLD_W / 2;
        let ky = WORLD_H / 2;
        const kOffsets = [[0, 0], [0, -125], [0, 125], [-125, 0], [125, 0], [0, 185]];
        for (const [ox, oy] of kOffsets) {
          if (!this._hitsObstacle(kx + ox, ky + oy, 46, curMap)) {
            kx += ox; ky += oy; break;
          }
        }
        this.kraken = { id: this._nextEntityId++, x: kx, y: ky, r: 44, hp: 240, maxHp: 240, slamCd: 2.2, warnTimer: 0, slamR: 145 };
        this._addPulse(kx, ky, 175, 'boom', 'N');
        this.onEvent({ type: 'sfx', name: 'shot_heavy' });
        this._triggerBanner('🐙 KRAKEN UYANDI!', 'Harita merkezinde! Son vuruş: +1 Silah & +50 Kalkan!', '#d946ef');
        this._pushFeed('🐙 DEV KRAKEN UYANDI! Onu batıran silahını doldurur + 50 Kalkan alır!', 'firearm');
      }
    }
    if (this.kraken) {
      const k = this.kraken;
      if (k.warnTimer > 0) {
        k.warnTimer -= dt;
        if (k.warnTimer <= 0) {
          // 🐙 Dokunaç Şamarı!
          this._addPulse(k.x, k.y, k.slamR + 15, 'boom', 'N');
          this._addFloatText(k.x, k.y - 44, '🐙 ŞAMAR!', '#e879f9');
          this.onEvent({ type: 'sfx', name: 'shot_heavy' });
          for (const p of this.players) {
            if (!p.alive) continue;
            const d = dist(k.x, k.y, p.x, p.y);
            if (d <= k.slamR + p.r) {
              if (p.submerged) this._surfacePlayer(p, true);
              const a = d > 1 ? angleBetween(k.x, k.y, p.x, p.y) : Math.random() * Math.PI * 2;
              this._applyDamage(p, 24, null, Math.cos(a) * 440, Math.sin(a) * 440, 'Kraken');
            }
          }
          k.slamCd = 2.6;
        }
      } else {
        k.slamCd -= dt;
        if (k.slamCd <= 0) {
          const near = this.players.some(p => p.alive && dist(k.x, k.y, p.x, p.y) <= k.slamR + 28);
          if (near) k.warnTimer = 0.85;
        }
      }
      // Oyuncular Kraken gövdesinin içine girmesin
      for (const p of this.players) {
        if (!p.alive) continue;
        const d = dist(k.x, k.y, p.x, p.y);
        const minD = k.r + p.r;
        if (d > 0.01 && d < minD) {
          p.x = k.x + ((p.x - k.x) / d) * minD;
          p.y = k.y + ((p.y - k.y) / d) * minD;
        }
      }
    }

    // 👑 ALTIN TAÇ MODU SİMÜLASYONU
    if (this.crown) {
      if (this.crown.dropGrace > 0) this.crown.dropGrace = Math.max(0, this.crown.dropGrace - dt);
      if (this.crown.holderId) {
        const holder = this.players.find(pl => pl.id === this.crown.holderId);
        if (!holder || !holder.alive) {
          this.crown.holderId = null;
        } else {
          this.crown.x = holder.x;
          this.crown.y = holder.y;
          holder.revealTimer = Math.max(holder.revealTimer, 0.4);
          if (holder.submerged) this._surfacePlayer(holder, true);
          this.crownScores[holder.id] = Math.min(100, (this.crownScores[holder.id] || 0) + 5.5 * dt);
          if (this.crownScores[holder.id] >= 100) {
            this.ffaScores[holder.id] = (this.ffaScores[holder.id] || 0) + 1;
            this._endRound('crown', holder.id, `👑 ${holder.name} 100 Altın Taç puanına ulaştı!`, holder.name);
            return;
          }
        }
      } else if (this.crown.dropGrace <= 0) {
        for (const p of this.players) {
          if (!p.alive || p.submerged) continue;
          if (dist(p.x, p.y, this.crown.x, this.crown.y) <= p.r + 24) {
            this.crown.holderId = p.id;
            this._addPulse(p.x, p.y, 130, 'heal', p.team);
            this._addFloatText(p.x, p.y - 34, '👑 ALTIN TACI KAPTI!', '#ffd166');
            this._triggerBanner('👑 TAÇ KAPILDI!', `${p.name} Altın Tacı aldı — 100 puana koşuyor!`, '#ffd166');
            this._pushFeed(`👑 ${p.name} Altın Tacı kaptı!`, 'firearm');
            this.onEvent({ type: 'sfx', name: 'boost' });
            break;
          }
        }
      }
    }

    // Update pulses
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pu = this.pulses[i];
      pu.life -= dt;
      const prog = 1 - Math.max(0, pu.life / pu.maxLife);
      pu.r = 12 + (pu.maxR - 12) * prog;
      if (pu.life <= 0) this.pulses.splice(i, 1);
    }

    // Update sink effects & float texts
    for (let i = this.sinkEffects.length - 1; i >= 0; i--) {
      this.sinkEffects[i].life -= dt;
      if (this.sinkEffects[i].life <= 0) this.sinkEffects.splice(i, 1);
    }
    for (let i = this.floatTexts.length - 1; i >= 0; i--) {
      this.floatTexts[i].life -= dt;
      this.floatTexts[i].y -= dt * 26;
      if (this.floatTexts[i].life <= 0) this.floatTexts.splice(i, 1);
    }

    // Spawn & collect Sea Power-Ups!
    if (this.settings.powerups) {
      this.powerupSpawnTimer -= dt;
      if (this.powerupSpawnTimer <= 0) {
        this.powerupSpawnTimer = this.roundEvent === 'hazine_firtinasi' ? 4.8 : 9.0;
        this._spawnPowerup();
      }
    }
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pu = this.powerups[i];
      pu.life -= dt;
      let pickedBy = null;
      for (const p of this.players) {
        if (!p.alive) continue;
        if (dist(p.x, p.y, pu.x, pu.y) <= p.r + pu.r + 4) {
          pickedBy = p;
          break;
        }
      }
      if (pickedBy) {
        this._grantPowerup(pickedBy, pu);
        this.powerups.splice(i, 1);
      } else if (pu.life <= 0) {
        this.powerups.splice(i, 1);
      }
    }

    // Update Rescue Buoys (Takım Arkadaşını Sudan Kurtarma!)
    for (let i = this.rescueBuoys.length - 1; i >= 0; i--) {
      const rb = this.rescueBuoys[i];
      rb.life -= dt;
      const fallen = this.players.find(p => p.id === rb.playerId);
      const rescuer = this.players.find(p => p.alive && p.team === rb.team && p.id !== rb.playerId);

      if (!fallen || fallen.alive || !rescuer || rb.life <= 0) {
        this.rescueBuoys.splice(i, 1);
        continue;
      }

      const d = dist(rescuer.x, rescuer.y, rb.x, rb.y);
      if (d <= rb.r && rescuer.stunTimer <= 0) {
        rb.progress = Math.min(rb.duration, rb.progress + dt);
        // Kurtarma sürerken süre donar ki son saniye heyecanı bozulmasın!
        rb.life = Math.min(rb.maxLife, rb.life + dt * 0.65);
        if (rb.progress >= rb.duration) {
          // KURTARMA TAMAMLANDI!
          const rStat = this._stat(rescuer.id);
          if (rStat) rStat.rescues += 1;
          fallen.alive = true;
          fallen.lives = Math.max(1, fallen.lives);
          fallen.submerged = false;
          fallen.diveTime = 0;
          fallen.diveCd = 0;
          fallen.rescuedOnce = true;
          fallen.breath = fallen.maxBreath;
          fallen.breathRegenDelay = 0;
          fallen.hp = Math.round(fallen.maxHp * 0.55);
          fallen.shield = 30;
          fallen.shieldTimer = 3.0;
          fallen.x = rb.x;
          fallen.y = rb.y;
          fallen.vx = 0;
          fallen.vy = 0;
          fallen.stunTimer = 0;
          fallen.rootTimer = 0;
          fallen.slowTimer = 0;
          fallen.blindTimer = 0;
          this._addPulse(rb.x, rb.y, 145, 'heal', rb.team);
          this._addFloatText(rb.x, rb.y - 28, `🛟 ${fallen.name} KURTARILDI!`, '#06d6a0');
          this._pushFeed(`🛟 ${rescuer.name}, ${fallen.name}'i sudan kurtardı!`, 'sink');
          this.onEvent({ type: 'sfx', name: 'boost' });
          this.rescueBuoys.splice(i, 1);
        }
      } else {
        rb.progress = Math.max(0, rb.progress - dt * 0.75);
      }
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
        // ❤️ Mario Kalp Yeniden Doğma Sayacı!
        if (p.lives > 0 && p.respawnTimer > 0) {
          p.respawnTimer -= dt;
          if (p.respawnTimer <= 0) {
            this._respawnPlayer(p, map);
          }
        }
        continue;
      }

      // Tick cooldowns & statuses
      p.spaceCd = Math.max(0, p.spaceCd - dt);
      p.diveCd = Math.max(0, p.diveCd - dt);
      p.emoteCd = Math.max(0, p.emoteCd - dt);
      if (p.emoteTimer > 0) {
        p.emoteTimer = Math.max(0, p.emoteTimer - dt);
        if (p.emoteTimer <= 0) p.emote = null;
      }
      p.dashTimer = Math.max(0, p.dashTimer - dt);
      p.ramActive = Math.max(0, p.ramActive - dt);
      p.shieldTimer = Math.max(0, p.shieldTimer - dt);
      if (p.shieldTimer <= 0) p.shield = 0;
      p.mirrorTimer = Math.max(0, p.mirrorTimer - dt);
      if (p.kelpTimer > 0) {
        p.kelpTimer = Math.max(0, p.kelpTimer - dt);
        p.kelpDropCd -= dt;
        if (p.kelpDropCd <= 0) {
          p.kelpDropCd = 0.28;
          this.zones.push({
            id: this._nextEntityId++,
            kind: 'kelp',
            team: p.team,
            x: p.x,
            y: p.y,
            r: 42,
            life: 4.5,
            maxLife: 4.5
          });
        }
      }

      // 🤿 Su altı nefes tüketimi vs 🫁 Yüzeyde nefes yenilenmesi!
      const pSk = p.sk || this._computeSkillBonuses([]);
      if (p.submerged) {
        p.diveTime += dt;
        const evDrain = this.roundEvent === 'derin_deniz' ? 0.5 : 1.0;
        p.breath = Math.max(0, p.breath - (22 * pSk.breathDrainMult * evDrain) * dt);
        p.breathRegenDelay = Math.max(1.2, 2.2 - pSk.regenDelayReduce * 0.5);
        if (p.breath <= 0) {
          this._addFloatText(p.x, p.y - 30, '🫁 NEFES BİTTİ!', '#38bdf8');
          this._surfacePlayer(p, true);
        }
      } else if (p.breathRegenDelay > 0) {
        p.breathRegenDelay = Math.max(0, p.breathRegenDelay - dt);
      } else if (p.breath < p.maxBreath) {
        p.breath = Math.min(p.maxBreath, p.breath + (20 * pSk.regenSpeedMult) * dt);
      }
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

      const evSpd = this.roundEvent === 'kasirga_hizi' ? 1.25 : 1.0;
      let maxSpd = ch.speed * p.speedMult * p.slowFactor * pSk.speedMult * evSpd;
      if (p.role === 'hunter') maxSpd *= 1.03; // Hafif avcı takip hızı avantajı
      if (this.crown && this.crown.holderId === p.id) maxSpd *= 0.87; // 👑 Taç taşıyıcısı %13 yavaşlar
      if (p.submerged) maxSpd *= 0.66 * pSk.subSpeedBonus; // Su altında yavaş gizlenme ve pusu hızı
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

      // 🌪️ Çekim Bombası & 🌿 Yosun İzi bölge etkileri!
      for (const z of this.zones) {
        if (z.kind === 'gravity' && z.team !== p.team) {
          const dz = dist(p.x, p.y, z.x, z.y);
          if (dz < z.r && dz > 8) {
            const a = angleBetween(p.x, p.y, z.x, z.y);
            const pull = (1 - dz / z.r) * 360 + 110;
            p.vx += Math.cos(a) * pull * dt * 4.2;
            p.vy += Math.sin(a) * pull * dt * 4.2;
          }
        } else if (z.kind === 'kelp' && z.team !== p.team) {
          if (dist(p.x, p.y, z.x, z.y) <= z.r + p.r * 0.4) {
            p.slowTimer = Math.max(p.slowTimer, 0.45);
            p.slowFactor = Math.min(p.slowFactor, 0.4);
          }
        }
      }

      // 🌊 Turbo Deniz Akıntıları (Yönlü Hız Koridorları — hasarsız saf hız taktiği!)
      p.inCurrent = false;
      for (const cur of map.currents || []) {
        if (p.x >= cur.x && p.x <= cur.x + cur.w && p.y >= cur.y && p.y <= cur.y + cur.h) {
          const dot = mx * cur.dirX + my * cur.dirY;
          if (dot >= -0.15) {
            // Akıntıyla aynı yönde veya nötr: turbo hızlanma!
            p.inCurrent = true;
            const bonus = ch.currentBonus ? 1.25 : 1.0;
            const push = maxSpd * (cur.boost - 1.0) * bonus;
            p.vx += (cur.dirX * push) * Math.min(1, 10 * dt);
            p.vy += (cur.dirY * push) * Math.min(1, 10 * dt);
          } else if (!ch.currentBonus) {
            // Ters yönde hafif direnç (Dalga Binicisi etkilenmez, hasar yok!)
            p.vx += cur.dirX * 55 * dt * 6;
            p.vy += cur.dirY * 55 * dt * 6;
          }
        }
      }

      // Integrate position (kumsal/plaj varsa kıyı çizgisinden karaya çıkamaz!)
      const minY = map.beach ? map.beach.sandY + p.r + 2 : p.r + 12;
      p.x = clamp(p.x + p.vx * dt, p.r + 12, WORLD_W - p.r - 12);
      p.y = clamp(p.y + p.vy * dt, minY, WORLD_H - p.r - 12);
      this._resolveObstacleCollision(p, p.r, map, false);
      // Engel çözümü sonrası kumsala / sınır dışına taşmayı engelle!
      p.x = clamp(p.x, p.r + 12, WORLD_W - p.r - 12);
      p.y = clamp(p.y, minY, WORLD_H - p.r - 12);

      // 🏖️ Mercan Plajı: Sığ su şeridinde dalış yapılamaz (dalıştaysa yüzeye çıkar!)
      p.inShallow = Boolean(map.beach && p.y < map.beach.shallowY);
      if (p.inShallow && p.submerged) {
        this._addFloatText(p.x, p.y - 28, '🏖️ SIĞ SU!', '#ffd166');
        this._surfacePlayer(p, true);
      }

      // Fırtına çemberi dışı hasarı!
      p.inStorm = false;
      if (this.storm.active) {
        const dStorm = dist(p.x, p.y, this.storm.cx, this.storm.cy);
        if (dStorm > this.storm.r) {
          p.inStorm = true;
          this._applyDamage(p, 18 * dt, null, 0, 0, 'Dev Fırtına');
          if (!p.alive) continue;
        }
      }

      // Wake / sound ripple when moving fast (su altındayken köpük izi bırakmaz!)
      const spd = Math.hypot(p.vx, p.vy);
      if (spd > 130 && p.stealthBoost <= 0 && !p.submerged) {
        p.wakeTimer -= dt;
        if (p.wakeTimer <= 0) {
          p.wakeTimer = 0.65;
          const wakeR = 145 * (ch.wakeMult || 1);
          if (wakeR > 75) {
            this._addPulse(p.x, p.y, wakeR, 'wake', p.team);
          }
        }
      }

      // Hunter & FFA Ram (Suya Bastırma) collision check
      if ((p.role === 'hunter' || p.role === 'ffa') && p.ramActive > 0) {
        if (this.kraken && !p.ramHitIds.has('kraken') && dist(p.x, p.y, this.kraken.x, this.kraken.y) <= p.r + this.kraken.r + 16) {
          p.ramHitIds.add('kraken');
          this._damageKraken(46, p.id);
        }
        // 🪵 SPACE darbesiyle kırılabilir barikatları parçala!
        for (let bi = this.breakables.length - 1; bi >= 0; bi--) {
          const br = this.breakables[bi];
          const bKey = `br_${br.id}`;
          if (!p.ramHitIds.has(bKey) && dist(p.x, p.y, br.x, br.y) <= p.r + br.r + 14) {
            p.ramHitIds.add(bKey);
            this._damageBreakable(br, 42);
          }
        }
        for (const other of this.players) {
          if (!other.alive || other.submerged || other.team === p.team || p.ramHitIds.has(other.id)) continue;
          if (dist(p.x, p.y, other.x, other.y) <= p.r + other.r + 14) {
            p.ramHitIds.add(other.id);
            const pushA = angleBetween(p.x, p.y, other.x, other.y);
            const dmg = p.speedBoost > 0 ? 52 : 42;
            const kb = p.speedBoost > 0 ? 450 : 360;
            this._applyDamage(other, dmg, p.id, Math.cos(pushA) * kb, Math.sin(pushA) * kb, 'Suya Bastırma');
            other.slowTimer = Math.max(other.slowTimer, 0.8);
            other.slowFactor = Math.min(other.slowFactor, 0.65);
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
          const sepMinY = map.beach ? map.beach.sandY + a.r + 2 : a.r + 12;
          a.x = clamp(a.x, a.r + 12, WORLD_W - a.r - 12);
          a.y = clamp(a.y, sepMinY, WORLD_H - a.r - 12);
          b.x = clamp(b.x, b.r + 12, WORLD_W - b.r - 12);
          b.y = clamp(b.y, sepMinY, WORLD_H - b.r - 12);
        }
      }
    }

    // 🧨 Update Pushable & Chain-Exploding Sea Powder Barrels!
    if (this.settings.barrels) {
      this.barrelSpawnTimer -= dt;
      if (this.barrelSpawnTimer <= 0) {
        this.barrelSpawnTimer = this.roundEvent === 'barut_yagmuru' ? 10.0 : 22.0;
        this._spawnOneBarrel();
      }
    }
    for (let i = this.barrels.length - 1; i >= 0; i--) {
      const b = this.barrels[i];
      if (b.fuse > 0) {
        b.fuse -= dt;
        if (b.fuse <= 0) {
          this._detonateBarrel(b, b.lastTouchId, b.lastTouchTeam);
          continue;
        }
      }
      // Drift with Turbo Sea Currents!
      for (const cur of map.currents || []) {
        if (b.x >= cur.x && b.x <= cur.x + cur.w && b.y >= cur.y && b.y <= cur.y + cur.h) {
          b.vx += cur.dirX * 360 * dt;
          b.vy += cur.dirY * 360 * dt;
        }
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx *= Math.pow(0.22, dt);
      b.vy *= Math.pow(0.22, dt);
      const minBY = map.beach ? map.beach.sandY + b.r + 4 : 30;
      if (b.x < 30 || b.x > WORLD_W - 30) { b.x = clamp(b.x, 30, WORLD_W - 30); b.vx *= -0.7; }
      if (b.y < minBY || b.y > WORLD_H - 30) { b.y = clamp(b.y, minBY, WORLD_H - 30); b.vy *= -0.7; }
      this._resolveObstacleCollision(b, b.r, map, true);

      // Player pushes / launches barrel with boat or SPACE ram!
      for (const p of this.players) {
        if (!p.alive) continue;
        const d = dist(p.x, p.y, b.x, b.y);
        const minD = p.r + b.r;
        if (d > 0.01 && d < minD) {
          const nx = (b.x - p.x) / d;
          const ny = (b.y - p.y) / d;
          b.x = p.x + nx * (minD + 1);
          b.y = p.y + ny * (minD + 1);
          const launch = (p.ramActive > 0 || p.dashTimer > 0) ? 560 : Math.max(210, Math.hypot(p.vx, p.vy) * 1.35);
          b.vx = nx * launch;
          b.vy = ny * launch;
          b.lastTouchId = p.id;
          b.lastTouchTeam = p.team;
          if (p.ramActive > 0) {
            this.onEvent({ type: 'sfx', name: 'splash' });
          }
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
          // Ağır Çapa ve Su Altı Mayını su altındakileri de yakalayıp yüzeye çıkarır!
          if (p.submerged) this._surfacePlayer(p, true);
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
            // Mayın yakındaki barut fıçısını da tetikler!
            for (const b of this.barrels) {
              if (b.fuse <= 0 && dist(tr.x, tr.y, b.x, b.y) <= 135) {
                b.fuse = 0.14;
                b.lastTouchId = tr.ownerId;
                b.lastTouchTeam = tr.team;
              }
            }
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

      const minPY = map.beach ? map.beach.sandY : 10;
      let dead = pr.traveled >= pr.maxDist;

      // 🎱 SEKEN MERMİLER: Deniz sınırından veya kayadan/enkazdan 2 kez seker!
      if (!dead && (pr.x < 12 || pr.x > WORLD_W - 12 || pr.y < minPY || pr.y > WORLD_H - 12)) {
        if (pr.bouncesLeft > 0) {
          pr.bouncesLeft -= 1;
          if (pr.x < 12 || pr.x > WORLD_W - 12) { pr.vx = -pr.vx; pr.x = clamp(pr.x, 14, WORLD_W - 14); }
          if (pr.y < minPY || pr.y > WORLD_H - 12) { pr.vy = -pr.vy; pr.y = clamp(pr.y, minPY + 2, WORLD_H - 14); }
          pr.maxDist += 160;
          this._addPulse(pr.x, pr.y, 44, 'flash', pr.team);
          this.onEvent({ type: 'sfx', name: 'hit' });
        } else {
          dead = true;
        }
      }

      // 🐙 Kraken hit!
      if (!dead && this.kraken && dist(pr.x, pr.y, this.kraken.x, this.kraken.y) <= pr.r + this.kraken.r) {
        dead = true;
        this._damageKraken(Math.max(20, pr.damage || 28), pr.ownerId);
      }

      // 🪵 Breakable barricade hit -> damage & shatter!
      if (!dead) {
        for (let bi = this.breakables.length - 1; bi >= 0; bi--) {
          const br = this.breakables[bi];
          if (dist(pr.x, pr.y, br.x, br.y) <= pr.r + br.r) {
            dead = true;
            this._damageBreakable(br, Math.max(22, pr.damage || 28));
            break;
          }
        }
      }

      // Obstacle hit (🎱 Seken Mermiler olayı aktifse kayadan & enkazdan bilardo gibi sek!)
      if (!dead) {
        const hitNorm = this._getObstacleBounceNormal(pr.x, pr.y, pr.r, map);
        if (hitNorm) {
          if (pr.bouncesLeft > 0) {
            pr.bouncesLeft -= 1;
            const dot = pr.vx * hitNorm.nx + pr.vy * hitNorm.ny;
            if (dot < 0) {
              pr.vx -= 2 * dot * hitNorm.nx;
              pr.vy -= 2 * dot * hitNorm.ny;
            }
            pr.x += hitNorm.nx * 8;
            pr.y += hitNorm.ny * 8;
            pr.maxDist += 180;
            this._addPulse(pr.x, pr.y, 48, 'flash', pr.team);
            this.onEvent({ type: 'sfx', name: 'hit' });
          } else {
            dead = true;
          }
        }
      }

      // 🧨 Powder barrel hit -> instant explosion!
      if (!dead) {
        for (const b of this.barrels) {
          if (dist(pr.x, pr.y, b.x, b.y) <= pr.r + b.r + 3) {
            dead = true;
            this._detonateBarrel(b, pr.ownerId, pr.team);
            break;
          }
        }
      }

      // Player hit (yüzey mermileri su altındakilerin üstünden geçer!)
      if (!dead) {
        for (const p of this.players) {
          if (!p.alive || p.submerged || p.team === pr.team) continue;
          if (dist(pr.x, pr.y, p.x, p.y) <= pr.r + p.r) {
            // 🪞 AYNA KALKANI: Gelen mermiyi %100 engelleyip aynen GERİ SEKTİRİR!
            if (p.mirrorTimer > 0) {
              p.mirrorTimer = 0;
              pr.ownerId = p.id;
              pr.team = p.team;
              pr.vx = -pr.vx * 1.15;
              pr.vy = -pr.vy * 1.15;
              pr.traveled = 0;
              pr.color = '#e0f2fe';
              this._addPulse(p.x, p.y, 90, 'flash', p.team);
              this._addFloatText(p.x, p.y - 30, '🪞 YANSITILDI!', '#e0f2fe');
              this._pushFeed(`🪞 ${p.name} Ayna Kalkanı ile mermiyi geri sektirdi!`, 'firearm');
              this.onEvent({ type: 'sfx', name: 'flash' });
              break;
            }
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
            if (pr.revealHitDur) {
              p.revealTimer = Math.max(p.revealTimer, pr.revealHitDur);
            }
            this._applyDamage(p, pr.damage || 0, pr.ownerId, kx, ky, '', Boolean(pr.firearm));
            // 🎯 KESKİN NİŞANCI (Saldırı Tier 3): Ateşli silahla ilk isabette +1 mermi iadesi!
            if (pr.firearm) {
              const shooter = this.players.find(pl => pl.id === pr.ownerId);
              if (shooter && shooter.alive && shooter.sk?.sniperRefund && !shooter.sniperRefundUsed) {
                const gun = shooter.items.find(it => it.id === pr.itemId && !it.longCd)
                  || shooter.items.find(it => it.firearm && !it.longCd && it.usesLeft < it.maxUses);
                if (gun) {
                  shooter.sniperRefundUsed = true;
                  gun.usesLeft = Math.min(gun.maxUses, gun.usesLeft + 1);
                  gun.cd = 0;
                  this._addPulse(shooter.x, shooter.y, 90, 'heal', shooter.team);
                  this._addFloatText(shooter.x, shooter.y - 34, '🎯 +1 MERMİ İADESİ!', '#ffd166');
                  this._pushFeed(`🎯 ${shooter.name} Keskin Nişancı ile mermisini geri kazandı!`, 'firearm');
                  this.onEvent({ type: 'sfx', name: 'boost', targetId: shooter.id });
                }
              }
            }
            // ⚡ Elektrik Ağı: Yakındaki başka bir düşmana zincirleme elektrik sıçrat!
            if (pr.kind === 'shock' && pr.chainRange) {
              for (const other of this.players) {
                if (!other.alive || other.id === p.id || other.team === pr.team) continue;
                if (dist(p.x, p.y, other.x, other.y) <= pr.chainRange) {
                  other.slowTimer = Math.max(other.slowTimer, pr.slowDur || 1.3);
                  other.slowFactor = Math.min(other.slowFactor, 0.45);
                  this._applyDamage(other, pr.chainDamage || 26, pr.ownerId, 0, 0, 'Elektrik Ağı');
                  this._addPulse(other.x, other.y, 75, 'flash', pr.team);
                  this._addFloatText(other.x, other.y - 26, '⚡ ZİNCİR ŞOK!', '#38bdf8');
                  break;
                }
              }
            }
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

    // Check Round Win Conditions (kalan kalbi > 0 olanlar hâlâ oyundadır!)
    const inRound = (p) => p.alive || (p.lives > 0);
    if (this.settings.mode === 'crown') {
      if (this.phaseTimer <= 0) {
        const ranked = [...this.players].sort((a, b) => (this.crownScores[b.id] || 0) - (this.crownScores[a.id] || 0));
        const win = ranked[0];
        if (win) {
          this.ffaScores[win.id] = (this.ffaScores[win.id] || 0) + 1;
          this._endRound('crown', win.id, `Süre doldu — 👑 ${Math.round(this.crownScores[win.id] || 0)} puanla ${win.name} kazandı!`, win.name);
        }
      }
      return;
    }
    if (this.settings.mode === 'ffa') {
      const aliveAll = this.players.filter(inRound);
      if (aliveAll.length <= 1) {
        const win = aliveAll[0] || null;
        if (win) {
          this.ffaScores[win.id] = (this.ffaScores[win.id] || 0) + 1;
          this._endRound('ffa', win.id, `${win.name} son ayakta kalan oldu!`, win.name);
        } else {
          this._endRound('ffa', null, 'Herkes aynı anda suya gömüldü — Berabere!', 'Berabere');
        }
      } else if (this.phaseTimer <= 0) {
        aliveAll.sort((a, b) => (b.lives * 500 + b.hp + b.breath) - (a.lives * 500 + a.hp + a.breath));
        const win = aliveAll[0];
        this.ffaScores[win.id] = (this.ffaScores[win.id] || 0) + 1;
        this._endRound('ffa', win.id, `Süre doldu — en sağlam kalan ${win.name} kazandı!`, win.name);
      }
      return;
    }

    const aliveHunters = this.players.filter(p => p.role === 'hunter' && inRound(p));
    const alivePrey = this.players.filter(p => p.role === 'prey' && inRound(p));

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

  _respawnPlayer(p, map) {
    // Düşmanlardan en uzak güvenli başlangıç noktasını seç!
    const candidates = [...map.hunterSpawns, ...map.preySpawns];
    const enemies = this.players.filter(o => o.alive && o.team !== p.team);
    let bestSp = candidates[0];
    let bestScore = -1;
    for (const sp of candidates) {
      let minD = 9999;
      for (const e of enemies) minD = Math.min(minD, dist(sp.x, sp.y, e.x, e.y));
      // Fırtına aktifse merkeze yakın spawn da dene
      if (this.storm.active && dist(sp.x, sp.y, this.storm.cx, this.storm.cy) > this.storm.r - 40) {
        minD *= 0.2;
      }
      if (minD > bestScore) { bestScore = minD; bestSp = sp; }
    }
    p.x = bestSp.x;
    p.y = bestSp.y;
    if (this.storm.active && dist(p.x, p.y, this.storm.cx, this.storm.cy) > this.storm.r - 50) {
      p.x = this.storm.cx + (Math.random() - 0.5) * 140;
      p.y = Math.max(map.beach ? map.beach.sandY + 40 : 80, this.storm.cy + (Math.random() - 0.5) * 140);
    }
    p.vx = 0;
    p.vy = 0;
    p.alive = true;
    p.hp = p.maxHp;
    p.breath = p.maxBreath;
    p.breathRegenDelay = 0;
    p.shield = 40;
    p.shieldTimer = 3.0;
    p.stunTimer = 0;
    p.rootTimer = 0;
    p.slowTimer = 0;
    p.blindTimer = 0;
    p.submerged = false;
    p.diveCd = 0;
    p.sniperRefundUsed = false;
    // Yeni kalp = taze 2 item şarjı!
    for (const it of p.items) {
      it.usesLeft = it.maxUses;
      it.cd = 0;
    }
    this._addPulse(p.x, p.y, 120, 'heal', p.team);
    this._addFloatText(p.x, p.y - 30, `❤️ YENİDEN DOĞDU!`, '#ff8fa3');
    this.onEvent({ type: 'sfx', name: 'boost' });
  }

  _grantPowerup(p, pu) {
    const def = POWERUP_MAP[pu.kind];
    if (!def) return;
    const pStat = this._stat(p.id);
    if (pStat) pStat.powerups += 1;
    this._addPulse(pu.x, pu.y, 95, 'heal', p.team);
    this.onEvent({ type: 'sfx', name: 'boost' });
    this._addFloatText(p.x, p.y - 26, `${def.icon} ${def.label}`, def.color);

    switch (pu.kind) {
      case 'heal':
        p.hp = Math.min(p.maxHp, p.hp + 50);
        break;
      case 'shield':
        p.shield = Math.min(60, (p.shield || 0) + 45);
        p.shieldTimer = Math.max(p.shieldTimer, 8.5);
        break;
      case 'speed':
        p.speedBoost = Math.max(p.speedBoost, 5.0);
        p.speedMult = Math.max(p.speedMult, 1.35);
        break;
      case 'reload': {
        // Öncelik: tükenmiş ateşli silahı veya eksik itemi +1 doldur!
        const spent = p.items.find(it => it.usesLeft === 0) || p.items.find(it => it.usesLeft < it.maxUses);
        if (spent) {
          spent.usesLeft += 1;
          spent.cd = 0;
          this._pushFeed(`📦 ${p.name} Cephane Sandığı kaptı (+1 Şarj)!`, 'firearm');
        } else {
          // Tüm itemler doluysa +35 direnç + hız bonusu ver
          p.hp = Math.min(p.maxHp, p.hp + 35);
          p.speedBoost = Math.max(p.speedBoost, 3.0);
          p.speedMult = Math.max(p.speedMult, 1.28);
        }
        break;
      }
      case 'reveal':
        this._addPulse(p.x, p.y, 950, 'sonar', p.team);
        for (const other of this.players) {
          if (other.alive && other.team !== p.team && !other.inInk) {
            other.revealTimer = Math.max(other.revealTimer, 3.5);
          }
        }
        this.onEvent({ type: 'sfx', name: 'sonar' });
        break;
    }
  }

  _endRound(winnerRole, winnerTeam, reason, winnerName = '') {
    this.phase = 'round_end';
    this.phaseTimer = 5.2;
    this.roundWinnerRole = winnerRole;
    this.roundWinnerTeam = winnerTeam;
    this.roundWinnerName = winnerName;
    this.roundReason = reason;
    // Hayatta kalarak turu tamamlayanlara +1 survived istatistiği
    for (const p of this.players) {
      if (p.alive) {
        const st = this._stat(p.id);
        if (st) st.survived += 1;
      }
    }
    if (winnerRole !== 'ffa' && winnerRole !== 'crown' && (winnerTeam === 'A' || winnerTeam === 'B')) {
      this.scores[winnerTeam] += 1;
    }
    this.onEvent({ type: 'sfx', name: 'round_end' });
    this.onEvent({
      type: 'round_telemetry',
      mode: this.settings.mode,
      mapId: this.currentMap.id,
      winnerRole,
      winnerTeam,
      humans: this.players.filter(p => !p.isBot).map(p => ({
        charId: p.charId,
        role: p.role,
        won: (winnerRole === 'ffa' || winnerRole === 'crown') ? p.id === winnerTeam : p.team === winnerTeam,
        items: p.items.map(i => i.id),
        skills: [...(p.skills || [])]
      }))
    });
    this.onEvent({ type: 'phase', phase: 'round_end', round: this.round });
  }

  _eruptGeyser(z) {
    this._addPulse(z.x, z.y, z.r + 22, 'boom', 'N');
    this._addFloatText(z.x, z.y - 16, '🌋 LAV!', '#ff6b35');
    this.onEvent({ type: 'sfx', name: 'shot_heavy' });
    for (const p of this.players) {
      if (!p.alive) continue;
      const d = dist(z.x, z.y, p.x, p.y);
      if (d <= z.r + p.r) {
        if (p.submerged) this._surfacePlayer(p, true);
        const a = d > 1 ? angleBetween(z.x, z.y, p.x, p.y) : Math.random() * Math.PI * 2;
        this._applyDamage(p, 36, null, Math.cos(a) * 360, Math.sin(a) * 360, 'Lav Gayzeri');
      }
    }
  }

  _damageKraken(dmg, attackerId) {
    if (!this.kraken) return;
    const k = this.kraken;
    k.hp -= dmg;
    this._addPulse(k.x, k.y, k.r + 22, 'flash', 'N');
    this._addFloatText(k.x + (Math.random() - 0.5) * 30, k.y - 34, `-${Math.round(dmg)}`, '#f0abfc');
    this.onEvent({ type: 'sfx', name: 'hit' });
    if (k.hp <= 0) {
      const kx = k.x; const ky = k.y;
      this.kraken = null;
      this._addPulse(kx, ky, 190, 'boom', 'N');
      this.onEvent({ type: 'sfx', name: 'sink' });
      const killer = this.players.find(pl => pl.id === attackerId);
      if (killer && killer.alive) {
        const spent = killer.items.find(it => it.usesLeft === 0) || killer.items.find(it => it.usesLeft < it.maxUses);
        if (spent) {
          spent.usesLeft += 1;
          spent.cd = 0;
        } else {
          killer.hp = Math.min(killer.maxHp, killer.hp + 45);
        }
        killer.shield = Math.min(75, (killer.shield || 0) + 50);
        killer.shieldTimer = Math.max(killer.shieldTimer, 10.0);
        this._addPulse(killer.x, killer.y, 130, 'heal', killer.team);
        this._addFloatText(killer.x, killer.y - 36, '🐙 +1 ŞARJ & +50 KALKAN!', '#e879f9');
        this._triggerBanner('🐙 KRAKEN AVLANDI!', `${killer.name} son vuruşu çaldı! (+1 Silah & +50 Kalkan)`, '#d946ef');
        this._pushFeed(`🐙 ${killer.name} DEV KRAKEN'İ BATIRDI! (+1 Şarj & +50 Kalkan)`, 'firearm');
      } else {
        this._pushFeed('🐙 Dev Kraken derinlere gömüldü!', 'info');
      }
    }
  }

  _damageBreakable(br, dmg) {
    br.hp -= dmg;
    this._addPulse(br.x, br.y, br.r + 18, 'splash', 'N');
    this.onEvent({ type: 'sfx', name: 'hit' });
    if (br.hp <= 0) {
      const idx = this.breakables.indexOf(br);
      if (idx >= 0) this.breakables.splice(idx, 1);
      this._addPulse(br.x, br.y, br.r + 45, 'boom', 'N');
      this._addFloatText(br.x, br.y - 18, '🪵 KIRILDI!', '#fde68a');
      this.onEvent({ type: 'sfx', name: 'shot_heavy' });
    }
  }

  _advanceAfterRound() {
    if (this.isSoloMode()) {
      if (this.round >= this.totalRounds) {
        const ranked = this.getActiveSlots(true)
          .map(s => ({ id: s.id, name: s.name, pts: this.ffaScores[s.id] || 0 }))
          .sort((a, b) => b.pts - a.pts);
        if (ranked.length >= 2 && ranked[0].pts === ranked[1].pts) {
          this.totalRounds = this.round + 1;
        } else {
          this.phase = 'match_end';
          this.matchWinnerTeam = ranked[0]?.id || null;
          this.matchWinnerName = ranked[0]?.name || 'Şampiyon';
          if (this.matchWinnerTeam) {
            this.sessionWins[this.matchWinnerTeam] = (this.sessionWins[this.matchWinnerTeam] || 0) + 1;
          }
          this.onEvent({ type: 'phase', phase: 'match_end', round: this.round });
          return;
        }
      }
      this.round += 1;
      this.startDraft();
      return;
    }

    // Check if match is over
    if (this.round >= this.totalRounds) {
      if (this.scores.A !== this.scores.B) {
        this.phase = 'match_end';
        this.matchWinnerTeam = this.scores.A > this.scores.B ? 'A' : 'B';
        for (const s of this.getActiveSlots(true)) {
          if (s.id && s.team === this.matchWinnerTeam) {
            this.sessionWins[s.id] = (this.sessionWins[s.id] || 0) + 1;
          }
        }
        this.onEvent({ type: 'phase', phase: 'match_end', round: this.round });
        return;
      }
      // Beraberlik! Uzatma Final Turu
      this.totalRounds = this.round + 1;
    }
    this.round += 1;
    this.startDraft();
  }

  _getObstacleBounceNormal(x, y, r, map) {
    for (const obs of map.rocks) {
      if (obs.type === 'rock') {
        const d = dist(x, y, obs.x, obs.y);
        if (d < obs.r + r && d > 0.001) {
          return { nx: (x - obs.x) / d, ny: (y - obs.y) / d };
        }
      } else {
        const cx = clamp(x, obs.x, obs.x + obs.w);
        const cy = clamp(y, obs.y, obs.y + obs.h);
        const d = dist(x, y, cx, cy);
        if (d < r) {
          if (d > 0.001) {
            return { nx: (x - cx) / d, ny: (y - cy) / d };
          }
          const dl = Math.abs(x - obs.x);
          const dr = Math.abs(obs.x + obs.w - x);
          const dt = Math.abs(y - obs.y);
          const db = Math.abs(obs.y + obs.h - y);
          const m = Math.min(dl, dr, dt, db);
          if (m === dl) return { nx: -1, ny: 0 };
          if (m === dr) return { nx: 1, ny: 0 };
          if (m === dt) return { nx: 0, ny: -1 };
          return { nx: 0, ny: 1 };
        }
      }
    }
    return null;
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
    for (const br of this.breakables) {
      if (dist(x, y, br.x, br.y) < br.r + r) return true;
    }
    return false;
  }

  _resolveObstacleCollision(ent, r, map, bounce = false) {
    for (const br of this.breakables) {
      const d = dist(ent.x, ent.y, br.x, br.y);
      const minD = br.r + r;
      if (d < minD && d > 0.001) {
        const nx = (ent.x - br.x) / d;
        const ny = (ent.y - br.y) / d;
        ent.x = br.x + nx * minD;
        ent.y = br.y + ny * minD;
        if (bounce) {
          const dot = ent.vx * nx + ent.vy * ny;
          ent.vx -= 2 * dot * nx;
          ent.vy -= 2 * dot * ny;
        }
      }
    }
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
            if (obs.type === 'pier') {
              ent.x = (ent.x < obs.x + obs.w * 0.5) ? obs.x - r : obs.x + obs.w + r;
            } else {
              ent.y = obs.y - r;
            }
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

    if (target.submerged) return false;
    if (target.inInk && d > 70) return false;
    if (target.inFog) {
      const fogDetect = tch.stealthBonus ? 85 : 135;
      if (d > fogDetect) return false;
    }
    const visMult = this.roundEvent === 'gece_sisi' ? 0.7 : 1.0;
    if (d > ch.vision * visMult) return false;
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

    // 👑 Altın Taç Modu: Bot düşen taca koşsun veya taçlıyı kovalasın!
    if (this.crown && !this.crown.holderId) {
      const a = angleBetween(bot.x, bot.y, this.crown.x, this.crown.y);
      bot.aim = a;
      this.inputs[bot.id] = { mx: Math.cos(a), my: Math.sin(a), aim: a };
      return;
    }
    if (this.crown && this.crown.holderId && this.crown.holderId !== bot.id && !target) {
      const holder = this.players.find(pl => pl.id === this.crown.holderId && pl.alive);
      if (holder) {
        target = holder;
        bestD = dist(bot.x, bot.y, holder.x, holder.y);
      }
    }

    // Bot takım arkadaşının kurtarma şamandırasına koşsun (yakında tehdit yoksa!)
    const allyBuoy = this.rescueBuoys.find(rb => rb.team === bot.team);
    if (allyBuoy && (!target || bestD > 260)) {
      const dBuoy = dist(bot.x, bot.y, allyBuoy.x, allyBuoy.y);
      if (dBuoy > 26) {
        const a = angleBetween(bot.x, bot.y, allyBuoy.x, allyBuoy.y);
        bot.aim = a;
        mx = Math.cos(a);
        my = Math.sin(a);
      }
      this.inputs[bot.id] = { mx: clamp(mx, -1, 1), my: clamp(my, -1, 1), aim: bot.aim };
      return;
    }

    if (bot.role === 'hunter' || bot.role === 'ffa') {
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
          // Bot kaçarken nefesi bolsa kısa dalış yapabilir, veya 1.2s sonra dibinde çıkabilir!
          if (!bot.submerged && bestD < 190 && bot.diveCd <= 0 && bot.breath >= 45 && Math.random() < 0.25) {
            this.toggleDive(bot.id);
          } else if (bot.submerged && (bot.diveTime >= 1.5 || bot.breath < 22)) {
            this.toggleDive(bot.id);
          }
          if (bestD < 150 && bot.spaceCd <= 0 && !bot.submerged) {
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

    // Stay inside storm circle!
    if (this.storm.active) {
      const dStorm = dist(bot.x, bot.y, this.storm.cx, this.storm.cy);
      if (dStorm > this.storm.r - 65) {
        const inward = angleBetween(bot.x, bot.y, this.storm.cx, this.storm.cy);
        mx += Math.cos(inward) * 2.0;
        my += Math.sin(inward) * 2.0;
      }
    }

    this.inputs[bot.id] = { mx: clamp(mx, -1, 1), my: clamp(my, -1, 1), aim: bot.aim };
  }

  getLobbySnapshot() {
    return {
      version: GAME_VERSION,
      phase: this.phase,
      totalRounds: this.totalRounds,
      settings: { ...this.settings },
      round: this.round,
      mapIndex: this.mapIndex,
      roundEvent: this.roundEvent,
      scores: { ...this.scores },
      ffaScores: { ...this.ffaScores },
      phaseTimer: Math.ceil(this.phaseTimer),
      slots: this.getActiveSlots(this.phase !== 'lobby').map(s => ({
        idx: s.idx,
        team: s.team,
        id: s.id,
        name: s.name,
        isBot: s.isBot,
        charId: s.charId,
        skinId: s.skinId || 'auto',
        items: [...s.items],
        readyItems: s.readyItems,
        skills: [...(s.skills || [])],
        skillPoints: s.skillPoints || 0,
        wins: s.id ? (this.sessionWins[s.id] || 0) : 0
      }))
    };
  }

  getStateSnapshot() {
    return {
      phase: this.phase,
      mode: this.settings.mode,
      round: this.round,
      totalRounds: this.totalRounds,
      mapIndex: this.mapIndex,
      roundEvent: this.roundEvent,
      banner: this.banner ? { id: this.banner.id, text: this.banner.text, sub: this.banner.sub, color: this.banner.color } : null,
      scores: { ...this.scores },
      ffaScores: { ...this.ffaScores },
      crown: this.crown ? { x: Math.round(this.crown.x), y: Math.round(this.crown.y), holderId: this.crown.holderId } : null,
      crownScores: this.crown ? Object.fromEntries(Object.entries(this.crownScores).map(([k, v]) => [k, Math.round(v)])) : null,
      breakables: this.breakables.map(br => ({ id: br.id, x: br.x, y: br.y, r: br.r, hp: Math.round(br.hp), maxHp: br.maxHp })),
      kraken: this.kraken ? {
        id: this.kraken.id,
        x: Math.round(this.kraken.x),
        y: Math.round(this.kraken.y),
        r: this.kraken.r,
        hp: Math.round(this.kraken.hp),
        maxHp: this.kraken.maxHp,
        warn: this.kraken.warnTimer > 0,
        warnPct: this.kraken.warnTimer > 0 ? Number((1 - this.kraken.warnTimer / 0.85).toFixed(2)) : 0,
        slamR: this.kraken.slamR
      } : null,
      lighthouse: this.currentMap.lighthouse ? {
        x: this.currentMap.lighthouse.x,
        y: this.currentMap.lighthouse.y,
        range: this.currentMap.lighthouse.range,
        halfAngle: this.currentMap.lighthouse.halfAngle,
        angle: Number(this.lighthouseAngle.toFixed(2))
      } : null,
      phaseTimer: Number(this.phaseTimer.toFixed(1)),
      roundWinnerRole: this.roundWinnerRole,
      roundWinnerTeam: this.roundWinnerTeam,
      roundWinnerName: this.roundWinnerName,
      roundReason: this.roundReason,
      matchWinnerTeam: this.matchWinnerTeam,
      matchWinnerName: this.matchWinnerName,
      matchStats: this.phase === 'match_end' ? Object.values(this.matchStats) : undefined,
      players: this.players.map(p => ({
        id: p.id,
        slotIdx: p.slotIdx,
        name: p.name,
        team: p.team,
        role: p.role,
        isBot: p.isBot,
        charId: p.charId,
        skinId: p.skinId || 'auto',
        x: Math.round(p.x),
        y: Math.round(p.y),
        vx: Math.round(p.vx),
        vy: Math.round(p.vy),
        aim: Number(p.aim.toFixed(2)),
        hp: Math.round(p.hp),
        maxHp: p.maxHp,
        lives: p.lives ?? 1,
        maxLives: p.maxLives ?? 1,
        respawnTimer: Number((p.respawnTimer || 0).toFixed(1)),
        breath: Math.round(p.breath || 0),
        maxBreath: p.maxBreath || 70,
        breathRegen: p.breathRegenDelay <= 0 && p.breath < p.maxBreath,
        shield: Math.round(p.shield || 0),
        alive: p.alive,
        sinkingAnim: Number(p.sinkingAnim.toFixed(2)),
        items: p.items.map(it => ({
          id: it.id,
          usesLeft: it.usesLeft,
          maxUses: it.maxUses,
          firearm: it.firearm,
          longCd: Boolean(it.longCd),
          cd: Number(it.cd.toFixed(1)),
          maxCd: it.longCd ? 30 : (ALL_ITEMS[it.id]?.cooldown || 1)
        })),
        spaceCd: Number(p.spaceCd.toFixed(1)),
        spaceMaxCd: (p.role === 'hunter' || p.role === 'ffa') ? 2.3 : 4.4,
        submerged: p.submerged,
        diveTime: Number(p.diveTime.toFixed(1)),
        diveCd: Number(p.diveCd.toFixed(1)),
        emote: p.emote || null,
        emoteTimer: p.emote ? Number(p.emoteTimer.toFixed(2)) : 0,
        mirrorTimer: Number((p.mirrorTimer || 0).toFixed(1)),
        ramActive: p.ramActive > 0,
        speedBoost: p.speedBoost > 0,
        speedBoostSec: Number(p.speedBoost.toFixed(1)),
        slowTimer: p.slowTimer > 0,
        slowSec: Number(p.slowTimer.toFixed(1)),
        rootTimer: p.rootTimer > 0,
        rootSec: Number(p.rootTimer.toFixed(1)),
        stunTimer: p.stunTimer > 0,
        stunSec: Number(p.stunTimer.toFixed(1)),
        blindTimer: Number(p.blindTimer.toFixed(2)),
        revealTimer: p.revealTimer > 0,
        inFog: p.inFog,
        inInk: p.inInk,
        inCurrent: p.inCurrent,
        inShallow: p.inShallow,
        inStorm: p.inStorm,
        bounty: Boolean(p.bounty),
        streak: p.streak || 0,
        hasCrown: Boolean(this.crown && this.crown.holderId === p.id),
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
      powerups: this.powerups.map(pu => ({
        id: pu.id,
        kind: pu.kind,
        x: Math.round(pu.x),
        y: Math.round(pu.y)
      })),
      barrels: this.barrels.map(b => ({
        id: b.id,
        x: Math.round(b.x),
        y: Math.round(b.y),
        vx: Math.round(b.vx),
        vy: Math.round(b.vy),
        hot: b.fuse > 0
      })),
      rescueBuoys: this.rescueBuoys.map(rb => ({
        id: rb.id,
        name: rb.name,
        team: rb.team,
        role: rb.role,
        x: Math.round(rb.x),
        y: Math.round(rb.y),
        r: rb.r,
        pct: Number(clamp(rb.progress / rb.duration, 0, 1).toFixed(2)),
        life: Math.ceil(rb.life)
      })),
      storm: this.storm.active ? {
        active: true,
        cx: Math.round(this.storm.cx),
        cy: Math.round(this.storm.cy),
        r: Math.round(this.storm.r)
      } : { active: false },
      floatTexts: this.floatTexts.map(ft => ({
        id: ft.id,
        x: Math.round(ft.x),
        y: Math.round(ft.y),
        text: ft.text,
        color: ft.color,
        alpha: Number(clamp(ft.life / ft.maxLife, 0, 1).toFixed(2))
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
