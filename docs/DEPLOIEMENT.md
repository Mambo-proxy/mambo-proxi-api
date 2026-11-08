# Déploiement en production (VPS)

Serveur unique : VPS Contabo, Ubuntu 24.04. Le site (`mambo-proxi-web`) et l'API tournent dans la même pile Docker
Compose, derrière Caddy (HTTPS Let's Encrypt). Images dans le registre GitHub (`ghcr.io`), déploiement par SSH depuis
GitHub Actions.

| Élément                 | Valeur                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Site                    | `https://mamboproxi.com` (`www.mamboproxi.com` redirigé), variable `WEB_DOMAIN`                                                                |
| API                     | `https://api.mamboproxi.com`, variable `API_DOMAIN`                                                                                            |
| Images                  | `ghcr.io/mambo-proxy/mambo-proxi-api` (`<sha>`, `tools-<sha>`), `ghcr.io/mambo-proxy/mambo-proxi-web`                                          |
| Accès au serveur        | SSH par clé : `root` (administration) et `deploy` (déploiements, groupe `docker`)                                                              |
| Fichiers sur le serveur | `/opt/mambo` : `docker-compose.prod.yml`, `Caddyfile`, `deploy.sh`, `deploy-web.sh`, `.env` (secrets, hors dépôt), `.deployed-tag`, `.web-tag` |

## Architecture

```text
Internet ──443/80──▶ caddy ──┬──▶ web:3000   mamboproxi.com (Next.js autonome, cache ISR dans le volume web-cache)
                             └──▶ api:4000   api.mamboproxi.com
                                   │
             api = API + workers (MAIL_WORKER=on : e-mails, médias, rappels, campagnes, tâches planifiées)
                       ├──▶ postgres:5432 (PostgreSQL 18, volume postgres-data)
                       ├──▶ redis:6379 (BullMQ, AOF, noeviction, volume redis-data)
                       └──▶ smtp.resend.com:465 (e-mails, domaine mamboproxi.com vérifié)
```

- Le site appelle l'API depuis le serveur par le réseau interne (`API_INTERNAL_URL=http://api:4000`) et depuis le
  navigateur en direct (`https://api.mamboproxi.com`). Cookies de session sur `.mamboproxi.com` (`COOKIE_DOMAIN`) :
  aucun relais nécessaire.
- **Volumes** : `postgres-data`, `redis-data`, `storage` (CV et pièces jointes), `media` (médiathèque), `backups`,
  `web-cache`, `caddy-data` (certificats).
- **Mémoire** (limites) : api 1 Go, web 768 Mo, postgres 1 Go, redis 192 Mo, caddy 256 Mo.
- **Pare-feu** (ufw) : 22/tcp, 80/tcp, 443/tcp, 443/udp. PostgreSQL et Redis ne sont pas publiés.
- **Journaux** : `json-file`, 5 fichiers de 10 Mo par conteneur.

## Première mise en place

### 1. DNS (chez le registrar de mamboproxi.com)

| Type | Nom   | Valeur    |
| ---- | ----- | --------- |
| A    | `@`   | IP du VPS |
| A    | `www` | IP du VPS |
| A    | `api` | IP du VPS |

Plus les enregistrements donnés par Resend (étape 4). Supprimer tout ancien enregistrement `@`/`www` pointant vers
un autre hébergeur. Vérification : `nslookup api.mamboproxi.com`.

### 2. Serveur

```bash
# Depuis le poste : clé dédiée au serveur (sans phrase de passe pour la clé de déploiement)
ssh-keygen -t ed25519 -f ~/.ssh/mambo_vps -C admin-mambo
ssh-keygen -t ed25519 -f ~/.ssh/mambo_deploy -N '' -C github-deploy
ssh-copy-id -i ~/.ssh/mambo_vps.pub root@<IP>          # mot de passe root fourni par Contabo
scp deploy/bootstrap.sh root@<IP>:/root/
ssh -i ~/.ssh/mambo_vps root@<IP> 'bash /root/bootstrap.sh'
# Clé de déploiement pour l'utilisateur deploy, puis relance (durcit SSH : clés seulement)
ssh -i ~/.ssh/mambo_vps root@<IP> 'cat >> /home/deploy/.ssh/authorized_keys' < ~/.ssh/mambo_deploy.pub
ssh -i ~/.ssh/mambo_vps root@<IP> 'bash /root/bootstrap.sh'
```

`bootstrap.sh` installe Docker (dépôt officiel), ufw, fail2ban, les mises à jour de sécurité automatiques, un échange
de 2 Go, l'utilisateur `deploy` et `/opt/mambo`. Relançable sans risque.

### 3. Secrets GitHub (les deux dépôts)

- Secrets : `VPS_HOST` (IP), `VPS_USER` (`deploy`), `VPS_SSH_KEY` (contenu de `~/.ssh/mambo_deploy`),
  `VPS_KNOWN_HOSTS` (sortie de `ssh-keyscan -t ed25519 <IP>`).
- Variables du dépôt du site : `NEXT_PUBLIC_API_URL=https://api.mamboproxi.com`,
  `NEXT_PUBLIC_SITE_URL=https://mamboproxi.com`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (clé publique Turnstile du
  domaine), facultatives : `NEXT_PUBLIC_MEDIA_URL`, `NEXT_PUBLIC_MAP_TILES_URL`, `NEXT_PUBLIC_MAP_TILES_CREDIT`.

### 4. E-mails (Resend)

Resend → Domains → `mamboproxi.com` (région UE) : ajouter au DNS les enregistrements affichés (DKIM `resend._domainkey`,
MX et TXT SPF du sous-domaine `send`), attendre « Verified ». Créer une clé d'API « Sending access » limitée au domaine :
c'est `SMTP_PASSWORD`. Conseillé : un TXT `_dmarc` `v=DMARC1; p=none; rua=mailto:contact@mamboproxi.com`.

### 5. Fichier `.env`

En `deploy` sur le serveur : copier `deploy/.env.production.example` dans `/opt/mambo/.env` (`chmod 600`) et remplir
`ACME_EMAIL`, `POSTGRES_PASSWORD`, `REVALIDATE_SECRET`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`TOKEN_SIGNING_SECRET`, `TURNSTILE_SECRET_KEY`, `SMTP_PASSWORD`, `SEED_ADMIN_PASSWORD`. Secrets : `openssl rand -hex 32`.
En cas de reprise des données d'un autre serveur, reprendre **les mêmes** `POSTGRES_PASSWORD`, secrets JWT et
`TOKEN_SIGNING_SECRET` (sinon sessions et liens signés en cours deviennent invalides).

### 6. Premiers déploiements

1. API : `gh workflow run deploy.yml` dans ce dépôt (construit, pousse, copie `deploy/` dans `/opt/mambo`, migre,
   démarre). Caddy obtient les certificats au premier accès : `curl https://api.mamboproxi.com/v1/health`.
2. Site : `gh workflow run deploy.yml` dans `mambo-proxi-web`, puis `curl https://mamboproxi.com/health`.
3. Seed (base vierge seulement, une fois) :

   ```bash
   cd /opt/mambo
   IMAGE_TAG=$(cat .deployed-tag) docker compose -f docker-compose.prod.yml --profile tools \
     run --rm -e SEED_DEMO=false migrate prisma db seed
   ```

## Déploiement courant

- API : GitHub → Actions → « Déploiement » → _Run workflow_. `deploy.sh` : images de l'API, PostgreSQL et Redis,
  `prisma migrate deploy`, `docker compose up -d --wait`, contrôle de `/v1/health`, nettoyage des images. Le site
  en place (`.web-tag`) n'est pas modifié.
- Site : même workflow dans `mambo-proxi-web` (`deploy-web.sh` : image du site, redémarrage du service `web`).
- Retour arrière : `bash /opt/mambo/deploy.sh <sha>` ou `bash /opt/mambo/deploy-web.sh <sha>` (les migrations ne sont
  pas annulées). À la main, se connecter d'abord au registre avec un jeton GitHub « read:packages » :
  `docker login ghcr.io -u <compte>`.

## Exploitation

```bash
ssh -i ~/.ssh/mambo_vps root@<IP>
cd /opt/mambo
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail 200 api   # ou web, caddy
```

Maintenance du site : `MAINTENANCE_MODE=on` dans `.env`, puis `bash deploy-web.sh $(cat .web-tag)`.

## Sauvegardes et restauration

- **Base** : tâche planifiée de l'API à 2 h (heure de Douala), `pg_dump` dans le volume `backups`, rotation 30 jours.
  Sauvegarde immédiate :
  `docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U mambo -Fc mambo_proxi > /root/manuel.dump`.
- **Hors serveur** (indispensable : un seul disque) : instantanés Contabo (panneau client) avant chaque opération
  délicate, et copie régulière de `/var/lib/docker/volumes/mambo_{backups,media,storage}/_data` vers un autre stockage
  (Contabo Object Storage ou poste local par `rsync`).

Restauration d'une sauvegarde :

```bash
cd /opt/mambo
docker compose -f docker-compose.prod.yml stop api
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore --clean --if-exists --no-owner -U mambo -d mambo_proxi \
  < /var/lib/docker/volumes/mambo_backups/_data/mambo-proxi-AAAAMMJJ-HHMMSS.dump
docker compose -f docker-compose.prod.yml start api
```

## Reprise des données d'un autre serveur

Sur l'ancien serveur, API arrêtée (`docker compose stop api`) pour figer les données :

```bash
cd /opt/mambo
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U mambo -Fc mambo_proxi > /root/mambo.dump
tar -C /var/lib/docker/volumes -czf /root/mambo-files.tgz mambo_media/_data mambo_storage/_data
```

Sur le VPS, après le premier déploiement de l'API (base créée, migrations appliquées) :

```bash
cd /opt/mambo
docker compose -f docker-compose.prod.yml stop api
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore --clean --if-exists --no-owner -U mambo -d mambo_proxi < /root/mambo.dump
tar -C /var/lib/docker/volumes -xzf /root/mambo-files.tgz
chown -R 1000:1000 /var/lib/docker/volumes/mambo_media/_data /var/lib/docker/volumes/mambo_storage/_data
bash deploy.sh $(cat .deployed-tag)   # migrations éventuelles, redémarrage
```

## Coûts indicatifs

VPS Contabo (Cloud VPS 10 : 4 vCPU, 8 Go, 75 Go NVMe) ≈ 5 à 7 € par mois, domaine ≈ 10 à 15 € par an, Resend gratuit
jusqu'à 3 000 e-mails par mois (100 par jour), registre GitHub gratuit pour un usage modéré.
