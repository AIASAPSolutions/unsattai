'use client';
import { useId, useRef } from 'react';
import { flow } from '@/lib/flow';
import s from './studio.module.css';

/** A range input where one drag (or one run of key presses) is one undo step. */
export function Slider({ label, value, min, max, step, format, onLive, testId }: {
  label: string; value: number; min: number; max: number; step: number; format: (v: number) => string;
  onLive: (v: number) => void; testId?: string;
}) {
  const id = useId();
  const active = useRef(false);
  const begin = () => {
    if (!active.current) {
      active.current = true;
      flow.beginGesture();
    }
  };
  const end = () => {
    if (active.current) {
      active.current = false;
      flow.endGesture();
    }
  };
  return (
    <div className={s.slider}>
      <div className={s.sliderHead}>
        <label htmlFor={id}>{label}</label>
        <span className="tnum">{format(value)}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} data-testid={testId}
        aria-valuetext={format(value)}
        onPointerDown={begin} onKeyDown={begin} onPointerUp={end} onKeyUp={end} onBlur={end}
        onChange={(e) => {
          begin();
          onLive(Number(e.target.value));
        }} />
    </div>
  );
}
