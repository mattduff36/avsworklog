'use client';

import { useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  APP_WIDESCREEN_CHANGED_EVENT,
  readAppWidescreenPreference,
  writeAppWidescreenPreference,
} from '@/lib/config/layout-preferences';

export function ProfileWidescreenPreferenceCard() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const syncPreference = () => {
      setEnabled(readAppWidescreenPreference());
    };

    syncPreference();
    window.addEventListener('storage', syncPreference);
    window.addEventListener(APP_WIDESCREEN_CHANGED_EVENT, syncPreference);

    return () => {
      window.removeEventListener('storage', syncPreference);
      window.removeEventListener(APP_WIDESCREEN_CHANGED_EVENT, syncPreference);
    };
  }, []);

  function handleToggle(checked: boolean) {
    setEnabled(checked);
    writeAppWidescreenPreference(checked);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-sky-500/15 p-3 text-sky-300 sm:p-2">
            <Monitor className="h-6 w-6 sm:h-5 sm:w-5" />
          </div>
          <div>
            <CardTitle>Widescreen view</CardTitle>
            <CardDescription className="text-base sm:text-sm">
              Use a wider content area on desktop screens in this browser.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-background/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="font-medium text-foreground">Use widescreen layout on desktop</p>
            <p className="text-sm text-muted-foreground">
              This personal display preference is stored on the current device.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {enabled ? 'Enabled' : 'Default width'}
            </span>
            <Switch
              checked={enabled}
              onCheckedChange={handleToggle}
              aria-label="Use widescreen layout on desktop"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
