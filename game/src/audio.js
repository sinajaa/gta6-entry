// audio.js — efek suara sintetis WebAudio; AudioContext baru dibuat setelah gesture
// Suara game disusun dengan tangan sendiri lewat WebAudio, tanpa berkas audio luar.
export function createAudio() {
  let ac = null, master = null, muted = false, failed = false;
  let sirenGain = null, sirenOsc = [], sirenTimer = 0, sirenIntensity = 0, sirenHigh = false;

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
        }
        if (ac.state === 'suspended') ac.resume();
      } catch (e) { failed = true; ac = null; }
    },
    setSiren: safe((intensity) => {
      sirenIntensity = Math.max(0, Math.min(1, intensity || 0));
      sirenGain.gain.setTargetAtTime(sirenIntensity * 0.12, ac.currentTime, 0.1);
    }),
    shot: safe(() => {
      const t = ac.currentTime;
      const src = ac.createBufferSource(); src.buffer = noiseBuffer(0.15);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(4000, t); lp.frequency.exponentialRampToValueAtTime(200, t + 0.15);
      src.connect(lp); lp.connect(envGain(t, 0.8, 0.15));
      src.start(t);
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
  };
}
