import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DesignPreview } from '../../components/domain';
import { Stars } from '../../components/marketplace';
import { IconPlus, IconStar } from '../../components/icons';
import {
  Alert, Badge, Button, ButtonTabs, Card, Chips, DataTable, Drawer, ErrorBox, Field, PageHeader, Pager, SearchInput, StatusBadge, TagInput, useToast,
} from '../../components/ui';
import { get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ApiError, errorText, errorsByPath } from '../../lib/errors';
import { day, GARMENT_LABEL, label, money0, num } from '../../lib/format';
import { useAction, useDebounced, useLoad } from '../../lib/hooks';
import { priceFrom } from '../../lib/marketplace';
import { useRefData } from '../../lib/refdata';
import { GARMENTS, type Garment, type OrderSummary, type Page, type Product, type Quote, type Spec } from '../../lib/types';

export default function Products() {
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const { settings, sellers, currency } = useRefData();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [status, setStatus] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const d = useLoad(() => get<Page<Product>>('/ops/products', { q: dq || undefined, status: status[0], page }), [dq, status.join(','), page]);
  const { busy, run } = useAction();
  const canEdit = can('pricing');
  const pb = settings?.price_book.value;

  const act = (p: Product, path: string, ok: string, query?: Record<string, string | boolean>) => run(p.id, async () => {
    await post(`/ops/products/${p.id}/${path}`, {}, query);
    toast.success(ok);
    await d.reload();
  }, toast.error);

  return (
    <>
      <PageHeader title="Products" subtitle="Ready-made designs customers can buy or customise in the store. Only published products are listed there."
        actions={canEdit && <Button variant="primary" icon={<IconPlus />} onClick={() => setCreating(true)} data-testid="new-product">New product</Button>} />
      <Card flush>
        <div className="card-body row">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search title, sport, garment, colour, tag…" testId="product-search" />
          <Chips value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }]} />
        </div>
        {!canEdit && <div className="card-body" style={{ paddingTop: 0 }}><Alert>Your role can view products. Creating, editing and publishing needs the pricing permission.</Alert></div>}
        {d.error ? <div className="card-body"><ErrorBox error={d.error} onRetry={d.reload} /></div> : (
          <DataTable testId="products-table" rows={d.data?.items ?? []} rowKey={(p) => p.id} onRowClick={(p) => nav(`/products/${p.id}`)}
            empty={d.loading ? 'Loading…' : q || status.length ? 'No products match.' : 'No products yet. Create one from a brief, a past order or a quote.'}
            columns={[
              { key: 'img', header: '', width: 72, render: (p) => <div className="thumb"><DesignPreview spec={p.spec} height={56} alt={p.title} /></div> },
              { key: 'title', header: 'Product', sort: (p) => p.title, render: (p) => (
                <div><Link to={`/products/${p.id}`} className="strong">{p.title}</Link> {p.featured && <Badge tone="warn" title="Featured in the store"><IconStar width={11} height={11} />Featured</Badge>}
                  <div className="muted small">/{p.slug}</div></div>) },
              { key: 'kind', header: 'Sport and garment', sort: (p) => p.sport, render: (p) => <div className="small">{label(p.sport)}<div className="muted">{GARMENT_LABEL[p.garment] ?? p.garment}</div></div> },
              { key: 'tags', header: 'Tags', render: (p) => <span className="row tight">{p.tags.slice(0, 4).map((t) => <span key={t} className="tag">{t}</span>)}</span> },
              { key: 'price', header: 'Price from', num: true, render: (p) => {
                const v = pb ? priceFrom(pb, sellers, p.garment, p.fabric) : null;
                return v === null ? <span className="muted small" title="No active seller makes this garment and fabric">—</span> : money0(v, currency);
              } },
              { key: 'rating', header: 'Rating', sort: (p) => p.rating?.average ?? -1, render: (p) => <Stars rating={p.rating} /> },
              { key: 'orders', header: 'Orders', num: true, sort: (p) => p.orders_count, render: (p) => num(p.orders_count) },
              { key: 'status', header: 'Status', sort: (p) => p.status, render: (p) => <div><StatusBadge status={p.status === 'published' ? 'active' : 'draft'} text={label(p.status)} />{p.published_at && <div className="muted small">{day(p.published_at)}</div>}</div> },
              { key: 'act', header: '', render: (p) => canEdit && (
                <div className="row tight" style={{ flexWrap: 'nowrap' }}>
                  {p.status === 'published'
                    ? <Button size="xs" busy={busy === p.id} onClick={() => act(p, 'unpublish', `${p.title} is back to draft.`)}>Unpublish</Button>
                    : <Button size="xs" variant="primary" busy={busy === p.id} onClick={() => act(p, 'publish', `${p.title} is live in the store.`)} data-testid="product-publish">Publish</Button>}
                  <Button size="xs" variant="ghost" disabled={busy === p.id} onClick={() => act(p, 'feature', p.featured ? 'No longer featured.' : 'Featured in the store.', { featured: !p.featured })}>{p.featured ? 'Unfeature' : 'Feature'}</Button>
                </div>) },
            ]} />
        )}
        {d.data && d.data.pages > 1 && <Pager page={d.data.page} pages={d.data.pages} total={d.data.total} onPage={setPage} noun="products" />}
      </Card>
      {creating && <NewProduct onClose={() => setCreating(false)} onCreated={(p) => nav(`/products/${p.id}`)} />}
    </>
  );
}

// ------------------------------------------------------------------ create

type Source = 'brief' | 'order' | 'quote';
interface GenDesign { id: string; spec: Spec; mockup_svg: string; manufacturing_ready: boolean }

export function useSports(): string[] {
  const m = useLoad(() => get<{ sports: string[] }>('/meta').then((x) => x.sports).catch(() => [] as string[]), []);
  return m.data ?? [];
}

function NewProduct({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Product) => void }) {
  const toast = useToast();
  const { settings } = useRefData();
  const sports = useSports();
  const [source, setSource] = useState<Source>('brief');
  const [v, setV] = useState({ title: '', description: '', sport: '', tags: [] as string[], fabric: 'standard', featured: false, publish: false });
  const [brief, setBrief] = useState({ prompt: '', garment: 'jersey' as Garment, team_name: '' });
  const [designs, setDesigns] = useState<GenDesign[]>([]);
  const [picked, setPicked] = useState<GenDesign | null>(null);
  const [orderId, setOrderId] = useState<{ id: string; label: string; spec?: Spec } | null>(null);
  const [quoteId, setQuoteId] = useState<{ id: string; label: string; spec?: Spec } | null>(null);
  const [errs, setErrs] = useState<Record<string, string[]>>({});
  const [top, setTop] = useState<string | null>(null);
  const { busy, run } = useAction();

  const garment: Garment = source === 'brief' ? (picked?.spec.garment ?? brief.garment) : ((source === 'order' ? orderId?.spec : quoteId?.spec)?.garment ?? 'jersey');
  const fabrics = (settings?.price_book.value.fabrics ?? []).filter((f) => f.garments.includes(garment));
  const fabric = fabrics.some((f) => f.id === v.fabric) ? v.fabric : fabrics[0]?.id ?? v.fabric;

  const generate = () => run('gen', async () => {
    const r = await post<{ designs: GenDesign[] }>('/designs/generate', { prompt: brief.prompt.trim(), garment: brief.garment, sport: v.sport || undefined, team_name: brief.team_name.trim(), variants: 4 });
    setDesigns(r.designs);
    setPicked(r.designs[0] ?? null);
  }, (e) => toast.error(errorText(e)));

  const ready = v.title.trim().length >= 2 && (source === 'brief' ? brief.prompt.trim().length >= 3 : source === 'order' ? !!orderId : !!quoteId);
  const create = () => run('create', async () => {
    setErrs({}); setTop(null);
    const body: Record<string, unknown> = {
      title: v.title.trim(), description: v.description.trim(), sport: v.sport || null, tags: v.tags, fabric, featured: v.featured,
      status: v.publish ? 'published' : 'draft',
    };
    if (source === 'brief') {
      // A picked preview is sent as the design itself, so the product is exactly what was shown.
      if (picked) body.spec = picked.spec;
      else body.brief = { prompt: brief.prompt.trim(), garment: brief.garment, sport: v.sport || null, team_name: brief.team_name.trim() };
    } else if (source === 'order') body.order_id = orderId!.id;
    else body.quote_id = quoteId!.id;
    const p = await post<Product>('/ops/products', body);
    toast.success(`${p.title} created${v.publish ? ' and published' : ' as a draft'}.`);
    onCreated(p);
  }, (e) => {
    if (e instanceof ApiError && e.fields.length) setErrs(errorsByPath(e.fields));
    else if (e instanceof ApiError && /fabric/i.test(e.message)) setErrs({ fabric: [e.message] });
    else if (e instanceof ApiError && /sport/i.test(e.message)) setErrs({ sport: [e.message] });
    else setTop(errorText(e));
  });

  return (
    <Drawer open wide title="New product" onClose={onClose} testId="product-dialog"
      footer={<div className="row" style={{ justifyContent: 'flex-end', width: '100%' }}>
        <label className="check small" style={{ marginRight: 'auto' }}><input type="checkbox" checked={v.publish} onChange={(e) => setV({ ...v, publish: e.target.checked })} data-testid="product-publish-now" /> Publish now</label>
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" busy={busy === 'create'} disabled={!ready} onClick={create} data-testid="product-create">Create product</Button>
      </div>}>
      <div className="stack">
        {top && <Alert tone="error">{top}</Alert>}
        {errs[''] && <Alert tone="error">{errs[''].join(' ')}</Alert>}
        <div className="form-grid">
          <Field label="Title" errors={errs.title}><input value={v.title} maxLength={80} onChange={(e) => setV({ ...v, title: e.target.value })} data-testid="product-title" /></Field>
          <Field label="Sport" errors={errs.sport}>
            <select value={v.sport} onChange={(e) => setV({ ...v, sport: e.target.value })} data-testid="product-sport">
              <option value="">From the design</option>
              {sports.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </Field>
          <Field label="Description" className="wide" errors={errs.description}><textarea value={v.description} maxLength={2000} onChange={(e) => setV({ ...v, description: e.target.value })} style={{ minHeight: 60 }} /></Field>
          <Field label="Tags" errors={errs.tags}><TagInput value={v.tags} onChange={(t) => setV({ ...v, tags: t })} normalise={(x) => x.trim().toLowerCase()} placeholder="club, school…" /></Field>
          <Field label="Default fabric" errors={errs.fabric}>
            <select value={fabric} onChange={(e) => setV({ ...v, fabric: e.target.value })}>{fabrics.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          </Field>
          <label className="check"><input type="checkbox" checked={v.featured} onChange={(e) => setV({ ...v, featured: e.target.checked })} /> Featured in the store</label>
        </div>

        <h3 style={{ margin: '8px 0 0' }}>Design</h3>
        <ButtonTabs value={source} onChange={setSource} options={[
          { value: 'brief', label: 'From a brief' }, { value: 'order', label: 'From a past order' }, { value: 'quote', label: 'From a quote' },
        ]} />
        {source === 'brief' && (
          <div className="stack">
            <div className="form-grid">
              <Field label="Brief" className="wide" errors={errs['brief.prompt']} hint="Colours, sport, pattern, mood. The design generator makes it.">
                <textarea value={brief.prompt} maxLength={600} onChange={(e) => { setBrief({ ...brief, prompt: e.target.value }); setPicked(null); setDesigns([]); }}
                  placeholder="Yellow and blue cricket jersey with sharp diagonal stripes" style={{ minHeight: 56 }} data-testid="product-brief" />
              </Field>
              <Field label="Garment"><select value={brief.garment} onChange={(e) => { setBrief({ ...brief, garment: e.target.value as Garment }); setPicked(null); setDesigns([]); }}>{GARMENTS.map((g) => <option key={g} value={g}>{GARMENT_LABEL[g]}</option>)}</select></Field>
              <Field label="Team name on the design" hint="Optional. Leave empty for a design any team can use."><input value={brief.team_name} maxLength={24} onChange={(e) => setBrief({ ...brief, team_name: e.target.value })} /></Field>
            </div>
            <div className="row">
              <Button onClick={generate} busy={busy === 'gen'} disabled={brief.prompt.trim().length < 3} data-testid="product-generate">Preview 4 designs</Button>
              <span className="muted small">{picked ? `Using “${picked.spec.style_name}”.` : 'Or create straight away and the generator picks one.'}</span>
            </div>
            {designs.length > 0 && (
              <div className="design-pick" data-testid="product-designs">
                {designs.map((x) => (
                  <button key={x.id} type="button" className={picked?.id === x.id ? 'on' : ''} onClick={() => setPicked(x)} data-testid="product-pick">
                    <DesignPreview svg={x.mockup_svg} height={130} />
                    <span className="ellipsis">{x.spec.style_name}{!x.manufacturing_ready && ' · check'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {source === 'order' && <PickOrder value={orderId} onPick={setOrderId} />}
        {source === 'quote' && <PickQuote value={quoteId} onPick={setQuoteId} />}
        {source !== 'brief' && <p className="muted small" style={{ margin: 0 }}>The player name and number are left out, so any team can order it.</p>}
      </div>
    </Drawer>
  );
}

function PickOrder({ value, onPick }: { value: { id: string; label: string; spec?: Spec } | null; onPick: (v: { id: string; label: string; spec?: Spec }) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const d = useLoad(() => get<Page<OrderSummary>>('/ops/orders', { q: dq || undefined, size: 12 }), [dq]);
  const { run } = useAction();
  const pick = (o: OrderSummary) => run(o.id, async () => {
    const det = await get<{ order: { spec: Spec } }>(`/ops/orders/${o.id}`);
    onPick({ id: o.id, label: `${o.number} · ${o.team_name || o.style_name}`, spec: det.order.spec });
  });
  return (
    <div className="stack tight">
      <SearchInput value={q} onChange={setQ} placeholder="Order number, customer or team…" testId="product-order-search" />
      {d.error ? <ErrorBox error={d.error} onRetry={d.reload} /> : (
        <DataTable rows={d.data?.items ?? []} rowKey={(o) => o.id} compact onRowClick={pick} empty={d.loading ? 'Loading…' : 'No orders match.'} columns={[
          { key: 'n', header: 'Order', render: (o) => <b>{o.number}</b> },
          { key: 'c', header: 'Customer', render: (o) => o.customer_name },
          { key: 'd', header: 'Design', render: (o) => o.team_name || o.style_name },
          { key: 'x', header: '', render: (o) => (value?.id === o.id ? <Badge tone="good">Chosen</Badge> : <Button size="xs" onClick={() => pick(o)} data-testid="product-pick-order">Use</Button>) },
        ]} />
      )}
      {value?.spec && <div className="row"><div style={{ width: 180 }}><DesignPreview spec={value.spec} height={160} /></div><span>Design of <b>{value.label}</b></span></div>}
    </div>
  );
}

function PickQuote({ value, onPick }: { value: { id: string; label: string; spec?: Spec } | null; onPick: (v: { id: string; label: string; spec?: Spec }) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const d = useLoad(() => get<{ items: Quote[] }>('/ops/quotes', { q: dq || undefined }), [dq]);
  const pick = (x: Quote) => onPick({ id: x.id, label: `${x.number} · ${x.title || x.spec?.style_name}`, spec: x.spec });
  return (
    <div className="stack tight">
      <SearchInput value={q} onChange={setQ} placeholder="Quote number, title or customer…" />
      {d.error ? <ErrorBox error={d.error} onRetry={d.reload} /> : (
        <DataTable rows={(d.data?.items ?? []).slice(0, 12)} rowKey={(x) => x.id} compact onRowClick={pick}
          empty={d.loading ? 'Loading…' : 'No quotes match.'} columns={[
            { key: 'n', header: 'Quote', render: (x) => <b>{x.number}</b> },
            { key: 't', header: 'Title', render: (x) => x.title || x.spec?.style_name },
            { key: 'c', header: 'Customer', render: (x) => x.customer?.name },
            { key: 's', header: 'Status', render: (x) => <StatusBadge status={x.status} /> },
            { key: 'x', header: '', render: (x) => (value?.id === x.id ? <Badge tone="good">Chosen</Badge> : <Button size="xs" onClick={() => pick(x)}>Use</Button>) },
          ]} />
      )}
      {value?.spec && <div className="row"><div style={{ width: 180 }}><DesignPreview spec={value.spec} height={160} /></div><span>Design of <b>{value.label}</b></span></div>}
    </div>
  );
}
