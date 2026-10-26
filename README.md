# mambo-proxi-api

API du site officiel **MAMBO Proxi** — agence de coordination multiservices entre la France et le Cameroun.
NestJS · Prisma · PostgreSQL · Redis/BullMQ · stockage S3 · e-mails transactionnels.

Le site public et le back-office (dépôt `mambo-proxi-web`) consomment cette API.
Le contrat d'échange est **`contracts/openapi.yaml`** (OpenAPI 3.1) : il fait foi pour les deux dépôts.

## Démarrage (développement)

Prérequis : Node.js 24 (`.nvmrc`), pnpm 12 (`corepack enable`), Docker.

```bash
pnpm install            # dépendances + génération du client Prisma
cp .env.example .env
pnpm services:up        # PostgreSQL, Redis, S3 (SeaweedFS), Mailpit
pnpm db:migrate         # créer / appliquer les migrations
pnpm start:dev          # API sur http://localhost:4000
```

- État de l'API : http://localhost:4000/v1/health
- Documentation générée depuis le code (hors production) : http://localhost:4000/docs — le contrat de référence reste `contracts/openapi.yaml`.
- Interface des e-mails de développement (Mailpit) : http://localhost:8025

La configuration est validée au démarrage : en développement, les variables absentes prennent les valeurs de `.env.example` ; en production, elles sont toutes obligatoires et l'API refuse de démarrer en indiquant chaque variable à corriger.

## Données de départ

```bash
pnpm db:seed            # remplir la base (relançable sans doublon)
SEED_DEMO=false pnpm db:seed   # données de référence seulement (production)
pnpm db:purge-demo      # supprimer toutes les données de démonstration (isDemo)
```

- **Données de référence** (contenus des maquettes) : paramètres et coordonnées provisoires, navigation, 16 pages en
  français et en anglais, 5 rubriques, 22 services et 4 formules, offres, zones et quartiers de Douala, médias,
  modèles d'e-mails, questions du questionnaire, disponibilités. Créées si elles manquent, jamais écrasées.
- **Données de démonstration** (marquées `isDemo`, dates relatives au jour du lancement) : avis, demandes et
  historique, rendez-vous, contacts et inscrits, candidatures, événements, formations, partenaires, offres
  d'emploi, magazine, campagnes, notifications et journal, service en brouillon « Visites guidées ». Remises à l'état des maquettes à chaque lancement.
- **Comptes** : administrateur `SEED_ADMIN_EMAIL` / `SEED_ADMIN_NAME` (créé s'il n'existe pas) et, avec les
  données de démonstration, Carine Eboa (MANAGER), Paul Ngando (AGENT), Équipe Douala (EDITOR) et Grace Nkongo
  (WRITER). Aucun mot de passe n'est enregistré par le seed : il est défini à l'invitation ou à la première
  connexion (lien « Mot de passe oublié »).
- Les images sont celles livrées avec le site (`/photos/…`, `/illustrations/…`) : leur adresse relative est
  enregistrée telle quelle, sans téléversement dans le stockage S3.
- Les fichiers `prisma/seed/data/*.json` reprennent les mocks du site (`mambo-proxi-web/src/mocks`).

## E-mails

Les e-mails partent en arrière-plan par la file BullMQ `mail` (Redis) : `MailQueueService.enqueue(...)` ajoute une
tâche, le worker la rend (gabarit React Email + textes du modèle modifiable dans le back-office) et l'envoie par SMTP
avec une version texte brut. 5 tentatives à attente exponentielle (1, 2, 4, 8 min) ; tâches terminées purgées
(7 jours pour les réussies, 30 jours pour les échecs).

- En local, les e-mails arrivent dans **Mailpit** : http://localhost:8025 (`pnpm services:up`).
- `MAIL_WORKER=on|off` : démarre ou non le worker dans le processus (`off` par défaut en test).
- Données attendues par chaque gabarit : `src/modules/mail/templates/README.md`.

```bash
pnpm mail:preview   # rend les 21 gabarits (FR et EN) dans tmp/mail-preview/ — ouvrir index.html
```

La prévisualisation utilise les textes par défaut et des données d'exemple, sans base ni Redis ; le logo est chargé
depuis `WEB_URL` (site local par défaut, `WEB_URL=https://mamboproxi.com pnpm mail:preview` pour le site en ligne).

## Vérifications

```bash
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test               # tests unitaires
pnpm test:e2e           # tests e2e (réponses validées contre le contrat)
E2E_REAL_SERVICES=true pnpm test:e2e   # en plus, sur PostgreSQL et Redis démarrés
pnpm contract:lint      # valider le contrat
```

## Documentation

- `CLAUDE.md` — conventions du dépôt et règles non négociables.
- `TASKS.md` — avancement.
- `JOURNAL.md` — décisions, difficultés et solutions, étape par étape.
