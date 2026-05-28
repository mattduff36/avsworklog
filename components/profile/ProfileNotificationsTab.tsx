'use client';

import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { NotificationModule, NotificationModuleKey, NotificationPreference } from '@/types/notifications';

interface ProfileNotificationsTabProps {
  modules: NotificationModule[];
  preferences: NotificationPreference[];
  isLoadingPreferences: boolean;
  savingPreferenceModules: NotificationModuleKey[];
  onTogglePreference: (
    moduleKey: NotificationModuleKey,
    field: 'notify_in_app' | 'notify_email',
    checked: boolean
  ) => void;
}

function getPreference(
  preferences: NotificationPreference[],
  moduleKey: NotificationModuleKey
): Pick<NotificationPreference, 'notify_in_app' | 'notify_email'> {
  return (
    preferences.find((preference) => preference.module_key === moduleKey) || {
      notify_in_app: true,
      notify_email: true,
    }
  );
}

export function ProfileNotificationsTab({
  modules,
  preferences,
  isLoadingPreferences,
  savingPreferenceModules,
  onTogglePreference,
}: ProfileNotificationsTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Choose which profile, operational, and role-based alerts reach you in-app or by email.
        </CardDescription>
        {isLoadingPreferences ? (
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Loading saved preferences...</span>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 lg:grid-cols-2">
          {modules.map((module) => {
            const preference = getPreference(preferences, module.key);
            const isSaving = savingPreferenceModules.includes(module.key);
            const isDisabled = isLoadingPreferences || isSaving;

            return (
              <div
                key={module.key}
                id={`notification-preference-${module.key}`}
                className="scroll-mt-24 rounded-lg border border-border bg-slate-900/30 p-4"
              >
                <div className="mb-4">
                  <p className="text-sm font-semibold text-foreground">{module.label}</p>
                  <p className="text-xs text-muted-foreground">{module.description}</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-md border border-border bg-[hsl(var(--card))] px-3 py-2">
                    <Label htmlFor={`profile-notify-in-app-${module.key}`} className="text-xs">
                      In-app
                    </Label>
                    <Switch
                      id={`profile-notify-in-app-${module.key}`}
                      checked={preference.notify_in_app}
                      disabled={isDisabled}
                      onCheckedChange={(checked) =>
                        onTogglePreference(module.key, 'notify_in_app', checked)
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-border bg-[hsl(var(--card))] px-3 py-2">
                    <Label htmlFor={`profile-notify-email-${module.key}`} className="text-xs">
                      Email
                    </Label>
                    <Switch
                      id={`profile-notify-email-${module.key}`}
                      checked={preference.notify_email}
                      disabled={isDisabled}
                      onCheckedChange={(checked) =>
                        onTogglePreference(module.key, 'notify_email', checked)
                      }
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

