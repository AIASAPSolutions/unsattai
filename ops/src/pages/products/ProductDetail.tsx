import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DesignPreview } from '../../components/domain';
import { Stars } from '../../components/marketplace';
import { IconPlus, IconStar, IconTrash } from '../../components/icons';
import { Alert, Badge, Button, Card, ErrorBox, Field, Loading, PageHeader, StatusBadge, TagInput, useToast } from '../../components/ui';
import { api, get, patch, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ApiError, errorsByPath } from '../../lib/errors';
import { dateTime, GARMENT_LABEL, label, money0, num } from '../../lib/format';
import { useAction, useDebounced, useLoad } from '../../lib/hooks';
import { priceFrom } from '../../lib/marketplace';
import { useRefData } from '../../lib/refdata';
import { stableJson } from '../../lib/settingsForm';
import { cleanColourways, fullPalette, MAX_COLOURWAYS, newColourway, ROLE_LABEL, toColourwayId, validateColourways } from '../../lib/colourways';
import { GARMENTS, PALETTE_ROLES, type Colourway, type Garment, type Product } from '../../lib/types';
import { useSports } from './Products';

interface Form { title: string; description: string; sport: string; garment: Garment; fabric: string; tags: string[]; featured: boolean; colourways: Colourway[] }
const toForm = (p: Product): Form => ({ title: p.title, description: p.description, sport: p.sport, garment: p.garment, fabric: p.fabric, tags: [...p.tags], featured: p.featured,
  colourways: (p.colourways ?? []).map((c) => ({ id: c.id, name: c.name, palette: fullPalette(c.palette) })) });

function Swatches({ palette, small }: { palette: Record<string, string>; small?: boolean }) {
  return <span className={`swatches ${small ? '' : 'lg'}`} aria-hidden>{PALETTE_ROLES.map((r) => <i key={r} style={{ background: palette[r], ...(small ? { width: 8, height: 14 } : {}) }} />)}</span>;
}

export default function ProductDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const { settings, sellers, currency } = useRefData();
  const sports = useSports();
  const d = useLoad(() => get<Product>(`/ops/products/${id}`), [id]);
  const [f, setF] = useState<Form | null>(null);
  const [errs, setErrs] = useState<Record<string, string[]>>({});
  const [shown, setShown] = useState('original');
  const { busy, run } = useAction();
  useEffect(() => { if (d.data) setF(toForm(d.data)); }, [d.data]);
  const canEdit = can('pricing');
  const p = d.data;
  const dirty = !!p && !!f && stableJson(f) !== stableJson(toForm(p));
  const fabrics = (settings?.price_book.value.fabrics ?? []).filter((x) => !f || x.garments.includes(f.garment));
  const shownCw = f?.colourways.find((c) => c.id === shown);
  const cwPalette = shownCw ? JSON.stringify(shownCw.palette) : '';
  const previewSpec = useMemo(() => (p && f ? { ...p.spec, garment: f.garment, ...(shownCw ? { palette: { ...p.spec.palette, ...shownCw.palette } } : {}) } : null), [p, f?.garment, cwPalette]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownSpec = useDebounced(previewSpec, 300);
  const cwErrors = useMemo(() => errorsByPath(f ? validateColourways(f.colourways) : []), [f]);

  if (d.error && !p) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!p || !f) return <Loading />;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });
  const pb = settings?.price_book.value;
  const from = pb ? priceFrom(pb, sellers, f.garment, f.fabric) : null;

  const cwChanged = stableJson(f.colourways) !== stableJson(toForm(p).colourways);
  const cwBad = Object.keys(cwErrors).length > 0;
  const cwErr = (path: string) => [...(cwErrors[path] ?? []), ...(errs[path] ?? [])];
  const save = () => run('save', async () => {
    setErrs({});
    const body: Record<string, unknown> = { title: f.title.trim(), description: f.description.trim(), sport: f.sport, tags: f.tags, fabric: f.fabric, featured: f.featured };
    if (f.garment !== p.garment) body.spec = { ...p.spec, garment: f.garment };
    if (cwChanged) body.colourways = cleanColourways(f.colourways);
    const out = await patch<Product>(`/ops/products/${p.id}`, body);
    d.setData(out);
    toast.success('Product saved.');
  }, (e) => {
    if (e instanceof ApiError && e.fields.length) setErrs(errorsByPath(e.fields));
    else if (e instanceof ApiError && /fabric/i.test(e.message)) setErrs({ fabric: [e.message] });
    else if (e instanceof ApiError && /sport/i.test(e.message)) setErrs({ sport: [e.message] });
    else toast.error(e);
  });
  const act = (key: string, fn: () => Promise<Product>, ok: string) => run(key, async () => { d.setData(await fn()); toast.success(ok); }, toast.error);
  const remove = () => {
    if (!window.confirm(`Delete ${p.title}? Orders already placed keep their design.`)) return;
    void run('del', async () => { await api(`/ops/products/${p.id}`, { method: 'DELETE' }); toast.success('Product deleted.'); nav('/products'); }, toast.error);
  };

  return (
    <>
      <PageHeader crumbs={<><Link to="/products">Products</Link> / {p.title}</>}
        title={<span className="row">{p.title} <StatusBadge status={p.status === 'published' ? 'active' : 'draft'} text={label(p.status)} />{p.featured && <Badge tone="warn"><IconStar width={11} height={11} />Featured</Badge>}</span>}
        subtitle={<>/{p.slug} · {p.published_at ? `published ${dateTime(p.published_at)}` : 'not published yet'} · <code>{p.id}</code></>}
        actions={canEdit && <>
          {dirty && <span className="badge warn">Unsaved changes</span>}
          {p.status === 'published'
            ? <Button busy={busy === 'pub'} onClick={() => act('pub', () => post(`/ops/products/${p.id}/unpublish`), 'Back to draft: hidden from the store.')} data-testid="product-unpublish">Unpublish</Button>
            : <Button variant="primary" busy={busy === 'pub'} onClick={() => act('pub', () => post(`/ops/products/${p.id}/publish`), 'Published: it is in the store now.')} data-testid="product-publish">Publish</Button>}
          <Button icon={<IconStar />} busy={busy === 'feat'} onClick={() => act('feat', () => post(`/ops/products/${p.id}/feature`, {}, { featured: !p.featured }), p.featured ? 'No longer featured.' : 'Featured in the store.')} data-testid="product-feature">{p.featured ? 'Unfeature' : 'Feature'}</Button>
          <Button variant="danger" icon={<IconTrash />} busy={busy === 'del'} onClick={remove}>Delete</Button>
        </>} />
      <div className="grid grid-main" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 16 }}>
        <Card title="Details" footer={canEdit && <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button disabled={!dirty} onClick={() => { setF(toForm(p)); setErrs({}); }}>Discard</Button>
          <Button variant="primary" disabled={!dirty || f.title.trim().length < 2 || cwBad} busy={busy === 'save'} onClick={save} data-testid="product-save">Save</Button>
        </div>}>
          {!canEdit && <div style={{ marginBottom: 12 }}><Alert>Read only: editing products needs the pricing permission.</Alert></div>}
          <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div className="form-grid">
              <Field label="Title" errors={errs.title ?? (f.title.trim().length < 2 ? ['At least 2 characters.'] : undefined)}><input value={f.title} maxLength={80} onChange={(e) => set('title', e.target.value)} data-testid="product-edit-title" /></Field>
              <Field label="Sport" errors={errs.sport}>
                <select value={f.sport} onChange={(e) => set('sport', e.target.value)}>
                  {!sports.includes(f.sport) && <option value={f.sport}>{label(f.sport)}</option>}
                  {sports.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </select>
              </Field>
              <Field label="Description" className="wide" errors={errs.description} hint="Shown on the product page in the store.">
                <textarea value={f.description} maxLength={2000} onChange={(e) => set('description', e.target.value)} style={{ minHeight: 90 }} data-testid="product-edit-description" />
              </Field>
              <Field label="Garment" errors={errs.garment ?? errs.spec} hint={f.garment !== p.garment ? 'The design is re-made as this garment when you save.' : undefined}>
                <select value={f.garment} onChange={(e) => {
                  const g = e.target.value as Garment;
                  const ok = (settings?.price_book.value.fabrics ?? []).filter((x) => x.garments.includes(g));
                  setF({ ...f, garment: g, fabric: ok.some((x) => x.id === f.fabric) ? f.fabric : ok[0]?.id ?? f.fabric });
                }}>{GARMENTS.map((g) => <option key={g} value={g}>{GARMENT_LABEL[g]}</option>)}</select>
              </Field>
              <Field label="Default fabric" errors={errs.fabric}>
                <select value={f.fabric} onChange={(e) => set('fabric', e.target.value)}>
                  {!fabrics.some((x) => x.id === f.fabric) && <option value={f.fabric}>{f.fabric}</option>}
                  {fabrics.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
              <Field label="Tags" className="wide" errors={errs.tags} hint="Words customers search for. Up to 20.">
                <TagInput value={f.tags} onChange={(t) => set('tags', t.slice(0, 20))} normalise={(x) => x.trim().toLowerCase()} disabled={!canEdit} />
              </Field>
              <label className="check"><input type="checkbox" checked={f.featured} onChange={(e) => set('featured', e.target.checked)} /> Featured in the store</label>
            </div>
          </fieldset>
        </Card>
        <Card title={`Colourways (${f.colourways.length + 1})`} actions={canEdit && <Button size="sm" icon={<IconPlus />} disabled={f.colourways.length >= MAX_COLOURWAYS}
            title={f.colourways.length >= MAX_COLOURWAYS ? `At most ${MAX_COLOURWAYS} besides the original` : ''}
            onClick={() => { const c = newColourway(f.colourways, p.spec.palette); set('colourways', [...f.colourways, c]); setShown(c.id); }} data-testid="cw-add">Add colourway</Button>}
          footer={canEdit && cwChanged && <div className="row" style={{ justifyContent: 'flex-end' }}>
            <span className="muted small" style={{ marginRight: 'auto' }}>{cwBad ? 'Fix the marked values to save.' : 'Colourway changes are saved with the product.'}</span>
            <Button onClick={() => set('colourways', toForm(p).colourways)}>Discard</Button>
            <Button variant="primary" disabled={!dirty || f.title.trim().length < 2 || cwBad} busy={busy === 'save'} onClick={save} data-testid="cw-save">Save</Button>
          </div>}>
          <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="stack tight" data-testid="colourways">
            <p className="muted small" style={{ margin: 0 }}>Customers pick a colourway in the store; the design stays the same with these colours. The original colours are always offered. Up to {MAX_COLOURWAYS} more.</p>
            <div className={`cw-row ${shown === 'original' ? 'on' : ''}`}>
              <div><b>Original</b><div className="muted small">original</div></div>
              <Swatches palette={fullPalette(p.spec.palette)} />
              <span />
              <Button size="xs" onClick={() => setShown('original')} data-testid="cw-preview-original">Preview</Button>
            </div>
            {f.colourways.map((c, i) => {
              const upd = (patch: Partial<Colourway>) => set('colourways', f.colourways.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className={`cw-row ${shown === c.id ? 'on' : ''}`} data-testid={`cw-row-${i}`}>
                  <div className="stack tight">
                    <Field label="Name" errors={cwErr(`colourways.${i}.name`).length ? cwErr(`colourways.${i}.name`) : undefined}>
                      <input value={c.name} maxLength={40} onChange={(e) => {
                        const name = e.target.value;
                        // Keep the id in step with the name until someone edits the id by hand.
                        const auto = c.id === toColourwayId(c.name) || /^colourway-\d+$/.test(c.id);
                        upd({ name, ...(auto && toColourwayId(name).length >= 2 ? { id: toColourwayId(name) } : {}) });
                      }} data-testid={`cw-name-${i}`} />
                    </Field>
                    <Field label="ID" errors={[...cwErr(`colourways.${i}.id`), ...cwErr(`colourways.${i}`)].length ? [...cwErr(`colourways.${i}.id`), ...cwErr(`colourways.${i}`)] : undefined}>
                      <input value={c.id} maxLength={31} className="mono" onChange={(e) => upd({ id: e.target.value.toLowerCase() })} data-testid={`cw-id-${i}`} />
                    </Field>
                  </div>
                  <div className="cw-colours">
                    {PALETTE_ROLES.map((r) => (
                      <label key={r}>{ROLE_LABEL[r]}
                        <input type="color" value={c.palette[r]} onChange={(e) => { upd({ palette: { ...c.palette, [r]: e.target.value } }); setShown(c.id); }} data-testid={`cw-${i}-${r}`} />
                        <span className="mono">{c.palette[r]}</span>
                      </label>
                    ))}
                    {PALETTE_ROLES.some((r) => cwErr(`colourways.${i}.palette.${r}`).length) && <div className="small bad-text">{PALETTE_ROLES.flatMap((r) => cwErr(`colourways.${i}.palette.${r}`))[0]}</div>}
                  </div>
                  <Button size="xs" onClick={() => setShown(c.id)} data-testid={`cw-preview-${i}`}>Preview</Button>
                  <button type="button" className="icon-btn" aria-label={`Remove ${c.name || c.id}`} onClick={() => { set('colourways', f.colourways.filter((_, j) => j !== i)); if (shown === c.id) setShown('original'); }} data-testid={`cw-remove-${i}`}><IconTrash /></button>
                </div>
              );
            })}
            {cwErr('colourways').length > 0 && <div className="small bad-text">{cwErr('colourways').join(' ')}</div>}
          </fieldset>
        </Card>
      </div>
        <div className="stack" style={{ gap: 16 }}>
          <Card title="Mock-up" actions={<span className="muted small">{p.spec.style_name}{shownCw ? ` · ${shownCw.name}` : ''}</span>}>
            {shownSpec && <DesignPreview spec={shownSpec} height={300} alt={p.title} />}
            <div className="row tight" style={{ marginTop: 8 }} data-testid="cw-swatches">
              {[{ id: 'original', name: 'Original', palette: fullPalette(p.spec.palette) }, ...f.colourways].map((c) => (
                <button key={c.id} type="button" className={`btn xs ${shown === c.id ? 'primary' : ''}`} onClick={() => setShown(c.id)} title={c.name}>
                  <Swatches palette={c.palette} small />{c.name}
                </button>
              ))}
            </div>
            {p.colours.length > 0 && <div className="row tight" style={{ marginTop: 8 }}>{p.colours.map((c) => <span key={c} className="tag">{c}</span>)}</div>}
          </Card>
          <Card title="In the store">
            <dl className="kv" data-testid="product-store">
              <dt>Price from</dt><dd className="strong">{from === null ? <span className="muted">No active seller makes this</span> : `${money0(from, currency)} per piece`}</dd>
              <dt>Rating</dt><dd><Stars rating={p.rating} /></dd>
              <dt>Paid orders</dt><dd>{num(p.orders_count)}</dd>
              <dt>Source</dt><dd>{p.source.kind === 'order' && p.source.ref ? <Link to={`/orders/${p.source.ref}`}>Past order</Link>
                : p.source.kind === 'quote' && p.source.ref ? <Link to={`/crm/quotes/${p.source.ref}`}>Sales quote</Link> : label(p.source.kind)}</dd>
            </dl>
            <p className="muted small" style={{ marginBottom: 0 }}>The price is the lowest one-piece price of any active seller, before names, numbers, logos, delivery and tax. Customers can change fabric and garment when they order.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
