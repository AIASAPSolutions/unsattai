'use client';
import { useState } from 'react';
import { useSession } from '@/components/providers/session';
import { AddressFields } from '@/components/shop/AddressFields';
import { Banner, Button, Card, Checkbox, TextField } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useT } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { Address, Me } from '@/lib/api/types';
import { EMPTY_ADDRESS } from '@/lib/flow';
import { validateAddress } from '@/lib/order';
import { stateName } from '@/lib/states';
import { checkEmail } from '@/lib/validation';
import s from '../account.module.css';

const MAX_ADDRESSES = 10;

export function ProfileClient() {
  const { me } = useSession();
  // AccountShell only renders this when signed in.
  return me ? <ProfileForm key={me.id} me={me} /> : null;
}

function ProfileForm({ me }: { me: Me }) {
  const t = useT();
  const { setMe } = useSession();
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email);
  const [optIn, setOptIn] = useState(me.marketing_opt_in);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'pass' | 'fail'; text: string } | null>(null);
  const [adding, setAdding] = useState<Address | null>(null);
  const [addTried, setAddTried] = useState(false);

  const save = async (patch: Parameters<typeof api.updateMe>[0], what: string) => {
    setBusy(what);
    setMsg(null);
    try {
      const updated = await api.updateMe(patch);
      setMe(updated);
      setMsg({ tone: 'pass', text: t('saved') });
      return true;
    } catch (e) {
      setMsg({ tone: 'fail', text: errorMessage(t, e) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const emailErr = checkEmail(email) ? t('invalid') : null;

  const addAddress = async () => {
    if (!adding) return;
    setAddTried(true);
    if (validateAddress(adding).length) return;
    if (await save({ addresses: [...me.addresses, adding] }, 'address')) {
      setAdding(null);
      setAddTried(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }} data-testid="account-profile">
      <h2 style={{ margin: 0 }}>{t('accProfile')}</h2>
      {msg ? <Banner tone={msg.tone} live testId="profile-msg">{msg.text}</Banner> : null}
      <Card title={t('accDetails')}>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!emailErr) void save({ name: name.trim(), email: email.trim(), marketing_opt_in: optIn }, 'profile'); }}>
          <TextField label={t('customerName')} value={name} onValue={setName} maxLength={80} autoComplete="name" testId="profile-name" />
          <TextField label={t('phone')} value={me.phone} readOnly hint={t('accPhoneFixed')} testId="profile-phone" />
          <TextField label={t('email')} value={email} onValue={setEmail} type="email" maxLength={120} optional={t('optional')}
            autoComplete="email" error={emailErr} testId="profile-email" />
          <Checkbox checked={optIn} onChange={setOptIn} testId="profile-optin">{t('accMarketing')}</Checkbox>
          <div><Button type="submit" busy={busy === 'profile'} testId="profile-save">{t('save')}</Button></div>
        </form>
      </Card>

      <Card title={t('savedAddresses')} testId="addresses">
        {me.addresses.length === 0 && !adding ? <p className="muted">{t('accNoAddresses')}</p> : null}
        <ul className={s.list}>
          {me.addresses.map((a, i) => (
            <li key={`${a.line1}-${a.pincode}-${i}`} className={s.item} data-testid={`address-${i}`}>
              <address style={{ fontStyle: 'normal' }}>
                {a.name ? <strong>{a.name}{a.phone ? ` · ${a.phone}` : ''}<br /></strong> : null}
                {a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />
                {a.city}, {stateName(a.state)} {a.pincode}
              </address>
              <Button kind="ghost" size="sm" busy={busy === `del-${i}`} testId={`address-remove-${i}`}
                onClick={() => void save({ addresses: me.addresses.filter((_, j) => j !== i) }, `del-${i}`)}>
                {t('delete')}
              </Button>
            </li>
          ))}
        </ul>
        {adding ? (
          <div className="stack" style={{ marginTop: 16 }}>
            <AddressFields value={adding} onChange={setAdding} showErrors={addTried} testId="new-address" />
            <div className="row" style={{ gap: 8 }}>
              <Button busy={busy === 'address'} onClick={addAddress} testId="address-save">{t('save')}</Button>
              <Button kind="ghost" onClick={() => { setAdding(null); setAddTried(false); }}>{t('cancel')}</Button>
            </div>
          </div>
        ) : me.addresses.length < MAX_ADDRESSES ? (
          <div style={{ marginTop: 12 }}>
            <Button kind="secondary" onClick={() => setAdding({ ...EMPTY_ADDRESS, name: me.name, phone: me.phone })} testId="address-add">
              + {t('accAddAddress')}
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
