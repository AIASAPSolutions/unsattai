import { GARMENT_LABEL, money, pct } from '../lib/format';
import { FIT_LABEL, type Pricing } from '../lib/types';
import { Alert } from './ui';

/** Itemised price, in the same order as the server computes it (pricing.py). */
export function PricingBreakdown({ p, showLines = true, testId }: { p: Pricing; showLines?: boolean; testId?: string }) {
  const c = p.currency;
  const rows: [string, number, string?][] = [['Subtotal', p.subtotal]];
  if (p.quantity_discount.amount) rows.push([`Quantity discount (${p.quantity_discount.min}+ pieces, ${pct(p.quantity_discount.rate)})`, -p.quantity_discount.amount]);
  if (p.rush.selected) rows.push([`${p.rush.label} (${pct(p.rush.rate)})`, p.rush.amount]);
  if (p.coupon && p.coupon.amount) rows.push([`Coupon ${p.coupon.code}`, -p.coupon.amount]);
  const sh = p.shipping;
  rows.push([sh.method === 'pickup' ? (sh.label || 'Pickup') : `Delivery${sh.zone_name ? ` — ${sh.zone_name}` : ''}${sh.free ? ' (free)' : ''}`, sh.amount]);
  rows.push([`${p.tax.name} ${pct(p.tax.rate, p.tax.rate * 100 % 1 ? 1 : 0)}${p.tax.inclusive ? ' (included)' : ''}`, p.tax.amount]);
  if (p.sales_discount) rows.push(['Sales discount', -p.sales_discount]);
  return (
    <div className="stack tight" data-testid={testId}>
      {p.problems.length > 0 && <Alert tone="warn"><ul style={{ margin: 0 }}>{p.problems.map((x) => <li key={x}>{x}</li>)}</ul></Alert>}
      {p.coupon?.error && <Alert tone="warn">Coupon {p.coupon.code}: {p.coupon.error}</Alert>}
      {showLines && (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>#</th><th>Name</th><th>No.</th><th>Size</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {p.lines.map((l) => (
                <tr key={l.line} title={`Garment ${l.parts.garment} + fabric ${l.parts.fabric} + logos ${l.parts.logos} + size ${l.parts.size} + name ${l.parts.name} + number ${l.parts.number}${l.parts.sleeves ? ` + sleeves ${l.parts.sleeves}` : ''}${l.parts.collar ? ` + collar ${l.parts.collar}` : ''}${l.parts.fit ? ` + fit ${l.parts.fit}` : ''}`}>
                  <td>{l.line}</td><td>{l.player_name || '—'}</td><td>{l.number || '—'}</td><td>{l.fit && l.fit !== 'men' ? `${FIT_LABEL[l.fit]} ` : ''}{l.size}</td>
                  <td className="num">{l.quantity}</td><td className="num">{money(l.unit_price, c)}</td><td className="num">{money(l.line_total, c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <table className="table compact">
        <tbody>
          {rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{money(v, c)}</td></tr>)}
        </tbody>
        <tfoot><tr><td>Total</td><td className="num" data-testid={testId ? `${testId}-total` : undefined}>{money(p.total, c)}</td></tr></tfoot>
      </table>
      <div className="muted small">
        {GARMENT_LABEL[p.garment] ?? p.garment} · {p.fabric.name}
        {[p.options?.sleeves, p.options?.collar].filter(Boolean).map((o) => <span key={o!.id}> · {o!.name}{o!.price ? ` (${o!.price > 0 ? '+' : '−'}${money(Math.abs(o!.price), c)} per piece)` : ''}</span>)} · {p.pieces} pieces · {money(p.average_per_piece, c)} per piece
        · price book {p.price_book_version === 'draft' ? 'draft' : `v${p.price_book_version}`}
        {p.quantity_discount.next && <> · {p.quantity_discount.next.pieces_needed} more pieces for {pct(p.quantity_discount.next.rate)} off</>}
      </div>
    </div>
  );
}
