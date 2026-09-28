import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL } from '../lib/permissions';
import {
  IconBuilding, IconChart, IconChat, IconDashboard, IconDoc, IconFactory, IconFunnel, IconMenu, IconOrders, IconRepeat,
  IconSettings, IconShield, IconTask, IconTruck, IconUsers,
} from './icons';

interface Item { to: string; label: string; icon: ReactNode; show?: boolean }

export function Layout() {
  const { staff, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  const groups: { title?: string; items: Item[] }[] = [
    { items: [
      { to: '/dashboard', label: 'Dashboard', icon: <IconDashboard /> },
      { to: '/orders', label: 'Orders', icon: <IconOrders /> },
      { to: '/production', label: 'Production', icon: <IconFactory /> },
      { to: '/delivery', label: 'Delivery', icon: <IconTruck /> },
    ] },
    { title: 'CRM', items: [
      { to: '/crm/customers', label: 'Customers', icon: <IconUsers /> },
      { to: '/crm/organisations', label: 'Organisations', icon: <IconBuilding /> },
      { to: '/crm/leads', label: 'Leads', icon: <IconFunnel /> },
      { to: '/crm/quotes', label: 'Quotes', icon: <IconDoc /> },
      { to: '/crm/tickets', label: 'Tickets', icon: <IconChat /> },
      { to: '/crm/tasks', label: 'Tasks', icon: <IconTask /> },
      { to: '/crm/reorders', label: 'Reorders', icon: <IconRepeat /> },
    ] },
    { title: 'Business', items: [
      { to: '/reports', label: 'Reports', icon: <IconChart /> },
      { to: '/settings', label: 'Settings', icon: <IconSettings /> },
      { to: '/staff', label: 'Staff', icon: <IconShield />, show: can('staff') },
    ] },
  ];

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <span className="brand-mark"><svg viewBox="0 0 32 32" width="20" height="20"><path d="M9 8l4-2h6l4 2 3 5-4 2v11H10V15l-4-2z" fill="white" /></svg></span>
          <span>UrJersey<small>Operations</small></span>
        </div>
        <nav className="nav">
          {groups.map((g, i) => (
            <div key={i} style={{ display: 'contents' }}>
              {g.title && <div className="nav-group">{g.title}</div>}
              {g.items.filter((x) => x.show !== false).map((x) => (
                <NavLink key={x.to} to={x.to} className={({ isActive }) => (isActive ? 'active' : '')}>{x.icon}{x.label}</NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who" data-testid="whoami">{staff?.name || staff?.email}</div>
          <div className="muted" style={{ marginBottom: 6 }}>{staff && ROLE_LABEL[staff.role]} · {staff?.email}</div>
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
          {staff && <span className="badge accent">{ROLE_LABEL[staff.role]}</span>}
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}
