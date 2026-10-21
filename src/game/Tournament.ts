import type { AILevel } from './ai';

export interface Contestant {
  name: string;
  /** null = human player on this screen. */
  ai: AILevel | null;
}

export interface BracketMatch {
  /** Indices into `players`; null until the semi-final winners are known. */
  a: number | null;
  b: number | null;
  winner: number | null;
  score: [number, number] | null;
  /** Number of drawn games replayed so far. */
  replays: number;
}

export type RoundName = 'Demi-finale 1' | 'Demi-finale 2' | 'Finale';
export const ROUND_NAMES: RoundName[] = ['Demi-finale 1', 'Demi-finale 2', 'Finale'];

/**
 * Four-player knockout: 1 vs 2 and 3 vs 4, then the two winners meet in the
 * final. A drawn match is simply replayed.
 */
export class Tournament {
  readonly players: Contestant[];
  readonly matches: BracketMatch[];

  constructor(players: Contestant[]) {
    if (players.length !== 4) throw new Error('Un tournoi se joue à 4');
    this.players = players.map((p) => ({ ...p }));
    this.matches = [
      { a: 0, b: 1, winner: null, score: null, replays: 0 },
      { a: 2, b: 3, winner: null, score: null, replays: 0 },
      { a: null, b: null, winner: null, score: null, replays: 0 }
    ];
  }

  /** Index of the next match to play, or -1 once the champion is known. */
  get currentIndex(): number {
    return this.matches.findIndex((m) => m.winner === null);
  }

  get current(): BracketMatch | null {
    const i = this.currentIndex;
    return i < 0 ? null : this.matches[i];
  }

  get champion(): Contestant | null {
    const w = this.matches[2].winner;
    return w === null ? null : this.players[w];
  }

  get isOver(): boolean {
    return this.matches[2].winner !== null;
  }

  /**
   * Records the result of the current match (scores of its `a` and `b` side).
   * Returns 'draw' when the match must be replayed.
   */
  record(scoreA: number, scoreB: number): 'win' | 'draw' {
    const m = this.current;
    if (!m || m.a === null || m.b === null) throw new Error('Aucun match en cours');
    m.score = [scoreA, scoreB];
    if (scoreA === scoreB) {
      m.replays++;
      return 'draw';
    }
    m.winner = scoreA > scoreB ? m.a : m.b;
    const final = this.matches[2];
    if (this.matches[0].winner !== null && this.matches[1].winner !== null && final.a === null) {
      final.a = this.matches[0].winner;
      final.b = this.matches[1].winner;
    }
    return 'win';
  }
}
