import { describe, expect, it } from 'vitest';
import { parseP2PMessage } from '../src/game/types';

describe('P2P message validation', () => {
  it('accepts well-formed messages', () => {
    expect(parseP2PMessage({ type: 'START', size: 4, starter: 2, timer: 10 })).toEqual({ type: 'START', size: 4, starter: 2, timer: 10 });
    // Older app versions send no timer: it defaults to off.
    expect(parseP2PMessage({ type: 'START', size: 4, starter: 2 })).toEqual({ type: 'START', size: 4, starter: 2, timer: 0 });
    expect(parseP2PMessage({ type: 'MOVE', edge: 7, seq: 0 })).toEqual({ type: 'MOVE', edge: 7, seq: 0 });
    expect(parseP2PMessage({ type: 'SYNC', size: 3, starter: 1, moves: [1, 2], timer: 5 })).toEqual({
      type: 'SYNC', size: 3, starter: 1, moves: [1, 2], timer: 5
    });
    expect(parseP2PMessage({ type: 'BYE', extra: 'ignored' })).toEqual({ type: 'BYE' });
  });

  it('rejects malformed or hostile data', () => {
    expect(parseP2PMessage(null)).toBeNull();
    expect(parseP2PMessage('MOVE')).toBeNull();
    expect(parseP2PMessage({ type: 'MOVE', edge: '3', seq: 0 })).toBeNull();
    expect(parseP2PMessage({ type: 'START', size: 1000, starter: 1 })).toBeNull();
    expect(parseP2PMessage({ type: 'START', size: 4, starter: 3 })).toBeNull();
    expect(parseP2PMessage({ type: 'SYNC', size: 4, starter: 1, moves: [1.5] })).toBeNull();
    expect(parseP2PMessage({ type: 'HACK' })).toBeNull();
  });
});

describe('tournament messages', () => {
  const seats = [
    { name: 'Ana', kind: 'host' },
    { name: 'Bob', kind: 'phone' },
    { name: 'IA Malin', kind: 'ai' },
    { name: '', kind: 'open' }
  ];
  const match = { a: 0, b: 1, winner: null, score: null, replays: 0, starter: 1, moves: [3, 4] };
  const tbd = { a: null, b: null, winner: null, score: null, replays: 0, starter: 2, moves: null };

  it('accepts a full tournament sync', () => {
    const msg = { type: 'T_SYNC', size: 4, you: 1, seats, matches: [match, { ...match, a: 2, b: 3 }, tbd], timer: 20 };
    expect(parseP2PMessage(msg)).toEqual(msg);
    expect(parseP2PMessage({ type: 'T_MOVE', m: 2, edge: 5, seq: 0 })).toEqual({ type: 'T_MOVE', m: 2, edge: 5, seq: 0 });
  });

  it('rejects malformed tournament data', () => {
    expect(parseP2PMessage({ type: 'LOBBY', size: 4, you: 7, seats })).toBeNull();
    expect(parseP2PMessage({ type: 'LOBBY', size: 4, you: 0, seats: seats.slice(0, 3) })).toBeNull();
    expect(parseP2PMessage({ type: 'LOBBY', size: 4, you: 0, seats: [...seats.slice(0, 3), { name: 'x', kind: 'root' }] })).toBeNull();
    expect(parseP2PMessage({ type: 'T_MOVE', m: 3, edge: 5, seq: 0 })).toBeNull();
    expect(parseP2PMessage({ type: 'NAME', name: 'x'.repeat(200) })).toBeNull();
    // A silly timer value is ignored (no timer) rather than trusted.
    expect(parseP2PMessage({ type: 'LOBBY', size: 4, you: 0, seats, timer: 1e9 })).toMatchObject({ timer: 0 });
    expect(parseP2PMessage({ type: 'T_SYNC', size: 4, you: 0, seats, matches: [match, match] })).toBeNull();
  });
});
