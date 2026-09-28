'use client';
import { useState } from 'react';
import { Banner, Button, Checkbox, TextArea, TextField } from '@/components/ui';
import { useSession } from '@/components/providers/session';
import { errorMessage } from '@/i18n';
import { useT } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { DesignSpec } from '@/lib/api/types';
import { checkCustomerName, checkEmail, checkPhone } from '@/lib/validation';

/** Bulk or custom enquiry (POST /shop/enquiries): becomes a lead and a call-back task for sales. */
export function EnquiryForm({ spec, pieces, compact, testId = 'enquiry' }: {
  spec?: DesignSpec | null; pieces?: number; compact?: boolean; testId?: string;
}) {
  const t = useT();
  const { me } = useSession();
  const [f, setF] = useState({
    name: me?.name ?? '', phone: me?.phone ?? '', email: me?.email ?? '', organisation: spec?.typography.team_name ?? '',
    pieces: pieces ? String(pieces) : '', needed_by: '', message: '',
  });
  const [withDesign, setWithDesign] = useState(!!spec);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const issues = { name: checkCustomerName(f.name), phone: checkPhone(f.phone), email: checkEmail(f.email) };
  const valid = !issues.name && !issues.phone && !issues.email;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.enquiry({
        name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), organisation: f.organisation.trim(),
        pieces: Math.max(0, Math.min(100000, Number(f.pieces) || 0)), needed_by: f.needed_by || null,
        message: f.message.trim(), spec: withDesign && spec ? spec : null,
      });
      setDone(res.reference);
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  if (done) return <Banner tone="pass" testId={`${testId}-done`}>{t('enquirySent', { ref: done })}</Banner>;

  const grid = compact ? undefined : { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', columnGap: 16 };
  return (
    <form onSubmit={submit} noValidate data-testid={testId}>
      <div style={grid}>
        <TextField label={t('enquiryName')} value={f.name} onValue={set('name')} autoComplete="name" maxLength={80}
          error={touched && issues.name ? t('required') : null} testId={`${testId}-name`} />
        <TextField label={t('phone')} value={f.phone} onValue={set('phone')} type="tel" autoComplete="tel" maxLength={24}
          error={touched && issues.phone ? t('invalid') : null} testId={`${testId}-phone`} />
        <TextField label={t('email')} value={f.email} onValue={set('email')} type="email" autoComplete="email" optional={t('optional')}
          maxLength={120} error={touched && issues.email ? t('invalid') : null} testId={`${testId}-email`} />
        <TextField label={t('enquiryOrg')} value={f.organisation} onValue={set('organisation')} optional={t('optional')} maxLength={120}
          testId={`${testId}-org`} />
        <TextField label={t('enquiryPieces')} value={f.pieces} onValue={(v) => set('pieces')(v.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric" testId={`${testId}-pieces`} />
        <TextField label={t('enquiryNeededBy')} value={f.needed_by} onValue={set('needed_by')} type="date" optional={t('optional')}
          min={new Date().toISOString().slice(0, 10)} testId={`${testId}-date`} />
      </div>
      <TextArea label={t('enquiryMessage')} value={f.message} onValue={set('message')} maxLength={2000}
        placeholder={t('enquiryMessagePlaceholder')} testId={`${testId}-message`} />
      {spec ? <Checkbox checked={withDesign} onChange={setWithDesign}>{t('enquiryAttachDesign')}</Checkbox> : null}
      {error ? <Banner tone="fail">{error}</Banner> : null}
      <div style={{ marginTop: 12 }}>
        <Button type="submit" busy={busy} testId={`${testId}-send`}>{t('enquirySend')}</Button>
      </div>
    </form>
  );
}
