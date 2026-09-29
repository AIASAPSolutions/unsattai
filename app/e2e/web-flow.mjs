// End-to-end run of the web build against a local UrJersey API.
//   APP_URL=http://127.0.0.1:8081 API_URL=http://127.0.0.1:8000 node e2e/web-flow.mjs
// Needs Playwright (npm i -g playwright) and a Chromium it can launch. The API must
// run with ADMIN_EMAIL / ADMIN_PASSWORD set (defaults below): the run signs in to the
// ops API to add a second seller, block a PIN code and move an order to delivered.
import { createRequire } from 'module';
import { mkdirSync } from 'fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const APP = process.env.APP_URL ?? 'http://127.0.0.1:8081';
const OUT = process.env.SHOTS ?? 'e2e/shots';
const API = (process.env.API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '') + '/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@urjersey.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Adm1nPassword!';
// A fresh email per run so sign-in always starts as a new account.
const EMAIL = `e2e.${Date.now().toString(36)}@example.com`;
const PASSWORD = 'Jersey2026Pass';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack ?? e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

// Stack screens underneath stay in the page on web: only look at what is on screen.
const id = (x) => page.locator(`[data-testid="${x}"]:visible`).first();
const prefixed = (x) => page.locator(`[data-testid^="${x}"]:visible`);
const textOf = async (x) => (await id(x).innerText()).trim();
const waitText = (x, re, timeout = 15000) => page.waitForFunction(([sel, src]) => {
  const re = new RegExp(src, 'i');
  return [...document.querySelectorAll(`[data-testid="${sel}"]`)].some((el) => el.offsetParent !== null && re.test(el.textContent ?? ''));
}, [x, re.source], { timeout });
const enabled = (x, timeout = 20000) => page.waitForFunction((sel) => {
  const b = [...document.querySelectorAll(`[data-testid="${sel}"]`)].find((el) => el.offsetParent !== null);
  return b && b.getAttribute('aria-disabled') !== 'true';
}, x, { timeout });
const tab = async (name) => {
  // Like a person pressing back until the tab bar shows again.
  for (let i = 0; i < 8 && !(await id(`tab-${name}`).count()); i++) {
    await page.goBack();
    await page.waitForTimeout(300);
  }
  await id(`tab-${name}`).click();
  await page.waitForTimeout(400);
};

// ---------------------------------------------------------------- ops API (admin)
let opsToken = null;
async function ops(method, path, body) {
  if (!opsToken && path !== '/ops/auth/login') {
    const r = await ops('POST', '/ops/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    opsToken = r.token;
  }
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opsToken ? { Authorization: `Bearer ${opsToken}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function setupSellers() {
  const list = await ops('GET', '/ops/sellers?q=Fast%20Prints');
  if (!list.items.some((x) => x.name === 'Fast Prints')) {
    await ops('POST', '/ops/sellers', {
      name: 'Fast Prints', active: true, garments: ['jersey', 'vneck', 'shorts'], fabrics: [],
      service_areas: [{ match: '600', transit_days: 1, cod: true }], price_adjust: 0.05,
    });
  }
  const house = (await ops('GET', '/ops/sellers/sel_house')).seller;
  if (!(house.blocked_pincodes ?? []).includes('194101')) {
    const editable = ['name', 'legal_name', 'gstin', 'email', 'phone', 'address', 'active', 'garments', 'fabrics', 'service_areas',
      'blocked_pincodes', 'capacity_factor', 'holidays', 'handling_days', 'min_pieces', 'max_pieces', 'price_adjust'];
    const body = Object.fromEntries(editable.filter((k) => house[k] !== undefined).map((k) => [k, house[k]]));
    await ops('PUT', '/ops/sellers/sel_house', { ...body, blocked_pincodes: [...(house.blocked_pincodes ?? []), '194101'] });
  }
}

/** Every production stage, then a shipment dispatched and delivered. */
async function deliver(orderId) {
  const { order } = await ops('GET', `/ops/orders/${orderId}`);
  const stages = (order.fulfilment?.stages ?? []).filter((x) => !x.done_at).map((x) => x.id);
  for (const st of stages) await ops('POST', `/ops/orders/${orderId}/stages/${st}`);
  const shp = await ops('POST', `/ops/orders/${orderId}/shipments`, { carrier: 'surface', tracking_no: 'SRF-E2E-1001' });
  await ops('PATCH', `/ops/shipments/${shp.id}`, { status: 'dispatched' });
  await ops('PATCH', `/ops/shipments/${shp.id}`, { status: 'delivered' });
}

async function orderNumber(orderId) {
  const n = (await ops('GET', `/ops/orders/${orderId}`)).order.number;
  if (!n) throw new Error(`order ${orderId} has no number`);
  return n;
}
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `);
  await fn();
  console.log('ok');
};

try {
  await step('ops setup: second seller, blocked PIN code', setupSellers);

  await step('describe', async () => {
    await page.goto(APP);
    await id('brief').fill('Aggressive navy and gold cricket jersey with lightning shards for team Chennai Strikers, number 7');
    await id('player').fill('ARUL');
    await shot('01-describe');
    await id('understand').click();
    await id('screen-confirm').waitFor();
  });

  await step('confirm', async () => {
    await page.waitForTimeout(300);
    await shot('02-confirm');
    // answer any open questions with their first option
    for (let i = 0; i < 4; i++) {
      const q = page.locator('[data-testid^="answer-"]').first();
      if (!(await q.count())) break;
      await q.click();
    }
    await id('generate').click();
    await id('screen-designs').waitFor({ timeout: 60000 });
    await id('open-0').waitFor();
    await shot('03-designs');
  });

  await step('rate and open studio', async () => {
    await page.locator('[data-testid="rate-0"] [role="button"], [data-testid="rate-0"] div[tabindex]').nth(3).click().catch(() => {});
    await id('open-0').click();
    await id('screen-studio').waitFor();
    await id('panel-editor').waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await shot('04-studio');
  });

  await step('style edit + undo/redo', async () => {
    await id('pattern-waves').click();
    await page.waitForTimeout(800);
    await id('undo').click();
    await id('redo').click();
    await page.waitForTimeout(800);
    await shot('05-style');
  });

  await step('text layer', async () => {
    await id('tab-text').click();
    await id('free-text').fill('Since 1999');
    await id('add-free').click();
    await page.waitForTimeout(800);
    await id('panel-back').click();
    await page.waitForTimeout(800);
    await shot('06-text');
  });

  await step('logos', async () => {
    await id('tab-logos').click();
    await id('suggestion-0').waitFor({ timeout: 15000 });
    await id('suggestion-0').click();
    await id('more-logos').click();
    await id('suggestion-8').waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    await shot('07-logos');
  });

  await step('refine', async () => {
    await id('tab-refine').click();
    await id('refine-input').fill('make the collar gold and change the pattern to hexagon');
    await id('refine-apply').click();
    await id('refine-result').waitFor({ timeout: 15000 });
    await shot('08-refine');
    // Only when the API has AI edits on (AI_EDITS): the rules can't map this, so the model does.
    if (process.env.E2E_AI === '1') {
      await id('ai-left').waitFor({ timeout: 15000 });
      const before = await id('ai-left').innerText();
      await id('refine-input').fill('make it look more premium and classy');
      await id('refine-apply').click();
      await id('refine-result').filter({ hasText: /✨ AI ·/ }).waitFor({ timeout: 20000 });
      const after = await id('ai-left').innerText();
      if (before === after) throw new Error(`AI edit count did not change: ${after}`);
      await shot('08b-refine-ai');
    }
  });

  await step('checks', async () => {
    await id('tab-checks').click();
    await id('checks-summary').waitFor({ timeout: 15000 });
    await shot('09-checks');
  });

  await step('3d preview', async () => {
    await id('view-3d').click();
    await page.waitForTimeout(3000);
    await shot('10-3d');
    await id('view-2d').click();
  });

  let quotedTeamTotal = '';
  await step('team order → cart', async () => {
    await enabled('order');
    await id('order').click();
    await id('screen-order').waitFor();
    await id('order-mode-team').click();
    await id('add-row').click();
    await id('row-name-0').fill('Priya');
    await id('row-number-0').fill('10');
    await id('row-size-0-S').click();
    await id('add-row').click();
    await id('row-name-1').fill('அருள்');
    await id('row-number-1').fill('7');
    await id('row-size-1-XL').click();
    await id('fabric-premium').click();
    await page.waitForFunction(() => /₹/.test(document.querySelector('[data-testid="price-total"]')?.textContent ?? ''), null, { timeout: 15000 });
    quotedTeamTotal = await textOf('price-total');
    const footer = await textOf('footer-total');
    if (!quotedTeamTotal.startsWith('₹') || quotedTeamTotal !== footer) throw new Error(`price mismatch: ${quotedTeamTotal} vs ${footer}`);
    await shot('11-order');
    await id('item-quote').scrollIntoViewIfNeeded();
    await shot('11b-price');
    await id('add-to-cart').click();
    await id('added-to-cart').waitFor({ timeout: 10000 });
    await shot('12-added');
  });

  await step('deliver-to PIN code (unserviceable, invalid, then Chennai)', async () => {
    await tab('create');
    await id('deliver-to').click();
    await id('pin-sheet').waitFor();
    await id('pin-input').fill('194101');
    await id('pin-apply').click();
    await waitText('pin-result', /can't deliver|cannot deliver|not deliver|sorry/);
    await shot('13-pin-unserviceable');
    await id('pin-input').fill('999999');
    await id('pin-apply').click();
    await waitText('pin-result', /not a valid|valid PIN/);
    await shot('13a-pin-invalid');
    await id('pin-input').fill('600028');
    await id('pin-apply').click();
    await id('pin-sheet').waitFor({ state: 'hidden', timeout: 15000 });
    await waitText('deliver-to-text', /600028/);
    await shot('13b-pin-home');
  });

  await step('shop: search and filter', async () => {
    await tab('shop');
    await id('screen-shop').waitFor();
    await prefixed('product-').first().waitFor({ timeout: 15000 });
    await waitText('deliver-to-text', /600028/);
    const all = await textOf('result-count');
    await id('shop-search').fill('kings');
    await page.waitForFunction((before) => {
      const el = [...document.querySelectorAll('[data-testid="result-count"]')].find((e) => e.offsetParent !== null);
      return el && el.textContent !== before;
    }, all, { timeout: 15000 });
    await id('shop-search').fill('');
    await page.waitForFunction((before) => {
      const el = [...document.querySelectorAll('[data-testid="result-count"]')].find((e) => e.offsetParent !== null);
      return el && el.textContent === before;
    }, all, { timeout: 15000 });
    await id('open-filters').click();
    await id('filter-sheet').waitFor();
    await id('filter-sport-cricket').click();
    await shot('14-filters');
    await id('apply-filters').click();
    await id('filter-sheet').waitFor({ state: 'hidden' });
    await waitText('result-count', /^1\b/);
    await shot('14b-shop-filtered');
  });

  await step('product detail with other sellers', async () => {
    await id('product-0').click();
    await id('screen-product').waitFor();
    await waitText('product-title', /Crimson Kings/);
    await id('delivery-box').waitFor();
    await waitText('sold-by', /.+/);
    await id('other-sellers').waitFor({ timeout: 15000 });
    const others = await prefixed('other-seller-').count();
    if (!others) throw new Error('expected another seller for 600028');
    await shot('15-product');
    // Buy from the other seller, so the cart has two sellers (two deliveries, two orders).
    const before = await textOf('sold-by');
    await id('choose-seller-0').click();
    await page.waitForFunction((b) => {
      const el = [...document.querySelectorAll('[data-testid="sold-by"]')].find((e) => e.offsetParent !== null);
      return el && el.textContent !== b;
    }, before, { timeout: 10000 });
    await id('product-wish').click();
    await id('product-size-L').click();
    await id('add-to-cart').click();
    await id('product-notice').waitFor();
    await id('delivery-box').scrollIntoViewIfNeeded();
    await shot('15b-product-sellers');
  });

  await step('wishlist', async () => {
    await tab('account');
    await id('account-wishlist').click();
    await id('screen-wishlist').waitFor();
    await id('product-0').waitFor({ timeout: 10000 });
    await waitText('product-0', /Crimson Kings/);
    await shot('16-wishlist');
    await page.goBack();
  });

  await step('cart: product and custom team design', async () => {
    await tab('cart');
    await id('screen-cart').waitFor();
    await id('cart-item-1').waitFor({ timeout: 10000 });
    if (await prefixed('cart-item-title-').count() !== 2) throw new Error('expected two cart items');
    await waitText('cart-total', /₹/);
    await waitText('cart-eta', /\d/);
    await shot('17-cart');
  });

  const placed = { cod: [], online: [] };
  const fillCustomer = async () => {
    if (!(await id('customer-name').inputValue())) await id('customer-name').fill('Arul Kumar');
    if (!(await id('customer-phone').inputValue())) await id('customer-phone').fill('+91 98765 43210');
    if (!(await id('customer-email').inputValue())) await id('customer-email').fill(EMAIL);
    if (!(await id('addr-line1').inputValue())) await id('addr-line1').fill('12 Gandhi Street');
    if (!(await id('addr-city').inputValue())) await id('addr-city').fill('Chennai');
    if (!(await id('addr-pincode').inputValue())) await id('addr-pincode').fill('600028');
    if (!(await id('addr-state').inputValue())) await id('addr-state').fill('TN');
  };
  const confirmedOrders = async () => {
    const els = await prefixed('confirm-order-').all();
    return Promise.all(els.map(async (e) => (await e.getAttribute('data-testid')).replace('confirm-order-', '')));
  };

  await step('checkout with cash on delivery', async () => {
    await id('proceed-checkout').click();
    await id('screen-checkout').waitFor();
    await fillCustomer();
    await id('seller-group-1').waitFor({ timeout: 15000 });   // custom design and product from two sellers
    await id('pay-cod').click();
    await id('cart-cod-fee').waitFor({ timeout: 15000 });
    await shot('18-checkout');
    await id('seller-groups').scrollIntoViewIfNeeded();
    await shot('18b-checkout-sellers');
    await enabled('place-order');
    await id('place-order').click();
    await id('screen-confirmation').waitFor({ timeout: 30000 });
    placed.cod = await confirmedOrders();
    if (placed.cod.length !== 2) throw new Error(`expected 2 orders, got ${placed.cod.length}`);
    await shot('19-confirmation-cod');
    await id('continue-shopping').click();
    await id('screen-shop').waitFor({ timeout: 10000 });
  });

  await step('buy now, pay online → TEST queue', async () => {
    await id('clear-filters').click().catch(() => {});
    await id('shop-search').fill('royal strikers');
    await waitText('result-count', /^1\b/);
    await id('product-0').click();
    await id('screen-product').waitFor();
    await waitText('product-title', /Royal Strikers/);
    await waitText('sold-by', /.+/);
    await id('buy-now').click();
    await id('screen-checkout').waitFor();
    await fillCustomer();
    await id('pay-online').click();
    await waitText('checkout-total', /₹/);
    await enabled('place-order');
    await id('place-order').click();
    await id('screen-confirmation').waitFor({ timeout: 30000 });
    await waitText('checkout-status', /paid/);
    placed.online = await confirmedOrders();
    await shot('20-confirmation-online');
    await id(`confirm-order-${placed.online[0]}`).click();
    await id('screen-order-status').waitFor({ timeout: 15000 });
    await id('receipt').waitFor({ timeout: 20000 });
    const job = await textOf('job-id');
    if (!job.startsWith('TEST-')) throw new Error(`expected a TEST job id, got ${job}`);
    await id('stages').waitFor();
    await id('order-eta').waitFor();
    await shot('21-receipt');
    await id('timeline').scrollIntoViewIfNeeded();
    await shot('21b-progress');
  });

  await step('sign in with an email code', async () => {
    await tab('account');
    await id('account-sign-in').click();
    await id('screen-sign-in').waitFor();
    await id('signin-kind-email').click();
    await id('signin-id').fill(EMAIL);
    await id('send-code').click();
    await id('dev-code').waitFor({ timeout: 15000 });
    const code = (await textOf('dev-code')).match(/\d{4,8}/)[0];
    await id('signin-code').fill(code);
    if (await id('signin-name').count()) await id('signin-name').fill('Arul Kumar');
    await shot('22-sign-in-code');
    await id('verify-code').click();
    await id('account-greeting').waitFor({ timeout: 20000 });
    await shot('23-account');
  });

  await step('set a password, sign out, sign in with it', async () => {
    await id('account-security').click();
    await id('screen-security').waitFor();
    await id('pw-new').fill(PASSWORD);
    await id('pw-confirm').fill(PASSWORD);
    await id('save-password').click();
    await waitText('password-result', /saved/);
    await shot('24-security');
    await page.goBack();
    await id('sign-out').click();
    await id('account-sign-in').waitFor();
    await id('account-sign-in').click();
    await id('signin-method-password').click();
    await id('signin-id').fill(EMAIL);
    await id('signin-password').fill('wrong-Password1');
    await id('password-sign-in').click();
    await waitText('signin-error', /not right|password/);
    await id('signin-password').fill(PASSWORD);
    await shot('25-sign-in-password');
    await id('password-sign-in').click();
    await id('account-greeting').waitFor({ timeout: 20000 });
  });

  await step('my orders → cancel a cash-on-delivery order', async () => {
    await id('account-orders').click();
    await id('screen-my-orders').waitFor();
    await id('my-order-2').waitFor({ timeout: 15000 });
    await shot('26-my-orders');
    const number = await orderNumber(placed.cod[0]);
    await prefixed('my-order-').filter({ hasText: number }).first().click();
    await id('screen-order-status').waitFor();
    await waitText('order-seller', /.+/);
    await id('cancel-order').click();
    await id('cancel-sheet').waitFor();
    await id('cancel-reason-changed_mind').click();
    await shot('27-cancel');
    await id('confirm-cancel').click();
    await waitText('fulfilment-status', /cancel/);
    await id('cancel-sheet').waitFor({ state: 'hidden', timeout: 5000 });
    await shot('27b-cancelled');
    await page.goBack();
  });

  await step('delivered order: tracking, return and review', async () => {
    await deliver(placed.online[0]);
    const number = await orderNumber(placed.online[0]);
    await page.goBack();
    await id('account-orders').click();
    await id('screen-my-orders').waitFor();
    await prefixed('my-order-').filter({ hasText: number }).first().click();
    await id('screen-order-status').waitFor();
    await waitText('fulfilment-status', /deliver/);
    await waitText('tracking-no', /SRF-E2E-1001/);
    await id('tracking').scrollIntoViewIfNeeded();
    await shot('28-delivered');
    await id('return-order').click();
    await id('return-sheet').waitFor();
    await id('return-reason-print_quality').click();
    await id('return-details').fill('The number 7 print is peeling after one wash.');
    await shot('29-return');
    await id('confirm-return').click();
    await prefixed('return-R').first().waitFor({ timeout: 15000 });
    await id('return-sheet').waitFor({ state: 'hidden', timeout: 5000 });
    await id('review-stars-5').click();
    await id('review-title').fill('Great fit');
    await id('review-body').fill('Colours came out bright and the fabric breathes well.');
    await id('submit-review').click();
    await id('my-review').waitFor({ timeout: 15000 });
    await id('order-actions').scrollIntoViewIfNeeded();
    await shot('30-return-review');
  });

  await step('design from a picture', async () => {
    await page.goto(APP);
    await id('use-picture').click();
    await id('screen-picture').waitFor({ timeout: 15000 });
    const prompt = await id('outside-prompt').innerText();
    if (!/No text, no letters/.test(prompt)) throw new Error(`unexpected prompt: ${prompt.slice(0, 80)}`);
    const chooser = page.waitForEvent('filechooser');
    await id('choose-picture').click();
    await (await chooser).setFiles(new URL('./fixtures/hoops-jersey.png', import.meta.url).pathname);
    await id('picked-picture').waitFor({ timeout: 15000 });
    await id('recognise').click();
    await id('picture-result').waitFor({ timeout: 30000 });
    await page.waitForTimeout(600);
    await id('open-2').waitFor({ state: 'attached', timeout: 10000 });   // three interpretations
    await id('picture-result').screenshot({ path: `${OUT}/31-picture.png` });
    await id('open-0').click();
    await id('panel-editor').waitFor({ timeout: 20000 });
    await shot('32-picture-studio');
  });

  await step('app link prefill', async () => {
    await page.goto(`${APP}/design?prompt=${encodeURIComponent('Teal volleyball jersey with ocean waves')}&garment=vneck&team=Waves&lang=hi&autostart=1`);
    await id('screen-confirm').waitFor({ timeout: 20000 });
    await shot('33-link-hindi');
  });

  const real = errors.filter((e) => !/Download the React DevTools|findDOMNode|shadow\*|props\.pointerEvents|THREE\.|aria-hidden/.test(e));
  if (real.length) console.log('Console errors:\n' + real.slice(0, 10).join('\n'));
  console.log('E2E passed');
} catch (e) {
  await shot('zz-failure').catch(() => {});
  console.error('\nE2E failed:', e.message);
  if (errors.length) console.error(errors.slice(0, 10).join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
