/**
 * Development-only PostgreSQL. Starts a local PostgreSQL 18 server from the
 * `embedded-postgres` npm package so the project runs without Docker or a
 * system install. Production deployments must point DATABASE_URL at a managed
 * PostgreSQL instance instead.
 *
 *   npm run db:start          # foreground; Ctrl+C to stop
 */
import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';
import fs from 'node:fs';
import pg from 'pg';

const port = Number(process.env.DEV_DB_PORT ?? 5432);
const dataDir = path.resolve(process.env.DEV_DB_DIR ?? '.localy/pgdata');
const databases = (process.env.DEV_DB_NAMES ?? 'localy,localy_test').split(',');

if (process.env.NODE_ENV === 'production') {
  console.error('The embedded development database cannot run with NODE_ENV=production.');
  process.exit(1);
}

async function main() {
  fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  const firstRun = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
    onLog: () => {},
    onError: (e) => console.error('[postgres]', typeof e === 'string' ? e.trim() : e),
  });
  if (firstRun) await server.initialise();
  await server.start();
  const client = new pg.Client({ connectionString: `postgres://postgres:postgres@localhost:${port}/postgres` });
  await client.connect();
  for (const name of databases) {
    const exists = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (exists.rowCount === 0) await client.query(`create database "${name}"`);
  }
  await client.end();
  console.log(`Development PostgreSQL running on postgres://postgres:postgres@localhost:${port}`);
  console.log(`Databases: ${databases.join(', ')}  Data: ${dataDir}`);

  const shutdown = async () => {
    console.log('\nStopping development PostgreSQL...');
    await server.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
