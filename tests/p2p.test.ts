import { describe, expect, it } from 'vitest';
import { parseP2PMessage } from '../src/game/types';

describe('P2P message validation', () => {
  it('accepts well-formed messages', () => {
    expect(parseP2PMessage({ type: 'START', size: 4, starter: 2 })).toEqual({ type: 'START', size: 4, starter: 2 });
    expect(parseP2PMessage({ type: 'MOVE', edge: 7, seq: 0 })).toEqual({ type: 'MOVE', edge: 7, seq: 0 });
    expect(parseP2PMessage({ type: 'SYNC', size: 3, starter: 1, moves: [1, 2] })).toEqual({
      type: 'SYNC', size: 3, starter: 1, moves: [1, 2]
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
