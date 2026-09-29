'use client';
import { useEffect, useRef, useState } from 'react';
import { useMeta } from '@/components/providers/data';
import { SizeGuideButton, fitLabel } from '@/components/shop/Sizing';
import { Banner, Button, Modal, TextArea, cx } from '@/components/ui';
import { useT } from '@/i18n/provider';
import { TEXT_LIMITS, type Fit, type Garment, type Size, type Sleeves } from '@/lib/api/types';
import { rowKey, type RosterRow } from '@/lib/flow';
import { duplicateNumbers, parseRoster, parseRosterCsv, totalPieces, type RosterResult } from '@/lib/roster';
import { fitSizeSummary, fitsFrom, normaliseFit, sizeForFit, sizesFor } from '@/lib/sizing';
import s from './configure.module.css';

const CSV_MAX_BYTES = 200_000;

export type RowIssues = Record<number, Partial<Record<'player_name' | 'number' | 'quantity' | 'size', string>>>;

/** Team roster: one row per player (fit and size each), with paste, CSV import, the size guide and a duplicate-number check. */
export function RosterEditor({ rows, onChange, issues, failed, defaultSize, defaultFit = 'men', garment = 'jersey', sleeves }: {
  rows: RosterRow[];
  onChange: (rows: RosterRow[]) => void;
  issues: RowIssues;
  /** Rows the server rejected (print checks), by index, with the reason. */
  failed: Record<number, string>;
  defaultSize: Size;
  defaultFit?: Fit;
  garment?: Garment;
  sleeves?: Sleeves;
}) {
  const t = useT();
  const { meta } = useMeta();
  const source = meta?.fit_sizes ?? null;
  const fits = fitsFrom(source);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [result, setResult] = useState<{ added: number; errors: RosterResult['errors'] } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement | null>(null);
  const focusLast = useRef(false);

  useEffect(() => {
    if (focusLast.current) {
      focusLast.current = false;
      lastNameRef.current?.focus();
    }
  }, [rows.length]);

  const dups = duplicateNumbers(rows);
  const breakdown = fitSizeSummary(rows, (f) => fitLabel(t, f), ' · ', ' ');

  const update = (i: number, patch: Partial<RosterRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));
  const add = () => {
    const last = rows[rows.length - 1];
    const fit = last ? normaliseFit(last.fit) : defaultFit;
    onChange([...rows, { key: rowKey(), player_name: '', number: '', fit, size: last?.size ?? sizeForFit(fit, defaultSize, source), quantity: 1 }]);
    focusLast.current = true;
  };
  const append = (r: RosterResult) => {
    onChange([...rows, ...r.rows.map((x) => ({ ...x, key: rowKey() }))]);
    setResult({ added: r.rows.length, errors: r.errors });
  };

  const importPasted = () => {
    const r = parseRoster(pasted, defaultSize);
    append(r);
    if (!r.errors.length) {
      setPasted('');
      setPasteOpen(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    if (file.size > CSV_MAX_BYTES) {
      setFileError(t('csvTooBig'));
      return;
    }
    const text = await file.text();
    append(parseRosterCsv(text, defaultSize));
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="stack" style={{ gap: 12 }} data-testid="roster">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Button kind="secondary" size="sm" onClick={() => setPasteOpen(true)} testId="roster-paste">{t('pasteRoster')}</Button>
        <Button kind="secondary" size="sm" onClick={() => fileRef.current?.click()} testId="roster-csv">{t('csvUpload')}</Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" hidden data-testid="roster-csv-input"
          onChange={(e) => void onFile(e.target.files?.[0])} />
        <SizeGuideButton garment={garment} sleeves={sleeves} fit={normaliseFit(rows[0]?.fit ?? defaultFit)} testId="size-chart"
          dialogTestId="size-chart-dialog" />
      </div>
      <p className="small muted" style={{ margin: 0 }}>{t('csvHint')}</p>
      {fileError ? <Banner tone="fail">{fileError}</Banner> : null}
      {result ? (
        <Banner tone={result.errors.length ? 'warn' : 'pass'} live testId="roster-result">
          <div>{t('rosterImported', { n: result.added })}</div>
          {result.errors.length ? (
            <>
              <div>{t('rosterErrors', { n: result.errors.length })}</div>
              <ul className={s.errList}>
                {result.errors.slice(0, 8).map((e) => (
                  <li key={`${e.line}-${e.text}`}>
                    {t('line', { n: e.line })}: “{e.text}” — {t(`rosterIssue_${e.issue}` as 'rosterIssue_size')}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Banner>
      ) : null}

      {rows.length === 0 ? (
        <div className={s.rosterEmpty} data-testid="roster-empty">
          <p style={{ margin: 0 }}>{t('rosterEmptyWeb')}</p>
        </div>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.roster}>
            <caption className="visually-hidden">{t('roster')}</caption>
            <thead>
              <tr>
                <th scope="col" className={s.colIdx}>#</th>
                <th scope="col">{t('playerName')}</th>
                <th scope="col" className={s.colNo}>{t('number')}</th>
                {fits.length > 1 ? <th scope="col" className={s.colFit}>{t('fitLabel')}</th> : null}
                <th scope="col" className={s.colSize}>{t('size')}</th>
                <th scope="col" className={s.colQty}>{t('quantity')}</th>
                <th scope="col" className={s.colDel}><span className="visually-hidden">{t('removeRow')}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const is = issues[i] ?? {};
                const dup = !!r.number.trim() && dups.includes(r.number.trim());
                const bad = failed[i];
                const label = r.player_name || `${t('line', { n: i + 1 })}`;
                const fit = normaliseFit(r.fit);
                return (
                  <tr key={r.key} className={cx(bad && s.rowFailed)} data-testid={`roster-row-${i}`}>
                    <td className={s.colIdx}>{i + 1}</td>
                    <td>
                      <input className={cx(s.cell, is.player_name && s.cellBad)} value={r.player_name} maxLength={TEXT_LIMITS.player_name}
                        aria-label={`${t('playerName')} ${i + 1}`} aria-invalid={is.player_name ? true : undefined}
                        data-testid={`roster-name-${i}`} placeholder={t('unnamed')}
                        ref={i === rows.length - 1 ? lastNameRef : undefined}
                        onChange={(e) => update(i, { player_name: e.target.value })} />
                      {bad ? <div className={s.cellMsg} role="alert">{bad}</div> : null}
                    </td>
                    <td className={s.colNo}>
                      <input className={cx(s.cell, (is.number || dup) && s.cellBad)} value={r.number} inputMode="numeric" maxLength={3}
                        aria-label={`${t('number')} ${label}`} aria-invalid={is.number ? true : undefined}
                        data-testid={`roster-number-${i}`}
                        onChange={(e) => update(i, { number: e.target.value.replace(/[^\d०-९౦-౯௦-௯]/g, '') })} />
                    </td>
                    {fits.length > 1 ? (
                      <td className={s.colFit}>
                        <select className={s.cell} value={fit} aria-label={`${t('fitLabel')} ${label}`} data-testid={`roster-fit-${i}`}
                          onChange={(e) => {
                            const f = e.target.value as Fit;
                            update(i, { fit: f, size: sizeForFit(f, r.size, source) });
                          }}>
                          {fits.map((f) => <option key={f} value={f}>{fitLabel(t, f)}</option>)}
                        </select>
                      </td>
                    ) : null}
                    <td className={s.colSize}>
                      <select className={cx(s.cell, is.size && s.cellBad)} value={r.size} aria-label={`${t('size')} ${label}`}
                        aria-invalid={is.size ? true : undefined} data-testid={`roster-size-${i}`}
                        onChange={(e) => update(i, { size: e.target.value as Size })}>
                        {sizesFor(fit, source).includes(r.size) ? null : <option value={r.size} disabled>{r.size}</option>}
                        {sizesFor(fit, source).map((z) => <option key={z} value={z}>{z}</option>)}
                      </select>
                    </td>
                    <td className={s.colQty}>
                      <input className={cx(s.cell, is.quantity && s.cellBad)} type="number" min={1} max={500} value={r.quantity || ''}
                        aria-label={`${t('quantity')} ${label}`} aria-invalid={is.quantity ? true : undefined}
                        data-testid={`roster-qty-${i}`}
                        onChange={(e) => update(i, { quantity: Math.max(0, Math.min(500, Math.floor(Number(e.target.value) || 0))) })} />
                    </td>
                    <td className={s.colDel}>
                      <button type="button" className={s.del} onClick={() => remove(i)} aria-label={`${t('removeRow')} ${label}`}
                        data-testid={`roster-remove-${i}`}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <Button kind="secondary" onClick={add} testId="roster-add">+ {t('addRow')}</Button>
        <div className="small muted tnum" data-testid="roster-total">
          {t('totalPieces', { n: totalPieces(rows) })}
          {breakdown ? ` · ${breakdown}` : ''}
        </div>
      </div>
      {dups.length ? <Banner tone="warn" testId="duplicate-numbers">{t('duplicateNumbersWarn', { numbers: dups.join(', ') })}</Banner> : null}

      <Modal open={pasteOpen} onClose={() => setPasteOpen(false)} title={t('pasteRoster')} testId="paste-dialog" closeLabel={t('close')}>
        <div className="stack">
          <TextArea label={t('roster')} hint={t('rosterHelp')} rows={8} value={pasted} onValue={setPasted}
            placeholder={'Arul, 7, M, 2\nPriya Sharma, 10, women, S\nKavin, 4, 8Y'} testId="paste-text" />
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <Button kind="ghost" onClick={() => setPasteOpen(false)}>{t('cancel')}</Button>
            <Button onClick={importPasted} disabled={!pasted.trim()} testId="paste-import">{t('importRoster')}</Button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
