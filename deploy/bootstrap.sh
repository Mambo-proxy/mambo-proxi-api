#!/usr/bin/env bash
# Initialisation du VPS Ubuntu 24.04 (idempotente, sans aucun secret), à lancer en root :
#   bash bootstrap.sh
# Installe Docker (dépôt officiel, plugin compose compris), le pare-feu (SSH, HTTP, HTTPS), fail2ban, les mises à jour
# de sécurité automatiques, un fichier d'échange de 2 Go, l'utilisateur « deploy » (déploiements GitHub Actions) et
# /opt/mambo. Durcit SSH (clés seulement) uniquement si l'utilisateur deploy a déjà une clé autorisée.
set -euo pipefail

DEPLOY_USER=deploy
SWAP_FILE=/swapfile
SWAP_SIZE_MB=2048

log() { printf '[bootstrap] %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || {
  echo 'À lancer en root.' >&2
  exit 1
}
export DEBIAN_FRONTEND=noninteractive

log 'Paquets système'
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg ufw fail2ban unattended-upgrades

log 'Mises à jour de sécurité automatiques'
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF

log 'Docker (dépôt officiel)'
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
install -d -m 0755 /etc/docker
if [ ! -f /etc/docker/daemon.json ]; then
  cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true
}
JSON
  systemctl restart docker
fi
systemctl enable --now docker
docker compose version

log 'Pare-feu (22, 80, 443)'
# Les ports publiés par Docker (80/443 de Caddy uniquement) contournent ufw : rien d'autre n'est publié.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

log 'fail2ban (SSH)'
cat >/etc/fail2ban/jail.d/sshd.local <<'CONF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban

log "Fichier d'échange de ${SWAP_SIZE_MB} Mo"
if ! swapon --show=NAME --noheadings | grep -qx "$SWAP_FILE"; then
  if [ ! -f "$SWAP_FILE" ]; then
    fallocate -l "${SWAP_SIZE_MB}M" "$SWAP_FILE"
    chmod 600 "$SWAP_FILE"
    mkswap "$SWAP_FILE"
  fi
  swapon "$SWAP_FILE"
fi
grep -q "^$SWAP_FILE " /etc/fstab || echo "$SWAP_FILE none swap defaults 0 0" >>/etc/fstab
echo 'vm.swappiness=10' >/etc/sysctl.d/90-mambo-swap.conf
sysctl -q -p /etc/sysctl.d/90-mambo-swap.conf

log "Utilisateur $DEPLOY_USER (groupe docker)"
id "$DEPLOY_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

log 'Répertoire /opt/mambo'
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/mambo

log 'SSH'
if [ -s "/home/$DEPLOY_USER/.ssh/authorized_keys" ] && [ -s /root/.ssh/authorized_keys ]; then
  # 00- : lu avant 50-cloud-init.conf (PasswordAuthentication yes chez Contabo) ; la première valeur lue l'emporte.
  rm -f /etc/ssh/sshd_config.d/90-mambo.conf
  cat >/etc/ssh/sshd_config.d/00-mambo.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
  systemctl reload ssh
  log 'Connexion par mot de passe désactivée (clés seulement).'
else
  log "SSH non durci : ajoutez d'abord une clé dans /root/.ssh/authorized_keys et /home/$DEPLOY_USER/.ssh/authorized_keys, puis relancez."
fi

log 'Terminé. Étape suivante : créer /opt/mambo/.env puis lancer le workflow « Déploiement » (docs/DEPLOIEMENT.md).'
