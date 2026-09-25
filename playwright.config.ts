import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run against an already running stack (npm run dev).
 * Set CHROME_PATH to use a specific browser; otherwise Playwright's bundled
 * Chromium is used (install with: npx playwright install chromium).
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROME_PATH
      ? {
          executablePath: process.env.CHROME_PATH,
          // Flags needed by portable/sandboxed Chromium builds in containers.
          args: process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(' ') : ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--use-angle=swiftshader'],
        }
      : undefined,
  },
});
