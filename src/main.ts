import '@fontsource/caveat/latin-700.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import './style.css';
import { initPWA } from './pwa';
import { DotsAndBoxesGame } from './game/DotsAndBoxesGame';
import { P2PManager } from './game/P2PManager';
import { isAIMode, type GameMode, type P2PMessage, type Player } from './game/types';

/** Public URL used in invite links when the page is not served over http(s) (standalone file). */
const PUBLIC_URL = 'https://engob.github.io/dotslines/';
const SETTINGS_KEY = 'dotslines.settings.v1';
const MODES: GameMode[] = ['ai-easy', 'ai-medium', 'ai-expert', 'pvp', 'p2p'];
const SIZES = [3, 4, 5];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- settings -------------------------------------------------------------

interface Settings {
  mode: GameMode;
  size: number;
  sound: boolean;
}

function loadSettings(): Settings {
  const defaults: Settings = { mode: 'ai-expert', size: 4, sound: true };
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as Partial<Settings>;
    return {
      // A P2P session cannot be resumed after a reload: fall back to the default mode.
      mode: raw.mode && MODES.includes(raw.mode) && raw.mode !== 'p2p' ? raw.mode : defaults.mode,
      size: raw.size && SIZES.includes(raw.size) ? raw.size : defaults.size,
      sound: typeof raw.sound === 'boolean' ? raw.sound : defaults.sound
    };
  } catch {
    return defaults;
  }
}

const settings = loadSettings();
const saveSettings = () => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* private mode: ignore */
  }
};

// ---- toast ----------------------------------------------------------------

const toastEl = $('toast');
let toastTimer: number | undefined;
function toast(message: string, ms = 3200): void {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
}

initPWA($<HTMLButtonElement>('btn-install'), toast);

// ---- screens --------------------------------------------------------------

const startScreen = $('screen-start');
const gameOverScreen = $('screen-gameover');

function showScreen(screen: 'start' | 'gameover' | null): void {
  startScreen.classList.toggle('hidden', screen !== 'start');
  gameOverScreen.classList.toggle('hidden', screen !== 'gameover');
  if (screen === 'start') refreshMenu();
}

// ---- game -----------------------------------------------------------------

const tally: Record<0 | Player, number> = { 0: 0, 1: 0, 2: 0 };
let tallyKey = '';

const game = new DotsAndBoxesGame($<HTMLCanvasElement>('game-canvas'), {
  onUpdate: updateHUD,
  onMove: (edge, source, seq) => {
    if (game.config.mode === 'p2p' && source === 'local') p2p.send({ type: 'MOVE', edge, seq });
  },
  onGameOver: showGameOver
});
game.sfx.enabled = settings.sound;

function playerNames(): Record<Player, string> {
  const { mode, localPlayer } = game.config;
  if (mode === 'p2p') {
    return localPlayer === 1 ? { 1: 'Toi', 2: 'Téléphone 2' } : { 1: 'Téléphone 1', 2: 'Toi' };
  }
  if (mode === 'pvp') return { 1: 'Joueur 1', 2: 'Joueur 2' };
  const ai: Record<string, string> = { 'ai-easy': 'IA Facile', 'ai-medium': 'IA Malin', 'ai-expert': 'IA Expert 👑' };
  return { 1: 'Toi', 2: ai[mode] };
}

function updateHUD(): void {
  const { state, config } = game;
  const names = playerNames();
  const labels = game.labels;
  $('score-p1').textContent = String(state.scores[1]);
  $('score-p2').textContent = String(state.scores[2]);
  $('name-p1').textContent = names[1];
  $('name-p2').textContent = names[2];
  $('badge-p1').textContent = labels[1];
  $('badge-p2').textContent = labels[2];

  const over = state.isOver;
  $('card-p1').classList.toggle('active', !over && state.currentPlayer === 1);
  $('card-p2').classList.toggle('active', !over && state.currentPlayer === 2);

  const turn = $('turn-badge');
  let text: string;
  let thinking = false;
  if (over) text = 'Partie finie !';
  else if (config.mode === 'p2p') text = state.currentPlayer === config.localPlayer ? '✏️ À ton tour !' : '⏳ Tour adverse';
  else if (config.mode === 'pvp') text = `Tour : Joueur ${state.currentPlayer}`;
  else if (state.currentPlayer === 1) text = '✏️ À ton tour !';
  else {
    text = "L'IA réfléchit";
    thinking = true;
  }
  turn.textContent = text;
  turn.classList.toggle('thinking', thinking);
}

function showGameOver(): void {
  const { state, config } = game;
  const s1 = state.scores[1];
  const s2 = state.scores[2];
  const winner: 0 | Player = s1 > s2 ? 1 : s2 > s1 ? 2 : 0;
  const names = playerNames();
  tally[winner]++;

  let title: string;
  let localWin = false;
  if (winner === 0) title = 'Match nul parfait ! 🤝';
  else if (config.mode === 'p2p') {
    localWin = winner === config.localPlayer;
    title = localWin ? 'Tu as gagné ! 🎉' : 'Perdu… revanche ? ✏️';
  } else if (config.mode === 'pvp') {
    localWin = true;
    title = `Victoire du Joueur ${winner} ! 🎉`;
  } else {
    localWin = winner === 1;
    title = localWin ? 'Bravo, tu as gagné ! 🎉' : "L'IA remporte la manche ! 🤖";
  }
  if (localWin) game.sfx.playVictory();

  $('winner-title').textContent = title;
  $('winner-subtitle').textContent = `Score final : ${s1} à ${s2}`;
  const played = tally[0] + tally[1] + tally[2];
  $('match-tally').textContent =
    played > 1
      ? `Manches — ${names[1]} : ${tally[1]} · ${names[2]} : ${tally[2]}${tally[0] ? ` · nuls : ${tally[0]}` : ''}`
      : '';
  $('btn-replay').textContent =
    config.mode === 'p2p' && p2p.role === 'guest' ? '🔄 Proposer une revanche' : '🔄 Rejouer';
  showScreen('gameover');
}

function resetTallyIfNeeded(key: string): void {
  if (key === tallyKey) return;
  tallyKey = key;
  tally[0] = tally[1] = tally[2] = 0;
}

/** Whoever started last time lets the other one begin. */
let lastStart: { key: string; starter: Player } | null = null;
function nextStarter(key: string): Player {
  const starter: Player = lastStart?.key === key && lastStart.starter === 1 ? 2 : 1;
  lastStart = { key, starter };
  return starter;
}

function startLocalMatch(mode: GameMode = settings.mode, size: number = settings.size): void {
  const key = `${mode}:${size}`;
  resetTallyIfNeeded(key);
  game.start({ size, mode, starter: nextStarter(key) });
  showScreen(null);
}

// ---- P2P --------------------------------------------------------------------

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
        width: 240,
        color: { dark: '#2c2623', light: '#ffffff' }
      });
      if (p2p.roomCode === code) qrImg.classList.remove('hidden-el');
    } catch {
      qrImg.classList.add('hidden-el');
    }
  },
  onConnected: (role) => {
    resetTallyIfNeeded(`p2p:${p2p.roomCode}:${Date.now()}`);
    lastStart = null;
    $('connected-status').textContent = `🟢 Connecté au salon ${p2p.roomCode}`;
    if (location.search.includes('room=')) history.replaceState(null, '', location.pathname);
    if (role === 'host') startP2PRound();
    else refreshMenu();
  },
  onMessage: handleP2PMessage,
  onDisconnected: (reason) => {
    toast(reason, 4500);
    if (game.config.mode === 'p2p') showScreen('start');
    else refreshMenu();
  }
});

function startP2PRound(): void {
  if (p2p.role !== 'host' || !p2p.isConnected) return;
  const starter = nextStarter('p2p');
  game.start({ size: settings.size, mode: 'p2p', starter, localPlayer: 1 });
  p2p.send({ type: 'START', size: settings.size, starter });
  showScreen(null);
}

function handleP2PMessage(msg: P2PMessage): void {
  switch (msg.type) {
    case 'START':
      if (p2p.role !== 'guest') return;
      game.start({ size: msg.size, mode: 'p2p', starter: msg.starter, localPlayer: 2 });
      showScreen(null);
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
      if (!game.isGameOver) showScreen(null);
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

function startHosting(): void {
  codeText.textContent = '····';
  qrImg.classList.add('hidden-el');
  shareBtn.disabled = true;
  if (!navigator.onLine) {
    setStatus(hostStatus, 'Le mode 2 téléphones a besoin d’Internet pour mettre les téléphones en relation.', 'error');
    return;
  }
  void p2p.host();
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
  game.sfx.unlock();
  void p2p.join(code);
}

function selectP2PTab(tab: 'host' | 'join'): void {
  p2pTab = tab;
  if (tab === 'host' && p2p.role !== 'host') startHosting();
  if (tab === 'join' && p2p.role === 'host') p2p.cleanup();
  refreshMenu();
}

// ---- menu -----------------------------------------------------------------

const modeButtons = document.querySelectorAll<HTMLButtonElement>('#mode-select .seg-btn, #multi-select .seg-btn');
const sizeButtons = document.querySelectorAll<HTMLButtonElement>('#size-select .seg-btn');

function refreshMenu(): void {
  const mode = settings.mode;
  modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  sizeButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.size) === settings.size));

  const isP2P = mode === 'p2p';
  const connected = isP2P && p2p.isConnected;
  $('p2p-panel').classList.toggle('hidden-el', !isP2P);
  $('p2p-tabs').classList.toggle('hidden-el', connected);
  $('host-view').classList.toggle('hidden-el', connected || p2pTab !== 'host');
  $('join-view').classList.toggle('hidden-el', connected || p2pTab !== 'join');
  $('connected-view').classList.toggle('hidden-el', !connected);
  $('btn-host-tab').classList.toggle('active', p2pTab === 'host');
  $('btn-join-tab').classList.toggle('active', p2pTab === 'join');
  $('btn-p2p-newround').textContent = p2p.role === 'guest' ? '🔄 Proposer une manche' : '🔄 Nouvelle manche';
  // The host decides the grid size in P2P.
  $('size-group').classList.toggle('disabled', isP2P && p2p.role === 'guest');

  $('btn-start-game').classList.toggle('hidden-el', isP2P);
  const canResume = game.hasMatchInProgress && (isP2P ? connected && game.config.mode === 'p2p' : game.config.mode === mode);
  $('btn-resume').classList.toggle('hidden-el', !canResume);
}

modeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode as GameMode;
    if (mode === settings.mode) return;
    if (settings.mode === 'p2p' && p2p.isActive) p2p.leave();
    settings.mode = mode;
    if (mode !== 'p2p') saveSettings();
    if (mode === 'p2p') selectP2PTab(p2pTab);
    refreshMenu();
  });
});

sizeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    settings.size = Number(btn.dataset.size);
    saveSettings();
    refreshMenu();
  });
});

$('btn-host-tab').addEventListener('click', () => selectP2PTab('host'));
$('btn-join-tab').addEventListener('click', () => {
  selectP2PTab('join');
  codeInput.focus();
});

codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connectToRoom();
});
$('btn-connect-peer').addEventListener('click', connectToRoom);

shareBtn.addEventListener('click', async () => {
  if (!p2p.roomCode) return;
  const url = inviteUrl(p2p.roomCode);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Petits Carrés', text: `Rejoins ma partie avec le code ${p2p.roomCode} !`, url });
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

$('btn-p2p-newround').addEventListener('click', () => {
  if (p2p.role === 'host') startP2PRound();
  else {
    p2p.send({ type: 'REMATCH' });
    toast('Demande envoyée au Téléphone 1…');
  }
});

$('btn-p2p-leave').addEventListener('click', () => {
  p2p.leave();
  p2pTab = 'host';
  startHosting();
  refreshMenu();
});

$('btn-start-game').addEventListener('click', () => {
  game.sfx.unlock();
  startLocalMatch();
});

$('btn-resume').addEventListener('click', () => showScreen(null));

$('btn-replay').addEventListener('click', () => {
  game.sfx.unlock();
  if (game.config.mode !== 'p2p') return startLocalMatch(game.config.mode, game.config.size);
  if (!p2p.isConnected) return showScreen('start');
  if (p2p.role === 'host') startP2PRound();
  else {
    p2p.send({ type: 'REMATCH' });
    toast('Demande de revanche envoyée…');
  }
});

$('btn-menu').addEventListener('click', () => showScreen('start'));
$('btn-change-mode').addEventListener('click', () => showScreen('start'));

const soundBtn = $('btn-sound');
const renderSoundBtn = () => {
  soundBtn.textContent = game.sfx.enabled ? '🔊' : '🔇';
  soundBtn.setAttribute('aria-label', game.sfx.enabled ? 'Son activé' : 'Son coupé');
};
soundBtn.addEventListener('click', () => {
  game.sfx.enabled = !game.sfx.enabled;
  settings.sound = game.sfx.enabled;
  saveSettings();
  renderSoundBtn();
  game.sfx.unlock();
});
renderSoundBtn();

window.addEventListener('online', () => {
  if (settings.mode === 'p2p' && p2pTab === 'host' && !p2p.isActive) startHosting();
});

// ---- boot -------------------------------------------------------------------

// Background board behind the menu.
game.start({ size: settings.size, mode: isAIMode(settings.mode) || settings.mode === 'pvp' ? settings.mode : 'pvp', starter: 1 });
showScreen('start');

const roomParam = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
if (/^[A-Z0-9]{4}$/.test(roomParam)) {
  settings.mode = 'p2p';
  p2pTab = 'join';
  codeInput.value = roomParam;
  refreshMenu();
  connectToRoom();
}
