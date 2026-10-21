import { describe, expect, it } from 'vitest';
import { Tournament } from '../src/game/Tournament';

const players = ['Ana', 'Bob', 'Cléo', 'Dan'].map((name, i) => ({ name, ai: i === 3 ? ('expert' as const) : null }));

describe('Tournament', () => {
  it('plays two semi-finals then a final between the winners', () => {
    const t = new Tournament(players);
    expect(t.currentIndex).toBe(0);
    expect(t.record(3, 6)).toBe('win'); // Bob wins
    expect(t.currentIndex).toBe(1);
    expect(t.matches[2].a).toBeNull();
    t.record(10, 6); // Cléo wins
    expect(t.matches[2]).toMatchObject({ a: 1, b: 2 });
    expect(t.isOver).toBe(false);
    t.record(4, 5);
    expect(t.isOver).toBe(true);
    expect(t.champion?.name).toBe('Cléo');
    expect(t.currentIndex).toBe(-1);
  });

  it('replays a drawn match', () => {
    const t = new Tournament(players);
    expect(t.record(8, 8)).toBe('draw');
    expect(t.currentIndex).toBe(0);
    expect(t.matches[0].replays).toBe(1);
    t.record(9, 7);
    expect(t.matches[0].winner).toBe(0);
  });

  it('does not share player objects with the caller', () => {
    const t = new Tournament(players);
    t.players[0].name = 'X';
    expect(players[0].name).toBe('Ana');
  });
});
