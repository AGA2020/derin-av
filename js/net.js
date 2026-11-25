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

  disconnect() {
    this._closing = true;
    this.connected = false;
    if (this.client) {
      try { this.client.end(true); } catch (_) {}
      this.client = null;
    }
  }
}
