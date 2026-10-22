import type { DataConnection, Peer } from 'peerjs';
import { parseP2PMessage, type P2PMessage } from './types';

export type P2PRole = 'host' | 'guest';

export interface P2PCallbacks {
  /** Human-readable connection status for the menu. */
  onStatus: (text: string, kind: 'info' | 'ok' | 'error') => void;
  /** Host only: the room code is registered and can be shared. */
  onRoomReady: (code: string) => void;
  /** A data channel opened (host: a guest arrived, guest: reached the host). */
  onConnected: (role: P2PRole, peerId: string) => void;
  onMessage: (msg: P2PMessage, peerId: string) => void;
  /** A phone left or the link dropped (never fired for our own leave()). */
  onDisconnected: (reason: string, peerId: string) => void;
}

const PREFIX = 'petits-carres-pwa-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_TIMEOUT_MS = 15000;

function errorMessage(type: string | undefined, role: P2PRole): string {
  switch (type) {
    case 'peer-unavailable':
      return 'Salon introuvable. Vérifie le code à 4 caractères (l’hôte doit garder l’écran ouvert).';
    case 'browser-incompatible':
      return 'Ce navigateur ne gère pas WebRTC. Essaie Chrome, Safari ou Firefox récent.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Impossible de joindre le serveur de mise en relation. Vérifie ta connexion Internet.';
    case 'webrtc':
      return 'La connexion directe entre les téléphones a échoué (réseau trop restrictif ?).';
    default:
      return role === 'host' ? 'Erreur réseau lors de la création du salon.' : 'Connexion impossible au salon.';
  }
}

/**
 * Serverless multi-phone play: PeerJS only brokers the WebRTC handshake, then
 * messages travel directly between the phones. The host accepts up to
 * `maxPeers` guests (1 for a duel, 3 for a tournament) and relays everything.
 */
export class P2PManager {
  public roomCode = '';
  public role: P2PRole | null = null;
  private peer: Peer | null = null;
  /** Host: one connection per guest. Guest: the single link to the host. */
  private readonly conns = new Map<string, DataConnection>();
  private maxPeers = 1;
  private waitingText = 'En attente du Téléphone 2…';
  /** Host stops accepting newcomers (tournament started). */
  private locked = false;
  private joinTimer: number | undefined;
  /** Incremented on every new session so stale PeerJS events are ignored. */
  private session = 0;

  constructor(private readonly cb: P2PCallbacks) {}

  get isConnected(): boolean {
    return this.peerCount > 0;
  }

  get peerCount(): number {
    let n = 0;
    for (const c of this.conns.values()) if (c.open) n++;
    return n;
  }

  get isActive(): boolean {
    return this.peer !== null;
  }

  /** Host: refuse (or accept again) new phones. */
  public setLocked(locked: boolean): void {
    this.locked = locked;
  }

  private static generateCode(): string {
    let res = '';
    const rnd = new Uint32Array(4);
    crypto.getRandomValues(rnd);
    for (let i = 0; i < 4; i++) res += CODE_CHARS[rnd[i] % CODE_CHARS.length];
    return res;
  }

  private static async createPeer(id?: string): Promise<Peer> {
    const { Peer } = await import('peerjs');
    const env = import.meta.env;
    // Optional self-hosted signalling server (defaults to the free PeerJS cloud).
    const options = {
      debug: 0,
      ...(env.VITE_PEER_HOST && {
        host: env.VITE_PEER_HOST,
        port: Number(env.VITE_PEER_PORT || 443),
        path: env.VITE_PEER_PATH || '/',
        secure: env.VITE_PEER_SECURE !== 'false'
      })
    };
    return id ? new Peer(id, options) : new Peer(options);
  }

  /** Closes everything without notifying the UI. */
  public cleanup(): void {
    this.session++;
    window.clearTimeout(this.joinTimer);
    const conns = [...this.conns.values()];
    const peer = this.peer;
    this.conns.clear();
    this.peer = null;
    this.role = null;
    this.roomCode = '';
    this.locked = false;
    conns.forEach((c) => c.close());
    peer?.destroy();
  }

  /** Politely tells the other phones we leave, then cleans up. */
  public leave(): void {
    this.send({ type: 'BYE' });
    const conns = [...this.conns.values()];
    const peer = this.peer;
    this.session++;
    this.conns.clear();
    this.peer = null;
    this.role = null;
    this.roomCode = '';
    this.locked = false;
    window.clearTimeout(this.joinTimer);
    // Give the BYE a moment to go out before tearing the channels down.
    window.setTimeout(() => {
      conns.forEach((c) => c.close());
      peer?.destroy();
    }, 150);
  }

  public async host(maxPeers = 1, waitingText = 'En attente du Téléphone 2…', attempt = 0): Promise<void> {
    this.cleanup();
    const session = this.session;
    this.role = 'host';
    this.maxPeers = maxPeers;
    this.waitingText = waitingText;
    this.roomCode = P2PManager.generateCode();
    this.cb.onStatus('Création du salon sur le réseau…', 'info');

    let peer: Peer;
    try {
      peer = await P2PManager.createPeer(PREFIX + this.roomCode);
    } catch {
      this.cb.onStatus('Module P2P indisponible (hors-ligne ?).', 'error');
      return;
    }
    if (session !== this.session) {
      peer.destroy();
      return;
    }
    this.peer = peer;

    let registered = false;
    let reconnects = 0;
    peer.on('open', () => {
      if (session !== this.session) return;
      registered = true;
      reconnects = 0;
      this.cb.onRoomReady(this.roomCode);
      this.cb.onStatus(this.waitingText, 'info');
    });

    peer.on('connection', (incoming) => {
      if (session !== this.session) return;
      if (this.locked || this.peerCount >= this.maxPeers) {
        // Room full or game already running.
        incoming.on('open', () => {
          incoming.send({ type: 'FULL' } satisfies P2PMessage);
          window.setTimeout(() => incoming.close(), 300);
        });
        return;
      }
      this.conns.get(incoming.peer)?.close();
      this.conns.set(incoming.peer, incoming);
      this.wireConnection(incoming, session);
    });

    peer.on('disconnected', () => {
      // Lost the signalling server only: the data channels survive, so try to
      // re-register the room a few times (never when it never came up at all).
      if (session !== this.session || peer.destroyed || !registered || reconnects >= 3) return;
      reconnects++;
      window.setTimeout(() => {
        if (session === this.session && !peer.destroyed && peer.disconnected) peer.reconnect();
      }, 1000 * reconnects);
    });

    peer.on('error', (err) => {
      if (session !== this.session) return;
      if (err.type === 'unavailable-id' && attempt < 3) {
        void this.host(maxPeers, waitingText, attempt + 1);
        return;
      }
      // A guest's own channel failing must not look like the room failing.
      if (err.type === 'peer-unavailable' && registered) return;
      this.cb.onStatus(errorMessage(err.type, 'host'), 'error');
    });
  }

  public async join(rawCode: string): Promise<void> {
    this.cleanup();
    const session = this.session;
    this.role = 'guest';
    this.roomCode = rawCode.trim().toUpperCase();
    this.cb.onStatus('Connexion au salon en cours…', 'info');

    let peer: Peer;
    try {
      peer = await P2PManager.createPeer();
    } catch {
      this.cb.onStatus('Module P2P indisponible (hors-ligne ?).', 'error');
      return;
    }
    if (session !== this.session) {
      peer.destroy();
      return;
    }
    this.peer = peer;

    this.joinTimer = window.setTimeout(() => {
      if (session !== this.session || this.isConnected) return;
      this.cb.onStatus('Pas de réponse de l’hôte. Vérifie le code et réessaie.', 'error');
      this.cleanup();
    }, JOIN_TIMEOUT_MS);

    peer.on('open', () => {
      if (session !== this.session) return;
      const conn = peer.connect(PREFIX + this.roomCode, { reliable: true });
      this.conns.set(conn.peer, conn);
      this.wireConnection(conn, session);
    });

    peer.on('error', (err) => {
      if (session !== this.session) return;
      window.clearTimeout(this.joinTimer);
      this.cb.onStatus(errorMessage(err.type, 'guest'), 'error');
    });
  }

  private wireConnection(conn: DataConnection, session: number): void {
    conn.on('open', () => {
      if (session !== this.session) return;
      window.clearTimeout(this.joinTimer);
      if (this.role === 'guest') this.cb.onStatus(`Connecté au salon ${this.roomCode} ✔`, 'ok');
      this.cb.onConnected(this.role!, conn.peer);
    });

    conn.on('data', (raw) => {
      if (session !== this.session) return;
      const msg = parseP2PMessage(raw);
      if (!msg) return;
      if (msg.type === 'BYE') {
        const who = this.role === 'host' ? 'Un téléphone a quitté le salon.' : 'L’hôte a quitté la partie.';
        this.dropConnection(conn, this.maxPeers > 1 || this.role === 'guest' ? who : 'L’autre téléphone a quitté la partie.');
        return;
      }
      if (msg.type === 'FULL') {
        this.cb.onStatus('Ce salon est complet ou la partie a déjà commencé.', 'error');
        this.cleanup();
        return;
      }
      this.cb.onMessage(msg, conn.peer);
    });

    conn.on('close', () => {
      if (session !== this.session) return;
      this.dropConnection(conn, this.role === 'host' ? 'Un téléphone s’est déconnecté.' : 'La connexion avec l’hôte a été perdue.');
    });

    conn.on('error', () => {
      if (session !== this.session) return;
      this.dropConnection(conn, 'La connexion avec un téléphone a été perdue.');
    });
  }

  private dropConnection(conn: DataConnection, reason: string): void {
    if (this.conns.get(conn.peer) !== conn) return;
    this.conns.delete(conn.peer);
    conn.close();
    if (this.role === 'host' && this.peer && !this.peer.destroyed) {
      // The host keeps its room open so the guest can come back with the same code.
      if (!this.locked) this.cb.onStatus(this.waitingText, 'info');
    } else {
      this.cleanup();
    }
    this.cb.onDisconnected(reason, conn.peer);
  }

  /** Host: to one guest (`to`) or to all of them. Guest: to the host. */
  public send(msg: P2PMessage, to?: string): void {
    if (to) {
      const c = this.conns.get(to);
      if (c?.open) void c.send(msg);
      return;
    }
    for (const c of this.conns.values()) if (c.open) void c.send(msg);
  }
}
