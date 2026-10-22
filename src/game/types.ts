import type { Player } from './board';
import type { AILevel } from './ai';

export type { Player };
export type GameMode = 'ai-easy' | 'ai-medium' | 'ai-expert' | 'pvp' | 'p2p' | 'tournament';

export const isAIMode = (mode: GameMode): boolean => mode.startsWith('ai-');

export interface MatchConfig {
  size: number;
  mode: GameMode;
  /** Player who draws the first line. */
  starter: Player;
  /** P2P only: the player controlled on this device (host = 1, guest = 2). */
  localPlayer?: Player;
  /** Players driven by the computer (any side, both for AI-vs-AI tournament matches). */
  ai?: Partial<Record<Player, AILevel>>;
  /** Initials written in captured boxes (default J1 / J2, IA for the computer). */
  labels?: Record<Player, string>;
  /** Seconds allowed per move (0 / undefined = no timer). */
  turnSeconds?: number;
  /** Sides played by a computer elsewhere (tournament host): never timed. */
  untimed?: Player[];
}

export interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rot: number;
  vRot: number;
}

export type SeatKind = 'host' | 'phone' | 'ai' | 'open';

/** A tournament seat as broadcast by the host. */
export interface SeatInfo {
  name: string;
  kind: SeatKind;
}

/** One bracket match as broadcast by the host (moves = live or last board). */
export interface MatchInfo {
  a: number | null;
  b: number | null;
  winner: number | null;
  score: [number, number] | null;
  replays: number;
  starter: Player;
  moves: number[] | null;
}

/** Messages exchanged over the WebRTC data channel. The host is authoritative. */
export type P2PMessage =
  // Duel (2 phones)
  | { type: 'START'; size: number; starter: Player; timer: number }
  | { type: 'MOVE'; edge: number; seq: number }
  | { type: 'SYNC_REQUEST' }
  | { type: 'SYNC'; size: number; starter: Player; moves: number[]; timer: number }
  | { type: 'REMATCH' }
  // Room management
  | { type: 'WELCOME'; kind: 'duel' | 'tournament' }
  | { type: 'FULL' }
  | { type: 'BYE' }
  // Tournament (4 phones)
  | { type: 'NAME'; name: string }
  | { type: 'LOBBY'; size: number; you: number; seats: SeatInfo[]; timer: number }
  | { type: 'T_SYNC'; size: number; you: number; seats: SeatInfo[]; matches: MatchInfo[]; timer: number }
  | { type: 'T_MOVE'; m: number; edge: number; seq: number }
  | { type: 'INFO'; text: string };

const isInt = (v: unknown): v is number => Number.isInteger(v);
const isPlayer = (v: unknown): v is Player => v === 1 || v === 2;
const isSize = (v: unknown): v is number => isInt(v) && v >= 2 && v <= 8;
const isSeat = (v: unknown): v is number => isInt(v) && v >= 0 && v < 4;
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isMoves = (v: unknown): v is number[] => Array.isArray(v) && v.length <= 200 && v.every(isInt);
/** Seconds per move; absent (older app version) means no timer. */
const timerOf = (v: unknown): number => (isInt(v) && v >= 0 && v <= 120 ? v : 0);

function parseSeats(v: unknown): SeatInfo[] | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const seats: SeatInfo[] = [];
  for (const s of v) {
    if (!s || typeof s !== 'object') return null;
    const { name, kind } = s as Record<string, unknown>;
    if (!isText(name, 24) || !['host', 'phone', 'ai', 'open'].includes(kind as string)) return null;
    seats.push({ name, kind: kind as SeatKind });
  }
  return seats;
}

function parseMatches(v: unknown): MatchInfo[] | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out: MatchInfo[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') return null;
    const m = raw as Record<string, unknown>;
    const seatOrNull = (x: unknown) => x === null || isSeat(x);
    const score = m.score;
    const scoreOk = score === null || (Array.isArray(score) && score.length === 2 && score.every(isInt));
    if (!seatOrNull(m.a) || !seatOrNull(m.b) || !seatOrNull(m.winner) || !scoreOk) return null;
    if (!isInt(m.replays) || !isPlayer(m.starter) || !(m.moves === null || isMoves(m.moves))) return null;
    out.push({
      a: m.a as number | null,
      b: m.b as number | null,
      winner: m.winner as number | null,
      score: score as [number, number] | null,
      replays: m.replays,
      starter: m.starter,
      moves: m.moves as number[] | null
    });
  }
  return out;
}

/** Validates untrusted data coming from another phone. */
export function parseP2PMessage(raw: unknown): P2PMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'START':
      return isSize(m.size) && isPlayer(m.starter)
        ? { type: 'START', size: m.size, starter: m.starter, timer: timerOf(m.timer) }
        : null;
    case 'MOVE':
      return isInt(m.edge) && isInt(m.seq) ? { type: 'MOVE', edge: m.edge, seq: m.seq } : null;
    case 'SYNC':
      return isSize(m.size) && isPlayer(m.starter) && isMoves(m.moves)
        ? { type: 'SYNC', size: m.size, starter: m.starter, moves: m.moves, timer: timerOf(m.timer) }
        : null;
    case 'WELCOME':
      return m.kind === 'duel' || m.kind === 'tournament' ? { type: 'WELCOME', kind: m.kind } : null;
    case 'NAME':
      return isText(m.name, 24) ? { type: 'NAME', name: m.name } : null;
    case 'LOBBY': {
      const seats = parseSeats(m.seats);
      return seats && isSize(m.size) && isSeat(m.you)
        ? { type: 'LOBBY', size: m.size, you: m.you, seats, timer: timerOf(m.timer) }
        : null;
    }
    case 'T_SYNC': {
      const seats = parseSeats(m.seats);
      const matches = parseMatches(m.matches);
      return seats && matches && isSize(m.size) && isSeat(m.you)
        ? { type: 'T_SYNC', size: m.size, you: m.you, seats, matches, timer: timerOf(m.timer) }
        : null;
    }
    case 'T_MOVE':
      return isInt(m.m) && m.m >= 0 && m.m < 3 && isInt(m.edge) && isInt(m.seq)
        ? { type: 'T_MOVE', m: m.m, edge: m.edge, seq: m.seq }
        : null;
    case 'INFO':
      return isText(m.text, 160) ? { type: 'INFO', text: m.text } : null;
    case 'SYNC_REQUEST':
    case 'REMATCH':
    case 'FULL':
    case 'BYE':
      return { type: m.type };
    default:
      return null;
  }
}
