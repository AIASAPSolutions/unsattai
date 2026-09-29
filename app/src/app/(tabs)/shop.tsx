import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';
import { api } from '../../api/endpoints';
import type { Facet, Product, ProductPage, ProductQuery, ProductSort } from '../../api/types';
import { DeliverToBar } from '../../components/shop/DeliverTo';
import { ProductCard } from '../../components/shop/ProductCard';
import { errorMessage, tMaybe, useT, type T as Tr } from '../../i18n';
import { formatMoney } from '../../lib/money';
import { useVoiceGuide } from '../../voice/useVoiceGuide';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { Field } from '../../ui/Field';
import { Sheet } from '../../ui/Sheet';
import { Empty, ErrorState, Loading } from '../../ui/States';
import { T } from '../../ui/Text';
import { colors, space } from '../../ui/theme';

const SORTS: ProductSort[] = ['popular', 'new', 'price_asc', 'price_desc', 'rating'];
type Filters = Pick<ProductQuery, 'sport' | 'garment' | 'colour' | 'min_price' | 'max_price'>;
const NO_FILTERS: Filters = { sport: '', garment: '', colour: '', min_price: null, max_price: null };

function facetLabel(t: Tr, group: 'sport' | 'garment' | 'colour', v: string): string {
  if (group === 'sport') return tMaybe(t, `sport_${v}`, v);
  if (group === 'garment') return tMaybe(t, `garment_${v}`, v);
  return tMaybe(t, `colour_${v.replace(' ', '_')}`, v);
}

export default function ShopScreen() {
  const t = useT();
  const { width } = useWindowDimensions();
  const { speak } = useVoiceGuide();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<ProductSort>('popular');
  const [data, setData] = useState<ProductPage | null>(null);
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sheet, setSheet] = useState<'filters' | 'sort' | null>(null);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);

  // Search while typing, a moment after the last key.
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(timer);
  }, [text]);

  const query = useMemo<ProductQuery>(() => ({ q, sort, ...filters, size: 24 }), [q, sort, filters]);
  useEffect(() => {
    const id = ++seq.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.products({ ...query, page: 1 }, controller.signal)
      .then((res) => {
        if (id !== seq.current) return;
        setData(res);
        setItems(res.items);
        if (q) speak(t(res.total === 1 ? 'resultsCountOne' : 'resultsCount', { n: res.total }));
      })
      .catch((e) => id === seq.current && !controller.signal.aborted && setError(e))
      .finally(() => id === seq.current && setLoading(false));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, nonce]);

  const loadMore = async () => {
    if (!data || more || data.page >= data.pages) return;
    setMore(true);
    try {
      const res = await api.products({ ...query, page: data.page + 1 });
      setData(res);
      setItems((cur) => [...cur, ...res.items.filter((p) => !cur.some((c) => c.id === p.id))]);
    } catch (e) {
      setError(e);
    } finally {
      setMore(false);
    }
  };

  const cols = width >= 700 ? 3 : 2;
  const gap = space(3);
  const cardW = Math.floor((Math.min(width, 1100) - space(8) - gap * (cols - 1)) / cols);
  const active = (['sport', 'garment', 'colour'] as const).filter((k) => filters[k]);
  const priceActive = filters.min_price != null || filters.max_price != null;
  const clearAll = () => setFilters(NO_FILTERS);

  const header = (
    <View>
      <DeliverToBar />
      <Field testID="shop-search" label={t('searchLabel')} placeholder={t('searchPlaceholder')} value={text} onChangeText={setText}
        returnKeyType="search" autoCorrect={false} onSubmitEditing={() => setQ(text.trim())} />
      <View style={styles.row}>
        <Chip testID="open-filters" label={`☰ ${t('filters')}${active.length + (priceActive ? 1 : 0) ? ` (${active.length + (priceActive ? 1 : 0)})` : ''}`}
          onPress={() => setSheet('filters')} />
        <Chip testID="open-sort" label={`⇅ ${t(`sort_${sort}`)}`} onPress={() => setSheet('sort')} />
        {(data?.facets.garment ?? []).map((f) => (
          <Chip key={f.value} testID={`quick-garment-${f.value}`} label={facetLabel(t, 'garment', f.value)} selected={filters.garment === f.value}
            onPress={() => setFilters({ ...filters, garment: filters.garment === f.value ? '' : f.value })} />
        ))}
      </View>
      {active.length || priceActive ? (
        <View style={styles.row}>
          {active.map((k) => (
            <Chip key={k} testID={`clear-${k}`} label={`${facetLabel(t, k, filters[k] as string)} ✕`} selected
              onPress={() => setFilters({ ...filters, [k]: '' })} />
          ))}
          {priceActive ? (
            <Chip testID="clear-price" selected label={`${priceText(t, filters, data?.items[0]?.currency ?? 'INR')} ✕`}
              onPress={() => setFilters({ ...filters, min_price: null, max_price: null })} />
          ) : null}
          <Button compact kind="ghost" label={t('clearAll')} onPress={clearAll} testID="clear-filters" />
        </View>
      ) : null}
      {data ? <T variant="caption" style={{ marginBottom: space(2) }} testID="result-count">{t(data.total === 1 ? 'resultsCountOne' : 'resultsCount', { n: data.total })}</T> : null}
      {error ? <ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={() => setNonce((n) => n + 1)} testID="shop-error" /> : null}
    </View>
  );

  return (
    <View style={{ flex: 1 }} testID="screen-shop">
      <FlatList
        key={cols}
        data={items}
        numColumns={cols}
        keyExtractor={(p) => p.id}
        columnWrapperStyle={{ gap }}
        contentContainerStyle={{ padding: space(4), paddingBottom: space(12) }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        renderItem={({ item, index }) => <ProductCard p={item} index={index} width={cardW} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={loading ? <Loading label={t('loading')} /> : error ? null : (
          <View testID="shop-empty">
            <Empty label={t('noProducts')} />
            {active.length || priceActive || q ? <Button kind="secondary" label={t('clearAll')} onPress={() => { clearAll(); setText(''); }} /> : null}
          </View>
        )}
        ListFooterComponent={more ? <Loading label={t('loading')} /> : null}
      />

      <Sheet visible={sheet === 'sort'} title={t('sortBy')} onClose={() => setSheet(null)} testID="sort-sheet">
        {SORTS.map((s) => (
          <Chip key={s} testID={`sort-${s}`} label={t(`sort_${s}`)} selected={sort === s} onPress={() => { setSort(s); setSheet(null); }} />
        ))}
      </Sheet>

      <FilterSheet visible={sheet === 'filters'} onClose={() => setSheet(null)} filters={filters} onApply={(f) => { setFilters(f); setSheet(null); }}
        facets={data?.facets ?? null} currency={data?.items[0]?.currency ?? 'INR'} />
    </View>
  );
}

function priceText(t: Tr, f: Filters, currency: string): string {
  if (f.min_price != null && f.max_price != null) return `${formatMoney(f.min_price, currency)}–${formatMoney(f.max_price, currency)}`;
  if (f.min_price != null) return t('priceAbove', { price: formatMoney(f.min_price, currency) });
  return t('priceUnder', { price: formatMoney(f.max_price ?? 0, currency) });
}

function FilterSheet({ visible, onClose, filters, onApply, facets, currency }: {
  visible: boolean; onClose: () => void; filters: Filters; onApply: (f: Filters) => void;
  facets: ProductPage['facets'] | null; currency: string;
}) {
  const t = useT();
  const [draft, setDraft] = useState<Filters>(filters);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  useEffect(() => {
    if (!visible) return;
    setDraft(filters);
    setMin(filters.min_price != null ? String(filters.min_price) : '');
    setMax(filters.max_price != null ? String(filters.max_price) : '');
  }, [visible, filters]);
  const group = (key: 'sport' | 'garment' | 'colour', title: string, list: Facet[]) => (
    <View style={{ marginBottom: space(3) }}>
      <T variant="label" style={{ marginBottom: space(2) }}>{title}</T>
      <View style={styles.row}>
        {list.map((f) => (
          <Chip key={f.value} testID={`filter-${key}-${f.value.replace(' ', '_')}`} label={`${facetLabel(t, key, f.value)} (${f.count})`}
            selected={draft[key] === f.value} onPress={() => setDraft({ ...draft, [key]: draft[key] === f.value ? '' : f.value })} />
        ))}
      </View>
    </View>
  );
  const num = (s: string) => (s.trim() ? Math.max(0, Number(s.replace(/\D/g, '')) || 0) : null);
  return (
    <Sheet visible={visible} title={t('filters')} onClose={onClose} testID="filter-sheet" footer={
      <View style={{ flexDirection: 'row', gap: space(3) }}>
        <Button kind="secondary" label={t('clearAll')} onPress={() => onApply(NO_FILTERS)} style={{ flex: 1 }} />
        <Button testID="apply-filters" label={t('showResults')} style={{ flex: 1 }}
          onPress={() => onApply({ ...draft, min_price: num(min), max_price: num(max) })} />
      </View>
    }>
      {facets ? (
        <>
          {group('sport', t('sport'), facets.sport)}
          {group('garment', t('garment'), facets.garment)}
          {group('colour', t('colours'), facets.colour)}
          <T variant="label" style={{ marginBottom: space(2) }}>{t('priceRange')}</T>
          {facets.price ? (
            <T variant="caption" style={{ marginBottom: space(2) }}>
              {t('priceSpan', { min: formatMoney(facets.price.min, currency), max: formatMoney(facets.price.max, currency) })}
            </T>
          ) : null}
          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: space(2) }}>
              <Field testID="price-min" label={t('priceMin')} value={min} onChangeText={setMin} keyboardType="number-pad" maxLength={6} />
            </View>
            <View style={{ flex: 1 }}>
              <Field testID="price-max" label={t('priceMax')} value={max} onChangeText={setMax} keyboardType="number-pad" maxLength={6} />
            </View>
          </View>
        </>
      ) : <Loading label={t('loading')} />}
      <T variant="caption" color={colors.muted}>{t('filtersHint')}</T>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
});
