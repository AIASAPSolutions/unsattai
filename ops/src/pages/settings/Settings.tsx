import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Loading, PageHeader, Tabs } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { CompanyEditor, CrmEditor, DeliveryEditor, ProductionEditor } from './OtherEditors';

const PriceBookEditor = lazy(() => import('./PriceBookEditor'));
const SizeChartsEditor = lazy(() => import('./SizeChartsEditor'));

export default function Settings() {
  const { canEdit } = useAuth();
  const lock = (s: Parameters<typeof canEdit>[0]) => (canEdit(s) ? '' : ' (view)');
  return (
    <>
      <PageHeader title="Settings" subtitle="Versioned business configuration. Every save is validated by the server and kept in history." />
      <Tabs tabs={[
        { to: '/settings/price-book', label: `Price book${lock('price_book')}` },
        { to: '/settings/production', label: `Production${lock('production')}` },
        { to: '/settings/sizing', label: `Size charts${lock('sizing')}` },
        { to: '/settings/delivery', label: `Delivery${lock('delivery')}` },
        { to: '/settings/company', label: `Company${lock('company')}` },
        { to: '/settings/crm', label: `CRM lists${lock('crm')}` },
      ]} />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<Navigate to="price-book" replace />} />
          <Route path="price-book" element={<PriceBookEditor />} />
          <Route path="production" element={<ProductionEditor />} />
          <Route path="sizing" element={<SizeChartsEditor />} />
          <Route path="delivery" element={<DeliveryEditor />} />
          <Route path="company" element={<CompanyEditor />} />
          <Route path="crm" element={<CrmEditor />} />
        </Routes>
      </Suspense>
    </>
  );
}
