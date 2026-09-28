// End-to-end run of the web build against a local UrJersey API.
//   APP_URL=http://127.0.0.1:8081 node e2e/web-flow.mjs
// Needs Playwright (npm i -g playwright) and a Chromium it can launch.
import { createRequire } from 'module';
import { mkdirSync } from 'fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const APP = process.env.APP_URL ?? 'http://127.0.0.1:8081';
const OUT = process.env.SHOTS ?? 'e2e/shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack ?? e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const id = (x) => page.getByTestId(x);
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `);
  await fn();
  console.log('ok');
};

try {
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

  await step('team order', async () => {
    await page.waitForFunction(() => {
      const b = document.querySelector('[data-testid="order"]');
      return b && b.getAttribute('aria-disabled') !== 'true';
    }, null, { timeout: 20000 });
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
    await id('customer-name').fill('Arul');
    await id('customer-phone').fill('+91 98765 43210');
    // Shop options: fabric, address, express, coupon, then the live price and date.
    await id('fabric-premium').click();
    await id('addr-line1').fill('12 Gandhi Street');
    await id('addr-city').fill('Chennai');
    await id('addr-state').fill('TN');
    await id('addr-pincode').fill('600001');
    await id('express').click();
    await id('coupon').fill('WELCOME10');
    await id('coupon-ok').waitFor({ timeout: 15000 });
    await page.waitForFunction(() => /\d/.test(document.querySelector('[data-testid="quote-eta"]')?.textContent ?? ''), null, { timeout: 15000 });
    const total = await id('price-total').innerText();
    const footer = await id('footer-total').innerText();
    if (!total.startsWith('₹') || total !== footer) throw new Error(`price mismatch: ${total} vs ${footer}`);
    await shot('11-order');
    await id('price-summary').scrollIntoViewIfNeeded();
    await shot('11b-price');
    await id('place-order').click();
    await id('screen-order-status').waitFor({ timeout: 30000 });
    const status = await id('fulfilment-status').innerText();
    if (!/payment/i.test(status)) throw new Error(`unexpected fulfilment status: ${status}`);
    const placedTotal = await id('price-total').innerText();
    if (placedTotal !== total) throw new Error(`order total ${placedTotal} differs from quote ${total}`);
    await shot('12-status');
  });

  await step('demo payment → TEST queue', async () => {
    await id('demo-pay').click();
    await id('receipt').waitFor({ timeout: 20000 });
    const job = await id('job-id').innerText();
    if (!job.startsWith('TEST-')) throw new Error(`expected a TEST job id, got ${job}`);
    await page.waitForFunction(() => /start/i.test(document.querySelector('[data-testid="fulfilment-status"]')?.textContent ?? ''), null, { timeout: 15000 });
    await id('stages').waitFor();
    await id('order-eta').waitFor();
    await shot('13-receipt');
    await id('timeline').scrollIntoViewIfNeeded();
    await shot('13b-progress');
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
    await id('picture-result').screenshot({ path: `${OUT}/13b-picture.png` });
    await id('open-0').click();
    await id('panel-editor').waitFor({ timeout: 20000 });
    await shot('13c-picture-studio');
  });

  await step('app link prefill', async () => {
    await page.goto(`${APP}/design?prompt=${encodeURIComponent('Teal volleyball jersey with ocean waves')}&garment=vneck&team=Waves&lang=hi&autostart=1`);
    await id('screen-confirm').waitFor({ timeout: 20000 });
    await shot('14-link-hindi');
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
