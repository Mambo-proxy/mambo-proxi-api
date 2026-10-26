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
