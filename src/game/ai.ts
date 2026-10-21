import type { Geometry } from './board';

export type AILevel = 'easy' | 'medium' | 'expert';

export interface AIOptions {
  /** Random source in [0, 1) — injectable for tests. */
  random?: () => number;
  /** Max positions explored by the expert search before falling back to heuristics. */
  nodeLimit?: number;
  /** Max thinking time for the expert search (ms). */
  timeLimitMs?: number;
}

/**
 * Free-edge count from which the expert solves the game exactly (measured to
 * stay well under a second on a phone). Above it, heuristics are used.
 */
const SEARCH_FREE_EDGES: Record<number, number> = { 2: 12, 3: 20, 4: 26, 5: 34 };

const ABORT = Symbol('abort');

const enum Bound {
  Exact,
  Lower,
  Upper
}

interface TTEntry {
  value: number;
  bound: Bound;
}

/**
 * Picks the edge to play for the side to move. `drawn` holds 1 for every drawn
 * edge. The function never mutates its inputs.
 */
export function chooseMove(geom: Geometry, drawn: Uint8Array, level: AILevel, options: AIOptions = {}): number {
  const solver = new Solver(geom, drawn, options);
  return solver.choose(level);
}

/** Exposed for tests: net score (mover − opponent) of a chains/loops-only endgame. */
export function simpleEndgameValue(chains: number[], loops: number[]): number {
  return dpValue([...chains].sort((a, b) => a - b), [...loops].sort((a, b) => a - b)) + 0;
}

/** Exposed for tests: exact net score for the side to move, or null if the budget ran out. */
export function solvePosition(geom: Geometry, drawn: Uint8Array, nodeLimit = 2_000_000): number | null {
  const solver = new Solver(geom, drawn, { nodeLimit, timeLimitMs: Infinity });
  try {
    return solver.negamax(-Infinity, Infinity) + 0; // normalise -0
  } catch (err) {
    if (err === ABORT) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Chains & loops endgame (Berlekamp): exact value once every remaining box has
// exactly two drawn sides, i.e. the board is a set of independent chains/loops.
// ---------------------------------------------------------------------------

const dpMemo = new Map<string, number>();

function dpValue(chains: number[], loops: number[]): number {
  if (chains.length === 0 && loops.length === 0) return 0;
  const key = chains.join(',') + '|' + loops.join(',');
  const memo = dpMemo.get(key);
  if (memo !== undefined) return memo;

  let best = -Infinity;
  for (let i = 0; i < chains.length; i++) {
    if (i > 0 && chains[i] === chains[i - 1]) continue;
    const k = chains[i];
    const rest = dpValue(chains.slice(0, i).concat(chains.slice(i + 1)), loops);
    // 1- and 2-chains (opened in the middle) cannot be double-dealt.
    const opponent = k <= 2 ? k + rest : Math.max(k + rest, k - 4 - rest);
    best = Math.max(best, -opponent);
  }
  for (let i = 0; i < loops.length; i++) {
    if (i > 0 && loops[i] === loops[i - 1]) continue;
    const k = loops[i];
    const rest = dpValue(chains, loops.slice(0, i).concat(loops.slice(i + 1)));
    best = Math.max(best, -Math.max(k + rest, k - 8 - rest));
  }
  dpMemo.set(key, best);
  return best;
}

// ---------------------------------------------------------------------------

class Solver {
  private readonly geom: Geometry;
  private readonly drawn: Uint8Array;
  private readonly sides: Uint8Array;
  private remaining: number;
  private readonly random: () => number;
  private readonly nodeLimit: number;
  private readonly deadline: number;
  private nodes = 0;

  private readonly zobristA: Int32Array;
  private readonly zobristB: Int32Array;
  private hashA = 0;
  private hashB = 0;
  private readonly tt = new Map<number, TTEntry>();

  constructor(geom: Geometry, drawn: Uint8Array, options: AIOptions) {
    this.geom = geom;
    this.drawn = Uint8Array.from(drawn);
    this.sides = new Uint8Array(geom.boxCount);
    this.random = options.random ?? Math.random;
    this.nodeLimit = options.nodeLimit ?? 1_500_000;
    this.deadline = Date.now() + (options.timeLimitMs ?? 1500);

    // Deterministic Zobrist keys (mulberry32).
    let seed = 0x9e3779b9;
    const next = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return t ^ (t >>> 14);
    };
    this.zobristA = new Int32Array(geom.edgeCount).map(next);
    this.zobristB = new Int32Array(geom.edgeCount).map(next);

    this.remaining = geom.boxCount;
    for (let e = 0; e < geom.edgeCount; e++) {
      if (!this.drawn[e]) continue;
      this.hashA ^= this.zobristA[e];
      this.hashB ^= this.zobristB[e];
    }
    for (let b = 0; b < geom.boxCount; b++) {
      let n = 0;
      for (let i = 0; i < 4; i++) if (this.drawn[geom.boxEdges[b * 4 + i]]) n++;
      this.sides[b] = n;
      if (n === 4) this.remaining--;
    }
  }

  // ---- board helpers ------------------------------------------------------

  private freeEdges(): number[] {
    const res: number[] = [];
    for (let e = 0; e < this.geom.edgeCount; e++) if (!this.drawn[e]) res.push(e);
    return res;
  }

  private otherBox(e: number, b: number): number {
    const a = this.geom.edgeBoxes[e * 2];
    return a === b ? this.geom.edgeBoxes[e * 2 + 1] : a;
  }

  private freeEdgeOf(b: number, except = -1): number {
    for (let i = 0; i < 4; i++) {
      const e = this.geom.boxEdges[b * 4 + i];
      if (!this.drawn[e] && e !== except) return e;
    }
    return -1;
  }

  /** A safe edge does not hand a third side to any box. */
  private isSafe(e: number): boolean {
    for (let i = 0; i < 2; i++) {
      const b = this.geom.edgeBoxes[e * 2 + i];
      if (b >= 0 && this.sides[b] >= 2) return false;
    }
    return true;
  }

  private capturableBoxes(): number[] {
    const res: number[] = [];
    for (let b = 0; b < this.geom.boxCount; b++) if (this.sides[b] === 3) res.push(b);
    return res;
  }

  private apply(e: number): number {
    this.drawn[e] = 1;
    this.hashA ^= this.zobristA[e];
    this.hashB ^= this.zobristB[e];
    let captured = 0;
    for (let i = 0; i < 2; i++) {
      const b = this.geom.edgeBoxes[e * 2 + i];
      if (b < 0) continue;
      if (++this.sides[b] === 4) captured++;
    }
    this.remaining -= captured;
    return captured;
  }

  private undo(e: number, captured: number): void {
    this.drawn[e] = 0;
    this.hashA ^= this.zobristA[e];
    this.hashB ^= this.zobristB[e];
    for (let i = 0; i < 2; i++) {
      const b = this.geom.edgeBoxes[e * 2 + i];
      if (b >= 0) this.sides[b]--;
    }
    this.remaining += captured;
  }

  /** Boxes the opponent collects by greedily capturing after we draw `e`. */
  private giveaway(e: number): number {
    const played: number[] = [];
    const caps: number[] = [];
    let captured = this.apply(e);
    played.push(e);
    caps.push(captured);
    if (captured > 0) {
      // Our own capture: not a giveaway at all.
      this.undo(e, captured);
      return -captured;
    }
    let total = 0;
    let found = true;
    while (found) {
      found = false;
      for (let b = 0; b < this.geom.boxCount; b++) {
        if (this.sides[b] !== 3) continue;
        const f = this.freeEdgeOf(b);
        captured = this.apply(f);
        played.push(f);
        caps.push(captured);
        total += captured;
        found = true;
      }
    }
    for (let i = played.length - 1; i >= 0; i--) this.undo(played[i], caps[i]);
    return total;
  }

  private pickRandom<T>(items: T[]): T {
    return items[Math.floor(this.random() * items.length)];
  }

  private shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  // ---- move selection -----------------------------------------------------

  choose(level: AILevel): number {
    const free = this.freeEdges();
    if (free.length === 0) throw new Error('Aucun coup disponible');
    const caps = this.capturableBoxes();
    const safe = free.filter((e) => this.isSafe(e));

    if (level === 'easy') {
      if (caps.length > 0) return this.freeEdgeOf(caps[0]);
      return this.pickRandom(free);
    }

    if (level === 'medium') {
      if (caps.length > 0) return this.freeEdgeOf(caps[0]);
      if (safe.length > 0) return this.pickRandom(safe);
      return this.smallestSacrifice(free);
    }

    if (safe.length === 0 || free.length <= (SEARCH_FREE_EDGES[this.geom.size] ?? 26)) {
      const searched = this.searchRoot();
      if (searched !== null) return searched;
    }
    return this.expertHeuristic(free, caps, safe);
  }

  private smallestSacrifice(free: number[]): number {
    let best: number[] = [];
    let bestScore = Infinity;
    for (const e of this.shuffle([...free])) {
      const score = this.giveaway(e);
      if (score < bestScore) {
        bestScore = score;
        best = [e];
      } else if (score === bestScore) {
        best.push(e);
      }
    }
    // Prefer the "hard-hearted handout" for 2-chains: the edge between the two boxes.
    const between = best.find((e) => this.geom.edgeBoxes[e * 2 + 1] >= 0);
    return between ?? best[0];
  }

  private expertHeuristic(free: number[], caps: number[], safe: number[]): number {
    if (caps.length > 0) {
      if (safe.length === 0) {
        const dd = this.heuristicDoubleDeal(caps);
        if (dd !== null) return dd;
      }
      return this.freeEdgeOf(caps[0]);
    }
    if (safe.length > 0) {
      // Keep the board open: favour edges next to the emptiest boxes.
      const weight = (e: number) => {
        let w = 0;
        for (let i = 0; i < 2; i++) {
          const b = this.geom.edgeBoxes[e * 2 + i];
          w += b >= 0 ? this.sides[b] : 0;
        }
        return w;
      };
      const min = Math.min(...safe.map(weight));
      return this.pickRandom(safe.filter((e) => weight(e) === min));
    }
    return this.smallestSacrifice(free);
  }

  /** When only two boxes of a chain remain, decline them if the rest of the board is worth it. */
  private heuristicDoubleDeal(caps: number[]): number | null {
    if (caps.length !== 1) return null;
    const a = caps[0];
    const e = this.freeEdgeOf(a);
    const b = this.otherBox(e, a);
    if (b < 0 || this.sides[b] !== 2) return null;
    const f = this.freeEdgeOf(b, e);
    const c = this.otherBox(f, b);
    if (c >= 0 && this.sides[c] >= 2) return null; // not the end of the chain
    return this.remaining - 2 > 4 ? f : null;
  }

  // ---- exact search -------------------------------------------------------

  /**
   * Candidate moves with the classic pruning rules:
   *  - a capturable box whose capture cannot be declined usefully is simply taken;
   *  - otherwise the only alternatives are "capture" or the double-dealing move.
   */
  private generateMoves(): number[] {
    let firstChoice = -1;
    for (let a = 0; a < this.geom.boxCount; a++) {
      if (this.sides[a] !== 3) continue;
      const e = this.freeEdgeOf(a);
      const b = this.otherBox(e, a);
      if (b < 0 || this.sides[b] !== 2) return [e];
      if (firstChoice < 0) firstChoice = a;
    }

    if (firstChoice >= 0) {
      const e = this.freeEdgeOf(firstChoice);
      const b = this.otherBox(e, firstChoice);
      const f = this.freeEdgeOf(b, e);
      const c = this.otherBox(f, b);
      return c >= 0 && this.sides[c] === 3 ? [e] : [e, f];
    }

    const safe: number[] = [];
    const unsafe: number[] = [];
    for (let e = 0; e < this.geom.edgeCount; e++) {
      if (this.drawn[e]) continue;
      (this.isSafe(e) ? safe : unsafe).push(e);
    }
    return safe.concat(unsafe);
  }

  /** Chains/loops decomposition, or null when some box is a junction. */
  private simpleComponents(): { chains: number[]; loops: number[] } | null {
    const { boxCount } = this.geom;
    for (let b = 0; b < boxCount; b++) if (this.sides[b] !== 4 && this.sides[b] !== 2) return null;

    const chains: number[] = [];
    const loops: number[] = [];
    const seen = new Uint8Array(boxCount);
    for (let start = 0; start < boxCount; start++) {
      if (seen[start] || this.sides[start] === 4) continue;
      let count = 0;
      let ground = 0;
      const stack = [start];
      seen[start] = 1;
      while (stack.length > 0) {
        const b = stack.pop()!;
        count++;
        for (let i = 0; i < 4; i++) {
          const e = this.geom.boxEdges[b * 4 + i];
          if (this.drawn[e]) continue;
          const o = this.otherBox(e, b);
          if (o < 0) ground++;
          else if (!seen[o]) {
            seen[o] = 1;
            stack.push(o);
          }
        }
      }
      (ground === 0 ? loops : chains).push(count);
    }
    return { chains, loops };
  }

  /** Net boxes (side to move − opponent) still to be won from this position. */
  negamax(alpha: number, beta: number): number {
    if (this.remaining === 0) return 0;
    if (++this.nodes > this.nodeLimit || ((this.nodes & 1023) === 0 && Date.now() > this.deadline)) throw ABORT;

    const key = (this.hashA >>> 0) * 2097152 + (this.hashB >>> 11);
    const entry = this.tt.get(key);
    if (entry) {
      if (entry.bound === Bound.Exact) return entry.value;
      if (entry.bound === Bound.Lower && entry.value >= beta) return entry.value;
      if (entry.bound === Bound.Upper && entry.value <= alpha) return entry.value;
    }

    const moves = this.generateMoves();
    if (moves.length > 1 && this.sides.every((s) => s !== 3)) {
      const simple = this.simpleComponents();
      if (simple) {
        const v = dpValue(simple.chains.sort((x, y) => x - y), simple.loops.sort((x, y) => x - y));
        this.tt.set(key, { value: v, bound: Bound.Exact });
        return v;
      }
    }

    const alphaOrig = alpha;
    let best = -Infinity;
    for (const m of moves) {
      const captured = this.apply(m);
      let v: number;
      try {
        v = captured > 0 ? captured + this.negamax(alpha - captured, beta - captured) : -this.negamax(-beta, -alpha);
      } finally {
        this.undo(m, captured);
      }
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }

    const bound = best <= alphaOrig ? Bound.Upper : best >= beta ? Bound.Lower : Bound.Exact;
    this.tt.set(key, { value: best, bound });
    return best;
  }

  private searchRoot(): number | null {
    const moves = this.generateMoves();
    if (moves.length === 1) return moves[0];

    // Shuffle within the safe/unsafe groups so equal moves vary between games.
    const safe = this.shuffle(moves.filter((e) => this.isSafe(e)));
    const unsafe = this.shuffle(moves.filter((e) => !this.isSafe(e)));
    const ordered = safe.concat(unsafe);

    try {
      let bestMove = ordered[0];
      let bestValue = -Infinity;
      for (const m of ordered) {
        const captured = this.apply(m);
        let v: number;
        try {
          // Window (bestValue, ∞): we only need to know whether m beats the best so far.
          v = captured > 0
            ? captured + this.negamax(bestValue - captured, Infinity)
            : -this.negamax(-Infinity, -bestValue);
        } finally {
          this.undo(m, captured);
        }
        if (v > bestValue) {
          bestValue = v;
          bestMove = m;
        }
      }
      return bestMove;
    } catch (err) {
      if (err === ABORT) return null;
      throw err;
    }
  }
}
