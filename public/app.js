'use strict';
const $ = id => document.getElementById(id);
const labels = { customers: 'Customer', drivers: 'Driver', vehicles: 'Kendaraan' };
const statusNames = { PENDING: 'Pending', CONFIRMED: 'Dikonfirmasi', ASSIGNED: 'Ditugaskan', ON_TRIP: 'Dalam perjalanan', COMPLETED: 'Selesai', CANCELLED: 'Dibatalkan' };
const nextStatus = { PENDING: 'CONFIRMED', ASSIGNED: 'ON_TRIP', ON_TRIP: 'COMPLETED' };
let view = 'dashboard', tripOffset = 0, entityOffset = 0;
const pageSize = 25;
const today = () => {
  const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
};
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
function node(tag, content, className) {
  const n = document.createElement(tag); if (content !== undefined) n.textContent = content; if (className) n.className = className; return n;
}
function button(title, action, className) {
  const b = node('button', title, className); b.type = 'button'; b.addEventListener('click', () => safely(action)); return b;
}
function notify(message, error = false) { $('message').textContent = message; $('message').className = error ? 'notice error' : 'notice'; }
async function safely(action) { try { await action(); } catch (error) { notify(error.message || 'Operasi gagal.', true); } }
async function api(path, method = 'GET', body) {
  const response = await fetch('/api/' + path, { method, headers: body ? { 'Content-Type': 'application/json', 'X-Requested-With': 'FamilyTransport' } : {}, body: body ? JSON.stringify(body) : undefined });
  let result; try { result = await response.json(); } catch { throw new Error('Respons tidak valid. Muat ulang halaman.'); }
  if (!response.ok) throw new Error(result.error || 'Operasi gagal.');
  return result;
}
function wa(phone, title, message = '') {
  if (!phone) return null;
  let number = String(phone).replace(/[ +()-]/g, ''); if (number.startsWith('0')) number = '62' + number.slice(1);
  if (!/^[1-9]\d{7,14}$/.test(number)) return null;
  const link = node('a', title, 'wa'); link.href = 'https://wa.me/' + number + (message ? '?text=' + encodeURIComponent(message) : '');
  link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
}
function tripCard(trip) {
  const card = node('article', undefined, 'trip'); const body = node('div');
  const head = node('div', undefined, 'section-head'); head.append(node('strong', trip.trip_date + ' · ' + trip.trip_time), node('span', statusNames[trip.status] || trip.status, 'badge ' + trip.status));
  body.append(head, node('h3', trip.pickup + ' → ' + trip.destination), node('p', trip.customer_name + ' · ' + trip.passengers + ' penumpang'), node('p', (trip.driver_name || 'Driver belum dipilih') + ' · ' + (trip.vehicle_name || 'Kendaraan belum dipilih'), 'muted'));
  const actions = node('div', undefined, 'toolbar'); actions.append(button('Buka trip', () => detail(trip.id)));
  const customer = wa(trip.customer_whatsapp, 'Chat customer'); if (customer) actions.append(customer);
  const driver = wa(trip.driver_whatsapp, 'Chat driver'); if (driver) actions.append(driver);
  card.append(body, actions); return card;
}
function renderTrips(container, trips) {
  container.replaceChildren(); if (!trips.length) container.append(node('p', 'Belum ada perjalanan.', 'muted'));
  for (const trip of trips) container.append(tripCard(trip));
}
function pagination(container, offset, more, change) {
  container.replaceChildren();
  if (offset) container.append(button('Sebelumnya', () => change(Math.max(0, offset - pageSize))));
  if (more) container.append(button('Berikutnya', () => change(offset + pageSize)));
}
async function dashboard() {
  const date = today(); $('current-date').textContent = new Intl.DateTimeFormat('id-ID', { dateStyle: 'full' }).format(new Date());
  const [summary, daily, attention, upcoming] = await Promise.all([
    api('dashboard?date=' + date), api('trips?from=' + date + '&to=' + date + '&limit=20'),
    api('trips?attention=' + date + '&limit=20'), api('trips?from=' + tomorrow() + '&open=1&limit=20')
  ]);
  for (const key of ['today', 'upcoming', 'attention']) $(key + '-count').textContent = summary.data[key] || 0;
  for (const [key, result] of [['today', daily], ['attention', attention], ['upcoming', upcoming]]) {
    const box = $(key + '-trips'); renderTrips(box, result.data);
    if (result.has_more) box.append(button('Lihat daftar lengkap', () => {
      $('filters').reset(); if (key === 'today') { $('filters').elements.from.value = date; $('filters').elements.to.value = date; }
      if (key === 'upcoming') $('filters').elements.from.value = tomorrow();
      return navigate('trips');
    }));
  }
}
async function trips() {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData($('filters'))) if (value) params.set(key, value);
  params.set('limit', pageSize); params.set('offset', tripOffset);
  const result = await api('trips?' + params); renderTrips($('trip-list'), result.data);
  pagination($('trip-pagination'), tripOffset, result.has_more, offset => { tripOffset = offset; return trips(); });
}
async function entities() {
  const kind = view; $('entities-title').textContent = labels[kind];
  const result = await api(kind + '?limit=' + pageSize + '&offset=' + entityOffset);
  const box = $('entity-list'); box.replaceChildren();
  if (!result.data.length) box.append(node('p', 'Belum ada ' + labels[kind].toLowerCase() + '.', 'muted'));
  for (const item of result.data) {
    const row = node('article', undefined, 'trip'); const body = node('div');
    body.append(node('h3', item.name), node('p', kind === 'vehicles' ? item.identifier || 'Identitas belum diisi' : item.whatsapp || 'WhatsApp belum diisi', 'muted'));
    if (kind !== 'customers') body.append(node('span', item.active ? 'Aktif' : 'Tidak aktif', 'badge'));
    if (item.notes) body.append(node('p', item.notes, 'notes'));
    const actions = node('div', undefined, 'toolbar'); actions.append(button('Edit', () => editEntity(kind, item)));
    if (kind === 'customers') actions.append(button('Riwayat trip', () => history(item)));
    const chat = wa(item.whatsapp, 'WhatsApp'); if (chat) actions.append(chat);
    row.append(body, actions); box.append(row);
  }
  pagination($('entity-pagination'), entityOffset, result.has_more, offset => { entityOffset = offset; return entities(); });
}
async function navigate(target) {
  view = target; tripOffset = 0; entityOffset = 0;
  for (const b of $('main-nav').querySelectorAll('button')) { if (b.dataset.view === target) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  $('dashboard-view').hidden = target !== 'dashboard'; $('trips-view').hidden = target !== 'trips'; $('entities-view').hidden = !labels[target];
  await reload();
}
async function reload() {
  $('refresh').disabled = true;
  try { if (view === 'dashboard') await dashboard(); else if (view === 'trips') await trips(); else await entities(); }
  finally { $('refresh').disabled = false; }
}
function openEditor(title) {
  $('editor-title').textContent = title; $('editor-content').replaceChildren(); if (!$('editor').open) $('editor').showModal(); return $('editor-content');
}
function field(form, name, label, options = {}) {
  const wrap = node('label', label); const input = document.createElement(options.options ? 'select' : options.area ? 'textarea' : 'input');
  input.name = name;
  if (options.options) for (const [value, title] of options.options) { const o = node('option', title); o.value = value; input.append(o); }
  else { if (!options.area) input.type = options.type || 'text'; input.maxLength = options.max || 300; }
  if (options.required) input.required = true;
  if (options.min !== undefined) input.min = options.min;
  if (options.maxNumber !== undefined) input.max = options.maxNumber;
  input.value = options.value ?? ''; wrap.append(input); form.append(wrap); return input;
}
function formSubmit(form, action) {
  const error = node('p', '', 'form-error'); error.setAttribute('role', 'alert');
  const save = node('button', 'Simpan', 'primary'); save.type = 'submit'; form.append(error, save);
  form.addEventListener('submit', async event => {
    event.preventDefault(); error.textContent = ''; save.disabled = true;
    try { await action(Object.fromEntries(new FormData(form))); }
    catch (e) { error.textContent = e.message || 'Gagal menyimpan.'; }
    finally { save.disabled = false; }
  });
}
async function allEntities(kind) {
  const rows = []; let offset = 0;
  while (true) { const result = await api(kind + '?limit=100&offset=' + offset); rows.push(...result.data); if (!result.has_more) break; offset += 100; }
  return rows;
}
async function editTrip(trip = null) {
  const customers = await allEntities('customers'); const box = openEditor(trip ? 'Edit trip' : 'Trip baru');
  const form = node('form', undefined, 'grid'); const customer = field(form, 'customer_id', 'Customer', { options: [['', 'Customer baru'], ...customers.map(c => [c.id, c.name])], value: trip?.customer_id || '' });
  const name = field(form, 'customerName', 'Nama customer baru', { max: 120 }); const whatsapp = field(form, 'customerWhatsapp', 'WhatsApp customer baru', { type: 'tel', max: 25 });
  const toggle = () => { name.parentElement.hidden = !!customer.value; whatsapp.parentElement.hidden = !!customer.value; name.required = !customer.value; };
  customer.addEventListener('change', toggle); toggle();
  field(form, 'trip_date', 'Tanggal', { type: 'date', required: true, value: trip?.trip_date || today() });
  field(form, 'trip_time', 'Jam', { type: 'time', required: true, value: trip?.trip_time || '08:00' });
  field(form, 'pickup', 'Pickup', { required: true, value: trip?.pickup }); field(form, 'destination', 'Tujuan', { required: true, value: trip?.destination });
  field(form, 'passengers', 'Penumpang', { type: 'number', min: 1, maxNumber: 100, required: true, value: trip?.passengers || 1 });
  field(form, 'price', 'Harga (Rp, opsional)', { type: 'number', min: 0, maxNumber: 1000000000, value: trip?.price });
  field(form, 'partner_source', 'Partner / sumber (opsional)', { value: trip?.partner_source }); field(form, 'notes', 'Catatan', { area: true, max: 2000, value: trip?.notes });
  formSubmit(form, async data => {
    if (!data.customer_id) {
      // Customer persists as a useful master record even if subsequent trip save fails.
      const created = await api('customers', 'POST', { name: data.customerName, whatsapp: data.customerWhatsapp });
      const option = node('option', created.data.name); option.value = created.data.id; customer.append(option); customer.value = created.data.id; toggle(); data.customer_id = created.data.id;
    }
    delete data.customerName; delete data.customerWhatsapp; data.passengers = Number(data.passengers); data.price = data.price === '' ? null : Number(data.price);
    const result = await api(trip ? 'trips/' + trip.id : 'trips', trip ? 'PATCH' : 'POST', data);
    notify('Trip tersimpan.'); await reload(); await detail(result.data.id);
  }); box.append(form);
}
async function detail(id) {
  const trip = (await api('trips/' + id)).data; const box = openEditor('Detail perjalanan');
  box.append(tripCard(trip));
  const info = node('dl');
  for (const [title, value] of [['Harga', trip.price === null ? 'Belum diisi' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(trip.price)], ['Partner / sumber', trip.partner_source || '—'], ['Identitas kendaraan', trip.vehicle_identifier || '—'], ['Catatan', trip.notes || '—']]) info.append(node('dt', title), node('dd', value, 'notes'));
  box.append(info);
  const actions = node('div', undefined, 'toolbar'); const terminal = ['COMPLETED', 'CANCELLED'].includes(trip.status);
  if (!terminal) actions.append(button('Edit trip', () => editTrip(trip)));
  const change = async status => {
    if (status === 'CANCELLED' && !confirm('Batalkan trip ini? Riwayat tetap disimpan.')) return;
    await api('trips/' + id, 'PATCH', { status }); notify('Status diperbarui.'); await reload(); await detail(id);
  };
  if (nextStatus[trip.status]) actions.append(button('→ ' + statusNames[nextStatus[trip.status]], () => change(nextStatus[trip.status]), 'primary'));
  if (!terminal) actions.append(button('Batalkan trip', () => change('CANCELLED'), 'danger'));
  box.append(actions);
  const message = 'Halo ' + trip.customer_name + ', detail perjalanan Family Transport: ' + trip.trip_date + ' pukul ' + trip.trip_time + ', ' + trip.pickup + ' → ' + trip.destination + '. ' + trip.passengers + ' penumpang. Driver: ' + (trip.driver_name || 'menyusul') + '. Kendaraan: ' + (trip.vehicle_name || 'menyusul') + '.';
  const links = node('div', undefined, 'toolbar');
  for (const a of [wa(trip.customer_whatsapp, 'Konfirmasi via WhatsApp', 'Halo ' + trip.customer_name + ', mohon konfirmasi perjalanan ' + trip.trip_date + ' pukul ' + trip.trip_time + ': ' + trip.pickup + ' → ' + trip.destination + '.'), wa(trip.customer_whatsapp, 'Kirim detail trip', message), wa(trip.driver_whatsapp, 'Detail untuk driver', message)]) if (a) links.append(a);
  box.append(links);
  if (['CONFIRMED', 'ASSIGNED'].includes(trip.status)) {
    const [drivers, vehicles] = await Promise.all([allEntities('drivers'), allEntities('vehicles')]);
    const form = node('form', undefined, 'assignment grid'); form.append(node('h3', 'Assignment'));
    const options = (rows, current, label) => [['', 'Pilih ' + label], ...rows.filter(r => r.active || r.id === current).map(r => [r.id, r.name + (r.active ? '' : ' (tidak aktif)')])];
    field(form, 'driver_id', 'Driver', { options: options(drivers, trip.driver_id, 'driver'), value: trip.driver_id });
    field(form, 'vehicle_id', 'Kendaraan', { options: options(vehicles, trip.vehicle_id, 'kendaraan'), value: trip.vehicle_id });
    formSubmit(form, async data => {
      await api('trips/' + id + '/assignment', 'PATCH', { driver_id: data.driver_id || null, vehicle_id: data.vehicle_id || null });
      notify('Assignment tersimpan. Driver dan kendaraan lengkap otomatis menjadi ASSIGNED.'); await reload(); await detail(id);
    }); box.append(form);
  }
}
function editEntity(kind, item = null) {
  const box = openEditor((item ? 'Edit ' : 'Tambah ') + labels[kind]); const form = node('form', undefined, 'grid');
  field(form, 'name', 'Nama', { required: true, max: 120, value: item?.name });
  if (kind !== 'vehicles') field(form, 'whatsapp', 'WhatsApp', { type: 'tel', max: 25, value: item?.whatsapp });
  else field(form, 'identifier', 'Identitas / nomor polisi', { max: 120, value: item?.identifier });
  field(form, 'notes', 'Catatan', { area: true, max: 2000, value: item?.notes });
  if (kind !== 'customers') field(form, 'active', 'Status', { options: [['1', 'Aktif'], ['0', 'Tidak aktif']], value: item ? String(item.active) : '1' });
  formSubmit(form, async data => {
    if (kind !== 'customers') data.active = data.active === '1';
    await api(kind + (item ? '/' + item.id : ''), item ? 'PATCH' : 'POST', data);
    $('editor').close(); notify(labels[kind] + ' tersimpan.'); await reload();
  }); box.append(form);
}
async function history(customer, offset = 0) {
  const result = await api('customers/' + customer.id + '/trips?limit=' + pageSize + '&offset=' + offset);
  const box = openEditor('Riwayat: ' + customer.name); renderTrips(box, result.data);
  const pages = node('div', undefined, 'toolbar'); pagination(pages, offset, result.has_more, next => history(customer, next)); box.append(pages);
}
$('main-nav').addEventListener('click', event => { const target = event.target.closest('button[data-view]'); if (target) safely(() => navigate(target.dataset.view)); });
$('refresh').addEventListener('click', () => safely(reload));
$('new-trip').addEventListener('click', () => safely(() => editTrip()));
$('new-entity').addEventListener('click', () => editEntity(view));
$('close-editor').addEventListener('click', () => $('editor').close());
$('filters').elements.from.value = today();
$('filters').addEventListener('submit', event => { event.preventDefault(); tripOffset = 0; safely(trips); });
$('reset-filters').addEventListener('click', () => { $('filters').reset(); tripOffset = 0; safely(trips); });
safely(reload);
