'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  Loader2,
  Search,
  ShieldCheck,
  Tablet,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PanelLoader } from '@/components/ui/panel-loader';

interface KioskPairing {
  id: string;
  device_label: string;
  confirmation_code: string | null;
  status: 'active' | 'confirmed' | 'consumed' | 'cancelled' | 'expired';
  candidate_seen_at: string | null;
  replaces_device_id: string | null;
  expires_at: string;
}

interface KioskPendingCommand {
  id: string;
  command_type: string;
  status: string;
  issued_at: string;
}

interface KioskDevice {
  id: string;
  device_label: string;
  last_seen_at: string | null;
  last_authenticated_at: string | null;
  last_heartbeat_at?: string | null;
  last_phase?: string | null;
  last_app_version?: string | null;
  last_error_code?: string | null;
  last_diagnostic_id?: string | null;
  presence?: 'online' | 'stale' | 'offline' | 'revoked';
  pending_commands?: KioskPendingCommand[];
  revoked_at: string | null;
  created_at: string;
}

type DestructiveCommand = 'reset_workflow' | 'logout' | 'clear_credentials';

interface KioskDeviceState {
  success?: boolean;
  active_pairing: KioskPairing | null;
  devices: KioskDevice[];
  error?: string;
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function InventoryKioskDevicesPanel() {
  const [state, setState] = useState<KioskDeviceState | null>(null);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<KioskDevice | null>(null);
  const [isReplaceDialogOpen, setIsReplaceDialogOpen] = useState(false);
  const [destructiveTarget, setDestructiveTarget] = useState<{
    device: KioskDevice;
    command: DestructiveCommand;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadState = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch('/api/inventory/kiosk/devices', {
        cache: 'no-store',
      });
      const result = await response.json() as KioskDeviceState;
      if (!response.ok) {
        throw new Error(result.error || 'Unable to load Yard kiosk devices');
      }
      setState(result);
      setError('');
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load Yard kiosk devices',
      );
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    const hasPendingCommands = (state?.devices || []).some(
      (device) => (device.pending_commands || []).length > 0,
    );
    if (!state?.active_pairing && !hasPendingCommands) return;
    const interval = window.setInterval(() => {
      void loadState(true);
    }, 2_000);
    return () => window.clearInterval(interval);
  }, [loadState, state?.active_pairing, state?.devices]);

  const runAction = useCallback(async (
    action: string,
    values: Record<string, unknown> = {},
  ) => {
    setSaving(true);
    try {
      const response = await fetch('/api/inventory/kiosk/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...values }),
      });
      const result = await response.json() as KioskDeviceState;
      if (!response.ok) {
        throw new Error(result.error || 'Unable to update Yard kiosk devices');
      }
      setState(result);
      setError('');
      return true;
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Unable to update Yard kiosk devices',
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  async function startPairing(replaceExisting = false) {
    const label = deviceLabel.trim();
    if (!label) {
      setError('Enter a name for the kiosk device');
      return;
    }
    const succeeded = await runAction('start_pairing', {
      device_label: label,
      replace_existing: replaceExisting,
    });
    if (succeeded) {
      setDeviceLabel('');
      setIsReplaceDialogOpen(false);
    }
  }

  async function confirmPairing() {
    const pairing = state?.active_pairing;
    if (!pairing?.confirmation_code) return;
    await runAction('confirm_pairing', {
      pairing_id: pairing.id,
      confirmation_code: pairing.confirmation_code,
      confirmed_replacement: Boolean(pairing.replaces_device_id),
    });
  }

  async function revokeDevice() {
    if (!revokeTarget) return;
    const succeeded = await runAction('revoke_device', {
      device_id: revokeTarget.id,
    });
    if (succeeded) setRevokeTarget(null);
  }

  async function issueCommand(
    device: KioskDevice,
    commandType: string,
    confirmedDestructive = false,
  ) {
    await runAction('issue_command', {
      device_id: device.id,
      command_type: commandType,
      confirmed_destructive: confirmedDestructive,
      idempotency_key: `${commandType}:${device.id}:${Date.now()}`,
    });
  }

  async function confirmDestructiveCommand() {
    if (!destructiveTarget) return;
    const succeeded = await runAction('issue_command', {
      device_id: destructiveTarget.device.id,
      command_type: destructiveTarget.command,
      confirmed_destructive: true,
      idempotency_key: `${destructiveTarget.command}:${destructiveTarget.device.id}:${Date.now()}`,
    });
    if (succeeded) setDestructiveTarget(null);
  }

  function presenceLabel(device: KioskDevice): string {
    if (device.presence === 'online') return 'Online';
    if (device.presence === 'stale') return 'Recently seen';
    if (device.presence === 'revoked') return 'Revoked';
    return 'Offline';
  }

  if (loading && !state) {
    return (
      <PanelLoader
        message="Loading Yard kiosk devices..."
        accent="inventory"
        className="rounded-xl border border-border bg-slate-900/60 py-12"
      />
    );
  }

  const pairing = state?.active_pairing || null;
  const activeDevices = state?.devices.filter((device) => !device.revoked_at) || [];
  const revokedDevices = state?.devices.filter((device) => device.revoked_at) || [];

  return (
    <>
      <Card className="overflow-hidden border-border bg-slate-900/60">
        <div className="h-1 bg-inventory" />
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-white">
                <ShieldCheck className="h-5 w-5 text-inventory" />
                Yard kiosk trusted devices
              </CardTitle>
              <CardDescription className="mt-2 max-w-3xl leading-relaxed text-slate-400">
                Pair approved browser installations for password-free Yard kiosk access.
                No MAC address or browser fingerprint is collected.
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className="w-fit border-inventory/40 bg-inventory/10 text-inventory"
            >
              {activeDevices.length} active
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-red-500/35 bg-red-500/10 p-3 text-sm text-red-100"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : null}

          <div className="flex flex-col gap-4 rounded-xl border border-amber-300/25 bg-amber-300/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-amber-300/15 p-2 text-amber-200">
                <Download className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-white">Install the dedicated Android app</p>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-300">
                  On the kiosk tablet, open{' '}
                  <span className="font-medium text-white">
                    squiresapp.com/yard-kiosk/install
                  </span>{' '}
                  in Chrome (not www). Install Yard Inventory, then pair the browser below.
                </p>
              </div>
            </div>
            <Button asChild variant="outline" className="shrink-0 border-amber-300/35">
              <a href="/yard-kiosk/install" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Tablet setup page
              </a>
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-slate-950/45 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="font-semibold text-white">Pair a new kiosk browser</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">
                  {activeDevices.length > 0
                    ? 'Only one kiosk can be linked. Replacing it keeps the current tablet active until you confirm the new tablet code.'
                    : 'Start a five-minute pairing window, then open '}{' '}
                  {activeDevices.length === 0 ? (
                    <>
                  <span className="font-medium text-slate-200">squiresapp.com/yard-kiosk</span>{' '}
                  on the device and compare the six-digit code.
                    </>
                  ) : null}
                </p>
              </div>
              {!pairing ? (
                <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                  <div className="min-w-64 space-y-1.5">
                    <Label htmlFor="kiosk-device-label" className="sr-only">
                      Device name
                    </Label>
                    <Input
                      id="kiosk-device-label"
                      value={deviceLabel}
                      onChange={(event) => setDeviceLabel(event.target.value)}
                      maxLength={100}
                      placeholder="e.g. Yard Tablet 1"
                      disabled={saving}
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={() => {
                      if (activeDevices.length > 0) {
                        if (!deviceLabel.trim()) {
                          setError('Enter a name for the replacement kiosk device');
                          return;
                        }
                        setIsReplaceDialogOpen(true);
                        return;
                      }
                      void startPairing();
                    }}
                    disabled={saving}
                    className={
                      activeDevices.length > 0
                        ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                        : 'bg-inventory text-white hover:bg-inventory-dark'
                    }
                  >
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="mr-2 h-4 w-4" />
                    )}
                    {activeDevices.length > 0 ? 'Replace existing kiosk' : 'Start pairing'}
                  </Button>
                </div>
              ) : null}
            </div>

            {pairing ? (
              <div className="mt-4 rounded-xl border border-inventory/35 bg-inventory/10 p-4">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="font-semibold text-inventory">
                      Pairing {pairing.device_label}
                    </p>
                    {pairing.confirmation_code ? (
                      <>
                        <p className="mt-1 text-sm text-slate-300">
                          Confirm only if this matches the code on the kiosk screen.
                          {pairing.replaces_device_id
                            ? ' This will immediately revoke the existing kiosk.'
                            : ''}
                        </p>
                        <p className="mt-3 font-mono text-4xl font-black tracking-[0.22em] text-white">
                          {pairing.confirmation_code}
                        </p>
                      </>
                    ) : (
                      <p className="mt-2 flex items-center gap-2 text-sm text-slate-300">
                        <Loader2 className="h-4 w-4 animate-spin text-inventory" />
                        Waiting for the kiosk browser to open the Yard kiosk page
                      </p>
                    )}
                    <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                      <Clock3 className="h-3.5 w-3.5" />
                      Expires {formatDateTime(pairing.expires_at)}
                    </p>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void runAction('cancel_pairing')}
                      disabled={saving}
                      className="border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void confirmPairing()}
                      disabled={saving || !pairing.confirmation_code}
                      className="bg-inventory text-white hover:bg-inventory-dark"
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      {pairing.replaces_device_id
                        ? 'Confirm and replace kiosk'
                        : 'Confirm matching code'}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-white">Trusted browsers</p>
                <p className="text-sm text-slate-400">
                  Access continues until revoked here or browser cookies are cleared.
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <a
                  href="/inventory/kiosk-control"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open kiosk control
                </a>
              </Button>
            </div>

            <div className="space-y-2">
              {activeDevices.length > 0 ? activeDevices.map((device) => (
                <div
                  key={device.id}
                  className="rounded-xl border border-border bg-slate-950/40 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg bg-inventory/10 p-2 text-inventory">
                        <Tablet className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-white">{device.device_label}</p>
                          <Badge
                            variant="outline"
                            className={
                              device.presence === 'online'
                                ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                                : device.presence === 'stale'
                                  ? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
                                  : 'border-slate-500/40 bg-slate-500/10 text-slate-300'
                            }
                          >
                            {presenceLabel(device)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-slate-400">
                          Paired {formatDateTime(device.created_at)}
                        </p>
                        <p className="text-sm text-slate-400">
                          Last automatic login {formatDateTime(device.last_authenticated_at)}
                        </p>
                        <p className="text-sm text-slate-400">
                          Last contact {formatDateTime(device.last_heartbeat_at || null)}
                          {device.last_phase ? ` · ${device.last_phase}` : ''}
                        </p>
                        {device.last_error_code ? (
                          <p className="mt-1 text-sm text-amber-200">
                            Last issue {device.last_error_code}
                            {device.last_diagnostic_id
                              ? ` · Ref ${device.last_diagnostic_id}`
                              : ''}
                          </p>
                        ) : null}
                        {(device.pending_commands || []).length > 0 ? (
                          <p className="mt-1 text-xs text-sky-200">
                            Pending: {(device.pending_commands || [])
                              .map((command) => `${command.command_type} (${command.status})`)
                              .join(', ')}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setRevokeTarget(device)}
                      disabled={saving}
                      className="border-red-500/40 text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Revoke
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={saving || device.presence === 'offline'}
                      onClick={() => void issueCommand(device, 'ping')}
                    >
                      Ping
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={saving || device.presence === 'offline'}
                      onClick={() => void issueCommand(device, 'reload_app')}
                    >
                      Reload app
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={saving || device.presence === 'offline'}
                      onClick={() => setDestructiveTarget({
                        device,
                        command: 'reset_workflow',
                      })}
                    >
                      Reset screen
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={saving || device.presence === 'offline'}
                      onClick={() => setDestructiveTarget({
                        device,
                        command: 'logout',
                      })}
                    >
                      Sign out
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() => setDestructiveTarget({
                        device,
                        command: 'clear_credentials',
                      })}
                      className="border-amber-500/40 text-amber-200"
                    >
                      Clear &amp; re-pair
                    </Button>
                  </div>
                </div>
              )) : (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-slate-400">
                  No Yard kiosk browsers are paired yet.
                </div>
              )}
            </div>
          </div>

          {revokedDevices.length > 0 ? (
            <p className="text-xs text-slate-500">
              {revokedDevices.length} revoked device{revokedDevices.length === 1 ? '' : 's'} retained
              in the audit history.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog
        open={isReplaceDialogOpen}
        onOpenChange={(open) => {
          if (!saving) setIsReplaceDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the linked Yard kiosk?</AlertDialogTitle>
            <AlertDialogDescription>
              The current tablet remains linked while the replacement pairing window is
              open. It is revoked only after you confirm the matching six-digit code on
              the new tablet. Cancelling or letting the window expire changes nothing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Keep current kiosk</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                void startPairing(true);
              }}
              className="bg-amber-500 text-slate-950 hover:bg-amber-400"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Start replacement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => {
          if (!open && !saving) setRevokeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {revokeTarget?.device_label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Automatic login stops immediately and active kiosk sessions from this
              browser are revoked. If the tablet is online it will be signed out on
              the next contact. Pair it again to restore access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Keep device</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                void revokeDevice();
              }}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Revoke device
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(destructiveTarget)}
        onOpenChange={(open) => {
          if (!open && !saving) setDestructiveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {destructiveTarget?.command === 'reset_workflow'
                ? `Reset ${destructiveTarget.device.device_label}?`
                : destructiveTarget?.command === 'logout'
                  ? `Sign out ${destructiveTarget.device.device_label}?`
                  : `Clear saved login for ${destructiveTarget?.device.device_label}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {destructiveTarget?.command === 'reset_workflow'
                ? 'This clears the unfinished basket and returns the tablet to the start screen.'
                : destructiveTarget?.command === 'logout'
                  ? 'This signs the tablet out of Yard Inventory. Pairing may still remain until revoked.'
                  : 'This revokes the trusted login and asks the tablet to open pairing again. The unfinished basket is discarded.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                void confirmDestructiveCommand();
              }}
              className="bg-amber-500 text-slate-950 hover:bg-amber-400"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
