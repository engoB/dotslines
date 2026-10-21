import type { Player } from './board';

export type { Player };
export type GameMode = 'ai-easy' | 'ai-medium' | 'ai-expert' | 'pvp' | 'p2p';

export const isAIMode = (mode: GameMode): boolean => mode.startsWith('ai-');

export interface MatchConfig {
  size: number;
  mode: GameMode;
  /** Player who draws the first line. */
  starter: Player;
  /** P2P only: the player controlled on this device (host = 1, guest = 2). */
  localPlayer?: Player;
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

/** Messages exchanged over the WebRTC data channel. The host is authoritative. */
export type P2PMessage =
  | { type: 'START'; size: number; starter: Player }
  | { type: 'MOVE'; edge: number; seq: number }
  | { type: 'SYNC_REQUEST' }
  | { type: 'SYNC'; size: number; starter: Player; moves: number[] }
  | { type: 'REMATCH' }
  | { type: 'FULL' }
  | { type: 'BYE' };

const isInt = (v: unknown): v is number => Number.isInteger(v);
const isPlayer = (v: unknown): v is Player => v === 1 || v === 2;
const isSize = (v: unknown): v is number => isInt(v) && v >= 2 && v <= 8;

/** Validates untrusted data coming from the other phone. */
export function parseP2PMessage(raw: unknown): P2PMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'START':
      return isSize(m.size) && isPlayer(m.starter) ? { type: 'START', size: m.size, starter: m.starter } : null;
    case 'MOVE':
      return isInt(m.edge) && isInt(m.seq) ? { type: 'MOVE', edge: m.edge, seq: m.seq } : null;
    case 'SYNC':
      return isSize(m.size) && isPlayer(m.starter) && Array.isArray(m.moves) && m.moves.every(isInt)
        ? { type: 'SYNC', size: m.size, starter: m.starter, moves: m.moves as number[] }
        : null;
    case 'SYNC_REQUEST':
    case 'REMATCH':
    case 'FULL':
    case 'BYE':
      return { type: m.type };
    default:
      return null;
  }
}
