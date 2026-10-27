# syntax=docker/dockerfile:1
#
# Image de production de l'API (docs/DEPLOIEMENT.md). Deux cibles :
#   - runtime (par défaut) : API + workers (`node dist/main.js`, `MAIL_WORKER=on`), dépendances de production seules,
#     `pg_dump` de PostgreSQL 18 pour la sauvegarde quotidienne ;
#   - tools : dépendances complètes et sources, pour les commandes ponctuelles (`prisma migrate deploy`, seed).
# Base Debian (glibc) : binaires précompilés de sharp et argon2, dépôt PGDG pour postgresql-client.

# Version de Node.js : celle de .nvmrc (24), figée au correctif (à mettre à jour avec .nvmrc).
ARG NODE_VERSION=24.13.0
# Même version majeure que le serveur PostgreSQL de deploy/docker-compose.prod.yml.
ARG PG_MAJOR=18

# ─── Base commune : pnpm par corepack (version de `packageManager`) ───
FROM node:${NODE_VERSION}-trixie-slim AS base
ENV COREPACK_HOME=/usr/local/share/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
# corepack récent : clés de signature à jour pour pnpm 12.
RUN npm install --global corepack@latest && corepack enable pnpm
WORKDIR /app

# ─── Dépendances complètes + client Prisma (postinstall : prisma generate) ───
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma/schema.prisma prisma/schema.prisma
RUN pnpm install --frozen-lockfile

# ─── Compilation TypeScript (client Prisma généré compris : dist/generated/prisma) ───
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src src
RUN pnpm build

# ─── Dépendances de production seules (sans scripts : sharp et argon2 utilisent leurs binaires précompilés) ───
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# ─── Outils : migrations et seed (docker compose --profile tools run --rm migrate …) ───
FROM build AS tools
COPY prisma prisma
COPY scripts scripts
ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1 \
    PATH=/app/node_modules/.bin:$PATH
USER node
CMD ["prisma", "migrate", "deploy"]

# ─── Image d'exécution ───
FROM node:${NODE_VERSION}-trixie-slim AS runtime
ARG PG_MAJOR
# Outils clients PostgreSQL (pg_dump) depuis le dépôt officiel PGDG, même version majeure que le serveur.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
    . /etc/os-release; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends "postgresql-client-${PG_MAJOR}"; \
    apt-get purge -y --auto-remove curl; \
    rm -rf /var/lib/apt/lists/*; \
    "/usr/lib/postgresql/${PG_MAJOR}/bin/pg_dump" --version

ENV NODE_ENV=production \
    PORT=4000 \
    PG_DUMP_PATH=/usr/lib/postgresql/${PG_MAJOR}/bin/pg_dump
WORKDIR /app

COPY --from=prod-deps /app/node_modules node_modules
COPY --from=build /app/dist dist
# Version renvoyée par GET /v1/health (lue dans package.json).
COPY package.json ./
# Fichiers de déploiement, extraits sur le serveur par le workflow de déploiement (copie dans /opt/mambo).
COPY deploy deploy
# Répertoires des volumes (fichiers privés, médias, sauvegardes) : créés ici pour appartenir à l'utilisateur `node`
# (un volume nommé vide reprend le propriétaire du répertoire de l'image).
RUN mkdir -p var/storage var/media var/backups && chown -R node:node var

USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
