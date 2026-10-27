# Gabarits d'e-mails — données attendues

Un e-mail se demande par `MailQueueService.enqueue({ template, to, lang, data, reference? })`. Les textes (objet,
titre, paragraphes, libellé du bouton) viennent du modèle en base (`email_templates`, modifiable dans le
back-office), à défaut de `default-contents.ts`. `data` fournit les valeurs des variables et du bloc récapitulatif.

Règles communes :

- dates en chaînes ISO 8601 UTC (`2026-11-12T13:00:00.000Z`), affichées à l'heure de Douala dans la langue `lang` ;
  `dateLabel` / `timeLabel` permettent d'imposer un texte ;
- libellés déjà traduits dans la langue du message (service, rubrique, motif…) ;
- `actionUrl` : adresse absolue http(s) du bouton (un autre schéma est refusé) ; obligatoire quand indiqué ;
- `reference` : prise dans `data.reference`, sinon dans `job.reference` ;
- valeur vide ou `null` = absente (la ligne du récapitulatif disparaît, la phrase est nettoyée) ;
- données obligatoires manquantes : la tâche échoue aussitôt, sans réessai (`MailDataError`).

Variables utilisables dans les textes : `{prénom}` (`firstName`), `{nom}` (`fullName`, ou `firstName` + `lastName`),
`{référence}`, `{service}` (`serviceName`), `{rubrique}` (`categoryName`), `{offre}` / `{poste}` (`jobTitle`),
`{formation}` (`trainingName`), `{événement}` (`eventName`), `{objet}` (`subject`), `{quartier}`
(`quarterName`, sinon `city`), `{ville}`, `{lieu}` (`place`), `{code}`, `{date}` (date longue, avec l'heure si
`startsAt`), `{heure}`. Toute donnée texte est aussi accessible sous son nom (`{firstName}`). `{{prenom}}` est accepté.

Noms acceptés en plus (formulaires publics, `src/modules/forms/forms.mail.ts`) : `contactName` → `fullName`,
`contactEmail` → `email`, `contactPhone` → `phone`, `contactCity` → `city`, `contactCountry` → `country`,
`adminUrl` → `actionUrl` ; `quote-ack` : `categoryName` si `serviceName` est nul ; `team-new-request` : `subject`
puis `requestTypeLabel` → `serviceName` ; `training-request-received` : `trainingTitle` → `trainingName` ;
`event-registration` : `eventTitle`, `eventStartsAt`, `eventEndsAt`, `eventPlace` (sinon `eventCity`).

| Modèle                      | Obligatoire                                   | Facultatif                                                                                                                                                        | Variante                                                                      |
| --------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `quote-ack`                 | `reference`, `serviceName`                    | `firstName`, `categoryName`, `desiredDate` (ISO) ou `desiredDateLabel`, `city`, `actionUrl`                                                                       | récapitulatif ; bouton par défaut : WhatsApp avec la référence                |
| `team-new-request`          | `reference`, `serviceName`                    | `fullName`, `requestTypeLabel`, `phone`, `email`, `quarterName`, `city`, `country`, `fields` (`[{ label, value }]`), `message`, `dueAt`, `requestId`, `actionUrl` | récapitulatif ; bouton par défaut : `{WEB_URL}/admin/demandes?id={requestId}` |
| `team-assignment`           | `reference`, `serviceName`                    | `fullName`, `assignedByName`, `requestId`, `actionUrl`                                                                                                            | idem                                                                          |
| `contact-ack`               | —                                             | `firstName`, `reference`, `subjectLabel` (ou `subject`), `serviceName`                                                                                            | récapitulatif                                                                 |
| `appointment-received`      | `startsAt` (ou `date`/`dateLabel`)            | `firstName`, `reference`, `endsAt`, `reasonLabel`, `formatLabel`, `serviceName`, `timeLabel`                                                                      | carte de rendez-vous                                                          |
| `appointment-confirmed`     | `startsAt` (ou `dateLabel`)                   | `firstName`, `reference`, `endsAt`, `reasonLabel`, `serviceName`, `formatLabel`, `place` (agence), `videoLink`, `location`, `ics` (iCalendar), `actionUrl`        | carte ; `.ics` joint ; bouton par défaut : Google Agenda                      |
| `appointment-proposed`      | `startsAt`, `actionUrl`                       | `firstName`, `reasonLabel`, `formatLabel`, `place`, `videoLink`, `message` (de l'agence)                                                                          | carte, message de l’agence                                                    |
| `appointment-cancelled`     | `startsAt`                                    | `firstName`, `actionUrl`, `message` (de l'agence)                                                                                                                 | carte (date, heure, message de l’agence)                                      |
| `appointment-reminder`      | `startsAt`                                    | `firstName`, `serviceName`, `reasonLabel`, `formatLabel`, `place`, `videoLink`                                                                                    | carte                                                                         |
| `survey-invitation`         | `actionUrl`, `serviceName`                    | `firstName`, `serviceDate` (ISO, pour `{date}`), `reference`                                                                                                      | cinq étoiles + bouton                                                         |
| `survey-reminder`           | `actionUrl`, `serviceName`                    | `firstName`, `reference`                                                                                                                                          | cinq étoiles + bouton                                                         |
| `registration-confirmed`    | —                                             | `firstName`, `actionUrl` (défaut : page des services, `/en/services` en anglais)                                                                                  | —                                                                             |
| `application-received`      | `jobTitle`                                    | `firstName`                                                                                                                                                       | récapitulatif (poste)                                                         |
| `training-request-received` | `trainingName`                                | `firstName`, `reference`, `participants`, `period`                                                                                                                | récapitulatif                                                                 |
| `partner-request-received`  | —                                             | `firstName`, `partnershipLabel` ou `partnershipType` (code), `organization`                                                                                       | récapitulatif                                                                 |
| `event-registration`        | `eventName`                                   | `firstName`, `startsAt`, `place`, `seats`                                                                                                                         | récapitulatif                                                                 |
| `newsletter-confirm`        | `actionUrl` (lien de confirmation)            | `firstName`                                                                                                                                                       | —                                                                             |
| `newsletter-campaign`       | `subject`, `html` (assaini), `unsubscribeUrl` | `text`, `preheader`, `firstName`, `oneClickUnsubscribeUrl` (POST, RFC 8058), `deliveryId`                                                                         | corps HTML ; en-têtes `List-Unsubscribe`                                      |
| `user-invite`               | `actionUrl`                                   | `firstName`                                                                                                                                                       | —                                                                             |
| `otp-code`                  | `code`                                        | —                                                                                                                                                                 | code en grand                                                                 |
| `password-reset`            | `actionUrl`                                   | —                                                                                                                                                                 | —                                                                             |

Les données d'exemple de chaque modèle sont dans `sample-data.ts` (`pnpm mail:preview`).
