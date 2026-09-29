import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading, ToastProvider } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import { RefDataProvider } from './lib/refdata';
import { LoginPage } from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Orders = lazy(() => import('./pages/orders/OrdersList'));
const OrderDetail = lazy(() => import('./pages/orders/OrderDetail'));
const Production = lazy(() => import('./pages/production/Production'));
const Delivery = lazy(() => import('./pages/delivery/Delivery'));
const Customers = lazy(() => import('./pages/crm/Customers'));
const CustomerDetail = lazy(() => import('./pages/crm/CustomerDetail'));
const Organisations = lazy(() => import('./pages/crm/Organisations'));
const OrganisationDetail = lazy(() => import('./pages/crm/OrganisationDetail'));
const Leads = lazy(() => import('./pages/crm/Leads'));
const LeadDetail = lazy(() => import('./pages/crm/LeadDetail'));
const Quotes = lazy(() => import('./pages/crm/Quotes'));
const QuoteEditor = lazy(() => import('./pages/crm/QuoteEditor'));
const Tickets = lazy(() => import('./pages/crm/Tickets'));
const Tasks = lazy(() => import('./pages/crm/Tasks'));
const Reorders = lazy(() => import('./pages/crm/Reorders'));
const Settings = lazy(() => import('./pages/settings/Settings'));
const StaffPage = lazy(() => import('./pages/Staff'));
const Reports = lazy(() => import('./pages/reports/Reports'));
const Account = lazy(() => import('./pages/Account'));
const SellersList = lazy(() => import('./pages/sellers/SellersList'));
const SellerEditor = lazy(() => import('./pages/sellers/SellerEditor'));
const Products = lazy(() => import('./pages/products/Products'));
const ProductDetail = lazy(() => import('./pages/products/ProductDetail'));
const Returns = lazy(() => import('./pages/marketplace/Returns'));
const Reviews = lazy(() => import('./pages/marketplace/Reviews'));
const Messages = lazy(() => import('./pages/marketplace/Messages'));
const Cod = lazy(() => import('./pages/marketplace/Cod'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, ready, signedOut } = useAuth();
  const loc = useLocation();
  if (!ready) return <Loading text="Starting…" />;
  if (!me) return <Navigate to="/login" replace state={signedOut ? null : { from: loc.pathname + loc.search }} />;
  return <RefDataProvider>{children}</RefDataProvider>;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<RequireAuth><Layout /></RequireAuth>}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<S><Dashboard /></S>} />
              <Route path="/orders" element={<S><Orders /></S>} />
              <Route path="/orders/:id" element={<S><OrderDetail /></S>} />
              <Route path="/production/*" element={<S><Production /></S>} />
              <Route path="/delivery/*" element={<S><Delivery /></S>} />
              <Route path="/sellers" element={<S><SellersList /></S>} />
              <Route path="/sellers/:id" element={<S><SellerEditor /></S>} />
              <Route path="/products" element={<S><Products /></S>} />
              <Route path="/products/:id" element={<S><ProductDetail /></S>} />
              <Route path="/returns" element={<S><Returns /></S>} />
              <Route path="/returns/:id" element={<S><Returns /></S>} />
              <Route path="/reviews" element={<S><Reviews /></S>} />
              <Route path="/messages" element={<S><Messages /></S>} />
              <Route path="/cod" element={<S><Cod /></S>} />
              <Route path="/crm" element={<Navigate to="/crm/customers" replace />} />
              <Route path="/crm/customers" element={<S><Customers /></S>} />
              <Route path="/crm/customers/:id" element={<S><CustomerDetail /></S>} />
              <Route path="/crm/organisations" element={<S><Organisations /></S>} />
              <Route path="/crm/organisations/:id" element={<S><OrganisationDetail /></S>} />
              <Route path="/crm/leads" element={<S><Leads /></S>} />
              <Route path="/crm/leads/:id" element={<S><LeadDetail /></S>} />
              <Route path="/crm/quotes" element={<S><Quotes /></S>} />
              <Route path="/crm/quotes/new" element={<S><QuoteEditor /></S>} />
              <Route path="/crm/quotes/:id" element={<S><QuoteEditor /></S>} />
              <Route path="/crm/tickets" element={<S><Tickets /></S>} />
              <Route path="/crm/tickets/:id" element={<S><Tickets /></S>} />
              <Route path="/crm/tasks" element={<S><Tasks /></S>} />
              <Route path="/crm/reorders" element={<S><Reorders /></S>} />
              <Route path="/settings/*" element={<S><Settings /></S>} />
              <Route path="/staff" element={<S><StaffPage /></S>} />
              <Route path="/reports/*" element={<S><Reports /></S>} />
              <Route path="/account" element={<S><Account /></S>} />
              <Route path="*" element={<div className="empty"><strong>Page not found</strong></div>} />
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

function S({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}
