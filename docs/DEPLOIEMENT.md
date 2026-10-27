# Déploiement de l'API en production

Serveur unique AWS : EC2 `t3.small` (x86_64, 2 Go de RAM + 2 Go d'échange), Amazon Linux 2023, disque EBS gp3 de
30 Go, région `eu-west-3` (Paris). Tout tourne en conteneurs Docker Compose ; aucun accès SSH (SSM Session Manager).

| Élément                 | Valeur                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| Instance                | `i-052b02745fc7639ae`, étiquette `Name=mambo-proxi-api`                                          |
| IP élastique            | `13.38.208.248`                                                                                  |
| Adresse de l'API        | `https://13-38-208-248.sslip.io` (variable `API_DOMAIN`, en attendant un domaine)                |
| Registre d'images       | `168692730521.dkr.ecr.eu-west-3.amazonaws.com/mambo-proxi-api`                                   |
| Rôle GitHub (OIDC)      | `arn:aws:iam::168692730521:role/mambo-proxi-api-deploy` (variable `AWS_DEPLOY_ROLE_ARN`)         |
| Fichiers sur le serveur | `/opt/mambo` : `docker-compose.prod.yml`, `Caddyfile`, `deploy.sh`, `.env` (secrets, hors dépôt) |

## Architecture

```text
Internet ──443/80──▶ caddy (HTTPS Let's Encrypt, compression, en-têtes) ──▶ api:4000
                                                                           │
             api = API + workers (MAIL_WORKER=on : e-mails, médias, rappels, campagnes, tâches planifiées)
                       ├──▶ postgres:5432 (PostgreSQL 18, volume postgres-data)
                       ├──▶ redis:6379 (BullMQ, AOF, noeviction, volume redis-data)
                       └──▶ mailpit:1025 (e-mails retenus, interface sur 127.0.0.1:8025 du serveur)
```

- **Une seule image** (`Dockerfile`, cible `runtime`) : `node dist/main.js`, utilisateur `node`, `HEALTHCHECK` sur
  `GET /v1/health`, `pg_dump` 18 pour la sauvegarde. Les workers tournent dans le processus de l'API (une seule
  instance : moins de mémoire, les tâches planifiées ne s'exécutent qu'une fois). L'image `tools-<sha>` (cible
  `tools`) sert aux migrations et au seed.
- **Volumes** : `postgres-data`, `redis-data`, `storage` (CV et pièces jointes, `STORAGE_DIR`), `media` (médiathèque,
  `MEDIA_STORAGE_DIR`), `backups` (`BACKUP_DIR`), `caddy-data` (certificats), `mailpit-data`.
- **Mémoire** (limites) : api 768 Mo (tas Node 512 Mo), postgres 512 Mo, redis 160 Mo, caddy 128 Mo, mailpit 96 Mo.
- **Ports ouverts** (groupe de sécurité) : 80/tcp, 443/tcp, 443/udp (HTTP/3). Rien d'autre : PostgreSQL, Redis et
  Mailpit ne sont pas publiés.
- **Journaux** : `json-file`, 5 fichiers de 10 Mo par conteneur.

## Première mise en place

1. **Serveur** : `deploy/bootstrap.sh` en « user data » de l'instance, ou dans une session SSM :
   `sudo bash bootstrap.sh` (Docker, plugin compose, échange de 2 Go, `/opt/mambo`). Relançable sans risque.
   Rôle d'instance : `AmazonSSMManagedInstanceCore` + lecture ECR (`AmazonEC2ContainerRegistryReadOnly`).
2. **Fichier `.env`** (session SSM, en root) : copier `deploy/.env.production.example` dans `/opt/mambo/.env`
   (`sudo nano /opt/mambo/.env`, `chmod 600`), puis remplir : `ACME_EMAIL`, `POSTGRES_PASSWORD`, `WEB_URL`,
   `REVALIDATE_SECRET`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TOKEN_SIGNING_SECRET`, `TURNSTILE_SECRET_KEY`,
   `SEED_ADMIN_PASSWORD`. Secrets : `openssl rand -hex 32` (hexadécimal, rien à échapper).
3. **Premier déploiement** : GitHub → Actions → « Déploiement » → _Run workflow_ (ou
   `gh workflow run deploy.yml`). Le workflow construit et pousse les images, copie les fichiers de `deploy/` dans
   `/opt/mambo`, applique les migrations et démarre tout. Caddy obtient le certificat au premier accès
   (`curl https://13-38-208-248.sslip.io/v1/health`).
4. **Seed** (une seule fois, données de référence sans démonstration, compte administrateur initial) :

   ```bash
   cd /opt/mambo
   sudo IMAGE_TAG=$(cat .deployed-tag) docker compose -f docker-compose.prod.yml --profile tools \
     run --rm -e SEED_DEMO=false migrate prisma db seed
   ```

   Il crée `SEED_ADMIN_EMAIL` avec le mot de passe `SEED_ADMIN_PASSWORD` (haché en argon2id). Relançable : les
   données existantes ne sont jamais écrasées. Retirer ensuite `SEED_ADMIN_PASSWORD` du `.env`.

5. **Première connexion** au back-office : mot de passe, puis code à 6 chiffres envoyé par e-mail → à lire dans
   Mailpit (ci-dessous). Changer ensuite le mot de passe. Les autres comptes sont invités depuis le back-office.

## Déploiement courant

GitHub → Actions → « Déploiement » → _Run workflow_ sur la branche voulue (case « Déployer » décochée : image
seulement). Étapes de `deploy.sh` : connexion ECR, `docker compose pull`, PostgreSQL et Redis démarrés,
`prisma migrate deploy` (conteneur à usage unique), `docker compose up -d --wait`, contrôle de `/v1/health`,
suppression des images inutilisées de plus de 3 jours. Le workflow échoue si une étape échoue et affiche la sortie.

Retour à une version précédente (les migrations ne sont pas annulées) : `sudo /opt/mambo/deploy.sh <sha>`.

## Accès au serveur (SSM)

```bash
aws ssm start-session --target i-052b02745fc7639ae --region eu-west-3
sudo -i && cd /opt/mambo
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail 200 api
```

**E-mails (Mailpit)** — aucun envoi réel pour l'instant. Tunnel vers l'interface :

```bash
aws ssm start-session --target i-052b02745fc7639ae --region eu-west-3 \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["8025"],"localPortNumber":["8025"]}'
# puis http://localhost:8025
```

Envoi réel plus tard : renseigner `SMTP_HOST`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASSWORD` d'un fournisseur
(Amazon SES, Brevo…), domaine authentifié SPF/DKIM, puis relancer le déploiement.

## Sauvegardes et restauration

- **Base** : tâche planifiée de l'API à 2 h (heure de Douala), `pg_dump` au format personnalisé dans le volume
  `backups`, rotation 30 jours, suivi dans le tableau de bord (`backup_runs`). Sauvegarde immédiate (avant une
  opération délicate) :
  `docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U mambo -Fc mambo_proxi > /root/manuel.dump`.
- **Disque** : instantanés EBS quotidiens (Amazon Data Lifecycle Manager, conservation 7 jours) : couvrent aussi
  les fichiers (`storage`, `media`) et les certificats.
- **Copie hors serveur** (à prévoir) : `aws s3 sync /var/lib/docker/volumes/mambo_backups/_data s3://…` planifié.

Restauration d'une sauvegarde :

```bash
cd /opt/mambo
docker compose -f docker-compose.prod.yml stop api
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore --clean --if-exists --no-owner -U mambo -d mambo_proxi \
  < /var/lib/docker/volumes/mambo_backups/_data/mambo-proxi-AAAAMMJJ-HHMMSS.dump
docker compose -f docker-compose.prod.yml start api
```

Restauration complète : nouveau volume EBS depuis un instantané, attaché à la place du disque racine.

## Site et back-office sur deux domaines

- `WEB_URL` est l'**unique origine CORS** autorisée, la base des liens des e-mails et la cible de la revalidation
  (`POST {WEB_URL}/api/revalidate`). Tant que le site n'est pas en ligne, mettre une adresse https provisoire : la
  revalidation échoue (réessais puis abandon journalisé) sans gêner l'API.
- Les cookies d'authentification (`mp_at`, `mp_rt`, `mp_csrf`, `mp_td`) sont `SameSite=Lax`, `Secure` (API en
  https), domaine `COOKIE_DOMAIN`. Le site lit `mp_csrf` pour l'en-tête `X-CSRF-Token`. Conséquence : **le
  back-office ne fonctionne que si le site et l'API sont sur le même site** (même domaine enregistrable).
  `*.sslip.io` est un domaine à part (liste des suffixes publics) : avec le site sur Vercel ou sur un autre domaine,
  les cookies ne partent pas avec les appels du navigateur et `mp_csrf` est illisible. Le site public, lui,
  fonctionne (lectures et formulaires sans cookie).
- Solutions : un domaine commun (`mamboproxi.com` pour le site, `api.mamboproxi.com` pour l'API,
  `COOKIE_DOMAIN=.mamboproxi.com`) — recommandé ; ou, en attendant, un relais `/v1/*` côté site (réécriture Next.js
  vers l'API : le navigateur ne voit qu'une origine). `SameSite=None` n'est pas une solution (cookies tiers bloqués
  par Safari et Firefox).

## Passage à un vrai domaine

1. DNS : enregistrement `A` `api.mamboproxi.com` → `13.38.208.248`.
2. `/opt/mambo/.env` : `API_DOMAIN=api.mamboproxi.com`, `COOKIE_DOMAIN=.mamboproxi.com`, `WEB_URL=https://mamboproxi.com`.
3. Relancer le déploiement (ou `sudo /opt/mambo/deploy.sh $(cat /opt/mambo/.deployed-tag)`) : Caddy obtient le
   nouveau certificat. Côté site : `NEXT_PUBLIC_API_URL=https://api.mamboproxi.com`.

## Coûts indicatifs (eu-west-3, à la demande, hors taxes, octobre 2026)

| Poste                                  | Coût mensuel |
| -------------------------------------- | ------------ |
| EC2 t3.small (730 h)                   | ≈ 17 $       |
| EBS gp3 30 Go                          | ≈ 2,8 $      |
| IPv4 publique (IP élastique)           | ≈ 3,7 $      |
| Instantanés EBS (≈ 10 Go incrémentaux) | ≈ 0,5 $      |
| ECR (< 2 Go d'images)                  | ≈ 0,2 $      |
| Transfert sortant (premiers 100 Go)    | gratuit      |
| **Total**                              | **≈ 25 $**   |

Une instance réservée ou un Savings Plan d'un an réduit le poste EC2 d'environ 35 %.
