import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Card } from '../../components/ui';
import { setIn } from '../../lib/settingsForm';
import {
  fitErrorCount, formToSizing, SHORTS_FIELDS, sizingToForm, TOP_FIELDS, type Sizing, type SizingForm,
} from '../../lib/sizingForm';
import { FIT_LABEL, FITS, type Fit } from '../../lib/types';
import { CellErr, F, NumInput, SettingsEditor, type Editor } from './common';

type E = Editor<SizingForm, Sizing>;

export default function SizeChartsEditor() {
  return (
    <SettingsEditor<SizingForm, Sizing> section="sizing" toForm={sizingToForm} fromForm={formToSizing}
      intro={<p className="muted" style={{ margin: 0 }}>
        The size guide customers see and the measurements every order line is cut and sewn to. Garment measurements are in cm,
        laid flat: chest, waist and hip across (half the circumference), length from the highest shoulder point to the hem.
        “Fits chest” is the wearer's chest all round. Orders keep the chart they were placed with; changes apply to new orders.
      </p>}>
      {(e) => <Body e={e} />}
    </SettingsEditor>
  );
}

function Body({ e }: { e: E }) {
  // Tabs are links (?fit=kids) so they keep working when the form is read only (a disabled fieldset).
  const [params] = useSearchParams();
  const fit: Fit = (FITS as readonly string[]).includes(params.get('fit') ?? '') ? params.get('fit') as Fit : 'men';
  const { form: f, err } = e;
  const set = (path: (string | number)[], v: unknown) => e.setForm((cur) => setIn(cur, path, v));
  return (
    <>
      <Card title="Chart settings">
        <div className="form-grid" style={{ gridTemplateColumns: '160px 1fr' }}>
          <F label="Tolerance" errors={err('tolerance_cm')} hint="Plus or minus, printed on the measurement sheet.">
            <NumInput value={f.tolerance_cm} onChange={(v) => set(['tolerance_cm'], v)} errors={err('tolerance_cm')} suffix="cm" testId="sizing-tolerance" />
          </F>
          <F label="Note shown with the size guide" errors={err('note')} hint={`${f.note.length} / 400`}>
            <textarea value={f.note} maxLength={400} onChange={(v) => set(['note'], v.target.value)} style={{ minHeight: 56 }} data-testid="sizing-note" />
          </F>
        </div>
      </Card>

      <Card flush title="Size chart" actions={
        <nav className="tabs" style={{ margin: 0, border: 0 }} role="tablist">
          {FITS.map((x) => {
            const n = fitErrorCount(e.draft.errors, x);
            return <Link key={x} to={`?fit=${x}`} replace role="tab" aria-selected={x === fit} className={x === fit ? 'active' : ''} data-testid={`sizing-tab-${x}`}>
              {FIT_LABEL[x]}{n > 0 && <> <Badge tone="bad">{n}</Badge></>}</Link>;
          })}
        </nav>}>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className="row">
            <F label="Name shown to customers" errors={err(`fits.${fit}.name`)}>
              <input value={f.fits[fit].name} maxLength={40} style={{ width: 220 }} onChange={(v) => set(['fits', fit, 'name'], v.target.value)} data-testid={`sizing-name-${fit}`} />
            </F>
            <span className="muted small" style={{ flex: 1 }}>
              Sizes {f.fits[fit].sizes.map((r) => r.size).join(', ')} are fixed. Chest and length must not get smaller as sizes go up.
            </span>
          </div>
          <CellErr errors={err(`fits.${fit}`)} />
        </div>
        <ChartTable e={e} fit={fit} />
      </Card>
    </>
  );
}

function ChartTable({ e, fit }: { e: E; fit: Fit }) {
  const { form: f, err } = e;
  const set = (path: (string | number)[], v: unknown) => e.setForm((cur) => setIn(cur, path, v));
  const kids = fit === 'kids';
  const rows = f.fits[fit].sizes;
  const cell = (i: number, path: (string | number)[], errPath: string, value: string, testId: string) => (
    <NumInput value={value} width={58} onChange={(v) => set(['fits', fit, 'sizes', i, ...path], v)} errors={err(errPath)} testId={testId} />
  );
  return (
    <div className="table-wrap">
      <table className="table compact size-chart" data-testid={`sizing-table-${fit}`}>
        <thead>
          <tr>
            <th rowSpan={2}>Size</th>
            <th colSpan={kids ? 2 : 1} className="group">Wearer</th>
            <th colSpan={TOP_FIELDS.length} className="group">Jersey, laid flat</th>
            <th colSpan={SHORTS_FIELDS.length} className="group">Shorts, laid flat</th>
          </tr>
          <tr>
            <th>Fits chest</th>
            {kids && <th>Height</th>}
            {TOP_FIELDS.map((x) => <th key={x.key} className="num" title={`More than ${x.gt}, less than ${x.lt} cm`}>{x.label}</th>)}
            {SHORTS_FIELDS.map((x) => <th key={x.key} className="num" title={`More than ${x.gt}, less than ${x.lt} cm`}>{x.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const p = `fits.${fit}.sizes.${i}`;
            const id = `sz-${fit}-${r.size}`;
            return (
              <tr key={r.size} data-size={r.size}>
                <td className="strong nowrap">{r.size}</td>
                <td className="nowrap">
                  <span className="range-in">{cell(i, ['body_chest', 0], `${p}.body_chest`, r.body_chest[0], `${id}-body_chest-0`)}–{cell(i, ['body_chest', 1], `${p}.body_chest`, r.body_chest[1], `${id}-body_chest-1`)}</span>
                  <CellErr errors={err(`${p}.body_chest`, true)} />
                </td>
                {kids && (
                  <td className="nowrap">
                    <span className="range-in">{cell(i, ['height', 0], `${p}.height`, r.height[0], `${id}-height-0`)}–{cell(i, ['height', 1], `${p}.height`, r.height[1], `${id}-height-1`)}</span>
                    <CellErr errors={err(`${p}.height`, true)} />
                  </td>
                )}
                {TOP_FIELDS.map((x) => (
                  <td key={x.key}>{cell(i, ['top', x.key], `${p}.top.${x.key}`, r.top[x.key], `${id}-top.${x.key}`)}<CellErr errors={err(`${p}.top.${x.key}`)} /></td>
                ))}
                {SHORTS_FIELDS.map((x) => (
                  <td key={x.key}>{cell(i, ['shorts', x.key], `${p}.shorts.${x.key}`, r.shorts[x.key], `${id}-shorts.${x.key}`)}<CellErr errors={err(`${p}.shorts.${x.key}`)} /></td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small card-body" style={{ margin: 0 }}>All values in cm. Sleeve length is measured from the shoulder seam; the order uses the short or long value by its sleeves.</p>
    </div>
  );
}
