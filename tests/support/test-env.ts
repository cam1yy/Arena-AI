/** Environment shared by the test process and the global setup process. */
export const FAKE_SERVICES_PORT = 59999;
export const FAKE_URL = `http://127.0.0.1:${FAKE_SERVICES_PORT}`;

export function applyTestEnv() {
  Object.assign(process.env, {
    LOCALY_SKIP_DOTENV: '1',
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/localy_test',
    SESSION_SECRET: 'test-session-secret-0123456789abcdefghijklmnop',
    EMAIL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    APP_URL: 'http://localhost:5173',
    API_URL: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    ENABLE_DEV_EMAIL_SANDBOX: 'true',
    PLACES_REQUESTS_PER_SECOND: '1000',
    GOOGLE_MAPS_API_KEY: 'test-server-key',
    GOOGLE_PLACES_BASE_URL: FAKE_URL,
    GOOGLE_GEOCODING_BASE_URL: FAKE_URL,
    GOOGLE_CLIENT_ID: 'test-google-client',
    GOOGLE_CLIENT_SECRET: 'test-google-secret',
    GOOGLE_TOKEN_URL: `${FAKE_URL}/token`,
    GMAIL_API_BASE_URL: FAKE_URL,
    MICROSOFT_GRAPH_BASE_URL: FAKE_URL,
    STRIPE_SECRET_KEY: 'sk_test_fake_key',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
    STRIPE_PRICE_ID_PRO: 'price_pro_test',
    STRIPE_PRICE_ID_AGENCY: 'price_agency_test',
    STRIPE_API_BASE_URL: FAKE_URL,
    LOCALY_FAKE_SERVICES_URL: FAKE_URL,
  });
}
