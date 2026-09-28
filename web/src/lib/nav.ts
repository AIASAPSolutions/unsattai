/** Only same-site paths are followed after sign-in (no "//evil.example" or absolute URLs). */
export function safeNext(next: string | null | undefined, fallback = '/account'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.startsWith('/api/')) return fallback;
  if (next.startsWith('/signin')) return fallback;
  return next;
}
