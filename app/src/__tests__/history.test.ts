import { canRedo, canUndo, commitFrom, createHistory, HISTORY_LIMIT, push, redo, replace, undo } from '../lib/history';

describe('undo history', () => {
  it('undoes and redoes, and a new edit clears redo', () => {
    let h = push(push(createHistory(1), 2), 3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = redo(h);
    expect(h.present).toBe(3);
    h = push(undo(h), 9);
    expect(canRedo(h)).toBe(false);
  });

  it(`keeps at most ${HISTORY_LIMIT} steps`, () => {
    let h = createHistory(0);
    for (let i = 1; i <= 100; i++) h = push(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });

  it('makes a whole drag one undo step', () => {
    let h = createHistory('a');
    const base = h.present;
    h = replace(h, 'b1');
    h = replace(h, 'b2');
    h = commitFrom(h, base);
    expect(h.present).toBe('b2');
    h = undo(h);
    expect(h.present).toBe('a');
    expect(canUndo(h)).toBe(false);
  });
});
