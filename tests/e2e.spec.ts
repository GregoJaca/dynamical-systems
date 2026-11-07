import { expect, test } from '@playwright/test';

test('numeric portrait appears and nothing is written to localStorage', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(250);
  const pixels = await canvas.evaluate((node) => {
    const context = (node as HTMLCanvasElement).getContext('2d');
    if (!context) return 0;
    const { width, height } = node as HTMLCanvasElement;
    const data = context.getImageData(0, 0, width, height).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 16) {
      if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 40) ink += 1;
    }
    return ink;
  });
  expect(pixels).toBeGreaterThan(20);

  const stored = await page.evaluate(() => window.localStorage.length);
  expect(stored).toBe(0);
});

test('a shared hash restores the parameter and stays stateless', async ({ page, browser }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.location.hash.includes('#s='), null, { timeout: 10_000 });
  const hash = await page.evaluate(() => window.location.hash);
  expect(await page.evaluate(() => window.localStorage.length)).toBe(0);

  const fresh = await browser.newContext();
  const restored = await fresh.newPage();
  await restored.goto(`/${hash}`);
  await expect(restored.locator('canvas').first()).toBeVisible();
  expect(await restored.evaluate(() => window.location.hash)).toBe(hash);
  expect(await restored.evaluate(() => window.localStorage.length)).toBe(0);
  await fresh.close();
});
