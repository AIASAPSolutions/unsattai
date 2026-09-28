import { describe, expect, it } from 'vitest';
import { buildUrl, escapeHtml, printShell } from '../src/lib/api';
import { quoteLink } from '../src/lib/env';
import { actorName, addDays, day, label, money } from '../src/lib/format';
import { fillDays } from '../src/pages/reports/Reports';

describe('format', () => {
  it('money never shows negative zero', () => {
    expect(money(-0.001, 'INR')).toBe(money(0, 'INR'));
    expect(money(1234.5, 'INR')).toContain('1,234.50');
    expect(money(null)).toBe('—');
  });
  it('dates are calendar days without time-zone drift', () => {
    expect(day('2026-10-04')).toBe('Sun 4 Oct');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('labels codes and names actors', () => {
    expect(label('in_production')).toBe('In production');
    const staff = [{ id: 'stf_1', name: 'Meena', email: 'm@x' }];
    expect(actorName('staff:stf_1', staff)).toBe('Meena');
    expect(actorName('customer:cus_1')).toBe('Customer');
    expect(actorName('system')).toBe('System');
  });
});

describe('urls', () => {
  it('builds API urls and skips empty query values', () => {
    expect(buildUrl('/ops/orders', { status: 'ready,queued', q: '', page: 2, x: undefined }, 'http://h'))
      .toBe('http://h/api/v1/ops/orders?status=ready%2Cqueued&page=2');
  });
  it('builds quote links from the web store base', () => {
    expect(quoteLink('/quote/abc', 'https://shop.example/')).toBe('https://shop.example/quote/abc');
    expect(quoteLink('quote/abc', 'https://shop.example')).toBe('https://shop.example/quote/abc');
  });
  it('escapes server HTML into a sandboxed frame', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    const shell = printShell('Invoice <1>', '<script>alert(1)</script>');
    expect(shell).toContain('sandbox="allow-same-origin allow-modals"');
    expect(shell).not.toContain('<script>alert');
    expect(shell).toContain('Invoice &lt;1&gt;');
  });
});

describe('reports', () => {
  it('fills missing days with zeros', () => {
    const out = fillDays([{ date: '2026-09-02', orders: 1, revenue: 10, pieces: 3 }], '2026-09-01', '2026-09-03');
    expect(out.map((d) => d.orders)).toEqual([0, 1, 0]);
  });
});
