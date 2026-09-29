import { describe, expect, it } from 'vitest';
import { csvRecords, duplicateNumbers, parseRoster, parseRosterCsv, parseRosterLine, sizeBreakdown, totalPieces } from './roster';

describe('parseRosterLine', () => {
  it('reads name, number, size, quantity in several shapes', () => {
    expect(parseRosterLine('Arul, 7, M, 2')).toEqual({ player_name: 'Arul', number: '7', fit: 'men', size: 'M', quantity: 2 });
    expect(parseRosterLine('Priya Sharma - 10 - XL')).toEqual({ player_name: 'Priya Sharma', number: '10', fit: 'men', size: 'XL', quantity: 1 });
    expect(parseRosterLine('7 Arul L x3')).toEqual({ player_name: 'Arul', number: '7', fit: 'men', size: 'L', quantity: 3 });
    expect(parseRosterLine('Kiran\t23\t2XL')).toEqual({ player_name: 'Kiran', number: '23', fit: 'men', size: 'XXL', quantity: 1 });
  });
  it('keeps names in any script and reads Indian digits', () => {
    expect(parseRosterLine('அருள், ௭, M')).toEqual({ player_name: 'அருள்', number: '7', fit: 'men', size: 'M', quantity: 1 });
    expect(parseRosterLine('प्रिया, १०, S')).toMatchObject({ player_name: 'प्रिया', number: '10' });
  });
  it('uses the default size when none is given', () => {
    expect(parseRosterLine('Arul, 7', 'L')).toMatchObject({ size: 'L' });
    expect(parseRosterLine('Arul, 7')).toBe('size');
  });
  it('reports problems', () => {
    expect(parseRosterLine('Averyveryverylongname, 7, M')).toBe('nameTooLong');
    expect(parseRosterLine('Arul, 1234, M')).toBe('number');
    expect(parseRosterLine('Arul, 7, M, 900')).toBe('quantity');
    expect(parseRosterLine('   ')).toBe('empty');
  });
});

describe('parseRoster', () => {
  it('skips a header row and blank lines, and reports bad lines with their numbers', () => {
    const r = parseRoster('Name, No, Size\nArul, 7, M\n\nBad line zz\nPriya, 10, S, 2');
    expect(r.rows.map((x) => x.player_name)).toEqual(['Arul', 'Priya']);
    expect(r.errors).toEqual([{ line: 4, text: 'Bad line zz', issue: 'size' }]);
    expect(totalPieces(r.rows)).toBe(3);
  });
});

describe('CSV import', () => {
  it('splits quoted fields', () => {
    expect(csvRecords('"Sai, Jr",11,M\n"He said ""hi""",1,S')).toEqual([['Sai, Jr', '11', 'M'], ['He said "hi"', '1', 'S']]);
  });
  it('maps columns by header in any order', () => {
    const r = parseRosterCsv('﻿Size,Qty,Player,Number\nM,2,"Sai, Jr",11\nXS,,Deepa,12\nZZ,1,Bad,1\n');
    expect(r.rows).toEqual([
      { player_name: 'Sai, Jr', number: '11', fit: 'men', size: 'M', quantity: 2 },
      { player_name: 'Deepa', number: '12', fit: 'men', size: 'XS', quantity: 1 },
    ]);
    expect(r.errors).toEqual([{ line: 4, text: 'Bad, 1, ZZ, 1', issue: 'size' }]);
  });
  it('without a header reads each record like a pasted line', () => {
    expect(parseRosterCsv('Arul,7,M,2\n').rows).toEqual([{ player_name: 'Arul', number: '7', fit: 'men', size: 'M', quantity: 2 }]);
  });
});

describe('duplicates and breakdown', () => {
  it('finds numbers used twice, ignoring blanks', () => {
    expect(duplicateNumbers([{ number: '7' }, { number: ' 7 ' }, { number: '' }, { number: '' }, { number: '8' }])).toEqual(['7']);
  });
  it('counts pieces per size in size order', () => {
    expect(sizeBreakdown([{ size: 'XL', quantity: 2 }, { size: 'S', quantity: 1 }, { size: 'XL', quantity: 1 }]))
      .toEqual([{ fit: 'men', size: 'S', quantity: 1 }, { fit: 'men', size: 'XL', quantity: 3 }]);
  });
});

describe('fits in rosters', () => {
  it('reads a fit word and kids sizes', () => {
    expect(parseRosterLine('Priya, 10, women, S')).toEqual({ player_name: 'Priya', number: '10', fit: 'women', size: 'S', quantity: 1 });
    expect(parseRosterLine('Kavin, 4, 8Y, 2')).toEqual({ player_name: 'Kavin', number: '4', fit: 'kids', size: '8Y', quantity: 2 });
    expect(parseRosterLine('Big Ravi 9 3XL')).toMatchObject({ fit: 'men', size: '3XL' });
    expect(parseRosterLine('Asha 5 ladies XS')).toMatchObject({ player_name: 'Asha', fit: 'women', size: 'XS' });
  });
  it('refuses a size the fit does not have', () => {
    expect(parseRosterLine('Priya, 10, women, 3XL')).toBe('size');
    expect(parseRosterLine('Kavin, 4, kids, M')).toBe('size');
  });
  it('reads a fit column in a CSV', () => {
    const r = parseRosterCsv('Name,Number,Fit,Size\nPriya,10,Women,M\nKavin,4,Kids,10Y\nBad,5,Women,8Y\nOdd,6,Robots,M\n');
    expect(r.rows.map((x) => `${x.player_name}:${x.fit}:${x.size}`)).toEqual(['Priya:women:M', 'Kavin:kids:10Y']);
    expect(r.errors.map((e) => e.line)).toEqual([4, 5]);
  });
  it('keeps fits apart in the breakdown', () => {
    expect(sizeBreakdown([{ fit: 'women', size: 'S', quantity: 1 }, { size: 'S', quantity: 2 }]))
      .toEqual([{ fit: 'men', size: 'S', quantity: 2 }, { fit: 'women', size: 'S', quantity: 1 }]);
  });
});
