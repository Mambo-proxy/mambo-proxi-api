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
