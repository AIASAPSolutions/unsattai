'use client';
import { useEffect, useMemo, useState } from 'react';
import { Banner, Button, Card, Chip, Chips, Empty, ErrorState, Loading, Modal, SelectField, Skeleton, SvgImg, TextField } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { SIZES, TEXT_LIMITS, type CollectionEntry, type PublicCollection, type Size } from '@/lib/api/types';
import { formatDate, formatMoney } from '@/lib/price';
import { local } from '@/lib/store';
import { cleanNumber } from '@/lib/validation';
import { SizeChart } from '../../configure/RosterEditor';
import s from './team.module.css';

interface SavedEntry {
  id: string;
  edit_key: string;
  entry: Omit<CollectionEntry, 'id' | 'edit_key' | 'created_at'>;
}

// Kept in this browser's localStorage so the player can come back and change their entry (PUT ?key=).
const entryKey = (token: string) => `team-entry.${token}`;

function readSaved(token: string): SavedEntry | null {
  const v = local.get<SavedEntry | null>(entryKey(token), null);
  return v && typeof v.id === 'string' && typeof v.edit_key === 'string' ? v : null;
}

/** Public team page: a player adds (or later edits) their own name, number and size. */
export function TeamEntryClient({ token }: { token: string }) {
  const { t, lang } = useI18n();
  const [col, setCol] = useState<PublicCollection | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const [saved, setSaved] = useState<SavedEntry | null>(null);
  const [editing, setEditing] = useState(true);
  const [form, setForm] = useState({ player_name: '', number: '', size: 'M' as Size, quantity: 1, contact: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'pass' | 'fail'; text: string } | null>(null);
  const [mock, setMock] = useState<string | null>(null);
  const [chart, setChart] = useState(false);

  useEffect(() => {
    let live = true;
    api.publicCollection(token)
      .then((c) => {
        if (!live) return;
        setCol(c);
        const sv = readSaved(token);
        if (sv) {
          setSaved(sv);
          setForm({ ...sv.entry });
          setEditing(false);
        }
      })
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [token, nonce]);

  // The kit with this player's own name and number, redrawn as they type.
  const personal = useMemo(() => (col ? {
    ...col.spec, typography: { ...col.spec.typography, player_name: form.player_name.trim(), number: cleanNumber(form.number) },
  } : null), [col, form.player_name, form.number]);
  useEffect(() => {
    if (!personal) return;
    const c = new AbortController();
    const timer = setTimeout(() => {
      api.render(personal, [form.size], c.signal).then((p) => setMock(p.mockup_svg)).catch(() => undefined);
    }, 450);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [personal, form.size]);

  if (error) {
    const notFound = error instanceof ApiError && error.kind === 'not_found';
    return (
      <div className="container page">
        {notFound ? <Empty title={t('teamLinkInvalid')}><p>{t('teamLinkInvalidText')}</p></Empty>
          : <ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={() => { setError(null); setNonce((n) => n + 1); }} />}
      </div>
    );
  }
  if (!col) return <Loading label={t('loading')} />;

  const today = new Date().toISOString().slice(0, 10);
  const pastDeadline = !!col.deadline && col.deadline < today;
  const closed = col.status !== 'open' || pastDeadline;
  const num = cleanNumber(form.number);
  const takenByOther = col.unique_numbers && !!num && col.taken_numbers.includes(num) && saved?.entry.number !== num;
  const nameErr = form.player_name.length > TEXT_LIMITS.player_name ? t('tooLong') : null;
  const numErr = !/^\d{0,3}$/.test(num) ? t('digitsOnly') : takenByOther ? t('teamNumberTaken', { n: num }) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nameErr || numErr) return;
    if (!form.player_name.trim() && !num) {
      setMsg({ tone: 'fail', text: t('teamNameOrNumber') });
      return;
    }
    setBusy(true);
    setMsg(null);
    const body = { player_name: form.player_name.trim(), number: num, size: form.size, quantity: form.quantity, contact: form.contact.trim() };
    try {
      const res = saved ? await api.editEntry(token, saved.id, saved.edit_key, body) : await api.addEntry(token, body);
      const sv: SavedEntry = { id: res.id, edit_key: res.edit_key ?? saved?.edit_key ?? '', entry: body };
      local.set(entryKey(token), sv);
      setSaved(sv);
      setEditing(false);
      setMsg({ tone: 'pass', text: saved ? t('teamEntryUpdated') : t('teamEntryAdded') });
      const fresh = await api.publicCollection(token).catch(() => null);
      if (fresh) setCol(fresh);
    } catch (err) {
      setMsg({ tone: 'fail', text: errorMessage(t, err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container page" data-testid="screen-team-entry">
      <div className={s.layout}>
        <div className={s.art}>
          {mock ? <SvgImg svg={mock} alt={t('teamKitAlt', { title: col.title })} className={s.mock} testId="team-mockup" /> : <Skeleton height={380} />}
        </div>
        <div className="stack" style={{ gap: 16 }}>
          <div>
            <p className="small muted" style={{ margin: 0 }}>{t('teamInvitedBy', { name: col.organiser })}</p>
            <h1 style={{ margin: '4px 0 8px' }} data-testid="team-title">{col.title}</h1>
            {col.message ? <blockquote className={s.message}>{col.message}</blockquote> : null}
            <p style={{ margin: 0 }}>
              {col.deadline ? <strong>{t('teamAddBy', { date: formatDate(col.deadline, lang, true) })}</strong> : null}
              {col.deadline ? ' · ' : ''}{t('teamSoFar', { n: col.count })}
              {' · '}{t('teamFromPrice', { price: formatMoney(col.base_price, col.currency, lang) })}
            </p>
          </div>

          {closed ? (
            <Banner tone="warn" testId="team-closed">{pastDeadline ? t('teamDeadlinePassed') : t('teamClosed')}</Banner>
          ) : null}
          {msg ? <Banner tone={msg.tone} live testId="team-msg">{msg.text}</Banner> : null}

          {saved && !editing ? (
            <Card title={t('teamYourEntry')} testId="team-your-entry">
              <p style={{ marginTop: 0 }}>
                <strong>{saved.entry.player_name || t('unnamed')}</strong> · #{saved.entry.number || '—'} · {saved.entry.size} × {saved.entry.quantity}
              </p>
              {!closed ? <Button kind="secondary" onClick={() => setEditing(true)} testId="team-edit">{t('teamEditEntry')}</Button> : null}
              <p className="small muted" style={{ marginBottom: 0 }}>{t('teamEditHint')}</p>
            </Card>
          ) : !closed ? (
            <Card title={saved ? t('teamEditEntry') : t('teamAddYourself')}>
              <form className="stack" onSubmit={submit} noValidate data-testid="team-form">
                <div className={s.grid2}>
                  <TextField label={t('playerName')} value={form.player_name} maxLength={TEXT_LIMITS.player_name} error={nameErr}
                    hint={t('exactSpelling')} onValue={(v) => setForm((f) => ({ ...f, player_name: v }))} testId="team-name" />
                  <TextField label={t('number')} value={form.number} inputMode="numeric" maxLength={3} error={numErr}
                    onValue={(v) => setForm((f) => ({ ...f, number: v }))} testId="team-number" />
                </div>
                <div className={s.grid2}>
                  <SelectField label={t('size')} value={form.size} onValue={(v) => setForm((f) => ({ ...f, size: v as Size }))} testId="team-size">
                    {(col.sizes.length ? col.sizes : SIZES).map((z) => <option key={z} value={z}>{z}</option>)}
                  </SelectField>
                  <TextField label={t('quantity')} type="number" min={1} max={20} value={form.quantity}
                    onValue={(v) => setForm((f) => ({ ...f, quantity: Math.max(1, Math.min(20, Math.floor(Number(v) || 1))) }))} testId="team-qty" />
                </div>
                <button type="button" className={s.linkBtn} onClick={() => setChart(true)}>{t('sizeChart')}</button>
                <TextField label={t('teamContactLabel')} value={form.contact} maxLength={40} optional={t('optional')}
                  hint={t('teamContactHint')} onValue={(v) => setForm((f) => ({ ...f, contact: v }))} testId="team-contact" />
                <div className="row" style={{ gap: 8 }}>
                  <Button type="submit" busy={busy} testId="team-submit">{saved ? t('save') : t('teamJoin')}</Button>
                  {saved ? <Button kind="ghost" onClick={() => { setForm({ ...saved.entry }); setEditing(false); }}>{t('cancel')}</Button> : null}
                </div>
              </form>
            </Card>
          ) : null}

          {col.taken_numbers.length ? (
            <div data-testid="team-taken">
              <p className="small muted" style={{ margin: '0 0 6px' }}>
                {col.unique_numbers ? t('teamTakenNumbers') : t('teamUsedNumbers')}
              </p>
              <Chips label={t('teamTakenNumbers')}>
                {col.taken_numbers.map((n) => <Chip key={n} disabled>{n}</Chip>)}
              </Chips>
            </div>
          ) : null}
        </div>
      </div>
      <Modal open={chart} onClose={() => setChart(false)} title={t('sizeChart')} closeLabel={t('close')}><SizeChart /></Modal>
    </div>
  );
}
