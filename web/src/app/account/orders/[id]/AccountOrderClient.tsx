'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { OrderDetail } from '@/components/shop/OrderDetail';
import { useOrder } from '@/components/shop/orderBits';
import { Banner, Button, ErrorState, Loading } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { Reorder } from '@/lib/api/types';
import { EMPTY_ADDRESS, flow, flowStore, rowKey } from '@/lib/flow';
import { whenHydrated } from '@/lib/store';

/** Put a previous order back into the studio and checkout, ready to change and pay again. */
export async function applyReorder(r: Reorder) {
  await whenHydrated(flowStore);
  flow.openSpec(r.spec, r.design_id, 'reorder');
  const ty = r.spec.typography;
  const single = r.items.length === 1 && r.items[0].player_name === ty.player_name && r.items[0].number === ty.number;
  const cur = flowStore.get().checkout;
  flow.setCheckout({
    mode: single ? 'single' : 'team',
    single: single ? { size: r.items[0].size, quantity: r.items[0].quantity } : cur.single,
    rows: single ? [] : r.items.map((it) => ({ ...it, key: rowKey() })),
    fabric: r.fabric || cur.fabric,
    method: r.delivery.method ?? cur.method,
    address: r.delivery.address ? { ...EMPTY_ADDRESS, ...r.delivery.address } : cur.address,
    rush: false, coupon: '',
  });
}

export function AccountOrderClient({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { order, error, loading, retry } = useOrder(id, api.myOrder);
  const [busy, setBusy] = useState(false);
  const [reErr, setReErr] = useState<string | null>(null);

  if (loading) return <Loading label={t('loading')} />;
  if (error || !order) return <ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={retry} />;

  const again = async () => {
    setBusy(true);
    setReErr(null);
    try {
      await applyReorder(await api.reorder(order.id));
      router.push('/checkout');
    } catch (e) {
      setReErr(errorMessage(t, e));
      setBusy(false);
    }
  };

  return (
    <div className="stack" data-testid="account-order">
      <div><Button kind="ghost" size="sm" href="/account">← {t('accOrders')}</Button></div>
      {reErr ? <Banner tone="fail">{reErr}</Banner> : null}
      {!order.payment && order.fulfilment?.status !== 'cancelled' ? (
        <Banner tone="warn" action={t('payment')} onAction={() => router.push(`/order/${encodeURIComponent(order.id)}/pay`)}>
          {t('fstatus_awaiting_payment')}
        </Banner>
      ) : null}
      <OrderDetail order={order} extraActions={(
        <>
          <Button kind="primary" busy={busy} onClick={again} testId="order-again">{t('orderAgain')}</Button>
          <Button kind="ghost" href={`/account/support?order=${encodeURIComponent(order.id)}`} testId="order-help">{t('orderHelp')}</Button>
        </>
      )} />
    </div>
  );
}
