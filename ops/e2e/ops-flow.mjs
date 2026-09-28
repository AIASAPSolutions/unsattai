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
