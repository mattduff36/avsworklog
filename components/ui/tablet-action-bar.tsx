'use client';

import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { TabletAwareButton } from '@/components/ui/tablet-mode-controls';
import { cn } from '@/lib/utils/cn';
import type { ButtonProps } from '@/components/ui/button';

type ActionButtonType = NonNullable<ButtonProps['type']>;
type ActionButtonVariant = NonNullable<ButtonProps['variant']>;

export interface TabletActionBarAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  type?: ActionButtonType;
  variant?: ActionButtonVariant;
  className?: string;
}

export interface TabletActionBarProps {
  primaryAction: TabletActionBarAction;
  secondaryAction: TabletActionBarAction;
  tertiaryAction?: TabletActionBarAction;
  statusText?: string;
  className?: string;
}

export function TabletActionBar({
  primaryAction,
  secondaryAction,
  tertiaryAction,
  statusText,
  className,
}: TabletActionBarProps) {
  const { tabletModeEnabled } = useTabletMode();

  if (!tabletModeEnabled) return null;
  const showStatus = Boolean(statusText && statusText.trim().length > 0);

  const actionContainerClass = cn(
    'flex gap-2',
    'flex-row items-center'
  );

  return (
    <div
      data-testid="tablet-action-bar"
      className={cn(
        'z-30 border border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 shadow-md',
        'sticky bottom-0 mt-4 rounded-lg p-3',
        className
      )}
    >
      {showStatus ? (
        <p className="mb-2 text-xs text-muted-foreground">
          {statusText}
        </p>
      ) : null}

      <div data-testid="tablet-action-bar-actions" className={actionContainerClass}>
        <TabletAwareButton
          type={primaryAction.type ?? 'button'}
          onClick={primaryAction.onClick}
          disabled={primaryAction.disabled}
          variant={primaryAction.variant ?? 'default'}
          className={cn(
            'flex-1',
            primaryAction.className
          )}
        >
          {primaryAction.label}
        </TabletAwareButton>

        <TabletAwareButton
          type={secondaryAction.type ?? 'button'}
          onClick={secondaryAction.onClick}
          disabled={secondaryAction.disabled}
          variant={secondaryAction.variant ?? 'outline'}
          className={cn(
            'flex-1',
            secondaryAction.className
          )}
        >
          {secondaryAction.label}
        </TabletAwareButton>

        {tertiaryAction ? (
          <TabletAwareButton
            type={tertiaryAction.type ?? 'button'}
            onClick={tertiaryAction.onClick}
            disabled={tertiaryAction.disabled}
            variant={tertiaryAction.variant ?? 'secondary'}
            className={cn(
              'flex-1',
              tertiaryAction.className
            )}
          >
            {tertiaryAction.label}
          </TabletAwareButton>
        ) : null}
      </div>
    </div>
  );
}
