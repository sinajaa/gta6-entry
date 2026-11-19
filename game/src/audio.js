// audio.js — efek suara sintetis WebAudio; AudioContext baru dibuat setelah gesture
// Suara game disusun dengan tangan sendiri lewat WebAudio, tanpa berkas audio luar.
// Lapisan: music director adaptif (bass/chord/drum per heat + distrik), engine & ban
// yang mengikuti kecepatan dengan pitching doppler-ish, senjata per jenis + reverb ekor,
// ambience kota (trafik jauh + burung camar dekat air), dan guntur yang menyusul kilat.
export function createAudio() {
  let ac = null, master = null, muted = false, failed = false;
  let sirenGain = null, sirenOsc = [], sirenTimer = 0, sirenIntensity = 0, sirenHigh = false;
  let sirenAmb = null, sirenAmbGain = null, sirenAmbOsc = [], sirenAmbHigh = false, sirenAmbTimer = 0;
  let fuelWarn = { timer: 0, next: 0, beeps: 0 };
  const FUEL_LOW = 0.15;

  // State adaptif dibaca oleh music director tiap tick.
  const ctx = { heat: 0, district: 0, speed: 0, water: 0, time: 0, fuel: 1 };

  const safe = (fn) => (...args) => {
    if (!ac) return;
    try { return fn(...args); } catch (e) { return undefined; }
  };

  function noiseBuffer(seconds) {
    const buf = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * seconds)), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function envGain(t0, peak, dur) {
    const g = ac.createGain();
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    g.connect(master);
    return g;
  }

  function startSiren() {
    sirenGain = ac.createGain();
    sirenGain.gain.value = 0;
    sirenGain.connect(master);
    sirenOsc = [650, 950].map((f) => {
      const o = ac.createOscillator();
      o.type = 'square'; o.frequency.value = f;
      const g = ac.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(sirenGain); o.start();
      return { o, g };
    });
    sirenOsc[0].g.gain.value = 1;
    sirenTimer = setInterval(() => {
      try {
        sirenHigh = !sirenHigh;
        sirenOsc[0].g.gain.value = sirenHigh ? 0 : 1;
        sirenOsc[1].g.gain.value = sirenHigh ? 1 : 0;
      } catch (e) { /* abaikan */ }
    }, 500);
  }

  // Sirene jauh: dengung dua-nada yang redup di latar, masuk pelan saat heat tinggi.
  function startSirenAmbient() {
    sirenAmbGain = ac.createGain(); sirenAmbGain.gain.value = 0; sirenAmbGain.connect(master);
    sirenAmbOsc = [440, 660].map((f) => {
      const o = ac.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = ac.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(sirenAmbGain); o.start();
      return { o, g };
    });
    sirenAmbOsc[0].g.gain.value = 1;
    sirenAmbTimer = setInterval(() => {
      try {
        sirenAmbHigh = !sirenAmbHigh;
        sirenAmbOsc[0].g.gain.value = sirenAmbHigh ? 0 : 1;
        sirenAmbOsc[1].g.gain.value = sirenAmbHigh ? 1 : 0;
      } catch (e) { /* abaikan */ }
    }, 900);
  }

  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  let rainGain = null;
  let radioGain = null, radioNoise = null, radioTimer = 0, radioIdx = 0, radioStep = 0, radioNext = 0, radioActive = false;

  function tone(type, f, t, dur, vol, lp) {
    const o = ac.createOscillator(); o.type = type; o.frequency.value = f;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (lp) { const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); node = fl; }
    node.connect(g); g.connect(radioGain);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function hit(t, dur, vol, hp) {
    const s = ac.createBufferSource(); s.buffer = radioNoise;
    const fl = ac.createBiquadFilter(); fl.type = 'highpass'; fl.frequency.value = hp;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(radioGain);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  function kick(t, vol) {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(radioGain); o.start(t); o.stop(t + 0.2);
  }

  const SYNTH_ROOTS = [33, 29, 36, 31], SYNTH_CH = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]];
  const FUNK_ROOTS = [40, 40, 45, 45];
  const FUNK_BASS = [0, null, 0, 12, null, 0, null, 7, 0, null, 10, null, 0, 12, null, null];
  const CHILL_CH = [[65, 69, 72, 76], [64, 67, 71, 74], [62, 65, 69, 72], [60, 64, 67, 71]];
  const PENTA = [0, 2, 4, 7, 9];
  const STATIONS = [
    {
      name: 'NEON WAVE 101.3 — SYNTHWAVE', spb: 60 / 100 / 4,
      step(s, t) {
        const bar = Math.floor(s / 16) % 4, k = s % 16, root = SYNTH_ROOTS[bar];
        if (k % 4 === 0) kick(t, 0.9);
        if (k === 4 || k === 12) hit(t, 0.14, 0.35, 1800);
        if (k % 2 === 0) tone('sawtooth', hz(root + (k % 8 === 6 ? 12 : 0)), t, 0.2, 0.22, 700);
        tone('square', hz(root + 24 + SYNTH_CH[bar][k % 3] + (k % 8 >= 4 ? 12 : 0)), t, 0.12, 0.05, 2400);
        if (k === 0) for (const iv of SYNTH_CH[bar]) tone('sawtooth', hz(root + 24 + iv), t, 16 * this.spb, 0.04, 900);
      },
    },
    {
      name: 'FUNKY TOWN 94.7 — FUNK', spb: 60 / 108 / 4,
      step(s, t) {
        const bar = Math.floor(s / 16) % 4, k = s % 16, root = FUNK_ROOTS[bar];
        if (k === 0 || k === 6 || k === 10) kick(t, 0.85);
        if (k === 4 || k === 12) hit(t, 0.12, 0.5, 1200);
        hit(t, 0.04, k % 4 === 2 ? 0.28 : 0.14, 6000);
        if (FUNK_BASS[k] !== null) tone('sawtooth', hz(root + FUNK_BASS[k]), t, 0.14, 0.3, 600);
        if (k === 3 || k === 6 || k === 10 || k === 14) for (const iv of [0, 3, 7, 10]) tone('square', hz(root + 24 + iv), t, 0.09, 0.05, 2200);
      },
    },
    {
      name: 'LOFI BAY 88.1 — CHILL', spb: 60 / 76 / 4,
      step(s, t) {
        const bar = Math.floor(s / 16) % 4, k = s % 16, ch = CHILL_CH[bar];
        if (k === 0 || k === 8) for (const n of ch) tone('triangle', hz(n), t, 2.2, 0.07, 1400);
        if (k === 0 || k === 10) { kick(t, 0.5); tone('sine', hz(ch[0] - 24), t, 0.7, 0.25); }
        if (k % 2 === 0) hit(t, 0.07, 0.1, 7000);
        if (k === 4 || k === 12) hit(t, 0.1, 0.18, 2500);
        if (k % 3 === 1 && Math.random() < 0.6) tone('sine', hz(72 + PENTA[Math.floor(Math.random() * 5)]), t, 0.6, 0.08);
      },
    },
  ];

  function radioTick() {
    if (!ac || !radioActive) return;
    const st = STATIONS[radioIdx];
    const horizon = ac.currentTime + 0.35;
    while (radioNext < horizon) { st.step(radioStep++, radioNext); radioNext += st.spb; }
  }
  function radioReset() { radioStep = 0; radioNext = ac.currentTime + 0.05; }

  // ---------------------------------------------------------------------------
  // Music director adaptif: tiga lapisan (bass, chord, drum) yang intensitas dan
  // warnanya ditentukan oleh heat (police.stars) dan district (0 pusat, 1 tengah,
  // 2 pinggir), di-crossfade halus lewat gain node tiap lapisan.
  // ---------------------------------------------------------------------------
  const music = { bassG: null, chG: null, drumG: null, step: 0, next: 0, timer: 0, active: false };

  // Rentang/akar per distrik: pinggir lebih rendah & tenang, pusat lebih cerah.
  const MUSIC_ROOTS = [[38, 41, 43], [33, 36, 38], [31, 34, 36]];      // [pusat, tengah, pinggir]
  const MUSIC_CHORDS = [[[0, 3, 7], [0, 4, 7], [0, 3, 7], [0, 4, 7]],  // mayor/mayor-ish pusat
                        [[0, 3, 7], [0, 3, 8], [0, 4, 7], [0, 3, 7]],
                        [[0, 3, 7], [0, 3, 7], [0, 4, 7], [0, 2, 7]]]; // mellow pinggir
  const MUSIC_SPB = 60 / 95 / 4; // satu "step" seperempat-enam-belas, tempo sedang

  function musicDirNote(t, kind) {
    // kind: 'bass' | 'chord' | 'drum'
    const heat = ctx.heat, dist = Math.max(0, Math.min(2, ctx.district));
    const bar = Math.floor(music.step / 16) % 4, k = music.step % 16;
    const root = MUSIC_ROOTS[dist][bar % 3];
    if (kind === 'bass') {
      const f = hz(root - 4 + (k % 8 >= 4 ? 12 : 0));
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320 + heat * 220;
      o.connect(lp); lp.connect(g); g.connect(music.bassG); o.start(t); o.stop(t + 0.3);
    } else if (kind === 'chord') {
      const ch = MUSIC_CHORDS[dist][bar];
      for (const iv of ch) {
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.12, t + 0.06);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(root + 24 + iv);
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 + heat * 220;
        o.connect(lp); lp.connect(g); g.connect(music.chG); o.start(t); o.stop(t + 0.95);
      }
    } else if (kind === 'drum') {
      // kick tiap beat, hihat di offbeat; makin panas makin rapat.
      if (k % 4 === 0) {
        const o = ac.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(120 + heat * 12, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        const g = ac.createGain(); g.gain.setValueAtTime(0.38, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g); g.connect(music.drumG); o.start(t); o.stop(t + 0.2);
      }
      if (k % 2 === 1) {
        const s = ac.createBufferSource(); s.buffer = radioNoise;
        const fl = ac.createBiquadFilter(); fl.type = 'highpass'; fl.frequency.value = 6500;
        const g = ac.createGain(); g.gain.setValueAtTime(0.1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        s.connect(fl); fl.connect(g); g.connect(music.drumG); s.start(t, Math.random() * 0.4); s.stop(t + 0.06);
      }
    }
  }

  function musicTick() {
    if (!ac || !music.active) return;
    const horizon = ac.currentTime + 0.4;
    while (music.next < horizon) {
      musicDirNote(music.next, 'bass');
      musicDirNote(music.next, 'chord');
      musicDirNote(music.next, 'drum');
      music.step++;
      music.next += MUSIC_SPB;
    }
    // Crossfade lapisan menuju target intensitas berbanding heat.
    const heatN = Math.max(0, Math.min(1, ctx.heat / 5));
    const calm = Math.max(0, Math.min(1, 1 - ctx.district * 0.4));
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

  // ---------------------------------------------------------------------------
  // Engine + tyre: dua oscilator looping yang pitchnya mengikuti kecepatan dengan
  // pergeseran "doppler-ish" (satu sedikit di atas, satu di bawah, dibangun dari
  // frekuensi dasar yang naik bersama kecepatan).
  // ---------------------------------------------------------------------------
  const drive = { engOsc: null, engG: null, tyreSrc: null, tyreG: null, tyreF: null, cur: 0 };

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

  // speed: 0..~470 (MAX 320 * boost 1.45). doppler-ish: dasar + detune kecil bergetar.
  function setDrive(speed) {
    if (!ac || !drive.engOsc) return;
    const s = Math.max(0, Math.min(470, Math.abs(speed)));
    const n = s / 470;
    const wobble = 1 + Math.sin(ac.currentTime * 30) * 0.02; // doppler-ish detune
    const f = (45 + 130 * n) * (1 + n * 0.15) * wobble;
    drive.engOsc.frequency.setTargetAtTime(f, ac.currentTime, 0.05);
    drive.engG.gain.setTargetAtTime(n > 0.005 ? 0.05 + 0.16 * n : 0, ac.currentTime, 0.08);
    const tyreLevel = n > 0.01 ? 0.03 + 0.06 * n : 0;
    drive.tyreG.gain.setTargetAtTime(tyreLevel, ac.currentTime, 0.1);
    drive.tyreF.frequency.setTargetAtTime(700 + 1400 * n, ac.currentTime, 0.1);
    drive.cur = n;
  }

  // ---------------------------------------------------------------------------
  // Ambience: bed kota berisi dengung lalu lintas jauh (noise lowpass + LFO) dan
  // burung camar terisolasi yang muncul hanya ketika dekat air (ctx.water > 0).
  // ---------------------------------------------------------------------------
  const amb = { trafficG: null, gullG: null, gullTimer: 0, gullNext: 0 };

  function gullCall(t) {
    // seruan berdengung naik-turun, khas burung camar pantai
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
    // LFO untuk dengungan lalu lintas yang "bernapas" (naik-turun pelan).
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.13;
    const lfoG = ac.createGain(); lfoG.gain.value = 0.03;
    lfo.connect(lfoG); lfoG.connect(amb.trafficG.gain); lfo.start();

    amb.gullG = ac.createGain(); amb.gullG.gain.value = 0; amb.gullG.connect(master);
    amb.gullNext = ac.currentTime + 2;
  }

  function setWater(amount) {
    if (!ac || !amb.gullG) return;
    ctx.water = Math.max(0, Math.min(1, amount));
    amb.gullG.gain.setTargetAtTime(ctx.water * 0.5, ac.currentTime, 0.5);
  }

  function tickAmbience() {
    if (!ac || !amb.gullG) return;
    // camar hanya terdengar ketika dekat air (water) dan tidak sedang hujan berat.
    if (ctx.water > 0.3 && ac.currentTime >= amb.gullNext) {
      gullCall(ac.currentTime);
      amb.gullNext = ac.currentTime + 2 + Math.random() * 5;
    }
  }

  // Peringatan bahan bakar: bip ganda pendek ketika nitro (bahan bakar) hampir habis,
  // berulang selagi level rendah.
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
    // interval kembali: dua bip rapat lalu jeda ~0.9s sampai putaran berikutnya
    fuelWarn.next = ac.currentTime + (fuelWarn.beeps === 0 ? 0.9 : 0.14);
  }

  // Sirene jauh: gain merambat pelan mengikuti heat (makin panas makin terdengar).
  function tickSirenAmbient() {
    if (!ac || !sirenAmbGain) return;
    const t = Math.max(0, Math.min(1, ctx.heat / 4));
    sirenAmbGain.gain.setTargetAtTime(t * 0.04, ac.currentTime, 0.8);
  }

  // ---------------------------------------------------------------------------
  // Reverb ekor sederhana: delay feedback pendek untuk "tail" suara senapan.
  // ---------------------------------------------------------------------------
  let reverb = null, reverbIn = null, reverbOut = null;
  function startReverb() {
    reverbIn = ac.createGain(); reverbIn.gain.value = 1;
    reverbOut = ac.createGain(); reverbOut.gain.value = 0.5;
    reverb = ac.createDelay(1.0); reverb.delayTime.value = 0.16;
    const fb = ac.createGain(); fb.gain.value = 0.45;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    reverbIn.connect(reverb); reverb.connect(fb); fb.connect(lp); lp.connect(reverb);
    reverb.connect(reverbOut); reverbOut.connect(master);
  }
  function sendReverb(node, level) {
    if (!reverbIn) return;
    const g = ac.createGain(); g.gain.value = level;
    node.connect(g); g.connect(reverbIn);
  }

  // Karakter tiap senjata: pitch dasar, durasi, jenis filter, dan level reverb.
  const GUNS = {
    pistol: { f: 180, dur: 0.14, lp: 3200, vol: 0.7, rev: 0.3, noise: 0.16 },
    smg:    { f: 240, dur: 0.09, lp: 4200, vol: 0.5, rev: 0.2, noise: 0.1 },
    compactsmg: { f: 260, dur: 0.08, lp: 5000, vol: 0.42, rev: 0.18, noise: 0.08 },
    shotgun: { f: 120, dur: 0.28, lp: 1600, vol: 0.9, rev: 0.5, noise: 0.34 },
    rifle:  { f: 210, dur: 0.12, lp: 3800, vol: 0.65, rev: 0.35, noise: 0.14 },
    cop:    { f: 200, dur: 0.12, lp: 3400, vol: 0.55, rev: 0.28, noise: 0.12 },
  };

  return {
    start() {
      if (failed) return;
      try {
        if (!ac) {
          const Ctor = window.AudioContext || window.webkitAudioContext;
          if (!Ctor) { failed = true; return; }
          ac = new Ctor();
          master = ac.createGain();
          master.gain.value = muted ? 0 : 0.35;
          master.connect(ac.destination);
          startSiren();
          startSirenAmbient();
          radioNoise = noiseBuffer(1);
          startReverb();
          startMusic();
          startDrive();
          startAmbience();
        }
        if (ac.state === 'suspended') ac.resume();
      } catch (e) { failed = true; ac = null; }
    },
    setSiren: safe((intensity) => {
      sirenIntensity = Math.max(0, Math.min(1, intensity || 0));
      sirenGain.gain.setTargetAtTime(sirenIntensity * 0.12, ac.currentTime, 0.1);
    }),
    // shot(weapon) — suara senapan kaya per senjata dengan ekor reverb.
    shot: safe((weapon = 'pistol') => {
      const g = GUNS[weapon] || GUNS.pistol;
      const t = ac.currentTime;
      const src = ac.createBufferSource(); src.buffer = noiseBuffer(g.noise);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(g.lp, t); lp.frequency.exponentialRampToValueAtTime(120, t + g.dur);
      const mainG = ac.createGain();
      mainG.gain.setValueAtTime(g.vol, t); mainG.gain.exponentialRampToValueAtTime(0.0001, t + g.dur);
      src.connect(lp); lp.connect(mainG); mainG.connect(master);
      // bodi: dentuman rendah menyertai ledakan noise
      const body = ac.createOscillator(); body.type = 'sine';
      body.frequency.setValueAtTime(g.f, t); body.frequency.exponentialRampToValueAtTime(50, t + g.dur * 0.8);
      const bg = ac.createGain(); bg.gain.setValueAtTime(g.vol * 0.6, t); bg.gain.exponentialRampToValueAtTime(0.0001, t + g.dur);
      body.connect(bg); bg.connect(master);
      sendReverb(mainG, g.rev);
      if (weapon === 'shotgun') { // ledakan kedua kecil sesaat kemudian
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
      const t = ac.currentTime, s = Math.max(0.2, Math.min(1, strength));
      const src = ac.createBufferSource(); src.buffer = noiseBuffer(0.3);
      src.connect(envGain(t, 0.7 * s, 0.3)); src.start(t);
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = 60;
      o.connect(envGain(t, 0.9 * s, 0.3)); o.start(t); o.stop(t + 0.3);
    }),
    click: safe(() => {
      const t = ac.currentTime;
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = 800;
      o.connect(envGain(t, 0.4, 0.03)); o.start(t); o.stop(t + 0.03);
    }),
    complete: safe(() => {
      const t = ac.currentTime;
      [523.25, 659.25, 783.99].forEach((f, i) => {
        const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        o.connect(envGain(t + i * 0.12, 0.5, 0.25)); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.25);
      });
    }),
    setRadio: safe((on) => {
      if (!radioGain) {
        radioGain = ac.createGain(); radioGain.gain.value = 0; radioGain.connect(master);
        radioNoise = noiseBuffer(1);
      }
      if (on === radioActive) return;
      radioActive = on;
      radioGain.gain.setTargetAtTime(on ? 0.6 : 0, ac.currentTime, 0.08);
      if (on) { radioReset(); if (!radioTimer) radioTimer = setInterval(radioTick, 90); radioTick(); }
      else if (radioTimer) { clearInterval(radioTimer); radioTimer = 0; }
    }),
    nextStation() {
      radioIdx = (radioIdx + 1) % STATIONS.length;
      try { if (ac && radioActive) { radioReset(); radioTick(); } } catch (e) { /* abaikan */ }
      return STATIONS[radioIdx].name;
    },
    stationName: () => STATIONS[radioIdx].name,
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
        o.connect(envGain(t + i * 0.07, 0.4, 0.15)); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.15);
      });
    }),
    toggleMute() {
      muted = !muted;
      try { if (master) master.gain.value = muted ? 0 : 0.35; } catch (e) { /* abaikan */ }
      return muted;
    },
    setVolume: safe((vol) => {
      if (!master) return;
      master.gain.value = vol;
    }),
    // --- antarmuka adaptif baru ---------------------------------------------------
    // setHeat(h): 0..5 bintang buruan, mendorong intensitas director.
    setHeat: safe((h) => { ctx.heat = Math.max(0, Math.min(5, h || 0)); }),
    // setDistrict(d): 0 pusat, 1 tengah, 2 pinggir — mewarnai director.
    setDistrict: safe((d) => { ctx.district = Math.max(0, Math.min(2, d || 0)); }),
    // setEngine(speed): 0..~470, menggerakkan engine & tyre.
    setEngine: safe((speed) => { setDrive(speed); }),
    // setWater(a): 0..1 kedekatan dengan laut/pantai untuk camar.
    setWater: safe((a) => setWater(a)),
    setFuel: safe((f) => { ctx.fuel = Math.max(0, Math.min(1, f ?? 1)); }),
    // update(state): dipanggil tiap frame dari loop utama dengan snapshot konteks.
    update: safe((state) => {
      if (!ac) return;
      const car = state.car;
      const speed = car ? Math.abs(car.speed || 0) : 0;
      ctx.heat = state.heat ?? 0;
      ctx.district = state.district ?? 0;
      ctx.speed = speed;
      ctx.water = state.water ?? 0;
      ctx.fuel = car ? Math.max(0, Math.min(1, car.nitroFuel ?? 1)) : 1;
      setDrive(speed);
      setWater(ctx.water);
      tickAmbience();
      tickFuelWarn();
      tickSirenAmbient();
    }),
  };
}