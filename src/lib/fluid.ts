// src/lib/fluid.ts — Optimised Navier-Stokes fluid sim on Canvas2D (ported as-is, framework-agnostic)

interface FluidOptions {
  N?: number;          // grid size (power of 2, default 64)
  viscosity?: number;
  diffusion?: number;
  iterations?: number;
}

export class FluidSim {
  private readonly N: number;
  private readonly sz: number;
  private u: Float32Array; private u0: Float32Array;
  private v: Float32Array; private v0: Float32Array;
  private r: Float32Array; private r0: Float32Array;
  private g: Float32Array; private g0: Float32Array;
  private b: Float32Array; private b0: Float32Array;
  private readonly visc: number;
  private readonly diff: number;
  private readonly iters: number;
  private raf = 0;
  private t = 0;
  public colorMode: 'cinema' | 'gold' | 'aurora' = 'cinema';
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private imgData!: ImageData;

  constructor(canvas: HTMLCanvasElement, opts: FluidOptions = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: false })!;
    this.N    = opts.N    ?? 64;
    this.visc = opts.viscosity  ?? 0.0002;
    this.diff = opts.diffusion  ?? 0.000002;
    this.iters = opts.iterations ?? 8;
    this.sz = (this.N + 2) ** 2;
    this.u  = new Float32Array(this.sz); this.u0 = new Float32Array(this.sz);
    this.v  = new Float32Array(this.sz); this.v0 = new Float32Array(this.sz);
    this.r  = new Float32Array(this.sz); this.r0 = new Float32Array(this.sz);
    this.g  = new Float32Array(this.sz); this.g0 = new Float32Array(this.sz);
    this.b  = new Float32Array(this.sz); this.b0 = new Float32Array(this.sz);
    this.resize();
    this.loop();
  }

  resize() {
    this.canvas.width  = this.N + 2;
    this.canvas.height = this.N + 2;
    this.imgData = this.ctx.createImageData(this.N + 2, this.N + 2);
    // Pre-fill alpha
    for (let i = 3; i < this.imgData.data.length; i += 4) this.imgData.data[i] = 0;
  }

  splat(x: number, y: number, fu: number, fv: number, dr: number, dg: number, db: number) {
    const N = this.N;
    const ix = Math.round(x * N) + 1;
    const iy = Math.round(y * N) + 1;
    if (ix < 1 || ix > N || iy < 1 || iy > N) return;
    const radius = 3;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d2 = dx*dx + dy*dy;
        if (d2 > radius*radius) continue;
        const w = Math.exp(-d2 / (radius * radius * 0.4));
        const nx = ix+dx, ny = iy+dy;
        if (nx < 1 || nx > N || ny < 1 || ny > N) continue;
        const i = nx + (N+2)*ny;
        this.u0[i] += fu * w; this.v0[i] += fv * w;
        this.r0[i] += dr * w; this.g0[i] += dg * w; this.b0[i] += db * w;
      }
    }
  }

  private IX(x: number, y: number) { return x + (this.N+2)*y; }

  private diffuse(b: number, x: Float32Array, x0: Float32Array, amount: number, dt: number) {
    const N = this.N, a = dt * amount * N * N;
    const inv = 1 / (1 + 4*a);
    for (let k = 0; k < this.iters; k++) {
      for (let j = 1; j <= N; j++) for (let i = 1; i <= N; i++) {
        x[this.IX(i,j)] = (x0[this.IX(i,j)] + a*(
          x[this.IX(i-1,j)] + x[this.IX(i+1,j)] +
          x[this.IX(i,j-1)] + x[this.IX(i,j+1)]
        )) * inv;
      }
      this.setBnd(b, x);
    }
  }

  private advect(b: number, d: Float32Array, d0: Float32Array, u: Float32Array, v: Float32Array, dt: number) {
    const N = this.N, dt0 = dt * N;
    for (let j = 1; j <= N; j++) for (let i = 1; i <= N; i++) {
      let x = i - dt0*u[this.IX(i,j)];
      let y = j - dt0*v[this.IX(i,j)];
      x = Math.max(0.5, Math.min(N + 0.5, x));
      y = Math.max(0.5, Math.min(N + 0.5, y));
      const i0 = x|0, i1 = i0+1, j0 = y|0, j1 = j0+1;
      const s1 = x-i0, s0 = 1-s1, t1 = y-j0, t0 = 1-t1;
      d[this.IX(i,j)] =
        s0*(t0*d0[this.IX(i0,j0)] + t1*d0[this.IX(i0,j1)]) +
        s1*(t0*d0[this.IX(i1,j0)] + t1*d0[this.IX(i1,j1)]);
    }
    this.setBnd(b, d);
  }

  private project(u: Float32Array, v: Float32Array, p: Float32Array, div: Float32Array) {
    const N = this.N, h = 1/N;
    for (let j = 1; j <= N; j++) for (let i = 1; i <= N; i++) {
      div[this.IX(i,j)] = -0.5*h*(u[this.IX(i+1,j)]-u[this.IX(i-1,j)]+v[this.IX(i,j+1)]-v[this.IX(i,j-1)]);
      p[this.IX(i,j)] = 0;
    }
    this.setBnd(0,div); this.setBnd(0,p);
    for (let k = 0; k < this.iters; k++) {
      for (let j = 1; j <= N; j++) for (let i = 1; i <= N; i++) {
        p[this.IX(i,j)] = (div[this.IX(i,j)] +
          p[this.IX(i-1,j)] + p[this.IX(i+1,j)] +
          p[this.IX(i,j-1)] + p[this.IX(i,j+1)]) * 0.25;
      }
      this.setBnd(0,p);
    }
    for (let j = 1; j <= N; j++) for (let i = 1; i <= N; i++) {
      u[this.IX(i,j)] -= 0.5*(p[this.IX(i+1,j)]-p[this.IX(i-1,j)])/h;
      v[this.IX(i,j)] -= 0.5*(p[this.IX(i,j+1)]-p[this.IX(i,j-1)])/h;
    }
    this.setBnd(1,u); this.setBnd(2,v);
  }

  private setBnd(b: number, x: Float32Array) {
    const N = this.N;
    for (let i = 1; i <= N; i++) {
      x[this.IX(0,i)]   = b===1 ? -x[this.IX(1,i)]   : x[this.IX(1,i)];
      x[this.IX(N+1,i)] = b===1 ? -x[this.IX(N,i)]   : x[this.IX(N,i)];
      x[this.IX(i,0)]   = b===2 ? -x[this.IX(i,1)]   : x[this.IX(i,1)];
      x[this.IX(i,N+1)] = b===2 ? -x[this.IX(i,N)]   : x[this.IX(i,N)];
    }
    x[this.IX(0,0)]     = 0.5*(x[this.IX(1,0)]     + x[this.IX(0,1)]);
    x[this.IX(0,N+1)]   = 0.5*(x[this.IX(1,N+1)]   + x[this.IX(0,N)]);
    x[this.IX(N+1,0)]   = 0.5*(x[this.IX(N,0)]     + x[this.IX(N+1,1)]);
    x[this.IX(N+1,N+1)] = 0.5*(x[this.IX(N,N+1)]   + x[this.IX(N+1,N)]);
  }

  private step(dt: number) {
    // Velocity
    this.diffuse(1,this.u0,this.u,this.visc,dt);
    this.diffuse(2,this.v0,this.v,this.visc,dt);
    this.project(this.u0,this.v0,this.u,this.v);
    this.advect(1,this.u,this.u0,this.u0,this.v0,dt);
    this.advect(2,this.v,this.v0,this.u0,this.v0,dt);
    this.project(this.u,this.v,this.u0,this.v0);
    // Density
    this.diffuse(0,this.r0,this.r,this.diff,dt);
    this.advect(0,this.r,this.r0,this.u,this.v,dt);
    this.diffuse(0,this.g0,this.g,this.diff,dt);
    this.advect(0,this.g,this.g0,this.u,this.v,dt);
    this.diffuse(0,this.b0,this.b,this.diff,dt);
    this.advect(0,this.b,this.b0,this.u,this.v,dt);
    // Decay
    const sz = this.sz;
    for (let i = 0; i < sz; i++) {
      this.r[i]*=0.995; this.g[i]*=0.995; this.b[i]*=0.995;
      this.u[i]*=0.99;  this.v[i]*=0.99;
      this.r0[i]=0; this.g0[i]=0; this.b0[i]=0;
      this.u0[i]=0; this.v0[i]=0;
    }
  }

  private autoSwirlTimer = 0;
  private autoSwirl(dt: number) {
    this.autoSwirlTimer += dt;
    this.t += dt * 0.5;
    if (this.autoSwirlTimer < 0.04) return;
    this.autoSwirlTimer = 0;

    const x = 0.5 + 0.32 * Math.cos(this.t);
    const y = 0.5 + 0.32 * Math.sin(this.t * 1.23);
    const spd = 140;
    const fu = -Math.sin(this.t) * spd;
    const fv = Math.cos(this.t*1.23)*1.23*spd;

    let cr: number, cg: number, cb: number;
    switch (this.colorMode) {
      case 'gold':   cr=0.92; cg=0.72+0.18*Math.sin(this.t*2); cb=0.08; break;
      case 'aurora': cr=0.1+0.1*Math.sin(this.t); cg=0.85; cb=0.6+0.3*Math.cos(this.t*1.5); break;
      default:       cr=0.88; cg=0.58+0.2*Math.sin(this.t*0.7); cb=0.04; break;
    }
    this.splat(x,y,fu,fv,cr,cg,cb);

    // Occasional accent splat
    if (Math.random() < 0.08) {
      let ar: number, ag: number, ab: number;
      switch (this.colorMode) {
        case 'gold':   ar=0.7; ag=0.1; ab=0.85; break;
        case 'aurora': ar=0.2; ag=0.3; ab=0.95; break;
        default:       ar=0.5; ag=0.08; ab=0.9; break;
      }
      this.splat(Math.random(),Math.random(),(Math.random()-.5)*90,(Math.random()-.5)*90,ar,ag,ab);
    }
  }

  private render() {
    const N = this.N, px = this.imgData.data;
    for (let j = 1; j <= N; j++) for (let i = 1; i <= N; i++) {
      const fi = this.IX(i,j);
      const rv = Math.min(255, this.r[fi]*255);
      const gv = Math.min(255, this.g[fi]*255);
      const bv = Math.min(255, this.b[fi]*255);
      const pi = (j*(N+2)+i)*4;
      px[pi]   = rv;
      px[pi+1] = gv;
      px[pi+2] = bv;
      px[pi+3] = Math.min(220, (rv+gv+bv)*1.3 + 6);
    }
    this.ctx.putImageData(this.imgData, 0, 0);
  }

  private last = performance.now();
  private visible = true;
  private observer: IntersectionObserver | null = null;
  private loop() {
    // Stop simulating while the canvas is scrolled/covered out of view.
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(([entry]) => {
        this.visible = entry?.isIntersecting ?? true;
      });
      this.observer.observe(this.canvas);
    }
    const tick = (now: number) => {
      if (!document.hidden && this.visible) {
        const dt = Math.min(0.033, (now - this.last) / 1000);
        this.last = now;
        this.autoSwirl(dt);
        this.step(dt);
        this.render();
      } else {
        this.last = now;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
  }
}
