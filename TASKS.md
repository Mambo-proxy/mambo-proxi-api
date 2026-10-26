# Liste des tâches — API

Légende : `[x]` fait · `[~]` en cours · `[ ]` à faire. Les tâches du site et du back-office sont dans `../mambo-proxi-web/TASKS.md`.

## Phase 0 — Préparation

- [x] Contrat `contracts/openapi.yaml` (OpenAPI 3.1) : 116 routes, schémas, exemples tirés des maquettes
- [x] Validation Redocly sans erreur ni avertissement (`pnpm contract:lint`)
- [x] `docker-compose.yml` de développement (PostgreSQL 18, Redis 8, S3 SeaweedFS, Mailpit)
- [x] `.env.example`, `CLAUDE.md`, `JOURNAL.md`, CI minimale (lint du contrat)
- [ ] Relecture finale du contrat formulaire par formulaire et écran par écran (après inventaire des cadres restants : questionnaire, 404, e-mails)

## Phase 2 — Backend complet

### Socle

- [~] Projet NestJS (TypeScript strict), configuration validée (zod), journaux pino sans données personnelles, Helmet, CORS strict, throttler, filtre d'erreurs RFC 9457, `/v1/health`
  - [x] Outillage : TypeScript 6 strict (ESM, `nodenext`), ESLint avec types, Prettier, Vitest + SWC (projets `unit` et `e2e`), scripts `package.json`
  - [x] Configuration validée par zod au démarrage (`src/config`), messages en français, obligatoire en production
  - [x] Journaux nestjs-pino (JSON / pino-pretty, masquage, `X-Request-Id`), Helmet, CORS limité au site, cookie-parser, arrêt propre, Swagger `/docs` hors production
  - [x] Filtre global RFC 9457 (`ProblemFilter`, `ProblemException`), `ZodValidationPipe` (422 corps / 400 paramètres), JSON illisible → `invalid-body`
  - [x] Limitation de débit globale (120 requêtes/min par IP, en-têtes `RateLimit-*` et `Retry-After`)
  - [x] `PrismaModule` global (adaptateur `pg`, connexion à la première requête)
  - [x] `GET /v1/health` (base de données + Redis ; 503 si une dépendance est indisponible)
  - [x] CI : job « API » (PostgreSQL et Redis en services, lint, format, types, build, migrations, tests)
  - [ ] Premier passage complet en local et en CI (lint, types, tests) ; vérification du stockage S3 dans `/v1/health` avec le module storage
- [ ] Prisma : schéma complet (docs/05 §2), migrations, seed (4 rubriques, 19 services, contenus de toutes les pages, démo marquée `demo` + `pnpm db:purge-demo`, admin initial, questions, modèles d'e-mails, paramètres)
- [~] Tests de contrat : validation de chaque réponse contre `openapi.yaml` (`test/contract.ts`, ajv 2020-12 : fait) ; diff du document `@nestjs/swagger` en CI (à faire)

### Modules (ordre docs/08)

- [~] settings · navigation · pages · categories · services (lecture publique, cache, preview ; offres en carrousel des fiches, `ServiceOffer`)
  - [x] `GET /v1/site/settings`, `/site/navigation`, `/site/redirects`, `/pages/{key}`, `/zones`, `/sitemap`, `/categories`, `/categories/{slug}`, `/services`, `/services/{slug}` (`src/modules/*`)
  - [x] Langue (`?lang=fr|en`, fusion `translations` / colonnes `…En`, repli champ par champ : `src/common/i18n`), cache HTTP (`public, no-cache` + `ETag` → 304 : `src/common/http-cache`)
  - [x] Publication : statuts, `publishedAt`, rubrique publiée, zones actives, sections désactivées masquées ; aucun tarif ni prix exposé
  - [x] Tests unitaires des mappers et de la fusion des langues ; e2e `test/public-content.e2e-spec.ts` (double de Prisma, et base remplie par le seed en CI) ; `pnpm db:seed` en CI
  - [ ] Prévisualisation (`?preview=` : jetons signés du back-office, brouillons) avec les modules admin
  - [ ] Premier passage des tests en local et en CI (non lancés sur la machine de développement)
- [~] Formulaires publics : quote-requests, contact-messages, registrations, training-requests, partner-requests, event-registrations (anti-spam Turnstile + piège + délai, limitation de débit)
  - [x] Six opérations du contrat (`src/modules/forms`) : `201 { reference, message }`, 400 `spam-check-failed`, 409 `event-full`, 422 `validation-error` (chemins et messages en français), 429 `rate-limited`
  - [x] Anti-spam partagé `src/common/anti-spam` : Turnstile côté serveur (`fetch`, 5 s, fermeture par défaut ; jeton vide et clé d'essai acceptés hors production), champ piège (succès factice sans enregistrement), délai minimal de 3 s
  - [x] Limitation de débit resserrée : 5 envois par minute, par IP et par formulaire (`PUBLIC_FORM_THROTTLE`)
  - [x] E-mails mis en file après l'enregistrement (`MailQueueService.enqueueMany`) : accusé de réception du type et alerte `team-new-request` à chaque destinataire du paramètre `emails` ; échec journalisé sans faire échouer l'envoi
  - [x] Tests : unitaires (anti-spam, références, mappers, schémas) ; e2e `test/public-forms.e2e-spec.ts` (doubles de Prisma, de Turnstile et de la file ; bloc base réelle `E2E_REAL_SERVICES=true`)
  - [ ] Limite journalière (30 envois par jour et par IP, docs/05 §3) : second limiteur nommé à ajouter
  - [ ] Premier passage des tests en local et en CI (non lancés sur la machine de développement)
- [~] contacts · requests (références `MP-AAAA-NNNN`, historique, notes, export CSV, anonymisation)
  - [x] Fiche contact créée ou mise à jour par e-mail normalisé (`src/modules/contacts`) : profil, structure, activité, ville et quartier, préférence de contact, langue, centres d'intérêt (inscription), abonnement newsletter préparé « en attente » (double opt-in)
  - [x] Création des demandes (`src/modules/requests`) : référence atomique (`ReferenceCounter`, année de Douala), statut `NOUVELLE`, échéance + 24 h, consentement horodaté (IP, agent utilisateur), historique `RECEIVED`, notifications de l'équipe (rôles `requests:read`)
  - [ ] Opérations du back-office : liste, détail, statut, assignation, notes, export CSV, anonymisation ; `ACK_SENT` / `TEAM_ALERT_SENT` à l'envoi effectif des e-mails (module mail)
- [x] mail (React Email, texte brut, gabarits Figma) + queue (BullMQ, réessais) — 21 gabarits, textes modifiables en base, 4 e-mails maquettés alignés, logo PNG, `pnpm mail:preview`
- [x] auth (argon2id, OTP e-mail, appareils de confiance, rotation des jetons, CSRF, verrouillage) · users (invitation, rôles)
  - [x] `/v1/auth/*` (9 opérations) : mot de passe argon2id, code à 6 chiffres (10 min, 5 essais, renvoi après 60 s), appareil de confiance `mp_td` (paramètre `trustedDeviceDays`), cookies `mp_at`/`mp_rt`/`mp_csrf`, rotation avec détection de réutilisation, verrouillage progressif, mot de passe oublié (réponse identique), réinitialisation et invitation à usage unique
  - [x] Garde globale fermée par défaut (`@Public()`), CSRF double-submit signé sur les mutations, permissions `@RequirePermissions` obligatoires sous `/v1/admin` (matrice du schéma `Role`) ; test qui compare chaque route aux `x-permissions` du contrat
  - [x] `/v1/admin/users*` et `/v1/admin/roles` : liste, présence (activité au plus une écriture par minute), invitation, modification, désactivation (sessions révoquées), suppression, réinitialisation ; journal d'activité
  - [x] Seed : mots de passe `SEED_ADMIN_PASSWORD` et `SEED_DEMO_PASSWORD` (développement) hachés en argon2id
  - [x] Tests : unitaires (permissions contre le contrat, JWT, politique des mots de passe) ; e2e `test/auth.e2e-spec.ts`, `test/admin-users.e2e-spec.ts` (doubles ; bloc base réelle)
  - [x] Contrat : 422 (login, verify-otp, resend-otp, forgot-password, PATCH users), 401 (resend-otp), 423 (verify-otp), 404 et 409 (DELETE et reset-password d'un utilisateur), 403 (logout), 429 (refresh), exemple `csrf-token-invalid` de `Forbidden` ; tests passés sur `expectContract`
  - [ ] Contrat : 403 `Forbidden` absent de ~70 mutations à cookie hors auth/utilisateurs (services, pages, avis, médias…), à ajouter avec leurs modules
  - [ ] Site : appeler `POST /v1/auth/refresh` sur un 401 (jeton d'accès de 15 min) avant de rediriger vers la connexion
- [ ] appointments + availability (créneaux, 409, confirmation `.ics`, proposition, rappel J-1 9 h Douala)
- [ ] surveys + reviews (invitation après « Prestation réalisée », relance J+3, jeton unique 30 j, consentement de publication)
- [ ] jobs + applications + storage (CV : signature de fichier, 5 Mo, stockage privé, URL signées, ClamAV optionnel)
- [ ] partners · trainings · events
- [ ] newsletter (double opt-in, segments, campagnes par lots, `List-Unsubscribe`, export, mesure optionnelle)
- [ ] media (sharp : AVIF/WebP 480/960/1600, SVG assaini, point focal)
- [ ] dashboard · search · notifications · audit
- [ ] Revalidation du site (`POST {WEB_URL}/api/revalidate` avec tags)
- [ ] Tâches planifiées : nettoyage RGPD quotidien, sauvegarde `pg_dump` vers S3 (rotation 30 jours)

## Phase 3 — Intégration

- [ ] E2E sur la pile Docker complète avec le site

## Phase 4 — Production

- [ ] Dockerfile multi-étapes (non-root, HEALTHCHECK), `docker-compose.prod.yml` + Caddy
- [ ] CI/CD : lint, types, tests, conformité au contrat, image GHCR, `prisma migrate deploy`, déploiement sur étiquette `v*`
- [ ] Tests de charge k6 (50 utilisateurs simultanés), `pnpm audit` sans vulnérabilité haute
- [ ] Documentation : README (5 commandes), DEPLOIEMENT, EXPLOITATION (sauvegardes, restauration testée, secrets), ARCHITECTURE
- [ ] `RAPPORT_DE_LIVRAISON.md`
