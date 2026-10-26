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
