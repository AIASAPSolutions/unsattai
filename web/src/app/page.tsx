import type { Metadata } from 'next';
import { ProductStrip } from '@/components/market/ProductStrip';
import { EnquiryForm } from '@/components/shop/EnquiryForm';
import { GarmentArt } from '@/components/shop/GarmentArt';
import { Banner, Button, Card } from '@/components/ui';
import { serverT } from '@/i18n/server';
import { GARMENTS, type ProductList } from '@/lib/api/types';
import { formatMoney, formatPercent, fromPrice } from '@/lib/price';
import { serverApi } from '@/lib/server/api';
import { loadCatalogue } from '@/lib/server/catalogue';
import s from './home.module.css';

export const metadata: Metadata = {
  title: { absolute: 'Unsattai · Design custom jerseys and team kits' },
  description: 'Describe your kit in your own words, pick from four designs, edit it in the studio and order for one player or a whole team. Live prices, quantity discounts and delivery dates.',
  alternates: { canonical: '/' },
};

export default async function Home() {
  const { t, lang } = await serverT();
  const cat = await loadCatalogue();
  const shop = await serverApi<ProductList>('shop/products?sort=popular&size=8', { revalidate: 120 }).catch(() => null);
  const maxTier = cat ? Math.max(...cat.quantity_tiers.map((x) => x.discount)) : 0;
  const colours: [string, string][] = [['#13225a', '#f2a900'], ['#0f766e', '#f8fafc'], ['#9f1239', '#fde047']];

  return (
    <>
      <section className={s.hero} aria-labelledby="hero-title">
        <div className={`container ${s.heroGrid}`}>
          <div>
            <h1 id="hero-title">{t('heroTitle')}</h1>
            <p>{t('heroText')}</p>
            <div className="row" style={{ marginTop: 24 }}>
              <Button kind="accent" size="lg" href="/design" testId="hero-start">{t('heroCta')}</Button>
              <Button kind="secondary" size="lg" href="/design/picture">{t('heroCtaPicture')}</Button>
            </div>
            <p className={s.heroNote}>{t('heroNote')}</p>
          </div>
          <div className={s.heroArt} aria-hidden>
            <div><GarmentArt garment="jersey" label="" /></div>
            <div><GarmentArt garment="vneck" primary="#0f766e" secondary="#f8fafc" label="" /></div>
            <div><GarmentArt garment="shorts" primary="#9f1239" secondary="#fde047" label="" /></div>
          </div>
        </div>
      </section>

      <section className={s.section} aria-labelledby="how-title">
        <div className="container">
          <div className={s.sectionHead}><h2 id="how-title">{t('howTitle')}</h2></div>
          <ol className={s.steps}>
            <li className={s.step}><h3>{t('howDescribe')}</h3><p>{t('howDescribeText')}</p></li>
            <li className={s.step}><h3>{t('howPick')}</h3><p>{t('howPickText')}</p></li>
            <li className={s.step}><h3>{t('howEdit')}</h3><p>{t('howEditText')}</p></li>
            <li className={s.step}><h3>{t('howOrder')}</h3><p>{t('howOrderText')}</p></li>
          </ol>
        </div>
      </section>

      {shop?.items.length ? (
        <section className={s.section} aria-labelledby="shop-title">
          <div className="container">
            <div className={s.sectionHead}>
              <h2 id="shop-title">{t('homeShopTitle')}</h2>
              <p className="muted">{t('homeShopText')}</p>
            </div>
            <ProductStrip products={shop.items} testId="home-products" />
            <div style={{ marginTop: 20 }}><Button kind="secondary" href="/shop" testId="home-shop-all">{t('homeShopCta')}</Button></div>
          </div>
        </section>
      ) : null}

      <section className={s.section} aria-labelledby="garments-title">
        <div className="container">
          <div className={s.sectionHead}><h2 id="garments-title">{t('garmentsTitle')}</h2></div>
          {!cat ? <Banner tone="info">{t('pricesUnavailable')}</Banner> : null}
          <div className={s.garments}>
            {GARMENTS.map((g, i) => {
              const price = cat ? fromPrice(cat.garments[g].base, cat.fabrics, g) : null;
              const fabrics = cat ? cat.fabrics.filter((f) => f.garments.includes(g)).length : 0;
              return (
                <article key={g} className={s.garment} data-testid={`garment-card-${g}`}>
                  <div className={s.garmentArt}>
                    <GarmentArt garment={g} primary={colours[i][0]} secondary={colours[i][1]} label={t(`garment_${g}`)} />
                  </div>
                  <h3>{t(`garment_${g}`)}</h3>
                  {price !== null ? (
                    <div>
                      <span className={s.price} data-testid={`from-price-${g}`}>{t('fromPrice', { price: formatMoney(price, cat!.currency, lang) })}</span>{' '}
                      <span className="muted small">{t('perPieceShort')} · {t('fabricsAvailable', { n: fabrics })}</span>
                    </div>
                  ) : null}
                  <div style={{ marginTop: 'auto' }}>
                    <Button kind="secondary" href={`/design?garment=${g}`}>{t('designThis')}</Button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className={s.section} aria-labelledby="team-title">
        <div className={`container ${s.team}`}>
          <div className={s.teamCard}>
            <h2 id="team-title">{t('teamTitle')}</h2>
            <p>{t('teamText')}</p>
            <ul className={s.ticks}>
              <li>{t('teamPoint1')}</li>
              <li>{t('teamPoint2')}</li>
              {maxTier ? <li>{t('teamPoint3', { pct: formatPercent(maxTier, lang) })}</li> : null}
            </ul>
            <Button href="/teams">{t('teamCta')}</Button>
          </div>
          {cat ? (
            <Card title={t('tiersTitle')}>
              <table className={s.tiers}>
                <tbody>
                  {cat.quantity_tiers.filter((x) => x.discount > 0).map((x) => (
                    <tr key={x.min}><td>{t('tierFrom', { n: x.min })}</td><td>−{formatPercent(x.discount, lang)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}
        </div>
      </section>

      <section className={s.section} aria-labelledby="bulk-title" id="bulk">
        <div className={`container ${s.bulk}`}>
          <div>
            <h2 id="bulk-title">{t('bulkTitle')}</h2>
            <p className="muted">{t('bulkText')}</p>
            {cat?.company.phone ? <p><a href={`tel:${cat.company.phone}`}>{cat.company.phone}</a></p> : null}
          </div>
          <Card><EnquiryForm testId="landing-enquiry" /></Card>
        </div>
      </section>
    </>
  );
}
