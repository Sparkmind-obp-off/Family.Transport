interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_NAME: string;
  OPERATOR_PASSWORD?: string;
}
type Row = Record<string, string | number | null>;
type Body = Record<string, unknown>;
const statuses = ['PENDING', 'CONFIRMED', 'ASSIGNED', 'ON_TRIP', 'COMPLETED', 'CANCELLED'];
const next: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['ON_TRIP', 'CANCELLED'], ON_TRIP: ['COMPLETED', 'CANCELLED'], COMPLETED: [], CANCELLED: []
};
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const fail = (message: string, status = 400): never => { throw new ApiError(status, message); };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8' }
});
const timestamp = () => new Date().toISOString();
function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== 'string') return fail(`${label} tidak valid.`);
  const result = value.trim();
  if ((required && !result) || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) fail(`${label} tidak valid.`);
  return result;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) fail('ID tidak valid.');
  return value as string;
}
function date(value: unknown): string {
  const s = text(value, 'Tanggal', 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s < '2000-01-01' || s > '2100-12-31' || !Number.isFinite(Date.parse(s + 'T00:00:00Z')) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s) fail('Tanggal tidak valid.');
  return s;
}
function time(value: unknown): string {
  const s = text(value, 'Jam', 5, true);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) fail('Jam tidak valid.');
  return s;
}
function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(`${label} tidak valid.`);
  return value as number;
}
function phone(value: unknown): string {
  const input = text(value, 'Nomor WhatsApp', 25);
  if (!input) return '';
  let s = input.replace(/[ +()-]/g, '');
  if (s.startsWith('0')) s = '62' + s.slice(1);
  if (!/^[1-9]\d{7,14}$/.test(s)) fail('Nomor WhatsApp tidak valid.');
  return s;
}
function keys(body: Body, allowed: string[]) {
  if (!Object.keys(body).length || Object.keys(body).some(k => !allowed.includes(k))) fail('Kolom data tidak valid.');
}
async function readBody(request: Request): Promise<Body> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) fail('Gunakan application/json.', 415);
  // Bound streamed payload too; Content-Length cannot be trusted.
  const reader = request.body?.getReader();
  if (!reader) fail('Data JSON tidak valid.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const part = await reader!.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 16384) { await reader!.cancel(); fail('Data terlalu besar.', 413); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail('Data JSON tidak valid.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('Data JSON tidak valid.');
  return parsed as Body;
}
const tables = {
  customers: ['name', 'whatsapp', 'notes'],
  drivers: ['name', 'whatsapp', 'notes', 'active'],
  vehicles: ['name', 'identifier', 'notes', 'active']
} as const;
type Table = keyof typeof tables;
const labels = { customers: 'Customer', drivers: 'Driver', vehicles: 'Kendaraan', trips: 'Trip' };
async function record(env: Env, table: Table | 'trips', id: string): Promise<Row> {
  // table is a server-owned allowlist, never a request string.
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<Row>();
  if (!row) fail(`${labels[table]} tidak ditemukan.`, 404);
  return row!;
}
function entityData(table: Table, body: Body, creating: boolean): Row {
  keys(body, [...tables[table]]);
  if (creating && !('name' in body)) fail('Nama belum diisi.');
  const data: Row = {};
  for (const key of tables[table]) {
    if (!(key in body)) { if (creating) data[key] = key === 'active' ? 1 : ''; continue; }
    if (key === 'active') {
      if (typeof body[key] !== 'boolean') fail('Status aktif tidak valid.');
      data[key] = body[key] ? 1 : 0;
    } else if (key === 'whatsapp') data[key] = phone(body[key]);
    else data[key] = text(body[key], key === 'name' ? 'Nama' : 'Catatan / identitas', key === 'notes' ? 2000 : 120, key === 'name');
  }
  return data;
}
const tripFields = ['customer_id', 'trip_date', 'trip_time', 'pickup', 'destination', 'passengers', 'price', 'partner_source', 'notes', 'status'];
function tripData(body: Body, creating: boolean): Row {
  keys(body, tripFields);
  if (creating && ['customer_id', 'trip_date', 'trip_time', 'pickup', 'destination'].some(k => !(k in body))) fail('Data trip belum lengkap.');
  const data: Row = {};
  if (creating) Object.assign(data, { passengers: 1, price: null, partner_source: '', notes: '', status: 'PENDING' });
  for (const [key, value] of Object.entries(body)) {
    if (key === 'customer_id') data[key] = identifier(value);
    else if (key === 'trip_date') data[key] = date(value);
    else if (key === 'trip_time') data[key] = time(value);
    else if (key === 'passengers') data[key] = integer(value, 'Jumlah penumpang', 1, 100);
    else if (key === 'price') data[key] = value === null ? null : integer(value, 'Harga', 0, 1000000000);
    else if (key === 'status') {
      if (typeof value !== 'string' || !statuses.includes(value)) fail('Status tidak valid.');
      if (creating && value !== 'PENDING') fail('Trip baru harus PENDING.');
      data[key] = value as string;
    } else data[key] = text(value, key, key === 'notes' ? 2000 : 300, key === 'pickup' || key === 'destination');
  }
  return data;
}
async function insert(env: Env, table: Table | 'trips', data: Row): Promise<string> {
  const id = crypto.randomUUID(); const now = timestamp();
  const all: Row = { id, ...data, created_at: now, updated_at: now };
  const fields = Object.keys(all);
  await env.DB.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`).bind(...Object.values(all)).run();
  return id;
}
async function update(env: Env, table: Table | 'trips', id: string, data: Row, old: Row) {
  const fields = Object.keys(data); const stamp = new Date(Math.max(Date.now(), Date.parse(String(old.updated_at)) + 1)).toISOString();
  try {
    const result = await env.DB.prepare(`UPDATE ${table} SET ${fields.map(k => `${k} = ?`).join(',')}, updated_at = ? WHERE id = ? AND updated_at = ?`)
      .bind(...Object.values(data), stamp, id, old.updated_at).run();
    if (!result.meta.changes) fail('Data telah berubah. Muat ulang lalu coba lagi.', 409);
  } catch (error) {
    // Classify only this known guard; never expose the original database message.
    if (error instanceof Error && error.message.includes('inactive_assignment')) fail('Driver / kendaraan tidak aktif. Muat ulang assignment.', 409);
    throw error;
  }
}
const tripSelect = `SELECT t.*, c.name AS customer_name, c.whatsapp AS customer_whatsapp,
  v.name AS vehicle_name, v.identifier AS vehicle_identifier, d.name AS driver_name, d.whatsapp AS driver_whatsapp
  FROM trips t JOIN customers c ON c.id=t.customer_id
  LEFT JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN drivers d ON d.id=t.driver_id`;
async function tripRecord(env: Env, id: string) {
  const row = await env.DB.prepare(tripSelect + ' WHERE t.id = ?').bind(id).first();
  if (!row) fail('Trip tidak ditemukan.', 404);
  return row;
}
function paging(url: URL): [number, number] {
  const number = (key: string, fallback: number, max: number) => {
    const value = url.searchParams.get(key);
    if (value === null) return fallback;
    if (!/^\d+$/.test(value)) fail('Paginasi tidak valid.');
    return integer(Number(value), 'Paginasi', key === 'limit' ? 1 : 0, max);
  };
  return [number('limit', 50, 100), number('offset', 0, 1000000)];
}
async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url); const method = request.method;
  const match = /^\/api\/(customers|drivers|vehicles|trips)(?:\/([^/]+))?(?:\/(assignment|trips))?$/.exec(url.pathname);
  if (url.pathname === '/api/dashboard' && method === 'GET') {
    const today = date(url.searchParams.get('date'));
    const result = await env.DB.prepare(`SELECT
      SUM(CASE WHEN trip_date=? THEN 1 ELSE 0 END) AS today,
      SUM(CASE WHEN trip_date>? AND status NOT IN ('COMPLETED','CANCELLED') THEN 1 ELSE 0 END) AS upcoming,
      SUM(CASE WHEN status IN ('PENDING','CONFIRMED') OR (trip_date<? AND status IN ('ASSIGNED','ON_TRIP')) THEN 1 ELSE 0 END) AS attention
      FROM trips`).bind(today, today, today).first();
    return json({ data: result });
  }
  if (!match) return json({ error: 'Endpoint tidak ditemukan.' }, 404);
  const table = match[1] as Table | 'trips'; const id = match[2] ? identifier(match[2]) : null; const action = match[3];
  if (action === 'trips' && table === 'customers' && id && method === 'GET') {
    await record(env, table, id); const [limit, offset] = paging(url);
    const result = await env.DB.prepare(tripSelect + ' WHERE t.customer_id=? ORDER BY t.trip_date DESC,t.trip_time DESC,t.id DESC LIMIT ? OFFSET ?').bind(id, limit + 1, offset).all();
    return json({ data: result.results.slice(0, limit), has_more: result.results.length > limit });
  }
  if (action && !(action === 'assignment' && table === 'trips' && id && method === 'PATCH')) return json({ error: 'Endpoint tidak ditemukan.' }, 404);
  if (method === 'GET' && !action) {
    if (id) return json({ data: table === 'trips' ? await tripRecord(env, id) : await record(env, table, id) });
    const [limit, offset] = paging(url); const clauses: string[] = []; const values: (string | number)[] = [];
    if (table === 'trips') {
      for (const key of ['from', 'to']) if (url.searchParams.has(key)) { clauses.push(`t.trip_date ${key === 'from' ? '>=' : '<='} ?`); values.push(date(url.searchParams.get(key))); }
      if (url.searchParams.has('from') && url.searchParams.has('to') && url.searchParams.get('from')! > url.searchParams.get('to')!) fail('Rentang tanggal tidak valid.');
      if (url.searchParams.has('status')) {
        const status = url.searchParams.get('status')!; if (!statuses.includes(status)) fail('Status tidak valid.');
        clauses.push('t.status=?'); values.push(status);
      }
      if (url.searchParams.has('attention')) {
        const today = date(url.searchParams.get('attention'));
        clauses.push("(t.status IN ('PENDING','CONFIRMED') OR (t.trip_date<? AND t.status IN ('ASSIGNED','ON_TRIP')))"); values.push(today);
      }
      if (url.searchParams.has('open')) {
        if (url.searchParams.get('open') !== '1') fail('Filter tidak valid.');
        clauses.push("t.status NOT IN ('COMPLETED','CANCELLED')");
      }
      if (url.searchParams.has('q')) {
        const q = text(url.searchParams.get('q'), 'Pencarian', 100, true).replace(/[\\%_]/g, '\\$&');
        clauses.push("(c.name LIKE ? ESCAPE '\\' OR t.pickup LIKE ? ESCAPE '\\' OR t.destination LIKE ? ESCAPE '\\')"); values.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
    }
    const sql = table === 'trips' ? tripSelect + (clauses.length ? ' WHERE ' + clauses.join(' AND ') : '') + ' ORDER BY t.trip_date,t.trip_time,t.id' : `SELECT * FROM ${table} ORDER BY name,id`;
    const result = await env.DB.prepare(sql + ' LIMIT ? OFFSET ?').bind(...values, limit + 1, offset).all();
    return json({ data: result.results.slice(0, limit), has_more: result.results.length > limit });
  }
  if (!['POST', 'PATCH'].includes(method) || (method === 'POST' && id) || (method === 'PATCH' && !id)) return json({ error: 'Metode tidak didukung.' }, 405);
  const body = await readBody(request);
  if (table !== 'trips') {
    const old = id ? await record(env, table, id) : null;
    const data = entityData(table, body, !id);
    if (id) await update(env, table, id, data, old!);
    const savedId = id || await insert(env, table, data);
    return json({ data: await record(env, table, savedId) }, id ? 200 : 201);
  }
  const old = id ? await record(env, 'trips', id) : null;
  if (action === 'assignment') {
    if (!['CONFIRMED', 'ASSIGNED'].includes(String(old!.status))) fail('Assignment hanya untuk trip CONFIRMED atau ASSIGNED.', 409);
    keys(body, ['driver_id', 'vehicle_id']); const data: Row = {};
    for (const key of ['driver_id', 'vehicle_id']) {
      if (!(key in body)) continue;
      data[key] = body[key] === null ? null : identifier(body[key]);
    }
    const merged = { ...old, ...data };
    // Validate retained resources too: either may have been deactivated after a partial assignment.
    for (const key of ['driver_id', 'vehicle_id']) {
      if (!merged[key]) continue;
      const related = await record(env, key === 'driver_id' ? 'drivers' : 'vehicles', String(merged[key]));
      if (!related.active) fail(`${key === 'driver_id' ? 'Driver' : 'Kendaraan'} tidak aktif.`, 409);
    }
    if (old!.status === 'ASSIGNED' && (!merged.driver_id || !merged.vehicle_id)) fail('Trip ASSIGNED wajib memiliki driver dan kendaraan.', 409);
    if (merged.driver_id && merged.vehicle_id) data.status = 'ASSIGNED';
    await update(env, 'trips', id!, data, old!);
    return json({ data: await tripRecord(env, id!) });
  }
  const data = tripData(body, !id);
  if (old && ['COMPLETED', 'CANCELLED'].includes(String(old.status))) fail('Trip selesai / dibatalkan tidak dapat diubah.', 409);
  if ('customer_id' in data) await record(env, 'customers', String(data.customer_id));
  if (old && data.status && data.status !== old.status) {
    if (!(next[String(old.status)] || []).includes(String(data.status))) fail('Perubahan status tidak diizinkan.', 409);
    if (['ASSIGNED', 'ON_TRIP'].includes(String(data.status))) {
      if (!old.driver_id || !old.vehicle_id) fail('Pilih driver dan kendaraan dahulu.', 409);
      for (const table of ['drivers', 'vehicles'] as const) {
        const related = await record(env, table, String(old[table === 'drivers' ? 'driver_id' : 'vehicle_id']));
        if (!related.active) fail('Driver / kendaraan tidak aktif.', 409);
      }
    }
  }
  if (id) await update(env, 'trips', id, data, old!);
  const savedId = id || await insert(env, 'trips', data);
  return json({ data: await tripRecord(env, savedId) }, id ? 200 : 201);
}
async function authenticated(request: Request, env: Env): Promise<boolean> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Basic ') || auth.length > 512) return false;
  let supplied: string;
  try { supplied = atob(auth.slice(6)); } catch { return false; }
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(supplied), digest('operator:' + env.OPERATOR_PASSWORD)]);
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function secure(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  headers.set('Cache-Control', 'no-store');
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  return new Response(response.body, { status: response.status, headers });
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (!env.OPERATOR_PASSWORD || env.OPERATOR_PASSWORD.length < 24) return secure(json({ error: 'Akses operator belum dikonfigurasi.' }, 503));
      if (!(await authenticated(request, env))) {
        const response = json({ error: 'Autentikasi operator diperlukan.' }, 401);
        response.headers.set('WWW-Authenticate', 'Basic realm="Family Transport Operator", charset="UTF-8"');
        return secure(response);
      }
      const url = new URL(request.url);
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
        const origin = request.headers.get('Origin');
        if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') fail('Permintaan lintas situs ditolak.', 403);
        if (url.pathname.startsWith('/api/') && !request.headers.has('X-Requested-With')) fail('Header permintaan wajib diisi.', 403);
      }
      const response = url.pathname.startsWith('/api/') ? await api(request, env) : await env.ASSETS.fetch(request);
      return secure(response);
    } catch (error) {
      if (error instanceof ApiError) return secure(json({ error: error.message }, error.status));
      // Never log database exceptions, request bodies, contacts, or notes.
      console.error('family-transport: operation failed');
      return secure(json({ error: 'Operasi gagal. Coba lagi.' }, 500));
    }
  }
};
