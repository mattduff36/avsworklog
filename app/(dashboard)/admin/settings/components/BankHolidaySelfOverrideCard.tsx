'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Switch } from '@/components/ui/switch';

const SETTINGS_HELPER_TEXT_CLASS = 'text-sm leading-relaxed text-slate-400';

export function BankHolidaySelfOverrideCard() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/settings/timesheet-module', { cache: 'no-store' });
      const payload = (await response.json()) as {
        bankHolidaySelfOverrideEnabled?: boolean;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load timesheet settings');
      }
      setEnabled(payload.bankHolidaySelfOverrideEnabled !== false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load timesheet settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleToggle = async (nextEnabled: boolean) => {
    const previous = enabled;
    setEnabled(nextEnabled);
    setSaving(true);
    try {
      const response = await fetch('/api/admin/settings/timesheet-module', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankHolidaySelfOverrideEnabled: nextEnabled }),
      });
      const payload = (await response.json()) as {
        bankHolidaySelfOverrideEnabled?: boolean;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save timesheet settings');
      }
      setEnabled(payload.bankHolidaySelfOverrideEnabled !== false);
      toast.success(
        nextEnabled
          ? 'Staff can confirm bank-holiday hours themselves'
          : 'Bank-holiday hours again require a manager Timesheet override'
      );
    } catch (error) {
      setEnabled(previous);
      toast.error(error instanceof Error ? error.message : 'Failed to save timesheet settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card id="bank-holiday-self-override" className="overflow-hidden border-avs-yellow/25 bg-slate-900/80">
      <CardHeader className="border-b border-border bg-gradient-to-r from-avs-yellow/10 via-transparent to-transparent">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-white">Bank holiday self-override trial</CardTitle>
          <Badge variant="outline" className="border-avs-yellow/30 text-avs-yellow">
            Trial
          </Badge>
        </div>
        <CardDescription className={SETTINGS_HELPER_TEXT_CLASS}>
          When this trial is on, staff can type BANK HOLIDAY to enter hours on a booked bank holiday.
          Turning it off restores manager-only Timesheet override.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        {loading ? (
          <PanelLoader message="Loading bank holiday trial setting..." className="py-8" />
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="bank-holiday-self-override-enabled" className="flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-avs-yellow" />
                Allow staff to confirm bank-holiday hours
              </Label>
              <p className={SETTINGS_HELPER_TEXT_CLASS}>
                {enabled
                  ? 'On: staff can unlock booked bank-holiday days after typing BANK HOLIDAY. Ordinary annual leave stays locked.'
                  : 'Off: only a manager Timesheet override can unlock leave days.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
              <Switch
                id="bank-holiday-self-override-enabled"
                checked={enabled}
                disabled={saving}
                onCheckedChange={handleToggle}
                aria-label="Enable bank holiday self-override trial"
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
