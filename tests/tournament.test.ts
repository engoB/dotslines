import { describe, expect, it } from 'vitest';
import { Tournament } from '../src/game/Tournament';

const players = ['Ana', 'Bob', 'Cléo', 'Dan'].map((name, i) => ({ name, ai: i === 3 ? ('expert' as const) : null }));

describe('Tournament', () => {
  it('plays both semi-finals (in any order) then a final between the winners', () => {
    const t = new Tournament(players);
    expect(t.playable).toEqual([0, 1]);
    expect(t.record(1, 10, 6)).toBe('win'); // Cléo wins semi 2 first
    expect(t.playable).toEqual([0]);
    expect(t.matches[2].a).toBeNull();
    t.record(0, 3, 6); // Bob wins semi 1
    expect(t.matches[2]).toMatchObject({ a: 1, b: 2 });
    expect(t.playable).toEqual([2]);
    t.record(2, 4, 5);
    expect(t.isOver).toBe(true);
    expect(t.champion?.name).toBe('Cléo');
    expect(t.playable).toEqual([]);
  });

  it('replays a drawn match', () => {
    const t = new Tournament(players);
    expect(t.record(0, 8, 8)).toBe('draw');
    expect(t.playable).toEqual([0, 1]);
    expect(t.matches[0].replays).toBe(1);
    t.record(0, 9, 7);
    expect(t.matches[0].winner).toBe(0);
  });

  it('refuses results for finished or unknown matches', () => {
    const t = new Tournament(players);
    expect(() => t.record(2, 1, 0)).toThrow();
    t.record(0, 5, 4);
    expect(() => t.record(0, 5, 4)).toThrow();
  });

  it('does not share player objects with the caller', () => {
    const t = new Tournament(players);
    t.players[0].name = 'X';
    expect(players[0].name).toBe('Ana');
  });
});
