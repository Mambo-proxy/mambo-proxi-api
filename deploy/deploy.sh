#!/usr/bin/env bash
# Déploiement de l'API sur le serveur (lancé par le workflow « Déploiement » via SSM, ou à la main en root) :
#   sudo /opt/mambo/deploy.sh <étiquette>     # SHA du commit (défaut : latest)
# Connexion ECR, téléchargement des images, migrations Prisma, redémarrage, attente du healthcheck, nettoyage.
set -euo pipefail

TAG="${1:-latest}"
DIR=/opt/mambo
REGION="${AWS_REGION:-eu-west-3}"
REGISTRY="${ECR_REGISTRY:-168692730521.dkr.ecr.eu-west-3.amazonaws.com}"

log() { printf '\n[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() {
  printf '\nÉCHEC : %s\n' "$*" >&2
  exit 1
}

cd "$DIR"
[ -f .env ] || fail "$DIR/.env est introuvable. Créez-le à partir de $DIR/.env.production.example (docs/DEPLOIEMENT.md)."
for variable in API_DOMAIN ACME_EMAIL POSTGRES_PASSWORD; do
  grep -Eq "^${variable}=.+" .env || fail "$variable est vide ou absent de $DIR/.env."
done

export IMAGE_TAG="$TAG"
compose() { docker compose -f "$DIR/docker-compose.prod.yml" --env-file "$DIR/.env" "$@"; }

log "Connexion au registre ECR ($REGISTRY)"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"

log "Téléchargement des images (étiquette $TAG)"
compose --profile tools pull --quiet

log "Démarrage de PostgreSQL et Redis"
compose up -d --wait --wait-timeout 120 postgres redis

log "Migrations Prisma (prisma migrate deploy)"
compose --profile tools run --rm migrate

log "Démarrage des services"
if ! compose up -d --remove-orphans --wait --wait-timeout 180; then
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
