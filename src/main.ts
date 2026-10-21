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
import { DotsAndBoxesGame, type MoveSource } from './game/DotsAndBoxesGame';
import { P2PManager } from './game/P2PManager';
import { ROUND_NAMES, Tournament, type Contestant } from './game/Tournament';
import { isAIMode, type GameMode, type MatchConfig, type P2PMessage, type Player } from './game/types';
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

function showView(view: View): void {
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

/** Names of the two sides of the current tournament match. */
let matchNames: Record<Player, string> = { 1: 'Joueur 1', 2: 'Joueur 2' };

function currentMode(): GameMode {
  if (prefs.kind === 'solo') return `ai-${prefs.level}` as GameMode;
  if (prefs.kind === 'tournament') return 'tournament';
  return prefs.kind === 'local' ? 'pvp' : 'p2p';
}

function playerNames(): Record<Player, string> {
  const { mode, localPlayer } = game.config;
  if (mode === 'p2p') return localPlayer === 1 ? { 1: 'Toi', 2: 'Téléphone 2' } : { 1: 'Téléphone 1', 2: 'Toi' };
  if (mode === 'pvp') return { 1: 'Joueur 1', 2: 'Joueur 2' };
  if (mode === 'tournament') return matchNames;
  return { 1: 'Toi', 2: `IA ${LEVEL_NAMES[mode.slice(3) as AILevelPref]}` };
}

const isAI = (p: Player) => !!game.config.ai?.[p];

/** "You" wording only when a single human plays on this device against someone else. */
const speaksToYou = (p: Player) => {
  const { mode, localPlayer } = game.config;
  return mode === 'p2p' ? p === localPlayer : isAIMode(mode) && p === 1;
};

function turnMessage(): string {
  const p = game.state.currentPlayer;
  const name = playerNames()[p];
  if (speaksToYou(p)) return 'À toi : relie deux points voisins.';
  if (isAI(p)) return `${name} réfléchit…`;
  if (game.config.mode === 'p2p') return "En attente du coup de l'adversaire…";
  return `Au tour de ${name}.`;
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
      else if (config.mode === 'p2p' && p !== config.localPlayer) status = 'joue…';
      else status = speaksToYou(p) ? 'À toi !' : 'À toi de jouer';
    }
    $(`status-p${p}`).textContent = status;
  }
  shownScores = { ...state.scores };
  $('board-frame').className = `board-frame ${over ? 'over' : `p${state.currentPlayer}`}`;
}

function handleMove(edge: number, source: MoveSource, seq: number, captured: number): void {
  if (game.config.mode === 'p2p' && source === 'local') p2p.send({ type: 'MOVE', edge, seq });
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
  closeOverlay();
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

// ---- tournament ---------------------------------------------------------------

let tournament: Tournament | null = null;
let tournamentSize = 4;
const AI_CYCLE: (AILevel | null)[] = [null, 'easy', 'medium', 'expert'];
const typeLabel = (ai: AILevel | null) => (ai ? `IA ${LEVEL_NAMES[ai]}` : 'Humain');

function renderLineup(contestants: Contestant[]): void {
  const box = $('lineup');
  box.innerHTML = '';
  contestants.forEach((c, i) => {
    if (i % 2 === 0) {
      const sep = document.createElement('p');
      sep.className = 'lineup-sep';
      sep.textContent = i === 0 ? 'Demi-finale 1' : 'Demi-finale 2';
      box.append(sep);
    }
    const row = document.createElement('div');
    row.className = 'lineup-row';
    row.innerHTML = `<span class="num">${i + 1}</span>
      <input type="text" maxlength="14" autocomplete="off" spellcheck="false" aria-label="Nom du joueur ${i + 1}" />
      <button type="button" class="type-btn"></button>`;
    const input = row.querySelector('input')!;
    const typeBtn = row.querySelector('button')!;
    input.value = c.name;
    const paint = (ai: AILevel | null) => {
      typeBtn.textContent = typeLabel(ai);
      typeBtn.classList.toggle('ai', !!ai);
      typeBtn.dataset.ai = ai ?? '';
    };
    paint(c.ai);
    typeBtn.addEventListener('click', () => {
      const prev = (typeBtn.dataset.ai || null) as AILevel | null;
      const next = AI_CYCLE[(AI_CYCLE.indexOf(prev) + 1) % AI_CYCLE.length];
      paint(next);
      // Keep auto-generated names in sync with the type.
      const auto = /^(IA( \S+)?|Joueur \d)$/.test(input.value.trim()) || !input.value.trim();
      if (auto) input.value = next ? `IA ${LEVEL_NAMES[next]}` : `Joueur ${i + 1}`;
    });
    box.append(row);
  });
}

function readLineup(): Contestant[] {
  return [...$('lineup').querySelectorAll<HTMLElement>('.lineup-row')].map((row, i) => {
    const name = row.querySelector('input')!.value.trim().slice(0, 14);
    const ai = (row.querySelector<HTMLButtonElement>('.type-btn')!.dataset.ai || null) as AILevel | null;
    return { name: name || (ai ? `IA ${LEVEL_NAMES[ai]}` : `Joueur ${i + 1}`), ai };
  });
}

function lineupSummary(list: Contestant[]): string {
  const ais = list.filter((c) => c.ai).length;
  const humans = 4 - ais;
  if (!ais) return '4 humains';
  if (!humans) return '4 IA (spectateur)';
  return `${plural(humans, 'humain')} · ${ais} IA`;
}

function openLineup(): void {
  renderLineup(prefs.contestants);
  openOverlay('sheet-tournament');
}

$('btn-shuffle').addEventListener('click', () => {
  const list = readLineup();
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  renderLineup(list);
});

$('btn-start-tournament').addEventListener('click', () => {
  const list = readLineup();
  setPrefs({ contestants: list });
  tournament = new Tournament(list);
  tournamentSize = prefs.size;
  lastStart = null;
  closeOverlay();
  showView('bracket');
});

function renderBracket(): void {
  if (!tournament) return;
  const t = tournament;
  $('bracket-size').textContent = sizeLabel(tournamentSize);
  const current = t.currentIndex;
  $('bracket-list').innerHTML = t.matches
    .map((m, i) => {
      const side = (idx: number | null, k: 0 | 1) => {
        if (idx === null) return `<div class="match-row tbd"><span class="who">Vainqueur demi-finale ${k + 1}</span></div>`;
        const c = t.players[idx];
        const state = m.winner === null ? '' : m.winner === idx ? 'won' : 'lost';
        const pts = m.score && m.winner !== null ? `<span class="pts">${m.score[k]}</span>` : '';
        const tag = c.ai ? `<span class="tag">${LEVEL_NAMES[c.ai]}</span>` : '';
        return `<div class="match-row ${state}"><span class="who">${escapeHTML(c.name)}</span>${tag}${pts}</div>`;
      };
      const note = m.replays && m.winner === null ? `<p class="match-note">Égalité : match à rejouer (${m.score?.join(' – ')})</p>` : '';
      const cls = `match-card${i === 2 ? ' final' : ''}${i === current ? ' current' : ''}`;
      return `<div class="${cls}"><span class="match-tag">${ROUND_NAMES[i]}</span>${side(m.a, 0)}${side(m.b, 1)}${note}</div>`;
    })
    .join('');

  const champion = t.champion;
  $('bracket-champion').classList.toggle('hidden-el', !champion);
  if (champion) $('bracket-champion').innerHTML = `🏆 <span>${escapeHTML(champion.name)}</span> remporte le tournoi !`;
  const m = t.current;
  if (m && m.a !== null && m.b !== null) {
    $('next-title').textContent = m.replays ? 'Rejouer le match' : 'Jouer le match';
    $('next-sub').textContent = `${ROUND_NAMES[current]} · ${t.players[m.a].name} contre ${t.players[m.b].name}`;
  } else {
    $('next-title').textContent = 'Nouveau tournoi';
    $('next-sub').textContent = 'Changer les joueurs ou rejouer';
  }
}

function playTournamentMatch(): void {
  const t = tournament;
  const m = t?.current;
  if (!t || !m || m.a === null || m.b === null) return openLineup();
  const a = t.players[m.a];
  const b = t.players[m.b];
  matchNames = { 1: a.name, 2: b.name };
  const ai: MatchConfig['ai'] = {};
  if (a.ai) ai[1] = a.ai;
  if (b.ai) ai[2] = b.ai;
  game.start({
    size: tournamentSize,
    mode: 'tournament',
    starter: pickStarter(`t:${t.currentIndex}`),
    ai,
    labels: { 1: initials(a.name), 2: initials(b.name) }
  });
  beginMatch(`${ROUND_NAMES[t.currentIndex]} : ${a.name} contre ${b.name}`);
}

function showTournamentResult(): void {
  const t = tournament;
  if (!t) return;
  const round = ROUND_NAMES[t.currentIndex];
  const { 1: s1, 2: s2 } = game.state.scores;
  const result = t.record(s1, s2);
  const winnerName = s1 > s2 ? matchNames[1] : matchNames[2];

  let title: string;
  if (result === 'draw') title = 'Égalité ! On rejoue 🤝';
  else if (t.isOver) title = `🏆 ${winnerName} remporte le tournoi !`;
  else title = `${winnerName} passe en finale !`;
  if (result === 'win' && (t.isOver || !t.players.find((c) => c.name === winnerName)?.ai)) game.sfx.playVictory();

  $('winner-title').textContent = title;
  $('winner-round').textContent = round;
  $('winner-round').classList.remove('hidden-el');
  fillFinalScore();
  $('match-tally').textContent = '';
  $('btn-gameover-home').textContent = 'Tableau';
  $('btn-replay').textContent = result === 'draw' ? 'Rejouer le match' : t.isOver ? 'Voir le tableau' : 'Match suivant';
  openOverlay('modal-gameover');
}

$('btn-next-match').addEventListener('click', playTournamentMatch);
$('btn-bracket-home').addEventListener('click', () => showView('home'));
$('btn-edit-lineup').addEventListener('click', openLineup);

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
        color: { dark: '#1f2a44', light: '#ffffff' }
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

/** Where "Reprendre" leads, if anywhere. */
function resumeTarget(): View | null {
  if (prefs.kind === 'tournament') return tournament && !tournament.isOver ? 'bracket' : null;
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
  $('row-lineup').classList.toggle('hidden-el', prefs.kind !== 'tournament');
  $('lineup-summary').textContent = lineupSummary(prefs.contestants);

  const size = `grille ${sizeLabel(prefs.size)}`;
  const titles: Record<PlayKind, [string, string]> = {
    solo: ['Jouer', `IA ${LEVEL_NAMES[prefs.level]} · ${size}`],
    local: ['Jouer', `À deux sur cet écran · ${size}`],
    tournament: ['Organiser le tournoi', `4 joueurs · ${size}`],
    online: ['Créer un salon', `2 téléphones · ${size}`]
  };
  [$('play-title').textContent, $('play-sub').textContent] = titles[prefs.kind];
  $('btn-join-code').classList.toggle('hidden-el', prefs.kind !== 'online');

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
sizeButtons.forEach((b) => b.addEventListener('click', () => setPrefs({ size: Number(b.dataset.size) })));

$('btn-play').addEventListener('click', () => {
  if (prefs.kind === 'online') openOnline('host');
  else if (prefs.kind === 'tournament') openLineup();
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
  $('stats-list').innerHTML = [
    vs('ai-easy', 'IA Facile'),
    vs('ai-medium', 'IA Malin'),
    vs('ai-expert', 'IA Expert'),
    vs('p2p', 'En ligne'),
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
  if (mode === 'tournament') label = ROUND_NAMES[Math.max(0, tournament?.currentIndex ?? 0)];
  else if (mode === 'p2p') label = `En ligne · salon ${p2p.roomCode}`;
  else label = isAIMode(mode) ? playerNames()[2] : 'À deux';
  $('pause-info').textContent = `${label} · grille ${sizeLabel(size)}`;
  $('restart-label').textContent =
    mode === 'p2p' ? (p2p.role === 'guest' ? 'Proposer une nouvelle manche' : 'Nouvelle manche') : mode === 'tournament' ? 'Rejouer ce match' : 'Recommencer';
  $('home-label').textContent = mode === 'p2p' ? 'Quitter le salon' : mode === 'tournament' ? 'Tableau du tournoi' : 'Accueil';
  soundSwitches[1].checked = prefs.sound;
  openOverlay('sheet-pause');
});

$('btn-pause-resume').addEventListener('click', closeOverlay);

function replay(): void {
  const { mode, size } = game.config;
  if (mode === 'tournament') {
    if (tournament?.isOver) {
      closeOverlay();
      return showView('bracket');
    }
    return playTournamentMatch();
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
  if (game.config.mode === 'tournament' && tournament) return showView('bracket');
  if (game.config.mode === 'p2p' && p2p.isActive) p2p.leave();
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
