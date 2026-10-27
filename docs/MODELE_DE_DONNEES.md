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

- **Recherche sans accents ni casse (migration `20261027000000_search_keys`).** `contacts.search_text` (nom, e-mail,
  structure), `contacts.city_key` (ville) et `requests.search_text` (référence, sujet) contiennent le texte sans
  accents, en minuscules (`src/common/text/search-key.ts`), recalculé par l'API à chaque écriture (formulaires,
  duplication, anonymisation, seed) ; les valeurs existantes ont été calculées par la migration. Recherche `q` des
  demandes et contacts du back-office (`contains`), filtre `district` (`city_key` commence par le quartier) et
  indicateur « Douala et environs » (`city_key` = « douala » ou se termine par « , douala ») : filtres Prisma
  ordinaires, sans l'extension `unaccent`.
- **Anonymisation (RGPD).** Une demande anonymisée garde type, service, statut, dates et horodatage du consentement
  (statistiques) ; `anonymized_at` est posé, message, valeurs du formulaire, IP, agent utilisateur, notes internes et
  noms des pièces jointes sont effacés, et la demande est rattachée à la fiche commune `anonyme@mamboproxi.invalid`
  (« Contact anonymisé »). Contact effacé : fiche vidée sur place (`efface-<id>@mamboproxi.invalid`, « Contact
  effacé », `anonymized_at`), demandes anonymisées, abonnement anonymisé et désinscrit (statistiques des campagnes
  conservées). Ces lignes ne sont plus affichées par le back-office.

- **Contenus du back-office.** `services.version` (verrouillage optimiste, `If-Match: v<n>`) est incrémentée à chaque
  enregistrement ; les listes d'un service (galerie, services liés, avis mis en avant, offres) et les carrousels
  d'une rubrique sont remplacés à chaque envoi, une offre renvoyée avec son identifiant le garde (et sa traduction).
  Les visuels des sections de pages sont enregistrés par référence (`{ illustration, imageId, alt }`), le HTML des
  articles assaini avant l'enregistrement. Quartiers : `normalized_name` (clé sans accents) unique, un quartier
  ajouté à une zone quitte l'ancienne. Changement d'adresse d'un contenu publié : ligne `redirects` (les redirections
  vers l'ancienne adresse sont reportées sur la nouvelle). Chaque modification visible sur le site ajoute une ligne
  `revalidation_requests` (`PENDING`, étiquettes du site) dans la même transaction.

- **Rendez-vous.** Une demande en ligne crée une demande `RENDEZ_VOUS` et un rendez-vous de **même référence**
  (`appointments.request_id`) ; une saisie manuelle n'a pas de demande (`request_id` vide, `created_by_id` renseigné).
  Créneau occupé : `[starts_at, ends_at[` pour « À confirmer » et « Confirmé », créneau proposé (`proposed_starts_at`,
  même durée) pour « Autre créneau proposé » ; le créneau d'origine est alors libéré (et sort de l'index unique
  partiel). Toute écriture qui prend un créneau pose d'abord le verrou consultatif
  `pg_advisory_xact_lock(hashtext('mambo:appointments'))` puis vérifie le chevauchement ; l'index unique partiel
  reste le dernier rempart (P2002 → 409). Lien d'acceptation d'un autre créneau : jeton aléatoire envoyé par e-mail,
  condensat HMAC-SHA256 (`TOKEN_SIGNING_SECRET`, usage `appointment-proposal`) dans `proposal_token_hash`, échéance
  `proposal_expires_at` (début du créneau proposé, 7 jours au plus), conservés après l'acceptation (seconde ouverture
  du lien) et effacés à l'annulation. `reminder_sent_at` : posé atomiquement par la tâche de rappel (BullMQ, file
  `appointment-reminders`, identifiant `rappel-<id>-<début>`), remis à vide quand le rendez-vous change de créneau.
  Plages `availability_rules` (heures locales « HH:MM », 1 = lundi … 7 = dimanche) et exceptions
  `availability_exceptions` (`date` seule, minuit UTC côté Prisma) remplacées en bloc par
  `PUT /v1/admin/availability` (identifiants connus conservés). Aucune migration ajoutée : toutes les colonnes
  existaient.

## Contraintes ajoutées à la main dans les migrations (non exprimables en Prisma)

Faites dans `prisma/migrations/20261026000000_init` : CHECK des offres, index unique partiel des créneaux, bornes des notes, jours, point focal et coordonnées. Restent pour le module de recherche : `unaccent` et index plein texte.

- CHECK `service_offers` : exactement un de `service_id` / `section_id` ;
- index unique partiel sur `appointments (starts_at)` pour les statuts `A_CONFIRMER`, `CONFIRME` (créneau pris → 409) ;
- extension `unaccent` + index de recherche plein texte (`tsvector` français / anglais) pour `/v1/search` et
  `/admin/search` (le filtre `district` et la recherche des listes du back-office passent par les clés
  `search_text` / `city_key`) ;
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
- Jetons de prévisualisation (`PreviewToken`) : signés (HMAC, `TOKEN_SIGNING_SECRET`), valables 30 minutes et sans
  état, donc sans table.
- Textes anglais (`translations` des services, rubriques, offres, pages et modèles d'e-mails ; `…En` des zones) : le
  contrat du back-office ne les édite pas (sauf les champs `…En` des zones) ; ils sont conservés tels quels quand le
  français change.
- Navigation : aucune opération d'écriture dans le contrat ; le méga-menu se déduit des services publiés
  (`showInMenu`), le pied de page vient du paramètre interne `navigation`.
- Libellés calculés non stockés : `RequestEvent.label`, `initials`, statut d'utilisateur (`ACTIF`/`INVITE`/`DESACTIVE`),
  `isOverdue`, `completeness`, `requests30d`, `readers`, `remainingPlaces`.
- Les images référencées dans des JSON (sections de pages, visuels secondaires des rubriques, image de partage) ne
  peuvent pas avoir de clé étrangère : `media_usages` doit être tenu à jour à chaque enregistrement (à faire avec le
  module de la médiathèque ; le back-office des contenus vérifie déjà que chaque image référencée existe).
