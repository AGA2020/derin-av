// DERİN AV — Stylized Top-Down Ocean & Maritime Combat Renderer

import { WORLD_W, WORLD_H, CHAR_MAP, ALL_ITEMS, POWERUP_MAP, SEA_MAPS } from './data.js?v=3.6';
import { hasLineOfSight } from './sim.js?v=3.6';

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
    this.shake = 0;
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

  render(state, myId, dt, localAim, localPred) {
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
          this.wakes.push({
            x: sp.x - Math.cos(sp.aim) * 16 + (Math.random() - 0.5) * 8,
            y: sp.y - Math.sin(sp.aim) * 16 + (Math.random() - 0.5) * 8,
            r: 5 + Math.random() * 5,
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
    this._drawCurrents(ctx, map);
    this._drawWakes(ctx);
    this._drawPulses(ctx, state.pulses || [], me);
    this._drawTraps(ctx, state.traps || [], me);
    this._drawPowerups(ctx, state.powerups || []);
    this._drawBarrels(ctx, state.barrels || []);
    this._drawRescueBuoys(ctx, state.rescueBuoys || [], me);
    this._drawRocksAndShips(ctx, map);
    this._drawSinkEffects(ctx, state.sinkEffects || []);
    this._drawDecoys(ctx, state.decoys || [], me, map);
    this._drawPlayers(ctx, players, me, map);
    this._drawProjectiles(ctx, state.projectiles || [], dt);
    this._drawZones(ctx, state.zones || []);
    this._drawFogs(ctx, map, me);
    this._drawStorm(ctx, state.storm);
    this._drawBubbles(ctx, me);
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
      const visR = (ch?.vision || 390) * 1.15;
      const grad = ctx.createRadialGradient(vx, vy, visR * 0.55, vx, vy, visR * 1.35);
      grad.addColorStop(0, 'rgba(3, 12, 22, 0)');
      grad.addColorStop(1, 'rgba(2, 10, 18, 0.56)');
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
        ctx.font = '900 15px system-ui, sans-serif';
        if (me.diveTime >= 1.0) {
          ctx.fillStyle = '#ffd166';
          ctx.fillText('🦈 SÜRPRİZ ÇIKIŞ HAZIR! Düşmanın dibinde [SHIFT / E] bas!', this.viewW / 2, 118);
        } else {
          ctx.fillStyle = '#7dd3fc';
          ctx.fillText('🤿 SU ALTINDASIN — Gizleniyorsun (Çıkış: SHIFT / E)', this.viewW / 2, 118);
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
          ctx.fillStyle = '#ff8fa3';
          ctx.font = '900 16px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('🌪️ FIRTINA DIŞINDASIN! ÇEMBERE GİR!', this.viewW / 2, 118);
        }
      }
    }

    // Minimap (sağ üst)
    this._drawMinimap(ctx, state, map, me);

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
      const a = Math.max(0, w.life / w.maxLife) * 0.28;
      ctx.strokeStyle = `rgba(210, 245, 255, ${a})`;
      ctx.lineWidth = 2;
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

  _canViewerSee(me, target, map) {
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
    if (d > (ch?.vision || 390)) return false;
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

  _drawPlayers(ctx, players, me, map) {
    for (const p of players) {
      if (!p.alive) continue;
      if (!this._canViewerSee(me, p, map)) continue;
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

    // Boat / vessel hull rotated toward aim
    ctx.save();
    ctx.scale(submergeScale, submergeScale);
    ctx.rotate(p.aim);

    // Hull shadow
    ctx.fillStyle = 'rgba(0, 8, 18, 0.45)';
    ctx.beginPath();
    ctx.ellipse(2, 4, 24, 15, 0, 0, Math.PI * 2);
    ctx.fill();

    // Pointed boat hull
    ctx.fillStyle = p.role === 'hunter' ? '#2c1810' : p.role === 'ffa' ? '#1a1b2e' : '#0f2936';
    ctx.strokeStyle = p.role === 'hunter' ? '#ffb703' : p.role === 'ffa' ? ch.color : '#06d6a0';
    ctx.lineWidth = p.isMe ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(25, 0);
    ctx.quadraticCurveTo(10, 15, -18, 12);
    ctx.lineTo(-22, 0);
    ctx.lineTo(-18, -12);
    ctx.quadraticCurveTo(10, -15, 25, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner deck colored by character
    ctx.fillStyle = ch.color;
    ctx.beginPath();
    ctx.ellipse(-2, 0, 12, 8.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Prow highlight
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(17, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Character icon
    ctx.font = '15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch.icon, 0, 1);

    // Status badges (Rooted / Stunned / Slowed)
    if (p.rootTimer) {
      ctx.fillStyle = '#ffb703';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillText('⚓ ÇAPALANDI', 0, -40);
    } else if (p.stunTimer) {
      ctx.fillStyle = '#f43f5e';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillText('⚡ SERSEMLEDİ', 0, -40);
    } else if (p.inStorm) {
      ctx.fillStyle = '#ff4d6d';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillText('🌪️ FIRTINA!', 0, -40);
    } else if (p.inCurrent) {
      ctx.fillStyle = '#67e8f9';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillText('⚡ AKINTI!', 0, -40);
    }

    // Name & Buoyancy bar ("Su Üstü Direnci")
    ctx.fillStyle = p.role === 'hunter' ? '#ffd166' : p.role === 'ffa' ? ch.accent : '#80ffdb';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name || '', 0, -28);

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

    ctx.restore();
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

  _drawMinimap(ctx, state, map, me) {
    const mw = 176;
    const mh = Math.round(mw * (WORLD_H / WORLD_W));
    const mx = this.viewW - mw - 16;
    const my = 72;
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

    // Visible players
    for (const p of state.players || []) {
      if (!p.alive) continue;
      if (!this._canViewerSee(me, p, map)) continue;
      ctx.fillStyle = p.id === me?.id ? '#ffffff' : p.role === 'hunter' ? '#ffb703' : p.role === 'ffa' ? '#ff6b6b' : '#06d6a0';
      ctx.beginPath();
      ctx.arc(p.x * sx, p.y * sy, p.id === me?.id ? 4.5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
