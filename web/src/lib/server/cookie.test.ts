import { describe, expect, it } from 'vitest';
import { cookieSecure } from './cookie';

describe('cookieSecure', () => {
  it('follows NODE_ENV unless UJ_COOKIE_SECURE says otherwise', () => {
    expect(cookieSecure({ NODE_ENV: 'production' })).toBe(true);
    expect(cookieSecure({ NODE_ENV: 'development' })).toBe(false);
    expect(cookieSecure({ NODE_ENV: 'production', UJ_COOKIE_SECURE: '0' })).toBe(false);
    expect(cookieSecure({ NODE_ENV: 'development', UJ_COOKIE_SECURE: 'true' })).toBe(true);
  });
});
