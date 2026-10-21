/**
 * Pure Dots & Boxes engine (no DOM). Edges and boxes are addressed by index so
 * the AI can search positions quickly with typed arrays.
 *
 * Edge indexing for an N×N board:
 *   - horizontal edges: (N+1) rows × N cols  → index r * N + c
 *   - vertical edges:   N rows × (N+1) cols  → index hCount + r * (N+1) + c
 */
export interface Geometry {
  size: number;
  edgeCount: number;
  boxCount: number;
  hCount: number;
  /** 4 edge indices per box: top, bottom, left, right. */
  boxEdges: Int16Array;
  /** 2 box indices per edge (-1 when the edge is on the border). */
  edgeBoxes: Int16Array;
}

const geometryCache = new Map<number, Geometry>();

export function getGeometry(size: number): Geometry {
  const cached = geometryCache.get(size);
  if (cached) return cached;

  const hCount = (size + 1) * size;
  const edgeCount = hCount + size * (size + 1);
  const boxCount = size * size;
  const boxEdges = new Int16Array(boxCount * 4);
  const edgeBoxes = new Int16Array(edgeCount * 2).fill(-1);

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const b = r * size + c;
      const edges = [
        r * size + c,
        (r + 1) * size + c,
        hCount + r * (size + 1) + c,
        hCount + r * (size + 1) + c + 1
      ];
      edges.forEach((e, i) => {
        boxEdges[b * 4 + i] = e;
        if (edgeBoxes[e * 2] === -1) edgeBoxes[e * 2] = b;
        else edgeBoxes[e * 2 + 1] = b;
      });
    }
  }

  const geom: Geometry = { size, edgeCount, boxCount, hCount, boxEdges, edgeBoxes };
  geometryCache.set(size, geom);
  return geom;
}

export function edgeInfo(geom: Geometry, e: number): { dir: 'h' | 'v'; r: number; c: number } {
  if (e < geom.hCount) return { dir: 'h', r: Math.floor(e / geom.size), c: e % geom.size };
  const k = e - geom.hCount;
  return { dir: 'v', r: Math.floor(k / (geom.size + 1)), c: k % (geom.size + 1) };
}

/** Number of drawn sides of every box. */
export function countSides(geom: Geometry, drawn: Uint8Array): Uint8Array {
  const sides = new Uint8Array(geom.boxCount);
  for (let b = 0; b < geom.boxCount; b++) {
    let n = 0;
    for (let i = 0; i < 4; i++) if (drawn[geom.boxEdges[b * 4 + i]]) n++;
    sides[b] = n;
  }
  return sides;
}

export type Player = 1 | 2;

/** Mutable match state shared by local play, AI and P2P replay. */
export class BoardState {
  readonly geom: Geometry;
  /** 0 = free, otherwise the player who drew it. */
  readonly edgeOwner: Uint8Array;
  /** 0 = free, otherwise the player who closed it. */
  readonly boxOwner: Uint8Array;
  readonly sides: Uint8Array;
  readonly moves: number[] = [];
  currentPlayer: Player;
  scores: Record<Player, number> = { 1: 0, 2: 0 };

  constructor(size: number, starter: Player = 1) {
    this.geom = getGeometry(size);
    this.edgeOwner = new Uint8Array(this.geom.edgeCount);
    this.boxOwner = new Uint8Array(this.geom.boxCount);
    this.sides = new Uint8Array(this.geom.boxCount);
    this.currentPlayer = starter;
  }

  get size(): number {
    return this.geom.size;
  }

  get isOver(): boolean {
    return this.scores[1] + this.scores[2] === this.geom.boxCount;
  }

  isFree(e: number): boolean {
    return e >= 0 && e < this.geom.edgeCount && this.edgeOwner[e] === 0;
  }

  /** Draws an edge for the current player. Returns the boxes it closed. */
  play(e: number): number[] {
    if (!this.isFree(e) || this.isOver) throw new Error(`Coup invalide : ${e}`);
    const player = this.currentPlayer;
    this.edgeOwner[e] = player;
    this.moves.push(e);

    const captured: number[] = [];
    for (let i = 0; i < 2; i++) {
      const b = this.geom.edgeBoxes[e * 2 + i];
      if (b < 0) continue;
      this.sides[b]++;
      if (this.sides[b] === 4) {
        this.boxOwner[b] = player;
        this.scores[player]++;
        captured.push(b);
      }
    }
    if (captured.length === 0) this.currentPlayer = player === 1 ? 2 : 1;
    return captured;
  }

  /** 0/1 view of the drawn edges, as used by the AI. */
  drawnMask(): Uint8Array {
    return this.edgeOwner.map((o) => (o ? 1 : 0));
  }
}
