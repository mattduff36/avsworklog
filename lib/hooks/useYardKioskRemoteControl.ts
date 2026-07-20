'use client';

import { useEffect, useRef } from 'react';
import {
  buildYardKioskUserError,
  createYardKioskDiagnosticId,
  type YardKioskUserError,
} from '@/lib/inventory/kiosk-errors';
import type { YardKioskRemoteCommandView } from '@/lib/inventory/kiosk-remote-types';
import { forceAppRefresh } from '@/lib/client/force-app-refresh';

interface UseYardKioskRemoteControlOptions {
  phase: string;
  offline: boolean;
  lastErrorCode: string | null;
  onResetWorkflow: () => void;
  onReloadStock: () => void;
  onRemoteNotice: (error: YardKioskUserError) => void;
}

const HEARTBEAT_MS = 12_000;

async function ackCommand(
  command: YardKioskRemoteCommandView,
  status: 'accepted' | 'completed' | 'failed',
  resultCode?: string,
  errorMessage?: string,
): Promise<void> {
  await fetch('/api/inventory/kiosk/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      phase: 'items',
      ack: {
        command_id: command.id,
        status,
        result_code: resultCode || null,
        error_message: errorMessage || null,
      },
    }),
  });
}

export function useYardKioskRemoteControl({
  phase,
  offline,
  lastErrorCode,
  onResetWorkflow,
  onReloadStock,
  onRemoteNotice,
}: UseYardKioskRemoteControlOptions): void {
  const handledRef = useRef(new Set<string>());
  const callbacksRef = useRef({
    onResetWorkflow,
    onReloadStock,
    onRemoteNotice,
  });

  useEffect(() => {
    callbacksRef.current = {
      onResetWorkflow,
      onReloadStock,
      onRemoteNotice,
    };
  }, [onReloadStock, onRemoteNotice, onResetWorkflow]);

  useEffect(() => {
    let cancelled = false;

    async function runHeartbeat() {
      if (cancelled || offline) return;

      try {
        const deploymentId = typeof document !== 'undefined'
          ? document.querySelector('meta[name="avs-deployment-id"]')?.getAttribute('content')
          : null;

        const response = await fetch('/api/inventory/kiosk/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({
            phase,
            offline,
            app_version: process.env.NEXT_PUBLIC_APP_VERSION || null,
            deployment_id: deploymentId,
            last_error_code: lastErrorCode,
          }),
        });

        if (response.status === 401) {
          const payload = await response.json().catch(() => ({})) as { code?: string };
          const code = payload.code === 'DEVICE_REVOKED'
            ? 'DEVICE_REVOKED'
            : 'SESSION_EXPIRED';
          window.location.replace(`/yard-kiosk/recover?code=${code}`);
          return;
        }

        if (!response.ok) return;
        const payload = await response.json() as {
          commands?: YardKioskRemoteCommandView[];
          revoked?: boolean;
        };

        if (payload.revoked) {
          window.location.replace('/yard-kiosk/recover?code=DEVICE_REVOKED');
          return;
        }

        for (const command of payload.commands || []) {
          if (handledRef.current.has(command.id)) continue;
          handledRef.current.add(command.id);

          try {
            await ackCommand(command, 'accepted');

            switch (command.command_type) {
              case 'ping':
              case 'refresh_status':
                await ackCommand(command, 'completed', 'OK');
                break;
              case 'refresh_session':
                window.location.replace('/yard-kiosk/activate');
                await ackCommand(command, 'completed', 'REFRESH_SESSION');
                break;
              case 'reload_app':
                await ackCommand(command, 'completed', 'RELOAD_APP');
                await forceAppRefresh({ redirectTo: '/yard-kiosk' });
                break;
              case 'reset_workflow': {
                callbacksRef.current.onResetWorkflow();
                const notice = buildYardKioskUserError('REMOTE_RESET', {
                  diagnosticId: createYardKioskDiagnosticId(),
                });
                callbacksRef.current.onRemoteNotice(notice);
                await ackCommand(command, 'completed', 'RESET_WORKFLOW');
                break;
              }
              case 'logout':
                await ackCommand(command, 'completed', 'LOGOUT');
                await fetch('/api/auth/logout', {
                  method: 'POST',
                  cache: 'no-store',
                }).catch(() => undefined);
                window.location.replace('/yard-kiosk/recover?code=REMOTE_LOGOUT');
                break;
              case 'clear_credentials':
                await ackCommand(command, 'completed', 'CLEAR_CREDENTIALS');
                await fetch('/api/auth/logout', {
                  method: 'POST',
                  cache: 'no-store',
                }).catch(() => undefined);
                window.location.replace('/yard-kiosk/recover?code=REMOTE_REPAIR');
                break;
              default:
                await ackCommand(command, 'failed', 'UNSUPPORTED');
            }

            if (command.command_type === 'refresh_status') {
              callbacksRef.current.onReloadStock();
            }
          } catch (error) {
            await ackCommand(
              command,
              'failed',
              'EXECUTION_FAILED',
              error instanceof Error ? error.message : 'Command failed',
            ).catch(() => undefined);
          }
        }
      } catch {
        // Heartbeat is best-effort while online.
      }
    }

    void runHeartbeat();
    const interval = window.setInterval(() => {
      void runHeartbeat();
    }, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [lastErrorCode, offline, phase]);
}
