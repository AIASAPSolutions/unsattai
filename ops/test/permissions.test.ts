import { describe, expect, it } from 'vitest';
import { can, canEditSection, isAdmin, sectionPermission } from '../src/lib/permissions';

// Same table as server/app/platform/security.py PERMISSIONS
const P = {
  admin: ['*'],
  manager: ['read', 'orders', 'pricing', 'production', 'delivery', 'crm', 'settings'],
  sales: ['read', 'orders', 'crm', 'quotes'],
  production: ['read', 'production'],
  dispatch: ['read', 'delivery'],
  viewer: ['read'],
};

describe('can', () => {
  it('admin wildcard allows everything, including staff', () => {
    expect(can(P.admin, 'staff')).toBe(true);
    expect(can(P.admin, 'quotes')).toBe(true);
    expect(isAdmin(P.admin)).toBe(true);
    expect(isAdmin(P.manager)).toBe(false);
  });
  it('checks explicit permissions', () => {
    expect(can(P.sales, 'quotes')).toBe(true);
    expect(can(P.manager, 'quotes')).toBe(false);
    expect(can(P.production, 'orders')).toBe(false);
    expect(can(P.viewer, 'read')).toBe(true);
    expect(can(undefined, 'read')).toBe(false);
  });
});

describe('settings sections', () => {
  it('maps sections to permissions like PUT /ops/settings/{section}', () => {
    expect(sectionPermission('price_book')).toBe('pricing');
    expect(sectionPermission('production')).toBe('production');
    expect(sectionPermission('sizing')).toBe('production');
    expect(sectionPermission('delivery')).toBe('delivery');
    expect(sectionPermission('company')).toBe('settings');
    expect(sectionPermission('crm')).toBe('settings');
  });
  it.each([
    ['admin', 'price_book', true], ['manager', 'price_book', true], ['manager', 'company', true],
    ['production', 'price_book', false], ['production', 'production', true], ['production', 'delivery', false],
    ['dispatch', 'delivery', true], ['dispatch', 'crm', false], ['sales', 'price_book', false], ['sales', 'crm', false],
    ['viewer', 'company', false],
    ['production', 'sizing', true], ['manager', 'sizing', true], ['sales', 'sizing', false], ['viewer', 'sizing', false], ['dispatch', 'sizing', false],
  ] as const)('%s editing %s -> %s', (role, section, ok) => {
    expect(canEditSection(P[role], section)).toBe(ok);
  });
});
