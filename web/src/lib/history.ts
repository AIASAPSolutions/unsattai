// Bounded undo/redo. Every committed edit pushes the previous state; drags and
// sliders call `replace` while moving and `commit` once when released, so one
// gesture is one undo step.

export const HISTORY_LIMIT = 60;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function push<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (Object.is(next, h.present)) return h;
  const past = [...h.past, h.present];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [] };
}

/** Change the present without recording a step (live drag preview). */
export function replace<T>(h: History<T>, next: T): History<T> {
  return { ...h, present: next };
}

/** Record a step from `base` (the state before a live gesture) to the current present. */
export function commitFrom<T>(h: History<T>, base: T, limit = HISTORY_LIMIT): History<T> {
  if (Object.is(base, h.present)) return h;
  const past = [...h.past, base];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: h.present, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  const prev = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next, future: rest };
}

export const canUndo = <T,>(h: History<T>) => h.past.length > 0;
export const canRedo = <T,>(h: History<T>) => h.future.length > 0;
