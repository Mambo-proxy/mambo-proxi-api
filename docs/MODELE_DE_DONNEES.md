# Modèle de données

Schéma : `prisma/schema.prisma` (PostgreSQL, Prisma 7). Source de vérité des échanges : `contracts/openapi.yaml`.
Point de départ : schéma du dossier de pilotage (`05-api-contract.md` §2), noms conservés, complété selon le contrat.

51 modèles, 41 énumérations.

## Modèles et couverture du contrat

| Domaine                 | Modèles                                                                                                                                      | Opérations / schémas du contrat                                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Utilisateurs & sécurité | `User`, `Session`, `TrustedDevice`, `OtpChallenge`, `PasswordReset`, `Invitation`                                                            | `/auth/*`, `/admin/users*`, `/admin/roles` · `CurrentUser`, `AdminUser`, `TeamPresence` (`lastActiveAt`), `LoginResult`                                                                                                          |
| Notifications, journal  | `Notification`, `AuditLog`                                                                                                                   | `/admin/notifications*`, `/admin/audit-log` · `Notification` (dont `ASSIGNMENT`), `AuditLogEntry`                                                                                                                                |
| Catalogue               | `Category`, `CategoryOfferSection`, `Service`, `ServiceGalleryImage`, `ServiceRelation`, `ServiceFeaturedReview`, `ServiceOffer`, `Redirect` | `/categories*`, `/services*`, `/site/navigation`, `/site/redirects`, `/admin/services*`, `/admin/categories*` · `CategoryDetail`, `ServiceDetail` (`kind: formula`), `ServiceOffers`, `AdminService` (`version`), `Completeness` |
| Pages & paramètres      | `Page`, `Setting`, `EmailTemplate`                                                                                                           | `/pages/{key}`, `/site/settings`, `/admin/pages*`, `/admin/settings/{group}`, `/admin/email-templates*` · `PageSection`, `SiteSettings`, `Settings*`                                                                             |
| Médiathèque             | `Media`, `MediaUsage`                                                                                                                        | `/admin/media*` · `Media` (variantes, point focal, `alt`, `usages`), `MediaImage`, `Visual`                                                                                                                                      |
| Zones                   | `Zone`, `ZoneQuarter`                                                                                                                        | `/zones`, `/admin/zones*` · `ServiceAreas`, `AdminZone`, `ZoneFee`, `ZoneArea` (GeoJSON), `GeoPoint`                                                                                                                             |
| Contacts & demandes     | `Contact`, `ContactInterest`, `ReferenceCounter`, `Request`, `RequestNote`, `RequestEvent`, `Attachment`                                     | tous les `POST` publics, `/admin/requests*`, `/admin/contacts*`, `/admin/training-requests`, `/admin/me/tasks` · `RequestDetail` (`assignedTo`, `dueAt`), `AdminContact`, `ContactStats`                                         |
| Rendez-vous             | `Appointment`, `AvailabilityRule`, `AvailabilityException`                                                                                   | `/appointments*`, `/admin/appointments*`, `/admin/availability` · `Availability`, `AdminAppointment` (`assignedTo`), `AvailabilityConfig`                                                                                        |
| Avis & questionnaire    | `Survey`, `SurveyQuestion`, `Review`                                                                                                         | `/reviews*`, `/surveys/{token}*`, `/admin/reviews*`, `/admin/survey-questions` · `ReviewStats`, `PublicSurvey`                                                                                                                   |
| Contenus                | `Partner`, `Training`, `JobOffer`, `JobApplication`, `Event`                                                                                 | `/partners`, `/trainings`, `/jobs*`, `/events`, `/job-applications`, `/admin/partners*`, `/admin/trainings*`, `/admin/jobs*`, `/admin/applications*`, `/admin/events*` · `JobSalary`                                             |
| Magazine                | `MagazineEdition`, `MagazineArticle`                                                                                                         | `/admin/magazine*` · `AdminMagazineEdition`, `AdminMagazineArticle`, `MagazineCampaignStats`                                                                                                                                     |
| Newsletter              | `Subscriber`, `Campaign`, `CampaignDelivery`                                                                                                 | `/newsletter/*`, `/admin/subscribers*`, `/admin/campaigns*`, envoi du magazine · `CampaignSegment`, `NewsletterStats`                                                                                                            |
| Mesure d'audience       | `AnalyticsPageViewDaily`, `AnalyticsActionDaily`, `AnalyticsVisitorDaily`                                                                    | `POST /analytics/events`, `/admin/analytics/summary`, carte « Visites »                                                                                                                                                          |
| Technique               | `RevalidationRequest`, `BackupRun`                                                                                                           | revalidation du site par tags, `/admin/system-status`                                                                                                                                                                            |

Les demandes de formation, de partenariat, les inscriptions aux événements et les candidatures sont des `Request`
(types `FORMATION`, `PARTENARIAT`, `EVENEMENT`, `CANDIDATURE`), comme dans le contrat (`RequestListItem`) ; les
colonnes dédiées (`trainingId`, `participants`, `eventId`, `seats`, `partnershipType`…) permettent filtres et comptages.

## Choix structurants

- **Traductions (`?lang=en`).** Le français reste dans les colonnes ordinaires. Les modèles dont le contrat édite déjà
  des champs `…En` (zones, quartiers, éditions et articles du magazine) ont des colonnes `…En`. Les autres contenus
  traduisibles (rubriques, services, offres, pages, paramètres, formations, offres d'emploi, événements, questions,
  modèles d'e-mails) ont une colonne `translations` JSON `{ "en": { champ: valeur } }`, de même forme que le champ
  français : un champ absent est renvoyé en français, comme l'exige le contrat. Cela évite de doubler une quarantaine
  de colonnes dont beaucoup sont déjà des JSON structurés. Rubriques et services ont un `slugEn` unique facultatif.
- **snake_case.** Tables au pluriel (`@@map`) et colonnes (`@map`) en snake_case, champs Prisma en camelCase ; toutes
  les dates en `timestamptz(3)` (UTC), dates seules en `date`. Les chaînes sont des `text` PostgreSQL (limites de
  longueur contrôlées par la validation de l'API, selon le contrat).
- **Identifiants** `cuid(2)`. Suppressions : `Cascade` pour les éléments dépendants (notes, historique, quartiers…),
  `SetNull` pour les liens facultatifs (assignation, service d'une demande, offre d'une candidature), `Restrict` pour
  les rubriques non vides, les contacts (effacement = anonymisation) et tous les médias référencés (409 « image
  utilisée »).
- **Références `MP-AAAA-NNNN`.** Table `reference_counters` (une ligne par année), incrémentée atomiquement
  (`INSERT … ON CONFLICT DO UPDATE … RETURNING`) dans la transaction de création ; compteur partagé par les demandes et
  les rendez-vous.
- **Mesure d'audience anonyme.** Uniquement des compteurs agrégés par jour, page, langue, appareil (et action,
  emplacement) : aucune adresse IP, aucun agent utilisateur, aucun identifiant sans consentement. Les visiteurs
  uniques ne sont comptés qu'avec consentement, via un condensat HMAC de l'identifiant pseudonyme (13 mois au plus).
- **Aucun prix des prestations.** Seuls figurent la rémunération des offres d'emploi (`JobSalary`) et le tarif
  indicatif de déplacement des zones (`ZoneFee`), donnée interne prévue par le contrat et masquée sur le site tant que
  « Afficher les tarifs » est désactivé.
- **Authentification.** Aucun secret en clair : mots de passe en argon2id (`users.password_hash`, format PHC) ; jetons
  de rafraîchissement, d'appareil de confiance, de réinitialisation, d'invitation et codes à 6 chiffres conservés
  sous forme de condensat HMAC-SHA256 (clé `JWT_REFRESH_SECRET` ou `TOKEN_SIGNING_SECRET`). Chaque rotation du jeton
  de rafraîchissement crée une ligne `sessions` (l'ancienne est révoquée et pointe sur la suivante par
  `replaced_by_id`). Le jeton CSRF est signé et sans état (aucune colonne). Statut affiché d'un utilisateur :
  `DESACTIVE` si `is_active = false`, `INVITE` tant que `activated_at` est vide (mot de passe jamais défini), sinon
  `ACTIF`.
- **Données de démonstration** : `isDemo` sur les utilisateurs, rubriques, services, offres, avis, partenaires,
  formations, offres d'emploi, événements, éditions et articles, zones, contacts, demandes, rendez-vous, abonnés,
  campagnes et médias (`pnpm db:purge-demo`).

## Contraintes ajoutées à la main dans les migrations (non exprimables en Prisma)

Faites dans `prisma/migrations/20261026000000_init` : CHECK des offres, index unique partiel des créneaux, bornes des notes, jours, point focal et coordonnées. Restent pour le module de recherche : `unaccent` et index plein texte.

- CHECK `service_offers` : exactement un de `service_id` / `section_id` ;
- index unique partiel sur `appointments (starts_at)` pour les statuts `A_CONFIRMER`, `CONFIRME` (créneau pris → 409) ;
- extension `unaccent` + index de recherche plein texte (`tsvector` français / anglais) pour `/v1/search`,
  `/admin/search` et le filtre `district` (insensible aux accents) ;
- CHECK de bornes (`rating` 1–5, `weekday` 1–7, `focal_x/y` 0–1, coordonnées dans l'emprise du Cameroun).

## Écarts et points du contrat à préciser

- `showFees` (`AdminZones`) et `note` (`ServiceAreas`) ne relèvent d'aucun `SettingsGroup` du contrat : stockés dans le
  paramètre interne `zones`, sans opération d'écriture dédiée (à ajouter au contrat).
- Disponibilités : `minNoticeHours`, `maxAdvanceDays`, `agencyAddress`, `defaultVideoLink` stockés dans le paramètre
  `availability` (pas une table).
- Aucune opération publique du magazine (`GET /v1/magazine…`) n'existe encore, alors que la page `magazine`, la
  recherche (`article`) et la mesure « lecteurs » y font référence ; le modèle la permet.
- La langue d'un abonné (inscrits « par langue » du magazine) n'est pas transmise par `NewsletterSubscriptionInput` :
  l'API la déduit de la page d'origine (à confirmer, ou ajouter `lang` au contrat).
- Les segments de campagne sont calculés (`ALL`, `FRANCE`, `CAMEROUN`, `PROFESSIONNELS`, `TAGS`) et non une table ;
  la campagne garde son segment (`segmentKind`, `segmentTags`, `language`).
- Jetons de prévisualisation (`PreviewToken`) : signés et sans état, donc sans table.
- Libellés calculés non stockés : `RequestEvent.label`, `initials`, statut d'utilisateur (`ACTIF`/`INVITE`/`DESACTIVE`),
  `isOverdue`, `completeness`, `requests30d`, `readers`, `remainingPlaces`.
- Les images référencées dans des JSON (sections de pages, visuels secondaires des rubriques, image de partage) ne
  peuvent pas avoir de clé étrangère : l'API tient `media_usages` à jour à chaque enregistrement.
