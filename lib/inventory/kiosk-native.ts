'use client';

interface NativeBridgeMessage {
  id: string | null;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: {
    code?: string;
    message?: string;
  };
}

interface NativeBridge {
  postMessage: (message: string) => void;
  onmessage: ((event: MessageEvent<string>) => void) | null;
}

interface NativeRequestProof {
  device_id: string;
  request_id: string;
  issued_at: number;
  signature: string;
}

declare global {
  interface Window {
    yardKioskNative?: NativeBridge;
  }
}

const NATIVE_CALL_TIMEOUT_MS = 15_000;
const pendingCalls = new Map<string, {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();
let listenerBridge: NativeBridge | null = null;

function ensureNativeListener(bridge: NativeBridge): void {
  if (listenerBridge === bridge) return;
  bridge.onmessage = (event) => {
    let message: NativeBridgeMessage;
    try {
      message = JSON.parse(event.data) as NativeBridgeMessage;
    } catch {
      return;
    }
    if (!message.id) return;
    const pending = pendingCalls.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingCalls.delete(message.id);
    if (message.ok && message.result) {
      pending.resolve(message.result);
      return;
    }
    pending.reject(new Error(
      message.error?.message || 'The native Yard kiosk identity request failed',
    ));
  };
  listenerBridge = bridge;
}

export function hasNativeKioskBridge(): boolean {
  return typeof window !== 'undefined'
    && typeof window.yardKioskNative?.postMessage === 'function';
}

export async function callNativeKiosk(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const bridge = window.yardKioskNative;
  if (!bridge) throw new Error('Open Yard Inventory from the installed Android app');
  ensureNativeListener(bridge);

  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCalls.delete(id);
      reject(new Error('The native Yard kiosk identity request timed out'));
    }, NATIVE_CALL_TIMEOUT_MS);
    pendingCalls.set(id, { resolve, reject, timeout });
    bridge.postMessage(JSON.stringify({ id, action, payload }));
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function bodyAsString(body: BodyInit | null | undefined): string {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  throw new Error('Native Yard kiosk requests require a string request body');
}

export async function kioskFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  if (!hasNativeKioskBridge()) return fetch(input, init);

  const url = new URL(input.toString(), window.location.origin);
  if (url.origin !== window.location.origin) {
    throw new Error('Yard kiosk requests must stay on the application origin');
  }
  const method = (init.method || 'GET').toUpperCase();
  const body = bodyAsString(init.body);
  const proof = await callNativeKiosk('request.sign', {
    method,
    path: `${url.pathname}${url.search}`,
    body_sha256: await sha256Hex(body),
  }) as unknown as NativeRequestProof;

  const headers = new Headers(init.headers);
  headers.set('X-Yard-Kiosk-Device-Id', proof.device_id);
  headers.set('X-Yard-Kiosk-Request-Id', proof.request_id);
  headers.set('X-Yard-Kiosk-Issued-At', String(proof.issued_at));
  headers.set('X-Yard-Kiosk-Signature', proof.signature);

  return fetch(url, {
    ...init,
    headers,
  });
}
