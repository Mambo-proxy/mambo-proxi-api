import type { DefaultJobOptions } from 'bullmq';

/** Jeton d'injection de la connexion ioredis partagée par les files et les workers BullMQ. */
export const REDIS_CONNECTION = Symbol('REDIS_CONNECTION');

/** Jeton d'injection du préfixe des clés BullMQ dans Redis (remplacé par les tests pour isoler leurs files). */
export const QUEUE_PREFIX = Symbol('QUEUE_PREFIX');

/** Préfixe des clés Redis des files de l'API (`mambo:mail:…`). */
export const DEFAULT_QUEUE_PREFIX = 'mambo';

/** Noms des files d'attente. */
export const QUEUE_NAMES = {
  mail: 'mail',
  appointmentReminders: 'appointment-reminders',
  surveyInvitations: 'survey-invitations',
  newsletterCampaigns: 'newsletter-campaigns',
  media: 'media',
} as const;

const MINUTE_MS = 60_000;
const DAY_S = 24 * 60 * 60;

/**
 * Options des tâches d'envoi d'e-mails : 5 tentatives, attente exponentielle à partir d'une minute
 * (1, 2, 4 puis 8 min, soit environ un quart d'heure avant l'abandon, de quoi passer une coupure du serveur SMTP).
 * Les tâches terminées sont purgées : on garde 7 jours (au plus 1 000) des envois réussis et 30 jours
 * (au plus 5 000) des échecs définitifs, pour le diagnostic.
 */
export const MAIL_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: MINUTE_MS },
  removeOnComplete: { age: 7 * DAY_S, count: 1_000 },
  removeOnFail: { age: 30 * DAY_S, count: 5_000 },
} as const satisfies DefaultJobOptions;

/** Nombre d'e-mails envoyés en parallèle par un worker. */
export const MAIL_WORKER_CONCURRENCY = 4;

/**
 * Options des rappels de rendez-vous (tâches différées jusqu'à la veille du rendez-vous) : 3 tentatives (la tâche ne
 * fait que relire la base et mettre l'e-mail en file), purge comme les e-mails.
 */
export const REMINDER_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: MINUTE_MS },
  removeOnComplete: { age: 7 * DAY_S, count: 1_000 },
  removeOnFail: { age: 30 * DAY_S, count: 5_000 },
} as const satisfies DefaultJobOptions;
