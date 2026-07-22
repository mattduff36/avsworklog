'use client';

import { useEffect, useRef, useState } from 'react';
import {
  buildYardKioskUserError,
  createYardKioskDiagnosticId,
  type YardKioskUserError,
} from '@/lib/inventory/kiosk-errors';
import type {
  YardKioskControlAction,
  YardKioskControlLeaseView,
  YardKioskRemoteCommandView,
  YardKioskWorkflowSnapshot,
} from '@/lib/inventory/kiosk-remote-types';
import { forceAppRefresh } from '@/lib/client/force-app-refresh';

interface UseYardKioskRemoteControlOptions {
  phase: string;
  offline: boolean;
  lastErrorCode: string | null;
  workflowSnapshot: YardKioskWorkflowSnapshot;
  onResetWorkflow: () => void;
  onReloadStock: () => void;
  onControlAction: (action: YardKioskControlAction) => void;
  onRemoteNotice: (error: YardKioskUserError) => void;
}

const HEARTBEAT_MS = 12_000;
const CONTROL_HEARTBEAT_MS = 1_000;

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
  workflowSnapshot,
  onResetWorkflow,
  onReloadStock,
  onControlAction,
  onRemoteNotice,
}: UseYardKioskRemoteControlOptions): { isRemotelyControlled: boolean } {
  const handledRef = useRef(new Set<string>());
  const [isRemotelyControlled, setIsRemotelyControlled] = useState(false);
  const statusRef = useRef({ phase, offline, lastErrorCode, workflowSnapshot });
  const callbacksRef = useRef({
    onResetWorkflow,
    onReloadStock,
    onControlAction,
    onRemoteNotice,
  });

  useEffect(() => {
    statusRef.current = { phase, offline, lastErrorCode, workflowSnapshot };
  }, [lastErrorCode, offline, phase, workflowSnapshot]);

  useEffect(() => {
    callbacksRef.current = {
      onResetWorkflow,
      onReloadStock,
      onControlAction,
      onRemoteNotice,
    };
  }, [onControlAction, onReloadStock, onRemoteNotice, onResetWorkflow]);

  useEffect(() => {
    let cancelled = false;
    let heartbeatTimer: number | null = null;
    let hasActiveControlLease = false;
    let controlLeaseExpiresAt = 0;

    async function runHeartbeat() {
      if (cancelled) return;
      const currentStatus = statusRef.current;
      if (hasActiveControlLease && controlLeaseExpiresAt <= Date.now()) {
        hasActiveControlLease = false;
        controlLeaseExpiresAt = 0;
        setIsRemotelyControlled(false);
      }

      if (!currentStatus.offline) try {
        const deploymentId = typeof document !== 'undefined'
          ? document.querySelector('meta[name="avs-deployment-id"]')?.getAttribute('content')
          : null;

        const response = await fetch('/api/inventory/kiosk/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({
            phase: currentStatus.phase,
            offline: currentStatus.offline,
            app_version: process.env.NEXT_PUBLIC_APP_VERSION || null,
            deployment_id: deploymentId,
            last_error_code: currentStatus.lastErrorCode,
            workflow_snapshot: currentStatus.workflowSnapshot,
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

        if (!response.ok) throw new Error('Yard kiosk heartbeat failed');
        const payload = await response.json() as {
          commands?: YardKioskRemoteCommandView[];
          revoked?: boolean;
          control_lease?: YardKioskControlLeaseView | null;
        };

        if (payload.revoked) {
          window.location.replace('/yard-kiosk/recover?code=DEVICE_REVOKED');
          return;
        }

        hasActiveControlLease = Boolean(
          payload.control_lease?.is_active
          && payload.control_lease.expires_at
          && new Date(payload.control_lease.expires_at).getTime() > Date.now(),
        );
        controlLeaseExpiresAt = hasActiveControlLease && payload.control_lease?.expires_at
          ? new Date(payload.control_lease.expires_at).getTime()
          : 0;
        setIsRemotelyControlled(hasActiveControlLease);

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
              case 'control_action': {
                const controlSessionId = command.payload.control_session_id;
                const action = command.payload.action;
                if (
                  !hasActiveControlLease
                  || typeof controlSessionId !== 'string'
                  || controlSessionId !== payload.control_lease?.session_id
                  || !action
                  || typeof action !== 'object'
                ) {
                  await ackCommand(command, 'failed', 'CONTROL_LEASE_EXPIRED');
                  break;
                }
                callbacksRef.current.onControlAction(
                  action as YardKioskControlAction,
                );
                await ackCommand(command, 'completed', 'CONTROL_ACTION_APPLIED');
                break;
              }
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

      if (cancelled) return;
      heartbeatTimer = window.setTimeout(
        () => void runHeartbeat(),
        hasActiveControlLease ? CONTROL_HEARTBEAT_MS : HEARTBEAT_MS,
      );
    }

    void runHeartbeat();

    return () => {
      cancelled = true;
      if (heartbeatTimer !== null) window.clearTimeout(heartbeatTimer);
    };
  }, []);

  return { isRemotelyControlled };
}
