import { setApiKey, setApiUrl } from '../api/config';
import { ApiError, parseErrorBody, request, setFetcher, withRetry } from '../api/client';
import { api } from '../api/endpoints';

type Call = { url: string; init: RequestInit };

function mockFetch(responses: (() => Response | Promise<Response>)[]) {
  const calls: Call[] = [];
  let i = 0;
  setFetcher((async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses[Math.min(i++, responses.length - 1)];
    return next();
  }) as unknown as typeof fetch);
  return calls;
}

const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(async () => {
  await setApiUrl('http://10.0.2.2:8000/');
  await setApiKey(null);
});

describe('request serialization', () => {
  it('posts JSON to the configured base URL and sends the API key from secure storage', async () => {
    await setApiKey('secret-key');
    const calls = mockFetch([json(200, { ok: true })]);
    await request('POST', '/api/v1/render', { body: { spec: { garment: 'jersey' }, sizes: ['M'] } });
    expect(calls[0].url).toBe('http://10.0.2.2:8000/api/v1/render');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-API-Key']).toBe('secret-key');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ spec: { garment: 'jersey' }, sizes: ['M'] });
  });

  it('omits the key header when no key is stored', async () => {
    const calls = mockFetch([json(200, {})]);
    await request('GET', '/api/v1/health');
    expect((calls[0].init.headers as Record<string, string>)['X-API-Key']).toBeUndefined();
    expect(calls[0].init.body).toBeUndefined();
  });

  it('keeps unknown spec fields when sending a spec back', async () => {
    const calls = mockFetch([json(200, { panels: [] })]);
    const spec = { garment: 'jersey', future_field: { a: 1 }, palette: { primary: '#000000', future_role: '#111111' } };
    await api.panels(spec as never, false, ['XL']);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.spec.future_field).toEqual({ a: 1 });
    expect(body.spec.palette.future_role).toBe('#111111');
    expect(body).toMatchObject({ include_elements: false, sizes: ['XL'] });
  });
});

describe('error mapping', () => {
  it('maps pydantic field errors to a validation error with paths', () => {
    const e = parseErrorBody(422, { detail: [{ loc: ['body', 'items', 0, 'number'], msg: 'Value error, bad number' }] });
    expect(e.kind).toBe('validation');
    expect(e.fields[0]).toEqual({ path: 'items.0.number', message: 'bad number' });
  });

  it('maps order manufacturing failures to blocked and keeps the failures', () => {
    const e = parseErrorBody(422, { detail: { message: 'fail', failures: [{ line: 1, checks: [] }] } });
    expect(e.kind).toBe('blocked');
    expect((e.data as { failures: unknown[] }).failures).toHaveLength(1);
  });

  it.each([[401, 'auth'], [404, 'not_found'], [409, 'conflict'], [413, 'too_large'], [503, 'server'], [418, 'http']])(
    'status %i -> %s', (status, kind) => expect(parseErrorBody(status, { detail: 'x' }).kind).toBe(kind),
  );

  it('reports an unreachable server as a network error', async () => {
    mockFetch([() => { throw new TypeError('Network request failed'); }]);
    await expect(request('GET', '/api/v1/health')).rejects.toMatchObject({ kind: 'network', retryable: true });
  });

  it('reports a slow server as a timeout', async () => {
    setFetcher(((_u: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch);
    await expect(request('GET', '/api/v1/health', { timeoutMs: 20 })).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('withRetry', () => {
  it('retries retryable errors and then succeeds', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new ApiError('network', 'down'))
      .mockRejectedValueOnce(new ApiError('server', '500'))
      .mockResolvedValue('ok');
    await expect(withRetry(fn, 3, 1)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry validation or blocked errors', async () => {
    const fn = jest.fn().mockRejectedValue(new ApiError('validation', 'bad'));
    await expect(withRetry(fn, 3, 1)).rejects.toMatchObject({ kind: 'validation' });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
