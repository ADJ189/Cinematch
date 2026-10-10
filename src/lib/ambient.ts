// src/lib/ambient.ts
//
// The one ambient animation system: a quiet constellation of drifting
// points with faint links between near neighbours, drawn on a single
// Canvas2D behind the landing hero. It replaces the old CPU fluid solver
// (which ran its Navier–Stokes grid every frame whether anyone looked or
// not) — there is exactly one animation loop in the app, and it:
//
//   • pauses while the tab is hidden or the hero is off-screen,
//   • stops completely when particles are Off / motion is Off,
//   • caps device-pixel-ratio and particle count (fewer on phones),
//   • listens for pointer movement only in Interactive mode on a real
//     hover pointer, and does its drawing inside requestAnimationFrame,
//   • is decorative: aria-hidden, pointer-events: none, never blocks input,
//   • tears down every frame, observer and listener in destroy().

import {
  effectiveParticles,
  getPreferences,
  subscribeAppearance,
  type ParticleLevel,
} from './appearance';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: 0 | 1; // 0 = primary accent, 1 = secondary accent
}

const LEVEL_CONFIG: Record<Exclude<ParticleLevel, 'off'>, { per100k: number; max: number; speed: number; link: number; pointer: boolean }> = {
  subtle: { per100k: 5, max: 38, speed: 0.12, link: 110, pointer: false },
  balanced: { per100k: 8, max: 64, speed: 0.18, link: 130, pointer: false },
  interactive: { per100k: 9, max: 80, speed: 0.2, link: 140, pointer: true },
};

export class AmbientField {
  private readonly ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private raf = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private level: ParticleLevel = 'off';
  private visible = true;
  private destroyed = false;
  private running = false;
  private last = 0;
  private pointer = { x: -9999, y: -9999, active: false };
  private c1 = '167,139,250';
  private c2 = '34,211,238';
  private readonly io: IntersectionObserver | null;
  private readonly ro: ResizeObserver | null;
  private readonly unsubscribe: () => void;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;

    this.io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([entry]) => {
            this.visible = entry?.isIntersecting ?? true;
            this.sync();
          })
        : null;
    this.io?.observe(canvas);

    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.ro?.observe(canvas);

    document.addEventListener('visibilitychange', this.onVisibility);
    this.unsubscribe = subscribeAppearance(() => this.configure());
    this.configure();
  }

  // ── configuration ──────────────────────────────────────────────────

  private configure(): void {
    if (this.destroyed) return;
    this.level = effectiveParticles(getPreferences());
    this.readColors();
    this.canvas.dataset.level = this.level;
    this.canvas.hidden = this.level === 'off';
    this.setPointerTracking(this.level === 'interactive' && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
    this.resize();
    this.sync();
  }

  /** Particle colours follow the live palette (and custom accent). */
  private readColors(): void {
    const cs = getComputedStyle(document.documentElement);
    this.c1 = toRgb(cs.getPropertyValue('--violet')) ?? this.c1;
    this.c2 = toRgb(cs.getPropertyValue('--cyan')) ?? this.c2;
  }

  private resize(): void {
    if (this.destroyed || this.level === 'off') return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const cfg = LEVEL_CONFIG[this.level];
    const target = Math.min(cfg.max, Math.max(14, Math.round((this.w * this.h) / 100000 * cfg.per100k)));
    while (this.particles.length < target) this.particles.push(this.spawn(cfg.speed));
    this.particles.length = Math.min(this.particles.length, target);
    for (const p of this.particles) {
      p.x = Math.min(p.x, this.w);
      p.y = Math.min(p.y, this.h);
    }
    if (!this.running) this.draw(); // keep a still frame correct while paused
  }

  private spawn(speed: number): Particle {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.8);
    return { x: Math.random() * this.w, y: Math.random() * this.h, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: 0.7 + Math.random() * 1.3, hue: Math.random() < 0.7 ? 0 : 1 };
  }

  // ── run state ──────────────────────────────────────────────────────

  private onVisibility = () => this.sync();

  /** Single place that decides whether a frame loop should exist. */
  private sync(): void {
    const shouldRun = !this.destroyed && this.level !== 'off' && this.visible && !document.hidden;
    if (shouldRun && !this.running) {
      this.running = true;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    } else if (!shouldRun && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
    if (this.level === 'off') this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private tick = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000) * 60; // normalise to ~60fps steps
    this.last = now;
    this.step(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.tick);
  };

  private step(dt: number): void {
    if (this.level === 'off') return;
    const cfg = LEVEL_CONFIG[this.level];
    const reach = 160;
    for (const p of this.particles) {
      if (cfg.pointer && this.pointer.active) {
        const dx = p.x - this.pointer.x;
        const dy = p.y - this.pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < reach * reach && d2 > 1) {
          // Gentle repel that eases out with distance — never a snap.
          const d = Math.sqrt(d2);
          const f = ((reach - d) / reach) * 0.05 * dt;
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
        }
      }
      // Ease back toward the base drift speed so pointer nudges fade.
      const sp = Math.hypot(p.vx, p.vy);
      const max = cfg.speed * 1.6;
      if (sp > max) {
        p.vx *= 0.96;
        p.vy *= 0.96;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < -10) p.x = this.w + 10;
      else if (p.x > this.w + 10) p.x = -10;
      if (p.y < -10) p.y = this.h + 10;
      else if (p.y > this.h + 10) p.y = -10;
    }
  }

  private draw(): void {
    if (this.level === 'off') return;
    const { ctx } = this;
    const cfg = LEVEL_CONFIG[this.level];
    ctx.clearRect(0, 0, this.w, this.h);

    const link2 = cfg.link * cfg.link;
    const ps = this.particles;
    ctx.lineWidth = 1;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i]!;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > link2) continue;
        const alpha = (1 - d2 / link2) * 0.22;
        ctx.strokeStyle = `rgba(${this.c1},${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    for (const p of ps) {
      ctx.fillStyle = `rgba(${p.hue === 0 ? this.c1 : this.c2},0.7)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── pointer (Interactive only) ─────────────────────────────────────

  private pointerTracking = false;
  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = e.clientX - rect.left;
    this.pointer.y = e.clientY - rect.top;
    this.pointer.active = true;
  };
  private onPointerLeave = () => {
    this.pointer.active = false;
  };

  private setPointerTracking(on: boolean): void {
    if (on === this.pointerTracking) return;
    this.pointerTracking = on;
    if (on) {
      window.addEventListener('pointermove', this.onPointerMove, { passive: true });
      document.addEventListener('pointerleave', this.onPointerLeave);
    } else {
      window.removeEventListener('pointermove', this.onPointerMove);
      document.removeEventListener('pointerleave', this.onPointerLeave);
      this.pointer.active = false;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.io?.disconnect();
    this.ro?.disconnect();
    this.unsubscribe();
    this.setPointerTracking(false);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.particles = [];
  }
}

/** Accepts `#rrggbb` (what the palette tokens use) → "r,g,b". */
function toRgb(value: string): string | null {
  const v = value.trim();
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) {
    const n = parseInt(m[1]!, 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(v);
  return rgb ? `${rgb[1]},${rgb[2]},${rgb[3]}` : null;
}
