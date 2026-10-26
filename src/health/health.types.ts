/** Types du schéma `Health` du contrat. */
export type DependencyState = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  checks: {
    database: DependencyState;
    redis: DependencyState;
  };
}

/** Délai maximal d'une vérification : la sonde répond vite même si une dépendance ne répond plus. */
export const HEALTH_CHECK_TIMEOUT_MS = 2_000;

/** Rejette la promesse si elle ne s'est pas terminée dans le délai imparti. */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Délai dépassé (${timeoutMs} ms)`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
