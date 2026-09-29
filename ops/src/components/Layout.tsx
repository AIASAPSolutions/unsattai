import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { navFor, screenAllowed, type NavIcon } from '../lib/nav';
import { ROLE_LABEL } from '../lib/permissions';
import { useRefData } from '../lib/refdata';
import {
  IconBuilding, IconCash, IconChart, IconChat, IconDashboard, IconDoc, IconFactory, IconFunnel, IconMail, IconMenu, IconOrders, IconRepeat,
  IconReturn, IconSettings, IconShield, IconStar, IconStore, IconTag, IconTask, IconTruck, IconUsers,
} from './icons';

const ICONS: Record<NavIcon, ReactNode> = {
  dashboard: <IconDashboard />, orders: <IconOrders />, factory: <IconFactory />, truck: <IconTruck />, users: <IconUsers />,
  building: <IconBuilding />, funnel: <IconFunnel />, doc: <IconDoc />, chat: <IconChat />, task: <IconTask />, repeat: <IconRepeat />,
  chart: <IconChart />, settings: <IconSettings />, shield: <IconShield />, store: <IconStore />, tag: <IconTag />, return: <IconReturn />,
  star: <IconStar />, mail: <IconMail />, cash: <IconCash />,
};

export function Layout() {
  const { staff, logout, me, isSeller, sellerId } = useAuth();
  const { sellerName } = useRefData();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const groups = navFor(me?.permissions, sellerId);
  const allowed = screenAllowed(loc.pathname, me?.permissions, sellerId);

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <span className="brand-mark"><svg viewBox="0 0 32 32" width="20" height="20"><path d="M9 8l4-2h6l4 2 3 5-4 2v11H10V15l-4-2z" fill="white" /></svg></span>
          <span>UrJersey<small>{isSeller ? 'Seller portal' : 'Operations'}</small></span>
        </div>
        <nav className="nav">
          {groups.map((g, i) => (
            <div key={i} style={{ display: 'contents' }}>
              {g.title && <div className="nav-group">{g.title}</div>}
              {g.items.map((x) => (
                <NavLink key={x.to} to={x.to} className={({ isActive }) => (isActive ? 'active' : '')} data-testid={x.testId}>{ICONS[x.icon]}{x.label}</NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who" data-testid="whoami">{staff?.name || staff?.email}</div>
          <div className="muted" style={{ marginBottom: 6 }}>{staff && ROLE_LABEL[staff.role]}{isSeller && sellerId ? ` · ${sellerName(sellerId)}` : ''} · {staff?.email}</div>
          <div className="row">
            <NavLink to="/account">Account</NavLink>
            <button className="linklike" onClick={() => void logout()} data-testid="sign-out">Sign out</button>
          </div>
        </div>
      </aside>
      {open && <div className="drawer-overlay" style={{ zIndex: 55 }} onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="topbar no-print">
          <button className="icon-btn menu-btn" aria-label="Open navigation" onClick={() => setOpen(true)}><IconMenu /></button>
          <span className="muted small">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
          <span className="spacer" />
          {isSeller && sellerId && <span className="badge info" data-testid="seller-scope">{sellerName(sellerId)}</span>}
          {staff && <span className="badge accent">{ROLE_LABEL[staff.role] ?? staff.role}</span>}
        </header>
        <main className="content">
          {allowed ? <Outlet /> : (
            <div className="empty" data-testid="not-for-seller">
              <strong>Not available to seller logins</strong>
              This screen is for UrJersey staff. Your login shows your own orders, production, delivery, returns and cash on delivery.
              <div style={{ marginTop: 10 }}><NavLink to="/dashboard">Go to your home page</NavLink></div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
