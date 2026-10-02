import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { OrderStatus } from '../../components/domain';
import { PaymentBadge, Stars } from '../../components/marketplace';
import { IconPlus, IconTrash } from '../../components/icons';
import {
  Alert, Badge, Button, Card, DataTable, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, useToast,
} from '../../components/ui';
import { api, get, post, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ApiError, errorText, errorsAt, errorsByPath, type FieldError } from '../../lib/errors';
import { dateTime, day, GARMENT_LABEL, isoDate, label, money0, num } from '../../lib/format';
import { useAction, useLoad } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import {
  describeMatch, emptySeller, formToSeller, matchKind, matchingArea, newArea, sellerServerErrors, sellerToForm, sortAreas, STATES,
  type AreaRow, type SellerForm,
} from '../../lib/sellerForm';
import { setIn, stableJson } from '../../lib/settingsForm';
import { GARMENTS, type Garment, type OrderSummary, type Page, type PincodeCheck, type SellerDetail, type SellerIn } from '../../lib/types';
import { CellErr, NumInput } from '../settings/common';

type Err = (path: string, deep?: boolean) => string[] | undefined;

export default function SellerEditor() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const toast = useToast();
  const { can, isSeller } = useAuth();
  const { settings, reloadSellers } = useRefData();
  const d = useLoad(() => (isNew ? Promise.resolve(null) : get<SellerDetail>(`/ops/sellers/${id}`)), [id]);
  const [form, setForm] = useState<SellerForm | null>(null);
  const [serverErrors, setServerErrors] = useState<FieldError[]>([]);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hit, setHit] = useState<string | null>(null);
  const readOnly = isSeller || !can('settings');
  const fabrics = settings?.price_book.value.fabrics;

  const initial: SellerIn | null = isNew ? emptySeller() : d.data?.seller ?? null;
  useEffect(() => { if (initial) { setForm(sellerToForm(initial)); setServerErrors([]); setTried(false); } }, [d.data, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  const draft = useMemo(() => (form ? formToSeller(form, fabrics?.map((f) => f.id)) : null), [form, fabrics]);
  const baseline = useMemo(() => (initial ? stableJson(formToSeller(sellerToForm(initial)).value) : ''), [initial]);
  const dirty = !!draft && stableJson(draft.value) !== baseline;
  const errMap = useMemo(() => errorsByPath([...(tried ? draft?.errors ?? [] : []), ...serverErrors]), [draft, serverErrors, tried]);
  const err: Err = useCallback((path, deep = false) => {
    const e = errorsAt(errMap, path, deep);
    return e.length ? e : undefined;
  }, [errMap]);

  const set = (path: (string | number)[], v: unknown) => setForm((cur) => (cur ? setIn(cur, path, v) : cur));

  const save = async () => {
    if (!draft) return;
    setTried(true);
    setServerErrors([]);
    if (draft.errors.length) { toast.error(new Error(`Fix ${draft.errors.length} value${draft.errors.length > 1 ? 's' : ''} before saving. They are marked below.`)); return; }
    setSaving(true);
    try {
      const out = isNew ? await post<{ id: string; name: string }>('/ops/sellers', draft.value) : await put<{ id: string; name: string }>(`/ops/sellers/${id}`, draft.value);
      toast.success(isNew ? `${out.name} added. Test a PIN code, then give them a login.` : `${out.name} saved.`);
      setTried(false);
      void reloadSellers();
      if (isNew) nav(`/sellers/${out.id}`, { replace: true }); else await d.reload();
    } catch (e) {
      const mapped = e instanceof ApiError ? sellerServerErrors(e) : [];
      if (mapped.length) { setServerErrors(mapped); toast.error(new Error('The server did not accept some values. They are marked below.')); }
      else toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${d.data?.seller.name}? A seller with orders is switched off instead, so its history stays.`)) return;
    try {
      const r = await api<{ deleted: boolean; deactivated: boolean }>(`/ops/sellers/${id}`, { method: 'DELETE' });
      toast.success(r.deleted ? 'Seller deleted.' : 'The seller has orders, so it was switched off instead.');
      void reloadSellers();
      if (r.deleted) nav('/sellers'); else await d.reload();
    } catch (e) { toast.error(e); }
  };

  if (d.error && !d.data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!form || !draft || (!isNew && !d.data)) return <Loading />;
  const s = d.data?.seller;
  const formLevel = errorsAt(errMap, '');
  const shown = [...(tried ? draft.errors : []), ...serverErrors];

  return (
    <>
      <PageHeader
        crumbs={isSeller ? <>Your seller profile</> : <><Link to="/sellers">Sellers</Link> / {isNew ? 'New' : s?.name}</>}
        title={<span className="row">{isNew ? 'New seller' : s?.name} {s && <StatusBadge status={s.active ? 'active' : 'inactive'} text={s.active ? 'Active' : 'Switched off'} />} {s?.house && <Badge tone="accent">House unit</Badge>}</span>}
        subtitle={isNew ? 'A production partner with its own coverage, capacity and prices.' : <>{s?.legal_name || 'No legal name'}{s?.gstin && ` · GSTIN ${s.gstin}`} · <code>{s?.id}</code> · updated {dateTime(s?.updated_at)}</>}
        actions={!readOnly && <>
          {dirty && <span className="badge warn">Unsaved changes</span>}
          {!isNew && dirty && <Button onClick={() => { setForm(sellerToForm(initial!)); setServerErrors([]); setTried(false); }}>Discard</Button>}
          {!isNew && !s?.house && <Button variant="danger" icon={<IconTrash />} onClick={remove} data-testid="seller-delete">Delete</Button>}
          <Button variant="primary" busy={saving} disabled={!isNew && !dirty} onClick={save} data-testid="seller-save">{isNew ? 'Create seller' : 'Save'}</Button>
        </>} />

      {readOnly && <div style={{ marginBottom: 16 }}><Alert tone="info" >{isSeller ? 'This is how Unsattai has set up your unit. Ask your Unsattai contact to change coverage, capacity or prices.' : 'Read only: changing sellers needs the settings permission.'}</Alert></div>}
      {shown.length > 0 && (
        <div style={{ marginBottom: 16 }}><Alert tone="error">
          <b>{shown.length} value{shown.length > 1 ? 's need' : ' needs'} attention.</b>
          {formLevel.length > 0 && <ul>{formLevel.map((m, i) => <li key={i}>{m}</li>)}</ul>}
        </Alert></div>
      )}

      <div className="grid grid-main" style={{ alignItems: 'start' }}>
        <fieldset disabled={readOnly} className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0, gap: 16 }}>
          <Card title="Business">
            <div className="form-grid">
              <Field label="Name shown to customers" errors={err('name')}><input value={form.name} maxLength={80} onChange={(e) => set(['name'], e.target.value)} data-testid="seller-name" /></Field>
              <Field label="Legal name" errors={err('legal_name')}><input value={form.legal_name} maxLength={120} onChange={(e) => set(['legal_name'], e.target.value)} /></Field>
              <Field label="GSTIN" errors={err('gstin')} hint="15 letters and digits. Printed on invoices as the seller."><input value={form.gstin} maxLength={15} onChange={(e) => set(['gstin'], e.target.value.toUpperCase())} data-testid="seller-gstin" /></Field>
              <Field label="Email" errors={err('email')}><input type="email" value={form.email} maxLength={120} onChange={(e) => set(['email'], e.target.value)} /></Field>
              <Field label="Phone" errors={err('phone')}><input value={form.phone} maxLength={24} onChange={(e) => set(['phone'], e.target.value)} /></Field>
              <Field label="Address" errors={err('address.line1')}><input value={form.address.line1} maxLength={160} onChange={(e) => set(['address', 'line1'], e.target.value)} /></Field>
              <Field label="City" errors={err('address.city')}><input value={form.address.city} maxLength={60} onChange={(e) => set(['address', 'city'], e.target.value)} /></Field>
              <Field label="State" errors={err('address.state')}>
                <select value={form.address.state} onChange={(e) => set(['address', 'state'], e.target.value)}>
                  <option value="">—</option>
                  {Object.entries(STATES).map(([k, v]) => <option key={k} value={k}>{v} ({k})</option>)}
                </select>
              </Field>
              <Field label="PIN code" errors={err('address.pincode')}><input value={form.address.pincode} maxLength={6} inputMode="numeric" onChange={(e) => set(['address', 'pincode'], e.target.value)} /></Field>
              <Field errors={err('active')} className="wide">
                <label className="check"><input type="checkbox" checked={form.active} onChange={(e) => set(['active'], e.target.checked)} data-testid="seller-active" /> Active: takes new orders and is offered to customers</label>
              </Field>
            </div>
          </Card>

          <Card title="Delivery coverage" actions={<span className="muted small">Most specific match wins: longest PIN prefix, then state, then *</span>}>
            <ServiceAreaEditor rows={form.service_areas} onChange={(v) => set(['service_areas'], v)} err={err} readOnly={readOnly} hit={hit} />
            <div style={{ marginTop: 14 }}>
              <Field label="Blocked PIN codes" errors={err('blocked_pincodes', true)} hint="Never delivered by this seller, even inside a covered area. Separate with commas, spaces or new lines.">
                <textarea value={form.blocked_pincodes} onChange={(e) => set(['blocked_pincodes'], e.target.value)} style={{ minHeight: 56, fontFamily: 'var(--mono)' }} placeholder="600119, 600120" data-testid="seller-blocked" />
              </Field>
            </div>
          </Card>

          <Card title="What they make">
            <div className="form-grid">
              <Field label="Garments" errors={err('garments', true)} className="wide">
                <div className="row">
                  {GARMENTS.map((g) => (
                    <label key={g} className="check"><input type="checkbox" checked={form.garments.includes(g)} data-testid={`seller-garment-${g}`}
                      onChange={(e) => set(['garments'], e.target.checked ? [...form.garments, g] : form.garments.filter((x) => x !== g))} />{GARMENT_LABEL[g]}</label>
                  ))}
                </div>
              </Field>
              <Field label="Fabrics" errors={err('fabrics', true)} className="wide" hint={!fabrics ? 'Fabric names come from the price book.' : undefined}>
                <div className="row">
                  <label className="check"><input type="checkbox" checked={!form.fabrics.length} onChange={(e) => set(['fabrics'], e.target.checked ? [] : (fabrics ?? []).map((f) => f.id))} /> Every fabric in the price book</label>
                  {form.fabrics.length > 0 && (fabrics ?? form.fabrics.map((x) => ({ id: x, name: x }))).map((f) => (
                    <label key={f.id} className="check small"><input type="checkbox" checked={form.fabrics.includes(f.id)}
                      onChange={(e) => set(['fabrics'], e.target.checked ? [...form.fabrics, f.id] : form.fabrics.filter((x) => x !== f.id))} />{f.name || f.id}</label>
                  ))}
                </div>
              </Field>
              <Field label="Minimum pieces per order" errors={err('min_pieces')}><NumInput value={form.min_pieces} onChange={(v) => set(['min_pieces'], v)} errors={err('min_pieces')} testId="seller-min" /></Field>
              <Field label="Maximum pieces per order" errors={err('max_pieces')}><NumInput value={form.max_pieces} onChange={(v) => set(['max_pieces'], v)} errors={err('max_pieces')} testId="seller-max" /></Field>
            </div>
          </Card>

          <Card title="Capacity, timing and price">
            <div className="form-grid">
              <Field label="Capacity factor" errors={err('capacity_factor')} hint="Multiplies every production stage's daily capacity. 1 = same as the house plan, 0.5 = half.">
                <NumInput value={form.capacity_factor} onChange={(v) => set(['capacity_factor'], v)} errors={err('capacity_factor')} suffix="×" testId="seller-capacity" />
              </Field>
              <Field label="Handling days" errors={err('handling_days')} hint="Extra days between ready and dispatch.">
                <NumInput value={form.handling_days} onChange={(v) => set(['handling_days'], v)} errors={err('handling_days')} suffix="days" />
              </Field>
              <Field label="Price adjustment" errors={err('price_adjust')} hint="Per piece against the price book: 5 = 5% dearer, -10 = 10% cheaper.">
                <NumInput value={form.price_adjust} onChange={(v) => set(['price_adjust'], v)} errors={err('price_adjust')} suffix="%" testId="seller-price-adjust" />
              </Field>
              <Field label="Holidays" errors={err('holidays', true)} className="wide" hint="No production on these days (on top of the company holidays).">
                <Holidays value={form.holidays} onChange={(v) => set(['holidays'], v)} readOnly={readOnly} />
              </Field>
            </div>
          </Card>
        </fieldset>

        <div className="stack" style={{ gap: 16 }}>
          {s && (
            <Card title="Summary">
              <dl className="kv">
                <dt>Rating</dt><dd><Stars rating={s.rating} /></dd>
                <dt>Orders</dt><dd>{Object.keys(d.data!.orders_by_status).length ? (
                  <span className="row tight">{Object.entries(d.data!.orders_by_status).map(([k, n]) => <Badge key={k}>{label(k)} {n}</Badge>)}</span>) : <span className="muted">None yet</span>}</dd>
                <dt>Added</dt><dd>{day(s.created_at, true)}</dd>
              </dl>
            </Card>
          )}
          <PincodeTest sellerId={isNew ? null : id} dirty={dirty} onResult={(r) => setHit(r?.area?.match ?? null)} areas={form.service_areas} />
          {s && !isSeller && <Logins detail={d.data!} onChange={d.reload} />}
        </div>
      </div>

      {s && <SellerOrders sellerId={s.id} />}
    </>
  );
}

// ------------------------------------------------------------------ service areas

export function ServiceAreaEditor({ rows, onChange, err, readOnly, hit }: {
  rows: AreaRow[]; onChange: (v: AreaRow[]) => void; err: Err; readOnly?: boolean; hit?: string | null;
}) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const hasAll = rows.some((r) => r.match.trim() === '*');
  const usedStates = new Set(rows.map((r) => r.match.trim().toUpperCase()));
  const add = (m: string, transit = '3') => {
    const v = m.trim().toUpperCase();
    if (!v) return;
    if (matchKind(v) === 'invalid') { setProblem(`"${v}" is not a PIN code prefix (1 to 6 digits, not starting with 0), a state code like TN, or *.`); return; }
    const next = newArea(rows, v, transit);
    if (!next) { setProblem(`"${v}" is already in the list.`); return; }
    setProblem(null);
    setDraft('');
    onChange(next);
  };
  const setRow = (i: number, k: keyof AreaRow, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="stack tight" data-testid="service-areas">
      <div className="table-wrap">
        <table className="table compact area-table">
          <thead><tr><th>Match</th><th style={{ width: 150 }}>Transit</th><th style={{ width: 120 }}>Cash on delivery</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const isHit = !!hit && r.match.trim().toUpperCase() === hit;
              return (
                <tr key={i} className={isHit ? 'hit' : ''} data-area={r.match}>
                  <td>
                    <input value={r.match} maxLength={6} onChange={(e) => setRow(i, 'match', e.target.value.toUpperCase())} className={err(`service_areas.${i}.match`) ? 'invalid' : ''}
                      style={{ maxWidth: 120 }} aria-label={`Area ${i + 1} match`} data-testid={`area-match-${i}`} />
                    <div className="area-kind">{describeMatch(r.match)}{isHit && <> · <b>matched by the last test</b></>}</div>
                    <CellErr errors={err(`service_areas.${i}.match`)} />
                  </td>
                  <td>
                    <NumInput value={r.transit_days} onChange={(v) => setRow(i, 'transit_days', v)} errors={err(`service_areas.${i}.transit_days`)} suffix="days" testId={`area-days-${i}`} />
                    <CellErr errors={err(`service_areas.${i}.transit_days`)} />
                  </td>
                  <td><label className="check small"><input type="checkbox" checked={r.cod} onChange={(e) => setRow(i, 'cod', e.target.checked)} data-testid={`area-cod-${i}`} /> {r.cod ? 'Allowed' : 'No'}</label></td>
                  <td>{!readOnly && <button type="button" className="icon-btn" aria-label={`Remove area ${r.match || i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}><IconTrash /></button>}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={4}><div className="empty">No areas: this seller can't deliver anywhere yet.</div></td></tr>}
          </tbody>
        </table>
      </div>
      <CellErr errors={err('service_areas')} />
      {!readOnly && (
        <div className="row" style={{ marginTop: 6 }}>
          <input className="sm" style={{ maxWidth: 190 }} value={draft} maxLength={6} placeholder="PIN prefix or state code" onChange={(e) => setDraft(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft); } }} data-testid="area-new" aria-label="New area" />
          <Button size="sm" icon={<IconPlus />} onClick={() => add(draft)} disabled={!draft.trim()} data-testid="area-add">Add</Button>
          <select className="sm" style={{ width: 'auto' }} value="" onChange={(e) => add(e.target.value)} aria-label="Add a state" data-testid="area-add-state">
            <option value="">Add a state…</option>
            {Object.entries(STATES).filter(([k]) => !usedStates.has(k)).map(([k, v]) => <option key={k} value={k}>{v} ({k})</option>)}
          </select>
          <Button size="sm" disabled={hasAll} onClick={() => add('*', '6')} title={hasAll ? 'Already covers everywhere else' : ''}>Add everywhere else</Button>
          <span className="spacer" style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" disabled={rows.length < 2} onClick={() => onChange(sortAreas(rows))}>Sort by specificity</Button>
        </div>
      )}
      {problem && <div className="small bad-text">{problem}</div>}
    </div>
  );
}

function Holidays({ value, onChange, readOnly }: { value: string[]; onChange: (v: string[]) => void; readOnly: boolean }) {
  const [d, setD] = useState('');
  return (
    <div className="stack tight">
      <div className="row tight">
        {value.map((h) => <span key={h} className="tag">{day(h, true)}{!readOnly && <button type="button" aria-label={`Remove ${h}`} onClick={() => onChange(value.filter((x) => x !== h))}>×</button>}</span>)}
        {!value.length && <span className="muted small">None</span>}
      </div>
      {!readOnly && (
        <div className="row tight">
          <input type="date" className="sm" style={{ width: 'auto' }} value={d} min={isoDate()} onChange={(e) => setD(e.target.value)} aria-label="Holiday date" data-testid="seller-holiday-date" />
          <Button size="sm" disabled={!d || value.includes(d)} onClick={() => { onChange([...value, d].sort()); setD(''); }} data-testid="seller-holiday-add">Add</Button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ PIN code test

const REASON: Record<string, string> = {
  invalid_pincode: 'Not a valid PIN code, or not in the PIN code table.',
  not_serviceable: 'No area covers it, it is blocked, or the seller is switched off.',
  garment_unavailable: 'The seller does not make this garment or fabric.',
  pieces_out_of_range: 'Outside the seller\'s minimum and maximum pieces.',
};

function PincodeTest({ sellerId, dirty, onResult, areas }: { sellerId: string | null; dirty: boolean; onResult: (r: PincodeCheck | null) => void; areas: AreaRow[] }) {
  const toast = useToast();
  const [pincode, setPincode] = useState('');
  const [garment, setGarment] = useState<Garment>('jersey');
  const [pieces, setPieces] = useState('10');
  const [r, setR] = useState<PincodeCheck | null>(null);
  const { busy, run } = useAction();
  const test = () => run('t', async () => {
    const out = await get<PincodeCheck>(`/ops/sellers/${sellerId}/pincode-check`, { pincode: pincode.trim(), garment, pieces: Math.max(1, Number(pieces) || 1) });
    setR(out);
    onResult(out);
  }, toast.error);
  // What the unsaved rows would match, for comparison with the saved answer.
  const local = r?.place ? matchingArea(areas, r.pincode, r.place.state) : null;
  const differs = !!r && dirty && (local?.match ?? null) !== (r.area?.match ?? null);
  return (
    <Card title="PIN code test">
      <div className="stack tight" data-testid="pin-test">
        {!sellerId ? <span className="muted small">Create the seller first, then test PIN codes against its coverage.</span> : (
          <>
            <div className="row tight" style={{ flexWrap: 'nowrap' }}>
              <input className="sm" style={{ width: 84 }} value={pincode} maxLength={6} inputMode="numeric" placeholder="PIN code" aria-label="PIN code"
                onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter' && pincode.length === 6) test(); }} data-testid="pin-test-input" />
              <select className="sm" style={{ width: 'auto', flex: '1 1 0', minWidth: 0 }} value={garment} onChange={(e) => setGarment(e.target.value as Garment)} aria-label="Garment">
                {GARMENTS.map((g) => <option key={g} value={g}>{GARMENT_LABEL[g]}</option>)}
              </select>
              <input className="sm num" style={{ width: 52 }} value={pieces} onChange={(e) => setPieces(e.target.value)} aria-label="Pieces" title="Pieces" />
              <Button size="sm" variant="primary" busy={busy === 't'} disabled={pincode.length !== 6} onClick={test} data-testid="pin-test-run">Test</Button>
            </div>
            {dirty && <span className="muted small">Tests the saved coverage. Save to test your changes.</span>}
            {r && (
              <div data-testid="pin-test-result" data-serviceable={String(r.serviceable)}>
                <div className="row tight" style={{ marginBottom: 6 }}>
                  {r.serviceable ? <Badge tone="good" dot>Delivers</Badge> : <Badge tone="bad" dot>Does not deliver</Badge>}
                  <b>{r.pincode}</b> <span className="muted">{r.place ? r.place.state_name : 'Unknown place'}</span>
                </div>
                <dl className="kv small">
                  {r.area ? <>
                    <dt>Matched</dt><dd><code>{r.area.match}</code> by {r.matched_by === '*' ? 'everywhere else' : r.matched_by}</dd>
                    <dt>Transit</dt><dd>{r.area.transit_days} days</dd>
                    <dt>Cash on delivery</dt><dd>{r.area.cod ? <Badge tone="good">Allowed</Badge> : <Badge>Not here</Badge>}</dd>
                  </> : <><dt>Why</dt><dd>{r.blocked ? 'This PIN code is blocked for this seller.' : REASON[r.reason ?? ''] ?? label(r.reason)}</dd></>}
                  {r.estimate && <>
                    <dt>Ready</dt><dd>{day(r.estimate.ready_date)}</dd>
                    <dt>Ships</dt><dd>{day(r.estimate.ship_date)}</dd>
                    <dt>Delivered by</dt><dd className="strong">{day(r.estimate.delivery_date)}</dd>
                  </>}
                </dl>
                {differs && <Alert tone="warn">With your unsaved changes this would match {local ? <code>{local.match}</code> : 'no area'}.</Alert>}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ logins

function Logins({ detail, onChange }: { detail: SellerDetail; onChange: () => void }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <Card title="Seller logins" actions={can('staff') && <Button size="sm" icon={<IconPlus />} onClick={() => setOpen(true)} data-testid="seller-login-new">Create login</Button>}>
      <div className="stack tight" data-testid="seller-logins">
        {detail.staff.map((x) => (
          <div key={x.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <span className="ellipsis"><b>{x.name || x.email}</b> <span className="muted small">{x.email}</span></span>
            <StatusBadge status={x.active ? 'active' : 'inactive'} />
          </div>
        ))}
        {!detail.staff.length && <span className="muted small">No logins yet. A seller login sees only this seller's orders, production, shipments, returns and cash on delivery.</span>}
        {detail.staff.length > 0 && can('staff') && <Link to="/staff" className="small">Reset passwords or deactivate in Staff</Link>}
      </div>
      {open && <NewLogin sellerId={detail.seller.id} sellerName={detail.seller.name} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onChange(); }} />}
    </Card>
  );
}

function NewLogin({ sellerId, sellerName, onClose, onDone }: { sellerId: string; sellerName: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { reload } = useRefData();
  const [v, setV] = useState({ name: '', email: '', password: '' });
  const [errs, setErrs] = useState<Record<string, string[]>>({});
  const [top, setTop] = useState<string | null>(null);
  const { busy, run } = useAction();
  const submit = () => run('c', async () => {
    setErrs({}); setTop(null);
    await post('/ops/staff', { name: v.name.trim(), email: v.email.trim(), password: v.password, role: 'seller', seller_id: sellerId });
    toast.success(`${v.email.trim()} can now sign in as ${sellerName}. Share the password securely.`);
    void reload();
    onDone();
  }, (e) => {
    if (e instanceof ApiError && e.fields.length) setErrs(errorsByPath(e.fields));
    else if (e instanceof ApiError && e.status === 422 && /password|characters|upper/i.test(e.message)) setErrs({ password: [e.message] });
    else if (e instanceof ApiError && e.status === 409) setErrs({ email: [e.message] });
    else setTop(errorText(e));
  });
  return (
    <Modal open title={`Create a login for ${sellerName}`} onClose={onClose} testId="seller-login-dialog"
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" busy={!!busy} disabled={!v.name.trim() || !v.email.trim() || !v.password} onClick={submit} data-testid="seller-login-submit">Create login</Button></>}>
      {top && <Alert tone="error">{top}</Alert>}
      <div className="form-grid">
        <Field label="Name" errors={errs.name}><input value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} data-testid="seller-login-name" /></Field>
        <Field label="Email" errors={errs.email}><input type="email" value={v.email} maxLength={120} onChange={(e) => setV({ ...v, email: e.target.value })} data-testid="seller-login-email" /></Field>
        <Field label="Initial password" className="wide" errors={errs.password} hint="10+ characters with upper and lower case and a digit.">
          <input type="text" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} data-testid="seller-login-password" />
        </Field>
      </div>
      <Alert tone="info">Role <b>Seller</b>: this person sees only {sellerName}'s orders, production, shipments, returns and cash on delivery.</Alert>
    </Modal>
  );
}

// ------------------------------------------------------------------ orders

function SellerOrders({ sellerId }: { sellerId: string }) {
  const nav = useNavigate();
  const { isSeller } = useAuth();
  const d = useLoad(() => get<Page<OrderSummary>>('/ops/orders', { seller_id: sellerId, size: 25 }), [sellerId]);
  return (
    <div style={{ marginTop: 16 }}>
      <Card title={`Orders${d.data ? ` (${d.data.total})` : ''}`} flush actions={<Link to={isSeller ? '/orders' : `/orders?seller=${sellerId}`}>All orders</Link>}>
        {d.error ? <div className="card-body"><ErrorBox error={d.error} onRetry={d.reload} /></div> : (
          <DataTable rows={d.data?.items ?? []} rowKey={(o) => o.id} compact onRowClick={(o) => nav(`/orders/${o.id}`)} testId="seller-orders"
            empty={d.loading ? 'Loading…' : 'No orders for this seller yet.'} columns={[
              { key: 'n', header: 'Order', render: (o) => <Link to={`/orders/${o.id}`}>{o.number}</Link> },
              { key: 'd', header: 'Placed', render: (o) => day(o.created_at) },
              { key: 'c', header: 'Customer', render: (o) => o.customer_name },
              { key: 's', header: 'Status', render: (o) => <span className="row tight"><OrderStatus o={o} /><PaymentBadge o={o} /></span> },
              { key: 'prom', header: 'Promised', render: (o) => day(o.promised_delivery_date) },
              { key: 'p', header: 'Pieces', num: true, render: (o) => num(o.pieces) },
              { key: 't', header: 'Total', num: true, render: (o) => money0(o.total, o.currency) },
            ]} />
        )}
      </Card>
    </div>
  );
}
