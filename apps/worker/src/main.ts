import { getConfig } from '@localy/config';
import { closeDb, runMigrations } from '@localy/database';
import { getLogger, getQueue, stopQueue } from '@localy/core';
import { registerJobs } from './jobs';

process.env.LOCALY_SERVICE ??= 'worker';

async function main() {
  const cfg = getConfig();
  const log = getLogger();
  if (process.env.RUN_MIGRATIONS_ON_START !== 'false') await runMigrations();
  const boss = await getQueue();
  await registerJobs(boss);
  log.info({ concurrency: cfg.WORKER_CONCURRENCY }, 'Localy worker started');
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down worker');
    await stopQueue();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
