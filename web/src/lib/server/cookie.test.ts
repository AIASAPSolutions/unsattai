import { describe, expect, it } from 'vitest';
import { cookieSecure } from './cookie';

describe('cookieSecure', () => {
  it('follows NODE_ENV unless UNSATTAI_COOKIE_SECURE says otherwise', () => {
    expect(cookieSecure({ NODE_ENV: 'production' })).toBe(true);
    expect(cookieSecure({ NODE_ENV: 'development' })).toBe(false);
    expect(cookieSecure({ NODE_ENV: 'production', UNSATTAI_COOKIE_SECURE: '0' })).toBe(false);
    expect(cookieSecure({ NODE_ENV: 'development', UNSATTAI_COOKIE_SECURE: 'true' })).toBe(true);
  });
});
