import { PgBoss } from 'pg-boss';
import { getConfig } from '@localy/config';
import { logger } from './logger';

/**
 * Background job queue backed by PostgreSQL (pg-boss). The API only enqueues;
 * the worker process consumes. Jobs are retried with exponential backoff and
 * carry singleton keys where duplicate execution would be harmful.
 */
export const QUEUES = {
  sendEmail: 'email.send',
  campaignTick: 'campaign.tick',
  inboxSync: 'inbox.sync',
  integrationHealth: 'integration.health',
  followUpReminders: 'followups.remind',
  analytics: 'analytics.aggregate',
  cleanup: 'maintenance.cleanup',
  notificationEmail: 'notification.email',
  websiteCheck: 'website.check',
  systemMail: 'system.mail',
  dispatch: 'dispatch.tick',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

interface QueueConfig {
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  expireInSeconds: number;
  /** `stately` allows at most one queued and one active job per singleton key. */
  policy?: 'standard' | 'stately';
}

export const QUEUE_OPTIONS: Record<QueueName, QueueConfig> = {
  'email.send': { retryLimit: 4, retryDelay: 30, retryBackoff: true, expireInSeconds: 120, policy: 'stately' },
  'campaign.tick': { retryLimit: 1, retryDelay: 10, retryBackoff: false, expireInSeconds: 300, policy: 'stately' },
  'inbox.sync': { retryLimit: 1, retryDelay: 30, retryBackoff: false, expireInSeconds: 300, policy: 'stately' },
  'integration.health': { retryLimit: 1, retryDelay: 60, retryBackoff: false, expireInSeconds: 300 },
  'followups.remind': { retryLimit: 1, retryDelay: 60, retryBackoff: false, expireInSeconds: 300 },
  'analytics.aggregate': { retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 600 },
  'maintenance.cleanup': { retryLimit: 2, retryDelay: 300, retryBackoff: true, expireInSeconds: 900 },
  'notification.email': { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 60 },
  'website.check': { retryLimit: 1, retryDelay: 60, retryBackoff: false, expireInSeconds: 60 },
  'system.mail': { retryLimit: 5, retryDelay: 20, retryBackoff: true, expireInSeconds: 60 },
  'dispatch.tick': { retryLimit: 0, retryDelay: 0, retryBackoff: false, expireInSeconds: 120, policy: 'stately' },
};

let boss: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;

export async function getQueue(): Promise<PgBoss> {
  if (boss) return boss;
  starting ??= (async () => {
    const instance = new PgBoss({
      connectionString: getConfig().DATABASE_URL,
      schema: 'pgboss',
      max: 4,
    });
    instance.on('error', (err: unknown) => logger.error({ err }, 'job queue error'));
    await instance.start();
    for (const name of Object.values(QUEUES)) {
      const existing = await instance.getQueue(name);
      if (!existing) await instance.createQueue(name, QUEUE_OPTIONS[name]);
    }
    boss = instance;
    return instance;
  })();
  try {
    return await starting;
  } catch (err) {
    starting = undefined;
    throw err;
  }
}

export interface EnqueueOptions {
  singletonKey?: string;
  startAfter?: Date | number;
  priority?: number;
}

export async function enqueue(name: QueueName, data: object, options: EnqueueOptions = {}): Promise<string | null> {
  const q = await getQueue();
  const { policy: _policy, ...jobOptions } = QUEUE_OPTIONS[name];
  return q.send(name, data, { ...jobOptions, ...options });
}

export async function stopQueue(): Promise<void> {
  if (boss) {
    const b = boss;
    boss = undefined;
    starting = undefined;
    await b.stop({ graceful: true, timeout: 10_000 }).catch(() => {});
  }
}
