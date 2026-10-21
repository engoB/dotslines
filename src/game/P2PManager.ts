import type { DataConnection, Peer } from 'peerjs';
import { parseP2PMessage, type P2PMessage } from './types';

export type P2PRole = 'host' | 'guest';

export interface P2PCallbacks {
  /** Human-readable connection status for the menu. */
  onStatus: (text: string, kind: 'info' | 'ok' | 'error') => void;
  /** Host only: the room code is registered and can be shared. */
  onRoomReady: (code: string) => void;
  onConnected: (role: P2PRole) => void;
  onMessage: (msg: P2PMessage) => void;
  /** The other phone left or the link dropped (never fired for our own leave()). */
  onDisconnected: (reason: string) => void;
}

const PREFIX = 'petits-carres-pwa-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_TIMEOUT_MS = 15000;

function errorMessage(type: string | undefined, role: P2PRole): string {
  switch (type) {
    case 'peer-unavailable':
      return 'Salon introuvable. Vérifie le code à 4 caractères (le Téléphone 1 doit garder l’écran ouvert).';
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
 * Serverless 2-phone play: PeerJS only brokers the WebRTC handshake, then the
 * moves travel directly between the phones over a data channel.
 */
export class P2PManager {
  public roomCode = '';
  public role: P2PRole | null = null;
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private joinTimer: number | undefined;
  /** Incremented on every new session so stale PeerJS events are ignored. */
  private session = 0;

  constructor(private readonly cb: P2PCallbacks) {}

  get isConnected(): boolean {
    return !!this.conn?.open;
  }

  get isActive(): boolean {
    return this.peer !== null;
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
    const conn = this.conn;
    const peer = this.peer;
    this.conn = null;
    this.peer = null;
    this.role = null;
    this.roomCode = '';
    conn?.close();
    peer?.destroy();
  }

  /** Politely tells the other phone we leave, then cleans up. */
  public leave(): void {
    if (this.isConnected) this.send({ type: 'BYE' });
    // Give the BYE a moment to go out before tearing the channel down.
    const conn = this.conn;
    const peer = this.peer;
    this.session++;
    this.conn = null;
    this.peer = null;
    this.role = null;
    this.roomCode = '';
    window.clearTimeout(this.joinTimer);
    window.setTimeout(() => {
      conn?.close();
      peer?.destroy();
    }, 150);
  }

  public async host(attempt = 0): Promise<void> {
    this.cleanup();
    const session = this.session;
    this.role = 'host';
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
      this.cb.onStatus('En attente du Téléphone 2…', 'info');
    });

    peer.on('connection', (incoming) => {
      if (session !== this.session) return;
      if (this.isConnected) {
        // Only two players per room.
        incoming.on('open', () => {
          incoming.send({ type: 'FULL' } satisfies P2PMessage);
          window.setTimeout(() => incoming.close(), 300);
        });
        return;
      }
      this.conn?.close();
      this.conn = incoming;
      this.wireConnection(incoming, session);
    });

    peer.on('disconnected', () => {
      // Lost the signalling server only: the data channel survives, so try to
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
        void this.host(attempt + 1);
        return;
      }
      this.cb.onStatus(errorMessage(err.type, 'host'), 'error');
    });
  }

  public async join(rawCode: string): Promise<void> {
    this.cleanup();
    const session = this.session;
    this.role = 'guest';
    this.roomCode = rawCode.trim().toUpperCase();
    this.cb.onStatus('Connexion au Téléphone 1 en cours…', 'info');

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
      this.cb.onStatus('Pas de réponse du Téléphone 1. Vérifie le code et réessaie.', 'error');
      this.cleanup();
    }, JOIN_TIMEOUT_MS);

    peer.on('open', () => {
      if (session !== this.session) return;
      const conn = peer.connect(PREFIX + this.roomCode, { reliable: true });
      this.conn = conn;
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
      this.cb.onStatus(`Connecté au salon ${this.roomCode} ✔`, 'ok');
      this.cb.onConnected(this.role!);
    });

    conn.on('data', (raw) => {
      if (session !== this.session) return;
      const msg = parseP2PMessage(raw);
      if (!msg) return;
      if (msg.type === 'BYE') {
        this.dropConnection(conn, 'L’autre téléphone a quitté la partie.');
        return;
      }
      if (msg.type === 'FULL') {
        this.cb.onStatus('Ce salon est déjà complet.', 'error');
        this.cleanup();
        return;
      }
      this.cb.onMessage(msg);
    });

    conn.on('close', () => {
      if (session !== this.session) return;
      this.dropConnection(conn, 'Le second téléphone s’est déconnecté.');
    });

    conn.on('error', () => {
      if (session !== this.session) return;
      this.dropConnection(conn, 'La connexion avec l’autre téléphone a été perdue.');
    });
  }

  private dropConnection(conn: DataConnection, reason: string): void {
    if (this.conn !== conn) return;
    this.conn = null;
    conn.close();
    if (this.role === 'host' && this.peer && !this.peer.destroyed) {
      // The host keeps its room open so the guest can come back with the same code.
      this.cb.onStatus('En attente du Téléphone 2…', 'info');
    } else {
      this.cleanup();
    }
    this.cb.onDisconnected(reason);
  }

  public send(msg: P2PMessage): void {
    if (this.conn?.open) void this.conn.send(msg);
  }
}
