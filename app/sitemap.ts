import type { MetadataRoute } from 'next';
import { LEGAL_UPDATED, siteUrl } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const legalUpdated = new Date(LEGAL_UPDATED);
  return [
    { url: base, changeFrequency: 'monthly', priority: 1 },
    { url: `${base}/privacy`, lastModified: legalUpdated, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${base}/terms`, lastModified: legalUpdated, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${base}/support`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${base}/delete-account`, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
