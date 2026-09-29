import type { MetadataRoute } from 'next';

const site = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/shop', '/design', '/design/picture', '/teams', '/enquiry', '/track'].map((p) => ({
    url: `${site}${p}`, changeFrequency: 'weekly', priority: p === '/' ? 1 : 0.6,
  }));
}
