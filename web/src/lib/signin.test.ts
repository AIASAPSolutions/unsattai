import { describe, expect, it } from 'vitest';
import { identifierKind, passwordIssues, signInBody } from './signin';

describe('sign-in helpers', () => {
  it('tells an email from a mobile number', () => {
    expect(identifierKind('asha@example.com')).toBe('email');
    expect(identifierKind(' +91 98765 43210 ')).toBe('phone');
    expect(identifierKind('98765')).toBeNull();
    expect(identifierKind('asha@')).toBeNull();
  });
  it('checks password strength like the server', () => {
    expect(passwordIssues('Better0ne1234')).toEqual([]);
    expect(passwordIssues('short')).toEqual(['length', 'upper', 'digit']);
  });
  it('forwards only known fields', () => {
    expect(signInBody('password', { identifier: ' a@b.co ', password: 'x', token: 'evil' })).toEqual({ identifier: 'a@b.co', password: 'x' });
    expect(signInBody('password', { identifier: '', password: 'x' })).toBeNull();
    expect(signInBody('otp', { email: 'a@b.co', code: '123456', name: 'Asha', extra: 1 })).toEqual({ email: 'a@b.co', code: '123456', name: 'Asha' });
    expect(signInBody('otp', { phone: '98765', code: '123456' })).toEqual({ phone: '98765', code: '123456', name: '' });
    expect(signInBody('otp', { phone: '98765', email: 'a@b.co', code: '1' })).toBeNull();
    expect(signInBody('otp', { phone: '98765' })).toBeNull();
    expect(signInBody('otp', null)).toBeNull();
  });
});
