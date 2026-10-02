import type { Metadata } from 'next';
import { Hydrated } from '@/components/design/Hydrated';
import { PictureClient } from './PictureClient';

export const metadata: Metadata = {
  title: 'Design from a picture',
  description: 'Made a jersey picture in another AI tool? Upload it and Unsattai rebuilds it as a print-ready design you can edit and order.',
  alternates: { canonical: '/design/picture' },
};

export default function Page() {
  return <Hydrated><PictureClient /></Hydrated>;
}
