# Journal — mambo-proxi-api

## Phase 0 — Préparation (5 octobre 2026)

### Fait

- Lecture complète du dossier de pilotage (FIGMA.md, docs 01 → 08, catalogue, tokens, cahier des charges v1.2).
- Rédaction du contrat `contracts/openapi.yaml` (OpenAPI 3.1) : 116 routes (site public, formulaires, newsletter, questionnaire, authentification, back-office complet), 190 schémas, exemples tirés des maquettes (inventaires `../mambo-proxi-web/qa/inventory/`).
- Validation avec Redocly CLI 2.58 (`pnpm contract:lint`) : 0 erreur, 0 avertissement ; règles `operation-4xx-response` et `no-unused-components` en erreur.
- `docker-compose.yml` de développement, `.env.example` commenté, `CLAUDE.md`, `TASKS.md`, CI minimale (lint du contrat).

### Décisions

- **Chemins complets `/v1/...` dans le contrat** (serveur = origine) : le document généré par `@nestjs/swagger` avec le préfixe global aura les mêmes chemins, ce qui simplifie le diff de conformité en CI.
- **Sections de pages éditables** : union discriminée `PageSection` (13 types : `hero`, `marquee`, `steps`, `featureList`, `cardGrid`, `textMedia`, `quote`, `statsGrid`, `team`, `faq`, `richText`, `ctaBand`, `dynamic`). Les blocs alimentés par d'autres écrans (rubriques, avis, partenaires, formations, offres, formulaires, carte) sont des sections `dynamic` dont seuls l'en-tête et la visibilité sont éditables — conforme à docs/06 (« sections générées automatiquement non éditables ici »).
- **Mise en avant orange des titres** : balisage léger `==…==` dans les textes (`AccentText`), rendu en `text/brand` par le site.
- **Champs dynamiques du devis** (`QuoteField`) portés par la rubrique, administrables ; valeurs envoyées dans `needs`.
- **Anti-spam** commun à tous les envois publics : objet `antiSpam` (jeton Turnstile, champ piège, horodatage d'ouverture).
- **Formulaire de contact** : téléphone, pays et sujet facultatifs (conforme à la maquette Contact) ; le reste des formulaires impose le téléphone.
- **Type de partenariat « Autre »** ajouté (présent sur la maquette Partenaires) ; présentation de l'activité facultative (pas d'astérisque sur la maquette).
- **Rendez-vous** : le type de demande `RENDEZ_VOUS` est ajouté à `RequestType` pour que chaque RDV apparaisse aussi dans le suivi des demandes et l'historique du contact.
- **Stockage objet local : SeaweedFS 4.48** (compatible S3) au lieu de MinIO : les images communautaires MinIO ne sont plus publiées sur Docker Hub (vérifié le 5 octobre 2026). En production, tout fournisseur S3 (Scaleway, OVH, AWS) via les variables `S3_*`.
- **Versions figées** (vérifiées sur les registres le 5 octobre 2026) : PostgreSQL 18.4, Redis 8.10.2, Mailpit 1.31.4, pnpm 12.9.1, Node 24, Redocly CLI 2.58.1, actions GitHub checkout v7 / setup-node v7 / pnpm v6.
- **Prisma** : l'étiquette `latest` du paquet `prisma` pointe sur une version candidate (8.0.0-rc) ; la phase 2 utilisera la dernière version stable 7.x après vérification de la documentation.

### Difficultés et solutions

- **YAML et typographie française** : les deux-points et virgules des textes français (« Au choix : », « Oui, tout à fait ») cassaient ou altéraient silencieusement l'analyse YAML (une option coupée en deux éléments). Cause : valeurs non entre guillemets dans les objets écrits sur une ligne. Solution : script de correction qui met entre guillemets toute valeur à risque, puis vérification par analyse YAML et par Redocly ; règle retenue pour la suite : toujours mettre entre guillemets les textes contenant `:`, `,`, `?` ou `#`.
- **Quota de l'API Figma** (200 appels/jour, 15/min sur l'offre Professional) atteint pendant l'inventaire parallèle des écrans. Solution : un seul appel `get_design_context` par cadre complet (sortie analysée localement), plus d'appels en parallèle. Les cadres restants (questionnaire, 404, e-mails) seront relus au prochain créneau de quota.

### Points ouverts (incohérences relevées dans les maquettes, sans impact sur le contrat)

- Compteurs de démonstration non cohérents entre écrans (demandes de partenariat 1 vs 3, logos 12 vs 8, avis 125 vs 120) : données fictives, le seed reprendra des valeurs cohérentes.
- Slug du service de démonstration « Visites guidées de Douala » différent entre deux écrans : `visites-guidees-douala` retenu (généré depuis le nom).
- Licence MIT présente dans le dépôt depuis sa création sur GitHub, alors que le cahier des charges indique que le code appartient à la cliente : non modifiée, à confirmer avec la cliente (le `package.json` est marqué `UNLICENSED`).

## Phase 2 — Socle de l'API (26 octobre 2026)

### Fait

- Outillage : `tsconfig.json` (strict, `module`/`moduleResolution` `nodenext`, ES2023, décorateurs et métadonnées) et `tsconfig.build.json` ; ESLint « flat » (typescript-eslint avec vérification des types) ; Prettier aligné sur le site (guillemets simples, 110 colonnes) ; Vitest avec deux projets (`unit` : `src/**/*.spec.ts`, `e2e` : `test/**/*.e2e-spec.ts`) ; scripts de développement, de test et de base de données.
- Application : `src/main.ts`, `src/app.module.ts`, `src/app.setup.ts` (préfixe `/v1`, Helmet, CORS limité à l'origine de `WEB_URL` avec cookies, cookie-parser, arrêt propre, Swagger sur `/docs` hors production).
- Configuration (`src/config`) : toutes les variables de `.env.example` validées par zod au démarrage, messages en français ; valeurs de `.env.example` par défaut en développement et en test ; en production, variables obligatoires, https exigé, secrets d'exemple et clé d'essai Turnstile refusés.
- Journaux nestjs-pino : JSON en production, pino-pretty en développement, muets en test ; ni en-têtes, ni corps, ni paramètres de requête, ni adresse IP ; champs sensibles masqués ; identifiant `X-Request-Id` repris s'il est valide, sinon généré, et renvoyé.
- Erreurs RFC 9457 : `ProblemFilter` global (`application/problem+json`, schéma `Problem` du contrat, textes en français, aucun détail interne pour les 5xx), `ProblemException` pour les erreurs métier, `ZodValidationPipe` (corps → 422 `validation-error`, paramètres → 400 `invalid-query`, `errors[]` avec `path`, `code`, `message`), JSON illisible → 400 `invalid-body`.
- Limitation de débit globale (`@nestjs/throttler`) : en-têtes `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` et `Retry-After` comme dans le contrat, corps 429 `rate-limited`.
- `PrismaModule` global (`PrismaService` avec l'adaptateur `pg`, schéma lu dans `DATABASE_URL`).
- `GET /v1/health` : base de données (`SELECT 1`) et Redis (`PING` sur une connexion courte), délai de 2 s par vérification, 200 `ok` ou 503 `down` / `degraded`, `Cache-Control: no-store`.
- Tests : utilitaire `test/contract.ts` (`expectToMatchContract`, `expectToMatchSchema`, ajv 2020-12), tests unitaires de la configuration, du filtre et du pipe, tests e2e de la santé.
- CI : job « API » avec PostgreSQL 18.4 et Redis 8.10.2 en services.

### Décisions

- **ESM imposé** : les paquets NestJS 12 et le client Prisma 7 (`prisma-client`) ne sont publiés qu'en modules ES. Projet en `"type": "module"`, imports relatifs suffixés `.js`.
- **TypeScript 6.0** : version prise en charge par typescript-eslint 8.
- **Vitest + SWC** (`unplugin-swc`) : esbuild n'émet pas les métadonnées de décorateurs dont dépend l'injection de NestJS. Par prudence, toutes les dépendances sont aussi déclarées avec `@Inject(...)` explicite.
- **Développement** : `pnpm start:dev` compile avec `tsc --watch` et relance `node --watch dist/main.js` (tsx, fondé sur esbuild, n'émet pas les métadonnées).
- **Statuts de validation** repris du contrat : 422 pour un corps invalide (réponse `ValidationError`), 400 `invalid-query` pour les paramètres (exemple de `GET /v1/search`), 400 `invalid-body` pour un JSON illisible.
- **Santé** : `down` si la base est indisponible, `degraded` si seul Redis l'est, 503 dans les deux cas (« une dépendance est indisponible »). Le stockage S3 n'est pas encore vérifié : `checks.storage` est facultatif dans le contrat et sera ajouté avec le module de stockage.
- **Tests e2e de la santé** : base et Redis remplacés par des doubles (cas 200 et 503, partout) ; avec `E2E_REAL_SERVICES=true` (CI), un test supplémentaire interroge les vrais PostgreSQL et Redis.
- **Connexion Prisma à la première requête** : l'API démarre même si la base est momentanément indisponible ; la sonde de santé le signale.

### Difficultés et solutions

- **Erreurs de l'analyseur JSON** : NestJS les convertit en 400 générique avec le message anglais de body-parser avant les filtres. Solution : analyseur JSON déclaré dans `configureApp` suivi d'un intergiciel qui les transforme en problème `invalid-body`.
- **En-têtes de limitation de débit** : `@nestjs/throttler` émet `X-RateLimit-*`, le contrat décrit `RateLimit-*`. Solution : garde dérivée (`AppThrottlerGuard`) qui change le préfixe.
- **Modules CommonJS (ajv, ajv-formats) importés depuis l'ESM** : l'export par défaut est lu par `.default`, ce qui fonctionne avec Node comme avec Vitest.
- **Machine de développement limitée** (4 cœurs, 2 Go) : la compilation et les tests n'ont pas été lancés pendant l'écriture du socle (ESLint avec vérification des types passe) ; premier passage complet à faire en local puis en CI.

## Phase 2 — Lectures publiques : site, pages, zones, catalogue (26 octobre 2026)

### Fait

- Dix opérations publiques du contrat : `GET /v1/site/settings`, `/v1/site/navigation`, `/v1/site/redirects`, `/v1/pages/{key}`, `/v1/zones`, `/v1/sitemap`, `/v1/categories`, `/v1/categories/{slug}`, `/v1/services`, `/v1/services/{slug}`.
- Un module par domaine sous `src/modules/` (`settings`, `navigation`, `pages`, `zones`, `sitemap`, `catalog`, plus `media` partagé pour les images) : contrôleur, service, mappers Prisma → schémas du contrat, schémas zod des paramètres.
- Utilitaires partagés : `src/common/i18n` (paramètre `lang`, fusion des traductions), `src/common/http-cache` (en-tête de cache), `src/common/json` (lecture prudente des colonnes JSON), `notFoundException` dans `src/common/problem`.
- Tests : unitaires des mappers et de la fusion des langues (`src/**/*.spec.ts`) ; e2e `test/public-content.e2e-spec.ts` avec un double en mémoire de Prisma (`test/support/prisma-double.ts`) rempli à partir des données simulées du site (`test/fixtures/public-content.ts`), et un bloc « base réelle » (`E2E_REAL_SERVICES=true`) qui parcourt rubriques, services et pages du seed. Chaque réponse est validée contre le contrat.
- CI : étape `pnpm db:seed` après les migrations.

### Décisions

- **Langue** : `lang` validé (`fr` par défaut, autre valeur → 400 `invalid-query`). Fusion récursive de `translations.en` sur le français : un champ absent, nul ou vide reste en français ; objets fusionnés clé par clé ; listes d'éléments identifiés (sections de pages) appariées par `id` dans l'ordre français, autres listes élément par élément. Seuls les champs traduisibles listés par mapper peuvent être recouverts. Colonnes `…En` pour les zones et quartiers.
- **Adresses** : les `href` restent les adresses françaises internes (comme dans les exemples anglais du contrat) ; `slugEn` est accepté pour la lecture d'une rubrique ou d'un service avec `lang=en`, mais n'est pas renvoyé (absent du contrat).
- **Publication** : rubrique `PUBLISHED` ; service `PUBLISHED`, `publishedAt` vide ou passé, dans une rubrique publiée (sinon 404, et absent des listes, menus, services liés, plan du site) ; page avec `publishedAt` renseigné, sections `enabled: false` masquées ; zones `active` ; avis `PUBLIE` ; offres d'emploi publiées et non expirées dans le plan du site.
- **Cache** : le contrat ne décrit ni `Cache-Control` ni `ETag` ni 304. Choix : `Cache-Control: public, no-cache` sur les lectures publiques (une publication est visible aussitôt) et `ETag` faible d'Express (réglé explicitement dans `configureApp`), d'où un 304 sans corps sur `If-None-Match`. Pas de `Content-Language` (non décrit).
- **Tarifs** : le schéma public `Zone` ne comporte ni délai ni `fee` : les tarifs indicatifs ne sont jamais lus par `GET /v1/zones`, quel que soit « Afficher les tarifs ». Aucun prix de prestation.
- **Paramètres** : une ligne `settings` par groupe, `value` de la forme du groupe du contrat (sans `group`) ; groupes internes `site` (`siteName`, `tagline`, `signature`, `turnstileSiteKey`), `navigation` (`main`, `signUp`, `footer`, `legal`, `megaMenuPromo`) et `zones` (`showFees`, `note`). Valeurs de repli conformes au contrat (coordonnées provisoires des maquettes) tant qu'un groupe manque ; numéros affichés calculés à partir du format E.164.
- **Images** : `MediaImage` depuis la médiathèque (clé de stockage préfixée par `MEDIA_PUBLIC_URL`, adresse relative au site conservée) ; un média en échec est remplacé par l'illustration. Les visuels enregistrés dans des JSON sous la forme `{ illustration, imageId, alt }` sont résolus en une requête ; ceux déjà sous la forme du contrat sont renvoyés tels quels.
- **Requêtes** : `select` ciblés, relations chargées dans la même requête, tri `sortOrder` puis slug ; la recherche `q` de `GET /v1/services` filtre en mémoire (insensible aux accents) une trentaine de services, la recherche plein texte restant celle de `GET /v1/search`.
- **Présentation** : numéro de rubrique selon le rang des rubriques publiées ; « Nos autres rubriques » = les trois premières autres rubriques publiées ; avis d'une fiche = avis mis en avant publiés, sinon les six plus récents ; synthèse des notes calculée sur les avis publiés ; libellé « 4 formules · 2 services » du méga-menu calculé.

### Difficultés et solutions

- **Machine limitée** : ni compilation ni tests lancés ; ESLint avec vérification des types et Prettier passent sur tous les fichiers ajoutés. Premier passage des tests à faire en local ou en CI.
- **Données du seed écrites en parallèle** : les mappers lisent prudemment les JSON (valeurs de repli conformes au contrat) ; le bloc « base réelle » des tests e2e vérifiera l'accord entre seed et API.
- **Doubles de Prisma** : un double en mémoire évalue le sous-ensemble des filtres, tris et sélections utilisés, pour tester les règles de publication sans base.

### Points ouverts (contrat et schéma)

- Ajouter au contrat les en-têtes `Cache-Control`/`ETag` et la réponse `304` des lectures publiques, et les réponses `400` (`lang` invalide) de ces opérations.
- Clé publique Turnstile : aucune variable d'environnement ; lue dans le paramètre `site.turnstileSiteKey` (clé d'essai hors production). Une variable `TURNSTILE_SITE_KEY` serait plus simple.
- `slugEn` existe dans le schéma mais pas dans le contrat : le site ne peut pas construire les adresses anglaises (`/en/services/experience/private-chef`).
- `preview` accepté mais non traité (jetons signés à venir avec le back-office).
- Le modèle `Service` n'a pas de `offersTitleMobile` (`ServiceOffers.titleMobile`) : propriété omise pour les fiches.

## Phase 2 — Formulaires publics, contacts et demandes (26 octobre 2026)

### Fait

- Six opérations publiques du contrat : `POST /v1/quote-requests`, `/v1/contact-messages`, `/v1/registrations`, `/v1/training-requests`, `/v1/partner-requests`, `/v1/event-registrations` (module `src/modules/forms` : contrôleur, schémas zod, service, mappers, données des e-mails).
- Anti-spam partagé `src/common/anti-spam` (schéma `AntiSpam`, `TurnstileService`, `AntiSpamService`), réutilisable par les rendez-vous, candidatures et la newsletter.
- Modules `contacts` (fiche par e-mail, centres d'intérêt, abonnement en attente) et `requests` (référence, création, historique, notifications).
- `MailModule` (écrit en parallèle) importé dans `AppModule` ; les formulaires n'utilisent que `MailQueueService.enqueueMany`.
- Tests : unitaires (`anti-spam.spec.ts`, `reference.spec.ts`, `contact.mapper.spec.ts`, `forms.mapper.spec.ts`) ; e2e `test/public-forms.e2e-spec.ts`. Le double de Prisma gagne les écritures (`create`, `createMany`, `update`, `upsert`, `deleteMany`, `aggregate`, `count`, `$transaction`) sans changer les lectures.

### Décisions

- **Ordre des contrôles** : validation du corps (422) → champ piège → délai minimal → Turnstile (400) → existence de la rubrique, du service, de la formation ou de l'événement (422 sur le champ, aucune réponse 404 n'étant prévue par le contrat) → transaction → e-mails.
- **Champ piège** : rempli → `201` avec une référence vraisemblable et le message habituel, sans enregistrement, sans e-mail, sans appel à Cloudflare (le contrat fixe `maxLength: 0`, qui donnerait un 422 révélateur).
- **Délai minimal** : moins de 3 s entre `startedAt` et la réception → 400 `spam-check-failed` (seule réponse anti-spam du contrat). Une date d'ouverture dans le futur (horloge du visiteur en avance) est tolérée.
- **Turnstile** : `fetch` natif, délai de 5 s, refus en cas d'erreur réseau. Jeton vide accepté hors production (le site l'envoie sans clé publique) ; clé d'essai `1x0000…AA` hors production : aucun appel réseau. Journaux : codes d'erreur de Cloudflare seulement.
- **Références** : `upsert` de la ligne de l'année (`INSERT … ON CONFLICT DO UPDATE … + 1`) dans la transaction de création ; année à l'heure de Douala ; compteur partagé avec les rendez-vous ; un échec de la transaction ne consomme aucun numéro.
- **Contacts** : une fiche par e-mail normalisé (minuscules, sans espaces) ; seules les informations fournies remplacent l'existant ; source retenue à la création ; prénom = premier mot du nom complet (sauf inscription) ; quartier déduit de « Quartier, Ville » ; partenariat → profil professionnel.
- **Consentements** : horodatage, IP et agent utilisateur portés par chaque demande (`consentAt`, `ip`, `userAgent`) ; newsletter cochée à l'inscription → abonné `EN_ATTENTE` avec `consentAt` (un abonné confirmé le reste, un désinscrit redevient en attente). L'e-mail de confirmation (jeton) sera envoyé par le module newsletter.
- **Demandes** : statut `NOUVELLE`, échéance réception + 24 h, `payload` = valeurs du formulaire + `fields` (libellé, valeur formatée) comme le seed ; historique `RECEIVED` ; une notification par membre actif des rôles qui voient toutes les demandes (ADMIN, MANAGER, EDITOR) : `REQUEST`, `REGISTRATION` (inscription) ou `PARTNERSHIP`, lien `/admin/demandes?id=…`.
- **Événements** : places restantes calculées (jauge − places des inscriptions) sous verrou de la ligne de l'événement (`SELECT … FOR UPDATE`) → 409 `event-full` ; événement terminé → 422.
- **E-mails** : après la transaction, accusé de réception (gabarit du formulaire, langue de l'envoi) et une alerte `team-new-request` en français par destinataire du paramètre `emails.teamRecipients` (à défaut `coordonnees.email`) ; erreur de mise en file journalisée avec la seule référence.
- **Langue** : `lang` facultatif dans le corps (absent du contrat), sinon `Accept-Language`, sinon `fr` ; message de confirmation en français ou en anglais, erreurs en français.
- **Limitation de débit** : 5 envois par minute, par IP et par formulaire (`@Throttle`), réponse 429 du socle.

### Difficultés et solutions

- **Module des e-mails écrit en parallèle** : interface convenue (`MailJob`, `MailQueueService`) importée telle quelle ; les tests remplacent `MailQueueService` par un double.
- **Limitation de débit dans les tests** : un stockage remis à zéro entre les tests remplace `ThrottlerStorage` (vider la table interne ne suffit pas : les dates d'expiration des coups sont gardées à part).
- **Machine limitée** : ni compilation ni tests lancés ; ESLint et Prettier passés sur les fichiers ajoutés.

### Points ouverts (contrat et schéma)

- Ajouter `lang` aux schémas `…Input` des formulaires (langue des e-mails), et préciser que le champ piège rempli reçoit un succès factice.
- Réponse 404 absente des formulaires : une rubrique, un service, une formation ou un événement inconnu donne un 422 sur le champ.
- Limite journalière (30 envois par jour et par IP) non encore en place.
- `ACK_SENT` / `TEAM_ALERT_SENT` : à écrire dans l'historique par le module mail lors de l'envoi effectif (la référence est transmise dans `MailJob.reference`).
- Clé publique Turnstile en production : toujours vide tant que `TURNSTILE_SITE_KEY` n'existe pas ; le site enverrait alors des jetons vides, refusés en production.

### E-mails et file d'attente (26 octobre 2026)

- File BullMQ `mail` sur une connexion ioredis partagée (ouverte à la première utilisation) : 5 tentatives, attente exponentielle à partir d'une minute ; historique limité (7 jours ou 1 000 envois, 30 jours ou 5 000 échecs). Tâche invalide : échec immédiat, sans réessai. Identifiant de tâche stable quand une référence est fournie (empreinte sha256, aucune adresse en clair dans Redis).
- Worker Nodemailer (SMTP de la configuration, Mailpit en local), démarré si `MAIL_WORKER=on` (désactivé en test), 4 envois à la fois ; texte brut toujours joint ; `List-Unsubscribe` pour la newsletter ; envois tracés dans l'historique des demandes (`ACK_SENT`, `TEAM_ALERT_SENT`) et dans les envois de campagne.
- 21 gabarits React Email sur un gabarit commun fidèle aux maquettes (carte 600 px, ruban dégradé, récapitulatif, bouton orange, pied de page lu dans les paramètres) ; textes lus dans les modèles d'e-mails en base (modifiables dans le back-office), version anglaise champ par champ, textes par défaut si le modèle manque.
- `pnpm mail:preview` : rendu HTML et texte de chaque gabarit dans `tmp/mail-preview/`.

### Décisions

- **Textes des 4 e-mails maquettés alignés sur les maquettes** (accusé de réception du devis, rendez-vous confirmé, inscription confirmée, invitation au questionnaire) dans le seed, les textes par défaut et les modèles du back-office du site. Écart volontaire : « nos 30 services » de la maquette devient « nos services » (22 services au catalogue).
- **Logo en PNG** (`mambo-proxi-web/public/brand/logo-horizontal.png`, 576 × 160, rendu depuis le SVG) : Gmail et Outlook n'affichent pas les SVG.

### Difficultés et solutions

- **`pnpm exec prettier` bloqué sous ce Windows** (processus qui ne se terminent pas) : Prettier et ESLint lancés directement par `node node_modules/...`.
- **Nom affiché des inscriptions** : le prénom et le nom saisis séparément étaient recollés puis recoupés au premier espace (« Marie C. » pour « Marie Claire Ndongo ») ; `shortName` reprend désormais le prénom et le nom tels quels (« Marie Claire N. »).

## Phase 2 — Authentification et utilisateurs du back-office (26 octobre 2026)

### Fait

- Module `auth` (`src/modules/auth`) : les neuf opérations `/v1/auth/*` du contrat (connexion, code par e-mail,
  renvoi, rafraîchissement, déconnexion, utilisateur connecté, mot de passe oublié, réinitialisation, acceptation
  d'invitation).
- Garde globale `AuthGuard` (après la limitation de débit) : session obligatoire sauf `@Public()`, jeton CSRF sur les
  mutations, permissions `@RequirePermissions(...)` obligatoires sous `/v1/admin`. Les contrôleurs publics existants
  (site, catalogue, formulaires, santé) sont marqués `@Public()`.
- Matrice rôle → permissions (`permissions.ts`) reprise du schéma `Role` du contrat ; `TEAM_NOTIFIED_ROLES` des
  demandes en est désormais déduit.
- Module `users` (`src/modules/users`) : `GET /v1/admin/users`, `/users/presence`, `/roles`, `POST /users/invite`,
  `PATCH` et `DELETE /users/{id}`, `POST /users/{id}/reset-password`, avec journal d'activité (`audit_logs`).
- E-mails `otp-code`, `user-invite`, `password-reset` : gabarits, textes par défaut (fr/en) et seed existaient déjà,
  identiques aux modèles du back-office simulé ; liens vers `/admin/nouveau-mot-de-passe?token=` et
  `/admin/invitation?token=` du site.
- Seed : `SEED_ADMIN_PASSWORD` (jusqu'ici ignorée) et nouvelle `SEED_DEMO_PASSWORD` hachées en argon2id.
- Dépendance : `argon2` 0.45.1 (binaires précompilés glibc, musl, Windows ; script d'installation refusé dans
  `allowBuilds`).
- Tests : unitaires (`permissions.spec.ts` contre l'énumération, la matrice et l'exemple de `GET /v1/admin/roles` du
  contrat ; `tokens.spec.ts` : JWT, jetons, mots de passe compromis, identité, verrouillage) ; e2e
  `test/auth.e2e-spec.ts` et `test/admin-users.e2e-spec.ts` (outils communs `test/support/auth.ts`), dont un test qui
  parcourt toutes les routes déclarées et compare publique / session / `x-permissions` au contrat. Le double de
  Prisma gagne `updateMany`, `delete`, les tables de l'authentification, et traite une colonne absente comme `null`
  dans les filtres.
- CI : comptes du seed avec mot de passe (`SEED_ADMIN_*`, `SEED_DEMO_PASSWORD` de test) pour le job « API ».

### Décisions

- **Jeton d'accès** : JWT HS256 de 15 min (`{ sub, sid, iat, exp }`) écrit sans bibliothèque (signature HMAC, en-tête
  fixe comparé octet par octet : `alg: none` et autres algorithmes refusés). La session et l'utilisateur sont relus à
  chaque requête : déconnexion, désactivation et changement de rôle prennent effet aussitôt.
- **Jetons opaques** (rafraîchissement, appareil de confiance, réinitialisation, invitation) : 256 bits aléatoires,
  seul un condensat HMAC-SHA256 est stocké. Code à 6 chiffres : condensat HMAC lié à l'utilisateur (une copie de la
  base ne permet pas de le retrouver par force brute).
- **Rotation** : nouvelle ligne `sessions` à chaque rafraîchissement, réservation atomique (`updateMany` sur
  `revokedAt: null`), durée de session fixée à la connexion. Jeton remplacé présenté de nouveau : moins de 10 s après
  la rotation (deux onglets) → 204 sans nouveaux cookies ; au-delà → toutes les sessions de l'utilisateur révoquées, 401. Session révoquée sans remplaçante (déconnexion, désactivation) : 401, sans délai de grâce.
- **CSRF** : double-submit signé `<aléa>.<HMAC(utilisateur, aléa)>` — un cookie planté par un tiers ou celui d'un
  autre compte est refusé ; lié à l'utilisateur, il reste valable après une rotation. Contrôlé sur toute mutation
  authentifiée (403 `csrf-token-invalid`), y compris la déconnexion.
- **Déconnexion** : marquée `@Public()` pour la garde, la route identifie la session par le jeton d'accès ou, s'il a
  expiré, par le jeton de rafraîchissement ; le cookie d'appareil de confiance est conservé.
- **Verrouillage** : toutes les 5 erreurs consécutives, 15 min puis 30, 60… (plafond 24 h) ; 423 dès la 5e erreur ;
  compteur remis à zéro par un mot de passe correct ou une réinitialisation. Adresse inconnue, invitation en cours
  ou compte désactivé : même 401, après un calcul argon2 factice (temps de réponse égalisé).
- **Code par e-mail** : un nouveau défi clôt les précédents ; le renvoi garde le défi et ses essais (5 au total,
  renvois compris) et prolonge sa validité de 10 min ; trop tôt → 429 avec `Retry-After`.
- **Appareil de confiance** : `trustedDeviceDays` du paramètre `securite` (0 = toujours un code) ; un appareil plus
  ancien que la durée actuelle n'est plus reconnu, même si son expiration initiale était plus lointaine.
- **Cookies** : `mp_at` 15 min ; `mp_rt` et `mp_csrf` persistants seulement avec « Rester connecté » (sinon cookies de
  session du navigateur, comme le back-office simulé) ; `Secure` dès que `API_URL` est en https.
- **Statut affiché** : `ACTIF` si `activatedAt` est renseigné (premier mot de passe défini), `INVITE` sinon,
  `DESACTIVE` si `isActive = false`. Présence et personnes assignables : membres `ACTIF` seulement.
- **Mot de passe oublié** : réponse identique et immédiate (lien créé sans attendre) ; tout compte actif reçoit un
  lien, y compris sans mot de passe (administratrice initiale du seed) ; compte désactivé : rien.
- **Politique des mots de passe** : 12 à 256 caractères, liste embarquée de mots de passe courants (12 caractères et
  plus, variantes françaises), suites triviales, identique à l'adresse e-mail → 422 `compromised_password`.
- **Utilisateurs** : on ne peut ni désactiver ni supprimer son propre compte ; le dernier administrateur actif ne
  peut être ni rétrogradé, ni désactivé, ni supprimé (409) ; un auteur de notes (clé étrangère `Restrict`) ne peut
  pas être supprimé (409 : le désactiver). Désactivation et réinitialisation par un administrateur révoquent
  sessions, appareils de confiance et codes. Réinitialisation d'un compte jamais activé : nouvelle invitation
  (« Invitation renvoyée à … », comme le back-office simulé).
- **Limitation de débit** des routes d'authentification, par IP : connexion et code 10/min, renvoi et mot de passe
  oublié 5/min, liens 10/min, rafraîchissement 30/min ; s'ajoute au verrouillage par compte.
- **Schéma** : aucune migration ; les tables `users`, `sessions`, `trusted_devices`, `otp_challenges`,
  `password_resets`, `invitations` et `audit_logs` de la migration initiale suffisent.

### Difficultés et solutions

- **argon2 et pnpm** : le script d'installation (`node-gyp-build`) est bloqué par `allowBuilds` ; le paquet livre ses
  binaires précompilés pour toutes les plateformes visées (Linux glibc et musl, Windows) : script refusé
  explicitement, le module se charge sans compilation.
- **Double de Prisma** : les lignes créées n'ont pas les colonnes facultatives (`undefined` au lieu de `null`). Les
  créations passent désormais les `null` explicitement, et le double traite une colonne absente comme `null` dans
  les filtres.
- **Contrôles du contrat** : plusieurs réponses nécessaires ne sont pas documentées (voir ci-dessous) ; les tests les
  valident contre le schéma `Problem` et le signalent.

### Points ouverts (contrat et site)

- Ajouter au contrat : 422 sur `login`, `verify-otp`, `resend-otp`, `forgot-password` et `PATCH /admin/users/{id}` ;
  401 sur `resend-otp` (défi inconnu ou clos) ; 404 sur `DELETE /admin/users/{id}` et
  `POST /admin/users/{id}/reset-password` ; 409 sur ce dernier (compte désactivé) ; le type `csrf-token-invalid` du 403.
- Le site n'appelle jamais `POST /v1/auth/refresh` : avec l'API réelle, la session tombera au bout de 15 min. À
  ajouter au client du back-office (sur un 401, rafraîchir puis rejouer la requête une fois).
- Les tâches d'e-mails gardent les données du gabarit dans Redis (code, lien) jusqu'à la purge (7 jours) : sans effet
  une fois le code (10 min) ou le lien (1 h) expiré, mais à savoir pour l'exploitation de Redis.
- Liste des mots de passe compromis embarquée et courte : une vérification « Have I Been Pwned » (k-anonymat) est
  possible plus tard, si un appel sortant est acceptable.

## Contrat — réponses d'erreur de l'authentification et des utilisateurs (26 octobre 2026)

### Fait

- `contracts/openapi.yaml` : 422 `ValidationError` sur `login`, `verify-otp`, `resend-otp`, `forgot-password` et
  `PATCH /v1/admin/users/{id}` ; 401 `invalid-otp` sur `resend-otp` (défi inconnu, expiré, utilisé ou épuisé) ;
  423 sur `verify-otp` (compte verrouillé entre le mot de passe et le code, cas déjà levé par le code) ; 404
  `NotFound` sur `DELETE /v1/admin/users/{id}` et `POST /v1/admin/users/{id}/reset-password` ; 409 sur ce dernier
  (compte désactivé) ; 409 de `DELETE` décrit (son propre compte, dernier administrateur actif, auteur de notes) ;
  403 `Forbidden` sur `logout` ; 429 sur `refresh` (limite de 30/min) et description du délai de grâce de 10 s.
- Réponse `Forbidden` : deux exemples nommés (`forbidden`, `csrfTokenInvalid`), description des deux types.
- Tests e2e : les réponses validées « contre `Problem` faute de contrat » passent sur `expectContract` ; ajout des
  422 de `verify-otp`, `resend-otp` et `forgot-password`, du 423 de `verify-otp`, du 404 de `reset-password`.

### Décisions

- 403 `csrf-token-invalid` : documenté une fois dans la réponse commune `Forbidden` (et le schéma de sécurité
  `csrfToken`) plutôt que par route ; les routes d'utilisateurs déclaraient déjà `403`, `logout` l'ajoute.
- `refresh` reste public (seul `mp_rt` est lu, pas de jeton CSRF), comme l'implémentation : le test qui compare les
  routes publiques au contrat reste valable.

### Points ouverts

- Environ 70 mutations à cookie hors authentification et utilisateurs ne déclarent pas `403` (modules pas encore
  implémentés) : à compléter avec chaque module.
