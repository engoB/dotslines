import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseMove } from '../src/game/ai';
import { getGeometry } from '../src/game/board';
import { parseP2PMessage, type P2PMessage } from '../src/game/types';
import { NEXT_MATCH_DELAY_MS, TournamentHost } from '../src/online/TournamentHost';
import { TournamentClient } from '../src/online/TournamentClient';

/** One host phone + guest phones wired through JSON (like the data channel). */
function setup(size = 3) {
  const clients: Record<string, TournamentClient> = { host: new TournamentClient() };
  const inbox: Record<string, P2PMessage[]> = { host: [] };
  const deliver = (who: string, msg: P2PMessage) => {
    const parsed = parseP2PMessage(JSON.parse(JSON.stringify(msg)));
    expect(parsed).not.toBeNull();
    inbox[who].push(parsed!);
    const c = clients[who];
    if (parsed!.type === 'LOBBY') c.applyLobby(parsed!);
    else if (parsed!.type === 'T_SYNC') c.applySync(parsed!);
    else if (parsed!.type === 'T_MOVE') expect(c.applyMove(parsed!.m, parsed!.edge, parsed!.seq)).toBe(true);
  };
  const infos: string[] = [];
  const host = new TournamentHost('Ana', size, {
    send: (msg, to) => deliver(to!, msg),
    local: (msg) => deliver('host', msg),
    info: (text) => infos.push(text)
  }, {
    request: async (sz, drawn, level) => chooseMove(getGeometry(sz), drawn, level, { random: () => 0.3 })
  });
  const join = (peer: string) => {
    clients[peer] = new TournamentClient();
    inbox[peer] = [];
    return host.addGuest(peer);
  };
  return { host, clients, inbox, join, infos };
}

/** A human phone plays the first legal move of its live match, as its UI would. */
function playHuman(host: TournamentHost, client: TournamentClient, peer: string): boolean {
  const m = client.myLiveMatch;
  if (m < 0) return false;
  const board = client.matches[m].board!;
  if (board.currentPlayer !== client.sideOf(m)) return false;
  const edge = [...Array(board.geom.edgeCount).keys()].find((e) => board.isFree(e))!;
  const seq = board.moves.length;
  expect(client.applyMove(m, edge, seq)).toBe(true); // optimistic local move
  if (peer === 'host') expect(host.submit(client.you, m, edge, seq, 'host')).toBe(true);
  else host.submitFromPeer(peer, m, edge, seq);
  return true;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('online tournament', () => {
  it('runs a full tournament with 3 phones and an AI, every phone staying in sync', async () => {
    const { host, clients, join } = setup();
    expect(join('bob')).toBe(1);
    expect(join('cleo')).toBe(2);
    expect(host.canStart).toBe(false);
    host.cycleSeat(3); // IA Facile
    host.cycleSeat(3); // IA Malin
    host.rename(1, '  Bob   le   bricoleur ');
    expect(clients.cleo.seats.map((s) => s.name)).toEqual(['Ana', 'Bob le bricole', 'Joueur 3', 'IA Malin']);
    expect(clients.bob.you).toBe(1);
    expect(host.start()).toBe(true);
    expect(join('late')).toBeNull();
    delete clients.late; // refused: receives nothing

    for (let guard = 0; guard < 2000 && !host.tournament!.isOver; guard++) {
      let moved = false;
      for (const peer of ['host', 'bob', 'cleo']) moved = playHuman(host, clients[peer], peer) || moved;
      await vi.advanceTimersByTimeAsync(moved ? 0 : 600);
      if (!moved) await vi.advanceTimersByTimeAsync(NEXT_MATCH_DELAY_MS);
    }

    const t = host.tournament!;
    expect(t.isOver).toBe(true);
    for (const c of Object.values(clients)) {
      expect(c.championSeat).toBe(t.matches[2].winner);
      c.matches.forEach((m, i) => {
        expect(m.winner).toBe(t.matches[i].winner);
        expect(m.board!.isOver).toBe(true);
      });
    }
  });

  it('rejects moves out of turn, from the wrong seat or out of sequence', () => {
    const { host, clients, join, inbox } = setup();
    join('bob');
    join('cleo');
    host.fillWithAI('easy');
    host.start();
    const board = clients.bob.matches[0].board!;
    const notBobsTurn = board.currentPlayer !== 2;
    const before = inbox.bob.length;
    // Cléo (seat 2) does not play in semi-final 1.
    host.submitFromPeer('cleo', 0, 0, 0);
    expect(host.matchInfo()[0].moves).toEqual([]);
    // Wrong sequence number from Bob → no move, a resync instead.
    host.submitFromPeer('bob', 0, 0, 5);
    expect(host.matchInfo()[0].moves).toEqual([]);
    expect(inbox.bob.length).toBe(before + 1);
    expect(inbox.bob.at(-1)!.type).toBe('T_SYNC');
    if (notBobsTurn) {
      host.submitFromPeer('bob', 0, 0, 0);
      expect(host.matchInfo()[0].moves).toEqual([]);
    }
  });

  it('replaces a phone that leaves mid-tournament with an AI', async () => {
    const { host, clients, join, infos } = setup();
    join('bob');
    join('cleo');
    join('dan');
    host.start();
    host.removeGuest('bob');
    expect(host.seats[1].kind).toBe('ai');
    expect(clients.cleo.seats[1]).toEqual({ name: 'Joueur 2', kind: 'ai' });
    expect(infos[0]).toContain('Joueur 2');
    // Before the start, leaving just frees the seat.
    const lobby = setup();
    lobby.join('x');
    lobby.host.removeGuest('x');
    expect(lobby.host.seats[1].kind).toBe('open');
  });

  it('goes back to the lobby for another tournament', () => {
    const { host, clients, join } = setup();
    join('bob');
    host.fillWithAI();
    host.start();
    host.reset();
    expect(host.started).toBe(false);
    expect(clients.bob.started).toBe(false);
    expect(host.start()).toBe(true);
  });
});
