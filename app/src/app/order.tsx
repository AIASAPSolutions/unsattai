import { Buffer } from 'buffer';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { ApiError } from '../api/client';
import { api } from '../api/endpoints';
import { SIZES, TEXT_LIMITS, type Check, type OrderFailure, type Size } from '../api/types';
import { ChecksList } from '../components/ChecksList';
import { buildItems, orderPayload, payloadHash, validateDraft, type DraftIssue } from '../features/order/buildOrder';
import { errorMessage, useT } from '../i18n';
import { newId } from '../lib/ids';
import { readAsBase64 } from '../lib/readFile';
import { parseRoster, totalPieces, type RosterError } from '../lib/roster';
import { cleanNumber } from '../lib/validation';
import { currentSpec, useFlow, type RosterRow } from '../state/flow';
import { usePrefs } from '../state/prefs';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { Field } from '../ui/Field';
import { Screen } from '../ui/Screen';
import { Segmented } from '../ui/Segmented';
import { Empty, Loading } from '../ui/States';
import { T } from '../ui/Text';
import { colors, radius, space } from '../ui/theme';
import { useVoiceGuide } from '../voice/useVoiceGuide';

function SizePicker({ value, onChange, testID }: { value: Size; onChange: (s: Size) => void; testID?: string }) {
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup">
      {SIZES.map((s) => <Chip key={s} testID={testID ? `${testID}-${s}` : undefined} label={s} selected={value === s} onPress={() => onChange(s)} />)}
    </View>
  );
}

function Qty({ value, onChange, testID }: { value: number; onChange: (n: number) => void; testID?: string }) {
  const t = useT();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const set = (n: number) => onChange(Math.max(1, Math.min(500, n)));
  return (
    <View style={styles.qty}>
      <Button compact kind="secondary" label="−" onPress={() => set(value - 1)} disabled={value <= 1} accessibilityHint={t('quantity')} />
      <Field testID={testID} label={t('quantity')} value={text} keyboardType="number-pad" maxLength={3} style={styles.qtyInput}
        onChangeText={(v) => {
          const clean = cleanNumber(v).replace(/\D/g, '');
          setText(clean);
          if (clean) onChange(Number(clean));
        }}
        onBlur={() => set(Number(text) || 1)}
        error={value < 1 || value > 500 ? t('qtyRange') : null} />
      <Button compact kind="secondary" label="+" onPress={() => set(value + 1)} disabled={value >= 500} />
    </View>
  );
}

function RowEditor({ row, index, issues, onChange, onRemove }: {
  row: RosterRow; index: number; issues: DraftIssue[]; onChange: (r: RosterRow) => void; onRemove: () => void;
}) {
  const t = useT();
  const has = (field: string) => issues.some((i) => i.kind === 'row' && i.index === index && i.field === field);
  return (
    <View style={styles.row} testID={`roster-row-${index}`}>
      <View style={styles.rowHead}>
        <T variant="label">{t('line', { n: index + 1 })}</T>
        <Button compact kind="ghost" label={t('removeRow')} onPress={onRemove} testID={`remove-row-${index}`} />
      </View>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 3, marginRight: space(2) }}>
          <Field testID={`row-name-${index}`} label={t('playerName')} value={row.player_name} maxLength={TEXT_LIMITS.player_name}
            error={has('player_name') ? t('tooLong') : null} onChangeText={(player_name) => onChange({ ...row, player_name })} />
        </View>
        <View style={{ flex: 1 }}>
          <Field testID={`row-number-${index}`} label={t('number')} value={row.number} maxLength={3} keyboardType="number-pad"
            error={has('number') ? t('digitsOnly') : null} onChangeText={(v) => onChange({ ...row, number: cleanNumber(v) })} />
        </View>
      </View>
      <SizePicker value={row.size} onChange={(size) => onChange({ ...row, size })} testID={`row-size-${index}`} />
      <Qty value={row.quantity} onChange={(quantity) => onChange({ ...row, quantity })} testID={`row-qty-${index}`} />
    </View>
  );
}

export default function OrderScreen() {
  const t = useT();
  const lang = usePrefs((s) => s.language);
  const remember = usePrefs((s) => s.rememberCustomer);
  const savedCustomer = usePrefs((s) => s.customer);
  const setRemember = usePrefs((s) => s.setRememberCustomer);
  const saveCustomer = usePrefs((s) => s.saveCustomer);
  const spec = useFlow(currentSpec);
  const designId = useFlow((s) => s.designId);
  const draft = useFlow((s) => s.order);
  const setOrder = useFlow((s) => s.setOrder);
  const keyForPayload = useFlow((s) => s.keyForPayload);
  const setLastOrder = useFlow((s) => s.setLastOrder);
  const { speak } = useVoiceGuide();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<OrderFailure[]>([]);
  const [rosterNote, setRosterNote] = useState<{ added: number; errors: RosterError[] } | null>(null);
  const [touched, setTouched] = useState(false);
  const [preflight, setPreflight] = useState<{ checks: Check[]; ready: boolean } | null>(null);
  const [preflightError, setPreflightError] = useState<unknown>(null);

  // Contact details come from "remember me" when the customer opted in.
  useEffect(() => {
    if (savedCustomer && !draft.customer.name && !draft.customer.phone) setOrder({ customer: { ...savedCustomer } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = useMemo(() => (spec ? buildItems(draft, spec) : []), [draft, spec]);
  const orderSizes = useMemo(() => [...new Set(items.map((i) => i.size))], [items]);
  const sizeKey = orderSizes.join(',');

  // Re-check the design for the sizes actually ordered (logo DPI depends on size).
  useEffect(() => {
    if (!spec) return;
    const controller = new AbortController();
    setPreflight(null);
    setPreflightError(null);
    const timer = setTimeout(() => {
      api.render(spec, orderSizes, controller.signal)
        .then((r) => setPreflight({ checks: r.checks, ready: r.manufacturing_ready }))
        .catch((e) => !controller.signal.aborted && setPreflightError(e));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, sizeKey]);

  if (!spec || !designId) {
    return (
      <Screen>
        <Empty label={t('noDesigns')} />
        <Button label={t('newDesign')} onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  const issues = validateDraft(draft, spec);
  const customerIssue = (f: 'name' | 'phone' | 'email') => touched && issues.some((i) => i.kind === 'customer' && i.field === f);
  const setRows = (rows: RosterRow[]) => setOrder({ rows });
  const setCustomer = (patch: Partial<typeof draft.customer>) => setOrder({ customer: { ...draft.customer, ...patch } });

  const addParsed = (text: string) => {
    const res = parseRoster(text, draft.rows[draft.rows.length - 1]?.size ?? 'M');
    setRows([...draft.rows, ...res.rows.map((r) => ({ ...r, key: newId('row') }))]);
    setRosterNote({ added: res.rows.length, errors: res.errors });
  };
  const paste = async () => addParsed(await Clipboard.getStringAsync());
  const importFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/plain', 'text/comma-separated-values', 'text/tab-separated-values'], copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets[0]) return;
      const { base64 } = await readAsBase64(res.assets[0].uri);
      addParsed(Buffer.from(base64, 'base64').toString('utf8'));
    } catch (e) {
      setError(errorMessage(t, e));
    }
  };

  const blocked = preflight ? !preflight.ready : false;
  const place = async () => {
    setTouched(true);
    setError(null);
    setFailures([]);
    if (issues.length || blocked || !preflight) return;
    setBusy(true);
    try {
      const payload = orderPayload(designId, spec, items, draft.customer, lang);
      // A retry of the same order reuses the key, so the server returns the first order instead of a duplicate.
      const idempotency_key = keyForPayload(payloadHash(payload));
      const order = await api.createOrder({ ...payload, idempotency_key });
      if (remember) saveCustomer(draft.customer);
      setLastOrder(order);
      speak(t(`status_${order.status}`));
      router.replace({ pathname: '/orders/[id]', params: { id: order.id, duplicate: order.duplicate ? '1' : '0' } });
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'blocked') {
        setFailures(((e.data as { failures?: OrderFailure[] })?.failures) ?? []);
      }
      const msg = errorMessage(t, e);
      setError(msg);
      speak(msg);
    } finally {
      setBusy(false);
    }
  };

  const listIssue = issues.find((i) => i.kind === 'emptyRoster' || i.kind === 'tooManyLines' || i.kind === 'tooManyPieces');
  return (
    <Screen
      testID="screen-order"
      footer={
        <View>
          <T variant="label" style={{ marginBottom: space(2) }} testID="total-pieces">{t('totalPieces', { n: totalPieces(items) })}</T>
          <Button testID="place-order" label={busy ? t('placingOrder') : t('placeOrder')} onPress={place} busy={busy}
            disabled={busy || blocked || !preflight || (touched && issues.length > 0)} />
        </View>
      }
    >
      {preflightError ? (
        <Banner tone="warn" text={errorMessage(t, preflightError)} />
      ) : !preflight ? <Loading label={t('checking')} /> : blocked ? (
        <Banner tone="fail" text={t('orderBlocked')} testID="order-blocked">
          <ChecksList checks={preflight.checks} compact />
          <Button compact kind="secondary" label={t('backToStudio')} onPress={() => router.back()} />
        </Banner>
      ) : null}

      <Segmented testID="order-mode" value={draft.mode} onChange={(mode) => setOrder({ mode })}
        options={[{ value: 'single', label: t('single') }, { value: 'team', label: t('team') }]} />

      {draft.mode === 'single' ? (
        <Card title={t('single')} style={{ marginTop: space(4) }}>
          <T variant="caption" style={{ marginBottom: space(3) }}>
            {[spec.typography.player_name, spec.typography.number].filter(Boolean).join(' · ') || spec.style_name}
          </T>
          <T variant="label" style={{ marginBottom: space(2) }}>{t('size')}</T>
          <SizePicker testID="single-size" value={draft.single.size} onChange={(size) => setOrder({ single: { ...draft.single, size } })} />
          <Qty testID="single-qty" value={draft.single.quantity} onChange={(quantity) => setOrder({ single: { ...draft.single, quantity } })} />
        </Card>
      ) : (
        <Card title={t('roster')} style={{ marginTop: space(4) }}>
          <T variant="caption" style={{ marginBottom: space(3) }}>{t('rosterHelp')}</T>
          <View style={styles.wrap}>
            <Button testID="paste-roster" compact kind="secondary" label={t('pasteRoster')} onPress={paste} style={{ marginRight: space(2), marginBottom: space(2) }} />
            <Button testID="import-roster" compact kind="secondary" label={t('importRoster')} onPress={importFile} style={{ marginBottom: space(2) }} />
          </View>
          {rosterNote ? (
            <Banner tone={rosterNote.errors.length ? 'warn' : 'pass'} text={t('rosterImported', { n: rosterNote.added })} testID="roster-note">
              {rosterNote.errors.length ? <T variant="caption" color={colors.ink}>{t('rosterErrors', { n: rosterNote.errors.length })}</T> : null}
              {rosterNote.errors.slice(0, 8).map((e) => (
                <T key={e.line} variant="caption" color={colors.ink}>{t('line', { n: e.line })}: “{e.text}” · {t(`rosterIssue_${e.issue as 'size'}`)}</T>
              ))}
            </Banner>
          ) : null}
          {draft.rows.map((r, i) => (
            <RowEditor key={r.key} row={r} index={i} issues={touched ? issues : []}
              onChange={(next) => setRows(draft.rows.map((x) => (x.key === r.key ? next : x)))}
              onRemove={() => setRows(draft.rows.filter((x) => x.key !== r.key))} />
          ))}
          <Button testID="add-row" kind="secondary" label={`+ ${t('addRow')}`} onPress={() => setRows([...draft.rows, {
            key: newId('row'), player_name: '', number: '', size: draft.rows[draft.rows.length - 1]?.size ?? 'M', quantity: 1,
          }])} />
          {touched && listIssue ? (
            <T variant="caption" color={colors.fail} style={{ marginTop: space(2) }}>
              {listIssue.kind === 'emptyRoster' ? t('emptyRoster') : t('tooManyLines')}
            </T>
          ) : null}
        </Card>
      )}

      <Card title={t('customer')}>
        <Field testID="customer-name" label={t('customerName')} value={draft.customer.name} autoComplete="name" textContentType="name"
          error={customerIssue('name') ? t('required') : null} onChangeText={(name) => setCustomer({ name })} />
        <Field testID="customer-phone" label={t('phone')} value={draft.customer.phone} keyboardType="phone-pad" autoComplete="tel"
          textContentType="telephoneNumber" error={customerIssue('phone') ? t('invalid') : null} onChangeText={(phone) => setCustomer({ phone })} />
        <Field testID="customer-email" label={`${t('email')} (${t('optional')})`} value={draft.customer.email} keyboardType="email-address"
          autoCapitalize="none" autoComplete="email" textContentType="emailAddress"
          error={customerIssue('email') ? t('invalid') : null} onChangeText={(email) => setCustomer({ email })} />
        <Pressable style={styles.switchRow} onPress={() => setRemember(!remember, draft.customer)} accessibilityRole="switch"
          accessibilityState={{ checked: remember }}>
          <T variant="body" style={{ flex: 1 }}>{t('rememberMe')}</T>
          <Switch value={remember} onValueChange={(on) => setRemember(on, draft.customer)} testID="remember-me" />
        </Pressable>
      </Card>

      {failures.length ? (
        <Card title={t('orderBlockedServer')}>
          {failures.map((f) => (
            <View key={`${f.line}-${f.size}`} style={{ marginBottom: space(3) }}>
              <T variant="label">{t('line', { n: f.line })}: {[f.player_name, f.number, f.size].filter(Boolean).join(' · ')}</T>
              <ChecksList checks={f.checks} compact />
            </View>
          ))}
        </Card>
      ) : null}
      {error ? <Banner tone="fail" text={error} testID="order-error" action={failures.length ? undefined : t('retry')} onAction={place} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  qty: { flexDirection: 'row', alignItems: 'center', marginTop: space(2) },
  qtyInput: { width: 90, textAlign: 'center', marginHorizontal: space(2) },
  row: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: space(3), marginBottom: space(3) },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space(2) },
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
});
