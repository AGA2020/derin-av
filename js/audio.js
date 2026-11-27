// Procedural Web Audio API SFX Engine (harici ses dosyası gerektirmez)

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ambientOn = true;
    this.musicOn = localStorage.getItem('derinav_music') !== '0';
    this.musicIntensity = 'off'; // off | calm | intense
    this._musicStep = 0;
    this._musicTimer = null;
    this._ambNodes = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (this.ambientOn && !this.muted && !this._ambNodes) {
      this._startOceanAmbient();
    }
    this._syncMusicLoop();
  }

  setMuted(m) {
    this.muted = m;
    if (this._ambNodes?.masterGain && this.ctx) {
      this._ambNodes.masterGain.gain.setTargetAtTime(m || !this.ambientOn ? 0 : 0.055, this.ctx.currentTime, 0.2);
    }
    this._syncMusicLoop();
  }

  setMusic(on) {
    this.musicOn = on;
    try { localStorage.setItem('derinav_music', on ? '1' : '0'); } catch (_) {}
    if (on && !this.muted) this.unlock();
    this._syncMusicLoop();
  }

  setMusicIntensity(level) {
    if (this.musicIntensity === level) return;
    this.musicIntensity = level;
    this._syncMusicLoop();
  }

  _syncMusicLoop() {
    clearInterval(this._musicTimer);
    this._musicTimer = null;
    if (this.muted || !this.musicOn || this.musicIntensity === 'off' || !this.ctx) return;
    // 🎵 Gerilim ritmi: son 25 sn fırtınada / 1v1'de hızlı korsan davulu + bas!
    const bpmMs = this.musicIntensity === 'intense' ? 210 : 340;
    this._musicTimer = setInterval(() => this._playMusicBeat(), bpmMs);
  }

  _playMusicBeat() {
    if (this.muted || !this.musicOn || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const step = this._musicStep++ % 8;
    const intense = this.musicIntensity === 'intense';
    // D-minor pirate bassline (D2, D2, F2, G2, A2, G2, F2, E2)
    const notes = [73.42, 73.42, 87.31, 98.0, 110.0, 98.0, 87.31, 82.41];
    try {
      // Deep naval war drum on strong beats
      if (step === 0 || step === 4 || (intense && (step === 2 || step === 6))) {
        const dOsc = this.ctx.createOscillator();
        dOsc.type = 'sine';
        dOsc.frequency.setValueAtTime(intense ? 115 : 95, now);
        dOsc.frequency.exponentialRampToValueAtTime(36, now + 0.14);
        const dg = this.ctx.createGain();
        dg.gain.setValueAtTime(intense ? 0.14 : 0.08, now);
        dg.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        dOsc.connect(dg).connect(this.ctx.destination);
        dOsc.start(now);
        dOsc.stop(now + 0.17);
      }
      // Plucked pirate bass note
      if (intense || step % 2 === 0) {
        const bOsc = this.ctx.createOscillator();
        bOsc.type = 'triangle';
        bOsc.frequency.setValueAtTime(notes[step], now);
        const bg = this.ctx.createGain();
        bg.gain.setValueAtTime(intense ? 0.075 : 0.045, now);
        bg.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        bOsc.connect(bg).connect(this.ctx.destination);
        bOsc.start(now);
        bOsc.stop(now + 0.19);
      }
    } catch (_) {}
  }

  setAmbient(on) {
    this.ambientOn = on;
    if (on && !this.muted && !this._ambNodes) {
      this.unlock();
    }
    if (this._ambNodes?.masterGain && this.ctx) {
      this._ambNodes.masterGain.gain.setTargetAtTime(on && !this.muted ? 0.055 : 0, this.ctx.currentTime, 0.25);
    }
  }

  _startOceanAmbient() {
    if (!this.ctx || this._ambNodes) return;
    try {
      const sr = this.ctx.sampleRate;
      const len = sr * 4;
      const buf = this.ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      // Soft pink-ish ocean noise
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + w * 0.029;
        b1 = 0.985 * b1 + w * 0.032;
        b2 = 0.950 * b2 + w * 0.048;
        data[i] = (b0 + b1 + b2 + w * 0.015) * 0.6;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 340;

      // Gentle slow swell LFO modulating wave cutoff
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.14;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 140;
      lfo.connect(lfoGain).connect(filter.frequency);

      const masterGain = this.ctx.createGain();
      masterGain.gain.value = this.muted || !this.ambientOn ? 0 : 0.055;

      src.connect(filter).connect(masterGain).connect(this.ctx.destination);
      src.start();
      lfo.start();
      this._ambNodes = { src, lfo, masterGain };
    } catch (_) {}
  }

  _noiseBuffer(duration = 0.4) {
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(sr * duration), sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  play(type, vol = 0.6) {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    try {
      switch (type) {
        case 'shot_heavy': {
          // Gemi Pompalısı / Zıpkın Topu (tek kullanımlık büyük patlama)
          const src = this.ctx.createBufferSource();
          src.buffer = this._noiseBuffer(0.35);
          const filter = this.ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(1400, now);
          filter.frequency.exponentialRampToValueAtTime(140, now + 0.32);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(vol * 0.9, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
          src.connect(filter).connect(g).connect(this.ctx.destination);
          src.start(now);

          const osc = this.ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(170, now);
          osc.frequency.exponentialRampToValueAtTime(42, now + 0.22);
          const og = this.ctx.createGain();
          og.gain.setValueAtTime(vol * 0.85, now);
          og.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
          osc.connect(og).connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.25);
          break;
        }
        case 'shot_pistol': {
          // Korsan Tabancası / İşaret Tabancası
          const src = this.ctx.createBufferSource();
          src.buffer = this._noiseBuffer(0.18);
          const filter = this.ctx.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.setValueAtTime(1900, now);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(vol * 0.75, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
          src.connect(filter).connect(g).connect(this.ctx.destination);
          src.start(now);

          const osc = this.ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(340, now);
          osc.frequency.exponentialRampToValueAtTime(85, now + 0.12);
          const og = this.ctx.createGain();
          og.gain.setValueAtTime(vol * 0.5, now);
          og.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
          osc.connect(og).connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.14);
          break;
        }
        case 'empty': {
          // Tükenmiş tek kullanımlık silah tıklaması
          const osc = this.ctx.createOscillator();
          osc.type = 'square';
          osc.frequency.setValueAtTime(520, now);
          osc.frequency.setValueAtTime(380, now + 0.03);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(vol * 0.22, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
          osc.connect(g).connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.08);
          break;
        }
        case 'splash': {
          // Suya çarpma / Dalga darbesi
          const src = this.ctx.createBufferSource();
          src.buffer = this._noiseBuffer(0.28);
          const filter = this.ctx.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.setValueAtTime(900, now);
          filter.frequency.exponentialRampToValueAtTime(300, now + 0.25);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(vol * 0.55, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.27);
          src.connect(filter).connect(g).connect(this.ctx.destination);
          src.start(now);
          break;
        }
        case 'sink': {
          // SUYA GÖMÜLDÜ! Derin batma ve baloncuk sesi
          const src = this.ctx.createBufferSource();
          src.buffer = this._noiseBuffer(0.65);
          const filter = this.ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(1100, now);
          filter.frequency.exponentialRampToValueAtTime(120, now + 0.6);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(vol * 0.85, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
          src.connect(filter).connect(g).connect(this.ctx.destination);
          src.start(now);

          [0, 0.14, 0.27, 0.4].forEach((offset, idx) => {
            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            const base = 360 - idx * 55;
            osc.frequency.setValueAtTime(base, now + offset);
            osc.frequency.exponentialRampToValueAtTime(base * 1.6, now + offset + 0.09);
            const og = this.ctx.createGain();
            og.gain.setValueAtTime(vol * 0.35, now + offset);
            og.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.11);
            osc.connect(og).connect(this.ctx.destination);
            osc.start(now + offset);
            osc.stop(now + offset + 0.12);
          });
          break;
        }
        case 'sonar': {
          const osc = this.ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(1180, now);
          osc.frequency.exponentialRampToValueAtTime(1020, now + 0.55);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(vol * 0.45, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
          osc.connect(g).connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.62);
          break;
        }
        case 'trap': {
          const osc = this.ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(220, now);
          osc.frequency.exponentialRampToValueAtTime(95, now + 0.18);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(vol * 0.55, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
          osc.connect(g).connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.22);
          break;
        }
        case 'flash': {
          const osc = this.ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(2400, now);
          osc.frequency.exponentialRampToValueAtTime(1600, now + 0.45);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(vol * 0.35, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
          osc.connect(g).connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.52);
          break;
        }
        case 'boost': {
          const osc = this.ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(240, now);
          osc.frequency.exponentialRampToValueAtTime(620, now + 0.24);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(vol * 0.38, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
          osc.connect(g).connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.28);
          break;
        }
        case 'hit': {
          const osc = this.ctx.createOscillator();
          osc.type = 'square';
          osc.frequency.setValueAtTime(190, now);
          osc.frequency.exponentialRampToValueAtTime(70, now + 0.11);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(vol * 0.45, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
          osc.connect(g).connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.14);
          break;
        }
        case 'round_start': {
          // Gemi düdüğü!
          [165, 220].forEach((freq) => {
            const osc = this.ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, now);
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(520, now);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.001, now);
            g.gain.linearRampToValueAtTime(vol * 0.32, now + 0.08);
            g.gain.setValueAtTime(vol * 0.32, now + 0.45);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
            osc.connect(filter).connect(g).connect(this.ctx.destination);
            osc.start(now);
            osc.stop(now + 0.88);
          });
          break;
        }
        case 'round_end': {
          [440, 554, 659].forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + i * 0.1);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(vol * 0.35, now + i * 0.1);
            g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.32);
            osc.connect(g).connect(this.ctx.destination);
            osc.start(now + i * 0.1);
            osc.stop(now + i * 0.1 + 0.35);
          });
          break;
        }
        case 'tsunamiWarn': {
          // 🚨 Dev gelgit derin sis düdüğü + uğultu uyarısı
          const osc = this.ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(118, now);
          osc.frequency.linearRampToValueAtTime(142, now + 0.35);
          osc.frequency.linearRampToValueAtTime(104, now + 0.85);
          const lp = this.ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.setValueAtTime(360, now);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0.001, now);
          g.gain.linearRampToValueAtTime(vol * 0.42, now + 0.14);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.92);
          osc.connect(lp).connect(g).connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.95);
          break;
        }
        case 'tsunamiRoar': {
          // 🌊 Dev su duvarı kükremesi!
          const src = this.ctx.createBufferSource();
          src.buffer = this._noiseBuffer(1.15);
          const bp = this.ctx.createBiquadFilter();
          bp.type = 'lowpass';
          bp.frequency.setValueAtTime(320, now);
          bp.frequency.exponentialRampToValueAtTime(1150, now + 0.32);
          bp.frequency.exponentialRampToValueAtTime(260, now + 1.1);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0.001, now);
          g.gain.linearRampToValueAtTime(vol * 0.72, now + 0.22);
          g.gain.exponentialRampToValueAtTime(0.001, now + 1.15);
          src.connect(bp).connect(g).connect(this.ctx.destination);
          src.start(now);
          break;
        }
        case 'tsunamiHit': {
          // 💥 Tsunami su çarpması + derin bas darbesi
          const src = this.ctx.createBufferSource();
          src.buffer = this._noiseBuffer(0.42);
          const bp = this.ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.setValueAtTime(750, now);
          bp.frequency.exponentialRampToValueAtTime(190, now + 0.4);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(vol * 0.78, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
          src.connect(bp).connect(g).connect(this.ctx.destination);
          src.start(now);
          const sub = this.ctx.createOscillator();
          sub.type = 'sine';
          sub.frequency.setValueAtTime(130, now);
          sub.frequency.exponentialRampToValueAtTime(42, now + 0.28);
          const sg = this.ctx.createGain();
          sg.gain.setValueAtTime(vol * 0.52, now);
          sg.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
          sub.connect(sg).connect(this.ctx.destination);
          sub.start(now);
          sub.stop(now + 0.31);
          break;
        }
        case 'slash': {
          // ⚔️ Çelik pala / mızrak savurma sesi
          const src = this.ctx.createBufferSource();
          src.buffer = this._noiseBuffer(0.18);
          const bp = this.ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.setValueAtTime(2200, now);
          bp.frequency.exponentialRampToValueAtTime(520, now + 0.16);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(vol * 0.55, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
          src.connect(bp).connect(g).connect(this.ctx.destination);
          src.start(now);
          const osc = this.ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(780, now);
          osc.frequency.exponentialRampToValueAtTime(320, now + 0.12);
          const og = this.ctx.createGain();
          og.gain.setValueAtTime(vol * 0.22, now);
          og.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
          osc.connect(og).connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.14);
          break;
        }
        case 'parry': {
          // ✨ Mermi kesme / çelik çınlaması!
          [1680, 2320].forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.02);
            osc.frequency.exponentialRampToValueAtTime(freq * 1.18, now + 0.26);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(vol * 0.36, now + idx * 0.02);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
            osc.connect(g).connect(this.ctx.destination);
            osc.start(now + idx * 0.02);
            osc.stop(now + 0.29);
          });
          break;
        }
        case 'oar_whack': {
          // 🪵 Dev kürek ağır ahşap darbesi + su patlaması!
          const osc = this.ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(210, now);
          osc.frequency.exponentialRampToValueAtTime(62, now + 0.19);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(vol * 0.65, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
          osc.connect(g).connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.23);
          const src = this.ctx.createBufferSource();
          src.buffer = this._noiseBuffer(0.22);
          const lp = this.ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.setValueAtTime(860, now);
          const ng = this.ctx.createGain();
          ng.gain.setValueAtTime(vol * 0.48, now);
          ng.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
          src.connect(lp).connect(ng).connect(this.ctx.destination);
          src.start(now);
          break;
        }
        case 'ping': {
          // 📍 2v2 Takım Sinyali çift parlak bip!
          [880, 1180].forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.07);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(vol * 0.28, now + idx * 0.07);
            g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.14);
            osc.connect(g).connect(this.ctx.destination);
            osc.start(now + idx * 0.07);
            osc.stop(now + idx * 0.07 + 0.15);
          });
          break;
        }
        case 'ui': {
          const osc = this.ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(640, now);
          osc.frequency.exponentialRampToValueAtTime(840, now + 0.06);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(vol * 0.18, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
          osc.connect(g).connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.08);
          break;
        }
      }
    } catch (_) {
      // Ignore audio errors
    }
  }
}

export const sfx = new SoundEngine();
