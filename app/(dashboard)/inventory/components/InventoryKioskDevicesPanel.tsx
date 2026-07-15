'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
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
  expires_at: string;
}

interface KioskDevice {
  id: string;
  device_label: string;
  last_seen_at: string | null;
  last_authenticated_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

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
    if (!state?.active_pairing) return;
    const interval = window.setInterval(() => {
      void loadState(true);
    }, 2_000);
    return () => window.clearInterval(interval);
  }, [loadState, state?.active_pairing]);

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

  async function startPairing() {
    const label = deviceLabel.trim();
    if (!label) {
      setError('Enter a name for the kiosk device');
      return;
    }
    const succeeded = await runAction('start_pairing', { device_label: label });
    if (succeeded) setDeviceLabel('');
  }

  async function confirmPairing() {
    const pairing = state?.active_pairing;
    if (!pairing?.confirmation_code) return;
    await runAction('confirm_pairing', {
      pairing_id: pairing.id,
      confirmation_code: pairing.confirmation_code,
    });
  }

  async function revokeDevice() {
    if (!revokeTarget) return;
    const succeeded = await runAction('revoke_device', {
      device_id: revokeTarget.id,
    });
    if (succeeded) setRevokeTarget(null);
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

          <div className="rounded-xl border border-border bg-slate-950/45 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="font-semibold text-white">Pair a new kiosk browser</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">
                  Start a five-minute pairing window, then open{' '}
                  <span className="font-medium text-slate-200">squiresapp.com/yard-kiosk</span>{' '}
                  on the device and compare the six-digit code.
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
                    onClick={() => void startPairing()}
                    disabled={saving}
                    className="bg-inventory text-white hover:bg-inventory-dark"
                  >
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="mr-2 h-4 w-4" />
                    )}
                    Start pairing
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
                      Confirm matching code
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
                <a href="/yard-kiosk" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open kiosk
                </a>
              </Button>
            </div>

            <div className="space-y-2">
              {activeDevices.length > 0 ? activeDevices.map((device) => (
                <div
                  key={device.id}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-slate-950/40 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-inventory/10 p-2 text-inventory">
                      <Tablet className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-white">{device.device_label}</p>
                      <p className="mt-1 text-sm text-slate-400">
                        Paired {formatDateTime(device.created_at)}
                      </p>
                      <p className="text-sm text-slate-400">
                        Last automatic login {formatDateTime(device.last_authenticated_at)}
                      </p>
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
              browser are revoked. Pair it again to restore access.
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
    </>
  );
}
