import { StyleSheet, View } from 'react-native';
import { COLLARS, SLEEVES, type Catalogue, type Collar, type Garment, type Sleeves } from '../api/types';
import { useT, type T as Tr } from '../i18n';
import { formatMoney } from '../lib/money';
import { COLLAR_KEY, hasCollar, hasSleeves, priceDelta, SLEEVES_KEY } from '../lib/sizing';
import { Chip } from '../ui/Chip';
import { T } from '../ui/Text';
import { space } from '../ui/theme';

type Prices = Catalogue['options'];

/** "Long sleeves · Polo collar" for tops, "" for shorts. Missing values are the defaults. */
export function optionsText(t: Tr, garment: Garment | null | undefined, sleeves?: string | null, collar?: string | null): string {
  if (!garment || !hasSleeves(garment)) return '';
  const s = (SLEEVES as readonly string[]).includes(sleeves ?? '') ? (sleeves as Sleeves) : 'short';
  const c = (COLLARS as readonly string[]).includes(collar ?? '') ? (collar as Collar) : 'crew';
  return [t(SLEEVES_KEY[s]), hasCollar(garment) ? t(COLLAR_KEY[c]) : ''].filter(Boolean).join(' · ');
}

/** Choices the price book has switched on (all of them for older servers); the current one always stays. */
export function activeChoices<V extends string>(all: readonly V[], priced: { id: string }[] | undefined, current: V | null): V[] {
  if (!priced?.length) return [...all];
  return all.filter((v) => v === current || priced.some((p) => p.id === v));
}

/**
 * Sleeves (Short / Long / Sleeveless) and, for the round-neck jersey only, the collar
 * (Crew / Polo / Mandarin), each with its price difference per piece when the catalogue
 * has prices. Shorts have neither, so nothing is drawn for them.
 * Test ids: `${testID}-sleeves-none`, `${testID}-collar-polo`.
 */
export function GarmentOptionsPicker({ garment, sleeves, collar, onSleeves, onCollar, prices, currency = 'INR', note, testID = 'opt' }: {
  garment: Garment;
  sleeves: Sleeves | null;
  collar: Collar | null;
  onSleeves: (s: Sleeves) => void;
  onCollar: (c: Collar) => void;
  prices?: Prices | null;
  currency?: string;
  /** Shown under the choices, e.g. "Read from your brief". */
  note?: string | null;
  testID?: string;
}) {
  const t = useT();
  if (!hasSleeves(garment)) return null;
  const money = (n: number) => formatMoney(n, currency);
  const label = (text: string, price: number | undefined) => {
    const d = priceDelta(price, money);
    return d ? `${text} (${d})` : text;
  };
  const sleeveChoices = activeChoices(SLEEVES, prices?.sleeves, sleeves);
  const collarChoices = activeChoices(COLLARS, prices?.collar, collar);
  return (
    <View testID={testID}>
      <T variant="label" style={styles.label}>{t('sleevesLabel')}</T>
      <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel={t('sleevesLabel')}>
        {sleeveChoices.map((s) => (
          <Chip key={s} testID={`${testID}-sleeves-${s}`} selected={sleeves === s} onPress={() => onSleeves(s)}
            label={label(t(SLEEVES_KEY[s]), prices?.sleeves.find((p) => p.id === s)?.price)} />
        ))}
      </View>
      {hasCollar(garment) ? (
        <>
          <T variant="label" style={styles.label}>{t('collarLabel')}</T>
          <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel={t('collarLabel')}>
            {collarChoices.map((c) => (
              <Chip key={c} testID={`${testID}-collar-${c}`} selected={collar === c} onPress={() => onCollar(c)}
                label={label(t(COLLAR_KEY[c]), prices?.collar.find((p) => p.id === c)?.price)} />
            ))}
          </View>
        </>
      ) : null}
      {note ? <T variant="caption">{note}</T> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  label: { marginBottom: space(2), marginTop: space(1) },
});
