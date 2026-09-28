/** Display helpers. */

const moneyFmt = new Map<string, Intl.NumberFormat>();
export function money(n: number | null | undefined, currency = 'INR', digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const key = `${currency}:${digits}`;
  if (!moneyFmt.has(key)) {
    try {
      moneyFmt.set(key, new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }));
    } catch {
      moneyFmt.set(key, new Intl.NumberFormat('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
    }
  }
  return moneyFmt.get(key)!.format(Math.abs(n) < 0.005 ? 0 : n);
}
export const money0 = (n: number | null | undefined, currency = 'INR') => money(n, currency, 0);

export function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-IN').format(n);
}
export function pct(fraction: number | null | undefined, digits = 0): string {
  if (fraction === null || fraction === undefined) return '—';
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** "2026-10-04" -> "Sun 4 Oct". Dates without time are treated as calendar days (no TZ shift). */
export function day(iso: string | null | undefined, withYear = false): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: withYear ? 'numeric' : undefined, timeZone: 'UTC' });
}
export function shortDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
export function weekday(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
}
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(s)) return iso;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return dateTime(iso);
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function label(code: string | null | undefined): string {
  if (!code) return '—';
  const s = code.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const GARMENT_LABEL: Record<string, string> = { jersey: 'Crew-neck jersey', vneck: 'V-neck jersey', shorts: 'Shorts' };

/** "staff:stf_x" -> name from the staff list, "customer:cus_x" -> "Customer", "system" -> "System". */
export function actorName(actor: string | null | undefined, staff: { id: string; name?: string; email: string }[] = []): string {
  if (!actor) return '—';
  if (actor === 'system') return 'System';
  const [kind, id] = actor.split(':');
  if (kind === 'staff') {
    const s = staff.find((x) => x.id === id);
    return s ? s.name || s.email : id?.startsWith('stf_') ? 'Staff' : id || 'Staff';
  }
  if (kind === 'customer') return 'Customer';
  return label(actor);
}

/** CSV-safe download name with a date. */
export function fileStamp(prefix: string, ext: string): string {
  return `${prefix}-${isoDate()}.${ext}`;
}
