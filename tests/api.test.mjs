import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const password = readFileSync('.dev.vars', 'utf8').match(/^OPERATOR_PASSWORD=(.+)$/m)[1];
const auth = 'Basic ' + Buffer.from('operator:' + password).toString('base64');
const nonce = Date.now();
async function call(path, method = 'GET', data, extra = {}) {
  const response = await fetch(base + '/api/' + path, { method, headers: { Authorization: auth, 'Content-Type': 'application/json', 'X-Requested-With': 'tests', ...extra }, body: data === undefined ? undefined : typeof data === 'string' ? data : JSON.stringify(data) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
let customer, driver, vehicle, trip;
const valid = () => ({ customer_id: customer.id, trip_date: '2026-10-04', trip_time: '09:30', pickup: 'Stasiun', destination: 'Hotel', passengers: 3, price: 0, notes: 'Test synthetic' });
async function expectStatus(result, code) { assert.equal(result.status, code, result.body.error || 'Unexpected HTTP status'); return result.body.data; }
await test('API integration with real local Worker and D1', async t => {
  await t.test('unauthenticated API and assets rejected', async () => {
    for (const path of ['/api/trips', '/', '/app.js', '/app.css']) assert.equal((await fetch(base + path)).status, 401);
  });
  await t.test('incorrect operator password rejected', async () => { assert.equal((await call('trips', 'GET', undefined, { Authorization: 'Basic ' + Buffer.from('operator:incorrect').toString('base64') })).status, 401); });
  await t.test('create customer and normalize Indonesian phone', async () => { customer = await expectStatus(await call('customers', 'POST', { name: 'Test Customer ' + nonce, whatsapp: '081234567890' }), 201); assert.equal(customer.whatsapp, '6281234567890'); });
  await t.test('retrieve and update customer', async () => { assert.equal((await call('customers/' + customer.id)).body.data.id, customer.id); await expectStatus(await call('customers/' + customer.id, 'PATCH', { notes: 'Updated' }), 200); });
  await t.test('create driver', async () => { driver = await expectStatus(await call('drivers', 'POST', { name: 'Test Driver ' + nonce, whatsapp: '081234567891', active: true }), 201); });
  await t.test('create vehicle', async () => { vehicle = await expectStatus(await call('vehicles', 'POST', { name: 'Test Vehicle ' + nonce, identifier: 'TEST', active: true }), 201); });
  await t.test('driver and vehicle update', async () => { await expectStatus(await call('drivers/' + driver.id, 'PATCH', { notes: 'Safe note' }), 200); await expectStatus(await call('vehicles/' + vehicle.id, 'PATCH', { identifier: 'TEST 2' }), 200); });
  await t.test('create trip with price zero preserved', async () => { trip = await expectStatus(await call('trips', 'POST', valid()), 201); assert.equal(trip.status, 'PENDING'); assert.equal(trip.price, 0); });
  await t.test('retrieve trips with date range and pagination', async () => { const r = await call('trips?from=2026-10-04&to=2026-10-04&limit=1'); await expectStatus(r, 200); assert.equal(r.body.data.length, 1); assert.equal(typeof r.body.has_more, 'boolean'); });
  await t.test('retrieve joined trip', async () => { const r = await call('trips/' + trip.id); assert.equal(r.body.data.customer_name, customer.name); });
  await t.test('update trip details', async () => { const r = await call('trips/' + trip.id, 'PATCH', { pickup: 'Bandara', passengers: 4, partner_source: 'Keluarga' }); assert.equal(r.body.data.passengers, 4); assert.equal(r.body.data.pickup, 'Bandara'); });
  await t.test('reject skipped status transition', async () => { await expectStatus(await call('trips/' + trip.id, 'PATCH', { status: 'ON_TRIP' }), 409); });
  await t.test('reject pending assignment', async () => { await expectStatus(await call('trips/' + trip.id + '/assignment', 'PATCH', { driver_id: driver.id }), 409); });
  await t.test('confirm trip', async () => { const r = await call('trips/' + trip.id, 'PATCH', { status: 'CONFIRMED' }); assert.equal(r.body.data.status, 'CONFIRMED'); });
  await t.test('missing driver', async () => { await expectStatus(await call('trips/' + trip.id + '/assignment', 'PATCH', { driver_id: 'missing' }), 404); });
  await t.test('missing vehicle', async () => { await expectStatus(await call('trips/' + trip.id + '/assignment', 'PATCH', { vehicle_id: 'missing' }), 404); });
  await t.test('inactive driver rejected', async () => { await call('drivers/' + driver.id, 'PATCH', { active: false }); await expectStatus(await call('trips/' + trip.id + '/assignment', 'PATCH', { driver_id: driver.id }), 409); await call('drivers/' + driver.id, 'PATCH', { active: true }); });
  await t.test('inactive vehicle rejected', async () => { await call('vehicles/' + vehicle.id, 'PATCH', { active: false }); await expectStatus(await call('trips/' + trip.id + '/assignment', 'PATCH', { vehicle_id: vehicle.id }), 409); await call('vehicles/' + vehicle.id, 'PATCH', { active: true }); });
  await t.test('assign driver alone stays confirmed', async () => { const r = await call('trips/' + trip.id + '/assignment', 'PATCH', { driver_id: driver.id }); assert.equal(r.body.data.driver_id, driver.id); assert.equal(r.body.data.status, 'CONFIRMED'); });
  await t.test('retained inactive driver blocks completion and preserves partial assignment', async () => {
    await call('drivers/' + driver.id, 'PATCH', { active: false });
    try {
      await expectStatus(await call('trips/' + trip.id + '/assignment', 'PATCH', { vehicle_id: vehicle.id }), 409);
      const saved = (await call('trips/' + trip.id)).body.data;
      assert.equal(saved.status, 'CONFIRMED'); assert.equal(saved.vehicle_id, null);
    } finally { await call('drivers/' + driver.id, 'PATCH', { active: true }); }
  });
  await t.test('retained inactive vehicle blocks completion', async () => {
    const separate = (await call('trips', 'POST', valid())).body.data;
    await call('trips/' + separate.id, 'PATCH', { status: 'CONFIRMED' });
    await call('trips/' + separate.id + '/assignment', 'PATCH', { vehicle_id: vehicle.id });
    await call('vehicles/' + vehicle.id, 'PATCH', { active: false });
    try { await expectStatus(await call('trips/' + separate.id + '/assignment', 'PATCH', { driver_id: driver.id }), 409); }
    finally { await call('vehicles/' + vehicle.id, 'PATCH', { active: true }); await call('trips/' + separate.id, 'PATCH', { status: 'CANCELLED' }); }
  });
  await t.test('assign vehicle completes assignment', async () => { const r = await call('trips/' + trip.id + '/assignment', 'PATCH', { vehicle_id: vehicle.id }); assert.equal(r.body.data.vehicle_id, vehicle.id); assert.equal(r.body.data.status, 'ASSIGNED'); });
  await t.test('cannot clear assigned driver', async () => { await expectStatus(await call('trips/' + trip.id + '/assignment', 'PATCH', { driver_id: null }), 409); });
  await t.test('cannot reverse status', async () => { await expectStatus(await call('trips/' + trip.id, 'PATCH', { status: 'PENDING' }), 409); });
  await t.test('start then complete trip', async () => { await expectStatus(await call('trips/' + trip.id, 'PATCH', { status: 'ON_TRIP' }), 200); const r = await call('trips/' + trip.id, 'PATCH', { status: 'COMPLETED' }); assert.equal(r.body.data.status, 'COMPLETED'); });
  await t.test('terminal trip immutable', async () => { await expectStatus(await call('trips/' + trip.id, 'PATCH', { notes: 'change' }), 409); });
  await t.test('customer trip history', async () => { const r = await call('customers/' + customer.id + '/trips'); assert.ok(r.body.data.some(r => r.id === trip.id)); });
  await t.test('cancellation retains history', async () => { const r = await call('trips', 'POST', valid()); const cancelled = await call('trips/' + r.body.data.id, 'PATCH', { status: 'CANCELLED' }); assert.equal(cancelled.body.data.status, 'CANCELLED'); });
  for (const [name, patch] of [
    ['invalid status', { status: 'FAKE' }], ['non pending new trip', { status: 'ASSIGNED' }],
    ['zero passengers', { passengers: 0 }], ['fractional passengers', { passengers: 1.5 }], ['string passengers', { passengers: '2' }], ['too many passengers', { passengers: 101 }],
    ['negative price', { price: -1 }], ['string price', { price: '1' }], ['fractional price', { price: 0.1 }], ['too large price', { price: 1000000001 }],
    ['invalid calendar date', { trip_date: '2026-02-30' }], ['invalid month', { trip_date: '2026-99-02' }], ['invalid time', { trip_time: '24:00' }], ['blank route', { pickup: ' ' }], ['unknown column', { extra: 'bad' }]
  ]) await t.test(name, async () => { await expectStatus(await call('trips', 'POST', { ...valid(), ...patch }), 400); });
  await t.test('missing required fields', async () => { await expectStatus(await call('trips', 'POST', { passengers: 1 }), 400); });
  await t.test('missing customer', async () => { await expectStatus(await call('trips', 'POST', { ...valid(), customer_id: 'missing' }), 404); });
  await t.test('missing trip', async () => { await expectStatus(await call('trips/missing', 'PATCH', { status: 'CONFIRMED' }), 404); });
  await t.test('malformed JSON', async () => { await expectStatus(await call('trips', 'POST', '{bad'), 400); });
  await t.test('array JSON rejected', async () => { await expectStatus(await call('trips', 'POST', '[]'), 400); });
  await t.test('wrong content type rejected', async () => { await expectStatus(await call('trips', 'POST', valid(), { 'Content-Type': 'text/plain' }), 415); });
  await t.test('large body rejected', async () => { await expectStatus(await call('trips', 'POST', { ...valid(), notes: 'a'.repeat(17000) }), 413); });
  await t.test('invalid IDs rejected', async () => { await expectStatus(await call('trips/bad%27id', 'PATCH', { status: 'CONFIRMED' }), 400); });
  await t.test('punctuation-only WhatsApp rejected', async () => {
    for (const whatsapp of ['+', '---', '()']) await expectStatus(await call('customers', 'POST', { name: 'Invalid', whatsapp }), 400);
  });
  await t.test('blank optional WhatsApp accepted', async () => {
    const saved = await expectStatus(await call('customers', 'POST', { name: 'Blank contact ' + nonce, whatsapp: '  ' }), 201); assert.equal(saved.whatsapp, '');
  });
  await t.test('invalid WhatsApp rejected', async () => { await expectStatus(await call('customers', 'POST', { name: 'Invalid', whatsapp: 'letters' }), 400); });
  await t.test('SQL-safe input and literal search', async () => { const input = "Robert'); DROP TABLE customers; -- <img src=x onerror=alert(1)>"; const r = await call('customers', 'POST', { name: input }); await expectStatus(r, 201); assert.equal(r.body.data.name, input); await expectStatus(await call('customers'), 200); await expectStatus(await call('trips?q=' + encodeURIComponent("%' OR 1=1 --")), 200); });
  await t.test('cross origin writes rejected', async () => { await expectStatus(await call('customers', 'POST', { name: 'Bad' }, { Origin: 'https://evil.example' }), 403); });
  await t.test('missing CSRF header rejected', async () => { const response = await fetch(base + '/api/customers', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Bad' }) }); assert.equal(response.status, 403); });
  await t.test('invalid pagination and dates rejected', async () => { for (const q of ['limit=-1', 'offset=x', 'from=2026-99-99', 'status=bad', 'from=2026-10-10&to=2026-10-01']) await expectStatus(await call('trips?' + q), 400); });
  await t.test('security headers and no-store', async () => { const r = await call('trips'); assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff'); assert.equal(r.headers.get('X-Frame-Options'), 'DENY'); assert.equal(r.headers.get('Cache-Control'), 'no-store'); assert.ok(r.headers.get('Content-Security-Policy').includes("script-src 'self'")); });
  await t.test('dashboard summary', async () => { const r = await call('dashboard?date=2026-10-04'); await expectStatus(r, 200); assert.ok(Number(r.body.data.today) >= 2); });
  await t.test('unsupported delete rejected', async () => { await expectStatus(await call('customers/' + customer.id, 'DELETE'), 405); });
});
