/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** True for the single-file build (standalone-bundle.html): no service worker. */
declare const __STANDALONE__: boolean;

interface ImportMetaEnv {
  /** Optional self-hosted PeerJS signalling server. */
  readonly VITE_PEER_HOST?: string;
  readonly VITE_PEER_PORT?: string;
  readonly VITE_PEER_PATH?: string;
  readonly VITE_PEER_SECURE?: string;
}
