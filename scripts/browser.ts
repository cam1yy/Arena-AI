/**
 * Headless Chromium launcher used by the end-to-end tests and the screenshot
 * tool. Uses a system Chrome when CHROME_PATH is set, otherwise the portable
 * build from @sparticuz/chromium (works in minimal Linux containers).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium, type Browser } from 'playwright-core';

export async function launchBrowser(): Promise<Browser> {
  if (process.env.CHROME_PATH) return chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const sparticuz = (await import('@sparticuz/chromium')).default;
  const libDir = path.join(os.tmpdir(), 'al2023', 'lib');
  if (!fs.existsSync(path.join(libDir, 'libnss3.so'))) {
    const { inflate } = await import('@sparticuz/chromium');
    // The package only exports its main entry (build/index.js), so locate the
    // package root from there rather than resolving package.json.
    const require = createRequire(import.meta.url);
    const bin = path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '..', 'bin', 'al2023.tar.br');
    await inflate(bin);
  }
  process.env.LD_LIBRARY_PATH = [libDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  const executablePath = await sparticuz.executablePath();
  return chromium.launch({ executablePath, headless: true, args: sparticuz.args.filter((a: string) => !a.startsWith('--single-process')) });
}
