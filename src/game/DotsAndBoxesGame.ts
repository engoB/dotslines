import { BoardState, edgeInfo, type Player } from './board';
import { AIClient } from './AIClient';
import type { AILevel } from './ai';
import { SketchRenderer } from './SketchRenderer';
import { SoundEffects } from './SoundEffects';
import type { ConfettiParticle, MatchConfig } from './types';

export type MoveSource = 'local' | 'ai' | 'remote';

export interface GameHooks {
  /** Scores / current player changed. */
  onUpdate: () => void;
  /** `captured` = number of boxes the move closed (the same player plays again). */
  onMove: (edge: number, source: MoveSource, seq: number, captured: number) => void;
  onGameOver: () => void;
}

/** Minimum time the AI "thinks", so its line is readable (shorter while it chains captures). */
const AI_MIN_DELAY_MS = 420;
const AI_CHAIN_DELAY_MS = 230;
/** Computer-vs-computer matches are watched at a brisker pace. */
const AI_VS_AI_DELAY_MS = 170;
const EDGE_ANIM_MS = 140;
const BOX_ANIM_MS = 420;

export const PLAYER_COLORS: Record<Player, string> = { 1: '#2f6fdb', 2: '#e2574c' };

export class DotsAndBoxesGame {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  public readonly sfx = new SoundEffects();
  private readonly ai = new AIClient();

  public config: MatchConfig = { size: 4, mode: 'ai-expert', starter: 1 };
  public state = new BoardState(4);
  public aiThinking = false;
  /** Bumped on every new match so late AI replies / timers from the old one are ignored. */
  private matchId = 0;

  private edgeAnim = new Float32Array(0);
  private boxAnim = new Float32Array(0);
  private lastEdge = -1;
  private lastSource: MoveSource | null = null;
  private hoverEdge = -1;
  private pointerDown = false;
  private confetti: ConfettiParticle[] = [];

  private cssWidth = 300;
  private cssHeight = 300;
  private rafId = 0;
  private lastFrame = 0;
  private hooks: GameHooks;

  constructor(canvas: HTMLCanvasElement, hooks: GameHooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.hooks = hooks;

    this.bindEvents();
    const parent = canvas.parentElement!;
    new ResizeObserver(() => this.resize()).observe(parent);
    this.resize();
    // Captured-box initials use the Caveat font: redraw once it is ready.
    document.fonts?.load("700 32px 'Caveat'").then(() => this.requestRender(), () => {});
  }

  // ---- match flow ---------------------------------------------------------

  public get labels(): Record<Player, string> {
    const { labels, ai } = this.config;
    return labels ?? { 1: ai?.[1] ? 'IA' : 'J1', 2: ai?.[2] ? 'IA' : 'J2' };
  }

  public get isGameOver(): boolean {
    return this.state.isOver;
  }

  /** Boxes still to be won. */
  public get boxesLeft(): number {
    return this.state.geom.boxCount - this.state.scores[1] - this.state.scores[2];
  }

  public get hasMatchInProgress(): boolean {
    return this.state.moves.length > 0 && !this.state.isOver;
  }

  public start(config: MatchConfig, moves: number[] = []): void {
    this.matchId++;
    this.config = { ...config };
    this.state = new BoardState(config.size, config.starter);
    this.edgeAnim = new Float32Array(this.state.geom.edgeCount);
    this.boxAnim = new Float32Array(this.state.geom.boxCount);
    this.aiThinking = false;
    this.hoverEdge = -1;
    this.lastEdge = -1;
    this.lastSource = null;
    this.confetti = [];

    // Replay (P2P resync): apply silently, fully drawn.
    for (const e of moves) {
      if (!this.state.isFree(e) || this.state.isOver) break;
      this.state.play(e);
      this.lastEdge = e;
    }
    this.edgeAnim.fill(1);
    this.boxAnim.fill(1);

    this.hooks.onUpdate();
    this.requestRender();
    if (this.state.isOver) this.finish();
    else this.maybeRunAI();
  }

  public canLocalPlayerAct(): boolean {
    if (this.state.isOver || this.aiThinking) return false;
    const { mode, localPlayer, ai } = this.config;
    if (mode === 'p2p') return this.state.currentPlayer === localPlayer;
    return !ai?.[this.state.currentPlayer];
  }

  /** Applies a move from the other phone. Returns false when out of sync. */
  public applyRemoteMove(edge: number, seq: number): boolean {
    if (this.config.mode !== 'p2p' || seq !== this.state.moves.length) return false;
    if (this.state.currentPlayer === this.config.localPlayer) return false;
    if (!this.state.isFree(edge)) return false;
    this.playEdge(edge, 'remote');
    return true;
  }

  private playEdge(edge: number, source: MoveSource): void {
    const seq = this.state.moves.length;
    const captured = this.state.play(edge);
    this.edgeAnim[edge] = 0.001;
    for (const b of captured) this.boxAnim[b] = 0.001;
    this.lastEdge = edge;
    this.lastSource = source;
    this.hoverEdge = -1;

    this.sfx.playPencilStroke();
    if (captured.length > 0) this.sfx.playBoxCaptured(captured.length);

    this.hooks.onMove(edge, source, seq, captured.length);
    this.hooks.onUpdate();
    this.requestRender();

    if (this.state.isOver) this.finish();
    else this.maybeRunAI();
  }

  private maybeRunAI(): void {
    const player = this.state.currentPlayer;
    const level: AILevel | undefined = this.config.ai?.[player];
    if (!level || this.state.isOver) return;
    const id = this.matchId;
    const bothAI = !!(this.config.ai?.[1] && this.config.ai?.[2]);
    const minDelay = bothAI ? AI_VS_AI_DELAY_MS : this.lastSource === 'ai' ? AI_CHAIN_DELAY_MS : AI_MIN_DELAY_MS;
    const started = performance.now();
    this.aiThinking = true;
    this.hooks.onUpdate();

    void this.ai.request(this.state.size, this.state.drawnMask(), level).then((move) => {
      const wait = Math.max(0, minDelay - (performance.now() - started));
      window.setTimeout(() => {
        if (id !== this.matchId || this.state.isOver || this.state.currentPlayer !== player) return;
        this.aiThinking = false;
        if (this.state.isFree(move)) this.playEdge(move, 'ai');
      }, wait);
    });
  }

  private finish(): void {
    this.aiThinking = false;
    this.spawnPaperConfetti();
    this.requestRender();
    const id = this.matchId;
    window.setTimeout(() => {
      if (id === this.matchId) this.hooks.onGameOver();
    }, 750);
  }

  // ---- layout & input -----------------------------------------------------

  private resize(): void {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.requestRender();
  }

  private metrics(): { originX: number; originY: number; cell: number; scale: number } {
    const side = Math.min(this.cssWidth, this.cssHeight);
    const padding = side * 0.11;
    const cell = (side - padding * 2) / this.state.size;
    return {
      originX: (this.cssWidth - side) / 2 + padding,
      originY: (this.cssHeight - side) / 2 + padding,
      cell,
      scale: Math.max(0.7, Math.min(1.3, cell / 80))
    };
  }

  private edgeCoords(e: number): { x1: number; y1: number; x2: number; y2: number } {
    const { originX, originY, cell } = this.metrics();
    const { dir, r, c } = edgeInfo(this.state.geom, e);
    const x1 = originX + c * cell;
    const y1 = originY + r * cell;
    return { x1, y1, x2: dir === 'h' ? x1 + cell : x1, y2: dir === 'v' ? y1 + cell : y1 };
  }

  private bindEvents(): void {
    const pos = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const setHover = (edge: number) => {
      if (edge !== this.hoverEdge) {
        this.hoverEdge = edge;
        this.requestRender();
      }
    };

    // Press shows a preview, release confirms: fingers can slide to adjust before committing.
    this.canvas.addEventListener('pointerdown', (e) => {
      this.sfx.unlock();
      if (!this.canLocalPlayerAct()) return;
      this.pointerDown = true;
      this.canvas.setPointerCapture?.(e.pointerId);
      const p = pos(e);
      setHover(this.findClosestFreeEdge(p.x, p.y));
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.canLocalPlayerAct()) return setHover(-1);
      if (e.pointerType !== 'mouse' && !this.pointerDown) return;
      const p = pos(e);
      setHover(this.findClosestFreeEdge(p.x, p.y));
    });

    this.canvas.addEventListener('pointerup', (e) => {
      if (!this.pointerDown) return;
      this.pointerDown = false;
      const p = pos(e);
      const edge = this.findClosestFreeEdge(p.x, p.y);
      if (edge >= 0 && this.canLocalPlayerAct()) this.playEdge(edge, 'local');
      else if (e.pointerType !== 'mouse') setHover(-1);
    });

    const cancel = () => {
      this.pointerDown = false;
      setHover(-1);
    };
    this.canvas.addEventListener('pointercancel', cancel);
    this.canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') cancel();
    });
  }

  private findClosestFreeEdge(px: number, py: number): number {
    const { cell } = this.metrics();
    let best = -1;
    let minDist = Math.min(cell * 0.5, Math.max(cell * 0.4, 22));
    for (let e = 0; e < this.state.geom.edgeCount; e++) {
      if (!this.state.isFree(e)) continue;
      const { x1, y1, x2, y2 } = this.edgeCoords(e);
      const dist = distToSegment(px, py, x1, y1, x2, y2);
      if (dist < minDist) {
        minDist = dist;
        best = e;
      }
    }
    return best;
  }

  // ---- rendering ----------------------------------------------------------

  /** Draws on demand: the loop only runs while something is animating. */
  public requestRender(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(time: number): void {
    this.rafId = 0;
    const dt = this.lastFrame ? Math.min(50, time - this.lastFrame) : 16;
    this.lastFrame = time;
    const animating = this.advance(dt);
    this.render();
    if (animating) this.requestRender();
    else this.lastFrame = 0;
  }

  private advance(dt: number): boolean {
    let animating = false;
    for (let i = 0; i < this.edgeAnim.length; i++) {
      if (this.edgeAnim[i] > 0 && this.edgeAnim[i] < 1) {
        this.edgeAnim[i] = Math.min(1, this.edgeAnim[i] + dt / EDGE_ANIM_MS);
        animating = true;
      }
    }
    for (let i = 0; i < this.boxAnim.length; i++) {
      if (this.boxAnim[i] > 0 && this.boxAnim[i] < 1) {
        this.boxAnim[i] = Math.min(1, this.boxAnim[i] + dt / BOX_ANIM_MS);
        animating = true;
      }
    }
    if (this.confetti.length > 0) {
      const k = dt / 16.67;
      for (const p of this.confetti) {
        p.x += p.vx * k;
        p.y += p.vy * k;
        p.vy += 0.18 * k;
        p.rot += p.vRot * k;
      }
      this.confetti = this.confetti.filter((p) => p.y < this.cssHeight + 30);
      animating = true;
    }
    return animating;
  }

  private render(): void {
    const ctx = this.ctx;
    const { geom, edgeOwner, boxOwner } = this.state;
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    const { originX, originY, cell, scale } = this.metrics();
    const labels = this.labels;

    for (let b = 0; b < geom.boxCount; b++) {
      const owner = boxOwner[b] as Player | 0;
      if (!owner) continue;
      const r = Math.floor(b / geom.size);
      const c = b % geom.size;
      SketchRenderer.drawCapturedBox(
        ctx,
        originX + c * cell,
        originY + r * cell,
        cell,
        PLAYER_COLORS[owner],
        labels[owner],
        this.boxAnim[b],
        1000 + geom.size * 97 + b * 13
      );
    }

    if (this.lastEdge >= 0 && edgeOwner[this.lastEdge] && !this.state.isOver) {
      const { x1, y1, x2, y2 } = this.edgeCoords(this.lastEdge);
      SketchRenderer.drawHighlight(ctx, x1, y1, x2, y2, PLAYER_COLORS[edgeOwner[this.lastEdge] as Player], 14 * scale);
    }

    if (this.hoverEdge >= 0 && this.state.isFree(this.hoverEdge) && this.canLocalPlayerAct()) {
      const { x1, y1, x2, y2 } = this.edgeCoords(this.hoverEdge);
      SketchRenderer.drawPencilLine(
        ctx, x1, y1, x2, y2, PLAYER_COLORS[this.state.currentPlayer], 1, this.edgeSeed(this.hoverEdge), true, scale
      );
    }

    for (let e = 0; e < geom.edgeCount; e++) {
      const owner = edgeOwner[e] as Player | 0;
      if (!owner) continue;
      const { x1, y1, x2, y2 } = this.edgeCoords(e);
      SketchRenderer.drawPencilLine(
        ctx, x1, y1, x2, y2, PLAYER_COLORS[owner], this.edgeAnim[e], this.edgeSeed(e), false, scale
      );
    }

    const dots = geom.size + 1;
    const dotRadius = Math.max(4, cell * 0.065);
    for (let r = 0; r < dots; r++) {
      for (let c = 0; c < dots; c++) {
        SketchRenderer.drawSketchDot(ctx, originX + c * cell, originY + r * cell, dotRadius, r * 17 + c * 31);
      }
    }

    for (const p of this.confetti) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      ctx.restore();
    }
  }

  private edgeSeed(e: number): number {
    return 10 + this.state.size * 211 + e * 7;
  }

  private spawnPaperConfetti(): void {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const palette = ['#2f6fdb', '#e2574c', '#14a38b', '#ffc93c', '#1f2a44'];
    for (let i = 0; i < 60; i++) {
      this.confetti.push({
        x: this.cssWidth / 2,
        y: this.cssHeight / 2,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.85) * 10,
        size: 6 + Math.random() * 6,
        color: palette[i % palette.length],
        rot: Math.random() * Math.PI,
        vRot: (Math.random() - 0.5) * 0.2
      });
    }
  }
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}
