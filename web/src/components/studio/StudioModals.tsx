'use client';
import { useState } from 'react';
import { OtpSignIn } from '@/components/account/OtpSignIn';
import { useCatalogue } from '@/components/providers/data';
import { useSession } from '@/components/providers/session';
import { Banner, Button, Checkbox, Modal, SelectField, TextArea, TextField } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useT } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { Collection, DesignSpec } from '@/lib/api/types';
import { flow } from '@/lib/flow';
import { copyText } from '@/lib/share';

export function SaveDesignModal({ open, onClose, spec }: { open: boolean; onClose: () => void; spec: DesignSpec }) {
  const t = useT();
  const { me } = useSession();
  const [name, setName] = useState(spec.style_name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveDesign({ name: name.trim().slice(0, 60), spec, design_id: (flow.ensureDesignId() ?? '').slice(0, 40) });
      setDone(true);
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { setDone(false); onClose(); }} title={t('saveDesignTitle')} testId="save-modal" closeLabel={t('close')}>
      {!me ? (
        <>
          <p className="small muted">{t('signInToSave')}</p>
          <OtpSignIn testId="save-otp" />
        </>
      ) : done ? (
        <div className="stack">
          <Banner tone="pass" testId="design-saved">{t('designSaved')}</Banner>
          <Button kind="secondary" href="/account/designs">{t('viewSavedDesigns')}</Button>
        </div>
      ) : (
        <form onSubmit={save}>
          <TextField label={t('designName')} value={name} onValue={setName} maxLength={60} testId="save-name" />
          {error ? <Banner tone="fail">{error}</Banner> : null}
          <Button type="submit" busy={busy} disabled={!name.trim()} testId="save-confirm">{t('save')}</Button>
        </form>
      )}
    </Modal>
  );
}

export function TeamCollectionModal({ open, onClose, spec }: { open: boolean; onClose: () => void; spec: DesignSpec }) {
  const t = useT();
  const { me } = useSession();
  const { catalogue } = useCatalogue();
  const fabrics = catalogue?.fabrics.filter((f) => f.garments.includes(spec.garment)) ?? [];
  const [f, setF] = useState({
    title: spec.typography.team_name ? `${spec.typography.team_name} kit` : '', deadline: '', message: '', unique: true, fabric: 'standard',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Collection | null>(null);
  const [copied, setCopied] = useState(false);
  const link = created ? `${typeof window !== 'undefined' ? window.location.origin : ''}/t/${created.token}` : '';

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.title.trim().length < 2) {
      setError(t('teamTitleRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const c = await api.createCollection({
        title: f.title.trim(), spec, design_id: (flow.ensureDesignId() ?? '').slice(0, 40), fabric: f.fabric,
        deadline: f.deadline || null, message: f.message.trim(), unique_numbers: f.unique,
      });
      setCreated(c);
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('teamCreateTitle')} testId="team-modal" closeLabel={t('close')}>
      {!me ? (
        <>
          <p className="small muted">{t('teamSignIn')}</p>
          <OtpSignIn testId="team-otp" />
        </>
      ) : created ? (
        <div className="stack" data-testid="team-created">
          <Banner tone="pass">{t('teamCreated')}</Banner>
          <TextField label={t('teamLink')} value={link} readOnly testId="team-link" onFocus={(e) => e.currentTarget.select()} />
          <div className="row">
            <Button onClick={async () => setCopied(await copyText(link))} testId="team-copy">{copied ? `✓ ${t('linkCopied')}` : t('copyLink')}</Button>
            <Button kind="secondary" href={`/account/teams/${created.id}`} testId="team-dashboard">{t('teamOpenDashboard')}</Button>
          </div>
          <p className="small muted">{t('teamShareHint')}</p>
        </div>
      ) : (
        <form onSubmit={create} noValidate>
          <p className="small muted">{t('teamCreateText')}</p>
          <TextField label={t('teamTitleLabel')} value={f.title} maxLength={80} testId="team-title"
            onValue={(title) => setF((x) => ({ ...x, title }))} />
          <TextField label={t('teamDeadline')} type="date" value={f.deadline} optional={t('optional')} testId="team-deadline"
            min={new Date().toISOString().slice(0, 10)} onValue={(deadline) => setF((x) => ({ ...x, deadline }))} />
          <TextArea label={t('teamMessage')} value={f.message} maxLength={500} optional={t('optional')} rows={3} testId="team-message"
            placeholder={t('teamMessagePlaceholder')} onValue={(message) => setF((x) => ({ ...x, message }))} />
          {fabrics.length ? (
            <SelectField label={t('fabric')} value={f.fabric} onValue={(fabric) => setF((x) => ({ ...x, fabric }))} testId="team-fabric">
              {fabrics.map((fb) => <option key={fb.id} value={fb.id}>{fb.name}</option>)}
            </SelectField>
          ) : null}
          <Checkbox checked={f.unique} onChange={(unique) => setF((x) => ({ ...x, unique }))} testId="team-unique">{t('teamUnique')}</Checkbox>
          {error ? <div style={{ marginTop: 10 }}><Banner tone="fail">{error}</Banner></div> : null}
          <div style={{ marginTop: 14 }}><Button type="submit" busy={busy} testId="team-create">{t('teamCreate')}</Button></div>
        </form>
      )}
    </Modal>
  );
}
