'use client';
import { useState } from 'react';
import { useMeta } from '@/components/providers/data';
import { Button, Modal, TextField } from '@/components/ui';
import { useT } from '@/i18n/provider';
import { normalizeHex } from '@/lib/color';
import s from './design.module.css';

/** Colour picker dialog: the browser's colour wheel, a hex field and the engine's named colours. */
export function ColorPickerModal({ open, initial, title, onClose, onPick, testId = 'color-picker' }: {
  open: boolean; initial: string; title?: string; onClose: () => void; onPick: (hex: string) => void; testId?: string;
}) {
  const t = useT();
  return (
    <Modal open={open} onClose={onClose} title={title ?? t('customColor')} testId={testId} closeLabel={t('close')}>
      {/* The body mounts each time the dialog opens, so it starts from `initial`. */}
      <PickerBody initial={initial} onClose={onClose} onPick={onPick} testId={testId} />
    </Modal>
  );
}

function PickerBody({ initial, onClose, onPick, testId }: { initial: string; onClose: () => void; onPick: (hex: string) => void; testId: string }) {
  const t = useT();
  const { meta } = useMeta();
  const [hex, setHex] = useState(initial);
  const [text, setText] = useState(initial);
  const valid = normalizeHex(text);
  return (
    <>
      <div className={s.picker}>
        <div className={s.pickerTop}>
          <input type="color" aria-label={t('customColor')} value={hex} data-testid={`${testId}-wheel`}
            onChange={(e) => { setHex(e.target.value); setText(e.target.value); }} />
          <div style={{ flex: 1 }}>
            <TextField label={t('hex')} value={text} maxLength={7} testId={`${testId}-hex`}
              error={text && !valid ? t('invalid') : null}
              onValue={(v) => { setText(v); const n = normalizeHex(v); if (n) setHex(n); }} />
          </div>
        </div>
        {meta?.colors.length ? (
          <div className={s.named} role="group" aria-label={t('palettes')}>
            {meta.colors.map((c) => (
              <button key={c.name} type="button" title={`${c.name} ${c.hex}`} aria-label={c.name} aria-pressed={hex === c.hex}
                style={{ background: c.hex }} onClick={() => { setHex(c.hex); setText(c.hex); }} />
            ))}
          </div>
        ) : null}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button kind="ghost" onClick={onClose}>{t('cancel')}</Button>
          <Button disabled={!valid} testId={`${testId}-apply`} onClick={() => valid && onPick(valid)}>{t('done')}</Button>
        </div>
      </div>
    </>
  );
}
