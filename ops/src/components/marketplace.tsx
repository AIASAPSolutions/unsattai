/** Pieces shared by the marketplace screens: the seller filter, seller links, payment badges, ratings. */
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useRefData } from '../lib/refdata';
import type { OrderSummary, Rating } from '../lib/types';
import { Badge } from './ui';

/** The `?seller=` filter in the URL. A seller login is always scoped by the server, so it has none. */
export function useSellerParam(): [string, (id: string) => void] {
  const [params, setParams] = useSearchParams();
  const { isSeller } = useAuth();
  const value = isSeller ? '' : params.get('seller') ?? '';
  const set = (id: string) => {
    const p = new URLSearchParams(params);
    if (id) p.set('seller', id); else p.delete('seller');
    p.delete('page');
    setParams(p, { replace: true });
  };
  return [value, set];
}

/** Keep the seller filter when moving between tabs. */
export function withSeller(path: string, sellerId: string): string {
  return sellerId ? `${path}?seller=${encodeURIComponent(sellerId)}` : path;
}

export function SellerFilter({ value, onChange, testId = 'seller-filter' }: { value: string; onChange: (id: string) => void; testId?: string }) {
  const { sellers } = useRefData();
  const { isSeller } = useAuth();
  if (isSeller) return null;
  return (
    <select className="sm" style={{ width: 'auto', minWidth: 160 }} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Seller" data-testid={testId}>
      <option value="">All sellers</option>
      {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? '' : ' (off)'}</option>)}
      {value && !sellers.some((s) => s.id === value) && <option value={value}>{value}</option>}
    </select>
  );
}

/** Seller name, linked to its page for staff. */
export function SellerLink({ id, name }: { id?: string | null; name?: string | null }) {
  const { sellerName } = useRefData();
  const { isSeller } = useAuth();
  if (!id) return <span className="muted">—</span>;
  const text = name || sellerName(id);
  return isSeller ? <span>{text}</span> : <Link to={`/sellers/${id}`}>{text}</Link>;
}

/** "COD · to collect" / "COD · collected" / nothing for online orders. */
export function PaymentBadge({ o }: { o: Pick<OrderSummary, 'payment_method' | 'cod_collected'> }) {
  if (o.payment_method !== 'cod') return null;
  return o.cod_collected ? <Badge tone="good" title="Cash on delivery, collected">COD collected</Badge> : <Badge tone="warn" title="Cash on delivery, not collected yet">COD</Badge>;
}

export function Stars({ rating }: { rating: Rating | number | null | undefined }) {
  const avg = typeof rating === 'number' ? rating : rating?.average ?? null;
  const count = typeof rating === 'number' ? undefined : rating?.count;
  if (avg === null || avg === undefined) return <span className="muted small">No reviews</span>;
  const full = Math.round(avg);
  return (
    <span className="nowrap" title={`${avg.toFixed(1)} out of 5${count !== undefined ? ` from ${count} review${count === 1 ? '' : 's'}` : ''}`}>
      <span className="stars" aria-hidden="true">{'★'.repeat(full)}<span className="off">{'★'.repeat(5 - full)}</span></span>
      {' '}<span className="small">{avg.toFixed(1)}{count !== undefined && <span className="muted"> ({count})</span>}</span>
    </span>
  );
}

/** A phone or email with a small verified mark (verified by a one-time code). */
export function Verified({ value, verified, testId }: { value?: string | null; verified?: boolean; testId?: string }) {
  if (!value) return null;
  return (
    <span className="verify" data-testid={testId}>
      {value}
      {verified ? <Badge tone="good" title="Verified with a one-time code">Verified</Badge> : <Badge title="Not verified yet">Unverified</Badge>}
    </span>
  );
}
