function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function newId(prefix: string): string {
  return `${prefix}_${uuid().replace(/-/g, '').slice(0, 10)}`;
}

/** One key per checkout attempt; reused for retries of the same order content. */
export function newIdempotencyKey(): string {
  return `web_${uuid().replace(/-/g, '')}`;
}
