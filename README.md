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

## Données de départ

```bash
pnpm db:seed            # remplir la base (relançable sans doublon)
SEED_DEMO=false pnpm db:seed   # données de référence seulement (production)
pnpm db:purge-demo      # supprimer toutes les données de démonstration (isDemo)
```

- **Données de référence** (contenus des maquettes) : paramètres et coordonnées provisoires, navigation, 16 pages en
  français et en anglais, 5 rubriques, 22 services et 4 formules, offres, zones et quartiers de Douala, médias,
  modèles d'e-mails, questions du questionnaire, disponibilités. Créées si elles manquent, jamais écrasées.
- **Données de démonstration** (marquées `isDemo`, dates relatives au jour du lancement) : avis, demandes et
  historique, rendez-vous, contacts et inscrits, candidatures, événements, formations, partenaires, offres
  d'emploi, magazine, campagnes, notifications et journal, service en brouillon « Visites guidées ». Remises à l'état des maquettes à chaque lancement.
- **Comptes** : administrateur `SEED_ADMIN_EMAIL` / `SEED_ADMIN_NAME` (créé s'il n'existe pas) et, avec les
  données de démonstration, Carine Eboa (MANAGER), Paul Ngando (AGENT), Équipe Douala (EDITOR) et Grace Nkongo
  (WRITER). Mots de passe hachés en argon2id, jamais écrits en clair :
  - administrateur : `SEED_ADMIN_PASSWORD`, appliqué à la création (ou si le compte n'a pas encore de mot de passe) ;
    en production, une valeur longue et aléatoire (la valeur d'exemple `change-me…` est ignorée), à changer ensuite
    par « Mot de passe oublié » ;
  - comptes de démonstration : `SEED_DEMO_PASSWORD` (développement et tests uniquement ; ignorée par le seed et
    refusée au démarrage de l'API en production) ;
  - sans variable, le compte est créé sans mot de passe : « Mot de passe oublié » sur la page de connexion envoie le
    lien qui le définit.
- Les images sont celles livrées avec le site (`/photos/…`, `/illustrations/…`) : leur adresse relative est
  enregistrée telle quelle, sans téléversement dans le stockage S3.
- Les fichiers `prisma/seed/data/*.json` reprennent les mocks du site (`mambo-proxi-web/src/mocks`).

## Authentification du back-office

Connexion par e-mail et mot de passe (argon2id), puis code à 6 chiffres envoyé par e-mail (10 min, 5 essais, renvoi
après 60 s), sauf sur un appareil de confiance (cookie `mp_td`, 30 jours, paramètre `securite.trustedDeviceDays`).

- Cookies `httpOnly`, `SameSite=Lax`, `Secure` dès que `API_URL` est en https, domaine `COOKIE_DOMAIN` : `mp_at`
  (jeton d'accès JWT de 15 min, `JWT_ACCESS_SECRET`), `mp_rt` (jeton de rafraîchissement rotatif, session de 7 jours
  ou 30 avec « Rester connecté »), `mp_csrf` (lisible, à recopier dans l'en-tête `X-CSRF-Token` de toute mutation).
- Rotation à chaque `POST /v1/auth/refresh` ; la réutilisation d'un jeton déjà remplacé révoque toutes les sessions
  de l'utilisateur. Verrouillage progressif après 5 erreurs de mot de passe (15 min, puis 30, 60…).
- Toutes les routes exigent une session, sauf celles marquées `@Public()` (site public, connexion, santé) ; sous
  `/v1/admin`, chaque route déclare ses permissions (`@RequirePermissions`, `x-permissions` du contrat), sinon elle
  est refusée à tous. Matrice rôle → permissions : `src/modules/auth/permissions.ts` (schéma `Role` du contrat).
- En local, les codes et les liens (invitation, réinitialisation) arrivent dans Mailpit.

## Back-office : demandes et contacts

- `/v1/admin/requests*` : liste filtrée (type, statut, rubrique, pays, quartier, personne assignée, échéance,
  période, recherche), paginée et triée avec les compteurs des onglets ; export CSV ; détail ; statut, assignation et
  échéance (`PATCH`) ; notes internes ; duplication ; anonymisation. Un chargé de clientèle (`requests:read-assigned`)
  ne voit que ses demandes. `/v1/admin/me/tasks` : « Mes tâches » du tableau de bord.
- `/v1/admin/contacts*` : liste et indicateurs, export CSV, fiche, export RGPD (JSON), droit à l'effacement.
- Exports CSV : UTF-8 avec BOM, séparateur `;`, cellules entre guillemets, formules neutralisées (apostrophe devant
  `=`, `+`, `-`, `@`, sauf nombres et téléphones), inscrits au journal d'activité.
- Recherche et quartier sans accents ni casse (colonnes `search_text`, `city_key` : `docs/MODELE_DE_DONNEES.md`).

## Back-office : contenus

- `/v1/admin/services*` et `/v1/admin/categories*` : services et rubriques de tous statuts, création (slug et SEO
  pré-remplis), sauvegarde automatique (`If-Match` → 412 si la version a changé), publication et dépublication,
  duplication, ordre d'affichage, complétude, jeton d'aperçu (30 min). Un changement d'adresse d'un contenu publié
  crée une redirection 301 (`/v1/site/redirects`).
- `/v1/admin/pages*` : brouillon enregistré à côté de la version en ligne, publication, abandon, jeton d'aperçu
  (`/v1/pages/{key}?preview=`). Le HTML des pages légales est assaini côté serveur (`src/common/html/rich-text.ts`).
- `/v1/admin/zones*` : zones, quartiers (un quartier n'appartient qu'à une zone), contours GeoJSON contrôlés dans
  l'emprise du Cameroun, délais et tarifs indicatifs.
- `/v1/admin/settings/{group}`, `/v1/admin/system-status`, `/v1/admin/email-templates*` (aperçu rendu par les
  gabarits React Email, envoi de test).
- Le MANAGER lit les contenus sans pouvoir les modifier ; l'EDITOR et le WRITER les éditent ; `analytics` et
  `securite` sont réservés aux administrateurs. Chaque modification visible sur le site inscrit une demande de
  revalidation (`revalidation_requests`) ; les lectures publiques, relues à chaque requête (`ETag`), sont à jour
  aussitôt.

## Rendez-vous

- Site : `GET /v1/appointments/availability` (créneaux libres de 62 jours au plus, calculés à chaque appel :
  plages hebdomadaires − fermetures − rendez-vous à confirmer, confirmés ou proposés − délai minimal − horizon),
  `POST /v1/appointments` (anti-spam des formulaires ; demande `RENDEZ_VOUS` et rendez-vous « À confirmer » de même
  référence), `POST /v1/appointments/{reference}/accept-proposal` (lien de l'e-mail « autre créneau proposé »).
- Back-office : `/v1/admin/appointments*` (agenda d'une période et file « À confirmer », saisie manuelle confirmée,
  confirmation, report, annulation, fin, notes, assignation ; un chargé de clientèle ne voit que ses rendez-vous) et
  `/v1/admin/availability` (plages, fermetures et horaires exceptionnels, délai minimal, horizon, adresse de l'agence,
  lien de visio par défaut).
- Heures de Douala (UTC+1 toute l'année, sans heure d'été) converties avec un décalage fixe
  (`src/common/time/agency-day.ts`).
- Double réservation impossible : verrou consultatif PostgreSQL pendant toute écriture qui prend un créneau, et
  index unique partiel `appointments_active_slot_key` (violation → 409 `slot-taken`).
- E-mails au client dans sa langue : demande reçue, confirmation avec invitation `.ics`, autre créneau proposé,
  annulation, rappel la veille à l'heure `emails.appointmentReminderHour` (9 h). Le rappel est une tâche différée de
  la file BullMQ `appointment-reminders` (identifiant stable par rendez-vous et créneau, retirée au report et à
  l'annulation, envoi vérifié et marqué `reminderSentAt` au moment de l'exécution).

## E-mails

Les e-mails partent en arrière-plan par la file BullMQ `mail` (Redis) : `MailQueueService.enqueue(...)` ajoute une
tâche, le worker la rend (gabarit React Email + textes du modèle modifiable dans le back-office) et l'envoie par SMTP
avec une version texte brut. 5 tentatives à attente exponentielle (1, 2, 4, 8 min) ; tâches terminées purgées
(7 jours pour les réussies, 30 jours pour les échecs).

- En local, les e-mails arrivent dans **Mailpit** : http://localhost:8025 (`pnpm services:up`).
- `MAIL_WORKER=on|off` : démarre ou non les workers dans le processus (e-mails, rappels de rendez-vous,
  questionnaires, campagnes, médias et tâches planifiées ; `off` par défaut en test).
- Données attendues par chaque gabarit : `src/modules/mail/templates/README.md`.

```bash
pnpm mail:preview   # rend les 21 gabarits (FR et EN) dans tmp/mail-preview/ — ouvrir index.html
```

La prévisualisation utilise les textes par défaut et des données d'exemple, sans base ni Redis ; le logo est chargé
depuis `WEB_URL` (site local par défaut, `WEB_URL=https://mamboproxi.com pnpm mail:preview` pour le site en ligne).

## Tâches planifiées

Démarrées avec les workers (`MAIL_WORKER=on`), par la file BullMQ `maintenance` (« job schedulers » : une seule
exécution par échéance, même avec plusieurs instances) :

| Tâche                  | Fréquence        | Rôle                                                                                                                                                                                                                                 |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `revalidation`         | toutes les 15 s  | Envoie les demandes `revalidation_requests` en attente au site (`POST {WEB_URL}/api/revalidate`, `Authorization: Bearer REVALIDATE_SECRET`), étiquettes regroupées ; réessais 30 s × 2ⁿ, `FAILED` après 8                            |
| `magazine-publication` | toutes les 5 min | Demande la revalidation de `page:magazine` quand une édition programmée atteint sa date de publication (une fois par édition)                                                                                                        |
| `database-backup`      | 2 h (Douala)     | `pg_dump` dans `BACKUP_DIR` (rotation 30 jours), suivi dans `backup_runs` et le journal ; échec clair si `pg_dump` est absent (`PG_DUMP_PATH`)                                                                                       |
| `gdpr-cleanup`         | 3 h 30 (Douala)  | Durées de conservation : contacts inactifs (paramètre `rgpd`, 36 mois), candidatures refusées (24 mois), inscriptions newsletter non confirmées (30 j), sessions et jetons expirés, journaux, audience (13 mois), fichiers orphelins |

```bash
pnpm db:backup      # sauvegarde manuelle (même fichier que la tâche planifiée)
pg_restore --clean --if-exists --no-owner -d mambo_proxi var/backups/mambo-proxi-AAAAMMJJ-HHMMSS.dump
```

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
- `docs/DEPLOIEMENT.md` — production (EC2 + Docker Compose + Caddy, image ECR, déploiement par SSM, sauvegardes).
- `TASKS.md` — avancement.
- `JOURNAL.md` — décisions, difficultés et solutions, étape par étape.
