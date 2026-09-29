import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Address, Serviceability } from '../../api/types';
import { cleanPincode, deliverToText, isPincode, serviceMessage } from '../../features/pincode/pincode';
import { checkServiceability, useDeliveryPincode, useServiceability } from '../../features/pincode/useServiceability';
import { errorMessage, useT } from '../../i18n';
import { useAuth } from '../../state/auth';
import { useLocation } from '../../state/location';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Sheet } from '../../ui/Sheet';
import { T } from '../../ui/Text';
import { colors, radius, space } from '../../ui/theme';

/** "Deliver to 600028 · Tamil Nadu" at the top of Home and Shop. Tap to change the PIN code. */
export function DeliverToBar({ garment = 'jersey', testID = 'deliver-to' }: { garment?: string; testID?: string }) {
  const t = useT();
  const pin = useDeliveryPincode();
  const place = useLocation((s) => s.place);
  const devicePin = useLocation((s) => s.pincode);
  const setPlace = useLocation((s) => s.setPlace);
  const [open, setOpen] = useState(false);
  const { data } = useServiceability(pin, { garment });
  // Keep the state name for a PIN code that came from a saved address.
  useEffect(() => {
    if (data?.place && data.pincode === devicePin && data.place.state !== place?.state) setPlace(data.place);
  }, [data, devicePin, place, setPlace]);
  const shownPlace = data?.pincode === pin ? data?.place ?? null : pin === devicePin ? place : null;
  const text = deliverToText(pin, shownPlace);
  const msg = pin ? serviceMessage(pin, data) : null;
  return (
    <View style={styles.bar}>
      <Pressable testID={testID} onPress={() => setOpen(true)} accessibilityRole="button"
        accessibilityLabel={text ? t('deliverTo', { place: text }) : t('deliverToPick')} accessibilityHint={t('changePincode')}
        style={({ pressed }) => [styles.chip, pressed && { opacity: 0.8 }]}>
        <T variant="label" color="#fff">📍</T>
        <T variant="label" color="#fff" style={{ flex: 1, marginLeft: space(2) }} numberOfLines={1} testID={`${testID}-text`}>
          {text ? t('deliverTo', { place: text }) : t('deliverToPick')}
        </T>
        <T variant="label" color="#fff">›</T>
      </Pressable>
      {msg && msg.tone === 'fail' ? (
        <T variant="caption" color={colors.fail} style={styles.note} testID={`${testID}-problem`}>{t(msg.key, msg.params)}</T>
      ) : null}
      <PincodeSheet visible={open} onClose={() => setOpen(false)} garment={garment} />
    </View>
  );
}

const NO_ADDRESSES: Address[] = [];

/** Enter a PIN code (or pick a saved address) and see at once whether we deliver there. */
export function PincodeSheet({ visible, onClose, garment = 'jersey' }: { visible: boolean; onClose: () => void; garment?: string }) {
  const t = useT();
  const current = useDeliveryPincode();
  const setPincode = useLocation((s) => s.setPincode);
  const saved = useAuth((s) => s.customer?.addresses);
  const addresses = saved ?? NO_ADDRESSES;
  const [text, setText] = useState(current ?? '');
  const [result, setResult] = useState<Serviceability | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  // Start fresh each time the sheet opens (not when applying a PIN code changes `current`).
  const currentRef = useRef(current);
  currentRef.current = current;
  useEffect(() => {
    if (visible) {
      setText(currentRef.current ?? '');
      setResult(null);
      setError(null);
      setTouched(false);
    }
  }, [visible]);

  const apply = async (value = text) => {
    const pin = cleanPincode(value);
    setText(pin);
    setTouched(true);
    setError(null);
    setResult(null);
    if (!isPincode(pin)) return;
    setBusy(true);
    try {
      const s = await checkServiceability(pin, { garment });
      setResult(s);
      // A PIN code the table doesn't know is not kept; one we can't serve yet is kept (with the notice).
      if (s.reason !== 'invalid_pincode') setPincode(pin, s.place);
      if (s.serviceable) onClose();
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const msg = touched ? serviceMessage(text, result) : null;
  return (
    <Sheet visible={visible} title={t('choosePincodeTitle')} onClose={onClose} testID="pin-sheet">
      <T variant="caption" style={{ marginBottom: space(3) }}>{t('choosePincodeHint')}</T>
      {addresses.length ? (
        <View style={{ marginBottom: space(3) }}>
          <T variant="label" style={{ marginBottom: space(2) }}>{t('savedAddresses')}</T>
          {addresses.map((a, i) => (
            <Pressable key={`${a.pincode}-${i}`} testID={`pin-address-${i}`} onPress={() => apply(a.pincode)} accessibilityRole="button"
              style={[styles.addr, cleanPincode(a.pincode) === current && styles.addrOn]}>
              <T variant="label">{a.name || a.line1}</T>
              <T variant="caption" numberOfLines={1}>{[a.line1, a.city, a.pincode].filter(Boolean).join(', ')}</T>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.row}>
        <View style={{ flex: 1, marginRight: space(2) }}>
          <Field testID="pin-input" label={t('pincode')} value={text} keyboardType="number-pad" maxLength={6} autoComplete="postal-code"
            onChangeText={(v) => { setText(cleanPincode(v)); setTouched(false); setResult(null); }}
            onSubmitEditing={() => apply()} returnKeyType="done" />
        </View>
        <Button testID="pin-apply" label={t('apply')} onPress={() => apply()} busy={busy} disabled={busy || text.length < 6} style={{ marginTop: space(6) }} />
      </View>
      {msg ? <Banner tone={msg.tone} text={t(msg.key, msg.params)} testID="pin-result" /> : null}
      {error ? <Banner tone="fail" text={error} testID="pin-error" /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  bar: { marginBottom: space(3) },
  chip: {
    flexDirection: 'row', alignItems: 'center', minHeight: 44, borderRadius: radius.md, paddingHorizontal: space(3),
    backgroundColor: '#23304f',
  },
  note: { marginTop: space(1) },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  addr: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: space(3), marginBottom: space(2), minHeight: 48 },
  addrOn: { borderColor: colors.brand, borderWidth: 2, backgroundColor: colors.brandSoft },
});
