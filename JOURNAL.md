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

## Phase 2 — Back-office : demandes et contacts (27 octobre 2026)

### Fait

- Demandes (`src/modules/requests`) : `GET /v1/admin/requests` (filtres `type`, `status`, `category`, `country`,
  `district`, `assignee`, `due`, `from`, `to`, `q` ; pagination ; tri ; compteurs des onglets calculés sans le
  statut), `GET /v1/admin/requests/export.csv`, `GET`, `PATCH` (statut, assignation, échéance) et `DELETE`
  (anonymisation) de `/v1/admin/requests/{id}`, `POST …/notes`, `POST …/duplicate` ; `GET /v1/admin/me/tasks`.
- Contacts (`src/modules/contacts`) : `GET /v1/admin/contacts` (filtres `profile`, `country`, `district`,
  `interest`, `q` ; indicateurs), `GET /v1/admin/contacts/export.csv`, `GET` et `DELETE` (droit à l'effacement) de
  `/v1/admin/contacts/{id}`, `GET …/export` (export RGPD en JSON).
- Socle : `common/pagination` (`page`, `pageSize`, `sort` validés, `meta`), `common/csv` (BOM, `;`, CRLF,
  guillemets, formules neutralisées), `common/text/search-key`, `common/time/agency-day` (journée de Douala),
  `common/audit/audit-log` ; formats partagés `ContactSummary`, `UserRef`, `AdminAppointment`.
- Migration `20261027000000_search_keys` (SQL produit hors ligne par
  `prisma migrate diff --from-schema <schéma précédent> --to-schema prisma/schema.prisma --script`, complété du calcul
  des lignes existantes) : `contacts.search_text`, `contacts.city_key`, `requests.search_text`, tenues à jour par les
  formulaires, la duplication, l'anonymisation et le seed.
- Contrat : réponse commune `InvalidQuery` (400) sur les listes et exports ; `403 Forbidden` (rôle insuffisant ou
  `csrf-token-invalid`) sur les dix routes du lot qui ne le déclaraient pas ; en-têtes `Content-Disposition` des
  exports ; règles de tri, de recherche, d'anonymisation, d'effacement et contenu de l'export RGPD décrits ; schéma
  de la réponse de `GET /v1/admin/contacts/{id}/export`. Site synchronisé (`pnpm contract:sync`,
  `pnpm contract:generate`).
- Tests : unitaires (`csv.spec.ts`, `search-key.spec.ts`, `request.mapper.spec.ts`, clés de recherche des contacts) ;
  e2e `test/admin-requests.e2e-spec.ts` et `test/admin-contacts.e2e-spec.ts` (données `test/fixtures/back-office.ts`,
  une session par rôle ouverte une seule fois), avec un bloc sur la base réelle. Le double de Prisma retrouve les
  relations par clé étrangère (`LINKS`), filtre les listes liées (`some`, `none`, `every`, `is`), compte (`_count`),
  regroupe (`groupBy`), pagine (`skip`) et connaît `contains` / `startsWith` / `endsWith`.

### Décisions

- **Périmètre** : avec la seule permission `requests:read-assigned` (AGENT), liste, compteurs et export se limitent
  aux demandes assignées ; `assignee` désignant quelqu'un d'autre → 403 ; une demande hors périmètre, comme une
  demande anonymisée, est « introuvable » (404, texte du back-office simulé). Statut, échéance et notes : toute
  demande avec `requests:write`, les siennes avec `requests:write-assigned` ; assignation : `requests:assign` ;
  retour en arrière du statut : `requests:revert-status` (administrateurs). Matrice existante inchangée (l'EDITOR
  assigne et anonymise ; le MANAGER aussi, comme le prévoit le schéma `Role`).
- **Assignation** : membre actif, mot de passe défini, rôle qui traite les demandes (comme `assignable` de la
  présence), sinon 422 sur `assignedToId`. Événement `ASSIGNED` (`assignedToId`, `assignedToName`), notification
  `ASSIGNMENT` (« Demande assignée — {service} ({référence}) », lien `/admin/demandes?id=`) et e-mail
  `team-assignment` à la personne assignée, sauf si elle s'assigne elle-même ; un échec de mise en file est
  journalisé sans faire échouer la modification. `assignedAt` figure dans les données de l'e-mail : deux
  assignations successives à la même personne ne sont pas fusionnées par l'identifiant stable de la tâche.
- **Statuts** : `completedAt` à « Prestation réalisée », `closedAt` à « Clôturée », effacés par un retour en arrière.
  Devis passé à « Prestation réalisée » : ligne `surveys` `SCHEDULED` à `surveyDelayHours` (paramètre `emails`, 24 h
  par défaut) et événement `SURVEY_SCHEDULED` ; un retour en arrière supprime l'invitation pas encore envoyée. Le
  jeton enregistré est provisoire : le module des questionnaires le remplacera à l'envoi (seul un condensat est
  conservé). L'échéance (`dueAt`) n'a pas de type d'événement dans le contrat : journal d'activité seulement.
- **Libellés de l'historique** calculés à la lecture à partir de `kind` et `data` (exemples du contrat et du
  back-office simulé : « Demande reçue via le formulaire », « Statut : Nouvelle → En cours », « Assignée à … »).
- **Anonymisation d'une demande** : message, valeurs du formulaire, structure, IP et agent utilisateur, sujet libre
  des messages de contact, notes internes, noms des pièces jointes (`fichier-anonymise`), réponses libres du
  questionnaire, message et notes du rendez-vous lié ; la demande (et le rendez-vous lié) passe sur la fiche commune
  `anonyme@mamboproxi.invalid`, exclue des listes : la demande n'est plus rattachable à la personne. Type, service,
  statut et dates restent pour les statistiques.
- **Droit à l'effacement** : fiche vidée sur place (`efface-<id>@mamboproxi.invalid`, « Contact effacé »), centres
  d'intérêt retirés, demandes anonymisées (elles restent sur la fiche effacée), message et notes des rendez-vous
  effacés, abonnement anonymisé et désinscrit plutôt que supprimé (la suppression des envois de campagne, en
  cascade, fausserait les statistiques). Fiches effacées et fiche commune exclues des listes, des indicateurs et des
  fiches (404).
- **Export RGPD** : fiche complète (prénom, nom, quartier, langue, dernière activité en plus), demandes avec contenu,
  preuve du consentement (IP, agent utilisateur), historique, pièces jointes décrites et questionnaire, abonnement ;
  sans les notes internes de l'équipe (demandes et rendez-vous).
- **CSV** : colonnes et en-têtes du back-office simulé ; UTF-8 avec BOM, `;`, CRLF, cellules entre guillemets.
  Injection de formules (pratique OWASP) : apostrophe devant une cellule commençant par `=`, `+`, `-`, `@`, tabulation
  ou retour chariot, sauf un nombre ou un numéro de téléphone (`+237…` deviendrait sinon illisible, et ne peut rien
  exécuter). `Cache-Control: no-store`, `Content-Disposition` `demandes-AAAA-MM-JJ.csv` / `contacts-AAAA-MM-JJ.csv`
  (date de Douala). Chaque export (CSV, RGPD) est inscrit au journal, avec le nombre de lignes seulement.
- **Journal d'activité** : `request.update`, `request.duplicate`, `request.anonymize`, `request.export`,
  `contact.export`, `contact.export-data`, `contact.erase` ; libellés et états sans donnée personnelle des clients
  (références, statuts, membres de l'équipe).
- **Recherche sans accents** : colonnes de clés normalisées plutôt que l'extension `unaccent` (gardée pour la
  recherche plein texte de `/v1/search` et `/admin/search`) : filtres Prisma ordinaires, testables avec le double.
- **« Mes tâches »** : la partie rendez-vous lit directement la table `appointments` (aujourd'hui, à confirmer, 5
  prochains sur 7 jours, créneau proposé pris en compte), au format `AdminAppointment` que reprendra le module des
  rendez-vous ; aucune partie n'est renvoyée à zéro par défaut.
- **Tris** : demandes `createdAt` (défaut `-createdAt`), `updatedAt`, `dueAt`, `reference`, `status`, `type` ;
  contacts `createdAt` (défaut), `updatedAt`, `fullName`, `lastActivityAt` ; autre valeur → 400 ; départage par
  identifiant. `totalPages` vaut 0 pour une liste vide (contrat : minimum 0).

### Écarts avec le back-office simulé du site (le contrat prime)

- Export des demandes : type en libellé (« Devis ») au lieu du code (`DEVIS`) ; formules neutralisées ; nom de
  fichier daté (le site nomme de toute façon le fichier téléchargé). Export des contacts : « Créé le » en date de
  Douala au lieu de la date UTC.
- `whatsappUrl` renseigné avec le message de l'exemple du contrat (« c'est Mambo Proxi… ») ; le mock renvoie `null`
  et le site construit alors son propre lien (« c’est MAMBO Proxi… »).
- Effacement d'un contact : ses demandes anonymisées disparaissent des listes (le mock les garde, renommées
  « Contact effacé ») ; `DELETE` d'une demande : anonymisation puis 404, comme la suppression du mock.
- `Subscriber.source` : origine de l'abonnement (`footer`, `suivi-mambo`, `inscription`, `autre`) au lieu de la
  source de la fiche contact. Export RGPD : clés `requests` et `newsletter` en plus de `exportedAt` et `contact`.
- Le mock ignore `sort` ; l'API l'applique. 422 d'assignation : même détail, avec `errors[].code = not_assignable`.

### Difficultés et solutions

- **Double de Prisma** : les lignes créées par l'API n'ont que leurs clés étrangères (le graphe d'objets des
  lectures publiques ne suffisait plus) ; relations retrouvées par clé (`LINKS`) sans changer le comportement des
  enregistrements qui portent déjà leurs relations. Le double renvoie toutes les colonnes quelle que soit la
  sélection : la duplication recopie désormais les champs un à un (un `...source` recopiait aussi `id`).
- **Machine** : commandes lourdes lancées une à une ; tests sur la base réelle non lancés en local (pas de Docker),
  exécutés par la CI.

### Points ouverts

- `GET /v1/admin/requests/{id}/attachments/{attachmentId}` (URL signée de 5 min) non implémenté : module de
  stockage, qui devra aussi purger les fichiers des demandes anonymisées (nom `fichier-anonymise`).
- Avis publiés liés aux demandes d'un contact effacé (nom affiché « Prénom N. », ville) : à traiter avec le module
  des avis. Titres de notifications reprenant le sujet libre d'un message de contact : non effacés.
- Tableau de bord et `sidebar-counts` (lot suivant) : exclure les demandes anonymisées, comme la présence
  (`openTasks`, corrigée dans ce lot).
- Envoi et relance du questionnaire programmé, avec le nouveau jeton : module des questionnaires.

## Phase 2 — Back-office : contenus (27 octobre 2026)

### Fait

- Services et rubriques (`src/modules/catalog/admin-*`) : `GET /v1/admin/services` (filtres `category`, `status`,
  `q` sans accents ; compteurs par rubrique calculés sans le filtre de rubrique ; demandes des 30 derniers jours ;
  complétude), `POST`, `GET`/`PATCH`/`DELETE` de `/v1/admin/services/{id}`, `publish`, `unpublish`, `duplicate`,
  `preview-token`, `completeness`, `PATCH /v1/admin/services/reorder` ; `/v1/admin/categories*` (liste, création,
  modification avec carrousels d'offres et champs du devis, ordre, suppression d'une rubrique vide).
- Pages (`src/modules/pages/admin-pages.*`, `page-sections.schemas.ts`) : liste, page avec son brouillon, `PUT`
  (sauvegarde automatique du brouillon), `publish`, `discard`, `preview-token` ; sections validées par l'union
  `PageSection` du contrat (zod, propriétés inconnues ignorées), HTML des articles assaini.
- Zones (`src/modules/zones/admin-zones.*`) : liste (`showFees` du paramètre `zones`, demandes des 12 derniers mois
  par quartier), création, modification (quartiers, contour, tarif), ordre, suppression.
- Paramètres (`src/modules/settings/admin-settings.*`) : `GET`/`PUT /v1/admin/settings/{group}` pour les 9 groupes du
  contrat, `GET /v1/admin/system-status`. E-mails (`src/modules/mail/admin-email-templates.*`,
  `email-template-catalog.ts`) : liste, modèle, modification, aperçu, envoi de test.
- Lecture publique : `?preview=` de `GET /v1/pages/{key}` (brouillon, `isPreview: true`) et de
  `GET /v1/services/{slug}` (fiche de tout statut), `Cache-Control: private, no-store`.
- Socle : `common/html/rich-text.ts` (assainissement ; dépendances `sanitize-html` 2.18.1 et `@types/sanitize-html`
  2.16.2, versions figées), `common/text/slug.ts`, `common/preview/preview-token.ts`,
  `common/revalidation/revalidation.ts`, `common/validation/content.schemas.ts`, `modules/navigation/redirects.ts`,
  `modules/media/media-refs.ts`, `modules/auth/audit-actor.ts`.
- Contrat : 403 `Forbidden` sur les opérations du lot qui ne le déclaraient pas ; 400 `InvalidQuery` (liste des
  services) ; 404 (suppression d'une rubrique, abandon et aperçu d'une page, groupe de paramètres inconnu,
  modification, aperçu et test d'un modèle d'e-mail) ; 409 (slug d'une rubrique, test d'un modèle désactivé) ; 422
  (ordre des rubriques et des zones, aperçu et test d'un modèle) ; règles décrites (slug et SEO pré-remplis,
  `If-Match`, redirections, duplication, complétude, aperçu, brouillon, variables des e-mails) ; liste blanche du
  schéma `Html` précisée ; `AdminService` : `categoryId`, `coverImageId`, titres des blocs (facultatifs). Site
  synchronisé (`pnpm contract:sync`, `pnpm contract:generate` : seuls `contracts/openapi.yaml` et
  `src/lib/api/schema.d.ts` changent).
- Tests : unitaires (`rich-text.spec.ts`, `slug.spec.ts`, `preview-token.spec.ts`, `admin-catalog.mapper.spec.ts`,
  `admin-zones.schemas.spec.ts`, `email-template-catalog.spec.ts`) ; e2e `test/admin-catalog.e2e-spec.ts` et
  `test/admin-site-content.e2e-spec.ts` (données `test/fixtures/content.ts`), avec un bloc sur la base réelle. Le double
  de Prisma retrouve désormais les relations des contenus par clé (service → rubrique, rubrique → services, zone →
  quartiers…), y compris pour les tris, et comprend `Prisma.DbNull`.

### Décisions

- **Rôles** : matrice inchangée. Lecture `content:read` (ADMIN, MANAGER, EDITOR, WRITER), écriture `content:write`
  (ADMIN, EDITOR, WRITER) : le MANAGER est en lecture seule (403 sur chaque écriture, testé). Paramètres :
  `settings:read` (ADMIN, MANAGER, EDITOR), `settings:write` (ADMIN, EDITOR), `analytics` et `securite` réservés à
  `settings:admin` (« Ces paramètres sont réservés aux administrateurs. »). Aperçu d'un e-mail : `settings:read`
  (contrat), envoi de test : `settings:write`.
- **Slugs** : tirés du nom (`slugify` : sans accents, ligatures dépliées), suffixés `-2`, `-3`… s'ils sont pris ; un
  slug choisi et déjà pris → 409 (services et rubriques). Unicité globale des services (contrainte de la base).
- **Verrouillage optimiste** : `version: "v<n>"` (forme du back-office simulé), `If-Match` facultatif (avec ou sans
  guillemets, `W/` accepté), différent → 412 `precondition-failed`. Publication et dépublication incrémentent aussi
  la version.
- **Publication d'un service** : statut seulement (fiche, carte, menu, devis, plan du site se lisent sur les services
  publiés) ; exige nom et accroche ; `publishedAt` gardé s'il est passé, sinon maintenant (une publication programmée
  plus tard devient immédiate). Dépublication : brouillon, `publishedAt` conservé (comme le back-office simulé).
  Suppression : brouillon ou archivé seulement, listes liées supprimées, offres qui le présélectionnaient détachées,
  demandes et avis conservés (`SetNull`).
- **Redirections** : un changement de slug ou de rubrique d'un service publié, ou du slug d'une rubrique publiée
  (avec ses fiches publiées), crée une redirection 301 ; les redirections vers l'ancienne adresse sont reportées sur
  la nouvelle, une redirection partant de la nouvelle adresse est supprimée (pas de boucle). Pas de redirection pour
  les formules (adresse `#formules` de la rubrique).
- **Revalidation (point d'accroche)** : chaque modification visible sur le site inscrit, dans sa transaction, une
  ligne `revalidation_requests` `PENDING` avec les étiquettes de `mambo-proxi-web/src/lib/api/tags.ts`
  (`services`, `service:<slug>`, `category:<slug>`, `categories`, `navigation`, `sitemap`, `page:<clé>`, `zones`,
  `settings`, `redirects`). Le module de revalidation enverra ces demandes. En attendant, les routes publiques n'ont
  aucun cache côté API : `Cache-Control: public, no-cache` et `ETag` recalculé sur le corps ; les tests vérifient
  qu'une publication change aussitôt le corps et l'`ETag` (un ancien `If-None-Match` reçoit 200).
- **Aperçu** : jeton HMAC-SHA256 (`TOKEN_SIGNING_SECRET`, préfixe `preview`) `{ k, id, exp }`, 30 minutes, valable pour
  un seul contenu, sans état ; adresse `WEB_URL` + chemin + `?preview=` (avant l'ancre). Réponse jamais mise en cache
  (`private, no-store`). Le contrat accepte `preview` sur les rubriques sans route pour en délivrer : ignoré.
- **Pages** : un type de section absent de `allowedSectionTypes` n'est accepté que pour une section déjà présente
  (même `id` et `type`, publiée ou dans le brouillon) ; la `source` d'une section `dynamic` ne change pas ; types par
  défaut si la page n'en déclare aucun (légales : `hero`, `richText`). Publication sans brouillon d'une page déjà
  publiée : renvoyée telle quelle ; page jamais publiée : publiée. Sauvegarde automatique non journalisée ;
  publication et abandon journalisés.
- **HTML riche** : liste blanche du schéma `Html` ; `b`/`i` → `strong`/`em` ; seul `href` est gardé, en `http(s)`,
  `mailto`, `tel` ou relatif au site (`/…`, `#…`) ; lien refusé : balise retirée, texte gardé ; `script`, `style`,
  `iframe`… supprimés avec leur contenu. Assaini à l'enregistrement du brouillon (idempotent).
- **Zones** : clé tirée du nom à la création, jamais changée ensuite ; `quarters` remplace la liste et retire ces
  quartiers des autres zones ; traduction d'un quartier gardée tant que son texte français ne change pas ; ordre de 0
  à n-1 (comme le seed et le back-office simulé). Demandes par zone : `contacts.city_key` commence par un quartier.
- **Paramètres** : `PUT` du groupe complet (schéma du contrat), clés internes conservées (libellés d'affichage retirés
  quand le numéro change, recalculés à la lecture), groupe jamais enregistré renvoyé avec des valeurs par défaut.
  Journal : noms des champs modifiés seulement (adresses et numéros hors du journal).
- **E-mails** : fiches (nom, description) reprises du back-office simulé ; variables = celles que l'API sait remplir
  pour le modèle (données d'exemple des gabarits, plus `{référence}` des accusés de réception) ; une autre variable →
  422 `unknown_variable`. Modèles indispensables (`canDisable: false`, toujours envoyés) : code, mot de passe,
  invitation, confirmation de la newsletter, gabarit des campagnes (`ESSENTIAL_TEMPLATES`, appliqué aussi à l'envoi).
  Aperçu : gabarit React Email réel, données d'exemple, coordonnées des paramètres. Test : modèle enregistré mis en
  file, 409 si le modèle est désactivé (le worker ne l'enverrait pas), adresse absente du journal.
- **Journal d'activité** : `service.create|update|publish|unpublish|duplicate|delete|reorder` (mise à jour journalisée
  pour un service en ligne seulement : la sauvegarde automatique d'un brouillon toutes les 1,5 s n'y figure pas),
  `category.*`, `page.publish|discard`, `zone.*`, `settings.update`, `email-template.update|test`.

### Écarts avec le back-office simulé du site (le contrat prime)

- Erreurs au format du contrat (`type` `https://api.mamboproxi.com/problems/…`, titre « Certaines informations sont à
  corriger ») au lieu de `about:blank` / « Données invalides » ; toutes les erreurs d'un corps sont renvoyées (le
  mock des zones n'en renvoie qu'une). Chemin d'un quartier en double : `quarters.<i>.name` (mock : `quarters`).
- Création d'un service : 409 pour un slug choisi déjà pris (le mock suffixe toujours) ; rubrique : slug tiré du nom
  suffixé au lieu d'un 409 ; modification d'une rubrique : slug contrôlé (409), le mock ne vérifie rien.
- Ordre des services : identifiants d'une même rubrique exigés même sans `scope` ; doublons refusés. Ordre des
  rubriques et des zones : identifiant inconnu → 422 (le mock des zones l'ignore).
- `PUT` d'une page sans `sections` : 422 (mock : 400). Section `dynamic` dont la source change : 422 (mock : accepté).
  Service publié dont l'accroche est vidée : 422 (mock : accepté). HTML assaini (le mock enregistre tel quel).
- Jeton d'aperçu des pages : 30 minutes (mock : 60), jeton signé au lieu d'un identifiant aléatoire.
- `requests30d`, `requestsCount`, `showFees`, `system-status` calculés (le mock renvoie des valeurs fixes : `1.0.0`,
  `Resend`) ; `system-status.lastBackupAt` vaut `null` tant que les sauvegardes n'existent pas.
- E-mails : variables `{lien}` et `{organisation}` du mock absentes (l'adresse du bouton est fournie à part, la
  structure du partenaire n'est pas une variable de l'API) ; `{nom}`, `{ville}`, `{heure}`, `{lieu}`, `{rubrique}`,
  `{poste}` en plus ; texte avec une variable inconnue refusé (mock : accepté) ; test d'un modèle désactivé : 409
  (mock : 202). Un modèle jamais enregistré en base a `updatedAt` = 1970-01-01 (le seed les crée tous).

### Difficultés et solutions

- **Double de Prisma** : les lignes créées par l'API n'ont pas les valeurs par défaut de la base ; les créations de
  services, rubriques et zones écrivent désormais toutes leurs colonnes (comportement identique en base réelle).
- **`sanitize-html`** : renommer une balise refusée (`a` → `span`) produisait une fermeture `</span>` sur le lien
  suivant ; remplacé par `exclusiveFilter` → `'excludeTag'` (balise retirée, texte gardé).
- **Machine** : commandes lourdes lancées une à une ; tests sur la base réelle non lancés en local (pas de Docker),
  exécutés par la CI.

### Points ouverts

- Revalidation : envoi des demandes `revalidation_requests` (`POST {WEB_URL}/api/revalidate`, secret, réessais).
- Médiathèque : tenir `media_usages` à jour à l'enregistrement des contenus (pages, rubriques, paramètres, services) et
  refuser la suppression d'une image utilisée.
- Textes anglais des contenus (`translations`) : aucune opération du contrat ne les modifie ; ils restent ceux du seed
  quand le français change (à prévoir dans le contrat pour le site bilingue).
- Navigation (pied de page, promotion du méga-menu) et `showFees`/`note` des zones : pas de groupe de paramètres dans
  le contrat, donc pas d'écriture.
- Un service publié, dépublié puis republié à une autre adresse ne reçoit pas de redirection depuis l'ancienne
  (l'adresse publiée n'est pas mémorisée).

### Correctif après la CI (blocs sur la base réelle)

- **Titres Google des rubriques trop longs** (seed : 66 à 69 caractères pour 60 ; `GET /v1/admin/categories` non
  conforme) : raccourcis dans `prisma/seed/data/catalogue.json`, ainsi que les phrases d'accroche des services qui
  dépassaient les 120 caractères du contrat (refrain « Vous nous confiez votre demande, nous nous occupons du reste. »
  ramené à « Nous nous occupons du reste. », « We take care of the rest. » en anglais). Mêmes textes alignés dans les
  exemples du contrat, `test/fixtures/public-content.ts` et les données simulées du site (`catalogue-services.json`,
  `category-details.ts`, `service-details.ts`, `contract-examples.json` régénéré). Le double ne l'avait pas vu : ses
  données sont écrites à la main (ou reprises des données simulées du site), le seed n'est lu que par la base réelle.
  Nouveau test unitaire `src/seed-content.spec.ts` : rubriques, services, pages, zones, paramètres et modèles
  d'e-mails du seed (français et traductions) passés aux schémas d'enregistrement du back-office. Une base déjà
  remplie garde les anciens textes (le seed n'écrase pas) : à corriger dans le back-office ou en relançant le seed sur
  une base vide.
- **Aller-retour d'un brouillon de page** : le seed des pages (et la promotion du méga-menu) recopiait les images sous
  la forme du contrat (`{ illustration, image: { id, url, width, height, variants }, alt }`), renvoyée telle quelle, alors
  qu'un brouillon enregistré passe par référence et revient sous la forme complète de la médiathèque (`alt`,
  `focalPoint`, `blurDataUrl`). Cause corrigée des deux côtés : le seed enregistre des références
  (`{ illustration, imageId, alt }`), et la lecture des JSON relit dans la médiathèque toute image copiée dont
  l'identifiant y existe (`resolveJsonVisuals`) : même forme, à jour, pour le site et le back-office. Le double
  reproduit le cas (copie dans `test/fixtures/content.ts`, test d'aller-retour sans base réelle).

## Phase 2 — Rendez-vous et disponibilités (27 octobre 2026)

### Fait

- Module `src/modules/appointments` : créneaux libres (`availability.ts`, calcul pur), disponibilités
  (`availability.service.ts` : plages `availability_rules`, exceptions `availability_exceptions`, paramètre
  `availability`), occupation des créneaux et verrou (`appointment-slots.ts`), e-mails au client
  (`appointment-mail.service.ts`, invitation `ics.ts`), rappels de la veille (`appointment-reminders.service.ts`,
  worker `appointment-reminder.processor.ts`), acceptation d'un créneau proposé (`appointments.service.ts`),
  back-office (`admin-appointments.*`), libellés FR/EN (`appointment-labels.ts`), schémas zod.
- Site : `GET /v1/appointments/availability`, `POST /v1/appointments` (dans `FormsService`, avec l'anti-spam, la fiche
  contact, la demande `RENDEZ_VOUS` de même référence, les notifications et l'alerte de l'équipe des autres
  formulaires ; nouveau crochet `afterRequest`), `POST /v1/appointments/{reference}/accept-proposal`.
- Back-office : `GET|POST /v1/admin/appointments`, `GET|PATCH /v1/admin/appointments/{id}` (`confirm`, `propose`,
  `cancel`, `complete`, `notes`, `assign`), `GET|PUT /v1/admin/availability`.
- Socle : `common/time/agency-day.ts` (heure locale ↔ instant à décalage fixe, jours `AAAA-MM-JJ`, jour ISO de la
  semaine), usage `appointment-proposal` des condensats de jetons, clé de paramètre `availability`, file
  `appointment-reminders` (`REMINDER_JOB_OPTIONS`). Gabarits : lieu, lien de visio et message de l'agence ajoutés aux
  cartes des rendez-vous (`template-definitions.ts`).
- Contrat : 403 `Forbidden` (avec l'exemple `csrfTokenInvalid` de la réponse commune) sur les 7 opérations du
  back-office, 400 `InvalidQuery` sur l'agenda, exemple 409 `slot-taken` sur la saisie manuelle, exemple 410 et
  réponses 422 / 429 sur l'acceptation ; règles décrites (calcul des créneaux, validation du créneau demandé,
  transitions, défauts du lieu et du lien, report, rappel, remplacement des disponibilités). Site synchronisé
  (`pnpm contract:sync`) : seuls `contracts/openapi.yaml` et `src/lib/api/schema.d.ts` changent.
- Tests : unitaires `agency-day.spec.ts`, `availability.spec.ts`, `appointment.schemas.spec.ts`, `appointments.spec.ts`,
  seed des disponibilités et des rendez-vous (`seed-content.spec.ts`) ; e2e `test/appointments.e2e-spec.ts` (données
  `test/fixtures/appointments.ts`) et `test/appointment-reminders.e2e-spec.ts` (Redis réel).
- Double de Prisma rapproché de PostgreSQL : annulation des écritures d'une transaction qui échoue, index uniques des
  rendez-vous (référence et index partiel du créneau) avec l'erreur P2002 sous la forme de l'adaptateur `pg`,
  `null` pour une colonne sélectionnée jamais renseignée, `$executeRaw`, tables des disponibilités. Les 196 tests e2e
  existants passent inchangés. `test/support/auth.ts` : double de la file des rappels (`ReminderQueueDouble`), branché
  par défaut dans `createApp` (aucun test ne joint Redis par erreur).

### Décisions

- **Créneaux** : chaque plage hebdomadaire est découpée par pas de sa durée (`slotMinutes`) tant que le créneau tient
  avant la fin ; horaires exceptionnels = une plage aux durée et formats de la première règle du jour (comme le
  back-office simulé). Un créneau est retiré avant le délai minimal (`minNoticeHours`, 24 h), après l'horizon
  (`maxAdvanceDays`, 60 j), s'il chevauche un rendez-vous à confirmer ou confirmé, ou le créneau proposé d'un
  rendez-vous « Autre créneau proposé » (même durée ; son créneau d'origine est libéré, comme dans l'index partiel).
  `closedReason` : libellé de l'exception, « Fermé le <jour> », « Complet », sinon `null`. Réponse `no-store`.
- **Fuseau** : Douala est à UTC+1 toute l'année ; conversion par décalage fixe (aucune table de fuseaux), vérifiée de
  part et d'autre des changements d'heure européens (29 mars et 25 octobre 2026).
- **Demande en ligne** : `startsAt` doit être un des créneaux proposés pour ce format (sinon 422 sur `startsAt`), la
  fin est celle du créneau. Vérification sous verrou dans la transaction : déjà pris → 409 `slot-taken`.
- **Double réservation** : toute transaction qui prend un créneau (demande, saisie, confirmation, proposition,
  acceptation) pose `pg_advisory_xact_lock(hashtext('mambo:appointments'))` avant de vérifier le chevauchement (deux
  durées différentes peuvent se chevaucher sans avoir le même début, ce que l'index ne voit pas) ; ordre des verrous
  identique partout (verrou consultatif, puis compteur des références) : pas d'interblocage avec les autres
  formulaires. L'index unique partiel reste le dernier rempart : `isSlotTakenError` reconnaît la P2002 de l'adaptateur
  (`meta.driverAdapterError.cause.constraint.index`, message « Unique constraint failed on the constraint: … ») et la
  traduit en 409. `$executeRaw` plutôt que `$queryRaw` : la fonction renvoie `void`, que le client ne sait pas lire.
- **Saisie manuelle** : confirmée d'office, non limitée aux plages du site mais sans chevauchement (409 `slot-taken`
  avec la référence du rendez-vous en conflit) ; assignée par défaut à qui la saisit, à quelqu'un d'autre avec
  `appointments:assign` ; personne assignable = membre actif dont le rôle voit des rendez-vous. Lieu par défaut
  (Agence) : `agencyAddress` ; lien par défaut (Visio) : `defaultVideoLink`, sinon `null` (aucun lien inventé).
- **Actions** : `confirm` sur « À confirmer » ou « Autre créneau proposé » (passe sur le créneau proposé) ; `propose`
  sur tout rendez-vous non clos, créneau à venir et libre, lien valable jusqu'au début du créneau proposé (7 jours au
  plus) ; `cancel` sur tout rendez-vous non clos (lien d'acceptation effacé) ; `complete` sur « Confirmé » ; `notes`
  sur tout rendez-vous ; 409 sinon. Rôle : toute action sauf `assign` avec `appointments:write`, ou
  `appointments:write-assigned` pour ses rendez-vous ; un rendez-vous hors du périmètre de lecture est introuvable.
- **Acceptation** : jeton aléatoire de 256 bits, condensat HMAC-SHA256 (usage `appointment-proposal`) ; lien inconnu,
  remplacé ou expiré → 410 ; rendez-vous clos → 409 ; créneau pris → 409 `slot-taken` ; seconde ouverture après
  acceptation → même réponse 200 (le condensat est gardé jusqu'à une nouvelle proposition ou une annulation). La
  personne assignée reçoit une notification. Limité à 5 envois par minute et par adresse, comme les formulaires.
- **Rappel** : la veille (jour de Douala) à `emails.appointmentReminderHour` (9 h par défaut), tâche différée BullMQ
  d'identifiant `rappel-<id>-<début en ms>` (sans `:`) : programmée à chaque confirmation (saisie, `confirm`,
  acceptation), retirée à la proposition d'un autre créneau, à l'annulation et à la fin. Moment déjà passé : pas de
  rappel. À l'exécution, la tâche ne fait rien si le rendez-vous n'est plus confirmé au même créneau ou a déjà été
  rappelé : `reminderSentAt` est posé par un `updateMany` conditionnel avant la mise en file de l'e-mail (une seule
  exécution envoie, même rejouée). Worker démarré avec celui des e-mails (`MAIL_WORKER=on`).
- **E-mails** : dans la langue du rendez-vous (celle de l'envoi en ligne, celle de la fiche pour une saisie) ;
  `appointment-confirmed` avec invitation `.ics` (UTC, `METHOD:REQUEST`, UID stable par rendez-vous, `SEQUENCE`
  croissante), lieu ou lien de visio ; `appointment-proposed` avec le lien `…/rendez-vous/confirmer?ref=&token=` ;
  `appointment-cancelled` avec le lien de prise de rendez-vous ; message de l'agence repris dans la carte. Aucun
  e-mail pour une fiche anonymisée.
- **Journal d'activité** : `appointment.create|confirm|propose|cancel|complete|assign`, `availability.update` ;
  libellés avec la référence et le créneau (« A confirmé le rendez-vous MP-2026-0142 (jeudi 12 novembre 2026 à
  14:00) »), jamais le nom du client. Notes internes non journalisées (comme les notes des demandes).
- **Disponibilités** : `PUT` remplace plages et exceptions (identifiant connu conservé, sinon nouvelle ligne) ;
  contrôles : fin après début, pas de chevauchement de deux plages d'un même jour, une exception par date, horaires
  obligatoires d'une journée non fermée ; `agencyAddress` / `defaultVideoLink` absents → valeurs conservées. Aucun
  contenu public mis en cache ne dépend des disponibilités (lues à chaque appel) : pas de demande de revalidation.
- **Aucune migration** : toutes les colonnes nécessaires existaient (`proposal_token_hash`, `proposal_expires_at`,
  `reminder_sent_at`, `language`…).

### Écarts avec le back-office simulé du site (le contrat prime)

- Agenda : paramètres invalides ou absents → 400 `invalid-query` (mock : 422). Erreurs au format du contrat (titres,
  `type`, chemins en notation pointée `rules.0.endTime`, mock : `rules[0].endTime`).
- Saisie manuelle et proposition : conflit signalé par la référence et le créneau du rendez-vous en conflit (mock : nom
  du contact) ; aucun lien de visio fabriqué (mock : `https://meet.mamboproxi.com/rdv-…`) ; lieu par défaut seulement
  pour le format Agence (comme le mock).
- Demande en ligne : créneau contrôlé (422 / 409, le mock accepte tout) ; durée = celle de la plage du créneau (mock :
  première règle trouvée).
- Disponibilités : chevauchement de plages et dates en double refusés (mock : acceptés).
- Acceptation : sémantique réelle (mock : jetons `expire` → 410 et `pris` → 409).

### Difficultés et solutions

- **Le double ne reproduisait ni l'annulation d'une transaction ni l'index unique** : sans cela, la traduction de la
  P2002 et l'absence d'écriture partielle ne pouvaient être testées sans base. Ajoutés au double (copie des tables
  avant `fn`, restaurée en cas d'erreur ; index déclarés par table), puis vérifiés sur la vraie base dans le bloc
  `E2E_REAL_SERVICES` (deux réservations simultanées du même créneau → un 201 et un 409 ; insertion directe d'un
  second rendez-vous actif au même instant → P2002 reconnue).
- **Colonnes jamais renseignées** : une ligne créée par l'API sans `anonymizedAt` renvoyait `undefined` au lieu de
  `null` ; le double renvoie désormais `null` pour toute colonne sélectionnée, comme PostgreSQL.
- **zod 4** : les contrôles d'ensemble (`superRefine` de l'objet) s'exécutent même quand un champ est en erreur ;
  toutes les erreurs sont donc renvoyées d'un coup (testé).
- **Machine** : tests sur PostgreSQL et Redis réels non lancés en local (pas de Docker) ; les blocs concernés ont été
  relus ligne à ligne (requêtes, formes renvoyées par l'adaptateur, nettoyage).

### Points ouverts

- Compteur « Rendez-vous » des pastilles (`sidebar-counts`) et bloc du tableau de bord : module du tableau de bord.
- Rappel d'un rendez-vous dont l'heure de rappel change dans les paramètres : les tâches déjà programmées gardent
  l'ancienne heure (identifiant inchangé) ; à reprogrammer si le paramètre change (non prévu par le contrat).
- La demande `RENDEZ_VOUS` reliée n'est pas mise à jour quand le rendez-vous est confirmé, annulé ou terminé (statuts
  indépendants) ; à décider avec la cliente.
- Invitation `.ics` d'annulation (`METHOD:CANCEL`) : non envoyée (le gabarit d'annulation n'en joint pas).

## Phase 2 — Questionnaires de satisfaction et avis clients (27 octobre 2026)

### Fait

- **Modules** `src/modules/surveys` (page publique par jeton, questions du back-office, file `survey-invitations`) et
  `src/modules/reviews` (avis publiés, modération, indicateurs) ; branchés sur les demandes (`AdminRequestsService`
  programme l'invitation après la transaction du passage à « Prestation réalisée ») et sur l'anonymisation
  (`anonymizeReviewsOfRequests` dans `anonymizeInTx`, donc aussi l'effacement d'un contact).
- **Routes** : `GET /v1/reviews`, `GET /v1/reviews/summary`, `GET /v1/surveys/{token}`,
  `POST /v1/surveys/{token}/responses`, `/v1/admin/reviews` (GET, POST), `/v1/admin/reviews/stats`,
  `/v1/admin/reviews/{id}` (PATCH, DELETE), `/v1/admin/reviews/{id}/reply`, `/v1/admin/survey-questions` (GET, PUT),
  toutes sous `reviews:moderate` côté back-office.
- **Aucune migration** : les colonnes de `surveys`, `survey_questions` et `reviews` existaient.
- **Contrat** : 400 `InvalidQuery` (listes publiques et du back-office), 403 `Forbidden`, 409 (mise en avant d'un avis
  non publié, suppression d'un avis vérifié), 422 (PATCH, réponse), règles décrites ; pas de nouvelle route.
- Tests non écrits (priorité au branchement du site) ; la file des questionnaires est remplacée par un double dans
  l'application de test (`test/support/auth.ts`) pour que les tests existants n'ouvrent pas Redis.

### Décisions

- **Lien du questionnaire** : jeton de 256 bits dérivé par HMAC de l'identifiant du questionnaire et de l'instant
  d'envoi (`TOKEN_SIGNING_SECRET`, usage `survey-link`) ; seul son condensat HMAC (`survey`) est stocké. La relance
  recalcule le même lien : aucun jeton en clair ni en base ni dans Redis. Le jeton provisoire posé à la programmation
  est remplacé à l'envoi. Changer le secret invalide les liens en cours.
- **File `survey-invitations`** (comme les rappels de rendez-vous) : tâches
  `questionnaire-<id>-invitation`, `-relance`, `-expiration` ; invitation réservée par `updateMany` `SCHEDULED → SENT` (une seule exécution envoie), relance
  `SENT → REMINDED` si toujours sans réponse et ouvert, expiration `SENT|REMINDED → EXPIRED`. Rien n'est envoyé pour
  une demande ou une fiche anonymisée, ni pour une demande revenue avant « Prestation réalisée » (ligne supprimée).
  Au démarrage du worker (`MAIL_WORKER=on`), reprise des questionnaires en attente (Redis perdu ou indisponible au
  moment de la programmation), au plus 500 de chaque sorte. `surveyReminderDays: null` → pas de relance.
- **Réponse** : question active connue et unique, STARS 1–5, NPS 0–10, CHOICE parmi les choix (français ou anglais,
  enregistré en français), TEXT ; obligatoires renseignées ; toutes les erreurs d'un coup (422). Lien inconnu au POST →
  410 (seule erreur de lien du contrat). Avis créé « À valider », vérifié, seulement avec consentement **et** note
  STARS ; texte = commentaire libre (vide sinon) ; nom affiché fourni ou « Prénom N. » de la fiche ; ville fournie ou
  celle de la fiche ; réponses lisibles (« 5/5 — Excellent ») dans `answersSnapshot`. Événement `SURVEY_ANSWERED`,
  notification `REVIEW` aux rôles `reviews:moderate`.
- **Modération** : publication sans consentement → 409 `no-publish-consent` ; mise en avant d'un avis non publié →
  409 ; masquer ou remettre « À valider » retire la mise en avant. Les liens des fiches (`featuredReviewIds`) et des
  rubriques (témoignage) sont conservés : les lectures publiques filtrent déjà sur « Publié ». Toute modification
  d'un avis publié, ou qui cesse de l'être, inscrit `reviews` + `service:<slug>` (service et fiches qui le mettent en
  avant) + `category:<slug>` (témoignage). Suppression réservée aux témoignages saisis à la main (409 sinon).
- **Public** : service d'un avis cité seulement s'il est visible sur le site ; synthèse vide → `average: 0`.
- **Anonymisation** : avis issus des questionnaires des demandes anonymisées : nom « Client anonymisé », ville et
  réponses retirées, masqué, consentement retiré (il ne peut plus être republié).
- **Statistiques** : moyenne et répartition des avis publiés ; écarts sur 30 jours (date de l'avis, date de réponse
  pour la recommandation) ; taux de réponse = questionnaires remplis / envoyés.

### Écarts avec le back-office simulé du site (le contrat prime)

- Lien inconnu au POST : 410 (mock : 201 pour tout jeton) ; GET : 404 / 410 avec les `type` du contrat.
- PUT des questions : erreurs aux chemins `0.label`, `0.options` comme le mock ; règles STARS (5 libellés) et NPS
  (2 bornes) en plus.
- Témoignage manuel : `serviceDate` et date affichée = `date` (mock : `createdAt` = `date`).

### Points ouverts

- Liste, détail et relance manuelle des questionnaires dans le back-office : pas de route au contrat (le suivi est
  dans `RequestDetail.survey` et l'historique).
- Compteur « Avis » des pastilles (`sidebar-counts`) et carte « questionnaires » du tableau de bord : module du
  tableau de bord.
- Tests unitaires et e2e du lot (file, réponses, modération, contrat) : après le branchement du site.

## Phase 2 — Offres d'emploi, candidatures et stockage des fichiers (27 octobre 2026)

### Fait

- **Stockage** (`src/modules/storage`, module global) : interface `StorageDriver` (`put`, `get` en flux avec taille,
  `delete` idempotent, `check`) et pilote disque local (`STORAGE_DRIVER=local`, répertoire `STORAGE_DIR`, `var/storage`
  par défaut, ignoré par git) : clés `cv/AAAA/MM/<128 bits aléatoires>.<ext>`, jamais tirées du nom envoyé ; chemin
  confiné au répertoire ; écriture atomique (fichier temporaire puis renommage), droits `0600`. Aucun fichier n'est
  servi statiquement.
- **Contrôle des documents** : type réel par signature, écrite à la main (PDF `%PDF-` dans le premier Ko ; DOC : en-tête
  OLE2 et flux `WordDocument` ; DOCX : archive ZIP avec `[Content_Types].xml` et `word/`) ; ODT, XLS, ZIP quelconque,
  exécutable ou fichier vide → 415 `unsupported-file`. 5 Mo : limite de multer (413 `file-too-large` avant toute autre
  vérification) et contrôle du service. Nom affiché assaini (sans chemin ni caractère de contrôle ou réservé, 120
  caractères, extension du type réel). Empreinte SHA-256 conservée. ClamAV : interface `VirusScanner`, implémentation
  désactivée (`SKIPPED`) ; un fichier `INFECTED` serait refusé (415) avant tout enregistrement.
- **Liens signés** : `SignedUrl` de 5 minutes, jeton `{ a, exp }` signé HMAC-SHA256 (`TOKEN_SIGNING_SECRET`, usage
  `file-download`, même forme que les jetons d'aperçu), servi par `GET /v1/files/{token}` (route publique ajoutée au
  contrat : le jeton tient lieu de session). La pièce jointe est relue à chaque téléchargement : anonymisée, demande
  anonymisée ou fichier absent → 404 ; lien périmé → 410 `link-expired`. Réponse `private, no-store`,
  `Content-Disposition: attachment` (nom ASCII de repli + `filename*` UTF-8), CSP `sandbox`.
- **Offres (site)** : `GET /v1/jobs` (publiées, date de publication passée, non expirées, plus récentes d'abord ;
  `city` / `contract` sur le début du libellé, `q` sur titre et accroche, sans accents ni casse, dans la langue
  demandée) ; `GET /v1/jobs/{slug}` (brouillon ou inconnue → 404, archivée ou expirée → 410 `job-closed`). Badge
  `isNew` < 7 jours. Traductions par la colonne `translations.en`.
- **Candidature** (`POST /v1/job-applications`, `multipart/form-data`) : multer en mémoire (un fichier `cv`, champs
  limités), champs et fichier validés ensemble (422 avec `cv` si le CV manque), anti-spam des formulaires (piège →
  succès factice sans fichier enregistré, délai, Turnstile), 5 envois par minute. Offre visée publiée et non expirée,
  sinon 422 `jobSlug`. Le CV est enregistré avant la transaction et supprimé si elle échoue ; la transaction crée
  contact, demande `CANDIDATURE` (`jobOfferId`, champs « Poste visé », « Ville », « CV »), pièce jointe `CV` reliée à
  la demande, candidature `NOUVEAU` ; notifications `APPLICATION` vers `/admin/recrutement?candidature=<id>`. E-mails :
  `application-received` (modèle du seed, fr/en, `jobTitle` traduit ou « Candidature spontanée ») et
  `team-new-request`. Enregistrement par `FormsService` (même chemin que les autres formulaires).
- **Back-office** : `/v1/admin/jobs*` (`content:read` / `content:write`) : liste (publiées, brouillons, archivées ;
  compteurs de candidatures et de nouvelles, demandes anonymisées exclues), création (brouillon par défaut, slug libre
  tiré du titre, 422 `slug_taken`), modification partielle dont publication (date de première publication posée) et
  archivage, suppression (candidatures conservées sans offre) ; publication exige au moins une mission (comme le
  mock). Revalidation `jobs`, `job:<slug>`, `sitemap` (et `redirects`) ; changement d'adresse d'une offre déjà
  publiée → redirection 301 `/recrutement/<ancien>` → `/recrutement/<nouveau>`. `/v1/admin/applications*`
  (`applications:read` / `applications:write`) : liste paginée (statut, offre ou `spontaneous`), détail (« Nouveau » →
  « Lu » par mise à jour conditionnelle, `readAt`), statut, lien signé du CV (téléchargement journalisé).
- **Pièces jointes des demandes** : `GET /v1/admin/requests/{id}/attachments/{attachmentId}` (même périmètre que le
  détail, `requests:read` / `requests:read-assigned`).
- **RGPD** : `anonymizeInTx` renvoie les clés des fichiers ; ils sont supprimés du stockage après la validation de la
  transaction (anonymisation d'une demande, effacement d'un contact), les lignes restent avec le nom
  `fichier-anonymise`. Journal d'activité : références, intitulés d'offre et statuts seulement.
- **Contrat** : `GET /v1/files/{token}` ; 400 `InvalidQuery`, 403, 422 manquants des routes du lot.
- **Configuration** : `STORAGE_DRIVER`, `STORAGE_DIR` (`env.schema.ts`, `.env.example`).
- **Aucune migration** : colonnes existantes (`attachments.storage_key`, `checksum`, `scan_status`,
  `job_applications.read_at`…).

### Décisions

- Pas de dépendance ajoutée : multer est celui de `@nestjs/platform-express` (intercepteur `FileInterceptor` dérivé
  pour traduire ses erreurs en problèmes du contrat) ; aucun SDK S3 installé, donc pas de pilote S3 (point
  d'extension documenté dans `storage.types.ts`).
- Le paramètre `preview` de `GET /v1/jobs/{slug}` est accepté sans effet : aucune route n'émet de jeton d'aperçu
  d'offre.
- Pas de nouveaux tests (priorité au branchement du site) ; tests existants passés.

### Écarts avec le back-office simulé du site (le contrat prime)

- CV : URL signée vers l'API (`/v1/files/…`) au lieu de `https://fichiers.mamboproxi.com/cv/…` ; lien périmé → 410.
- Offre supprimée : `job: null` sur ses candidatures (le mock garde l'intitulé) ; l'intitulé reste dans la demande
  liée (`subject`).
- Modification sans champ : 422 (mock : 400).

### Points ouverts

- Pilote S3 et `checks.storage` de `/v1/health` ; ClamAV à brancher (`VirusScanner`).
- Suppression automatique des candidatures refusées après la durée de conservation (24 mois) : tâche à écrire.
- CV du seed : clés sans fichier sur le disque (téléchargement → 404).
- Tests unitaires et e2e du lot : après le branchement du site.

## Phase 2 — Médiathèque (27 octobre 2026)

### Fait

- Module `src/modules/media` complété (`MediaLibraryModule`, enregistré dans `app.module.ts`) : back-office
  `GET|POST /v1/admin/media`, `GET|PATCH|DELETE /v1/admin/media/{id}`, `PUT /v1/admin/media/{id}/file` ; fichiers
  publics `GET /v1/media/{folder}/{file}` ; file BullMQ `media` (`media-processing.service.ts`, worker
  `media-processing.processor.ts`) ; usages (`media-usages.ts`) ; traitement d'image (`image-processing.ts`, sharp) ;
  assainissement SVG (`svg-sanitizer.ts`, sanitize-html) ; signature des images (`detectImageType` dans
  `storage/file-signature.ts`).
- **Envoi** : multer en mémoire (champ `file`, 10 Mo → 413 avant toute autre vérification), `alt` obligatoire (422),
  fichier manquant → 422 `file`. Type réel par octets magiques (JPEG `FF D8 FF`, PNG, RIFF/WEBP, SVG : texte
  commençant par `<svg` après déclaration XML, commentaires et DOCTYPE) ; AVIF, GIF, HEIC, PDF… → 415. Image décodée
  entièrement (`failOn: 'error'` : fichier tronqué → 415), 50 mégapixels au plus (415), redressée selon l'orientation
  EXIF puis réencodée dans son format (JPEG mozjpeg 88, PNG niveau 9, WebP 88) **sans aucune métadonnée** (EXIF, GPS,
  XMP) ; `blurDataUrl` = WebP de 16 px en `data:` (≈ 120 octets). L'original publié est cette version nettoyée : le
  fichier envoyé n'est jamais conservé. Nom affiché assaini (`sanitizeFileName`), empreinte SHA-256 de l'envoi.
- **Variantes** : AVIF (qualité 50, effort 4) et WebP (78) en 480/960/1600 px, seulement les largeurs ≤ à l'original
  (aucun agrandissement ; image de moins de 480 px : aucune variante, `READY` aussitôt). Média `PROCESSING` jusqu'à la
  tâche `media-<id>-<dossier>` (un traitement à la fois, 3 essais à 30 s / 1 min / 2 min, puis `FAILED`). Variantes
  écrites puis `updateMany` conditionnel (même fichier, toujours `PROCESSING`) : un remplacement ou une suppression
  pendant le traitement fait jeter les variantes. Redis indisponible : l'envoi rend la main après 3 s ; au démarrage
  du worker (`MAIL_WORKER=on`), reprise des médias `PROCESSING` (200 au plus) et reconstruction de `media_usages`.
- **SVG** : liste blanche d'éléments graphiques (formes, texte, dégradés, masques, filtres `fe*`, `image`) ;
  supprimés : `script`, `style`, `foreignObject` (avec leur contenu), animations (`set`/`animate` peuvent réécrire un
  lien), `a`, gestionnaires `on*`, attributs d'espaces de noms inconnus, liens autres que `#id` (et, pour `image`,
  `data:image/png|jpeg|webp|gif;base64`), valeurs avec `url(` externe, `javascript:`, `expression(`, `@import`.
  Déclaration XML, DOCTYPE et entités retirés avant l'analyse (aucune entité développée). Publié tel quel, sans
  variante, `READY` ; dimensions et miniature tirées du rendu librsvg.
- **Remplacement** : même identifiant, texte alternatif et point focal ; nouveau dossier (adresses nouvelles, cache
  immuable), variantes régénérées ; anciens fichiers supprimés 24 h plus tard (tâche différée `media-cleanup-…` :
  pages du site encore en cache). Un média du seed remplacé devient un média stocké.
- **Modification** (`alt`, `focalPoint`, `null` = centré), **remplacement**, fin du traitement (`READY`/`FAILED`) :
  demande de revalidation (`revalidation_requests`) des étiquettes des contenus publiés qui l'utilisent (service,
  rubrique, page, paramètres, `partners`/`events`).
- **Suppression** : usages recalculés sur les contenus (brouillons et versions anglaises compris) et relations
  directes → 409 `media-in-use` « Cette image est utilisée par : … Remplacez-la avant de la supprimer. » (5 usages
  cités, les suivants comptés) ; violation de clé étrangère imprévue → même 409. Fichiers supprimés après la
  transaction (jamais ceux d'un média du seed, servis par le site).
- **Usages** (`media_usages`, sortes du seed) : `service.cover`, `service.gallery`, `offer.image` (emplacement
  `service:<id>` / `category:<id>`), `category.image`, `category.visual`, `page.section` (emplacement : section),
  `settings.seo` / `settings.navigation`. Réécrits par `MediaService.refreshUsages` après l'enregistrement d'un
  service (création, sauvegarde, duplication, suppression), d'une rubrique, d'une page (brouillon, publication,
  abandon) et des paramètres SEO. Partenaires, événements et magazine : lus par leurs clés étrangères (relations de
  `Media`) au moment de la lecture, sans écriture dans leurs modules.
- **Liste** : plus récents d'abord, `q` sur le nom du fichier et le texte alternatif (sans casse ; accents non
  repliés), `status`, `used` (table et relations directes).
- **Contrat** : `GET /v1/admin/media/{id}`, `PUT /v1/admin/media/{id}/file`, `GET /v1/media/{folder}/{file}` ;
  filtres `status` et `used` ; `focalPoint: null` ; 400, 403, 404, 413/415 (`MediaTooLarge`, `UnsupportedMedia`),
  422 ; règles décrites (traitement, SVG, suppression, remplacement).
- **Configuration** : `MEDIA_STORAGE_DIR` (`var/media`) ; `MEDIA_PUBLIC_URL` par défaut `http://localhost:4000/v1/media`.
- **Dépendance** : `sharp` 0.35.5 (version figée ; binaires libvips précompilés des paquets `@img/sharp-*`,
  `allowBuilds: sharp: false` dans `pnpm-workspace.yaml`). Chargée à la première image traitée (import dynamique) :
  ni le démarrage de l'API ni les tests ne chargent la bibliothèque native.
- Aucune migration : colonnes existantes (`media.*`, `media_usages`).

### Décisions

- **Médias publics servis par l'API** plutôt que par un répertoire statique : route `@Public()` sans limitation de
  débit, `Cache-Control: public, max-age=31536000, immutable`, `Cross-Origin-Resource-Policy: cross-origin`, CSP
  `sandbox` sur les SVG. Seuls les noms produits par l'API sont acceptés (dossier de 32 caractères hexadécimaux,
  `original.<jpg|png|webp|svg>` ou `<480|960|1600>.<avif|webp>`), lus dans un pilote de stockage distinct de celui des
  fichiers privés (`MEDIA_STORAGE_DIR`) ; le démarrage échoue si les deux répertoires coïncident ou s'imbriquent. Aucun
  fichier privé n'est donc atteignable par ce chemin. Aucune lecture de la base par image. En production, un CDN (ou
  Caddy) placé devant `/v1/media` et `MEDIA_PUBLIC_URL` pointé sur lui.
- **Usages après la transaction** du contenu, sans la faire échouer (journalisé) : le double de Prisma des tests e2e
  ne connaît pas `media_usages` (non modifié, priorité au branchement) ; la table est reconstruite au démarrage du
  worker, et la suppression d'un média ne s'appuie pas sur elle (recalcul sur les contenus : quelques dizaines de
  lignes).
- Remplacement ajouté au contrat (le back-office simulé ne l'a pas) : le cahier des charges prévoit de remplacer les
  illustrations par les vraies photos sans reprendre chaque contenu.
- Pas de « légende » : ni colonne ni champ au contrat.

### Écarts avec le back-office simulé du site (le contrat prime)

- Envoi : `status: PROCESSING` et `variants: []` jusqu'à la fin du traitement (mock : `READY` aussitôt) ; `url`
  absolue vers l'API (mock : `blob:`) ; 415 sur le type réel (mock : type annoncé par le navigateur) ; erreurs de champ
  au format du contrat.
- Suppression d'un média utilisé : `type` `media-in-use`, titre « Image utilisée » et texte du contrat (mock : 409
  générique « Ce média est utilisé (…) : retirez-le d'abord. »).
- Libellés d'usage : forme du seed (« Service « Maison Essentiel » (photo principale) »).

### Points ouverts

- Site : `next.config` (`images.remotePatterns`) doit autoriser l'hôte de `MEDIA_PUBLIC_URL` ; le composant `<Visual>`
  peut servir `variants` (AVIF/WebP) en `srcset` et `focalPoint` en `object-position`.
- Pilote S3 des médias (bucket public `S3_BUCKET_PUBLIC`) ; `checks.storage` de `/v1/health` pour les médias.
- Recherche sans accents (colonne de recherche à ajouter si besoin).
- Tests unitaires et e2e du lot (signature, SVG, traitement, routes, contrat) : après le branchement du site.

## Phase 2 — Partenaires, formations, agenda et newsletter (27 octobre 2026)

### Fait

- **Partenaires** (`src/modules/partners`) : `GET /v1/partners` (logos visibles, triés par catégorie puis par ordre,
  libellé de catégorie traduit) ; `/v1/admin/partners*` : ajout (fin de catégorie, visible par défaut), modification
  dont visibilité et changement de catégorie, ordre (`scope` = catégorie facultative), suppression. Logo : image de la
  médiathèque (422 `unknown_media` sinon).
- **Formations** (`src/modules/trainings`) : `GET /v1/trainings` (publiées, `translations.en`) ;
  `/v1/admin/trainings*` (création en brouillon, slug libre tiré du titre, publication, ordre, suppression — les
  demandes restent sans formation), `requestsCount` = demandes `FORMATION` non anonymisées ;
  `GET /v1/admin/training-requests` (demandes `FORMATION`, la plus récente en premier).
- **Agenda** (`src/modules/events`) : `GET /v1/events` (`upcoming` : non terminés, du plus proche ; sinon tous, du
  plus récent ; `limit` = taille de page ; places restantes) ; `/v1/admin/events*` (période `upcoming` / `past` /
  `all`, inscriptions et places réservées, détail avec les demandes `EVENEMENT`, création en brouillon, fin après le
  début, capacité jamais sous les places réservées, suppression — les inscriptions restent sans événement).
- **Newsletter** (`src/modules/newsletter`) :
  - double opt-in : inscription (anti-spam des formulaires, consentement horodaté, rattachement à la fiche contact de
    même adresse), lien de confirmation à usage unique (condensat HMAC en base, 7 jours) par `newsletter-confirm`,
    confirmation `EN_ATTENTE → CONFIRME`, 410 `link-expired` ; une adresse confirmée ne reçoit rien
    (`alreadySubscribed: true`) ; l'inscription avec la case newsletter envoie aussi le lien (`FormsService`,
    `afterCommit`) ;
  - désinscription en un clic : jeton signé sans état (abonné + campagne d'origine), page du site en JSON ou POST
    `List-Unsubscribe=One-Click` (RFC 8058) avec `?token=` ; idempotente ; comptée dans `Campaign.unsubscribes` ;
  - back-office : inscrits (liste, recherche, export CSV des confirmés, suppression), campagnes (indicateurs, segments
    fixes et par étiquette avec effectifs, brouillon au HTML assaini — `img` et `a[data-button]` en plus du texte
    riche — et version texte générée, aperçu par le vrai gabarit, test « [Test] … » limité à 10 par minute,
    programmation, annulation, envoi immédiat) ;
  - envoi par lots : file BullMQ `newsletter-campaigns` (worker démarré avec `MAIL_WORKER=on`) — étapes `start`
    (réservation atomique `PROGRAMMEE → EN_COURS_ENVOI`, la programmation de la tâche doit être celle de la
    campagne), matérialisation des envois `campaign_deliveries` (unicité campagne + abonné), lots de 50 toutes les
    minutes, `finalize` (`ENVOYEE` quand plus aucun envoi n'est `PENDING`) ; identifiants de tâches stables ; reprise au
    démarrage du worker ; tâche d'e-mail `campagne-envoi-{deliveryId}` (`mailJobId`) : un envoi n'est jamais mis deux
    fois en file.
- **Socle** : étiquettes `partners`, `trainings`, `events` (`CACHE_TAGS`), file `newsletterCampaigns`
  (`QUEUE_NAMES`), `MailContentService` exporté par `MailModule` (aperçu des campagnes).
- **Contrat** : paramètre `token` (requête) et description de `POST /v1/newsletter/unsubscribe` (désinscription en un
  clic depuis la messagerie).
- **Aucune migration, aucune dépendance, aucune variable d'environnement** : colonnes existantes ; débit fixé par des
  constantes (`CAMPAIGN_BATCH_SIZE`, `CAMPAIGN_BATCH_INTERVAL_MS`).

### Décisions

- Mesure d'ouverture et de clic : le contrat ne prévoit ni pixel ni redirection de lien ; `opens` / `clicks` (et les
  taux) sont `null` tant que `analytics.newsletterTracking` est désactivé, et ne valent que les colonnes de la campagne
  sinon.
- `recipients` : 0 pour un brouillon, effectif actuel du segment pour une campagne programmée, nombre d'envois ensuite.
- La liste des campagnes comprend celles du magazine (mêmes envois, même file).
- Suppression d'un inscrit : effacement de la ligne et de ses envois individuels (droit à l'effacement) ; les
  compteurs des campagnes restent.
- Pas de nouveaux tests (priorité au branchement du site) ; tests existants passés.

### Écarts avec le back-office simulé du site (le contrat prime)

- « Envoyer maintenant » sans objet ou sans contenu : 409 (le mock accepte) ; programmation : 422 sur `subject` /
  `html` en plus de `scheduledAt`.
- Libellé du segment « Tous les inscrits » (comme le mock ; exemple du contrat : « Tous les abonnés »).
- Export CSV des inscrits : colonnes E-mail, Nom, Téléphone, Pays, Langue, Statut, Origine, Étiquettes, Confirmé le,
  Inscrit le (mock : 5 colonnes).
- Inscriptions d'un événement : toutes les demandes `EVENEMENT` (anonymisées comprises, elles occupent des places).

### Points ouverts

- Purge des inscriptions jamais confirmées (tâche RGPD quotidienne à écrire).
- Pas de détail d'un inscrit ni de préférences, pas d'export des inscrits d'un événement : absents du contrat.
- `POST /v1/admin/magazine/editions/{id}/newsletter/*` : lot du magazine (fait, voir ci-dessous).
- Tests unitaires et e2e du lot : après le branchement du site.

## Phase 2 — Magazine (27 octobre 2026)

### Fait

- **Back-office** (`src/modules/magazine`) : les 15 opérations `/v1/admin/magazine*` du contrat.
  - Éditions : création en brouillon (numéro suivant si `number` est absent, `null` = hors-série, 409 si le numéro
    est pris, y compris en cas de course : P2002), enregistrement (édito assaini, couverture de la médiathèque :
    422 `unknown_media`), suppression refusée pour une édition publiée (409 ; articles détachés, campagnes non
    parties supprimées), publication immédiate ou programmée (`SCHEDULED`, publiée à sa date : statut évalué à la
    lecture), dépublication (programmation de la newsletter annulée), articles dans l'ordre de lecture (422 sur
    `ids.N` inconnu ; un article ajouté quitte son édition précédente), jeton d'aperçu (`kind: magazine`, URL
    `/magazine?preview=`).
  - Articles : liste (`edition` = identifiant ou `none`, `q` sans accents), création à la fin de l'édition,
    modification (changement d'édition → fin de la nouvelle), suppression.
  - Tableau de bord : éditions de la plus récente à la plus ancienne, `toTranslate`, `languages` (anglais complet :
    titre, édito et tous les articles), `readers` (ouvertures des e-mails de l'édition ; `null` avant publication),
    `lastCampaign` (dernière édition envoyée : envois, taux d'ouverture et écart à la moyenne, clics, nouveaux
    inscrits depuis la publication ; `null` si la mesure est désactivée).
  - Audit sans donnée personnelle (l'adresse du test n'est pas journalisée) ; revalidation `page:magazine` pour toute
    modification d'une édition publiée ou programmée (et des images utilisées, `media-usages.ts`).
- **Newsletter d'une édition** (`MagazineNewsletterService`) : réutilise les campagnes et la file
  `newsletter-campaigns`. Programmation = une campagne par langue (`Campaign.language`, `magazineEditionId`), créée
  ou reprogrammée ; `segmentWhere` filtre désormais par langue (matérialisation des envois, estimations de la liste
  des campagnes). Contenu généré (titre, couverture, édito signé, sommaire avec liens absolus vers
  `/magazine#article-{id}`, bouton « Lire le magazine ») et régénéré après chaque modification tant que les
  campagnes ne sont pas parties. Test : une version par langue complète, 10 par minute.
- **Site** : `GET /v1/magazine` (`@Public`, `public, no-cache` ; aperçu `private, no-store`).
- **Contrat** : `GET /v1/magazine` et schémas `Magazine`, `MagazineEdition`, `MagazineEditionSummary`,
  `MagazineArticle` (+ exemple) ; 403 sur toutes les opérations du magazine, 400 sur la liste des articles, 422 sur
  le test ; règles de la programmation décrites.
- **Aucune migration, aucune dépendance, aucune variable d'environnement** : colonnes existantes.

### Décisions

- Aucune route publique du magazine n'existait : le site affiche la page `magazine` (sections) et la recherche vise
  `/magazine#article-{id}`. Une seule route (`GET /v1/magazine?edition=&preview=`) suffit à la page unique ; pas
  de slug d'édition (colonne absente), l'édition se choisit par identifiant.
- Une campagne par langue même sans version anglaise (la campagne `EN` porte alors le texte français) : les
  inscrits anglophones reçoivent le gabarit en anglais autour du contenu français.
- Pas de nouveaux tests (priorité au branchement) ; tests existants passés.

### Écarts avec le back-office simulé du site (le contrat prime)

- Ordre des éditions : de la plus récente à la plus ancienne (contrat) ; mock : numéros croissants, hors-séries
  ensuite.
- `languages` d'une édition : anglais complet seulement si tous ses articles le sont (mock : titre et édito).
- Programmation de la newsletter : 409 aussi quand l'envoi est déjà parti.

### Points ouverts

- Site : page Magazine branchée sur `GET /v1/magazine` (cartes d'articles avec l'ancre `anchor`).
- Édition programmée : revalidation `page:magazine` à sa date (tâche planifiée) ; le statut passe à `PUBLISHED` à la
  lecture seulement.
- `readers` ne compte que les ouvertures d'e-mails (pas de mesure par édition sur le site).
- Tests unitaires et e2e du lot : après le branchement du site.

## Phase 2 — Finitions : tableau de bord, recherche, notifications, journal, audience, tâches planifiées (27 octobre 2026)

### Fait

- **Back-office transverse** (`src/modules/dashboard`) : `GET /v1/admin/dashboard`, `GET /v1/admin/sidebar-counts`,
  `GET /v1/admin/search`, `GET /v1/admin/notifications`, `PATCH /v1/admin/notifications/read`,
  `GET /v1/admin/audit-log`. Toutes les routes du contrat hors magazine sont désormais déclarées.
- **Recherche du site** (`src/modules/search`) : `GET /v1/search`.
- **Mesure d'audience** (`src/modules/analytics`) : `POST /v1/analytics/events`, `GET /v1/admin/analytics/summary`.
- **Tâches planifiées** (`src/modules/maintenance`, file BullMQ `maintenance`, « job schedulers » démarrés avec
  `MAIL_WORKER=on`) : `revalidation` (15 s), `magazine-publication` (5 min), `database-backup` (2 h, Douala),
  `gdpr-cleanup` (3 h 30, Douala). Script `pnpm db:backup`.
- **Configuration** : `BACKUP_DIR` (`var/backups`), `PG_DUMP_PATH` (`pg_dump`) ; `REVALIDATE_SECRET` existant utilisé.
  Corps `text/plain` (16 Kio) accepté pour `navigator.sendBeacon`.
- **Aucune migration, aucune dépendance** : colonnes existantes (`revalidation_requests`, `backup_runs`,
  `analytics_*_daily`, `notifications`, `audit_logs`).

### Décisions

- **Périmètre** : demandes et questionnaires selon `requests:read` / `requests:read-assigned` (dossiers assignés),
  rendez-vous selon `appointments:read(-assigned)`, avis selon `reviews:moderate`, candidatures selon
  `applications:read`, newsletter selon `newsletter:read`, carte « Visites » selon `analytics:read` ; bloc vide (0) sans
  permission. Exclus partout : demandes anonymisées, rendez-vous d'une demande anonymisée ou d'un contact effacé,
  candidatures d'une demande anonymisée (les avis de demandes anonymisées sont masqués, donc jamais « à valider »).
- **Tableau de bord** : périodes en jours entiers de Douala (7 et 30 jours aujourd'hui compris, 12 mois mois en cours
  compris), période précédente de même durée ; graphique : 7 jours, 12 semaines ISO (maquette) ou 12 mois ;
  `newRequests` = demandes reçues sur la période, `servicesCompleted` = `completedAt` sur la période, `satisfaction` =
  note moyenne des questionnaires répondus ; `visits` = pages vues de la mesure interne (pas de GA4 Data API), `null`
  tant qu'aucune mesure n'est reçue.
- **Recherche du back-office** : demandes et contacts par les colonnes `search_text` (sans accents) ; services, offres
  et pages en mémoire (quelques dizaines). Liens : `/admin/demandes?id=`, `/admin/contacts?id=`,
  `/admin/services/{id}`, `/admin/recrutement/offres/{id}`, `/admin/pages?page={clé}` (paramètres lus par les écrans).
- **Recherche du site** : contenus publiés lus puis comparés en mémoire (sans accents ni casse, ligatures, mots en début
  de mot, pluriels en -s/-x) ; pas de racinisation complète ni d'index plein texte (volume faible). Articles : éditions
  visibles (`visibleEditionWhere` du magazine).
- **Audience** : 202 dès la validation, écriture en tâche de fond (`INSERT … ON CONFLICT DO UPDATE`) ; IP et agent
  utilisateur seulement pour la limitation de débit et le filtre des robots, jamais enregistrés ; `visitorId` haché
  (HMAC `TOKEN_SIGNING_SECRET`) et seulement avec consentement ; doublons d'un lot, pages `/admin`, `/api`, `/_next` et
  horodatages hors fenêtre comptés dans `rejected`. Résumé calculé à la demande (`generatedAt` = maintenant).
- **Revalidation** : réservation `FOR UPDATE SKIP LOCKED` (`RUNNING`), attente croissante calculée depuis la création
  (`created_at + (2^tentatives − 1) × 30 s`, sans colonne supplémentaire) ; état `SUCCEEDED` (énumération `TaskStatus`)
  plutôt que `SENT`. Demandes `RUNNING` remises en attente au démarrage du worker.
- **Magazine** : une édition programmée n'est jamais réécrite ; elle est « traitée » dès qu'une demande contenant
  `page:magazine` a été inscrite après sa date (par la tâche ou par le back-office) : pas de double inscription.
- **RGPD** : contacts inactifs effacés comme par le droit à l'effacement (`AdminContactsService.eraseInactive`, sauf
  abonnés confirmés, demande ouverte ou rendez-vous à venir) ; candidatures refusées : demande anonymisée rattachée à
  la fiche anonyme, candidature et pièces jointes supprimées, CV effacé (`purgeRejectedApplication`) ; conservation
  fixée : inscriptions non confirmées 30 j, journal d'activité 12 mois, notifications lues 90 j (toutes 12 mois),
  revalidations traitées 30 j, historique des sauvegardes 90 j, audience 13 mois, sessions et codes 1 j après
  expiration ; fichiers orphelins de plus de 24 h. Résumé (nombres seulement) au journal d'activité, sans auteur. Les
  anciens dossiers des médias remplacés étaient déjà supprimés par la file `media`.
- **Sauvegarde** : mot de passe passé par `PGPASSWORD` (jamais en argument), paramètre Prisma `schema` ignoré, fichier
  `.partial` renommé à la fin ; `pg_dump` absent → `FAILED` avec message explicite.

### Écarts avec le back-office simulé du site (le contrat prime)

- Tableau de bord d'un chargé de clientèle : rubriques, graphique et questionnaires calculés sur ses dossiers (mock :
  vides ou figés) ; `newRegistrations` = inscriptions « Nouvelle » visibles (mock : `contacts:read`).
- Notifications : celles enregistrées pour l'utilisateur (pas de filtrage par rôle comme le mock).
- Journal : `pageSize` 20 par défaut (contrat ; mock : 25) ; `entity` = nom technique (`Request`, `Service`…), comme
  enregistré par les modules (mock : libellés français).

### Points ouverts

- Site : la route `POST /api/revalidate` existe (`src/app/api/revalidate/route.ts`, `Bearer`, 100 étiquettes au plus) :
  renseigner le même `REVALIDATE_SECRET` des deux côtés.
- Copie des sauvegardes vers S3 et restauration testée (documentation d'exploitation).
- Tests unitaires et e2e du lot : après le branchement du site.

## Correctifs du branchement du site (27 octobre 2026)

### Fait

- **Recherche** : un article d'une édition plus ancienne que la dernière publiée pointe vers
  `/magazine?edition={editionId}#article-{id}` (la page sans paramètre affiche la dernière édition). La dernière
  édition est lue une fois par recherche, avec la condition et l'ordre du module magazine (`visibleEditionWhere`,
  `LATEST_EDITION_ORDER`, partagé avec `MagazineService`).
- **Contrat** : `lang` facultatif (`SubmissionLanguage`, `fr`/`en`) dans les corps des formulaires publics qui le
  lisent (devis, contact, rendez-vous, inscription, formation, partenaire, événement, candidature) ; repli
  `Accept-Language` puis `fr` décrit dans les conventions (la newsletter ne lit que l'en-tête).
- **Seed du magazine** : édito complet de l'édition n° 1 repris de la section `edito` de la page `magazine` (français
  et anglais) ; signatures au format de la page, « Mireille Bell — Fondatrice de Mambo Proxi » (un seul champ
  `signature`, nom et fonction séparés par un tiret cadratin, décrit au contrat).
- **Candidatures** : `jobTitle` (`AdminApplication`) = intitulé de l'offre, sinon l'objet de la demande conservé à
  l'envoi (offre supprimée), `null` pour une candidature spontanée. Le filtre `spontaneous` exige en plus un objet
  « Candidature spontanée » (constante `SPONTANEOUS_APPLICATION_SUBJECT`, aussi utilisée à l'envoi) : les candidatures
  dont l'offre a été supprimée en sont exclues, sans migration.
- **Modèles d'e-mails** : l'envoi de test (`POST /v1/admin/email-templates/{key}/test`) préfixe l'objet par « [TEST] »
  (champ facultatif `subjectPrefix` des tâches d'e-mail).

### Points ouverts

- Tests (unitaires, e2e, contrat) de ces correctifs : après le branchement, comme convenu.
- Site : afficher `jobTitle` dans le back-office après `pnpm contract:sync`.

## Phase 4 — Préparation du déploiement de production (28 octobre 2026)

### Fait

- `Dockerfile` multi-étapes (Node 24 sur Debian trixie slim, pnpm par corepack) : cible `runtime` (dépendances de
  production installées sans scripts, `dist/` avec le client Prisma compilé, `postgresql-client-18` du dépôt PGDG pour
  `pg_dump`, utilisateur `node`, `HEALTHCHECK` sur `/v1/health`) et cible `tools` (dépendances complètes, `prisma/`,
  pour `prisma migrate deploy` et le seed). `.dockerignore`.
- `deploy/` : `docker-compose.prod.yml` (caddy, api, migrate en profil `tools`, postgres 18.4, redis 8.10.2 AOF
  `noeviction`, mailpit), `Caddyfile`, `.env.production.example`, `deploy.sh`, `bootstrap.sh` (Amazon Linux 2023).
- Workflow manuel `.github/workflows/deploy.yml` : images poussées dans ECR (OIDC, cache GHA), puis commande SSM sur
  l'instance `Name=mambo-proxi-api` (fichiers de `deploy/` extraits de l'image vers `/opt/mambo`, puis `deploy.sh`),
  attente du résultat et sortie affichée.
- `docs/DEPLOIEMENT.md` : architecture, première mise en place, seed, Mailpit par tunnel SSM, sauvegardes,
  restauration, domaine, coûts.

### Décisions

- **AWS EC2 unique** (t3.small, 2 Go + 2 Go d'échange) plutôt que GHCR et étiquettes `v*` : image dans ECR, accès par
  SSM sans SSH, déploiement à la demande comme la CI.
- **API et workers dans le même conteneur** (`MAIL_WORKER=on`) : les workers démarrent dans le processus de l'API ;
  un second conteneur doublerait la mémoire sur 2 Go.
- **Image `tools` séparée** : la CLI Prisma, `tsx` et `dotenv` sont des dépendances de développement ; l'image
  d'exécution reste minimale.
- **Fichiers de déploiement livrés dans l'image** (`/app/deploy`) : versionnés avec le code, sans dépôt S3 ni limite de
  taille des paramètres SSM.
- **E-mails retenus dans Mailpit** (aucun transport « désactivé » dans l'API) : interface sur `127.0.0.1:8025` du
  serveur, consultée par tunnel SSM ; indispensable pour lire les codes de connexion du back-office.
- `DATABASE_URL`, `REDIS_URL`, `API_URL` et `MEDIA_PUBLIC_URL` composées par `docker-compose.prod.yml` à partir de
  `POSTGRES_PASSWORD` et `API_DOMAIN` : une seule valeur à changer pour passer à un vrai domaine.
- Aucune modification du code de l'API : écoute sur toutes les interfaces et `trust proxy` (production) déjà en place.

### Points ouverts

- Image jamais construite localement (pas de Docker) : à valider au premier lancement du workflow.
- Cookies `SameSite=Lax` : le back-office exige un domaine commun site/API (ou un relais `/v1` côté site).
