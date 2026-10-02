// End-to-end walk through the Unsattai web store with Playwright (Chromium).
//
//   npm run e2e
//
// Needs the store running (WEB_URL, default http://127.0.0.1:3100) against an API
// with its own database (API_URL, default http://127.0.0.1:8100) and the admin user
// from ADMIN_EMAIL / ADMIN_PASSWORD (sellers, shipping and the sales quote go
// through the ops API as that admin). Screenshots go to e2e/shots/.
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
function requirePackage(name) {
  try {
    return require(name);
  } catch (error) {
    if (!process.env.NODE_PATH) {
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      process.env.NODE_PATH = execFileSync(npm, ['root', '-g'], { encoding: 'utf8' }).trim();
      require('node:module')._initPaths();
    }
    try {
      return require(name);
    } catch {
      throw error;
    }
  }
}
const { chromium } = requirePackage('playwright');

const WEB = process.env.WEB_URL || 'http://127.0.0.1:3100';
const API = process.env.API_URL || 'http://127.0.0.1:8100';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@unsattai.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Adm1nPassword!';
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const run = Date.now().toString().slice(-5);
const phone = (n) => `98${run}${String(n).padStart(3, '0')}`;
const ORGANISER = phone(1);
// Sellers deliver everywhere except this PIN code (blocked for the house seller in the ops setup step).
const BLOCKED_PIN = '695001';
const PASSWORD = 'Strik3rs-Passw0rd';

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
  page.on('pageerror', (e) => consoleErrors.push(`${page.url()}: ${e}`));

  let orderId = '';
  let designShareUrl = '';
  let collectionId = '';
  let teamToken = '';
  let admin = '';
  let chennaiSeller = '';

  // ------------------------------------------------------------------ landing
  await step('landing shows garments with from-prices, tiers and contact', async () => {
    await page.goto(`${WEB}/`);
    await page.locator(tid('garment-card-jersey')).waitFor();
    const card = await page.locator(tid('garment-card-jersey')).innerText();
    assert(/₹/.test(card), `price on jersey card: ${card}`);
    assert(await page.locator('footer').innerText().then((t) => /Unsattai/.test(t)), 'footer brand');
    const title = await page.title();
    assert(/Unsattai/.test(title), 'page title');
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

  // ------------------------------------------------------------------ marketplace: PIN code, shop, product
  await step('ops setup: a second seller for Chennai and a blocked PIN code', async () => {
    // Staff do this in the ops app; here through the ops API as the admin.
    const { token } = await api('ops/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    admin = token;
    const seller = await api('ops/sellers', {
      method: 'POST', token, body: {
        name: `Chennai Quick Prints ${run}`, service_areas: [{ match: '600', transit_days: 1, cod: true }], price_adjust: 0.05,
      },
    });
    chennaiSeller = seller.id;
    const { seller: house } = await api('ops/sellers/sel_house', { token });
    for (const k of ['id', 'rating', 'created_at', 'updated_at', 'house']) delete house[k];
    await api('ops/sellers/sel_house', { method: 'PUT', token, body: { ...house, blocked_pincodes: [...new Set([...house.blocked_pincodes, BLOCKED_PIN])] } });
    // Only these two sellers may deliver to Chennai in this run.
    const { items } = await api('ops/sellers?status=active', { token });
    for (const x of items) {
      if (x.id !== 'sel_house' && x.id !== chennaiSeller) await api(`ops/sellers/${x.id}`, { method: 'DELETE', token }).catch(() => {});
    }
  });

  await step('Deliver to PIN code: invalid, not serviceable, then remembered', async () => {
    await page.goto(`${WEB}/`);
    await page.click(tid('pin-chip'));
    await page.locator(tid('pin-popover')).waitFor();
    await page.fill(tid('pin-input'), '012345');
    await page.click(tid('pin-apply'));
    assert(/valid 6-digit/.test(await page.locator(tid('pin-msg')).innerText()), 'invalid PIN code message');
    await page.fill(tid('pin-input'), BLOCKED_PIN);
    await page.click(tid('pin-apply'));
    await page.waitForFunction(() => /deliver to/.test(document.querySelector('[data-testid="pin-msg"]')?.textContent || ''), null, { timeout: 10_000 });
    await page.waitForFunction(() => /not deliverable/.test(document.querySelector('[data-testid="pin-chip-value"]')?.textContent || ''), null, { timeout: 10_000 });
    await shot('01b-pin-unserviceable');
    await page.fill(tid('pin-input'), '600001');
    await page.click(tid('pin-apply'));
    await page.locator(tid('pin-popover')).waitFor({ state: 'detached' });
    await page.waitForFunction(() => /600001.*Tamil Nadu/.test(document.querySelector('[data-testid="pin-chip-value"]')?.textContent || ''), null, { timeout: 10_000 });
    await page.reload();
    await page.waitForFunction(() => /600001/.test(document.querySelector('[data-testid="pin-chip-value"]')?.textContent || ''), null, { timeout: 10_000 });
    // Ready-made designs on the home page show delivery dates for the chosen PIN code.
    await page.locator(`${tid('home-products')} [data-testid^="delivery-"][data-state="ok"]`).first().waitFor({ timeout: 15_000 });
  });

  await step('shop: search, facets, sort and paging', async () => {
    await page.fill(tid('search-input'), 'strikers');
    await page.press(tid('search-input'), 'Enter');
    await page.waitForURL(/\/shop\?.*q=strikers/);
    await page.locator(tid('product-royal-strikers')).waitFor({ timeout: 15_000 });
    assert(/strikers/i.test(await page.locator('h1').innerText()), 'search title');
    await page.goto(`${WEB}/shop`);
    await page.locator(tid('product-grid')).waitFor({ timeout: 15_000 });
    const all = Number((await page.locator(tid('results-count')).innerText()).match(/\d+/)[0]);
    await page.click(tid('facet-sport-football'));
    await page.waitForURL(/sport=football/);
    await page.waitForFunction((n) => {
      const m = (document.querySelector('[data-testid="results-count"]')?.textContent || '').match(/\d+/);
      return m && Number(m[0]) < n;
    }, all, { timeout: 10_000 });
    const metas = await page.locator(`${tid('product-grid')} article`).allInnerTexts();
    assert(metas.every((x) => /Football/.test(x)), 'only football designs');
    await page.selectOption(tid('sort-select'), 'price_asc');
    await page.waitForURL(/sort=price_asc/);
    await page.waitForTimeout(500);
    const prices = (await page.locator(`${tid('product-grid')} article`).allInnerTexts())
      .map((x) => Number((x.match(/₹\s?([\d,]+(\.\d+)?)/) || [0, '0'])[1].replace(/,/g, '')));
    assert(prices.every((p, i) => i === 0 || p >= prices[i - 1]), `sorted by price: ${prices}`);
    await page.locator(`${tid('product-grid')} [data-testid^="delivery-"][data-state="ok"]`).first().waitFor({ timeout: 15_000 });
    await page.click(tid('clear-all'));
    await page.waitForURL((u) => !/sport=/.test(u.search));
    if (await page.locator(tid('page-next')).count() && await page.locator(tid('page-next')).isEnabled()) {
      await page.click(tid('page-next'));
      await page.waitForURL(/page=2/);
      await page.locator(`${tid('product-grid')} article`).first().waitFor();
    }
    await page.goto(`${WEB}/shop?q=zzzqqq`);
    await page.locator(tid('shop-empty')).waitFor({ timeout: 15_000 });
    await page.goto(`${WEB}/shop`);
    await page.locator(tid('product-grid')).waitFor({ timeout: 15_000 });
    await shot('01c-shop');
  });

  await step('product: colourway, long sleeves, delivery date, other sellers, size and add to cart', async () => {
    assert(await page.locator(`${tid('colourways-royal-strikers')} span`).count() >= 2, 'colourway swatches on the product card');
    await page.click(tid('product-link-royal-strikers'));
    await page.waitForURL(/\/shop\/royal-strikers/);
    await page.locator(tid('product-title')).waitFor();
    assert(/₹/.test(await page.locator(tid('product-price')).innerText()), 'price from');
    await page.waitForFunction(() => /Delivery by .*Sold by/s.test(document.querySelector('[data-testid="product-delivery"]')?.textContent || ''), null, { timeout: 15_000 });
    assert(/Chennai Quick Prints/.test(await page.locator(tid('product-delivery')).innerText()), 'fastest seller recommended');
    await page.locator(tid('offer-list')).waitFor();
    assert(await page.locator(`${tid('offer-list')} li`).count() === 2, 'two sellers deliver to 600001');
    await page.click(tid('offer-sel_house'));
    await page.waitForFunction(() => /Sold by Unsattai/.test(document.querySelector('[data-testid="product-delivery"]')?.textContent || ''), null, { timeout: 10_000 });
    // A colourway other than the original, with long sleeves: the picture follows both.
    await page.click(tid('colourway-midnight-volt'));
    await page.click(tid('product-opt-sleeves-long'));
    assert(/\+₹60/.test(await page.locator(tid('product-opt-sleeves-long')).innerText()), 'long sleeves show +₹60');
    assert(/−₹20/.test(await page.locator(tid('product-opt-sleeves-none')).innerText()), 'sleeveless shows −₹20');
    assert(!/₹/.test(await page.locator(tid('product-opt-sleeves-short')).innerText()), 'no price shown for short sleeves');
    await page.waitForFunction(() => {
      const src = document.querySelector('[data-testid="product-mockup"]')?.getAttribute('src') || '';
      return /mockup\.svg\?/.test(src) && /colourway=midnight-volt/.test(src) && /sleeves=long/.test(src);
    }, null, { timeout: 10_000 });
    assert(/Midnight Volt/.test(await page.locator(tid('colourway-name')).innerText()), 'colourway named');
    const mock = await page.evaluate(async () => {
      const r = await fetch(document.querySelector('[data-testid="product-mockup"]').getAttribute('src'));
      return { ok: r.ok, type: r.headers.get('content-type') || '' };
    });
    assert(mock.ok && /svg/.test(mock.type), `mockup with options served: ${JSON.stringify(mock)}`);
    await page.click(tid('product-size-chart'));
    await page.locator(`${tid('product-size-chart-dialog')} table`).waitFor({ timeout: 10_000 });
    assert(/Sleeve \(long\)/.test(await page.locator(`${tid('product-size-chart-dialog')} thead`).innerText()), 'long sleeve column in the guide');
    await page.keyboard.press('Escape');
    await page.click(tid('add-to-cart'));
    await page.locator(tid('size-error')).waitFor();
    await page.click(tid('size-M'));
    await page.click(tid('add-to-cart'));
    await page.locator(tid('added-to-cart')).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="cart-count"]')?.textContent?.trim() === '1');
    // A PIN code the sellers can't reach says so on the product page.
    await page.click(tid('product-pin-change'));
    await page.fill(tid('product-pin-input'), BLOCKED_PIN);
    await page.click(tid('product-pin-apply'));
    await page.waitForFunction(() => /Not deliverable/.test(document.querySelector('[data-testid="product-delivery"]')?.textContent || ''), null, { timeout: 10_000 });
    await page.fill(tid('product-pin-input'), '600001');
    await page.click(tid('product-pin-apply'));
    await page.waitForFunction(() => /Delivery by/.test(document.querySelector('[data-testid="product-delivery"]')?.textContent || ''), null, { timeout: 10_000 });
    await page.keyboard.press('Escape');
    await shot('01d-product');
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

  await step('studio: sleeveless with a polo collar keeps every layer printable', async () => {
    await page.click(tid('tab-style'));
    await page.locator(tid('studio-opt')).waitFor();
    assert(/\+₹90/.test(await page.locator(tid('studio-opt-collar-polo')).innerText()), 'polo shows +₹90');
    await page.click(tid('studio-opt-sleeves-none'));
    await page.click(tid('studio-opt-collar-polo'));
    assert(await page.locator(`${tid('studio-opt-sleeves-none')} input`).isChecked(), 'sleeveless chosen');
    assert(await page.locator(`${tid('studio-opt-collar-polo')} input`).isChecked(), 'polo chosen');
    await page.waitForFunction(() => !document.querySelector('[data-testid="panel-sleeve_left"]') && /Sleeveless/.test(document.querySelector('[data-testid="panel-note"]')?.textContent || ''), null, { timeout: 30_000 });
    assert(/placket/.test(await page.locator(tid('panel-note')).innerText()), 'polo placket note on the front');
    // Narrower zone: the layers were refitted, so the server's checks still pass.
    await page.click(tid('tab-checks'));
    await page.waitForFunction(() => /✓/.test(document.querySelector('[data-testid="studio-status"]')?.textContent || ''), null, { timeout: 30_000 });
    await shot('06b-studio-sleeveless-polo');
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

  // ------------------------------------------------------------------ configure, cart and checkout
  await step('configure: team roster, paste, CSV, duplicates and size chart', async () => {
    await page.click(tid('order'));
    await page.waitForURL(/\/configure/);
    await page.locator(tid('screen-configure')).waitFor();
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
    // A women's line and a kids' line: the size list follows the fit.
    await page.selectOption(tid('roster-fit-1'), 'women');
    await page.selectOption(tid('roster-fit-5'), 'kids');
    assert(await page.locator(`${tid('roster-size-5')} option[value="8Y"]`).count() === 1, 'kids sizes offered');
    assert(await page.locator(`${tid('roster-size-5')} option[value="XL"]`).count() === 0, 'no adult sizes for kids');
    assert(/Y$/.test(await page.locator(tid('roster-size-5')).inputValue()), 'kids line has a kids size');
    await page.selectOption(tid('roster-size-5'), '10Y');
    await page.click(tid('size-chart'));
    await page.locator(tid('size-chart-dialog')).locator('table').waitFor();
    const head = await page.locator(`${tid('size-chart-dialog')} thead`).innerText();
    assert(/Chest/.test(head) && /Length/.test(head) && /Shoulder/.test(head) && /Fits chest/.test(head) && !/Sleeve/.test(head), `sleeveless guide columns: ${head}`);
    await page.click(tid('size-chart-dialog-view-fit-kids'));
    await page.waitForFunction(() => /Height/.test(document.querySelector('[data-testid="size-chart-dialog"] thead')?.textContent || ''));
    assert(/How to measure/.test(await page.locator(tid('size-chart-dialog')).innerText()), 'how to measure');
    assert(/±?1 cm|1 cm/.test(await page.locator(tid('size-chart-dialog')).innerText()), 'tolerance shown');
    await shot('08a-size-guide');
    await page.keyboard.press('Escape');
    await page.locator(tid('size-chart-dialog')).waitFor({ state: 'hidden' });
    const total = await page.locator(tid('roster-total')).innerText();
    assert(/7/.test(total), `total pieces: ${total}`);
  });

  await step('configure: bulk enquiry offered above 50 pieces', async () => {
    await page.fill(tid('roster-qty-0'), '60');
    await page.locator(tid('bulk-banner')).waitFor();
    await page.fill(tid('roster-qty-0'), '1');
    await page.locator(tid('bulk-banner')).waitFor({ state: 'detached' });
  });

  await step('configure: fabric, live price, delivery date and add to cart', async () => {
    await page.locator(tid('price-total')).waitFor({ timeout: 20_000 });
    const before = await page.locator(tid('price-total')).innerText();
    await page.locator(tid('fabric-premium')).click();
    await page.waitForFunction((b) => {
      const x = document.querySelector('[data-testid="price-total"]')?.textContent;
      return x && x !== b;
    }, before, { timeout: 15_000 });
    for (const k of ['subtotal', 'shipping', 'tax', 'per-piece']) await page.locator(tid(`price-${k}`)).waitFor();
    assert((await page.locator(tid('price-line')).count()) >= 5, 'per-line prices');
    // The sleeveless and polo parts, and the kids' reduction, show in the breakdown.
    const parts = (await page.locator(tid('price-line-parts')).allInnerTexts()).join(' | ');
    assert(/Sleeveless/.test(parts) && /Polo/.test(parts) && /Kids/.test(parts), `option parts: ${parts}`);
    assert(/Sleeveless/.test(await page.locator(tid('configure-options')).innerText()), 'options on the configure page');
    await page.waitForFunction(() => /Delivery by/.test(document.querySelector('[data-testid="configure-delivery"]')?.textContent || ''), null, { timeout: 15_000 });
    assert(/Sold by/.test(await page.locator(tid('configure-seller')).innerText()), 'seller shown');
    await shot('08-configure');
    await page.click(tid('add-to-cart'));
    await page.locator(tid('added-to-cart')).waitFor();
    // The ready-made jersey added as a guest was merged into the account's cart at sign-in.
    await page.waitForFunction(() => document.querySelector('[data-testid="cart-count"]')?.textContent?.trim() === '2', null, { timeout: 10_000 });
  });

  await step('cart: ready-made and custom design, one delivery charge per seller', async () => {
    await page.click(tid('nav-cart'));
    await page.waitForURL(/\/cart/);
    await page.locator(tid('cart-item-1')).waitFor({ timeout: 15_000 });
    await page.waitForFunction(() => /Royal Strikers/.test(document.querySelector('[data-testid="cart-items"]')?.textContent || ''), null, { timeout: 15_000 });
    const rows = await page.locator(`${tid('cart-items')} > li`).allInnerTexts();
    assert(rows.some((x) => /Royal Strikers/.test(x)) && rows.some((x) => /7 pieces/.test(x)), `cart rows: ${rows.join(' | ')}`);
    const ready = rows.find((x) => /Royal Strikers/.test(x));
    assert(/Midnight Volt/.test(ready) && /Long sleeves/.test(ready), `ready-made options in the cart: ${ready}`);
    const custom = rows.find((x) => /7 pieces/.test(x));
    assert(/Sleeveless/.test(custom) && /Polo/.test(custom) && /Kids/.test(custom) && /Women/.test(custom), `custom options and fits in the cart: ${custom}`);
    await page.waitForFunction(() => /Sold by Unsattai/.test(document.body.textContent || '') && /Sold by Chennai Quick Prints/.test(document.body.textContent || ''), null, { timeout: 15_000 });
    await page.locator(tid('cart-totals-total')).waitFor({ timeout: 15_000 });
    // The server's cart quote: one delivery charge per seller, summed in the totals.
    const [req, same] = await page.evaluate(async () => {
      const cart = await (await fetch('/api/unsattai/me/cart')).json();
      const quote = async (items) => (await fetch('/api/unsattai/shop/cart/quote', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items, delivery: { method: 'ship', pincode: '600001', state: '' }, coupon: '', rush: false, payment_method: 'online' }),
      })).json();
      return [await quote(cart.items), await quote(cart.items.map((i) => ({ ...i, seller_id: 'sel_house' })))];
    });
    // Both items from one seller: one charge on the first item, the other travels with it.
    assert(same.items.every((i) => i.quote.shipping.combined) && same.items.filter((i) => i.quote.shipping.amount > 0).length <= 1,
      `same seller: one combined charge (${same.items.map((i) => i.quote.shipping.amount)})`);
    const sellers = new Set(req.items.map((i) => i.seller?.id));
    assert(sellers.size === 2, `two sellers: ${[...sellers]}`);
    const perSeller = req.items.reduce((m, i) => m.set(i.seller.id, (m.get(i.seller.id) ?? 0) + i.quote.shipping.amount), new Map());
    assert(Math.abs([...perSeller.values()].reduce((a, b) => a + b, 0) - req.totals.shipping) < 0.01, 'shipping = sum per seller');
    assert(/2 sellers/.test(await page.locator(tid('cart-totals-shipping')).innerText()), 'delivery charge per seller in the summary');
    // Quantity of the ready-made item.
    const idx = rows.findIndex((x) => /Royal Strikers/.test(x));
    const beforeTotal = await page.locator(tid('cart-totals-total')).innerText();
    await page.click(tid(`cart-qty-${idx}-plus`));
    await page.waitForFunction((b) => document.querySelector('[data-testid="cart-totals-total"]')?.textContent !== b, beforeTotal, { timeout: 15_000 });
    await page.locator(tid('offer-WELCOME10')).waitFor({ timeout: 10_000 });
    await shot('08b-cart');
    await page.click(tid('proceed-checkout'));
    await page.waitForURL(/\/checkout$/);
  });

  await step('checkout: address, dates by seller, express, offers and live price', async () => {
    await page.locator(tid('screen-checkout')).waitFor();
    assert(/Signed in as/.test(await page.locator(tid('signed-in-as')).innerText()), 'signed in at checkout');
    await page.fill(tid('addr-line1'), '12 Anna Salai');
    await page.fill(tid('addr-city'), 'Chennai');
    await page.selectOption(tid('addr-state'), 'TN');
    await page.fill(tid('addr-pincode'), '600002');
    await page.locator(tid('price-total')).waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="seller-group-"]').length === 2, null, { timeout: 15_000 });
    assert(await page.locator(tid('group-shipping')).count() === 2, 'a delivery charge line per seller');
    const before = await page.locator(tid('price-total')).innerText();
    await page.check(tid('express-toggle'));
    await page.waitForFunction(() => /Adds \d+%/.test(document.querySelector('[data-testid="express-dates"]')?.textContent || ''), null, { timeout: 15_000 });
    await page.locator(tid('price-rush')).waitFor({ timeout: 15_000 });
    await page.click(tid('offer-apply-WELCOME10'));
    await page.locator(tid('coupon-ok')).waitFor({ timeout: 15_000 });
    await page.locator(tid('price-coupon')).waitFor();
    await page.waitForTimeout(600);
    const after = await page.locator(tid('price-total')).innerText();
    assert(before !== after, `price updated (${before} -> ${after})`);
    for (const k of ['subtotal', 'shipping', 'tax', 'saved']) await page.locator(tid(`price-${k}`)).waitFor();
    assert(/Demo: no money is taken/.test(await page.locator(tid('demo-label')).innerText()), 'demo label');
    await page.locator(tid('pay-cod')).waitFor();
    await shot('08c-checkout');
  });

  let checkoutRequest = null;
  let checkoutId = '';
  let productOrderId = '';
  await step('place order online, demo payment and confirmation with invoice', async () => {
    const req = page.waitForRequest((r) => r.url().endsWith('/api/unsattai/checkout') && r.method() === 'POST');
    await page.click(tid('place-order'));
    checkoutRequest = (await req).postDataJSON();
    assert(checkoutRequest.channel === 'web' && checkoutRequest.payment_method === 'online' && checkoutRequest.items.length === 2, 'web checkout of two items');
    const readyItem = checkoutRequest.items.find((i) => i.product_id);
    assert(readyItem.colourway === 'midnight-volt' && readyItem.sleeves === 'long', `ready-made choices sent: ${JSON.stringify(readyItem)}`);
    assert(readyItem.lines.every((l) => l.fit === 'men'), 'every line sends its fit');
    const designItem = checkoutRequest.items.find((i) => !i.product_id);
    const fits = designItem.lines.map((l) => `${l.fit}:${l.size}`);
    assert(fits.includes('women:S') && fits.includes('kids:10Y'), `women and kids lines sent: ${fits}`);
    await page.waitForURL(/\/checkout\/[^/]+\/pay/, { timeout: 60_000 });
    checkoutId = decodeURIComponent(page.url().split('/checkout/')[1].split('/')[0]);
    await page.locator(tid('demo-box')).waitFor();
    await shot('09-pay');
    await page.click(tid('demo-pay'));
    await page.waitForURL(/\/checkout\/[^/]+(\?.*)?$/, { timeout: 30_000 });
    await page.locator(tid('checkout-number')).waitFor();
    assert(await page.locator('[data-testid^="checkout-order-ord"]').count() === 2, 'one order per item');
    const ck = await page.evaluate(async (id) => (await fetch(`/api/unsattai/checkouts/${id}`)).json(), checkoutId);
    assert(ck.status === 'paid', `checkout paid: ${ck.status}`);
    orderId = ck.orders.find((o) => !o.product_id).id;
    productOrderId = ck.orders.find((o) => o.product_id).id;
    const [designOrder, productOrder] = await page.evaluate(async (ids) => Promise.all(ids.map(async (id) => (await fetch(`/api/unsattai/orders/${encodeURIComponent(id)}`)).json())), [orderId, productOrderId]);
    const lineFits = (o) => (o.items ?? o.lines ?? []).map((l) => `${l.fit ?? 'men'}:${l.size}`);
    assert(lineFits(designOrder).includes('women:S') && lineFits(designOrder).includes('kids:10Y'), `order lines keep their fits: ${lineFits(designOrder)}`);
    assert(designOrder.options?.sleeves === 'none' && designOrder.options?.collar === 'polo', `design order options: ${JSON.stringify(designOrder.options)}`);
    assert(productOrder.options?.sleeves === 'long', `product order options: ${JSON.stringify(productOrder.options)}`);
    const href = await page.locator(tid('checkout-invoice')).first().getAttribute('href');
    // Fetched from the page, like the customer's click: it carries the browser's session and device cookies,
    // which the API needs to show an order to its owner.
    const inv = await page.evaluate(async (u) => {
      const r = await fetch(u);
      return { ok: r.ok, type: r.headers.get('content-type') ?? '', text: await r.text() };
    }, href);
    assert(inv.ok && /html/.test(inv.type), 'invoice through the proxy');
    assert(/Invoice|INVOICE|invoice/.test(inv.text), 'invoice content');
    await page.waitForFunction(() => !document.querySelector('[data-testid="cart-count"]'), null, { timeout: 10_000 });
    await shot('10-confirmation');
  });

  await step('same checkout key is not placed twice; staff API not exposed', async () => {
    // Replaying the exact checkout request with its idempotency key returns the same checkout.
    const again = await page.evaluate(async (body) => {
      const r = await fetch('/api/unsattai/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, data: await r.json() };
    }, checkoutRequest);
    assert(again.status === 200 && again.data.id === checkoutId && again.data.duplicate === true, `idempotent replay: ${again.status} ${again.data.id}`);
    const blocked = await page.request.get(`${WEB}/api/unsattai/ops/orders`);
    assert(blocked.status() === 404 || blocked.status() === 403, `ops API not exposed: ${blocked.status()}`);
    const verify = await page.request.post(`${WEB}/api/unsattai/auth/login`, { data: { identifier: ORGANISER, password: 'x' }, headers: { origin: WEB } });
    assert(verify.status() === 404 || verify.status() === 403, `password login only through the session route: ${verify.status()}`);
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
    const opts = await page.locator(tid('order-options')).innerText();
    assert(/Sleeveless/.test(opts) && /Polo/.test(opts), `order options: ${opts}`);
    const detail = await page.locator(tid('order-detail')).innerText();
    assert(/Women/.test(detail) && /Kids/.test(detail) && /10Y/.test(detail), 'order lines show fit and size');
    await shot('12-account-order');
    await page.click(tid('order-again'));
    await page.waitForURL(/\/configure/);
    await page.locator(tid('roster-row-5')).waitFor({ timeout: 10_000 });
    const againFits = await page.evaluate(() => [...document.querySelectorAll('select[data-testid^="roster-fit-"]')].map((e) => e.value));
    assert(againFits.includes('kids') && againFits.includes('women'), `order again keeps the fits: ${againFits}`);
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

  // ------------------------------------------------------------------ marketplace account: wishlist, COD, after-sales
  await step('wishlist: heart a design in the shop, list and remove it', async () => {
    await page.goto(`${WEB}/shop`);
    await page.locator(tid('product-grid')).waitFor({ timeout: 15_000 });
    const heart = page.locator(`${tid('product-grid')} [data-testid^="wish-"]`).first();
    const wid = await heart.getAttribute('data-testid');
    await heart.click();
    await page.waitForFunction((id) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('aria-pressed') === 'true', wid, { timeout: 10_000 });
    await page.goto(`${WEB}/account/wishlist`);
    await page.locator(`${tid('wishlist-grid')} article`).first().waitFor({ timeout: 15_000 });
    await shot('15b-wishlist');
    await page.locator(`${tid('wishlist-grid')} ${tid(wid)}`).click();
    await page.locator(tid('wishlist-empty')).waitFor({ timeout: 10_000 });
  });

  await step('cash on delivery: buy now with the COD fee, then cancel the order', async () => {
    await page.goto(`${WEB}/shop/royal-strikers`);
    await page.locator(tid('product-title')).waitFor();
    await page.click(tid('size-L'));
    await page.click(tid('buy-now'));
    await page.waitForURL(/\/checkout\?buy=1/);
    await page.locator(tid('address-book')).waitFor({ timeout: 15_000 });
    assert(await page.locator(`${tid('saved-address-0')} input`).isChecked(), 'default address chosen');
    await page.locator(tid('price-total')).waitFor({ timeout: 20_000 });
    await page.click(tid('pay-cod'));
    await page.locator(tid('price-cod')).waitFor({ timeout: 15_000 });
    assert(/on delivery/.test(await page.locator(tid('place-order')).innerText()), 'COD button');
    await shot('15c-checkout-cod');
    await page.click(tid('place-order'));
    await page.waitForURL(/\/checkout\/[^/?]+$/, { timeout: 60_000 });
    await page.locator(tid('checkout-number')).waitFor();
    assert(/cash/i.test(await page.locator(tid('screen-checkout-done')).innerText()), 'pay in cash note');
    const link = page.locator('[data-testid^="checkout-order-ord"] a').first();
    const codOrder = (await page.locator('[data-testid^="checkout-order-ord"]').first().getAttribute('data-testid')).replace('checkout-order-', '');
    await page.goto(`${WEB}/account/orders/${encodeURIComponent(codOrder)}`);
    await page.locator(tid('order-payment')).waitFor({ timeout: 15_000 });
    await page.click(tid('order-cancel'));
    await page.locator(tid('cancel-dialog')).waitFor();
    await page.selectOption(tid('cancel-reason'), 'cancel_ordered_twice');
    await page.click(tid('cancel-confirm'));
    await page.waitForFunction(() => /cancelled/.test(document.querySelector('[data-testid="order-msg"]')?.textContent || ''), null, { timeout: 15_000 });
    assert(!(await page.locator(tid('order-cancel')).count()), 'no second cancel');
    void link;
  });

  await step('delivered order: ops ships it; customer tracks, returns and reviews', async () => {
    // The seller's staff move the order through production and delivery (ops API).
    for (let i = 0; i < 12; i++) {
      const { order } = await api(`ops/orders/${productOrderId}`, { token: admin });
      const next = order.fulfilment.stages.find((st) => !st.done_at);
      if (!next) break;
      await api(`ops/orders/${productOrderId}/stages/${next.id}`, { method: 'POST', token: admin });
    }
    const shp = await api(`ops/orders/${productOrderId}/shipments`, { method: 'POST', token: admin, body: { carrier: 'surface', tracking_no: `SRF${run}` } });
    const sid = shp.id ?? shp.shipment?.id;
    await api(`ops/shipments/${sid}`, { method: 'PATCH', token: admin, body: { status: 'dispatched' } });
    await page.goto(`${WEB}/account/orders/${encodeURIComponent(productOrderId)}`);
    await page.locator(tid('shipment-details')).waitFor({ timeout: 15_000 });
    assert(new RegExp(`SRF${run}`).test(await page.locator(tid('tracking-no')).innerText()), 'tracking number');
    assert(/Dispatched with Surface courier/.test(await page.locator(tid('order-timeline')).innerText()), 'dispatch in the timeline');
    await api(`ops/shipments/${sid}`, { method: 'PATCH', token: admin, body: { status: 'delivered' } });
    await page.reload();
    await page.locator(tid('return-window')).waitFor({ timeout: 15_000 });
    await shot('15d-delivered');
    await page.click(tid('order-return'));
    await page.locator(tid('return-dialog')).waitFor();
    await page.locator(tid('return-deadline')).waitFor();
    await page.click(tid('return-submit'));
    await page.waitForFunction(() => /Choose a reason/.test(document.querySelector('[data-testid="return-dialog"]')?.textContent || ''), null, { timeout: 5000 });
    await page.selectOption(tid('return-reason'), 'print_quality');
    await page.fill(tid('return-details'), 'The number is cracked after one wash.');
    await page.click(tid('return-submit'));
    await page.waitForFunction(() => /Return requested/.test(document.querySelector('[data-testid="order-msg"]')?.textContent || ''), null, { timeout: 15_000 });
    await page.locator(tid('return-record')).waitFor({ timeout: 10_000 });
    await page.click(tid('order-review-btn'));
    await page.locator(tid('review-dialog')).waitFor();
    await page.click(tid('review-stars-4'));
    await page.fill(tid('review-title'), 'Great colours');
    await page.fill(tid('review-body'), 'Colours are bright and the fit is good. Delivery was on time.');
    await page.click(tid('review-submit'));
    await page.waitForFunction(() => /Thank you for your review/.test(document.querySelector('[data-testid="order-msg"]')?.textContent || ''), null, { timeout: 15_000 });
    await page.locator(tid('order-review')).waitFor({ timeout: 10_000 });
    await shot('15e-return-review');
    const reviews = await api('shop/products/royal-strikers/reviews');
    assert(reviews.items.some((r) => r.title === 'Great colours'), 'review public on the product');
  });

  await step('notifications: bell with unread count, list and mark all read', async () => {
    await page.goto(`${WEB}/account`);
    await page.locator(tid('bell-count')).waitFor({ timeout: 20_000 });
    await page.click(tid('nav-bell'));
    await page.locator(tid('bell-popover')).waitFor();
    await page.locator(`${tid('bell-list')} li`).first().waitFor({ timeout: 10_000 });
    await shot('15f-bell');
    await page.click(tid('bell-read-all'));
    await page.locator(tid('bell-count')).waitFor({ state: 'detached', timeout: 10_000 });
    await page.keyboard.press('Escape');
    await page.goto(`${WEB}/account/notifications`);
    await page.locator(`${tid('notifications-list')} li`).first().waitFor({ timeout: 10_000 });
  });

  await step('security: set a password, sign in with it elsewhere, sign that device out', async () => {
    await page.goto(`${WEB}/account/security`);
    await page.locator(tid('password-card')).waitFor({ timeout: 15_000 });
    await page.fill(tid('password-new'), 'short');
    await page.fill(tid('password-again'), 'short');
    await page.click(tid('password-save'));
    await page.waitForFunction(() => /too weak/.test(document.querySelector('[data-testid="password-card"]')?.textContent || ''));
    await page.fill(tid('password-new'), PASSWORD);
    await page.fill(tid('password-again'), PASSWORD);
    await page.click(tid('password-save'));
    await page.waitForFunction(() => /Password saved/.test(document.querySelector('[data-testid="password-msg"]')?.textContent || ''), null, { timeout: 10_000 });
    // Another browser signs in with the mobile number and the password.
    const other = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const o = await other.newPage();
    await o.goto(`${WEB}/signin`);
    await o.click(tid('otp-use-password'));
    await o.fill(tid('otp-phone'), ORGANISER);
    await o.fill(tid('otp-password'), 'Wrong-Passw0rd');
    await o.click(tid('otp-login'));
    assert(/not right/.test(await o.locator(tid('otp-error')).innerText()), 'wrong password message');
    await o.fill(tid('otp-password'), PASSWORD);
    await o.click(tid('otp-login'));
    await o.waitForURL(/\/account/, { timeout: 15_000 });
    await o.locator(tid('nav-account')).waitFor();
    await shot('15g-password-signin-mobile', o);
    // The first browser sees two devices and signs the other one out.
    await page.reload();
    await page.locator(tid('session-other')).first().waitFor({ timeout: 15_000 });
    await shot('15h-security');
    await page.locator(`${tid('session-other')} [data-testid^="session-drop-"]`).first().click();
    await page.waitForFunction(() => /signed out/.test(document.querySelector('[data-testid="sessions-msg"]')?.textContent || ''), null, { timeout: 10_000 });
    await o.goto(`${WEB}/account`);
    await o.locator(tid('otp')).waitFor({ timeout: 15_000 });
    await other.close();
  });

  await step('email sign-in with a code, verify a mobile number, password lockout', async () => {
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const e = await ctx2.newPage();
    e.on('pageerror', (x) => consoleErrors.push(String(x)));
    const email = `e2e${run}@example.com`;
    await e.goto(`${WEB}/signin`);
    await e.click(tid('otp-channel-email'));
    await e.fill(tid('otp-name'), 'Esha Email');
    await e.fill(tid('otp-email'), email);
    await e.click(tid('otp-send'));
    const code = (await e.locator(tid('otp-dev-code')).textContent({ timeout: 10_000 })).trim();
    await e.fill(tid('otp-code'), code);
    await e.click(tid('otp-verify'));
    await e.waitForURL(/\/account/, { timeout: 15_000 });
    await e.goto(`${WEB}/account/security`);
    await e.locator(tid('ident-email-card')).waitFor({ timeout: 15_000 });
    assert(/Verified/.test(await e.locator(tid('ident-email-status')).innerText()), 'email verified');
    await e.click(tid('ident-phone-edit'));
    await e.fill(tid('ident-phone-input'), phone(80));
    await e.click(tid('ident-phone-send'));
    const pcode = (await e.locator(tid('ident-phone-dev-code')).textContent({ timeout: 10_000 })).trim();
    await e.fill(tid('ident-phone-code'), pcode);
    await e.click(tid('ident-phone-verify'));
    await e.waitForFunction(() => /Verified/.test(document.querySelector('[data-testid="ident-phone-status"]')?.textContent || ''), null, { timeout: 10_000 });
    await shot('15i-security-mobile', e);
    await ctx2.close();
    // Wrong passwords lock password sign-in; the customer is offered a code instead.
    const ctx3 = await browser.newContext();
    const l = await ctx3.newPage();
    await l.goto(`${WEB}/signin`);
    await l.click(tid('otp-channel-email'));
    await l.click(tid('otp-use-password'));
    await l.fill(tid('otp-email'), email);
    let locked = false;
    for (let i = 0; i < 8 && !locked; i++) {
      await l.fill(tid('otp-password'), `Wrong-Passw0rd${i}`);
      await l.click(tid('otp-login'));
      await l.waitForFunction((n) => {
        const el = document.querySelector('[data-testid="otp-error"]');
        return el && el.getAttribute('data-try') !== String(n) && !document.querySelector('[data-testid="otp-login"][aria-busy="true"]');
      }, i, { timeout: 10_000 }).catch(() => {});
      await l.waitForTimeout(300);
      locked = /locked/.test(await l.locator(tid('otp-error')).innerText());
    }
    assert(locked, 'password sign-in locked after wrong passwords');
    await shot('15j-lockout', l);
    await l.locator(tid('otp-error')).locator('button').click();
    await l.locator(tid('otp-send')).waitFor();
    await ctx3.close();
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
    // A kids' entry: the fit changes the sizes offered.
    await p2.selectOption(tid('team-fit'), 'kids');
    assert(await p2.locator(`${tid('team-size')} option[value="L"]`).count() === 0, 'no adult sizes for kids');
    await p2.selectOption(tid('team-size'), '12Y');
    await p2.click(tid('team-size-guide'));
    await p2.locator(`${tid('team-size-guide-dialog')} table`).waitFor({ timeout: 10_000 });
    assert(/Height/.test(await p2.locator(`${tid('team-size-guide-dialog')} thead`).innerText()), 'kids guide opens on kids');
    await p2.keyboard.press('Escape');
    await p2.click(tid('team-submit'));
    await p2.locator(tid('team-your-entry')).waitFor();
    assert(/Kids/.test(await p2.locator(tid('team-your-entry')).innerText()) && /12Y/.test(await p2.locator(tid('team-your-entry')).innerText()), 'kids entry shown');
    await players.close();
    await other.close();
  });

  await step('team dashboard: remove, lock, reopen and checkout the team', async () => {
    await page.goto(`${WEB}/account/teams/${collectionId}`);
    await page.locator(tid('team-entries')).waitFor({ timeout: 10_000 });
    assert(await page.locator('[data-testid^="entry-remove-"]').count() === 2, 'two entries');
    assert(/Kids/.test(await page.locator(tid('team-entries')).innerText()), 'fit shown on the dashboard');
    await shot('18-team-dashboard');
    await page.locator('[data-testid^="entry-remove-"]').last().click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="entry-remove-"]').length === 1);
    await page.click(tid('team-lock'));
    await page.locator(tid('team-reopen')).waitFor();
    await page.click(tid('team-reopen'));
    await page.locator(tid('team-lock')).waitFor();
    await page.click(tid('team-checkout'));
    await page.waitForURL(/\/configure/);
    await page.locator(tid('collection-banner')).waitFor();
    assert(await page.locator(tid('roster-name-0')).inputValue() === 'Nila', 'roster from the team list');
    await page.locator(tid('price-total')).waitFor({ timeout: 20_000 });
    // A team list is ordered on its own (Buy now), to the saved address.
    await page.click(tid('buy-now'));
    await page.waitForURL(/\/checkout\?buy=1/);
    await page.locator(tid('collection-banner')).waitFor();
    await page.locator(tid('address-book')).waitFor({ timeout: 15_000 });
    await page.locator(tid('price-total')).waitFor({ timeout: 20_000 });
    // The last payment method (cash on delivery) is remembered; this one is paid online.
    assert(await page.locator(`${tid('pay-cod')} input`).isChecked(), 'last payment method remembered');
    await page.click(tid('pay-online'));
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
    g.on('pageerror', (e) => consoleErrors.push(`${g.url()}: ${e}`));
    await g.goto(designShareUrl);
    await g.locator(tid('shared-mockup')).waitFor({ timeout: 15_000 });
    await shot('21-shared-mobile', g);
    await g.click(tid('shared-open'));
    await g.waitForURL(/\/studio/);
    await g.locator(tid('order')).waitFor();
    await g.waitForFunction(() => !document.querySelector('[data-testid="order"]')?.hasAttribute('disabled'), null, { timeout: 30_000 });
    await g.click(tid('order'));
    await g.waitForURL(/\/configure/);
    await g.selectOption(tid('single-size'), 'L');
    await g.fill(tid('single-qty'), '2');
    await g.locator(tid('price-total')).waitFor({ timeout: 20_000 });
    await shot('22-configure-mobile', g);
    await g.click(tid('buy-now'));
    await g.waitForURL(/\/checkout\?buy=1/);
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
    await g.click(tid('demo-pay'));
    await g.locator(tid('checkout-number')).waitFor({ timeout: 30_000 });
    assert(/Keep the order IDs/.test(await g.locator(tid('screen-checkout-done')).innerText()), 'guest hint');
    const gid = (await g.locator('[data-testid^="checkout-order-ord"]').first().getAttribute('data-testid')).replace('checkout-order-', '');
    await shot('22b-checkout-done-mobile', g);
    // Shop, product and cart fit a phone screen too.
    await g.goto(`${WEB}/shop`);
    await g.locator(tid('product-grid')).waitFor({ timeout: 15_000 });
    await shot('22c-shop-mobile', g);
    await g.goto(`${WEB}/shop/royal-strikers`);
    await g.locator(tid('product-title')).waitFor();
    await g.click(tid('size-S'));
    await g.click(tid('add-to-cart'));
    await g.locator(tid('added-to-cart')).waitFor();
    await shot('22d-product-mobile', g);
    await g.goto(`${WEB}/cart`);
    await g.locator(tid('cart-item-0')).waitFor({ timeout: 15_000 });
    await g.locator(tid('cart-totals-total')).waitFor({ timeout: 15_000 });
    await shot('22e-cart-mobile', g);
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

  // ------------------------------------------------------------------ size guide page
  await step('size guide page: from the footer, tops and shorts for every fit (phone)', async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const g = await m.newPage();
    g.on('pageerror', (e) => consoleErrors.push(`${g.url()}: ${e}`));
    await g.goto(`${WEB}/shop`);
    await g.click(tid('footer-size-guide'));
    await g.waitForURL(/\/size-guide$/);
    await g.locator(`${tid('size-guide-page')} table`).waitFor({ timeout: 15_000 });
    let head = await g.locator(`${tid('size-guide-page')} thead`).innerText();
    assert(/Chest/.test(head) && /Sleeve/.test(head), `tops columns: ${head}`);
    await g.click(tid('sg-sleeves-long'));
    await g.waitForFunction(() => /long/i.test(document.querySelector('[data-testid="size-guide-page"] thead')?.textContent || ''));
    await g.click(tid('size-guide-page-fit-women'));
    assert(/Women/.test(await g.locator(`${tid('size-guide-page')} caption`).innerText()), 'women table');
    await g.click(tid('sg-garment-shorts'));
    await g.click(tid('size-guide-page-fit-kids'));
    await g.waitForFunction(() => /Waist/.test(document.querySelector('[data-testid="size-guide-page"] thead')?.textContent || ''));
    head = await g.locator(`${tid('size-guide-page')} thead`).innerText();
    assert(/Hip/.test(head) && /Height/.test(head) && !/Shoulder/.test(head), `kids shorts columns: ${head}`);
    await shot('25-size-guide-mobile', g);
    const sitemap = await (await g.request.get(`${WEB}/sitemap.xml`)).text();
    assert(/\/size-guide</.test(sitemap), 'size guide in the sitemap');
    await m.close();
  });

  // ------------------------------------------------------------------ demo payments off
  await step('demo payments off: no demo pay, cash on delivery offered instead', async () => {
    const off = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const o = await off.newPage();
    o.on('pageerror', (e) => consoleErrors.push(`${o.url()}: ${e}`));
    await o.route('**/api/unsattai/health', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), demo_payments: false } });
    });
    await o.goto(`${WEB}/shop/royal-strikers`);
    await o.locator(tid('product-title')).waitFor();
    await o.click(tid('fit-women'));
    await o.click(tid('size-S'));
    await o.click(tid('buy-now'));
    await o.waitForURL(/\/checkout\?buy=1/);
    await o.locator(tid('screen-checkout')).waitFor();
    await o.waitForFunction(() => document.querySelector('[data-testid="pay-online"] input')?.disabled === true, null, { timeout: 15_000 });
    assert(/coming soon/i.test(await o.locator(tid('screen-checkout')).innerText()), 'online payment coming soon');
    assert(/Women/.test(await o.locator(tid('ck-item-0-sizes')).innerText()), 'women fit at checkout');
    await o.fill(tid('cust-name'), 'Meena Off');
    await o.fill(tid('cust-phone'), phone(80));
    await o.fill(tid('addr-line1'), '4 Beach Road');
    await o.fill(tid('addr-city'), 'Chennai');
    await o.selectOption(tid('addr-state'), 'TN');
    await o.fill(tid('addr-pincode'), '600001');
    await o.locator(tid('price-total')).waitFor({ timeout: 20_000 });
    // Once the price is known, cash on delivery is chosen for the customer.
    await o.waitForFunction(() => document.querySelector('[data-testid="pay-cod"] input')?.checked === true, null, { timeout: 15_000 });
    await shot('26-checkout-demo-off', o);
    const req = o.waitForRequest((r) => r.url().endsWith('/api/unsattai/checkout') && r.method() === 'POST');
    await o.click(tid('place-order'));
    const body = (await req).postDataJSON();
    assert(body.payment_method === 'cod' && body.items[0].lines[0].fit === 'women', `COD order with the women fit: ${body.payment_method}`);
    await o.waitForURL(/\/checkout\/[^/?]+$/, { timeout: 60_000 });
    await o.locator(tid('checkout-number')).waitFor();
    assert(!(await o.locator(tid('demo-pay')).count()) && !(await o.locator(tid('go-pay')).count()), 'no demo pay offered');
    await off.close();
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
