/** Shared machinery for the settings editors: load, draft, validate, save with version, history. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { IconHistory } from '../../components/icons';
import { Alert, Button, DataTable, Drawer, ErrorBox, Field, Loading, Modal, useToast } from '../../components/ui';
import { get, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ApiError, errorsAt, errorsByPath, type FieldError } from '../../lib/errors';
import { dateTime } from '../../lib/format';
import { useLoad } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import { SECTION_TITLES, stableJson, type Converted } from '../../lib/settingsForm';
import type { SettingsSection } from '../../lib/permissions';
import type { Versioned } from '../../lib/types';

export interface Editor<F, V> {
  form: F;
  setForm: (f: F | ((cur: F) => F)) => void;
  draft: Converted<V>;
  loaded: Versioned<V>;
  readOnly: boolean;
  /** Messages for a path (and, with deep, anything under it). Client errors always; server errors after a save. */
  err: (path: string, deep?: boolean) => string[] | undefined;
}

export function SettingsEditor<F, V extends object>({ section, toForm, fromForm, intro, children, aside }: {
  section: SettingsSection;
  toForm: (v: V) => F;
  fromForm: (f: F, base: Partial<V>) => Converted<V>;
  intro?: ReactNode;
  children: (e: Editor<F, V>) => ReactNode;
  aside?: (e: Editor<F, V>) => ReactNode;
}) {
  const toast = useToast();
  const { canEdit, staff } = useAuth();
  const { reload: reloadRef, who } = useRefData();
  const d = useLoad(() => get<Versioned<V>>(`/ops/settings/${section}`), [section]);
  const [form, setForm] = useState<F | null>(null);
  const [serverErrors, setServerErrors] = useState<FieldError[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const [history, setHistory] = useState(false);
  const readOnly = !canEdit(section);

  useEffect(() => { if (d.data) setForm(toForm(d.data.value)); }, [d.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const draft = useMemo(() => (form && d.data ? fromForm(form, d.data.value) : null), [form, d.data, fromForm]);
  const baseline = useMemo(() => (d.data ? stableJson(fromForm(toForm(d.data.value), d.data.value).value) : ''), [d.data, fromForm, toForm]);
  const dirty = !!draft && stableJson(draft.value) !== baseline;

  const errMap = useMemo(() => errorsByPath([...(draft?.errors ?? []), ...(tried ? serverErrors : [])]), [draft, serverErrors, tried]);
  const err = useCallback((path: string, deep = false) => {
    const e = errorsAt(errMap, path, deep);
    return e.length ? e : undefined;
  }, [errMap]);

  const save = async () => {
    if (!draft || !d.data) return;
    setTried(true);
    setServerErrors([]);
    if (draft.errors.length) { toast.error(new Error(`Fix ${draft.errors.length} value${draft.errors.length > 1 ? 's' : ''} before saving.`)); return; }
    setSaving(true);
    try {
      const out = await put<Versioned<V>>(`/ops/settings/${section}`, { value: draft.value, version: d.data.version });
      d.setData(out);
      setConflict(null);
      setTried(false);
      toast.success(`${SECTION_TITLES[section]} saved as version ${out.version}.`);
      void reloadRef();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(e.message);
      else if (e instanceof ApiError && e.status === 422 && e.fields.length) { setServerErrors(e.fields); toast.error(new Error('The server did not accept some values. They are marked below.')); }
      else toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const reloadLatest = async () => {
    setConflict(null);
    setServerErrors([]);
    setTried(false);
    await d.reload();
  };

  if (d.error && !d.data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data || !form || !draft) return <Loading />;
  const editor: Editor<F, V> = { form, setForm: setForm as Editor<F, V>['setForm'], draft, loaded: d.data, readOnly, err };
  const formLevel = errorsAt(errMap, '');
  const shownErrors = tried ? [...draft.errors, ...serverErrors] : [];

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ position: 'sticky', top: 52, zIndex: 10, background: 'var(--bg)', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
        <div style={{ flex: 1 }}>
          <b>{SECTION_TITLES[section]}</b> <span className="muted small" data-testid="settings-version">version {d.data.version}</span>
          <span className="muted small"> · {d.data.updated_at ? `saved ${dateTime(d.data.updated_at)} by ${who(d.data.updated_by)}` : 'defaults, never saved'}</span>
          {dirty && !readOnly && <span className="badge warn" style={{ marginLeft: 8 }}>Unsaved changes</span>}
        </div>
        <Button size="sm" icon={<IconHistory />} onClick={() => setHistory(true)} data-testid="settings-history">History</Button>
        {!readOnly && <Button size="sm" disabled={!dirty || saving} onClick={() => { setForm(toForm(d.data!.value)); setServerErrors([]); setTried(false); }}>Discard</Button>}
        <Button variant="primary" busy={saving} disabled={readOnly || !dirty} onClick={save} data-testid="settings-save"
          title={readOnly ? `Your role (${staff?.role}) cannot change ${SECTION_TITLES[section].toLowerCase()}` : ''}>Save</Button>
      </div>

      {readOnly && <Alert tone="warn"><span data-testid="settings-readonly">Read only: your role (<b>{staff?.role}</b>) cannot change {SECTION_TITLES[section].toLowerCase()}. Ask a manager or admin.</span></Alert>}
      {conflict && (
        <Alert tone="error" action={<div className="row tight"><Button size="sm" variant="danger-solid" onClick={reloadLatest} data-testid="conflict-reload">Reload latest (discard mine)</Button><Button size="sm" onClick={() => setConflict(null)}>Keep editing</Button></div>}>
          <b>Someone else saved this section while you were editing.</b> {conflict} Reload to see their version, then make your change again.
        </Alert>
      )}
      {shownErrors.length > 0 && (
        <Alert tone="error">
          <b>{shownErrors.length} value{shownErrors.length > 1 ? 's need' : ' needs'} attention:</b>
          <ul>{shownErrors.slice(0, 8).map((e, i) => <li key={i}>{e.path ? <code>{e.path}</code> : null} {e.message}</li>)}</ul>
        </Alert>
      )}
      {!tried && formLevel.length > 0 && <Alert tone="warn">{formLevel.join(' ')}</Alert>}
      {intro}
      <div className={aside ? 'grid grid-main' : ''} style={{ alignItems: 'start' }}>
        <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="stack">{children(editor)}</fieldset>
        {aside && <div style={{ position: 'sticky', top: 110 }}>{aside(editor)}</div>}
      </div>
      {history && <History section={section} current={d.data.version} readOnly={readOnly} onClose={() => setHistory(false)}
        onLoad={(v) => { setForm(toForm(v as V)); setHistory(false); toast.info('Loaded into the editor. Review, then Save to make it current.'); }} />}
    </div>
  );
}

function History({ section, current, onClose, onLoad, readOnly }: { section: SettingsSection; current: number; readOnly: boolean; onClose: () => void; onLoad: (v: unknown) => void }) {
  const h = useLoad(() => get<{ items: (Versioned<unknown>)[] }>(`/ops/settings/${section}/history`), [section]);
  const { who } = useRefData();
  const [view, setView] = useState<Versioned<unknown> | null>(null);
  return (
    <Drawer open title={`${SECTION_TITLES[section]} history`} onClose={onClose} testId="history-drawer">
      {h.error ? <ErrorBox error={h.error} /> : !h.data ? <Loading /> : (
        <DataTable rows={h.data.items} rowKey={(r) => String(r.version)} compact empty="Never saved: the defaults are in use." columns={[
          { key: 'v', header: 'Version', render: (r) => <b>v{r.version}{r.version === current && ' (current)'}</b> },
          { key: 'at', header: 'Saved', render: (r) => dateTime(r.updated_at) },
          { key: 'by', header: 'By', render: (r) => who(r.updated_by) },
          { key: 'x', header: '', render: (r) => <Button size="xs" onClick={() => setView(r)} data-testid="history-view">View</Button> },
        ]} />
      )}
      <p className="muted small">The last 20 saves are kept. Loading an older version puts it in the editor; nothing changes until you save.</p>
      {view && (
        <Modal open wide title={`${SECTION_TITLES[section]} v${view.version}`} onClose={() => setView(null)}
          footer={<><Button onClick={() => setView(null)}>Close</Button>{!readOnly && view.version !== current && <Button variant="primary" onClick={() => onLoad(view.value)}>Load into editor</Button>}</>}>
          <div className="muted small">Saved {dateTime(view.updated_at)} by {who(view.updated_by)}</div>
          <pre className="mono" style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 6, maxHeight: '60vh', overflow: 'auto', margin: 0 }}>{JSON.stringify(view.value, null, 2)}</pre>
        </Modal>
      )}
    </Drawer>
  );
}

// ------------------------------------------------------------------ small inputs bound to errors

export function NumInput({ value, onChange, errors, suffix, width, testId, placeholder }: {
  value: string; onChange: (v: string) => void; errors?: string[]; suffix?: string; width?: number; testId?: string; placeholder?: string;
}) {
  const input = <input inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`num ${errors ? 'invalid' : ''}`} style={{ width }} title={errors?.join(' ')} data-testid={testId} aria-invalid={!!errors} />;
  return suffix ? <div className="input-suffix">{input}<span>{suffix}</span></div> : input;
}

export function F({ label, errors, hint, children, className }: { label: ReactNode; errors?: string[]; hint?: ReactNode; children: ReactNode; className?: string }) {
  return <Field label={label} errors={errors} hint={hint} className={className}>{children}</Field>;
}

export function CellErr({ errors }: { errors?: string[] }) {
  return errors ? <div className="small bad-text">{errors.join(' ')}</div> : null;
}

export { setIn } from '../../lib/settingsForm';
