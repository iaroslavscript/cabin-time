import { expect, test, type Page } from '@playwright/test';

type Counters = { chimes: number };

const WEATHER = {
  utc_offset_seconds: 3600,
  timezone_abbreviation: 'CET',
  current: { temperature_2m: 12.3, weather_code: 2, wind_speed_10m: 18, wind_direction_10m: 240, relative_humidity_2m: 71, is_day: 1 },
};

// Count plays of the recorded chime (the only non-looping sound longer than half a second).
test.beforeEach(async ({ page }) => {
  await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({ json: WEATHER }));
  await page.addInitScript(() => {
    const counters: Counters = { chimes: 0 };
    Object.assign(window, { counters });
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args) {
      if (!this.loop && (this.buffer?.duration ?? 0) > 0.5) counters.chimes++;
      return start.apply(this, args);
    };
  });
});

const chimes = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { counters: Counters }).counters.chimes);

test('the call button chimes and stays lit until pressed again', async ({ page }) => {
  await page.goto('./');
  const call = page.getByRole('button', { name: 'Call cabin crew' });
  await expect(call).toHaveAttribute('aria-pressed', 'false');

  await call.click();
  await expect(call).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => chimes(page)).toBe(1);
  await expect(page.locator('.psu')).toHaveClass(/\bcalling\b/);
  await page.waitForTimeout(1500);
  await expect(call).toHaveAttribute('aria-pressed', 'true');

  await call.click();
  await expect(call).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.psu')).not.toHaveClass(/\bcalling\b/);
  await page.waitForTimeout(300);
  expect(await chimes(page)).toBe(1);
});

test('reading lights and air vents work per seat and are remembered', async ({ page }) => {
  await page.goto('./');
  const light = page.getByRole('button', { name: 'Reading light B' });
  await light.click();
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Reading light A' })).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: 'Air vent C: off' }).click();
  await page.getByRole('button', { name: 'Air vent C: low' }).click();
  await expect(page.getByRole('button', { name: 'Air vent C: high' })).toBeVisible();

  await page.reload();
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Air vent C: high' })).toBeVisible();
  await page.getByRole('button', { name: 'Air vent C: high' }).click();
  await expect(page.getByRole('button', { name: 'Air vent C: off' })).toBeVisible();
});

test('the whole panel fits the screen', async ({ page }) => {
  await page.goto('./');
  for (const el of await page.locator('.placard, .ife, .sign, .pocket, .light-btn, .call-btn, .speaker, .oxygen, .info-btn').all()) {
    await expect(el).toBeInViewport({ ratio: 1 });
  }
});

test('shows credits for the chime and the version', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'About' }).click();
  const about = page.getByRole('dialog', { name: 'Cabin Crew Call' });
  await expect(about).toContainText('CC0 1.0');
  await expect(about.locator('#app-version')).toHaveText(/^\d+\.\d+\.\d+$/);
  await about.getByRole('button', { name: 'Close' }).click();
  await expect(about).toBeHidden();
});

test('works offline after the first visit, including the chime', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'offline emulation with service workers is reliable in Chromium only');
  await page.goto('./');
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const cached = async () => (await (await caches.open((await caches.keys())[0] ?? 'none')).keys()).length;
    while (reg.active?.state !== 'activated' || (await cached()) === 0) await new Promise((r) => setTimeout(r, 100));
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Call cabin crew' }).click();
  await expect.poll(() => chimes(page)).toBe(1);
});

const EUROPE = /^(AT|BE|BG|HR|CY|CZ|DK|EE|FI|FR|DE|GR|HU|IE|IT|LV|LT|LU|MT|NL|PL|PT|RO|SK|SI|ES|SE|IS|LI|NO|CH|GB|GI|FO|GG|JE|IM)$/;

test('the moving map shows a European flight and enlarges on tap', async ({ page }) => {
  await page.goto('./');
  const ife = page.locator('.ife');
  await expect(ife).toHaveAttribute('data-flight', /^[A-Z]{3}\w+$/);
  await expect(ife).toHaveAttribute('data-screen', 'map');
  const [from, to] = (await ife.getAttribute('data-route'))!.split('-');
  expect(from).toMatch(EUROPE);
  expect(to).toMatch(EUROPE);
  await expect(ife.locator('.ife-bar.top')).toContainText('→');

  const box = async () => (await ife.boundingBox())!.width;
  const small = await box();
  await ife.click();
  await expect(ife).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(box).toBeGreaterThan(small * 1.3);

  await ife.click();
  await expect(ife).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(box).toBeCloseTo(small, 0);

  // Android back button shrinks it as well.
  await ife.click();
  await expect(ife).toHaveAttribute('aria-expanded', 'true');
  await page.goBack();
  await expect(ife).toHaveAttribute('aria-expanded', 'false');
});

test('the display loops through all moving map screens', async ({ page }) => {
  // Midday over Europe, so the outside camera is available.
  await page.clock.install({ time: new Date('2026-06-15T11:00:00Z') });
  await page.goto('./');
  const ife = page.locator('.ife');
  await expect(ife).toHaveAttribute('data-screen', 'map');

  const seen = ['map'];
  for (let s = 0; s < 200 && seen.length < 8; s++) {
    await page.clock.runFor(1000);
    const screen = (await ife.getAttribute('data-screen'))!;
    if (screen !== seen.at(-1)) seen.push(screen);
    if (screen === 'weather') await expect(ife).toContainText('Partly cloudy');
  }
  expect(seen).toEqual(['map', 'progress', 'mini', 'altspeed', 'weather', 'remaining', 'camera', 'map']);
});

test('preferences choose the region and units, and are remembered', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Preferences' }).click();
  const dialog = page.getByRole('dialog', { name: 'Preferences' });
  await dialog.getByLabel('Flights shown on the moving map').selectOption('north-america');
  await dialog.getByLabel(/Imperial/).check();
  await expect(dialog.locator('#current-flight')).not.toHaveText('—');
  const flight = await page.locator('.ife').getAttribute('data-flight');
  await dialog.getByRole('button', { name: 'Another flight' }).click();
  await expect(page.locator('.ife')).not.toHaveAttribute('data-flight', flight!);
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.reload();
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('cabin-prefs-v1')!));
  expect(prefs).toMatchObject({ region: 'north-america', units: 'imperial' });
  await expect(page.locator('.ife')).toHaveAttribute('data-route', /^(US|CA|MX|PR|BS|BM|JM|DO|CU|GL)-(US|CA|MX|PR|BS|BM|JM|DO|CU|GL)$/);
  await page.getByRole('button', { name: 'Preferences' }).click();
  await expect(dialog.getByLabel(/Imperial/)).toBeChecked();
  await expect(dialog.getByLabel('Flights shown on the moving map')).toHaveValue('north-america');
});

test('the display can be switched off', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Preferences' }).click();
  const dialog = page.getByRole('dialog', { name: 'Preferences' });
  await dialog.getByLabel('Show the moving map display').uncheck();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.ife')).toBeHidden();
  await expect(page.getByRole('img', { name: 'No smoking' })).toBeVisible();
});

test('the seat row and letters are configurable', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Preferences' }).click();
  const dialog = page.getByRole('dialog', { name: 'Preferences' });
  await dialog.getByLabel('Row').fill('23');
  await dialog.getByLabel('Row').press('Tab');
  await dialog.getByLabel('Seats').selectOption('DEF');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(page.locator('.placard')).toHaveText(/23\s*D\s*E\s*F/);
  await page.getByRole('button', { name: 'Reading light E' }).click();
  await expect(page.getByRole('button', { name: 'Reading light E' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('.placard')).toHaveText(/23\s*D\s*E\s*F/);
  await expect(page.getByRole('button', { name: 'Air vent F: off' })).toBeVisible();
});

test('dragging a lamp or nozzle swivels it without switching it', async ({ page }) => {
  await page.goto('./');
  const vent = page.getByRole('button', { name: 'Air vent A: off' });
  const box = (await vent.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - box.width / 4, cy, { steps: 4 });
  await page.mouse.move(cx - box.width / 2, cy, { steps: 4 });
  await page.mouse.up();

  await expect(vent).toHaveAttribute('data-level', '0');
  await expect(vent).toHaveCSS('--ax', '-1');
  await expect(vent).toHaveCSS('--ay', '0');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Air vent A: off' })).toHaveCSS('--ax', '-1');

  // The aisle-seat lamp only swivels slightly toward the window seat, and tapping it doesn't switch it.
  const lamp = page.locator('.light-cell[data-seat="C"] .lamp');
  await lamp.click();
  await expect(page.getByRole('button', { name: 'Reading light C' })).toHaveAttribute('aria-pressed', 'false');
  const lb = (await lamp.boundingBox())!;
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await page.mouse.down();
  await page.mouse.move(lb.x - lb.width, lb.y + lb.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.light-cell[data-seat="C"]')).toHaveCSS('--ax', '-0.4');
});
