# mambo-proxi-api

API du site officiel **MAMBO Proxi** — agence de coordination multiservices entre la France et le Cameroun.
NestJS · Prisma · PostgreSQL · Redis/BullMQ · stockage S3 · e-mails transactionnels.

Le site public et le back-office (dépôt `mambo-proxi-web`) consomment cette API.
Le contrat d'échange est **`contracts/openapi.yaml`** (OpenAPI 3.1) : il fait foi pour les deux dépôts.

## Démarrage (développement)

Prérequis : Node.js 24 (`.nvmrc`), pnpm 12 (`corepack enable`), Docker.

```bash
pnpm install
cp .env.example .env
pnpm services:up        # PostgreSQL, Redis, S3 (SeaweedFS), Mailpit
pnpm contract:lint      # valider le contrat
```

Interface des e-mails de développement (Mailpit) : http://localhost:8025

> Le projet est en cours de réalisation par phases (contrat d'abord, puis site, puis API). Les commandes de base de données, de développement et de test seront documentées ici au fil des phases.

## Documentation

- `CLAUDE.md` — conventions du dépôt et règles non négociables.
- `TASKS.md` — avancement.
- `JOURNAL.md` — décisions, difficultés et solutions, étape par étape.
