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
- [ ] Projet NestJS (TypeScript strict), configuration validée (zod), journaux pino sans données personnelles, Helmet, CORS strict, throttler, filtre d'erreurs RFC 9457, `/v1/health`
- [ ] Prisma : schéma complet (docs/05 §2), migrations, seed (4 rubriques, 19 services, contenus de toutes les pages, démo marquée `demo` + `pnpm db:purge-demo`, admin initial, questions, modèles d'e-mails, paramètres)
- [ ] Tests de contrat : validation de chaque réponse contre `openapi.yaml` ; diff du document `@nestjs/swagger` en CI

### Modules (ordre docs/08)
- [ ] settings · navigation · pages · categories · services (lecture publique, cache, preview)
- [ ] Formulaires publics : quote-requests, contact-messages, registrations, training-requests, partner-requests, event-registrations (anti-spam Turnstile + piège + délai, limitation de débit)
- [ ] contacts · requests (références `MP-AAAA-NNNN`, historique, notes, export CSV, anonymisation)
- [ ] mail (React Email, texte brut, gabarits Figma) + queue (BullMQ, réessais)
- [ ] auth (argon2id, OTP e-mail, appareils de confiance, rotation des jetons, CSRF, verrouillage) · users (invitation, rôles)
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
