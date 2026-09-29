import { useEffect } from 'react';
import { View } from 'react-native';
import type { Address } from '../../api/types';
import { cleanPincode, isPincode } from '../../features/pincode/pincode';
import { checkServiceability } from '../../features/pincode/useServiceability';
import type { DraftIssue } from '../../features/order/buildOrder';
import { useT } from '../../i18n';
import { Field } from '../../ui/Field';
import { space } from '../../ui/theme';

export const EMPTY_ADDRESS_FORM: Address = { name: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '' };

/** House, street, city, state code and PIN code. The state is filled in from the PIN code when it is empty. */
export function AddressForm({ value, onChange, issues, touched, prefix = 'addr', withContact }: {
  value: Address; onChange: (a: Address) => void; issues: DraftIssue[]; touched: boolean; prefix?: string; withContact?: boolean;
}) {
  const t = useT();
  const bad = (f: 'line1' | 'city' | 'state' | 'pincode') => touched && issues.some((i) => i.kind === 'address' && i.field === f);
  const set = (patch: Partial<Address>) => onChange({ ...value, ...patch });

  useEffect(() => {
    if (!isPincode(value.pincode) || value.state) return;
    let live = true;
    checkServiceability(cleanPincode(value.pincode))
      .then((s) => live && s.place && !value.state && onChange({ ...value, state: s.place.state }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.pincode]);

  return (
    <View>
      {withContact ? (
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1, marginRight: space(2) }}>
            <Field testID={`${prefix}-name`} label={`${t('receiverName')} (${t('optional')})`} value={value.name ?? ''} maxLength={80}
              autoComplete="name" onChangeText={(name) => set({ name })} />
          </View>
          <View style={{ flex: 1 }}>
            <Field testID={`${prefix}-phone`} label={`${t('phone')} (${t('optional')})`} value={value.phone ?? ''} maxLength={24}
              keyboardType="phone-pad" autoComplete="tel" onChangeText={(phone) => set({ phone })} />
          </View>
        </View>
      ) : null}
      <Field testID={`${prefix}-line1`} label={t('addressLine1')} value={value.line1} maxLength={160} autoComplete="street-address"
        error={bad('line1') ? t('required') : null} onChangeText={(line1) => set({ line1 })} />
      <Field testID={`${prefix}-line2`} label={`${t('addressLine2')} (${t('optional')})`} value={value.line2 ?? ''} maxLength={160}
        onChangeText={(line2) => set({ line2 })} />
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1, marginRight: space(2) }}>
          <Field testID={`${prefix}-pincode`} label={t('pincode')} value={value.pincode} maxLength={6} keyboardType="number-pad"
            autoComplete="postal-code" error={bad('pincode') ? t('pincodeInvalid') : null}
            onChangeText={(v) => set({ pincode: cleanPincode(v) })} />
        </View>
        <View style={{ flex: 1 }}>
          <Field testID={`${prefix}-state`} label={t('stateCode')} value={value.state} maxLength={4} autoCapitalize="characters"
            error={bad('state') ? t('invalid') : null} onChangeText={(v) => set({ state: v.replace(/[^A-Za-z]/g, '').toUpperCase() })} />
        </View>
      </View>
      <Field testID={`${prefix}-city`} label={t('city')} value={value.city} maxLength={60}
        error={bad('city') ? t('required') : null} onChangeText={(city) => set({ city })} />
    </View>
  );
}

export function addressLine(a: Address): string {
  return [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', ');
}
