import type { Serviceability, SellerOffer } from '../api/types';
import { chosenOffer, cleanPincode, deliverToText, isPincode, otherOffers, serviceMessage } from '../features/pincode/pincode';
import { effectivePincode, useLocation } from '../state/location';

const offer = (id: string, over: Partial<SellerOffer> = {}): SellerOffer => ({
  seller_id: id, seller_name: id, rating: { average: 4.5, count: 3 } as never, unit_price: 499, ship_date: '2026-10-02',
  delivery_date: '2026-10-05', transit_days: 3, cod_available: true, recommended: false, fastest: false, cheapest: false, ...over,
});

const answer = (over: Partial<Serviceability> = {}): Serviceability => ({
  pincode: '600028', serviceable: true, place: { state: 'TN', state_name: 'Tamil Nadu' } as never, reason: null,
  offers: [offer('sel_house', { recommended: true }), offer('sel_fast', { fastest: true })], recommended_seller_id: 'sel_house', ...over,
});

describe('PIN code shape', () => {
  it('keeps six digits from any script and checks the first digit', () => {
    expect(cleanPincode(' 600 028 ')).toBe('600028');
    expect(cleanPincode('௬௦௦௦௨௮')).toBe('600028');
    expect(cleanPincode('1234567')).toBe('123456');
    expect(isPincode('600028')).toBe(true);
    expect(isPincode('999999')).toBe(false);
    expect(isPincode('012345')).toBe(false);
    expect(isPincode('60002')).toBe(false);
  });
});

describe('serviceability messages', () => {
  it('rejects a malformed PIN code without asking the server', () => {
    expect(serviceMessage('999999', null)).toEqual({ tone: 'fail', key: 'pinInvalid', params: { pin: '999999' } });
    expect(serviceMessage('', null)).toBeNull();
  });

  it('waits for the answer for this PIN code, then names the place', () => {
    expect(serviceMessage('600028', null)).toBeNull();
    expect(serviceMessage('600028', answer({ pincode: '560001' }))).toBeNull();
    expect(serviceMessage('600028', answer())).toEqual({ tone: 'pass', key: 'pinDeliversTo', params: { pin: '600028', place: 'Tamil Nadu' } });
  });

  it('turns each server reason into its own message', () => {
    expect(serviceMessage('194101', answer({ pincode: '194101', serviceable: false, offers: [], reason: 'not_serviceable' }))?.key).toBe('pinNotServiceable');
    expect(serviceMessage('600028', answer({ serviceable: false, offers: [], reason: 'garment_unavailable' }))?.key).toBe('pinGarmentUnavailable');
    expect(serviceMessage('600028', answer({ serviceable: false, offers: [], reason: 'something_new' }))?.key).toBe('pinNotServiceable');
  });

  it('picks the chosen seller when it can deliver, else the recommended one', () => {
    const s = answer();
    expect(chosenOffer(s)?.seller_id).toBe('sel_house');
    expect(chosenOffer(s, 'sel_fast')?.seller_id).toBe('sel_fast');
    expect(chosenOffer(s, 'sel_gone')?.seller_id).toBe('sel_house');
    expect(otherOffers(s).map((o) => o.seller_id)).toEqual(['sel_fast']);
    expect(otherOffers(s, 'sel_fast').map((o) => o.seller_id)).toEqual(['sel_house']);
    expect(chosenOffer(answer({ serviceable: false }))).toBeNull();
  });

  it('writes the Deliver-to chip text', () => {
    expect(deliverToText(null, null)).toBeNull();
    expect(deliverToText('600028', null)).toBe('600028');
    expect(deliverToText('600028', { state: 'TN', state_name: 'Tamil Nadu' } as never)).toBe('600028 · Tamil Nadu');
  });
});

describe('Deliver-to store', () => {
  beforeEach(() => useLocation.getState().clear());

  it('stores only valid PIN codes and forgets the place when the PIN changes', () => {
    expect(useLocation.getState().setPincode('12')).toBe(false);
    expect(useLocation.getState().pincode).toBeNull();
    expect(useLocation.getState().setPincode('600 028', { state: 'TN', state_name: 'Tamil Nadu' } as never)).toBe(true);
    expect(useLocation.getState()).toMatchObject({ pincode: '600028', place: { state_name: 'Tamil Nadu' } });
    useLocation.getState().setPincode('600028');
    expect(useLocation.getState().place?.state_name).toBe('Tamil Nadu');
    useLocation.getState().setPincode('560001');
    expect(useLocation.getState()).toMatchObject({ pincode: '560001', place: null });
  });

  it('falls back to the first saved address with a valid PIN code', () => {
    const addr = (pincode: string) => ({ line1: 'x', line2: '', city: 'y', state: 'TN', pincode });
    expect(effectivePincode('560001', [addr('600028')])).toBe('560001');
    expect(effectivePincode(null, [addr('bad'), addr('600 028')])).toBe('600028');
    expect(effectivePincode(null, [])).toBeNull();
    expect(effectivePincode(null, undefined)).toBeNull();
  });
});
