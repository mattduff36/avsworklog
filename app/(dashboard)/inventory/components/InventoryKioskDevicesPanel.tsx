'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  RadioTower,
  RefreshCw,
  RotateCcw,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
      <div className="min-w-0 space-y-5 md:space-y-0 md:overflow-hidden md:rounded-lg md:border md:border-border md:bg-slate-900/60">
        {/* Section header: consistent with the module-wide [icon] Title [count] + metadata pattern. */}
        <div className="flex items-center justify-between gap-3 md:border-b md:border-border md:bg-slate-950/30 md:p-6">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-bold text-white md:text-lg">
              <ShieldCheck className="h-4 w-4 shrink-0 text-inventory md:h-5 md:w-5" />
              Yard kiosk trusted devices
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground md:text-sm">
              {activeDevices.length} active · password-free Yard kiosk access
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="h-9 shrink-0">
            <a href="/inventory/kiosk-control" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1.5 h-4 w-4" />
              Open kiosk control
            </a>
          </Button>
        </div>

        <div className="space-y-5 md:p-6">
        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-red-500/35 bg-red-500/10 p-3 text-sm text-red-100"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : null}

        {/* Pair a kiosk */}
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-white">Pair a kiosk</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {activeDevices.length > 0
                ? 'Only one kiosk can be linked. Replacing it keeps the current tablet active until you confirm the new code.'
                : (
                  <>
                    Start a five-minute pairing window, then open{' '}
                    <span className="break-all font-medium text-slate-300">squiresapp.com/yard-kiosk</span>{' '}
                    on the device and compare the six-digit code.
                  </>
                )}
            </p>
          </div>

          {!pairing ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-64">
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
                  className="h-11 border-slate-600 bg-slate-800"
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
                className={`h-11 w-full shrink-0 sm:w-auto ${
                  activeDevices.length > 0
                    ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                    : 'bg-inventory text-white hover:bg-inventory-dark'
                }`}
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                {activeDevices.length > 0 ? 'Replace existing kiosk' : 'Start pairing'}
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border border-inventory/35 bg-inventory/10 p-4">
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
                  <p className="mt-3 break-all font-mono text-3xl font-black tracking-[0.16em] text-white min-[380px]:text-4xl min-[380px]:tracking-[0.22em]">
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
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void runAction('cancel_pairing')}
                  disabled={saving}
                  className="h-11 border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void confirmPairing()}
                  disabled={saving || !pairing.confirmation_code}
                  className="h-11 flex-1 bg-inventory text-white hover:bg-inventory-dark"
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {pairing.replaces_device_id
                    ? 'Confirm and replace kiosk'
                    : 'Confirm matching code'}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Trusted browsers */}
        <div className="space-y-2.5">
          <div>
            <p className="text-sm font-semibold text-white">Trusted browsers</p>
            <p className="text-xs text-muted-foreground">
              Access continues until revoked here or browser cookies are cleared.
            </p>
          </div>

          <div className="space-y-2.5">
            {activeDevices.length > 0 ? activeDevices.map((device) => (
              <div
                key={device.id}
                className="min-w-0 rounded-xl border border-slate-700/70 bg-slate-900/50 p-3.5"
              >
                <div className="flex items-start gap-2">
                  <Tablet className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-white">{device.device_label}</p>
                      <Badge
                        variant="outline"
                        className={
                          device.presence === 'online'
                            ? 'border-emerald-400/40 bg-emerald-500/10 text-[10px] text-emerald-200'
                            : device.presence === 'stale'
                              ? 'border-amber-400/40 bg-amber-500/10 text-[10px] text-amber-200'
                              : 'border-slate-500/40 bg-slate-500/10 text-[10px] text-slate-300'
                        }
                      >
                        {presenceLabel(device)}
                      </Badge>
                    </div>
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      Paired {formatDateTime(device.created_at)} · Last automatic login {formatDateTime(device.last_authenticated_at)}
                    </p>
                    <p className="break-words text-xs text-muted-foreground">
                      Last contact {formatDateTime(device.last_heartbeat_at || null)}
                      {device.last_phase ? ` · ${device.last_phase}` : ''}
                    </p>
                    {device.last_error_code ? (
                      <p className="mt-1 break-words text-xs text-amber-200">
                        Last issue {device.last_error_code}
                        {device.last_diagnostic_id ? ` · Ref ${device.last_diagnostic_id}` : ''}
                      </p>
                    ) : null}
                    {(device.pending_commands || []).length > 0 ? (
                      <p className="mt-1 break-words text-xs text-sky-200">
                        Pending: {(device.pending_commands || [])
                          .map((command) => `${command.command_type} (${command.status})`)
                          .join(', ')}
                      </p>
                    ) : null}

                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 flex-1 min-w-0 justify-center border-slate-600"
                        disabled={saving || device.presence === 'offline'}
                        onClick={() => void issueCommand(device, 'ping')}
                      >
                        <RadioTower className="mr-1.5 h-3.5 w-3.5" />
                        Ping
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 flex-1 min-w-0 justify-center border-slate-600"
                        disabled={saving || device.presence === 'offline'}
                        onClick={() => void issueCommand(device, 'reload_app')}
                      >
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                        Reload
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-9 w-9 shrink-0 border-slate-600 text-slate-300"
                            aria-label={`More actions for ${device.device_label}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={saving || device.presence === 'offline'}
                            onClick={() => setDestructiveTarget({ device, command: 'reset_workflow' })}
                          >
                            <RotateCcw className="h-4 w-4" />
                            Reset screen
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={saving || device.presence === 'offline'}
                            onClick={() => setDestructiveTarget({ device, command: 'logout' })}
                          >
                            <XCircle className="h-4 w-4" />
                            Sign out
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={saving}
                            onClick={() => setDestructiveTarget({ device, command: 'clear_credentials' })}
                            className="text-amber-300 focus:bg-amber-500/10 focus:text-amber-200"
                          >
                            <Clock3 className="h-4 w-4" />
                            Clear &amp; re-pair
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={saving}
                            onClick={() => setRevokeTarget(device)}
                            className="text-red-300 focus:bg-red-500/10 focus:text-red-200"
                          >
                            <Trash2 className="h-4 w-4" />
                            Revoke device
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-muted-foreground">
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
        </div>
      </div>

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
