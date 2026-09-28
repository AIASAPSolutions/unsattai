import { useState } from 'react';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '../../components/icons';
import { Badge, Button, Card, TagInput } from '../../components/ui';
import { day, isoDate, label } from '../../lib/format';
import {
  companyToForm, crmToForm, DAY_NAMES, deliveryToForm, formToCompany, formToCrm, formToDelivery, formToProduction, isCatchAll,
  productionToForm, setIn, toCode, type Company, type CompanyForm, type CrmConfig, type CrmForm, type Delivery, type DeliveryForm,
  type Production, type ProductionForm,
} from '../../lib/settingsForm';
import { CellErr, F, NumInput, SettingsEditor } from './common';

function move<T>(xs: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= xs.length) return xs;
  const c = [...xs];
  [c[i], c[j]] = [c[j], c[i]];
  return c;
}

function DayPicker({ value, onChange, testId }: { value: number[]; onChange: (v: number[]) => void; testId?: string }) {
  return (
    <div className="chips" data-testid={testId}>
      {DAY_NAMES.map((n, i) => {
        const on = value.includes(i);
        return <button key={n} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== i) : [...value, i].sort())}>{n}</button>;
      })}
    </div>
  );
}

// ------------------------------------------------------------------ production

export function ProductionEditor() {
  return (
    <SettingsEditor<ProductionForm, Production> section="production" toForm={productionToForm} fromForm={formToProduction}
      intro={<p className="muted" style={{ margin: 0 }}>The planner loads each stage up to its daily capacity (pieces), in this order. Changes re-plan every active order and change the dates new customers are promised.</p>}>
      {(e) => {
        const f = e.form;
        const set = (path: (string | number)[], v: unknown) => e.setForm((cur) => setIn(cur, path, v));
        return (
          <>
            <Card title="Stages" actions={<Button size="sm" icon={<IconPlus />} onClick={() => set(['stages'], [...f.stages, { id: `stage${f.stages.length + 1}`, name: '', capacity_per_day: '100', fixed_days: '0' }])}>Add stage</Button>} flush>
              <div className="table-wrap">
                <table className="table compact" data-testid="stages-table">
                  <thead><tr><th>Order</th><th>ID</th><th>Name</th><th className="num">Capacity per day</th><th className="num">Wait after (days)</th><th /></tr></thead>
                  <tbody>
                    {f.stages.map((s, i) => (
                      <tr key={i}>
                        <td style={{ width: 80 }} className="nowrap">
                          <button type="button" className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => set(['stages'], move(f.stages, i, -1))}><IconArrowUp /></button>
                          <button type="button" className="icon-btn" aria-label="Move down" disabled={i === f.stages.length - 1} onClick={() => set(['stages'], move(f.stages, i, 1))}><IconArrowDown /></button>
                        </td>
                        <td style={{ width: 120 }}><input value={s.id} maxLength={30} onChange={(v) => set(['stages', i, 'id'], v.target.value.toLowerCase())} className={e.err(`stages.${i}.id`) ? 'invalid' : ''} /><CellErr errors={e.err(`stages.${i}.id`)} /></td>
                        <td><input value={s.name} maxLength={60} onChange={(v) => set(['stages', i, 'name'], v.target.value)} className={e.err(`stages.${i}.name`) ? 'invalid' : ''} /><CellErr errors={e.err(`stages.${i}.name`)} /></td>
                        <td style={{ width: 170 }}><NumInput value={s.capacity_per_day} onChange={(v) => set(['stages', i, 'capacity_per_day'], v)} errors={e.err(`stages.${i}.capacity_per_day`)} suffix="pcs" testId={`capacity-${s.id}`} /><CellErr errors={e.err(`stages.${i}.capacity_per_day`)} /></td>
                        <td style={{ width: 140 }}><NumInput value={s.fixed_days} onChange={(v) => set(['stages', i, 'fixed_days'], v)} errors={e.err(`stages.${i}.fixed_days`)} /><CellErr errors={e.err(`stages.${i}.fixed_days`)} /></td>
                        <td style={{ width: 40 }}><button type="button" className="icon-btn" aria-label="Remove stage" disabled={f.stages.length <= 1} onClick={() => set(['stages'], f.stages.filter((_, j) => j !== i))}><IconTrash /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card-body" style={{ paddingTop: 6 }}><CellErr errors={e.err('stages')} /><span className="muted small">“Wait after” holds the next stage back (curing, batching). Orders already paid keep their own list of stages.</span></div>
            </Card>
            <div className="grid grid-2">
              <Card title="Working calendar">
                <div className="stack">
                  <F label="Working days" errors={e.err('working_days', true)}><DayPicker value={f.working_days} onChange={(v) => set(['working_days'], v)} testId="working-days" /></F>
                  <div className="form-grid">
                    <F label="Daily cut-off hour" errors={e.err('daily_cutoff_hour')} hint="Orders paid after this hour start the next working day."><NumInput value={f.daily_cutoff_hour} onChange={(v) => set(['daily_cutoff_hour'], v)} errors={e.err('daily_cutoff_hour')} suffix=":00" /></F>
                    <F label="Time zone" errors={e.err('timezone')}><input value={f.timezone} onChange={(v) => set(['timezone'], v.target.value)} /></F>
                  </div>
                  <label className="check"><input type="checkbox" checked={f.rush_priority} onChange={(v) => set(['rush_priority'], v.target.checked)} /> Plan express orders first</label>
                </div>
              </Card>
              <Card title="Holidays">
                <Holidays value={f.holidays} onChange={(v) => set(['holidays'], v)} err={e.err} />
              </Card>
            </div>
          </>
        );
      }}
    </SettingsEditor>
  );
}

function Holidays({ value, onChange, err }: { value: string[]; onChange: (v: string[]) => void; err: (p: string, deep?: boolean) => string[] | undefined }) {
  const [d, setD] = useState('');
  const today = isoDate();
  const sorted = [...value].sort();
  return (
    <div className="stack tight" data-testid="holidays">
      <div className="row tight">
        <input type="date" value={d} onChange={(x) => setD(x.target.value)} style={{ width: 'auto' }} data-testid="holiday-date" />
        <Button size="sm" disabled={!d || value.includes(d)} onClick={() => { onChange([...value, d].sort()); setD(''); }} data-testid="holiday-add">Add holiday</Button>
      </div>
      <CellErr errors={err('holidays', true)} />
      {!sorted.length && <div className="muted small">No holidays. Production and dispatch skip these dates.</div>}
      <div className="row tight">
        {sorted.map((h) => (
          <span key={h} className="tag" style={h < today ? { opacity: 0.6 } : undefined}>{day(h, true)}
            <button type="button" aria-label={`Remove ${h}`} onClick={() => onChange(value.filter((x) => x !== h))}>×</button>
          </span>
        ))}
      </div>
      {sorted.some((h) => h < today) && <Button size="xs" variant="ghost" onClick={() => onChange(value.filter((h) => h >= today))}>Remove past holidays</Button>}
    </div>
  );
}

// ------------------------------------------------------------------ delivery

export function DeliveryEditor() {
  return (
    <SettingsEditor<DeliveryForm, Delivery> section="delivery" toForm={deliveryToForm} fromForm={formToDelivery}
      intro={<p className="muted" style={{ margin: 0 }}>A delivery address is matched to the zone with the longest matching pincode prefix, then by state, else the catch-all zone.</p>}>
      {(e) => {
        const f = e.form;
        const set = (path: (string | number)[], v: unknown) => e.setForm((cur) => setIn(cur, path, v));
        const catchAlls = f.zones.filter((z) => isCatchAll(z)).length;
        return (
          <>
            <div className="grid grid-2">
              <Card title="Dispatch">
                <div className="stack">
                  <div className="form-grid">
                    {Object.keys(f.origin).map((k) => <F key={k} label={`Origin ${k}`}><input value={f.origin[k]} onChange={(v) => set(['origin', k], v.target.value)} /></F>)}
                  </div>
                  <F label="Dispatch days" errors={e.err('dispatch_days', true)}><DayPicker value={f.dispatch_days} onChange={(v) => set(['dispatch_days'], v)} /></F>
                </div>
              </Card>
              <Card title="Pickup">
                <div className="form-grid">
                  <label className="check wide"><input type="checkbox" checked={f.pickup.enabled} onChange={(v) => set(['pickup', 'enabled'], v.target.checked)} /> Customers can collect</label>
                  <F label="Label" errors={e.err('pickup.label')}><input value={f.pickup.label} maxLength={80} onChange={(v) => set(['pickup', 'label'], v.target.value)} /></F>
                  <F label="Fee" errors={e.err('pickup.fee')}><NumInput value={f.pickup.fee} onChange={(v) => set(['pickup', 'fee'], v)} errors={e.err('pickup.fee')} /></F>
                </div>
              </Card>
            </div>
            <Card title="Zones" actions={<Button size="sm" icon={<IconPlus />} onClick={() => {
              const z = { id: `zone${f.zones.length + 1}`, name: '', states: '', pincode_prefixes: '', base: '100', per_piece: '5', free_above: '', transit_days: '4' };
              const at = f.zones.findIndex((x) => isCatchAll(x));
              set(['zones'], at < 0 ? [...f.zones, z] : [...f.zones.slice(0, at), z, ...f.zones.slice(at)]);
            }}>Add zone</Button>} flush>
              <div className="table-wrap">
                <table className="table compact" data-testid="zones-table">
                  <thead><tr><th>ID</th><th>Name</th><th>States</th><th>Pincode prefixes</th><th className="num">Base</th><th className="num">Per piece</th><th className="num">Free above</th><th className="num">Transit days</th><th /></tr></thead>
                  <tbody>
                    {f.zones.map((z, i) => {
                      const all = isCatchAll(z);
                      return (
                        <tr key={i}>
                          <td style={{ width: 100 }}><input value={z.id} maxLength={30} onChange={(v) => set(['zones', i, 'id'], v.target.value.toLowerCase())} className={e.err(`zones.${i}.id`) ? 'invalid' : ''} /><CellErr errors={e.err(`zones.${i}.id`)} /></td>
                          <td style={{ minWidth: 140 }}><input value={z.name} maxLength={60} onChange={(v) => set(['zones', i, 'name'], v.target.value)} />{all && <Badge tone="accent">Everywhere else</Badge>}<CellErr errors={e.err(`zones.${i}.name`)} /></td>
                          <td style={{ minWidth: 120 }}><input value={z.states} placeholder="TN, KL" onChange={(v) => set(['zones', i, 'states'], v.target.value)} /></td>
                          <td style={{ minWidth: 140 }}><input value={z.pincode_prefixes} placeholder="60, 61" onChange={(v) => set(['zones', i, 'pincode_prefixes'], v.target.value)} className={e.err(`zones.${i}.pincode_prefixes`) ? 'invalid' : ''} /><CellErr errors={e.err(`zones.${i}.pincode_prefixes`)} /></td>
                          <td style={{ width: 90 }}><NumInput value={z.base} onChange={(v) => set(['zones', i, 'base'], v)} errors={e.err(`zones.${i}.base`)} /></td>
                          <td style={{ width: 80 }}><NumInput value={z.per_piece} onChange={(v) => set(['zones', i, 'per_piece'], v)} errors={e.err(`zones.${i}.per_piece`)} /></td>
                          <td style={{ width: 100 }}><NumInput value={z.free_above} placeholder="Never" onChange={(v) => set(['zones', i, 'free_above'], v)} errors={e.err(`zones.${i}.free_above`)} /></td>
                          <td style={{ width: 80 }}><NumInput value={z.transit_days} onChange={(v) => set(['zones', i, 'transit_days'], v)} errors={e.err(`zones.${i}.transit_days`)} /></td>
                          <td style={{ width: 40 }}><button type="button" className="icon-btn" aria-label="Remove zone" disabled={all && catchAlls <= 1} title={all && catchAlls <= 1 ? 'Keep one catch-all zone' : ''} onClick={() => set(['zones'], f.zones.filter((_, j) => j !== i))}><IconTrash /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="card-body" style={{ paddingTop: 6 }}><CellErr errors={e.err('zones')} /><span className="muted small">States and prefixes are comma separated. Leave both empty on exactly one zone: it covers everywhere else. Delivery cost = base + per piece × pieces, free when goods reach “free above”.</span></div>
            </Card>
            <Card title="Carriers" actions={<Button size="sm" icon={<IconPlus />} onClick={() => set(['carriers'], [...f.carriers, { id: `carrier${f.carriers.length + 1}`, name: '', tracking_url: '', active: true }])}>Add carrier</Button>} flush>
              <table className="table compact">
                <thead><tr><th>ID</th><th>Name</th><th>Tracking link</th><th>Active</th><th /></tr></thead>
                <tbody>
                  {f.carriers.map((c, i) => (
                    <tr key={i}>
                      <td style={{ width: 120 }}><input value={c.id} maxLength={30} onChange={(v) => set(['carriers', i, 'id'], v.target.value.toLowerCase())} className={e.err(`carriers.${i}.id`) ? 'invalid' : ''} /><CellErr errors={e.err(`carriers.${i}.id`)} /></td>
                      <td><input value={c.name} maxLength={60} onChange={(v) => set(['carriers', i, 'name'], v.target.value)} /><CellErr errors={e.err(`carriers.${i}.name`)} /></td>
                      <td><input value={c.tracking_url} maxLength={300} placeholder="https://carrier.example/track?no={tracking}" onChange={(v) => set(['carriers', i, 'tracking_url'], v.target.value)} className={e.err(`carriers.${i}.tracking_url`) ? 'invalid' : ''} /><CellErr errors={e.err(`carriers.${i}.tracking_url`)} /></td>
                      <td style={{ width: 60, textAlign: 'center' }}><input type="checkbox" checked={c.active} onChange={(v) => set(['carriers', i, 'active'], v.target.checked)} aria-label="Active" /></td>
                      <td style={{ width: 40 }}><button type="button" className="icon-btn" aria-label="Remove carrier" disabled={f.carriers.length <= 1} onClick={() => set(['carriers'], f.carriers.filter((_, j) => j !== i))}><IconTrash /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="card-body" style={{ paddingTop: 6 }}><CellErr errors={e.err('carriers')} /></div>
            </Card>
          </>
        );
      }}
    </SettingsEditor>
  );
}

// ------------------------------------------------------------------ company

export function CompanyEditor() {
  return (
    <SettingsEditor<CompanyForm, Company> section="company" toForm={companyToForm} fromForm={formToCompany}
      intro={<p className="muted" style={{ margin: 0 }}>Shown on invoices, labels, quotes and to customers in the store.</p>}>
      {(e) => {
        const f = e.form;
        const set = (k: keyof CompanyForm, v: string) => e.setForm((cur) => ({ ...cur, [k]: v }));
        const text = (k: keyof CompanyForm, l: string, max: number, hint?: string, wide?: boolean) => (
          <F label={l} errors={e.err(k)} hint={hint} className={wide ? 'wide' : ''}><input value={f[k]} maxLength={max} onChange={(v) => set(k, v.target.value)} data-testid={`company-${k}`} /></F>
        );
        return (
          <Card title="Company">
            <div className="form-grid">
              {text('name', 'Trading name', 80)}
              {text('legal_name', 'Legal name', 120)}
              {text('tax_id', 'Tax ID (GSTIN)', 40)}
              {text('email', 'Email', 120)}
              {text('phone', 'Phone', 30)}
              {text('support_hours', 'Support hours', 80)}
              <F label="Address" className="wide" errors={e.err('address')}><textarea value={f.address} maxLength={300} onChange={(v) => set('address', v.target.value)} /></F>
              {text('invoice_prefix', 'Invoice and order prefix', 8, 'Capitals, digits and -, up to 8. Applies to new orders.')}
              <F label="Quotes valid for" errors={e.err('quote_valid_days')}><NumInput value={f.quote_valid_days} onChange={(v) => set('quote_valid_days', v)} errors={e.err('quote_valid_days')} suffix="days" /></F>
            </div>
          </Card>
        );
      }}
    </SettingsEditor>
  );
}

// ------------------------------------------------------------------ CRM lists

export function CrmEditor() {
  return (
    <SettingsEditor<CrmForm, CrmConfig> section="crm" toForm={crmToForm} fromForm={formToCrm}
      intro={<p className="muted" style={{ margin: 0 }}>Codes are saved in lower_snake_case. Renaming a stage does not move leads already in it: move them first.</p>}>
      {(e) => {
        const f = e.form;
        const set = <K extends keyof CrmForm>(k: K, v: CrmForm[K]) => e.setForm((cur) => ({ ...cur, [k]: v }));
        return (
          <div className="grid grid-2">
            <Card title="Lead stages (pipeline order)">
              <OrderedList value={f.lead_stages} onChange={(v) => set('lead_stages', v)} locked={['won', 'lost']} />
              <CellErr errors={e.err('lead_stages', true)} />
              <p className="muted small" style={{ margin: '8px 0 0' }}>Renaming or removing a stage does not move existing leads. Leads left in a stage that no longer exists drop off the pipeline board, so move them first.</p>
            </Card>
            <div className="stack">
              <Card title="Lead sources"><TagInput value={f.lead_sources} onChange={(v) => set('lead_sources', v)} normalise={toCode} /><CellErr errors={e.err('lead_sources', true)} /></Card>
              <Card title="Organisation kinds"><TagInput value={f.organisation_kinds} onChange={(v) => set('organisation_kinds', v)} normalise={toCode} /><CellErr errors={e.err('organisation_kinds', true)} /></Card>
              <Card title="Ticket categories"><TagInput value={f.ticket_categories} onChange={(v) => set('ticket_categories', v)} normalise={toCode} /><CellErr errors={e.err('ticket_categories', true)} /></Card>
              <Card title="Reorder reminders">
                <F label="Remind after" errors={e.err('reorder_reminder_days')} hint="Days since a customer's last order. 0 turns reminders off.">
                  <NumInput value={f.reorder_reminder_days} onChange={(v) => set('reorder_reminder_days', v)} errors={e.err('reorder_reminder_days')} suffix="days" />
                </F>
              </Card>
            </div>
          </div>
        );
      }}
    </SettingsEditor>
  );
}

function OrderedList({ value, onChange, locked }: { value: string[]; onChange: (v: string[]) => void; locked: string[] }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const c = toCode(draft);
    if (!c || value.includes(c)) return;
    const i = value.findIndex((x) => locked.includes(x));
    onChange(i < 0 ? [...value, c] : [...value.slice(0, i), c, ...value.slice(i)]);
    setDraft('');
  };
  return (
    <div className="stack tight">
      {value.map((s, i) => (
        <div key={s} className="row" style={{ flexWrap: 'nowrap', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
          <span style={{ flex: 1 }}><b>{label(s)}</b> <code className="muted">{s}</code> {locked.includes(s) && <Badge>required</Badge>}</span>
          <button type="button" className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => onChange(move(value, i, -1))}><IconArrowUp /></button>
          <button type="button" className="icon-btn" aria-label="Move down" disabled={i === value.length - 1} onClick={() => onChange(move(value, i, 1))}><IconArrowDown /></button>
          <button type="button" className="icon-btn" aria-label={`Remove ${s}`} disabled={locked.includes(s)} onClick={() => onChange(value.filter((x) => x !== s))}><IconTrash /></button>
        </div>
      ))}
      <div className="row tight">
        <input className="sm" style={{ maxWidth: 220 }} value={draft} placeholder="New stage, e.g. sample sent" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <Button size="sm" onClick={add} disabled={!toCode(draft)}>Add stage</Button>
      </div>
    </div>
  );
}
