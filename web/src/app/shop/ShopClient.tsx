'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ProductCard } from '@/components/market/ProductCard';
import { Button, Chip, Empty, ErrorState, Skeleton, TextField, cx } from '@/components/ui';
import { errorMessage, tMaybe } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { isAbort } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import type { Facet, ProductList, ProductQuery, ProductSort } from '@/lib/api/types';
import { formatMoney } from '@/lib/price';
import s from '@/components/market/market.module.css';

const SORTS: ProductSort[] = ['popular', 'new', 'price_asc', 'price_desc', 'rating'];

/** Filters live in the URL so a search can be shared, bookmarked and navigated back to. */
export function queryFromParams(p: URLSearchParams): ProductQuery {
  const num = (k: string) => {
    const v = Number(p.get(k));
    return p.get(k) && Number.isFinite(v) && v >= 0 ? v : undefined;
  };
  const sort = p.get('sort') as ProductSort | null;
  return {
    q: p.get('q')?.slice(0, 100) || undefined,
    sport: p.get('sport') || undefined,
    garment: p.get('garment') || undefined,
    colour: p.get('colour') || undefined,
    min_price: num('min_price'),
    max_price: num('max_price'),
    sort: sort && SORTS.includes(sort) ? sort : undefined,
    page: Math.max(1, Math.floor(num('page') ?? 1)),
  };
}

export function ShopClient() {
  const { t, lang } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const query = useMemo(() => queryFromParams(new URLSearchParams(params.toString())), [params]);
  const key = JSON.stringify(query);
  const [state, setState] = useState<{ key: string; data: ProductList | null; error: unknown }>({ key: '', data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const c = new AbortController();
    api.products({ ...JSON.parse(key) as ProductQuery, size: 24 }, c.signal)
      .then((data) => setState({ key, data, error: null }))
      .catch((error) => !isAbort(error) && setState({ key, data: null, error }));
    return () => c.abort();
  }, [key, nonce]);

  const setParam = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in patch)) next.delete('page');
    router.push(`${path}${next.toString() ? `?${next}` : ''}`, { scroll: 'page' in patch });
  };

  const loading = state.key !== key && !state.error;
  const data = state.data;
  const facets = data?.facets;
  const colourName = (c: string) => tMaybe(t, `colour_${c.replace(/\s/g, '_')}`, c);
  const sportName = (v: string) => tMaybe(t, `sport_${v}`, v);
  const garmentName = (v: string) => tMaybe(t, `garment_${v}`, v);

  const active: { k: keyof ProductQuery; label: string }[] = [];
  if (query.q) active.push({ k: 'q', label: `“${query.q}”` });
  if (query.sport) active.push({ k: 'sport', label: sportName(query.sport) });
  if (query.garment) active.push({ k: 'garment', label: garmentName(query.garment) });
  if (query.colour) active.push({ k: 'colour', label: colourName(query.colour) });
  if (query.min_price !== undefined) active.push({ k: 'min_price', label: t('priceMinChip', { amount: formatMoney(query.min_price, 'INR', lang) }) });
  if (query.max_price !== undefined) active.push({ k: 'max_price', label: t('priceMaxChip', { amount: formatMoney(query.max_price, 'INR', lang) }) });

  return (
    <div className="container page" data-testid="screen-shop">
      <h1>{query.q ? t('searchResultsFor', { q: query.q }) : t('shopTitle')}</h1>
      <p className="muted">{t('shopText')}</p>
      <div className={s.shopLayout}>
        <div>
          <Button kind="secondary" size="sm" className={s.filterToggle} aria-expanded={filtersOpen} aria-controls="shop-filters"
            onClick={() => setFiltersOpen((o) => !o)} testId="filters-toggle">
            {t('filters')}{active.length ? ` (${active.length})` : ''}
          </Button>
          <aside id="shop-filters" className={cx(s.facets, !filtersOpen && s.facetsHidden)} aria-label={t('filters')} data-testid="facets">
            <FacetGroup name="sport" legend={t('sport')} facets={facets?.sport} value={query.sport} label={sportName} anyLabel={t('anyOption')}
              onChange={(v) => setParam({ sport: v })} />
            <FacetGroup name="garment" legend={t('garment')} facets={facets?.garment} value={query.garment} label={garmentName} anyLabel={t('anyOption')}
              onChange={(v) => setParam({ garment: v })} />
            <FacetGroup name="colour" legend={t('colours')} facets={facets?.colour} value={query.colour} label={colourName} anyLabel={t('anyOption')}
              onChange={(v) => setParam({ colour: v })} />
            <PriceFilter key={`${query.min_price}-${query.max_price}`} min={query.min_price} max={query.max_price} range={facets?.price}
              onApply={(min, max) => setParam({ min_price: min, max_price: max })} />
          </aside>
        </div>
        <section aria-labelledby="results-h">
          <div className={s.toolbar}>
            <h2 id="results-h" className="small muted" style={{ margin: 0, fontWeight: 600 }} aria-live="polite" data-testid="results-count">
              {data ? t('resultsN', { n: data.total }) : ' '}
            </h2>
            <label className="row" style={{ gap: 6 }}>
              <span className="small">{t('sortBy')}</span>
              <select value={query.sort ?? 'popular'} onChange={(e) => setParam({ sort: e.target.value === 'popular' ? undefined : e.target.value })}
                data-testid="sort-select">
                {SORTS.map((x) => <option key={x} value={x}>{t(`sort_${x}` as 'sort_popular')}</option>)}
              </select>
            </label>
          </div>
          {active.length ? (
            <div className={s.activeFilters} aria-label={t('activeFilters')} role="group">
              {active.map((a) => (
                <Chip key={a.k} selected onClick={() => setParam({ [a.k]: undefined })} testId={`clear-${a.k}`}>
                  {a.label} <span aria-hidden>✕</span><span className="visually-hidden">{t('removeFilter')}</span>
                </Chip>
              ))}
              <Button kind="ghost" size="sm" href="/shop" testId="clear-all">{t('clearAll')}</Button>
            </div>
          ) : null}
          {state.error && !loading ? (
            <ErrorState message={errorMessage(t, state.error)} retryLabel={t('retry')} onRetry={() => setNonce((n) => n + 1)} />
          ) : loading && !data ? (
            <div className={s.grid}>{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} height={300} />)}</div>
          ) : data && data.items.length === 0 ? (
            <Empty title={t('noResults')} testId="shop-empty">
              <p>{t('noResultsText')}</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <Button kind="secondary" href="/shop">{t('clearAll')}</Button>
                <Button href="/design">{t('heroCta')}</Button>
              </div>
            </Empty>
          ) : data ? (
            <>
              <div className={cx(s.grid)} style={{ opacity: loading ? 0.6 : 1 }} data-testid="product-grid" aria-busy={loading || undefined}>
                {data.items.map((p, i) => <ProductCard key={p.id} product={p} priority={i < 4} />)}
              </div>
              {data.pages > 1 ? (
                <nav className={s.pager} aria-label={t('pagination')}>
                  <Button kind="secondary" size="sm" disabled={data.page <= 1} onClick={() => setParam({ page: data.page - 1 })} testId="page-prev">
                    ← {t('previous')}
                  </Button>
                  <span className="small muted">{t('of', { a: data.page, b: data.pages })}</span>
                  <Button kind="secondary" size="sm" disabled={data.page >= data.pages} onClick={() => setParam({ page: data.page + 1 })} testId="page-next">
                    {t('next')} →
                  </Button>
                </nav>
              ) : null}
            </>
          ) : null}
          <div style={{ marginTop: 28 }}>
            <p className="muted">{t('shopCustomNote')}</p>
            <Button kind="accent" href="/design">{t('heroCta')}</Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function FacetGroup({ name, legend, facets, value, label, onChange, anyLabel }: {
  name: string; legend: string; facets?: Facet[]; value?: string; label: (v: string) => string;
  onChange: (v: string | undefined) => void; anyLabel: string;
}) {
  const list = facets ?? [];
  // Keep the chosen value visible even when it has no results with the other filters.
  const shown = value && !list.some((f) => f.value === value) ? [...list, { value, count: 0 }] : list;
  return (
    <fieldset className={s.facetGroup} data-testid={`facet-${name}`}>
      <legend>{legend}</legend>
      <label className={s.facetOption}>
        <input type="radio" name={name} checked={!value} onChange={() => onChange(undefined)} />
        <span>{anyLabel}</span>
      </label>
      {shown.map((f) => (
        <label key={f.value} className={s.facetOption}>
          <input type="radio" name={name} checked={value === f.value} onChange={() => onChange(f.value)}
            data-testid={`facet-${name}-${f.value.replace(/\s/g, '-')}`} />
          <span>{label(f.value)}</span> <span className={s.facetCount}>({f.count})</span>
        </label>
      ))}
    </fieldset>
  );
}

function PriceFilter({ min, max, range, onApply }: {
  min?: number; max?: number; range?: { min: number | null; max: number | null }; onApply: (min?: number, max?: number) => void;
}) {
  const { t } = useI18n();
  const [lo, setLo] = useState(min !== undefined ? String(min) : '');
  const [hi, setHi] = useState(max !== undefined ? String(max) : '');
  const parse = (v: string) => (v.trim() && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined);
  const bad = parse(lo) !== undefined && parse(hi) !== undefined && parse(lo)! > parse(hi)!;
  return (
    <fieldset className={s.facetGroup} data-testid="facet-price">
      <legend>{t('priceLabel')}</legend>
      <form className={s.priceInputs} onSubmit={(e) => { e.preventDefault(); if (!bad) onApply(parse(lo), parse(hi)); }}>
        <TextField label={t('priceMin')} value={lo} inputMode="numeric" onValue={(v) => setLo(v.replace(/[^\d.]/g, ''))}
          placeholder={range?.min != null ? String(Math.floor(range.min)) : ''} testId="price-min" />
        <TextField label={t('priceMax')} value={hi} inputMode="numeric" onValue={(v) => setHi(v.replace(/[^\d.]/g, ''))}
          placeholder={range?.max != null ? String(Math.ceil(range.max)) : ''} testId="price-max" />
        <Button type="submit" kind="secondary" size="sm" disabled={bad} testId="price-apply" style={{ marginBottom: 14 }}>{t('go')}</Button>
      </form>
      {bad ? <p className="small" role="alert" style={{ color: 'var(--fail)', margin: 0 }}>{t('priceRangeBad')}</p> : null}
    </fieldset>
  );
}
