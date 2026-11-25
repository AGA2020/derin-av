// Online 2v2 Multiplayer Transport over WSS MQTT (NAT/CGNAT sorunsuz, tarayıcıda direkt çalışır)

const BROKERS = [
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://broker.emqx.io:8084/mqtt'
];

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export function generateClientId() {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

export class NetClient {
  constructor({ onStatus, onMessage }) {
    this.onStatus = onStatus || (() => {});
    this.onMessage = onMessage || (() => {});
    this.client = null;
    this.roomCode = null;
    this.isHost = false;
    this.clientId = generateClientId();
    this.connected = false;
    this.brokerIndex = 0;
    this._closing = false;
  }

  get c2hTopic() {
    return `derinav2v2/r/${this.roomCode}/c2h`;
  }

  get h2cTopic() {
    return `derinav2v2/r/${this.roomCode}/h2c`;
  }

  connect(roomCode, isHost) {
    this.disconnect();
    this._closing = false;
    this.roomCode = roomCode.toUpperCase().trim();
    this.isHost = isHost;
    this.brokerIndex = 0;
    this._tryConnect();
  }

  _tryConnect() {
    if (this._closing) return;
    const url = BROKERS[this.brokerIndex % BROKERS.length];
    this.onStatus('connecting', `Sunucuya bağlanılıyor (${this.brokerIndex + 1}/${BROKERS.length})...`);

    if (typeof window.mqtt === 'undefined') {
      this.onStatus('error', 'MQTT kütüphanesi yüklenemedi.');
      return;
    }

    let settled = false;
    const fallbackTimer = setTimeout(() => {
      if (!settled && !this._closing) {
        settled = true;
        try { this.client?.end(true); } catch (_) {}
        this.brokerIndex++;
        if (this.brokerIndex < BROKERS.length * 2) {
          this._tryConnect();
        } else {
          this.onStatus('error', 'Online sunucuya bağlanılamadı. Tekrar deneyin.');
        }
      }
    }, 5500);

    const cli = window.mqtt.connect(url, {
      clientId: `derinav_${this.clientId}_${Math.floor(Math.random() * 9999)}`,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 2500,
      keepalive: 25
    });
    this.client = cli;

    cli.on('connect', () => {
      if (this._closing) {
        cli.end(true);
        return;
      }
      settled = true;
      clearTimeout(fallbackTimer);
      this.connected = true;
      const subTopic = this.isHost ? this.c2hTopic : this.h2cTopic;
      cli.subscribe(subTopic, { qos: 0 }, (err) => {
        if (err) {
          this.onStatus('error', 'Oda kanalına abone olunamadı.');
          return;
        }
        this.onStatus('connected', `Oda ${this.roomCode} bağlı`);
      });
    });

    cli.on('message', (_topic, payload) => {
      try {
        const msg = JSON.parse(payload.toString());
        if (msg && msg.from !== this.clientId) {
          this.onMessage(msg);
        }
      } catch (_) {}
    });

    cli.on('reconnect', () => {
      if (!this._closing) {
        this.onStatus('reconnecting', 'Yeniden bağlanılıyor...');
      }
    });

    cli.on('error', () => {
      if (!settled && !this._closing) {
        settled = true;
        clearTimeout(fallbackTimer);
        try { cli.end(true); } catch (_) {}
        this.brokerIndex++;
        if (this.brokerIndex < BROKERS.length * 2) {
          this._tryConnect();
        } else {
          this.onStatus('error', 'Bağlantı hatası oluştu.');
        }
      }
    });
  }

  send(msg) {
    if (!this.client || !this.connected) return;
    const topic = this.isHost ? this.h2cTopic : this.c2hTopic;
    const packet = JSON.stringify({ ...msg, from: this.clientId });
    try {
      this.client.publish(topic, packet, { qos: 0 });
    } catch (_) {}
  }

  publishRetained(topic, data) {
    if (!this.client || !this.connected) return;
    try {
      this.client.publish(topic, JSON.stringify(data), { qos: 0, retain: true });
    } catch (_) {}
  }

  disconnect() {
    this._closing = true;
    this.connected = false;
    if (this.client) {
      try { this.client.end(true); } catch (_) {}
      this.client = null;
    }
  }
}

// Retained telemetri kanalını okur. Telemetri her zaman BROKERS[0]'a yazılır (host o sunucudaysa);
// yine de iki sunucuyu da deneyip bulunan tüm host kayıtlarını birleştirir.
// Hiçbir sunucuya bağlanılamazsa reject eder (panel "bulut okunamadı" der).
export function fetchCloudTelemetry(topicPrefix, timeoutMs = 3000) {
  const readOne = (url) => new Promise((resolve) => {
    const collected = new Map();
    let connected = false;
    let done = false;
    let cli = null;
    const finish = () => {
      if (done) return;
      done = true;
      try { cli?.end(true); } catch (_) {}
      resolve({ connected, list: [...collected.entries()] });
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      cli = window.mqtt.connect(url, {
        clientId: `derinav_adm_${Math.random().toString(36).slice(2, 8)}`,
        clean: true,
        connectTimeout: Math.min(2800, timeoutMs),
        reconnectPeriod: 0
      });
      cli.on('connect', () => {
        connected = true;
        cli.subscribe(`${topicPrefix}/#`, { qos: 0 });
      });
      cli.on('message', (topic, payload) => {
        try {
          const obj = JSON.parse(payload.toString());
          if (obj && typeof obj === 'object' && obj.items) collected.set(topic, obj);
        } catch (_) {}
      });
      cli.on('error', () => { clearTimeout(timer); finish(); });
    } catch (_) {
      clearTimeout(timer);
      finish();
    }
  });

  if (typeof window === 'undefined' || typeof window.mqtt === 'undefined') {
    return Promise.reject(new Error('mqtt yok'));
  }
  return Promise.all(BROKERS.map(readOne)).then((results) => {
    if (!results.some(r => r.connected)) throw new Error('bulut okunamadı');
    // Aynı host kanalı iki sunucuda varsa daha güncel olanı al
    const byTopic = new Map();
    for (const r of results) {
      for (const [topic, obj] of r.list) {
        const prev = byTopic.get(topic);
        if (!prev || (obj.updatedAt || '') > (prev.updatedAt || '')) byTopic.set(topic, obj);
      }
    }
    return [...byTopic.values()];
  });
}

// Davet linkindeki odanın hâlâ aktif (Host'un canlı) olup olmadığını hızlıca yoklar.
// Host 'pingRoom' alınca anında 'pongRoom' döner (~150ms); yanıt yoksa oda kapanmıştır.
export function checkRoomAlive(roomCode, timeoutMs = 2600) {
  const code = String(roomCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (!code || typeof window === 'undefined' || typeof window.mqtt === 'undefined') {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let settled = false;
    const clients = [];
    const finish = (alive) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const c of clients) {
        try { c.end(true); } catch (_) {}
      }
      resolve(alive);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const probeId = `probe_${Math.random().toString(36).slice(2, 8)}`;
    const h2c = `derinav2v2/r/${code}/h2c`;
    const c2h = `derinav2v2/r/${code}/c2h`;

    for (const url of BROKERS) {
      try {
        const cli = window.mqtt.connect(url, {
          clientId: `derinav_${probeId}_${Math.floor(Math.random() * 999)}`,
          clean: true,
          connectTimeout: 2200,
          reconnectPeriod: 0
        });
        clients.push(cli);
        cli.on('connect', () => {
          if (settled) { try { cli.end(true); } catch (_) {} return; }
          cli.subscribe(h2c, { qos: 0 }, (err) => {
            if (!err && !settled) {
              try { cli.publish(c2h, JSON.stringify({ type: 'pingRoom', from: probeId }), { qos: 0 }); } catch (_) {}
            }
          });
        });
        cli.on('message', (_topic, payload) => {
          try {
            const msg = JSON.parse(payload.toString());
            if (msg && msg.from && msg.from !== probeId) {
              finish(true);
            }
          } catch (_) {}
        });
        cli.on('error', () => {
          try { cli.end(true); } catch (_) {}
        });
      } catch (_) {}
    }
  });
}
