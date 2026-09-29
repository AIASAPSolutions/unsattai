import { describe, expect, it } from 'vitest';
import { cleanPincode, NO_PINCODE, parseSaved, pincodeIssue, reasonKey, resolvePincode } from './pincode';

describe('PIN code chip logic', () => {
  it('checks the format before asking the server', () => {
    expect(pincodeIssue('')).toBe('empty');
    expect(pincodeIssue('60001')).toBe('format');
    expect(pincodeIssue('999999')).toBe('format');
    expect(pincodeIssue('012345')).toBe('format');
    expect(pincodeIssue(' 600001 ')).toBeNull();
    expect(cleanPincode('600 0-01x9')).toBe('600001');
  });
  it('reads saved values defensively', () => {
    expect(parseSaved({ pincode: '560001', source: 'user' })).toEqual({ pincode: '560001', source: 'user' });
    expect(parseSaved({ pincode: 'abc' })).toEqual(NO_PINCODE);
    expect(parseSaved('600001')).toEqual(NO_PINCODE);
    expect(parseSaved(null)).toEqual(NO_PINCODE);
  });
  it('uses the device choice, else the default address of a signed-in customer', () => {
    const me = { addresses: [{ pincode: '' }, { pincode: '641001' }, { pincode: '600002' }] };
    expect(resolvePincode({ pincode: '560001', source: 'user' }, me)).toEqual({ pincode: '560001', source: 'user' });
    expect(resolvePincode(NO_PINCODE, me)).toEqual({ pincode: '641001', source: 'account' });
    expect(resolvePincode(NO_PINCODE, null)).toEqual(NO_PINCODE);
    expect(resolvePincode(NO_PINCODE, { addresses: [] })).toEqual(NO_PINCODE);
  });
  it('maps reason codes to messages', () => {
    expect(reasonKey('not_serviceable')).toBe('pinNotServiceable');
    expect(reasonKey('invalid_pincode')).toBe('pinInvalidServer');
    expect(reasonKey('something_new')).toBe('pinNotServiceable');
    expect(reasonKey(null)).toBeNull();
  });
});
