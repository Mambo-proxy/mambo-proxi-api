#!/usr/bin/env bash
# Déploiement de l'API sur le VPS (lancé par le workflow « Déploiement » via SSH, ou à la main par l'utilisateur
# deploy) :
#   bash /opt/mambo/deploy.sh <étiquette>     # SHA du commit (défaut : latest)
# Téléchargement des images de l'API, migrations Prisma, redémarrage, attente du healthcheck, nettoyage.
# Connexion au registre ghcr.io : faite par le workflow avant l'appel (jeton éphémère), ou une fois pour toutes à la
# main avec un jeton personnel « read:packages » (docs/DEPLOIEMENT.md).
set -euo pipefail

TAG="${1:-latest}"
DIR=/opt/mambo

log() { printf '\n[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() {
  printf '\nÉCHEC : %s\n' "$*" >&2
  exit 1
}

cd "$DIR"
[ -f .env ] || fail "$DIR/.env est introuvable. Créez-le à partir de $DIR/.env.production.example (docs/DEPLOIEMENT.md)."
for variable in API_DOMAIN WEB_DOMAIN ACME_EMAIL POSTGRES_PASSWORD REVALIDATE_SECRET; do
  grep -Eq "^${variable}=.+" .env || fail "$variable est vide ou absent de $DIR/.env."
done

export IMAGE_TAG="$TAG"
# Version du site en place (déployée par mambo-proxi-web) : jamais changée par un déploiement de l'API.
WEB_IMAGE_TAG="$(cat "$DIR/.web-tag" 2>/dev/null || echo latest)"
export WEB_IMAGE_TAG
compose() { docker compose -f "$DIR/docker-compose.prod.yml" --env-file "$DIR/.env" "$@"; }

# Services démarrés : le site seulement s'il a déjà été déployé (image présente sur le serveur).
services=(caddy postgres redis api)
[ -f "$DIR/.web-tag" ] && services+=(web)

log "Téléchargement des images de l'API (étiquette $TAG)"
compose --profile tools pull --quiet api migrate

log "Démarrage de PostgreSQL et Redis"
compose up -d --wait --wait-timeout 120 postgres redis

log "Migrations Prisma (prisma migrate deploy)"
compose --profile tools run --rm migrate

log "Démarrage des services : ${services[*]}"
if ! compose up -d --remove-orphans --wait --wait-timeout 180 "${services[@]}"; then
  compose ps
  compose logs --tail 100 api
  fail "les services ne sont pas en bonne santé après 3 minutes."
fi
compose ps

log "Vérification de la route de santé"
docker exec "$(compose ps -q api)" node -e \
  "fetch('http://127.0.0.1:4000/v1/health').then(async r=>{console.log(r.status, await r.text());process.exit(r.ok?0:1)},()=>process.exit(1))" ||
  fail "GET /v1/health ne répond pas 200."

echo "$TAG" >"$DIR/.deployed-tag"

log "Nettoyage des anciennes images (plus de 3 jours, inutilisées)"
docker image prune -af --filter "until=72h" >/dev/null || true

log "Déploiement terminé : $TAG"
