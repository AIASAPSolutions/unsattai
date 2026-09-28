import 'server-only';
import { cookies, headers } from 'next/headers';
import type { Language } from '@/lib/api/types';
import { LANG_COOKIE } from '@/lib/proxy';
import { isLanguage, translate, type T } from './index';

/** Language for server-rendered pages: the customer's choice (cookie), else the browser's, else English. */
export async function serverLanguage(): Promise<Language> {
  const c = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLanguage(c)) return c;
  const accept = (await headers()).get('accept-language') ?? '';
  for (const part of accept.split(',')) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (isLanguage(code)) return code;
  }
  return 'en';
}

export async function serverT(): Promise<{ t: T; lang: Language }> {
  const lang = await serverLanguage();
  return { lang, t: (key, params) => translate(lang, key, params) };
}
