import { useMemo, useState } from 'react';
import { IconPlus, IconTrash } from '../../components/icons';
import { Alert, Badge, Button, Card, ErrorBox } from '../../components/ui';
import { post } from '../../lib/api';
import { ApiError } from '../../lib/errors';
import { GARMENT_LABEL, money, pct } from '../../lib/format';
import { useDebounced, useLoad } from '../../lib/hooks';
import { formToPriceBook, priceBookToForm, setIn, type PriceBook, type PriceBookForm } from '../../lib/settingsForm';
import { GARMENTS, SIZES, type Garment, type Pricing, type Size } from '../../lib/types';
import { CellErr, F, NumInput, SettingsEditor, type Editor } from './common';

type E = Editor<PriceBookForm, PriceBook>;

export default function PriceBookEditor() {
  return (
    <SettingsEditor<PriceBookForm, PriceBook> section="price_book" toForm={priceBookToForm} fromForm={formToPriceBook}
      intro={<p className="muted" style={{ margin: 0 }}>Prices apply to new quotes and checkouts as soon as you save. Existing orders and sent quotes keep their prices. Percentages are entered as percent (5 = 5%).</p>}
      aside={(e) => <TryIt e={e} />}>
      {(e) => <Body e={e} />}
    </SettingsEditor>
  );
}

function Body({ e }: { e: E }) {
  const { form: f, err } = e;
  const set = (path: (string | number)[], v: unknown) => e.setForm((cur) => setIn(cur, path, v));
  const cur = f.currency;
  return (
    <>
      <Card title="Garments" actions={<label className="row tight small">Currency <input className="sm" style={{ width: 70 }} value={f.currency} maxLength={3} onChange={(x) => set(['currency'], x.target.value.toUpperCase())} /></label>}>
        <table className="table compact">
          <thead><tr><th>Garment</th><th>Name shown to customers</th><th className="num">Base price per piece</th></tr></thead>
          <tbody>
            {GARMENTS.map((g) => (
              <tr key={g}>
                <td className="muted">{g}</td>
                <td><input value={f.garments[g].name} maxLength={60} onChange={(x) => set(['garments', g, 'name'], x.target.value)} className={err(`garments.${g}.name`) ? 'invalid' : ''} /><CellErr errors={err(`garments.${g}.name`)} /></td>
                <td style={{ width: 180 }}><NumInput value={f.garments[g].base} onChange={(v) => set(['garments', g, 'base'], v)} errors={err(`garments.${g}.base`)} suffix={cur} testId={`price-${g}`} /><CellErr errors={err(`garments.${g}.base`)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <CellErr errors={err('garments')} />
      </Card>

      <Card title="Fabrics" actions={<Button size="sm" icon={<IconPlus />} onClick={() => set(['fabrics'], [...f.fabrics, { id: `fabric${f.fabrics.length + 1}`, name: '', surcharge: '0', garments: [...GARMENTS] }])}>Add fabric</Button>} flush>
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>ID</th><th>Name</th><th className="num">Surcharge per piece</th><th>Available for</th><th /></tr></thead>
            <tbody>
              {f.fabrics.map((x, i) => (
                <tr key={i}>
                  <td style={{ width: 120 }}><input value={x.id} maxLength={30} onChange={(v) => set(['fabrics', i, 'id'], v.target.value.toLowerCase())} className={err(`fabrics.${i}.id`) ? 'invalid' : ''} /><CellErr errors={err(`fabrics.${i}.id`)} /></td>
                  <td><input value={x.name} maxLength={80} onChange={(v) => set(['fabrics', i, 'name'], v.target.value)} className={err(`fabrics.${i}.name`) ? 'invalid' : ''} /><CellErr errors={err(`fabrics.${i}.name`)} /></td>
                  <td style={{ width: 150 }}><NumInput value={x.surcharge} onChange={(v) => set(['fabrics', i, 'surcharge'], v)} errors={err(`fabrics.${i}.surcharge`)} suffix={cur} /></td>
                  <td>
                    <div className="row tight">
                      {GARMENTS.map((g) => (
                        <label key={g} className="check small"><input type="checkbox" checked={x.garments.includes(g)}
                          onChange={(v) => set(['fabrics', i, 'garments'], v.target.checked ? [...x.garments, g] : x.garments.filter((y) => y !== g))} />{g}</label>
                      ))}
                    </div>
                    <CellErr errors={err(`fabrics.${i}.garments`, true)} />
                  </td>
                  <td style={{ width: 40 }}><button type="button" className="icon-btn" aria-label="Remove fabric" disabled={f.fabrics.length <= 1} onClick={() => set(['fabrics'], f.fabrics.filter((_, j) => j !== i))}><IconTrash /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ paddingTop: 6 }}><CellErr errors={err('fabrics')} /><span className="muted small">Removing a fabric does not change existing orders. IDs are lower case letters, digits, - and _.</span></div>
      </Card>

      <div className="grid grid-2">
        <Card title="Size surcharges">
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {SIZES.map((s) => <F key={s} label={s} errors={err(`size_surcharge.${s}`)}><NumInput value={f.size_surcharge[s]} onChange={(v) => set(['size_surcharge', s], v)} errors={err(`size_surcharge.${s}`)} suffix={cur} /></F>)}
          </div>
        </Card>
        <Card title="Personalisation and minimum">
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <F label="Name, per piece" errors={err('personalisation.name')}><NumInput value={f.personalisation.name} onChange={(v) => set(['personalisation', 'name'], v)} errors={err('personalisation.name')} suffix={cur} /></F>
            <F label="Number, per piece" errors={err('personalisation.number')}><NumInput value={f.personalisation.number} onChange={(v) => set(['personalisation', 'number'], v)} errors={err('personalisation.number')} suffix={cur} /></F>
            <F label="Logo, per logo per piece" errors={err('logo_per_piece')}><NumInput value={f.logo_per_piece} onChange={(v) => set(['logo_per_piece'], v)} errors={err('logo_per_piece')} suffix={cur} /></F>
            <F label="Minimum pieces per order" errors={err('minimum_pieces')}><NumInput value={f.minimum_pieces} onChange={(v) => set(['minimum_pieces'], v)} errors={err('minimum_pieces')} /></F>
          </div>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Quantity tiers" actions={<Button size="sm" icon={<IconPlus />} onClick={() => {
          const last = Number(f.quantity_tiers[f.quantity_tiers.length - 1]?.min) || 1;
          set(['quantity_tiers'], [...f.quantity_tiers, { min: String(last * 2), discount: '0' }]);
        }}>Add tier</Button>} flush>
          <table className="table compact">
            <thead><tr><th>From pieces</th><th>Discount</th><th /></tr></thead>
            <tbody>
              {f.quantity_tiers.map((t, i) => (
                <tr key={i}>
                  <td><NumInput value={t.min} onChange={(v) => set(['quantity_tiers', i, 'min'], v)} errors={err(`quantity_tiers.${i}.min`)} /><CellErr errors={err(`quantity_tiers.${i}.min`)} /></td>
                  <td><NumInput value={t.discount} onChange={(v) => set(['quantity_tiers', i, 'discount'], v)} errors={err(`quantity_tiers.${i}.discount`)} suffix="%" /><CellErr errors={err(`quantity_tiers.${i}.discount`)} /></td>
                  <td style={{ width: 40 }}><button type="button" className="icon-btn" aria-label="Remove tier" disabled={i === 0} onClick={() => set(['quantity_tiers'], f.quantity_tiers.filter((_, j) => j !== i))}><IconTrash /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="card-body" style={{ paddingTop: 6 }}><CellErr errors={err('quantity_tiers')} /><span className="muted small">The first tier starts at 1 piece; each tier applies to the whole order.</span></div>
        </Card>
        <div className="stack">
          <Card title="Express production">
            <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <label className="check wide"><input type="checkbox" checked={f.rush.enabled} onChange={(v) => set(['rush', 'enabled'], v.target.checked)} /> Offer express production</label>
              <F label="Fee (of goods after discount)" errors={err('rush.fee_rate')}><NumInput value={f.rush.fee_rate} onChange={(v) => set(['rush', 'fee_rate'], v)} errors={err('rush.fee_rate')} suffix="%" /></F>
              <F label="Label" errors={err('rush.label')}><input value={f.rush.label} maxLength={60} onChange={(v) => set(['rush', 'label'], v.target.value)} /></F>
            </div>
          </Card>
          <Card title="Cash on delivery">
            <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }} data-testid="cod-settings">
              <label className="check wide"><input type="checkbox" checked={f.cod.enabled} onChange={(v) => set(['cod', 'enabled'], v.target.checked)} data-testid="cod-enabled" /> Offer cash on delivery</label>
              <F label="Fee per checkout" errors={err('cod.fee')} hint="Charged once per cart, on top of delivery."><NumInput value={f.cod.fee} onChange={(v) => set(['cod', 'fee'], v)} errors={err('cod.fee')} suffix={cur} testId="cod-fee" /></F>
              <F label="Largest order total" errors={err('cod.max_order_value')} hint="Empty for no limit."><NumInput value={f.cod.max_order_value} placeholder="No limit" onChange={(v) => set(['cod', 'max_order_value'], v)} errors={err('cod.max_order_value')} suffix={cur} testId="cod-max" /></F>
            </div>
            <p className="muted small" style={{ margin: '8px 0 0' }}>Each seller also turns COD on or off per delivery area. COD orders go straight to production.</p>
          </Card>
          <Card title="Tax">
            <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <F label="Name" errors={err('tax.name')}><input value={f.tax.name} maxLength={20} onChange={(v) => set(['tax', 'name'], v.target.value)} /></F>
              <F label="Rate" errors={err('tax.rate')}><NumInput value={f.tax.rate} onChange={(v) => set(['tax', 'rate'], v)} errors={err('tax.rate')} suffix="%" /></F>
              <F label="Higher rate" errors={err('tax.rate_above')}><NumInput value={f.tax.rate_above} onChange={(v) => set(['tax', 'rate_above'], v)} errors={err('tax.rate_above')} suffix="%" /></F>
              <F label="Higher rate above, per piece" errors={err('tax.threshold_per_piece')}><NumInput value={f.tax.threshold_per_piece} onChange={(v) => set(['tax', 'threshold_per_piece'], v)} errors={err('tax.threshold_per_piece')} suffix={cur} /></F>
              <label className="check wide"><input type="checkbox" checked={f.tax.inclusive} onChange={(v) => set(['tax', 'inclusive'], v.target.checked)} /> Prices include tax</label>
            </div>
          </Card>
        </div>
      </div>

      <Card title="Coupons" actions={<Button size="sm" icon={<IconPlus />} onClick={() => set(['coupons'], [...f.coupons, { code: '', kind: 'percent', value: '10', max_discount: '', min_subtotal: '0', active: true, expires: '', note: '', public: false, title: '' }])}>Add coupon</Button>} flush>
        <div className="card-body stack">
          {f.coupons.map((c, i) => (
            <div key={i} className="coupon-row" data-testid={`coupon-${i}`}>
              <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', flex: 1 }}>
                <F label="Code" errors={err(`coupons.${i}.code`)}><input value={c.code} maxLength={24} onChange={(v) => set(['coupons', i, 'code'], v.target.value.toUpperCase())} /></F>
                <F label="Type"><select value={c.kind} onChange={(v) => set(['coupons', i, 'kind'], v.target.value)}><option value="percent">Percent off</option><option value="amount">Amount off</option></select></F>
                <F label="Value" errors={err(`coupons.${i}.value`)}><NumInput value={c.value} onChange={(v) => set(['coupons', i, 'value'], v)} errors={err(`coupons.${i}.value`)} suffix={c.kind === 'percent' ? '%' : cur} /></F>
                <F label="Cap" errors={err(`coupons.${i}.max_discount`)}><NumInput value={c.max_discount} placeholder="No cap" onChange={(v) => set(['coupons', i, 'max_discount'], v)} errors={err(`coupons.${i}.max_discount`)} suffix={cur} /></F>
                <F label="Minimum order" errors={err(`coupons.${i}.min_subtotal`)}><NumInput value={c.min_subtotal} onChange={(v) => set(['coupons', i, 'min_subtotal'], v)} errors={err(`coupons.${i}.min_subtotal`)} suffix={cur} /></F>
                <F label="Expires" errors={err(`coupons.${i}.expires`)}><input type="date" value={c.expires} onChange={(v) => set(['coupons', i, 'expires'], v.target.value)} /></F>
                <F label="Note" className="wide"><input value={c.note} maxLength={120} placeholder="Internal note" onChange={(v) => set(['coupons', i, 'note'], v.target.value)} /></F>
                <F label="Title in the offers list" className="wide" errors={err(`coupons.${i}.title`)} hint={c.public ? 'Customers see this at checkout under Available offers.' : 'Needed only when listed publicly.'}>
                  <input value={c.title} maxLength={80} placeholder="10% off orders above 1000" onChange={(v) => set(['coupons', i, 'title'], v.target.value)} className={err(`coupons.${i}.title`) ? 'invalid' : ''} data-testid={`coupon-title-${i}`} />
                </F>
              </div>
              <div className="stack tight" style={{ alignItems: 'center' }}>
                <label className="check small"><input type="checkbox" checked={c.active} onChange={(v) => set(['coupons', i, 'active'], v.target.checked)} /> Active</label>
                <label className="check small" title="Listed at checkout under Available offers"><input type="checkbox" checked={c.public} onChange={(v) => set(['coupons', i, 'public'], v.target.checked)} data-testid={`coupon-public-${i}`} /> Public</label>
                <button type="button" className="icon-btn" aria-label="Remove coupon" onClick={() => set(['coupons'], f.coupons.filter((_, j) => j !== i))}><IconTrash /></button>
              </div>
            </div>
          ))}
          {!f.coupons.length && <div className="muted">No coupons.</div>}
        </div>
        <div className="card-body" style={{ paddingTop: 6 }}><span className="muted small">Codes: A–Z, 0–9, - and _, 3 to 24 characters. Percent coupons are at most 90%. Public coupons are listed at checkout; others work only when typed.</span></div>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Try it: draft vs current

interface Example { garment: Garment; fabric: string; size: Size; quantity: string; xxl: string; names: boolean; numbers: boolean; logos: string; rush: boolean; coupon: string; pincode: string; cod: boolean }

function TryIt({ e }: { e: E }) {
  const [ex, setEx] = useState<Example>({ garment: 'jersey', fabric: 'standard', size: 'M', quantity: '15', xxl: '0', names: true, numbers: true, logos: '1', rush: false, coupon: '', pincode: '600001', cod: false });
  const setX = <K extends keyof Example>(k: K, v: Example[K]) => setEx((c) => ({ ...c, [k]: v }));
  const fabrics = e.draft.value.fabrics.filter((x) => x.garments.includes(ex.garment));
  const fabric = fabrics.some((x) => x.id === ex.fabric) ? ex.fabric : fabrics[0]?.id ?? 'standard';
  const request = useMemo(() => {
    const q = Math.max(0, Math.round(Number(ex.quantity) || 0));
    const x = Math.max(0, Math.round(Number(ex.xxl) || 0));
    const line = (size: Size, quantity: number) => ({ size, quantity, player_name: ex.names ? 'PLAYER' : '', number: ex.numbers ? '10' : '' });
    const lines = [...(q ? [line(ex.size, q)] : []), ...(x ? [line('XXL', x)] : [])];
    return { garment: ex.garment, fabric, logos: Math.min(4, Math.max(0, Math.round(Number(ex.logos) || 0))), lines: lines.length ? lines : [line(ex.size, 1)],
      rush: ex.rush, coupon: ex.coupon.trim().toUpperCase(), delivery: { method: 'ship', pincode: /^\d{6}$/.test(ex.pincode) ? ex.pincode : '', state: '' },
      payment_method: ex.cod ? 'cod' : 'online' };
  }, [ex, fabric]);
  const body = useDebounced({ price_book: e.draft.value, request, ok: !e.draft.errors.length }, 450);
  const sim = useLoad(() => (body.ok ? post<{ draft: Pricing; current: Pricing }>('/ops/pricing/simulate', { price_book: body.price_book, request: body.request }, undefined) : Promise.resolve(null)),
    [JSON.stringify(body)]);
  const r = sim.data;
  const cur = e.draft.value.currency;
  const rows: [string, (p: Pricing) => number][] = [
    ['Subtotal', (p) => p.subtotal],
    ['Quantity discount', (p) => -p.quantity_discount.amount],
    ['Express', (p) => p.rush.amount],
    ['Coupon', (p) => -(p.coupon?.amount ?? 0)],
    ['Delivery', (p) => p.shipping.amount],
    ['Cash on delivery fee', (p) => (p.cod?.selected ? p.cod.fee : 0)],
    ['Tax', (p) => p.tax.amount],
  ];
  const delta = r ? r.draft.total - r.current.total : 0;
  return (
    <Card title="Try it" actions={sim.loading && <span className="spinner" />} className="try-it">
      <div className="stack tight" data-testid="try-it">
        <p className="muted small" style={{ margin: 0 }}>Price an example order with your unsaved draft and with the saved price book.</p>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          <F label="Garment"><select className="sm" value={ex.garment} onChange={(v) => setX('garment', v.target.value as Garment)}>{GARMENTS.map((g) => <option key={g} value={g}>{GARMENT_LABEL[g]}</option>)}</select></F>
          <F label="Fabric"><select className="sm" value={fabric} onChange={(v) => setX('fabric', v.target.value)}>{fabrics.map((x) => <option key={x.id} value={x.id}>{x.name || x.id}</option>)}</select></F>
          <F label="Size"><select className="sm" value={ex.size} onChange={(v) => setX('size', v.target.value as Size)}>{SIZES.map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="Pieces"><input className="sm num" value={ex.quantity} inputMode="numeric" onChange={(v) => setX('quantity', v.target.value)} data-testid="try-qty" /></F>
          <F label="Extra XXL pieces"><input className="sm num" value={ex.xxl} inputMode="numeric" onChange={(v) => setX('xxl', v.target.value)} /></F>
          <F label="Logos"><input className="sm num" value={ex.logos} inputMode="numeric" onChange={(v) => setX('logos', v.target.value)} /></F>
          <F label="Pincode"><input className="sm" value={ex.pincode} maxLength={6} onChange={(v) => setX('pincode', v.target.value)} /></F>
          <F label="Coupon"><input className="sm" value={ex.coupon} maxLength={24} onChange={(v) => setX('coupon', v.target.value.toUpperCase())} /></F>
          <label className="check small"><input type="checkbox" checked={ex.names} onChange={(v) => setX('names', v.target.checked)} /> Names</label>
          <label className="check small"><input type="checkbox" checked={ex.numbers} onChange={(v) => setX('numbers', v.target.checked)} /> Numbers</label>
          <label className="check small"><input type="checkbox" checked={ex.rush} onChange={(v) => setX('rush', v.target.checked)} /> Express</label>
          <label className="check small"><input type="checkbox" checked={ex.cod} onChange={(v) => setX('cod', v.target.checked)} data-testid="try-cod" /> Cash on delivery</label>
        </div>
        {!body.ok && <Alert tone="warn">Fix the marked values to see the draft price.</Alert>}
        {sim.error ? (sim.error instanceof ApiError && sim.error.status === 422 ? <Alert tone="warn">The draft is not valid yet: {sim.error.message}</Alert> : <ErrorBox error={sim.error} onRetry={sim.reload} />) : null}
        {r && (
          <table className="table compact" data-testid="try-table">
            <thead><tr><th /><th className="num">Current</th><th className="num">Draft</th></tr></thead>
            <tbody>
              {rows.map(([k, fn]) => {
                const a = fn(r.current), b = fn(r.draft);
                return <tr key={k}><td>{k}</td><td className="num">{money(a, cur)}</td><td className={`num ${Math.abs(a - b) > 0.004 ? 'strong' : ''}`}>{money(b, cur)}</td></tr>;
              })}
            </tbody>
            <tfoot>
              <tr><td>Total</td><td className="num" data-testid="try-current">{money(r.current.total, cur)}</td><td className="num" data-testid="try-draft">{money(r.draft.total, cur)}</td></tr>
              <tr><td>Per piece</td><td className="num">{money(r.current.average_per_piece, cur)}</td><td className="num">{money(r.draft.average_per_piece, cur)}</td></tr>
            </tfoot>
          </table>
        )}
        {r && (
          <div className="row" data-testid="try-delta">
            {Math.abs(delta) < 0.005 ? <Badge>No change</Badge> : <Badge tone={delta > 0 ? 'warn' : 'good'}>{delta > 0 ? '+' : '−'}{money(Math.abs(delta), cur)} ({delta > 0 ? '+' : '−'}{pct(Math.abs(delta) / (r.current.total || 1), 1)})</Badge>}
            <span className="muted small">{r.draft.pieces} pieces · tax {pct(r.draft.tax.rate)}</span>
          </div>
        )}
        {r && [...r.draft.problems, ...(r.draft.coupon?.error ? [r.draft.coupon.error] : []),
          ...(ex.cod && r.draft.cod && !r.draft.cod.available ? ['Cash on delivery is not available for this example with the draft (switched off, not allowed in this area, or above the limit).'] : [])]
          .map((p) => <div key={p} className="small warn-text">{p}</div>)}
      </div>
    </Card>
  );
}
