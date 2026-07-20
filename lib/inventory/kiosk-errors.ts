/**
 * Yard Inventory kiosk error catalogue.
 * Codes are stable for /debug and remote diagnostics.
 * User-facing copy is plain English only.
 */

export type YardKioskErrorCode =
  | 'OFFLINE'
  | 'FLAKY_CONNECTION'
  | 'APP_UPDATE_REQUIRED'
  | 'SESSION_MISSING'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  | 'DEVICE_UNPAIRED'
  | 'DEVICE_REVOKED'
  | 'DEVICE_CREDENTIAL_USED'
  | 'PAIRING_NOT_STARTED'
  | 'PAIRING_EXPIRED'
  | 'PAIRING_CLAIMED'
  | 'PAIRING_MISMATCH'
  | 'PAIRING_CANCELLED'
  | 'ACTIVATION_FAILED'
  | 'KIOSK_DISABLED'
  | 'WRONG_PROFILE'
  | 'YARD_MISSING'
  | 'SERVICE_UNAVAILABLE'
  | 'STOCK_LOAD_FAILED'
  | 'STOCK_STALE'
  | 'INVENTORY_CHECK_REQUIRED'
  | 'SUBMIT_FAILED'
  | 'SUBMIT_UNCERTAIN'
  | 'MALFORMED_RESPONSE'
  | 'UNSUPPORTED_VIEWPORT'
  | 'REMOTE_RESET'
  | 'REMOTE_LOGOUT'
  | 'REMOTE_REPAIR'
  | 'UNKNOWN';

export type YardKioskErrorSeverity = 'info' | 'warning' | 'error' | 'blocking';

export type YardKioskRecoveryAction =
  | 'retry'
  | 'check_connection'
  | 'refresh_app'
  | 'return_to_pairing'
  | 'sign_in'
  | 'dismiss'
  | 'reload_stock'
  | 'contact_manager';

export interface YardKioskErrorDefinition {
  code: YardKioskErrorCode;
  severity: YardKioskErrorSeverity;
  title: string;
  whatHappened: string;
  whatToDoNext: string;
  actions: YardKioskRecoveryAction[];
  preservesBasket: boolean;
  retryable: boolean;
}

export interface YardKioskUserError {
  code: YardKioskErrorCode;
  title: string;
  whatHappened: string;
  whatToDoNext: string;
  actions: YardKioskRecoveryAction[];
  preservesBasket: boolean;
  retryable: boolean;
  severity: YardKioskErrorSeverity;
  diagnosticId: string;
  /** Optional detail for managers/debug only — never shown as the primary tablet message. */
  technicalDetail?: string;
}

const CATALOGUE: Record<YardKioskErrorCode, Omit<YardKioskErrorDefinition, 'code'>> = {
  OFFLINE: {
    severity: 'warning',
    title: 'No internet connection',
    whatHappened: 'This tablet is offline, so Yard Inventory cannot load or move stock.',
    whatToDoNext: 'Reconnect to Wi‑Fi, then tap Try again.',
    actions: ['check_connection', 'retry'],
    preservesBasket: true,
    retryable: true,
  },
  FLAKY_CONNECTION: {
    severity: 'warning',
    title: 'Connection problem',
    whatHappened: 'The tablet could not reach Yard Inventory reliably.',
    whatToDoNext: 'Check Wi‑Fi signal, wait a moment, then tap Try again.',
    actions: ['check_connection', 'retry'],
    preservesBasket: true,
    retryable: true,
  },
  APP_UPDATE_REQUIRED: {
    severity: 'info',
    title: 'App update needed',
    whatHappened: 'A newer version of Yard Inventory is available.',
    whatToDoNext: 'Tap Refresh app to load the latest version. Unfinished baskets are cleared.',
    actions: ['refresh_app'],
    preservesBasket: false,
    retryable: false,
  },
  SESSION_MISSING: {
    severity: 'blocking',
    title: 'Sign-in required',
    whatHappened: 'This tablet is not signed in to Yard Inventory.',
    whatToDoNext: 'If this tablet is paired, open Yard Inventory again. Otherwise ask an Inventory manager to pair it.',
    actions: ['retry', 'return_to_pairing', 'sign_in'],
    preservesBasket: false,
    retryable: true,
  },
  SESSION_EXPIRED: {
    severity: 'blocking',
    title: 'Session ended',
    whatHappened: 'The automatic Yard Inventory sign-in has expired.',
    whatToDoNext: 'Tap Try again so the tablet can sign back in. If that fails, ask a manager to pair the tablet again.',
    actions: ['retry', 'return_to_pairing', 'sign_in'],
    preservesBasket: false,
    retryable: true,
  },
  SESSION_REVOKED: {
    severity: 'blocking',
    title: 'Access was removed',
    whatHappened: 'An Inventory manager ended this tablet’s Yard Inventory access.',
    whatToDoNext: 'Ask an Inventory manager to pair this tablet again.',
    actions: ['return_to_pairing', 'contact_manager'],
    preservesBasket: false,
    retryable: false,
  },
  DEVICE_UNPAIRED: {
    severity: 'blocking',
    title: 'Tablet not paired',
    whatHappened: 'This tablet is not set up as a trusted Yard Inventory kiosk.',
    whatToDoNext: 'Ask an Inventory manager to start pairing in Inventory Settings, then open pairing on this tablet.',
    actions: ['return_to_pairing', 'contact_manager'],
    preservesBasket: false,
    retryable: false,
  },
  DEVICE_REVOKED: {
    severity: 'blocking',
    title: 'Tablet access revoked',
    whatHappened: 'Trusted access for this tablet was revoked.',
    whatToDoNext: 'Ask an Inventory manager to pair this tablet again before using Yard Inventory.',
    actions: ['return_to_pairing', 'contact_manager'],
    preservesBasket: false,
    retryable: false,
  },
  DEVICE_CREDENTIAL_USED: {
    severity: 'warning',
    title: 'Sign-in already used',
    whatHappened: 'Another sign-in attempt used this tablet’s saved login at the same time.',
    whatToDoNext: 'Tap Try again once. Keep only one Yard Inventory window open on this tablet.',
    actions: ['retry'],
    preservesBasket: false,
    retryable: true,
  },
  PAIRING_NOT_STARTED: {
    severity: 'warning',
    title: 'Pairing not started yet',
    whatHappened: 'No manager pairing window is open for this kiosk.',
    whatToDoNext: 'Ask an Inventory manager to open Settings and start Yard kiosk pairing, then tap Try again.',
    actions: ['retry', 'contact_manager'],
    preservesBasket: false,
    retryable: true,
  },
  PAIRING_EXPIRED: {
    severity: 'warning',
    title: 'Pairing window expired',
    whatHappened: 'The pairing window timed out before this tablet finished setup.',
    whatToDoNext: 'Ask an Inventory manager to start a new pairing window, then tap Try again.',
    actions: ['retry', 'contact_manager'],
    preservesBasket: false,
    retryable: true,
  },
  PAIRING_CLAIMED: {
    severity: 'warning',
    title: 'Pairing already in use',
    whatHappened: 'Another browser already claimed this pairing window.',
    whatToDoNext: 'Close other browsers on this tablet, ask the manager to start a fresh pairing window, then tap Try again.',
    actions: ['retry', 'contact_manager'],
    preservesBasket: false,
    retryable: true,
  },
  PAIRING_MISMATCH: {
    severity: 'warning',
    title: 'Pairing code does not match',
    whatHappened: 'The code on the tablet did not match the code confirmed by the manager.',
    whatToDoNext: 'Start a new pairing window and confirm the code shown on this tablet.',
    actions: ['retry', 'contact_manager'],
    preservesBasket: false,
    retryable: true,
  },
  PAIRING_CANCELLED: {
    severity: 'warning',
    title: 'Pairing cancelled',
    whatHappened: 'The manager cancelled this pairing window.',
    whatToDoNext: 'Ask the manager to start pairing again, then tap Try again.',
    actions: ['retry', 'contact_manager'],
    preservesBasket: false,
    retryable: true,
  },
  ACTIVATION_FAILED: {
    severity: 'error',
    title: 'Could not start Yard Inventory',
    whatHappened: 'The tablet could not finish automatic sign-in.',
    whatToDoNext: 'Tap Try again. If it keeps failing, ask a manager to revoke and re-pair this tablet.',
    actions: ['retry', 'return_to_pairing', 'contact_manager'],
    preservesBasket: false,
    retryable: true,
  },
  KIOSK_DISABLED: {
    severity: 'blocking',
    title: 'Yard Inventory is turned off',
    whatHappened: 'The Yard kiosk has been disabled in the system configuration.',
    whatToDoNext: 'Ask an administrator to enable the Yard kiosk, then tap Try again.',
    actions: ['retry', 'contact_manager'],
    preservesBasket: false,
    retryable: true,
  },
  WRONG_PROFILE: {
    severity: 'blocking',
    title: 'Wrong account',
    whatHappened: 'This account is not allowed to use the Yard Inventory kiosk.',
    whatToDoNext: 'Sign out and use the dedicated Yard kiosk login, or ask a manager to pair this tablet.',
    actions: ['sign_in', 'return_to_pairing', 'contact_manager'],
    preservesBasket: false,
    retryable: false,
  },
  YARD_MISSING: {
    severity: 'blocking',
    title: 'Yard location missing',
    whatHappened: 'Yard Inventory needs exactly one active Yard location.',
    whatToDoNext: 'Ask an administrator to fix the Yard location setup, then tap Try again.',
    actions: ['retry', 'contact_manager'],
    preservesBasket: false,
    retryable: true,
  },
  SERVICE_UNAVAILABLE: {
    severity: 'error',
    title: 'Yard Inventory temporarily unavailable',
    whatHappened: 'The service could not be reached right now.',
    whatToDoNext: 'Wait a moment, check the connection, then tap Try again.',
    actions: ['check_connection', 'retry'],
    preservesBasket: true,
    retryable: true,
  },
  STOCK_LOAD_FAILED: {
    severity: 'error',
    title: 'Could not load stock',
    whatHappened: 'Available stock could not be loaded for this transfer.',
    whatToDoNext: 'Tap Try again. Your basket is kept if it was already started.',
    actions: ['reload_stock', 'retry', 'dismiss'],
    preservesBasket: true,
    retryable: true,
  },
  STOCK_STALE: {
    severity: 'warning',
    title: 'Stock changed',
    whatHappened: 'Someone else changed stock while this basket was open.',
    whatToDoNext: 'Review the refreshed stock list, then confirm the transfer again.',
    actions: ['reload_stock', 'dismiss'],
    preservesBasket: true,
    retryable: true,
  },
  INVENTORY_CHECK_REQUIRED: {
    severity: 'warning',
    title: 'Inventory check needed',
    whatHappened: 'One or more items need an inventory check before they can leave Yard.',
    whatToDoNext: 'Remove the blocked items or ask a manager to complete the inventory check, then try again.',
    actions: ['dismiss'],
    preservesBasket: true,
    retryable: false,
  },
  SUBMIT_FAILED: {
    severity: 'error',
    title: 'Transfer not completed',
    whatHappened: 'The basket could not be moved. Nothing was changed.',
    whatToDoNext: 'Check the message, adjust the basket if needed, then confirm again.',
    actions: ['retry', 'dismiss'],
    preservesBasket: true,
    retryable: true,
  },
  SUBMIT_UNCERTAIN: {
    severity: 'error',
    title: 'Transfer result unclear',
    whatHappened: 'The tablet lost contact while confirming the transfer, so the result is unclear.',
    whatToDoNext: 'Do not submit again yet. Ask a manager to check recent Yard transfers, then refresh stock.',
    actions: ['reload_stock', 'contact_manager', 'dismiss'],
    preservesBasket: true,
    retryable: false,
  },
  MALFORMED_RESPONSE: {
    severity: 'error',
    title: 'Unexpected response',
    whatHappened: 'Yard Inventory returned a response this tablet could not understand.',
    whatToDoNext: 'Tap Refresh app. If it continues, contact a manager with the reference code.',
    actions: ['refresh_app', 'contact_manager', 'retry'],
    preservesBasket: true,
    retryable: true,
  },
  UNSUPPORTED_VIEWPORT: {
    severity: 'blocking',
    title: 'Use landscape mode',
    whatHappened: 'Yard Inventory needs a landscape screen of at least 1024 by 600 pixels.',
    whatToDoNext: 'Rotate the tablet to landscape and keep it in the kiosk dock.',
    actions: ['retry'],
    preservesBasket: true,
    retryable: true,
  },
  REMOTE_RESET: {
    severity: 'info',
    title: 'Screen reset by manager',
    whatHappened: 'An Inventory manager reset this kiosk to the start screen.',
    whatToDoNext: 'Start the next transfer when ready.',
    actions: ['dismiss'],
    preservesBasket: false,
    retryable: false,
  },
  REMOTE_LOGOUT: {
    severity: 'blocking',
    title: 'Signed out by manager',
    whatHappened: 'An Inventory manager signed this tablet out of Yard Inventory.',
    whatToDoNext: 'Ask a manager if you need access restored.',
    actions: ['return_to_pairing', 'sign_in', 'contact_manager'],
    preservesBasket: false,
    retryable: false,
  },
  REMOTE_REPAIR: {
    severity: 'blocking',
    title: 'Re-pairing required',
    whatHappened: 'An Inventory manager cleared this tablet’s saved login so it can be paired again.',
    whatToDoNext: 'Wait for the manager to start a new pairing window, then continue on this screen.',
    actions: ['return_to_pairing', 'contact_manager'],
    preservesBasket: false,
    retryable: false,
  },
  UNKNOWN: {
    severity: 'error',
    title: 'Something went wrong',
    whatHappened: 'Yard Inventory hit an unexpected problem.',
    whatToDoNext: 'Tap Try again. If it keeps happening, contact a manager and share the reference code.',
    actions: ['retry', 'contact_manager', 'dismiss'],
    preservesBasket: true,
    retryable: true,
  },
};

export function createYardKioskDiagnosticId(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `YK-${stamp}-${rand}`;
}

export function getYardKioskErrorDefinition(code: YardKioskErrorCode): YardKioskErrorDefinition {
  return { code, ...CATALOGUE[code] };
}

export function buildYardKioskUserError(
  code: YardKioskErrorCode,
  options: {
    diagnosticId?: string;
    technicalDetail?: string;
    whatHappened?: string;
    whatToDoNext?: string;
  } = {},
): YardKioskUserError {
  const definition = getYardKioskErrorDefinition(code);
  return {
    code,
    title: definition.title,
    whatHappened: options.whatHappened || definition.whatHappened,
    whatToDoNext: options.whatToDoNext || definition.whatToDoNext,
    actions: definition.actions,
    preservesBasket: definition.preservesBasket,
    retryable: definition.retryable,
    severity: definition.severity,
    diagnosticId: options.diagnosticId || createYardKioskDiagnosticId(),
    technicalDetail: options.technicalDetail,
  };
}

export function mapHttpStatusToYardKioskErrorCode(
  status: number,
  apiCode?: string | null,
): YardKioskErrorCode {
  if (apiCode === 'INVENTORY_CHECK_REQUIRED') return 'INVENTORY_CHECK_REQUIRED';
  if (apiCode === 'STOCK_STALE' || status === 409) return 'STOCK_STALE';
  if (status === 401) return 'SESSION_EXPIRED';
  if (status === 403) return 'WRONG_PROFILE';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  if (status >= 500) return 'SERVICE_UNAVAILABLE';
  return 'UNKNOWN';
}

export function mapPairingStatusToYardKioskErrorCode(
  status: 'pairing' | 'paired' | 'expired' | 'unavailable',
  message?: string | null,
): YardKioskErrorCode | null {
  if (status === 'pairing' || status === 'paired') return null;
  if (status === 'expired') return 'PAIRING_EXPIRED';
  const normalized = (message || '').toLowerCase();
  if (normalized.includes('another browser')) return 'PAIRING_CLAIMED';
  if (normalized.includes('start pairing') || normalized.includes('ask an inventory manager')) {
    return 'PAIRING_NOT_STARTED';
  }
  if (normalized.includes('cancelled')) return 'PAIRING_CANCELLED';
  return 'PAIRING_NOT_STARTED';
}

export function listYardKioskErrorCatalogue(): YardKioskErrorDefinition[] {
  return (Object.keys(CATALOGUE) as YardKioskErrorCode[]).map((code) =>
    getYardKioskErrorDefinition(code),
  );
}
