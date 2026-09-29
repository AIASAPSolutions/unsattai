'use client';
import Link from 'next/link';
import {
  forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import s from './ui.module.css';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ----------------------------------------------------------------- Button

type Kind = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: Kind;
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
  block?: boolean;
  href?: string;
  testId?: string;
}

export function Button({ kind = 'primary', size = 'md', busy, block, href, testId, className, children, disabled, ...rest }: ButtonProps) {
  const cls = cx(s.btn, s[kind], size === 'sm' && s.sm, size === 'lg' && s.lg, block && s.block, className);
  if (href && !disabled) {
    return <Link href={href} className={cls} data-testid={testId}>{children}</Link>;
  }
  return (
    <button type="button" className={cls} disabled={disabled || busy} aria-busy={busy || undefined} data-testid={testId} {...rest}>
      {busy ? <span className={s.spinner} aria-hidden /> : null}
      {children}
    </button>
  );
}

/** A plain link styled as a button, for files and pages outside the app router (invoice, downloads). */
export function ExternalButton({ href, kind = 'secondary', size = 'md', testId, children, newTab = true }: {
  href: string; kind?: Kind; size?: 'sm' | 'md' | 'lg'; testId?: string; children: ReactNode; newTab?: boolean;
}) {
  return (
    <a href={href} className={cx(s.btn, s[kind], size === 'sm' && s.sm, size === 'lg' && s.lg)} data-testid={testId}
      {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}>
      {children}
    </a>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span role="status" className="row" style={{ gap: 8 }}>
      <span className={s.spinner} aria-hidden />
      {label ? <span>{label}</span> : <span className="visually-hidden">Loading</span>}
    </span>
  );
}

// ----------------------------------------------------------------- Fields

interface FieldShell {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  counter?: string;
  optional?: string;
  testId?: string;
}

function Shell({ id, label, hint, error, counter, optional, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={id}>
        {label} {optional ? <span className={s.optional}>({optional})</span> : null}
      </label>
      {children}
      {error || hint || counter ? (
        <div className={s.fieldFoot}>
          <span>
            {error ? <span className={s.error} id={`${id}-err`} role="alert">{error}</span>
              : hint ? <span className={s.hint} id={`${id}-hint`}>{hint}</span> : null}
          </span>
          {counter ? <span className={s.hint}>{counter}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export const TextField = forwardRef<HTMLInputElement, FieldShell & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
  onValue?: (v: string) => void; onChange?: InputHTMLAttributes<HTMLInputElement>['onChange'];
}>(function TextField({ label, hint, error, counter, optional, testId, onValue, onChange, id, className, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Shell id={fid} label={label} hint={hint} error={error} counter={counter} optional={optional}>
      <input ref={ref} id={fid} className={cx(s.input, error && s.inputError, className)} data-testid={testId}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${fid}-err` : hint ? `${fid}-hint` : undefined}
        onChange={(e) => {
          onChange?.(e);
          onValue?.(e.target.value);
        }} {...rest} />
    </Shell>
  );
});

export function TextArea({ label, hint, error, counter, optional, testId, onValue, id, ...rest }: FieldShell &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & { onValue?: (v: string) => void }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Shell id={fid} label={label} hint={hint} error={error} counter={counter} optional={optional}>
      <textarea id={fid} className={cx(s.input, error && s.inputError)} data-testid={testId}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${fid}-err` : hint ? `${fid}-hint` : undefined}
        onChange={(e) => onValue?.(e.target.value)} {...rest} />
    </Shell>
  );
}

export function SelectField({ label, hint, error, optional, testId, onValue, id, children, ...rest }: FieldShell &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & { onValue?: (v: string) => void }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Shell id={fid} label={label} hint={hint} error={error} optional={optional}>
      <select id={fid} className={cx(s.input, error && s.inputError)} data-testid={testId}
        aria-invalid={error ? true : undefined} onChange={(e) => onValue?.(e.target.value)} {...rest}>
        {children}
      </select>
    </Shell>
  );
}

export function Checkbox({ checked, onChange, children, testId, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; children: ReactNode; testId?: string; disabled?: boolean;
}) {
  return (
    <label className={s.checkbox}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span>{children}</span>
    </label>
  );
}

// ----------------------------------------------------------------- Card, Banner, Chip

export function Card({ title, sub, right, children, className, testId, as: As = 'section' }: {
  title?: ReactNode; sub?: ReactNode; right?: ReactNode; children?: ReactNode; className?: string; testId?: string;
  as?: 'section' | 'div' | 'article';
}) {
  const hid = useId();
  return (
    <As className={cx(s.card, className)} data-testid={testId} aria-labelledby={title ? hid : undefined}>
      {title || right ? (
        <div className={s.cardHead}>
          <div>
            {title ? <h2 className={s.cardTitle} id={hid}>{title}</h2> : null}
            {sub ? <p className={s.cardSub}>{sub}</p> : null}
          </div>
          {right}
        </div>
      ) : null}
      {children}
    </As>
  );
}

export type Tone = 'pass' | 'info' | 'warn' | 'fail';
const ICON: Record<Tone, string> = { pass: '✓', info: 'i', warn: '!', fail: '✕' };

export function Banner({ tone = 'info', children, action, onAction, testId, live }: {
  tone?: Tone; children: ReactNode; action?: string; onAction?: () => void; testId?: string; live?: boolean;
}) {
  return (
    <div className={cx(s.banner, s[`tone-${tone}`])} data-testid={testId}
      role={tone === 'fail' ? 'alert' : live ? 'status' : undefined}>
      <span className={s.bannerIcon} aria-hidden>{ICON[tone]}</span>
      <div className={s.bannerBody}>{children}</div>
      {action && onAction ? <Button kind="secondary" size="sm" onClick={onAction}>{action}</Button> : null}
    </div>
  );
}

export function Chip({ selected, onClick, children, testId, disabled, title }: {
  selected?: boolean; onClick?: () => void; children: ReactNode; testId?: string; disabled?: boolean; title?: string;
}) {
  return (
    <button type="button" className={cx(s.chip, selected && s.chipOn)} aria-pressed={selected ?? undefined}
      onClick={onClick} data-testid={testId} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function Chips({ children, label }: { children: ReactNode; label?: string }) {
  return <div className={s.chips} role={label ? 'group' : undefined} aria-label={label}>{children}</div>;
}

export function Stars({ value, onChange, label, testId }: { value: number; onChange: (n: number) => void; label: string; testId?: string }) {
  return (
    <div className={s.stars} role="radiogroup" aria-label={label} data-testid={testId}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} / 5`}
          className={cx(s.star, n <= value && s.starOn)} onClick={() => onChange(n)} data-testid={testId ? `${testId}-${n}` : undefined}>
          ★
        </button>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- States

export function Loading({ label, testId }: { label: string; testId?: string }) {
  return <div className={s.center} data-testid={testId}><Spinner label={label} /></div>;
}

export function Skeleton({ height = 120, className }: { height?: number; className?: string }) {
  return <div className={cx(s.skeleton, className)} style={{ height }} aria-hidden />;
}

export function Empty({ icon = '○', title, children, testId }: { icon?: string; title: string; children?: ReactNode; testId?: string }) {
  return (
    <div className={s.center} data-testid={testId}>
      <div className={s.emptyIcon} aria-hidden>{icon}</div>
      <strong style={{ color: 'var(--ink)' }}>{title}</strong>
      {children}
    </div>
  );
}

export function ErrorState({ message, retryLabel, onRetry, testId }: { message: string; retryLabel?: string; onRetry?: () => void; testId?: string }) {
  return (
    <div className={s.center} data-testid={testId} role="alert">
      <div className={s.emptyIcon} aria-hidden>⚠</div>
      <span style={{ color: 'var(--ink)' }}>{message}</span>
      {retryLabel && onRetry ? <Button kind="secondary" onClick={onRetry}>{retryLabel}</Button> : null}
    </div>
  );
}

export function StatusChip({ tone, children, testId }: { tone: 'neutral' | 'info' | 'warn' | 'pass' | 'fail'; children: ReactNode; testId?: string }) {
  return <span className={cx(s.status, s[`st-${tone}`])} data-testid={testId}>{children}</span>;
}

// ----------------------------------------------------------------- Tabs

export function Tabs<V extends string>({ value, onChange, options, label, testId }: {
  value: V; onChange: (v: V) => void; options: { value: V; label: ReactNode }[]; label: string; testId?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = options.findIndex((o) => o.value === value);
  return (
    <div className={s.tabs} role="tablist" aria-label={label} data-testid={testId}>
      {options.map((o, i) => (
        <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" aria-selected={o.value === value}
          tabIndex={o.value === value ? 0 : -1} className={cx(s.tab, o.value === value && s.tabOn)}
          data-testid={testId ? `${testId}-${o.value}` : undefined}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            const n = (idx + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
            onChange(options[n].value);
            refs.current[n]?.focus();
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- Modal

export function Modal({ open, onClose, title, children, testId, closeLabel = 'Close' }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; testId?: string; closeLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={s.dialog} onClose={onClose} onCancel={onClose} data-testid={testId}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open ? (
        <>
          <div className={s.dialogHead}>
            <h2 className={s.cardTitle}>{title}</h2>
            <Button kind="ghost" size="sm" onClick={onClose} aria-label={closeLabel}>✕</Button>
          </div>
          <div className={s.dialogBody}>{children}</div>
        </>
      ) : null}
    </dialog>
  );
}

// ----------------------------------------------------------------- SVG from the server

/**
 * Server SVG (mock-ups, panels, logo ideas) is drawn as an <img>, never injected into
 * the page: an SVG in an image can't run script, whatever it contains.
 */
export function SvgImg({ svg, alt, className, testId, style }: { svg: string; alt: string; className?: string; testId?: string; style?: React.CSSProperties }) {
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={cx(s.svgBox, className)} data-testid={testId} style={style} draggable={false} />;
}

export function Swatch({ hex, label }: { hex: string; label?: string }) {
  return <span className={s.swatch} style={{ background: hex }} title={label ?? hex} aria-label={label ?? hex} role="img" />;
}

export function Divider() {
  return <hr className={s.divider} />;
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className={s.kv}>
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

// ----------------------------------------------------------------- Popover

/**
 * A panel that opens under its trigger (the parent wraps both in a positioned box).
 * Escape or a click outside closes it and focus returns to the trigger.
 */
export function Popover({ open, onClose, children, label, testId, align = 'start', triggerRef, wide }: {
  open: boolean; onClose: () => void; children: ReactNode; label: string; testId?: string; align?: 'start' | 'end';
  triggerRef: React.RefObject<HTMLElement | null>; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const panel = ref.current;
    panel?.querySelector<HTMLElement>('input, button, a, select, textarea')?.focus();
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (panel?.contains(target) || triggerRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, triggerRef]);
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-label={label} className={cx(s.popover, align === 'end' && s.popEnd, wide && s.popWide)} data-testid={testId}>
      {children}
    </div>
  );
}

/** A count badge on an icon button (cart items, unread notifications). */
export function Badge({ n, testId, label }: { n: number; testId?: string; label?: string }) {
  if (n <= 0) return null;
  return <span className={s.badge} data-testid={testId} aria-label={label}>{n > 99 ? '99+' : n}</span>;
}

/** Stars shown read-only, with the average as text for screen readers. */
export function RatingStars({ value, count, label, testId, size = 'sm' }: {
  value: number | null; count?: number; label: string; testId?: string; size?: 'sm' | 'md';
}) {
  const v = value ?? 0;
  return (
    <span className={cx(s.ratingRow, size === 'md' && s.ratingMd)} data-testid={testId}>
      <span className={s.ratingStars} aria-hidden>
        <span style={{ width: `${(v / 5) * 100}%` }}>★★★★★</span>★★★★★
      </span>
      <span className="visually-hidden">{label}</span>
      {value !== null ? <span className={s.ratingNum} aria-hidden>{value.toFixed(1)}</span> : null}
      {count !== undefined ? <span className={s.ratingCount} aria-hidden>({count})</span> : null}
    </span>
  );
}
