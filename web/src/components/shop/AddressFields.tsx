'use client';
import { SelectField, TextField } from '@/components/ui';
import { useT } from '@/i18n/provider';
import type { Address } from '@/lib/api/types';
import { validateAddress } from '@/lib/order';
import { STATES } from '@/lib/states';
import s from './shop.module.css';

/** Postal address in the shape the API stores (state as a short code, 6-digit PIN code). */
export function AddressFields({ value, onChange, showErrors, withContact = true, testId = 'address' }: {
  value: Address; onChange: (a: Address) => void; showErrors: boolean; withContact?: boolean; testId?: string;
}) {
  const t = useT();
  const issues = showErrors ? validateAddress(value) : [];
  const err = (f: 'line1' | 'city' | 'state' | 'pincode') =>
    issues.some((i) => i.kind === 'address' && i.field === f)
      ? t(f === 'pincode' ? 'pincodeInvalid' : f === 'state' ? 'stateRequired' : 'required') : null;
  const set = (patch: Partial<Address>) => onChange({ ...value, ...patch });
  return (
    <div className="stack" data-testid={testId}>
      {withContact ? (
        <div className={s.grid2}>
          <TextField label={t('addressName')} value={value.name} optional={t('optional')} maxLength={80} autoComplete="name"
            onValue={(v) => set({ name: v })} testId={`${testId}-name`} />
          <TextField label={t('addressPhone')} value={value.phone} optional={t('optional')} maxLength={24} type="tel" autoComplete="tel"
            onValue={(v) => set({ phone: v })} testId={`${testId}-phone`} />
        </div>
      ) : null}
      <TextField label={t('addressLine1')} value={value.line1} maxLength={160} autoComplete="address-line1"
        onValue={(v) => set({ line1: v })} error={err('line1')} testId={`${testId}-line1`} />
      <TextField label={t('addressLine2')} value={value.line2} optional={t('optional')} maxLength={160} autoComplete="address-line2"
        onValue={(v) => set({ line2: v })} testId={`${testId}-line2`} />
      <div className={s.grid3}>
        <TextField label={t('city')} value={value.city} maxLength={60} autoComplete="address-level2"
          onValue={(v) => set({ city: v })} error={err('city')} testId={`${testId}-city`} />
        <SelectField label={t('state')} value={value.state} onValue={(v) => set({ state: v })} error={err('state')}
          testId={`${testId}-state`} autoComplete="address-level1">
          <option value="">{t('selectPlaceholder')}</option>
          {STATES.map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}
        </SelectField>
        <TextField label={t('pincode')} value={value.pincode} inputMode="numeric" maxLength={6} autoComplete="postal-code"
          onValue={(v) => set({ pincode: v.replace(/\D/g, '').slice(0, 6) })} error={err('pincode')} hint={t('pincodeHint')}
          testId={`${testId}-pincode`} />
      </div>
    </div>
  );
}
