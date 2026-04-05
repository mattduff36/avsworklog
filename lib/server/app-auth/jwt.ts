const encoder = new TextEncoder();

function toBase64(input: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input).toString('base64');
  }

  let binary = '';
  input.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(input: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(input, 'base64'));
  }

  const binary = atob(input);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

export function toBase64Url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = padded.length % 4;
  const normalized = remainder === 0 ? padded : `${padded}${'='.repeat(4 - remainder)}`;
  return fromBase64(normalized);
}

function toArrayBuffer(input: Uint8Array): ArrayBuffer {
  return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign', 'verify']
  );
}

export async function signJwtHS256(
  payload: Record<string, unknown>,
  secret: string,
  header: Record<string, unknown> = {}
): Promise<string> {
  const encodedHeader = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT', ...header }));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyJwtHS256<TPayload extends Record<string, unknown>>(
  token: string,
  secret: string
): Promise<TPayload | null> {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return null;
  }

  try {
    const headerJson = new TextDecoder().decode(fromBase64Url(encodedHeader));
    const header = JSON.parse(headerJson) as { alg?: string };
    if (header.alg !== 'HS256') {
      return null;
    }

    const key = await importHmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      toArrayBuffer(fromBase64Url(encodedSignature)),
      encoder.encode(`${encodedHeader}.${encodedPayload}`)
    );

    if (!valid) {
      return null;
    }

    const payloadJson = new TextDecoder().decode(fromBase64Url(encodedPayload));
    const payload = JSON.parse(payloadJson) as TPayload & { exp?: unknown };
    if (typeof payload.exp === 'number' && payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function randomToken(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return toBase64Url(value);
}
