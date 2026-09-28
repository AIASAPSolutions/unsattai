'use client';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { OrderDetail } from '@/components/shop/OrderDetail';
import { Banner, Button, Card, TextField } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useT } from '@/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import type { Order } from '@/lib/api/types';
import { checkPhone } from '@/lib/validation';

/** Guest tracking: order number plus the phone number used for the order. */
export function TrackClient() {
  const t = useT();
  const params = useSearchParams();
  const [orderId, setOrderId] = useState(params.get('order') ?? '');
  const [phone, setPhone] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);

  const idErr = tried && orderId.trim().length < 4 ? t('trackOrderInvalid') : null;
  const phoneErr = tried && checkPhone(phone) ? t('otpPhoneInvalid') : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (orderId.trim().length < 4 || checkPhone(phone)) return;
    setBusy(true);
    setError(null);
    setOrder(null);
    try {
      setOrder(await api.track(orderId.trim(), phone.trim()));
    } catch (err) {
      setError(err instanceof ApiError && err.kind === 'not_found' ? t('trackNotFound') : errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container page" style={{ maxWidth: 860 }} data-testid="screen-track">
      <h1>{t('trackTitle')}</h1>
      <p className="muted">{t('trackText')}</p>
      <Card>
        <form onSubmit={submit} noValidate className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}>
            <TextField label={t('orderIdField')} value={orderId} onValue={setOrderId} maxLength={60} error={idErr}
              hint={t('trackOrderHint')} testId="track-order" autoComplete="off" />
          </div>
          <div style={{ flex: '1 1 220px' }}>
            <TextField label={t('phone')} value={phone} onValue={setPhone} type="tel" autoComplete="tel" maxLength={24}
              error={phoneErr} hint={t('trackPhoneHint')} testId="track-phone" />
          </div>
          <div style={{ paddingTop: 28 }}><Button type="submit" busy={busy} testId="track-submit">{t('trackCta')}</Button></div>
        </form>
      </Card>
      {error ? <div style={{ marginTop: 16 }}><Banner tone="fail" live testId="track-error">{error}</Banner></div> : null}
      {order ? <div style={{ marginTop: 20 }}><OrderDetail order={order} /></div> : null}
    </div>
  );
}
