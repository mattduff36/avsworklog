'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';
import { MapPin, Settings, Users } from 'lucide-react';

export type InventoryRoleViewMode = 'management' | 'employee';

/** Primary module tabs: 3-up grid on mobile, left-aligned row from md. */
export const INVENTORY_PRIMARY_TABS_LIST_CLASSNAME =
  'grid w-full grid-cols-3 gap-1 md:inline-flex md:w-auto';

/** Secondary tabs: 2-up grid on mobile, compact row from md. */
export const INVENTORY_SECONDARY_TABS_LIST_CLASSNAME =
  'grid w-full grid-cols-2 gap-1 md:inline-flex md:w-auto';

export const INVENTORY_TAB_TRIGGER_CLASSNAME =
  'min-h-11 w-full gap-2 px-2 md:w-auto md:px-3';

/** Wrap secondary tab rows: left on mobile, right on tablet/desktop. */
export const INVENTORY_SECONDARY_TABS_ROW_CLASSNAME =
  'mt-3 flex justify-start md:justify-end';

interface InventoryRoleViewToggleProps {
  value: InventoryRoleViewMode;
  onValueChange: (value: InventoryRoleViewMode) => void;
}

export function InventoryRoleViewToggle({ value, onValueChange }: InventoryRoleViewToggleProps) {
  return (
    <div
      className="flex w-full items-center rounded-md border border-slate-700 bg-slate-800/80 p-0.5 sm:w-auto"
      role="group"
      aria-label="Inventory view mode"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onValueChange('management')}
        className={cn(
          'h-9 min-h-9 flex-1 gap-1.5 px-3 sm:flex-none',
          value === 'management'
            ? 'bg-white text-slate-900 hover:bg-white hover:text-slate-900'
            : 'text-muted-foreground hover:bg-transparent hover:text-white',
        )}
        aria-pressed={value === 'management'}
        aria-label="Management"
        title="Management"
      >
        <Settings className="h-3.5 w-3.5" />
        <span className="text-sm font-medium">Management</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onValueChange('employee')}
        className={cn(
          'h-9 min-h-9 flex-1 gap-1.5 px-3 sm:flex-none',
          value === 'employee'
            ? 'bg-white text-slate-900 hover:bg-white hover:text-slate-900'
            : 'text-muted-foreground hover:bg-transparent hover:text-white',
        )}
        aria-pressed={value === 'employee'}
        aria-label="My Location"
        title="My Location"
      >
        <Users className="h-3.5 w-3.5" />
        <span className="text-sm font-medium">My Location</span>
      </Button>
    </div>
  );
}

interface InventoryContextToolbarProps {
  roleViewToggle?: ReactNode;
  locationLabel: string | null;
  onChangeLocation: () => void;
  showLocationAction?: boolean;
}

export function InventoryContextToolbar({
  roleViewToggle,
  locationLabel,
  onChangeLocation,
  showLocationAction = true,
}: InventoryContextToolbarProps) {
  if (!roleViewToggle && !showLocationAction) return null;

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-slate-900/40 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      data-testid="inventory-context-toolbar"
    >
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Working context
        </p>
        <p className="truncate text-sm text-white">
          {locationLabel ? `Current location: ${locationLabel}` : 'No location set'}
        </p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        {roleViewToggle}
        {showLocationAction ? (
          <Button
            variant="outline"
            onClick={onChangeLocation}
            className="min-h-11 w-full border-slate-600 sm:w-auto"
          >
            <MapPin className="mr-2 h-4 w-4" />
            {locationLabel ? 'Change My Location' : 'Set My Location'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export interface InventorySummaryCardItem {
  id: string;
  label: string;
  shortLabel?: string;
  value: number;
  icon: ReactNode;
  tone?: 'default' | 'danger' | 'warning' | 'info';
  onClick?: () => void;
}

interface InventorySummaryCardProps {
  label: string;
  shortLabel?: string;
  value: number;
  icon: ReactNode;
  tone?: 'default' | 'danger' | 'warning' | 'info';
  onClick?: () => void;
}

export function InventorySummaryCard({
  label,
  shortLabel,
  value,
  icon,
  tone = 'default',
  onClick,
}: InventorySummaryCardProps) {
  const toneClassName = {
    default: 'text-inventory bg-inventory-soft',
    danger: 'text-red-300 bg-red-500/10',
    warning: 'text-amber-300 bg-amber-500/10',
    info: 'text-blue-300 bg-blue-500/10',
  }[tone];
  const mobileLabel = shortLabel || label;

  const card = (
    <Card className={`h-full border-slate-700 bg-slate-900/70 transition-colors ${onClick ? 'hover:border-slate-500 hover:bg-slate-800/70' : ''}`}>
      <CardContent className="flex items-center justify-center gap-0 px-1 py-1.5 text-center md:justify-start md:gap-3 md:p-4 md:text-left">
        <div className={`hidden rounded-lg p-2 md:block ${toneClassName}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold leading-none text-white md:text-2xl">{value}</div>
          <div className="mt-0.5 text-[8px] font-medium uppercase leading-tight tracking-wide text-muted-foreground md:mt-0 md:text-xs">
            <span className="md:hidden">{mobileLabel}</span>
            <span className="hidden md:inline">{label}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (!onClick) return card;

  return (
    <button
      type="button"
      onClick={onClick}
      className="h-full w-full appearance-none rounded-lg border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inventory focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
      aria-label={`Filter inventory by ${label}`}
    >
      {card}
    </button>
  );
}

interface InventorySummaryCardsProps {
  cards: InventorySummaryCardItem[];
  className?: string;
}

export function InventorySummaryCards({ cards, className }: InventorySummaryCardsProps) {
  return (
    <div
      className={cn('grid grid-cols-5 gap-1 md:gap-4', className)}
      data-testid="inventory-summary-cards"
    >
      {cards.map((card) => (
        <InventorySummaryCard
          key={card.id}
          label={card.label}
          shortLabel={card.shortLabel}
          value={card.value}
          icon={card.icon}
          tone={card.tone}
          onClick={card.onClick}
        />
      ))}
    </div>
  );
}
