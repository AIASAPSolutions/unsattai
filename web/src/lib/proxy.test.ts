import { describe, expect, it } from 'vitest';
import {
  apiBase, downstreamHeaders, isValidDeviceId, newDeviceId, sameOrigin, SESSION_COOKIE, upstreamHeaders, upstreamPath, upstreamUrl,
} from './proxy';

describe('upstreamPath / upstreamUrl', () => {
  it('maps segments onto /api/v1 and keeps the query', () => {
    expect(upstreamUrl('http://api:8000/', ['shop', 'catalogue'], '')).toBe('http://api:8000/api/v1/shop/catalogue');
    expect(upstreamUrl('http://api:8000', ['orders', 'ord_1', 'track'], '?phone=98')).toBe('http://api:8000/api/v1/orders/ord_1/track?phone=98');
    expect(upstreamUrl('http://api:8000', ['me'], '?')).toBe('http://api:8000/api/v1/me');
  });
  it('refuses staff and internal endpoints', () => {
    for (const p of [['ops', 'orders'], ['ops'], ['stats'], ['dataset', 'export'], ['factory', 'queue'], ['auth', 'otp', 'verify']]) {
      expect(upstreamPath(p)).toBeNull();
    }
    expect(upstreamPath(['auth', 'otp', 'request'])).toBe('auth/otp/request');
  });
  it('allows the customer marketplace routes', () => {
    const ok = [
      'shop/serviceability', 'shop/offers', 'shop/products', 'shop/products/royal-strikers',
      'shop/products/royal-strikers/reviews', 'shop/products/royal-strikers/mockup.svg', 'shop/sellers/sel_house',
      'shop/cart/quote', 'checkout', 'checkouts/chk_1', 'checkouts/chk_1/pay', 'me', 'me/cart', 'me/cart/merge',
      'me/wishlist', 'me/wishlist/prd_1', 'me/password', 'me/identifiers/request', 'me/identifiers/verify', 'me/sessions',
      'me/sessions/ses_1', 'me/sessions/revoke-others', 'me/orders/ord_1/cancel', 'me/orders/ord_1/returns',
      'me/orders/ord_1/review', 'me/returns', 'me/notifications', 'me/notifications/read', 'me/checkouts',
      'orders', 'orders/ord_1', 'orders/ord_1/invoice', 'orders/UJ-00001/track', 'orders/ord_1/payment-confirmed',
      'collections', 'collections/tok', 'collections/tok/entries', 'collections/tok/entries/e1', 'quotes/tok/accept',
      'designs/generate', 'designs/d1/feedback', 'render/panels', 'meta', 'health', 'shop/size-guide',
    ];
    for (const p of ok) expect(upstreamPath(p.split('/')), p).toBe(p);
  });
  it('refuses everything that is not a customer route', () => {
    const no = [
      'shop/ops', 'ops/sellers', 'ops/auth/login', 'auth/login', 'auth/logout', 'auth/otp/verify', 'print',
      'designs/d1/print.svg', 'orders/ord_1/files/front.svg', 'orders/ord_1/stages/print', 'checkouts/chk_1/refund',
      'shop/products/x/y/z', 'admin', 'factory/queue', 'dataset/export', 'stats', 'sellers', 'shop/sellers',
    ];
    for (const p of no) expect(upstreamPath(p.split('/')), p).toBeNull();
  });
  it('refuses traversal and odd characters', () => {
    expect(upstreamPath([])).toBeNull();
    expect(upstreamPath(['..', 'ops'])).toBeNull();
    expect(upstreamPath(['orders', '.'])).toBeNull();
    expect(upstreamPath(['orders', 'a/b'])).toBeNull();
    expect(upstreamPath(['orders', 'a?b'])).toBeNull();
    expect(upstreamPath(['orders', ''])).toBeNull();
  });
});

describe('upstreamHeaders', () => {
  it('adds the server API key and drops anything the browser sends for it', () => {
    const h = upstreamHeaders({ headers: { 'x-api-key': 'browser', cookie: 'a=b', host: 'evil' }, cookies: {}, apiKey: 'secret' });
    expect(h['X-API-Key']).toBe('secret');
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('cookie');
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('host');
  });
  it('sends no key when none is configured', () => {
    expect(upstreamHeaders({ headers: { 'x-api-key': 'browser' }, cookies: {} })['X-API-Key']).toBeUndefined();
  });
  it('turns the session cookie into a bearer token, but an explicit Authorization wins', () => {
    expect(upstreamHeaders({ headers: {}, cookies: { [SESSION_COOKIE]: 'tok' } }).Authorization).toBe('Bearer tok');
    expect(upstreamHeaders({ headers: { authorization: 'Bearer mine' }, cookies: { [SESSION_COOKIE]: 'tok' } }).Authorization).toBe('Bearer mine');
    expect(upstreamHeaders({ headers: { authorization: 'Basic abc' }, cookies: {} }).Authorization).toBeUndefined();
  });
  it('passes a valid device id from the header or the cookie', () => {
    expect(upstreamHeaders({ headers: { 'x-device-id': 'dev_12345678' }, cookies: {} })['X-Device-Id']).toBe('dev_12345678');
    expect(upstreamHeaders({ headers: {}, cookies: { uj_device: 'web_abcdef12' } })['X-Device-Id']).toBe('web_abcdef12');
    expect(upstreamHeaders({ headers: { 'x-device-id': 'bad id\n' }, cookies: {} })['X-Device-Id']).toBeUndefined();
  });
  it('passes the user agent so the API can label the device', () => {
    expect(upstreamHeaders({ headers: { 'user-agent': 'Mozilla/5.0 (Android) Chrome/120' }, cookies: {} })['User-Agent']).toContain('Chrome');
  });
  it('keeps content negotiation headers', () => {
    const h = upstreamHeaders({ headers: { 'content-type': 'application/json', accept: '*/*', 'accept-language': 'ta' }, cookies: {} });
    expect(h).toMatchObject({ 'Content-Type': 'application/json', Accept: '*/*', 'Accept-Language': 'ta' });
  });
});

describe('downstreamHeaders', () => {
  it('passes the content type and locks down HTML and SVG', () => {
    const html = downstreamHeaders(new Headers({ 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'x=1', server: 'uvicorn' }));
    expect(html.get('content-type')).toContain('text/html');
    expect(html.get('content-security-policy')).toContain("default-src 'none'");
    expect(html.get('set-cookie')).toBeNull();
    expect(html.get('server')).toBeNull();
    expect(html.get('cache-control')).toBe('no-store');
    const json = downstreamHeaders(new Headers({ 'content-type': 'application/json', 'retry-after': '3' }));
    expect(json.get('content-security-policy')).toBeNull();
    expect(json.get('retry-after')).toBe('3');
  });
});

describe('device ids, base url and origin checks', () => {
  it('mints valid random device ids', () => {
    const a = newDeviceId();
    expect(isValidDeviceId(a)).toBe(true);
    expect(a).toMatch(/^web_[0-9a-f]{32}$/);
    expect(newDeviceId()).not.toBe(a);
    expect(isValidDeviceId('short')).toBe(false);
    expect(isValidDeviceId(undefined)).toBe(false);
  });
  it('defaults the API base', () => {
    expect(apiBase({})).toBe('http://127.0.0.1:8000');
    expect(apiBase({ UJ_API_URL: 'http://x:8100/' })).toBe('http://x:8100');
  });
  it('refuses cross-site writes', () => {
    expect(sameOrigin('GET', 'https://evil.test', 'shop.test')).toBe(true);
    expect(sameOrigin('POST', 'https://shop.test', 'shop.test')).toBe(true);
    expect(sameOrigin('POST', 'https://evil.test', 'shop.test')).toBe(false);
    expect(sameOrigin('DELETE', 'null', 'shop.test')).toBe(false);
    expect(sameOrigin('POST', undefined, 'shop.test')).toBe(true);
    expect(sameOrigin('POST', 'not a url', 'shop.test')).toBe(false);
  });
});
