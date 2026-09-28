// End-to-end walk through the UrJersey web store with Playwright (Chromium).
//
//   npm run e2e            (NODE_PATH=$(npm root -g) so the global playwright is found)
//
// Needs the store running (WEB_URL, default http://127.0.0.1:3100) against an API
// with its own database (API_URL, default http://127.0.0.1:8100) and the admin user
// from ADMIN_EMAIL / ADMIN_PASSWORD for the sales-quote step. Screenshots go to e2e/shots/.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const WEB = process.env.WEB_URL || 'http://127.0.0.1:3100';
const API = process.env.API_URL || 'http://127.0.0.1:8100';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@urjersey.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Adm1nPassword!';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const run = Date.now().toString().slice(-5);
const phone = (n) => `98${run}${String(n).padStart(3, '0')}`;
const ORGANISER = phone(1);

let passed = 0;
const results = [];
let page;

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    results.push(`✓ ${name} (${Date.now() - t0} ms)`);
    console.log(`✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    console.log(`✗ ${name}\n  ${e.stack || e}`);
    if (page) await page.screenshot({ path: `${SHOTS}FAILED-${name.replace(/\W+/g, '-')}.png`, fullPage: true }).catch(() => {});
    throw e;
  }
}

const tid = (id) => `[data-testid="${id}"]`;
const overflow = [];
async function shot(name, p = page) {
  // Every screenshotted screen must fit its viewport width (no sideways page scroll).
  const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  if (w[0] > w[1] + 1) overflow.push(`${name}: ${w[0]}px > ${w[1]}px`);
  await p.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true });
}

async function signInWithOtp(p, prefix, number, name) {
  if (name) await p.fill(tid(`${prefix}-name`), name).catch(() => {});
  await p.fill(tid(`${prefix}-phone`), number);
  await p.click(tid(`${prefix}-send`));
  const code = (await p.locator(tid(`${prefix}-dev-code`)).textContent({ timeout: 10_000 })).trim();
  assert(/^\d{4,8}$/.test(code), 'dev code shown');
  await p.fill(tid(`${prefix}-code`), code);
  await p.click(tid(`${prefix}-verify`));
}

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}/api/v1/${path}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB });
  page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  let orderId = '';
  let designShareUrl = '';
  let collectionId = '';
  let teamToken = '';

  // ------------------------------------------------------------------ landing
  await step('landing shows garments with from-prices, tiers and contact', async () => {
    await page.goto(`${WEB}/`);
    await page.locator(tid('garment-card-jersey')).waitFor();
    const card = await page.locator(tid('garment-card-jersey')).innerText();
    assert(/₹/.test(card), `price on jersey card: ${card}`);
    assert(await page.locator('footer').innerText().then((t) => /UrJersey/.test(t)), 'footer brand');
    const title = await page.title();
    assert(/UrJersey/.test(title), 'page title');
    const desc = await page.locator('meta[name="description"]').getAttribute('content');
    assert(desc && desc.length > 40, 'meta description');
    await shot('01-landing');
  });

  await step('language switch to Hindi and back', async () => {
    await page.selectOption(tid('lang-select'), 'hi');
    await page.waitForFunction(() => /[\u0900-\u097F]/.test(document.querySelector('h1')?.textContent || ''), null, { timeout: 10_000 });
    const h1 = await page.locator('h1').first().innerText();
    assert(/[ऀ-ॿ]/.test(h1), `Hindi hero title: ${h1}`);
    await shot('02-landing-hindi');
    for (const lang of ['te', 'ta']) {
      await page.selectOption(tid('lang-select'), lang);
      await page.waitForFunction((l) => document.documentElement.lang === l, lang, { timeout: 10_000 });
    }
    await page.waitForFunction(() => /[\u0B80-\u0BFF]/.test(document.querySelector('h1')?.textContent || ''), null, { timeout: 10_000 });
    const ta = await page.locator('h1').first().innerText();
    assert(/[஀-௿]/.test(ta), `Tamil hero title: ${ta}`);
    await page.selectOption(tid('lang-select'), 'en');
    await page.waitForFunction(() => /Design your team kit/.test(document.querySelector('h1')?.textContent || ''), null, { timeout: 10_000 });
  });

  await step('bulk enquiry from the landing page', async () => {
    await page.fill(tid('landing-enquiry-name'), 'Coach Meena');
    await page.fill(tid('landing-enquiry-phone'), phone(90));
    await page.fill(tid('landing-enquiry-org'), 'Chennai Schools League');
    await page.fill(tid('landing-enquiry-pieces'), '240');
    await page.fill(tid('landing-enquiry-message'), 'Football kits for 12 schools, need them in March.');
    await page.click(tid('landing-enquiry-send'));
    const done = await page.locator(tid('landing-enquiry-done')).innerText({ timeout: 10_000 });
    assert(/lead_|[A-Za-z0-9_-]{6,}/.test(done), `enquiry reference: ${done}`);
  });

  // ------------------------------------------------------------------ design flow
  await step('brief with locked colour, team, player and number', async () => {
    await page.goto(`${WEB}/design`);
    await page.locator(tid('screen-describe')).waitFor();
    if (await page.locator(tid('resume-banner')).count()) await page.click('text=Start over').catch(() => {});
    await page.fill(tid('brief'), 'Aggressive navy and gold jersey with lightning shards for team Chennai Strikers');
    await page.click(tid('garment-jersey'));
    await page.click(tid('add-color'));
    await page.fill(tid('color-picker-hex'), '#13225A');
    await page.click(tid('color-picker-apply'));
    await page.fill(tid('team'), 'Madurai Kings');
    await page.fill(tid('player'), 'Arul');
    await page.fill(tid('number'), '7');
    await shot('03-brief');
    await page.click(tid('understand'));
    await page.waitForURL(/\/design\/confirm/);
  });

  await step('confirm: team-name conflict and missing sport are asked', async () => {
    await page.locator(tid('screen-confirm')).waitFor();
    const questions = page.locator('[data-testid^="question-"]');
    await questions.first().waitFor({ timeout: 10_000 });
    assert(await questions.count() >= 1, 'at least one question');
    const generate = page.locator(tid('generate'));
    assert(await generate.isDisabled(), 'generate disabled until questions are answered');
    await shot('04-confirm');
    // Answer every question with its first option, then pick a sport if none was detected.
    for (let i = 0; i < 6 && await page.locator('[data-testid^="question-"]').count(); i++) {
      await page.locator('[data-testid^="question-"]').first().locator('[data-testid^="answer-"]').first().click();
    }
    const sport = page.locator(tid('sport-cricket'));
    if (await sport.count() && (await sport.getAttribute('aria-pressed')) !== 'true') await sport.click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="generate"]')?.hasAttribute('disabled'), null, { timeout: 5000 });
    await page.click(tid('generate'));
    await page.waitForURL(/\/design\/designs/, { timeout: 60_000 });
  });

  await step('four designs, a star rating and more designs', async () => {
    await page.locator(tid('design-3')).waitFor({ timeout: 60_000 });
    assert(await page.locator('[data-testid^="design-"]').count() === 4, 'four designs');
    const feedback = page.waitForResponse((r) => r.url().includes('/feedback') && r.request().method() === 'POST');
    await page.click(tid('rate-0-4'));
    assert((await feedback).ok(), 'rating saved');
    await page.click(tid('more-designs'));
    await page.locator(tid('design-7')).waitFor({ timeout: 60_000 });
    await shot('05-designs');
    await page.click(tid('open-0'));
    await page.waitForURL(/\/studio/);
  });

  // ------------------------------------------------------------------ studio
  await step('studio: drag a layer, undo/redo, keyboard nudge', async () => {
    await page.locator(tid('panel-overlay')).waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => /✓|✕/.test(document.querySelector('[data-testid="studio-status"]')?.textContent || ''), null, { timeout: 30_000 });
    assert(await page.locator(tid('undo')).isDisabled(), 'nothing to undo yet');
    const layer = page.locator('[data-testid^="layer-"]').first();
    const box = await layer.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + i * 3, box.y + box.height / 2 + i * 2);
    await page.mouse.up();
    await page.locator(tid('selection')).waitFor();
    assert(await page.locator(tid('undo')).isEnabled(), 'drag is undoable');
    await page.click(tid('undo'));
    assert(await page.locator(tid('undo')).isDisabled(), 'one drag = one undo step');
    await page.click(tid('redo'));
    assert(await page.locator(tid('undo')).isEnabled(), 'redo restores the drag');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+Shift+z');
    assert(await page.locator(tid('undo')).isEnabled(), 'keyboard undo/redo');
    await page.locator(tid('safe-zone')).waitFor({ state: 'attached' });
    await shot('06-studio');
  });

  await step('studio: style, text, checks, 3D and share tabs', async () => {
    await page.click(tid('tab-style'));
    await page.click(tid('pattern-waves'));
    await page.waitForTimeout(600);
    await page.click(tid('tab-text'));
    await page.locator(tid('text-layer-editor')).first().waitFor({ state: 'attached' }).catch(() => {});
    await page.click(tid('tab-checks'));
    await page.locator(tid('checks-list')).waitFor({ timeout: 30_000 });
    await page.click(tid('view-3d'));
    await Promise.race([
      page.locator('canvas[data-testid="canvas-3d"]').waitFor({ timeout: 15_000 }),
      page.locator(tid('view-3d-unavailable')).waitFor({ timeout: 15_000 }),
    ]);
    await shot('07-studio-3d');
    await page.click(tid('view-2d'));
    await page.click(tid('tab-share'));
    await page.locator(tid('share-mockup')).waitFor({ timeout: 15_000 });
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(tid('download-png'))]);
    assert(/\.png$/.test(download.suggestedFilename()), `PNG download: ${download.suggestedFilename()}`);
    await page.click(tid('copy-link'));
    const link = await page.locator(tid('share-link')).inputValue({ timeout: 15_000 });
    assert(/\/d\//.test(link), `share link: ${link}`);
    designShareUrl = link;
    await page.click(tid('tab-checks'));
    await page.waitForFunction(() => /✓/.test(document.querySelector('[data-testid="studio-status"]')?.textContent || ''), null, { timeout: 30_000 });
  });

  await step('save design (signs in with a one-time code)', async () => {
    await page.click(tid('save-design'));
    await page.locator(tid('save-modal')).waitFor();
    await signInWithOtp(page, 'save-otp', ORGANISER, 'Arul Organiser');
    await page.fill(tid('save-name'), 'Strikers home kit');
    await page.click(tid('save-confirm'));
    await page.locator(tid('design-saved')).waitFor({ timeout: 10_000 });
    await page.keyboard.press('Escape');
  });

  // ------------------------------------------------------------------ checkout
  await step('checkout: team roster, paste, CSV, duplicates and size chart', async () => {
    await page.click(tid('order'));
    await page.waitForURL(/\/checkout/);
    await page.locator(tid('screen-checkout')).waitFor();
    await page.click(tid('mode-team'));
    await page.locator(tid('roster-row-0')).waitFor();
    await page.click(tid('roster-paste'));
    await page.fill(tid('paste-text'), 'Priya, 10, S\nKiran Kumar, 23, XL, 2\nRavi, 7, L\nnot a size line zz');
    await page.click(tid('paste-import'));
    await page.locator(tid('roster-result')).waitFor();
    assert(/1 line/.test(await page.locator(tid('roster-result')).innerText()), 'bad pasted line reported');
    await page.keyboard.press('Escape');
    await page.locator(tid('duplicate-numbers')).waitFor();
    await page.setInputFiles(tid('roster-csv-input'), {
      name: 'roster.csv', mimeType: 'text/csv',
      buffer: Buffer.from('Name,Number,Size,Qty\n"Sai, Jr",11,M,1\nDeepa,12,XS,1\n'),
    });
    await page.locator(tid('roster-row-5')).waitFor();
    const name5 = await page.locator(tid('roster-name-4')).inputValue();
    assert(name5 === 'Sai, Jr', `CSV quoted name kept: ${name5}`);
    await page.fill(tid('roster-number-3'), '8');
    await page.locator(tid('duplicate-numbers')).waitFor({ state: 'detached' });
    await page.click(tid('roster-add'));
    await page.locator(tid('roster-row-6')).waitFor();
    await page.click(tid('roster-remove-6'));
    await page.click(tid('size-chart'));
    await page.locator(tid('size-chart-dialog')).locator('table').waitFor();
    await page.keyboard.press('Escape');
    const total = await page.locator(tid('roster-total')).innerText();
    assert(/7/.test(total), `total pieces: ${total}`);
  });

  await step('checkout: bulk enquiry offered above 50 pieces', async () => {
    await page.fill(tid('roster-qty-0'), '60');
    await page.locator(tid('bulk-banner')).waitFor();
    await page.fill(tid('roster-qty-0'), '1');
    await page.locator(tid('bulk-banner')).waitFor({ state: 'detached' });
  });

  await step('checkout: fabric, express dates, coupon, address and live price', async () => {
    await page.locator(tid('fabric-premium')).click();
    await page.locator(tid('price-total')).waitFor({ timeout: 20_000 });
    const before = await page.locator(tid('price-total')).innerText();
    await page.check(tid('express-toggle'));
    await page.waitForFunction(() => /Express:|same/.test(document.querySelector('[data-testid="express-dates"]')?.textContent || ''), null, { timeout: 15_000 });
    await page.locator(tid('price-rush')).waitFor({ timeout: 15_000 });
    await page.fill(tid('coupon'), 'WELCOME10');
    await page.click(tid('coupon-apply'));
    await page.locator(tid('coupon-ok')).waitFor({ timeout: 15_000 });
    await page.locator(tid('price-coupon')).waitFor();
    await page.fill(tid('addr-line1'), '12 Anna Salai');
    await page.fill(tid('addr-city'), 'Chennai');
    await page.selectOption(tid('addr-state'), 'TN');
    await page.fill(tid('addr-pincode'), '600002');
    await page.waitForTimeout(900);
    const after = await page.locator(tid('price-total')).innerText();
    assert(before !== after, `price updated (${before} -> ${after})`);
    for (const k of ['subtotal', 'shipping', 'tax', 'per-piece', 'dates']) await page.locator(tid(`price-${k}`)).waitFor();
    assert((await page.locator(tid('price-line')).count()) >= 5, 'per-line prices');
    assert(/Demo: no money is taken/.test(await page.locator(tid('demo-label')).innerText()), 'demo label');
    assert(/Signed in as/.test(await page.locator(tid('signed-in-as')).innerText()), 'signed in at checkout');
    await shot('08-checkout');
  });

  let orderRequest = null;
  await step('place order, demo payment and confirmation with invoice', async () => {
    const req = page.waitForRequest((r) => r.url().endsWith('/api/uj/orders') && r.method() === 'POST');
    await page.click(tid('place-order'));
    orderRequest = (await req).postDataJSON();
    assert(orderRequest.channel === 'web' && /^web_/.test(orderRequest.idempotency_key), 'web channel and idempotency key');
    await page.waitForURL(/\/order\/[^/]+\/pay/, { timeout: 60_000 });
    orderId = decodeURIComponent(page.url().split('/order/')[1].split('/')[0]);
    await page.locator(tid('demo-box')).waitFor();
    await shot('09-pay');
    await page.click(tid('demo-pay'));
    await page.waitForURL(/\/order\/[^/]+(\?.*)?$/, { timeout: 30_000 });
    await page.locator(tid('confirmation-number')).waitFor();
    const number = await page.locator(tid('confirmation-number')).innerText();
    assert(number.length > 3, 'order number');
    await page.locator(tid('confirmation-promised')).waitFor();
    const href = await page.locator(tid('confirmation-invoice')).getAttribute('href');
    // Fetched from the page, like the customer's click: it carries the browser's session and device cookies,
    // which the API needs to show an order to its owner.
    const inv = await page.evaluate(async (u) => {
      const r = await fetch(u);
      return { ok: r.ok, type: r.headers.get('content-type') ?? '', text: await r.text() };
    }, href);
    assert(inv.ok && /html/.test(inv.type), 'invoice through the proxy');
    assert(/Invoice|INVOICE|invoice/.test(inv.text), 'invoice content');
    await shot('10-confirmation');
  });

  await step('same order key is not placed twice; staff API not exposed', async () => {
    // Replaying the exact order request with its idempotency key returns the same order.
    const replay = await page.request.post(`${WEB}/api/uj/orders`, { data: orderRequest, headers: { origin: WEB } });
    const again = await replay.json();
    assert(replay.status() === 200 && again.id === orderId && again.duplicate === true, `idempotent replay: ${replay.status()} ${again.id}`);
    const blocked = await page.request.get(`${WEB}/api/uj/ops/orders`);
    assert(blocked.status() === 404 || blocked.status() === 403, `ops API not exposed: ${blocked.status()}`);
  });

  // ------------------------------------------------------------------ account
  await step('account: orders list, detail with timeline, order again', async () => {
    await page.goto(`${WEB}/account`);
    await page.locator(tid(`order-${orderId}`)).waitFor({ timeout: 15_000 });
    await shot('11-account-orders');
    await page.click(tid(`order-${orderId}`));
    await page.locator(tid('order-detail')).waitFor();
    await page.locator(tid('order-timeline')).waitFor();
    await page.locator(tid('order-progress')).waitFor();
    await shot('12-account-order');
    await page.click(tid('order-again'));
    await page.waitForURL(/\/checkout/);
    await page.locator(tid('roster-row-5')).waitFor({ timeout: 10_000 });
  });

  await step('account: profile and saved addresses', async () => {
    await page.goto(`${WEB}/account/profile`);
    await page.fill(tid('profile-email'), 'arul@example.com');
    await page.click(tid('profile-save'));
    await page.locator(tid('profile-msg')).waitFor();
    const saved = await page.locator('[data-testid^="address-"][data-testid$="0"]').count();
    assert(saved >= 1, 'checkout address was saved to the account');
    await page.click(tid('address-add'));
    await page.fill(tid('new-address-line1'), '4 MG Road');
    await page.fill(tid('new-address-city'), 'Bengaluru');
    await page.selectOption(tid('new-address-state'), 'KA');
    await page.fill(tid('new-address-pincode'), '560001');
    await page.click(tid('address-save'));
    await page.locator(tid('address-1')).waitFor();
    await shot('13-profile');
  });

  await step('account: saved designs open in the studio', async () => {
    await page.goto(`${WEB}/account/designs`);
    const card = page.locator('[data-testid^="saved-open-"]').first();
    await card.waitFor({ timeout: 10_000 });
    await shot('14-saved-designs');
    await card.click();
    await page.waitForURL(/\/studio/);
    await page.locator(tid('panel-overlay')).waitFor({ timeout: 30_000 });
  });

  await step('account: support ticket linked to the order, with a reply', async () => {
    await page.goto(`${WEB}/account/orders/${encodeURIComponent(orderId)}`);
    await page.click(tid('order-help'));
    await page.waitForURL(/\/account\/support/);
    await page.locator(tid('ticket-form')).waitFor();
    assert(await page.locator(tid('ticket-order')).inputValue() === orderId, 'order preselected');
    await page.fill(tid('ticket-subject'), 'Change size for Kiran');
    await page.fill(tid('ticket-body'), 'Can Kiran get XXL instead of XL?');
    await page.click(tid('ticket-send'));
    await page.waitForURL(/\/account\/support\/.+/);
    await page.fill(tid('ticket-reply'), 'Also please confirm the delivery date.');
    await page.click(tid('ticket-reply-send'));
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="ticket-messages"] > div').length >= 2);
    await shot('15-ticket');
  });

  // ------------------------------------------------------------------ team collection
  await step('team collection: organiser creates a team link', async () => {
    await page.goto(`${WEB}/studio`);
    await page.locator(tid('panel-overlay')).waitFor({ timeout: 30_000 });
    await page.click(tid('team-order'));
    await page.locator(tid('team-modal')).waitFor();
    await page.fill(tid('team-title'), `U-16 Strikers ${run}`);
    const d = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    await page.fill(tid('team-deadline'), d);
    await page.fill(tid('team-message'), 'Add your details by Friday!');
    await page.click(tid('team-create'));
    await page.locator(tid('team-created')).waitFor({ timeout: 10_000 });
    const link = await page.locator(tid('team-link')).inputValue();
    teamToken = link.split('/t/')[1];
    assert(teamToken, `team link: ${link}`);
    const dash = await page.locator(tid('team-dashboard')).getAttribute('href');
    collectionId = dash.split('/account/teams/')[1];
    await shot('16-team-created');
    await page.keyboard.press('Escape');
  });

  await step('team page: players add and edit their own entry', async () => {
    const players = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const p1 = await players.newPage();
    await p1.goto(`${WEB}/t/${teamToken}`);
    await p1.locator(tid('team-form')).waitFor({ timeout: 15_000 });
    await p1.locator(tid('team-mockup')).waitFor({ timeout: 20_000 });
    await p1.fill(tid('team-name'), 'Nila');
    await p1.fill(tid('team-number'), '9');
    await p1.selectOption(tid('team-size'), 'S');
    await p1.fill(tid('team-contact'), '9000000009');
    await p1.click(tid('team-submit'));
    await p1.locator(tid('team-your-entry')).waitFor();
    await shot('17-team-player', p1);
    await p1.reload();
    await p1.locator(tid('team-your-entry')).waitFor();
    await p1.click(tid('team-edit'));
    await p1.selectOption(tid('team-size'), 'M');
    await p1.click(tid('team-submit'));
    await p1.locator(tid('team-your-entry')).waitFor();
    assert(/M × 1/.test(await p1.locator(tid('team-your-entry')).innerText()), 'edited size');
    // A second player (another browser) can't take number 9.
    const other = await browser.newContext();
    const p2 = await other.newPage();
    await p2.goto(`${WEB}/t/${teamToken}`);
    await p2.locator(tid('team-taken')).waitFor();
    await p2.fill(tid('team-name'), 'Vel');
    await p2.fill(tid('team-number'), '9');
    assert(/taken/.test(await p2.locator(tid('team-form')).innerText()), 'taken number warned');
    await p2.fill(tid('team-number'), '14');
    await p2.selectOption(tid('team-size'), 'L');
    await p2.click(tid('team-submit'));
    await p2.locator(tid('team-your-entry')).waitFor();
    await players.close();
    await other.close();
  });

  await step('team dashboard: remove, lock, reopen and checkout the team', async () => {
    await page.goto(`${WEB}/account/teams/${collectionId}`);
    await page.locator(tid('team-entries')).waitFor({ timeout: 10_000 });
    assert(await page.locator('[data-testid^="entry-remove-"]').count() === 2, 'two entries');
    await shot('18-team-dashboard');
    await page.locator('[data-testid^="entry-remove-"]').last().click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="entry-remove-"]').length === 1);
    await page.click(tid('team-lock'));
    await page.locator(tid('team-reopen')).waitFor();
    await page.click(tid('team-reopen'));
    await page.locator(tid('team-lock')).waitFor();
    await page.click(tid('team-checkout'));
    await page.waitForURL(/\/checkout/);
    await page.locator(tid('collection-banner')).waitFor();
    assert(await page.locator(tid('roster-name-0')).inputValue() === 'Nila', 'roster from the team list');
    await page.fill(tid('addr-line1'), '12 Anna Salai');
    await page.fill(tid('addr-city'), 'Chennai');
    await page.selectOption(tid('addr-state'), 'TN');
    await page.fill(tid('addr-pincode'), '600002');
    await page.locator(tid('price-total')).waitFor({ timeout: 20_000 });
    await page.click(tid('place-order'));
    await page.waitForURL(/\/pay/, { timeout: 60_000 });
    await page.click(tid('demo-pay'));
    await page.locator(tid('confirmation-number')).waitFor({ timeout: 30_000 });
    await page.goto(`${WEB}/account/teams/${collectionId}`);
    await page.waitForFunction(() => /Ordered/.test(document.querySelector('[data-testid="team-status"]')?.textContent || ''), null, { timeout: 10_000 });
  });

  // ------------------------------------------------------------------ sales quote
  await step('sales quote from the ops API is accepted on the web', async () => {
    const { token } = await api('ops/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    const customer = await api('ops/customers', { method: 'POST', token, body: { name: 'Priya Club', phone: phone(50), email: 'club@example.com' } });
    const gen = await api('designs/generate', { method: 'POST', body: { prompt: 'Teal volleyball jersey with ocean waves', garment: 'jersey', sport: 'volleyball', team_name: 'Wave Riders', player_name: '', number: '', locked_colors: [], variants: 1, language: 'en' } });
    const q = await api('ops/quotes', {
      method: 'POST', token, body: {
        customer_id: customer.id, title: 'Wave Riders season kit', spec: gen.designs[0].spec, design_id: gen.designs[0].id,
        garment: 'jersey', fabric: 'standard', lines: [{ size: 'M', quantity: 12, player_name: '', number: '' }, { size: 'L', quantity: 8, player_name: '', number: '' }],
        delivery: { method: 'ship', pincode: '560001', state: 'KA' }, extra_discount: 500, message: 'As discussed on the phone. Thank you!',
      },
    });
    const sent = await api(`ops/quotes/${q.id}/send`, { method: 'POST', token });
    await page.goto(`${WEB}${sent.path}`);
    await page.locator(tid('quote-price')).waitFor({ timeout: 15_000 });
    await page.locator(tid('quote-price-sales_discount')).waitFor();
    assert(/Valid until/.test(await page.locator(tid('quote-valid')).innerText()), 'validity shown');
    await page.fill(tid('quote-addr-line1'), '4 MG Road');
    await page.fill(tid('quote-addr-city'), 'Bengaluru');
    await page.fill(tid('quote-addr-pincode'), '560001');
    await shot('19-quote');
    await page.click(tid('quote-accept'));
    await page.waitForURL(/\/order\/[^/]+$/, { timeout: 60_000 });
    await page.locator(tid('confirmation-number')).waitFor();
    await shot('20-quote-accepted');
  });

  // ------------------------------------------------------------------ guest: shared link, pickup, tracking
  await step('guest: shared design link, single piece with pickup, tracking', async () => {
    const guest = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const g = await guest.newPage();
    g.on('pageerror', (e) => consoleErrors.push(String(e)));
    await g.goto(designShareUrl);
    await g.locator(tid('shared-mockup')).waitFor({ timeout: 15_000 });
    await shot('21-shared-mobile', g);
    await g.click(tid('shared-open'));
    await g.waitForURL(/\/studio/);
    await g.locator(tid('order')).waitFor();
    await g.waitForFunction(() => !document.querySelector('[data-testid="order"]')?.hasAttribute('disabled'), null, { timeout: 30_000 });
    await g.click(tid('order'));
    await g.waitForURL(/\/checkout/);
    await g.selectOption(tid('single-size'), 'L');
    await g.fill(tid('single-qty'), '2');
    await g.click(tid('method-pickup'));
    await g.locator(tid('pickup-info')).waitFor();
    await g.click(tid('place-order'));
    await g.locator(tid('order-error')).waitFor();
    await g.fill(tid('cust-name'), 'Guest Kumar');
    await g.fill(tid('cust-phone'), phone(70));
    await g.locator(tid('price-total')).waitFor({ timeout: 20_000 });
    await shot('22-checkout-mobile', g);
    await g.click(tid('place-order'));
    await g.waitForURL(/\/pay/, { timeout: 60_000 });
    const gid = decodeURIComponent(g.url().split('/order/')[1].split('/')[0]);
    await g.click(tid('demo-pay'));
    await g.locator(tid('confirmation-number')).waitFor({ timeout: 30_000 });
    await g.goto(`${WEB}/track?order=${encodeURIComponent(gid)}`);
    await g.fill(tid('track-phone'), '9999999999');
    await g.click(tid('track-submit'));
    await g.locator(tid('track-error')).waitFor();
    await g.fill(tid('track-phone'), phone(70));
    await g.click(tid('track-submit'));
    await g.locator(tid('order-detail')).waitFor();
    await shot('23-track-mobile', g);
    await guest.close();
  });

  // ------------------------------------------------------------------ design from a picture
  await step('design from a picture: prompt, upload, three interpretations', async () => {
    await page.goto(`${WEB}/design/picture`);
    await page.locator(tid('outside-prompt')).waitFor();
    await page.click(tid('copy-prompt'));
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 600;
      c.height = 700;
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, 600, 700);
      x.fillStyle = '#0b3d91';
      x.beginPath();
      x.moveTo(150, 80); x.lineTo(450, 80); x.lineTo(560, 200); x.lineTo(480, 260); x.lineTo(450, 230);
      x.lineTo(450, 650); x.lineTo(150, 650); x.lineTo(150, 230); x.lineTo(120, 260); x.lineTo(40, 200); x.closePath();
      x.fill();
      x.fillStyle = '#f2a900';
      for (let i = 0; i < 6; i++) x.fillRect(150, 300 + i * 50, 300, 18);
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.setInputFiles(tid('picture-input'), { name: 'kit.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.locator(tid('picked-picture')).waitFor();
    await page.click(tid('recognise'));
    await page.locator(tid('picture-result')).waitFor({ timeout: 60_000 });
    assert(await page.locator('[data-testid="picture-result"] [data-testid^="design-"]').count() === 3, 'three interpretations');
    await shot('24-picture');
  });

  await step('not found page and no page errors', async () => {
    const res = await page.goto(`${WEB}/no-such-page`);
    assert(res.status() === 404, 'status 404');
    await page.locator(tid('not-found')).waitFor();
    assert(consoleErrors.length === 0, `page errors: ${consoleErrors.join('\n')}`);
    assert(overflow.length === 0, `horizontal overflow: ${overflow.join('; ')}`);
  });

  await browser.close();
  console.log(`\n${passed} steps passed.`);
}

main().catch((e) => {
  console.error(`\nE2E FAILED after ${passed} passing steps: ${e.message}`);
  process.exit(1);
});
