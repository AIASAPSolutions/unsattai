import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { setApiKey, setApiUrl } from '../api/config';
import { ApiError, parseErrorBody, request, setFetcher } from '../api/client';
import { api } from '../api/endpoints';
import { getSessionToken, resetSessionCache, setSessionToken } from '../api/session';
import type { Me } from '../api/types';
import {
  displayIdentifier, guessKind, isCode, isEmail, normalizeMobile, passwordProblems, toIdentifier,
} from '../features/account/identifier';
import { errorMessage, translate } from '../i18n';
import { canResetPassword, useAuth } from '../state/auth';
import { useCart } from '../state/cart';

const t = ((key: string, params?: Record<string, string | number>) => translate('en', key as never, params)) as Parameters<typeof errorMessage>[0];

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
function server(handler: (c: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  setFetcher((async (url: string, init: RequestInit) => {
    const c = { method: String(init.method), url, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const r = handler(c);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch);
  return calls;
}

const me = (over: Partial<Me> = {}): Me => ({
  id: 'cus_1', name: 'Priya', phone: '', email: 'priya@example.com', addresses: [], marketing_opt_in: false, orders_count: 0,
  phone_verified: false, email_verified: true, has_password: false, ...over,
} as Me);

beforeEach(async () => {
  await setApiUrl('http://localhost:8000');
  await setApiKey(null);
  await setSessionToken(null);
  useAuth.setState({ status: 'guest', customer: null, expired: false, unread: 0, codeSignInAt: null });
  useCart.getState().signOut();
});

describe('session token', () => {
  it('keeps the token in secure storage and survives a restart', async () => {
    await setSessionToken(' tok-123 ');
    expect(await SecureStore.getItemAsync('unsattai.session')).toBe('tok-123');
    resetSessionCache();
    expect(await getSessionToken()).toBe('tok-123');
    await setSessionToken(null);
    expect(await SecureStore.getItemAsync('unsattai.session')).toBeNull();
  });

  it('keeps the token in memory only on web', async () => {
    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    try {
      await setSessionToken('web-tok');
      expect(await SecureStore.getItemAsync('unsattai.session')).toBeNull();
      resetSessionCache();
      expect(await getSessionToken()).toBe('web-tok');
      await setSessionToken(null);
    } finally {
      Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
    }
  });

  it('sends the token as a Bearer header, but not on sign-in calls', async () => {
    const calls = server(() => ({ body: {} }));
    await request('GET', '/api/v1/health');
    expect(calls[0].headers.Authorization).toBeUndefined();
    await setSessionToken('tok-abc');
    await api.me();
    expect(calls[1].headers.Authorization).toBe('Bearer tok-abc');
    await api.login('priya@example.com', 'pw');
    await api.requestCode({ phone: '+919876543210' });
    expect(calls[2].headers.Authorization).toBeUndefined();
    expect(calls[3].headers.Authorization).toBeUndefined();
    expect(calls[2].body).toEqual({ identifier: 'priya@example.com', password: 'pw' });
  });
});

describe('sign-in', () => {
  it('stores the token, merges the cart and counts unread notifications', async () => {
    useCart.getState().add({ item: { product_id: 'p1', fabric: 'poly_dryfit', lines: [{ player_name: '', number: '', size: 'M', quantity: 1 }] }, title: 'Kit' });
    const calls = server((c) => {
      if (c.url.endsWith('/auth/otp/verify')) return { body: { token: 'tok-new', expires_at: '', session_id: 's1', customer: me() } };
      if (c.url.endsWith('/me/cart/merge')) return { body: { items: (c.body as { items: unknown[] }).items, max_items: 20 } };
      if (c.url.includes('/me/wishlist')) return { body: { product_ids: [], items: [] } };
      if (c.url.includes('/me/notifications')) return { body: { notifications: [], unread: 2, total: 0, page: 1 } };
      return { status: 404, body: { detail: 'no' } };
    });
    const res = await api.verifyCode({ email: 'priya@example.com' }, '123456', 'Priya');
    expect(calls[0].body).toEqual({ email: 'priya@example.com', code: '123456', name: 'Priya' });
    await useAuth.getState().completeSignIn(res, 'code');
    expect(await getSessionToken()).toBe('tok-new');
    expect(useAuth.getState()).toMatchObject({ status: 'signedIn', unread: 2, customer: { name: 'Priya' } });
    expect(canResetPassword(useAuth.getState().codeSignInAt)).toBe(true);
    expect(canResetPassword(Date.now() - 20 * 60_000)).toBe(false);
    const merge = calls.find((c) => c.url.endsWith('/me/cart/merge'));
    expect(merge?.headers.Authorization).toBe('Bearer tok-new');
    expect(useCart.getState().remote).toBe(true);
  });

  it('signs out everywhere on this device when a signed-in request gets a 401', async () => {
    await setSessionToken('tok-old');
    useAuth.setState({ status: 'signedIn', customer: me() });
    server(() => ({ status: 401, body: { detail: 'Session expired. Please sign in again.' } }));
    const err = await api.myOrders().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).sessionExpired).toBe(true);
    expect(errorMessage(t, err)).toBe(t('errSessionExpired'));
    await new Promise((r) => setTimeout(r, 0));
    expect(useAuth.getState()).toMatchObject({ status: 'guest', expired: true, customer: null });
    expect(await getSessionToken()).toBeNull();
  });

  it('does not treat a missing API key as a lost session', async () => {
    await setSessionToken('tok-ok');
    useAuth.setState({ status: 'signedIn', customer: me() });
    server(() => ({ status: 401, body: { detail: 'invalid or missing X-API-Key' } }));
    const err = await api.me().catch((e) => e);
    expect((err as ApiError).sessionExpired).toBe(false);
    expect(errorMessage(t, err)).toBe(t('errAuth'));
    expect(useAuth.getState().status).toBe('signedIn');
  });

  it('restores a saved session on start and drops a rejected one', async () => {
    await setSessionToken('tok-saved');
    server((c) => (c.url.endsWith('/api/v1/me') ? { body: me({ name: 'Arul' }) } : { body: { items: [], product_ids: [], unread: 0, max_items: 20 } }));
    useAuth.setState({ status: 'unknown' });
    await useAuth.getState().restore();
    expect(useAuth.getState()).toMatchObject({ status: 'signedIn', customer: { name: 'Arul' } });

    server(() => ({ status: 401, body: { detail: 'Please sign in.' } }));
    useAuth.setState({ status: 'unknown' });
    await useAuth.getState().restore();
    expect(useAuth.getState().status).toBe('guest');
    expect(await getSessionToken()).toBeNull();
  });
});

describe('identifiers', () => {
  it('normalises Indian mobile numbers and emails', () => {
    expect(normalizeMobile('98765 43210')).toBe('+919876543210');
    expect(normalizeMobile('+91-98765-43210')).toBe('+919876543210');
    expect(normalizeMobile('098765 43210')).toBe('+919876543210');
    expect(normalizeMobile('12345 67890')).toBeNull();
    expect(toIdentifier('email', ' Priya@Example.com ')).toEqual({ email: 'priya@example.com' });
    expect(toIdentifier('email', 'priya@')).toBeNull();
    expect(toIdentifier('phone', '9876543210')).toEqual({ phone: '+919876543210' });
    expect(isEmail('a@b.in')).toBe(true);
    expect(guessKind('a@b.in')).toBe('email');
    expect(guessKind('98765')).toBe('phone');
    expect(displayIdentifier({ phone: '+919876543210' })).toBe('+91 98765 43210');
    expect(isCode('१२३४५६')).toBe(true);
    expect(isCode('12')).toBe(false);
  });

  it('checks the password rules the server uses', () => {
    expect(passwordProblems('short')).toEqual(['length', 'upper', 'digit']);
    expect(passwordProblems('Longenough1')).toEqual([]);
  });
});

describe('account error messages', () => {
  const msg = (status: number, detail: unknown) => errorMessage(t, parseErrorBody(status, { detail }));

  it('tells wrong codes, expired codes and wrong passwords apart (401)', () => {
    expect(msg(401, 'That code is not right.')).toBe(t('errWrongCode'));
    expect(msg(401, 'The code has expired. Ask for a new one.')).toBe(t('errCodeExpired'));
    expect(msg(401, 'The mobile number, email or password is not right.')).toBe(t('errWrongPassword'));
    expect(msg(401, 'Your current password is not right. Forgot it? Sign in with a code, then set a new one.')).toBe(t('errCurrentPassword'));
    expect(msg(401, 'Please sign in.')).toBe(t('errSignInNeeded'));
  });

  it('explains a blocked account (403) and a locked one (423)', () => {
    expect(parseErrorBody(403, { detail: 'blocked' }).kind).toBe('forbidden');
    expect(msg(403, 'This account is blocked. Contact support.')).toBe(t('errBlocked'));
    expect(parseErrorBody(423, { detail: 'locked' }).kind).toBe('locked');
    expect(msg(423, 'Locked')).toBe(t('errLocked'));
  });

  it('says which identifier conflict happened (409)', () => {
    expect(msg(409, 'This email belongs to another account.')).toBe(t('errIdentifierTaken'));
    expect(msg(409, 'This order can no longer be cancelled.')).toBe(t('errCannotChange', { detail: 'This order can no longer be cancelled.' }));
  });

  it('tells the three kinds of 429 apart from AI quotas', () => {
    expect(msg(429, 'Too many wrong passwords. Try again in 15 minutes, or sign in with a code.')).toBe(t('errLocked'));
    expect(msg(429, 'Too many wrong codes. Ask for a new one.')).toBe(t('errTooManyCodes'));
    expect(msg(429, 'Please wait a few seconds before asking for another code.')).toBe(t('errCodeWait'));
    expect(msg(429, 'Slow down')).toBe(t('errTooMany'));
    expect(msg(429, { message: 'used up', code: 'ai_quota' })).toMatch(/free AI edits/);
  });

  it('turns serviceability reason codes into plain words (422)', () => {
    expect(msg(422, { message: 'x', code: 'not_serviceable' })).toBe(t('errNotServiceable'));
    expect(msg(422, 'Password must have an upper-case letter.')).toBe(t('errWeakPassword', { detail: 'Password must have an upper-case letter.' }));
  });
});
