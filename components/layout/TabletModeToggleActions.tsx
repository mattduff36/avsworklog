'use client';

import { MonitorSmartphone } from 'lucide-react';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function TabletModeToggleActions() {
  const { tabletModeEnabled, enableTabletMode, disableTabletMode } = useTabletMode();

  if (tabletModeEnabled) {
    return (
      <div className="flex items-center gap-2">
        <Badge className="bg-avs-yellow text-slate-900 border border-avs-yellow/80">
          <MonitorSmartphone className="mr-1 h-3.5 w-3.5" />
          Tablet Mode Active
        </Badge>
        <Button variant="outline" onClick={disableTabletMode}>
          Exit Tablet Mode
        </Button>
      </div>
    );
  }

  return (
    <Button variant="outline" onClick={enableTabletMode}>
      Try Tablet Mode
    </Button>
  );
}
