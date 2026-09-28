import * as Crypto from 'expo-crypto';

export function newId(prefix: string): string {
  return `${prefix}_${Crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

/** One key per order attempt; kept with the draft so retries and double taps reuse it. */
export function newIdempotencyKey(): string {
  return `ord_${Crypto.randomUUID().replace(/-/g, '')}`;
}
