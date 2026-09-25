import { applyTestEnv } from './test-env';

/**
 * Test environment. Tests run against a dedicated PostgreSQL database
 * (TEST_DATABASE_URL, default localy_test) and local fakes of third-party APIs.
 */
applyTestEnv();
