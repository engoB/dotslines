import type { Player } from '../game/types';

export type PlayKind = 'solo' | 'local' | 'tournament' | 'online';
export type AILevelPref = 'easy' | 'medium' | 'expert';
export type StarterPref = 'alternate' | 'random' | 'me' | 'opponent';

export interface Prefs {
  kind: PlayKind;
  level: AILevelPref;
  size: number;
  sound: boolean;
  starter: StarterPref;
  /** Name shown to the other phones in online games. */
  playerName: string;
}

export interface Record3 {
  w: number;
  l: number;
  d: number;
}

/** Results from the point of view of this device (player 1 for local modes). */
/** 'tournament' counts whole online tournaments (won = champion). */
export type StatsMode = 'ai-easy' | 'ai-medium' | 'ai-expert' | 'pvp' | 'p2p' | 'tournament';
export type Stats = Record<StatsMode, Record3>;

const PREFS_KEY = 'dotslines.prefs.v2';
const STATS_KEY = 'dotslines.stats.v1';
const SIZES = [3, 4, 5];

const DEFAULT_PREFS: Prefs = {
  kind: 'solo',
  level: 'expert',
  size: 4,
  sound: true,
  starter: 'alternate',
  playerName: ''
};

function read<T>(key: string): Partial<T> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '{}');
    return raw && typeof raw === 'object' ? (raw as Partial<T>) : {};
  } catch {
    return {};
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private browsing / quota: settings simply aren't kept */
  }
}

const oneOf = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

export function loadPrefs(): Prefs {
  const raw = read<Prefs>(PREFS_KEY);
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    // An online session cannot survive a reload: come back on solo.
    kind: oneOf(raw.kind, ['solo', 'local', 'tournament'] as const, DEFAULT_PREFS.kind),
    level: oneOf(raw.level, ['easy', 'medium', 'expert'] as const, DEFAULT_PREFS.level),
    size: oneOf(raw.size, SIZES, DEFAULT_PREFS.size),
    sound: bool(raw.sound, DEFAULT_PREFS.sound),
    starter: oneOf(raw.starter, ['alternate', 'random', 'me', 'opponent'] as const, DEFAULT_PREFS.starter),
    playerName: typeof raw.playerName === 'string' ? raw.playerName.slice(0, 14) : ''
  };
}

export function savePrefs(prefs: Prefs): void {
  write(PREFS_KEY, prefs);
}

const emptyStats = (): Stats => ({
  'ai-easy': { w: 0, l: 0, d: 0 },
  'ai-medium': { w: 0, l: 0, d: 0 },
  'ai-expert': { w: 0, l: 0, d: 0 },
  pvp: { w: 0, l: 0, d: 0 },
  p2p: { w: 0, l: 0, d: 0 },
  tournament: { w: 0, l: 0, d: 0 }
});

export function loadStats(): Stats {
  const raw = read<Stats>(STATS_KEY);
  const stats = emptyStats();
  for (const key of Object.keys(stats) as (keyof Stats)[]) {
    const r = raw[key];
    if (!r) continue;
    for (const f of ['w', 'l', 'd'] as const) {
      const n = Number(r[f]);
      stats[key][f] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    }
  }
  return stats;
}

export function recordResult(mode: StatsMode, winner: 0 | Player, localPlayer: Player): Stats {
  const stats = loadStats();
  const r = stats[mode];
  if (winner === 0) r.d++;
  else if (winner === localPlayer) r.w++;
  else r.l++;
  write(STATS_KEY, stats);
  return stats;
}

export function resetStats(): Stats {
  const stats = emptyStats();
  write(STATS_KEY, stats);
  return stats;
}

/** Wins that count for the trophy counter on the home screen (vs AI and online). */
export const trophyCount = (s: Stats): number =>
  s['ai-easy'].w + s['ai-medium'].w + s['ai-expert'].w + s.p2p.w + s.tournament.w;
