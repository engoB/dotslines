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
 * Four-player knockout: 1 vs 2 and 3 vs 4 (played at the same time), then the
 * two winners meet in the final. A drawn match is simply replayed.
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

  /** Matches whose two players are known and that have no winner yet. */
  get playable(): number[] {
    return [0, 1, 2].filter((i) => {
      const m = this.matches[i];
      return m.a !== null && m.b !== null && m.winner === null;
    });
  }

  get champion(): Contestant | null {
    const w = this.matches[2].winner;
    return w === null ? null : this.players[w];
  }

  get isOver(): boolean {
    return this.matches[2].winner !== null;
  }

  /**
   * Records the result of a match (scores of its `a` and `b` side).
   * Returns 'draw' when the match must be replayed.
   */
  record(index: number, scoreA: number, scoreB: number): 'win' | 'draw' {
    const m = this.matches[index];
    if (!m || m.a === null || m.b === null || m.winner !== null) throw new Error('Match non jouable');
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
