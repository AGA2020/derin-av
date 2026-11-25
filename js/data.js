// DERİN AV — 2v2 Denizde Av & Avcı Oyun Verileri
// 6 Oynanabilir Çar, 2 İtemli Sistem, Ateşli Silahlar Tek Kullanımlık, Deniz Power-Up'ları

export const GAME_VERSION = 'v2.4';
export const CHANGELOG = [
  {
    ver: 'v2.4',
    notes: [
      '🌪️ YENİ MEKANİK: Turun son 25 saniyesinde Dev Fırtına Çemberi daralmaya başlar!',
      'Fırtına dışında kalanlar hızla su alır; rakipleri fırtınaya itip batırma taktiği artık mümkün!'
    ]
  },
  {
    ver: 'v2.3',
    notes: [
      '🛟 YENİ MEKANİK: Suya gömülen takım arkadaşının yerinde 15 sn boyunca Kurtarma Şamandırası kalır!',
      'Hayattaki takım arkadaşı şamandıra halkasında 3 sn durursa arkadaşını %55 canla sudan geri çıkarır (tur başı 1 kez).'
    ]
  },
  {
    ver: 'v2.2',
    notes: [
      'Normal sekmede eski önbellek yüzünden butonların tepki vermemesi sorunu tamamen çözüldü.'
    ]
  },
  {
    ver: 'v2.1',
    notes: [
      'Sağ alt köşeye sürüm etiketi ve yama notları eklendi.',
      'Host ile farklı sürümde olan oyuncular için otomatik yenileme uyarısı eklendi.'
    ]
  },
  {
    ver: 'v2.0',
    notes: [
      'Lag azaltma: istemci hareket tahmini (0ms tepki) ve 28Hz akıcı senkronizasyon.',
      'Host Alt+Tab donma sorunu Web Worker zamanlayıcı ile tamamen çözüldü.',
      'Haritaya 5 çeşit deniz Power-Up sandığı eklendi (Can, Kalkan, Hız, +1 Şarj, Radar).',
      '6 çarın canları %65+ artırıldı ve hasarlar dengelendi (tur süresi 85 sn).'
    ]
  },
  {
    ver: 'v1.0',
    notes: [
      'İlk sürüm: 2v2 Denizde Av & Avcı, her tur değişen roller, 6 çar, 2 item ve tek kullanımlık ateşli silahlar.'
    ]
  }
];

export const WORLD_W = 1600;
export const WORLD_H = 1000;
export const ROUND_DURATION = 85; // dengeli taktiksel kovalamaca süresi (sn)
export const DRAFT_DURATION = 22; // item seçme süresi (sn)
export const MAX_ITEMS = 2;

export const POWERUP_TYPES = [
  {
    id: 'heal',
    name: 'Can Simidi',
    label: '+50 DİRENÇ',
    icon: '🛟',
    color: '#06d6a0',
    desc: '+50 Su Üstü Direnci yeniler'
  },
  {
    id: 'shield',
    name: 'Çelik Gövde',
    label: '+45 KALKAN',
    icon: '🛡️',
    color: '#38bdf8',
    desc: '8 sn boyunca 45 hasar emen kalkan'
  },
  {
    id: 'speed',
    name: 'Rüzgar Akıntısı',
    label: 'HIZ +35%',
    icon: '⚡',
    color: '#ffd166',
    desc: '5 sn boyunca +%35 deniz hızı'
  },
  {
    id: 'reload',
    name: 'Cephane Sandığı',
    label: '+1 ŞARJ',
    icon: '📦',
    color: '#ff6b6b',
    desc: 'Tükenmiş bir itemine +1 kullanım ekler!'
  },
  {
    id: 'reveal',
    name: 'Fener Gözü',
    label: 'RADAR 3.5s',
    icon: '👁️',
    color: '#c084fc',
    desc: 'Düşmanları 3.5 sn haritada açığa çıkarır'
  }
];

export const POWERUP_MAP = Object.fromEntries(POWERUP_TYPES.map(p => [p.id, p]));

export const CHARACTERS = [
  {
    id: 'kaptan',
    name: 'Kaptan Kara',
    roleTag: 'Zırhlı Denizci',
    icon: '⚓',
    color: '#e09f3e',
    accent: '#ffd166',
    hp: 220,
    speed: 208,
    vision: 390,
    wakeMult: 1.0,
    cdMult: 1.0,
    projSpeedMult: 1.0,
    whirlpoolResist: 0.2,
    firstHitReduction: 0.25,
    passive: 'En yüksek su üstü direnci (220) ve her turda ilk isabetten %25 daha az batar.',
    stats: { hp: 5, speed: 3, utility: 3 }
  },
  {
    id: 'kopekbaligi',
    name: 'Köpekbalığı',
    roleTag: 'Hızlı Avcı',
    icon: '🦈',
    color: '#ef476f',
    accent: '#ff8fa3',
    hp: 175,
    speed: 238,
    vision: 395,
    wakeMult: 1.12,
    cdMult: 0.95,
    projSpeedMult: 1.05,
    whirlpoolResist: 0.2,
    dashBoost: 1.22,
    passive: 'En yüksek seyir hızı; SPACE dalga hamlesi %22 daha güçlü ve uzağa uzanır.',
    stats: { hp: 3, speed: 5, utility: 3 }
  },
  {
    id: 'hayalet',
    name: 'Sis Hayaleti',
    roleTag: 'Korsan Gölgesi',
    icon: '👻',
    color: '#8ecae6',
    accent: '#caf0f8',
    hp: 165,
    speed: 224,
    vision: 400,
    wakeMult: 0.45,
    cdMult: 1.0,
    projSpeedMult: 1.0,
    whirlpoolResist: 0.15,
    stealthBonus: true,
    passive: 'Köpük ve ses izi %55 daha küçük; deniz sisinde düşmana çok yakınken bile gizli kalır.',
    stats: { hp: 2, speed: 4, utility: 5 }
  },
  {
    id: 'fenerci',
    name: 'Fenerci',
    roleTag: 'Keskin Gözcü',
    icon: '🔦',
    color: '#f4a261',
    accent: '#ffe8d6',
    hp: 180,
    speed: 214,
    vision: 495,
    wakeMult: 1.0,
    cdMult: 1.0,
    projSpeedMult: 1.25,
    whirlpoolResist: 0.15,
    passive: '+%25 daha geniş görüş menzili; ateşli silah mermileri %25 daha hızlı gider.',
    stats: { hp: 3, speed: 3, utility: 5 }
  },
  {
    id: 'ahtapot',
    name: 'Ahtapot',
    roleTag: 'Tuzak Ustası',
    icon: '🐙',
    color: '#9b5de5',
    accent: '#d8bbff',
    hp: 190,
    speed: 216,
    vision: 400,
    wakeMult: 0.9,
    cdMult: 0.78,
    projSpeedMult: 1.05,
    whirlpoolResist: 0.25,
    trapBonus: 1.2,
    passive: 'Tuzak, ağ ve yardımcı eşyaların bekleme süresi %22 kısa, etki alanı %20 geniş.',
    stats: { hp: 4, speed: 3, utility: 5 }
  },
  {
    id: 'dalgabinici',
    name: 'Dalga Binicisi',
    roleTag: 'Çevik Sörfçü',
    icon: '🌊',
    color: '#06d6a0',
    accent: '#9bf6ff',
    hp: 175,
    speed: 232,
    vision: 405,
    wakeMult: 0.85,
    cdMult: 0.9,
    projSpeedMult: 1.0,
    whirlpoolResist: 0.55,
    turnBonus: true,
    passive: 'Süper çevik manevra, girdap çekiminden %55 daha az etkilenir, SPACE beklemesi kısa.',
    stats: { hp: 3, speed: 5, utility: 4 }
  }
];

export const CHAR_MAP = Object.fromEntries(CHARACTERS.map(c => [c.id, c]));

// AVCILARIN İTEMLERİ (2 adet seçilir)
// firearm: true => TEK KULLANIMLIK (uses: 1)
export const HUNTER_ITEMS = [
  {
    id: 'harpoon_cannon',
    name: 'Zıpkın Topu',
    icon: '🎯',
    category: 'ATEŞLİ SİLAH',
    firearm: true,
    uses: 1,
    cooldown: 0.5,
    range: 740,
    speed: 980,
    damage: 78,
    knockback: 250,
    slowDur: 1.5,
    desc: 'TEK KULLANIMLIK! Lazer nişangahlı uzun menzil zıpkın (78 Batırma Hasarı + yavaşlatma).'
  },
  {
    id: 'blunderbuss',
    name: 'Gemi Pompalısı',
    icon: '💥',
    category: 'ATEŞLİ SİLAH',
    firearm: true,
    uses: 1,
    cooldown: 0.5,
    range: 340,
    speed: 760,
    pellets: 5,
    spread: 0.34,
    damage: 21, // 5 x 21 = 105 maks yakın hasar (tek atışta öldürmez ama fena batırır!)
    knockback: 210,
    desc: 'TEK KULLANIMLIK! Yakından 5 iri saçma fırlatır (maks. 105 Batırma Hasarı + sert dalga itmesi).'
  },
  {
    id: 'flare_gun',
    name: 'İşaret Tabancası',
    icon: '🔫',
    category: 'ATEŞLİ SİLAH',
    firearm: true,
    uses: 1,
    cooldown: 0.5,
    range: 620,
    speed: 780,
    damage: 58,
    knockback: 180,
    flareRadius: 265,
    flareDur: 10.0,
    desc: 'TEK KULLANIMLIK! 58 Batırma Hasarı verir ve düştüğü yeri 10 sn aydınlatıp sisleri dağıtır.'
  },
  {
    id: 'sonar',
    name: 'Denizaltı Sonarı',
    icon: '📡',
    category: 'YARDIMCI',
    firearm: false,
    uses: 2,
    cooldown: 11,
    revealDur: 3.2,
    desc: 'Geniş sonar dalgası yayar; tüm Avları 3.2 sn boyunca kayalık ve sis arkasından gösterir.'
  },
  {
    id: 'anchor_trap',
    name: 'Ağır Çapa',
    icon: '⚓',
    category: 'TUZAK',
    firearm: false,
    uses: 2,
    cooldown: 6,
    trapRadius: 44,
    damage: 30,
    rootDur: 2.1,
    desc: 'Suya gizli çapa bırakır; basan Avı 2.1 sn kilitler, 30 Batırma Hasarı verir ve açığa çıkarır.'
  },
  {
    id: 'capture_net',
    name: 'Balıkçı Ağı',
    icon: '🕸️',
    category: 'KONTROL',
    firearm: false,
    uses: 2,
    cooldown: 8,
    range: 440,
    speed: 600,
    slowDur: 2.6,
    slowFactor: 0.3,
    damage: 16,
    desc: 'Fırlatılan geniş ağ isabet ettiği Avı 2.6 sn boyunca %70 yavaşlatır.'
  },
  {
    id: 'storm_surge',
    name: 'Fırtına Türbini',
    icon: '⚡',
    category: 'HIZ',
    firearm: false,
    uses: 2,
    cooldown: 11,
    dur: 4.0,
    speedMult: 1.4,
    desc: '4 sn boyunca +%40 deniz hızı ve güçlendirilmiş suya bastırma darbesi verir.'
  },
  {
    id: 'grapple_hook',
    name: 'Çekiş Kancası',
    icon: '🪝',
    category: 'KONTROL',
    firearm: false,
    uses: 2,
    cooldown: 9,
    range: 470,
    speed: 800,
    damage: 24,
    desc: 'İsabet ettiği Avı direkt sana doğru çeker ve 24 Batırma Hasarı verir.'
  }
];

// AVLARIN İTEMLERİ (2 adet seçilir)
// firearm: true => TEK KULLANIMLIK (uses: 1)
export const PREY_ITEMS = [
  {
    id: 'flintlock',
    name: 'Korsan Tabancası',
    icon: '🔫',
    category: 'ATEŞLİ SİLAH',
    firearm: true,
    uses: 1,
    cooldown: 0.5,
    range: 560,
    speed: 840,
    damage: 58,
    knockback: 260,
    stunDur: 1.35,
    desc: 'TEK KULLANIMLIK! Savunma silahı: Avcıya 58 Batırma Hasarı verir ve 1.35 sn sersemletir.'
  },
  {
    id: 'hand_mortar',
    name: 'Kısa Namlu Top',
    icon: '💣',
    category: 'ATEŞLİ SİLAH',
    firearm: true,
    uses: 1,
    cooldown: 0.5,
    range: 320,
    speed: 700,
    pellets: 3,
    spread: 0.36,
    damage: 24,
    knockback: 450,
    desc: 'TEK KULLANIMLIK! Yakından patlayıcı 3 saçma atar ve Avcıyı şiddetli dalgayla geri savurur.'
  },
  {
    id: 'ink_cloud',
    name: 'Mürekkep Bulutu',
    icon: '🦑',
    category: 'GİZLİLİK',
    firearm: false,
    uses: 2,
    cooldown: 11,
    radius: 140,
    dur: 6.5,
    desc: 'Suya dev siyah mürekkep bulutu salar (6.5 sn); içindekiler görünmez ve sonardan saklanır.'
  },
  {
    id: 'flash_flare',
    name: 'Kör Edici Fener',
    icon: '✨',
    category: 'KONTROL',
    firearm: false,
    uses: 2,
    cooldown: 10,
    range: 390,
    blastRadius: 160,
    blindDur: 2.2,
    desc: 'Atılan flaş kapsülü yakındaki Avcıları 2.2 sn kör eder ve yavaşlatır.'
  },
  {
    id: 'decoy_buoy',
    name: 'Sahte Klon Tekne',
    icon: '🛟',
    category: 'ALDATMA',
    firearm: false,
    uses: 2,
    cooldown: 10,
    dur: 5.5,
    speed: 235,
    desc: 'İleri doğru köpük izi bırakarak ilerleyen sahte bir kopya yollar, Avcıları şaşırtır.'
  },
  {
    id: 'jet_stream',
    name: 'Jet Akıntısı',
    icon: '💨',
    category: 'KAÇIŞ',
    firearm: false,
    uses: 2,
    cooldown: 11,
    dur: 3.6,
    speedMult: 1.44,
    desc: '3.6 sn boyunca +%44 hız, sessiz süzülme ve ağ/yavaşlatma etkilerini anında temizler.'
  },
  {
    id: 'sea_mine',
    name: 'Su Altı Mayını',
    icon: '✹',
    category: 'TUZAK',
    firearm: false,
    uses: 2,
    cooldown: 7,
    trapRadius: 48,
    damage: 32,
    stunDur: 1.8,
    desc: 'Suya mayın bırakır; yaklaşan Avcıyı patlatıp 1.8 sn sersemletir ve 32 Batırma Hasarı verir.'
  },
  {
    id: 'buoyancy_kit',
    name: 'Can Simidi Kiti',
    icon: '🛟',
    category: 'HAYATTA KALMA',
    firearm: false,
    uses: 1,
    cooldown: 4,
    healSelf: 78,
    healAlly: 42,
    allyRadius: 240,
    desc: 'Suya batmanı önler! +78 Su Üstü Direnci yeniler (yakındaki dostuna da +42 kazandırır).'
  }
];

export const ALL_ITEMS = Object.fromEntries(
  [...HUNTER_ITEMS, ...PREY_ITEMS].map(i => [i.id, i])
);

// 3 DÖNÜŞÜMLÜ DENİZ HARİTASI (Power-up noktaları dahil)
export const SEA_MAPS = [
  {
    id: 'firtina_bogazi',
    name: 'Fırtına Boğazı',
    subtitle: 'Merkezde batık gemi, iki yanda derin girdaplar ve sis cepleri',
    theme: { deep: '#051624', mid: '#09273d', foam: 'rgba(165, 228, 255, 0.14)' },
    hunterSpawns: [
      { x: 150, y: 380 },
      { x: 150, y: 620 }
    ],
    preySpawns: [
      { x: 1440, y: 320 },
      { x: 1440, y: 680 }
    ],
    powerupSpots: [
      { x: 800, y: 500 },
      { x: 520, y: 340 },
      { x: 1080, y: 660 },
      { x: 520, y: 660 },
      { x: 1080, y: 340 },
      { x: 800, y: 65 },
      { x: 800, y: 935 },
      { x: 300, y: 200 },
      { x: 1300, y: 800 }
    ],
    rocks: [
      { type: 'ship', x: 710, y: 445, w: 180, h: 110, label: 'BATIK' },
      { type: 'rock', x: 420, y: 230, r: 58 },
      { type: 'rock', x: 420, y: 770, r: 58 },
      { type: 'rock', x: 1180, y: 230, r: 58 },
      { type: 'rock', x: 1180, y: 770, r: 58 },
      { type: 'rock', x: 800, y: 155, r: 48 },
      { type: 'rock', x: 800, y: 845, r: 48 },
      { type: 'rock', x: 560, y: 500, r: 40 },
      { type: 'rock', x: 1040, y: 500, r: 40 }
    ],
    fogs: [
      { x: 310, y: 500, r: 95 },
      { x: 1290, y: 500, r: 95 },
      { x: 640, y: 270, r: 85 },
      { x: 960, y: 730, r: 85 },
      { x: 960, y: 270, r: 80 },
      { x: 640, y: 730, r: 80 }
    ],
    whirlpools: [
      { x: 800, y: 310, r: 78, pull: 125, dps: 16 },
      { x: 800, y: 690, r: 78, pull: 125, dps: 16 }
    ]
  },
  {
    id: 'korsan_enkazi',
    name: 'Korsan Enkazı',
    subtitle: 'Parçalanmış gemi gövdeleri, yoğun sis koridorları ve dar geçitler',
    theme: { deep: '#061922', mid: '#0c2f3b', foam: 'rgba(145, 240, 220, 0.13)' },
    hunterSpawns: [
      { x: 165, y: 220 },
      { x: 165, y: 780 }
    ],
    preySpawns: [
      { x: 1430, y: 240 },
      { x: 1430, y: 760 }
    ],
    powerupSpots: [
      { x: 580, y: 500 },
      { x: 1020, y: 500 },
      { x: 960, y: 240 },
      { x: 640, y: 760 },
      { x: 360, y: 490 },
      { x: 1240, y: 510 },
      { x: 800, y: 90 },
      { x: 800, y: 910 }
    ],
    rocks: [
      { type: 'ship', x: 430, y: 330, w: 170, h: 72, label: 'ENKAZ' },
      { type: 'ship', x: 1000, y: 598, w: 170, h: 72, label: 'ENKAZ' },
      { type: 'ship', x: 755, y: 170, w: 90, h: 175, label: 'GÜVERTE' },
      { type: 'ship', x: 755, y: 655, w: 90, h: 175, label: 'GÜVERTE' },
      { type: 'rock', x: 350, y: 670, r: 52 },
      { type: 'rock', x: 1250, y: 330, r: 52 },
      { type: 'rock', x: 800, y: 500, r: 44 }
    ],
    fogs: [
      { x: 580, y: 500, r: 105 },
      { x: 1020, y: 500, r: 105 },
      { x: 320, y: 170, r: 85 },
      { x: 1280, y: 830, r: 85 },
      { x: 1220, y: 170, r: 85 },
      { x: 380, y: 830, r: 85 }
    ],
    whirlpools: [
      { x: 560, y: 210, r: 70, pull: 118, dps: 15 },
      { x: 1040, y: 790, r: 70, pull: 118, dps: 15 }
    ]
  },
  {
    id: 'girdap_koyu',
    name: 'Girdap Koyu',
    subtitle: 'Açık deniz kovalamacası ve üç ölümcül derin girdap!',
    theme: { deep: '#041226', mid: '#0a2246', foam: 'rgba(160, 210, 255, 0.15)' },
    hunterSpawns: [
      { x: 170, y: 420 },
      { x: 170, y: 580 }
    ],
    preySpawns: [
      { x: 1430, y: 400 },
      { x: 1430, y: 600 }
    ],
    powerupSpots: [
      { x: 800, y: 355 },
      { x: 800, y: 645 },
      { x: 470, y: 250 },
      { x: 1130, y: 750 },
      { x: 470, y: 750 },
      { x: 1130, y: 250 },
      { x: 650, y: 580 },
      { x: 950, y: 420 }
    ],
    rocks: [
      { type: 'rock', x: 470, y: 500, r: 52 },
      { type: 'rock', x: 1130, y: 500, r: 52 },
      { type: 'rock', x: 800, y: 220, r: 54 },
      { type: 'rock', x: 800, y: 780, r: 54 },
      { type: 'rock', x: 580, y: 210, r: 38 },
      { type: 'rock', x: 1020, y: 210, r: 38 },
      { type: 'rock', x: 580, y: 790, r: 38 },
      { type: 'rock', x: 1020, y: 790, r: 38 }
    ],
    fogs: [
      { x: 340, y: 290, r: 95 },
      { x: 340, y: 710, r: 95 },
      { x: 1260, y: 290, r: 95 },
      { x: 1260, y: 710, r: 95 }
    ],
    whirlpools: [
      { x: 800, y: 500, r: 94, pull: 145, dps: 19 },
      { x: 590, y: 390, r: 66, pull: 112, dps: 15 },
      { x: 1010, y: 610, r: 66, pull: 112, dps: 15 }
    ]
  }
];
