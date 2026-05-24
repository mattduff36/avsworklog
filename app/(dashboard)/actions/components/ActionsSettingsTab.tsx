'use client';

import { useState } from 'react';
import { CheckCircle2, EyeOff, Settings } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActionedActionsPanel } from './ActionedActionsPanel';
import { FleetInspectionSettingsPanel } from './FleetInspectionSettingsPanel';
import { IgnoredActionsPanel } from './IgnoredActionsPanel';

interface ActionsSettingsTabProps {
  onSaved?: () => void;
}

type SettingsTab = 'fleet-inspection' | 'ignored-reminders' | 'actioned-reminders';

const settingsTriggerClassName = 'gap-2 data-[state=active]:bg-avs-yellow data-[state=active]:text-slate-900';

export function ActionsSettingsTab({ onSaved }: ActionsSettingsTabProps) {
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('fleet-inspection');

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Tabs value={settingsTab} onValueChange={(value) => setSettingsTab(value as SettingsTab)}>
          <TabsList>
            <TabsTrigger value="fleet-inspection" className={settingsTriggerClassName}>
              <Settings className="h-4 w-4" />
              Fleet inspections
            </TabsTrigger>
            <TabsTrigger value="ignored-reminders" className={settingsTriggerClassName}>
              <EyeOff className="h-4 w-4" />
              Ignored reminders
            </TabsTrigger>
            <TabsTrigger value="actioned-reminders" className={settingsTriggerClassName}>
              <CheckCircle2 className="h-4 w-4" />
              Actioned reminders
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {settingsTab === 'fleet-inspection' ? (
        <FleetInspectionSettingsPanel onSaved={onSaved} />
      ) : null}

      {settingsTab === 'ignored-reminders' ? (
        <IgnoredActionsPanel onRestored={onSaved} />
      ) : null}

      {settingsTab === 'actioned-reminders' ? (
        <ActionedActionsPanel />
      ) : null}
    </div>
  );
}
