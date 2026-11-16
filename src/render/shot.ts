// Vykreslí HTML do JPEG přes Playwright (Chromium). V GitHub Actions se prohlížeč instaluje
// v úloze; místně jde použít vlastní Chrome přes proměnnou CHROME_PATH.

import { chromium } from 'playwright';

export async function htmlToJpeg(html: string, size: { w: number; h: number }, file: string): Promise<void> {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    const page = await browser.newPage({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
    // Písma jsou z Google Fonts: počká se na síť i na načtení písem (offline zůstane záložní písmo).
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => page.setContent(html, { waitUntil: 'load' }));
    await page.evaluate(() => document.fonts.ready).catch(() => undefined);
    await page.evaluate(() => (window as unknown as { fit?: () => void }).fit?.());
    await page.screenshot({ path: file, type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: size.w, height: size.h } });
  } finally {
    await browser.close();
  }
}
