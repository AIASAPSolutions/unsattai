import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, commitFrom, createHistory, HISTORY_LIMIT, push, redo, replace, undo } from './history';

describe('history', () => {
  it('undoes and redoes edits', () => {
    let h = createHistory(1);
    h = push(h, 2);
    h = push(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(3);
    h = undo(undo(h));
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    expect(undo(h)).toBe(h);
  });
  it('a new edit clears redo', () => {
    let h = push(push(createHistory('a'), 'b'), 'c');
    h = push(undo(h), 'x');
    expect(canRedo(h)).toBe(false);
    expect(h.past).toEqual(['a', 'b']);
  });
  it(`keeps at most ${HISTORY_LIMIT} steps`, () => {
    let h = createHistory(0);
    for (let i = 1; i <= 100; i++) h = push(h, i);
    expect(h.past.length).toBe(HISTORY_LIMIT);
    expect(h.past[0]).toBe(100 - HISTORY_LIMIT);
  });
  it('one drag (many live moves) is one undo step', () => {
    let h = push(createHistory({ x: 0 }), { x: 1 });
    const base = h.present;
    for (let i = 2; i < 30; i++) h = replace(h, { x: i });
    h = commitFrom(h, base);
    expect(h.past.length).toBe(2);
    expect(undo(h).present).toBe(base);
  });
  it('a gesture that changed nothing records nothing, and identical pushes are ignored', () => {
    const h = createHistory('a');
    expect(commitFrom(h, h.present)).toBe(h);
    expect(push(h, 'a')).toBe(h);
  });
});
