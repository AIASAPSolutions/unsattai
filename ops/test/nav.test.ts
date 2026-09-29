import { describe, expect, it } from 'vitest';
import { returnStatusBody, priceFrom, RETURN_FLOW } from '../src/lib/marketplace';
import { navFor, screenAllowed } from '../src/lib/nav';
import { can, canEditSection, isSellerLogin } from '../src/lib/permissions';
import defaults from './fixtures/defaults.json';
import type { PriceBook } from '../src/lib/settingsForm';

// GET /ops/me permissions per role (server/app/platform/security.py PERMISSIONS)
const P = {
  admin: ['*'],
  manager: ['crm', 'delivery', 'orders', 'pricing', 'production', 'read', 'settings'],
  sales: ['crm', 'orders', 'quotes', 'read'],
  production: ['production', 'read'],
  viewer: ['read'],
  seller: ['seller'],
};
const paths = (perms: string[], sellerId?: string) => navFor(perms, sellerId).flatMap((g) => g.items.map((i) => i.to));

describe('seller login permissions', () => {
  it('is recognised only by the lone seller permission', () => {
    expect(isSellerLogin(P.seller)).toBe(true);
    expect(isSellerLogin(P.admin)).toBe(false);
    expect(isSellerLogin(P.viewer)).toBe(false);
    expect(isSellerLogin([])).toBe(false);
    expect(isSellerLogin(undefined)).toBe(false);
  });
  it('can work its own production and shipments, nothing else', () => {
    expect(can(P.seller, 'read')).toBe(true);
    expect(can(P.seller, 'production')).toBe(true);
    expect(can(P.seller, 'delivery')).toBe(true);
    for (const p of ['orders', 'pricing', 'crm', 'settings', 'quotes', 'staff'] as const) expect(can(P.seller, p)).toBe(false);
  });
  it('can never edit settings, not even production or delivery', () => {
    for (const s of ['price_book', 'production', 'delivery', 'company', 'crm'] as const) expect(canEditSection(P.seller, s)).toBe(false);
    expect(canEditSection(P.production, 'production')).toBe(true);
  });
});

describe('menu scoping', () => {
  it('gives a seller login only its own work and its profile', () => {
    expect(paths(P.seller, 'sel_abc')).toEqual(['/dashboard', '/orders', '/production', '/delivery', '/returns', '/cod', '/sellers/sel_abc']);
    const labels = navFor(P.seller, 'sel_abc').flatMap((g) => g.items.map((i) => i.label));
    expect(labels[0]).toBe('Home');
    expect(labels).not.toContain('Settings');
  });
  it('shows staff the marketplace screens and hides Staff unless admin', () => {
    const viewer = paths(P.viewer);
    for (const p of ['/sellers', '/products', '/returns', '/cod', '/reviews', '/messages', '/settings', '/crm/customers']) expect(viewer).toContain(p);
    expect(viewer).not.toContain('/staff');
    expect(paths(P.admin)).toContain('/staff');
    expect(paths(P.manager)).not.toContain('/staff');
  });
  it('does not add a profile entry for staff', () => {
    expect(paths(P.admin, 'sel_abc')).not.toContain('/sellers/sel_abc');
  });
});

describe('screens a seller login may open', () => {
  const ok = (p: string) => screenAllowed(p, P.seller, 'sel_abc');
  it('allows its own screens', () => {
    for (const p of ['/', '/dashboard', '/orders', '/orders/ord_1', '/production/board', '/delivery/shipments', '/returns/ret_1', '/cod', '/account', '/sellers/sel_abc']) {
      expect(ok(p)).toBe(true);
    }
  });
  it('blocks staff screens and other sellers', () => {
    for (const p of ['/settings', '/settings/price-book', '/staff', '/crm/customers', '/reports', '/products', '/reviews', '/messages', '/sellers', '/sellers/sel_other', '/sellers/new', '/ordersx']) {
      expect(ok(p)).toBe(false);
    }
  });
  it('never blocks staff', () => {
    expect(screenAllowed('/settings', P.viewer)).toBe(true);
    expect(screenAllowed('/sellers/sel_other', P.admin)).toBe(true);
  });
});

describe('marketplace helpers', () => {
  const pb = defaults.price_book as unknown as PriceBook;
  const seller = (o: Partial<{ active: boolean; garments: ('jersey' | 'vneck' | 'shorts')[]; fabrics: string[]; price_adjust: number }> = {}) =>
    ({ active: true, garments: ['jersey', 'vneck', 'shorts'] as ('jersey' | 'vneck' | 'shorts')[], fabrics: [] as string[], price_adjust: 0, ...o });
  it('prices from the cheapest active seller that makes the garment and fabric', () => {
    expect(priceFrom(pb, [seller()], 'jersey', 'standard')).toBe(499);
    expect(priceFrom(pb, [seller({ price_adjust: 0.1 }), seller({ price_adjust: -0.1 })], 'jersey', 'premium')).toBe(557.1);
    expect(priceFrom(pb, [seller({ active: false })], 'jersey', 'standard')).toBeNull();
    expect(priceFrom(pb, [seller({ garments: ['shorts'] })], 'jersey', 'standard')).toBeNull();
    expect(priceFrom(pb, [seller({ fabrics: ['premium'] })], 'jersey', 'standard')).toBeNull();
  });
  it('builds return moves with the server rules', () => {
    expect(RETURN_FLOW.requested).toEqual(['approved', 'rejected']);
    expect(RETURN_FLOW.resolved).toEqual([]);
    expect(returnStatusBody('approved', { resolution: '', refund: '', note: ' Pickup Monday ' })).toEqual({ body: { status: 'approved', note: 'Pickup Monday' }, error: null });
    expect(returnStatusBody('resolved', { resolution: '', refund: '', note: '' }).error).toMatch(/replacement or refund/);
    expect(returnStatusBody('resolved', { resolution: 'refund', refund: '1,200', note: '' }).body).toEqual({ status: 'resolved', note: '', resolution: 'refund', refund_amount: 1200 });
    expect(returnStatusBody('resolved', { resolution: 'refund', refund: '0', note: '' }).error).toMatch(/above 0/);
    expect(returnStatusBody('resolved', { resolution: 'replacement', refund: '50', note: '' }).body).toEqual({ status: 'resolved', note: '', resolution: 'replacement' });
    expect(returnStatusBody('rejected', { resolution: '', refund: '', note: '' }).error).toMatch(/why/);
  });
});
