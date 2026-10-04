import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/_worker.js';
import { randomBytes } from 'node:crypto';
const password = randomBytes(32).toString('hex');
const request = () => new Request('https://test.example/api/trips', { headers: { Authorization: 'Basic ' + Buffer.from('operator:' + password).toString('base64') } });
test('missing operator secret fails closed', async () => { const r = await worker.fetch(request(), {}); assert.equal(r.status, 503); });
test('short operator secret fails closed', async () => { const r = await worker.fetch(request(), { OPERATOR_PASSWORD: 'short' }); assert.equal(r.status, 503); });
test('database errors never leak details into responses or logs', async () => {
  const messages = []; const original = console.error; console.error = message => messages.push(message);
  try {
    const sensitive = 'SQL ERROR customer contact private note credential';
    const r = await worker.fetch(request(), { OPERATOR_PASSWORD: password, DB: { prepare() { throw new Error(sensitive); } } });
    assert.equal(r.status, 500); assert.equal((await r.json()).error, 'Operasi gagal. Coba lagi.');
    assert.deepEqual(messages, ['family-transport: operation failed']);
  } finally { console.error = original; }
});
test('atomic assignment guard becomes safe conflict without database details', async () => {
  const req = new Request('https://test.example/api/trips/test/assignment', {
    method: 'PATCH', headers: { Authorization: 'Basic ' + Buffer.from('operator:' + password).toString('base64'), 'Content-Type': 'application/json', 'X-Requested-With': 'tests' },
    body: JSON.stringify({ vehicle_id: 'v' })
  });
  const DB = { prepare(sql) { return { bind() { return this; },
    async first() { return sql.includes('FROM trips') ? { id: 'test', status: 'CONFIRMED', driver_id: 'd', vehicle_id: null, updated_at: '2026-10-04T00:00:00Z' } : { id: 'resource', active: 1 }; },
    async run() { throw new Error('D1 SQL private customer note: inactive_assignment'); }
  }; } };
  const response = await worker.fetch(req, { OPERATOR_PASSWORD: password, DB });
  assert.equal(response.status, 409); const body = await response.json();
  assert.equal(body.error, 'Driver / kendaraan tidak aktif. Muat ulang assignment.');
});
test('malformed Basic authentication fails safely', async () => {
  const r = await worker.fetch(new Request('https://test.example/', { headers: { Authorization: 'Basic not valid!' } }), { OPERATOR_PASSWORD: password });
  assert.equal(r.status, 401); assert.ok(r.headers.get('WWW-Authenticate'));
});
