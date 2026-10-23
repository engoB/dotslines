import { BoardState, edgeInfo, type Player } from './board';
import { AIClient } from './AIClient';
import type { AILevel } from './ai';
import { BOARD_FONT, BoardRenderer } from './BoardRenderer';
import { SoundEffects } from './SoundEffects';
import type { ConfettiParticle, MatchConfig } from './types';

export type MoveSource = 'local' | 'ai' | 'remote' | 'timeout';

export interface GameHooks {
  /** Scores / current player changed. */
  onUpdate: () => void;
  /** `captured` = number of boxes the move closed (the same player plays again). */
  onMove: (edge: number, source: MoveSource, seq: number, captured: number) => void;
  onGameOver: () => void;
  /** Turn timer: remaining / total ms for `player` (total 0 = no timer running). */
  onTimer?: (remainingMs: number, totalMs: number, player: Player) => void;
}

/** Minimum time the AI "thinks", so its line is readable (shorter while it chains captures). */
const AI_MIN_DELAY_MS = 420;
const AI_CHAIN_DELAY_MS = 230;
/** Computer-vs-computer matches are watched at a brisker pace. */
const AI_VS_AI_DELAY_MS = 170;
const EDGE_ANIM_MS = 170;
const BOX_ANIM_MS = 380;
/** How long the opponent's last move pulses before staying highlighted. */
const PULSE_MS = 2600;
const TIMER_TICK_MS = 100;

export const PLAYER_COLORS: Record<Player, string> = { 1: '#1d9bf0', 2: '#ff4b55' };

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
  private lastSource: MoveSource | null = null;
  /** Lines of the latest turn (one player's consecutive moves) and who played them. */
  private turnEdges: number[] = [];
  private turnOwner: Player | 0 = 0;
  private turnTime = 0;
  private hoverEdge = -1;
  private pointerDown = false;
  private confetti: ConfettiParticle[] = [];

  private deadline = 0;
  private pausedRemaining = -1;
  private timerHandle: number | undefined;

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
    // Captured-box initials use the rounded display font: redraw once it is ready.
    document.fonts?.load(`800 32px ${BOARD_FONT}`).then(() => this.requestRender(), () => {});
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
    this.pointerDown = false;
    this.lastSource = null;
    this.turnEdges = [];
    this.turnOwner = 0;
    this.confetti = [];
    this.pausedRemaining = -1;

    // Replay (P2P resync): apply silently, fully drawn.
    for (const e of moves) {
      if (!this.state.isFree(e) || this.state.isOver) break;
      this.trackTurn(e, this.state.currentPlayer);
      this.state.play(e);
    }
    this.turnTime = 0; // no pulse for replayed history
    this.edgeAnim.fill(1);
    this.boxAnim.fill(1);

    this.hooks.onUpdate();
    this.requestRender();
    if (this.state.isOver) this.finish();
    else {
      this.armTimer();
      this.maybeRunAI();
    }
  }

  public canLocalPlayerAct(): boolean {
    if (this.state.isOver || this.aiThinking) return false;
    const { mode, localPlayer, ai } = this.config;
    // Networked games: only the side held on this phone (none when spectating).
    if (mode === 'p2p' || mode === 'tournament') return this.state.currentPlayer === localPlayer;
    return !ai?.[this.state.currentPlayer];
  }

  /** Applies a move from the other phone. Returns false when out of sync. */
  public applyRemoteMove(edge: number, seq: number): boolean {
    const { mode } = this.config;
    if ((mode !== 'p2p' && mode !== 'tournament') || seq !== this.state.moves.length) return false;
    if (this.state.currentPlayer === this.config.localPlayer) return false;
    if (!this.state.isFree(edge)) return false;
    this.playEdge(edge, 'remote');
    return true;
  }

  private trackTurn(edge: number, player: Player): void {
    if (player !== this.turnOwner) {
      this.turnOwner = player;
      this.turnEdges = [];
    }
    this.turnEdges.push(edge);
    this.turnTime = performance.now();
  }

  private playEdge(edge: number, source: MoveSource): void {
    const seq = this.state.moves.length;
    this.trackTurn(edge, this.state.currentPlayer);
    const captured = this.state.play(edge);
    this.edgeAnim[edge] = 0.001;
    for (const b of captured) this.boxAnim[b] = 0.001;
    this.lastSource = source;
    this.hoverEdge = -1;
    this.pointerDown = false;

    this.sfx.playStroke();
    if (source === 'timeout') this.sfx.playTimeout();
    if (captured.length > 0) this.sfx.playBoxCaptured(captured.length);

    this.hooks.onMove(edge, source, seq, captured.length);
    this.hooks.onUpdate();
    this.requestRender();

    if (this.state.isOver) this.finish();
    else {
      this.armTimer();
      this.maybeRunAI();
    }
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
    this.stopTimer();
    this.spawnConfetti();
    this.requestRender();
    const id = this.matchId;
    window.setTimeout(() => {
      if (id === this.matchId) this.hooks.onGameOver();
    }, 750);
  }

  // ---- turn timer ---------------------------------------------------------

  /** Whose turns are timed: humans only (here or on another phone). */
  private isTimed(p: Player): boolean {
    const { turnSeconds, ai, untimed } = this.config;
    return !!turnSeconds && !ai?.[p] && !untimed?.includes(p);
  }

  /** Restarts the clock for the player to move (each line is a new decision). */
  private armTimer(): void {
    this.stopTimer();
    const p = this.state.currentPlayer;
    if (this.state.isOver || !this.isTimed(p)) {
      this.hooks.onTimer?.(0, 0, p);
      return;
    }
    const total = this.config.turnSeconds! * 1000;
    if (this.pausedRemaining >= 0) this.pausedRemaining = total;
    else this.deadline = performance.now() + total;
    const id = this.matchId;
    this.timerHandle = window.setInterval(() => this.tick(id, p, total), TIMER_TICK_MS);
    this.tick(id, p, total);
  }

  private tick(id: number, p: Player, total: number): void {
    if (id !== this.matchId || this.state.isOver || this.state.currentPlayer !== p) return this.stopTimer();
    const remaining = this.pausedRemaining >= 0 ? this.pausedRemaining : Math.max(0, this.deadline - performance.now());
    this.hooks.onTimer?.(remaining, total, p);
    if (remaining > 0 || this.pausedRemaining >= 0) return;
    this.stopTimer();
    // Out of time: a random line is drawn for the player (only by the phone that holds them).
    if (!this.canLocalPlayerAct()) return;
    const free: number[] = [];
    for (let e = 0; e < this.state.geom.edgeCount; e++) if (this.state.isFree(e)) free.push(e);
    if (free.length) this.playEdge(free[Math.floor(Math.random() * free.length)], 'timeout');
  }

  private stopTimer(): void {
    window.clearInterval(this.timerHandle);
    this.timerHandle = undefined;
  }

  /** Freezes / resumes the clock (local games: pause menu, app in background). */
  public setPaused(paused: boolean): void {
    if (paused && this.pausedRemaining < 0) {
      this.pausedRemaining = Math.max(0, this.deadline - performance.now());
    } else if (!paused && this.pausedRemaining >= 0) {
      this.deadline = performance.now() + this.pausedRemaining;
      this.pausedRemaining = -1;
    }
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

  private metrics(): { originX: number; originY: number; cell: number } {
    const side = Math.min(this.cssWidth, this.cssHeight);
    const padding = side * 0.08;
    const cell = (side - padding * 2) / this.state.size;
    return {
      originX: (this.cssWidth - side) / 2 + padding,
      originY: (this.cssHeight - side) / 2 + padding,
      cell
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
    const animating = this.advance(dt, time);
    this.render(time);
    if (animating) this.requestRender();
    else this.lastFrame = 0;
  }

  /** The opponent's last turn pulses for a moment after it was played. */
  private highlightActive(): boolean {
    return this.turnEdges.length > 0 && !this.state.isOver && this.turnOwner !== this.state.currentPlayer;
  }

  private advance(dt: number, now: number): boolean {
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
    if (this.highlightActive() && now - this.turnTime < PULSE_MS) animating = true;
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

  private render(now: number): void {
    const ctx = this.ctx;
    const { geom, edgeOwner, boxOwner } = this.state;
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    const { originX, originY, cell } = this.metrics();
    const labels = this.labels;
    const lineWidth = Math.max(5, cell * 0.095);

    for (let b = 0; b < geom.boxCount; b++) {
      const x = originX + (b % geom.size) * cell;
      const y = originY + Math.floor(b / geom.size) * cell;
      const owner = boxOwner[b] as Player | 0;
      if (owner && this.boxAnim[b] >= 1) {
        BoardRenderer.box(ctx, x, y, cell, PLAYER_COLORS[owner], labels[owner], 1);
        continue;
      }
      BoardRenderer.cell(ctx, x, y, cell);
      if (owner) BoardRenderer.box(ctx, x, y, cell, PLAYER_COLORS[owner], labels[owner], this.boxAnim[b]);
    }

    // The opponent's last turn: pulsing glow, then a steady one until you play.
    if (this.highlightActive()) {
      const age = now - this.turnTime;
      const alpha = age < PULSE_MS ? 0.22 + 0.2 * (0.5 + 0.5 * Math.sin((age / 1000) * Math.PI * 2.4)) : 0.24;
      for (const e of this.turnEdges) {
        const { x1, y1, x2, y2 } = this.edgeCoords(e);
        BoardRenderer.halo(ctx, x1, y1, x2, y2, PLAYER_COLORS[this.turnOwner as Player], lineWidth * 3.1, alpha);
      }
    }

    if (this.hoverEdge >= 0 && this.state.isFree(this.hoverEdge) && this.canLocalPlayerAct()) {
      const { x1, y1, x2, y2 } = this.edgeCoords(this.hoverEdge);
      BoardRenderer.ghost(ctx, x1, y1, x2, y2, PLAYER_COLORS[this.state.currentPlayer], lineWidth);
    }

    for (let e = 0; e < geom.edgeCount; e++) {
      const owner = edgeOwner[e] as Player | 0;
      if (!owner) continue;
      const { x1, y1, x2, y2 } = this.edgeCoords(e);
      BoardRenderer.line(ctx, x1, y1, x2, y2, PLAYER_COLORS[owner], lineWidth, this.edgeAnim[e]);
    }

    const dots = geom.size + 1;
    const dotRadius = Math.max(4.5, cell * 0.078);
    for (let r = 0; r < dots; r++) {
      for (let c = 0; c < dots; c++) BoardRenderer.dot(ctx, originX + c * cell, originY + r * cell, dotRadius);
    }

    for (const p of this.confetti) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private spawnConfetti(): void {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const palette = [PLAYER_COLORS[1], PLAYER_COLORS[2], '#ffc531', '#2ecc71', '#a26bff'];
    for (let i = 0; i < 70; i++) {
      this.confetti.push({
        x: this.cssWidth / 2,
        y: this.cssHeight / 2,
        vx: (Math.random() - 0.5) * 11,
        vy: (Math.random() - 0.85) * 11,
        size: 6 + Math.random() * 7,
        color: palette[i % palette.length],
        rot: 0,
        vRot: 0
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
