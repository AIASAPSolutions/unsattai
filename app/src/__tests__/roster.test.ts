import { parseRoster, parseRosterLine, totalPieces } from '../lib/roster';

describe('roster parsing', () => {
  it('reads name, number, size and quantity in common shapes', () => {
    expect(parseRosterLine('Arul, 7, M, 2')).toEqual({ player_name: 'Arul', number: '7', fit: 'men', size: 'M', quantity: 2 });
    expect(parseRosterLine('Priya Sharma - 10 - XL')).toEqual({ player_name: 'Priya Sharma', number: '10', fit: 'men', size: 'XL', quantity: 1 });
    expect(parseRosterLine('7 Arul L x3')).toEqual({ player_name: 'Arul', number: '7', fit: 'men', size: 'L', quantity: 3 });
    expect(parseRosterLine('Kavya\t23\t2XL')).toMatchObject({ player_name: 'Kavya', number: '23', size: 'XXL' });
  });

  it('keeps names in any script exactly as typed', () => {
    expect(parseRosterLine('அருள், 9, S')).toMatchObject({ player_name: 'அருள்', number: '9', size: 'S' });
    expect(parseRosterLine('राहुल, 12, M')).toMatchObject({ player_name: 'राहुल' });
  });

  it('uses the default size and reports lines it cannot read', () => {
    const r = parseRoster('Name, No, Size\nArul, 7\nVeryLongPlayerNameOver16, 5, M\nRavi, 1234, M\nSita, 4, M, 900', 'L');
    expect(r.rows).toEqual([{ player_name: 'Arul', number: '7', fit: 'men', size: 'L', quantity: 1 }]);
    expect(r.errors.map((e) => e.issue)).toEqual(['nameTooLong', 'number', 'quantity']);
    expect(r.errors[0].line).toBe(3);
  });

  it('reports a missing size when there is no default', () => {
    expect(parseRosterLine('Arul, 7')).toBe('size');
  });

  it('reads fits: kids sizes are kids, a fit word picks the chart, and the size must be in it', () => {
    expect(parseRosterLine('Kavin, 4, 8Y')).toEqual({ player_name: 'Kavin', number: '4', fit: 'kids', size: '8Y', quantity: 1 });
    expect(parseRosterLine('Meena 12 10 yrs x2')).toMatchObject({ fit: 'kids', size: '10Y', quantity: 2 });
    expect(parseRosterLine('Priya, 10, women, S')).toMatchObject({ player_name: 'Priya', fit: 'women', size: 'S' });
    expect(parseRosterLine('Big Ravi, 99, 3XL')).toMatchObject({ fit: 'men', size: '3XL' });
    expect(parseRosterLine('Asha, 3, women, 3XL')).toBe('size');          // women stop at XXL
    expect(parseRosterLine('Tiny, 1, kids, M')).toBe('size');
    // The default fit (the last row's) is used when it has the size; otherwise men's.
    expect(parseRosterLine('Latha, 8, M', undefined, 'women')).toMatchObject({ fit: 'women', size: 'M' });
    expect(parseRosterLine('Latha, 8, M', undefined, 'kids')).toMatchObject({ fit: 'men', size: 'M' });
    expect(parseRosterLine('Kid Two, 5', '6Y', 'kids')).toMatchObject({ fit: 'kids', size: '6Y' });
  });

  it('totals pieces', () => {
    expect(totalPieces([{ quantity: 2 }, { quantity: 3 }])).toBe(5);
  });
});
