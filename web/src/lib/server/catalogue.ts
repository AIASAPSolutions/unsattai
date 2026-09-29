import 'server-only';
import type { Catalogue, Health } from '../api/types';
import { serverApi } from './api';

export async function loadCatalogue(): Promise<Catalogue | null> {
  try {
    return await serverApi<Catalogue>('shop/catalogue', { revalidate: 300 });
  } catch {
    return null;
  }
}

/** Whether demo payments are on (GET /health `demo_payments`); unknown counts as on, like the browser. */
export async function loadDemoPayments(): Promise<boolean> {
  try {
    return (await serverApi<Health>('health', { revalidate: 60 })).demo_payments !== false;
  } catch {
    return true;
  }
}
