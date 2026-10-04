interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_NAME: string;
}

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) }
  });

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/trips") {
    const result = await env.DB.prepare(`
      SELECT
        t.*,
        c.name AS customer_name,
        c.whatsapp AS customer_whatsapp,
        v.name AS vehicle_name,
        d.name AS driver_name,
        d.whatsapp AS driver_whatsapp
      FROM trips t
      JOIN customers c ON c.id = t.customer_id
      LEFT JOIN vehicles v ON v.id = t.vehicle_id
      LEFT JOIN drivers d ON d.id = t.driver_id
      ORDER BY t.trip_date ASC, t.trip_time ASC
      LIMIT 100
    `).all();
    return json(result.results);
  }

  if (request.method === "POST" && url.pathname === "/api/trips") {
    const body = await request.json() as Record<string, unknown>;
    const tripId = id();
    const customerId = id();
    const timestamp = now();

    const customerName = String(body.customerName || "").trim();
    if (!customerName || !body.tripDate || !body.tripTime || !body.pickup || !body.destination) {
      return json({ error: "Customer, date, time, pickup and destination are required." }, { status: 400 });
    }

    await env.DB.prepare(`
      INSERT INTO customers (id, name, whatsapp, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      customerId,
      customerName,
      String(body.customerWhatsapp || ""),
      "",
      timestamp,
      timestamp
    ).run();

    await env.DB.prepare(`
      INSERT INTO trips
      (id, customer_id, trip_date, trip_time, pickup, destination, passengers, price, notes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
    `).bind(
      tripId,
      customerId,
      String(body.tripDate),
      String(body.tripTime),
      String(body.pickup),
      String(body.destination),
      Number(body.passengers || 1),
      body.price ? Number(body.price) : null,
      String(body.notes || ""),
      timestamp,
      timestamp
    ).run();

    return json({ id: tripId }, { status: 201 });
  }

  if (request.method === "PATCH" && url.pathname.startsWith("/api/trips/")) {
    const tripId = url.pathname.split("/").pop();
    const body = await request.json() as Record<string, unknown>;
    const allowed = ["PENDING", "CONFIRMED", "ASSIGNED", "ON_TRIP", "COMPLETED", "CANCELLED"];
    const status = String(body.status || "");
    if (!tripId || !allowed.includes(status)) {
      return json({ error: "Invalid trip or status." }, { status: 400 });
    }
    await env.DB.prepare("UPDATE trips SET status = ?, updated_at = ? WHERE id = ?")
      .bind(status, now(), tripId).run();
    return json({ ok: true });
  }

  return json({ error: "Not found" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request, env);
    return env.ASSETS.fetch(request);
  }
};
