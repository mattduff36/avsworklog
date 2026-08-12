'use client';

import type { ComponentType, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';
import { MapPin, PackageSearch, Plus, Settings, Users } from 'lucide-react';

export type InventoryRoleViewMode = 'management' | 'employee';

/** Primary module tabs: desktop-only row. Mobile uses InventoryMobilePrimaryNav instead. */
export const INVENTORY_PRIMARY_TABS_LIST_CLASSNAME = 'hidden md:inline-flex md:w-auto';

/** Employee My Location tabs: desktop-only row. Mobile uses InventoryMobilePrimaryNav instead. */
export const INVENTORY_EMPLOYEE_TABS_LIST_CLASSNAME = 'hidden md:inline-flex md:w-auto';

/** Keep primary navigation left and the compact view switcher right (desktop only; mobile renders its own row). */
export const INVENTORY_PRIMARY_TABS_ROW_CLASSNAME = 'hidden items-center justify-between md:flex';

/** Secondary tabs: desktop-only row. Mobile uses InventoryMobileSecondaryNav instead. */
export const INVENTORY_SECONDARY_TABS_LIST_CLASSNAME = 'hidden md:inline-flex md:w-auto';

export const INVENTORY_TAB_TRIGGER_CLASSNAME =
  'gap-2 rounded-md px-3 data-[state=active]:bg-inventory data-[state=active]:text-white';

export const INVENTORY_HEADER_CTA_CLASSNAME =
  'h-11 w-auto bg-inventory text-white shadow-md transition-all duration-200 hover:bg-inventory-dark hover:shadow-lg active:scale-95 sm:h-8';

/** Desktop-only secondary tab row wrapper (right-aligned). Mobile renders InventoryMobileSecondaryNav instead. */
export const INVENTORY_SECONDARY_TABS_ROW_CLASSNAME = 'hidden justify-end md:flex';

/** Compact header surface used across Inventory list/detail shells. */
export const INVENTORY_PAGE_HEADER_CLASSNAME = 'p-4';

interface InventoryRoleViewToggleProps {
  value: InventoryRoleViewMode;
  onValueChange: (value: InventoryRoleViewMode) => void;
  showLabel?: boolean;
}

export function InventoryRoleViewToggle({
  value,
  onValueChange,
  showLabel = true,
}: InventoryRoleViewToggleProps) {
  return (
    <div className="flex shrink-0 items-center gap-2" data-testid="inventory-view-toggle">
      {showLabel ? <span className="text-xs font-medium text-muted-foreground">View</span> : null}
      <div
        className="flex items-center rounded-md border border-slate-700 bg-slate-800/80 p-0.5"
        role="group"
        aria-label="Inventory view mode"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onValueChange('management')}
          className={cn(
            'h-11 w-12 md:h-8 md:w-10',
            value === 'management'
              ? 'bg-white text-slate-900 hover:bg-white hover:text-slate-900'
              : 'text-muted-foreground hover:bg-transparent hover:text-white',
          )}
          aria-pressed={value === 'management'}
          aria-label="Management"
          title="Management"
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onValueChange('employee')}
          className={cn(
            'h-11 w-12 md:h-8 md:w-10',
            value === 'employee'
              ? 'bg-white text-slate-900 hover:bg-white hover:text-slate-900'
              : 'text-muted-foreground hover:bg-transparent hover:text-white',
          )}
          aria-pressed={value === 'employee'}
          aria-label="My Location"
          title="My Location"
        >
          <Users className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

interface InventoryLocationLabelProps {
  locationLabel: string | null;
}

export function InventoryLocationLabel({ locationLabel }: InventoryLocationLabelProps) {
  return locationLabel ? `Current location: ${locationLabel}` : 'No location set';
}

interface InventoryLocationActionProps {
  locationLabel: string | null;
  onChangeLocation: () => void;
}

export function InventoryLocationAction({
  locationLabel,
  onChangeLocation,
}: InventoryLocationActionProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onChangeLocation}
      aria-label={locationLabel ? 'Change My Location' : 'Set My Location'}
      className="h-11 shrink-0 border-slate-600 sm:h-8"
      data-testid="inventory-location-action"
    >
      <MapPin className="mr-2 h-4 w-4" />
      <span className="sm:hidden">{locationLabel ? 'Change' : 'Set'}</span>
      <span className="hidden sm:inline">
        {locationLabel ? 'Change My Location' : 'Set My Location'}
      </span>
    </Button>
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
      className={cn('hidden md:grid md:grid-cols-5 md:gap-4', className)}
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

/* ------------------------------------------------------------------------ */
/* Mobile-only module chrome                                                 */
/* ------------------------------------------------------------------------ */

const MOBILE_STATUS_TONE_CLASSNAME: Record<'danger' | 'warning' | 'info' | 'neutral', string> = {
  danger: 'border-red-500/25 bg-red-500/[0.06] text-red-200',
  warning: 'border-amber-500/25 bg-amber-500/[0.06] text-amber-200',
  info: 'border-blue-500/25 bg-blue-500/[0.06] text-blue-200',
  neutral: 'border-slate-600/40 bg-slate-800/40 text-slate-200',
};

export interface InventoryMobileStatusChipProps {
  id: string;
  label: string;
  value: number;
  icon: ReactNode;
  tone: 'danger' | 'warning' | 'info' | 'neutral';
  isActive?: boolean;
  onClick?: () => void;
}

/** One compact tappable status tile used for standalone contextual alert rows (e.g. My Location check alerts). */
export function InventoryMobileStatusChip({ id, label, value, icon, tone, isActive, onClick }: InventoryMobileStatusChipProps) {
  return (
    <button
      key={id}
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-pressed={Boolean(isActive)}
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inventory',
        MOBILE_STATUS_TONE_CLASSNAME[tone],
        isActive && 'ring-2 ring-avs-yellow/70',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold leading-none text-white">{value}</span>
        <span className="mt-0.5 block truncate text-[11px] leading-tight opacity-90">{label}</span>
      </span>
      <span className="shrink-0 opacity-80">{icon}</span>
    </button>
  );
}

export interface InventoryMobileNavItem<TValue extends string = string> {
  value: TValue;
  label: string;
  icon: ComponentType<{ className?: string }>;
  count?: number;
  /** Optional per-tile icon tint (used by Settings-style navs); defaults to uniform slate. Overridden by the yellow active-state tint. */
  iconClassName?: string;
}

interface InventoryMobileNavProps<TValue extends string> {
  items: readonly InventoryMobileNavItem<TValue>[];
  value: TValue;
  onValueChange: (value: TValue) => void;
  'aria-label': string;
  className?: string;
}

/** Primary mobile module navigation (Overview / Locations / Settings). Bind to the same state as the desktop Tabs. Sits directly on the sticky wrapper's surface (no extra nested border/card). */
export function InventoryMobilePrimaryNav<TValue extends string>({
  items,
  value,
  onValueChange,
  'aria-label': ariaLabel,
  className,
}: InventoryMobileNavProps<TValue>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('grid', className)}
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item, index) => {
        const Icon = item.icon;
        const isActive = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onValueChange(item.value)}
            className={cn(
              'relative flex min-h-10 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[13px] font-semibold transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inventory',
              index > 0 && 'ml-0.5',
              isActive ? 'text-white' : 'text-muted-foreground hover:bg-slate-800/50 hover:text-slate-200',
            )}
          >
            <Icon className={cn('h-4 w-4', isActive && 'text-avs-yellow')} />
            <span className="flex items-center gap-1 whitespace-nowrap">
              {item.label}
              {typeof item.count === 'number' ? (
                <span className="rounded-full bg-slate-700 px-1.5 py-0.5 text-[9px] font-bold leading-none text-slate-200">
                  {item.count}
                </span>
              ) : null}
            </span>
            {isActive ? <span aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-avs-yellow" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Sticky wrapper for the primary mobile nav so it stays reachable while scrolling long lists. Sits below the fixed app Navbar. */
export function InventoryMobileStickyNav({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'sticky z-30 -mx-4 border-b border-slate-800/70 bg-slate-950/92 px-4 py-1 backdrop-blur-md md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none',
        className,
      )}
      style={{ top: 'var(--top-nav-h)' }}
      data-testid="inventory-mobile-sticky-nav"
    >
      {children}
    </div>
  );
}

/** Secondary mobile section navigation (e.g. Overview's Small Tools / Minor Plant / Hardware / Retired). Same restrained language as the primary nav and list cards: no per-tile background blocks, no icon boxes. */
export function InventoryMobileSecondaryNav<TValue extends string>({
  items,
  value,
  onValueChange,
  'aria-label': ariaLabel,
  className,
}: InventoryMobileNavProps<TValue>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('grid grid-cols-2 gap-1.5', className)}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onValueChange(item.value)}
            className={cn(
              'flex min-h-10 items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inventory',
              isActive
                ? 'border-slate-600 bg-slate-800/70 text-white'
                : 'border-transparent text-slate-400 hover:bg-slate-800/40 hover:text-slate-200',
            )}
          >
            <Icon
              className={cn(
                'h-4 w-4 shrink-0',
                isActive ? 'text-avs-yellow' : item.iconClassName || 'text-slate-500',
              )}
            />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {typeof item.count === 'number' ? (
              <span className="shrink-0 rounded-full bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-300">
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

interface InventoryMobileHeaderProps {
  addLabel?: string;
  onAdd?: () => void;
  locationLabel: string | null;
  onChangeLocation: () => void;
  description?: string;
}

/** Compact mobile Inventory header card: icon/title/description on top, Add alongside, current-location context below a subtle divider. One surface, no nested boxes. */
export function InventoryMobileHeader({
  addLabel = 'Add',
  onAdd,
  locationLabel,
  onChangeLocation,
  description,
}: InventoryMobileHeaderProps) {
  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-4" data-testid="inventory-mobile-header">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <PackageSearch className="mt-0.5 h-5 w-5 shrink-0 text-avs-yellow" />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold leading-tight text-white">Inventory</h1>
            {description ? <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {onAdd ? (
          <Button
            size="sm"
            onClick={onAdd}
            className="h-9 shrink-0 bg-inventory px-3 text-white hover:bg-inventory-dark"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {addLabel}
          </Button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onChangeLocation}
        className="mt-3 flex min-h-9 w-full items-center justify-between gap-2 border-t border-slate-800/70 pt-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inventory"
        data-testid="inventory-mobile-location-action"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-sm text-slate-300">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          <span className="min-w-0 truncate">{locationLabel || 'No location set'}</span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-avs-yellow">
          {locationLabel ? 'Change' : 'Set'}
        </span>
      </button>
    </div>
  );
}
