// audio.js — efek suara sintetis WebAudio; AudioContext baru dibuat setelah gesture
// v8: soundscape synth WebAudio lengkap — musik adaptif, mesin, senjata, dan ambience kota.
// Suara game disusun dengan tangan sendiri lewat WebAudio, tanpa berkas audio luar.
// Lapisan: music director adaptif (bass/chord/drum per heat + distrik), engine & ban
// yang mengikuti kecepatan dengan pitching doppler-ish, senjata per jenis + reverb ekor,
// ambience kota (trafik jauh + burung camar dekat air), dan guntur yang menyusul kilat.

// ---- konstanta penalaan ---------------------------------------------------------
const MASTER_VOLUME = 0.35;
const FUEL_LOW = 0.15;
const MAX_DRIVE_SPEED = 470;       // MAX 320 * boost 1.45
const DRIVE_BASE_HZ = 45;
const DRIVE_RAMP_HZ = 130;
const MIDI_A4 = 440;
const CLAMP = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const SIREN_TONES = [650, 950];
const SIREN_AMB_TONES = [440, 660];

// Stasiun radio: pola step disimpan sebagai data, lalu dievaluasi oleh scheduler.
const SYNTH_ROOTS = [33, 29, 36, 31];
const SYNTH_CHORDS = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]];
const FUNK_ROOTS = [40, 40, 45, 45];
const FUNK_BASS = [0, null, 0, 12, null, 0, null, 7, 0, null, 10, null, 0, 12, null, null];
const CHILL_CHORDS = [[65, 69, 72, 76], [64, 67, 71, 74], [62, 65, 69, 72], [60, 64, 67, 71]];
const PENTATONIC = [0, 2, 4, 7, 9];

// Director musik adaptif: rentang/akar & akor per distrik (0 pusat, 1 tengah, 2 pinggir).
const MUSIC_ROOTS = [[38, 41, 43], [33, 36, 38], [31, 34, 36]];
const MUSIC_CHORDS = [
  [[0, 3, 7], [0, 4, 7], [0, 3, 7], [0, 4, 7]],
  [[0, 3, 7], [0, 3, 8], [0, 4, 7], [0, 3, 7]],
  [[0, 3, 7], [0, 3, 7], [0, 4, 7], [0, 2, 7]],
];
const MUSIC_SPB = 60 / 95 / 4;

// Karakter tiap senjata: pitch dasar, durasi, jenis filter, dan level reverb.
const GUN_PROFILES = {
  pistol:     { f: 180, dur: 0.14, lp: 3200, vol: 0.7,  rev: 0.3,  noise: 0.16 },
  smg:        { f: 240, dur: 0.09, lp: 4200, vol: 0.5,  rev: 0.2,  noise: 0.1  },
  compactsmg: { f: 260, dur: 0.08, lp: 5000, vol: 0.42, rev: 0.18, noise: 0.08 },
  shotgun:    { f: 120, dur: 0.28, lp: 1600, vol: 0.9,  rev: 0.5,  noise: 0.34 },
  rifle:      { f: 210, dur: 0.12, lp: 3800, vol: 0.65, rev: 0.35, noise: 0.14 },
  cop:        { f: 200, dur: 0.12, lp: 3400, vol: 0.55, rev: 0.28, noise: 0.12 },
};

export function createAudio() {
  // ---- runtime state -----------------------------------------------------------
  let ac = null, master = null, muted = false, failed = false;
  const ctx = { heat: 0, district: 0, speed: 0, water: 0, time: 0, fuel: 1 };
  const drive = { engOsc: null, engG: null, tyreSrc: null, tyreG: null, tyreF: null, cur: 0 };
  const amb = { trafficG: null, gullG: null, gullTimer: 0, gullNext: 0 };
  const music = { bassG: null, chG: null, drumG: null, step: 0, next: 0, timer: 0, active: false };

  // Note: timers are held via closure-scoped setInterval IDs; see helpers below.

  // ---- pembangkit nada & util ---------------------------------------------------
  const hz = (m) => MIDI_A4 * Math.pow(2, (m - 69) / 12);

  const safe = (fn) => (...args) => {
    if (!ac) return;
    try { return fn(...args); } catch (e) { return undefined; }
  };

  function noiseBuffer(seconds) {
    // Clamp ke >= 1 sampel: Math.floor bisa 0 bila seconds sangat kecil, dan buffer 0-length invalid.
    const buf = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * seconds)), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Gain dengan envelope eksponensial sederhana (peak lalu peluruhan).
  function swelled(t0, peak, dur) {
    const g = ac.createGain();
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    g.connect(master);
    return g;
  }

  // Oscilator satu nada dengan serangan/pelepasan, terhubung ke tujuan tertentu.
  function pipedTone(dest, type, f, t, dur, vol, lp) {
    const o = ac.createOscillator(); o.type = type; o.frequency.value = f;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let head = o;
    if (lp) { const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); head = fl; }
    head.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ---- sirene polisi (jarak dekat) --------------------------------------------
  const siren = {
    gain: null, osc: [], high: false, intensity: 0, timer: 0,
  };
  function startSiren() {
    siren.gain = ac.createGain(); siren.gain.gain.value = 0; siren.gain.connect(master);
    siren.osc = SIREN_TONES.map((f) => {
      const o = ac.createOscillator(); o.type = 'square'; o.frequency.value = f;
      const g = ac.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(siren.gain); o.start();
      return { o, g };
    });
    siren.osc[0].g.gain.value = 1;
    siren.timer = setInterval(toggleSiren, 500);
  }
  function toggleSiren() {
    try {
      siren.high = !siren.high;
      siren.osc[0].g.gain.value = siren.high ? 0 : 1;
      siren.osc[1].g.gain.value = siren.high ? 1 : 0;
    } catch (e) { /* abaikan */ }
  }

  // ---- sirene jauh (dengung redup saat heat tinggi) ----------------------------
  const sirenAmb = { gain: null, osc: [], high: false, timer: 0 };
  function startSirenAmbient() {
    sirenAmb.gain = ac.createGain(); sirenAmb.gain.gain.value = 0; sirenAmb.gain.connect(master);
    sirenAmb.osc = SIREN_AMB_TONES.map((f) => {
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ac.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(sirenAmb.gain); o.start();
      return { o, g };
    });
    sirenAmb.osc[0].g.gain.value = 1;
    sirenAmb.timer = setInterval(toggleSirenAmbient, 900);
  }
  function toggleSirenAmbient() {
    try {
      sirenAmb.high = !sirenAmb.high;
      sirenAmb.osc[0].g.gain.value = sirenAmb.high ? 0 : 1;
      sirenAmb.osc[1].g.gain.value = sirenAmb.high ? 1 : 0;
    } catch (e) { /* abaikan */ }
  }
  function tickSirenAmbient() {
    if (!ac || !sirenAmb.gain) return;
    const t = CLAMP(ctx.heat / 4, 0, 1);
    sirenAmb.gain.gain.setTargetAtTime(t * 0.04, ac.currentTime, 0.8);
  }

  // ---- radio: scheduler step-driven berdasarkan data stasiun -------------------
  const radio = {
    gain: null, noise: null, timer: 0, idx: 0, step: 0, next: 0, active: false,
  };

  // Suara "hit" noise high-pass (snare/hat) yang jadi bahan stasiun & drum director.
  function noiseHit(dest, t, dur, vol, hp) {
    const s = ac.createBufferSource(); s.buffer = radio.noise;
    const fl = ac.createBiquadFilter(); fl.type = 'highpass'; fl.frequency.value = hp;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dest);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  function kick(dest, t, vol) {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.2);
  }

  // Bentuk nada chord synth stasiun: root akor ditambah interval & oktaf.
  function playSynthBarChord(root, chord, t, dur, vol, lp) {
    for (const iv of chord) pipedTone(radio.gain, 'sawtooth', hz(root + 24 + iv), t, dur, vol, lp);
  }

  const STATIONS = [
    {
      name: 'NEON WAVE 101.3 — SYNTHWAVE', spb: 60 / 100 / 4,
      step(s, t) {
        const bar = Math.floor(s / 16) % 4, k = s % 16, root = SYNTH_ROOTS[bar];
        if (k % 4 === 0) kick(radio.gain, t, 0.9);
        if (k === 4 || k === 12) noiseHit(radio.gain, t, 0.14, 0.35, 1800);
        if (k % 2 === 0) pipedTone(radio.gain, 'sawtooth', hz(root + (k % 8 === 6 ? 12 : 0)), t, 0.2, 0.22, 700);
        pipedTone(radio.gain, 'square', hz(root + 24 + SYNTH_CHORDS[bar][k % 3] + (k % 8 >= 4 ? 12 : 0)), t, 0.12, 0.05, 2400);
        if (k === 0) playSynthBarChord(root, SYNTH_CHORDS[bar], t, 16 * this.spb, 0.04, 900);
      },
    },
    {
      name: 'FUNKY TOWN 94.7 — FUNK', spb: 60 / 108 / 4,
      step(s, t) {
        const bar = Math.floor(s / 16) % 4, k = s % 16, root = FUNK_ROOTS[bar];
        if (k === 0 || k === 6 || k === 10) kick(radio.gain, t, 0.85);
        if (k === 4 || k === 12) noiseHit(radio.gain, t, 0.12, 0.5, 1200);
        noiseHit(radio.gain, t, 0.04, k % 4 === 2 ? 0.28 : 0.14, 6000);
        if (FUNK_BASS[k] !== null) pipedTone(radio.gain, 'sawtooth', hz(root + FUNK_BASS[k]), t, 0.14, 0.3, 600);
        if (k === 3 || k === 6 || k === 10 || k === 14) for (const iv of [0, 3, 7, 10]) pipedTone(radio.gain, 'square', hz(root + 24 + iv), t, 0.09, 0.05, 2200);
      },
    },
    {
      name: 'LOFI BAY 88.1 — CHILL', spb: 60 / 76 / 4,
      step(s, t) {
        const bar = Math.floor(s / 16) % 4, k = s % 16, ch = CHILL_CHORDS[bar];
        if (k === 0 || k === 8) for (const n of ch) pipedTone(radio.gain, 'triangle', hz(n), t, 2.2, 0.07, 1400);
        if (k === 0 || k === 10) { kick(radio.gain, t, 0.5); pipedTone(radio.gain, 'sine', hz(ch[0] - 24), t, 0.7, 0.25); }
        if (k % 2 === 0) noiseHit(radio.gain, t, 0.07, 0.1, 7000);
        if (k === 4 || k === 12) noiseHit(radio.gain, t, 0.1, 0.18, 2500);
        if (k % 3 === 1 && Math.random() < 0.6) pipedTone(radio.gain, 'sine', hz(72 + PENTATONIC[Math.floor(Math.random() * 5)]), t, 0.6, 0.08);
      },
    },
  ];

  function radioTick() {
    if (!ac || !radio.active) return;
    const st = STATIONS[radio.idx];
    const horizon = ac.currentTime + 0.35;
    while (radio.next < horizon) { st.step(radio.step++, radio.next); radio.next += st.spb; }
  }
  function radioReset() { radio.step = 0; radio.next = ac.currentTime + 0.05; }

  // ---- director musik adaptif --------------------------------------------------
  function musicBassLayer(t) {
    const heat = ctx.heat, dist = CLAMP(ctx.district, 0, 2), k = music.step % 16;
    const bar = Math.floor(music.step / 16) % 4, root = MUSIC_ROOTS[dist][bar % 3];
    const f = hz(root - 4 + (k % 8 >= 4 ? 12 : 0));
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320 + heat * 220;
    o.connect(lp); lp.connect(g); g.connect(music.bassG); o.start(t); o.stop(t + 0.3);
  }
  function musicChordLayer(t) {
    const heat = ctx.heat, dist = CLAMP(ctx.district, 0, 2);
    const bar = Math.floor(music.step / 16) % 4, root = MUSIC_ROOTS[dist][bar % 3];
    for (const iv of MUSIC_CHORDS[dist][bar]) {
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(root + 24 + iv);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 + heat * 220;
      o.connect(lp); lp.connect(g); g.connect(music.chG); o.start(t); o.stop(t + 0.95);
    }
  }
  function musicDrumLayer(t) {
    const heat = ctx.heat, k = music.step % 16;
    if (k % 4 === 0) {
      const o = ac.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(120 + heat * 12, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      const g = ac.createGain(); g.gain.setValueAtTime(0.38, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g); g.connect(music.drumG); o.start(t); o.stop(t + 0.2);
    }
    if (k % 2 === 1) {
      const s = ac.createBufferSource(); s.buffer = radio.noise;
      const fl = ac.createBiquadFilter(); fl.type = 'highpass'; fl.frequency.value = 6500;
      const g = ac.createGain(); g.gain.setValueAtTime(0.1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      s.connect(fl); fl.connect(g); g.connect(music.drumG); s.start(t, Math.random() * 0.4); s.stop(t + 0.06);
    }
  }
  function musicTick() {
    if (!ac || !music.active) return;
    const horizon = ac.currentTime + 0.4;
    while (music.next < horizon) {
      musicBassLayer(music.next);
      musicChordLayer(music.next);
      musicDrumLayer(music.next);
      music.step++;
      music.next += MUSIC_SPB;
    }
    const heatN = CLAMP(ctx.heat / 5, 0, 1);
    const calm = CLAMP(1 - ctx.district * 0.4, 0, 1);
    const t = ac.currentTime, tc = 0.5;
    music.bassG.gain.setTargetAtTime(0.28 * (0.4 + 0.6 * heatN) * calm, t, tc);
    music.chG.gain.setTargetAtTime(0.16 * (0.5 + 0.5 * heatN) * calm, t, tc);
    music.drumG.gain.setTargetAtTime(0.22 * (0.15 + 0.85 * heatN), t, tc);
  }
  function startMusic() {
    music.bassG = ac.createGain(); music.bassG.gain.value = 0; music.bassG.connect(master);
    music.chG = ac.createGain(); music.chG.gain.value = 0; music.chG.connect(master);
    music.drumG = ac.createGain(); music.drumG.gain.value = 0; music.drumG.connect(master);
    music.next = ac.currentTime + 0.05;
    music.active = true;
    if (!music.timer) music.timer = setInterval(musicTick, 100);
    musicTick();
  }

  // ---- engine & tendon ban (doppler-ish) ---------------------------------------
  function startDrive() {
    drive.engG = ac.createGain(); drive.engG.gain.value = 0; drive.engG.connect(master);
    drive.engOsc = ac.createOscillator(); drive.engOsc.type = 'sawtooth'; drive.engOsc.frequency.value = 55;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
    drive.engOsc.connect(lp); lp.connect(drive.engG); drive.engOsc.start();

    drive.tyreG = ac.createGain(); drive.tyreG.gain.value = 0; drive.tyreG.connect(master);
    drive.tyreF = ac.createBiquadFilter(); drive.tyreF.type = 'bandpass'; drive.tyreF.frequency.value = 900; drive.tyreF.Q.value = 0.8;
    drive.tyreSrc = ac.createBufferSource(); drive.tyreSrc.buffer = noiseBuffer(1); drive.tyreSrc.loop = true;
    drive.tyreSrc.connect(drive.tyreF); drive.tyreF.connect(drive.tyreG); drive.tyreSrc.start();
  }
  function setDrive(speed) {
    if (!ac || !drive.engOsc) return;
    const n = CLAMP(Math.abs(speed), 0, MAX_DRIVE_SPEED) / MAX_DRIVE_SPEED;
    const wobble = 1 + Math.sin(ac.currentTime * 30) * 0.02;
    const f = (DRIVE_BASE_HZ + DRIVE_RAMP_HZ * n) * (1 + n * 0.15) * wobble;
    drive.engOsc.frequency.setTargetAtTime(f, ac.currentTime, 0.05);
    drive.engG.gain.setTargetAtTime(n > 0.005 ? 0.05 + 0.16 * n : 0, ac.currentTime, 0.08);
    const tyreLevel = n > 0.01 ? 0.03 + 0.06 * n : 0;
    drive.tyreG.gain.setTargetAtTime(tyreLevel, ac.currentTime, 0.1);
    drive.tyreF.frequency.setTargetAtTime(700 + 1400 * n, ac.currentTime, 0.1);
    drive.cur = n;
  }

  // ---- ambience kota & camar ---------------------------------------------------
  function gullCall(t) {
    const base = 950 + Math.random() * 500;
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = base;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.6, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(base * 0.7, t + 0.22);
    o.frequency.setValueAtTime(base * 0.7, t + 0.3);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g); g.connect(amb.gullG); o.start(t); o.stop(t + 0.36);
  }
  function startAmbience() {
    amb.trafficG = ac.createGain(); amb.trafficG.gain.value = 0.05; amb.trafficG.connect(master);
    const src = ac.createBufferSource(); src.buffer = noiseBuffer(2); src.loop = true;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    src.connect(lp); lp.connect(amb.trafficG); src.start();
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.13;
    const lfoG = ac.createGain(); lfoG.gain.value = 0.03;
    lfo.connect(lfoG); lfoG.connect(amb.trafficG.gain); lfo.start();

    amb.gullG = ac.createGain(); amb.gullG.gain.value = 0; amb.gullG.connect(master);
    amb.gullNext = ac.currentTime + 2;
  }
  function setWater(amount) {
    if (!ac || !amb.gullG) return;
    ctx.water = CLAMP(amount, 0, 1);
    amb.gullG.gain.setTargetAtTime(ctx.water * 0.5, ac.currentTime, 0.5);
  }
  function tickAmbience() {
    if (!ac || !amb.gullG) return;
    if (ctx.water > 0.3 && ac.currentTime >= amb.gullNext) {
      gullCall(ac.currentTime);
      amb.gullNext = ac.currentTime + 2 + Math.random() * 5;
    }
  }

  // ---- peringatan bahan bakar --------------------------------------------------
  const fuelWarn = { timer: 0, next: 0, beeps: 0 };
  function fuelBeep(f) {
    const t = ac.currentTime;
    const o = ac.createOscillator(); o.type = 'square'; o.frequency.value = f;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.1);
  }
  function tickFuelWarn() {
    if (ctx.fuel > FUEL_LOW) { fuelWarn.beeps = 0; return; }
    if (fuelWarn.timer && ac.currentTime < fuelWarn.next) return;
    fuelBeep(880 + fuelWarn.beeps * 40);
    fuelWarn.beeps = (fuelWarn.beeps + 1) % 2;
    fuelWarn.next = ac.currentTime + (fuelWarn.beeps === 0 ? 0.9 : 0.14);
  }

  // ---- reverb ekor sederhana ---------------------------------------------------
  const reverb = { in: null };
  const reverbNodes = { delay: null, out: null };
  function startReverb() {
    reverb.in = ac.createGain(); reverb.in.gain.value = 1;
    reverbNodes.out = ac.createGain(); reverbNodes.out.gain.value = 0.5;
    reverbNodes.delay = ac.createDelay(1.0); reverbNodes.delay.delayTime.value = 0.16;
    const fb = ac.createGain(); fb.gain.value = 0.45;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    reverb.in.connect(reverbNodes.delay); reverbNodes.delay.connect(fb); fb.connect(lp); lp.connect(reverbNodes.delay);
    reverbNodes.delay.connect(reverbNodes.out); reverbNodes.out.connect(master);
  }
  function sendReverb(node, level) {
    if (!reverb.in) return;
    const g = ac.createGain(); g.gain.value = level;
    node.connect(g); g.connect(reverb.in);
  }

  // ---- suara cuaca (hujan & guntur) --------------------------------------------
  let rainGain = null;
  // ---- efek sekali-pakai -------------------------------------------------------
  // (helpers for crash/click/complete/pickup/thunder/shot reimplemented inline below)

  return {
    start() {
      if (failed) return;
      try {
        if (!ac) {
          const Ctor = window.AudioContext || window.webkitAudioContext;
          if (!Ctor) { failed = true; return; }
          ac = new Ctor();
          master = ac.createGain();
          master.gain.value = muted ? 0 : MASTER_VOLUME;
          master.connect(ac.destination);
          startSiren();
          startSirenAmbient();
          radio.noise = noiseBuffer(1);
          startReverb();
          startMusic();
          startDrive();
          startAmbience();
        }
        if (ac.state === 'suspended') ac.resume();
      } catch (e) { failed = true; ac = null; }
    },
    setSiren: safe((intensity) => {
      siren.intensity = CLAMP(intensity || 0, 0, 1);
      siren.gain.gain.setTargetAtTime(siren.intensity * 0.12, ac.currentTime, 0.1);
    }),
    shot: safe((weapon = 'pistol') => {
      const g = GUN_PROFILES[weapon] || GUN_PROFILES.pistol;
      const t = ac.currentTime;
      const src = ac.createBufferSource(); src.buffer = noiseBuffer(g.noise);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(g.lp, t); lp.frequency.exponentialRampToValueAtTime(120, t + g.dur);
      const mainG = ac.createGain();
      mainG.gain.setValueAtTime(g.vol, t); mainG.gain.exponentialRampToValueAtTime(0.0001, t + g.dur);
      src.connect(lp); lp.connect(mainG); mainG.connect(master);
      const body = ac.createOscillator(); body.type = 'sine';
      body.frequency.setValueAtTime(g.f, t); body.frequency.exponentialRampToValueAtTime(50, t + g.dur * 0.8);
      const bg = ac.createGain(); bg.gain.setValueAtTime(g.vol * 0.6, t); bg.gain.exponentialRampToValueAtTime(0.0001, t + g.dur);
      body.connect(bg); bg.connect(master);
      sendReverb(mainG, g.rev);
      if (weapon === 'shotgun') {
        const src2 = ac.createBufferSource(); src2.buffer = noiseBuffer(0.12);
        const lp2 = ac.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 1200;
        const g2 = ac.createGain(); g2.gain.setValueAtTime(g.vol * 0.5, t + 0.03); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        src2.connect(lp2); lp2.connect(g2); g2.connect(master);
        sendReverb(g2, g.rev);
        src2.start(t + 0.03);
      }
      src.start(t); body.start(t); body.stop(t + g.dur + 0.02);
    }),
    crash: safe((strength = 1) => {
      const t = ac.currentTime, s = CLAMP(strength, 0.2, 1);
      const src = ac.createBufferSource(); src.buffer = noiseBuffer(0.3);
      src.connect(swelled(t, 0.7 * s, 0.3)); src.start(t);
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = 60;
      o.connect(swelled(t, 0.9 * s, 0.3)); o.start(t); o.stop(t + 0.3);
    }),
    click: safe(() => {
      const t = ac.currentTime;
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = 800;
      o.connect(swelled(t, 0.4, 0.03)); o.start(t); o.stop(t + 0.03);
    }),
    complete: safe(() => {
      const t = ac.currentTime;
      [523.25, 659.25, 783.99].forEach((f, i) => {
        const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        o.connect(swelled(t + i * 0.12, 0.5, 0.25)); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.25);
      });
    }),
    setRadio: safe((on) => {
      if (!radio.gain) {
        radio.gain = ac.createGain(); radio.gain.gain.value = 0; radio.gain.connect(master);
        radio.noise = noiseBuffer(1);
      }
      if (on === radio.active) return;
      radio.active = on;
      radio.gain.gain.setTargetAtTime(on ? 0.6 : 0, ac.currentTime, 0.08);
      if (on) { radioReset(); if (!radio.timer) radio.timer = setInterval(radioTick, 90); radioTick(); }
      else if (radio.timer) { clearInterval(radio.timer); radio.timer = 0; }
    }),
    nextStation() {
      radio.idx = (radio.idx + 1) % STATIONS.length;
      try { if (ac && radio.active) { radioReset(); radioTick(); } } catch (e) { /* abaikan */ }
      return STATIONS[radio.idx].name;
    },
    stationName: () => STATIONS[radio.idx].name,
    setRain: safe((amount) => {
      if (!rainGain) {
        rainGain = ac.createGain(); rainGain.gain.value = 0; rainGain.connect(master);
        const src = ac.createBufferSource(); src.buffer = noiseBuffer(2); src.loop = true;
        const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
        src.connect(hp); hp.connect(rainGain); src.start();
      }
      rainGain.gain.setTargetAtTime(amount * 0.12, ac.currentTime, 0.5);
    }),
    thunder: safe(() => {
      const t = ac.currentTime;
      const src = ac.createBufferSource(); src.buffer = noiseBuffer(2);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(380, t); lp.frequency.exponentialRampToValueAtTime(70, t + 1.8);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.9, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
      src.connect(lp); lp.connect(g); g.connect(master); src.start(t);
    }),
    pickup: safe(() => {
      const t = ac.currentTime;
      [880, 1318.5].forEach((f, i) => {
        const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        o.connect(swelled(t + i * 0.07, 0.4, 0.15)); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.15);
      });
    }),
    toggleMute() {
      muted = !muted;
      try { if (master) master.gain.value = muted ? 0 : MASTER_VOLUME; } catch (e) { /* abaikan */ }
      return muted;
    },
    setVolume: safe((vol) => {
      if (!master) return;
      master.gain.value = vol;
    }),
    setHeat: safe((h) => { ctx.heat = CLAMP(h || 0, 0, 5); }),
    setDistrict: safe((d) => { ctx.district = CLAMP(d || 0, 0, 2); }),
    setEngine: safe((speed) => { setDrive(speed); }),
    setWater: safe((a) => setWater(a)),
    setFuel: safe((f) => { ctx.fuel = CLAMP(f ?? 1, 0, 1); }),
    update: safe((state) => {
      if (!ac) return;
      const car = state.car;
      const speed = car ? Math.abs(car.speed || 0) : 0;
      ctx.heat = state.heat ?? 0;
      ctx.district = state.district ?? 0;
      ctx.speed = speed;
      ctx.water = state.water ?? 0;
      ctx.fuel = car ? CLAMP(car.nitroFuel ?? 1, 0, 1) : 1;
      setDrive(speed);
      setWater(ctx.water);
      tickAmbience();
      tickFuelWarn();
      tickSirenAmbient();
    }),
  };
}