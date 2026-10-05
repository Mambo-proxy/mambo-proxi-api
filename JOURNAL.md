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
