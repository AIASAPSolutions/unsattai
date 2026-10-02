import type { Metadata } from 'next';
import type { SizeGuide } from '@/lib/api/types';
import { serverApi } from '@/lib/server/api';
import { SizeGuideClient } from './SizeGuideClient';

export const metadata: Metadata = {
  title: 'Size guide',
  description: 'Men / unisex, Women and Kids size charts for Unsattai jerseys, V-necks and shorts: chest, length, shoulder, sleeve, waist and hip in cm, and how to measure.',
  alternates: { canonical: '/size-guide' },
};

async function load(): Promise<SizeGuide | null> {
  try {
    return await serverApi<SizeGuide>('shop/size-guide', { revalidate: 300 });
  } catch {
    return null;
  }
}

export default async function Page() {
  return <SizeGuideClient initial={await load()} />;
}
