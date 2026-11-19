// audio.js — efek suara sintetis WebAudio; AudioContext baru dibuat setelah gesture
// SUNNY CITY — authored pass 2026-11-19 (recording 03)
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
    toggleMute() {
      muted = !muted;
      try { if (master) master.gain.value = muted ? 0 : 0.35; } catch (e) { /* abaikan */ }
      return muted;
    },
  };
}
