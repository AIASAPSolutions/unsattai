/**
 * The side menu and which screens a login may open. Pure: unit tested.
 *
 * Staff roles see every menu item their permissions allow (the server still checks each call).
 * A seller login sees only its own work: orders, production, delivery, returns, cash on delivery
 * and its seller profile. Anything else is hidden, and opening it by URL shows a short notice
 * instead of a screen full of 403 errors.
 */
import { can, isSellerLogin, type Permission } from './permissions';

export type NavIcon =
  | 'dashboard' | 'orders' | 'factory' | 'truck' | 'users' | 'building' | 'funnel' | 'doc' | 'chat' | 'task' | 'repeat'
  | 'chart' | 'settings' | 'shield' | 'store' | 'tag' | 'return' | 'star' | 'mail' | 'cash';

export interface NavItem { to: string; label: string; icon: NavIcon; testId?: string }
export interface NavGroup { title?: string; items: NavItem[] }

interface Def extends NavItem {
  /** Permission a staff login needs to see it. */
  need?: Permission;
  /** Shown to seller logins too (their own data only). */
  seller?: boolean;
  /** Label for seller logins, when different. */
  sellerLabel?: string;
}

const GROUPS: { title?: string; items: Def[] }[] = [
  { items: [
    { to: '/dashboard', label: 'Dashboard', sellerLabel: 'Home', icon: 'dashboard', need: 'read', seller: true },
    { to: '/orders', label: 'Orders', icon: 'orders', need: 'read', seller: true },
    { to: '/production', label: 'Production', icon: 'factory', need: 'read', seller: true },
    { to: '/delivery', label: 'Delivery', icon: 'truck', need: 'read', seller: true },
  ] },
  { title: 'Marketplace', items: [
    { to: '/sellers', label: 'Sellers', icon: 'store', need: 'read' },
    { to: '/products', label: 'Products', icon: 'tag', need: 'read' },
    { to: '/returns', label: 'Returns', icon: 'return', need: 'read', seller: true },
    { to: '/cod', label: 'Cash on delivery', icon: 'cash', need: 'read', seller: true },
    { to: '/reviews', label: 'Reviews', icon: 'star', need: 'read' },
    { to: '/messages', label: 'Messages', icon: 'mail', need: 'read' },
  ] },
  { title: 'CRM', items: [
    { to: '/crm/customers', label: 'Customers', icon: 'users', need: 'read' },
    { to: '/crm/organisations', label: 'Organisations', icon: 'building', need: 'read' },
    { to: '/crm/leads', label: 'Leads', icon: 'funnel', need: 'read' },
    { to: '/crm/quotes', label: 'Quotes', icon: 'doc', need: 'read' },
    { to: '/crm/tickets', label: 'Tickets', icon: 'chat', need: 'read' },
    { to: '/crm/tasks', label: 'Tasks', icon: 'task', need: 'read' },
    { to: '/crm/reorders', label: 'Reorders', icon: 'repeat', need: 'read' },
  ] },
  { title: 'Business', items: [
    { to: '/reports', label: 'Reports', icon: 'chart', need: 'read' },
    { to: '/settings', label: 'Settings', icon: 'settings', need: 'read' },
    { to: '/staff', label: 'Staff', icon: 'shield', need: 'staff' },
  ] },
];

/** The menu for these permissions. `sellerId` adds "My profile" for a seller login. */
export function navFor(perms: readonly string[] | undefined, sellerId?: string | null): NavGroup[] {
  const seller = isSellerLogin(perms);
  const out: NavGroup[] = [];
  for (const g of GROUPS) {
    const items = g.items
      .filter((d) => (seller ? d.seller : !d.need || can(perms, d.need)))
      .map(({ to, label, icon, sellerLabel }) => ({ to, label: seller && sellerLabel ? sellerLabel : label, icon }));
    if (items.length) out.push({ title: g.title, items });
  }
  if (seller && sellerId) {
    out.push({ title: 'My business', items: [{ to: `/sellers/${sellerId}`, label: 'Seller profile', icon: 'store', testId: 'nav-my-seller' }] });
  }
  return out;
}

/** Path prefixes a seller login may open. Everything else is staff-only. */
const SELLER_PATHS = ['/dashboard', '/orders', '/production', '/delivery', '/returns', '/cod', '/account'];

/** Can this login open this screen? (Staff: yes; the screens handle their own role checks.) */
export function screenAllowed(pathname: string, perms: readonly string[] | undefined, sellerId?: string | null): boolean {
  if (!isSellerLogin(perms)) return true;
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return true;
  if (sellerId && (path === `/sellers/${sellerId}` || path.startsWith(`/sellers/${sellerId}/`))) return true;
  return SELLER_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

