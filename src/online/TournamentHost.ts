import type { AILevel } from '../game/ai';
import { BoardState, type Player } from '../game/board';
import { Tournament } from '../game/Tournament';
import type { MatchInfo, P2PMessage, SeatInfo, SeatKind } from '../game/types';

export interface Seat {
  name: string;
  kind: SeatKind;
  /** Peer id of the phone sitting here. */
  peer?: string;
  level?: AILevel;
}

/** Computes a move for an AI seat (a Web Worker in the app, synchronous in tests). */
export interface MovePicker {
  request: (size: number, drawn: Uint8Array, level: AILevel) => Promise<number>;
}

export interface HostIO {
  /** To one guest phone (peer id) or to all of them. */
  send: (msg: P2PMessage, to?: string) => void;
  /** To this phone's own interface. */
  local: (msg: P2PMessage) => void;
  /** Short notice for everybody (also shown locally). */
  info: (text: string) => void;
}

/** Pause before the final or a replayed match, so everyone sees the results. */
export const NEXT_MATCH_DELAY_MS = 3000;
const AI_DELAY_MS = 550;
const AI_CYCLE: (AILevel | undefined)[] = [undefined, 'easy', 'medium', 'expert'];
const AI_NAMES: Record<AILevel, string> = { easy: 'IA Facile', medium: 'IA Malin', expert: 'IA Expert' };
export const MAX_NAME = 14;

export const cleanName = (raw: string, fallback: string): string => {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return name || fallback;
};

/**
 * Authority of an online tournament, running on the phone that created the
 * room. It owns the seats, the bracket and the reference board of every match,
 * validates moves, plays the AI seats and broadcasts the state.
 */
export class TournamentHost {
  readonly seats: Seat[];
  tournament: Tournament | null = null;
  private readonly boards: (BoardState | null)[] = [null, null, null];
  private readonly starters: Player[] = [1, 1, 1];
  /** Bumped when a board is (re)created: late AI replies are then ignored. */
  private readonly gen = [0, 0, 0];
  private readonly aiBusy = [false, false, false];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private disposed = false;

  /** Seconds per move for every human seat (0 = no timer). */
  timer = 0;

  constructor(
    hostName: string,
    public size: number,
    private readonly io: HostIO,
    private readonly ai: MovePicker
  ) {
    this.seats = [
      { name: cleanName(hostName, 'Joueur 1'), kind: 'host' },
      { name: '', kind: 'open' },
      { name: '', kind: 'open' },
      { name: '', kind: 'open' }
    ];
  }

  get started(): boolean {
    return this.tournament !== null;
  }

  get hostSeat(): number {
    return this.seats.findIndex((s) => s.kind === 'host');
  }

  get canStart(): boolean {
    return !this.started && this.seats.every((s) => s.kind !== 'open');
  }

  seatOfPeer(peer: string): number {
    return this.seats.findIndex((s) => s.peer === peer);
  }

  // ---- lobby ----------------------------------------------------------------

  /** Seats a newly connected phone; null when the room has no free seat. */
  addGuest(peer: string): number | null {
    if (this.started) return null;
    const i = this.seats.findIndex((s) => s.kind === 'open');
    if (i < 0) return null;
    this.seats[i] = { name: `Joueur ${i + 1}`, kind: 'phone', peer };
    this.broadcastLobby();
    return i;
  }

  removeGuest(peer: string): void {
    const i = this.seatOfPeer(peer);
    if (i < 0) return;
    const name = this.seats[i].name;
    if (!this.started) {
      this.seats[i] = { name: '', kind: 'open' };
      this.broadcastLobby();
      return;
    }
    // Mid-tournament: an AI takes over so the bracket can finish.
    this.seats[i] = { name, kind: 'ai', level: 'medium' };
    if (this.tournament) this.tournament.players[i].ai = 'medium';
    this.io.info(`${name} s'est déconnecté : une IA joue à sa place.`);
    this.broadcastSync();
    this.runAI();
  }

  rename(seat: number, raw: string): void {
    const s = this.seats[seat];
    if (!s || (s.kind !== 'host' && s.kind !== 'phone')) return;
    s.name = cleanName(raw, `Joueur ${seat + 1}`);
    if (this.tournament) this.tournament.players[seat].name = s.name;
    if (this.started) this.broadcastSync();
    else this.broadcastLobby();
  }

  /** Free seat → IA Facile → IA Malin → IA Expert → free seat. */
  cycleSeat(i: number): void {
    const s = this.seats[i];
    if (this.started || !s || (s.kind !== 'open' && s.kind !== 'ai')) return;
    const next = AI_CYCLE[(AI_CYCLE.indexOf(s.level) + 1) % AI_CYCLE.length];
    this.seats[i] = next ? { name: AI_NAMES[next], kind: 'ai', level: next } : { name: '', kind: 'open' };
    this.broadcastLobby();
  }

  /** Fills every free seat with an AI of the given level. */
  fillWithAI(level: AILevel = 'medium'): void {
    if (this.started) return;
    this.seats.forEach((s, i) => {
      if (s.kind === 'open') this.seats[i] = { name: AI_NAMES[level], kind: 'ai', level };
    });
    this.broadcastLobby();
  }

  shuffle(): void {
    if (this.started) return;
    for (let i = this.seats.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.seats[i], this.seats[j]] = [this.seats[j], this.seats[i]];
    }
    this.broadcastLobby();
  }

  setTimer(seconds: number): void {
    if (this.started) return;
    this.timer = seconds;
    this.broadcastLobby();
  }

  setSize(size: number): void {
    if (this.started) return;
    this.size = size;
    this.broadcastLobby();
  }

  // ---- tournament flow -------------------------------------------------------

  start(): boolean {
    if (!this.canStart) return false;
    this.tournament = new Tournament(this.seats.map((s) => ({ name: s.name, ai: s.kind === 'ai' ? s.level ?? 'medium' : null })));
    this.newBoard(0, Math.random() < 0.5 ? 1 : 2);
    this.newBoard(1, Math.random() < 0.5 ? 1 : 2);
    this.broadcastSync();
    this.runAI();
    return true;
  }

  /** Back to the lobby with the same phones, for another tournament. */
  reset(): void {
    this.clearTimers();
    this.tournament = null;
    for (let m = 0; m < 3; m++) {
      this.boards[m] = null;
      this.gen[m]++;
      this.aiBusy[m] = false;
    }
    this.broadcastLobby();
  }

  private newBoard(m: number, starter: Player): void {
    this.boards[m] = new BoardState(this.size, starter);
    this.starters[m] = starter;
    this.gen[m]++;
    this.aiBusy[m] = false;
  }

  /** The side (1 or 2) a seat plays in match m, if any. */
  sideOf(m: number, seat: number): Player | null {
    const match = this.tournament?.matches[m];
    if (!match) return null;
    return match.a === seat ? 1 : match.b === seat ? 2 : null;
  }

  /** A move from a guest phone. Out-of-sync or illegal moves get a resync. */
  submitFromPeer(peer: string, m: number, edge: number, seq: number): void {
    const seat = this.seatOfPeer(peer);
    if (seat < 0 || !this.submit(seat, m, edge, seq, peer)) this.syncPeer(peer);
  }

  /** Validates and applies a move played by `seat`; `origin` is not echoed. */
  submit(seat: number, m: number, edge: number, seq: number, origin?: string): boolean {
    const board = this.boards[m];
    const match = this.tournament?.matches[m];
    if (!board || !match || match.winner !== null || board.isOver) return false;
    const side = this.sideOf(m, seat);
    if (!side || board.currentPlayer !== side || seq !== board.moves.length || !board.isFree(edge)) return false;
    this.apply(m, edge, origin);
    return true;
  }

  private apply(m: number, edge: number, origin?: string): void {
    const board = this.boards[m]!;
    const seq = board.moves.length;
    board.play(edge);
    const msg: P2PMessage = { type: 'T_MOVE', m, edge, seq };
    for (const s of this.seats) if (s.peer && s.peer !== origin) this.io.send(msg, s.peer);
    if (origin !== 'host') this.io.local(msg);
    if (board.isOver) this.finish(m);
    else this.runAI();
  }

  private finish(m: number): void {
    const t = this.tournament!;
    const board = this.boards[m]!;
    const result = t.record(m, board.scores[1], board.scores[2]);
    this.broadcastSync();
    if (result === 'draw') {
      this.later(() => {
        this.newBoard(m, this.starters[m] === 1 ? 2 : 1);
        this.broadcastSync();
        this.runAI();
      });
    } else if (m < 2 && t.matches[2].a !== null && !this.boards[2]) {
      this.later(() => {
        this.newBoard(2, Math.random() < 0.5 ? 1 : 2);
        this.broadcastSync();
        this.runAI();
      });
    }
  }

  private later(fn: () => void): void {
    const id = setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== id);
      if (!this.disposed) fn();
    }, NEXT_MATCH_DELAY_MS);
    this.timers.push(id);
  }

  /** Plays for every AI seat whose turn it is. */
  private runAI(): void {
    const t = this.tournament;
    if (!t) return;
    for (let m = 0; m < 3; m++) {
      const board = this.boards[m];
      const match = t.matches[m];
      if (!board || board.isOver || match.winner !== null || this.aiBusy[m]) continue;
      const seat = board.currentPlayer === 1 ? match.a : match.b;
      const s = seat === null ? null : this.seats[seat];
      if (!s || s.kind !== 'ai') continue;
      this.aiBusy[m] = true;
      const g = this.gen[m];
      const t0 = performance.now();
      void this.ai.request(this.size, board.drawnMask(), s.level ?? 'medium').then((edge) => {
        const wait = Math.max(0, AI_DELAY_MS - (performance.now() - t0));
        setTimeout(() => {
          if (this.disposed || this.gen[m] !== g) return;
          this.aiBusy[m] = false;
          const b = this.boards[m];
          if (b && !b.isOver && b.isFree(edge)) this.apply(m, edge, undefined);
        }, wait);
      });
    }
  }

  // ---- state broadcast -------------------------------------------------------

  seatInfo(): SeatInfo[] {
    return this.seats.map((s) => ({ name: s.name, kind: s.kind }));
  }

  matchInfo(): MatchInfo[] {
    const t = this.tournament!;
    return t.matches.map((m, i) => ({
      a: m.a,
      b: m.b,
      winner: m.winner,
      score: m.score ? [m.score[0], m.score[1]] : null,
      replays: m.replays,
      starter: this.starters[i],
      moves: this.boards[i] ? [...this.boards[i]!.moves] : null
    }));
  }

  private message(you: number): P2PMessage {
    return this.started
      ? { type: 'T_SYNC', size: this.size, you, seats: this.seatInfo(), matches: this.matchInfo(), timer: this.timer }
      : { type: 'LOBBY', size: this.size, you, seats: this.seatInfo(), timer: this.timer };
  }

  broadcastLobby(): void {
    this.broadcastSync();
  }

  /** Lobby or tournament state, personalised with each phone's seat. */
  broadcastSync(): void {
    this.seats.forEach((s, i) => {
      if (s.peer) this.io.send(this.message(i), s.peer);
    });
    this.io.local(this.message(this.hostSeat));
  }

  syncPeer(peer: string): void {
    const seat = this.seatOfPeer(peer);
    if (seat >= 0) this.io.send(this.message(seat), peer);
  }

  private clearTimers(): void {
    this.timers.forEach((id) => clearTimeout(id));
    this.timers = [];
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
  }
}
