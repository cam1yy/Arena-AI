import { getConfig } from '@localy/config';
import { closeDb, runMigrations } from '@localy/database';
import { getLogger, getQueue, stopQueue } from '@localy/core';
import { buildApp } from './app';

process.env.LOCALY_SERVICE ??= 'api';

async function main() {
  const cfg = getConfig();
  const log = getLogger();
  if (process.env.RUN_MIGRATIONS_ON_START !== 'false') await runMigrations();
  await getQueue();
  const app = await buildApp();
  await app.listen({ host: cfg.API_HOST, port: cfg.API_PORT });
  log.info(
    { features: cfg.features, sandbox: cfg.devSandboxEnabled },
    `Localy API listening on ${cfg.API_HOST}:${cfg.API_PORT}`,
  );
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down API');
    await app.close();
    await stopQueue();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('API failed to start:', err);
  process.exit(1);
});
