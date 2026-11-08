#!/usr/bin/env bash
# Déploiement du site (image de mambo-proxi-web) sur le VPS, lancé par le workflow « Déploiement » du site via SSH,
# ou à la main par l'utilisateur deploy :
#   bash /opt/mambo/deploy-web.sh <étiquette>     # SHA du commit du site (défaut : latest)
# Retour à une version précédente : même commande avec l'ancien SHA.
set -euo pipefail

TAG="${1:-latest}"
DIR=/opt/mambo

log() { printf '\n[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() {
  printf '\nÉCHEC : %s\n' "$*" >&2
  exit 1
}

cd "$DIR"
[ -f .env ] || fail "$DIR/.env est introuvable (docs/DEPLOIEMENT.md de mambo-proxi-api)."
[ -f docker-compose.prod.yml ] || fail "Déployez d'abord l'API (workflow « Déploiement » de mambo-proxi-api)."

export WEB_IMAGE_TAG="$TAG"
IMAGE_TAG="$(cat "$DIR/.deployed-tag" 2>/dev/null || echo latest)"
export IMAGE_TAG
compose() { docker compose -f "$DIR/docker-compose.prod.yml" --env-file "$DIR/.env" "$@"; }

log "Téléchargement de l'image du site (étiquette $TAG)"
compose pull --quiet web

log "Démarrage du site"
if ! compose up -d --no-deps --wait --wait-timeout 120 web; then
  compose logs --tail 100 web
  fail "le site n'est pas en bonne santé après 2 minutes."
fi

echo "$TAG" >"$DIR/.web-tag"

# Caddy (déjà lancé par l'API) : démarré s'il ne l'est pas encore.
compose up -d --no-deps caddy
compose ps

log "Nettoyage des anciennes images (plus de 3 jours, inutilisées)"
docker image prune -af --filter "until=72h" >/dev/null || true

log "Site déployé : $TAG"
