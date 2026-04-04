'use client';

import { useEffect, useState } from 'react';
import { ACCOUNT_SWITCHER_PRD_EPIC_ID } from '@/lib/account-switch/epic';
import { isAccountSwitcherEnabled } from '@/lib/account-switch/feature-flag';
import { canUseBiometricUnlock } from '@/lib/account-switch/biometric';
import {
  getAccountSwitchDeviceLabel,
  getOrCreateAccountSwitchDeviceId,
} from '@/lib/account-switch/device';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface AccountSwitchSettingsPayload {
  quick_switch_enabled: boolean;
  pin_configured: boolean;
  device_registered?: boolean;
  pin_failed_attempts: number;
  pin_locked_until: string | null;
  pin_is_locked: boolean;
  pin_last_changed_at: string | null;
}

const PIN_LENGTH = 4;

function isValidFixedPin(value: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(value);
}

export function AccountSwitcherSettingsCard() {
  const [deviceId] = useState(() => getOrCreateAccountSwitchDeviceId());
  const [settings, setSettings] = useState<AccountSwitchSettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const isFeatureEnabled = isAccountSwitcherEnabled();
  const biometricSupported = canUseBiometricUnlock();

  async function loadSettings() {
    if (!isFeatureEnabled) return;
    if (!deviceId) return;

    setLoading(true);
    try {
      await fetch('/api/account-switch/device/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceId,
          deviceLabel: getAccountSwitchDeviceLabel(),
        }),
      });

      const response = await fetch(
        `/api/account-switch/settings?deviceId=${encodeURIComponent(deviceId)}`,
        { cache: 'no-store' }
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load account switch settings');
      }
      setSettings(payload.settings as AccountSwitchSettingsPayload);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load account switch settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isFeatureEnabled) return null;

  async function handleSavePin() {
    if (!currentPassword || !pin || !confirmPin) {
      toast.error('Complete all PIN setup fields');
      return;
    }
    if (pin !== confirmPin) {
      toast.error('PIN confirmation does not match');
      return;
    }
    if (!isValidFixedPin(pin)) {
      toast.error(`PIN must be exactly ${PIN_LENGTH} digits`);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/account-switch/pin/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword,
          pin,
          enableQuickSwitch: true,
          deviceId,
          deviceLabel: getAccountSwitchDeviceLabel(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to configure PIN');
      }

      toast.success('Quick switch PIN saved');
      setCurrentPassword('');
      setPin('');
      setConfirmPin('');
      await loadSettings();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to configure PIN');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPin() {
    if (!resetPassword || !newPin) {
      toast.error('Provide current password and new PIN');
      return;
    }
    if (!isValidFixedPin(newPin)) {
      toast.error(`PIN must be exactly ${PIN_LENGTH} digits`);
      return;
    }

    setResetting(true);
    try {
      const response = await fetch('/api/account-switch/pin/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: resetPassword,
          newPin,
          deviceId,
          deviceLabel: getAccountSwitchDeviceLabel(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to reset PIN');
      }

      toast.success('Quick switch PIN reset');
      setResetPassword('');
      setNewPin('');
      await loadSettings();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reset PIN');
    } finally {
      setResetting(false);
    }
  }

  return (
    <Card data-prd-epic-id={ACCOUNT_SWITCHER_PRD_EPIC_ID}>
      <CardHeader>
        <CardTitle>Shared Device Account Switching</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-md border border-border/60 bg-slate-900/30 p-3 text-sm">
          {loading ? (
            <p className="text-muted-foreground">Loading switch settings...</p>
          ) : (
            <div className="space-y-1 text-muted-foreground">
              <p>
                Quick switch: <span className="font-medium text-foreground">{settings?.quick_switch_enabled ? 'Enabled' : 'Disabled'}</span>
              </p>
              <p>
                PIN: <span className="font-medium text-foreground">{settings?.pin_configured ? 'Configured' : 'Not configured'}</span>
              </p>
              <p>
                This device:{' '}
                <span className="font-medium text-foreground">
                  {settings?.device_registered ? 'Registered' : 'Not registered'}
                </span>
              </p>
              <p>
                Lock status:{' '}
                <span className="font-medium text-foreground">
                  {settings?.pin_is_locked ? `Locked until ${settings?.pin_locked_until}` : 'Unlocked'}
                </span>
              </p>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Biometric quick unlock {biometricSupported ? 'is supported on this device and will be enabled in a future release.' : 'is not currently available on this device/browser.'}
        </p>

        <div className="space-y-3 rounded-md border border-border/60 p-4">
          <h3 className="font-semibold">Set up PIN</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="account-switch-password">Current password</Label>
              <Input
                id="account-switch-password"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-switch-pin">PIN</Label>
              <Input
                id="account-switch-pin"
                type="password"
                inputMode="numeric"
                maxLength={PIN_LENGTH}
                value={pin}
                onChange={(event) =>
                  setPin(event.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-switch-pin-confirm">Confirm PIN</Label>
              <Input
                id="account-switch-pin-confirm"
                type="password"
                inputMode="numeric"
                maxLength={PIN_LENGTH}
                value={confirmPin}
                onChange={(event) =>
                  setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))
                }
              />
            </div>
          </div>
          <Button onClick={() => void handleSavePin()} disabled={saving}>
            {saving ? 'Saving...' : 'Save PIN'}
          </Button>
        </div>

        <div className="space-y-3 rounded-md border border-border/60 p-4">
          <h3 className="font-semibold">Forgot PIN / Reset</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="account-switch-reset-password">Current password</Label>
              <Input
                id="account-switch-reset-password"
                type="password"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-switch-new-pin">New PIN</Label>
              <Input
                id="account-switch-new-pin"
                type="password"
                inputMode="numeric"
                maxLength={PIN_LENGTH}
                value={newPin}
                onChange={(event) =>
                  setNewPin(event.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))
                }
              />
            </div>
          </div>
          <Button variant="outline" onClick={() => void handleResetPin()} disabled={resetting}>
            {resetting ? 'Resetting...' : 'Reset PIN'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
