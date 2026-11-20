// missions.js — rantai 8 misi cerita + 6 pekerjaan sampingan untuk SUNNY CITY.
// v8: rantai 8 misi cerita dan pekerjaan sampingan taksi/heist/stunt untuk SUNNY CITY.
// Semua logika misi disusun ulang: konstanta bernama, helper kecil, tabel data,
// dan registri handler per-misi. Kontrak ekspor (MISSION_LIST, createMissions)
// serta permukaan objek yang dipakai modul lain dipertahankan.
import { addHeat } from './police.js';

// ——— KONSTANTA BERNAMA ———
const COOLDOWN_SECONDS = 3;      // jeda antar-misi cerita sebelum misi berikutnya mulai
const ARRIVE_DISTANCE = 40;      // jarak (m) dianggap "sampai" pada titik tujuan

const STORY_MISSIONS = 8;        // jumlah misi cerita berantai (delivery … finale)

const CAR_HITPOINTS = {          // HP awal kendaraan yang dibuat per misi
  execute: 150,
  finale: 300,
  bounty: 150,
  repo: 100,
};

// ——— TABEL DATA MISI ———
// Delapan misi cerita berantai + enam pekerjaan sampingan (start manual lewat Log Misi).
export const MISSION_LIST = [
  {
    id: 'delivery', title: 'KURIR PAKET', who: 'Mama Rosa', reward: 300, limit: 150,
    intro: 'Ambil paket di titik kuning, antar ke klien sebelum waktu habis.',
    win: 'Paketnya utuh. Kamu bisa dipercaya.', lose: 'Klien kabur. Paketnya basi.',
  },
  {
    id: 'chase', title: 'KEJAR MOBIL', who: 'Rico', reward: 450, limit: 120,
    intro: 'Mobil pink itu bawa uangku. Susul dan tempel sampai berhenti!', win: 'Dia menyerah. Uangnya kembali.', lose: 'Dia lolos...',
  },
  {
    id: 'execute', title: 'EKSEKUSI TARGET', who: 'Don Vega', reward: 500, limit: 120,
    intro: 'Pengkhianat itu parkir di dekat sini. Hancurkan mobilnya.', win: 'Satu masalah beres.', lose: 'Target pergi. Don Vega kecewa.',
  },
  {
    id: 'protect', title: 'LINDUNGI SEKUTU', who: 'Lena', reward: 600, limit: 60,
    intro: 'Aku dikejar geng! Jaga aku selama 60 detik, tembak pengejarnya.', win: 'Kita aman. Makasih!', lose: 'Lena tertangkap...',
  },
  {
    id: 'steal', title: 'CURI DI GUDANG', who: 'Tikus', reward: 700, limit: 150,
    intro: 'Ada kargo di gudang. Ambil, polisi pasti datang. Bawa ke tempat aman.', win: 'Bersih! Kargo aman.', lose: 'Kargo hilang, kamu ketahuan.',
  },
  {
    id: 'race', title: 'BALAPAN CHECKPOINT', who: 'Turbo', reward: 600, limit: 70,
    intro: 'Lewati 5 checkpoint sebelum waktu habis. Pakai mobil!', win: 'Cepat juga kamu.', lose: 'Terlalu lambat.',
  },
  {
    id: 'wave', title: 'TAHAN POLISI', who: 'Kapten Hale', reward: 800, limit: 45,
    intro: 'Polisi mengepung markas! Bertahan hidup 45 detik.', win: 'Mereka mundur. Kamu hebat.', lose: 'Markas jatuh.',
  },
  {
    id: 'finale', title: 'FINALE: BOS KOTA', who: 'Don Vega', reward: 1500, limit: 200,
    intro: 'Ini akhirnya. Temui aku di titik kuning, lalu hancurkan mobil bos.', win: 'Kota ini milikmu, Sunny City.', lose: 'Bos lolos. Coba lagi.',
  },

  // ——— PEKERJAAN SAMPINGAN (side jobs) — start lewat Log Misi, tidak mengubah rantai 8 misi cerita ———
  {
    id: 'heist', kind: 'side', title: 'PERAMPOKAN BANK (2 GELOMBANG)', who: 'Nico', reward: 1200, limit: 240,
    intro: 'Jebol brankas bank (titik kuning), tahan 2 gelombang polisi, lalu kabur pakai mobil!',
    win: 'Lolos dengan uangnya. Kamu gila!', lose: 'Perampokan gagal...',
  },
  {
    id: 'taxi', kind: 'side', title: 'TARIF TAKSI BERJALAN', who: 'Dewan Taksi', reward: 400, limit: 90,
    intro: 'Jemput penumpang di titik kuning, antar ke tujuan sebelum waktu habis.',
    win: 'Penumpang puas. Ongkos dihitung.', lose: 'Penumpang kesal dan turun.',
  },
  {
    id: 'stunt', kind: 'side', title: 'LOMPATAN STUNT (3 RAMP)', who: 'Racer Red', reward: 900, limit: 120,
    intro: 'Tiga ramp ditandai. Laju kencang, lompat, dan mendarat mulus untuk skor maksimal!',
    win: 'Stunt hebat! Penonton takjub.', lose: 'Stunt gagal... lompatanmu cuma angin.',
  },
  {
    id: 'bounty', kind: 'side', title: 'BURUAN HIDUP', who: 'Bounty Board', reward: 1000, limit: 90,
    intro: 'Target kabur pakai mobil cepat. Hentikan dia sebelum waktu habis!',
    win: 'Target tertangkap. Hadiah cair.', lose: 'Target hilang di kejauhan...',
  },
  {
    id: 'pizza', kind: 'side', title: 'KIRIM PIZZA (3 TITIK)', who: 'Pabrik Pizza', reward: 250, limit: 180,
    intro: 'Antar 3 pizza hangat ke 3 alamat sebelum dingin. Bonus kalau cepat!',
    win: 'Tiga pizza sampai tepat waktu. Bonus buat pelayan tercepat!', lose: 'Pizza basi. Pelanggan marah.',
  },
  {
    id: 'repo', kind: 'side', title: 'REPOSESSI MOBIL', who: 'Diablo Repo', reward: 1500, limit: 180,
    intro: 'Curi mobil bertanda, antar ke garasi sebelum polisi datang — jangan sampai rusak!',
    win: 'Mobil utuh di garasi. Gaji cair penuh.', lose: 'Mobil hancur atau ketinggalan.',
  },
];

// ——— HELPER MURNI ———
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
// f bisa mobil (punya speed & angle) atau pejalan kaki (punya vx/vy).
const asCar = (f) => (f && f.speed !== undefined && f.angle !== undefined ? f : null);

// Sudut gerak sebuah titik jalur mengikuti arah perjalanan dir (+1/-1).
const headingFor = (point, dir) =>
  point.horizontal ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);

// Titik-titik jalur di sekitar `from` dalam rentang jarak [min, max]; munculkan
// cadangan yang lebih longgar atau seluruh jalur jika rentang terlalu sempit.
function pointsInRing(world, from, min, max) {
  let pts = world.lanePoints.filter((p) => {
    const d = distance(p, from);
    return d >= min && d <= max;
  });
  if (!pts.length) pts = world.lanePoints.filter((p) => distance(p, from) >= min * 0.5);
  return pts.length ? pts : world.lanePoints;
}

function randomSpot(world, from, min, max) {
  const p = pickOne(pointsInRing(world, from, min, max));
  if (!p) return { x: world.width / 2, y: world.height / 2 }; // fallback kalau lanePoints kosong
  return { x: p.x, y: p.y };
}

function spawnLaneCar(world, point, dir, driver, color, speed) {
  const car = {
    x: point.x, y: point.y, angle: headingFor(point, dir), speed, color,
    driver, horizontal: point.horizontal, dir, hp: 100,
  };
  world.cars.push(car);
  return car;
}

function slideAlongLane(world, car, speed, dt) {
  const axis = car.horizontal ? 'x' : 'y';
  if (car[axis] > world.width - 30) car.dir = -1; else if (car[axis] < 30) car.dir = 1;
  car.angle = headingFor(car, car.dir);
  car.speed = speed;
  car.x += Math.cos(car.angle) * speed * dt;
  car.y += Math.sin(car.angle) * speed * dt;
}

// Arah (+1/-1) dari `from` menuju titik jalur `point`, agar target menjauh/mendekat secara masuk akal.
function laneDirection(point, from) {
  return (point.horizontal ? point.x - from.x : point.y - from.y) >= 0 ? 1 : -1;
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

// ——— API MISI ———
export function createMissions(world, ui, audio) {
  let cursor = (ui.missionsDone || 0) % STORY_MISSIONS;
  let gap = 0;
  let startHp = 100; // kondisi mobil repo saat diambil — dipakai untuk deteksi "rusak".

  const say = (who, text) => ui.toast(who + ': ' + text, 4.5);

  const m = {
    list: MISSION_LIST,
    active: null,
    done: 0,
    markers: [],
    target: null,
    focus: { x: 0, y: 0 },
    checkpoint: null,

    // Maju ke misi cerita berikutnya (membungkus lewat daftar 8 misi).
    next() {
      m.start(MISSION_LIST[cursor % STORY_MISSIONS].id);
    },

    // Mulai pekerjaan sampingan tanpa menggeser rantai cerita.
    startSide(id) {
      const def = findDef(id);
      if (!def) return;
      m.start(id);
    },

    start(id) {
      discardActive();
      const def = findDef(id);
      if (!def) throw new Error('misi tidak dikenal: ' + id);
      m.active = { id, def, title: def.title, pending: true, t: 0, cars: [], stage: 0 };
      // Pulihkan objektif checkpoint bila misi yang sama barusan gagal.
      restoreCheckpoint(m.active);
      gap = 0;
    },

    update(dt, player, w = world) {
      const focus = player.car || player;
      m.focus = focus;
      if (!m.active) {
        if (gap > 0) { gap -= dt; if (gap <= 0) m.next(); }
        return;
      }
      const a = m.active;
      if (a.pending) { a.pending = false; init(a, focus, w); say(a.def.who, a.def.intro); }
      a.t += dt;
      const handler = handlerFor(a.id);
      handler.update(a, focus, dt);
      if (m.active === a && !handler.noLimit && a.t > a.def.limit) { fail(); return; }
      if (m.active === a) refreshMarkers();
    },

    abort() { if (m.active) fail(); },

    get objectiveText() {
      const a = m.active;
      if (!a) return gap > 0 ? 'MISI BERIKUTNYA...' : '';
      if (a.pending) return a.title;
      const handler = handlerFor(a.id);
      const left = handler.noLimit ? '' : ` — ${Math.max(0, Math.ceil(a.def.limit - a.t))}s`;
      return `${a.title}: ${handler.text(a)}${left}`;
    },
  };

  // ——— PEMBACAAN / PENULISAN STATUS ———
  function findDef(id) {
    return MISSION_LIST.find((d) => d.id === id);
  }

  function handlerFor(id) {
    const h = HANDLERS[id];
    if (!h) throw new Error('handler misi tidak dikenal: ' + id);
    return h;
  }

  function restoreCheckpoint(a) {
    const cp = m.checkpoint;
    if (!cp || cp.id !== a.id) return;
    a.stage = cp.stage;
    if (cp.wave != null) a.wave = cp.wave;
    if (cp.waveT != null) a.waveT = cp.waveT;
    if (cp.waveDuration != null) a.waveDuration = cp.waveDuration;
    if (cp.dest) a.dest = cp.dest;
    if (cp.pickup) a.pickup = cp.pickup;
    if (cp.points) a.points = cp.points;
    if (cp.score != null) a.score = cp.score;
    if (cp.ramps) a.ramps = cp.ramps;
    a.cp = cp;
    delete m.checkpoint;
  }

  function discardActive() {
    const a = m.active;
    if (a) {
      for (const c of a.cars) {
        const i = world.cars.indexOf(c);
        if (i >= 0) world.cars.splice(i, 1);
      }
    }
    m.active = null;
    m.markers = [];
    m.target = null;
  }

  // ——— ALUR MISI (init → update → finish/fail) ———
  function init(a, focus, w) {
    m.focus = focus;
    if (a.cp) { a.cp = null; return; } // checkpoint sudah memulihkan stage & objektif di start()

    switch (a.id) {
      case 'delivery':
        a.dest = randomSpot(w, focus, 150, 350);
        break;
      case 'chase':
        a.car = spawnTarget(w, focus, 260, 340, '#ff2fb3', 170);
        a.hold = 0;
        break;
      case 'execute':
        a.car = spawnStill(w, focus, 250, 450, '#7a1fff', CAR_HITPOINTS.execute);
        break;
      case 'protect':
        a.car = spawnAlly(w, focus);
        a.thugs = spawnThugs(w, focus, a.car);
        break;
      case 'steal':
        a.dest = randomSpot(w, focus, 300, 550);
        break;
      case 'race':
        a.points = chainSpots(w, focus, 5, 120, 260);
        break;
      case 'wave':
        a.pulse = 0;
        a.wave = 0;
        break;
      case 'finale':
        a.dest = randomSpot(w, focus, 250, 450);
        break;
      case 'heist':
        a.dest = randomSpot(w, focus, 250, 450);
        break;
      case 'taxi':
        a.pickup = randomSpot(w, focus, 300, 550);
        break;
      case 'stunt':
        a.score = 0;
        a.air = 0;
        a.airborne = false;
        a.ramps = chainSpots(w, focus, 3, 160, 340);
        break;
      case 'bounty':
        a.car = spawnTarget(w, focus, 260, 380, '#ff6b1a', 240);
        a.car.hp = CAR_HITPOINTS.bounty;
        a.hold = 0;
        break;
      case 'pizza':
        a.points = chainSpots(w, focus, 3, 250, 500);
        break;
      case 'repo':
        a.car = spawnStill(w, focus, 260, 450, '#22d3ee', CAR_HITPOINTS.repo);
        a.garage = w.garage || { x: 1312, y: 1450 };
        break;
      default:
        break;
    }
  }

  // Kendaraan target yang melaju di jalur, memilih titik jalur berarah lurus.
  function spawnTarget(w, focus, min, max, color, speed) {
    const p = pickOne(pointsInRing(w, focus, min, max));
    const dir = laneDirection(p, focus);
    const car = spawnLaneCar(w, p, dir, 'target', color, speed);
    a_latest().cars.push(car); // dipanggil dari init; a aktif adalah m.active
    return car;
  }

  // Kendaraan diam bertanda untuk dihancurkan/dicuri.
  function spawnStill(w, focus, min, max, color, hp) {
    const p = pickOne(pointsInRing(w, focus, min, max));
    const car = spawnLaneCar(w, p, 1, 'mark', color, 0);
    car.hp = hp;
    a_latest().cars.push(car);
    return car;
  }

  // Sekutu (Lena) yang dikawal.
  function spawnAlly(w, focus) {
    const p = pickOne(pointsInRing(w, focus, 60, 160));
    const dir = p.horizontal ? (p.x > focus.x ? 1 : -1) : (p.y > focus.y ? 1 : -1);
    const car = spawnLaneCar(w, p, dir, 'ally', '#37d6a0', 70);
    a_latest().cars.push(car);
    return car;
  }

  // Dua pengejar geng yang membuntuti sekutu.
  function spawnThugs(w, focus, ally) {
    const p = ally; // pakai titik jalur sekutu agar arahnya konsisten
    const dir = p.horizontal ? (p.x > focus.x ? 1 : -1) : (p.y > focus.y ? 1 : -1);
    const thugs = [];
    for (let i = 0; i < 2; i++) {
      const back = i * 70 + 150;
      const pos = {
        x: clamp(ally.x - Math.cos(ally.angle) * back, 40, w.width - 40),
        y: clamp(ally.y - Math.sin(ally.angle) * back, 40, w.height - 40),
        horizontal: p.horizontal,
      };
      const th = spawnLaneCar(w, pos, dir, 'thug', '#303030', 120);
      thugs.push(th);
      a_latest().cars.push(th);
    }
    return thugs;
  }

  // Rangkaian titik berurutan (checkpoint/ramp/pizza) menjauh dari lokasi awal.
  function chainSpots(w, focus, count, min, max) {
    const spots = [];
    let from = focus;
    for (let i = 0; i < count; i++) {
      const p = randomSpot(w, from, min, max);
      spots.push(p);
      from = p;
    }
    return spots;
  }

  function a_latest() { return m.active; }

  function finish() {
    const a = m.active;
    const reward = a.def.reward + (a.bonus || 0);
    const isSide = a.def.kind === 'side';
    ui.addMoney(reward);
    ui.toast(`MISI SELESAI +$${reward}`);
    say(a.def.who, a.def.win);
    if (!isSide) { ui.missionsDone++; m.done++; }
    if (ui.rep) {
      ui.rep.add(m.focus.x, m.focus.y, 10);
      const bonus = ui.rep.job(m.focus.x, m.focus.y);
      if (bonus) { ui.addMoney(bonus); ui.toast(`REP DISTRIK +$${bonus}`); }
    }
    audio.complete();
    cursor = isSide ? cursor : (indexOfStory(a.def) + 1) % STORY_MISSIONS;
    m.checkpoint = null;
    discardActive();
    ui.save();
    gap = COOLDOWN_SECONDS;
  }

  function indexOfStory(def) {
    return MISSION_LIST.indexOf(def);
  }

  function fail() {
    const a = m.active;
    ui.toast('MISI GAGAL');
    say(a.def.who, a.def.lose);
    m.checkpoint = snapshotCheckpoint(a);
    discardActive();
    gap = COOLDOWN_SECONDS;
  }

  function snapshotCheckpoint(a) {
    if (a.stage <= 0) return null;
    return {
      id: a.id,
      stage: a.stage,
      wave: a.wave,
      waveT: a.waveT,
      waveDuration: a.waveDuration,
      dest: a.dest ? { x: a.dest.x, y: a.dest.y } : null,
      pickup: a.pickup ? { x: a.pickup.x, y: a.pickup.y } : null,
      points: a.points ? a.points.map((p) => ({ x: p.x, y: p.y })) : null,
      score: a.score,
      ramps: a.ramps ? a.ramps.map((p) => ({ x: p.x, y: p.y })) : null,
    };
  }

  function refreshMarkers() {
    const a = m.active;
    if (!a || a.pending) { m.markers = []; m.target = null; return; }
    const handler = handlerFor(a.id);
    m.markers = handler.markers(a);
    m.target = handler.target(a);
  }

  // ——— REGISTRI HANDLER PER-MISI ———
  // Tiap handler menyediakan update(a, focus, dt), text(a), markers(a), target(a),
  // dan opsional noLimit untuk misi tanpa batas waktu global.
  const HANDLERS = {
    delivery: {
      update(a, focus) {
        if (distance(focus, a.dest) >= ARRIVE_DISTANCE) return;
        if (a.stage === 0) {
          a.stage = 1;
          a.dest = randomSpot(world, a.dest, 400, 700);
          ui.toast('PAKET DIAMBIL');
          say(a.def.who, 'Bagus, sekarang antar ke klien!');
        } else finish();
      },
      text: (a) => `${a.stage ? 'ANTAR' : 'AMBIL'} ${Math.round(distance(m.focus, a.dest))}m`,
      markers: (a) => [{ x: a.dest.x, y: a.dest.y, scale: 1 }],
      target: (a) => a.dest,
    },

    chase: {
      update(a, focus, dt) {
        slideAlongLane(world, a.car, 170, dt);
        a.hold = distance(focus, a.car) < ARRIVE_DISTANCE ? a.hold + dt : 0;
        if (a.hold >= 2) finish();
      },
      text: (a) => `${Math.round(distance(m.focus, a.car))}m${a.hold > 0 ? ` (${a.hold.toFixed(1)}/2s)` : ''}`,
      markers: (a) => [{ x: a.car.x, y: a.car.y, scale: 0.6 }],
      target: (a) => a.car,
    },

    execute: {
      update(a) {
        if (!world.cars.includes(a.car)) finish();
      },
      text: (a) => `HANCURKAN MOBIL ${Math.round(distance(m.focus, a.car))}m`,
      markers: (a) => [{ x: a.car.x, y: a.car.y, scale: 0.6 }],
      target: (a) => a.car,
    },

    protect: {
      noLimit: true,
      update(a, focus, dt) {
        const ally = a.car;
        if (ally.hp <= 0) { fail(); return; }
        slideAlongLane(world, ally, 70, dt);
        a.thugs = a.thugs.filter((th) => world.cars.includes(th));
        for (const th of a.thugs) {
          slideAlongLane(world, th, 120, dt);
          if (distance(th, ally) < 45) ally.hp -= 10 * dt;
        }
        a.far = distance(focus, ally) > 350 ? (a.far || 0) + dt : 0;
        if (a.far > 8) { fail(); return; }
        if (a.t >= a.def.limit) finish();
      },
      text: (a) => `LENA ${Math.max(0, Math.round(a.car.hp))}% — PENGEJAR ${a.thugs.length} — ${Math.max(0, Math.ceil(a.def.limit - a.t))}s${distance(m.focus, a.car) > 200 ? ' — DEKATI!' : ''}`,
      markers: (a) => [{ x: a.car.x, y: a.car.y, scale: 0.6 }],
      target: (a) => a.car,
    },

    steal: {
      update(a, focus) {
        if (distance(focus, a.dest) >= ARRIVE_DISTANCE) return;
        if (a.stage === 0) {
          a.stage = 1;
          a.dest = randomSpot(world, a.dest, 450, 750);
          addHeat(world, 150, 'steal');
          ui.toast('KARGO DIAMBIL — POLISI DATANG');
          say('Tikus', 'Alarm menyala! Kabur ke titik aman!');
        } else finish();
      },
      text: (a) => `${a.stage ? 'KABUR' : 'GUDANG'} ${Math.round(distance(m.focus, a.dest))}m`,
      markers: (a) => [{ x: a.dest.x, y: a.dest.y, scale: 1 }],
      target: (a) => a.dest,
    },

    race: {
      update(a, focus) {
        if (distance(focus, a.points[a.stage]) >= 35) return;
        a.stage++;
        if (a.stage >= a.points.length) finish();
        else ui.toast(`CHECKPOINT ${a.stage}/${a.points.length}`);
      },
      text: (a) => `CP ${a.stage + 1}/${a.points.length}`,
      markers: (a) => a.points.slice(a.stage, a.stage + 2).map((p, i) => ({ x: p.x, y: p.y, scale: i ? 0.5 : 0.9 })),
      target: (a) => a.points[a.stage],
    },

    wave: {
      noLimit: true,
      update(a, focus, dt) {
        a.pulse -= dt;
        if (a.pulse <= 0) { a.pulse = 1; addHeat(world, world.police.stars < 3 ? 100 : 8, 'wave'); }
        const w = Math.floor(a.t / 15) + 1;
        if (w > a.wave) { a.wave = w; ui.toast('GELOMBANG ' + w); }
        if (a.t >= a.def.limit) finish();
      },
      text: (a) => `BERTAHAN ${Math.max(0, Math.ceil(a.def.limit - a.t))}s — GELOMBANG ${a.wave}`,
      markers: () => [],
      target: () => null,
    },

    finale: {
      update(a, focus) {
        if (a.stage === 0) {
          if (distance(focus, a.dest) < ARRIVE_DISTANCE) {
            a.stage = 1;
            const p = randomSpot(world, focus, 250, 450);
            a.car = spawnLaneCar(world, p, 1, 'mark', '#7a1fff', 0);
            a.car.horizontal = true;
            a.car.hp = CAR_HITPOINTS.finale;
            a.cars.push(a.car);
            addHeat(world, 200, 'finale');
            say('Don Vega', 'Kamu berani datang. Habisi mobilku kalau bisa!');
          }
        } else if (!world.cars.includes(a.car)) finish();
      },
      text: (a) => (a.stage
        ? `HANCURKAN MOBIL BOS ${Math.round(distance(m.focus, a.car))}m (${Math.max(0, Math.round(a.car.hp))} HP)`
        : `TEMUI BOS ${Math.round(distance(m.focus, a.dest))}m`),
      markers: (a) => (a.stage ? [{ x: a.car.x, y: a.car.y, scale: 0.7 }] : [{ x: a.dest.x, y: a.dest.y, scale: 1 }]),
      target: (a) => (a.stage ? a.car : a.dest),
    },

    // PERAMPOKAN BANK: ambil brankas, tahan 2 gelombang polisi, kabur pakai mobil ke titik aman.
    heist: {
      update(a, focus, dt) {
        if (a.stage === 0) {
          if (distance(focus, a.dest) < ARRIVE_DISTANCE) {
            a.stage = 1; a.wave = 1; a.waveT = 0; a.waveDuration = 20; a.pulse = 0;
            addHeat(world, 150, 'heist');
            ui.toast('BRANKAS DIJEBOL — GELOMBANG 1');
            say(a.def.who, 'Alarm menyala! Tahan dua gelombang polisi!');
          }
        } else if (a.stage === 1) {
          a.pulse -= dt;
          if (a.pulse <= 0) { a.pulse = 1.5; addHeat(world, world.police.stars < 3 ? 100 : 8, 'heist'); }
          a.waveT += dt;
          if (a.waveT >= a.waveDuration) {
            a.wave++;
            if (a.wave > 2) {
              a.stage = 2;
              a.dest = randomSpot(world, focus, 350, 650);
              ui.toast('LUPAKAN UANG — KABUR PAKAI MOBIL!');
              say(a.def.who, 'Lari sekarang, ke titik aman!');
            } else {
              a.waveT = 0;
              ui.toast('GELOMBANG ' + a.wave);
            }
          }
        } else if (distance(focus, a.dest) < ARRIVE_DISTANCE) {
          finish();
        }
      },
      text: (a) => {
        if (a.stage === 0) return `BOBRAK BANK ${Math.round(distance(m.focus, a.dest))}m`;
        if (a.stage === 1) return `TAHAN POLISI — GELOMBANG ${a.wave}/2 (${Math.max(0, Math.ceil(a.waveDuration - a.waveT))}s)`;
        return `KABUR ${Math.round(distance(m.focus, a.dest))}m`;
      },
      markers: (a) => (a.stage === 2
        ? [{ x: a.dest.x, y: a.dest.y, scale: 1 }]
        : a.stage === 0 ? [{ x: a.dest.x, y: a.dest.y, scale: 1 }] : []),
      target: (a) => (a.stage === 2 || a.stage === 0 ? a.dest : null),
    },

    // TARIF TAKSI: jemput penumpang, antar ke tujuan, terima bayaran.
    taxi: {
      update(a, focus) {
        if (a.stage === 0) {
          if (distance(focus, a.pickup) >= ARRIVE_DISTANCE) return;
          a.stage = 1;
          a.dest = randomSpot(world, a.pickup, 350, 700);
          ui.toast('PENUMPANG NAIK');
          say(a.def.who, 'Nggih, antar ke alamat ini, cepat!');
        } else if (distance(focus, a.dest) < ARRIVE_DISTANCE) {
          finish();
        }
      },
      text: (a) => `${a.stage ? 'ANTAR PENUMPANG' : 'JEMPUT'} ${Math.round(distance(m.focus, a.stage ? a.dest : a.pickup))}m`,
      markers: (a) => [{ x: a.stage ? a.dest.x : a.pickup.x, y: a.stage ? a.dest.y : a.pickup.y, scale: 1 }],
      target: (a) => (a.stage ? a.dest : a.pickup),
    },

    // LOMPATAN STUNT: 3 ramp ditandai, dinilai air time (waktu melayang) dan mendarat mulus.
    stunt: {
      update(a, focus, dt) {
        const car = asCar(focus);
        const speed = car ? Math.abs(car.speed) : 0;
        if (!a.ramps) return;
        const ramp = a.ramps[a.stage];

        if (a.airborne) {
          a.air += dt;
          if (a.air >= 0.25 && (speed < 90 || distance(focus, ramp) > 260)) {
            a.airborne = false;
            const airScore = Math.min(100, a.air * 80);
            const landed = speed > 40 && speed < 260 && car ? 1 : 0;
            const landingScore = landed ? 40 : 0;
            const jumpScore = Math.round(airScore + landingScore);
            a.score += jumpScore;
            ui.toast('RAMP ' + (a.stage + 1) + '/3 — AIR ' + a.air.toFixed(1) + 's — SKOR +' + jumpScore);
            say(a.def.who, a.stage + 1 >= a.ramps.length ? 'Tuntas tiga ramp! Maestro.' : 'Bagus, lanjut ramp berikutnya!');
            a.stage++;
            a.air = 0;
            if (a.stage >= a.ramps.length) finish();
            else say(a.def.who, 'Ramp berikutnya ditandai. Gas lagi!');
          }
          return;
        }

        if (distance(focus, ramp) >= 34) return;
        if (speed < 140) {
          ui.toast('LAJU TERLALU PELAN — BUTUH ' + Math.round(140 - speed) + ' KM/JAM LAGI', 1.2);
          return;
        }
        a.airborne = true; a.air = 0;
      },
      text: (a) => (a.airborne
        ? `MELAYANG ${a.air.toFixed(1)}s — SKOR ${a.score}`
        : `RAMP ${a.stage + 1}/3 ${Math.round(distance(m.focus, a.ramps[a.stage]))}m — SKOR ${a.score}`),
      markers: (a) => a.ramps.slice(a.stage, a.stage + 1).map((p) => ({ x: p.x, y: p.y, scale: 1 })),
      target: (a) => a.ramps[a.stage],
    },

    // BURUAN HIDUP: target kabur pakai mobil cepat, hentikan (tempel & rusak) sebelum timer habis.
    bounty: {
      update(a, focus, dt) {
        if (!a.car) return;
        slideAlongLane(world, a.car, 240, dt);

        if (distance(focus, a.car) < 30) {
          a.hold += dt;
          a.car.hp = Math.max(0, (a.car.hp ?? 150) - 40 * dt);
        } else {
          a.hold = Math.max(0, a.hold - dt * 2);
        }

        const car = asCar(focus);
        if (car && distance(focus, a.car) < 34 && Math.abs(car.speed) > 150) {
          a.car.hp = Math.max(0, (a.car.hp ?? 150) - 80 * dt);
        }

        if ((a.car.hp ?? 150) <= 0 || a.hold >= 2.5) finish();
      },
      text: (a) => `HENTIKAN TARGET ${Math.round(distance(m.focus, a.car))}m (${Math.max(0, Math.round(a.car.hp))}% HP)`,
      markers: (a) => [{ x: a.car.x, y: a.car.y, scale: 0.6 }],
      target: (a) => a.car,
    },

    // KIRIM PIZZA: antar ke 3 titik berurutan sebelum dingin, bonus kalau cepat.
    pizza: {
      update(a, focus) {
        const cur = a.points[a.stage];
        if (distance(focus, cur) >= ARRIVE_DISTANCE) return;
        a.stage++;
        if (a.stage >= a.points.length) {
          const left = a.def.limit - a.t;
          a.bonus = Math.max(0, Math.round(left)) * 5;
          ui.toast(`SEMUA PIZZA TERKIRIM! BONUS +$${a.bonus}`);
          finish();
        } else {
          ui.toast(`PIZZA ${a.stage}/${a.points.length} DITERIMA`);
        }
      },
      text: (a) => `ANTAR ${a.stage + 1}/3 ${Math.round(distance(m.focus, a.points[a.stage]))}m`,
      markers: (a) => a.points.slice(a.stage, a.stage + 1).map((p) => ({ x: p.x, y: p.y, scale: 1 })),
      target: (a) => a.points[a.stage],
    },

    // REPOSESSI MOBIL: curi mobil bertanda, bawa ke garasi tanpa merusaknya.
    repo: {
      update(a, focus) {
        if (a.stage === 0) {
          if (distance(focus, a.car) >= ARRIVE_DISTANCE) return;
          a.stage = 1;
          const cp = m.focus.car;
          startHp = cp ? (cp.hp ?? cp.maxHp ?? 100) : 100;
          const i = world.cars.indexOf(a.car);
          if (i >= 0) world.cars.splice(i, 1);
          addHeat(world, 120, 'repo');
          ui.toast('MOBIL DICURI — BAWA KE GARASI UTUH!');
          say(a.def.who, 'Jangan sampai lecet! Polisi memburumu.');
        } else {
          const cp = m.focus.car;
          const hp = cp ? (cp.hp ?? cp.maxHp ?? 100) : 100;
          if (hp <= startHp * 0.35) { fail(); return; }
          if (distance(m.focus, a.garage) < 60) finish();
        }
      },
      text: (a) => (a.stage
        ? `BAWA KE GARASI ${Math.round(distance(m.focus, a.garage))}m — KONDISI ${Math.max(0, Math.round(100 * (m.focus.car ? (m.focus.car.hp ?? 100) : 100) / startHp))}%`
        : `CURI MOBIL ${Math.round(distance(m.focus, a.car))}m`),
      markers: (a) => (a.stage ? [{ x: a.garage.x, y: a.garage.y, scale: 1 }] : [{ x: a.car.x, y: a.car.y, scale: 0.7 }]),
      target: (a) => (a.stage ? a.garage : a.car),
    },
  };

  return m;
}