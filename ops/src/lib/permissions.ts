/** Role-aware UI. Mirrors server/app/platform/security.py; the server still enforces everything. */

export type Permission = 'read' | 'orders' | 'pricing' | 'production' | 'delivery' | 'crm' | 'settings' | 'quotes' | 'staff';
export type Role = 'admin' | 'manager' | 'sales' | 'production' | 'dispatch' | 'viewer';
export type SettingsSection = 'price_book' | 'production' | 'delivery' | 'company' | 'crm';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin', manager: 'Manager', sales: 'Sales', production: 'Production', dispatch: 'Dispatch', viewer: 'Viewer',
};

export const ROLE_HELP: Record<Role, string> = {
  admin: 'Everything, including staff accounts.',
  manager: 'Orders, prices, production, delivery, CRM and all settings.',
  sales: 'Orders (payments, notes, holds), CRM and quotes.',
  production: 'Production stages and production settings.',
  dispatch: 'Shipments and delivery settings.',
  viewer: 'Read only.',
};

export function can(perms: readonly string[] | undefined, p: Permission): boolean {
  if (!perms) return false;
  return perms.includes('*') || perms.includes(p);
}

export function sectionPermission(section: SettingsSection): Permission {
  return ({ price_book: 'pricing', production: 'production', delivery: 'delivery' } as const)[section as 'price_book'] ?? 'settings';
}

/** Same rule as PUT /ops/settings/{section}: the section's permission or "settings". */
export function canEditSection(perms: readonly string[] | undefined, section: SettingsSection): boolean {
  return can(perms, sectionPermission(section)) || can(perms, 'settings');
}

export function isAdmin(perms: readonly string[] | undefined): boolean {
  return !!perms?.includes('*');
}
