import { completeQuiz, expect, test, toResults } from './fixtures';

// Opt-in visual regression (npm run test:visual). Baselines are NOT committed:
// rendering differs between machines/OSes, so generate them on the machine
// (or CI image) that will compare them:  npm run test:visual -- --update-snapshots
// Decorative animation is frozen and particles are off so shots are stable.
test.skip(!process.env.VISUAL, 'set VISUAL=1 (npm run test:visual) to run screenshot comparisons');

const FREEZE = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}.landing-canvas{display:none!important}`;
const combos = [
  { name: 'default', prefs: {} },
  { name: 'noir-light-hc', prefs: { palette: 'noir-gold', mode: 'light', contrast: 'high' } },
  { name: 'oceanic-large-dense', prefs: { palette: 'oceanic', mode: 'dark', textScale: 125, density: 'compact', fontPreset: 'soft-minimal' } },
  { name: 'paper-serif-list', prefs: { palette: 'indie-paper', mode: 'light', fontPreset: 'prestige-cinema', resultLayout: 'list' } },
];

for (const c of combos) {
  test(`landing + results · ${c.name}`, async ({ page, mock }) => {
    void mock;
    await page.addInitScript((p) => {
      localStorage.setItem('cinematch-appearance:v1', JSON.stringify({ version: 1, motion: 'off', particles: 'off', ...p }));
      localStorage.setItem('cinematch-vibe:v1', 'skipped');
    }, c.prefs);
    await page.goto('/');
    await page.addStyleTag({ content: FREEZE });
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`landing-${c.name}.png`, { maxDiffPixelRatio: 0.02 });
    await completeQuiz(page);
    await toResults(page);
    await page.addStyleTag({ content: FREEZE });
    await expect(page).toHaveScreenshot(`results-${c.name}.png`, { maxDiffPixelRatio: 0.02, fullPage: false });
  });
}

test('settings drawer', async ({ page, mock }) => {
  void mock;
  await page.addInitScript(() => localStorage.setItem('cinematch-vibe:v1', 'skipped'));
  await page.goto('/');
  await page.addStyleTag({ content: FREEZE });
  await page.getByRole('button', { name: 'Appearance settings', exact: true }).click();
  await expect(page.locator('.appearance-panel')).toHaveScreenshot('drawer.png', { maxDiffPixelRatio: 0.02 });
});
