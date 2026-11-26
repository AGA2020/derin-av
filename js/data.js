// DERİN AV — 2v2 Denizde Av & Avcı Oyun Verileri
// 6 Oynanabilir Çar, 2 İtemli Sistem, Ateşli Silahlar Tek Kullanımlık, Deniz Power-Up'ları

export const GAME_VERSION = 'v5.2';
export const EMOTES = ['😂', '🦈', '🔥', '💀'];

// 🎲 RASTGELE TUR OLAYLARI (Lobi Ayarında Aç/Kapa!)
export const ROUND_EVENTS = [
  { id: 'barut_yagmuru', name: 'Barut Yağmuru', icon: '🧨', color: '#ff6b35', desc: 'Haritada 2 kat barut fıçısı ve hızlı yenilenme!' },
  { id: 'seken_mermiler', name: 'Seken Mermiler', icon: '🎱', color: '#38bdf8', desc: 'Mermiler, zıpkınlar ve ağlar kayalardan 2 kez seker!' },
  { id: 'gece_sisi', name: 'Karanlık Gece Sisi', icon: '🌫️', color: '#94a3b8', desc: 'Görüş mesafesi %30 daralır — tam gerilim ve pusu!' },
  { id: 'kasirga_hizi', name: 'Kasırga Hızı', icon: '⚡', color: '#38bdf8', desc: 'Tüm tekneler +%25 daha hızlı süzülür!' },
  { id: 'derin_deniz', name: 'Sonsuz Derinlik', icon: '🤿', color: '#06d6a0', desc: 'Su altında nefes tüketimi yarıya iner (%50)!' },
  { id: 'hazine_firtinasi', name: 'Hazine Fırtınası', icon: '📦', color: '#c084fc', desc: '4 deniz sandığı ile başlar ve 2 kat hızlı çıkar!' },
  { id: 'kraken_uyanisi', name: 'Kraken Uyanışı', icon: '🐙', color: '#d946ef', desc: 'Merkezde dev Kraken uyanır — son vuruş +1 silah & +50 kalkan verir!' }
];
export const ROUND_EVENT_MAP = Object.fromEntries(ROUND_EVENTS.map(e => [e.id, e]));

// 🚩 TEKNE RENGİ & KÖPÜK İZİ KİŞİSELLEŞTİRME
export const BOAT_SKINS = [
  { id: 'auto', name: 'Çar Rengi', icon: '⚓', hull: null, wake: '210, 245, 255' },
  { id: 'gold', name: 'Altın Korsan', icon: '👑', hull: '#ffb703', wake: '255, 220, 120' },
  { id: 'crimson', name: 'Kızıl Alev', icon: '🔥', hull: '#ef476f', wake: '255, 130, 155' },
  { id: 'neon', name: 'Neon Turkuaz', icon: '💎', hull: '#00f5d4', wake: '100, 255, 235' },
  { id: 'phantom', name: 'Hayalet Mor', icon: '👻', hull: '#a855f7', wake: '205, 160, 255' },
  { id: 'emerald', name: 'Zümrüt', icon: '🐉', hull: '#22c55e', wake: '125, 250, 175' }
];
export const BOAT_SKIN_MAP = Object.fromEntries(BOAT_SKINS.map(s => [s.id, s]));

// 🌿 3 DALLI MAÇ İÇİ YETENEK AĞACI (Her tur +1 Yetenek Puanı!)
export const SKILL_TREE = [
  {
    branch: 'atk',
    title: '⚔️ Saldırı',
    color: '#ffb703',
    nodes: [
      { id: 'atk1', tier: 1, name: 'Keskin Barut', icon: '💥', desc: '+%12 tüm saldırı & fıçı hasarı' },
      { id: 'atk2', tier: 2, name: 'Hızlı Hamle', icon: '🌊', desc: 'SPACE bekleme süresi -%22' },
      { id: 'atk3', tier: 3, name: 'Keskin Nişancı', icon: '🎯', desc: '+%15 mermi hızı & ilk silah isabetinde +1 mermi iadesi' }
    ]
  },
  {
    branch: 'deep',
    title: '🤿 Derinlik',
    color: '#38bdf8',
    nodes: [
      { id: 'deep1', tier: 1, name: 'Geniş Ciğer', icon: '🫁', desc: '+22 Maksimum Nefes' },
      { id: 'deep2', tier: 2, name: 'Yüzgeç Hızı', icon: '🦈', desc: 'Su altı hız +%14, nefes tüketimi -%15' },
      { id: 'deep3', tier: 3, name: 'Jaws Çıkışı', icon: '⚡', desc: 'Sürpriz Çıkış +0.7s slow & +15 şok' }
    ]
  },
  {
    branch: 'def',
    title: '🛡️ Dayanıklılık',
    color: '#06d6a0',
    nodes: [
      { id: 'def1', tier: 1, name: 'Meşe Gövde', icon: '🛡️', desc: '+28 Maksimum Batma Direnci' },
      { id: 'def2', tier: 2, name: 'Derin Soluk', icon: '💨', desc: 'Nefes %30 hızlı ve 0.7s erken dolar' },
      { id: 'def3', tier: 3, name: 'Usta Denizci', icon: '⚓', desc: 'Yardımcı/Tuzak CD -%20 & +%6 hız' }
    ]
  }
];

export const SKILL_NODE_MAP = Object.fromEntries(
  SKILL_TREE.flatMap(b => b.nodes.map((n, i) => [n.id, { ...n, branch: b.branch, prereq: i > 0 ? b.nodes[i - 1].id : null }]))
);

export const CHANGELOG = [
  {
    ver: 'v5.2',
    notes: [
      '✨ 3D GÖRSELLİK DEVRİMİ (WIND WAKER / BRAWL STARS KALİTESİ):',
      '🌊 Gerçek GPU GLSL Okyanus Shader’ı: Organik akan Voronoi su köpüğü ağı, dalga tepelerinde yakamoz parıltıları ve her adanın dibinde parlak turkuaz sığ su halkası!',
      '⛵ Kutu Modeller Gitti — Gerçek Kavisli 3D Modeller + Çizgi-Film Konturu (Toon Outline): Sivri burunlu kalyon, yan toplar, kavisli şişkin yelken, sallanan bayrak, organik köpekbalığı, kıvrımlı ahtapot dokunaçları, kapaklı hazine sandıkları ve halatlı ahşap barikatlar!',
      '🎨 Haritalara Özel Işık Paletleri + Namludan Barut Dumanı + Gemilerin 2.1 saniye yana yatarak köpükler içinde 3D batma animasyonu!'
    ]
  },
  {
    ver: 'v5.1',
    notes: [
      '🧊 3D ARTIK VARSAYILAN GÖRÜNÜM! (WebGL olmayan cihazlar otomatik 2D’ye düşer; isteyen tek tıkla 🎨 2D’ye geçebilir.)',
      '🌊 Canlı Okyanus & V-Köpük İzi: Kayan dalga dokusu, gemi arkasında çift V-köpük izi ve Mercan Plajı’nda hareketli kıyı köpüğü!',
      '💥 3D Çatışma Efektleri: Parlayan 3D mermi kuyrukları, patlama/sonar/fener şok halkaları, dalış & sürpriz çıkış su sıçramaları ve görüş menzili vinyeti!',
      '🏝️ Haritalara Özel 3D Atmosfer: Fırtına Boğazı’nda yağmur & şimşek, Volkanik Resif’te yükselen lav kıvılcımları, Hayalet Sis’te hayalet ışıkları, sahilde süzülen martılar!',
      '🎥 3D Kamera Açısı (C tuşu veya 🎥): Taktiksel Yüksek 3D ↔ Sinematik Alçak 3D arasında akıcı geçiş!'
    ]
  },
  {
    ver: 'v5.01',
    notes: [
      '✨ 3D Görünüm HD keskinlik düzeltmesi (tam ekran WebGL + keskin isim/can barları & mini harita), daha canlı okyanus ışığı ve katmanlı 3D sis bulutları!'
    ]
  },
  {
    ver: 'v5.0',
    notes: [
      '🧊 BÜYÜK GÜNCELLEME — İSTEĞE BAĞLI 3D GÖRÜNÜM (2D ↔ 3D ÇAPRAZ OYNANIŞ):',
      '🎨 2D hiç bozulmadan duruyor! İsteyen ana menüden, lobiden veya maç içinden tek tıkla 🧊 3D (Eğik Kuşbakışı Low-Poly) görünüme geçebilir — aynı odada biri 2D, diğeri 3D adil şekilde oynayabilir!',
      '🏝️ 6 özgün 3D çar modeli, dalgalı low-poly okyanus, 3D Kraken, palmiyeli kumsal, dönen fener ışığı ve su altına gerçek dalış animasyonu!',
      '⚖️ OYUN TEMPOSU DENGELENDİ: Temel tekne hızları %8 sakinleştirildi + üst üste binen hız bonuslarına tavan kondu; ateşli silah mermi hızları ~%15 düşürülerek refleksle dodge kolaylaştırıldı; tüm çarlara +15 Batma Direnci eklendi.'
    ]
  },
  {
    ver: 'v4.68',
    notes: [
      '📱 Mobil oyun içi üst HUD cilalandı: uzun tur olayı başlığının ortadaki sayacı şişirip olay akışıyla çakışma sorunu çözüldü, oda kodu kutusu dar ekrana uyarlandı.'
    ]
  },
  {
    ver: 'v4.67',
    notes: [
      '📱 MOBİL ARAYÜZ & İTEM SEÇİMİ TAMAMEN YENİLENDİ:',
      '🎒 Draft (İtem & Yetenek Seçimi) ekranında item listesinin telefonda 0px’e ezilme hatası giderildi — 2 sütunlu rahat kaydırma, 3 sütunlu kompakt yetenek ağacı ve altta sabit (sticky) Onayla butonu eklendi!',
      '🕹️ Mobil kontroller baştan yapıldı: dokununca yanlışlıkla silah sıkma (sentetik tıklama) ve nişanın sol üste kilitlenmesi çözüldü; görsel sanal joystick + çift parmak hareket/nişan eklendi.',
      '📐 Mobil üst HUD, alt 4 büyük başparmak butonu, mini harita ve lobi/menü ekranları telefon boyutuna tam uyarlandı.'
    ]
  },
  {
    ver: 'v4.66',
    notes: [
      '🧪 80 MAÇLIK KAOS TESTİYLE BULUNAN 2 GİZLİ BUG ÇÖZÜLDÜ:',
      '🏖️ Mercan Plajı’nda iskele/çarpışma itmesiyle teknenin kuru kumsala çıkma hatası giderildi.',
      '🗺️ Akıntı Koyu, Mercan Plajı ve Hayalet Sis haritalarında kaya/iskele içine denk gelen 5 sandık/fıçı doğma noktası açık suya taşındı.'
    ]
  },
  {
    ver: 'v4.65',
    notes: [
      '🔌 Yedek sunucu (EMQX) bağlantısında katılma zaman aşımının erken kesme riski giderildi (sayaç artık sunucu bağlandıktan sonra 4.5 sn sayar).',
      '🔄 Tekrar Oyna (Rematch) sonrası önbellek & kariyer kayıt kilidi temizlendi.',
      '❤️ 3 Kalp açıkken tekne üstü durum yazılarının (Çapalandı / Sersemledi) kalplerin üstüne binmesi düzeltildi.'
    ]
  },
  {
    ver: 'v4.64',
    notes: [
      '🐛 Maç Sonu ekranının saniyede 28 kez yeniden çizilip kaydırmayı bozma hatası giderildi.',
      '🚪 Maç içi sağ üst HUD’a güvenli çift-tıkla Lobiye Dön / Çık butonu eklendi.',
      '⌨️ Klavye UX: ESC ile açık pencereler kapanır, oda kodunda Enter ile direkt girilir, rehber açıkken arkada silah sıkılmaz.',
      '🔌 Oda kurucusu odadan ayrıldığında veya bağlantısı koptuğunda arkadaşlar artık sonsuza kadar beklemez; otomatik bilgilendirilir.',
      '📖 Nasıl Oynanır rehberi İKİ İTEMLİ OYUN ve tüm yeni özelliklerle güncellendi.'
    ]
  },
  {
    ver: 'v4.63',
    notes: [
      '🐛 KRİTİK UX DÜZELTMESİ: Draft (İtem & Yetenek seçimi) ekranında her 0.45 sn’de bir kartların yeniden çizilip imleç/hover titremesi ve tıklama yutması sorunu tamamen çözüldü!'
    ]
  },
  {
    ver: 'v4.62',
    notes: [
      '🗺️ Maç Ayarları Harita Seçici Düzeni: Üstte tam genişlik 🔄 Dönüşümlü, altında simetrik 3×2 ikonlu 6 harita ızgarası!'
    ]
  },
  {
    ver: 'v4.61',
    notes: [
      '⏱️ TUR SÜRESİ SEÇENEKLERİ ARTIRILDI: Maç Ayarlarına 5 süre seçeneği eklendi — 45 sn (Blitz) · 60 sn · 85 sn · 120 sn (2 dk) · 180 sn (3 dk)!',
      '🌊 SPACE (SUYA BASTIR) GÜÇLENDİRİLDİ: Yakın temas darbesi 26 → 42 Hasar (hız takviyesiyle 34 → 52 Hasar) oldu — silah bittiğinde yakın dövüş artık çok daha etkili!'
    ]
  },
  {
    ver: 'v4.6',
    notes: [
      '🏷️ YENİ İSİM: Oyunumuzun resmi adı artık İKİ İTEMLİ OYUN! (Kayıtlı linkleriniz aynı kalır.)',
      '🐙 7. TUR OLAYI — KRAKEN UYANIŞI: Turun ortasında harita merkezinde 8 dokunaçlı dev Kraken uyanır! Yaklaşanlara dokunaç şamarı atar; son vuruşu yapıp batıran anında tükenmiş silahını doldurur + 50 Kalkan kazanır!'
    ]
  },
  {
    ver: 'v4.54',
    notes: [
      '🎱 YENİ TUR OLAYI — SEKEN MERMİLER: Çift Cephane kaldırıldı! Artık bu olayda mermiler, zıpkınlar ve ağlar kayalardan, enkazlardan ve deniz sınırlarından 2 kez seker!',
      '🎯 YETENEK AĞACI (SALDIRI TİER 3) — KESKİN NİŞANCI: +%15 mermi hızı + ateşli silahla rakibe ilk isabetinde anında +1 mermi iadesi!'
    ]
  },
  {
    ver: 'v4.53',
    notes: [
      '✂️ GENEL METİN SADELEŞTİRMESİ: Ana menü, lobi, 6 çar pasifi, 20 item açıklaması ve oyun içi HUD’daki tekrar eden uzun metinler kısaltıldı — tüm ekranlar çok daha temiz ve hızlı okunur hale geldi!'
    ]
  },
  {
    ver: 'v4.52',
    notes: [
      '⛶ TAM EKRAN ARAYÜZ UYUMU: Lobi, Ana Menü, Draft ve VS ekranları artık tam ekranda (1080p / 1440p / geniş ekran) ortalanarak genişler ve ekranı dengeli doldurur!',
      '🌊 Canlı okyanus arka planı artık Lobide de hafifçe akar + Lobi üst çubuğuna ⛶ Tam Ekran kısayolu eklendi.'
    ]
  },
  {
    ver: 'v4.51',
    notes: [
      '🌊 ANA MENÜ CANLANDIRILDI: Arka planda canlı okyanus dalgaları, deniz feneri parıltısı ve yüzen Köpekbalığı / Ahtapot / Kalyon / Hayalet Gemi siluetleri eklendi!',
      '✨ Cam efektli kart cilası, güncel 4 Mod · 20 İtem · 6 Harita metinleri, tek satır dengeli 4 alt rozet ve sağ üst hızlı Ses / Tam Ekran butonları eklendi.'
    ]
  },
  {
    ver: 'v4.5',
    notes: [
      '💥 SAVAŞ HİSSİ (GAME JUICE) CİLASI: İsabet anında beyaz parlama (hit-flash) + hafif ekran sarsılması, barut fıçısında alev kıvılcımları, barikat kırılınca uçuşan tahta parçaları ve batırma anında su köpüğü patlaması eklendi!',
      '🏆 LOBİ OTURUM KUPASI: Aynı odada arka arkaya oynarken lobide her oyuncunun yanında bu akşam kaç maç kazandığı (🏆 X) görünür.'
    ]
  },
  {
    ver: 'v4.41',
    notes: [
      '🔗 Ölü Davet Linki Düzeltmesi: Eski davet linkiyle (?room=XXXX) açıldığında oda hâlâ canlı mı kontrol edilir; kapanmışsa Hemen Katıl çıkmaz ve adres temizlenir.',
      '⏱️ Odaya Katılma Zaman Aşımı: Kapanmış veya yanlış bir oda koduna katılmaya çalışınca 6 sn içinde yanıt gelmezse otomatik ana menüye döner.'
    ]
  },
  {
    ver: 'v4.4',
    notes: [
      '🎨 6 ÇARIN TAMAMI YENİDEN ÇİZİLDİ! Artık hepsi aynı tekne değil — her çarın kendine özgü hareketli 2D silueti var:',
      '🦈 Köpekbalığı (kuyruk sallayan gerçek köpekbalığı!), 🐙 Ahtapot (6 dalgalanan dokunaçlı dev ahtapot!), ⚓ Kaptan Kara (top mazgallı zırhlı kalyon), 👻 Sis Hayaleti (hayalet gemi), 🔦 Fenerci (ışıldaklı katamaran), 🌊 Dalga Binicisi (sörf / jet-ski)!',
      '🚩 Lobideki 6 Renk (Skin) seçimi her çarın gövdesine, dokunaçlarına veya yelkenine otomatik uyarlanır.'
    ]
  },
  {
    ver: 'v4.33',
    notes: [
      '🔒 Denge logu ayrıldı: Online PvP turları (en az 2 gerçek oyuncu) buluta gider; Solo/bot test turları sadece kendi tarayıcında kalır ve denge verisini bozmaz.',
      '📊 Gizli panelde ☁️ Online PvP / 🤖 Solo Testler sekmeleri; bulut okuma iki sunucuyu da dener.'
    ]
  },
  {
    ver: 'v4.32',
    notes: [
      '⏱️ Tur başı İtem & Yetenek Ağacı seçim süresi 22 sn → 45 sn’ye çıkarıldı (herkes onaylayınca yine anında başlar!).'
    ]
  },
  {
    ver: 'v4.31',
    notes: [
      '✨ Lobi & Draft Ekranı Cila: 4 mod ve 1/2/3 Kalp seçicisi tek satıra alındı, Maçı Başlat butonu kaydırmasız tek ekrana sığdırıldı.',
      '🎯 Draft Ekranı: 5×2 kompakt item dizilimi, altta sabit Onayla çubuğu ve koyu okyanus temalı ince kaydırma çubuğu eklendi.'
    ]
  },
  {
    ver: 'v4.3',
    notes: [
      '👑 YENİ 4. OYUN MODU — ALTIN TAÇ: Haritanın ortasındaki Altın Tacı kap, 100 puana ilk ulaşan kazanır! Taç taşıyıcısı parlar, biraz yavaşlar ve su altına dalamaz.',
      '💰 YENİ: Kelle Ödülü (Bounty)! Üst üste 2+ batırma yapanın üzerinde ödül parlar — onu durduran +40 Can, +35 Kalkan ve +1 Yetenek Puanı kazanır!',
      '🗺️ YENİ HARİTA MEKANİKLERİ: Volkanik Resif’te Lav Gayzerleri 🌋, Korsan Enkazı & Hayalet Sis’te Dönen Deniz Feneri 🗼, Fırtına Boğazı & Akıntı Koyu’nda Kırılabilir Barikatlar 🪵!',
      '❤️ MARİO KALP ARAYÜZÜ: Oyun içi büyük Mario Kalp çubuğu + lobide tek tıkla 1 / 2 / 3 Kalp seçicisi eklendi!'
    ]
  },
  {
    ver: 'v4.2',
    notes: [
      '🎯 4 YENİ EGZOTİK İTEM (Toplam 20 İtem): ⚡ Elektrik Ağı (zincirleme sıçrama), 🌪️ Çekim Bombası, 🪞 Ayna Kalkanı (mermiyi geri sektirir!), 🌿 Yosun İzi!',
      '📊 YENİ: Ana menüde kalıcı Kişisel Kariyer & Rekor Defteri (İstatistiklerim) eklendi.',
      '⚖️ Arka plan denge telemetrisi eklendi (gelecek buff/nerf yamaları için).'
    ]
  },
  {
    ver: 'v4.1',
    notes: [
      '🎲 YENİ: Rastgele Tur Olayları! (Barut Yağmuru, Çift Cephane, Karanlık Gece Sisi, Kasırga Hızı, Sonsuz Derinlik, Hazine Fırtınası — lobiden açılıp kapatılabilir.)',
      '🔥 YENİ: Çifte Batırma, Durdurulamaz ve Barut Ustası seri anonsları + hafif okyanus dalga sesi ambıyansı (🌊 aç/kapa).',
      '🚩 YENİ: Lobide 6 farklı Tekne Rengi & Köpük İzi seçimi eklendi!'
    ]
  },
  {
    ver: 'v4.0',
    notes: [
      '❤️ YENİ: Mario Tarzı Can Hakkı (1 / 2 / 3 Kırmızı Kalp ❤️❤️❤️)! Lobi ayarlarından açılır; ölünce 1 kalp kırılır ve 2.6 sn sonra kalkanla yeniden doğarsın!',
      '🌿 YENİ: 3 Dallı Maç İçi Yetenek Ağacı (Skill Tree)! Her turda herkese +1 Yetenek Puanı gelir — Saldırı, Derinlik veya Dayanıklılık dallarından kendi build’ini kur!'
    ]
  },
  {
    ver: 'v3.8',
    notes: [
      '💬 YENİ: Tekne üstü mini emoji tepkileri eklendi! [3] 😂 · [4] 🦈 · [5] 🔥 · [6] 💀 (veya sol alttaki hızlı emoji çubuğu).',
      'Siste, mürekkepte veya su altında gizliyken rakipler emojini göremez — gizlilik bozulmaz!'
    ]
  },
  {
    ver: 'v3.7',
    notes: [
      '🗺️ 3 YENİ DENİZ HARİTASI (Toplam 6 Harita)!',
      '🏝️ Mercan Plajı: Altın kumsal, palmiyeler, ahşap iskeleler ve dalış yapılamayan turkuaz sığ su şeridi!',
      '🌋 Volkanik Resif: Lav parıltılı dar kayalık geçitler, 6 barut fıçısı ve çapraz turbo akıntılar!',
      '🌫️ Hayalet Sis Denizi: Dev sis labirenti ve kırık gemi enkazları — pusu ve sonar cenneti!'
    ]
  },
  {
    ver: 'v3.6',
    notes: [
      '🏆 YENİ: Maç Sonu MVP & Eğlenceli Denizci Ünvanları ekranı eklendi!',
      'Tüm turlar boyunca Batırma, Hasar, Sürpriz Çıkış, Kurtarma, Fıçı Patlatma ve Sandık istatistikleri toplanır.',
      'Maç sonunda 👑 MVP seçilir ve herkese özel denizci lakabı verilir (Köpekbalığı Pusucusu, Barut Delisi, Can Kurtaran, Batmaz Gemi, Çapa Magneti...).'
    ]
  },
  {
    ver: 'v3.5',
    notes: [
      '⚔️ YENİ: Her tur başında 3.8 saniyelik "VS / Karşılaşma Ekranı" eklendi!',
      'İki tarafın (veya Herkes Tek’te tüm oyuncuların) seçtiği çarları ve 2 itemini tur başlamadan hemen önce tek bakışta görebilirsin.'
    ]
  },
  {
    ver: 'v3.4',
    notes: [
      '✨ Arayüz yenilemesi: Alt HUD sıkılaştırıldı, slotlara kayan görsel bekleme (CD) dolumu ve canlı etki rozetleri (Hız, Kalkan, Yavaş, Su Altı) eklendi.',
      '⛶ Sağ üste tek tıkla Tam Ekran butonu eklendi.',
      '🎒 Draft ekranına Tümü / Ateşli / Yardımcı filtresi ve canlı [SLOT 1] + [SLOT 2] önizleme çubuğu eklendi.',
      '⚔️ Lobi üstüne tek tıkla 2v2 / 1v1 / Herkes Tek hızlı mod seçici eklendi.'
    ]
  },
  {
    ver: 'v3.3',
    notes: [
      '💀 YENİ MOD: Herkes Tek (Deathmatch / FFA)! 2, 3 veya 4 kişi botsuz birbirine girebilir — son hayatta kalan turu kazanır!',
      'Ortak 16 itemlik deniz cephaneliğinden istediğin 2 itemi kombinle (ör. Gemi Pompalısı + Mürekkep Bulutu).',
      'Deathmatch’te birini suya gömünce +40 Batma Direnci ve tam Nefes ödülü kazanırsın!'
    ]
  },
  {
    ver: 'v3.2',
    notes: [
      '⚔️ YENİ MOD: Lobi ve Maç Ayarlarına 1v1 Düello modu eklendi! (2 arkadaş botsuz 1v1 kapışabilir.)',
      '📖 YENİ: Ana menü, lobi ve oyun içinden (? butonu) tek tıkla açılan 4 sekmeli "Nasıl Oynanır? (Rehber)" eklendi.'
    ]
  },
  {
    ver: 'v3.1',
    notes: [
      '⚖️ Su altı dengesi: Sürpriz Çıkış alanı 108px → 70px daraltıldı (artık gerçekten rakibin dibinde çıkman gerekiyor!).',
      '⚖️ Su altı hareket hızı %88 → %66 yapıldı (gizlenme ve pusu odaklı).'
    ]
  },
  {
    ver: 'v3.0',
    notes: [
      '🤿 BÜYÜK GÜNCELLEME: Tüm karakterler [SHIFT] veya [E] ile su altına dalıp gizlenebilir ve su altında ilerleyebilir!',
      '🫁 Su altında durmak Nefes Barını tüketir (22/sn) — nefes bitince zorla yüzeye çıkarsın.',
      '🦈 SÜRPRİZ ÇIKIŞ: En az 1 sn su altında kalıp düşmanın dibinde (105px) yukarı çıkarsan 2.0 sn %65 yavaşlatma + dalga şoku vurur!'
    ]
  },
  {
    ver: 'v2.9',
    notes: [
      '🫁 YENİ MEKANİK: Yenilenen Nefes Barı eklendi! Alınan hasar önce Nefes Barından gider; nefes bitince Batma Direncine vurur.',
      'Son hasardan 3.6 sn sonra Nefes Barı hızla dolmaya başlar — kaçış ve baskı taktikleri çok daha derin!',
      'Nefes kırılınca "🫁 NEFESİ KESİLDİ!" efekti ve çift barlı yeni HUD eklendi.'
    ]
  },
  {
    ver: 'v2.8',
    notes: [
      '🔥 Ateşli silahlar güçlendirildi: Zıpkın Topu (112 + iz bırakma), Gemi Pompalısı (maks. 135), İşaret Tabancası (82 + 12s aydınlatma), Korsan Tabancası (85 + 2.0s sersemletme), Kısa Namlu Top (maks. 96 + dev itme)!',
      '💥 Vuruş hissi: Ekranda -112 💥 hasar sayıları, parlak namlu alevi ve kalın mermi izleri eklendi.',
      '⚙️ Lobi Ayarlarına "Ateşli Silah Modu" eklendi: Tek Atım (Ağır) veya 30 sn Uzun Bekleme!'
    ]
  },
  {
    ver: 'v2.7',
    notes: [
      '⚙️ Lobiye kapsamlı Maç Ayarları eklendi: Tur sayısı (2/4/6/8), Tur süresi (60/85/110s), Can çarpanı (%75/%100/%140), Harita seçimi.',
      'Power-Up Sandıkları, Barut Fıçıları, Dev Fırtına ve Takım Arkadaşı Kurtarma artık tek tıkla açılıp kapatılabiliyor!',
      'Aktif maç kuralları lobide tüm oyunculara anlık özet rozetler halinde görünür.'
    ]
  },
  {
    ver: 'v2.6',
    notes: [
      '🧨 YENİ MEKANİK: Haritalarda 5 adet itilebilir & patlatılabilir Korsan Barut Fıçısı yüzüyor!',
      'Tekneyle veya SPACE hamlesiyle fıçıyı rakibe itip mermiyle patlatabilir, yakındaki fıçıları zincirleme patlatabilirsin!'
    ]
  },
  {
    ver: 'v2.5',
    notes: [
      '🌊 Girdaplar tamamen kaldırıldı! Yerine yönlü Turbo Deniz Akıntıları (Hız Koridorları) eklendi.',
      'Akıntı yönünde süzülürsen +%55 hız kazanırsın — pasif hasar yok, yapışma yok!',
      'Dalga Binicisi pasifi akıntılardan ekstra hız alacak şekilde güncellendi; Girdap Koyu haritası Akıntı Koyu oldu.'
    ]
  },
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
export const DRAFT_DURATION = 45; // item & yetenek ağacı seçme süresi (sn)
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
    breath: 85,
    hp: 160,
    speed: 192,
    vision: 390,
    wakeMult: 1.0,
    cdMult: 1.0,
    projSpeedMult: 1.0,
    whirlpoolResist: 0.2,
    firstHitReduction: 0.25,
    passive: 'En yüksek nefes & direnç; ilk darbeden %25 az hasar.',
    stats: { hp: 5, speed: 3, utility: 3 }
  },
  {
    id: 'kopekbaligi',
    name: 'Köpekbalığı',
    roleTag: 'Hızlı Avcı',
    icon: '🦈',
    color: '#ef476f',
    accent: '#ff8fa3',
    breath: 70,
    hp: 130,
    speed: 218,
    vision: 395,
    wakeMult: 1.12,
    cdMult: 0.95,
    projSpeedMult: 1.05,
    whirlpoolResist: 0.2,
    dashBoost: 1.22,
    passive: 'En yüksek hız; SPACE hamlesi %22 daha güçlü.',
    stats: { hp: 3, speed: 5, utility: 3 }
  },
  {
    id: 'hayalet',
    name: 'Sis Hayaleti',
    roleTag: 'Korsan Gölgesi',
    icon: '👻',
    color: '#8ecae6',
    accent: '#caf0f8',
    breath: 65,
    hp: 125,
    speed: 206,
    vision: 400,
    wakeMult: 0.45,
    cdMult: 1.0,
    projSpeedMult: 1.0,
    whirlpoolResist: 0.15,
    stealthBonus: true,
    passive: '-%55 köpük izi; siste çok yakından bile gizli.',
    stats: { hp: 2, speed: 4, utility: 5 }
  },
  {
    id: 'fenerci',
    name: 'Fenerci',
    roleTag: 'Keskin Gözcü',
    icon: '🔦',
    color: '#f4a261',
    accent: '#ffe8d6',
    breath: 70,
    hp: 135,
    speed: 198,
    vision: 495,
    wakeMult: 1.0,
    cdMult: 1.0,
    projSpeedMult: 1.25,
    whirlpoolResist: 0.15,
    passive: '+%25 görüş menzili; mermiler %25 daha hızlı.',
    stats: { hp: 3, speed: 3, utility: 5 }
  },
  {
    id: 'ahtapot',
    name: 'Ahtapot',
    roleTag: 'Tuzak Ustası',
    icon: '🐙',
    color: '#9b5de5',
    accent: '#d8bbff',
    breath: 75,
    hp: 140,
    speed: 200,
    vision: 400,
    wakeMult: 0.9,
    cdMult: 0.78,
    projSpeedMult: 1.05,
    whirlpoolResist: 0.25,
    trapBonus: 1.2,
    passive: 'Tuzak & yardımcı beklemesi -%22, alanı +%20.',
    stats: { hp: 4, speed: 3, utility: 5 }
  },
  {
    id: 'dalgabinici',
    name: 'Dalga Binicisi',
    roleTag: 'Çevik Sörfçü',
    icon: '🌊',
    color: '#06d6a0',
    accent: '#9bf6ff',
    breath: 75,
    hp: 125,
    speed: 214,
    vision: 405,
    wakeMult: 0.85,
    cdMult: 0.9,
    projSpeedMult: 1.0,
    currentBonus: true,
    turnBonus: true,
    passive: 'Çevik dönüş; akıntıda ekstra hız, ters akıntıya bağışık.',
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
    range: 760,
    speed: 910,
    damage: 112,
    knockback: 320,
    slowDur: 2.2,
    revealHitDur: 3.5,
    desc: '112 Hasar + 2.2 sn yavaşlatma + 3.5 sn iz bırakır.'
  },
  {
    id: 'blunderbuss',
    name: 'Gemi Pompalısı',
    icon: '💥',
    category: 'ATEŞLİ SİLAH',
    firearm: true,
    uses: 1,
    cooldown: 0.5,
    range: 350,
    speed: 690,
    pellets: 5,
    spread: 0.34,
    damage: 27, // 5 x 27 = 135 maks yakın hasar!
    knockback: 280,
    slowDur: 0.65,
    desc: '5 iri saçma (maks. 135 Hasar) + güçlü savurma.'
  },
  {
    id: 'flare_gun',
    name: 'İşaret Tabancası',
    icon: '🔫',
    category: 'ATEŞLİ SİLAH',
    firearm: true,
    uses: 1,
    cooldown: 0.5,
    range: 640,
    speed: 720,
    damage: 82,
    knockback: 230,
    revealHitDur: 3.5,
    flareRadius: 285,
    flareDur: 12.0,
    desc: '82 Hasar + 3.5 sn işaretler, bölgeyi 12 sn aydınlatır.'
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
    desc: 'Tüm rakipleri 3.2 sn kayalık ve sis arkasından gösterir.'
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
    desc: 'Gizli çapa: basanı 2.1 sn kilitler, 30 Hasar + açığa çıkarır.'
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
    desc: 'İsabet ettiği rakibi 2.6 sn %70 yavaşlatır (+16 Hasar).'
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
    desc: '4 sn +%40 hız ve güçlendirilmiş SPACE darbesi.'
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
    desc: 'Rakibi direkt sana çeker (+24 Hasar).'
  },
  {
    id: 'electric_net',
    name: 'Elektrik Ağı',
    icon: '⚡',
    category: 'KONTROL',
    firearm: false,
    uses: 2,
    cooldown: 9.5,
    range: 480,
    speed: 680,
    damage: 32,
    chainDamage: 28,
    chainRange: 230,
    slowDur: 1.4,
    desc: '32 Hasar + yavaşlatma; yakındaki 2. düşmana elektrik sıçratır.'
  },
  {
    id: 'gravity_bomb',
    name: 'Çekim Bombası',
    icon: '🌀',
    category: 'TUZAK',
    firearm: false,
    uses: 2,
    cooldown: 11,
    range: 340,
    radius: 175,
    dur: 3.3,
    desc: '3.3 sn girdap alanı — yakındaki rakipleri merkeze çeker.'
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
    range: 580,
    speed: 765,
    damage: 85,
    knockback: 330,
    stunDur: 2.0,
    desc: '85 Hasar + 2.0 sn tam sersemletme.'
  },
  {
    id: 'hand_mortar',
    name: 'Kısa Namlu Top',
    icon: '💣',
    category: 'ATEŞLİ SİLAH',
    firearm: true,
    uses: 1,
    cooldown: 0.5,
    range: 335,
    speed: 640,
    pellets: 3,
    spread: 0.36,
    damage: 32, // 3 x 32 = 96 maks hasar!
    knockback: 540,
    slowDur: 0.7,
    desc: '3 saçma (maks. 96 Hasar) + güçlü geri itme.'
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
    desc: '6.5 sn siyah bulut — içindekiler görünmez ve sonardan saklı.'
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
    desc: 'Yakındaki rakipleri 2.2 sn kör eder ve yavaşlatır.'
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
    desc: 'İleri giden sahte klon yollar, rakipleri şaşırtır.'
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
    desc: '3.6 sn +%44 hız, sessiz kaçış + yavaşlatmaları siler.'
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
    desc: 'Patlayan mayın: 32 Hasar + 1.8 sn sersemletme.'
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
    desc: '+78 Direnç yeniler (yakındaki dostuna +42).'
  },
  {
    id: 'mirror_shield',
    name: 'Ayna Kalkanı',
    icon: '🪞',
    category: 'SAVUNMA',
    firearm: false,
    uses: 2,
    cooldown: 11,
    dur: 1.8,
    desc: '1.8 sn gelen ilk mermiyi aynen rakibe geri sektirir!'
  },
  {
    id: 'kelp_trail',
    name: 'Yosun İzi',
    icon: '🌿',
    category: 'KAÇIŞ',
    firearm: false,
    uses: 2,
    cooldown: 10,
    dur: 4.0,
    speedMult: 1.18,
    desc: '4 sn +%18 hız + arkanda rakipleri %60 yavaşlatan yosun izi.'
  }
];

export const FFA_ITEMS = [...HUNTER_ITEMS, ...PREY_ITEMS];

export const ALL_ITEMS = Object.fromEntries(
  FFA_ITEMS.map(i => [i.id, i])
);

// 3 DÖNÜŞÜMLÜ DENİZ HARİTASI (Turbo Deniz Akıntıları & Power-up noktaları)
export const SEA_MAPS = [
  {
    id: 'firtina_bogazi',
    name: 'Fırtına Boğazı',
    subtitle: 'Merkezde batık gemi, iki yanda hızlı deniz akıntıları ve sis cepleri',
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
      { x: 800, y: 310 },
      { x: 800, y: 690 },
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
    currents: [
      { x: 540, y: 295, w: 520, h: 68, dirX: 1, dirY: 0, boost: 1.55 },
      { x: 540, y: 637, w: 520, h: 68, dirX: -1, dirY: 0, boost: 1.55 }
    ],
    barrelSpots: [
      { x: 640, y: 500 },
      { x: 960, y: 500 },
      { x: 800, y: 330 },
      { x: 800, y: 670 },
      { x: 460, y: 410 },
      { x: 1140, y: 590 }
    ],
    breakables: [
      { x: 420, y: 500, r: 34 },
      { x: 1180, y: 500, r: 34 },
      { x: 800, y: 265, r: 32 },
      { x: 800, y: 735, r: 32 }
    ]
  },
  {
    id: 'korsan_enkazi',
    name: 'Korsan Enkazı',
    subtitle: 'Parçalanmış gemi gövdeleri, dönen deniz feneri ve dikey kaçış akıntıları',
    lighthouse: { x: 800, y: 500, range: 580, halfAngle: 0.24, speed: 0.56 },
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
    currents: [
      { x: 625, y: 205, w: 68, h: 590, dirX: 0, dirY: 1, boost: 1.55 },
      { x: 907, y: 205, w: 68, h: 590, dirX: 0, dirY: -1, boost: 1.55 }
    ],
    barrelSpots: [
      { x: 660, y: 360 },
      { x: 940, y: 640 },
      { x: 660, y: 640 },
      { x: 940, y: 360 },
      { x: 480, y: 500 },
      { x: 1120, y: 500 }
    ]
  },
  {
    id: 'akinti_koyu',
    name: 'Akıntı Koyu',
    subtitle: 'Açık deniz kovalamacası ve üç süper hızlı turbo deniz akıntısı!',
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
      { x: 800, y: 500 },
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
    currents: [
      { x: 560, y: 462, w: 480, h: 76, dirX: 1, dirY: 0, boost: 1.62 },
      { x: 460, y: 325, w: 680, h: 64, dirX: -1, dirY: 0, boost: 1.55 },
      { x: 460, y: 611, w: 680, h: 64, dirX: -1, dirY: 0, boost: 1.55 }
    ],
    barrelSpots: [
      { x: 800, y: 500 },
      { x: 640, y: 355 },
      { x: 960, y: 645 },
      { x: 960, y: 355 },
      { x: 640, y: 645 },
      { x: 470, y: 380 }
    ],
    breakables: [
      { x: 350, y: 500, r: 34 },
      { x: 1250, y: 500, r: 34 },
      { x: 800, y: 390, r: 32 },
      { x: 800, y: 610, r: 32 }
    ]
  },
  {
    id: 'mercan_plaji',
    name: 'Mercan Plajı',
    subtitle: 'Üst kıyıda altın kumsal, palmiyeler, ahşap iskeleler ve dalış yapılamayan sığ su!',
    theme: { deep: '#072a40', mid: '#0d4a66', foam: 'rgba(186, 245, 255, 0.18)' },
    beach: {
      sandY: 145,
      shallowY: 270,
      palms: [
        { x: 130, y: 68, r: 34 },
        { x: 380, y: 54, r: 38 },
        { x: 690, y: 72, r: 32 },
        { x: 960, y: 58, r: 38 },
        { x: 1270, y: 66, r: 35 },
        { x: 1480, y: 74, r: 32 }
      ],
      umbrellas: [
        { x: 255, y: 82, color: '#ef476f' },
        { x: 540, y: 86, color: '#ffb703' },
        { x: 830, y: 78, color: '#06d6a0' },
        { x: 1125, y: 84, color: '#38bdf8' },
        { x: 1390, y: 88, color: '#fb8500' }
      ]
    },
    hunterSpawns: [
      { x: 165, y: 450 },
      { x: 165, y: 740 }
    ],
    preySpawns: [
      { x: 1435, y: 450 },
      { x: 1435, y: 740 }
    ],
    powerupSpots: [
      { x: 600, y: 215 }, // Sığ su risk-ödül sandığı!
      { x: 260, y: 215 },
      { x: 1340, y: 215 },
      { x: 800, y: 580 },
      { x: 520, y: 760 },
      { x: 1080, y: 760 },
      { x: 800, y: 880 }
    ],
    rocks: [
      // Kumsaldan denize uzanan ahşap iskeleler!
      { type: 'pier', x: 390, y: 145, w: 46, h: 175 },
      { type: 'pier', x: 1164, y: 145, w: 46, h: 175 },
      { type: 'pier', x: 774, y: 145, w: 52, h: 140 },
      // Mercan kayalıkları & batık tekne
      { type: 'ship', x: 715, y: 620, w: 170, h: 86, label: 'YAT' },
      { type: 'rock', x: 480, y: 540, r: 48 },
      { type: 'rock', x: 1120, y: 540, r: 48 },
      { type: 'rock', x: 340, y: 800, r: 44 },
      { type: 'rock', x: 1260, y: 800, r: 44 }
    ],
    fogs: [
      { x: 610, y: 440, r: 82 },
      { x: 990, y: 440, r: 82 },
      { x: 610, y: 820, r: 90 },
      { x: 990, y: 820, r: 90 }
    ],
    currents: [
      // Kıyıdan açık denize çeken akıntı + alt kıyı paralel akıntısı
      { x: 560, y: 310, w: 480, h: 62, dirX: 1, dirY: 0, boost: 1.55 },
      { x: 480, y: 845, w: 640, h: 62, dirX: -1, dirY: 0, boost: 1.55 }
    ],
    barrelSpots: [
      { x: 600, y: 215 },
      { x: 1000, y: 215 },
      { x: 800, y: 470 },
      { x: 580, y: 670 },
      { x: 1020, y: 670 },
      { x: 800, y: 785 }
    ]
  },
  {
    id: 'volkanik_resif',
    name: 'Volkanik Resif',
    subtitle: 'Su altı lav gayzerleri, bol barut fıçısı ve çapraz turbo akıntılar!',
    geysers: true,
    theme: { deep: '#17080d', mid: '#2d111a', foam: 'rgba(255, 160, 110, 0.14)' },
    hunterSpawns: [
      { x: 155, y: 260 },
      { x: 155, y: 740 }
    ],
    preySpawns: [
      { x: 1445, y: 260 },
      { x: 1445, y: 740 }
    ],
    powerupSpots: [
      { x: 800, y: 500 },
      { x: 520, y: 500 },
      { x: 1080, y: 500 },
      { x: 800, y: 220 },
      { x: 800, y: 780 },
      { x: 370, y: 220 },
      { x: 1230, y: 780 }
    ],
    rocks: [
      { type: 'rock', lava: true, x: 800, y: 355, r: 54 },
      { type: 'rock', lava: true, x: 800, y: 645, r: 54 },
      { type: 'rock', lava: true, x: 520, y: 290, r: 58 },
      { type: 'rock', lava: true, x: 1080, y: 710, r: 58 },
      { type: 'rock', lava: true, x: 520, y: 710, r: 50 },
      { type: 'rock', lava: true, x: 1080, y: 290, r: 50 },
      { type: 'rock', lava: true, x: 330, y: 500, r: 44 },
      { type: 'rock', lava: true, x: 1270, y: 500, r: 44 }
    ],
    fogs: [
      { x: 660, y: 170, r: 78 },
      { x: 940, y: 830, r: 78 },
      { x: 940, y: 170, r: 78 },
      { x: 660, y: 830, r: 78 }
    ],
    currents: [
      { x: 430, y: 468, w: 740, h: 64, dirX: 1, dirY: 0, boost: 1.62 },
      { x: 645, y: 120, w: 62, h: 760, dirX: 0, dirY: 1, boost: 1.58 },
      { x: 893, y: 120, w: 62, h: 760, dirX: 0, dirY: -1, boost: 1.58 }
    ],
    barrelSpots: [
      { x: 800, y: 500 },
      { x: 675, y: 350 },
      { x: 925, y: 650 },
      { x: 675, y: 650 },
      { x: 925, y: 350 },
      { x: 420, y: 390 },
      { x: 1180, y: 610 }
    ]
  },
  {
    id: 'hayalet_sis',
    name: 'Hayalet Sis Denizi',
    subtitle: 'Dev sis labirenti ve dönen deniz feneri — gizlilik, sonar ve pusu cenneti!',
    lighthouse: { x: 800, y: 500, range: 600, halfAngle: 0.24, speed: 0.62 },
    theme: { deep: '#041414', mid: '#092929', foam: 'rgba(130, 245, 225, 0.13)' },
    hunterSpawns: [
      { x: 150, y: 340 },
      { x: 150, y: 660 }
    ],
    preySpawns: [
      { x: 1450, y: 340 },
      { x: 1450, y: 660 }
    ],
    powerupSpots: [
      { x: 800, y: 380 },
      { x: 470, y: 500 },
      { x: 1130, y: 500 },
      { x: 800, y: 180 },
      { x: 800, y: 820 },
      { x: 470, y: 200 },
      { x: 1130, y: 800 }
    ],
    rocks: [
      { type: 'ship', x: 540, y: 230, w: 165, h: 68, label: 'HAYALET' },
      { type: 'ship', x: 895, y: 702, w: 165, h: 68, label: 'HAYALET' },
      { type: 'ship', x: 895, y: 230, w: 165, h: 68, label: 'ENKAZ' },
      { type: 'ship', x: 540, y: 702, w: 165, h: 68, label: 'ENKAZ' },
      { type: 'rock', x: 800, y: 500, r: 46 },
      { type: 'rock', x: 350, y: 500, r: 42 },
      { type: 'rock', x: 1250, y: 500, r: 42 }
    ],
    fogs: [
      { x: 640, y: 420, r: 118 },
      { x: 960, y: 580, r: 118 },
      { x: 960, y: 420, r: 118 },
      { x: 640, y: 580, r: 118 },
      { x: 360, y: 240, r: 105 },
      { x: 1240, y: 760, r: 105 },
      { x: 1240, y: 240, r: 105 },
      { x: 360, y: 760, r: 105 }
    ],
    currents: [
      { x: 540, y: 110, w: 520, h: 58, dirX: 1, dirY: 0, boost: 1.52 },
      { x: 540, y: 832, w: 520, h: 58, dirX: -1, dirY: 0, boost: 1.52 }
    ],
    barrelSpots: [
      { x: 640, y: 500 },
      { x: 960, y: 500 },
      { x: 800, y: 310 },
      { x: 800, y: 690 },
      { x: 460, y: 370 },
      { x: 1140, y: 630 }
    ]
  }
];
