import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { OrderStatus } from '../../components/domain';
import { SellerFilter, SellerLink, useSellerParam } from '../../components/marketplace';
import { Alert, Badge, Button, ButtonTabs, Card, DataTable, ErrorBox, Field, Kpi, Modal, PageHeader, Pager, useToast } from '../../components/ui';
import { get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, day, money, money0, num } from '../../lib/format';
import { useAction, useLoad } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import type { OrderSummary, Page } from '../../lib/types';

type View = 'open' | 'collected' | 'all';

export default function Cod() {
  const nav = useNavigate();
  const { can, isSeller } = useAuth();
  const { currency } = useRefData();
  const [seller, setSeller] = useSellerParam();
  const [view, setView] = useState<View>('open');
  const [page, setPage] = useState(1);
  const [marking, setMarking] = useState<OrderSummary | null>(null);
  const d = useLoad(() => get<Page<OrderSummary> & { outstanding: number }>('/ops/cod', {
    collected: view === 'all' ? undefined : view === 'collected', seller_id: seller || undefined, page,
  }), [view, seller, page]);
  const canCollect = can('delivery');

  return (
    <>
      <PageHeader title="Cash on delivery" subtitle="COD orders go straight to production. The cash is marked collected when the shipment is delivered, or by hand here when a courier or rider hands it over." />
      <div className="kpis" style={{ marginBottom: 16 }}>
        <Kpi k="To collect" v={d.data ? money0(d.data.outstanding, currency) : '…'} s={view === 'open' && d.data ? `${num(d.data.total)} order${d.data.total === 1 ? '' : 's'}` : 'Not yet collected'} alert={!!d.data?.outstanding} testId="kpi-cod-outstanding" />
      </div>
      <Card flush>
        <div className="card-body row">
          <ButtonTabs value={view} onChange={(v) => { setView(v); setPage(1); }} options={[{ value: 'open', label: 'To collect' }, { value: 'collected', label: 'Collected' }, { value: 'all', label: 'All' }]} />
          <span style={{ flex: 1 }} />
          <SellerFilter value={seller} onChange={setSeller} />
        </div>
        {!canCollect && <div className="card-body" style={{ paddingTop: 0 }}><Alert>Your role can see COD orders. Marking cash collected needs the delivery permission.</Alert></div>}
        {d.error ? <div className="card-body"><ErrorBox error={d.error} onRetry={d.reload} /></div> : (
          <DataTable testId="cod-table" rows={d.data?.items ?? []} rowKey={(o) => o.id} onRowClick={(o) => nav(`/orders/${o.id}`)}
            empty={d.loading ? 'Loading…' : view === 'open' ? 'Nothing to collect.' : 'No cash on delivery orders.'}
            columns={[
              { key: 'n', header: 'Order', sort: (o) => o.number, render: (o) => <Link to={`/orders/${o.id}`} className="strong">{o.number}</Link> },
              { key: 'c', header: 'Customer', sort: (o) => o.customer_name, render: (o) => <div>{o.customer_name}<div className="muted small">{o.phone}</div></div> },
              ...(isSeller ? [] : [{ key: 'sel', header: 'Seller', render: (o: OrderSummary) => <SellerLink id={o.seller_id} name={o.seller_name} /> }]),
              { key: 's', header: 'Status', sort: (o) => o.fulfilment_status, render: (o) => <OrderStatus o={o} /> },
              { key: 'prom', header: 'Promised', sort: (o) => o.promised_delivery_date, render: (o) => day(o.promised_delivery_date) },
              { key: 't', header: 'Amount', num: true, sort: (o) => o.total, render: (o) => money(o.total, o.currency) },
              { key: 'cash', header: 'Cash', render: (o) => (o.cod_collected ? <Badge tone="good" dot>Collected</Badge> : <Badge tone="warn" dot>To collect</Badge>) },
              { key: 'x', header: '', render: (o) => !o.cod_collected && canCollect && (
                <Button size="xs" variant="primary" onClick={() => setMarking(o)} data-testid="cod-mark">Mark collected</Button>) },
            ]} />
        )}
        {d.data && d.data.pages > 1 && <Pager page={d.data.page} pages={d.data.pages} total={d.data.total} onPage={setPage} noun="orders" />}
      </Card>
      {marking && <CollectDialog order={marking} onClose={() => setMarking(null)} onDone={async () => { setMarking(null); await d.reload(); }} />}
    </>
  );
}

export function CollectDialog({ order, onClose, onDone }: { order: Pick<OrderSummary, 'id' | 'number' | 'total' | 'currency'>; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reference, setReference] = useState('');
  const { busy, run } = useAction();
  return (
    <Modal open title={`Cash collected for ${order.number}`} onClose={onClose} testId="cod-dialog"
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" busy={!!busy} data-testid="cod-submit"
        onClick={() => run('c', async () => { await post(`/ops/orders/${order.id}/cod-collected`, { reference: reference.trim() }); toast.success(`${order.number}: cash collected.`); onDone(); }, toast.error)}>Mark collected</Button></>}>
      <p style={{ marginTop: 0 }}>Amount due: <b>{money(order.total, order.currency)}</b>. Delivered COD shipments are marked automatically; use this when the cash reached you another way.</p>
      <Field label="Receipt or reference (optional)" hint={`Recorded ${dateTime(new Date().toISOString())} with your name.`}>
        <input value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} data-testid="cod-reference" />
      </Field>
    </Modal>
  );
}
