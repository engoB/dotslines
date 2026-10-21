import '@fontsource/baloo-2/latin-600.css';
import '@fontsource/baloo-2/latin-700.css';
import '@fontsource/baloo-2/latin-800.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/caveat/latin-700.css';
import './style.css';
import { initPWA } from './pwa';
import type { AILevel } from './game/ai';
import { AIClient } from './game/AIClient';
import { DotsAndBoxesGame, type MoveSource } from './game/DotsAndBoxesGame';
import { P2PManager } from './game/P2PManager';
import { ROUND_NAMES } from './game/Tournament';
import { isAIMode, type GameMode, type MatchConfig, type P2PMessage, type Player } from './game/types';
import { TournamentClient } from './online/TournamentClient';
import { cleanName, TournamentHost } from './online/TournamentHost';
import { DemoBoard } from './ui/DemoBoard';
import { hydrateIcons, ICONS } from './ui/icons';
import {
  loadPrefs,
  loadStats,
  recordResult,
  resetStats,
  savePrefs,
  trophyCount,
  type AILevelPref,
  type PlayKind,
  type Prefs,
  type StarterPref,
  type StatsMode
} from './ui/prefs';

/** Public URL used in invite links when the page is not served over http(s) (standalone file). */
const PUBLIC_URL = 'https://engob.github.io/dotslines/';
const LEVEL_NAMES: Record<AILevelPref, string> = { easy: 'Facile', medium: 'Malin', expert: 'Expert' };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
const sizeLabel = (n: number) => `${n} × ${n}`;
const escapeHTML = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** "Joueur 1" → "J1", "Ana" → "An". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] ?? '?';
  return w.slice(0, 1).toUpperCase() + w.slice(1, 2).toLowerCase();
}

hydrateIcons();

const prefs = loadPrefs();
let stats = loadStats();

// ---- toast --------------------------------------------------------------------

const toastEl = $('toast');
let toastTimer: number | undefined;
function toast(message: string, ms = 3200): void {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
}

initPWA([$<HTMLButtonElement>('btn-install'), $<HTMLButtonElement>('btn-install-2')], toast);

// ---- views & sheets -----------------------------------------------------------

type View = 'home' | 'game' | 'bracket';
const views: Record<View, HTMLElement> = { home: $('view-home'), game: $('view-game'), bracket: $('view-bracket') };
const scrim = $('scrim');
const demo = new DemoBoard($<HTMLCanvasElement>('demo-canvas'));
let openPanel: HTMLElement | null = null;
let currentView: View = 'home';

function showView(view: View): void {
  currentView = view;
  for (const [name, el] of Object.entries(views)) el.classList.toggle('hidden', name !== view);
  if (view === 'home') {
    setFullscreen(false);
    refreshHome();
    demo.start();
  } else {
    demo.stop();
  }
  if (view === 'bracket') renderBracket();
}

/** Opens a bottom sheet or the game-over modal (one at a time). */
function openOverlay(id: string): void {
  closeOverlay(true);
  openPanel = $(id);
  openPanel.hidden = false;
  scrim.hidden = false;
  openPanel.querySelector<HTMLElement>('[data-close], .btn')?.focus({ preventScroll: true });
}

/** `switching` = another overlay replaces this one (no "leave the room" side effect). */
function closeOverlay(switching = false): void {
  if (!openPanel) return;
  const closing = openPanel;
  openPanel = null;
  closing.hidden = true;
  scrim.hidden = true;
  if (switching || closing.id !== 'sheet-online') return;
  // Closing the online sheet before a game started leaves the room.
  if (onlineKind === 'tournament' && !tClient.started) leaveTournament();
  else if (!p2p.isConnected) p2p.cleanup();
}

scrim.addEventListener('click', () => {
  if (openPanel?.id !== 'modal-gameover') closeOverlay();
});
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeOverlay()));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openPanel && openPanel.id !== 'modal-gameover') closeOverlay();
});
// iOS only allows audio after a gesture: unlock it on the first touch anywhere.
document.addEventListener('pointerdown', () => game.sfx.unlock(), { once: true });

// ---- game ---------------------------------------------------------------------

const tally: Record<0 | Player, number> = { 0: 0, 1: 0, 2: 0 };
let tallyKey = '';

const game = new DotsAndBoxesGame($<HTMLCanvasElement>('game-canvas'), {
  onUpdate: updateHUD,
  onMove: handleMove,
  onGameOver: showGameOver
});
game.sfx.enabled = prefs.sound;

function currentMode(): GameMode {
  if (prefs.kind === 'solo') return `ai-${prefs.level}` as GameMode;
  if (prefs.kind === 'tournament') return 'tournament';
  return prefs.kind === 'local' ? 'pvp' : 'p2p';
}

/** Tournament match shown on the board (-1: none). */
let shownMatch = -1;

function playerNames(): Record<Player, string> {
  const { mode, localPlayer } = game.config;
  if (mode === 'p2p') return localPlayer === 1 ? { 1: 'Toi', 2: 'Téléphone 2' } : { 1: 'Téléphone 1', 2: 'Toi' };
  if (mode === 'pvp') return { 1: 'Joueur 1', 2: 'Joueur 2' };
  if (mode === 'tournament') {
    const m = tClient.matches[shownMatch];
    return { 1: tClient.name(m?.a ?? null), 2: tClient.name(m?.b ?? null) };
  }
  return { 1: 'Toi', 2: `IA ${LEVEL_NAMES[mode.slice(3) as AILevelPref]}` };
}

/** Is side p played by the computer (here or, in a tournament, on the host)? */
function isAI(p: Player): boolean {
  if (game.config.mode === 'tournament') {
    const m = tClient.matches[shownMatch];
    return tClient.isAI(p === 1 ? m?.a ?? null : m?.b ?? null);
  }
  return !!game.config.ai?.[p];
}

/** "You" wording only when a single human plays on this device against someone else. */
const speaksToYou = (p: Player) => {
  const { mode, localPlayer } = game.config;
  return mode === 'p2p' || mode === 'tournament' ? p === localPlayer : isAIMode(mode) && p === 1;
};

const remoteMode = () => game.config.mode === 'p2p' || game.config.mode === 'tournament';

function turnMessage(): string {
  const p = game.state.currentPlayer;
  const name = playerNames()[p];
  if (speaksToYou(p)) return 'À toi : relie deux points voisins.';
  if (isAI(p)) return `${name} réfléchit…`;
  if (game.config.mode === 'p2p') return "En attente du coup de l'adversaire…";
  return game.config.mode === 'tournament' ? `${name} joue…` : `Au tour de ${name}.`;
}

const messageBar = $('message-bar');
function setMessage(text: string, pop = false): void {
  messageBar.textContent = text;
  if (pop) {
    messageBar.classList.remove('pop');
    void messageBar.offsetWidth;
    messageBar.classList.add('pop');
  }
}

let shownScores: Record<Player, number> = { 1: 0, 2: 0 };
function updateHUD(): void {
  const { state, config } = game;
  const names = playerNames();
  const labels = game.labels;
  const over = state.isOver;

  for (const p of [1, 2] as const) {
    $(`name-p${p}`).textContent = names[p];
    $(`avatar-p${p}`).textContent = labels[p];
    const score = $(`score-p${p}`);
    score.textContent = String(state.scores[p]);
    if (state.scores[p] > shownScores[p]) {
      score.classList.remove('bump');
      void score.offsetWidth;
      score.classList.add('bump');
    }

    const active = !over && state.currentPlayer === p;
    const card = $(`card-p${p}`);
    card.classList.toggle('active', active);
    card.classList.toggle('thinking', active && isAI(p));
    let status = '';
    if (active) {
      if (isAI(p)) status = 'réfléchit';
      else if (remoteMode() && p !== config.localPlayer) status = 'joue…';
      else status = speaksToYou(p) ? 'À toi !' : 'À toi de jouer';
    }
    $(`status-p${p}`).textContent = status;
  }
  shownScores = { ...state.scores };
  $('board-frame').className = `board-frame ${over ? 'over' : `p${state.currentPlayer}`}`;
}

function handleMove(edge: number, source: MoveSource, seq: number, captured: number): void {
  if (source === 'local' && game.config.mode === 'p2p') p2p.send({ type: 'MOVE', edge, seq });
  if (source === 'local' && game.config.mode === 'tournament') sendTournamentMove(edge, seq);
  if (game.isGameOver) return setMessage('Partie terminée !', true);
  if (captured === 0) return setMessage(turnMessage());
  const p = game.state.currentPlayer;
  const boxes = plural(captured, 'carré');
  if (speaksToYou(p)) setMessage(`+${boxes} ! Tu rejoues.`, true);
  else if (game.config.mode === 'p2p') setMessage(`L'adversaire ferme ${boxes} et rejoue.`, true);
  else setMessage(`${playerNames()[p]} ferme ${boxes} et rejoue !`, true);
}

function fillFinalScore(): void {
  const names = playerNames();
  const labels = game.labels;
  for (const p of [1, 2] as const) {
    $(`final-p${p}`).textContent = String(game.state.scores[p]);
    $(`final-name-p${p}`).textContent = names[p];
    $(`final-avatar-p${p}`).textContent = labels[p];
  }
}

function showGameOver(): void {
  if (game.config.mode === 'tournament') return showTournamentResult();
  const { state, config } = game;
  const s1 = state.scores[1];
  const s2 = state.scores[2];
  const winner: 0 | Player = s1 > s2 ? 1 : s2 > s1 ? 2 : 0;
  const local: Player = config.mode === 'p2p' ? config.localPlayer ?? 1 : 1;
  const names = playerNames();
  tally[winner]++;
  stats = recordResult(config.mode as StatsMode, winner, local);

  let title: string;
  let celebrate = false;
  if (winner === 0) title = 'Match nul ! 🤝';
  else if (config.mode === 'pvp') {
    celebrate = true;
    title = `Victoire du Joueur ${winner} ! 🎉`;
  } else {
    celebrate = winner === local;
    title = celebrate ? 'Tu as gagné ! 🎉' : config.mode === 'p2p' ? 'Perdu… revanche ?' : "L'IA l'emporte !";
  }
  if (celebrate) game.sfx.playVictory();

  $('winner-title').textContent = title;
  $('winner-round').classList.add('hidden-el');
  fillFinalScore();
  const played = tally[0] + tally[1] + tally[2];
  $('match-tally').textContent =
    played > 1 ? `Manches : ${names[1]} ${tally[1]} – ${tally[2]} ${names[2]}${tally[0] ? ` · ${plural(tally[0], 'nul')}` : ''}` : '';
  const guest = config.mode === 'p2p' && p2p.role === 'guest';
  $('btn-replay').textContent = guest ? 'Proposer une revanche' : 'Rejouer';
  $('btn-gameover-home').textContent = config.mode === 'p2p' ? 'Quitter' : 'Accueil';
  openOverlay('modal-gameover');
}

function resetTallyIfNeeded(key: string): void {
  if (key === tallyKey) return;
  tallyKey = key;
  tally[0] = tally[1] = tally[2] = 0;
}

/** Applies the "who starts" preference ("me" = player 1). */
let lastStart: { key: string; starter: Player } | null = null;
function pickStarter(key: string, pref: StarterPref = prefs.starter): Player {
  let starter: Player;
  if (pref === 'me') starter = 1;
  else if (pref === 'opponent') starter = 2;
  else if (pref === 'random') starter = Math.random() < 0.5 ? 1 : 2;
  else starter = lastStart?.key === key && lastStart.starter === 1 ? 2 : 1;
  lastStart = { key, starter };
  return starter;
}

function beginMatch(intro?: string): void {
  shownScores = { 1: 0, 2: 0 };
  closeOverlay(true);
  if (touchDevice) setFullscreen(true);
  showView('game');
  setMessage(intro ?? turnMessage(), true);
}

function startLocalMatch(mode: GameMode = currentMode(), size: number = prefs.size): void {
  const key = `${mode}:${size}`;
  resetTallyIfNeeded(key);
  const config: MatchConfig = { size, mode, starter: pickStarter(key) };
  if (isAIMode(mode)) config.ai = { 2: mode.slice(3) as AILevel };
  game.start(config);
  beginMatch();
}

// ---- online: shared ---------------------------------------------------------------

/** What the current room is for. */
let onlineKind: 'duel' | 'tournament' = 'duel';

const hostStatus = $('host-status');
const joinStatus = $('join-status');
const codeText = $('room-code-text');
const qrImg = $<HTMLImageElement>('room-qr');
const shareBtn = $<HTMLButtonElement>('btn-share-link');
const codeInput = $<HTMLInputElement>('input-room-code');
let p2pTab: 'host' | 'join' = 'host';

function setStatus(el: HTMLElement, text: string, kind: 'info' | 'ok' | 'error'): void {
  el.textContent = text;
  el.classList.toggle('ok', kind === 'ok');
  el.classList.toggle('error', kind === 'error');
  // No room on the network: hide the empty code / share, offer a retry instead.
  if (el === hostStatus) $('host-view').classList.toggle('failed', kind === 'error');
}

function inviteUrl(code: string): string {
  const base =
    !__STANDALONE__ && location.protocol.startsWith('http') ? location.origin + location.pathname : PUBLIC_URL;
  return `${base}?room=${code}`;
}

const p2p = new P2PManager({
  onStatus: (text, kind) => setStatus(p2p.role === 'guest' || p2pTab === 'join' ? joinStatus : hostStatus, text, kind),
  onRoomReady: async (code) => {
    codeText.textContent = code;
    shareBtn.disabled = false;
    try {
      const { toDataURL } = await import('qrcode');
      qrImg.src = await toDataURL(inviteUrl(code), {
        margin: 1,
        width: 260,
        color: { dark: '#1f2a44', light: '#ffffff' }
      });
      if (p2p.roomCode === code) qrImg.classList.remove('hidden-el');
    } catch {
      qrImg.classList.add('hidden-el');
    }
  },
  onConnected: (role, peer) => {
    if (location.search.includes('room=')) history.replaceState(null, '', location.pathname);
    if (role === 'guest') return; // wait for the host's WELCOME
    p2p.send({ type: 'WELCOME', kind: onlineKind }, peer);
    if (onlineKind === 'tournament') {
      if (tHost?.addGuest(peer) === null) p2p.send({ type: 'FULL' }, peer);
      return;
    }
    resetTallyIfNeeded(`p2p:${p2p.roomCode}:${Date.now()}`);
    lastStart = null;
    startP2PRound();
  },
  onMessage: (msg, peer) => {
    if (p2p.role === 'host' && onlineKind === 'tournament') return handleHostTournamentMessage(msg, peer);
    if (msg.type === 'WELCOME') return handleWelcome(msg.kind);
    if (onlineKind === 'tournament') return handleTournamentMessage(msg);
    handleP2PMessage(msg);
  },
  onDisconnected: (reason, peer) => {
    if (onlineKind === 'tournament') {
      if (p2p.role === 'host') {
        const seat = tHost?.seatOfPeer(peer) ?? -1;
        if (seat >= 0 && !tHost?.started) toast(`${tHost!.seats[seat].name} a quitté le salon.`);
        tHost?.removeGuest(peer);
        return;
      }
      toast(reason, 4500);
      resetTournamentState();
      prefs.kind = 'tournament';
      closeOverlay(true);
      showView('home');
      return;
    }
    toast(reason, 4500);
    if (game.config.mode !== 'p2p') return;
    closeOverlay(true);
    // Back to the online sheet: the host keeps its room open with the same code.
    prefs.kind = 'online';
    showView('home');
    openOnline(p2p.role === 'host' ? 'host' : 'join');
  }
});

function startHosting(): void {
  $('host-view').classList.remove('failed');
  codeText.textContent = '····';
  qrImg.classList.add('hidden-el');
  shareBtn.disabled = true;
  if (!navigator.onLine) {
    setStatus(hostStatus, 'Le jeu en ligne a besoin d’Internet pour mettre les téléphones en relation.', 'error');
    return;
  }
  if (onlineKind === 'tournament') {
    resetTournamentState();
    void p2p.host(3, 'En attente des joueurs…');
    tHost = new TournamentHost(prefs.playerName, prefs.size, tournamentIO, aiClient);
    tHost.broadcastSync();
  } else {
    void p2p.host(1);
  }
}

function connectToRoom(): void {
  const code = codeInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) {
    setStatus(joinStatus, 'Le code fait 4 caractères (lettres et chiffres).', 'error');
    codeInput.focus();
    return;
  }
  if (!navigator.onLine) {
    setStatus(joinStatus, 'Pas de connexion Internet : impossible de rejoindre un salon.', 'error');
    return;
  }
  resetTournamentState();
  void p2p.join(code);
}

/** Refreshes which parts of the online sheet are visible. */
function renderOnlineSheet(): void {
  const tournament = onlineKind === 'tournament';
  const guestInLobby = tournament && p2p.role === 'guest' && p2p.isConnected;
  $('online-title').textContent = tournament ? 'Tournoi en ligne' : 'Jouer en ligne';
  $('online-tabs').classList.toggle('hidden-el', guestInLobby);
  $('tab-host').classList.toggle('on', p2pTab === 'host');
  $('tab-join').classList.toggle('on', p2pTab === 'join');
  $('host-view').classList.toggle('hidden-el', p2pTab !== 'host' || guestInLobby);
  $('join-view').classList.toggle('hidden-el', p2pTab !== 'join' || guestInLobby);
  $('lobby-view').classList.toggle('hidden-el', !tournament || !(tHost || guestInLobby));
  $('host-size').textContent = sizeLabel(prefs.size);
  if (tournament) renderLobby();
}

function selectOnlineTab(tab: 'host' | 'join'): void {
  p2pTab = tab;
  if (tab === 'host' && p2p.role !== 'host') startHosting();
  if (tab === 'join' && p2p.role === 'host') {
    p2p.cleanup();
    resetTournamentState();
  }
  renderOnlineSheet();
}

function openOnline(tab: 'host' | 'join'): void {
  onlineKind = prefs.kind === 'tournament' ? 'tournament' : 'duel';
  openOverlay('sheet-online');
  selectOnlineTab(tab);
  if (tab === 'join') codeInput.focus({ preventScroll: true });
}

function handleWelcome(kind: 'duel' | 'tournament'): void {
  onlineKind = kind;
  if (kind === 'duel') {
    resetTallyIfNeeded(`p2p:${p2p.roomCode}:${Date.now()}`);
    lastStart = null;
    toast('Connecté ! La partie va commencer…');
    return;
  }
  prefs.kind = 'tournament';
  refreshHome();
  if (prefs.playerName) p2p.send({ type: 'NAME', name: prefs.playerName });
  renderOnlineSheet();
}

$('tab-host').addEventListener('click', () => selectOnlineTab('host'));
$('tab-join').addEventListener('click', () => {
  selectOnlineTab('join');
  codeInput.focus();
});
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connectToRoom();
});
$('btn-connect-peer').addEventListener('click', connectToRoom);
$('btn-retry-host').addEventListener('click', startHosting);

shareBtn.addEventListener('click', async () => {
  if (!p2p.roomCode) return;
  const url = inviteUrl(p2p.roomCode);
  const what = onlineKind === 'tournament' ? 'mon tournoi' : 'ma partie';
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Petits Carrés', text: `Rejoins ${what} avec le code ${p2p.roomCode} !`, url });
      return;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('🔗 Lien copié !');
  } catch {
    toast(url, 6000);
  }
});

window.addEventListener('online', () => {
  if (openPanel?.id === 'sheet-online' && p2pTab === 'host' && !p2p.isActive) startHosting();
});

// ---- online: duel (2 phones) --------------------------------------------------------

function startP2PRound(): void {
  if (p2p.role !== 'host' || !p2p.isConnected) return;
  const starter = pickStarter('p2p', prefs.starter === 'random' ? 'random' : 'alternate');
  game.start({ size: prefs.size, mode: 'p2p', starter, localPlayer: 1 });
  p2p.send({ type: 'START', size: prefs.size, starter });
  beginMatch();
}

function handleP2PMessage(msg: P2PMessage): void {
  switch (msg.type) {
    case 'START':
      if (p2p.role !== 'guest') return;
      game.start({ size: msg.size, mode: 'p2p', starter: msg.starter, localPlayer: 2 });
      beginMatch();
      break;
    case 'MOVE':
      if (game.config.mode !== 'p2p') return;
      if (!game.applyRemoteMove(msg.edge, msg.seq)) {
        // Out of sync: the host's board is the reference.
        if (p2p.role === 'guest') p2p.send({ type: 'SYNC_REQUEST' });
        else sendSync();
      }
      break;
    case 'SYNC_REQUEST':
      if (p2p.role === 'host') sendSync();
      break;
    case 'SYNC':
      if (p2p.role !== 'guest') return;
      game.start({ size: msg.size, mode: 'p2p', starter: msg.starter, localPlayer: 2 }, msg.moves);
      if (!game.isGameOver) beginMatch();
      break;
    case 'REMATCH':
      if (p2p.role !== 'host') return;
      toast("L'autre téléphone lance une nouvelle manche !");
      startP2PRound();
      break;
  }
}

function sendSync(): void {
  if (game.config.mode !== 'p2p') return;
  p2p.send({ type: 'SYNC', size: game.config.size, starter: game.config.starter, moves: [...game.state.moves] });
}

// ---- online: tournament (4 phones) ------------------------------------------------

const aiClient = new AIClient();
let tHost: TournamentHost | null = null;
let tClient = new TournamentClient();
/** Tournament result already counted in the stats. */
let tournamentCounted = false;

const tournamentIO = {
  send: (msg: P2PMessage, to?: string) => p2p.send(msg, to),
  local: (msg: P2PMessage) => handleTournamentMessage(msg),
  info: (text: string) => {
    p2p.send({ type: 'INFO', text });
    toast(text, 4000);
  }
};

function resetTournamentState(): void {
  tHost?.dispose();
  tHost = null;
  tClient = new TournamentClient();
  shownMatch = -1;
  tournamentCounted = false;
}

function leaveTournament(): void {
  if (p2p.isActive) p2p.leave();
  resetTournamentState();
}

function handleHostTournamentMessage(msg: P2PMessage, peer: string): void {
  if (!tHost) return;
  if (msg.type === 'NAME') {
    const seat = tHost.seatOfPeer(peer);
    if (seat >= 0) tHost.rename(seat, msg.name);
  } else if (msg.type === 'T_MOVE') tHost.submitFromPeer(peer, msg.m, msg.edge, msg.seq);
  else if (msg.type === 'SYNC_REQUEST') tHost.syncPeer(peer);
}

function sendTournamentMove(edge: number, seq: number): void {
  const m = shownMatch;
  if (m < 0) return;
  tClient.applyMove(m, edge, seq);
  // A refused move (should not happen) realigns this phone on the host's state.
  if (tHost) {
    if (!tHost.submit(tClient.you, m, edge, seq, 'host')) tHost.broadcastSync();
  } else p2p.send({ type: 'T_MOVE', m, edge, seq });
}

/** Messages from the host (or, on the host phone, from its own TournamentHost). */
function handleTournamentMessage(msg: P2PMessage): void {
  switch (msg.type) {
    case 'LOBBY': {
      const wasStarted = tClient.started;
      tClient.applyLobby(msg);
      shownMatch = -1;
      tournamentCounted = false;
      if (wasStarted) {
        // The host set up another tournament with the same phones.
        showView('home');
        openOverlay('sheet-online');
      }
      if (openPanel?.id === 'sheet-online') renderOnlineSheet();
      break;
    }
    case 'T_SYNC': {
      const first = !tClient.started;
      const started = tClient.applySync(msg);
      if (first) {
        closeOverlay(true);
        showView('bracket');
      }
      onTournamentChanged(started);
      break;
    }
    case 'T_MOVE':
      if (!tClient.applyMove(msg.m, msg.edge, msg.seq)) {
        if (!tHost) p2p.send({ type: 'SYNC_REQUEST' });
        return;
      }
      if (msg.m === shownMatch && !game.applyRemoteMove(msg.edge, msg.seq)) refreshShownMatch();
      if (currentView === 'bracket') renderBracket();
      break;
    case 'INFO':
      toast(msg.text, 4000);
      break;
  }
}

function onTournamentChanged(started: number[]): void {
  const mine = tClient.myLiveMatch;
  if (mine >= 0 && started.includes(mine)) {
    toast(mine === 2 ? 'La finale commence !' : tClient.matches[mine].replays ? 'Égalité : on rejoue !' : 'Ton match commence !');
    enterMatch(mine, false);
  } else if (started.includes(2) && !tClient.stillIn && currentView !== 'home') {
    toast('La finale commence : tu la regardes en direct.');
    enterMatch(2, true);
  } else if (shownMatch >= 0) {
    refreshShownMatch();
  }

  const champion = tClient.championSeat;
  if (champion !== null && !tournamentCounted) {
    tournamentCounted = true;
    stats = recordResult('tournament', champion === tClient.you ? 1 : 2, 1);
  }
  if (currentView === 'bracket') renderBracket();
}

/** Shows match m on the board, as a player when this phone holds a side. */
function enterMatch(m: number, spectate: boolean): void {
  const match = tClient.matches[m];
  if (!match?.board || match.a === null || match.b === null) return;
  shownMatch = m;
  const side = spectate ? null : tClient.sideOf(m);
  const a = tClient.name(match.a);
  const b = tClient.name(match.b);
  game.start(
    { size: tClient.size, mode: 'tournament', starter: match.starter, localPlayer: side ?? undefined, labels: { 1: initials(a), 2: initials(b) } },
    [...match.board.moves]
  );
  beginMatch(`${ROUND_NAMES[m]} : ${a} contre ${b}${side ? '' : ' (en spectateur)'}`);
}

/** Realigns the board with the host's state for the match on screen. */
function refreshShownMatch(): void {
  const match = tClient.matches[shownMatch];
  if (!match?.board || game.config.mode !== 'tournament') return;
  const moves = match.board.moves;
  const same = moves.length === game.state.moves.length && moves.every((e, i) => e === game.state.moves[i]);
  if (same) return;
  game.start({ ...game.config, starter: match.starter }, [...moves]);
}

function showTournamentResult(): void {
  const m = shownMatch;
  const match = tClient.matches[m];
  if (!match) return;
  const { 1: s1, 2: s2 } = game.state.scores;
  const winnerSeat = s1 === s2 ? null : s1 > s2 ? match.a : match.b;
  const winnerName = tClient.name(winnerSeat);
  const meWon = winnerSeat === tClient.you;

  let title: string;
  if (winnerSeat === null) title = 'Égalité ! Le match va être rejoué 🤝';
  else if (m === 2) title = meWon ? '🏆 Tu remportes le tournoi !' : `🏆 ${winnerName} remporte le tournoi !`;
  else title = meWon ? 'Tu es en finale ! 🎉' : `${winnerName} passe en finale !`;
  if (meWon) game.sfx.playVictory();

  $('winner-title').textContent = title;
  $('winner-round').textContent = ROUND_NAMES[m];
  $('winner-round').classList.remove('hidden-el');
  fillFinalScore();
  $('match-tally').textContent =
    winnerSeat === null ? '' : m < 2 && meWon ? "La finale commence dès que l'autre demi-finale est terminée." : '';
  $('btn-gameover-home').textContent = 'Quitter';
  $('btn-replay').textContent = 'Voir le tableau';
  openOverlay('modal-gameover');
}

function renderLobby(): void {
  const host = !!tHost;
  const seats = tClient.seats;
  const list = $('seat-list');
  list.innerHTML = '';
  seats.forEach((s, i) => {
    const editable = host && (s.kind === 'open' || s.kind === 'ai');
    const row = document.createElement(editable ? 'button' : 'div');
    row.className = `seat${i === tClient.you ? ' me' : ''}${s.kind === 'open' ? ' open' : ''}`;
    if (editable) (row as HTMLButtonElement).type = 'button';
    const tag =
      i === tClient.you ? 'Toi' : s.kind === 'host' ? 'Hôte' : s.kind === 'phone' ? 'Téléphone' : s.kind === 'ai' ? 'IA' : host ? '+ IA' : 'Libre';
    const name = s.kind === 'open' ? 'En attente d’un téléphone…' : s.name;
    row.innerHTML = `<span class="num">${i + 1}</span><span class="who">${escapeHTML(name)}</span><span class="tag${
      i === tClient.you ? ' me' : ''
    }">${tag}</span>`;
    if (editable) row.addEventListener('click', () => tHost?.cycleSeat(i));
    list.append(row);
  });

  const open = seats.filter((s) => s.kind === 'open').length;
  $('lobby-host-actions').classList.toggle('hidden-el', !host);
  $('btn-start-tournament').classList.toggle('hidden-el', !host);
  ($('btn-start-tournament') as HTMLButtonElement).disabled = !tHost?.canStart;
  ($('btn-fill-ai') as HTMLButtonElement).disabled = open === 0;
  $('lobby-hint').textContent = host
    ? open
      ? `Encore ${plural(open, 'place')} : partage le code, ou touche une place pour y mettre une IA.`
      : `Tout le monde est là · grille ${sizeLabel(tClient.size)}. C'est parti ?`
    : `Grille ${sizeLabel(tClient.size)} · l'hôte lance le tournoi quand les 4 places sont prises.`;
  const nameInput = $<HTMLInputElement>('my-name');
  if (document.activeElement !== nameInput) nameInput.value = prefs.playerName;
}

let nameTimer: number | undefined;
$<HTMLInputElement>('my-name').addEventListener('input', (e) => {
  const value = (e.target as HTMLInputElement).value;
  window.clearTimeout(nameTimer);
  nameTimer = window.setTimeout(() => {
    setPrefs({ playerName: cleanName(value, '') });
    if (tHost) tHost.rename(tHost.hostSeat, value);
    else if (p2p.isConnected) p2p.send({ type: 'NAME', name: cleanName(value, '') || 'Joueur' });
  }, 350);
});
$('btn-fill-ai').addEventListener('click', () => tHost?.fillWithAI('medium'));
$('btn-shuffle').addEventListener('click', () => tHost?.shuffle());
$('btn-start-tournament').addEventListener('click', () => {
  if (!tHost?.canStart) return;
  p2p.setLocked(true);
  tHost.start();
});

function renderBracket(): void {
  if (!tClient.started) return;
  $('bracket-size').textContent = sizeLabel(tClient.size);
  const you = tClient.you;
  $('bracket-list').innerHTML = tClient.matches
    .map((m, i) => {
      const live = tClient.isLive(i);
      const scores = m.board ? [m.board.scores[1], m.board.scores[2]] : null;
      const side = (seat: number | null, k: 0 | 1) => {
        if (seat === null) return `<div class="match-row tbd"><span class="who">Vainqueur demi-finale ${k + 1}</span></div>`;
        const state = m.winner === null ? '' : m.winner === seat ? 'won' : 'lost';
        const pts = scores && (live || m.winner !== null) ? `<span class="pts">${scores[k]}</span>` : '';
        const tag = seat === you ? '<span class="tag me">Toi</span>' : tClient.isAI(seat) ? '<span class="tag">IA</span>' : '';
        return `<div class="match-row ${state}"><span class="who">${escapeHTML(tClient.name(seat))}</span>${tag}${pts}</div>`;
      };
      let status = 'À venir';
      if (live) status = m.replays ? 'En cours · match rejoué' : 'En cours';
      else if (m.winner !== null) status = 'Terminé';
      else if (m.board?.isOver) status = 'Égalité : nouveau match dans un instant';
      const mine = tClient.sideOf(i) !== null;
      const action = live ? `<button type="button" class="watch-btn${mine ? ' mine' : ''}" data-watch="${i}">${mine ? 'Jouer' : 'Regarder'}</button>` : '';
      const cls = `match-card${i === 2 ? ' final' : ''}${live ? ' current' : ''}`;
      return `<div class="${cls}"><span class="match-tag">${ROUND_NAMES[i]}</span>${side(m.a, 0)}${side(m.b, 1)}
        <div class="match-foot"><span class="match-status${live ? ' live' : ''}">${status}</span>${action}</div></div>`;
    })
    .join('');
  $('bracket-list').querySelectorAll<HTMLButtonElement>('[data-watch]').forEach((b) =>
    b.addEventListener('click', () => {
      const m = Number(b.dataset.watch);
      enterMatch(m, tClient.sideOf(m) === null);
    })
  );

  const champion = tClient.championSeat;
  $('bracket-champion').classList.toggle('hidden-el', champion === null);
  if (champion !== null) {
    const who = champion === you ? 'Tu remportes' : `<span>${escapeHTML(tClient.name(champion))}</span> remporte`;
    $('bracket-champion').innerHTML = `🏆 ${who} le tournoi !`;
  }
  const next = $<HTMLButtonElement>('btn-next-match');
  const mine = tClient.myLiveMatch;
  next.disabled = false;
  if (mine >= 0) {
    $('next-title').textContent = 'Reprendre mon match';
    $('next-sub').textContent = ROUND_NAMES[mine];
  } else if (champion !== null) {
    $('next-title').textContent = tHost ? 'Nouveau tournoi' : 'Tournoi terminé';
    $('next-sub').textContent = tHost ? 'Mêmes téléphones, nouveau tableau' : "L'hôte peut relancer un tournoi";
    next.disabled = !tHost;
  } else if (tClient.isLive(2)) {
    $('next-title').textContent = 'Regarder la finale';
    $('next-sub').textContent = `${tClient.name(tClient.matches[2].a)} contre ${tClient.name(tClient.matches[2].b)}`;
  } else {
    $('next-title').textContent = tClient.stillIn ? 'En attente…' : 'Tu es éliminé·e';
    $('next-sub').textContent = tClient.stillIn ? "La suite démarre dès que l'autre match est terminé" : 'Regarde les autres matchs en direct';
    next.disabled = true;
  }
}

$('btn-next-match').addEventListener('click', () => {
  const mine = tClient.myLiveMatch;
  if (mine >= 0) return enterMatch(mine, false);
  if (tClient.championSeat !== null && tHost) {
    p2p.setLocked(false);
    tHost.reset();
    return;
  }
  if (tClient.isLive(2)) enterMatch(2, true);
});
$('btn-bracket-home').addEventListener('click', () => showView('home'));
$('btn-leave-tournament').addEventListener('click', () => {
  const warn = tHost && tClient.championSeat === null ? ' En tant qu’hôte, cela arrête le tournoi pour tout le monde.' : '';
  if (tClient.championSeat === null && !window.confirm(`Quitter le tournoi ?${warn}`)) return;
  leaveTournament();
  showView('home');
});

// ---- home -----------------------------------------------------------------------

const tiles = document.querySelectorAll<HTMLButtonElement>('.tile');
const levelButtons = document.querySelectorAll<HTMLButtonElement>('#level-select button');
const sizeButtons = document.querySelectorAll<HTMLButtonElement>('#size-select button');

/** Where "Reprendre" leads, if anywhere. */
function resumeTarget(): View | null {
  if (prefs.kind === 'tournament') return tClient.started && p2p.isActive ? 'bracket' : null;
  const mode = game.config.mode;
  if (!game.hasMatchInProgress || mode === 'tournament') return null;
  return mode !== 'p2p' || p2p.isConnected ? 'game' : null;
}

function refreshHome(): void {
  tiles.forEach((t) => {
    const on = t.dataset.kind === prefs.kind;
    t.classList.toggle('on', on);
    t.setAttribute('aria-checked', String(on));
  });
  levelButtons.forEach((b) => b.classList.toggle('on', b.dataset.level === prefs.level));
  sizeButtons.forEach((b) => b.classList.toggle('on', Number(b.dataset.size) === prefs.size));
  $('row-level').classList.toggle('hidden-el', prefs.kind !== 'solo');

  const size = `grille ${sizeLabel(prefs.size)}`;
  const titles: Record<PlayKind, [string, string]> = {
    solo: ['Jouer', `IA ${LEVEL_NAMES[prefs.level]} · ${size}`],
    local: ['Jouer', `À deux sur cet écran · ${size}`],
    tournament: ['Créer le tournoi', `4 téléphones (ou IA) · ${size}`],
    online: ['Créer un salon', `2 téléphones · ${size}`]
  };
  [$('play-title').textContent, $('play-sub').textContent] = titles[prefs.kind];
  $('btn-join-code').classList.toggle('hidden-el', prefs.kind !== 'online' && prefs.kind !== 'tournament');

  const target = resumeTarget();
  $('btn-resume').classList.toggle('hidden-el', !target);
  $('resume-label').textContent = target === 'bracket' ? 'Reprendre le tournoi' : 'Reprendre la partie';
  $('trophy-count').textContent = String(trophyCount(stats));
}

function setPrefs(patch: Partial<Prefs>): void {
  Object.assign(prefs, patch);
  savePrefs(prefs);
  refreshHome();
}

tiles.forEach((t) => t.addEventListener('click', () => setPrefs({ kind: t.dataset.kind as PlayKind })));
levelButtons.forEach((b) => b.addEventListener('click', () => setPrefs({ level: b.dataset.level as AILevelPref })));
sizeButtons.forEach((b) =>
  b.addEventListener('click', () => {
    setPrefs({ size: Number(b.dataset.size) });
    tHost?.setSize(prefs.size);
  })
);

$('btn-play').addEventListener('click', () => {
  if (prefs.kind === 'online' || prefs.kind === 'tournament') openOnline('host');
  else startLocalMatch();
});
$('btn-join-code').addEventListener('click', () => openOnline('join'));
$('btn-resume').addEventListener('click', () => {
  const target = resumeTarget();
  if (target) showView(target);
});
$('btn-trophies').addEventListener('click', () => openStats());
document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) =>
  b.addEventListener('click', () => {
    const which = b.dataset.open;
    if (which === 'stats') openStats();
    else if (which === 'settings') openSettings();
    else openOverlay('sheet-rules');
  })
);

// ---- sound / settings / stats -------------------------------------------------

const soundBtn = $('btn-sound');
const soundSwitches = [$<HTMLInputElement>('set-sound'), $<HTMLInputElement>('set-sound-2')];

function setSound(on: boolean): void {
  game.sfx.enabled = on;
  prefs.sound = on;
  savePrefs(prefs);
  soundBtn.innerHTML = on ? ICONS.sound : ICONS.mute;
  soundBtn.setAttribute('aria-label', on ? 'Son activé' : 'Son coupé');
  soundSwitches.forEach((s) => (s.checked = on));
  if (on) game.sfx.unlock();
}

soundBtn.addEventListener('click', () => setSound(!prefs.sound));
soundSwitches.forEach((s) => s.addEventListener('change', () => setSound(s.checked)));

const starterButtons = document.querySelectorAll<HTMLButtonElement>('#starter-select button');

function openSettings(): void {
  starterButtons.forEach((b) => b.classList.toggle('on', b.dataset.starter === prefs.starter));
  openOverlay('sheet-settings');
}

starterButtons.forEach((b) =>
  b.addEventListener('click', () => {
    setPrefs({ starter: b.dataset.starter as StarterPref });
    starterButtons.forEach((x) => x.classList.toggle('on', x === b));
  })
);
$('btn-reset-stats').addEventListener('click', () => {
  if (!window.confirm('Effacer toutes les statistiques ?')) return;
  stats = resetStats();
  refreshHome();
  toast('Statistiques effacées');
});
$('app-version').textContent = `Petits Carrés v${__APP_VERSION__}${__STANDALONE__ ? ' · version 1 fichier' : ''}`;

function openStats(): void {
  const row = (label: string, detail: string, ratio: number | null) =>
    `<div class="stat-row"><b>${label}</b><span>${detail}</span>${
      ratio === null ? '' : `<div class="stat-bar"><i style="width:${Math.round(ratio * 100)}%"></i></div>`
    }</div>`;
  const vs = (key: 'ai-easy' | 'ai-medium' | 'ai-expert' | 'p2p', label: string) => {
    const r = stats[key];
    const total = r.w + r.l + r.d;
    const detail = total ? `${plural(r.w, 'victoire')} · ${r.l} déf. · ${r.d} nul${r.d > 1 ? 's' : ''}` : 'aucune partie';
    return row(label, detail, total ? r.w / total : 0);
  };
  const duo = stats.pvp;
  const duoTotal = duo.w + duo.l + duo.d;
  const tour = stats.tournament;
  const tourTotal = tour.w + tour.l;
  $('stats-list').innerHTML = [
    vs('ai-easy', 'IA Facile'),
    vs('ai-medium', 'IA Malin'),
    vs('ai-expert', 'IA Expert'),
    vs('p2p', 'En ligne (duel)'),
    row('Tournois', tourTotal ? `${plural(tour.w, 'gagné')} sur ${tourTotal}` : 'aucun tournoi', tourTotal ? tour.w / tourTotal : 0),
    row('À deux', duoTotal ? `J1 ${duo.w} – ${duo.l} J2 · ${duo.d} nul${duo.d > 1 ? 's' : ''}` : 'aucune partie', null)
  ].join('');
  openOverlay('sheet-stats');
}

// ---- full screen ----------------------------------------------------------------

/** Phones go full screen with each game (where the browser allows it; installed apps already are). */
const fsSupported = !!document.fullscreenEnabled;
const touchDevice = window.matchMedia?.('(pointer: coarse)').matches ?? false;
const fsBtn = $('btn-fullscreen');
fsBtn.classList.toggle('hidden-el', !fsSupported);

function setFullscreen(on: boolean): void {
  if (!fsSupported || on === !!document.fullscreenElement) return;
  if (on) void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  else void document.exitFullscreen().catch(() => {});
}

fsBtn.addEventListener('click', () => {
  setFullscreen(!document.fullscreenElement);
  closeOverlay();
});
document.addEventListener('fullscreenchange', () => {
  const on = !!document.fullscreenElement;
  $('fs-icon').innerHTML = on ? ICONS.compress : ICONS.expand;
  $('fs-label').textContent = on ? 'Quitter le plein écran' : 'Plein écran';
});

// ---- pause & game over ------------------------------------------------------------

$('btn-pause').addEventListener('click', () => {
  const { mode, size } = game.config;
  let label: string;
  if (mode === 'tournament') label = `Tournoi · ${ROUND_NAMES[Math.max(0, shownMatch)]}`;
  else if (mode === 'p2p') label = `En ligne · salon ${p2p.roomCode}`;
  else label = isAIMode(mode) ? playerNames()[2] : 'À deux';
  $('pause-info').textContent = `${label} · grille ${sizeLabel(size)}`;
  $('restart-label').textContent =
    mode === 'p2p' ? (p2p.role === 'guest' ? 'Proposer une nouvelle manche' : 'Nouvelle manche') : mode === 'tournament' ? 'Tableau du tournoi' : 'Recommencer';
  $('home-label').textContent = mode === 'p2p' ? 'Quitter le salon' : mode === 'tournament' ? 'Quitter le tournoi' : 'Accueil';
  soundSwitches[1].checked = prefs.sound;
  openOverlay('sheet-pause');
});

$('btn-pause-resume').addEventListener('click', () => closeOverlay());

function replay(): void {
  const { mode, size } = game.config;
  if (mode === 'tournament') {
    closeOverlay();
    return showView('bracket');
  }
  if (mode !== 'p2p') return startLocalMatch(mode, size);
  if (!p2p.isConnected) return leaveToHome();
  if (p2p.role === 'host') startP2PRound();
  else {
    p2p.send({ type: 'REMATCH' });
    closeOverlay();
    toast('Demande envoyée au Téléphone 1…');
  }
}

function leaveToHome(): void {
  closeOverlay();
  if (game.config.mode === 'tournament') {
    const warn = tHost && tClient.championSeat === null ? ' En tant qu’hôte, cela arrête le tournoi pour tout le monde.' : '';
    if (tClient.championSeat === null && !window.confirm(`Quitter le tournoi ?${warn}`)) return;
    leaveTournament();
  } else if (game.config.mode === 'p2p' && p2p.isActive) {
    p2p.leave();
  }
  showView('home');
}

$('btn-pause-restart').addEventListener('click', replay);
$('btn-pause-home').addEventListener('click', leaveToHome);
$('btn-replay').addEventListener('click', replay);
$('btn-gameover-home').addEventListener('click', leaveToHome);

// ---- boot -------------------------------------------------------------------------

setSound(prefs.sound);
game.start({ size: prefs.size, mode: 'pvp', starter: 1 });
showView('home');

const roomParam = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
if (/^[A-Z0-9]{4}$/.test(roomParam)) {
  prefs.kind = 'online';
  refreshHome();
  openOnline('join');
  codeInput.value = roomParam;
  connectToRoom();
}
