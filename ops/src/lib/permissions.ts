/** Role-aware UI. Mirrors server/app/platform/security.py; the server still enforces everything. */

export type Permission = 'read' | 'orders' | 'pricing' | 'production' | 'delivery' | 'crm' | 'settings' | 'quotes' | 'staff' | 'seller';
export type Role = 'admin' | 'manager' | 'sales' | 'production' | 'dispatch' | 'viewer' | 'seller';
export type SettingsSection = 'price_book' | 'production' | 'sizing' | 'delivery' | 'company' | 'crm';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin', manager: 'Manager', sales: 'Sales', production: 'Production', dispatch: 'Dispatch', viewer: 'Viewer', seller: 'Seller',
};

export const ROLE_HELP: Record<Role, string> = {
  admin: 'Everything, including staff accounts.',
  manager: 'Orders, prices, production, delivery, CRM and all settings.',
  sales: 'Orders (payments, notes, holds), CRM and quotes.',
  production: 'Production stages, production settings and size charts.',
  dispatch: 'Shipments and delivery settings.',
  viewer: 'Read only.',
  seller: "A partner unit's own login: only that seller's orders, production, shipments, returns and cash on delivery.",
};

/** Roles an admin can give on the Staff screen. Seller logins are created from the seller's page. */
export const STAFF_ROLES: Role[] = ['admin', 'manager', 'sales', 'production', 'dispatch', 'viewer', 'seller'];

export function can(perms: readonly string[] | undefined, p: Permission): boolean {
  if (!perms) return false;
  if (isSellerLogin(perms)) return SELLER_CAN.includes(p);
  return perms.includes('*') || perms.includes(p);
}

/**
 * A seller login's permissions are exactly ["seller"]. The server lets it into the routes that opt in
 * (its own orders, stages, shipments, returns and cash on delivery) and answers everything else with 403.
 * These are the actions the UI offers it; "read" means it can see its own data.
 */
const SELLER_CAN: Permission[] = ['seller', 'read', 'production', 'delivery'];

export function isSellerLogin(perms: readonly string[] | undefined): boolean {
  return !!perms && perms.length > 0 && perms.every((p) => p === 'seller');
}

export function sectionPermission(section: SettingsSection): Permission {
  return ({ price_book: 'pricing', production: 'production', sizing: 'production', delivery: 'delivery' } as const)[section as 'price_book'] ?? 'settings';
}

/** Same rule as PUT /ops/settings/{section}: the section's permission or "settings". */
export function canEditSection(perms: readonly string[] | undefined, section: SettingsSection): boolean {
  if (isSellerLogin(perms)) return false;
  return can(perms, sectionPermission(section)) || can(perms, 'settings');
}

export function isAdmin(perms: readonly string[] | undefined): boolean {
  return !!perms?.includes('*');
}
