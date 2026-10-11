import AxeBuilder from '@axe-core/playwright';
import { completeQuiz, expect, test, toResults } from './fixtures';

// Automated checks catch a class of problems, not all of them — keyboard and
// screen-reader review still matter. These guard against regressions.
const scan = (page: import('@playwright/test').Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();

test('landing has no serious/critical axe violations in default dark and light', async ({ page, mock }) => {
  void mock;
  for (const mode of ['dark', 'light'] as const) {
    await page.addInitScript((m) => localStorage.setItem('cinematch-appearance:v1', JSON.stringify({ version: 1, mode: m })), mode);
    await page.goto('/');
    await page.waitForTimeout(2000); // hero reveal animations must finish before sampling colours
    const r = await scan(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'), `${mode}: ${JSON.stringify(r.violations.map((v) => v.id))}`).toEqual([]);
  }
});

test('appearance drawer and results have no serious/critical violations', async ({ page, mock }) => {
  void mock;
  await page.goto('/');
  await page.getByRole('button', { name: 'Appearance settings', exact: true }).click();
  await page.waitForTimeout(500); // let the entrance animation finish — axe samples mid-fade colours otherwise
  const drawer = await new AxeBuilder({ page }).include('.appearance-panel').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(drawer.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'), JSON.stringify(drawer.violations.map((v) => v.id))).toEqual([]);
  await page.keyboard.press('Escape');
  await completeQuiz(page);
  await toResults(page);
  await page.waitForTimeout(2000); // staggered card entrances must finish — axe samples mid-fade colours otherwise
  const r = await scan(page);
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'), JSON.stringify(r.violations.map((v) => v.id))).toEqual([]);
});

test('combined high contrast + large text + compact density has no horizontal overflow', async ({ page, mock }) => {
  void mock;
  await page.addInitScript(() => localStorage.setItem('cinematch-appearance:v1', JSON.stringify({ version: 1, contrast: 'high', textScale: 125, density: 'compact', transparency: 'reduced', contentWidth: 'wide' })));
  await page.goto('/');
  await completeQuiz(page);
  await toResults(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
