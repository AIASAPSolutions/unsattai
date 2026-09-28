import { setApiUrl } from '../api/config';
import { setFetcher } from '../api/client';
import type { DesignSpec, Understanding } from '../api/types';
import { canGenerate, currentSpec, unansweredQuestions, useFlow } from '../state/flow';

const understanding = (over: Partial<Understanding> = {}): Understanding => ({
  prompt: 'navy kit for Strikers', normalized_prompt: 'navy kit', language: 'en', detected_language: 'en',
  sport: null, sport_source: null, garment: 'jersey', garment_source: 'form', colors: [], patterns: [], themes: [],
  coverage: null, font: null, team_name: { value: 'Strikers', source: 'form' }, player_name: { value: '', source: null },
  number: { value: '7', source: 'prompt' },
  questions: [
    { id: 'sport_missing', field: 'sport', kind: 'missing', message: 'Which sport?', options: [{ value: 'cricket', source: null }] },
    { id: 'team_name_conflict', field: 'team_name', kind: 'conflict', message: '', options: [{ value: 'Strikers', source: 'form' }, { value: 'Kings', source: 'prompt' }] },
  ],
  ready: false,
  ...over,
});

const spec = { garment: 'jersey', style_name: 'A', elements: [], typography: { team_name: '', player_name: '', number: '', font: 'block' } } as unknown as DesignSpec;

function respond(body: unknown, status = 200) {
  const calls: { url: string; body: unknown }[] = [];
  setFetcher((async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch);
  return calls;
}

beforeEach(async () => {
  await setApiUrl('http://localhost:8000');
  useFlow.getState().reset();
});

describe('brief to confirmation', () => {
  it('sends the brief with the language and blocks generation until questions are answered', async () => {
    const calls = respond(understanding());
    useFlow.getState().setBrief({ prompt: 'navy kit for Strikers', team_name: 'Strikers' });
    await useFlow.getState().understand('ta');
    expect(calls[0].url).toMatch(/\/api\/v1\/brief\/understand$/);
    expect(calls[0].body).toMatchObject({ prompt: 'navy kit for Strikers', team_name: 'Strikers', language: 'ta' });

    const s = useFlow.getState();
    expect(unansweredQuestions(s.understanding, s.answers)).toHaveLength(2);
    expect(canGenerate(s)).toBe(false);

    s.answer(s.understanding!.questions[0], 'cricket');
    useFlow.getState().answer(s.understanding!.questions[1], 'Kings');
    const after = useFlow.getState();
    expect(after.confirmed).toMatchObject({ sport: 'cricket', team_name: 'Kings' });
    expect(canGenerate(after)).toBe(true);
  });

  it('typing a value settles the question about that field', async () => {
    respond(understanding());
    useFlow.getState().setBrief({ prompt: 'navy kit' });
    await useFlow.getState().understand('en');
    useFlow.getState().editConfirmed({ team_name: 'Royals', sport: 'football' });
    expect(unansweredQuestions(useFlow.getState().understanding, useFlow.getState().answers)).toHaveLength(0);
  });
});

describe('studio edits', () => {
  it('edits, undoes and redoes; a gesture is a single undo step', () => {
    const f = useFlow.getState();
    f.openDesign({ id: 'd1', spec, variant_index: 0, mockup_svg: '', checks: [], manufacturing_ready: true });
    useFlow.getState().edit({ ...spec, style_name: 'B' });
    useFlow.getState().beginGesture();
    useFlow.getState().live({ ...spec, style_name: 'C1' });
    useFlow.getState().live({ ...spec, style_name: 'C2' });
    useFlow.getState().endGesture();
    expect(currentSpec(useFlow.getState())?.style_name).toBe('C2');
    useFlow.getState().undo();
    expect(currentSpec(useFlow.getState())?.style_name).toBe('B');
    useFlow.getState().undo();
    expect(currentSpec(useFlow.getState())?.style_name).toBe('A');
    useFlow.getState().redo();
    expect(currentSpec(useFlow.getState())?.style_name).toBe('B');
  });

  it('rolls a rating back when the server rejects it', async () => {
    respond({ detail: 'nope' }, 500);
    await expect(useFlow.getState().rate('d1', 4)).rejects.toMatchObject({ kind: 'server' });
    expect(useFlow.getState().ratings.d1).toBeUndefined();
  });
});

describe('idempotency keys', () => {
  it('reuses the key for the same order and issues a new one when the order changes', () => {
    const k1 = useFlow.getState().keyForPayload('hash-a');
    expect(useFlow.getState().keyForPayload('hash-a')).toBe(k1);
    const k2 = useFlow.getState().keyForPayload('hash-b');
    expect(k2).not.toBe(k1);
    expect(k1).toMatch(/^ord_[0-9a-f]{32}$/);
  });
});
