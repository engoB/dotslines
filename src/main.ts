import '@fontsource/baloo-2/latin-600.css';
import '@fontsource/baloo-2/latin-700.css';
import '@fontsource/baloo-2/latin-800.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/caveat/latin-700.css';
import './style.css';
import { initPWA } from './pwa';
import { DotsAndBoxesGame, type MoveSource } from './game/DotsAndBoxesGame';
import { P2PManager } from './game/P2PManager';
import { isAIMode, type GameMode, type P2PMessage, type Player } from './game/types';
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
  type StarterPref
} from './ui/prefs';

/** Public URL used in invite links when the page is not served over http(s) (standalone file). */
const PUBLIC_URL = 'https://engob.github.io/dotslines/';
const LEVEL_NAMES: Record<AILevelPref, string> = { easy: 'Facile', medium: 'Malin', expert: 'Expert' };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
const sizeLabel = (n: number) => `${n} × ${n}`;

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

const homeView = $('view-home');
const gameView = $('view-game');
const scrim = $('scrim');
const demo = new DemoBoard($<HTMLCanvasElement>('demo-canvas'));
let openPanel: HTMLElement | null = null;

function showView(view: 'home' | 'game'): void {
  homeView.classList.toggle('hidden', view !== 'home');
  gameView.classList.toggle('hidden', view !== 'game');
  if (view === 'home') {
    refreshHome();
    demo.start();
  } else {
    demo.stop();
  }
}

/** Opens a bottom sheet or the game-over modal (one at a time). */
function openOverlay(id: string): void {
  closeOverlay();
  openPanel = $(id);
  openPanel.hidden = false;
  scrim.hidden = false;
  openPanel.querySelector<HTMLElement>('[data-close], .btn')?.focus({ preventScroll: true });
}

function closeOverlay(): void {
  if (!openPanel) return;
  const closing = openPanel;
  openPanel = null;
  closing.hidden = true;
  scrim.hidden = true;
  // Leaving the online sheet without a partner frees the room.
  if (closing.id === 'sheet-online' && !p2p.isConnected) p2p.cleanup();
}

scrim.addEventListener('click', () => {
  if (openPanel?.id !== 'modal-gameover') closeOverlay();
});
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeOverlay));
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
game.sfx.haptics = prefs.haptics;
game.showLastMove = prefs.showLastMove;

function currentMode(): GameMode {
  if (prefs.kind === 'solo') return `ai-${prefs.level}` as GameMode;
  return prefs.kind === 'local' ? 'pvp' : 'p2p';
}

function playerNames(): Record<Player, string> {
  const { mode, localPlayer } = game.config;
  if (mode === 'p2p') return localPlayer === 1 ? { 1: 'Toi', 2: 'Téléphone 2' } : { 1: 'Téléphone 1', 2: 'Toi' };
  if (mode === 'pvp') return { 1: 'Joueur 1', 2: 'Joueur 2' };
  return { 1: 'Toi', 2: `IA ${LEVEL_NAMES[mode.slice(3) as AILevelPref]}` };
}

/** Is it this device's turn (always true in pass-and-play)? */
const isLocalTurn = () => {
  const { mode, localPlayer } = game.config;
  if (mode === 'p2p') return game.state.currentPlayer === localPlayer;
  return mode === 'pvp' || game.state.currentPlayer === 1;
};

function turnMessage(): string {
  const { mode } = game.config;
  const p = game.state.currentPlayer;
  if (mode === 'pvp') return `Au tour du Joueur ${p}.`;
  if (isLocalTurn()) return 'À toi de jouer : relie deux points voisins.';
  return mode === 'p2p' ? "En attente du coup de l'adversaire…" : "L'IA réfléchit…";
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
  $('name-p1').textContent = names[1];
  $('name-p2').textContent = names[2];

  for (const p of [1, 2] as const) {
    $(`score-p${p}`).textContent = String(state.scores[p]);
    if (state.scores[p] > shownScores[p]) {
      const pennant = $(`pennant-p${p}`);
      pennant.classList.remove('bump');
      void pennant.offsetWidth;
      pennant.classList.add('bump');
    }
  }
  shownScores = { ...state.scores };

  const over = state.isOver;
  const turn = $('turn-pill');
  const orb = $('turn-orb');
  const cls = over ? 'over' : `p${state.currentPlayer}`;
  turn.className = `turn-pill ${cls}`;
  orb.className = `orb ${cls}`;
  let text: string;
  if (over) text = 'Partie terminée';
  else if (config.mode === 'pvp') text = `Joueur ${state.currentPlayer}`;
  else if (isLocalTurn()) text = 'À toi de jouer';
  else text = config.mode === 'p2p' ? 'Tour adverse' : "L'IA réfléchit";
  turn.textContent = text;
  turn.classList.toggle('thinking', !over && game.aiThinking);

  $('grid-info').textContent = `Grille ${sizeLabel(config.size)}`;
  $('boxes-left').textContent = over ? 'Tous les carrés sont pris' : `${plural(game.boxesLeft, 'carré')} à prendre`;
}

function handleMove(edge: number, source: MoveSource, seq: number, captured: number): void {
  if (game.config.mode === 'p2p' && source === 'local') p2p.send({ type: 'MOVE', edge, seq });
  if (game.isGameOver) return setMessage('Partie terminée !', true);
  if (captured === 0) return setMessage(turnMessage());
  const boxes = plural(captured, 'carré');
  const { mode } = game.config;
  if (mode === 'pvp') setMessage(`Joueur ${game.state.currentPlayer} ferme ${boxes} et rejoue !`, true);
  else if (source === 'local') setMessage(`+${boxes} ! Tu rejoues.`, true);
  else setMessage(mode === 'p2p' ? `L'adversaire ferme ${boxes} et rejoue.` : `L'IA ferme ${boxes} et rejoue.`, true);
}

function showGameOver(): void {
  const { state, config } = game;
  const s1 = state.scores[1];
  const s2 = state.scores[2];
  const winner: 0 | Player = s1 > s2 ? 1 : s2 > s1 ? 2 : 0;
  const local: Player = config.mode === 'p2p' ? config.localPlayer ?? 1 : 1;
  const names = playerNames();
  tally[winner]++;
  stats = recordResult(config.mode, winner, local);

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
  $('final-p1').textContent = String(s1);
  $('final-p2').textContent = String(s2);
  $('final-name-p1').textContent = names[1];
  $('final-name-p2').textContent = names[2];
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

/** Applies the "who starts" preference; "alternate" swaps after every round of the same setup. */
let lastStart: { key: string; starter: Player } | null = null;
function pickStarter(key: string, pref: StarterPref = prefs.starter): Player {
  let starter: Player;
  if (pref === 'me') starter = 1;
  else if (pref === 'opponent') starter = 2;
  else starter = lastStart?.key === key && lastStart.starter === 1 ? 2 : 1;
  lastStart = { key, starter };
  return starter;
}

function beginMatch(): void {
  shownScores = { 1: 0, 2: 0 };
  closeOverlay();
  showView('game');
  setMessage(turnMessage(), true);
}

function startLocalMatch(mode: GameMode = currentMode(), size: number = prefs.size): void {
  const key = `${mode}:${size}`;
  resetTallyIfNeeded(key);
  game.start({ size, mode, starter: pickStarter(key) });
  beginMatch();
}

// ---- P2P ----------------------------------------------------------------------

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
        color: { dark: '#4a2f1f', light: '#ffffff' }
      });
      if (p2p.roomCode === code) qrImg.classList.remove('hidden-el');
    } catch {
      qrImg.classList.add('hidden-el');
    }
  },
  onConnected: (role) => {
    resetTallyIfNeeded(`p2p:${p2p.roomCode}:${Date.now()}`);
    lastStart = null;
    if (location.search.includes('room=')) history.replaceState(null, '', location.pathname);
    if (role === 'host') startP2PRound();
    else toast('Connecté ! La partie va commencer…');
  },
  onMessage: handleP2PMessage,
  onDisconnected: (reason) => {
    toast(reason, 4500);
    if (game.config.mode !== 'p2p') return;
    // Back to the online sheet: the host keeps its room open with the same code.
    prefs.kind = 'online';
    showView('home');
    openOnline(p2p.role === 'host' ? 'host' : 'join');
  }
});

function startP2PRound(): void {
  if (p2p.role !== 'host' || !p2p.isConnected) return;
  const starter = pickStarter('p2p', 'alternate');
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

function startHosting(): void {
  $('host-view').classList.remove('failed');
  codeText.textContent = '····';
  qrImg.classList.add('hidden-el');
  shareBtn.disabled = true;
  if (!navigator.onLine) {
    setStatus(hostStatus, 'Le jeu en ligne a besoin d’Internet pour mettre les téléphones en relation.', 'error');
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
  void p2p.join(code);
}

function selectOnlineTab(tab: 'host' | 'join'): void {
  p2pTab = tab;
  $('tab-host').classList.toggle('on', tab === 'host');
  $('tab-join').classList.toggle('on', tab === 'join');
  $('host-view').classList.toggle('hidden-el', tab !== 'host');
  $('join-view').classList.toggle('hidden-el', tab !== 'join');
  $('host-size').textContent = sizeLabel(prefs.size);
  if (tab === 'host' && p2p.role !== 'host') startHosting();
  if (tab === 'join' && p2p.role === 'host') p2p.cleanup();
}

function openOnline(tab: 'host' | 'join'): void {
  openOverlay('sheet-online');
  selectOnlineTab(tab);
  if (tab === 'join') codeInput.focus({ preventScroll: true });
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

window.addEventListener('online', () => {
  if (openPanel?.id === 'sheet-online' && p2pTab === 'host' && !p2p.isActive) startHosting();
});

// ---- home -----------------------------------------------------------------------

const tiles = document.querySelectorAll<HTMLButtonElement>('.tile');
const levelButtons = document.querySelectorAll<HTMLButtonElement>('#level-select button');
const sizeButtons = document.querySelectorAll<HTMLButtonElement>('#size-select button');

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
  const online = prefs.kind === 'online';
  $('play-title').textContent = online ? 'Créer un salon' : 'Jouer';
  $('play-sub').textContent =
    prefs.kind === 'solo' ? `IA ${LEVEL_NAMES[prefs.level]} · ${size}` : online ? `2 téléphones · ${size}` : `À deux sur cet écran · ${size}`;
  $('btn-join-code').classList.toggle('hidden-el', !online);

  const resumable = game.hasMatchInProgress && (game.config.mode !== 'p2p' || p2p.isConnected);
  $('btn-resume').classList.toggle('hidden-el', !resumable);
  $('trophy-count').textContent = String(trophyCount(stats));
}

function setPrefs(patch: Partial<typeof prefs>): void {
  Object.assign(prefs, patch);
  savePrefs(prefs);
  refreshHome();
}

tiles.forEach((t) => t.addEventListener('click', () => setPrefs({ kind: t.dataset.kind as PlayKind })));
levelButtons.forEach((b) => b.addEventListener('click', () => setPrefs({ level: b.dataset.level as AILevelPref })));
sizeButtons.forEach((b) => b.addEventListener('click', () => setPrefs({ size: Number(b.dataset.size) })));

$('btn-play').addEventListener('click', () => (prefs.kind === 'online' ? openOnline('host') : startLocalMatch()));
$('btn-join-code').addEventListener('click', () => openOnline('join'));
$('btn-resume').addEventListener('click', () => showView('game'));
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

const hapticsSwitch = $<HTMLInputElement>('set-haptics');
const lastMoveSwitch = $<HTMLInputElement>('set-lastmove');
const starterButtons = document.querySelectorAll<HTMLButtonElement>('#starter-select button');
if (!('vibrate' in navigator)) $('row-haptics').classList.add('hidden-el');

function openSettings(): void {
  hapticsSwitch.checked = prefs.haptics;
  lastMoveSwitch.checked = prefs.showLastMove;
  starterButtons.forEach((b) => b.classList.toggle('on', b.dataset.starter === prefs.starter));
  openOverlay('sheet-settings');
}

hapticsSwitch.addEventListener('change', () => {
  game.sfx.haptics = hapticsSwitch.checked;
  setPrefs({ haptics: hapticsSwitch.checked });
  if (hapticsSwitch.checked) navigator.vibrate?.(15);
});
lastMoveSwitch.addEventListener('change', () => {
  game.showLastMove = lastMoveSwitch.checked;
  game.requestRender();
  setPrefs({ showLastMove: lastMoveSwitch.checked });
});
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
  $('stats-list').innerHTML = [
    vs('ai-easy', 'IA Facile'),
    vs('ai-medium', 'IA Malin'),
    vs('ai-expert', 'IA Expert'),
    vs('p2p', 'En ligne'),
    row('À deux', duoTotal ? `J1 ${duo.w} – ${duo.l} J2 · ${duo.d} nul${duo.d > 1 ? 's' : ''}` : 'aucune partie', null)
  ].join('');
  openOverlay('sheet-stats');
}

// ---- pause & game over ------------------------------------------------------------

$('btn-pause').addEventListener('click', () => {
  const { mode, size } = game.config;
  const p2pMode = mode === 'p2p';
  const label = isAIMode(mode) ? playerNames()[2] : p2pMode ? `En ligne · salon ${p2p.roomCode}` : 'À deux';
  $('pause-info').textContent = `${label} · grille ${sizeLabel(size)}`;
  $('restart-label').textContent = p2pMode ? (p2p.role === 'guest' ? 'Proposer une nouvelle manche' : 'Nouvelle manche') : 'Recommencer';
  $('home-label').textContent = p2pMode ? 'Quitter le salon' : 'Accueil';
  soundSwitches[1].checked = prefs.sound;
  openOverlay('sheet-pause');
});

$('btn-pause-resume').addEventListener('click', closeOverlay);

function replay(): void {
  const { mode, size } = game.config;
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
  if (game.config.mode === 'p2p' && p2p.isActive) p2p.leave();
  closeOverlay();
  showView('home');
}

$('btn-pause-restart').addEventListener('click', replay);
$('btn-pause-home').addEventListener('click', leaveToHome);
$('btn-replay').addEventListener('click', replay);
$('btn-gameover-home').addEventListener('click', leaveToHome);

// ---- boot -------------------------------------------------------------------------

setSound(prefs.sound);
const bootMode = currentMode();
game.start({ size: prefs.size, mode: bootMode === 'p2p' ? 'pvp' : bootMode, starter: 1 });
showView('home');

const roomParam = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
if (/^[A-Z0-9]{4}$/.test(roomParam)) {
  prefs.kind = 'online';
  refreshHome();
  openOnline('join');
  codeInput.value = roomParam;
  connectToRoom();
}
