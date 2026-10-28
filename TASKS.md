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

- [~] settings · navigation · pages · categories · services (lecture publique, cache, preview ; offres en carrousel des fiches, `ServiceOffer`) — back-office fait
  - [x] `GET /v1/site/settings`, `/site/navigation`, `/site/redirects`, `/pages/{key}`, `/zones`, `/sitemap`, `/categories`, `/categories/{slug}`, `/services`, `/services/{slug}` (`src/modules/*`)
  - [x] Langue (`?lang=fr|en`, fusion `translations` / colonnes `…En`, repli champ par champ : `src/common/i18n`), cache HTTP (`public, no-cache` + `ETag` → 304 : `src/common/http-cache`)
  - [x] Publication : statuts, `publishedAt`, rubrique publiée, zones actives, sections désactivées masquées ; aucun tarif ni prix exposé
  - [x] Tests unitaires des mappers et de la fusion des langues ; e2e `test/public-content.e2e-spec.ts` (double de Prisma, et base remplie par le seed en CI) ; `pnpm db:seed` en CI
  - [x] Prévisualisation (`?preview=` : jetons signés HMAC de 30 min, sans état) : brouillon d'une page (`isPreview`), fiche d'un service quel que soit son statut, `Cache-Control: private, no-store` ; rubriques : pas de jeton dans le contrat (version publiée)
  - [x] Back-office : `/v1/admin/services*` (liste et compteurs, détail, création, sauvegarde automatique avec `If-Match`/412, publication, dépublication, duplication, ordre, suppression, complétude, jeton d'aperçu), `/v1/admin/categories*` (carrousels d'offres, champs du devis, statut, ordre, suppression d'une rubrique vide), `/v1/admin/pages*` (brouillon, publication, abandon, jeton d'aperçu, HTML riche assaini), `/v1/admin/zones*` (quartiers déplacés d'une zone à l'autre, contours GeoJSON contrôlés, ordre), `/v1/admin/settings/{group}` (9 groupes, `analytics`/`securite` réservés aux administrateurs), `/v1/admin/system-status`, `/v1/admin/email-templates*` (variables contrôlées, aperçu React Email, envoi de test)
  - [x] Redirections 301 automatiques (slug ou rubrique d'un service publié, slug d'une rubrique publiée) ; demandes de revalidation inscrites (`revalidation_requests`, étiquettes du site) à chaque modification visible ; journal d'activité sans donnée personnelle
  - [x] Tests : unitaires (assainissement HTML, slugs, jetons d'aperçu, complétude, contours, fiches des e-mails) ; e2e `test/admin-catalog.e2e-spec.ts`, `test/admin-site-content.e2e-spec.ts` (double de Prisma, permissions par rôle dont MANAGER refusé en écriture, relecture par les routes publiques ; bloc base réelle)
  - [x] Usages des médias (`media_usages`) tenus à jour à l'enregistrement des contenus (services, rubriques, pages, paramètres SEO ; après la transaction, reconstruits au démarrage du worker) : module de la médiathèque
  - [ ] Textes anglais (`translations`, `…En`) des services, rubriques, pages et e-mails : aucune opération du contrat ne les modifie
  - [x] Pages : traduction anglaise « marquée comme revue » (28/10) — `PageTranslationInput.reviewedSectionIds` (≤ 40, `id` présents dans `sections` de l'envoi anglais, sinon 422 `translations.en.reviewedSectionIds.N`) : empreinte des textes français actuels du brouillon sans changer les textes anglais ; test unitaire `page-translations.spec.ts`, cas e2e dans `test/admin-site-content.e2e-spec.ts`
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
  - [x] Opérations du back-office (`src/modules/requests`, `src/modules/contacts`) : `/v1/admin/requests*` (liste filtrée, paginée, triée et compteurs, export CSV, détail, statut, assignation avec notification et e-mail `team-assignment`, échéance, notes, duplication, anonymisation), `/v1/admin/contacts*` (liste et indicateurs, export CSV, fiche, export RGPD, droit à l'effacement), `/v1/admin/me/tasks` ; périmètre `requests:read-assigned` ; journal d'activité
  - [x] Migration `20261027000000_search_keys` : clés de recherche sans accents (`contacts.search_text`, `contacts.city_key`, `requests.search_text`), tenues à jour par l'API et le seed
  - [x] Questionnaire programmé au passage d'un devis à « Prestation réalisée » (`surveys`, `SURVEY_SCHEDULED`) ; envoi et relance avec le module des questionnaires
  - [x] Tests : unitaires (CSV, clés de recherche, journée de Douala, libellés de l'historique, filtres) ; e2e `test/admin-requests.e2e-spec.ts`, `test/admin-contacts.e2e-spec.ts` (double de Prisma avec relations par clé ; bloc base réelle)
  - [x] `ACK_SENT` / `TEAM_ALERT_SENT` à l'envoi effectif des e-mails (module mail, `MailRecorder`)
  - [ ] `GET /v1/admin/requests/{id}/attachments/{attachmentId}` (URL signée) : avec le module de stockage ; purge des fichiers des demandes anonymisées
  - [x] Avis d'une demande anonymisée ou d'un contact effacé : nom affiché, ville et réponses retirés, avis masqué sans consentement, revalidation s'il était publié
- [x] mail (React Email, texte brut, gabarits Figma) + queue (BullMQ, réessais) — 21 gabarits, textes modifiables en base, 4 e-mails maquettés alignés, logo PNG, `pnpm mail:preview`
- [x] auth (argon2id, OTP e-mail, appareils de confiance, rotation des jetons, CSRF, verrouillage) · users (invitation, rôles)
  - [x] `/v1/auth/*` (9 opérations) : mot de passe argon2id, code à 6 chiffres (10 min, 5 essais, renvoi après 60 s), appareil de confiance `mp_td` (paramètre `trustedDeviceDays`), cookies `mp_at`/`mp_rt`/`mp_csrf`, rotation avec détection de réutilisation, verrouillage progressif, mot de passe oublié (réponse identique), réinitialisation et invitation à usage unique
  - [x] Garde globale fermée par défaut (`@Public()`), CSRF double-submit signé sur les mutations, permissions `@RequirePermissions` obligatoires sous `/v1/admin` (matrice du schéma `Role`) ; test qui compare chaque route aux `x-permissions` du contrat
  - [x] `/v1/admin/users*` et `/v1/admin/roles` : liste, présence (activité au plus une écriture par minute), invitation, modification, désactivation (sessions révoquées), suppression, réinitialisation ; journal d'activité
  - [x] Seed : mots de passe `SEED_ADMIN_PASSWORD` et `SEED_DEMO_PASSWORD` (développement) hachés en argon2id
  - [x] Tests : unitaires (permissions contre le contrat, JWT, politique des mots de passe) ; e2e `test/auth.e2e-spec.ts`, `test/admin-users.e2e-spec.ts` (doubles ; bloc base réelle)
  - [x] Contrat : 422 (login, verify-otp, resend-otp, forgot-password, PATCH users), 401 (resend-otp), 423 (verify-otp), 404 et 409 (DELETE et reset-password d'un utilisateur), 403 (logout), 429 (refresh), exemple `csrf-token-invalid` de `Forbidden` ; tests passés sur `expectContract`
  - [~] Contrat : 403 `Forbidden` absent des mutations à cookie hors auth/utilisateurs/demandes/contacts : ajouté pour services, rubriques, pages, zones, paramètres, e-mails, rendez-vous, avis, médias et magazine ; reste les autres modules
  - [ ] Site : appeler `POST /v1/auth/refresh` sur un 401 (jeton d'accès de 15 min) avant de rediriger vers la connexion
- [x] appointments + availability (créneaux, 409, confirmation `.ics`, proposition, rappel J-1 9 h Douala)
  - [x] Site (`src/modules/appointments`, `src/modules/forms`) : `GET /v1/appointments/availability` (plages, fermetures et horaires exceptionnels, rendez-vous qui occupent un créneau, délai minimal, horizon, format ; 62 jours au plus, `no-store`), `POST /v1/appointments` (anti-spam des formulaires, créneau proposé exigé → 422, pris → 409 `slot-taken`, demande `RENDEZ_VOUS` de même référence, e-mail « demande reçue », alerte de l'équipe), `POST /v1/appointments/{reference}/accept-proposal` (jeton HMAC, 410 expiré, 409 clos ou pris)
  - [x] Back-office : `/v1/admin/appointments*` (agenda d'une période et file « À confirmer », filtres statut et personne assignée, détail, saisie manuelle confirmée, `confirm`, `propose` (report), `cancel`, `complete`, `notes`, `assign` avec notification et e-mail `team-assignment`), `GET|PUT /v1/admin/availability` ; périmètre `appointments:read-assigned` / `write-assigned` ; journal d'activité sans donnée client
  - [x] Double réservation : verrou consultatif PostgreSQL dans chaque transaction qui prend un créneau, puis index unique partiel `appointments_active_slot_key` (P2002 → 409)
  - [x] E-mails au client dans sa langue (reçu, confirmé avec `.ics`, autre créneau, annulé, rappel) ; rappel la veille à `emails.appointmentReminderHour` par la file BullMQ `appointment-reminders` (tâche différée à identifiant stable, retirée au report, à l'annulation et à la fin ; envoi vérifié et marqué `reminderSentAt`)
  - [x] Fuseau `Africa/Douala` à décalage fixe (`src/common/time/agency-day.ts`)
  - [x] Contrat : 403 `Forbidden` des opérations du lot, 400 `InvalidQuery` (agenda), 409 `slot-taken` (saisie), 410 (exemple), 422 et 429 (acceptation), règles décrites ; site synchronisé
  - [x] Tests : unitaires (créneaux et changement d'heure européen, schémas, rappel, `.ics`, erreur P2002 de l'adaptateur `pg`, seed des disponibilités) ; e2e `test/appointments.e2e-spec.ts` (double de Prisma avec annulation des transactions et index uniques, permissions par rôle, CSRF, double réservation, rappel programmé et retiré ; bloc base réelle : réservations simultanées, index unique) et `test/appointment-reminders.e2e-spec.ts` (Redis réel)
  - [ ] Base réelle et Redis réel : non lancés sur la machine de développement (pas de Docker), à passer en CI
  - [ ] Compteur `appointments` des pastilles (`sidebar-counts`) et tableau de bord : avec le module du tableau de bord
- [~] surveys + reviews (invitation après « Prestation réalisée », relance J+3, jeton unique 30 j, consentement de publication)
  - [x] Site : `GET /v1/surveys/{token}` (questions actives localisées, 404 / 410 `survey-completed` / 410 `survey-expired`, `no-store`), `POST /v1/surveys/{token}/responses` (réponses contrôlées, réservation atomique, avis « À valider » vérifié seulement avec consentement et note, notification `REVIEW`), `GET /v1/reviews` et `/v1/reviews/summary`
  - [x] Back-office : `/v1/admin/reviews*` (liste et compteurs, ajout manuel non vérifié, statistiques, publication refusée sans consentement, mise en avant d'un avis publié seulement, service, suppression des seuls témoignages manuels, réponse), `GET|PUT /v1/admin/survey-questions` ; journal d'activité sans nom de client ; revalidation `reviews` / `service:*` / `category:*`
  - [x] File BullMQ `survey-invitations` : invitation après `emails.surveyDelayHours`, relance après `emails.surveyReminderDays`, expiration à 30 jours ; tâches à identifiant stable, réservation atomique ; reprise au démarrage du worker
  - [x] Contrat : 400 (listes), 403, 409 (mise en avant, suppression d'un avis vérifié), 422 ; règles décrites
  - [ ] Tests (unitaires, e2e) : après le branchement du site
  - [ ] Relance manuelle et liste des questionnaires du back-office : absentes du contrat (suivi dans le détail des demandes)
- [~] jobs + applications + storage (CV : signature de fichier, 5 Mo, stockage privé, URL signées, ClamAV optionnel)
  - [x] Stockage `src/modules/storage` (global) : interface `StorageDriver` (`put`, `get` en flux, `delete`, `check`), pilote disque local (`STORAGE_DRIVER=local`, `STORAGE_DIR`), clés aléatoires, écriture atomique `0600` ; type réel par signature (PDF, DOC, DOCX), 5 Mo, nom assaini ; liens signés HMAC de 5 min servis par `GET /v1/files/{token}` ; point d'accroche ClamAV désactivé (`SKIPPED`)
  - [x] Site : `GET /v1/jobs` (filtres `city`, `contract`, `q`, `lang`), `GET /v1/jobs/{slug}` (404 brouillon, 410 `job-closed` archivée ou expirée), `POST /v1/job-applications` (multipart, anti-spam des formulaires, 413 / 415 / 422, demande `CANDIDATURE` + pièce jointe `CV` + candidature, e-mails `application-received` et `team-new-request`)
  - [x] Back-office : `/v1/admin/jobs*` (liste avec compteurs, création, modification et publication, suppression ; revalidation `jobs` / `job:*` / `sitemap`, redirection 301 au changement d'adresse), `/v1/admin/applications*` (liste paginée, détail → « Lu », statut, lien signé du CV), `GET /v1/admin/requests/{id}/attachments/{attachmentId}`
  - [x] RGPD : fichiers supprimés du stockage à l'anonymisation d'une demande et à l'effacement d'un contact (noms `fichier-anonymise`)
  - [x] Contrat : `GET /v1/files/{token}` ajouté ; 400 / 403 / 422 manquants des routes du lot
  - [ ] Tests (unitaires, e2e) : après le branchement du site
  - [ ] Pilote S3 (aucune dépendance S3 installée), `checks.storage` de `/v1/health`, suppression des candidatures refusées après la durée de conservation, duplication / ordre / notes des offres et candidatures (absents du contrat)
- [~] partners · trainings · events
  - [x] Site : `GET /v1/partners` (visibles, `category`, libellés traduits), `GET /v1/trainings` (publiées, `category`, `translations.en`), `GET /v1/events` (`upcoming`, `limit`, `page`, places restantes)
  - [x] Back-office : `/v1/admin/partners*` (ajout, modification dont visibilité, ordre par catégorie, suppression), `/v1/admin/trainings*` (création en brouillon, slug libre, publication, ordre, suppression), `GET /v1/admin/training-requests`, `/v1/admin/events*` (période, inscrits et places réservées, détail avec inscriptions, capacité ≥ places réservées) ; audit, revalidation `partners` / `page:partenaires`, `trainings` / `page:formation`, `events`
  - [ ] Tests (unitaires, e2e) : après le branchement du site
  - [ ] Export CSV des inscrits d'un événement : absent du contrat (inscriptions = demandes `EVENEMENT`, export des demandes)
- [~] newsletter (double opt-in, segments, campagnes par lots, `List-Unsubscribe`, export, mesure optionnelle)
  - [x] Site : `POST /v1/newsletter/subscriptions` (anti-spam, consentement horodaté, lien à usage unique valable 7 jours, e-mail `newsletter-confirm`), `confirm` (410 lien expiré), `unsubscribe` (jeton signé sans état, JSON ou `List-Unsubscribe=One-Click` avec `?token=`, idempotent) ; confirmation envoyée aussi après l'inscription avec la case newsletter
  - [x] Back-office : `/v1/admin/subscribers*` (liste, export CSV des confirmés, suppression), `/v1/admin/campaigns*` (indicateurs, segments avec effectifs, brouillon HTML assaini, aperçu réel, test, programmation, annulation, envoi immédiat ; 409 hors brouillon / programmée)
  - [x] File BullMQ `newsletter-campaigns` : départ à l'heure programmée (réservation atomique), envois individuels uniques par abonné, lots de 50 par minute, identifiant de tâche par envoi, clôture `ENVOYEE` quand plus rien n'est en attente, reprise au démarrage du worker ; en-têtes `List-Unsubscribe` + `List-Unsubscribe-Post`
  - [ ] Tests (unitaires, e2e) : après le branchement du site
  - [ ] Mesure d'ouverture et de clic : `opens` / `clicks` à `null` sans l'option `analytics.newsletterTracking` ; aucun pixel ni lien de suivi (absents du contrat)
  - [ ] Purge des inscriptions jamais confirmées (tâche RGPD quotidienne), détail d'un inscrit et préférences (absents du contrat)
- [~] magazine (éditions, articles, aperçu, envoi par la newsletter)
  - [x] Back-office : `/v1/admin/magazine*` (tableau de bord et dernière campagne, éditions : création avec numéro suivant ou hors-série, modification, 409 numéro pris, suppression d'une édition non publiée, publication immédiate ou programmée, dépublication, articles dans l'ordre de lecture, jeton d'aperçu ; articles : liste filtrée, création, modification, suppression) ; HTML assaini, médias contrôlés, audit, revalidation `page:magazine`
  - [x] Newsletter d'une édition : test (une version par langue complète), programmation = une campagne par langue (`Campaign.language`, inscrits de cette langue ; français pour les anglophones tant que l'anglais est incomplet), même file et même liste que les campagnes, contenu régénéré à chaque modification, annulé à la dépublication
  - [x] Site : `GET /v1/magazine` ajouté au contrat (édition affichée, éditions publiées, `lang`, `edition`, `?preview=`)
  - [x] Contrat : 403 des opérations du magazine, 400 (liste des articles), 422 (test)
  - [ ] Site : lire `GET /v1/magazine` dans la page Magazine (aujourd'hui : sections de la page `magazine`) ; revalidation à la date d'une édition programmée (tâche planifiée)
  - [ ] Tests (unitaires, e2e) : après le branchement du site
- [x] media (sharp : AVIF/WebP 480/960/1600, SVG assaini, point focal)
  - [x] `/v1/admin/media*` : liste (`q`, `status`, `used`), détail, envoi (type réel, 10 Mo, 50 Mpx, EXIF/GPS retirés, orientation), remplacement du fichier, texte alternatif et point focal, suppression refusée si utilisée (409 `media-in-use`) ; revalidation des contenus qui l'utilisent
  - [x] Variantes en tâche de fond (file `media`, `PROCESSING` → `READY`/`FAILED`), fichiers publics `GET /v1/media/{folder}/{file}` (répertoire `MEDIA_STORAGE_DIR` distinct des fichiers privés, cache immuable)
  - [ ] Tests unitaires et e2e du lot (après le branchement du site) ; pilote S3 des médias
- [x] dashboard · search · notifications · audit · mesure d'audience
  - [x] `GET /v1/admin/dashboard` (KPI et période précédente, graphique jours / semaines / mois, rubriques, dernières demandes, « à faire », questionnaires, newsletter, visites de la mesure interne), `GET /v1/admin/sidebar-counts` : périmètre des permissions (`…-assigned`, 0 sans permission), demandes, rendez-vous et candidatures de demandes anonymisées exclus
  - [x] `GET /v1/admin/search` (demandes, contacts, services, offres, pages ; sans accents ; groupes selon les permissions), `GET|PATCH /v1/admin/notifications*`, `GET /v1/admin/audit-log` (filtres, `diff` déduit des états avant / après)
  - [x] `GET /v1/search` (site public : services, rubriques, pages, articles, offres, formations ; sans accents, pluriels simples, extraits et plages surlignées, cache 5 min)
  - [x] `POST /v1/analytics/events` (JSON ou `text/plain`, origine du site, 16 Kio, 30 lots/min, robots ignorés, agrégats quotidiens sans IP ni agent utilisateur, condensat HMAC du visiteur avec consentement) et `GET /v1/admin/analytics/summary`
  - [ ] Tests (unitaires, e2e) : après le branchement du site
- [x] Revalidation du site : tâche planifiée `revalidation` (toutes les 15 s, étiquettes regroupées par paquets de 100, `Authorization: Bearer REVALIDATE_SECRET`, réessais 30 s × 2ⁿ, `SUCCEEDED` / `FAILED` après 8 tentatives) ; revalidation `page:magazine` à la date des éditions programmées (toutes les 5 min)
- [~] Tâches planifiées (file `maintenance`, worker `MAIL_WORKER=on`) : nettoyage RGPD quotidien (contacts inactifs, candidatures refusées, inscriptions non confirmées, jetons et sessions, journaux, audience 13 mois, fichiers orphelins) ; sauvegarde `pg_dump` locale (`BACKUP_DIR`, rotation 30 jours, `pnpm db:backup`)
  - [ ] Copie des sauvegardes vers S3 (aucune dépendance S3 : point d'extension documenté) ; restauration testée (EXPLOITATION)
- [x] Correctifs du branchement : lien de recherche des articles d'une édition ancienne (`?edition=`), `lang` des formulaires publics au contrat (`SubmissionLanguage`, repli `Accept-Language`), édito complet et signature « Nom — Fonction » du seed, `jobTitle` des candidatures et filtre `spontaneous` sans les offres supprimées, objet « [TEST] » des tests de modèles d'e-mails

## Phase 3 — Intégration

- [ ] E2E sur la pile Docker complète avec le site

## Phase 4 — Production

- [x] Dockerfile multi-étapes (non-root, HEALTHCHECK, `pg_dump` 18, cibles `runtime` et `tools`), `deploy/docker-compose.prod.yml` + Caddy (sslip.io en attendant un domaine), Mailpit interne, `deploy/bootstrap.sh` (Amazon Linux 2023)
- [x] Déploiement : workflow manuel `deploy.yml` (image ECR par OIDC, `deploy/deploy.sh` par SSM : migrations, `up --wait`, santé)
- [ ] Premier déploiement réel sur l'instance EC2 et seed de production
- [ ] Envoi réel des e-mails (fournisseur SMTP, SPF/DKIM) ; domaine commun site/API pour le back-office (`COOKIE_DOMAIN`)
- [ ] Tests de charge k6 (50 utilisateurs simultanés), `pnpm audit` sans vulnérabilité haute
- [~] Documentation : README (5 commandes), DEPLOIEMENT (fait), EXPLOITATION (sauvegardes, restauration testée, secrets), ARCHITECTURE
- [ ] `RAPPORT_DE_LIVRAISON.md`
