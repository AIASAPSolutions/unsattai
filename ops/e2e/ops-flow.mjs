// End-to-end run of UrJersey Ops against a local API.
//
//   API_URL=http://127.0.0.1:8200 OPS_URL=http://127.0.0.1:5200 \
//   ADMIN_EMAIL=admin@urjersey.test ADMIN_PASSWORD='Adm1nPassword!' \
//   NODE_PATH=$(npm root -g) node e2e/ops-flow.mjs
//
// Needs Playwright (global install is fine) and a running API + ops build (see e2e/run.sh,
// which starts both on their own ports and database and stops them afterwards).
// Seeds data through the public API first, then drives the browser as staff would.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const API = (process.env.API_URL ?? 'http://127.0.0.1:8200').replace(/\/$/, '');
const OPS = (process.env.OPS_URL ?? 'http://127.0.0.1:5200').replace(/\/$/, '');
const ADMIN = { email: process.env.ADMIN_EMAIL ?? 'admin@urjersey.test', password: process.env.ADMIN_PASSWORD ?? 'Adm1nPassword!' };
const OUT = new URL('./shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const RUN = Date.now().toString(36);

// ------------------------------------------------------------------ helpers

let failures = 0;
const results = [];
async function step(name, fn) {
  const t = Date.now();
  process.stdout.write(`• ${name} … `);
  try {
    await fn();
    const ms = Date.now() - t;
    console.log(`ok (${ms} ms)`);
    results.push({ name, ok: true });
  } catch (e) {
    failures++;
    console.log('FAILED');
    console.log(`  ${String(e?.stack ?? e).split('\n').slice(0, 6).join('\n  ')}`);
    results.push({ name, ok: false, error: String(e?.message ?? e) });
    try { await page?.screenshot({ path: `${OUT}FAIL-${name.replace(/\W+/g, '-')}.png`, fullPage: true }); } catch { /* ignore */ }
    throw e;
  }
}
function assert(cond, msg) { if (!cond) throw new Error(`assertion failed: ${msg}`); }

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}/api/v1${path}`, {
    method: body !== undefined ? (method === 'GET' ? 'POST' : method) : method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(process.env.API_KEY ? { 'X-API-Key': process.env.API_KEY } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

let page;
let browser;
const shot = (name) => page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
const tid = (id) => page.getByTestId(id);
async function toast(kind = 'success') {
  const t = page.getByTestId(`toast-${kind}`).last();
  await t.waitFor({ timeout: 15000 });
  return t.innerText();
}
async function login(email, password) {
  await page.goto(`${OPS}/login`);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await tid('login-submit').click();
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
}
async function staffToken(email, password) {
  return (await api('/ops/auth/login', { body: { email, password } })).token;
}

// ------------------------------------------------------------------ seed

const seed = {};
const phoneA = `98${String(Date.now()).slice(-8)}`;
const phoneB = `97${String(Date.now() + 1).slice(-8)}`;
const phoneLead = `96${String(Date.now() + 2).slice(-8)}`;
const address = (name, phone) => ({ name, phone, line1: '12 Gandhi Road', line2: 'Near bus stand', city: 'Chennai', state: 'TN', pincode: '600001' });

try {
  await step('seed: design, 2 orders (1 paid), enquiry, customer ticket', async () => {
    const gen = await api('/designs/generate', { body: { prompt: 'navy and gold cricket jersey with bold stripes', team_name: 'STRIKERS', variants: 2 } });
    const d = gen.designs[0];
    seed.spec = d.spec;
    seed.designId = d.id;
    const order = (key, name, phone, items) => api('/orders', { body: {
      design_id: d.id, spec: d.spec, items, customer: { name, phone }, idempotency_key: `e2e_${RUN}_${key}`, channel: 'web',
      delivery: { method: 'ship', address: address(name, phone) },
    } });
    seed.paid = await order('paid', `Arul Kumar ${RUN}`, phoneA, [{ player_name: 'ARUL', number: '7', size: 'M', quantity: 10 }, { size: 'L', quantity: 5 }]);
    seed.unpaid = await order('unpaid', `Priya Raman ${RUN}`, phoneB, [{ player_name: 'PRIYA', number: '9', size: 'S', quantity: 6 }]);
    await api(`/orders/${seed.paid.id}/payment-confirmed`, { body: { demo: true } });
    seed.leadTitle = `Kovai Kings ${RUN}: 40 pieces`;
    await api('/shop/enquiries', { body: { name: 'Karthik', phone: phoneLead, organisation: `Kovai Kings ${RUN}`, pieces: 40, message: 'Need 40 football jerseys for the district league.', spec: d.spec } });
    const otp = await api('/auth/otp/request', { body: { phone: phoneB } });
    assert(otp.dev_code, 'OTP dev code returned (OTP_DEV_ECHO on)');
    const ver = await api('/auth/otp/verify', { body: { phone: phoneB, code: otp.dev_code, name: `Priya Raman ${RUN}` } });
    seed.ticketSubject = `Size exchange ${RUN}`;
    seed.ticket = await api('/me/tickets', { token: ver.token, body: { subject: seed.ticketSubject, body: 'Can I change two S jerseys to M?', category: 'sizing', order_id: seed.unpaid.id } });
    seed.admin = await staffToken(ADMIN.email, ADMIN.password);
    const dash = await api('/ops/dashboard', { token: seed.admin });
    seed.ordersToday = dash.orders.today;
    console.log(`\n  paid ${seed.paid.number} (${seed.paid.id}), unpaid ${seed.unpaid.number}, ticket ${seed.ticket.number}, orders today ${seed.ordersToday}`);
  });

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
  page.on('dialog', (d) => d.accept());

  await step('login as admin; dashboard shows the numbers', async () => {
    await page.goto(`${OPS}/dashboard`);
    await page.waitForURL(/\/login/);
    await shot('01-login');
    await login(ADMIN.email, ADMIN.password);
    await tid('kpi-orders-today').waitFor();
    const today = Number((await tid('kpi-orders-today').innerText()).replace(/\D/g, ''));
    assert(today === seed.ordersToday, `orders today ${today} == ${seed.ordersToday}`);
    const active = Number((await tid('kpi-active').innerText()).replace(/\D/g, ''));
    assert(active >= 1, 'at least one order in production');
    const leads = Number((await tid('kpi-leads').innerText()).replace(/\D/g, ''));
    assert(leads >= 1, 'open lead from the enquiry');
    await tid('utilisation').waitFor();
    await tid('demo-payments').waitFor();
    assert(await tid('demo-payments').getAttribute('data-on') === 'true', 'the throw-away API has demo payments on, and the dashboard says so');
    await shot('02-dashboard');
  });

  await step('orders list, filter, open the paid order', async () => {
    await page.click('nav a[href="/orders"]');
    await tid('orders-table').getByText(seed.paid.number).waitFor();
    await tid('orders-table').getByText(seed.unpaid.number).waitFor();
    await page.click('[data-chip="awaiting_payment"]');
    await page.waitForURL(/status=awaiting_payment/);
    await tid('orders-table').getByText(seed.paid.number).waitFor({ state: 'detached' });
    await tid('orders-table').getByText(seed.unpaid.number).waitFor();
    await page.click('[data-chip="awaiting_payment"]');
    await tid('orders-search').fill(seed.paid.number);
    await tid('orders-table').getByText(seed.unpaid.number).waitFor({ state: 'detached' });
    await shot('03-orders');
    await tid('orders-table').getByRole('link', { name: seed.paid.number }).click();
    await tid('order-stages').waitFor();
    await tid('design-preview').locator('img').waitFor();
    await tid('order-pricing-total').waitFor();
    assert((await tid('timeline').innerText()).includes('Payment received'), 'timeline shows payment');
    await shot('04-order-detail');
  });

  await step('add an internal note and change priority on the order', async () => {
    await tid('add-note').click();
    await tid('note-text').fill('Customer asked for extra care with the gold print.');
    await tid('note-submit').click();
    await toast();
    await page.getByText('Customer asked for extra care').waitFor();
    assert(await tid('timeline').locator('li.internal', { hasText: 'extra care' }).count() === 1, 'note marked internal');
    await tid('priority').click();
    await tid('priority-rush').check();
    await tid('priority-submit').click();
    await toast();
    await tid('timeline').getByText('Priority changed (express: yes)').waitFor();
    const o = await api(`/ops/orders/${seed.paid.id}`, { token: seed.admin });
    assert(o.order.fulfilment.rush === true, 'order is now express');
  });

  await step('mark every production stage done from the board', async () => {
    await page.goto(`${OPS}/production/board`);
    await tid('board').waitFor();
    for (let i = 0; i < 7; i++) {
      const card = page.locator(`.kcard[data-order="${seed.paid.number}"]`);
      await card.waitFor();
      const col = await card.evaluate((el) => el.closest('[data-column]').getAttribute('data-column'));
      if (col === 'ready') break;
      await card.getByTestId('stage-done').click();
      await toast();
      await page.locator(`[data-column="${col}"] .kcard[data-order="${seed.paid.number}"]`).waitFor({ state: 'detached' });
      if (i === 2) await shot('05-board');
    }
    await page.locator(`[data-column="ready"] .kcard[data-order="${seed.paid.number}"]`).waitFor();
    const o = await api(`/ops/orders/${seed.paid.id}`, { token: seed.admin });
    assert(o.order.fulfilment.status === 'ready', `order is ready (${o.order.fulfilment.status})`);
  });

  await step('production plan, capacity and worklist render', async () => {
    await page.click('.tabs a[href="/production/plan"]');
    await page.waitForSelector('[data-testid="gantt"], .empty');
    await shot('06-plan');
    await page.click('.tabs a[href="/production/capacity"]');
    await tid('heatmap').waitFor();
    await shot('07-capacity');
    await page.click('.tabs a[href="/production/worklist"]');
    await tid('worklist-stage').waitFor();
    await shot('08-worklist');
  });

  await step('create shipment, dispatch, deliver', async () => {
    await page.goto(`${OPS}/delivery/ready`);
    const row = tid('ready-table').locator('tr', { hasText: seed.paid.number });
    await row.getByTestId('create-shipment').click();
    await tid('shipment-dialog').waitFor();
    await tid('shipment-tracking').fill(`TRK${RUN}`);
    await tid('shipment-submit').click();
    await toast();
    await page.goto(`${OPS}/delivery/shipments`);
    const srow = () => tid('shipments-table').locator('tr', { hasText: seed.paid.number });
    await srow().waitFor();
    for (const next of ['packed', 'dispatched', 'delivered']) {
      await srow().getByTestId(`ship-${next}`).click();
      await toast();
      await srow().getByText(next === 'packed' ? 'Packed' : next === 'dispatched' ? 'Dispatched' : 'Delivered', { exact: true }).waitFor();
    }
    await shot('09-shipments');
    const o = await api(`/ops/orders/${seed.paid.id}`, { token: seed.admin });
    assert(o.order.fulfilment.status === 'delivered', `order delivered (${o.order.fulfilment.status})`);
    await page.goto(`${OPS}/delivery/plan`);
    await page.waitForSelector('.card');
    await shot('10-dispatch-plan');
  });

  await step('record a UPI payment for the unpaid order', async () => {
    await page.goto(`${OPS}/orders/${seed.unpaid.id}`);
    await tid('record-payment').click();
    await tid('payment-method').selectOption('upi');
    await tid('payment-reference').fill(`UPI-${RUN}`);
    await tid('payment-submit').click();
    await toast();
    await tid('payment-info').getByText(`UPI-${RUN}`).waitFor();
    await shot('11-order-paid-upi');
    const o = await api(`/ops/orders/${seed.unpaid.id}`, { token: seed.admin });
    assert(o.order.payment.method === 'upi' && o.order.fulfilment.status === 'queued', 'UPI payment recorded and order queued');
  });

  await step('price book: change a price, Try it shows draft vs current, save bumps the version', async () => {
    await page.goto(`${OPS}/settings/price-book`);
    await tid('price-jersey').waitFor();
    const v0 = Number((await tid('settings-version').innerText()).replace(/\D/g, ''));
    await tid('try-current').waitFor();
    const before = await tid('try-current').innerText();
    assert(before === await tid('try-draft').innerText(), 'draft equals current before editing');
    const old = Number(await tid('price-jersey').inputValue());
    await tid('price-jersey').fill(String(old + 50));
    await page.waitForFunction(() => {
      const a = document.querySelector('[data-testid="try-current"]')?.textContent;
      const b = document.querySelector('[data-testid="try-draft"]')?.textContent;
      return a && b && a !== b;
    }, null, { timeout: 15000 });
    assert((await tid('try-delta').innerText()).includes('+'), 'draft is dearer');
    await shot('12-price-book-try-it');
    await tid('settings-save').click();
    await toast();
    await page.waitForFunction((v) => document.querySelector('[data-testid="settings-version"]')?.textContent?.includes(`version ${v + 1}`), v0);
    const pb = await api('/ops/settings/price_book', { token: seed.admin });
    assert(pb.value.garments.jersey.base === old + 50 && pb.version === v0 + 1, `saved ${pb.value.garments.jersey.base} v${pb.version}`);
    await tid('settings-history').click();
    await tid('history-drawer').getByText(`v${v0 + 1} (current)`).waitFor();
    await shot('13-price-book-history');
    await page.keyboard.press('Escape');
  });

  await step('stale version is refused with a reload offer (409)', async () => {
    await tid('price-jersey').fill(String(Number(await tid('price-jersey').inputValue()) + 1));
    const cur = await api('/ops/settings/price_book', { token: seed.admin });
    await api('/ops/settings/price_book', { method: 'PUT', token: seed.admin, body: { value: cur.value, version: cur.version } });
    await tid('settings-save').click();
    await tid('conflict-reload').waitFor();
    await shot('14-price-book-conflict');
    await tid('conflict-reload').click();
    await tid('conflict-reload').waitFor({ state: 'detached' });
  });

  await step('production settings: add a holiday', async () => {
    await page.goto(`${OPS}/settings/production`);
    await tid('holidays').waitFor();
    const v0 = Number((await tid('settings-version').innerText()).replace(/\D/g, ''));
    const d = new Date(Date.now() + (30 + Math.floor(Math.random() * 300)) * 86400000).toISOString().slice(0, 10);
    await tid('holiday-date').fill(d);
    await tid('holiday-add').click();
    await tid('settings-save').click();
    await toast();
    await page.waitForFunction((v) => document.querySelector('[data-testid="settings-version"]')?.textContent?.includes(`version ${v + 1}`), v0);
    const p = await api('/ops/settings/production', { token: seed.admin });
    assert(p.value.holidays.includes(d), `holiday ${d} saved`);
    await shot('15-production-settings');
  });

  await step('CRM: enquiry lead → contacted, add a task', async () => {
    await page.goto(`${OPS}/crm/leads`);
    const card = page.locator(`.kcard[data-lead="${seed.leadTitle}"]`);
    await card.waitFor();
    await card.getByTestId('lead-move').selectOption('contacted');
    await toast();
    await page.locator(`[data-column="contacted"] .kcard[data-lead="${seed.leadTitle}"]`).waitFor();
    await shot('16-pipeline');
    await page.locator(`[data-column="contacted"] .kcard[data-lead="${seed.leadTitle}"] a`).click();
    await tid('lead-stage').waitFor();
    assert(await tid('lead-stage').inputValue() === 'contacted', 'lead detail shows contacted');
    await page.click('[data-kind="task"]');
    await tid('activity-body').fill(`Send three design options by WhatsApp (${RUN}).`);
    await tid('activity-due').fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    await tid('activity-add').click();
    await toast();
    await tid('activity-feed').getByText(`Send three design options by WhatsApp (${RUN}).`).waitFor();
    await shot('17-lead-detail');
  });

  await step('CRM: create and send a quote, see the customer link', async () => {
    await tid('lead-new-quote').click();
    await page.waitForURL(/\/crm\/quotes\/new/);
    await page.getByRole('tab', { name: 'Generate from a brief' }).click();
    await tid('brief').fill('Green and white football jersey with chevrons');
    await tid('generate').click();
    await tid('pick-design').first().waitFor({ timeout: 30000 });
    await tid('pick-design').first().click();
    await tid('line-qty-0').fill('40');
    await tid('quote-title').fill('District league kit');
    await page.locator('[data-testid="quote-price"]', { hasText: '40 pieces' }).waitFor({ timeout: 15000 });
    await page.locator('[data-stale]').waitFor({ state: 'detached' });
    await shot('18-quote-editor');
    await tid('quote-send').click();
    await tid('quote-link').waitFor({ timeout: 15000 });
    const link = await tid('quote-link').innerText();
    assert(/\/quote\/[A-Za-z0-9_-]{10,}$/.test(link), `quote link ${link}`);
    await shot('19-quote-sent');
    const leads = await api(`/ops/leads?q=${encodeURIComponent(seed.leadTitle.slice(0, 20))}`, { token: seed.admin });
    const lead = leads.items.find((l) => l.title === seed.leadTitle);
    assert(lead?.stage === 'quoted', `lead moved to quoted (${lead?.stage})`);
    const pub = await api(link.slice(link.indexOf('/quote/')).replace('/quote/', '/quotes/'));
    assert(pub.status === 'sent' && pub.pricing.pieces === 40, 'public quote is live');
  });

  await step('CRM: reply to the customer ticket', async () => {
    await page.goto(`${OPS}/crm/tickets`);
    await page.locator(`[data-ticket="${seed.ticketSubject}"]`).click();
    await tid('conversation').getByText('Can I change two S jerseys to M?').waitFor();
    await tid('ticket-reply').fill('Yes — we have updated your order to 4 × S and 2 × M.');
    await tid('ticket-send').click();
    await toast();
    await tid('conversation').getByText('we have updated your order').waitFor();
    await shot('20-ticket');
    const t = await api(`/ops/tickets/${seed.ticket.id}`, { token: seed.admin });
    assert(t.status === 'pending' && t.messages.length === 2, 'reply stored, ticket pending');
  });

  await step('CRM: customers, tasks and reports render', async () => {
    await page.goto(`${OPS}/crm/customers`);
    await tid('customers-table').waitFor();
    await tid('customer-search').fill(`Priya Raman ${RUN}`);
    await tid('customers-table').getByText(`Priya Raman ${RUN}`).click();
    await tid('activity-feed').waitFor();
    await shot('21-customer');
    await page.goto(`${OPS}/crm/tasks`);
    await page.getByText(`Send three design options by WhatsApp (${RUN}).`).waitFor();
    await shot('22-tasks');
    await page.goto(`${OPS}/reports/sales`);
    await tid('report-revenue').waitFor();
    await page.waitForSelector('.recharts-bar-rectangle');
    await shot('23-reports');
    await page.goto(`${OPS}/reports/audit`);
    await tid('audit-table').waitFor();
    await shot('24-audit');
  });

  // ---------------------------------------------------------------- marketplace
  const sellerName = `Kerala Kits ${RUN}`;
  const sellerEmail = `unit.${RUN}@partner.test`;
  const sellerPassword = 'Partn3rPassword';
  const phoneC = `95${String(Date.now() + 3).slice(-8)}`;
  const kerala = (name, phone, pincode = '682001') => ({ name, phone, line1: '7 Marine Drive', line2: '', city: 'Kochi', state: 'KL', pincode });

  await step('sellers: create a seller covering one state, with a blocked PIN code and COD', async () => {
    await page.goto(`${OPS}/sellers`);
    await tid('sellers-table').getByText('UrJersey').first().waitFor();
    await shot('27-sellers');
    await tid('new-seller').click();
    await page.waitForURL(/\/sellers\/new/);
    // A bad value first: the server-side rule for GSTIN is also checked in the browser, next to the field.
    await tid('seller-name').fill(sellerName);
    await tid('seller-gstin').fill('BAD');
    await tid('area-match-0').fill('KL');
    await tid('area-days-0').fill('2');
    assert(await tid('area-cod-0').isChecked(), 'COD allowed in the Kerala area');
    await tid('seller-blocked').fill('682002');
    await tid('seller-save').click();
    await page.locator('.field.invalid', { hasText: 'A GSTIN has 15 letters' }).waitFor();
    await tid('seller-gstin').fill('32ABCDE1234F1Z5');
    await tid('seller-save').click();
    await toast();
    await page.waitForURL(/\/sellers\/sel_/);
    seed.sellerId = page.url().split('/sellers/')[1].split(/[?#]/)[0];
    const s = await api(`/ops/sellers/${seed.sellerId}`, { token: seed.admin });
    assert(s.seller.service_areas.length === 1 && s.seller.service_areas[0].match === 'KL' && s.seller.service_areas[0].cod === true, 'one KL area with COD');
    assert(s.seller.blocked_pincodes[0] === '682002', 'blocked PIN saved');
  });

  await step('sellers: PIN code test', async () => {
    await tid('pin-test-input').fill('682001');
    await tid('pin-test-run').click();
    await page.locator('[data-testid="pin-test-result"][data-serviceable="true"]').waitFor();
    assert((await tid('pin-test-result').innerText()).includes('Kerala'), 'place shown');
    await page.locator('tr.hit[data-area="KL"]').waitFor();
    await shot('28-seller-pincode-test');
    await tid('pin-test-input').fill('682002');
    await tid('pin-test-run').click();
    await page.locator('[data-testid="pin-test-result"][data-serviceable="false"]').waitFor();
    assert((await tid('pin-test-result').innerText()).includes('blocked'), 'blocked PIN explained');
    await tid('pin-test-input').fill('600001');
    await tid('pin-test-run').click();
    await page.locator('[data-testid="pin-test-result"][data-serviceable="false"]', { hasText: '600001' }).waitFor();
  });

  await step('sellers: create a login for the seller', async () => {
    await tid('seller-login-new').click();
    await tid('seller-login-name').fill('Anil (Kerala Kits)');
    await tid('seller-login-email').fill(sellerEmail);
    await tid('seller-login-password').fill('weak');
    await tid('seller-login-submit').click();
    await tid('seller-login-dialog').locator('.field.invalid').waitFor();
    await tid('seller-login-password').fill(sellerPassword);
    await tid('seller-login-submit').click();
    await toast();
    await tid('seller-logins').getByText(sellerEmail).waitFor();
    await shot('29-seller-editor');
    const staff = await api('/ops/staff', { token: seed.admin });
    const st = staff.items.find((x) => x.email === sellerEmail);
    assert(st?.role === 'seller' && st.seller_id === seed.sellerId, 'seller login linked to the seller');
  });

  await step('seed: a customer COD order that lands on the new seller', async () => {
    seed.sellerOrder = await api('/orders', { body: {
      design_id: seed.designId, spec: seed.spec, items: [{ player_name: 'ANU', number: '4', size: 'M', quantity: 8 }],
      customer: { name: `Anu Joseph ${RUN}`, phone: phoneC }, idempotency_key: `e2e_${RUN}_seller`, channel: 'web',
      delivery: { method: 'ship', address: kerala(`Anu Joseph ${RUN}`, phoneC) }, seller_id: seed.sellerId, payment_method: 'cod',
    } });
    assert(seed.sellerOrder.seller?.id === seed.sellerId, `order sold by the new seller (${seed.sellerOrder.seller?.id})`);
    assert(seed.sellerOrder.payment_method === 'cod', 'cash on delivery');
    // A blocked PIN code is refused for this seller.
    let status = 0;
    try {
      await api('/orders', { body: { design_id: seed.designId, spec: seed.spec, items: [{ size: 'M', quantity: 5 }], customer: { name: 'Blocked', phone: phoneC },
        idempotency_key: `e2e_${RUN}_blocked`, channel: 'web', delivery: { method: 'ship', address: kerala('Blocked', phoneC, '682002') }, seller_id: seed.sellerId } });
    } catch (e) { status = Number(String(e.message).match(/-> (\d+)/)?.[1]); }
    assert(status === 422, `blocked PIN code refused (${status})`);
    // The admin sees it with the seller filter and the order page shows seller and payment.
    await page.goto(`${OPS}/orders?seller=${seed.sellerId}`);
    await tid('orders-table').getByText(seed.sellerOrder.number).waitFor();
    assert(await tid('orders-table').getByText(seed.paid.number).count() === 0, 'seller filter hides house orders');
    await page.goto(`${OPS}/orders/${seed.sellerOrder.id}`);
    await tid('order-seller').getByText(sellerName).waitFor();
    await tid('cod-status').getByText('To collect').waitFor();
    await shot('30-order-seller-cod');
  });

  await step('as the seller: only its own order, no settings', async () => {
    await tid('sign-out').click();
    await page.waitForURL(/\/login/);
    await login(sellerEmail, sellerPassword);
    await tid('seller-scope').getByText(sellerName).waitFor();
    await tid('kpi-seller-queued').waitFor();
    await shot('31-seller-home');
    assert(await page.locator('nav a[href="/settings"]').count() === 0, 'no Settings menu');
    assert(await page.locator('nav a[href="/crm/customers"]').count() === 0, 'no CRM menu');
    await page.click('nav a[href="/orders"]');
    await tid('orders-table').getByText(seed.sellerOrder.number).waitFor();
    const rows = await tid('orders-table').locator('tbody tr').count();
    assert(rows === 1, `seller sees exactly its one order (${rows})`);
    await shot('32-seller-orders');
    await page.goto(`${OPS}/settings/price-book`);
    await tid('not-for-seller').waitFor();
    await shot('33-seller-no-settings');
    const tok = await staffToken(sellerEmail, sellerPassword);
    let status = 0;
    try { await api('/ops/settings', { token: tok }); } catch (e) { status = Number(String(e.message).match(/-> (\d+)/)?.[1]); }
    assert(status === 403, `server refuses settings to the seller (${status})`);
    status = 0;
    try { await api(`/ops/orders/${seed.paid.id}`, { token: tok }); } catch (e) { status = Number(String(e.message).match(/-> (\d+)/)?.[1]); }
    assert(status === 404, `another seller's order is hidden (${status})`);
  });

  await step('as the seller: print file download, production stages, shipment from the carrier list, delivery (cash collected on delivery)', async () => {
    await page.goto(`${OPS}/orders/${seed.sellerOrder.id}`);
    const dl = tid('print-files').getByTestId('print-file-download').first();
    await dl.waitFor();
    const [file] = await Promise.all([page.waitForEvent('download'), dl.click()]);
    const svgPath = await file.path();
    const svg = (await import('node:fs')).readFileSync(svgPath, 'utf8');
    assert(file.suggestedFilename().endsWith('.svg') && svg.includes('<svg'), `seller downloaded a print file (${file.suggestedFilename()}, ${svg.length} bytes)`);
    await page.goto(`${OPS}/production/board`);
    await tid('board').waitFor();
    for (let i = 0; i < 8; i++) {
      const card = page.locator(`.kcard[data-order="${seed.sellerOrder.number}"]`);
      await card.waitFor();
      const col = await card.evaluate((el) => el.closest('[data-column]').getAttribute('data-column'));
      if (col === 'ready') break;
      await card.getByTestId('stage-done').click();
      await toast();
      await page.locator(`[data-column="${col}"] .kcard[data-order="${seed.sellerOrder.number}"]`).waitFor({ state: 'detached' });
    }
    await shot('34-seller-board');
    await page.goto(`${OPS}/delivery/ready`);
    const row = tid('ready-table').locator('tr', { hasText: seed.sellerOrder.number });
    await row.getByTestId('create-shipment').click();
    const carrier = tid('shipment-carrier');
    await carrier.locator('option[value="surface"]').waitFor({ state: 'attached' });
    await carrier.selectOption('surface');
    await tid('shipment-tracking').fill(`KL${RUN}`);
    await tid('shipment-submit').click();
    await toast();
    await page.goto(`${OPS}/delivery/shipments`);
    const srow = () => tid('shipments-table').locator('tr', { hasText: seed.sellerOrder.number });
    for (const next of ['packed', 'dispatched', 'delivered']) {
      await srow().getByTestId(`ship-${next}`).click();
      await toast();
      await srow().getByText(next.charAt(0).toUpperCase() + next.slice(1), { exact: true }).waitFor();
    }
    await shot('35-seller-shipments');
    const tok = await staffToken(sellerEmail, sellerPassword);
    const o = await api(`/ops/orders/${seed.sellerOrder.id}`, { token: tok });
    assert(o.order.fulfilment.status === 'delivered', `seller order delivered (${o.order.fulfilment.status})`);
    assert(o.order.payment.collected === true, 'COD marked collected on delivery');
    await tid('sign-out').click();
    await page.waitForURL(/\/login/);
    await login(ADMIN.email, ADMIN.password);
  });

  await step('COD: mark a cash on delivery order collected by hand', async () => {
    seed.codOrder = await api('/orders', { body: {
      design_id: seed.designId, spec: seed.spec, items: [{ size: 'L', quantity: 6 }], customer: { name: `Cash Customer ${RUN}`, phone: phoneC },
      idempotency_key: `e2e_${RUN}_cod`, channel: 'web', delivery: { method: 'ship', address: address(`Cash Customer ${RUN}`, phoneC) }, payment_method: 'cod',
    } });
    await page.goto(`${OPS}/cod`);
    await tid('kpi-cod-outstanding').waitFor();
    const row = tid('cod-table').locator('tr', { hasText: seed.codOrder.number });
    await row.waitFor();
    await shot('36-cod');
    await row.getByTestId('cod-mark').click();
    await tid('cod-reference').fill(`RCPT-${RUN}`);
    await tid('cod-submit').click();
    await toast();
    await row.waitFor({ state: 'detached' });
    const o = await api(`/ops/orders/${seed.codOrder.id}`, { token: seed.admin });
    assert(o.order.payment.collected === true && o.order.payment.reference === `RCPT-${RUN}`, 'COD collected with reference');
  });

  await step('products: create from a brief, publish, see it in the store', async () => {
    const title = `Monsoon Strikers ${RUN}`;
    await page.goto(`${OPS}/products`);
    await tid('products-table').waitFor();
    await tid('new-product').click();
    await tid('product-title').fill(title);
    await tid('product-sport').selectOption('cricket');
    await tid('product-brief').fill('Teal and orange cricket jersey with diagonal stripes');
    await tid('product-generate').click();
    await tid('product-pick').first().waitFor({ timeout: 30000 });
    await tid('product-pick').nth(1).click();
    await shot('37-product-new');
    await tid('product-create').click();
    await toast();
    await page.waitForURL(/\/products\/prd_/);
    seed.productId = page.url().split('/products/')[1].split(/[?#]/)[0];
    await tid('product-edit-title').waitFor(); // the detail page, not the list it came from
    await tid('design-preview').first().locator('img').waitFor();
    await tid('product-edit-description').fill('Ready-made cricket kit with bold diagonal stripes.');
    await tid('product-save').click();
    await toast();
    await tid('product-publish').click();
    await toast();
    await tid('product-unpublish').waitFor();
    await tid('product-store').getByText('per piece').waitFor();
    await shot('38-product-detail');
    const shop = await api(`/shop/products?q=${encodeURIComponent(RUN)}`);
    const p = shop.items.find((x) => x.title === title);
    assert(p && p.description.startsWith('Ready-made cricket'), `published product in /shop/products (${shop.items.length} found)`);
  });

  await step('returns: a customer return on a delivered order is approved and resolved', async () => {
    const otp = await api('/auth/otp/request', { body: { phone: phoneA } });
    const ver = await api('/auth/otp/verify', { body: { phone: phoneA, code: otp.dev_code } });
    seed.custA = ver.token;
    seed.review = (await api(`/me/orders/${seed.paid.id}/review`, { token: ver.token, body: { rating: 2, title: `Colours faded ${RUN}`, body: 'The gold looks dull.' } })).review;
    const r = await api(`/me/orders/${seed.paid.id}/returns`, { token: ver.token, body: { reason: 'print_quality', details: 'Number 7 is peeling on two shirts.', lines: [{ line: 1, quantity: 2 }] } });
    seed.ret = r.return;
    await page.goto(`${OPS}/returns`);
    await tid('kpi-returns-waiting').waitFor();
    await tid('returns-table').getByText(seed.ret.number).click();
    await tid('return-drawer').getByText('Number 7 is peeling').waitFor();
    await shot('39-return-requested');
    await tid('return-to-approved').click();
    await tid('return-note').fill('Our courier will pick them up on Monday.');
    await tid('return-submit').click();
    await toast();
    await tid('return-to-picked_up').click();
    await tid('return-submit').click();
    await toast();
    await tid('return-to-resolved').click();
    await tid('return-submit').click();
    await tid('return-form').getByText('Choose replacement or refund.').waitFor();
    await tid('return-resolution').selectOption('refund');
    await tid('return-refund').fill('500');
    await tid('return-note').fill('Refunded 500 to your UPI.');
    await tid('return-submit').click();
    await toast();
    await tid('return-history').getByText('Resolved').waitFor();
    await shot('40-return-resolved');
    const got = await api(`/ops/returns/${seed.ret.id}`, { token: seed.admin });
    assert(got.return.status === 'resolved' && got.return.resolution === 'refund' && got.return.refund_amount === 500, `return resolved (${got.return.status})`);
    await page.keyboard.press('Escape');
  });

  await step('reviews: hide a review', async () => {
    await page.goto(`${OPS}/reviews`);
    const row = tid('reviews-table').locator('tr', { hasText: `Colours faded ${RUN}` });
    await row.waitFor();
    await row.getByTestId('review-hide').click();
    await tid('review-hide-reason').fill('Test of moderation');
    await tid('review-hide-submit').click();
    await toast();
    await row.getByText('Hidden', { exact: true }).waitFor();
    await shot('41-reviews');
    // Rating range is filtered on the server: the 2-star review is outside 4–5 and inside 1–2.
    await tid('reviews-min-rating').selectOption('4');
    await row.waitFor({ state: 'detached' });
    await tid('reviews-min-rating').selectOption('1');
    await tid('reviews-max-rating').selectOption('2');
    await row.waitFor();
    const list = await api(`/ops/reviews?status=hidden`, { token: seed.admin });
    assert(list.items.some((x) => x.id === seed.review.id && x.hidden), 'review hidden on the server');
  });

  await step('messages: the outbox lists SMS and email for the orders', async () => {
    await page.goto(`${OPS}/messages`);
    const real = tid('messages-table').locator('tbody tr', { has: page.locator('code') });
    await real.first().waitFor();
    const rows = await real.count();
    assert(rows >= 3, `outbox has entries (${rows})`);
    await tid('messages-search').fill(seed.sellerOrder.number);
    await tid('messages-table').locator('tbody tr', { hasText: seed.sellerOrder.number }).first().waitFor();
    await shot('42-messages');
  });

  await step('messages: the SMS and email services panel sends a test', async () => {
    await page.goto(`${OPS}/messages`);
    await page.locator('.messaging-setup').getByText('Not connected (server log only)').first().waitFor();
    await page.fill('#msg-test-to', 'owner@example.com');
    await tid('messaging-test-send').click();
    await page.locator('.messaging-setup').getByText('only written to the server log').waitFor();
    await shot('42b-messaging-setup');
  });

  await step('settings: COD fee saves, coupons and returns show their new fields', async () => {
    await page.goto(`${OPS}/settings/price-book`);
    await tid('cod-fee').waitFor();
    const v0 = Number((await tid('settings-version').innerText()).replace(/\D/g, ''));
    await tid('cod-fee').fill('59');
    await tid('cod-max').fill('25000');
    await tid('try-cod').check();
    await tid('try-table').getByText('Cash on delivery fee').waitFor();
    await tid('try-table').locator('tr', { hasText: 'Cash on delivery fee' }).getByText(/59\.00/).waitFor();
    await tid('coupon-public-0').waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('43-cod-settings');
    await tid('settings-save').click();
    await toast();
    await page.waitForFunction((v) => document.querySelector('[data-testid="settings-version"]')?.textContent?.includes(`version ${v + 1}`), v0);
    const pb = await api('/ops/settings/price_book', { token: seed.admin });
    assert(pb.value.cod.fee === 59 && pb.value.cod.max_order_value === 25000 && pb.value.cod.enabled, `COD saved (${JSON.stringify(pb.value.cod)})`);
    assert(pb.value.coupons[0].public === true && pb.value.coupons[0].title, 'coupon public and title kept');
    await page.goto(`${OPS}/settings/crm`);
    await tid('return-window').waitFor();
    await shot('44-crm-returns-settings');
    await page.goto(`${OPS}/dashboard`);
    await tid('kpi-returns').waitFor();
    await tid('orders-by-seller').getByText(sellerName).waitFor();
    await shot('45-dashboard-marketplace');
  });

  await step('size charts: a wrong kids value is marked, then a kids value is edited and saved', async () => {
    await page.goto(`${OPS}/settings/sizing`);
    await tid('sizing-table-men').waitFor();
    await tid('sizing-tab-kids').click();
    await tid('sizing-table-kids').waitFor();
    const v0 = Number((await tid('settings-version').innerText()).replace(/\D/g, ''));
    // 10Y smaller than 8Y is refused next to the field before anything is sent
    await tid('sz-kids-10Y-top.chest').fill('30');
    await tid('settings-save').click();
    await tid('sizing-table-kids').locator('tr[data-size="10Y"]').getByText('Must not be smaller than 8Y').waitFor();
    await tid('sizing-tab-kids').locator('.badge').waitFor();
    await shot('46a-size-chart-error');
    await tid('sz-kids-10Y-top.chest').fill('38');
    await tid('sz-kids-8Y-top.chest').fill('36.5');
    await tid('sz-kids-8Y-height-1').fill('135');
    await tid('settings-save').click();
    await toast();
    await page.waitForFunction((v) => document.querySelector('[data-testid="settings-version"]')?.textContent?.includes(`version ${v + 1}`), v0);
    const sz = await api('/ops/settings/sizing', { token: seed.admin });
    const row = sz.value.fits.kids.sizes.find((r) => r.size === '8Y');
    assert(row.top.chest === 36.5 && row.height[1] === 135, `kids 8Y saved (${JSON.stringify(row)})`);
    const guide = await api('/shop/size-guide');
    assert(guide.fits.find((f) => f.id === 'kids').sizes.find((r) => r.size === '8Y').top.chest === 36.5, 'customers see the new kids chart');
    await shot('46-size-charts-kids');
  });

  await step('price book: set the long-sleeve price; Try it prices long sleeves for a kids size', async () => {
    await page.goto(`${OPS}/settings/price-book`);
    await tid('opt-sleeves-long-price').waitFor();
    const v0 = Number((await tid('settings-version').innerText()).replace(/\D/g, ''));
    assert(await tid('opt-sleeves-short-active').isDisabled(), 'short sleeves cannot be switched off');
    assert(await tid('opt-collar-crew-active').isDisabled(), 'crew neck cannot be switched off');
    await tid('size-surcharge-3XL').waitFor();
    await tid('size-surcharge-8Y').waitFor();
    await tid('opt-sleeves-long-price').fill('75');
    await tid('try-fit').selectOption('kids');
    await tid('try-size').selectOption('8Y');
    await tid('try-sleeves').selectOption('long');
    await tid('try-table').locator('tr', { hasText: 'of which garment options' }).waitFor();
    await page.waitForFunction(() => {
      const a = document.querySelector('[data-testid="try-current"]')?.textContent;
      const b = document.querySelector('[data-testid="try-draft"]')?.textContent;
      return a && b && a !== b;
    }, null, { timeout: 15000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('47-price-book-options');
    await tid('settings-save').click();
    await toast();
    await page.waitForFunction((v) => document.querySelector('[data-testid="settings-version"]')?.textContent?.includes(`version ${v + 1}`), v0);
    const pb = await api('/ops/settings/price_book', { token: seed.admin });
    assert(pb.value.options.sleeves.long.price === 75 && pb.value.options.sleeves.short.active, `long sleeves 75 (${JSON.stringify(pb.value.options.sleeves)})`);
    const cat = await api('/shop/catalogue');
    assert(cat.options.sleeves.find((x) => x.id === 'long').price === 75, 'catalogue shows the new long-sleeve price');
  });

  await step('order with a kids line and long sleeves: measurements, pieces and the measurement sheet', async () => {
    const phoneK = `93${String(Date.now() + 5).slice(-8)}`;
    seed.kidsOrder = await api('/orders', { body: {
      design_id: seed.designId, spec: { ...seed.spec, sleeves: 'long' }, customer: { name: `Junior Club ${RUN}`, phone: phoneK },
      items: [{ player_name: 'KAVIN', number: '5', fit: 'kids', size: '8Y', quantity: 4 }, { player_name: 'COACH', number: '1', fit: 'men', size: 'L', quantity: 1 }],
      idempotency_key: `e2e_${RUN}_kids`, channel: 'web', delivery: { method: 'ship', address: address(`Junior Club ${RUN}`, phoneK) },
    } });
    assert(seed.kidsOrder.options?.sleeves === 'long', `order has long sleeves (${JSON.stringify(seed.kidsOrder.options)})`);
    await page.goto(`${OPS}/orders/${seed.kidsOrder.id}`);
    const kidsRow = tid('order-lines').locator('tr', { hasText: 'KAVIN' });
    await kidsRow.waitFor();
    const txt = await kidsRow.innerText();
    assert(txt.includes('Kids') && txt.includes('8Y') && txt.includes('36.5') && txt.includes('Sleeves (2)'), `kids line shows fit, size, the saved chart and pieces (${txt.replace(/\s+/g, ' ')})`);
    await tid('order-options').getByText('Long sleeves').waitFor();
    await tid('print-files').locator('[data-testid="print-file-line"]', { hasText: 'Kids 8Y' }).waitFor();
    assert(await tid('print-file-line').count() === 2, 'print files grouped in two lines');
    const [file] = await Promise.all([page.waitForEvent('download'), tid('measurement-sheet-download').click()]);
    const svg = (await import('node:fs')).readFileSync(await file.path(), 'utf8');
    assert(file.suggestedFilename().endsWith('_measurements.svg'), `sheet file name ${file.suggestedFilename()}`);
    assert(svg.startsWith('<svg') && svg.includes('Measurement sheet') && svg.includes('8Y') && svg.includes('long sleeves'), `measurement sheet SVG (${svg.length} bytes)`);
    // Piece sizes are fully visible: the lines table fits its card at desktop width, with no hidden overflow.
    const fit = await tid('order-lines').evaluate((t) => ({ sw: t.parentElement.scrollWidth, cw: t.parentElement.clientWidth, cell: t.querySelector('tr[data-line="1"] td.measure').innerText }));
    assert(fit.sw <= fit.cw + 1, `lines table fits its card (${fit.sw} > ${fit.cw})`);
    assert(/Front, back\s+\d+\s×\s\d+/.test(fit.cell) && /Sleeves \(2\)\s+\d+\s×\s\d+/.test(fit.cell), `piece sizes shown in full (${fit.cell})`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('48-order-kids-measurements');
    // On a phone the table scrolls sideways instead of clipping.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400); // the side menu slides away (0.15 s transition)
    const narrow = await tid('order-lines').evaluate((t) => ({ sw: t.parentElement.scrollWidth, cw: t.parentElement.clientWidth, ox: getComputedStyle(t.parentElement).overflowX,
      page: document.documentElement.scrollWidth, vw: window.innerWidth }));
    assert(narrow.page <= narrow.vw + 1, `narrow screen: the page itself does not scroll sideways (${JSON.stringify(narrow)})`);
    assert(narrow.sw > narrow.cw && (narrow.ox === 'auto' || narrow.ox === 'scroll'), `narrow screen: the lines table scrolls sideways inside its card (${JSON.stringify(narrow)})`);
    // Show the table scrolled to its last column (piece sizes), page itself at the left edge.
    await tid('order-lines').evaluate((t) => { t.parentElement.scrollLeft = t.parentElement.scrollWidth; const r = t.getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - 120); });
    await page.screenshot({ path: `${OUT}48b-order-lines-narrow.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await step('products: add a colourway with its own colours', async () => {
    await page.goto(`${OPS}/products/${seed.productId}`);
    await tid('colourways').waitFor();
    const before = (await api(`/ops/products/${seed.productId}`, { token: seed.admin })).colourways?.length ?? 0;
    await tid('cw-add').click();
    const i = before;
    await tid(`cw-name-${i}`).fill('Sunset Orange');
    assert(await tid(`cw-id-${i}`).inputValue() === 'sunset-orange', 'id follows the name');
    await tid(`cw-${i}-primary`).fill('#ff6a00');
    await tid(`cw-${i}-secondary`).fill('#1b1b3a');
    await tid('cw-swatches').getByText('Sunset Orange').waitFor();
    await tid('cw-save').click();
    await toast();
    const p = await api(`/ops/products/${seed.productId}`, { token: seed.admin });
    const cw = p.colourways.find((c) => c.id === 'sunset-orange');
    assert(cw && cw.palette.primary.toLowerCase() === '#ff6a00' && cw.name === 'Sunset Orange', `colourway saved (${JSON.stringify(p.colourways)})`);
    const shop = await api(`/shop/products/${p.slug}`);
    assert(shop.colourways.some((c) => c.id === 'sunset-orange'), 'the store offers the colourway');
    await tid('design-preview').locator('img').waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('49-product-colourway');
  });

  const prodEmail = `prod.${RUN}@urjersey.test`;
  const prodPassword = 'Pr0duction-Pass';
  await step('create a production-role staff user', async () => {
    await page.goto(`${OPS}/staff`);
    await tid('new-staff').click();
    await tid('staff-name').fill('Meena (Production)');
    await tid('staff-email').fill(prodEmail);
    await tid('staff-role').selectOption('production');
    await tid('staff-password').fill('short');
    await tid('staff-submit').click();
    await tid('staff-dialog').getByText('Use at least 10 characters.').waitFor();
    await tid('staff-password').fill(prodPassword);
    await tid('staff-submit').click();
    await toast();
    await tid('staff-table').getByText(prodEmail).waitFor();
    await shot('25-staff');
    await tid('sign-out').click();
    await page.waitForURL(/\/login/);
  });

  await step('as production: price book is read only and cannot be saved', async () => {
    await login(prodEmail, prodPassword);
    assert((await tid('whoami').innerText()).includes('Meena'), 'signed in as the production user');
    assert(await page.locator('nav a[href="/staff"]').count() === 0, 'no Staff menu for production');
    await page.goto(`${OPS}/settings/price-book`);
    await tid('settings-readonly').waitFor();
    assert(await tid('settings-save').isDisabled(), 'save disabled');
    assert(await tid('price-jersey').isDisabled(), 'inputs disabled');
    await shot('26-production-user-price-book');
    // the server refuses too
    const tok = await staffToken(prodEmail, prodPassword);
    const pb = await api('/ops/settings/price_book', { token: tok });
    let status = 0;
    try { await api('/ops/settings/price_book', { method: 'PUT', token: tok, body: { value: pb.value, version: pb.version } }); } catch (e) { status = Number(String(e.message).match(/-> (\d+)/)?.[1]); }
    assert(status === 403, `server refuses price book save for production (${status})`);
    // but production settings are theirs to change
    await page.goto(`${OPS}/settings/production`);
    await tid('holidays').waitFor();
    assert(await page.getByTestId('settings-readonly').count() === 0, 'production settings editable for production role');
    // and so are the size charts
    await page.goto(`${OPS}/settings/sizing?fit=kids`);
    await tid('sizing-table-kids').waitFor();
    assert(await page.getByTestId('settings-readonly').count() === 0 && !(await tid('sz-kids-8Y-top.chest').isDisabled()), 'size charts editable for production role');
    // and the board lets them work
    await page.goto(`${OPS}/production/board`);
    await tid('board').waitFor();
    await page.goto(`${OPS}/orders/${seed.unpaid.id}`);
    await tid('order-stages').waitFor();
    assert(await tid('record-payment').count() === 0, 'paid order has no payment button');
    assert(await tid('add-note').isDisabled(), 'production cannot add order notes');
  });

  await step('no uncaught errors in the browser', async () => {
    assert(consoleErrors.length === 0, `console errors:\n${consoleErrors.join('\n')}`);
  });
} catch {
  // reported by step()
} finally {
  await browser?.close();
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed${failures ? `, ${failures} failed` : ''}. Screenshots: ${OUT}`);
  process.exitCode = failures ? 1 : 0;
}
