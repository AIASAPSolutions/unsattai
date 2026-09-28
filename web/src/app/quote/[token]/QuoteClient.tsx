'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AddressFields } from '@/components/shop/AddressFields';
import { PriceSummary } from '@/components/shop/PriceSummary';
import { Banner, Button, Card, Empty, ErrorState, Loading, Skeleton, StatusChip, SvgImg } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import type { Address, PublicQuote } from '@/lib/api/types';
import { EMPTY_ADDRESS } from '@/lib/flow';
import { validateAddress } from '@/lib/order';
import { formatDate } from '@/lib/price';
import { sizeBreakdown } from '@/lib/roster';
import s from '../../order/[id]/order.module.css';

/** A quote our sales team sent: prices are fixed by the quote, the customer only adds an address and accepts. */
export function QuoteClient({ token }: { token: string }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState<PublicQuote | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const [mock, setMock] = useState<string | null>(null);
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [acceptErr, setAcceptErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.publicQuote(token)
      .then((r) => {
        if (!live) return;
        setQ(r);
        setAddress({ ...EMPTY_ADDRESS, name: r.customer.name, phone: r.customer.phone, pincode: r.delivery.pincode, state: r.delivery.state });
        api.render(r.spec).then((p) => live && setMock(p.mockup_svg)).catch(() => undefined);
      })
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [token, nonce]);

  if (error) {
    const nf = error instanceof ApiError && error.kind === 'not_found';
    return (
      <div className="container page">
        {nf ? <Empty title={t('quoteNotFound')}><p>{t('quoteNotFoundText')}</p><Button href="/enquiry">{t('navBulk')}</Button></Empty>
          : <ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={() => { setError(null); setNonce((n) => n + 1); }} />}
      </div>
    );
  }
  if (!q) return <Loading label={t('loading')} />;

  const ship = q.delivery.method === 'ship';
  const canAccept = q.status === 'sent' && !q.expired;

  const accept = async () => {
    setTried(true);
    if (ship && validateAddress(address).length) return;
    setBusy(true);
    setAcceptErr(null);
    try {
      const res = await api.acceptQuote(token, ship ? { ...address, name: address.name.trim(), line1: address.line1.trim(), city: address.city.trim() } : null);
      router.push(`/order/${encodeURIComponent(res.order_id)}`);
    } catch (e) {
      setAcceptErr(errorMessage(t, e));
      setBusy(false);
    }
  };

  const status = q.expired ? 'expired' : q.status;

  return (
    <div className="container page" data-testid="screen-quote">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <p className="small muted" style={{ margin: 0 }}>{t('quoteFor', { name: q.customer.name, number: q.number })}</p>
          <h1 style={{ margin: '4px 0' }} data-testid="quote-title">{q.title}</h1>
          <p style={{ margin: 0 }} data-testid="quote-valid">
            {q.expired ? t('quoteExpiredOn', { date: formatDate(q.valid_until, lang, true) }) : t('quoteValidUntil', { date: formatDate(q.valid_until, lang, true) })}
          </p>
        </div>
        <StatusChip tone={status === 'sent' ? 'info' : status === 'converted' ? 'pass' : 'warn'} testId="quote-status">
          {t(`qstatus_${status}` as 'qstatus_sent')}
        </StatusChip>
      </div>
      {q.message ? <blockquote style={{ margin: '16px 0', padding: '10px 14px', borderLeft: '4px solid var(--accent)', background: 'var(--accent-soft)', whiteSpace: 'pre-wrap' }}>{q.message}</blockquote> : null}

      <div className={s.layout} style={{ marginTop: 16 }}>
        <div className="stack" style={{ gap: 20 }}>
          <Card>
            {mock ? <SvgImg svg={mock} alt={q.title} className={s.thumb} testId="quote-mockup" /> : <Skeleton height={260} />}
            <p style={{ marginBottom: 0 }}>
              {t(`garment_${q.spec.garment}` as 'garment_jersey')} · {q.pricing.fabric.name}
              {q.rush ? ` · ${t('expressChosen')}` : ''} · {t('piecesN', { n: q.pricing.pieces })}
            </p>
            <p className="small muted" style={{ margin: 0 }}>{sizeBreakdown(q.lines).map((b) => `${b.size} ${b.quantity}`).join(' · ')}</p>
          </Card>
          {canAccept ? (
            <Card title={ship ? t('quoteDeliverTo') : t('pickup')}>
              {ship ? <AddressFields value={address} onChange={setAddress} showErrors={tried} testId="quote-addr" />
                : <p style={{ margin: 0 }}>{t('quotePickup')}</p>}
            </Card>
          ) : null}
        </div>
        <Card title={t('priceTitle')}>
          <PriceSummary quote={q.pricing} showNudges={false} testId="quote-price" />
          {acceptErr ? <div style={{ marginTop: 12 }}><Banner tone="fail" live>{acceptErr}</Banner></div> : null}
          {canAccept ? (
            <div style={{ marginTop: 14 }}>
              <Button size="lg" block busy={busy} onClick={accept} testId="quote-accept">{t('quoteAccept')}</Button>
              <p className="small muted" style={{ textAlign: 'center' }}>{t('quoteAcceptHint')}</p>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <Banner tone={q.status === 'converted' ? 'pass' : 'warn'}>
                {q.status === 'converted' ? t('quoteAccepted') : q.expired ? t('quoteExpired') : t('quoteClosed')}
              </Banner>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
