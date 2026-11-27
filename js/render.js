// DERİN AV — Stylized Top-Down Ocean & Maritime Combat Renderer

import { WORLD_W, WORLD_H, CHAR_MAP, ALL_ITEMS, POWERUP_MAP, BOAT_SKIN_MAP, SEA_MAPS } from './data.js?v=9.0';
import { hasLineOfSight } from './sim.js?v=9.0';

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

export class SeaRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camX = WORLD_W / 2;
    this.camY = WORLD_H / 2;
    this.time = 0;
    this.wakes = []; // visual foam trails
    this.bubbles = []; // visual bubbles for sinking players
    this.particles = []; // 💥 Game Juice: ateş kıvılcımı, tahta kıymığı, köpük & elektrik parçacıkları (maks 140)
    this.hitFlash = new Map(); // id -> flash timer (beyaz vuruş parlaması)
    this.prevHpTotal = new Map(); // id -> önceki (hp + breath + shield)
    this.prevBreakables = new Map(); // id -> { x, y }
    this.seenPulses = new Set();
    this.seenSinks = new Set();
    this.lastRoundSeen = -1;
    this.shake = 0;
    this.homeActors = null; // 🌊 Ana menü canlı arka plan aktörleri
    this.smoothPos = new Map(); // id -> { x, y, aim }
    this.smoothProj = new Map(); // id -> { x, y }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (this.canvas.width !== Math.floor(w * dpr) || this.canvas.height !== Math.floor(h * dpr)) {
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
    }
    this.dpr = dpr;
    this.viewW = w;
    this.viewH = h;
  }

  triggerShake(amount = 8) {
    this.shake = Math.max(this.shake, amount);
  }

  screenToWorld(sx, sy) {
    return {
      x: this.camX - this.viewW / 2 + sx,
      y: this.camY - this.viewH / 2 + sy
    };
  }

  renderHomeBg(canvas, dt) {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    this.time += dt;
    const t = this.time;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // 1. Slow sweeping lighthouse glow from upper-left sea horizon
    const lhAngle = -0.15 + Math.sin(t * 0.35) * 0.48;
    const lhG = ctx.createRadialGradient(0, 0, 20, 0, 0, Math.max(w, h) * 0.72);
    lhG.addColorStop(0, 'rgba(255, 224, 130, 0.14)');
    lhG.addColorStop(0.45, 'rgba(56, 189, 248, 0.05)');
    lhG.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = lhG;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, Math.max(w, h) * 0.72, lhAngle - 0.16, lhAngle + 0.16);
    ctx.closePath();
    ctx.fill();

    // 2. Gentle rolling ocean wave crests
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.08)';
    ctx.lineWidth = 2;
    const cols = Math.ceil(w / 140) + 2;
    const rows = Math.ceil(h / 92) + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = ((c * 140 + r * 52 + t * 18) % (w + 160)) - 80;
        const wy = r * 92 + 30 + Math.sin(t * 1.1 + c + r) * 8;
        ctx.beginPath();
        ctx.moveTo(wx - 22, wy);
        ctx.quadraticCurveTo(wx, wy - 6, wx + 22, wy);
        ctx.stroke();
      }
    }

    // 3. Ambient animated sea characters patrolling the deep margins!
    if (!this.homeActors) {
      this.homeActors = [
        { charId: 'kopekbaligi', color: '#38bdf8', role: 'hunter', rx: 0.14, ry: 0.28, dir: 1, spd: 52, ampY: 22, scale: 1.25, seed: 0.4, wakes: [] },
        { charId: 'ahtapot', color: '#f472b6', role: 'prey', rx: 0.86, ry: 0.72, dir: -1, spd: 38, ampY: 26, scale: 1.22, seed: 2.1, wakes: [] },
        { charId: 'kaptan', color: '#ffb703', role: 'hunter', rx: 0.82, ry: 0.22, dir: -1, spd: 32, ampY: 14, scale: 1.18, seed: 3.7, wakes: [] },
        { charId: 'hayalet', color: '#a855f7', role: 'prey', rx: 0.16, ry: 0.78, dir: 1, spd: 40, ampY: 18, scale: 1.18, seed: 5.2, wakes: [] }
      ];
    }

    for (const a of this.homeActors) {
      a.rx += (a.dir * a.spd * dt) / Math.max(w, 600);
      if (a.rx > 1.12) a.rx = -0.12;
      if (a.rx < -0.12) a.rx = 1.12;
      const px = a.rx * w;
      const py = a.ry * h + Math.sin(t * 0.9 + a.seed) * a.ampY;
      const dy = Math.cos(t * 0.9 + a.seed) * a.ampY * 0.9;
      const aim = Math.atan2(dy, a.dir * a.spd);

      // Soft ambient wake bubbles
      if (Math.random() < dt * 10) {
        a.wakes.push({ x: px - Math.cos(aim) * 20, y: py - Math.sin(aim) * 20, r: 4, life: 1.1, maxLife: 1.1 });
        if (a.wakes.length > 18) a.wakes.shift();
      }
      for (let i = a.wakes.length - 1; i >= 0; i--) {
        const wk = a.wakes[i];
        wk.life -= dt;
        wk.r += dt * 12;
        if (wk.life <= 0) { a.wakes.splice(i, 1); continue; }
        ctx.strokeStyle = `rgba(186, 230, 253, ${(wk.life / wk.maxLife) * 0.14})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(wk.x, wk.y, wk.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.save();
      ctx.globalAlpha = 0.36;
      ctx.translate(px, py);
      ctx.scale(a.scale, a.scale);
      ctx.rotate(aim);
      const ch = CHAR_MAP[a.charId] || { color: a.color };
      this._drawCharacterBody(
        ctx,
        { charId: a.charId, isMe: false, submerged: false, slotIdx: Math.round(a.seed) },
        ch,
        a.color,
        a.role === 'hunter' ? '#ffb703' : '#06d6a0',
        a.spd * 2,
        a.seed
      );
      ctx.restore();
    }

    ctx.restore();
  }

  render(state, myId, dt, localAim, localPred, touchJoy = null) {
    this.resize();
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 28);

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    const map = SEA_MAPS[(state.mapIndex || 0) % SEA_MAPS.length];
    const players = state.players || [];

    // Smooth velocity-assisted interpolation for remote players, instant CSP for local client!
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
        // Dead-reckoning + smooth error correction (lag hissini sıfırlar!)
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

      // Spawn foam wakes behind moving alive boats (su altındayken köpük değil hava kabarcığı çıkar!)
      if (p.alive) {
        const spd = Math.hypot(p.vx || 0, p.vy || 0);
        if (p.submerged) {
          if (Math.random() < dt * (spd > 30 ? 14 : 6)) {
            this.bubbles.push({
              x: sp.x + (Math.random() - 0.5) * 18,
              y: sp.y + (Math.random() - 0.5) * 18,
              r: 2.5 + Math.random() * 3.5,
              life: 0.65,
              maxLife: 0.65,
              subId: p.id,
              subTeam: p.team
            });
          }
        } else if (spd > 40 && Math.random() < dt * 26) {
          const skin = BOAT_SKIN_MAP[p.skinId] || BOAT_SKIN_MAP.auto;
          this.wakes.push({
            x: sp.x - Math.cos(sp.aim) * 16 + (Math.random() - 0.5) * 8,
            y: sp.y - Math.sin(sp.aim) * 16 + (Math.random() - 0.5) * 8,
            r: 5 + Math.random() * 5,
            rgb: skin.wake || '210, 245, 255',
            life: 0.75,
            maxLife: 0.75
          });
        }
        // Spawn rising water bubbles when low Buoyancy (<65%)
        const ratio = p.hp / (p.maxHp || 100);
        if (ratio < 0.7 && Math.random() < dt * (1 - ratio) * 18) {
          this.bubbles.push({
            x: sp.x + (Math.random() - 0.5) * 26,
            y: sp.y + (Math.random() - 0.5) * 26,
            r: 2 + Math.random() * 4,
            life: 0.7,
            maxLife: 0.7
          });
        }
      }
    }

    // 💥 Game Juice event detection & particle physics
    this._stepJuice(state, myId, dt);

    // Update trails
    for (let i = this.wakes.length - 1; i >= 0; i--) {
      const w = this.wakes[i];
      w.life -= dt;
      w.r += dt * 16;
      if (w.life <= 0) this.wakes.splice(i, 1);
    }
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.life -= dt;
      b.y -= dt * 18;
      if (b.life <= 0) this.bubbles.splice(i, 1);
    }

    // Camera follows local player (or surviving teammate if sunk)
    let me = players.find(p => p.id === myId) || players[0];
    let camTarget = me;
    if (me && !me.alive) {
      const aliveAlly = players.find(p => p.team === me.team && p.alive);
      if (aliveAlly) camTarget = aliveAlly;
    }
    if (camTarget) {
      const sp = this.smoothPos.get(camTarget.id) || camTarget;
      const desiredX = Math.max(this.viewW / 2 - 40, Math.min(WORLD_W - this.viewW / 2 + 40, sp.x));
      const desiredY = Math.max(this.viewH / 2 - 40, Math.min(WORLD_H - this.viewH / 2 + 40, sp.y));
      // If screen is larger than world, center world
      const tx = this.viewW >= WORLD_W ? WORLD_W / 2 : desiredX;
      const ty = this.viewH >= WORLD_H ? WORLD_H / 2 : desiredY;
      this.camX += (tx - this.camX) * Math.min(1, dt * 8);
      this.camY += (ty - this.camY) * Math.min(1, dt * 8);
    }

    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;

    // Background deep abyss
    ctx.fillStyle = '#030d17';
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    ctx.save();
    ctx.translate(
      Math.round(this.viewW / 2 - this.camX + shakeX),
      Math.round(this.viewH / 2 - this.camY + shakeY)
    );

    this._drawOcean(ctx, map);
    this._drawBeach(ctx, map);
    this._drawCurrents(ctx, map);
    this._drawWakes(ctx);
    this._drawPulses(ctx, state.pulses || [], me);
    this._drawTraps(ctx, state.traps || [], me);
    this._drawPowerups(ctx, state.powerups || []);
    this._drawBarrels(ctx, state.barrels || []);
    this._drawRescueBuoys(ctx, state.rescueBuoys || [], me);
    this._drawRocksAndShips(ctx, map);
    this._drawBreakables(ctx, state.breakables || []);
    this._drawKraken(ctx, state.kraken);
    this._drawEdgeTentacles(ctx, state.edgeTentacles || []);
    this._drawTsunami(ctx, state.tsunami);
    this._drawCrown(ctx, state.crown);
    this._drawMegaChest(ctx, state.megaChest);
    this._drawPings(ctx, state.pings || [], me);
    this._drawSinkEffects(ctx, state.sinkEffects || []);
    this._drawDecoys(ctx, state.decoys || [], me, map);
    this._drawPlayers(ctx, players, me, map, state.roundEvent);
    this._drawProjectiles(ctx, state.projectiles || [], dt);
    this._drawMeleeSwings(ctx, state.meleeSwings || []);
    this._drawZones(ctx, state.zones || []);
    this._drawFogs(ctx, map, me);
    this._drawLighthouse(ctx, state.lighthouse);
    this._drawStorm(ctx, state.storm);
    this._drawBubbles(ctx, me);
    this._drawParticles(ctx);
    this._drawFloatTexts(ctx, state.floatTexts || []);

    // Subtle sea border buoys
    ctx.strokeStyle = 'rgba(255, 183, 3, 0.35)';
    ctx.lineWidth = 4;
    ctx.setLineDash([18, 14]);
    ctx.strokeRect(8, 8, WORLD_W - 16, WORLD_H - 16);
    ctx.setLineDash([]);

    ctx.restore();

    // Vision vignette centered on viewer
    if (me && me.alive) {
      const sp = this.smoothPos.get(me.id) || me;
      const vx = sp.x - this.camX + this.viewW / 2;
      const vy = sp.y - this.camY + this.viewH / 2;
      const ch = CHAR_MAP[me.charId];
      const visMult = state.roundEvent === 'gece_sisi' ? 0.7 : 1.0;
      const visR = (ch?.vision || 390) * visMult * 1.15;
      const grad = ctx.createRadialGradient(vx, vy, visR * 0.52, vx, vy, visR * 1.32);
      grad.addColorStop(0, 'rgba(3, 12, 22, 0)');
      grad.addColorStop(1, state.roundEvent === 'gece_sisi' ? 'rgba(1, 6, 14, 0.82)' : 'rgba(2, 10, 18, 0.56)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.viewW, this.viewH);

      // Flashbang blind overlay!
      if (me.blindTimer > 0) {
        const a = Math.min(0.92, me.blindTimer * 0.75);
        ctx.fillStyle = `rgba(240, 250, 255, ${a})`;
        ctx.fillRect(0, 0, this.viewW, this.viewH);
      }

      // 🤿 Su altı dalış ekran atmosferi!
      if (me.submerged) {
        ctx.fillStyle = 'rgba(3, 38, 66, 0.36)';
        ctx.fillRect(0, 0, this.viewW, this.viewH);
        const uwGrad = ctx.createRadialGradient(
          this.viewW / 2, this.viewH / 2, Math.min(this.viewW, this.viewH) * 0.22,
          this.viewW / 2, this.viewH / 2, Math.max(this.viewW, this.viewH) * 0.68
        );
        uwGrad.addColorStop(0, 'rgba(0,0,0,0)');
        uwGrad.addColorStop(1, 'rgba(2, 24, 48, 0.62)');
        ctx.fillStyle = uwGrad;
        ctx.fillRect(0, 0, this.viewW, this.viewH);

        ctx.textAlign = 'center';
        const isNarrow = this.viewW < 640;
        ctx.font = isNarrow ? '900 12px system-ui, sans-serif' : '900 15px system-ui, sans-serif';
        const warnY = isNarrow ? 82 : 118;
        if (me.diveTime >= 1.0) {
          ctx.fillStyle = '#ffd166';
          ctx.fillText(isNarrow ? '🦈 SÜRPRİZ ÇIKIŞ HAZIR! Dalış butonuna bas!' : '🦈 SÜRPRİZ ÇIKIŞ HAZIR! Düşmanın dibinde [SHIFT / E] bas!', this.viewW / 2, warnY);
        } else {
          ctx.fillStyle = '#7dd3fc';
          ctx.fillText(isNarrow ? '🤿 SU ALTINDASIN — Gizleniyorsun' : '🤿 SU ALTINDASIN — Gizleniyorsun (Çıkış: SHIFT / E)', this.viewW / 2, warnY);
        }
      }

      // Low buoyancy / sinking / storm danger edge pulse
      if (me.hp / me.maxHp < 0.38 || me.inStorm) {
        const pulse = 0.16 + 0.12 * Math.sin(this.time * 8);
        const dg = ctx.createRadialGradient(
          this.viewW / 2, this.viewH / 2, Math.min(this.viewW, this.viewH) * 0.25,
          this.viewW / 2, this.viewH / 2, Math.max(this.viewW, this.viewH) * 0.65
        );
        dg.addColorStop(0, 'rgba(0,0,0,0)');
        dg.addColorStop(1, me.inStorm
          ? `rgba(239, 71, 111, ${pulse + 0.26})`
          : `rgba(14, 165, 233, ${pulse + 0.18})`);
        ctx.fillStyle = dg;
        ctx.fillRect(0, 0, this.viewW, this.viewH);

        if (me.inStorm) {
          const isNarrow = this.viewW < 640;
          ctx.fillStyle = '#ff8fa3';
          ctx.font = isNarrow ? '900 12.5px system-ui, sans-serif' : '900 16px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('🌪️ FIRTINA DIŞINDASIN! ÇEMBERE GİR!', this.viewW / 2, isNarrow ? 100 : 118);
        }
      }
    }

    // Minimap (sağ üst)
    this._drawMinimap(ctx, state, map, me);

    // 🎬 Son Vuruş Ağır Çekim sinematik çerçeve!
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

    // 📱 Mobil sanal kumanda göstergesi (sadece dokunulurken görünür)
    if (touchJoy) {
      this._drawTouchJoy(ctx, touchJoy);
    }

    ctx.restore();
  }

  _drawTouchJoy(ctx, joy) {
    ctx.save();
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.42)';
    ctx.fillStyle = 'rgba(4, 18, 34, 0.34)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(joy.bx, joy.by, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(56, 189, 248, 0.72)';
    ctx.strokeStyle = 'rgba(224, 242, 254, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(joy.cx, joy.cy, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  _drawOcean(ctx, map) {
    const grad = ctx.createRadialGradient(WORLD_W / 2, WORLD_H / 2, 120, WORLD_W / 2, WORLD_H / 2, 1100);
    grad.addColorStop(0, map.theme.mid);
    grad.addColorStop(1, map.theme.deep);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    // Subtle nautical grid lines
    ctx.strokeStyle = 'rgba(130, 210, 255, 0.045)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD_W; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD_H);
      ctx.stroke();
    }
    for (let y = 0; y <= WORLD_H; y += 100) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD_W, y);
      ctx.stroke();
    }

    // Animated rolling wave crests
    ctx.strokeStyle = map.theme.foam;
    ctx.lineWidth = 2;
    const t = this.time;
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 14; col++) {
        const wx = ((col * 130 + row * 47 + t * 22) % (WORLD_W + 120)) - 60;
        const wy = row * 86 + 35 + Math.sin(t * 1.4 + col + row) * 9;
        ctx.beginPath();
        ctx.moveTo(wx - 22, wy);
        ctx.quadraticCurveTo(wx, wy - 7, wx + 22, wy);
        ctx.stroke();
      }
    }
  }

  _drawBeach(ctx, map) {
    const b = map.beach;
    if (!b) return;
    const t = this.time;
    ctx.save();

    // 1. Sığ turkuaz lagün şeridi (sandY -> shallowY)
    const lag = ctx.createLinearGradient(0, b.sandY, 0, b.shallowY);
    lag.addColorStop(0, 'rgba(56, 217, 210, 0.52)');
    lag.addColorStop(0.7, 'rgba(34, 184, 207, 0.25)');
    lag.addColorStop(1, 'rgba(13, 74, 102, 0)');
    ctx.fillStyle = lag;
    ctx.fillRect(0, b.sandY, WORLD_W, b.shallowY - b.sandY);

    // Sığ su sınır çizgisi (dalış yasağı göstergesi)
    ctx.strokeStyle = 'rgba(125, 249, 255, 0.34)';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(0, b.shallowY);
    ctx.lineTo(WORLD_W, b.shallowY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(186, 245, 255, 0.55)';
    ctx.font = '800 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🏖️ SIĞ SU ŞERİDİ — DALIŞ YAPILAMAZ', WORLD_W / 2, b.shallowY - 8);

    // 2. Kıyıya vuran hareketli beyaz köpük dalgaları
    const surfShift = Math.sin(t * 2.2) * 7;
    ctx.strokeStyle = 'rgba(235, 252, 255, 0.65)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let x = 0; x <= WORLD_W; x += 40) {
      const y = b.sandY + 8 + surfShift + Math.sin(x * 0.015 + t * 2.5) * 4;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 3. Altın sarısı kumsal (0 -> sandY)
    const sandGrad = ctx.createLinearGradient(0, 0, 0, b.sandY + 8);
    sandGrad.addColorStop(0, '#c89b55');
    sandGrad.addColorStop(0.75, '#e2be79');
    sandGrad.addColorStop(1, '#b88c48');
    ctx.fillStyle = sandGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(WORLD_W, 0);
    ctx.lineTo(WORLD_W, b.sandY);
    for (let x = WORLD_W; x >= 0; x -= 40) {
      const y = b.sandY + Math.sin(x * 0.012) * 5;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    // 4. Renkli plaj şemsiyeleri
    for (const u of b.umbrellas || []) {
      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.arc(4, 5, 18, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = u.color;
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * 18, Math.sin(a) * 18);
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 5. Sallanan tropikal palmiye ağaçları
    for (const pm of b.palms || []) {
      ctx.save();
      ctx.translate(pm.x, pm.y);
      const sway = Math.sin(t * 1.6 + pm.x) * 0.08;
      ctx.rotate(sway);
      // Gölge
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.beginPath();
      ctx.arc(7, 8, pm.r * 0.85, 0, Math.PI * 2);
      ctx.fill();
      // Yapraklar
      for (let i = 0; i < 7; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI * 2) / 7);
        ctx.fillStyle = i % 2 === 0 ? '#15803d' : '#22c55e';
        ctx.beginPath();
        ctx.ellipse(pm.r * 0.55, 0, pm.r * 0.55, pm.r * 0.19, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // Gövde merkezi
      ctx.fillStyle = '#78350f';
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  _drawCurrents(ctx, map) {
    const t = this.time;
    for (const cur of map.currents || []) {
      ctx.save();
      // Rounded glowing sea stream channel
      ctx.beginPath();
      ctx.roundRect(cur.x, cur.y, cur.w, cur.h, 24);
      ctx.fillStyle = 'rgba(14, 165, 233, 0.16)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(103, 232, 249, 0.35)';
      ctx.lineWidth = 2;
      ctx.setLineDash([12, 10]);
      ctx.lineDashOffset = -t * 55;
      ctx.stroke();
      ctx.setLineDash([]);

      // Clip interior for animated flowing chevrons
      ctx.clip();
      const horizontal = Math.abs(cur.dirX) >= Math.abs(cur.dirY);
      const spacing = 54;
      const offset = (t * 95) % spacing;

      ctx.strokeStyle = 'rgba(165, 243, 252, 0.55)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (horizontal) {
        const cy = cur.y + cur.h / 2;
        const dir = cur.dirX >= 0 ? 1 : -1;
        const start = dir > 0 ? cur.x - spacing + offset : cur.x + cur.w + spacing - offset;
        const count = Math.ceil(cur.w / spacing) + 3;
        for (let i = 0; i < count; i++) {
          const cx = start + i * spacing * dir;
          ctx.beginPath();
          ctx.moveTo(cx - 10 * dir, cy - 12);
          ctx.lineTo(cx + 6 * dir, cy);
          ctx.lineTo(cx - 10 * dir, cy + 12);
          ctx.stroke();
        }
      } else {
        const cx = cur.x + cur.w / 2;
        const dir = cur.dirY >= 0 ? 1 : -1;
        const start = dir > 0 ? cur.y - spacing + offset : cur.y + cur.h + spacing - offset;
        const count = Math.ceil(cur.h / spacing) + 3;
        for (let i = 0; i < count; i++) {
          const cy = start + i * spacing * dir;
          ctx.beginPath();
          ctx.moveTo(cx - 12, cy - 10 * dir);
          ctx.lineTo(cx, cy + 6 * dir);
          ctx.lineTo(cx + 12, cy - 10 * dir);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  _drawWakes(ctx) {
    for (const w of this.wakes) {
      const a = Math.max(0, w.life / w.maxLife) * 0.34;
      ctx.strokeStyle = `rgba(${w.rgb || '210, 245, 255'}, ${a})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _drawBubbles(ctx, me) {
    const myPos = me ? (this.smoothPos.get(me.id) || me) : null;
    for (const b of this.bubbles) {
      // Düşman su altı kabarcıkları sadece 150px yakından fark edilir!
      if (b.subTeam && me && me.alive && b.subTeam !== me.team && myPos) {
        if (dist(myPos.x, myPos.y, b.x, b.y) > 150) continue;
      }
      const a = Math.max(0, b.life / b.maxLife) * 0.72;
      ctx.strokeStyle = `rgba(200, 244, 255, ${a})`;
      ctx.fillStyle = `rgba(180, 235, 255, ${a * 0.35})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  _drawPulses(ctx, pulses, me) {
    for (const pu of pulses) {
      ctx.save();
      if (pu.kind === 'sonar') {
        ctx.strokeStyle = `rgba(255, 196, 61, ${pu.alpha * 0.75})`;
        ctx.lineWidth = 3.5;
      } else if (pu.kind === 'sound') {
        ctx.strokeStyle = `rgba(255, 107, 107, ${pu.alpha * 0.65})`;
        ctx.lineWidth = 2.5;
      } else if (pu.kind === 'flash') {
        ctx.fillStyle = `rgba(255, 253, 220, ${pu.alpha * 0.45})`;
        ctx.beginPath();
        ctx.arc(pu.x, pu.y, pu.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 240, 150, ${pu.alpha * 0.85})`;
        ctx.lineWidth = 3;
      } else if (pu.kind === 'muzzle') {
        ctx.fillStyle = `rgba(255, 232, 120, ${pu.alpha * 0.65})`;
        ctx.beginPath();
        ctx.arc(pu.x, pu.y, pu.r * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 160, 40, ${pu.alpha * 0.9})`;
        ctx.lineWidth = 3;
      } else if (pu.kind === 'boom') {
        ctx.fillStyle = `rgba(255, 107, 53, ${pu.alpha * 0.42})`;
        ctx.beginPath();
        ctx.arc(pu.x, pu.y, pu.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 209, 102, ${pu.alpha * 0.95})`;
        ctx.lineWidth = 4;
      } else if (pu.kind === 'heal') {
        ctx.strokeStyle = `rgba(6, 214, 160, ${pu.alpha * 0.85})`;
        ctx.lineWidth = 3;
      } else if (pu.kind === 'wake') {
        if (me && pu.team === me.team) {
          ctx.restore();
          continue;
        }
        ctx.strokeStyle = `rgba(160, 225, 255, ${pu.alpha * 0.32})`;
        ctx.lineWidth = 1.8;
      } else {
        ctx.strokeStyle = `rgba(186, 230, 253, ${pu.alpha * 0.6})`;
        ctx.lineWidth = 2.5;
      }
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, pu.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawTraps(ctx, traps, me) {
    for (const tr of traps) {
      const isAlly = me && tr.team === me.team;
      if (!isAlly) {
        // Enemy traps are only faintly visible if very close
        if (!me) continue;
        const sp = this.smoothPos.get(me.id) || me;
        if (dist(sp.x, sp.y, tr.x, tr.y) > 135) continue;
      }
      ctx.save();
      ctx.translate(tr.x, tr.y);
      ctx.globalAlpha = isAlly ? 0.9 : 0.4;
      ctx.strokeStyle = tr.kind === 'anchor' ? '#ffb703' : '#ef476f';
      ctx.fillStyle = tr.kind === 'anchor' ? 'rgba(255,183,3,0.14)' : 'rgba(239,71,111,0.14)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, tr.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tr.kind === 'anchor' ? '⚓' : '💣', 0, 1);
      ctx.restore();
    }
  }

  _drawRocksAndShips(ctx, map) {
    const wavePulse = Math.sin(this.time * 2.2) * 3;
    for (const obs of map.rocks) {
      if (obs.type === 'rock') {
        if (obs.lava) {
          // 🌋 Volkanik lav parıltılı bazalt kayalık
          ctx.fillStyle = 'rgba(255, 90, 40, 0.22)';
          ctx.beginPath();
          ctx.arc(obs.x, obs.y, obs.r + 15 + wavePulse, 0, Math.PI * 2);
          ctx.fill();

          const rg = ctx.createRadialGradient(obs.x - obs.r * 0.2, obs.y - obs.r * 0.2, 5, obs.x, obs.y, obs.r);
          rg.addColorStop(0, '#44262b');
          rg.addColorStop(0.65, '#261419');
          rg.addColorStop(1, '#12080b');
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.arc(obs.x, obs.y, obs.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 110, 50, 0.72)';
          ctx.lineWidth = 2.8;
          ctx.stroke();
        } else {
          // Shallow reef glow & breaking foam
          ctx.fillStyle = 'rgba(38, 165, 190, 0.18)';
          ctx.beginPath();
          ctx.arc(obs.x, obs.y, obs.r + 16 + wavePulse, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = 'rgba(205, 244, 255, 0.32)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(obs.x, obs.y, obs.r + 5 + wavePulse * 0.5, 0, Math.PI * 2);
          ctx.stroke();

          // Sea rock body
          const rg = ctx.createRadialGradient(obs.x - obs.r * 0.25, obs.y - obs.r * 0.25, 6, obs.x, obs.y, obs.r);
          rg.addColorStop(0, '#4a6070');
          rg.addColorStop(0.65, '#2b3d4a');
          rg.addColorStop(1, '#18242e');
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.arc(obs.x, obs.y, obs.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      } else if (obs.type === 'pier') {
        // 🏝️ Ahşap plaj iskelesi
        ctx.save();
        ctx.fillStyle = 'rgba(0, 18, 30, 0.35)';
        ctx.fillRect(obs.x + 5, obs.y + 5, obs.w, obs.h);
        ctx.fillStyle = '#7c4d2b';
        ctx.strokeStyle = '#3b2110';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(obs.x, obs.y, obs.w, obs.h, 6);
        ctx.fill();
        ctx.stroke();
        // Yatay tahta çizgileri
        ctx.strokeStyle = 'rgba(255, 224, 178, 0.22)';
        ctx.lineWidth = 1.5;
        for (let py = obs.y + 12; py < obs.y + obs.h - 6; py += 14) {
          ctx.beginPath();
          ctx.moveTo(obs.x + 4, py);
          ctx.lineTo(obs.x + obs.w - 4, py);
          ctx.stroke();
        }
        // İskele direkleri
        ctx.fillStyle = '#4a2a14';
        for (let py = obs.y + 18; py <= obs.y + obs.h - 10; py += 46) {
          ctx.beginPath(); ctx.arc(obs.x + 4, py, 4, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(obs.x + obs.w - 4, py, 4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      } else {
        // Shipwreck hull
        ctx.save();
        ctx.fillStyle = 'rgba(32, 145, 175, 0.16)';
        ctx.beginPath();
        ctx.roundRect(obs.x - 10, obs.y - 10, obs.w + 20, obs.h + 20, 22);
        ctx.fill();

        ctx.fillStyle = '#3b281c';
        ctx.strokeStyle = '#1c120c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(obs.x, obs.y, obs.w, obs.h, 16);
        ctx.fill();
        ctx.stroke();

        // Deck planks
        ctx.strokeStyle = 'rgba(255, 220, 180, 0.12)';
        ctx.lineWidth = 1.5;
        for (let px = obs.x + 16; px < obs.x + obs.w - 8; px += 18) {
          ctx.beginPath();
          ctx.moveTo(px, obs.y + 6);
          ctx.lineTo(px, obs.y + obs.h - 6);
          ctx.stroke();
        }
        // Broken mast circle
        ctx.fillStyle = '#5c3d28';
        ctx.beginPath();
        ctx.arc(obs.x + obs.w / 2, obs.y + obs.h / 2, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  _drawZones(ctx, zones) {
    for (const z of zones) {
      const fade = Math.min(1, z.life / 1.2);
      if (z.kind === 'ink') {
        const g = ctx.createRadialGradient(z.x, z.y, 12, z.x, z.y, z.r);
        g.addColorStop(0, `rgba(6, 10, 24, ${0.92 * fade})`);
        g.addColorStop(0.7, `rgba(18, 12, 42, ${0.78 * fade})`);
        g.addColorStop(1, 'rgba(18, 12, 42, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
        ctx.fill();
      } else if (z.kind === 'gravity') {
        ctx.save();
        ctx.translate(z.x, z.y);
        const g = ctx.createRadialGradient(0, 0, 8, 0, 0, z.r);
        g.addColorStop(0, `rgba(124, 58, 237, ${0.42 * fade})`);
        g.addColorStop(0.65, `rgba(56, 189, 248, ${0.18 * fade})`);
        g.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, z.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.rotate(-this.time * 4.5);
        ctx.strokeStyle = `rgba(192, 132, 252, ${0.75 * fade})`;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([12, 10]);
        ctx.beginPath();
        ctx.arc(0, 0, z.r * 0.72, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      } else if (z.kind === 'kelp') {
        ctx.fillStyle = `rgba(16, 185, 129, ${0.28 * fade})`;
        ctx.strokeStyle = `rgba(52, 211, 153, ${0.48 * fade})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (z.kind === 'geyser_warn') {
        const prog = 1 - Math.max(0, z.life / (z.maxLife || 1.6));
        ctx.save();
        ctx.translate(z.x, z.y);
        ctx.fillStyle = `rgba(239, 68, 68, ${0.14 + prog * 0.28})`;
        ctx.beginPath();
        ctx.arc(0, 0, z.r, 0, Math.PI * 2);
        ctx.fill();
        // Expanding inner eruption countdown circle
        ctx.fillStyle = `rgba(255, 107, 53, ${0.26 + prog * 0.35})`;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(8, z.r * prog), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ff6b35';
        ctx.lineWidth = 2.6;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.arc(0, 0, z.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '18px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🌋', 0, 0);
        ctx.restore();
      } else if (z.kind === 'flare') {
        const g = ctx.createRadialGradient(z.x, z.y, 6, z.x, z.y, z.r);
        g.addColorStop(0, `rgba(255, 110, 130, ${0.42 * fade})`);
        g.addColorStop(0.5, `rgba(255, 180, 70, ${0.18 * fade})`);
        g.addColorStop(1, 'rgba(255, 180, 70, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#fff1f2';
        ctx.beginPath();
        ctx.arc(z.x, z.y, 6 + Math.sin(this.time * 16) * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _drawFogs(ctx, map, me) {
    const myPos = me ? (this.smoothPos.get(me.id) || me) : null;
    for (const f of map.fogs) {
      const meInside = myPos && dist(myPos.x, myPos.y, f.x, f.y) <= f.r;
      const alpha = meInside ? 0.22 : 0.48;
      const driftX = Math.sin(this.time * 0.6 + f.x) * 6;
      const driftY = Math.cos(this.time * 0.5 + f.y) * 5;
      const g = ctx.createRadialGradient(f.x + driftX, f.y + driftY, 12, f.x + driftX, f.y + driftY, f.r);
      g.addColorStop(0, `rgba(198, 232, 245, ${alpha})`);
      g.addColorStop(0.68, `rgba(148, 198, 220, ${alpha * 0.68})`);
      g.addColorStop(1, 'rgba(148, 198, 220, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x + driftX, f.y + driftY, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _canViewerSee(me, target, map, roundEvent = null) {
    if (!me || !me.alive) return true; // Spectator sees everyone!
    if (me.team === target.team) return true;
    if (me.blindTimer > 0) return false;
    if (target.revealTimer > 0) return true;

    const myPos = this.smoothPos.get(me.id) || me;
    const tPos = this.smoothPos.get(target.id) || target;
    const ch = CHAR_MAP[me.charId];
    const tch = CHAR_MAP[target.charId];
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

  _drawDecoys(ctx, decoys, me, map) {
    for (const d of decoys) {
      if (me && me.team !== d.team) {
        const myPos = this.smoothPos.get(me.id) || me;
        if (dist(myPos.x, myPos.y, d.x, d.y) > 420) continue;
        if (!hasLineOfSight(map, myPos.x, myPos.y, d.x, d.y)) continue;
      }
      this._drawVessel(ctx, {
        x: d.x,
        y: d.y,
        aim: d.aim,
        charId: d.charId,
        role: d.role,
        name: me && me.team === d.team ? `${d.name} (Klon)` : d.name,
        hp: 100,
        maxHp: 100,
        isMe: false,
        alpha: me && me.team === d.team ? 0.6 : 0.95
      });
    }
  }

  _drawPlayers(ctx, players, me, map, roundEvent = null) {
    for (const p of players) {
      if (!p.alive) continue;
      if (!this._canViewerSee(me, p, map, roundEvent)) continue;
      const sp = this.smoothPos.get(p.id) || p;
      const isMe = me && p.id === me.id;
      const alpha = p.submerged
        ? 0.42
        : ((p.inFog || p.inInk) && me && p.team === me.team ? 0.62 : 1.0);

      // Aiming indicator for local player (sürpriz çıkış halkası su altındayken görünür!)
      if (isMe) {
        if (p.submerged) {
          ctx.save();
          ctx.translate(sp.x, sp.y);
          ctx.strokeStyle = p.diveTime >= 1.0 ? 'rgba(255, 209, 102, 0.55)' : 'rgba(56, 189, 248, 0.35)';
          ctx.lineWidth = 2;
          ctx.setLineDash([7, 7]);
          ctx.beginPath();
          ctx.arc(0, 0, 70, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        } else {
          this._drawAimGuide(ctx, p, sp);
        }
      }

      this._drawVessel(ctx, {
        ...p,
        x: sp.x,
        y: sp.y,
        aim: sp.aim,
        isMe,
        alpha
      });
    }
  }

  _drawAimGuide(ctx, p, sp) {
    const readyFirearm = p.items?.find(it => it.firearm && it.usesLeft > 0);
    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(sp.aim);

    if (readyFirearm) {
      const def = ALL_ITEMS[readyFirearm.id];
      if (def.pellets) {
        // Shotgun cone guide
        ctx.fillStyle = p.role === 'hunter' ? 'rgba(255, 183, 3, 0.08)' : 'rgba(6, 214, 160, 0.08)';
        ctx.beginPath();
        ctx.moveTo(20, 0);
        ctx.arc(0, 0, Math.min(260, def.range), -def.spread / 2, def.spread / 2);
        ctx.closePath();
        ctx.fill();
      } else {
        // Single-shot laser line
        ctx.strokeStyle = p.role === 'hunter' ? 'rgba(255, 183, 3, 0.34)' : 'rgba(76, 201, 240, 0.34)';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.moveTo(24, 0);
        ctx.lineTo(Math.min(360, def.range * 0.65), 0);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else {
      // Short heading arrow
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(24, 0);
      ctx.lineTo(54, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawVessel(ctx, p) {
    const ch = CHAR_MAP[p.charId] || { color: '#38bdf8', accent: '#bae6fd', icon: '⛵' };
    const ratio = Math.max(0, Math.min(1, p.hp / (p.maxHp || 100)));
    // Submersion scale: lower buoyancy -> sits slightly lower & deeper in water!
    const submergeScale = 0.84 + ratio * 0.18;

    ctx.save();
    ctx.globalAlpha = p.alpha ?? 1;
    ctx.translate(p.x, p.y);

    // Reveal sonar ring
    if (p.revealTimer) {
      ctx.strokeStyle = '#ff4d6d';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 29 + Math.sin(this.time * 10) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Ram active foam aura
    if (p.ramActive) {
      ctx.fillStyle = 'rgba(255, 183, 3, 0.3)';
      ctx.beginPath();
      ctx.arc(0, 0, 32, 0, Math.PI * 2);
      ctx.fill();
    }

    // 🪞 Ayna Kalkanı parlayan yansıtıcı halka!
    if (p.mirrorTimer > 0) {
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = 'rgba(224, 242, 254, 0.25)';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(0, 0, 29 + Math.sin(this.time * 14) * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Shield barrier ring
    if (p.shield > 0) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
      ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, 0, 27 + Math.sin(this.time * 6) * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Water ring around hull (gets thicker as player sinks!)
    ctx.strokeStyle = ratio < 0.45 ? 'rgba(56, 189, 248, 0.75)' : 'rgba(200, 242, 255, 0.28)';
    ctx.lineWidth = ratio < 0.45 ? 3 : 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, 23 + Math.sin(this.time * 5 + p.x) * 1.5, 0, Math.PI * 2);
    ctx.stroke();

    // Character-specific animated 2D silhouette rotated toward aim!
    const skin = BOAT_SKIN_MAP[p.skinId];
    const mainColor = skin?.hull || ch.color;
    const roleColor = p.role === 'hunter' ? '#ffb703' : p.role === 'ffa' ? ch.color : '#06d6a0';
    const spd = Math.hypot(p.vx || 0, p.vy || 0);
    const seed = (p.slotIdx || 0) * 1.7;

    // Subtle team/role ring around base so Hunter (Gold) vs Prey (Emerald) is ALWAYS crystal clear
    ctx.save();
    ctx.strokeStyle = roleColor;
    ctx.globalAlpha = (p.alpha ?? 1) * (p.isMe ? 0.65 : 0.38);
    ctx.lineWidth = p.isMe ? 2.4 : 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, 22.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 💥 Vurulunca ani geri savrulma + ezilme (hit-flash süresine bağlı)
    const hf = this.hitFlash.get(p.id) || 0;
    const knock = Math.min(1, hf / 0.16);
    ctx.save();
    ctx.scale(submergeScale, submergeScale);
    ctx.rotate(p.aim);
    if (knock > 0) {
      ctx.translate(-knock * 6, 0);
      ctx.scale(1 - knock * 0.12, 1 + knock * 0.08);
    }
    if (p.rootTimer && !p.stunTimer) ctx.translate(0, Math.sin(this.time * 38) * 1.3);
    this._drawCharacterBody(ctx, p, ch, mainColor, roleColor, spd, seed);
    ctx.restore();

    // ⭐ Sersemleme yıldızları başın üstünde döner
    if (p.stunTimer && !p.submerged) {
      ctx.save();
      ctx.fillStyle = '#fde047';
      ctx.strokeStyle = '#a16207';
      ctx.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        const a = this.time * 5 + (k / 3) * Math.PI * 2;
        const sx = Math.cos(a) * 13;
        const sy = -20 + Math.sin(a) * 5;
        ctx.beginPath();
        for (let v = 0; v < 8; v++) {
          const r = v % 2 ? 1.6 : 3.8;
          const va = (v / 8) * Math.PI * 2 + this.time * 3;
          ctx.lineTo(sx + Math.cos(va) * r, sy + Math.sin(va) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // 💥 Beyaz Vuruş Parlaması (Hit-Flash!)
    if (hf > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.78, hf * 5.2)})`;
      ctx.beginPath();
      ctx.arc(0, 0, 23, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Status badges (Rooted / Stunned / Slowed) — 3 Kalp varsa kalplerin üstünde çiz (çakışma yok!)
    const badgeY = (p.maxLives || 1) > 1 ? -60 : -40;
    if (p.rootTimer) {
      ctx.fillStyle = '#ffb703';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillText('⚓ ÇAPALANDI', 0, badgeY);
    } else if (p.stunTimer) {
      ctx.fillStyle = '#f43f5e';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillText('⚡ SERSEMLEDİ', 0, badgeY);
    } else if (p.inStorm) {
      ctx.fillStyle = '#ff4d6d';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillText('🌪️ FIRTINA!', 0, badgeY);
    } else if (p.inCurrent) {
      ctx.fillStyle = '#67e8f9';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillText('⚡ AKINTI!', 0, badgeY);
    }

    // 👑 Altın Taç & 💰 Kelle Ödülü parıltı halkaları!
    if (p.hasCrown) {
      ctx.save();
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(0, 0, 31 + Math.sin(this.time * 8) * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (p.bounty) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 183, 3, 0.85)';
      ctx.lineWidth = 2.4;
      ctx.setLineDash([6, 5]);
      ctx.rotate(this.time * 2.2);
      ctx.beginPath();
      ctx.arc(0, 0, 29, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Name & ❤️ Mario Hearts (eğer 1'den fazla kalp seçiliyse!)
    ctx.fillStyle = p.hasCrown ? '#ffd166' : (p.role === 'hunter' ? '#ffd166' : p.role === 'ffa' ? ch.accent : '#80ffdb');
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const prefix = p.hasCrown ? '👑 ' : (p.bounty ? '💰 ' : '');
    ctx.fillText(prefix + (p.name || ''), 0, -28);
    if ((p.maxLives || 1) > 1) {
      const hStr = '❤️'.repeat(Math.max(0, p.lives || 0)) + '🖤'.repeat(Math.max(0, (p.maxLives || 1) - (p.lives || 0)));
      const pillW = Math.max(44, (p.maxLives || 1) * 16 + 10);
      ctx.fillStyle = 'rgba(4, 14, 28, 0.82)';
      ctx.beginPath();
      ctx.roundRect(-pillW / 2, -52, pillW, 18, 8);
      ctx.fill();
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(hStr, 0, -42);
    }

    const bw = 48;
    const bh = 4.5;
    const bRatio = Math.max(0, Math.min(1, (p.breath ?? 0) / (p.maxBreath || 70)));
    // Top mini bar: 🫁 Nefes (cyan-sky)
    ctx.fillStyle = 'rgba(2, 10, 20, 0.85)';
    ctx.fillRect(-bw / 2, 23, bw, 3.5);
    ctx.fillStyle = p.breathRegen ? '#a5f3fc' : '#38bdf8';
    ctx.fillRect(-bw / 2, 23, bw * bRatio, 3.5);

    // Bottom mini bar: 🌊 Batma Direnci (emerald -> amber -> red)
    ctx.fillStyle = 'rgba(2, 10, 20, 0.85)';
    ctx.fillRect(-bw / 2, 27.5, bw, bh);
    ctx.fillStyle = ratio > 0.5 ? '#06d6a0' : ratio > 0.25 ? '#f59e0b' : '#ef4444';
    ctx.fillRect(-bw / 2, 27.5, bw * ratio, bh);

    if (p.shield > 0) {
      const shRatio = Math.min(1, p.shield / (p.maxHp || 120));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-bw / 2, 20, bw * shRatio, 2);
    }

    // 💬 Tekne üstü mini emoji tepki balonu (gizlilik otomatik korunur!)
    if (p.emote && p.emoteTimer > 0) {
      const elapsed = 2.2 - p.emoteTimer;
      const pop = elapsed < 0.16 ? 0.65 + (elapsed / 0.16) * 0.45 : 1.0;
      const alpha = p.emoteTimer < 0.4 ? Math.max(0, p.emoteTimer / 0.4) : 1.0;
      const lift = elapsed * 6;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(0, -56 - lift);
      ctx.scale(pop, pop);

      ctx.fillStyle = 'rgba(6, 22, 40, 0.92)';
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.78)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-19, -18, 38, 32, 11);
      ctx.fill();
      ctx.stroke();

      // Baloncuk ucu
      ctx.fillStyle = 'rgba(6, 22, 40, 0.92)';
      ctx.beginPath();
      ctx.moveTo(-5, 13);
      ctx.lineTo(0, 19);
      ctx.lineTo(5, 13);
      ctx.closePath();
      ctx.fill();

      ctx.font = '20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.emote, 0, -1);
      ctx.restore();
    }

    ctx.restore();
  }

  _drawHandheldItem2D(ctx, itemId, hx, hy) {
    if (!itemId) return;
    ctx.save();
    ctx.translate(hx, hy);
    const def = ALL_ITEMS[itemId];
    if (def?.firearm) {
      // Silah namlusu (Pompalı / Zıpkın / Tabanca / Top)
      ctx.fillStyle = itemId === 'flare_gun' ? '#ef4444' : (itemId === 'blunderbuss' ? '#fbbf24' : '#cbd5e1');
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.4;
      const len = itemId === 'harpoon_cannon' ? 18 : 13;
      const w = itemId === 'blunderbuss' || itemId === 'hand_cannon' ? 5.2 : 3.4;
      ctx.fillRect(-1, -w / 2, len, w);
      ctx.strokeRect(-1, -w / 2, len, w);
      if (itemId === 'harpoon_cannon') {
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(len + 5, 0); ctx.lineTo(len - 1, -3.2); ctx.lineTo(len - 1, 3.2);
        ctx.closePath(); ctx.fill();
      }
    } else if (itemId === 'cutlass') {
      // ⚔️ Korsan Palası: altın kabzalı kavisli çelik pala
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-1, -4.2, 3.2, 8.4);
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.quadraticCurveTo(11, -3.5, 19, -1);
      ctx.stroke();
    } else if (itemId === 'trident') {
      // 🔱 Poseidon Mızrağı: uzun altın-turkuaz üç dişli mızrak
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-4, 0); ctx.lineTo(17, 0);
      ctx.stroke();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      ctx.moveTo(14, -5); ctx.lineTo(22, -4);
      ctx.moveTo(15, 0); ctx.lineTo(24, 0);
      ctx.moveTo(14, 5); ctx.lineTo(22, 4);
      ctx.stroke();
    } else if (itemId === 'heavy_oar') {
      // 🪵 Dev Kürek: kalın ahşap sap + geniş kürek palası
      ctx.strokeStyle = '#92400e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-4, 0); ctx.lineTo(13, 0);
      ctx.stroke();
      ctx.fillStyle = '#b45309';
      ctx.strokeStyle = '#451a03';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.roundRect(11, -4.8, 11, 9.6, 3);
      ctx.fill(); ctx.stroke();
    } else if (itemId === 'coral_dagger') {
      // 🗡️ Dalgıç Hançeri: parlak mercan-turkuaz hançer
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(-1, -3, 3, 6);
      ctx.fillStyle = '#5eead4';
      ctx.beginPath();
      ctx.moveTo(2, -2.5); ctx.lineTo(14, 0); ctx.lineTo(2, 2.5);
      ctx.closePath(); ctx.fill();
    } else if (itemId === 'mirror_shield') {
      ctx.fillStyle = '#e0f2fe';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(4, 0, 3.5, 8, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    } else if (itemId === 'grapple_hook' || itemId === 'anchor_trap') {
      ctx.strokeStyle = itemId === 'grapple_hook' ? '#fbbf24' : '#94a3b8';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(11, 0);
      ctx.moveTo(8, -4.5); ctx.lineTo(12, 0); ctx.lineTo(8, 4.5);
      ctx.stroke();
    } else if (itemId === 'gravity_bomb' || itemId === 'ink_cloud' || itemId === 'sea_mine') {
      ctx.fillStyle = itemId === 'gravity_bomb' ? '#c084fc' : (itemId === 'sea_mine' ? '#e11d48' : '#4c1d95');
      ctx.strokeStyle = '#f5d0fe';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(5, 0, 4.6, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    } else {
      ctx.fillStyle = itemId === 'buoyancy_kit' || itemId === 'kelp_trail' ? '#10b981' : (itemId === 'decoy_buoy' ? '#f97316' : '#38bdf8');
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(0, -3.4, 10, 6.8, 3);
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  _drawCharacterBody(ctx, p, ch, mainColor, roleColor, spd, seed) {
    const t = this.time;
    const strokeW = p.isMe ? 2.6 : 1.9;
    const kickSpd = 6.5 + Math.min(7, spd * 0.035);
    const stroke = Math.sin(t * kickSpd + seed);
    const swimAmp = spd > 35 ? 4.5 : 1.2;
    const skinTone = p.charId === 'hayalet' ? '#a5f3fc' : '#f6c39b';
    const stunned = Boolean(p.stunTimer);
    const rooted = Boolean(p.rootTimer) && !stunned;
    const blind = (p.blindTimer || 0) > 0 && !stunned && !rooted;
    const dashing = !p.submerged && (Boolean(p.ramActive) || spd > 330);
    const riding = p.charId === 'dalgabinici' && !p.submerged && (spd > 170 || p.inCurrent || Boolean(p.ramActive));
    const baseAlpha = ctx.globalAlpha;

    // 🏄 Dalga Binicisi sörf tahtası (gövdenin altında; hızlanınca yalpalar)
    if (p.charId === 'dalgabinici' && !p.submerged) {
      ctx.save();
      if (riding) ctx.rotate(Math.sin(t * 4 + seed) * 0.06);
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(-1, 0, 25, 8.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = mainColor;
      ctx.fillRect(-24, -1.4, 47, 2.8);
      ctx.restore();
    }

    // 👻 Sis Hayaleti arkasında süzülen sis kuyruğu
    if (p.charId === 'hayalet' && !p.submerged) {
      for (let w = 0; w < 4; w++) {
        ctx.fillStyle = `rgba(103, 232, 249, ${0.28 - w * 0.055})`;
        ctx.beginPath();
        ctx.arc(-14 - w * (7 + Math.min(4, spd * 0.012)), Math.sin(t * 3 + w * 1.4 + seed) * (2 + w * 1.5), 7 - w * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      // Titreşen yarı saydam beden
      ctx.globalAlpha = baseAlpha * Math.max(0.45, 0.72 + Math.sin(t * 3.1 + seed) * 0.12);
    }

    // ⚓ Kaptan'ın arkada dalgalanan paltosu
    if (p.charId === 'kaptan') {
      const sway = Math.sin(t * 5 + seed) * (spd > 35 ? 3 : 1);
      ctx.fillStyle = '#7f1d1d';
      ctx.beginPath();
      ctx.moveTo(-6, -9);
      ctx.quadraticCurveTo(-18, -8 + sway, -22 - Math.min(5, spd * 0.02), sway);
      ctx.quadraticCurveTo(-18, 8 + sway, -6, 9);
      ctx.closePath();
      ctx.fill();
    }

    // Fenerci forward headlamp beam (hidden when submerged)
    if (p.charId === 'fenerci' && !p.submerged && !stunned && !blind) {
      const beam = ctx.createRadialGradient(12, 0, 4, 12, 0, 96);
      beam.addColorStop(0, 'rgba(255, 240, 170, 0.34)');
      beam.addColorStop(1, 'rgba(255, 214, 102, 0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.arc(12, 0, 96, -0.32, 0.32);
      ctx.closePath();
      ctx.fill();
    }

    // Underwater shadow + white swimming ripple collar
    ctx.fillStyle = 'rgba(0, 8, 18, 0.42)';
    ctx.beginPath();
    ctx.ellipse(0, 3, 21, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!p.submerged) {
      ctx.strokeStyle = 'rgba(224, 248, 255, 0.42)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 21 + Math.sin(t * 4.5 + seed) * 1.8, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Kicking swimmer legs trailing behind
    ctx.strokeStyle = skinTone;
    ctx.lineWidth = 4.2;
    ctx.lineCap = 'round';
    const legKick = rooted ? Math.sin(t * 24) * 5 : (stunned ? 0 : stroke * swimAmp * 0.7);
    const legLen = dashing ? 23 : (riding ? 14 : 19);
    ctx.beginPath();
    ctx.moveTo(-8, -4.5); ctx.lineTo(-legLen - legKick, -5.5);
    ctx.moveTo(-8, 4.5); ctx.lineTo(-legLen + legKick, 5.5);
    ctx.stroke();

    // Ahtapot: arkada yelpaze gibi açılan 6 dokunaç
    if (p.charId === 'ahtapot') {
      for (let k = 0; k < 6; k++) {
        const yOff = (k - 2.5) * (dashing ? 2.6 : 4.4);
        const sw = Math.sin(t * (dashing ? 11 : 6) + k * 1.2 + seed) * 4.5;
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 3.6;
        ctx.beginPath();
        ctx.moveTo(-6, yOff);
        ctx.quadraticCurveTo(-16, yOff + sw, -25, yOff - sw * 0.5);
        ctx.stroke();
      }
    }

    // 💪 Right & Left swimming arms + REAL 2 HELD ITEMS!
    let rHandX = 11 + stroke * swimAmp;
    let rHandY = 13.5;
    let lHandX = 11 - stroke * swimAmp;
    let lHandY = -13.5;
    if (stunned) {
      // Sarkık, sersem kollar
      rHandX = 3 + Math.sin(t * 3) * 2; lHandX = 3 + Math.sin(t * 3 + 1) * 2;
      rHandY = 15; lHandY = -15;
    } else if (rooted) {
      // Çapadan/ağdan kurtulmak için çırpınma
      rHandX = 8 + Math.sin(t * 20) * 6; lHandX = 8 - Math.sin(t * 20) * 6;
      rHandY = 16 + Math.sin(t * 18) * 3; lHandY = -16 + Math.sin(t * 18) * 3;
    } else if (blind) {
      // Elleri gözlerine kapatır
      rHandX = 9; lHandX = 9; rHandY = 4; lHandY = -4;
    } else if (dashing) {
      // Süpermen hamlesi: kollar öne kenetli
      rHandX = 19; lHandX = 19; rHandY = 5; lHandY = -5;
    } else if (riding) {
      // Sörf dengesi: kollar yana açık
      rHandX = 1; lHandX = 1; rHandY = 19 + Math.sin(t * 4) * 1.5; lHandY = -19 - Math.sin(t * 4) * 1.5;
    }
    ctx.strokeStyle = skinTone;
    ctx.lineWidth = 5.2;
    ctx.beginPath();
    ctx.moveTo(1, 10); ctx.lineTo(rHandX, rHandY);
    ctx.moveTo(1, -10); ctx.lineTo(lHandX, lHandY);
    ctx.stroke();

    const it0 = p.items?.[0];
    const it1 = p.items?.[1];
    if (it0 && it0.usesLeft > 0 && !(it0.longCd && it0.cd > 0)) this._drawHandheldItem2D(ctx, it0.id, rHandX + 2, rHandY);
    if (it1 && it1.usesLeft > 0 && !(it1.longCd && it1.cd > 0)) this._drawHandheldItem2D(ctx, it1.id, lHandX + 2, lHandY);

    // Broad swimmer shoulders / wetsuit torso
    ctx.fillStyle = mainColor;
    ctx.strokeStyle = roleColor;
    ctx.lineWidth = strokeW;
    ctx.beginPath();
    ctx.ellipse(0, 0, 10.5, 14.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (p.charId === 'kaptan') {
      // Omuzlarda altın apoletler
      ctx.fillStyle = '#fbbf24';
      ctx.strokeStyle = '#92400e';
      ctx.lineWidth = 1;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(0.5, s * 11.5, 4.2, 3.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (p.charId === 'kopekbaligi') {
      // Sırtta büyük köpekbalığı yüzgeci
      const finSw = Math.sin(t * (5 + spd * 0.02) + seed) * 1.5;
      ctx.fillStyle = mainColor;
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-1, -4.5);
      ctx.lineTo(-17, finSw);
      ctx.lineTo(-1, 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Stylized human head
    ctx.fillStyle = skinTone;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(3, 0, 8.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 🎭 Character-specific hat / hood / goggles from top-down!
    if (p.charId === 'kaptan') {
      // Pirate tricorn hat + golden badge
      ctx.fillStyle = '#1c1917';
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(13, 0); ctx.lineTo(-5, -11); ctx.lineTo(-5, 11);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if (p.charId === 'kopekbaligi') {
      // Shark hood + dorsal fin on top
      ctx.fillStyle = mainColor;
      ctx.beginPath();
      ctx.arc(1.5, 0, 8.8, Math.PI * 0.45, Math.PI * 1.55);
      ctx.fill();
      ctx.fillStyle = '#e0f2fe';
      ctx.beginPath();
      ctx.moveTo(2, 0); ctx.lineTo(-9, -2.5); ctx.lineTo(-9, 2.5);
      ctx.closePath(); ctx.fill();
    } else if (p.charId === 'hayalet') {
      // Glowing hooded diver
      ctx.fillStyle = '#0f766e';
      ctx.strokeStyle = '#67e8f9';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(1, 0, 9.2, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#67e8f9';
      ctx.beginPath();
      ctx.arc(6.5, -3, 1.8, 0, Math.PI * 2);
      ctx.arc(6.5, 3, 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.charId === 'fenerci') {
      // Yellow rain hat + glowing headlamp
      ctx.fillStyle = '#facc15';
      ctx.strokeStyle = '#a16207';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(2.5, 0, 9.2, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(10.5, 0, 3.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.charId === 'ahtapot') {
      // Purple octopus cap with yellow eyes
      ctx.fillStyle = '#9333ea';
      ctx.beginPath();
      ctx.arc(2.5, 0, 9.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(7, -3.2, 2.1, 0, Math.PI * 2);
      ctx.arc(7, 3.2, 2.1, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Surf goggles + bandana
      ctx.fillStyle = '#38bdf8';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(7.5, -5.5, 4.2, 11, 2);
      ctx.fill(); ctx.stroke();
    }

    if (blind) {
      // Gözleri kapatan eller kafanın üstünde
      ctx.fillStyle = skinTone;
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(9.5, s * 3.6, 3.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.globalAlpha = baseAlpha;
  }

  _drawPowerups(ctx, powerups) {
    const t = this.time;
    for (const pu of powerups) {
      const def = POWERUP_MAP[pu.kind];
      if (!def) continue;
      const bob = Math.sin(t * 4.2 + pu.id) * 3.5;
      const pulse = 22 + Math.sin(t * 5 + pu.id) * 4;
      ctx.save();
      ctx.translate(pu.x, pu.y + bob);

      // Outer glowing sea ripple
      ctx.strokeStyle = def.color;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, pulse, 0, Math.PI * 2);
      ctx.stroke();

      // Buoy / crate badge
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(4, 18, 34, 0.9)';
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.font = '17px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.icon, 0, 1);

      ctx.fillStyle = def.color;
      ctx.font = '800 10px system-ui, sans-serif';
      ctx.fillText(def.label, 0, 27);
      ctx.restore();
    }
  }

  _drawBarrels(ctx, barrels) {
    const t = this.time;
    for (const b of barrels) {
      const bob = Math.sin(t * 3.8 + b.id * 1.7) * 2.5;
      ctx.save();
      ctx.translate(b.x, b.y + bob);

      // Foam ring around floating keg
      ctx.strokeStyle = b.hot ? 'rgba(255, 77, 109, 0.9)' : 'rgba(255, 140, 66, 0.35)';
      ctx.lineWidth = b.hot ? 3.5 : 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, b.hot ? 24 + Math.sin(t * 28) * 3 : 21, 0, Math.PI * 2);
      ctx.stroke();

      // Wooden barrel body + iron bands
      ctx.fillStyle = b.hot ? '#ef4444' : '#7c2d12';
      ctx.strokeStyle = b.hot ? '#fef08a' : '#29150b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Inner red danger cap
      ctx.fillStyle = b.hot ? '#fde047' : '#dc2626';
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🧨', 0, 1);
      ctx.restore();
    }
  }

  _drawRescueBuoys(ctx, buoys, me) {
    const t = this.time;
    for (const rb of buoys) {
      const isAlly = me && me.team === rb.team;
      const col = rb.role === 'hunter' ? '#ffb703' : '#06d6a0';
      const bob = Math.sin(t * 4.5 + rb.id) * 3;

      ctx.save();
      ctx.translate(rb.x, rb.y);

      // Rescue zone circle (76px)
      ctx.fillStyle = rb.pct > 0 ? 'rgba(6, 214, 160, 0.16)' : 'rgba(56, 189, 248, 0.08)';
      ctx.strokeStyle = col;
      ctx.lineWidth = rb.pct > 0 ? 3 : 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, rb.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      // Circular rescue progress arc!
      if (rb.pct > 0) {
        ctx.strokeStyle = '#80ffdb';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, rb.r - 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * rb.pct);
        ctx.stroke();
      }

      // Floating life buoy icon in center
      ctx.translate(0, bob);
      ctx.fillStyle = 'rgba(4, 18, 34, 0.92)';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.font = '20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🛟', 0, 1);

      // Label & timer
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 12px system-ui, sans-serif';
      const statusTxt = rb.pct > 0
        ? `KURTARILIYOR %${Math.round(rb.pct * 100)}`
        : (isAlly ? `KURTAR: ${rb.name} (${rb.life}s)` : `BATIK: ${rb.name} (${rb.life}s)`);
      ctx.fillText(statusTxt, 0, -30);

      if (isAlly && rb.pct === 0) {
        ctx.fillStyle = '#80ffdb';
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.fillText('Halkada 3 sn dur!', 0, 32);
      }
      ctx.restore();
    }
  }

  _drawStorm(ctx, storm) {
    if (!storm || !storm.active) return;
    ctx.save();
    // Dark crimson-violet storm mask outside the safe circle using evenodd!
    ctx.beginPath();
    ctx.rect(-200, -200, WORLD_W + 400, WORLD_H + 400);
    ctx.arc(storm.cx, storm.cy, Math.max(10, storm.r), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(42, 6, 36, 0.44)';
    ctx.fill('evenodd');

    // Pulsing storm wall ring
    const glow = 0.65 + 0.3 * Math.sin(this.time * 7);
    ctx.strokeStyle = `rgba(255, 77, 109, ${glow})`;
    ctx.lineWidth = 5;
    ctx.setLineDash([18, 10]);
    ctx.lineDashOffset = -this.time * 45;
    ctx.beginPath();
    ctx.arc(storm.cx, storm.cy, Math.max(10, storm.r), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Subtle inner safety halo
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(storm.cx, storm.cy, Math.max(10, storm.r - 6), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  _drawFloatTexts(ctx, floatTexts) {
    for (const ft of floatTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.font = '800 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#03101d';
      ctx.fillText(ft.text, ft.x + 1, ft.y + 1);
      ctx.fillStyle = ft.color || '#7dd3fc';
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }

  _drawProjectiles(ctx, projectiles, dt) {
    const aliveIds = new Set();
    for (const pr of projectiles) {
      aliveIds.add(pr.id);
      let sp = this.smoothProj.get(pr.id);
      if (!sp) {
        sp = { x: pr.x, y: pr.y };
        this.smoothProj.set(pr.id, sp);
      } else {
        sp.x += (pr.vx || 0) * dt;
        sp.y += (pr.vy || 0) * dt;
        const k = Math.min(1, dt * 22);
        sp.x += (pr.x - sp.x) * k;
        sp.y += (pr.y - sp.y) * k;
      }
      ctx.save();
      ctx.translate(sp.x, sp.y);
      const a = Math.atan2(pr.vy, pr.vx);
      ctx.rotate(a);

      if (pr.kind === 'harpoon') {
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(-18, 0);
        ctx.lineTo(12, 0);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(15, 0);
        ctx.lineTo(7, -5);
        ctx.lineTo(7, 5);
        ctx.closePath();
        ctx.fill();
      } else if (pr.kind === 'net') {
        ctx.strokeStyle = '#e9c46a';
        ctx.fillStyle = 'rgba(233, 196, 106, 0.25)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, pr.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (pr.kind === 'shock') {
        ctx.fillStyle = '#e0f2fe';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(0, 0, pr.r * 0.75, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (pr.kind === 'hook') {
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 8, -Math.PI * 0.7, Math.PI * 0.7);
        ctx.stroke();
      } else {
        // Bullet / Pellet / Flare with glowing tracer tail!
        ctx.strokeStyle = pr.color || '#ffb703';
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = Math.max(3, pr.r * 0.9);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-24, 0);
        ctx.lineTo(0, 0);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff9db';
        ctx.shadowColor = pr.color || '#ffb703';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(0, 0, pr.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    for (const id of this.smoothProj.keys()) {
      if (!aliveIds.has(id)) this.smoothProj.delete(id);
    }
  }

  _drawBreakables(ctx, breakables) {
    for (const br of breakables) {
      ctx.save();
      ctx.translate(br.x, br.y);
      const dmgPct = 1 - Math.max(0, br.hp / (br.maxHp || 55));
      // Sea foam around barricade
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, br.r + 3, 0, Math.PI * 2);
      ctx.stroke();

      // Octagonal wooden sea barricade
      ctx.fillStyle = '#78350f';
      ctx.strokeStyle = '#fde68a';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const px = Math.cos(a) * br.r;
        const py = Math.sin(a) * br.r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Cross beams
      ctx.strokeStyle = '#451a03';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-br.r * 0.65, -br.r * 0.65);
      ctx.lineTo(br.r * 0.65, br.r * 0.65);
      ctx.moveTo(br.r * 0.65, -br.r * 0.65);
      ctx.lineTo(-br.r * 0.65, br.r * 0.65);
      ctx.stroke();

      // Cracks when damaged
      if (dmgPct > 0.1) {
        ctx.strokeStyle = '#fef3c7';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(-10, -12); ctx.lineTo(2, 0); ctx.lineTo(14, -6);
        if (dmgPct > 0.45) {
          ctx.moveTo(2, 0); ctx.lineTo(-8, 16);
        }
        ctx.stroke();
        // Mini HP bar
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(-20, br.r + 6, 40, 4);
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(-20, br.r + 6, 40 * (1 - dmgPct), 4);
      }

      ctx.font = '15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🪵', 0, 1);
      ctx.restore();
    }
  }

  _drawKraken(ctx, k) {
    if (!k) return;
    const t = this.time;
    ctx.save();
    ctx.translate(k.x, k.y);

    // Slam telegraph ring!
    if (k.warn) {
      ctx.fillStyle = `rgba(217, 70, 239, ${0.14 + k.warnPct * 0.24})`;
      ctx.beginPath();
      ctx.arc(0, 0, k.slamR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#f0abfc';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, k.slamR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.26)';
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(20, k.slamR * k.warnPct), 0, Math.PI * 2);
      ctx.fill();
    }

    // Abyssal dark whirlpool underneath Kraken
    const vg = ctx.createRadialGradient(0, 0, 12, 0, 0, k.r + 36);
    vg.addColorStop(0, 'rgba(30, 8, 52, 0.85)');
    vg.addColorStop(0.6, 'rgba(126, 34, 206, 0.28)');
    vg.addColorStop(1, 'rgba(126, 34, 206, 0)');
    ctx.fillStyle = vg;
    ctx.beginPath();
    ctx.arc(0, 0, k.r + 36, 0, Math.PI * 2);
    ctx.fill();

    // 8 giant animated writhing tentacles!
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.sin(t * 1.4 + i) * 0.14;
      const sway = Math.sin(t * (k.warn ? 11 : 4.2) + i * 1.3) * 18;
      const reach = k.warn ? k.r + 42 : k.r + 28;
      const sx = Math.cos(a) * 18;
      const sy = Math.sin(a) * 18;
      const mx = Math.cos(a) * (reach * 0.55) - Math.sin(a) * sway;
      const my = Math.sin(a) * (reach * 0.55) + Math.cos(a) * sway;
      const ex = Math.cos(a) * reach + Math.sin(a) * (sway * 0.45);
      const ey = Math.sin(a) * reach - Math.cos(a) * (sway * 0.45);

      ctx.strokeStyle = i % 2 === 0 ? '#a21caf' : '#7e22ce';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(mx, my, ex, ey);
      ctx.stroke();

      // Suction-cup glow dots
      ctx.fillStyle = 'rgba(245, 208, 254, 0.65)';
      ctx.beginPath();
      ctx.arc(mx, my, 2.5, 0, Math.PI * 2);
      ctx.arc((mx + ex) * 0.5, (my + ey) * 0.5, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Giant Kraken dome head
    ctx.fillStyle = '#581c87';
    ctx.strokeStyle = '#e879f9';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.arc(0, 0, 30 + Math.sin(t * 4) * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Enraged vortex pull ring (245px)
    if (k.enraged) {
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.42)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, 245, t * 1.4, t * 1.4 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Glowing yellow / enraged crimson boss eyes
    ctx.fillStyle = k.enraged ? '#ff2a55' : '#fef08a';
    ctx.beginPath();
    ctx.ellipse(-10, 4, 6.5, 4.5, 0.25, 0, Math.PI * 2);
    ctx.ellipse(10, 4, 6.5, 4.5, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1e1b4b';
    ctx.fillRect(-11, 1.5, 2.5, 5.5);
    ctx.fillRect(8.5, 1.5, 2.5, 5.5);

    // Boss HP Bar & label above
    const bw = 96;
    const pct = Math.max(0, Math.min(1, k.hp / (k.maxHp || 260)));
    ctx.fillStyle = 'rgba(8, 4, 18, 0.88)';
    ctx.beginPath();
    ctx.roundRect(-bw / 2 - 2, -56, bw + 4, 10, 5);
    ctx.fill();
    ctx.fillStyle = k.enraged ? '#f43f5e' : '#d946ef';
    ctx.beginPath();
    ctx.roundRect(-bw / 2, -54, bw * pct, 6, 3);
    ctx.fill();

    ctx.fillStyle = k.enraged ? '#fda4af' : '#f5d0fe';
    ctx.font = '900 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(k.enraged ? `🔥 ÖFKELİ KRAKEN · ${k.hp}/${k.maxHp}` : `🐙 KRAKEN · ${k.hp}/${k.maxHp}`, 0, -64);
    ctx.restore();
  }

  _drawEdgeTentacles(ctx, list) {
    if (!list || list.length === 0) return;
    const t = this.time;
    for (const et of list) {
      ctx.save();
      ctx.translate(et.x, et.y);
      ctx.rotate(et.angle);
      const ix = 74;
      if (et.phase === 'warn') {
        const p = et.pct || 0;
        ctx.fillStyle = `rgba(217, 70, 239, ${0.12 + p * 0.22})`;
        ctx.beginPath();
        ctx.arc(ix, 0, et.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#f0abfc';
        ctx.lineWidth = 2.6;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.arc(ix, 0, et.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(244, 63, 94, 0.28)';
        ctx.beginPath();
        ctx.arc(ix, 0, Math.max(12, et.r * p), 0, Math.PI * 2);
        ctx.fill();
        // Emerging tentacle tip from map edge
        const reach = 18 + p * 36;
        ctx.strokeStyle = '#a21caf';
        ctx.lineWidth = 14;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-10, 0);
        ctx.quadraticCurveTo(reach * 0.5, Math.sin(t * 14 + et.id) * 14, reach, 0);
        ctx.stroke();
      } else {
        const p = et.pct || 0;
        const alpha = p > 0.45 ? Math.max(0, 1 - (p - 0.45) / 0.55) : 1;
        const reach = p < 0.25 ? (55 + (p / 0.25) * 95) : (150 - (p - 0.25) * 80);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#7e22ce';
        ctx.lineWidth = 18;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-12, 0);
        ctx.quadraticCurveTo(reach * 0.5, Math.sin(p * 10) * 16, reach, 0);
        ctx.stroke();
        ctx.fillStyle = '#f5d0fe';
        for (const f of [0.3, 0.55, 0.78]) {
          ctx.beginPath();
          ctx.arc(reach * f, 4, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  _drawTsunami(ctx, ts) {
    if (!ts) return;
    const t = this.time;
    const isHoriz = ts.dir === 'E' || ts.dir === 'W';
    const span = isHoriz ? WORLD_H : WORLD_W;

    ctx.save();
    if (isHoriz) {
      ctx.translate(ts.pos, WORLD_H / 2);
      if (ts.dir === 'W') ctx.scale(-1, 1);
    } else {
      ctx.translate(WORLD_W / 2, ts.pos);
      ctx.rotate(ts.dir === 'S' ? Math.PI / 2 : -Math.PI / 2);
    }

    if (ts.state === 'telegraph') {
      const pct = 1 - (ts.timer / (ts.maxTelegraph || 2.3));
      const pulse = 0.55 + 0.45 * Math.sin(t * 14);
      const warnDepth = 115;
      const g = ctx.createLinearGradient(0, 0, warnDepth, 0);
      g.addColorStop(0, `rgba(14, 165, 233, ${(0.42 + pulse * 0.24).toFixed(2)})`);
      g.addColorStop(0.55, `rgba(56, 189, 248, ${(0.18 + pct * 0.16).toFixed(2)})`);
      g.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, -span / 2, warnDepth, span);

      // Animated warning chevrons pointing inward
      const slide = (t * 95) % 52;
      ctx.strokeStyle = `rgba(224, 242, 254, ${(0.65 + pulse * 0.35).toFixed(2)})`;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let y = -span / 2 + 80; y < span / 2 - 60; y += 135) {
        const ax = 18 + slide;
        ctx.beginPath();
        ctx.moveTo(ax - 14, y - 18);
        ctx.lineTo(ax + 8, y);
        ctx.lineTo(ax - 14, y + 18);
        ctx.stroke();
      }
      // Rising dark swell lip right at the border
      ctx.fillStyle = 'rgba(2, 132, 199, 0.78)';
      ctx.fillRect(-16, -span / 2, 16 + pct * 26, span);
      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(pct * 26, -span / 2);
      ctx.lineTo(pct * 26, span / 2);
      ctx.stroke();
    } else {
      // Sweeping giant wall of water! Local +X is wave travel direction
      const bodyG = ctx.createLinearGradient(-120, 0, 56, 0);
      bodyG.addColorStop(0, 'rgba(3, 105, 161, 0)');
      bodyG.addColorStop(0.45, 'rgba(2, 132, 199, 0.56)');
      bodyG.addColorStop(0.82, 'rgba(14, 165, 233, 0.86)');
      bodyG.addColorStop(1, 'rgba(224, 242, 254, 0.94)');
      ctx.fillStyle = bodyG;
      ctx.fillRect(-120, -span / 2, 176, span);

      // Deep dark trough shadow right ahead of the curling lip
      ctx.fillStyle = 'rgba(7, 37, 64, 0.44)';
      ctx.fillRect(42, -span / 2, 28, span);

      // Ragged frothy white crest ribbon
      ctx.fillStyle = 'rgba(240, 249, 255, 0.94)';
      ctx.beginPath();
      ctx.moveTo(22, -span / 2);
      for (let y = -span / 2; y <= span / 2; y += 26) {
        const j = Math.sin(y * 0.045 + t * 11) * 10 + Math.cos(y * 0.11 - t * 8) * 5;
        ctx.lineTo(44 + j, y);
      }
      for (let y = span / 2; y >= -span / 2; y -= 26) {
        const j = Math.sin(y * 0.055 - t * 9) * 7;
        ctx.lineTo(14 + j, y);
      }
      ctx.closePath();
      ctx.fill();

      // Flying spray droplets ahead of crest
      ctx.fillStyle = 'rgba(224, 242, 254, 0.82)';
      for (let y = -span / 2 + 24; y < span / 2; y += 44) {
        const sx = 54 + ((Math.sin(y * 0.17 + t * 14) + 1) * 16);
        const r = 2.6 + ((Math.cos(y * 0.23 - t * 9) + 1) * 1.6);
        ctx.beginPath();
        ctx.arc(sx, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  _drawMeleeSwings(ctx, swings) {
    if (!swings || swings.length === 0) return;
    for (const ms of swings) {
      const p = ms.pct || 0;
      const alpha = Math.max(0, 1 - p * p);
      ctx.save();
      ctx.translate(ms.x, ms.y);
      ctx.rotate(ms.angle);
      ctx.globalAlpha = alpha;
      if (ms.kind === 'trident') {
        // Piercing 3-prong aqua-gold spear thrust!
        const reach = ms.range * (0.45 + 0.55 * Math.min(1, p * 2.2));
        for (const oy of [-13, 0, 13]) {
          const g = ctx.createLinearGradient(12, oy, reach, oy);
          g.addColorStop(0, 'rgba(56, 189, 248, 0)');
          g.addColorStop(0.6, 'rgba(56, 189, 248, 0.85)');
          g.addColorStop(1, '#fef08a');
          ctx.strokeStyle = g;
          ctx.lineWidth = oy === 0 ? 7 : 4.2;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(14, oy * 0.45);
          ctx.lineTo(reach - (oy === 0 ? 0 : 12), oy);
          ctx.stroke();
        }
      } else {
        const half = (ms.arc || 2) * 0.5;
        const rOut = ms.range * (0.82 + p * 0.22);
        const rIn = rOut * (ms.kind === 'heavy_oar' ? 0.56 : 0.64);
        const colMain = ms.kind === 'heavy_oar' ? 'rgba(251, 191, 36, 0.68)'
          : ms.kind === 'coral_dagger' ? 'rgba(244, 63, 94, 0.72)'
            : 'rgba(224, 242, 254, 0.82)';
        const colEdge = ms.kind === 'heavy_oar' ? '#fef08a'
          : ms.kind === 'coral_dagger' ? '#5eead4'
            : '#38bdf8';
        ctx.fillStyle = colMain;
        ctx.beginPath();
        ctx.arc(0, 0, rOut, -half, half);
        ctx.arc(0, 0, rIn, half, -half, true);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = colEdge;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.arc(0, 0, rOut, -half, half);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  _drawCrown(ctx, crown) {
    if (!crown || crown.holderId) return;
    const bob = Math.sin(this.time * 4.5) * 4;
    ctx.save();
    ctx.translate(crown.x, crown.y + bob);
    const g = ctx.createRadialGradient(0, 0, 6, 0, 0, 44);
    g.addColorStop(0, 'rgba(255, 209, 102, 0.72)');
    g.addColorStop(1, 'rgba(255, 209, 102, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 44, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(0, 0, 22 + Math.sin(this.time * 6) * 3, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(25, 16, 4, 0.88)';
    ctx.beginPath();
    ctx.arc(0, 0, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.font = '22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👑', 0, 1);

    ctx.fillStyle = '#ffd166';
    ctx.font = '900 11px system-ui, sans-serif';
    ctx.fillText('ALTIN TAÇ', 0, 32);
    ctx.restore();
  }

  _drawLighthouse(ctx, lh) {
    if (!lh) return;
    ctx.save();
    ctx.translate(lh.x, lh.y);
    // Sweeping translucent golden light cone
    const g = ctx.createRadialGradient(0, 0, 14, 0, 0, lh.range);
    g.addColorStop(0, 'rgba(255, 240, 175, 0.42)');
    g.addColorStop(0.55, 'rgba(255, 214, 102, 0.16)');
    g.addColorStop(1, 'rgba(255, 214, 102, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, lh.range, lh.angle - lh.halfAngle, lh.angle + lh.halfAngle);
    ctx.closePath();
    ctx.fill();

    // Beacon turret on center rock
    ctx.fillStyle = 'rgba(255, 245, 200, 0.92)';
    ctx.strokeStyle = '#ffb703';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🗼', 0, 1);
    ctx.restore();
  }

  _spawnBurst(x, y, count, cfg) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= 140) this.particles.shift();
      const a = Math.random() * Math.PI * 2;
      const spd = cfg.minSpd + Math.random() * (cfg.maxSpd - cfg.minSpd);
      const colors = cfg.colors;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        size: cfg.minSize + Math.random() * (cfg.maxSize - cfg.minSize),
        color: colors[Math.floor(Math.random() * colors.length)],
        shape: cfg.shape || 'dot',
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 10,
        life: cfg.life * (0.7 + Math.random() * 0.5),
        maxLife: cfg.life
      });
    }
  }

  _stepJuice(state, myId, dt) {
    // Reset tracking cleanly on new round
    if (state.round !== this.lastRoundSeen) {
      this.lastRoundSeen = state.round;
      this.prevHpTotal.clear();
      this.hitFlash.clear();
      this.prevBreakables.clear();
      this.seenPulses.clear();
      this.seenSinks.clear();
      this.particles = [];
    }

    // Tick hit-flashes
    for (const [id, t] of this.hitFlash.entries()) {
      const nt = t - dt;
      if (nt <= 0) this.hitFlash.delete(id);
      else this.hitFlash.set(id, nt);
    }

    // 1) Detect player hits -> Hit-flash + droplets + subtle screen shake!
    for (const p of state.players || []) {
      const tot = (p.hp || 0) + (p.breath || 0) + (p.shield || 0);
      const prev = this.prevHpTotal.get(p.id);
      if (prev !== undefined && p.alive && prev - tot >= 10) {
        const dmg = prev - tot;
        this.hitFlash.set(p.id, 0.15);
        this._spawnBurst(p.x, p.y, dmg >= 45 ? 12 : 7, {
          minSpd: 75, maxSpd: 210, minSize: 2.5, maxSize: 5, life: 0.42,
          colors: dmg >= 45 ? ['#ffffff', '#ffd166', '#ff6b35'] : ['#ffffff', '#7dd3fc', '#bae6fd']
        });
        if (p.id === myId) {
          this.triggerShake(dmg >= 45 ? 8.5 : 4.2);
        } else if (dmg >= 55 && dist(this.camX, this.camY, p.x, p.y) < 520) {
          this.triggerShake(5.5);
        }
      }
      this.prevHpTotal.set(p.id, tot);
    }

    // 2) Detect new boom / flash pulses -> sparks & glints!
    for (const pu of state.pulses || []) {
      if (this.seenPulses.has(pu.id)) continue;
      this.seenPulses.add(pu.id);
      if (this.seenPulses.size > 240) this.seenPulses.clear();
      if (pu.kind === 'boom') {
        this._spawnBurst(pu.x, pu.y, 18, {
          minSpd: 90, maxSpd: 310, minSize: 3, maxSize: 6.5, life: 0.55,
          colors: ['#fff7ed', '#ffd166', '#ff6b35', '#ef4444']
        });
        if (dist(this.camX, this.camY, pu.x, pu.y) < 680) this.triggerShake(7.5);
      } else if (pu.kind === 'flash') {
        this._spawnBurst(pu.x, pu.y, 11, {
          minSpd: 80, maxSpd: 240, minSize: 2.2, maxSize: 4.5, life: 0.38,
          colors: ['#ffffff', '#38bdf8', '#e0f2fe']
        });
      }
    }

    // 3) Detect shattered barricades -> flying wood splinters!
    const curBrIds = new Set((state.breakables || []).map(b => b.id));
    if (state.phase === 'playing') {
      for (const [id, pos] of this.prevBreakables.entries()) {
        if (!curBrIds.has(id)) {
          this._spawnBurst(pos.x, pos.y, 14, {
            minSpd: 85, maxSpd: 260, minSize: 5, maxSize: 9, life: 0.65, shape: 'splinter',
            colors: ['#b45309', '#fde68a', '#78350f', '#d97706']
          });
          if (dist(this.camX, this.camY, pos.x, pos.y) < 620) this.triggerShake(5.2);
        }
      }
    }
    this.prevBreakables.clear();
    for (const b of state.breakables || []) this.prevBreakables.set(b.id, { x: b.x, y: b.y });

    // 4) Detect new sink effects -> dramatic ocean foam burst!
    for (const se of state.sinkEffects || []) {
      if (this.seenSinks.has(se.id)) continue;
      this.seenSinks.add(se.id);
      this._spawnBurst(se.x, se.y, 20, {
        minSpd: 70, maxSpd: 250, minSize: 3, maxSize: 6.5, life: 0.72,
        colors: ['#ffffff', '#bae6fd', '#38bdf8', '#06d6a0']
      });
      if (dist(this.camX, this.camY, se.x, se.y) < 700) this.triggerShake(8.0);
    }

    // 5) Step particles with water/air drag
    const drag = Math.pow(0.06, dt);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= drag;
      pt.vy *= drag;
      pt.rot += pt.vrot * dt;
      if (pt.life <= 0) this.particles.splice(i, 1);
    }
  }

  _drawParticles(ctx) {
    for (const pt of this.particles) {
      const alpha = Math.max(0, Math.min(1, pt.life / pt.maxLife));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(pt.x, pt.y);
      ctx.fillStyle = pt.color;
      if (pt.shape === 'splinter') {
        ctx.rotate(pt.rot);
        ctx.fillRect(-pt.size * 0.5, -pt.size * 0.22, pt.size, pt.size * 0.44);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, pt.size * (0.45 + alpha * 0.55), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  _drawSinkEffects(ctx, effects) {
    for (const se of effects) {
      const prog = 1 - se.life / se.maxLife;
      const alpha = Math.max(0, se.life / se.maxLife);
      ctx.save();
      ctx.translate(se.x, se.y);

      // Expanding dark ocean swallow ring
      ctx.fillStyle = `rgba(2, 16, 32, ${alpha * 0.75})`;
      ctx.beginPath();
      ctx.arc(0, 0, 18 + prog * 36, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(125, 211, 252, ${alpha * 0.9})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 12 + prog * 54, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = `rgba(224, 242, 254, ${alpha})`;
      ctx.font = '800 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`🌊 ${se.name} SUYA GÖMÜLDÜ!`, 0, -18 - prog * 28);
      ctx.restore();
    }
  }

  _drawMegaChest(ctx, mc) {
    if (!mc) return;
    const pulse = Math.sin(this.time * 5) * 4;
    const pct = Math.max(0, Math.min(1, (mc.progress || 0) / (mc.duration || 2.5)));
    ctx.save();
    ctx.translate(mc.x, mc.y);

    // Outer capture zone
    ctx.fillStyle = mc.contested ? 'rgba(239, 71, 111, 0.14)' : 'rgba(255, 209, 102, 0.13)';
    ctx.strokeStyle = mc.contested ? '#ef476f' : 'rgba(255, 209, 102, 0.78)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, mc.r + pulse * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Capture progress arc
    if (pct > 0) {
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, mc.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
      ctx.stroke();
    }

    // Chest icon & label
    ctx.font = '32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('💎', 0, 10 + Math.sin(this.time * 4) * 3);
    ctx.font = '900 12px system-ui, sans-serif';
    ctx.fillStyle = mc.contested ? '#fda4af' : '#fef08a';
    ctx.fillText(mc.contested ? '⚔️ ÇEKİŞMELİ!' : `BÜYÜK SANDIK ${Math.round(pct * 100)}%`, 0, -mc.r - 8);
    ctx.restore();
  }

  _drawPings(ctx, pings, me) {
    for (const pg of pings) {
      if (me && pg.team !== me.team) continue;
      const alpha = Math.max(0, Math.min(1, pg.life / 1.2));
      const wave = ((this.time * 2.2) % 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(pg.x, pg.y);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 14 + wave * 42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffd166';
      ctx.font = '900 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`📍 ${pg.by}`, 0, -20);
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

    // Beach shoreline on minimap
    if (map.beach) {
      ctx.fillStyle = 'rgba(226, 190, 121, 0.72)';
      ctx.fillRect(0, 0, mw, map.beach.sandY * sy);
      ctx.fillStyle = 'rgba(56, 217, 210, 0.3)';
      ctx.fillRect(0, map.beach.sandY * sy, mw, (map.beach.shallowY - map.beach.sandY) * sy);
    }

    // Turbo currents on minimap
    for (const cur of map.currents || []) {
      ctx.fillStyle = 'rgba(34, 211, 238, 0.34)';
      ctx.fillRect(cur.x * sx, cur.y * sy, cur.w * sx, cur.h * sy);
    }

    // Rocks
    ctx.fillStyle = '#475569';
    for (const obs of map.rocks) {
      if (obs.type === 'rock') {
        ctx.beginPath();
        ctx.arc(obs.x * sx, obs.y * sy, Math.max(3, obs.r * sx), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(obs.x * sx, obs.y * sy, obs.w * sx, obs.h * sy);
      }
    }

    // Powder barrels on minimap
    for (const b of state.barrels || []) {
      ctx.fillStyle = '#ff6b35';
      ctx.beginPath();
      ctx.arc(b.x * sx, b.y * sy, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Power-ups on minimap
    for (const pu of state.powerups || []) {
      const def = POWERUP_MAP[pu.kind];
      ctx.fillStyle = def?.color || '#ffd166';
      ctx.beginPath();
      ctx.arc(pu.x * sx, pu.y * sy, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Rescue buoys on minimap (pulsing white/green beacon!)
    for (const rb of state.rescueBuoys || []) {
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = rb.role === 'hunter' ? '#ffb703' : '#06d6a0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rb.x * sx, rb.y * sy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Storm circle on minimap
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

    // Breakables on minimap
    for (const br of state.breakables || []) {
      ctx.fillStyle = '#b45309';
      ctx.beginPath();
      ctx.arc(br.x * sx, br.y * sy, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tsunami wave line on minimap
    if (state.tsunami) {
      const ts = state.tsunami;
      ctx.strokeStyle = ts.state === 'telegraph' ? '#fde047' : '#38bdf8';
      ctx.lineWidth = ts.state === 'telegraph' ? 3 : 4;
      ctx.beginPath();
      if (ts.dir === 'E' || ts.dir === 'W') {
        const x = Math.max(0, Math.min(mw, ts.pos * sx));
        ctx.moveTo(x, 0);
        ctx.lineTo(x, mh);
      } else {
        const y = Math.max(0, Math.min(mh, ts.pos * sy));
        ctx.moveTo(0, y);
        ctx.lineTo(mw, y);
      }
      ctx.stroke();
    }
    // 2D Top Warning Banner during Tsunami telegraph
    if (state.tsunami && state.tsunami.state === 'telegraph') {
      const ts = state.tsunami;
      const dirTxt = ts.dir === 'E' ? 'BATIDAN DOĞUYA ➡️' : ts.dir === 'W' ? 'DOĞUDAN BATIYA ⬅️' : ts.dir === 'S' ? 'KUZEYDEN GÜNEYE ⬇️' : 'GÜNEYDEN KUZEYE ⬆️';
      const pulse = 0.65 + 0.35 * Math.sin(this.time * 12);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
      ctx.scale(dpr, dpr);
      const bw = Math.min(470, this.viewW - 24);
      const bx = (this.viewW - bw) / 2;
      const by = 68;
      ctx.fillStyle = `rgba(2, 132, 199, ${(0.76 * pulse).toFixed(2)})`;
      ctx.strokeStyle = '#bae6fd';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, 42, 12);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 14px system-ui, sans-serif';
      ctx.fillText(`🌊 TSUNAMİ GELİYOR (${ts.timer.toFixed(1)}s) · ${dirTxt}`, this.viewW / 2, by + 18);
      ctx.fillStyle = '#fef08a';
      ctx.font = '700 11.5px system-ui, sans-serif';
      ctx.fillText('🪨 Kaya arkasına saklan veya 🤿 SHIFT ile su altına dal!', this.viewW / 2, by + 35);
      ctx.restore();
    }

    // Kraken Boss on minimap
    if (state.kraken) {
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = '#d946ef';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(state.kraken.x * sx, state.kraken.y * sy, 5.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Golden Crown on minimap
    if (state.crown) {
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = '#ffd166';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(state.crown.x * sx, state.crown.y * sy, 5.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Mega Chest on minimap (pulsing golden diamond!)
    if (state.megaChest) {
      const mx0 = state.megaChest.x * sx;
      const my0 = state.megaChest.y * sy;
      ctx.fillStyle = '#ffd166';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx0, my0 - 6);
      ctx.lineTo(mx0 + 6, my0);
      ctx.lineTo(mx0, my0 + 6);
      ctx.lineTo(mx0 - 6, my0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Team Pings on minimap
    for (const pg of state.pings || []) {
      if (me && pg.team !== me.team) continue;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(pg.x * sx, pg.y * sy, 5 + Math.sin(this.time * 10) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Visible players
    for (const p of state.players || []) {
      if (!p.alive) continue;
      if (!this._canViewerSee(me, p, map)) continue;
      ctx.fillStyle = p.hasCrown ? '#ffd166' : (p.id === me?.id ? '#ffffff' : p.role === 'hunter' ? '#ffb703' : p.role === 'ffa' ? '#ff6b6b' : '#06d6a0');
      ctx.beginPath();
      ctx.arc(p.x * sx, p.y * sy, p.id === me?.id ? 4.5 : (p.bounty || p.hasCrown ? 4.4 : 3.5), 0, Math.PI * 2);
      ctx.fill();
      if (p.bounty) {
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
