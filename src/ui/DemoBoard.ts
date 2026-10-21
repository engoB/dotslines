import { BoardState, edgeInfo } from '../game/board';
import { PLAYER_COLORS } from '../game/DotsAndBoxesGame';
import { SketchRenderer } from '../game/SketchRenderer';

const SIZE = 3;
const STEP_MS = 650;
const EDGE_MS = 260;
const BOX_MS = 450;

/**
 * Small self-playing sketch board for the home screen: two pencils play a
 * quick game, then the page is "turned" and a new one starts.
 */
export class DemoBoard {
  private readonly ctx: CanvasRenderingContext2D;
  private state = new BoardState(SIZE);
  private edgeAnim = new Float32Array(this.state.geom.edgeCount);
  private boxAnim = new Float32Array(this.state.geom.boxCount);
  private running = false;
  private raf = 0;
  private timer: number | undefined;
  private last = 0;
  private w = 0;
  private h = 0;
  private readonly reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.running && this.start()));
    document.fonts?.load("700 32px 'Caveat'").then(() => this.draw(), () => {});
    if (this.reduced) this.prefill();
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  /** Static picture of a game in progress (reduced motion). */
  private prefill(): void {
    for (let i = 0; i < 14 && !this.state.isOver; i++) this.state.play(this.pickMove());
    this.edgeAnim.fill(1);
    this.boxAnim.fill(1);
  }

  public start(): void {
    this.running = true;
    if (this.reduced || document.hidden || this.timer !== undefined) return;
    this.schedule();
  }

  public stop(): void {
    window.clearTimeout(this.timer);
    this.timer = undefined;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (!document.hidden) this.running = false;
  }

  private schedule(): void {
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      if (this.state.isOver) {
        this.state = new BoardState(SIZE);
        this.edgeAnim = new Float32Array(this.state.geom.edgeCount);
        this.boxAnim = new Float32Array(this.state.geom.boxCount);
      } else {
        const e = this.pickMove();
        for (const b of this.state.play(e)) this.boxAnim[b] = 0.001;
        this.edgeAnim[e] = 0.001;
        this.animate();
      }
      this.draw();
      this.schedule();
    }, this.state.isOver ? 2600 : STEP_MS);
  }

  /** Takes a free box when there is one, otherwise avoids handing one out. */
  private pickMove(): number {
    const { geom, sides } = this.state;
    const free: number[] = [];
    for (let e = 0; e < geom.edgeCount; e++) if (this.state.isFree(e)) free.push(e);
    const adjacent = (e: number) => [geom.edgeBoxes[e * 2], geom.edgeBoxes[e * 2 + 1]].filter((b) => b >= 0);
    const closing = free.filter((e) => adjacent(e).some((b) => sides[b] === 3));
    if (closing.length) return closing[0];
    const safe = free.filter((e) => adjacent(e).every((b) => sides[b] < 2));
    const pool = safe.length ? safe : free;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private animate(): void {
    if (this.raf) return;
    const tick = (t: number) => {
      this.raf = 0;
      const dt = this.last ? Math.min(50, t - this.last) : 16;
      this.last = t;
      let moving = false;
      for (let i = 0; i < this.edgeAnim.length; i++) {
        if (this.edgeAnim[i] > 0 && this.edgeAnim[i] < 1) {
          this.edgeAnim[i] = Math.min(1, this.edgeAnim[i] + dt / EDGE_MS);
          moving = true;
        }
      }
      for (let i = 0; i < this.boxAnim.length; i++) {
        if (this.boxAnim[i] > 0 && this.boxAnim[i] < 1) {
          this.boxAnim[i] = Math.min(1, this.boxAnim[i] + dt / BOX_MS);
          moving = true;
        }
      }
      this.draw();
      if (moving) this.raf = requestAnimationFrame(tick);
      else this.last = 0;
    };
    this.raf = requestAnimationFrame(tick);
  }

  private draw(): void {
    const { ctx, w, h } = this;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const side = Math.min(w, h);
    const pad = side * 0.13;
    const cell = (side - pad * 2) / SIZE;
    const ox = (w - side) / 2 + pad;
    const oy = (h - side) / 2 + pad;
    const scale = Math.max(0.6, Math.min(1.1, cell / 80));
    const { geom, edgeOwner, boxOwner } = this.state;

    for (let b = 0; b < geom.boxCount; b++) {
      const owner = boxOwner[b] as 1 | 2 | 0;
      if (!owner) continue;
      const x = ox + (b % SIZE) * cell;
      const y = oy + Math.floor(b / SIZE) * cell;
      SketchRenderer.drawCapturedBox(ctx, x, y, cell, PLAYER_COLORS[owner], owner === 1 ? 'J1' : 'J2', this.boxAnim[b], 300 + b * 13);
    }
    for (let e = 0; e < geom.edgeCount; e++) {
      const owner = edgeOwner[e] as 1 | 2 | 0;
      if (!owner) continue;
      const { dir, r, c } = edgeInfo(geom, e);
      const x1 = ox + c * cell;
      const y1 = oy + r * cell;
      SketchRenderer.drawPencilLine(
        ctx, x1, y1, dir === 'h' ? x1 + cell : x1, dir === 'v' ? y1 + cell : y1,
        PLAYER_COLORS[owner], this.edgeAnim[e], 40 + e * 7, false, scale
      );
    }
    for (let r = 0; r <= SIZE; r++) {
      for (let c = 0; c <= SIZE; c++) {
        SketchRenderer.drawSketchDot(ctx, ox + c * cell, oy + r * cell, Math.max(3.5, cell * 0.07), r * 17 + c * 31);
      }
    }
  }
}
