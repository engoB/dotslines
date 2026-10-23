import { BoardState, type Player } from '../game/board';
import type { MatchInfo, P2PMessage, SeatInfo } from '../game/types';

export interface ClientMatch extends MatchInfo {
  /** Live (or last) board of the match, rebuilt from the host's moves. */
  board: BoardState | null;
}

/**
 * What one phone knows about an online tournament (the host's own interface
 * uses it too). Fed only by LOBBY / T_SYNC / T_MOVE messages.
 */
export class TournamentClient {
  size = 4;
  you = 0;
  /** Seconds per move chosen by the host (0 = no timer). */
  timer = 0;
  seats: SeatInfo[] = [];
  matches: ClientMatch[] = [];

  get started(): boolean {
    return this.matches.length === 3;
  }

  get championSeat(): number | null {
    return this.matches[2]?.winner ?? null;
  }

  name(seat: number | null): string {
    return seat === null ? '' : this.seats[seat]?.name ?? '';
  }

  isAI(seat: number | null): boolean {
    return seat !== null && this.seats[seat]?.kind === 'ai';
  }

  /** Is match m being played right now? */
  isLive(m: number): boolean {
    const match = this.matches[m];
    return !!match && match.winner === null && !!match.board && !match.board.isOver;
  }

  sideOf(m: number, seat = this.you): Player | null {
    const match = this.matches[m];
    if (!match) return null;
    return match.a === seat ? 1 : match.b === seat ? 2 : null;
  }

  /** The live match this phone plays in, or -1. */
  get myLiveMatch(): number {
    return [0, 1, 2].find((m) => this.isLive(m) && this.sideOf(m) !== null) ?? -1;
  }

  /** Still in the running (not eliminated)? */
  get stillIn(): boolean {
    if (!this.started) return true;
    return this.matches.every((m) => m.winner === null || m.a !== this.you && m.b !== this.you || m.winner === this.you);
  }

  applyLobby(msg: Extract<P2PMessage, { type: 'LOBBY' }>): void {
    this.size = msg.size;
    this.you = msg.you;
    this.seats = msg.seats;
    this.timer = msg.timer;
    this.matches = [];
  }

  /**
   * Applies a full tournament state. Returns the matches that (re)started
   * since the previous state, so the interface can jump into them.
   */
  applySync(msg: Extract<P2PMessage, { type: 'T_SYNC' }>): number[] {
    const before = this.matches;
    this.timer = msg.timer;
    this.size = msg.size;
    this.you = msg.you;
    this.seats = msg.seats;
    this.matches = msg.matches.map((m) => {
      let board: BoardState | null = null;
      if (m.moves) {
        board = new BoardState(msg.size, m.starter);
        for (const e of m.moves) {
          if (!board.isFree(e) || board.isOver) break;
          board.play(e);
        }
      }
      return { ...m, board };
    });
    const started: number[] = [];
    this.matches.forEach((m, i) => {
      const prev = before[i];
      const live = m.winner === null && !!m.moves;
      const wasLive = !!prev && prev.winner === null && !!prev.moves && prev.replays === m.replays;
      if (live && !wasLive) started.push(i);
    });
    return started;
  }

  /** Applies one move; false when it does not fit (the caller should resync). */
  applyMove(m: number, edge: number, seq: number): boolean {
    const board = this.matches[m]?.board;
    if (!board || board.isOver) return false;
    if (seq < board.moves.length) return board.moves[seq] === edge; // already known
    if (seq !== board.moves.length || !board.isFree(edge)) return false;
    board.play(edge);
    return true;
  }
}
