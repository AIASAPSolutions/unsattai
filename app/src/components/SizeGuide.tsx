import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { Fit, Garment, Size, SizeGuide, Sleeves } from '../api/types';
import { errorMessage, useT } from '../i18n';
import { FIT_KEY, guideHowTo, guideTable, SLEEVES_KEY, hasSleeves } from '../lib/sizing';
import { useSizeGuide } from '../state/shopInfo';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { Sheet } from '../ui/Sheet';
import { Loading } from '../ui/States';
import { T } from '../ui/Text';
import { colors, radius, space } from '../ui/theme';

/** The table and notes for one fit; exported on its own so it can be tested without a modal. */
export function SizeGuideBody({ guide, fit, onFit, garment, sleeves, highlight }: {
  guide: SizeGuide; fit: Fit; onFit: (f: Fit) => void; garment: Garment; sleeves: Sleeves; highlight?: Size | null;
}) {
  const t = useT();
  const table = guideTable(guide, fit, garment, sleeves);
  const fits = guide.fits.map((f) => f.id);
  return (
    <View testID="size-guide-body">
      <Segmented testID="guide-fit" value={fit} onChange={onFit}
        options={fits.map((f) => ({ value: f, label: t(FIT_KEY[f]) }))} />
      <T variant="caption" style={{ marginTop: space(2) }}>
        {t(`garment_${garment}`)}{hasSleeves(garment) ? ` · ${t(SLEEVES_KEY[sleeves])}` : ''}
      </T>
      {!table ? <T variant="body" style={{ marginTop: space(3) }}>{t('guideNoFit')}</T> : (
        <ScrollView horizontal style={{ marginTop: space(2) }} testID={`guide-table-${fit}`}>
          <View style={styles.table}>
            <View style={[styles.tr, styles.head]}>
              <T variant="label" style={[styles.cell, styles.sizeCell]}>{t('guide_size')}</T>
              {table.columns.map((c) => (
                <T key={c} variant="label" style={styles.cell} testID={`guide-col-${c}`}>{t(`guide_${c}`)}</T>
              ))}
            </View>
            {table.rows.map((r) => (
              <View key={r.size} style={[styles.tr, r.size === highlight && styles.on]} testID={`guide-row-${r.size}`}>
                <T variant="label" style={[styles.cell, styles.sizeCell]}>{r.size}</T>
                {r.cells.map((v, i) => <T key={table.columns[i]} variant="body" style={styles.cell}>{v}</T>)}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
      <T variant="caption" style={{ marginTop: space(2) }}>
        {t('guideUnit', { unit: guide.unit })} {t('guideTolerance', { n: guide.tolerance_cm, unit: guide.unit })}
      </T>
      {guide.note ? <T variant="caption" style={{ marginTop: space(1) }} testID="guide-note">{guide.note}</T> : null}
      {table ? (
        <View style={{ marginTop: space(3) }}>
          <T variant="label" style={{ marginBottom: space(1) }}>{t('howToMeasure')}</T>
          {guideHowTo(guide, table.columns).map((m) => (
            <T key={m.id} variant="caption" style={{ marginBottom: space(1) }} testID={`guide-how-${m.id}`}>
              <T variant="caption" color={colors.ink} style={{ fontWeight: '700' }}>{m.name}: </T>{m.text}
            </T>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Men / Women / Kids tabs with the current garment's measurements, loaded once and cached. */
export function SizeGuideSheet({ visible, onClose, fit: initialFit, garment, sleeves, size }: {
  visible: boolean; onClose: () => void; fit: Fit; garment: Garment; sleeves: Sleeves; size?: Size | null;
}) {
  const t = useT();
  const { guide, error } = useSizeGuide(visible);
  const [fit, setFit] = useState<Fit>(initialFit);
  useEffect(() => {
    if (visible) setFit(initialFit);
  }, [visible, initialFit]);
  return (
    <Sheet visible={visible} title={t('sizeGuide')} onClose={onClose} testID="size-guide">
      {guide ? (
        <SizeGuideBody guide={guide} fit={fit} onFit={setFit} garment={garment} sleeves={sleeves}
          highlight={fit === initialFit ? size : null} />
      ) : error ? (
        <T variant="body" color={colors.fail}>{t('guideUnavailable')} {errorMessage(t, error)}</T>
      ) : <Loading label={t('loading')} />}
    </Sheet>
  );
}

/** "Size guide" link that opens the sheet for this garment. */
export function SizeGuideButton({ fit, garment, sleeves, size, testID = 'size-guide-open' }: {
  fit: Fit; garment: Garment; sleeves: Sleeves; size?: Size | null; testID?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button compact kind="ghost" testID={testID} label={`📏 ${t('sizeGuide')}`} onPress={() => setOpen(true)} />
      <SizeGuideSheet visible={open} onClose={() => setOpen(false)} fit={fit} garment={garment} sleeves={sleeves} size={size} />
    </>
  );
}

const styles = StyleSheet.create({
  table: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, borderRadius: radius.sm },
  tr: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  head: { backgroundColor: colors.bg },
  on: { backgroundColor: colors.brandSoft },
  cell: { width: 88, paddingHorizontal: space(2), paddingVertical: space(1.5), textAlign: 'center' },
  sizeCell: { width: 52 },
});
