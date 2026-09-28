/** Turning API error responses into messages people can act on. Pure: unit tested. */

export interface FieldError {
  /** Dotted path inside the edited value, e.g. "fabrics.0.id". "" means the whole form. */
  path: string;
  message: string;
}

export class ApiError extends Error {
  status: number;
  fields: FieldError[];
  body: unknown;
  constructor(status: number, message: string, fields: FieldError[] = [], body: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields;
    this.body = body;
  }
  get isForbidden() { return this.status === 403; }
  get isConflict() { return this.status === 409; }
  get isUnauthorized() { return this.status === 401; }
}

/**
 * FastAPI / pydantic loc -> dotted path relative to the edited value.
 * ["body", "value", "fabrics", 0, "id"] -> "fabrics.0.id"; ["body", "fabrics", "0"] -> "fabrics.0";
 * ["body"] or ["body", ""] -> "". `strip` removes extra leading segments (e.g. "request").
 */
export function locToPath(loc: unknown, strip: string[] = ['body', 'value']): string {
  if (!Array.isArray(loc)) return '';
  const parts = loc.map((p) => String(p)).filter((p) => p !== '');
  let i = 0;
  while (i < parts.length && strip.includes(parts[i]) && i < strip.length) i++;
  return parts.slice(i).join('.');
}

const FRIENDLY: [RegExp, string][] = [
  [/^Field required$/i, 'Required.'],
  [/^Input should be a valid number.*/i, 'Enter a number.'],
  [/^Input should be a valid integer.*/i, 'Enter a whole number.'],
  [/^Extra inputs are not permitted$/i, 'Not an allowed field.'],
];

export function friendly(msg: string): string {
  const m = msg.replace(/^Value error, /, '');
  for (const [re, out] of FRIENDLY) if (re.test(m)) return out;
  return m.charAt(0).toUpperCase() + m.slice(1);
}

export function statusMessage(status: number): string {
  switch (status) {
    case 0: return 'Could not reach the server. Check your connection and the API address.';
    case 401: return 'Please sign in again.';
    case 403: return 'Your role does not allow this.';
    case 404: return 'Not found.';
    case 409: return 'This was changed by someone else or is no longer possible.';
    case 413: return 'The request is too large.';
    case 422: return 'Some values are not valid.';
    case 429: return 'Too many requests. Wait a moment and try again.';
    default: return status >= 500 ? 'The server had a problem. Try again in a moment.' : `Request failed (${status}).`;
  }
}

/** Build an ApiError from a status and a parsed JSON body (or text). */
export function toApiError(status: number, body: unknown, strip?: string[]): ApiError {
  const detail = body && typeof body === 'object' ? (body as { detail?: unknown }).detail : undefined;
  if (typeof detail === 'string') return new ApiError(status, detail, [], body);
  if (Array.isArray(detail)) {
    const fields: FieldError[] = detail.map((d) => ({
      path: locToPath((d as { loc?: unknown }).loc, strip),
      message: friendly(String((d as { msg?: unknown }).msg ?? 'Not valid')),
    }));
    const head = fields.length === 1
      ? (fields[0].path ? `${fields[0].path}: ${fields[0].message}` : fields[0].message)
      : `${fields.length} values need attention.`;
    return new ApiError(status, head, fields, body);
  }
  if (detail && typeof detail === 'object') {
    const m = (detail as { message?: unknown }).message;
    if (typeof m === 'string') return new ApiError(status, m, [], body);
  }
  if (typeof body === 'string' && body.trim() && body.length < 300 && !body.trim().startsWith('<')) {
    return new ApiError(status, body.trim(), [], body);
  }
  return new ApiError(status, statusMessage(status), [], body);
}

/** Message for any thrown value, with the role explained on 403. */
export function errorText(e: unknown, role?: string): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return role ? `Not allowed for your role (${role}): ${e.message}` : e.message;
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Group field errors by path; a path also matches its parents' prefix lookups. */
export function errorsByPath(fields: FieldError[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of fields) (out[f.path] ??= []).push(f.message);
  return out;
}

/** Errors at `path` exactly (own) — and, with deep, at anything under it. */
export function errorsAt(map: Record<string, string[]>, path: string, deep = false): string[] {
  if (!deep) return map[path] ?? [];
  const pre = path ? `${path}.` : '';
  return Object.entries(map).filter(([k]) => k === path || k.startsWith(pre)).flatMap(([, v]) => v);
}
