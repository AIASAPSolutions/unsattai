'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/components/providers/session';
import { Badge, Button, Popover, Spinner, cx } from '@/components/ui';
import { BellIcon, CartIcon, SearchIcon } from '@/components/ui/icons';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { NotificationPage } from '@/lib/api/types';
import { cartPieces } from '@/lib/cart';
import { formatDateTime } from '@/lib/price';
import { useCart } from '@/lib/shopStore';
import s from './market.module.css';

export function CartLink() {
  const { t } = useI18n();
  const { items, ready } = useCart();
  const n = ready ? items.length : 0;
  return (
    <Link href="/cart" className={s.iconBtn} data-testid="nav-cart" aria-label={t('cartWithCount', { n })}>
      <CartIcon size={22} />
      <Badge n={n} testId="cart-count" />
      <span className={s.iconLabel}>{t('cartTitle')}</span>
      <span className="visually-hidden">{cartPieces(items)}</span>
    </Link>
  );
}

/** Search box: goes to /shop?q=… (keeps the other filters when already on the shop). */
export function SearchBox() {
  const { t } = useI18n();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const onShop = path === '/shop';
  const q = onShop ? params.get('q') ?? '' : '';
  return (
    // Keyed by the query so the box shows the current search after navigating.
    <SearchForm key={q} initial={q} onSearch={(v) => {
      const next = new URLSearchParams(onShop ? params.toString() : '');
      if (v) next.set('q', v);
      else next.delete('q');
      next.delete('page');
      router.push(`/shop${next.toString() ? `?${next}` : ''}`);
    }} label={t('searchLabel')} placeholder={t('searchPlaceholder')} />
  );
}

function SearchForm({ initial, onSearch, label, placeholder }: { initial: string; onSearch: (q: string) => void; label: string; placeholder: string }) {
  const [value, setValue] = useState(initial);
  return (
    <form role="search" className={s.search} onSubmit={(e) => { e.preventDefault(); onSearch(value.trim().slice(0, 100)); }}>
      <label htmlFor="site-search" className="visually-hidden">{label}</label>
      <input id="site-search" type="search" value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder}
        maxLength={100} data-testid="search-input" enterKeyHint="search" />
      <button type="submit" aria-label={label} data-testid="search-submit"><SearchIcon size={18} /></button>
    </form>
  );
}

/** Bell with the unread count; the popover lists the latest notifications. */
export function NotificationBell() {
  const { t, lang } = useI18n();
  const { me } = useSession();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationPage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const signedIn = !!me;

  const load = useCallback(() => {
    api.notifications(1).then((d) => { setData(d); setError(null); }).catch(setError);
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    const run = () => api.notifications(1).then((d) => live && setData(d)).catch(() => undefined);
    void run();
    const id = setInterval(run, 60_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [signedIn, path]);

  if (!signedIn) return null;
  const unread = data?.unread ?? 0;

  const markAll = async () => {
    try {
      const r = await api.markRead({ all: true });
      setData((d) => (d ? { ...d, unread: r.unread, items: d.items.map((x) => ({ ...x, read: true })) } : d));
    } catch (e) {
      setError(e);
    }
  };
  const openOne = async (id: string, orderId: string | null) => {
    setOpen(false);
    setData((d) => (d ? { ...d, unread: Math.max(0, d.unread - (d.items.find((x) => x.id === id && !x.read) ? 1 : 0)),
      items: d.items.map((x) => (x.id === id ? { ...x, read: true } : x)) } : d));
    void api.markRead({ ids: [id] }).catch(() => undefined);
    if (orderId) router.push(`/account/orders/${encodeURIComponent(orderId)}`);
  };

  return (
    <div className={s.popWrap}>
      <button ref={trigger} type="button" className={s.iconBtn} aria-expanded={open} aria-haspopup="dialog"
        aria-label={t('notificationsWithCount', { n: unread })} data-testid="nav-bell"
        onClick={() => { setOpen((o) => !o); if (!open) load(); }}>
        <BellIcon size={22} />
        <Badge n={unread} testId="bell-count" />
      </button>
      <Popover open={open} onClose={close} label={t('notificationsTitle')} testId="bell-popover" align="end" triggerRef={trigger} wide>
        <div className={s.bellHead}>
          <strong>{t('notificationsTitle')}</strong>
          {unread ? <Button kind="ghost" size="sm" onClick={markAll} testId="bell-read-all">{t('markAllRead')}</Button> : null}
        </div>
        {error ? <p className="small" role="alert">{errorMessage(t, error)}</p> : !data ? <Spinner /> : data.items.length === 0 ? (
          <p className="small muted" data-testid="bell-empty">{t('notificationsEmpty')}</p>
        ) : (
          <ul className={s.bellList} data-testid="bell-list">
            {data.items.slice(0, 8).map((n) => (
              <li key={n.id}>
                <button type="button" className={cx(s.bellItem, !n.read && s.unread)} onClick={() => void openOne(n.id, n.order_id)}>
                  <span className={s.bellTitle}>{n.title}</span>
                  <span className="small muted">{n.body}</span>
                  <time className="small muted" dateTime={n.created_at}>{formatDateTime(n.created_at, lang)}</time>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ marginTop: 8 }}>
          <Link href="/account/notifications" onClick={close} className="small" data-testid="bell-all">{t('notificationsAll')}</Link>
        </div>
      </Popover>
    </div>
  );
}
