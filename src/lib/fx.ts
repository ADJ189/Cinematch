// src/lib/fx.ts
//
// Pointer-driven polish for result cards: a gentle poster tilt and a local
// glow. One delegated pointermove listener for the whole document (not one
// per card), requestAnimationFrame-throttled, mouse-only (touch never
// simulates hover), and gated by the live `data-tilt` / `data-glow`
// attributes so Off, reduced motion, and coarse pointers disable it
// instantly. It only writes CSS variables — no layout reads in the move path
// beyond one getBoundingClientRect per frame — so nothing can shift layout.

const CARD = '.result-card, .featured';

let active: HTMLElement | null = null;
let pending: PointerEvent | null = null;
let raf = 0;
let started = false;

function reset(card: HTMLElement | null) {
  if (!card) return;
  card.classList.remove('fx-active');
  card.style.removeProperty('--mx');
  card.style.removeProperty('--my');
  card.style.removeProperty('--rx');
  card.style.removeProperty('--ry');
}

function frame() {
  raf = 0;
  const e = pending;
  pending = null;
  if (!e) return;
  const root = document.documentElement;
  const tilt = root.getAttribute('data-tilt') === 'gentle';
  const glow = root.getAttribute('data-glow') !== 'off';
  const target = (e.target as Element | null)?.closest<HTMLElement>(CARD) ?? null;

  if (target !== active) {
    reset(active);
    active = target;
  }
  if (!target || (!tilt && !glow)) return;

  const r = target.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return;
  const px = (e.clientX - r.left) / r.width; // 0..1
  const py = (e.clientY - r.top) / r.height;
  target.classList.add('fx-active');
  target.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
  target.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
  // Featured is large — keep its tilt far smaller than a poster's.
  const max = target.classList.contains('featured') ? 1.2 : 4;
  if (tilt) {
    target.style.setProperty('--rx', `${((0.5 - py) * 2 * max).toFixed(2)}deg`);
    target.style.setProperty('--ry', `${((px - 0.5) * 2 * max).toFixed(2)}deg`);
  }
}

export function initPointerFx(): void {
  if (started) return;
  started = true;
  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse') return;
      pending = e;
      if (!raf) raf = requestAnimationFrame(frame);
    },
    { passive: true }
  );
  // Leaving the window (or a screen being replaced) must not leave a card
  // stuck mid-tilt.
  document.addEventListener('pointerleave', () => {
    reset(active);
    active = null;
  });
  window.addEventListener('blur', () => {
    reset(active);
    active = null;
  });
}
