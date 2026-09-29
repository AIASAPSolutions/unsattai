import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DesignPreview } from '../../components/domain';
import { IconExternal, IconPlus, IconTrash } from '../../components/icons';
import { PricingBreakdown } from '../../components/Pricing';
import {
  Alert, Button, ButtonTabs, Card, CopyButton, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, useToast,
} from '../../components/ui';
import { get, post, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { env, quoteLink } from '../../lib/env';
import { errorText } from '../../lib/errors';
import { dateTime, day, GARMENT_LABEL, label, money } from '../../lib/format';
import { useAction, useDebounced, useLoad } from '../../lib/hooks';
import { useFitSizes } from '../../lib/meta';
import { blankLine, logoCount, parseRoster, specOptions, toQuoteLines, totalPieces, withFit, withSalesDiscount, type EditLine } from '../../lib/quote';
import { useRefData } from '../../lib/refdata';
import {
  COLLAR_LABEL, COLLARS, FIT_LABEL, FITS, GARMENTS, SLEEVE_LABEL, SLEEVES, type Collar, type Fit, type Sleeves, type Customer, type Garment, type Lead, type Order, type OrderSummary, type Page, type Pricing, type Quote, type Spec } from '../../lib/types';

interface GenDesign { id: string; spec: Spec; mockup_svg: string; manufacturing_ready: boolean }
interface CustDetail { customer: Customer; orders: OrderSummary[]; leads: Lead[] }

export default function QuoteEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const { settings, who } = useRefData();
  const existing = useLoad(() => (id ? get<Quote>(`/ops/quotes/${id}`) : Promise.resolve(null)), [id]);
  const q = existing.data ?? null;

  const [customerId, setCustomerId] = useState(params.get('customer') ?? '');
  const [leadId, setLeadId] = useState(params.get('lead') ?? '');
  const [title, setTitle] = useState('');
  const [spec, setSpec] = useState<Spec | null>(null);
  const [designId, setDesignId] = useState('');
  const [fabric, setFabric] = useState('standard');
  const [lines, setLines] = useState<EditLine[]>([blankLine('M')]);
  const [method, setMethod] = useState<'ship' | 'pickup'>('ship');
  const [pincode, setPincode] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [rush, setRush] = useState(false);
  const [coupon, setCoupon] = useState('');
  const [extra, setExtra] = useState('');
  const [message, setMessage] = useState('');
  const [sentPath, setSentPath] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const { busy, run } = useAction();

  // load an existing quote into the form once
  useEffect(() => {
    if (!q) return;
    setCustomerId(q.customer_id); setLeadId(q.lead_id); setTitle(q.title); setSpec(q.spec); setDesignId(q.design_id);
    setFabric(q.fabric); setLines(q.lines.map((l) => ({ ...l, fit: l.fit ?? 'men', quantity: String(l.quantity) }))); setMethod(q.delivery.method);
    setPincode(q.delivery.pincode); setStateCode(q.delivery.state); setRush(q.rush); setCoupon(q.coupon);
    setExtra(q.extra_discount ? String(q.extra_discount) : ''); setMessage(q.message);
    if (q.status !== 'draft') setSentPath(`/quote/${q.token}`);
  }, [q]);

  const cust = useLoad(() => (customerId ? get<CustDetail>(`/ops/customers/${customerId}`) : Promise.resolve(null)), [customerId]);
  // default delivery pincode from the customer's saved address
  useEffect(() => {
    const a = cust.data?.customer.addresses?.[0];
    if (!id && a && !pincode) { setPincode(a.pincode); setStateCode(a.state); }
  }, [cust.data, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pb = settings?.price_book.value;
  const garment: Garment = (spec?.garment as Garment) ?? 'jersey';
  const fabrics = (pb?.fabrics ?? []).filter((f) => f.garments.includes(garment));
  useEffect(() => { if (fabrics.length && !fabrics.some((f) => f.id === fabric)) setFabric(fabrics[0].id); }, [garment, fabrics.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const fitSizes = useFitSizes();
  const conv = useMemo(() => toQuoteLines(lines, fitSizes), [lines, fitSizes]);
  const so = specOptions(spec);
  // Offer the choices switched on in the price book (all of them if the server has no options yet), with their price.
  const choices = <K extends 'sleeves' | 'collar'>(group: K, ids: readonly string[], cur: string) => ids
    .filter((x) => x === cur || (pb?.options?.[group] as Record<string, { active: boolean }> | undefined)?.[x]?.active !== false)
    .map((x) => {
      const c = (pb?.options?.[group] as Record<string, { name: string; price: number }> | undefined)?.[x];
      return { id: x, label: `${c?.name ?? (group === 'sleeves' ? SLEEVE_LABEL[x as Sleeves] : COLLAR_LABEL[x as Collar])}${c?.price ? ` (${c.price > 0 ? '+' : '−'}${money(Math.abs(c.price), pb?.currency)})` : ''}` };
    });
  const extraNum = Number(extra) || 0;
  const pinBad = method === 'ship' && pincode !== '' && !/^\d{6}$/.test(pincode);
  const request = useMemo(() => ({
    garment, fabric, logos: logoCount(spec), sleeves: so.sleeves, collar: so.collar, lines: conv.lines, rush, coupon: coupon.trim().toUpperCase(),
    delivery: { method, pincode: method === 'ship' && /^\d{6}$/.test(pincode) ? pincode : '', state: method === 'ship' ? stateCode.trim().toUpperCase() : '' },
  }), [garment, fabric, spec, so.sleeves, so.collar, conv.lines, rush, coupon, method, pincode, stateCode]);
  const dReq = useDebounced(request, 400);
  const linesOk = !Object.keys(conv.errors).length;
  const preview = useLoad(() => (spec && linesOk ? post<Pricing>('/shop/quote', dReq) : Promise.resolve(null)), [JSON.stringify(dReq), !!spec, linesOk]);
  const shown = preview.data ? withSalesDiscount(preview.data, extraNum) : null;
  const stale = preview.loading || JSON.stringify(request) !== JSON.stringify(dReq);

  const locked = !!q && (q.status === 'accepted' || q.status === 'converted');
  const canEdit = can('quotes') && !locked;
  const body = {
    customer_id: customerId, lead_id: leadId, title: title.trim(), spec, design_id: designId, garment, fabric, lines: conv.lines,
    delivery: request.delivery, rush, coupon: request.coupon, extra_discount: extraNum, message: message.trim(),
  };
  const valid = !!customerId && !!spec && linesOk && !pinBad;

  const save = () => run('save', async () => {
    const out = q ? await put<Quote>(`/ops/quotes/${q.id}`, body) : await post<Quote>('/ops/quotes', body);
    toast.success(q ? 'Quote saved.' : `Quote ${out.number} saved as a draft.`);
    if (!q) nav(`/crm/quotes/${out.id}`, { replace: true }); else await existing.reload();
  }, toast.error);
  const send = () => run('send', async () => {
    let qid = q?.id;
    if (!qid) { const out = await post<Quote>('/ops/quotes', body); qid = out.id; }
    else await put<Quote>(`/ops/quotes/${qid}`, body);
    const r = await post<Quote>(`/ops/quotes/${qid}/send`);
    setSentPath(r.path ?? `/quote/${r.token}`);
    toast.success('Quote sent. Share the link with the customer.');
    void cust.reload();
    if (!q) nav(`/crm/quotes/${qid}`, { replace: true }); else await existing.reload();
  }, toast.error);
  const setStatus = (s: string) => run('status', async () => {
    await post(`/ops/quotes/${q!.id}/status`, {}, { status: s });
    toast.success(`Quote marked ${label(s).toLowerCase()}.`);
    await existing.reload();
  }, toast.error);

  if (existing.error) return <ErrorBox error={existing.error} onRetry={existing.reload} />;
  if (id && !q) return <Loading />;
  const link = sentPath ? quoteLink(sentPath) : null;
  const setLine = (i: number, patch: Partial<EditLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <>
      <PageHeader
        crumbs={<><Link to="/crm/quotes">Quotes</Link> / {q ? q.number : 'New'}</>}
        title={<span className="row">{q ? `Quote ${q.number}` : 'New quote'} {q && <StatusBadge status={q.status} />}</span>}
        subtitle={q ? <>Created by {who(q.created_by)} · valid until {day(q.valid_until, true)} · updated {dateTime(q.updated_at)}</> : 'Choose a customer and a design, add the roster, then save or send.'}
        actions={<>
          {q && can('quotes') && !locked && q.status !== 'draft' && <Button onClick={() => setStatus('draft')} busy={busy === 'status'}>Back to draft</Button>}
          {q && can('quotes') && q.status === 'sent' && <><Button onClick={() => setStatus('declined')}>Declined</Button><Button onClick={() => setStatus('expired')}>Expired</Button></>}
          {canEdit && <Button onClick={save} busy={busy === 'save'} disabled={!valid} data-testid="quote-save">Save draft</Button>}
          {canEdit && <Button variant="primary" onClick={send} busy={busy === 'send'} disabled={!valid} data-testid="quote-send">{q?.status === 'sent' ? 'Save and resend' : 'Send to customer'}</Button>}
        </>} />

      {!can('quotes') && <div style={{ marginBottom: 16 }}><Alert>Your role can view quotes but not create or change them.</Alert></div>}
      {locked && <div style={{ marginBottom: 16 }}><Alert tone="good">The customer accepted this quote.{q?.order_id && <> It became order <Link to={`/orders/${q.order_id}`}>{q.order_id}</Link>.</>}</Alert></div>}
      {link && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="info" action={<div className="row tight"><CopyButton text={link} label="Copy link" testId="copy-link" /><a className="btn sm" href={link} target="_blank" rel="noreferrer"><IconExternal />Open</a></div>}>
            <div><b>Customer link</b> — send it by WhatsApp, SMS or email. The customer can review and accept online.</div>
            <code data-testid="quote-link" style={{ wordBreak: 'break-all' }}>{link}</code>
            {!env.webStore && <div className="small">Set VITE_WEB_STORE_URL to the web store's address.</div>}
          </Alert>
        </div>
      )}

      <div className="grid grid-main">
        <div className="stack" style={{ gap: 16 }}>
          <Card title="Customer">
            <CustomerPicker value={customerId} onChange={(c) => { setCustomerId(c); setSpec(null); }} disabled={!!q} current={cust.data?.customer ?? null} />
            {cust.data && cust.data.leads.length > 0 && (
              <Field label="Lead" hint="Sending moves the lead to Quoted.">
                <select value={leadId} onChange={(e) => setLeadId(e.target.value)} disabled={!canEdit}>
                  <option value="">None</option>
                  {cust.data.leads.map((l) => <option key={l.id} value={l.id}>{l.title} ({label(l.stage)})</option>)}
                </select>
              </Field>
            )}
          </Card>

          <Card title="Design">
            {canEdit ? <DesignChooser customer={cust.data ?? null} spec={spec} onPick={(s, did) => { setSpec(s); setDesignId(did); }} /> : null}
            {spec && (
              <div className="grid" style={{ gridTemplateColumns: 'minmax(160px, 220px) 1fr', marginTop: canEdit ? 12 : 0 }}>
                <DesignPreview spec={spec} height={220} />
                <dl className="kv">
                  <dt>Style</dt><dd>{spec.style_name}</dd>
                  <dt>Garment</dt><dd>{GARMENT_LABEL[garment]}</dd>
                  <dt>Sport</dt><dd>{label(String(spec.sport ?? ''))}</dd>
                  <dt>Team</dt><dd>{spec.typography?.team_name || '—'}</dd>
                  <dt>Logos</dt><dd>{logoCount(spec)}</dd>
                  <dt>Sleeves</dt><dd>{garment === 'shorts' ? <span className="muted">—</span> : (
                    <select className="sm" value={so.sleeves} disabled={!canEdit} onChange={(e) => setSpec({ ...spec, sleeves: e.target.value })} data-testid="quote-sleeves">
                      {choices('sleeves', SLEEVES, so.sleeves).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>)}</dd>
                  <dt>Collar</dt><dd>{garment !== 'jersey' ? <span className="muted">{garment === 'vneck' ? 'V-neck' : '—'}</span> : (
                    <select className="sm" value={so.collar} disabled={!canEdit} onChange={(e) => setSpec({ ...spec, collar: e.target.value })} data-testid="quote-collar">
                      {choices('collar', COLLARS, so.collar).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>)}</dd>
                </dl>
              </div>
            )}
            {!spec && !canEdit && <div className="muted">No design.</div>}
          </Card>

          <Card title={`Lines (${totalPieces(lines)} pieces)`} actions={canEdit && <><Button size="sm" onClick={() => setPasteOpen(true)}>Paste roster</Button><Button size="sm" icon={<IconPlus />} onClick={() => setLines((ls) => [...ls, blankLine(ls[ls.length - 1]?.size ?? 'M', ls[ls.length - 1]?.fit ?? 'men')])} data-testid="add-line">Add line</Button></>} flush>
            <div className="table-wrap">
              <table className="table compact" data-testid="quote-lines">
                <thead><tr><th>Fit</th><th>Size</th><th>Player name</th><th>Number</th><th className="num">Quantity</th><th /></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td style={{ width: 130 }}><select value={l.fit} disabled={!canEdit} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? withFit(x, e.target.value as Fit, fitSizes) : x)))} data-testid={`line-fit-${i}`}>{FITS.map((x) => <option key={x} value={x}>{FIT_LABEL[x]}</option>)}</select></td>
                      <td style={{ width: 90 }}><select value={l.size} disabled={!canEdit} onChange={(e) => setLine(i, { size: e.target.value as EditLine['size'] })} data-testid={`line-size-${i}`} className={conv.errors[`lines.${i}.size`] ? 'invalid' : ''} title={conv.errors[`lines.${i}.size`]}>
                        {!fitSizes[l.fit].includes(l.size) && <option>{l.size}</option>}
                        {fitSizes[l.fit].map((s) => <option key={s}>{s}</option>)}
                      </select></td>
                      <td><input value={l.player_name} maxLength={16} disabled={!canEdit} placeholder="Optional" onChange={(e) => setLine(i, { player_name: e.target.value })} data-testid={`line-name-${i}`} className={conv.errors[`lines.${i}.player_name`] ? 'invalid' : ''} /></td>
                      <td style={{ width: 100 }}><input value={l.number} maxLength={3} inputMode="numeric" disabled={!canEdit} placeholder="—" onChange={(e) => setLine(i, { number: e.target.value })} data-testid={`line-number-${i}`} className={conv.errors[`lines.${i}.number`] ? 'invalid' : ''} title={conv.errors[`lines.${i}.number`]} /></td>
                      <td style={{ width: 110 }}><input className={`num ${conv.errors[`lines.${i}.quantity`] ? 'invalid' : ''}`} value={l.quantity} inputMode="numeric" disabled={!canEdit} onChange={(e) => setLine(i, { quantity: e.target.value })} data-testid={`line-qty-${i}`} title={conv.errors[`lines.${i}.quantity`]} /></td>
                      <td style={{ width: 40 }}>{canEdit && lines.length > 1 && <button className="icon-btn" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><IconTrash /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!linesOk && <div className="card-body"><Alert tone="error">{Object.values(conv.errors)[0]} (line {Number(Object.keys(conv.errors)[0].split('.')[1]) + 1 || ''})</Alert></div>}
          </Card>

          <Card title="Options">
            <div className="form-grid">
              <Field label="Fabric">
                <select value={fabric} onChange={(e) => setFabric(e.target.value)} disabled={!canEdit} data-testid="quote-fabric">
                  {fabrics.map((f) => <option key={f.id} value={f.id}>{f.name}{f.surcharge ? ` (+${money(f.surcharge, pb?.currency)})` : ''}</option>)}
                </select>
              </Field>
              <Field label="Delivery">
                <select value={method} onChange={(e) => setMethod(e.target.value as 'ship' | 'pickup')} disabled={!canEdit} data-testid="quote-method">
                  <option value="ship">Ship</option>
                  {settings?.delivery.value.pickup.enabled && <option value="pickup">{settings.delivery.value.pickup.label}</option>}
                </select>
              </Field>
              {method === 'ship' && <>
                <Field label="Pincode" errors={pinBad ? ['6 digits'] : undefined} hint="Sets the delivery zone."><input value={pincode} maxLength={6} inputMode="numeric" disabled={!canEdit} onChange={(e) => setPincode(e.target.value.trim())} data-testid="quote-pincode" /></Field>
                <Field label="State code" hint="e.g. TN, KA"><input value={stateCode} maxLength={4} disabled={!canEdit} onChange={(e) => setStateCode(e.target.value)} /></Field>
              </>}
              <Field label="Coupon"><input value={coupon} maxLength={24} disabled={!canEdit} onChange={(e) => setCoupon(e.target.value.toUpperCase())} data-testid="quote-coupon" /></Field>
              <Field label={`Extra sales discount (${pb?.currency ?? ''})`} hint="Taken off the final total."><input value={extra} inputMode="decimal" disabled={!canEdit} onChange={(e) => setExtra(e.target.value)} data-testid="quote-extra" /></Field>
              <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" checked={rush} disabled={!canEdit || !pb?.rush.enabled} onChange={(e) => setRush(e.target.checked)} data-testid="quote-rush" /> {pb?.rush.label ?? 'Express'}{pb && ` (+${Math.round(pb.rush.fee_rate * 100)}%)`}</label>
              <Field label="Title" className="wide"><input value={title} maxLength={120} disabled={!canEdit} placeholder="e.g. Home kit 2026" onChange={(e) => setTitle(e.target.value)} data-testid="quote-title" /></Field>
              <Field label="Message to the customer" className="wide"><textarea value={message} maxLength={2000} disabled={!canEdit} onChange={(e) => setMessage(e.target.value)} /></Field>
            </div>
          </Card>
        </div>

        <div className="stack" style={{ gap: 16, position: 'sticky', top: 64, alignSelf: 'start' }}>
          <Card title="Price" actions={stale && spec && <span className="row tight small muted"><span className="spinner" /> Updating</span>}>
            {!spec ? <div className="muted">Choose a design to see the price.</div>
              : preview.error ? <ErrorBox error={preview.error} onRetry={preview.reload} />
                : shown ? <div style={{ opacity: stale ? 0.55 : 1, transition: 'opacity .15s' }} data-stale={stale || undefined}>
                  <PricingBreakdown p={shown} showLines={false} testId="quote-price" />
                  {shown.estimate && <p className="muted small" style={{ marginBottom: 0 }}>If accepted and paid today: ships {day(shown.estimate.ship_date)}, arrives {day(shown.estimate.delivery_date)}.</p>}
                </div> : <Loading />}
            {q && locked && <div className="muted small" style={{ marginTop: 8 }}>Agreed total: {money(q.pricing.total, q.pricing.currency)}</div>}
            {q && !locked && preview.data && Math.abs((shown?.total ?? 0) - q.pricing.total) > 0.005 && (
              <div style={{ marginTop: 8 }}><Alert tone="warn">Saved total was {money(q.pricing.total, q.pricing.currency)}. Save to update it.</Alert></div>
            )}
          </Card>
          {q?.history && q.history.length > 0 && (
            <Card title="History">
              <ul className="timeline">{[...q.history].reverse().map((h, i) => <li key={i}><div className="t">{label(h.status)}</div><div className="m">{dateTime(h.at)} · {who(h.by)}</div></li>)}</ul>
            </Card>
          )}
        </div>
      </div>

      <PasteRoster open={pasteOpen} onClose={() => setPasteOpen(false)} onAdd={(ls, replace) => { setLines((cur) => (replace ? ls : [...cur, ...ls])); setPasteOpen(false); }} />
    </>
  );
}

function CustomerPicker({ value, onChange, disabled, current }: { value: string; onChange: (id: string) => void; disabled: boolean; current: Customer | null }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const list = useLoad(() => (disabled || (value && !q) ? Promise.resolve([] as Customer[]) : get<Page<Customer>>('/ops/customers', { q: dq || undefined }).then((r) => r.items)), [dq, disabled, value]);
  if (value && current) {
    return (
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><Link to={`/crm/customers/${current.id}`} className="strong">{current.name || 'No name'}</Link> <span className="muted">· {current.phone}{current.email && ` · ${current.email}`}</span></div>
        {!disabled && <Button size="sm" onClick={() => onChange('')}>Change</Button>}
      </div>
    );
  }
  if (value) return <Loading />;
  return (
    <div className="stack tight">
      <input placeholder="Search customers by name or phone…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="quote-customer-search" autoFocus />
      <div className="stack tight" style={{ maxHeight: 220, overflowY: 'auto' }}>
        {(list.data ?? []).map((c) => (
          <button key={c.id} className="btn ghost" style={{ justifyContent: 'flex-start' }} onClick={() => onChange(c.id)}>{c.name || 'No name'} <span className="muted">· {c.phone}</span></button>
        ))}
        {list.data && !list.data.length && <div className="muted small">No customers found. Add one under Customers first.</div>}
      </div>
    </div>
  );
}

function DesignChooser({ customer, spec, onPick }: { customer: CustDetail | null; spec: Spec | null; onPick: (s: Spec, designId: string) => void }) {
  const leadSpec = customer?.leads.find((l) => l.spec)?.spec ?? null;
  const [tab, setTab] = useState<'orders' | 'brief'>('orders');
  return (
    <div className="stack">
      <ButtonTabs value={tab} onChange={setTab} options={[{ value: 'orders', label: 'From previous orders' }, { value: 'brief', label: 'Generate from a brief' }]} />
      {tab === 'orders' ? <PreviousOrders customer={customer} leadSpec={leadSpec} current={spec} onPick={onPick} /> : <FromBrief team={customer?.customer.name ?? ''} current={spec} onPick={onPick} />}
    </div>
  );
}

function PreviousOrders({ customer, leadSpec, current, onPick }: { customer: CustDetail | null; leadSpec: Spec | null; current: Spec | null; onPick: (s: Spec, d: string) => void }) {
  const ids = (customer?.orders ?? []).slice(0, 8).map((o) => o.id);
  const specs = useLoad(() => Promise.all(ids.map((oid) => get<{ order: Order }>(`/ops/orders/${oid}`).then((r) => r.order))), [ids.join(',')]);
  if (!customer) return <div className="muted">Choose a customer first.</div>;
  if (specs.loading && !specs.data) return <Loading />;
  const items = [...(leadSpec ? [{ key: 'lead', label: 'From enquiry', spec: leadSpec, design: '' }] : []),
    ...(specs.data ?? []).map((o) => ({ key: o.id, label: `${o.number} · ${o.spec.style_name}`, spec: o.spec, design: o.design_id ?? '' }))];
  if (!items.length) return <div className="muted">This customer has no previous orders. Generate a design from a brief instead.</div>;
  return (
    <div className="design-pick" data-testid="previous-designs">
      {items.map((x) => (
        <button key={x.key} className={current && JSON.stringify(current) === JSON.stringify(x.spec) ? 'on' : ''} onClick={() => onPick(x.spec, x.design)}>
          <DesignPreview spec={x.spec} height={130} />
          <span className="ellipsis">{x.label}</span>
        </button>
      ))}
    </div>
  );
}

function FromBrief({ team, current, onPick }: { team: string; current: Spec | null; onPick: (s: Spec, d: string) => void }) {
  const toast = useToast();
  const [prompt, setPrompt] = useState('');
  const [garment, setGarment] = useState<Garment>('jersey');
  const [teamName, setTeamName] = useState(team.slice(0, 24));
  const [designs, setDesigns] = useState<GenDesign[]>([]);
  const { busy, run } = useAction();
  const gen = () => run('gen', async () => {
    const r = await post<{ designs: GenDesign[] }>('/designs/generate', { prompt: prompt.trim(), garment, team_name: teamName.trim().slice(0, 24), variants: 4 });
    setDesigns(r.designs);
  }, (e) => toast.error(errorText(e)));
  return (
    <div className="stack">
      <div className="form-grid">
        <Field label="Brief" className="wide" hint="Colours, sport, pattern, mood. English, Hindi, Telugu or Tamil.">
          <textarea value={prompt} maxLength={600} onChange={(e) => setPrompt(e.target.value)} placeholder="Navy and gold cricket jersey with lightning stripes" data-testid="brief" style={{ minHeight: 56 }} />
        </Field>
        <Field label="Garment"><select value={garment} onChange={(e) => setGarment(e.target.value as Garment)}>{GARMENTS.map((g) => <option key={g} value={g}>{GARMENT_LABEL[g]}</option>)}</select></Field>
        <Field label="Team name"><input value={teamName} maxLength={24} onChange={(e) => setTeamName(e.target.value)} /></Field>
      </div>
      <div><Button variant="primary" onClick={gen} busy={busy === 'gen'} disabled={prompt.trim().length < 3} data-testid="generate">Generate 4 designs</Button></div>
      {designs.length > 0 && (
        <div className="design-pick" data-testid="generated-designs">
          {designs.map((d) => (
            <button key={d.id} className={current && JSON.stringify(current) === JSON.stringify(d.spec) ? 'on' : ''} onClick={() => onPick(d.spec, d.id)} data-testid="pick-design">
              <DesignPreview svg={d.mockup_svg} height={130} />
              <span className="ellipsis">{d.spec.style_name}{!d.manufacturing_ready && ' · check'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PasteRoster({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (l: EditLine[], replace: boolean) => void }) {
  const [text, setText] = useState('');
  const parsed = parseRoster(text);
  return (
    <Modal open={open} title="Paste roster" onClose={onClose}
      footer={<><Button onClick={onClose}>Close</Button><Button onClick={() => onAdd(parsed.lines, false)} disabled={!parsed.lines.length}>Add {parsed.lines.length} lines</Button><Button variant="primary" onClick={() => onAdd(parsed.lines, true)} disabled={!parsed.lines.length}>Replace lines</Button></>}>
      <Field label="One player per line" hint="Name, number, size, quantity — e.g. “Arul, 7, M”, “L x 10”, “Kavin, 5, 8Y” (kids) or “Divya, women, S”. Name and number are optional.">
        <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 160, fontFamily: 'var(--mono)' }} />
      </Field>
      {parsed.bad.length > 0 && <Alert tone="warn">No size found on line {parsed.bad.join(', ')}. Those lines are skipped.</Alert>}
    </Modal>
  );
}
