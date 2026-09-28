import type { Garment } from '@/lib/api/types';

// Simple brand illustrations for marketing sections (our own static SVG, not user content).
export function GarmentArt({ garment, primary = '#13225a', secondary = '#f2a900', label }: {
  garment: Garment; primary?: string; secondary?: string; label: string;
}) {
  if (garment === 'shorts') {
    return (
      <svg viewBox="0 0 200 160" role="img" aria-label={label}>
        <path d="M40 20h120l14 118h-58l-16-62-16 62H26z" fill={primary} />
        <path d="M40 20h120v14H40z" fill={secondary} />
        <path d="M150 34l18 104h-12L140 40z" fill={secondary} opacity=".85" />
        <path d="M50 34 32 138h12l16-98z" fill={secondary} opacity=".85" />
      </svg>
    );
  }
  const neck = garment === 'vneck' ? 'M82 18 100 46 118 18' : 'M82 18q18 16 36 0';
  return (
    <svg viewBox="0 0 200 200" role="img" aria-label={label}>
      <path d="M62 16 82 10q18 14 36 0l20 6 46 30-18 36-24-12v118H58V70L34 82 16 46z" fill={primary} />
      <path d="M58 110 142 62v26L58 136z" fill={secondary} opacity=".9" />
      <path d="M58 146 142 98v12L58 158z" fill={secondary} opacity=".55" />
      <path d={neck} fill="none" stroke={secondary} strokeWidth="6" strokeLinecap="round" />
      <text x="100" y="178" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="30" fill="#fff">10</text>
    </svg>
  );
}
