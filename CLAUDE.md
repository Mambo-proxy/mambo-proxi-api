# mambo-proxi-api — conventions du dépôt

API REST du site MAMBO Proxi (agence de coordination multiservices France ↔ Cameroun) : NestJS, Prisma, PostgreSQL, Redis/BullMQ, stockage S3, e-mails.
Le site et le back-office (dépôt `mambo-proxi-web`) consomment cette API.

## Sources de vérité

- **Contrat** : `contracts/openapi.yaml` (OpenAPI 3.1). Toute évolution d'un échange commence **par le contrat**, puis l'implémentation, puis le site (`pnpm contract:sync` côté web).
- **Fonctionnel** : dossier de pilotage `../Mambo_Proxi_Pilotage_Claude_Code/mambo-proxi-pilotage/` (docs 01 → 08, cahier des charges v1.2 dans `ref/`). En cas de doute : maquettes pour le visuel, cahier des charges pour le fonctionnel.
- **Données de référence** : `content/catalogue-services.json` du dossier de pilotage (4 rubriques, 19 services) et inventaires des maquettes dans `../mambo-proxi-web/qa/inventory/`.

## Commandes

| Commande                            | Rôle                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install`                      | Installer les dépendances (pnpm 12, Node 24 — voir `.nvmrc`)                                                             |
| `pnpm services:up`                  | Démarrer PostgreSQL, Redis, S3 (SeaweedFS) et Mailpit (`docker compose up -d`)                                           |
| `pnpm contract:lint`                | Valider le contrat OpenAPI (Redocly)                                                                                     |
| `pnpm contract:docs`                | Générer la documentation HTML du contrat dans `dist/`                                                                    |
| `pnpm start:dev`                    | Compiler puis relancer l'API à chaque modification (http://localhost:4000, documentation générée sur `/docs`)            |
| `pnpm build` / `pnpm start`         | Compiler dans `dist/` / démarrer la version compilée                                                                     |
| `pnpm lint`                         | ESLint (typescript-eslint avec vérification des types)                                                                   |
| `pnpm format` / `pnpm format:check` | Mettre en forme / vérifier la mise en forme (Prettier)                                                                   |
| `pnpm typecheck`                    | Vérifier les types (`tsc --noEmit`)                                                                                      |
| `pnpm test`                         | Tests unitaires (`src/**/*.spec.ts`, Vitest + SWC)                                                                       |
| `pnpm test:e2e`                     | Tests e2e (`test/**/*.e2e-spec.ts`, supertest) ; `E2E_REAL_SERVICES=true` ajoute les tests sur PostgreSQL et Redis réels |
| `pnpm prisma:generate`              | Générer le client Prisma dans `src/generated/prisma` (aussi lancé après `pnpm install`)                                  |
| `pnpm db:migrate`                   | Créer et appliquer une migration en développement (`prisma migrate dev`)                                                 |
| `pnpm db:deploy`                    | Appliquer les migrations existantes (`prisma migrate deploy`, CI et production)                                          |
| `pnpm db:seed`                      | Remplir la base (`prisma/seed.ts`)                                                                                       |

Socle technique : modules ESM (`"type": "module"`, imports relatifs suffixés `.js`), NestJS 12, Prisma 7 (client généré, adaptateur `pg`), validation par zod (`ZodValidationPipe`), erreurs levées avec `ProblemException` (`src/common/problem`), tests de contrat avec `expectToMatchContract` (`test/contract.ts`). Les dépendances injectées sont déclarées avec `@Inject(...)` explicite.

## Conventions

- Préfixe `/v1`, JSON `camelCase`, dates ISO 8601 UTC, affichage en fuseau `Africa/Douala`.
- Pagination `?page=&pageSize=` → `{ data, meta: { page, pageSize, total, totalPages } }` ; tri `?sort=-createdAt`.
- Erreurs au format RFC 9457 (`application/problem+json`), messages **en français** prêts à afficher, chemin du champ dans `errors[].path`.
- Références lisibles des demandes `MP-AAAA-NNNN` (séquence annuelle).
- Code et noms techniques en anglais ; messages, e-mails, documentation et journal en français.
- TypeScript strict. Validation de toutes les entrées. Aucune donnée personnelle dans les journaux.
- Commits petits, au format « conventional commits » (`feat:`, `fix:`, `docs:`, `chore:`, `test:`…).

## Règles non négociables

- **Aucun prix** stocké ni renvoyé pour les prestations (devis uniquement) ; **aucun paiement en ligne** ; pas d'espace client (lot 1).
- RGPD : consentements explicites et horodatés, double opt-in newsletter, export et effacement des données, durées de conservation paramétrables.
- Sécurité de niveau production (OWASP ASVS niveau 2) : argon2id, cookies `httpOnly`/`Secure`/`SameSite`, CSRF double-submit, limitation de débit, OTP par e-mail, journal d'audit, téléversements contrôlés (type réel, taille, stockage privé, URL signées).
- Les tests de contrat valident chaque réponse contre `contracts/openapi.yaml` ; la CI échoue en cas d'écart.
- Ne jamais mentionner d'outil d'IA ni d'assistant dans le code, les commentaires, la documentation, les messages de commit ; aucune ligne `Co-Authored-By` d'outil. Le dépôt appartient à la cliente.
- Versions : dernières versions stables, vérifiées dans la documentation officielle, figées (lockfile, `packageManager`, `.nvmrc`).

## Suivi

- `TASKS.md` : liste des tâches de l'API, tenue à jour.
- `JOURNAL.md` : à chaque étape, ce qui a été fait, décisions, difficultés et solutions.
