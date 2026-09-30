'use client';

import Image from 'next/image';

/**
 * The mark for a connected service.
 *
 * Every entry names a file in public/brands, so swapping in an officially
 * licensed asset is a file drop rather than a code change. The files shipped
 * here are drawn from each brand's published geometry; where no file exists the
 * caller falls back to its own glyph.
 */
const BRAND_FILES: Record<string, string> = {
  google: '/brands/google.svg',
  instagram: '/brands/instagram.svg',
  threads: '/brands/threads.svg',
  groww: '/brands/groww.png',
  zerodha: '/brands/zerodha.svg',
};

export function BrandMark({ id, size = 20 }: { id: string; size?: number }) {
  const file = BRAND_FILES[id];
  if (!file) return null;
  return <Image src={file} alt="" width={size} height={size} unoptimized />;
}

export const hasBrandMark = (id: string) => Boolean(BRAND_FILES[id]);
