'use client';

import { AppPageHeader } from '@/components/layout/AppPageShell';
import { DailyAllocationBetaBadge } from '@/components/daily-allocation/DailyAllocationBetaBadge';
import { Button } from '@/components/ui/button';

export const DAILY_ALLOCATION_MODULE_DESCRIPTION =
  'Assign jobs and plant to employees for a full day, morning, or afternoon, then publish an immutable allocation.';

interface DailyAllocationModuleHeaderProps {
  latestPublicationLabel?: string;
  onOpenHistory?: () => void;
  onCopy?: () => void;
  onPublish: () => void;
  publishDisabled?: boolean;
  publishDisabledReason?: string;
  publishing?: boolean;
}

export function DailyAllocationModuleHeader({
  latestPublicationLabel,
  onOpenHistory,
  onCopy,
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
        actions={(
          <>
            {latestPublicationLabel ? (
              <p className="basis-full text-sm text-muted-foreground md:max-w-xs md:basis-auto md:text-right" data-testid="daily-allocation-latest-publication">
                {latestPublicationLabel}
              </p>
            ) : null}
            {onOpenHistory ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 border-border text-muted-foreground md:h-9"
                onClick={onOpenHistory}
              >
                Publication history
              </Button>
            ) : null}
            {onCopy ? (
              <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onCopy}>
                Copy
              </Button>
            ) : null}
            {publishDisabled && publishDisabledReason ? (
              <p
                id="daily-allocation-publish-reason"
                className="max-w-sm text-sm text-muted-foreground"
                data-testid="daily-allocation-publish-reason"
              >
                {publishDisabledReason}
              </p>
            ) : null}
            <Button
              type="button"
              className="h-11 bg-daily-allocation text-white shadow-md transition-all duration-200 hover:bg-daily-allocation-dark hover:shadow-lg active:scale-95 md:h-9"
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
