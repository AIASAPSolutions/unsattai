const SYMBOLS: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };

/** "₹1,234.50", with whole amounts shown without paise. Grouping is Indian for INR (1,23,456). */
export function formatMoney(amount: number, currency: string): string {
  const sign = amount < 0 ? '−' : '';
  const abs = Math.abs(Math.round(amount * 100) / 100);
  const [whole, frac] = abs.toFixed(2).split('.');
  let grouped: string;
  if (currency === 'INR' && whole.length > 3) {
    const head = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${head},${whole.slice(-3)}`;
  } else {
    grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  const body = frac === '00' ? grouped : `${grouped}.${frac}`;
  const sym = SYMBOLS[currency];
  return sym ? `${sign}${sym}${body}` : `${sign}${currency} ${body}`;
}

/** "2026-10-05" -> "Mon, 5 Oct" in the device's locale; unknown input is returned as is. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {
    return iso.slice(0, 10);
  }
}

export function percent(rate: number): string {
  return `${Math.round(rate * 1000) / 10}`;
}
