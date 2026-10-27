#!/usr/bin/env bash
# Initialisation du serveur Amazon Linux 2023 (idempotente, sans aucun secret) : utilisable comme « user data » EC2
# ou relancée à la main (sudo bash bootstrap.sh). Installe Docker et le plugin compose, crée le fichier d'échange de
# 2 Go et le répertoire /opt/mambo. L'agent SSM et l'AWS CLI sont fournis par l'AMI Amazon Linux 2023.
set -euo pipefail

# Plugin docker compose (absent des dépôts AL2023) : version figée, somme de contrôle vérifiée.
COMPOSE_VERSION="${COMPOSE_VERSION:-v2.40.3}"
SWAP_FILE=/swapfile
SWAP_SIZE_MB=2048

log() { printf '[bootstrap] %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || {
  echo 'À lancer en root (sudo).' >&2
  exit 1
}

log 'Mises à jour de sécurité et paquets'
dnf -y upgrade --security || true
dnf -y install docker

log 'Docker'
install -d -m 0755 /etc/docker
if [ ! -f /etc/docker/daemon.json ]; then
  cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true
}
JSON
fi
systemctl enable --now docker
usermod -aG docker ssm-user 2>/dev/null || true

log "Plugin docker compose $COMPOSE_VERSION"
PLUGIN_DIR=/usr/local/lib/docker/cli-plugins
PLUGIN="$PLUGIN_DIR/docker-compose"
if ! docker compose version 2>/dev/null | grep -q "${COMPOSE_VERSION#v}"; then
  install -d -m 0755 "$PLUGIN_DIR"
  base="https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/docker-compose-linux-x86_64" "$base/docker-compose-linux-x86_64"
  curl -fsSL -o "$tmp/docker-compose-linux-x86_64.sha256" "$base/docker-compose-linux-x86_64.sha256"
  (cd "$tmp" && sha256sum -c docker-compose-linux-x86_64.sha256)
  install -m 0755 "$tmp/docker-compose-linux-x86_64" "$PLUGIN"
  rm -rf "$tmp"
fi
docker compose version

log "Fichier d'échange de ${SWAP_SIZE_MB} Mo"
if ! swapon --show=NAME --noheadings | grep -qx "$SWAP_FILE"; then
  if [ ! -f "$SWAP_FILE" ]; then
    dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SWAP_SIZE_MB" status=none
    chmod 600 "$SWAP_FILE"
    mkswap "$SWAP_FILE"
  fi
  swapon "$SWAP_FILE"
fi
grep -q "^$SWAP_FILE " /etc/fstab || echo "$SWAP_FILE none swap defaults 0 0" >>/etc/fstab
echo 'vm.swappiness=10' >/etc/sysctl.d/90-mambo-swap.conf
sysctl -q -p /etc/sysctl.d/90-mambo-swap.conf

log 'Répertoire /opt/mambo'
install -d -m 0750 /opt/mambo

log 'Agent SSM'
systemctl enable --now amazon-ssm-agent || log "Agent SSM introuvable : vérifiez l'AMI (Amazon Linux 2023)."

log 'Terminé. Étape suivante : créer /opt/mambo/.env puis lancer le workflow « Déploiement » (docs/DEPLOIEMENT.md).'
