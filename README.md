# Petits Carrés ✏️ (Dots and Boxes PWA)

Le jeu des petits carrés au style **carnet de croquis** : traits au crayon dessinés en Canvas 2D,
cases hachurées, sons synthétisés en Web Audio. Jouable **hors-ligne** (PWA), contre l'IA, à deux
sur le même écran, ou **sur deux téléphones** en P2P (WebRTC, sans serveur de jeu).

👉 **Jouer :** https://engob.github.io/dotslines/
👉 **Version 1 fichier :** [`standalone-bundle.html`](./standalone-bundle.html) (s'ouvre directement depuis le disque)

## Interface

Style « console de salon » : fond clair, panneaux blancs arrondis, couleurs vives (bleu et rouge néon),
boutons en relief qui s'enfoncent, curseur de sélection cyan animé, police arrondie (M PLUS Rounded 1c + Nunito,
auto-hébergées). Plateau net : traits droits avec une légère ombre, pions ronds, cases capturées en tuiles pleines
qui « poppent ».

- **Accueil** : plateau de démonstration qui se joue tout seul, 4 modes (Solo · À deux · En ligne · Tournoi),
  difficulté, taille de grille, **chrono**, bouton *Jouer*, barre Règles · Stats · Réglages.
- **Partie** : écran maximisé (plein écran automatique sur téléphone quand le navigateur le permet), cartes de score
  (pleine couleur pour le joueur dont c'est le tour), cadre du plateau à sa couleur, **dernier tour de l'adversaire
  surligné** (halo qui pulse, puis reste visible jusqu'à ton coup), bandeau de messages, pause.
- **Chrono par coup (option, tous les modes)** : Off, 5, 10 ou 20 s par trait. Barre de temps à la couleur du joueur,
  rouge et bips dans les 3 dernières secondes ; à zéro, un trait est tracé au hasard. En solo / à deux le chrono se met
  en pause avec le jeu ; en ligne c'est le réglage de l'hôte qui s'applique et le chrono ne s'arrête pas.
- **Réglages** : sons et « qui commence » (chacun son tour, au hasard, moi, l'adversaire).
- **Statistiques** : victoires / défaites / nuls par niveau d'IA, en ligne, tournois et à deux.

## Fonctionnalités

- Grilles 3×3, 4×4, 5×5.
- **IA Facile** : prend les carrés offerts, sinon joue au hasard.
- **IA Malin** : ne donne jamais de 3ᵉ côté tant qu'elle peut l'éviter, puis sacrifie la plus petite chaîne.
- **IA Expert** : en fin de partie, elle **résout exactement** la position (alpha-bêta + table de transposition,
  règles de capture/double-cross de Berlekamp et évaluation exacte des chaînes et boucles). Elle tourne dans un
  Web Worker pour ne jamais figer l'animation.
- **Tournoi en ligne à 4 téléphones** : l'hôte crée un salon (code + QR), les autres le rejoignent et
  choisissent leur prénom ; les places libres peuvent être tenues par une IA. Les deux demi-finales
  (1 contre 2, 3 contre 4) se jouent **en même temps**, chacun sur son téléphone, puis la finale se lance
  toute seule ; les éliminés la regardent en direct. Tableau avec scores en direct, match rejoué en cas
  d'égalité, une IA remplace un téléphone qui se déconnecte, « Nouveau tournoi » avec les mêmes téléphones.
- **2 joueurs (1 écran)** et **2 téléphones (P2P)** : code salon à 4 caractères, QR code généré localement,
  lien d'invitation `?room=XXXX`, revanche, reconnexion au même salon, salon limité à 2 téléphones.
- Le premier joueur alterne à chaque manche ou est tiré au sort (réglable) ; score des manches affiché.
- PWA installable, polices auto-hébergées, 100 % hors-ligne : Solo et À deux n'ont jamais besoin de réseau ;
  En ligne et Tournoi demandent Internet, uniquement pour la mise en relation des téléphones.
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
│   ├── BoardRenderer.ts    # dessin du plateau (traits, pions, tuiles, halo)
│   ├── SoundEffects.ts     # sons Web Audio
│   ├── P2PManager.ts       # WebRTC via PeerJS
│   ├── Tournament.ts       # tableau du tournoi à 4
│   └── types.ts            # types + validation des messages P2P
├── online/
│   ├── TournamentHost.ts   # arbitre du tournoi (sur le téléphone hôte) : places, coups, IA, diffusion
│   └── TournamentClient.ts # état du tournoi vu par chaque téléphone
├── ui/
│   ├── DemoBoard.ts        # plateau de démo animé de l'accueil
│   ├── icons.ts            # icônes SVG inline
│   └── prefs.ts            # réglages et statistiques (localStorage)
├── main.ts                 # interface (accueil, partie, feuilles, P2P)
├── pwa.ts                  # service worker, installation, statut réseau
└── style.css
tests/                      # Vitest
```
