// missions.js — 8 misi berantai dengan cerita singkat: kurir, kejar, eksekusi, lindungi, curi, balapan, gelombang polisi, finale
// Rangkaian misi dan alur ceritanya karangan asli untuk kota SUNNY CITY.
import { addHeat } from './police.js';

const GAP_SECONDS = 3;
const REACH = 40;

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

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// f bisa mobil (punya speed & angle) atau pejalan kaki (punya vx/vy).
const playerCar = (f) => (f && f.speed !== undefined && f.angle !== undefined ? f : null);

function ptsBetween(world, from, min, max) {
  let pts = world.lanePoints.filter((p) => { const d = dist(p, from); return d >= min && d <= max; });
  if (!pts.length) pts = world.lanePoints.filter((p) => dist(p, from) >= min * 0.5);
  return pts.length ? pts : world.lanePoints;
}

function spot(world, from, min, max) {
  const p = pick(ptsBetween(world, from, min, max));
  return { x: p.x, y: p.y };
}

function laneAngle(p, dir) {
  return p.horizontal ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
}

function laneCar(world, p, dir, driver, color, speed) {
  const car = { x: p.x, y: p.y, angle: laneAngle(p, dir), speed, color, driver, horizontal: p.horizontal, dir, hp: 100 };
  world.cars.push(car);
  return car;
}

function driveLane(world, c, speed, dt) {
  const pos = c.horizontal ? 'x' : 'y';
  if (c[pos] > world.width - 30) c.dir = -1; else if (c[pos] < 30) c.dir = 1;
  c.angle = laneAngle(c, c.dir);
  c.speed = speed;
  c.x += Math.cos(c.angle) * speed * dt;
  c.y += Math.sin(c.angle) * speed * dt;
}

export function createMissions(world, ui, audio) {
  let cursor = (ui.missionsDone || 0) % MISSION_LIST.length;
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

    next() {
      m.start(MISSION_LIST[cursor % MISSION_LIST.length].id);
    },

    // Mulai pekerjaan sampingan (side jobs) dari Log Misi tanpa menggeser rantai cerita.
    startSide(id) {
      const def = MISSION_LIST.find((d) => d.id === id);
      if (!def) return;
      m.start(id);
    },

    start(id) {
      cleanup();
      const idx = MISSION_LIST.findIndex((d) => d.id === id);
      if (idx < 0) throw new Error('misi tidak dikenal: ' + id);
      const def = MISSION_LIST[idx];
      m.active = { id, def, title: def.title, pending: true, t: 0, cars: [], stage: 0 };
      // Checkpoint respawn: kalau misi yang sama baru gagal dan punya cache objektif, pulihkan posisinya.
      if (m.checkpoint && m.checkpoint.id === id) {
        const cp = m.checkpoint;
        m.active.stage = cp.stage;
        if (cp.wave != null) m.active.wave = cp.wave;
        if (cp.waveT != null) m.active.waveT = cp.waveT;
        if (cp.waveDuration != null) m.active.waveDuration = cp.waveDuration;
        if (cp.dest) m.active.dest = cp.dest;
        if (cp.pickup) m.active.pickup = cp.pickup;
        if (cp.points) m.active.points = cp.points;
        if (cp.score != null) m.active.score = cp.score;
        if (cp.ramps) m.active.ramps = cp.ramps;
        m.active.cp = cp;
        delete m.checkpoint;
      }
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
      HANDLERS[a.id].update(a, focus, dt);
      if (m.active === a && !HANDLERS[a.id].noLimit && a.t > a.def.limit) { fail(); return; }
      if (m.active === a) refreshMarkers();
    },

    abort() { if (m.active) fail(); },

    get objectiveText() {
      const a = m.active;
      if (!a) return gap > 0 ? 'MISI BERIKUTNYA...' : '';
      if (a.pending) return a.title;
      const h = HANDLERS[a.id];
      const left = h.noLimit ? '' : ` — ${Math.max(0, Math.ceil(a.def.limit - a.t))}s`;
      return `${a.title}: ${h.text(a)}${left}`;
    },
  };

  const HANDLERS = {
    delivery: {
      update(a, f) {
        if (dist(f, a.dest) >= REACH) return;
        if (a.stage === 0) {
          a.stage = 1; a.dest = spot(world, a.dest, 400, 700);
          ui.toast('PAKET DIAMBIL'); say(a.def.who, 'Bagus, sekarang antar ke klien!');
        } else finish();
      },
      text: (a) => `${a.stage ? 'ANTAR' : 'AMBIL'} ${Math.round(dist(m.focus, a.dest))}m`,
      markers: (a) => [{ x: a.dest.x, y: a.dest.y, scale: 1 }],
      target: (a) => a.dest,
    },
    chase: {
      update(a, f, dt) {
        driveLane(world, a.car, 170, dt);
        if (dist(f, a.car) < REACH) a.hold += dt; else a.hold = 0;
        if (a.hold >= 2) finish();
      },
      text: (a) => `${Math.round(dist(m.focus, a.car))}m${a.hold > 0 ? ` (${a.hold.toFixed(1)}/2s)` : ''}`,
      markers: (a) => [{ x: a.car.x, y: a.car.y, scale: 0.6 }],
      target: (a) => a.car,
    },
    execute: {
      update(a) {
        if (!world.cars.includes(a.car)) finish();
      },
      text: (a) => `HANCURKAN MOBIL ${Math.round(dist(m.focus, a.car))}m`,
      markers: (a) => [{ x: a.car.x, y: a.car.y, scale: 0.6 }],
      target: (a) => a.car,
    },
    protect: {
      noLimit: true,
      update(a, f, dt) {
        const ally = a.car;
        if (ally.hp <= 0) { fail(); return; }
        driveLane(world, ally, 70, dt);
        a.thugs = a.thugs.filter((th) => world.cars.includes(th));
        for (const th of a.thugs) {
          driveLane(world, th, 120, dt);
          if (dist(th, ally) < 45) ally.hp -= 10 * dt;
        }
        a.far = dist(f, ally) > 350 ? (a.far || 0) + dt : 0;
        if (a.far > 8) { fail(); return; }
        if (a.t >= a.def.limit) finish();
      },
      text: (a) => `LENA ${Math.max(0, Math.round(a.car.hp))}% — PENGEJAR ${a.thugs.length} — ${Math.max(0, Math.ceil(a.def.limit - a.t))}s${dist(m.focus, a.car) > 200 ? ' — DEKATI!' : ''}`,
      markers: (a) => [{ x: a.car.x, y: a.car.y, scale: 0.6 }],
      target: (a) => a.car,
    },
    steal: {
      update(a, f) {
        if (dist(f, a.dest) >= REACH) return;
        if (a.stage === 0) {
          a.stage = 1; a.dest = spot(world, a.dest, 450, 750);
          addHeat(world, 150, 'steal');
          ui.toast('KARGO DIAMBIL — POLISI DATANG'); say('Tikus', 'Alarm menyala! Kabur ke titik aman!');
        } else finish();
      },
      text: (a) => `${a.stage ? 'KABUR' : 'GUDANG'} ${Math.round(dist(m.focus, a.dest))}m`,
      markers: (a) => [{ x: a.dest.x, y: a.dest.y, scale: 1 }],
      target: (a) => a.dest,
    },
    race: {
      update(a, f) {
        if (dist(f, a.points[a.stage]) >= 35) return;
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
      update(a, f, dt) {
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
      update(a, f) {
        if (a.stage === 0) {
          if (dist(f, a.dest) < REACH) {
            a.stage = 1;
            const p = spot(world, f, 250, 450);
            a.car = laneCar(world, p, 1, 'mark', '#7a1fff', 0);
            a.car.horizontal = true;
            a.car.hp = 300; a.cars.push(a.car);
            addHeat(world, 200, 'finale');
            say('Don Vega', 'Kamu berani datang. Habisi mobilku kalau bisa!');
          }
        } else if (!world.cars.includes(a.car)) finish();
      },
      text: (a) => a.stage ? `HANCURKAN MOBIL BOS ${Math.round(dist(m.focus, a.car))}m (${Math.max(0, Math.round(a.car.hp))} HP)` : `TEMUI BOS ${Math.round(dist(m.focus, a.dest))}m`,
      markers: (a) => a.stage ? [{ x: a.car.x, y: a.car.y, scale: 0.7 }] : [{ x: a.dest.x, y: a.dest.y, scale: 1 }],
      target: (a) => (a.stage ? a.car : a.dest),
    },

    // PERAMPOKAN BANK: ambil brankas, tahan 2 gelombang polisi, kabur pakai mobil ke titik aman.
    heist: {
      update(a, f, dt) {
        if (a.stage === 0) {
          // Gelombang 0 = menuju & membobol brankas.
          if (dist(f, a.dest) >= REACH) return;
          a.stage = 1; a.wave = 1; a.waveT = 0; a.waveDuration = 20; a.pulse = 0;
          addHeat(world, 150, 'heist');
          ui.toast('BRANKAS DIJEBOL — GELOMBANG 1');
          say(a.def.who, 'Alarm menyala! Tahan dua gelombang polisi!');
        } else if (a.stage === 1) {
          // Tahan 2 gelombang polisi.
          a.pulse -= dt;
          if (a.pulse <= 0) { a.pulse = 1.5; addHeat(world, world.police.stars < 3 ? 100 : 8, 'heist'); }
          a.waveT += dt;
          if (a.waveT >= a.waveDuration) {
            a.wave++;
            if (a.wave > 2) {
              // Gelombang selesai → kabur pakai mobil.
              a.stage = 2;
              a.dest = spot(world, f, 350, 650);
              ui.toast('LUPAKAN UANG — KABUR PAKAI MOBIL!');
              say(a.def.who, 'Lari sekarang, ke titik aman!');
            } else {
              a.waveT = 0;
              ui.toast('GELOMBANG ' + a.wave);
            }
          }
        } else if (dist(f, a.dest) < REACH) {
          finish();
        }
      },
      text: (a) => {
        if (a.stage === 0) return `BOBRAK BANK ${Math.round(dist(m.focus, a.dest))}m`;
        if (a.stage === 1) return `TAHAN POLISI — GELOMBANG ${a.wave}/2 (${Math.max(0, Math.ceil(a.waveDuration - a.waveT))}s)`;
        return `KABUR ${Math.round(dist(m.focus, a.dest))}m`;
      },
      markers: (a) => (a.stage === 2 ? [{ x: a.dest.x, y: a.dest.y, scale: 1 }] : a.stage === 0 ? [{ x: a.dest.x, y: a.dest.y, scale: 1 }] : []),
      target: (a) => (a.stage === 2 || a.stage === 0 ? a.dest : null),
    },

    // TARIF TAKSI: jemput penumpang, antar ke tujuan, terima bayaran.
    taxi: {
      update(a, f) {
        if (a.stage === 0) {
          if (dist(f, a.pickup) >= REACH) return;
          a.stage = 1; a.dest = spot(world, a.pickup, 350, 700);
          ui.toast('PENUMPANG NAIK');
          say(a.def.who, 'Nggih, antar ke alamat ini, cepat!');
        } else if (dist(f, a.dest) < REACH) {
          finish();
        }
      },
      text: (a) => `${a.stage ? 'ANTAR PENUMPANG' : 'JEMPUT'} ${Math.round(dist(m.focus, a.stage ? a.dest : a.pickup))}m`,
      markers: (a) => [{ x: a.stage ? a.dest.x : a.pickup.x, y: a.stage ? a.dest.y : a.pickup.y, scale: 1 }],
      target: (a) => (a.stage ? a.dest : a.pickup),
    },

    // LOMPATAN STUNT: 3 ramp ditandai, dinilai air time (waktu melayang) dan mendarat mulus.
    stunt: {
      update(a, f, dt) {
        const car = playerCar(f);
        const speed = car ? Math.abs(car.speed) : 0;
        if (!a.ramps) return; // tidak terjadi di luar init
        const ramp = a.ramps[a.stage];

        // Fase melayang: setelah lepas landas dari ramp, hitung air time sampai mendarat.
        if (a.airborne) {
          a.air += dt;
          // Mendarat = kondisi sudah melewati puncak & kecepatan normal kembali / melewati ramp.
          if (a.air >= 0.25 && (speed < 90 || dist(f, ramp) > 260)) {
            a.airborne = false;
            const airScore = Math.min(100, a.air * 80);           // air time → skor 0..100
            const landed = speed > 40 && speed < 260 && car ? 1 : 0; // mendarat mulus (tidak terhenti / kebalik)
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

        // Belum melayang: dekati & lewati ramp dengan kecepatan cukup.
        if (dist(f, ramp) >= 34) return;
        if (speed < 140) { ui.toast('LAJU TERLALU PELAN — BUTUH ' + Math.round(140 - speed) + ' KM/JAM LAGI', 1.2); return; }
        a.airborne = true; a.air = 0;
      },
      text: (a) => {
        if (a.airborne) return `MELAYANG ${a.air.toFixed(1)}s — SKOR ${a.score}`;
        return `RAMP ${a.stage + 1}/3 ${Math.round(dist(m.focus, a.ramps[a.stage]))}m — SKOR ${a.score}`;
      },
      markers: (a) => a.ramps.slice(a.stage, a.stage + 1).map((p, i) => ({ x: p.x, y: p.y, scale: 1 })),
      target: (a) => a.ramps[a.stage],
    },

    // BURUAN HIDUP: target kabur pakai mobil cepat, hentikan (tempel & rusak) sebelum timer habis.
    bounty: {
      update(a, f, dt) {
        if (!a.car) return;
        driveLane(world, a.car, 240, dt);

        // Hentikan: sentuh & tahan cukup lama sambil mobilnya rusak.
        if (dist(f, a.car) < 30) { a.hold += dt; a.car.hp = Math.max(0, (a.car.hp ?? 150) - 40 * dt); }
        else a.hold = Math.max(0, a.hold - dt * 2);

        // Ramming: pemain menabrak target saat kencang → kerusakan besar.
        const car = playerCar(f);
        if (car && dist(f, a.car) < 34 && Math.abs(car.speed) > 150) a.car.hp = Math.max(0, (a.car.hp ?? 150) - 80 * dt);

        if ((a.car.hp ?? 150) <= 0 || a.hold >= 2.5) finish();
      },
      text: (a) => `HENTIKAN TARGET ${Math.round(dist(m.focus, a.car))}m (${Math.max(0, Math.round(a.car.hp))}% HP)`,
      markers: (a) => [{ x: a.car.x, y: a.car.y, scale: 0.6 }],
      target: (a) => a.car,
    },

    // KIRIM PIZZA: antar ke 3 titik berurutan sebelum dingin, bonus kalau cepat.
    pizza: {
      update(a, f) {
        const cur = a.points[a.stage];
        if (dist(f, cur) >= REACH) return;
        a.stage++;
        if (a.stage >= a.points.length) {
          // Bonus uang tunai kalau selesai jauh sebelum batas waktu.
          const left = a.def.limit - a.t;
          a.bonus = Math.max(0, Math.round(left)) * 5;
          ui.toast(`SEMUA PIZZA TERKIRIM! BONUS +$${a.bonus}`);
          finish();
        } else {
          ui.toast(`PIZZA ${a.stage}/${a.points.length} DITERIMA`);
        }
      },
      text: (a) => `ANTAR ${a.stage + 1}/3 ${Math.round(dist(m.focus, a.points[a.stage]))}m`,
      markers: (a) => a.points.slice(a.stage, a.stage + 1).map((p) => ({ x: p.x, y: p.y, scale: 1 })),
      target: (a) => a.points[a.stage],
    },

    // REPOSESSI MOBIL: curi mobil bertanda, bawa ke garasi tanpa merusaknya.
    repo: {
      update(a, f, dt) {
        if (a.stage === 0) {
          // Mendekati mobil bertanda → curi (mobil target hilang, pemain menyetirnya).
          if (dist(f, a.car) >= REACH) return;
          a.stage = 1;
          const cp = m.focus.car;
          startHp = cp ? (cp.hp ?? cp.maxHp ?? 100) : 100;
          const i = world.cars.indexOf(a.car);
          if (i >= 0) world.cars.splice(i, 1);
          addHeat(world, 120, 'repo');
          ui.toast('MOBIL DICURI — BAWA KE GARASI UTUH!');
          say(a.def.who, 'Jangan sampai lecet! Polisi memburumu.');
        } else {
          // Lacak kondisi mobil yang dikemudikan pemain.
          const cp = m.focus.car;
          const hp = cp ? (cp.hp ?? cp.maxHp ?? 100) : 100;
          if (hp <= startHp * 0.35) { fail(); return; }
          if (dist(m.focus, a.garage) < 60) finish();
        }
      },
      text: (a) => a.stage
        ? `BAWA KE GARASI ${Math.round(dist(m.focus, a.garage))}m — KONDISI ${Math.max(0, Math.round(100 * (m.focus.car ? (m.focus.car.hp ?? 100) : 100) / startHp))}%`
        : `CURI MOBIL ${Math.round(dist(m.focus, a.car))}m`,
      markers: (a) => a.stage ? [{ x: a.garage.x, y: a.garage.y, scale: 1 }] : [{ x: a.car.x, y: a.car.y, scale: 0.7 }],
      target: (a) => (a.stage ? a.garage : a.car),
    },
  };

  function init(a, f, w) {
    m.focus = f;
    if (a.cp) { a.cp = null; return; } // checkpoint sudah memulihkan stage & objektif di start()
    if (a.id === 'delivery') a.dest = spot(w, f, 150, 350);
    else if (a.id === 'chase') {
      const p = pick(ptsBetween(w, f, 260, 340));
      const dir = (p.horizontal ? p.x - f.x : p.y - f.y) >= 0 ? 1 : -1;
      a.car = laneCar(w, p, dir, 'target', '#ff2fb3', 170);
      a.cars.push(a.car); a.hold = 0;
    } else if (a.id === 'execute') {
      const p = pick(ptsBetween(w, f, 250, 450));
      a.car = laneCar(w, p, 1, 'mark', '#7a1fff', 0);
      a.car.hp = 150; a.cars.push(a.car);
    } else if (a.id === 'protect') {
      const p = pick(ptsBetween(w, f, 60, 160));
      const dir = p.horizontal ? (p.x > f.x ? 1 : -1) : (p.y > f.y ? 1 : -1);
      a.car = laneCar(w, p, dir, 'ally', '#37d6a0', 70);
      a.cars.push(a.car);
      a.thugs = [];
      for (let i = 0; i < 2; i++) {
        const d = 150 + i * 70;
        const back = {
          x: Math.max(40, Math.min(w.width - 40, a.car.x - Math.cos(a.car.angle) * d)),
          y: Math.max(40, Math.min(w.height - 40, a.car.y - Math.sin(a.car.angle) * d)),
          horizontal: p.horizontal,
        };
        const th = laneCar(w, back, dir, 'thug', '#303030', 120);
        a.thugs.push(th); a.cars.push(th);
      }
    } else if (a.id === 'steal') a.dest = spot(w, f, 300, 550);
    else if (a.id === 'race') {
      a.points = [];
      let from = f;
      for (let i = 0; i < 5; i++) { const p = spot(w, from, 120, 260); a.points.push(p); from = p; }
    } else if (a.id === 'wave') { a.pulse = 0; a.wave = 0; }
    else if (a.id === 'finale') a.dest = spot(w, f, 250, 450);
    else if (a.id === 'heist') a.dest = spot(w, f, 250, 450);
    else if (a.id === 'taxi') a.pickup = spot(w, f, 300, 550);
    else if (a.id === 'stunt') {
      a.stage = 0; a.score = 0; a.air = 0; a.airborne = false;
      a.ramps = [];
      let from = f;
      for (let i = 0; i < 3; i++) {
        const p = spot(w, from, 160, 340); a.ramps.push(p); from = p;
      }
    } else if (a.id === 'bounty') {
      const p = pick(ptsBetween(w, f, 260, 380));
      const dir = (p.horizontal ? p.x - f.x : p.y - f.y) >= 0 ? 1 : -1;
      a.car = laneCar(w, p, dir, 'mark', '#ff6b1a', 240);
      a.car.hp = 150; a.hold = 0; a.cars.push(a.car);
    } else if (a.id === 'pizza') {
      a.points = [];
      let from = f;
      for (let i = 0; i < 3; i++) { const p = spot(w, from, 250, 500); a.points.push(p); from = p; }
    } else if (a.id === 'repo') {
      const p = pick(ptsBetween(w, f, 260, 450));
      const dir = (p.horizontal ? p.x - f.x : p.y - f.y) >= 0 ? 1 : -1;
      a.car = laneCar(w, p, dir, 'mark', '#22d3ee', 0);
      a.car.hp = 100; a.cars.push(a.car);
      a.garage = w.garage || { x: 1312, y: 1450 };
    }
  }

  function cleanup() {
    const a = m.active;
    if (a) for (const c of a.cars) { const i = world.cars.indexOf(c); if (i >= 0) world.cars.splice(i, 1); }
    m.active = null;
    m.markers = [];
    m.target = null;
  }

  function finish() {
    const a = m.active, reward = a.def.reward + (a.bonus || 0);
    const isSide = a.def.kind === 'side';
    ui.addMoney(reward);
    ui.toast(`MISI SELESAI +$${reward}`);
    say(a.def.who, a.def.win);
    if (!isSide) { ui.missionsDone++; m.done++; }
    if (ui.rep) ui.rep.add(m.focus.x, m.focus.y, 10);
    audio.complete();
    cursor = isSide ? cursor : (MISSION_LIST.indexOf(a.def) + 1) % MISSION_LIST.length;
    m.checkpoint = null;
    cleanup();
    ui.save();
    gap = GAP_SECONDS;
  }

  function fail() {
    const a = m.active;
    ui.toast('MISI GAGAL');
    say(a.def.who, a.def.lose);
    // Checkpoint respawn: simpan objektif terakhir supaya ulangan tidak mulai dari nol.
    if (a.stage > 0) {
      m.checkpoint = {
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
    } else {
      m.checkpoint = null;
    }
    cleanup();
    gap = GAP_SECONDS;
  }

  function refreshMarkers() {
    const a = m.active;
    if (!a || a.pending) { m.markers = []; m.target = null; return; }
    const h = HANDLERS[a.id];
    m.markers = h.markers(a);
    m.target = h.target(a);
  }

  return m;
}
