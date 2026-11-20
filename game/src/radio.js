// radio.js — radio mobil 6 stasiun untuk SUNNY CITY.
// Tiap stasiun punya genre, frekuensi, serangkaian kalimat DJ, dan jingle yang dibunyikan
// memakai efek nada API audio (complete / pickup / click). Playlist nada prosedural datang dari
// ranah musik audio.js yang diputar lewat audio.setRadio, lalu bed synth digeser lewat
// audio.nextStation supaya musik ikut berubah tiap pindah stasiun. Volume mengikuti pengaturan
// master yang sudah dikelola audio.setVolume melalui applySettings. Ditulis sendiri; membaca
// ui/audio/gfx lebih dulu, dan pola pembuatan modul mengikuti taxi.js.

const HINT = 'R / [ — ganti stasiun';

// ——— DATA 6 STASIUN ———
// Tiap item: nama, frekuensi, genre, warna aksen HUD, jingle (urutan [efek, jeda ms]),
// dan kalimat DJ untuk disela saat mendengarkan.
const STATIONS = [
  {
    name: 'NEON WAVE', freq: '101.3 FM', genre: 'SYNTHWAVE', accent: '#ff5ee0',
    jingle: [['complete', 0], ['click', 150], ['click', 290]],
    dj: [
      'Selamat malam Sunny City, kamu nemu Neon Wave.',
      'Buat yang ngebut, synthwave bikin makin menyala.',
      'Kota berpendar neon — dan suaranya ada di sini.',
      'Petualangan malam butuh soundtrack, dan ini dia.',
      'Satu-satunya tempat synth dan hujan kota jadi satu paket.',
    ],
  },
  {
    name: 'FUNKY TOWN', freq: '94.7 FM', genre: 'FUNK', accent: '#ffb347',
    jingle: [['pickup', 0], ['click', 130]],
    dj: [
      'Funky Town di udara, siap-siap goyang di kursi.',
      'Bass-nya nendang, pedal gas kamu juga kudu nendang.',
      'Kita funky, kita santai, tapi jangan telat, ya.',
      'Frekuensi yang bikin macet jadi pesta.',
      'Naikkan funk, biarkan kota ikut bergoyang pelan.',
    ],
  },
  {
    name: 'LOFI BAY', freq: '88.1 FM', genre: 'CHILL', accent: '#7fe3ff',
    jingle: [['complete', 0]],
    dj: [
      'LoFi Bay — soundtrack buat cruise santai di tepi pantai.',
      'Kurangi kecepatan, biarkan beat-nya yang berjalan.',
      'Butuh jeda? Kita jagain vibes-nya di sini.',
      'Hujan di jendela mobil, lofi menemani.',
      'Pelan-pelan pun sampai. Nikmati dulu alurnya.',
    ],
  },
  {
    name: 'GREEN RIDGE', freq: '76.9 FM', genre: 'COUNTRY', accent: '#7bd66b',
    jingle: [['click', 0], ['click', 120], ['pickup', 240]],
    dj: [
      'Green Ridge Country — buat jiwa jalanan terbuka.',
      'Gitar slide dan debu jalanan, sempurna.',
      'Kota boleh sibuk, tapi kita mainin lagu desa.',
      'Patuhi lampu merah, sob. Musiknya saja yang liar.',
      'Jalanan panjang, soundtrack panjang, gas secukupnya.',
    ],
  },
  {
    name: 'PULSE', freq: '108.5 FM', genre: 'CLUB', accent: '#ffd21f',
    jingle: [['pickup', 0], ['complete', 170]],
    dj: [
      'PULSE — denyut malam Sunny City, seratus persen.',
      'Turunkan jendela, naikkan volume, biar terasa.',
      'Ini bukan radio, ini pesta di mobil kamu.',
      'Bass drop di lampu merah? Kenapa tidak.',
      'Malam belum berakhir selama PULSE masih menyala.',
    ],
  },
  {
    name: 'ROCK CLASSICS', freq: '99.9 FM', genre: 'ROCK', accent: '#ff6a5a',
    jingle: [['click', 0], ['pickup', 100], ['click', 220]],
    dj: [
      'Rock Classics — buat kamu yang gas-nya tak kenal rem.',
      'Riff lawas, tenaga baru, jalanan sama-sama legendaris.',
      'Gitar dikencengkan, persis seperti kamu tadi.',
      'Klasik tidak pernah mati, dan kamu juga, kan?',
      'Putar kencang, jendela terbuka, warga ikut nyanyi.',
    ],
  },
];

// Bunyikan jingle stasiun aktif sebagai sederet efek nada kecil berjeda.
function playJingle(r) {
  for (const [sfx, ms] of STATIONS[r.idx].jingle) {
    setTimeout(() => r.audio[sfx](), ms);
  }
}

// Pasang nama stasiun ke HUD tengah (ui.station) agar ikut muncul sekilas saat pindah.
function showName(r) {
  const st = STATIONS[r.idx];
  r.ui.station = st.name + ' ' + st.freq + ' — ' + st.genre;
  r.ui.stationT = 3;
}

// Panel HUD tetap kiri-atas: nama, frekuensi, genre, volume (mengikuti pengaturan), dan petunjuk.
function drawRadioHud(r) {
  const ctx2 = r.gfx && r.gfx.hud;
  if (!ctx2 || !r.on || !r.inCar || r.ui.state !== 'PLAYING') return;
  const st = STATIONS[r.idx];
  const vol = Math.round((r.ui.settings.volume || 0) * 100);
  const x = 16, y = 16;
  ctx2.save();
  ctx2.textAlign = 'left';
  ctx2.textBaseline = 'alphabetic';
  ctx2.font = 'bold 15px sans-serif';
  const line1 = '\u25C9 ' + st.name + ' ' + st.freq;
  const w1 = ctx2.measureText(line1).width;
  ctx2.font = '12px sans-serif';
  const line2 = st.genre + ' \u00B7 VOL ' + vol + '% \u00B7 ' + HINT;
  const w = Math.max(w1, ctx2.measureText(line2).width) + 24;
  ctx2.fillStyle = 'rgba(8,8,14,0.62)';
  ctx2.fillRect(x, y, w, 44);
  ctx2.strokeStyle = st.accent;
  ctx2.lineWidth = 1.5;
  ctx2.strokeRect(x + 1, y + 1, w - 2, 42);
  ctx2.fillStyle = st.accent;
  ctx2.font = 'bold 15px sans-serif';
  ctx2.fillText(line1, x + 12, y + 19);
  ctx2.fillStyle = '#e8e8e8';
  ctx2.font = '12px sans-serif';
  ctx2.fillText(line2, x + 12, y + 37);
  ctx2.restore();
}

// ——— API PUBLIK ———
export function createRadio(ctx) {
  const { ui, audio, gfx } = ctx;
  const r = {
    ui, audio, gfx,
    idx: 0,          // indeks stasiun yang sedang didengarkan
    on: false,       // radio menyala (sedang di dalam mobil & main)
    inCar: false,    // frame terakhir pemain berada di dalam mobil
    banterTimer: 14, // hitung mundur ke sapaan DJ berikutnya

    // Nyala/mati radio; saat menyala, perkenalkan stasiun + jingle.
    setCar(on) {
      if (on === r.on) return;
      r.on = on;
      r.audio.setRadio(on);
      if (on) { showName(r); playJingle(r); r.banterTimer = 6; }
    },

    // Pindah stasiun; audio hanya punya langkah maju, jadi mundur = dua langkah pada siklus 3 bed.
    change(dir) {
      r.idx = (r.idx + dir + STATIONS.length) % STATIONS.length;
      r.audio.setRadio(true);
      r.on = true;
      const steps = dir > 0 ? 1 : 2;
      for (let i = 0; i < steps; i++) r.audio.nextStation();
      showName(r);
      playJingle(r);
      r.banterTimer = 6;
    },
    next() { r.change(1); },
    prev() { r.change(-1); },
    toggle() { r.setCar(!r.on); },
    current() { return STATIONS[r.idx]; },
  };

  // Gambar HUD menempel sesudah ui.update selesai menggambar (pola sama seperti taxi.js).
  const prevUpdate = ui.update.bind(ui);
  ui.update = (dt, c) => { prevUpdate(dt, c); drawRadioHud(r); };

  return r;
}

// ——— UPDATE PER-FRAME ———
export function updateRadio(radio, dt, player) {
  const r = radio;
  r.inCar = !!player.car;
  r.setCar(!!player.car && r.ui.state === 'PLAYING');
  if (!r.on) return;

  // Sapaan DJ berkala dari stasiun aktif.
  r.banterTimer -= dt;
  if (r.banterTimer <= 0) {
    r.banterTimer = 16 + Math.random() * 26;
    const st = STATIONS[r.idx];
    r.ui.toast('DJ ' + st.name + ': ' + st.dj[(Math.random() * st.dj.length) | 0], 4);
  }
}