import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type ReactNode,
} from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError, errorText } from '../lib/errors';
import { label } from '../lib/format';
import { IconAlert, IconArrowDown, IconArrowUp, IconCopy, IconSearch, IconX } from './icons';

// ------------------------------------------------------------------ buttons

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'danger-solid';
  size?: 'md' | 'sm' | 'xs';
  busy?: boolean;
  icon?: ReactNode;
};
export function Button({ variant = 'default', size = 'md', busy, icon, children, className = '', disabled, type = 'button', ...rest }: BtnProps) {
  const v = variant === 'danger-solid' ? 'danger solid' : variant === 'default' ? '' : variant;
  return (
    <button type={type} className={`btn ${v} ${size === 'md' ? '' : size} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="spinner" style={{ width: 13, height: 13 }} /> : icon}
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ badges

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'accent';
export function Badge({ tone = 'neutral', children, dot, title }: { tone?: Tone; children: ReactNode; dot?: boolean; title?: string }) {
  return <span className={`badge ${tone === 'neutral' ? '' : tone}`} title={title}>{dot && <span className="dot" />}{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  awaiting_payment: 'warn', queued: 'accent', in_production: 'info', ready: 'good', dispatched: 'accent', delivered: 'good', cancelled: 'bad',
  planned: 'neutral', packed: 'info', returned: 'bad',
  open: 'warn', pending: 'info', resolved: 'good', closed: 'neutral',
  draft: 'neutral', sent: 'accent', accepted: 'good', converted: 'good', declined: 'bad', expired: 'warn',
  won: 'good', lost: 'bad', active: 'good', blocked: 'bad', archived: 'neutral', inactive: 'neutral',
  low: 'neutral', normal: 'neutral', high: 'warn', urgent: 'bad',
};
export function StatusBadge({ status, text }: { status: string | null | undefined; text?: string }) {
  if (!status) return <span className="muted">—</span>;
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'} dot>{text ?? label(status)}</Badge>;
}

// ------------------------------------------------------------------ layout pieces

export function PageHeader({ title, subtitle, crumbs, actions }: { title: ReactNode; subtitle?: ReactNode; crumbs?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="grow">
        {crumbs && <div className="crumbs">{crumbs}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, flush, footer, className = '', id }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; footer?: ReactNode; className?: string; id?: string;
}) {
  return (
    <section className={`card ${className}`} id={id}>
      {(title || actions) && <div className="card-head"><h2>{title}</h2>{actions}</div>}
      <div className={`card-body ${flush ? 'flush' : ''}`}>{children}</div>
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}

export function Kpi({ k, v, s, alert, to, testId }: { k: string; v: ReactNode; s?: ReactNode; alert?: boolean; to?: string; testId?: string }) {
  const body = <><div className="k">{k}</div><div className="v" data-testid={testId}>{v}</div>{s && <div className="s">{s}</div>}</>;
  return to ? <NavLink to={to} className={`kpi ${alert ? 'kpi-alert' : ''}`}>{body}</NavLink> : <div className={`kpi ${alert ? 'kpi-alert' : ''}`}>{body}</div>;
}

export function Tabs({ tabs }: { tabs: { to: string; label: ReactNode; end?: boolean }[] }) {
  return (
    <nav className="tabs no-print">
      {tabs.map((t) => <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>{t.label}</NavLink>)}
    </nav>
  );
}

export function ButtonTabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ value, options, onChange, multi }: {
  value: T[]; options: { value: T; label: ReactNode; count?: number }[]; onChange: (v: T[]) => void; multi?: boolean;
}) {
  return (
    <div className="chips" role="group">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} data-chip={o.value}
            onClick={() => onChange(multi ? (on ? value.filter((x) => x !== o.value) : [...value, o.value]) : on ? [] : [o.value])}>
            {o.label}{o.count !== undefined && <span className="count">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', testId }: { value: string; onChange: (v: string) => void; placeholder?: string; testId?: string }) {
  return (
    <div className="search">
      <IconSearch />
      <input type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} data-testid={testId} />
    </div>
  );
}

// ------------------------------------------------------------------ feedback

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return <div className="loading-block"><span className="spinner" /> {text}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><strong>{title}</strong>{children}</div>;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { staff } = useAuth();
  if (!error) return null;
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <div className="alert error" role="alert">
      <IconAlert width={16} height={16} />
      <div className="grow">
        {forbidden ? <><strong>Not allowed.</strong> {errorText(error)} {staff && <>Your role is <b>{staff.role}</b>; ask an admin if you need access.</>}</> : errorText(error)}
        {error instanceof ApiError && error.fields.length > 1 && (
          <ul>{error.fields.map((f, i) => <li key={i}>{f.path ? <code>{f.path}</code> : null} {f.message}</li>)}</ul>
        )}
      </div>
      {onRetry && !forbidden && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function Alert({ tone = 'info', children, action }: { tone?: 'info' | 'warn' | 'error' | 'good'; children: ReactNode; action?: ReactNode }) {
  return <div className={`alert ${tone}`} role={tone === 'error' ? 'alert' : 'status'}><div className="grow">{children}</div>{action}</div>;
}

// ------------------------------------------------------------------ toasts

interface ToastItem { id: number; kind: 'info' | 'success' | 'error'; text: string }
interface ToastApi { info: (t: string) => void; success: (t: string) => void; error: (e: unknown) => void }
const ToastCtx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const n = useRef(0);
  const { staff } = useAuth();
  const push = useCallback((kind: ToastItem['kind'], text: string) => {
    const id = ++n.current;
    setItems((xs) => [...xs.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);
  const api = useMemo<ToastApi>(() => ({
    info: (t) => push('info', t),
    success: (t) => push('success', t),
    error: (e) => push('error', errorText(e, staff?.role)),
  }), [push, staff?.role]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'} data-testid={`toast-${t.kind}`}>
            <span className="toast-msg">{t.text}</span>
            <button aria-label="Dismiss" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast(): ToastApi {
  const v = useContext(ToastCtx);
  if (!v) throw new Error('useToast outside ToastProvider');
  return v;
}

// ------------------------------------------------------------------ overlays

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
}

export function Modal({ open, title, onClose, children, footer, wide, testId }: {
  open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; testId?: string;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} data-testid={testId}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><IconX /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, title, onClose, children, footer, wide, actions, testId }: {
  open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; actions?: ReactNode; testId?: string;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className={`drawer ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" data-testid={testId}>
        <div className="drawer-head"><h2>{title}</h2>{actions}<button className="icon-btn" onClick={onClose} aria-label="Close"><IconX /></button></div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </>
  );
}

// ------------------------------------------------------------------ forms

export function Field({ label: l, hint, errors, children, className = '', htmlFor }: {
  label?: ReactNode; hint?: ReactNode; errors?: string[]; children: ReactNode; className?: string; htmlFor?: string;
}) {
  const bad = !!errors?.length;
  return (
    <div className={`field ${bad ? 'invalid' : ''} ${className}`}>
      {l && <label htmlFor={htmlFor}>{l}</label>}
      {children}
      {bad ? errors!.map((e, i) => <div key={i} className="err" role="alert">{e}</div>) : hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function TagInput({ value, onChange, placeholder = 'Add…', disabled, normalise, testId }: {
  value: string[]; onChange: (v: string[]) => void; placeholder?: string; disabled?: boolean; normalise?: (s: string) => string; testId?: string;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = (normalise ? normalise(draft) : draft.trim());
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft('');
  };
  return (
    <div className="stack tight">
      <div className="row tight">
        {value.map((t) => (
          <span key={t} className="tag">{t}{!disabled && <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>×</button>}</span>
        ))}
        {!value.length && <span className="muted small">None</span>}
      </div>
      {!disabled && (
        <div className="row tight">
          <input className="sm" style={{ maxWidth: 220 }} value={draft} placeholder={placeholder} data-testid={testId}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }} />
          <Button size="sm" onClick={add} disabled={!draft.trim()}>Add</Button>
        </div>
      )}
    </div>
  );
}

export function CopyButton({ text, label: l = 'Copy', testId }: { text: string; label?: string; testId?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return <Button size="sm" icon={<IconCopy />} onClick={copy} data-testid={testId}>{done ? 'Copied' : l}</Button>;
}

// ------------------------------------------------------------------ tables

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  sort?: (row: T) => string | number | null | undefined;
  num?: boolean;
  className?: string;
  width?: number | string;
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, empty = 'Nothing here yet.', initialSort, pageSize, compact, footer, testId }: {
  columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; empty?: ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' }; pageSize?: number; compact?: boolean; footer?: ReactNode; testId?: string;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(1);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const f = col.sort;
    return [...rows].sort((a, b) => {
      const x = f(a), y = f(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return sort.dir === 'asc' ? r : -r;
    });
  }, [rows, sort, columns]);
  const pages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const cur = Math.min(page, pages);
  const shown = pageSize ? sorted.slice((cur - 1) * pageSize, cur * pageSize) : sorted;
  const toggle = (c: Column<T>) => {
    if (!c.sort) return;
    setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.num ? 'desc' : 'asc' }));
  };
  return (
    <>
      <div className="table-wrap">
        <table className={`table ${compact ? 'compact' : ''}`} data-testid={testId}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`${c.sort ? 'sortable' : ''} ${c.num ? 'num' : ''}`} style={{ width: c.width }} onClick={() => toggle(c)}
                  aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <span className="row tight" style={{ display: 'inline-flex', flexWrap: 'nowrap' }}>
                    {c.header}
                    {sort?.key === c.key && (sort.dir === 'asc' ? <IconArrowUp width={12} height={12} /> : <IconArrowDown width={12} height={12} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={rowKey(r)} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? (e) => {
                if ((e.target as HTMLElement).closest('a,button,input,select,textarea,label')) return;
                onRowClick(r);
              } : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={`${c.num ? 'num' : ''} ${c.className ?? ''}`}>
                    {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={columns.length}><div className="empty">{empty}</div></td></tr>}
          </tbody>
          {footer}
        </table>
      </div>
      {pageSize && sorted.length > pageSize && <Pager page={cur} pages={pages} total={sorted.length} onPage={setPage} />}
    </>
  );
}

export function Pager({ page, pages, total, onPage, noun = 'rows' }: { page: number; pages: number; total: number; onPage: (p: number) => void; noun?: string }) {
  return (
    <div className="pager">
      <span>{total} {noun}</span>
      <span className="spacer" />
      <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span>Page {page} of {pages}</span>
      <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}
