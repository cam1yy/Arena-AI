/** Prints a Chromium executable path usable by Playwright (installs a portable build if needed). */
import { launchBrowser } from './browser';

const b = await launchBrowser();
await b.close();
const sparticuz = (await import('@sparticuz/chromium')).default;
console.log(await sparticuz.executablePath());
