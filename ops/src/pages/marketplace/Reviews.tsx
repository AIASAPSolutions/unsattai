import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SellerFilter, SellerLink, Stars, useSellerParam } from '../../components/marketplace';
import { Alert, Badge, Button, Card, Chips, DataTable, ErrorBox, Field, Modal, PageHeader, Pager, SearchInput, useToast } from '../../components/ui';
import { get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime } from '../../lib/format';
import { useAction, useDebounced, useLoad } from '../../lib/hooks';
import type { Page, Product, Review } from '../../lib/types';

export default function Reviews() {
  const toast = useToast();
  const { can } = useAuth();
  const [seller, setSeller] = useSellerParam();
  const [status, setStatus] = useState<string[]>([]);
  const [minRating, setMinRating] = useState(1);
  const [maxRating, setMaxRating] = useState(5);
  const [product, setProduct] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const products = useLoad(() => get<Page<Product>>('/ops/products').then((r) => r.items).catch(() => [] as Product[]), []);
  const d = useLoad(() => get<Page<Review>>('/ops/reviews', { status: status[0], product_id: product || undefined, seller_id: seller || undefined, q: dq || undefined, page,
    min_rating: minRating > 1 ? minRating : undefined, max_rating: maxRating < 5 ? maxRating : undefined }),
    [status.join(','), product, seller, dq, page, minRating, maxRating]);
  const [hiding, setHiding] = useState<Review | null>(null);
  const { busy, run } = useAction();
  const canModerate = can('crm');
  const productTitle = (id: string) => products.data?.find((p) => p.id === id)?.title;

  const rows = d.data?.items ?? [];
  // Keep the range valid: moving one end past the other moves both.
  const setRange = (lo: number, hi: number) => { setMinRating(Math.min(lo, hi)); setMaxRating(Math.max(lo, hi)); setPage(1); };
  const show = (r: Review) => run(r.id, async () => {
    await post(`/ops/reviews/${r.id}/moderate`, { hidden: false });
    toast.success('Review is visible again. The ratings were recounted.');
    await d.reload();
  }, toast.error);

  return (
    <>
      <PageHeader title="Reviews" subtitle="Verified-purchase reviews from delivered orders. Hidden reviews leave the product page and the seller and product ratings." />
      <Card flush>
        <div className="card-body stack">
          <div className="row">
            <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Words in the title or text, or the customer…" testId="reviews-search" />
            <select className="sm" style={{ width: 'auto', maxWidth: 240 }} value={product} onChange={(e) => { setProduct(e.target.value); setPage(1); }} aria-label="Product" data-testid="reviews-product">
              <option value="">All products</option>
              {(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
            <SellerFilter value={seller} onChange={(v) => { setSeller(v); setPage(1); }} />
          </div>
          <div className="row">
            <Chips value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: 'visible', label: 'Visible' }, { value: 'hidden', label: 'Hidden' }]} />
            <label className="row tight small" style={{ gap: 6 }}>
              Rating
              <select className="sm" style={{ width: 'auto' }} value={minRating} onChange={(e) => setRange(Number(e.target.value), Math.max(Number(e.target.value), maxRating))} aria-label="Lowest rating" data-testid="reviews-min-rating">
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}★</option>)}
              </select>
              to
              <select className="sm" style={{ width: 'auto' }} value={maxRating} onChange={(e) => setRange(Math.min(minRating, Number(e.target.value)), Number(e.target.value))} aria-label="Highest rating" data-testid="reviews-max-rating">
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}★</option>)}
              </select>
            </label>
            {(minRating > 1 || maxRating < 5) && <Button size="xs" onClick={() => setRange(1, 5)}>Any rating</Button>}
          </div>
          {!canModerate && <Alert>Your role can read reviews. Hiding them needs the CRM permission.</Alert>}
        </div>
        {d.error ? <div className="card-body"><ErrorBox error={d.error} onRetry={d.reload} /></div> : (
          <DataTable testId="reviews-table" rows={rows} rowKey={(r) => r.id}
            empty={d.loading ? 'Loading…' : 'No reviews match.'}
            columns={[
              { key: 'r', header: 'Rating', sort: (r) => r.rating, render: (r) => <Stars rating={r.rating} /> },
              { key: 't', header: 'Review', render: (r) => (
                <div style={{ maxWidth: 420 }}>
                  <b>{r.title || <span className="muted">No title</span>}</b>
                  {r.body && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{r.body}</div>}
                  {r.hidden && r.hidden_reason && <div className="small warn-text">Hidden: {r.hidden_reason}</div>}
                </div>) },
              { key: 'c', header: 'Customer', render: (r) => <div>{r.customer_name}{r.verified_purchase && <div className="muted small">Verified purchase</div>}</div> },
              { key: 'p', header: 'Product', render: (r) => (r.product_id ? <Link to={`/products/${r.product_id}`}>{productTitle(r.product_id) ?? r.product_id}</Link> : <span className="muted small">Own design</span>) },
              { key: 's', header: 'Seller', render: (r) => <SellerLink id={r.seller_id} name={r.seller_name} /> },
              { key: 'o', header: 'Order', render: (r) => <Link to={`/orders/${r.order_id}`}>Order</Link> },
              { key: 'at', header: 'Posted', sort: (r) => r.created_at, render: (r) => <span className="small nowrap">{dateTime(r.created_at)}</span> },
              { key: 'st', header: 'Status', sort: (r) => String(r.hidden), render: (r) => (r.hidden ? <Badge tone="bad" dot>Hidden</Badge> : <Badge tone="good" dot>Visible</Badge>) },
              { key: 'x', header: '', render: (r) => canModerate && (r.hidden
                ? <Button size="xs" busy={busy === r.id} onClick={() => show(r)} data-testid="review-show">Show</Button>
                : <Button size="xs" variant="danger" onClick={() => setHiding(r)} data-testid="review-hide">Hide</Button>) },
            ]} />
        )}
        {d.data && d.data.pages > 1 && <Pager page={d.data.page} pages={d.data.pages} total={d.data.total} onPage={setPage} noun="reviews" />}
      </Card>
      {hiding && <HideDialog review={hiding} onClose={() => setHiding(null)} onDone={async () => { setHiding(null); await d.reload(); }} />}
    </>
  );
}

function HideDialog({ review, onClose, onDone }: { review: Review; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  return (
    <Modal open title="Hide review" onClose={onClose} testId="review-hide-dialog"
      footer={<><Button onClick={onClose}>Close</Button><Button variant="danger-solid" busy={!!busy} data-testid="review-hide-submit"
        onClick={() => run('h', async () => { await post(`/ops/reviews/${review.id}/moderate`, { hidden: true, reason: reason.trim() }); toast.success('Review hidden. The ratings were recounted.'); onDone(); }, toast.error)}>Hide review</Button></>}>
      <div className="stack tight">
        <div><Stars rating={review.rating} /> <b>{review.title}</b></div>
        {review.body && <div className="muted small" style={{ whiteSpace: 'pre-wrap' }}>{review.body}</div>}
      </div>
      <Field label="Reason (internal)" hint="For example: abusive language, personal details, not about the product.">
        <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="review-hide-reason" />
      </Field>
    </Modal>
  );
}
