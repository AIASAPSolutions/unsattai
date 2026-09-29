import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api } from '../../api/endpoints';
import type { Address } from '../../api/types';
import { AddressForm, addressLine, EMPTY_ADDRESS_FORM } from '../../components/shop/AddressForm';
import { addressProblems, cleanAddress } from '../../features/checkout/checkout';
import { errorMessage, useT } from '../../i18n';
import { useAuth } from '../../state/auth';
import { useLocation } from '../../state/location';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Screen } from '../../ui/Screen';
import { Sheet } from '../../ui/Sheet';
import { Empty, Loading } from '../../ui/States';
import { T } from '../../ui/Text';
import { colors, space } from '../../ui/theme';

export default function AddressesScreen() {
  const t = useT();
  const me = useAuth((s) => s.customer);
  const setCustomer = useAuth((s) => s.setCustomer);
  const setPincode = useLocation((s) => s.setPincode);
  const [editing, setEditing] = useState<{ index: number | null; value: Address } | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) router.replace('/sign-in');
  }, [me]);
  if (!me) return <Screen><Loading label={t('loading')} /></Screen>;
  const list = me.addresses;

  const save = async (next: Address[]) => {
    setBusy(true);
    setError(null);
    try {
      setCustomer(await api.updateMe({ addresses: next }));
      return true;
    } catch (e) {
      setError(errorMessage(t, e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!editing) return;
    setTouched(true);
    if (addressProblems(editing.value).length) return;
    const clean = cleanAddress(editing.value);
    const next = editing.index === null ? [...list, clean] : list.map((a, i) => (i === editing.index ? clean : a));
    if (await save(next.slice(0, 10))) setEditing(null);
  };

  const makeDefault = async (i: number) => {
    const a = list[i];
    if (await save([a, ...list.filter((_, j) => j !== i)])) setPincode(a.pincode);
  };

  const issues = editing ? addressProblems(editing.value) : [];
  return (
    <Screen testID="screen-addresses" footer={
      <Button testID="add-address" label={`+ ${t('addNewAddress')}`} disabled={list.length >= 10}
        onPress={() => { setTouched(false); setEditing({ index: null, value: { ...EMPTY_ADDRESS_FORM, name: me.name, phone: me.phone } }); }} />
    }>
      {!list.length ? <Empty label={t('noAddresses')} /> : null}
      {list.map((a, i) => (
        <Card key={`${a.line1}-${i}`} testID={`saved-address-${i}`}>
          <View style={styles.head}>
            <T variant="label" style={{ flex: 1 }}>{a.name || me.name}</T>
            {i === 0 ? <T variant="caption" color={colors.pass}>✓ {t('defaultAddress')}</T> : null}
          </View>
          <T variant="body">{addressLine(a)}</T>
          {a.phone ? <T variant="caption">{a.phone}</T> : null}
          <View style={styles.actions}>
            <Button compact kind="secondary" label={t('edit')} onPress={() => { setTouched(false); setEditing({ index: i, value: { ...EMPTY_ADDRESS_FORM, ...a } }); }}
              testID={`edit-address-${i}`} />
            {i > 0 ? <Button compact kind="ghost" label={t('makeDefault')} onPress={() => makeDefault(i)} disabled={busy} testID={`default-address-${i}`} /> : null}
            <Button compact kind="ghost" label={t('delete')} onPress={() => save(list.filter((_, j) => j !== i))} disabled={busy} testID={`delete-address-${i}`} />
          </View>
        </Card>
      ))}
      {error ? <Banner tone="fail" text={error} /> : null}
      <Sheet visible={!!editing} title={editing?.index === null ? t('addNewAddress') : t('editAddress')} onClose={() => setEditing(null)}
        testID="address-sheet" footer={<Button testID="save-address" label={t('save')} onPress={submit} busy={busy} disabled={busy || (touched && issues.length > 0)} />}>
        {editing ? <AddressForm value={editing.value} onChange={(value) => setEditing({ ...editing, value })} issues={issues} touched={touched}
          prefix="saved-addr" withContact /> : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: space(1) },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginTop: space(2) },
});
