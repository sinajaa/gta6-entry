// touch.js — joystick virtual + tombol sentuh (E/F/LARI/HANDBRAKE/PAUSE) untuk HP
// SUNNY CITY — authored pass 2026-11-19 (recording 03)
const BUTTON_KEYS = { e: 'e', f: 'f', run: 'shift', brake: ' ', pause: 'Escape' };
const DEAD_ZONE = 0.12;

function vibrate(ms = 12) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) { /* not supported */ }
}

export function createTouch({ onStick, onButton }) {
  const root = document.getElementById('touch');
  const isTouch = !!root && ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 900);
  if (!isTouch) return { isTouch: false, root };
  root.classList.add('on');

  const stick = root.querySelector('#stick');
  const knob = root.querySelector('#knob');
  let stickId = null;
  const moveStick = (e) => {
    const r = stick.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = (e.clientX - (r.left + radius)) / radius, dy = (e.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(dx, dy);
    if (len < DEAD_ZONE) { dx = dy = 0; }
    else if (len > 1) { dx /= len; dy /= len; }
    knob.style.transform = `translate(${dx * radius * 0.6}px, ${dy * radius * 0.6}px)`;
    onStick(dx, dy);
  };
  const endStick = () => { stickId = null; knob.style.transform = ''; onStick(0, 0); };
  stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); e.preventDefault(); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
  stick.addEventListener('pointerup', (e) => { if (e.pointerId === stickId) endStick(); });
  stick.addEventListener('pointercancel', (e) => { if (e.pointerId === stickId) endStick(); });

  // LARI adalah tombol toggle: sekali tekan menyala, sekali tekan lagi mati.
  let sprintOn = false;
  for (const btn of root.querySelectorAll('[data-btn]')) {
    const key = BUTTON_KEYS[btn.dataset.btn];
    const isRunToggle = btn.dataset.btn === 'run';
    btn.addEventListener('pointerdown', (e) => {
      btn.setPointerCapture(e.pointerId);
      vibrate();
      if (isRunToggle) {
        sprintOn = !sprintOn;
        btn.classList.toggle('down', sprintOn);
        onButton(key, sprintOn);
      } else {
        btn.classList.add('down');
        onButton(key, true);
      }
      e.preventDefault();
    });
    if (isRunToggle) continue;
    const up = () => { btn.classList.remove('down'); onButton(key, false); };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
  }
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  return { isTouch: true, root, reset: endStick };
}