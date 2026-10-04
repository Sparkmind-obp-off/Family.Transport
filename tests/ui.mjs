import { chromium, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const password = readFileSync('.dev.vars', 'utf8').match(/^OPERATOR_PASSWORD=(.+)$/m)[1];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ httpCredentials: { username: 'operator', password }, viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = []; let passed = 0;
const nonce = Date.now(); const driver = 'UI Driver ' + nonce, vehicle = 'UI Vehicle ' + nonce, customer = 'UI Customer ' + nonce;
page.on('pageerror', error => errors.push(error.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
const check = async (name, fn) => { await fn(); passed++; console.log('PASS: ' + name); };
const dialog = () => page.locator('#editor');
async function findEntityRow(name) {
  await expect(page.locator('#refresh')).toBeEnabled();
  for (let i = 0; i < 100; i++) {
    const row = page.locator('#entity-list .trip').filter({ hasText: name });
    if (await row.count()) return row;
    const next = page.locator('#entity-pagination').getByRole('button', { name: 'Berikutnya', exact: true });
    if (!await next.count()) throw new Error('Synthetic entity not found in paginated collection');
    const response = page.waitForResponse(r => /\/api\/(customers|drivers|vehicles)\?/.test(r.url()) && r.status() === 200);
    await next.click(); await response;
  }
  throw new Error('Collection pagination exceeded test bound');
}
async function addEntity(kind, name, extraLabel, extraValue) {
  await page.locator('[data-view="' + kind + '"]').click();
  await page.locator('#new-entity').click();
  await dialog().getByLabel('Nama', { exact: true }).fill(name);
  if (extraLabel) await dialog().getByLabel(extraLabel, { exact: true }).fill(extraValue);
  await dialog().getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(dialog()).not.toBeVisible();
}
try {
  await check('mobile dashboard loads with no horizontal overflow', async () => {
    await page.goto('http://localhost:3000'); await expect(page.locator('#today-count')).not.toHaveText('—');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  });
  await check('create driver from mobile UI', async () => { await addEntity('drivers', driver, 'WhatsApp', '081234567895'); await expect(await findEntityRow(driver)).toBeVisible(); });
  await check('create vehicle from mobile UI', async () => { await addEntity('vehicles', vehicle, 'Identitas / nomor polisi', 'TEST UI'); await expect(await findEntityRow(vehicle)).toBeVisible(); });
  await check('create trip and new customer from mobile UI', async () => {
    await page.locator('#new-trip').click();
    await dialog().getByLabel('Nama customer baru', { exact: true }).fill(customer);
    await dialog().getByLabel('WhatsApp customer baru', { exact: true }).fill('081234567896');
    await dialog().getByLabel('Pickup', { exact: true }).fill('UI Stasiun'); await dialog().getByLabel('Tujuan', { exact: true }).fill('UI Hotel');
    await dialog().getByLabel('Penumpang', { exact: true }).fill('4'); await dialog().getByLabel('Harga (Rp, opsional)', { exact: true }).fill('250000');
    await dialog().getByLabel('Catatan', { exact: true }).fill('<img src=x onerror=alert(1)>');
    await dialog().getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect(page.locator('#editor-title')).toHaveText('Detail perjalanan'); await expect(dialog().locator('.PENDING')).toBeVisible();
  });
  await check('unsafe customer-controlled text renders literally', async () => { await expect(dialog().getByText('<img src=x onerror=alert(1)>', { exact: true })).toBeVisible(); assert.equal(await dialog().locator('img').count(), 0); });
  await check('edit trip route', async () => {
    await dialog().getByRole('button', { name: 'Edit trip', exact: true }).click();
    await dialog().getByLabel('Tujuan', { exact: true }).fill('UI Hotel Baru');
    await dialog().getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect(dialog().getByRole('heading', { name: 'UI Stasiun → UI Hotel Baru' })).toBeVisible();
  });
  await check('dialog errors stay visible instead of hiding behind modal', async () => {
    await page.evaluate(() => safely(async () => { throw new Error('Data berubah. Muat ulang.'); }));
    await expect(page.locator('#editor-error')).toHaveText('Data berubah. Muat ulang.');
    await expect(page.locator('#editor-error')).toBeVisible();
    await dialog().getByRole('button', { name: 'Buka trip', exact: true }).click();
    await expect(page.locator('#editor-error')).toBeHidden();
  });
  await check('confirm trip and display assignment form', async () => { await dialog().getByRole('button', { name: '→ Dikonfirmasi', exact: true }).click(); await expect(dialog().locator('.CONFIRMED')).toBeVisible(); await expect(dialog().getByRole('combobox', { name: 'Driver', exact: true })).toBeVisible(); });
  await check('assign driver and vehicle', async () => {
    await dialog().getByRole('combobox', { name: 'Driver', exact: true }).selectOption({ label: driver });
    await dialog().getByRole('combobox', { name: 'Kendaraan', exact: true }).selectOption({ label: vehicle });
    await dialog().getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect(dialog().locator('.ASSIGNED')).toBeVisible(); await expect(dialog().getByText(driver + ' · ' + vehicle, { exact: true })).toBeVisible();
  });
  await check('WhatsApp normalizes phone and prefills trip detail', async () => {
    const a = dialog().getByRole('link', { name: 'Kirim detail trip', exact: true });
    const href = await a.getAttribute('href'); assert.ok(href.startsWith('https://wa.me/6281234567896?text=')); assert.ok(decodeURIComponent(href).includes('UI Hotel Baru')); assert.equal(await a.getAttribute('rel'), 'noopener noreferrer');
  });
  await check('start and complete trip', async () => {
    await dialog().getByRole('button', { name: '→ Dalam perjalanan', exact: true }).click(); await expect(dialog().locator('.ON_TRIP')).toBeVisible();
    await dialog().getByRole('button', { name: '→ Selesai', exact: true }).click(); await expect(dialog().locator('.COMPLETED')).toBeVisible(); assert.equal(await dialog().getByRole('button', { name: 'Edit trip', exact: true }).count(), 0);
    await page.locator('#close-editor').click();
  });
  await check('trip search and filter', async () => {
    await page.locator('[data-view="trips"]').click(); await page.locator('#filters [name=q]').fill(customer); await page.locator('#filters [name=status]').selectOption('COMPLETED');
    await page.getByRole('button', { name: 'Terapkan filter', exact: true }).click(); await expect(page.locator('#trip-list .trip')).toHaveCount(1); await expect(page.locator('#trip-list')).toContainText(customer);
  });
  await check('customer history shows completed trip', async () => {
    await page.locator('[data-view="customers"]').click();
    const row = await findEntityRow(customer); await row.getByRole('button', { name: 'Riwayat trip', exact: true }).click(); await expect(dialog().locator('.COMPLETED')).toBeVisible(); await page.locator('#close-editor').click();
  });
  await check('edit and deactivate driver', async () => {
    await page.locator('[data-view="drivers"]').click(); const row = await findEntityRow(driver);
    await row.getByRole('button', { name: 'Edit', exact: true }).click(); await dialog().getByRole('combobox', { name: 'Status', exact: true }).selectOption('0'); await dialog().getByRole('button', { name: 'Simpan', exact: true }).click(); await expect(row).toContainText('Tidak aktif');
  });
  const forceMore = async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('limit') === '20') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], has_more: true }) });
    return route.continue();
  };
  await page.route('**/api/trips?**', forceMore);
  await check('attention dashboard drill-down preserves exact filter', async () => {
    await page.locator('[data-view="dashboard"]').click();
    const more = page.locator('#attention-trips').getByRole('button', { name: 'Lihat daftar lengkap', exact: true }); await expect(more).toBeVisible();
    const response = page.waitForResponse(r => r.url().includes('/api/trips?') && new URL(r.url()).searchParams.get('limit') === '25');
    await more.click(); const url = new URL((await response).url());
    assert.ok(url.searchParams.get('attention')); assert.equal(url.searchParams.get('from'), null);
    await expect(page.locator('#trip-filter-context')).toContainText('Perlu tindakan');
  });
  await check('upcoming dashboard drill-down excludes terminal trips', async () => {
    await page.locator('[data-view="dashboard"]').click();
    const more = page.locator('#upcoming-trips').getByRole('button', { name: 'Lihat daftar lengkap', exact: true }); await expect(more).toBeVisible();
    const response = page.waitForResponse(r => r.url().includes('/api/trips?') && new URL(r.url()).searchParams.get('limit') === '25');
    await more.click(); const url = new URL((await response).url());
    assert.equal(url.searchParams.get('open'), '1'); assert.ok(url.searchParams.get('from')); assert.equal(url.searchParams.get('attention'), null);
    await expect(page.locator('#trip-filter-context')).toContainText('Mendatang');
  });
  await check('all-history reset removes dashboard-only filters', async () => {
    const response = page.waitForResponse(r => r.url().includes('/api/trips?') && new URL(r.url()).searchParams.get('limit') === '25');
    await page.locator('#reset-filters').click(); const url = new URL((await response).url());
    for (const name of ['attention', 'open', 'from', 'to', 'status', 'q']) assert.equal(url.searchParams.get(name), null);
    await expect(page.locator('#trip-filter-context')).toBeHidden();
  });
  await page.unroute('**/api/trips?**', forceMore);
  await check('desktop and mobile layout with no browser or CSP errors', async () => {
    await page.locator('[data-view="dashboard"]').click(); await expect(page.locator('#today-count')).not.toHaveText('—');
    mkdirSync('playwright-results', { recursive: true }); await page.screenshot({ path: 'playwright-results/mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: 'playwright-results/desktop.png', fullPage: true }); assert.deepEqual(errors, []);
  });
  console.log('UI checks: ' + passed + ' passed, 0 failed');
} finally { await browser.close(); }
