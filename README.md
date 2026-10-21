# Petits Carrés ✏️ (Dots and Boxes PWA)

Le jeu des petits carrés au style **carnet de croquis** : traits au crayon dessinés en Canvas 2D,
cases hachurées, sons synthétisés en Web Audio. Jouable **hors-ligne** (PWA), contre l'IA, à deux
sur le même écran, ou **sur deux téléphones** en P2P (WebRTC, sans serveur de jeu).

👉 **Jouer :** https://engob.github.io/dotslines/
👉 **Version 1 fichier :** [`standalone-bundle.html`](./standalone-bundle.html) (s'ouvre directement depuis le disque)

## Interface

Le plateau reste un **carnet de croquis** (papier quadrillé, traits au crayon), habillé d'une interface
inspirée d'[Iro-Koku](https://github.com/engoB/IroKoku) (couleurs et polices uniquement, sans ses illustrations) :
cartes parchemin à liseré doré, bouton gemme magenta, onglets « pilule », fanions de score bleu/rouge,
gemme de tour au-dessus du plateau, feuilles coulissantes. Polices : Baloo 2, Nunito et Caveat (auto-hébergées).

- **Accueil** : plateau de démonstration qui se joue tout seul, choix du mode (Solo · À deux · En ligne),
  difficulté et taille de grille, bouton *Jouer*, barre Règles · Stats · Réglages.
- **Partie** : fanions de score, carte « Toi vs adversaire » avec le tour en cours, bandeau de messages
  (« +2 carrés ! Tu rejoues. »), pause (reprendre, recommencer, accueil).
- **Réglages** : sons, vibrations, marquage du dernier trait, qui commence (à tour de rôle / moi / l'adversaire),
  installation, remise à zéro des statistiques.
- **Statistiques** : victoires / défaites / nuls par niveau d'IA, en ligne et à deux.

## Fonctionnalités

- Grilles 3×3, 4×4, 5×5.
- **IA Facile** : prend les carrés offerts, sinon joue au hasard.
- **IA Malin** : ne donne jamais de 3ᵉ côté tant qu'elle peut l'éviter, puis sacrifie la plus petite chaîne.
- **IA Expert** : en fin de partie, elle **résout exactement** la position (alpha-bêta + table de transposition,
  règles de capture/double-cross de Berlekamp et évaluation exacte des chaînes et boucles). Elle tourne dans un
  Web Worker pour ne jamais figer l'animation.
- **2 joueurs (1 écran)** et **2 téléphones (P2P)** : code salon à 4 caractères, QR code généré localement,
  lien d'invitation `?room=XXXX`, revanche, reconnexion au même salon, salon limité à 2 téléphones.
- Le premier joueur alterne à chaque manche (réglable) ; score des manches affiché.
- PWA installable, polices auto-hébergées, 100 % hors-ligne (sauf la mise en relation P2P qui demande Internet).
- Réglages mémorisés (mode, taille, son).

## Développement

```bash
npm install
npm run dev        # serveur de dev
npm test           # tests unitaires (moteur, IA vs force brute, protocole P2P)
npm run build      # dist/ (PWA) + standalone-bundle.html
npm run preview    # sert dist/
```

`standalone-bundle.html` est **généré** par `npm run build` (ne pas l'éditer à la main).

Les icônes PNG de `public/` sont générées par `node scripts/generate-icons.mjs` (nécessite Playwright).

### Serveur de mise en relation P2P

Par défaut, le serveur public gratuit de PeerJS (`0.peerjs.com`) sert uniquement à la poignée de main WebRTC ;
les coups passent ensuite directement d'un téléphone à l'autre. Pour utiliser votre propre
[PeerServer](https://github.com/peers/peerjs-server), définissez au build :

```bash
VITE_PEER_HOST=peer.example.com VITE_PEER_PORT=443 VITE_PEER_PATH=/ npm run build
```

Sur certains réseaux mobiles très restrictifs (NAT symétrique), une connexion directe peut échouer faute de
serveur TURN.

## Déploiement

Le workflow `.github/workflows/deploy.yml` teste, construit et publie sur GitHub Pages à chaque push sur `main`.
Dans **Settings → Pages**, choisir la source **GitHub Actions** (une seule fois).

## Architecture

```text
src/
├── game/
│   ├── board.ts            # moteur pur (géométrie indexée, état, règles)
│   ├── ai.ts               # IA Facile / Malin / Expert (solveur exact)
│   ├── ai.worker.ts        # IA dans un Web Worker
│   ├── AIClient.ts         # pont worker ↔ jeu (repli sur le thread principal)
│   ├── DotsAndBoxesGame.ts # rendu Canvas, saisie, déroulé des manches
│   ├── SketchRenderer.ts   # primitives « crayon sur papier »
│   ├── SoundEffects.ts     # sons Web Audio
│   ├── P2PManager.ts       # WebRTC via PeerJS
│   └── types.ts            # types + validation des messages P2P
├── ui/
│   ├── DemoBoard.ts        # plateau de démo animé de l'accueil
│   ├── icons.ts            # icônes SVG inline
│   └── prefs.ts            # réglages et statistiques (localStorage)
├── main.ts                 # interface (accueil, partie, feuilles, P2P)
├── pwa.ts                  # service worker, installation, statut réseau
└── style.css
tests/                      # Vitest
```
