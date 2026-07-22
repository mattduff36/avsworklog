'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  LogIn,
  PackageOpen,
  RefreshCw,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  type YardKioskRecoveryAction,
  type YardKioskUserError,
  buildYardKioskUserError,
  type YardKioskErrorCode,
} from '@/lib/inventory/kiosk-errors';
import { forceAppRefresh } from '@/lib/client/force-app-refresh';

interface YardKioskRecoveryScreenProps {
  error: YardKioskUserError;
  busy?: boolean;
  onAction?: (action: YardKioskRecoveryAction) => void | Promise<void>;
}

const ACTION_LABELS: Record<YardKioskRecoveryAction, string> = {
  retry: 'Try again',
  check_connection: 'Check connection',
  refresh_app: 'Refresh app',
  return_to_pairing: 'Open pairing',
  sign_in: 'Sign in',
  dismiss: 'Dismiss',
  reload_stock: 'Refresh stock',
  contact_manager: 'Ask a manager',
};

export function resolveRecoveryError(
  code: string | null | undefined,
  diagnosticId?: string,
): YardKioskUserError {
  const allowed = new Set([
    'OFFLINE',
    'FLAKY_CONNECTION',
    'APP_UPDATE_REQUIRED',
    'SESSION_MISSING',
    'SESSION_EXPIRED',
    'SESSION_REVOKED',
    'DEVICE_UNPAIRED',
    'DEVICE_REVOKED',
    'DEVICE_CREDENTIAL_USED',
    'PAIRING_NOT_STARTED',
    'PAIRING_EXPIRED',
    'PAIRING_CLAIMED',
    'PAIRING_MISMATCH',
    'PAIRING_CANCELLED',
    'ACTIVATION_FAILED',
    'KIOSK_DISABLED',
    'WRONG_PROFILE',
    'YARD_MISSING',
    'SERVICE_UNAVAILABLE',
    'STOCK_LOAD_FAILED',
    'STOCK_STALE',
    'INVENTORY_CHECK_REQUIRED',
    'SUBMIT_FAILED',
    'SUBMIT_UNCERTAIN',
    'MALFORMED_RESPONSE',
    'UNSUPPORTED_VIEWPORT',
    'REMOTE_RESET',
    'REMOTE_LOGOUT',
    'REMOTE_REPAIR',
    'UNKNOWN',
  ]);
  const resolved = code && allowed.has(code)
    ? (code as YardKioskErrorCode)
    : 'UNKNOWN';
  return buildYardKioskUserError(resolved, { diagnosticId });
}

async function defaultAction(
  action: YardKioskRecoveryAction,
): Promise<void> {
  switch (action) {
    case 'retry':
      window.location.replace('/yard-kiosk/activate');
      return;
    case 'check_connection':
      window.location.replace('/yard-kiosk/recover?code=OFFLINE');
      return;
    case 'refresh_app':
      await forceAppRefresh({ redirectTo: '/yard-kiosk' });
      return;
    case 'return_to_pairing':
      window.location.replace('/yard-kiosk/pair');
      return;
    case 'sign_in':
      window.location.replace('/login?redirect=%2Fyard-kiosk');
      return;
    case 'reload_stock':
      window.location.replace('/yard-kiosk');
      return;
    case 'contact_manager':
    case 'dismiss':
    default:
      return;
  }
}

export function YardKioskRecoveryScreen({
  error,
  busy = false,
  onAction,
}: YardKioskRecoveryScreenProps) {
  const isInfo = error.severity === 'info';

  return (
    <main className="fixed inset-x-0 top-0 z-[100] grid h-[var(--yard-kiosk-viewport-height,100svh)] place-items-center overflow-hidden bg-slate-950 p-6 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(251,191,36,0.16),transparent_34%),radial-gradient(circle_at_85%_85%,rgba(14,165,233,0.1),transparent_30%)]" />
      <section className="relative w-full max-w-2xl overflow-hidden rounded-[2rem] border border-white/10 bg-slate-900/85 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <div className="h-2 bg-amber-300" />
        <div className="p-8 text-center sm:p-10">
          <div className="mx-auto flex w-fit items-center gap-3 rounded-2xl bg-amber-300 px-5 py-3 text-slate-950">
            <PackageOpen className="h-7 w-7" />
            <span className="text-xl font-black">Yard Inventory</span>
          </div>

          {isInfo ? (
            <CheckCircle2 className="mx-auto mt-8 h-14 w-14 text-emerald-300" />
          ) : (
            <AlertTriangle className="mx-auto mt-8 h-14 w-14 text-amber-300" />
          )}

          <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
            {error.title}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-lg leading-relaxed text-slate-300">
            {error.whatHappened}
          </p>
          <p className="mx-auto mt-2 max-w-xl text-base leading-relaxed text-slate-400">
            {error.whatToDoNext}
          </p>

          <div className="mx-auto mt-6 flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-amber-300" />
            Ref {error.diagnosticId}
          </div>

          <div className="mx-auto mt-8 flex w-full max-w-lg flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
            {error.actions.map((action) => {
              if (action === 'contact_manager') {
                return (
                  <p
                    key={action}
                    className="w-full text-sm text-slate-500 sm:order-last"
                  >
                    Tell your Inventory manager the reference code above.
                  </p>
                );
              }

              const Icon = action === 'check_connection'
                ? Wifi
                : action === 'sign_in'
                  ? LogIn
                  : RefreshCw;

              return (
                <Button
                  key={action}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void (onAction ? onAction(action) : defaultAction(action));
                  }}
                  className="h-14 flex-1 rounded-xl bg-amber-300 px-6 text-base font-black text-slate-950 hover:bg-amber-200 disabled:opacity-60"
                >
                  {busy ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <Icon className="mr-2 h-5 w-5" />
                  )}
                  {ACTION_LABELS[action]}
                </Button>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
