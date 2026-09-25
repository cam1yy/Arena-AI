/** Development tool: signs in and captures screenshots of the given paths. */
import { launchBrowser } from './browser';

const base = process.env.BASE_URL ?? 'http://localhost:5173';
const email = process.env.SHOT_EMAIL ?? 'demo@localy.dev';
const password = process.env.SHOT_PASSWORD ?? 'localy-demo-2026';
const out = process.env.SHOT_DIR ?? '/tmp/shots';
const width = Number(process.env.SHOT_WIDTH ?? 1440);
const height = Number(process.env.SHOT_HEIGHT ?? 900);

async function main() {
  const paths = process.argv.slice(2);
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  if (!process.env.NO_LOGIN) {
    await page.goto(`${base}/signin`);
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type=submit]');
    await page.waitForURL(/\/(app|onboarding)/, { timeout: 15000 });
  }
  for (const p of paths) {
    // Format: <route>[@name]. "@" separates the output name so routes may contain "=".
    const at = p.lastIndexOf('@');
    const route = at > 0 ? p.slice(0, at) : p;
    const name = at > 0 ? p.slice(at + 1) : undefined;
    await page.goto(`${base}${route}`, { waitUntil: 'networkidle' }).catch(() => undefined);
    await page.waitForTimeout(Number(process.env.SHOT_WAIT ?? 900));
    const file = `${out}/${(name ?? route).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root'}.png`;
    await page.screenshot({ path: file, fullPage: process.env.FULL === '1' });
    console.log('saved', file);
  }
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
