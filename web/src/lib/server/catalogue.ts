import 'server-only';
import type { Catalogue } from '../api/types';
import { serverApi } from './api';

export async function loadCatalogue(): Promise<Catalogue | null> {
  try {
    return await serverApi<Catalogue>('shop/catalogue', { revalidate: 300 });
  } catch {
    return null;
  }
}
