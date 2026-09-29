/** Whether session cookies need HTTPS. UJ_COOKIE_SECURE=0 allows testing a production build over plain http. */
export function cookieSecure(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.UJ_COOKIE_SECURE || '').trim().toLowerCase();
  if (v) return !['0', 'false', 'no', 'off'].includes(v);
  return env.NODE_ENV === 'production';
}
