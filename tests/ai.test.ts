import { describe, expect, it } from 'vitest';
import { BoardState, countSides, getGeometry, type Geometry } from '../src/game/board';
import { chooseMove, simpleEndgameValue, solvePosition } from '../src/game/ai';

/** Plain exhaustive negamax with memo — the reference the real solver must match. */
function bruteForce(geom: Geometry, drawn: Uint8Array): number {
  const memo = new Map<string, number>();
  const sides = countSides(geom, drawn);
  const rec = (): number => {
    const key = drawn.join('');
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let best = -Infinity;
    let any = false;
    for (let e = 0; e < geom.edgeCount; e++) {
      if (drawn[e]) continue;
      any = true;
      drawn[e] = 1;
      let captured = 0;
      for (let i = 0; i < 2; i++) {
        const b = geom.edgeBoxes[e * 2 + i];
        if (b >= 0 && ++sides[b] === 4) captured++;
      }
      const v = captured > 0 ? captured + rec() : -rec();
      for (let i = 0; i < 2; i++) {
        const b = geom.edgeBoxes[e * 2 + i];
        if (b >= 0) sides[b]--;
      }
      drawn[e] = 0;
      best = Math.max(best, v);
    }
    const result = any ? best : 0;
    memo.set(key, result);
    return result;
  };
  return rec();
}

function mulberry(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random position with no capturable box pending and `free` edges left. */
function randomPosition(size: number, free: number, rnd: () => number): Uint8Array {
  const geom = getGeometry(size);
  for (;;) {
    const drawn = new Uint8Array(geom.edgeCount);
    const order = [...Array(geom.edgeCount).keys()].sort(() => rnd() - 0.5);
    for (let i = 0; i < geom.edgeCount - free; i++) drawn[order[i]] = 1;
    if (countSides(geom, drawn).every((s) => s !== 3)) return drawn;
  }
}

describe('board engine', () => {
  it('builds the right geometry', () => {
    const g = getGeometry(4);
    expect(g.edgeCount).toBe(40);
    expect(g.boxCount).toBe(16);
    for (let e = 0; e < g.edgeCount; e++) {
      const n = (g.edgeBoxes[e * 2] >= 0 ? 1 : 0) + (g.edgeBoxes[e * 2 + 1] >= 0 ? 1 : 0);
      expect(n).toBeGreaterThan(0);
    }
  });

  it('keeps the turn after a capture and scores it', () => {
    const s = new BoardState(2);
    const g = s.geom;
    const box0 = Array.from(g.boxEdges.slice(0, 4));
    s.play(box0[0]); // P1
    s.play(box0[1]); // P2
    s.play(box0[2]); // P1
    expect(s.currentPlayer).toBe(2);
    expect(s.play(box0[3])).toEqual([0]);
    expect(s.scores[2]).toBe(1);
    expect(s.currentPlayer).toBe(2);
  });
});

describe('chains & loops endgame values', () => {
  it('matches textbook values', () => {
    expect(simpleEndgameValue([3], [])).toBe(-3);
    expect(simpleEndgameValue([3, 3], [])).toBe(-2);
    expect(simpleEndgameValue([1, 1], [])).toBe(0);
    expect(simpleEndgameValue([2], [])).toBe(-2);
    expect(simpleEndgameValue([4], [4])).toBe(0); // open the loop first
    expect(simpleEndgameValue([], [4])).toBe(-4);
  });
});

describe('expert solver', () => {
  it('matches brute force on every 2×2 opening', () => {
    const geom = getGeometry(2);
    expect(solvePosition(geom, new Uint8Array(geom.edgeCount))).toBe(bruteForce(geom, new Uint8Array(geom.edgeCount)));
  });

  it('matches brute force on random 3×3 positions', () => {
    const rnd = mulberry(42);
    const geom = getGeometry(3);
    for (let i = 0; i < 60; i++) {
      const drawn = randomPosition(3, 9 + (i % 6), rnd);
      expect(solvePosition(geom, drawn)).toBe(bruteForce(geom, Uint8Array.from(drawn)));
    }
  });

  it('matches brute force on random 4×4 endgames', () => {
    const rnd = mulberry(7);
    const geom = getGeometry(4);
    for (let i = 0; i < 25; i++) {
      const drawn = randomPosition(4, 12 + (i % 4), rnd);
      expect(solvePosition(geom, drawn)).toBe(bruteForce(geom, Uint8Array.from(drawn)));
    }
  });

  it('plays an optimal move in random endgames', () => {
    const rnd = mulberry(99);
    const geom = getGeometry(3);
    for (let i = 0; i < 40; i++) {
      const drawn = randomPosition(3, 10 + (i % 5), rnd);
      const best = bruteForce(geom, Uint8Array.from(drawn));
      const move = chooseMove(geom, drawn, 'expert', { random: rnd, timeLimitMs: 5000 });
      const after = Uint8Array.from(drawn);
      after[move] = 1;
      const sides = countSides(geom, after);
      const before = countSides(geom, drawn);
      let captured = 0;
      for (let b = 0; b < geom.boxCount; b++) if (sides[b] === 4 && before[b] !== 4) captured++;
      const value = captured > 0 ? captured + bruteForce(geom, after) : -bruteForce(geom, after);
      expect(value).toBe(best);
    }
  });
});

describe('AI levels', () => {
  const play = (level: 'easy' | 'medium' | 'expert', setup: (s: BoardState) => void) => {
    const s = new BoardState(3);
    setup(s);
    return { s, move: chooseMove(s.geom, s.drawnMask(), level, { random: mulberry(1) }) };
  };

  it.each(['easy', 'medium', 'expert'] as const)('%s takes a free box', (level) => {
    const { s, move } = play(level, (s) => {
      const e = s.geom.boxEdges;
      s.play(e[4 * 4 + 0]);
      s.play(e[4 * 4 + 1]);
      s.play(e[4 * 4 + 2]);
    });
    expect(move).toBe(s.geom.boxEdges[4 * 4 + 3]);
  });

  it.each(['medium', 'expert'] as const)('%s does not hand out a box early', (level) => {
    const { s, move } = play(level, (s) => {
      const e = s.geom.boxEdges;
      s.play(e[4 * 4 + 0]);
      s.play(e[4 * 4 + 1]);
    });
    const after = s.drawnMask();
    after[move] = 1;
    expect(countSides(s.geom, after).some((n) => n === 3)).toBe(false);
  });

  it('expert finishes a full 5×5 game quickly', () => {
    const s = new BoardState(5);
    const rnd = mulberry(5);
    const t0 = Date.now();
    while (!s.isOver) s.play(chooseMove(s.geom, s.drawnMask(), 'expert', { random: rnd }));
    expect(s.scores[1] + s.scores[2]).toBe(25);
    expect(Date.now() - t0).toBeLessThan(30000);
  });

  it('expert beats medium most of the time on 4×4', () => {
    let wins = 0;
    const rnd = mulberry(2024);
    for (let g = 0; g < 20; g++) {
      const s = new BoardState(4, g % 2 === 0 ? 1 : 2);
      while (!s.isOver) {
        const level = s.currentPlayer === 1 ? 'expert' : 'medium';
        s.play(chooseMove(s.geom, s.drawnMask(), level, { random: rnd }));
      }
      if (s.scores[1] > s.scores[2]) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(15);
  });
});
