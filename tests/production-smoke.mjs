// Only synthetic records created by this run are removed; existing data is untouched.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const base = process.env.PRODUCTION_URL || 'https://family-transport-manager.pages.dev';
const password = readFileSync('.env.production', 'utf8').match(/^OPERATOR_PASSWORD=(.+)$/m)[1];
const Authorization = 'Basic ' + Buffer.from('operator:' + password).toString('base64');
const created = []; let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('PASS: ' + name); };
async function call(path, method = 'GET', body) {
  const response = await fetch(base + '/api/' + path, { method, headers: { Authorization, 'Content-Type': 'application/json', 'X-Requested-With': 'smoke' }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json(); assert.ok(response.ok, 'Unexpected HTTP ' + response.status); return data.data;
}
async function create(table, data) { const record = await call(table, 'POST', data); assert.match(record.id, /^[a-f0-9-]{36}$/); created.push([table, record.id]); return record; }
try {
  await check('unauthenticated production pages and API protected', async () => { for (const path of ['/', '/app.js', '/api/trips']) assert.equal((await fetch(base + path)).status, 401); });
  await check('authenticated production frontend and assets load', async () => { for (const path of ['/', '/app.js', '/app.css']) { const r = await fetch(base + path, { headers: { Authorization } }); assert.equal(r.status, 200); assert.equal(r.headers.get('X-Frame-Options'), 'DENY'); } });
  await check('production rejects punctuation-only WhatsApp', async () => {
    const response = await fetch(base + '/api/customers', { method: 'POST', headers: { Authorization, 'Content-Type': 'application/json', 'X-Requested-With': 'smoke' }, body: JSON.stringify({ name: 'Synthetic invalid contact', whatsapp: '+' }) });
    assert.equal(response.status, 400);
  });
  let customer, driver, vehicle, trip;
  await check('create production customer', async () => { customer = await create('customers', { name: 'Synthetic smoke customer' }); });
  await check('create production driver', async () => { driver = await create('drivers', { name: 'Synthetic smoke driver', active: true }); });
  await check('create production vehicle', async () => { vehicle = await create('vehicles', { name: 'Synthetic smoke vehicle', active: true }); });
  await check('create production pending trip', async () => { trip = await create('trips', { customer_id: customer.id, trip_date: '2026-10-04', trip_time: '12:00', pickup: 'Synthetic pickup', destination: 'Synthetic destination', passengers: 2, price: 0 }); assert.equal(trip.status, 'PENDING'); });
  await check('confirm production trip', async () => { assert.equal((await call('trips/' + trip.id, 'PATCH', { status: 'CONFIRMED' })).status, 'CONFIRMED'); });
  await check('production saves partial driver assignment as confirmed', async () => {
    const saved = await call('trips/' + trip.id + '/assignment', 'PATCH', { driver_id: driver.id }); assert.equal(saved.status, 'CONFIRMED'); assert.equal(saved.vehicle_id, null);
  });
  await check('production rejects retained inactive driver and preserves trip', async () => {
    await call('drivers/' + driver.id, 'PATCH', { active: false });
    try {
      const response = await fetch(base + '/api/trips/' + trip.id + '/assignment', { method: 'PATCH', headers: { Authorization, 'Content-Type': 'application/json', 'X-Requested-With': 'smoke' }, body: JSON.stringify({ vehicle_id: vehicle.id }) });
      assert.equal(response.status, 409); const saved = await call('trips/' + trip.id); assert.equal(saved.status, 'CONFIRMED'); assert.equal(saved.vehicle_id, null);
    } finally { await call('drivers/' + driver.id, 'PATCH', { active: true }); }
  });
  await check('production rejects retained inactive vehicle', async () => {
    await call('trips/' + trip.id + '/assignment', 'PATCH', { driver_id: null, vehicle_id: vehicle.id });
    await call('vehicles/' + vehicle.id, 'PATCH', { active: false });
    try {
      const response = await fetch(base + '/api/trips/' + trip.id + '/assignment', { method: 'PATCH', headers: { Authorization, 'Content-Type': 'application/json', 'X-Requested-With': 'smoke' }, body: JSON.stringify({ driver_id: driver.id }) });
      assert.equal(response.status, 409); assert.equal((await call('trips/' + trip.id)).status, 'CONFIRMED');
    } finally { await call('vehicles/' + vehicle.id, 'PATCH', { active: true }); }
  });
  await check('assign production driver and vehicle', async () => { const r = await call('trips/' + trip.id + '/assignment', 'PATCH', { driver_id: driver.id, vehicle_id: vehicle.id }); assert.equal(r.status, 'ASSIGNED'); assert.equal(r.driver_name, driver.name); assert.equal(r.vehicle_name, vehicle.name); });
  await check('start production trip', async () => { assert.equal((await call('trips/' + trip.id, 'PATCH', { status: 'ON_TRIP' })).status, 'ON_TRIP'); });
  await check('complete production trip', async () => { assert.equal((await call('trips/' + trip.id, 'PATCH', { status: 'COMPLETED' })).status, 'COMPLETED'); });
  await check('production customer history retains trip', async () => { assert.ok((await call('customers/' + customer.id + '/trips')).some(r => r.id === trip.id)); });
  await check('production rejects malformed request', async () => { const r = await fetch(base + '/api/trips', { method: 'POST', headers: { Authorization, 'Content-Type': 'application/json', 'X-Requested-With': 'smoke' }, body: '{invalid' }); assert.equal(r.status, 400); });
} finally {
  if (created.length) {
    const order = { trips: 0, customers: 1, drivers: 2, vehicles: 3 };
    const sql = created.sort((a,b) => order[a[0]] - order[b[0]]).map(([table,id]) => `DELETE FROM ${table} WHERE id='${id}';`).join('\n');
    const result = spawnSync('npx', ['wrangler', 'd1', 'execute', 'family-transport-manager', '--remote', '--command', sql], { stdio: 'inherit' });
    assert.equal(result.status, 0, 'Synthetic production data cleanup failed');
    console.log('Only this run\'s synthetic records removed.');
  }
}
console.log('Production smoke: ' + passed + ' passed, 0 failed.');
