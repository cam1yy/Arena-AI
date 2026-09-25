/**
 * End-to-end tests of the critical user flows in a real browser against the
 * running app (web + API + worker). Start the stack first (npm run dev, with
 * the development sandbox mailbox enabled), then run: npm run test:e2e
 */
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

const DB = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/localy';
const PASSWORD = 'e2e-password-2468';

async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query(query, params)).rows as T[];
  } finally {
    await c.end();
  }
}

async function signUp(page: Page) {
  const email = `e2e.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
  await page.goto('/signup');
  await page.fill('#name', 'Robin Tester');
  await page.fill('#email', email);
  await page.fill('#workspace', 'Tester Studio');
  await page.fill('#password', PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/onboarding');
  return email;
}

test.describe('critical flows', () => {
  test('sign up, verify email, complete onboarding and land in the app', async ({ page }) => {
    const email = await signUp(page);
    await expect(page.getByRole('heading', { name: 'Welcome to Localy' })).toBeVisible();
    await page.getByRole('button', { name: 'Get started' }).click();
    await page.getByRole('radio', { name: 'Web design' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.fill('#o-agency', 'Tester Studio');
    await page.fill('#o-sender', 'Robin');
    await page.getByRole('button', { name: 'Continue' }).click();
    // Email verification link arrives in the development outbox.
    await expect.poll(async () => (await sql<{ n: number }>('select count(*)::int n from dev_outbox where to_email = $1', [email]))[0].n, { timeout: 15_000 }).toBeGreaterThan(0);
    const [mail] = await sql<{ text: string }>('select text from dev_outbox where to_email = $1 order by created_at desc limit 1', [email]);
    const link = /https?:\/\/\S+\/verify-email\?token=(\S+)/.exec(mail.text)!;
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await page.getByRole('button', { name: 'Barbers' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: "You're ready" })).toBeVisible();
    await page.getByRole('button', { name: 'Start discovering' }).click();
    await page.waitForURL(/\/app/);
    await page.goto(`/verify-email?token=${link[1]}`);
    await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  });

  test('add a prospect, write a note, tag it, and find it with global search', async ({ page }) => {
    await signUp(page);
    await sql(`update users set onboarding_completed_at = now(), email_verified_at = now() where email like 'e2e.%' and onboarding_completed_at is null`);
    await page.goto('/app/prospects');
    await expect(page.getByText('Your prospect list is empty.')).toBeVisible();
    await page.getByRole('button', { name: 'New prospect' }).first().click();
    await page.fill('#np-name', 'Harbour Barbers E2E');
    await page.fill('#np-first', 'Sam');
    await page.fill('#np-email', 'sam@harbour-e2e.test');
    await page.getByRole('button', { name: 'Add prospect' }).click();
    await expect(page.getByRole('heading', { name: 'Harbour Barbers E2E' })).toBeVisible();
    await page.getByLabel('New note').fill('Owner seems interested in a booking page.');
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByText('Owner seems interested in a booking page.').first()).toBeVisible();
    await page.getByLabel('New tag').fill('High value');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('High value').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('body').click();
    await page.keyboard.press('/');
    await page.getByPlaceholder('Search prospects, campaigns, templates, notes...').fill('booking page');
    await expect(page.getByRole('option', { name: /Owner seems interested/ })).toBeVisible();
  });

  test('compose and send outreach through the sandbox mailbox, then see the reply stop follow-ups', async ({ page }) => {
    await signUp(page);
    await sql(`update users set onboarding_completed_at = now(), email_verified_at = now() where email like 'e2e.%' and onboarding_completed_at is null`);
    await page.goto('/app/integrations');
    await page.getByRole('button', { name: 'Connect sandbox' }).click();
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await page.goto('/app/prospects?new=1');
    await page.fill('#np-name', 'Bakery E2E');
    await page.fill('#np-first', 'Yusuf');
    await page.fill('#np-email', 'yusuf@bakery-e2e.test');
    await page.getByRole('button', { name: 'Add prospect' }).click();
    await page.getByRole('button', { name: 'Compose', exact: true }).click();
    await expect(page.getByText('Preview for Bakery E2E')).toBeVisible();
    await expect(page.getByText('A website idea for Bakery E2E')).toBeVisible();
    await expect(page.getByText('Hi Yusuf,')).toBeVisible();
    await page.getByRole('button', { name: /Send 1 email/ }).click();
    await expect(page.getByText('You are about to send 1 email.')).toBeVisible();
    await page.getByRole('button', { name: 'Send emails' }).click();
    await page.waitForURL(/\/app\/campaigns\//);
    // The background worker sends it.
    await expect.poll(async () => (await sql<{ n: number }>(`select count(*)::int n from email_messages where to_email = 'yusuf@bakery-e2e.test' and status = 'sent'`))[0].n, { timeout: 90_000 }).toBe(1);
    await page.goto('/app/inbox');
    await page.getByRole('button', { name: /Bakery E2E/ }).click();
    await page.getByRole('button', { name: 'Simulate reply' }).click();
    await page.getByRole('button', { name: 'Simulate reply' }).last().click();
    await expect(page.getByText('Thanks for reaching out. Yes, I would like to see an example.')).toBeVisible();
    await page.getByRole('button', { name: 'Mark interested' }).click();
    await expect(page.getByText('Interested').first()).toBeVisible();
  });

  test('protects app routes and redirects signed-out users to sign in', async ({ page }) => {
    await page.goto('/app/prospects');
    await page.waitForURL(/\/signin\?redirect=/);
    await expect(page.getByRole('heading', { name: 'Sign in to Localy' })).toBeVisible();
  });
});
