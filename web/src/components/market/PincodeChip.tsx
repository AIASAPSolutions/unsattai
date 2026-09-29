'use client';
import { useCallback, useRef, useState } from 'react';
import { usePincode, loadServiceability, useServiceability } from '@/components/providers/shop';
import { useSession } from '@/components/providers/session';
import { Banner, Button, Popover, TextField, cx } from '@/components/ui';
import { PinIcon } from '@/components/ui/icons';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { cleanPincode, pincodeIssue, reasonKey } from '@/lib/pincode';
import { pin } from '@/lib/shopStore';
import s from './market.module.css';

/** Header "Deliver to 600001" chip with a popover to change the PIN code. */
export function PincodeChip() {
  const { t } = useI18n();
  const { me } = useSession();
  const current = usePincode();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const status = useServiceability(current.pincode ? { pincode: current.pincode } : null);
  const bad = status.data && !status.data.serviceable;
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className={s.pinWrap}>
      <button ref={trigger} type="button" className={cx(s.pinChip, bad && s.pinBad)} aria-expanded={open} aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)} data-testid="pin-chip">
        <PinIcon size={18} />
        <span className={s.pinText}>
          <span className={s.pinSmall}>{current.pincode ? t('deliverTo') : t('pinChooseShort')}</span>
          <span className={s.pinValue} data-testid="pin-chip-value">
            {current.pincode || t('pinEnter')}
            {status.data?.place ? <span className={s.pinPlace}> · {status.data.place.state_name}</span> : null}
            {bad ? <span className={s.pinPlace}> · {t('pinNotDeliverable')}</span> : null}
          </span>
        </span>
      </button>
      <Popover open={open} onClose={close} label={t('pinTitle')} testId="pin-popover" triggerRef={trigger}>
        <PincodeForm initial={current.pincode} addresses={me?.addresses ?? []} onDone={close} />
      </Popover>
    </div>
  );
}

export function PincodeForm({ initial, addresses, onDone, testId = 'pin' }: {
  initial: string; addresses: { name: string; line1: string; city: string; pincode: string }[]; onDone?: () => void; testId?: string;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'fail' | 'warn' | 'pass'; text: string } | null>(null);

  const apply = async (p: string, e?: React.FormEvent) => {
    e?.preventDefault();
    const issue = pincodeIssue(p);
    if (issue) {
      setMsg({ tone: 'fail', text: t('pinInvalid') });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await loadServiceability({ pincode: p.trim() });
      if (r.reason === 'invalid_pincode') {
        setMsg({ tone: 'fail', text: t('pinInvalidServer', { pincode: p }) });
        return;
      }
      pin.choose(p.trim());
      if (!r.serviceable) {
        setMsg({ tone: 'warn', text: t(reasonKey(r.reason) ?? 'pinNotServiceable', { pincode: p }) });
        return;
      }
      setMsg({ tone: 'pass', text: t('pinSaved', { pincode: p, place: r.place?.state_name ?? '' }) });
      onDone?.();
    } catch (err) {
      setMsg({ tone: 'fail', text: errorMessage(t, err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <strong>{t('pinTitle')}</strong>
      <p className="small muted" style={{ margin: 0 }}>{t('pinText')}</p>
      {addresses.length ? (
        <div className={s.pinAddrs} role="group" aria-label={t('savedAddresses')}>
          {addresses.slice(0, 4).map((a, i) => (
            <button key={`${a.pincode}-${i}`} type="button" className={s.pinAddr} onClick={() => { setValue(a.pincode); void apply(a.pincode); }}
              data-testid={`${testId}-address-${i}`}>
              <strong>{a.name || a.city}</strong> <span className="muted">{a.line1}, {a.city}</span> <span className="tnum">{a.pincode}</span>
            </button>
          ))}
        </div>
      ) : null}
      <form className={s.pinForm} onSubmit={(e) => void apply(value, e)} noValidate>
        <TextField label={t('pincode')} value={value} inputMode="numeric" autoComplete="postal-code" maxLength={6}
          onValue={(v) => setValue(cleanPincode(v))} testId={`${testId}-input`} />
        <Button type="submit" busy={busy} testId={`${testId}-apply`}>{t('couponApply')}</Button>
      </form>
      {msg ? <Banner tone={msg.tone} live testId={`${testId}-msg`}>{msg.text}</Banner> : null}
    </div>
  );
}
