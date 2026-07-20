import {
  buildYardKioskUserError,
  createYardKioskDiagnosticId,
  mapHttpStatusToYardKioskErrorCode,
  type YardKioskErrorCode,
  type YardKioskUserError,
} from '@/lib/inventory/kiosk-errors';
import { errorLogger } from '@/lib/utils/error-logger';

export async function logYardKioskHandledError(
  error: YardKioskUserError,
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    await errorLogger.logError({
      error: `${error.code}: ${error.title}`,
      componentName: 'Yard Kiosk',
      additionalData: {
        yardKiosk: {
          code: error.code,
          diagnosticId: error.diagnosticId,
          severity: error.severity,
          preservesBasket: error.preservesBasket,
          retryable: error.retryable,
          technicalDetail: error.technicalDetail || null,
        },
        ...extra,
        errorHandling: {
          wasHandled: true,
          didShowMessage: true,
        },
      },
    });
  } catch {
    // Diagnostics must never break the kiosk workflow.
  }
}

export function yardKioskErrorFromApiPayload(
  status: number,
  payload: {
    error?: string;
    code?: string;
    diagnostic_id?: string;
  },
): YardKioskUserError {
  const mapped = mapHttpStatusToYardKioskErrorCode(status, payload.code);
  const code = (payload.code as YardKioskErrorCode | undefined) && payload.code
    ? (payload.code as YardKioskErrorCode)
    : mapped;
  return buildYardKioskUserError(code, {
    diagnosticId: payload.diagnostic_id || createYardKioskDiagnosticId(),
    technicalDetail: payload.error,
    whatHappened: payload.error && status < 500 ? undefined : undefined,
  });
}

export function yardKioskOfflineError(): YardKioskUserError {
  return buildYardKioskUserError('OFFLINE', {
    diagnosticId: createYardKioskDiagnosticId(),
  });
}
