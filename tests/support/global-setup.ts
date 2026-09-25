import pg from 'pg';
import { startFakeServices, type FakeServer } from './fake-services';
import { applyTestEnv, FAKE_SERVICES_PORT } from './test-env';

let fake: FakeServer | undefined;

/** Creates a clean test database, applies migrations and starts fake third-party services. */
export default async function setup() {
  applyTestEnv();
  const url = process.env.DATABASE_URL!;
  const dbName = new URL(url).pathname.slice(1);
  const admin = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, '/postgres') });
  await admin.connect();
  await admin.query(`drop database if exists "${dbName}" with (force)`);
  await admin.query(`create database "${dbName}"`);
  await admin.end();

  fake = await startFakeServices(FAKE_SERVICES_PORT);
  const { runMigrations, closeDb } = await import('@localy/database');
  await runMigrations();
  await closeDb();

  return async () => {
    await fake?.close();
  };
}
