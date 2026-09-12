'use client';

import { AppPageHeader } from '@/components/layout/AppPageShell';
import { DailyAllocationBetaBadge } from '@/components/daily-allocation/DailyAllocationBetaBadge';
import { Button } from '@/components/ui/button';

export const DAILY_ALLOCATION_MODULE_DESCRIPTION =
  'Place timed visits against catalogue jobs, assign people and plant, then publish an immutable allocation.';

interface DailyAllocationModuleHeaderProps {
  latestPublicationLabel?: string;
  onOpenHistory?: () => void;
  onPublish: () => void;
  publishDisabled?: boolean;
  publishDisabledReason?: string;
  publishing?: boolean;
}

export function DailyAllocationModuleHeader({
  latestPublicationLabel,
  onOpenHistory,
  onPublish,
  publishDisabled,
  publishDisabledReason,
  publishing,
}: DailyAllocationModuleHeaderProps) {
  return (
    <div data-testid="daily-allocation-module-header">
      <AppPageHeader
        title="Daily Allocation"
        titleMeta={<DailyAllocationBetaBadge />}
        description={DAILY_ALLOCATION_MODULE_DESCRIPTION}
        details={latestPublicationLabel}
        actions={(
          <>
            {publishDisabled && publishDisabledReason ? (
              <p
                id="daily-allocation-publish-reason"
                className="max-w-56 truncate text-sm text-muted-foreground"
                data-testid="daily-allocation-publish-reason"
                title={publishDisabledReason}
              >
                {publishDisabledReason}
              </p>
            ) : null}
            {onOpenHistory ? (
              <Button
                type="button"
                variant="outline"
                className="border-border text-muted-foreground"
                onClick={onOpenHistory}
              >
                Publication history
              </Button>
            ) : null}
            <Button
              type="button"
              className="bg-daily-allocation text-white shadow-md transition-all duration-200 hover:bg-daily-allocation-dark hover:shadow-lg active:scale-95"
              onClick={onPublish}
              disabled={publishDisabled || publishing}
              aria-describedby={publishDisabled && publishDisabledReason ? 'daily-allocation-publish-reason' : undefined}
              data-testid="daily-allocation-publish"
            >
              {publishing ? 'Publishing…' : 'Publish'}
            </Button>
          </>
        )}
      />
    </div>
  );
}
