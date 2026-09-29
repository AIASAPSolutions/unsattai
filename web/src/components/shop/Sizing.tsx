'use client';
import { useId, useState, type ReactNode } from 'react';
import { primeSizeGuide, useCatalogue, useMeta, useSizeGuide } from '@/components/providers/data';
import { ErrorState, Modal, SelectField, Skeleton, Tabs, cx } from '@/components/ui';
import type { StringKey, T } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import type { Collar, Colourway, Fit, Garment, Size, SizeGuide, Sleeves } from '@/lib/api/types';
import {
  colourwayName, formatDelta, hasCollarChoice, hasSleeves, optionChoices, optionPrice, swatchColours,
} from '@/lib/options';
import {
  fitsFrom, guideHowTo, guideTable, sizeForFit, sizesFor, type FitSizes, type GuideColumn,
} from '@/lib/sizing';
import s from './sizing.module.css';

// Pickers for garment options (sleeves, collar), fit and size, product colourways, and the
// Men / Women / Kids size guide, shared by the studio, configure, product, cart and team pages.

export const fitLabel = (t: T, f: Fit) => t(`fit_${f}` as StringKey);

/** "Long sleeves · Polo · Midnight Volt": the options a garment is made with (only those that apply). */
export function optionsText(t: T, o: { garment: Garment; sleeves?: Sleeves | '' | null; collar?: Collar | '' | null; colourway?: string }): string {
  const parts: string[] = [];
  if (o.colourway) parts.push(o.colourway);
  if (hasSleeves(o.garment)) parts.push(t(`sleeves_${o.sleeves || 'short'}` as StringKey));
  if (hasCollarChoice(o.garment)) parts.push(t(`collar_${o.collar || 'crew'}` as StringKey));
  return parts.join(' · ');
}

/** The colourway's display name for a cart item ('' for the original). */
export function colourwayLabel(colourways: Colourway[] | undefined, id: string | undefined | null): string {
  return id && id !== 'original' ? colourwayName(colourways, id) : '';
}

// ----------------------------------------------------------------- choice cards

export interface Choice {
  value: string;
  label: string;
  /** Price difference per piece; nothing is shown when 0. */
  delta?: number;
}

/** A radio group drawn as cards, each with its price difference ("+₹60", "−₹20"). */
export function ChoiceCards({ legend, name, choices, value, onChange, testId, currency = 'INR' }: {
  legend: ReactNode; name: string; choices: Choice[]; value: string; onChange: (v: string) => void; testId?: string; currency?: string;
}) {
  const { lang } = useI18n();
  return (
    <fieldset className={s.group} data-testid={testId}>
      <legend className={s.legend}>{legend}</legend>
      <div className={s.cards}>
        {choices.map((c) => {
          const delta = formatDelta(c.delta ?? 0, currency, lang);
          return (
            <label key={c.value} className={cx(s.card, value === c.value && s.cardOn)} data-testid={testId ? `${testId}-${c.value}` : undefined}>
              <input type="radio" name={name} value={c.value} checked={value === c.value} onChange={() => onChange(c.value)} />
              <span className={s.cardName}>{c.label}</span>
              {delta ? <span className={cx(s.delta, (c.delta ?? 0) < 0 && s.deltaMinus)}>{delta}</span> : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** A radio group drawn as pills (fits, sizes). */
export function PillRadios({ legend, name, choices, value, onChange, testId, itemTestId, right, error, currency = 'INR' }: {
  legend: ReactNode; name: string; choices: Choice[]; value: string | null; onChange: (v: string) => void; testId?: string;
  itemTestId?: (v: string) => string; right?: ReactNode; error?: string | null; currency?: string;
}) {
  const { lang } = useI18n();
  const errId = useId();
  return (
    <fieldset className={s.group} data-testid={testId} aria-describedby={error ? errId : undefined}>
      <div className={s.legendRow}>
        <legend className={s.legend}>{legend}</legend>
        {right}
      </div>
      <div className={s.pills}>
        {choices.map((c) => {
          const delta = formatDelta(c.delta ?? 0, currency, lang);
          return (
            <label key={c.value} className={cx(s.pill, value === c.value && s.pillOn)} data-testid={itemTestId?.(c.value)}>
              <input type="radio" name={name} value={c.value} checked={value === c.value} onChange={() => onChange(c.value)} />
              {c.label}{delta ? <span className="small" style={{ marginLeft: 6, fontWeight: 500 }}>{delta}</span> : null}
            </label>
          );
        })}
      </div>
      {error ? <p id={errId} className="small" role="alert" style={{ color: 'var(--fail)', margin: '6px 0 0', fontWeight: 600 }}>{error}</p> : null}
    </fieldset>
  );
}

// ----------------------------------------------------------------- sleeves and collar

/**
 * Sleeves (not for shorts) and, for round-neck jerseys, the collar, with each choice's price
 * difference from the catalogue. Renders nothing for shorts.
 */
export function GarmentOptionsPicker({ garment, sleeves, collar, onChange, testId = 'options' }: {
  garment: Garment; sleeves: Sleeves; collar: Collar; onChange: (group: 'sleeves' | 'collar', value: string) => void; testId?: string;
}) {
  const { t } = useI18n();
  const { catalogue } = useCatalogue();
  const name = useId();
  if (!hasSleeves(garment)) return null;
  const cur = catalogue?.currency ?? 'INR';
  const choices = (group: 'sleeves' | 'collar') => optionChoices(catalogue, group).map((o) => ({
    value: o.id, label: t(`${group}_${o.id}` as StringKey), delta: o.price,
  }));
  return (
    <div className="stack" style={{ gap: 14 }} data-testid={testId}>
      <ChoiceCards legend={t('sleevesLabel')} name={`${name}-sleeves`} choices={choices('sleeves')} value={sleeves}
        onChange={(v) => onChange('sleeves', v)} testId={`${testId}-sleeves`} currency={cur} />
      {hasCollarChoice(garment) ? (
        <ChoiceCards legend={t('collarLabel')} name={`${name}-collar`} choices={choices('collar')} value={collar}
          onChange={(v) => onChange('collar', v)} testId={`${testId}-collar`} currency={cur} />
      ) : null}
      {catalogue?.options ? <p className="small muted" style={{ margin: 0 }}>{t('optionsPerPiece')}</p> : null}
    </div>
  );
}

// ----------------------------------------------------------------- fit and size

/**
 * Fit (Men / unisex, Women, Kids) and the sizes of that fit, with a size guide link. Changing
 * the fit keeps the size when the new fit has it, else picks the fit's middle size.
 */
export function FitSizePicker({
  fit, size, onChange, fitSizes, variant = 'select', garment, sleeves, testId = 'fit-size', sizeTestId, fitTestId,
  sizeError, guideTestId,
}: {
  fit: Fit; size: Size | null; onChange: (v: { fit: Fit; size: Size }) => void;
  /** A collection's own lists; otherwise meta `fit_sizes`, else the built-in lists. */
  fitSizes?: FitSizes | null;
  variant?: 'select' | 'pills';
  garment: Garment; sleeves?: Sleeves;
  testId?: string; sizeTestId?: string; fitTestId?: string; sizeError?: string | null; guideTestId?: string;
}) {
  const { t } = useI18n();
  const { meta } = useMeta();
  const { catalogue } = useCatalogue();
  const name = useId();
  const source = fitSizes ?? meta?.fit_sizes ?? null;
  const fits = fitsFrom(source);
  const sizes = sizesFor(fit, source);
  const cur = catalogue?.currency ?? 'INR';
  const fitChoices: Choice[] = fits.map((f) => ({ value: f, label: fitLabel(t, f), delta: optionPrice(catalogue, 'fit', f) }));
  const pickFit = (f: string) => onChange({ fit: f as Fit, size: sizeForFit(f as Fit, size, source) });
  const guide = <SizeGuideButton garment={garment} sleeves={sleeves} fit={fit} size={size} testId={guideTestId ?? `${testId}-guide`} />;

  if (variant === 'pills') {
    return (
      <div className={s.fitSize} data-testid={testId}>
        {fits.length > 1 ? (
          <PillRadios legend={t('fitLabel')} name={`${name}-fit`} choices={fitChoices} value={fit} onChange={pickFit}
            testId={fitTestId} itemTestId={(v) => `fit-${v}`} currency={cur} />
        ) : null}
        <PillRadios legend={t('size')} name={`${name}-size`} value={size} error={sizeError}
          choices={sizes.map((z) => ({ value: z, label: z }))} onChange={(v) => onChange({ fit, size: v as Size })}
          testId={sizeTestId} itemTestId={(v) => `size-${v}`} right={guide} />
      </div>
    );
  }
  return (
    <div className={s.fitSize} data-testid={testId}>
      <div className={s.selects}>
        {fits.length > 1 ? (
          <SelectField label={t('fitLabel')} value={fit} onValue={pickFit} testId={fitTestId}>
            {fitChoices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </SelectField>
        ) : null}
        <SelectField label={t('size')} value={size ?? ''} onValue={(v) => onChange({ fit, size: v as Size })} testId={sizeTestId}
          error={sizeError}>
          {sizes.map((z) => <option key={z} value={z}>{z}</option>)}
        </SelectField>
      </div>
      {guide}
    </div>
  );
}

// ----------------------------------------------------------------- size guide

const COL_KEY: Record<Exclude<GuideColumn, 'sleeve'>, StringKey> = {
  chest: 'sgCol_chest', length: 'sgCol_length', shoulder: 'sgCol_shoulder', waist: 'sgCol_waist', hip: 'sgCol_hip',
  body_chest: 'sgCol_body_chest', height: 'sgCol_height',
};

export function columnLabel(t: T, col: GuideColumn, sleeves: Sleeves): string {
  if (col === 'sleeve') return t(sleeves === 'long' ? 'sgCol_sleeveLong' : 'sgCol_sleeveShort');
  return t(COL_KEY[col]);
}

/** The size table for one fit, with how-to-measure notes, the note and tolerance. Pure display. */
export function SizeGuideTable({ guide, fit, garment, sleeves = 'short', highlight, testId = 'size-guide-table' }: {
  guide: SizeGuide; fit: Fit; garment: Garment; sleeves?: Sleeves; highlight?: string | null; testId?: string;
}) {
  const { t } = useI18n();
  const table = guideTable(guide, fit, garment, sleeves);
  if (!table) return null;
  const howTo = guideHowTo(guide, table.columns);
  return (
    <div className={s.guide}>
      <div className={s.tableWrap} tabIndex={0} role="region" aria-label={t('sgCaption', { fit: table.name, unit: guide.unit })}>
        <table className={s.table} data-testid={testId}>
          <caption>{t('sgCaption', { fit: fitLabel(t, fit), unit: guide.unit })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('size')}</th>
              {table.columns.map((c) => <th key={c} scope="col">{columnLabel(t, c, sleeves)}</th>)}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.size} className={cx(highlight === r.size && s.rowOn)} aria-current={highlight === r.size ? 'true' : undefined}>
                <th scope="row">{r.size}</th>
                {r.cells.map((v, i) => <td key={table.columns[i]}>{v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {garment !== 'shorts' && sleeves === 'none' ? <p className={s.note}>{t('sgSleeveless')}</p> : null}
      {howTo.length ? (
        <div>
          <h3 style={{ fontSize: '1rem', margin: '0 0 6px' }}>{t('sgHowTo')}</h3>
          <ul className={s.howTo} data-testid={`${testId}-howto`}>
            {howTo.map((m) => <li key={m.id}><strong>{m.id === 'sleeve' ? t('sgCol_sleeve') : columnLabel(t, m.id as GuideColumn, sleeves)}:</strong>{m.text}</li>)}
          </ul>
        </div>
      ) : null}
      {guide.note ? <p className={s.note}>{guide.note}</p> : null}
      <p className={s.note}>{t('sgTolerance', { n: guide.tolerance_cm, unit: guide.unit })}</p>
    </div>
  );
}

/** Men / Women / Kids tabs over the size table, loaded once and cached. */
export function SizeGuideView({ garment, sleeves = 'short', fit: initialFit = 'men', highlight, initial, testId = 'size-guide' }: {
  garment: Garment; sleeves?: Sleeves; fit?: Fit; highlight?: string | null;
  /** The guide a server component already loaded (the size guide page). */
  initial?: SizeGuide | null;
  testId?: string;
}) {
  const { t } = useI18n();
  primeSizeGuide(initial);
  const loaded = useSizeGuide();
  const guide = loaded.guide ?? initial ?? null;
  const { error, retry } = loaded;
  const [fit, setFit] = useState<Fit>(initialFit);
  if (error && !guide) return <ErrorState message={t('sgUnavailable')} retryLabel={t('retry')} onRetry={retry} testId={`${testId}-error`} />;
  if (!guide) return <Skeleton height={260} />;
  const fits = guide.fits.map((f) => f.id);
  const shown = fits.includes(fit) ? fit : fits[0];
  if (!shown) return <p className="muted">{t('sgUnavailable')}</p>;
  return (
    <div className="stack" style={{ gap: 12 }} data-testid={testId}>
      <p className="small muted" style={{ margin: 0 }}>{t('sgIntro', { unit: guide.unit })}</p>
      {fits.length > 1 ? (
        <Tabs label={t('fitLabel')} value={shown} onChange={setFit} testId={`${testId}-fit`}
          options={fits.map((f) => ({ value: f, label: fitLabel(t, f) }))} />
      ) : null}
      <div role="tabpanel" aria-label={fitLabel(t, shown)}>
        <SizeGuideTable guide={guide} fit={shown} garment={garment} sleeves={sleeves}
          highlight={shown === initialFit ? highlight : null} testId={`${testId}-table`} />
      </div>
    </div>
  );
}

/** "Size guide" link that opens the guide for this garment, sleeves and fit in a dialog. */
export function SizeGuideButton({ garment, sleeves, fit, size, testId = 'size-guide-open', dialogTestId }: {
  garment: Garment; sleeves?: Sleeves; fit?: Fit; size?: string | null; testId?: string; dialogTestId?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={s.link} onClick={() => setOpen(true)} data-testid={testId} aria-haspopup="dialog">
        {t('sizeGuide')}
      </button>
      <SizeGuideDialog open={open} onClose={() => setOpen(false)} garment={garment} sleeves={sleeves} fit={fit} size={size}
        testId={dialogTestId ?? `${testId}-dialog`} />
    </>
  );
}

export function SizeGuideDialog({ open, onClose, garment, sleeves, fit, size, testId = 'size-guide-dialog' }: {
  open: boolean; onClose: () => void; garment: Garment; sleeves?: Sleeves; fit?: Fit; size?: string | null; testId?: string;
}) {
  const { t } = useI18n();
  return (
    <Modal open={open} onClose={onClose} title={`${t('sizeGuide')} · ${t(`garment_${garment}` as StringKey)}`} testId={testId} closeLabel={t('close')}>
      {/* Remounted on every open so it starts on the fit being picked. */}
      {open ? <SizeGuideView garment={garment} sleeves={sleeves} fit={fit} highlight={size} testId={`${testId}-view`} /> : null}
    </Modal>
  );
}

// ----------------------------------------------------------------- colourways

function SwatchFill({ colours, className }: { colours: [string, string]; className: string }) {
  return (
    <span className={className} aria-hidden
      style={{ background: `linear-gradient(135deg, ${colours[0]} 0 50%, ${colours[1]} 50% 100%)` }} />
  );
}

/** Colourway swatches as a radio group (product page). */
export function ColourwayPicker({ colourways, value, onChange, testId = 'colourways' }: {
  colourways: Colourway[]; value: string; onChange: (id: string) => void; testId?: string;
}) {
  const { t } = useI18n();
  const name = useId();
  if (colourways.length < 2) return null;
  const current = colourways.find((c) => c.id === value) ?? colourways[0];
  return (
    <fieldset className={s.group} data-testid={testId}>
      <legend className={s.legend}>{t('colourwayLabel')}: <span style={{ fontWeight: 500 }} data-testid={`${testId}-name`}>{current.name}</span></legend>
      <div className={s.swatches}>
        {colourways.map((c) => {
          const colours = swatchColours(c) ?? ['#dde2ec', '#c8d0de'];
          const on = c.id === current.id;
          return (
            <label key={c.id} className={cx(s.swatchOpt, on && s.swatchOn)} data-testid={`${testId}-${c.id}`}>
              <input type="radio" name={name} value={c.id} checked={on} onChange={() => onChange(c.id)} />
              <SwatchFill colours={colours} className={s.swatchBig} />
              <span>{c.name}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Small read-only swatches for product cards. */
export function ColourwayDots({ colourways, max = 4, testId }: { colourways?: Colourway[]; max?: number; testId?: string }) {
  const { t } = useI18n();
  if (!colourways || colourways.length < 2) return null;
  return (
    <span className={s.dots} role="img" aria-label={t('colourwaysN', { n: colourways.length })} title={colourways.map((c) => c.name).join(', ')}
      data-testid={testId}>
      {colourways.slice(0, max).map((c) => {
        const colours = swatchColours(c);
        return colours ? <SwatchFill key={c.id} colours={colours} className={s.dot} /> : null;
      })}
      {colourways.length > max ? <span className="small muted">+{colourways.length - max}</span> : null}
    </span>
  );
}

// ----------------------------------------------------------------- small bits

/** The note the server gives with a 2D pattern piece ("The sleeves are separate pieces, sewn on."). */
export function PanelNote({ note, testId = 'panel-note' }: { note?: string; testId?: string }) {
  if (!note) return null;
  return <p className={s.panelNote} data-testid={testId}>{note}</p>;
}

export function OptionsLine({ text, testId }: { text: string; testId?: string }) {
  if (!text) return null;
  return <div className={s.optionsLine} data-testid={testId}>{text}</div>;
}
