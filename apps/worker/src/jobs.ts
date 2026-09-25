import type { PgBoss, Job } from 'pg-boss';
import { getConfig } from '@localy/config';
import { errorLogs, getDb } from '@localy/database';
import {
  deliverSystemMail,
  getLogger,
  maintenance,
  QUEUES,
  sending,
  systemMail,
  type QueueName,
} from '@localy/core';

const log = () => getLogger();

async function recordJobError(queue: string, err: unknown, data: unknown) {
  const e = err as Error;
  try {
    await getDb()
      .insert(errorLogs)
      .values({ source: 'worker', route: queue, message: e?.message?.slice(0, 2000) ?? String(err), stack: e?.stack?.slice(0, 8000) ?? null, context: { data: data as Record<string, unknown> } });
  } catch {
    /* ignore */
  }
}

type Handler<T> = (data: T, job: Job<T>) => Promise<unknown>;

function wrap<T>(queue: QueueName, handler: Handler<T>) {
  return async (jobs: Job<T>[]) => {
    for (const job of jobs) {
      const started = Date.now();
      try {
        const result = await handler(job.data, job);
        log().debug({ queue, jobId: job.id, ms: Date.now() - started, result }, 'job complete');
      } catch (err) {
        log().warn({ queue, jobId: job.id, err: (err as Error).message }, 'job failed');
        await recordJobError(queue, err, job.data);
        throw err;
      }
    }
  };
}

/**
 * Registers every background job handler and the recurring schedules.
 * Handlers are idempotent; pg-boss retries failures with backoff.
 */
export async function registerJobs(boss: PgBoss) {
  const db = getDb();
  const concurrency = getConfig().WORKER_CONCURRENCY;

  await boss.work<{ messageId: string }, unknown, { localConcurrency: number; includeMetadata: true }>(QUEUES.sendEmail, { localConcurrency: concurrency, includeMetadata: true }, async (jobs) => {
    for (const job of jobs) {
      try {
        await sending.processSendEmail(db, job.data.messageId, job.retryCount);
      } catch (err) {
        await recordJobError(QUEUES.sendEmail, err, job.data);
        throw err;
      }
    }
  });
  await boss.work<{ campaignId: string }>(QUEUES.campaignTick, { localConcurrency: 2 }, wrap(QUEUES.campaignTick, (d) => sending.processCampaignTick(db, d.campaignId)));
  await boss.work<Record<string, never>>(QUEUES.inboxSync, wrap(QUEUES.inboxSync, () => maintenance.runInboxSync(db)));
  await boss.work<Record<string, never>>(QUEUES.integrationHealth, wrap(QUEUES.integrationHealth, () => maintenance.runIntegrationHealthChecks(db)));
  await boss.work<Record<string, never>>(QUEUES.followUpReminders, wrap(QUEUES.followUpReminders, async () => {
    const reminders = await maintenance.runFollowUpReminders(db);
    const usage = await maintenance.runUsageChecks(db);
    return { reminders, usage };
  }));
  await boss.work<Record<string, never>>(QUEUES.analytics, wrap(QUEUES.analytics, () => maintenance.runAnalyticsAggregation(db)));
  await boss.work<Record<string, never>>(QUEUES.cleanup, wrap(QUEUES.cleanup, () => maintenance.runCleanup(db)));
  await boss.work<{ to: string; subject: string; text: string; html?: string }>(QUEUES.systemMail, wrap(QUEUES.systemMail, (d) => deliverSystemMail(d)));
  await boss.work<{ to: string; title: string; body: string; link: string | null }>(QUEUES.notificationEmail, wrap(QUEUES.notificationEmail, (d) =>
    deliverSystemMail(systemMail.notificationDigestEmail(d.to, d.title, d.body, d.link)),
  ));
  await boss.work<Record<string, never>>(QUEUES.dispatch, wrap(QUEUES.dispatch, () => sending.dispatch(db)));

  // Recurring schedules (cron, UTC). pg-boss guarantees a single instance per schedule across workers.
  await boss.schedule(QUEUES.dispatch, '* * * * *', {}, { singletonKey: 'dispatch' });
  await boss.schedule(QUEUES.inboxSync, '*/2 * * * *', {}, { singletonKey: 'inbox-sync' });
  await boss.schedule(QUEUES.followUpReminders, '*/15 * * * *', {}, { singletonKey: 'reminders' });
  await boss.schedule(QUEUES.integrationHealth, '17 * * * *', {}, { singletonKey: 'health' });
  await boss.schedule(QUEUES.analytics, '*/30 * * * *', {}, { singletonKey: 'analytics' });
  await boss.schedule(QUEUES.cleanup, '23 3 * * *', {}, { singletonKey: 'cleanup' });
}
