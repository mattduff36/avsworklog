import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const PIN_LENGTH = 4;
const PIN_HASH_ALGORITHM = 'scrypt';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;

export const ACCOUNT_SWITCH_MAX_PIN_ATTEMPTS = 5;
export const ACCOUNT_SWITCH_LOCK_MINUTES = 15;

export interface PinValidationResult {
  isValid: boolean;
  errorMessage: string | null;
}

function isSequentialPin(pin: string): boolean {
  return '0123456789'.includes(pin) || '9876543210'.includes(pin);
}

function isRepeatedPin(pin: string): boolean {
  return new Set(pin.split('')).size === 1;
}

export function validateQuickSwitchPin(pin: string): PinValidationResult {
  const trimmedPin = pin.trim();

  if (!/^\d+$/.test(trimmedPin)) {
    return { isValid: false, errorMessage: 'PIN must contain numbers only' };
  }

  if (trimmedPin.length !== PIN_LENGTH) {
    return {
      isValid: false,
      errorMessage: `PIN must be exactly ${PIN_LENGTH} digits`,
    };
  }

  if (isRepeatedPin(trimmedPin)) {
    return { isValid: false, errorMessage: 'PIN cannot use repeated digits only' };
  }

  if (isSequentialPin(trimmedPin)) {
    return { isValid: false, errorMessage: 'PIN cannot use sequential digits' };
  }

  return { isValid: true, errorMessage: null };
}

export function hashQuickSwitchPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  return [
    PIN_HASH_ALGORITHM,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

function parseStoredPinHash(pinHash: string) {
  const [algorithm, n, r, p, saltBase64, hashBase64] = pinHash.split('$');

  if (
    algorithm !== PIN_HASH_ALGORITHM ||
    !n ||
    !r ||
    !p ||
    !saltBase64 ||
    !hashBase64
  ) {
    throw new Error('Invalid PIN hash format');
  }

  return {
    n: Number(n),
    r: Number(r),
    p: Number(p),
    salt: Buffer.from(saltBase64, 'base64url'),
    hash: Buffer.from(hashBase64, 'base64url'),
  };
}

export function verifyQuickSwitchPin(pin: string, pinHash: string): boolean {
  try {
    const parsed = parseStoredPinHash(pinHash);
    const candidateHash = scryptSync(pin, parsed.salt, parsed.hash.length, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
    });

    if (candidateHash.length !== parsed.hash.length) {
      return false;
    }

    return timingSafeEqual(candidateHash, parsed.hash);
  } catch {
    return false;
  }
}

export function getAccountSwitchLockUntil(baseDate: Date = new Date()): string {
  return new Date(baseDate.getTime() + ACCOUNT_SWITCH_LOCK_MINUTES * 60 * 1000).toISOString();
}

export function isPinLockActive(lockedUntil: string | null): boolean {
  if (!lockedUntil) return false;
  return new Date(lockedUntil).getTime() > Date.now();
}
