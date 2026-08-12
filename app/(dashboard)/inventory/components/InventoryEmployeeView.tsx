'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  CheckCircle2,
  Hand,
  LayoutDashboard,
  MapPin,
  PackageSearch,
  Send,
} from 'lucide-react';
import type {
  InventoryCheckStatus,
  InventoryHardwareBalance,
  InventoryHardwareItem,
  InventoryHardwareTransferPayload,
  InventoryItem,
  InventoryLocation,
  InventoryUserLocation,
  InventoryUserSiteLocation,
} from '../types';
import {
  formatInventoryLocationTypeLabel,
  getInventoryEmployeeOverviewStats,
  isLegacyQuoteInventoryLocation,
} from '../utils';
import { InventoryLocationSelect } from './InventoryLocationSelect';
import {
  InventoryMobilePrimaryNav,
  InventoryMobileStatusChip,
  InventoryMobileStickyNav,
  InventorySummaryCards,
  INVENTORY_EMPLOYEE_TABS_LIST_CLASSNAME,
  INVENTORY_PRIMARY_TABS_ROW_CLASSNAME,
  INVENTORY_TAB_TRIGGER_CLASSNAME,
} from './InventoryPageChrome';
import { InventoryTable, type InventoryTableQuickFilter } from './InventoryTable';
import { HardwareQuantityRow } from './HardwareQuantityRow';
import { HardwareTransferDialog } from './HardwareTransferDialog';
import { LegacyQuoteLocationOptIn } from './LegacyQuoteLocationOptIn';

const LOCATION_NOT_SHOWN_VALUE = '__location_not_shown__';

export type InventoryEmployeeTab = 'overview' | 'items' | 'hardware' | 'claim';

const EMPLOYEE_NAV_ITEMS: Array<{
  value: InventoryEmployeeTab;
  label: string;
  shortLabel?: string;
  icon: typeof LayoutDashboard;
}> = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'items', label: 'Inventory Items', shortLabel: 'Items', icon: PackageSearch },
  { value: 'hardware', label: 'Hardware', icon: Boxes },
  { value: 'claim', label: 'Claim Item', shortLabel: 'Claim', icon: Hand },
];

interface InventoryEmployeeViewProps {
  items: InventoryItem[];
  locations: InventoryLocation[];
  categoryLabels?: Record<string, string>;
  userLocation: InventoryUserLocation | null;
  secondarySiteLocations?: InventoryUserSiteLocation[];
  hardwareItems?: InventoryHardwareItem[];
  hardwareBalances?: InventoryHardwareBalance[];
  locationFilter?: (location: InventoryLocation) => boolean;
  onSetUserLocation: (locationId: string) => Promise<void>;
  onRequestLocation: (payload: { suggested_name: string; note: string }) => Promise<void>;
  onOpenMoveDialog: (items: InventoryItem[]) => void;
  onTransferHardware?: (payload: InventoryHardwareTransferPayload) => Promise<void>;
  /** Desktop-only View control; mobile uses the Navbar portal. */
  desktopViewToggle?: ReactNode;
}

export function InventoryEmployeeView({
  items,
  locations,
  categoryLabels,
  userLocation,
  secondarySiteLocations = [],
  hardwareItems = [],
  hardwareBalances = [],
  locationFilter,
  onSetUserLocation,
  onRequestLocation,
  onOpenMoveDialog,
  onTransferHardware,
  desktopViewToggle,
}: InventoryEmployeeViewProps) {
  const initialLocationId = userLocation?.location?.is_active === false ? '' : userLocation?.location_id || '';
  const [selectedLocationId, setSelectedLocationId] = useState(initialLocationId);
  const [suggestedName, setSuggestedName] = useState('');
  const [requestNote, setRequestNote] = useState('');
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [isRequestingLocation, setIsRequestingLocation] = useState(false);
  const [claimSearch, setClaimSearch] = useState('');
  const [includeLegacyQuoteClaims, setIncludeLegacyQuoteClaims] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [hardwareTransferOpen, setHardwareTransferOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<InventoryEmployeeTab>('overview');
  const [itemsQuickFilter, setItemsQuickFilter] = useState<InventoryTableQuickFilter>({
    version: 0,
    statusFilters: [],
    locationFilters: [],
    search: '',
  });

  const activeLocation = userLocation?.location?.is_active === false ? null : userLocation?.location || null;
  const isRequestingMissingLocation = selectedLocationId === LOCATION_NOT_SHOWN_VALUE;

  useEffect(() => {
    setSelectedLocationId(userLocation?.location?.is_active === false ? '' : userLocation?.location_id || '');
  }, [userLocation?.location?.is_active, userLocation?.location_id]);

  const activeItemsByLocationId = useMemo(() => {
    const nextItemsByLocationId = new Map<string, InventoryItem[]>();
    items.forEach((item) => {
      if (item.status !== 'active') return;
      const locationItems = nextItemsByLocationId.get(item.location_id) || [];
      locationItems.push(item);
      nextItemsByLocationId.set(item.location_id, locationItems);
    });
    return nextItemsByLocationId;
  }, [items]);
  const locationItems = activeLocation ? activeItemsByLocationId.get(activeLocation.id) || [] : [];
  const activeSecondaryLocations = useMemo(
    () => secondarySiteLocations.filter((secondaryLocation) => (
      secondaryLocation.location?.is_active === true
      && ['site', 'manual'].includes(secondaryLocation.location.location_type)
    )),
    [secondarySiteLocations]
  );
  const responsibleHardwareLocations = useMemo(
    () => [
      ...(activeLocation ? [activeLocation] : []),
      ...activeSecondaryLocations.flatMap((secondaryLocation) => (
        secondaryLocation.location ? [secondaryLocation.location] : []
      )),
    ],
    [activeLocation, activeSecondaryLocations],
  );
  const responsibleLocationIds = useMemo(
    () => responsibleHardwareLocations.map((location) => location.id),
    [responsibleHardwareLocations],
  );
  const hardwareItemById = useMemo(
    () => new Map(hardwareItems.map((item) => [item.id, item])),
    [hardwareItems],
  );
  const hardwareTransferLocations = useMemo(() => {
    const locationsById = new Map(
      responsibleHardwareLocations.map((location) => [location.id, location]),
    );
    for (const balance of hardwareBalances) {
      if (balance.quantity > 0 && balance.location?.is_active !== false) {
        if (balance.location) locationsById.set(balance.location.id, balance.location);
      }
    }
    return [...locationsById.values()];
  }, [hardwareBalances, responsibleHardwareLocations]);
  const hasTransferableHardware = hardwareBalances.some((balance) => (
    balance.quantity > 0 && hardwareItemById.get(balance.hardware_item_id)?.is_active === true
  ));
  const positiveHardwareByLocation = useMemo(() => {
    const grouped = new Map<string, InventoryHardwareBalance[]>();
    for (const balance of hardwareBalances) {
      if (balance.quantity <= 0 || !hardwareItemById.get(balance.hardware_item_id)?.is_active) continue;
      const locationBalances = grouped.get(balance.location_id) || [];
      locationBalances.push(balance);
      grouped.set(balance.location_id, locationBalances);
    }
    return grouped;
  }, [hardwareBalances, hardwareItemById]);
  const claimableItems = useMemo(() => {
    const query = claimSearch.trim().toLowerCase();
    if (!activeLocation || !query) return [];

    return items
      .filter((item) => item.status === 'active' && item.location_id !== activeLocation.id)
      .filter((item) => (
        item.item_number.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query) ||
        (
          includeLegacyQuoteClaims || !isLegacyQuoteInventoryLocation(item.location)
            ? item.location?.name || ''
            : ''
        ).toLowerCase().includes(query)
      ))
      .slice(0, 8);
  }, [activeLocation, claimSearch, includeLegacyQuoteClaims, items]);

  const overviewStats = useMemo(() => {
    if (!activeLocation) {
      return null;
    }

    return getInventoryEmployeeOverviewStats({
      items,
      primaryLocationId: activeLocation.id,
      responsibleLocationIds,
      hardwareItems,
      hardwareBalances,
      secondaryLocationCount: activeSecondaryLocations.length,
    });
  }, [
    activeLocation,
    activeSecondaryLocations.length,
    hardwareBalances,
    hardwareItems,
    items,
    responsibleLocationIds,
  ]);

  async function handleSetLocation() {
    if (!selectedLocationId || isRequestingMissingLocation) return;
    setIsSavingLocation(true);
    try {
      await onSetUserLocation(selectedLocationId);
    } finally {
      setIsSavingLocation(false);
    }
  }

  async function handleRequestLocation(event: React.FormEvent) {
    event.preventDefault();
    if (!suggestedName.trim()) return;

    setIsRequestingLocation(true);
    try {
      await onRequestLocation({ suggested_name: suggestedName, note: requestNote });
      setSuggestedName('');
      setRequestNote('');
    } finally {
      setIsRequestingLocation(false);
    }
  }

  function renderLocationRequestCard() {
    if (!isRequestingMissingLocation) return null;

    return (
      <Card className="border-amber-500/30 bg-amber-500/10">
        <CardHeader>
          <CardTitle className="text-white">Request Admin To Add My Location</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleRequestLocation}>
            <div className="space-y-2">
              <Label htmlFor="suggested_location">Suggested location name</Label>
              <Input
                id="suggested_location"
                value={suggestedName}
                onChange={(event) => setSuggestedName(event.target.value)}
                className="bg-slate-800 border-slate-600"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location_request_note">Note</Label>
              <Textarea
                id="location_request_note"
                value={requestNote}
                onChange={(event) => setRequestNote(event.target.value)}
                className="bg-slate-800 border-slate-600"
                rows={3}
              />
            </div>
            <Button
              type="submit"
              disabled={!suggestedName.trim() || isRequestingLocation}
              className="min-h-11 w-full bg-inventory text-white hover:bg-inventory-dark sm:w-auto"
            >
              <Send className="mr-2 h-4 w-4" />
              Send Request
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  function handleClaim(item: InventoryItem) {
    if (!activeLocation) return;
    onOpenMoveDialog([item]);
    setClaimSearch('');
  }

  function openItemsTab(statusFilters: InventoryCheckStatus[] = []) {
    setSelectedItemIds(new Set());
    setItemsQuickFilter((current) => ({
      version: current.version + 1,
      statusFilters,
      locationFilters: [],
      search: '',
    }));
    setActiveTab('items');
  }

  if (!activeLocation) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 py-8">
        {desktopViewToggle ? (
          <div className="hidden justify-end md:flex">{desktopViewToggle}</div>
        ) : null}
        <Card className="border-slate-700 bg-slate-900/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <MapPin className="h-5 w-5 text-inventory" />
              Set Your Inventory Location
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select the location or bin you are working from. Inventory items assigned to that location will appear here.
            </p>
            <div className="space-y-2">
              <Label>Location</Label>
              <InventoryLocationSelect
                value={selectedLocationId}
                onValueChange={setSelectedLocationId}
                locations={locations}
                placeholder="Choose your location"
                extraOptions={[{
                  value: LOCATION_NOT_SHOWN_VALUE,
                  label: 'Location not shown',
                  className: 'mt-1 border-t border-amber-500/30 bg-amber-500/10 font-semibold text-amber-200 hover:bg-amber-500/20 focus:bg-amber-500/20',
                }]}
                serverSearch
                locationFilter={locationFilter}
                allowLegacyQuoteOptIn={false}
              />
            </div>
            <Button
              onClick={handleSetLocation}
              disabled={!selectedLocationId || isRequestingMissingLocation || isSavingLocation}
              className="min-h-11 w-full bg-inventory text-white hover:bg-inventory-dark sm:w-auto"
            >
              Save Location
            </Button>
          </CardContent>
        </Card>

        {renderLocationRequestCard()}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as InventoryEmployeeTab)}
        className="space-y-4"
      >
        <InventoryMobileStickyNav className="md:hidden">
          <InventoryMobilePrimaryNav
            items={EMPLOYEE_NAV_ITEMS}
            value={activeTab}
            onValueChange={(value) => setActiveTab(value)}
            aria-label="My Location sections"
          />
        </InventoryMobileStickyNav>

        <div
          className={INVENTORY_PRIMARY_TABS_ROW_CLASSNAME}
          data-testid="inventory-employee-tabs-row"
        >
          <TabsList
            className={INVENTORY_EMPLOYEE_TABS_LIST_CLASSNAME}
            data-testid="inventory-employee-tabs"
          >
            {EMPLOYEE_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <TabsTrigger
                  key={item.value}
                  value={item.value}
                  className={INVENTORY_TAB_TRIGGER_CLASSNAME}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {desktopViewToggle}
        </div>

        <TabsContent value="overview" className="mt-0 space-y-4">
          {overviewStats ? (
            <>
              <Card className="border-slate-700 bg-slate-900/70">
                <CardContent className="space-y-2 p-4">
                  <p className="text-sm text-white">
                    Showing inventory for <span className="font-semibold">{activeLocation.name}</span>
                    {overviewStats.secondaryLocationCount > 0
                      ? ` plus ${overviewStats.secondaryLocationCount} secondary location${overviewStats.secondaryLocationCount === 1 ? '' : 's'}`
                      : ''}
                    .
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Item, hardware, and check-alert totals cover only locations you are responsible for. Claim uses the search pool outside your primary location.
                  </p>
                </CardContent>
              </Card>

              <div className="grid gap-3 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => openItemsTab()}
                  className="rounded-lg border border-slate-700 bg-slate-900/70 p-4 text-left transition-colors hover:border-slate-500 hover:bg-slate-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inventory"
                  aria-label="Open inventory items"
                >
                  <div className="flex items-center gap-2 text-inventory">
                    <PackageSearch className="h-4 w-4" />
                    <span className="text-xs font-medium uppercase tracking-wide">Inventory Items</span>
                  </div>
                  <div className="mt-2 text-2xl font-bold text-white">{overviewStats.responsibleItemCount}</div>
                  <p className="mt-1 text-sm text-muted-foreground">Active items at your locations</p>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('hardware')}
                  className="rounded-lg border border-slate-700 bg-slate-900/70 p-4 text-left transition-colors hover:border-slate-500 hover:bg-slate-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inventory"
                  aria-label="Open hardware"
                >
                  <div className="flex items-center gap-2 text-inventory">
                    <Boxes className="h-4 w-4" />
                    <span className="text-xs font-medium uppercase tracking-wide">Hardware</span>
                  </div>
                  <div className="mt-2 text-2xl font-bold text-white">{overviewStats.hardwareQuantityTotal}</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {overviewStats.hardwareSkuCount} SKU{overviewStats.hardwareSkuCount === 1 ? '' : 's'} with stock
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('claim')}
                  className="rounded-lg border border-slate-700 bg-slate-900/70 p-4 text-left transition-colors hover:border-slate-500 hover:bg-slate-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inventory"
                  aria-label="Open claim item"
                >
                  <div className="flex items-center gap-2 text-inventory">
                    <Hand className="h-4 w-4" />
                    <span className="text-xs font-medium uppercase tracking-wide">Claim Item</span>
                  </div>
                  <div className="mt-2 text-2xl font-bold text-white">{overviewStats.claimableItemCount}</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Active items outside your primary location (claim search pool)
                  </p>
                </button>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Check alerts at your locations
                </p>
                <div className="grid grid-cols-3 gap-2 md:hidden">
                  <InventoryMobileStatusChip
                    id="overdue"
                    label="Overdue"
                    value={overviewStats.overdue}
                    icon={<AlertTriangle className="h-4 w-4" />}
                    tone="danger"
                    onClick={() => openItemsTab(['overdue'])}
                  />
                  <InventoryMobileStatusChip
                    id="due-soon"
                    label="Due soon"
                    value={overviewStats.dueSoon}
                    icon={<AlertTriangle className="h-4 w-4" />}
                    tone="warning"
                    onClick={() => openItemsTab(['due_soon'])}
                  />
                  <InventoryMobileStatusChip
                    id="needs-check"
                    label="Need check"
                    value={overviewStats.needsCheck}
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    tone="info"
                    onClick={() => openItemsTab(['needs_check'])}
                  />
                </div>
                <InventorySummaryCards
                  cards={[
                    {
                      id: 'overdue',
                      label: 'Overdue',
                      value: overviewStats.overdue,
                      icon: <AlertTriangle className="h-5 w-5" />,
                      tone: 'danger',
                      onClick: () => openItemsTab(['overdue']),
                    },
                    {
                      id: 'due-soon',
                      label: 'Due Soon',
                      shortLabel: 'Soon',
                      value: overviewStats.dueSoon,
                      icon: <AlertTriangle className="h-5 w-5" />,
                      tone: 'warning',
                      onClick: () => openItemsTab(['due_soon']),
                    },
                    {
                      id: 'needs-check',
                      label: 'Needs Check',
                      shortLabel: 'Check',
                      value: overviewStats.needsCheck,
                      icon: <CheckCircle2 className="h-5 w-5" />,
                      tone: 'info',
                      onClick: () => openItemsTab(['needs_check']),
                    },
                  ]}
                  className="!grid-cols-3"
                />
              </div>
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="items" className="mt-0 space-y-6">
          <Card className="border-slate-700 bg-slate-900/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <PackageSearch className="h-5 w-5 text-inventory" />
                My Inventory Items
              </CardTitle>
            </CardHeader>
            <CardContent>
              {locationItems.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No active inventory items are currently assigned to this location.</p>
              ) : (
                <InventoryTable
                  key={`employee-primary-${itemsQuickFilter.version}`}
                  items={locationItems}
                  selectedItemIds={selectedItemIds}
                  onSelectedItemIdsChange={setSelectedItemIds}
                  onMove={onOpenMoveDialog}
                  categoryLabels={categoryLabels}
                  filterStorageKey="employee-primary"
                  quickFilter={itemsQuickFilter}
                />
              )}
            </CardContent>
          </Card>

          {activeSecondaryLocations.length > 0 ? (
            <div className="space-y-4">
              {activeSecondaryLocations.map((secondaryLocation) => {
                const location = secondaryLocation.location;
                if (!location) return null;
                const secondaryLocationItems = activeItemsByLocationId.get(location.id) || [];
                const locationTypeLabel = formatInventoryLocationTypeLabel(location);

                return (
                  <Card key={secondaryLocation.location_id} className="border-slate-700 bg-slate-900/70">
                    <CardHeader>
                      <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-white">
                        <MapPin className="h-5 w-5 shrink-0 text-inventory" />
                        <span className="min-w-0 break-words">{locationTypeLabel}: {location.name}</span>
                        <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-300">
                          Secondary Location
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {location.description ? (
                        <p className="mb-4 text-sm text-muted-foreground">{location.description}</p>
                      ) : null}
                      {secondaryLocationItems.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                          No active inventory items are currently assigned to this location.
                        </p>
                      ) : (
                        <InventoryTable
                          key={`employee-secondary-${location.id}-${itemsQuickFilter.version}`}
                          items={secondaryLocationItems}
                          selectedItemIds={selectedItemIds}
                          onSelectedItemIdsChange={setSelectedItemIds}
                          onMove={onOpenMoveDialog}
                          categoryLabels={categoryLabels}
                          tableLabel={location.external_reference
                            ? `${locationTypeLabel} ${location.external_reference}`
                            : location.name}
                          filterStorageKey={`employee-secondary:${location.id}`}
                          quickFilter={itemsQuickFilter}
                        />
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="hardware" className="mt-0">
          <Card className="border-slate-700 bg-slate-900/70">
            <CardHeader className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-white">
                  <Boxes className="h-5 w-5 text-inventory" />
                  Hardware
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Quantity stock held at locations you are responsible for.
                </p>
              </div>
              {onTransferHardware && hasTransferableHardware ? (
                <Button variant="outline" onClick={() => setHardwareTransferOpen(true)} className="min-h-11 w-full shrink-0 border-slate-600 sm:w-auto">
                  <ArrowRightLeft className="mr-2 h-4 w-4" />
                  Transfer
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
              {responsibleHardwareLocations.every(
                (location) => (positiveHardwareByLocation.get(location.id) || []).length === 0,
              ) ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No Hardware stock is currently assigned to your locations.
                </p>
              ) : (
                responsibleHardwareLocations.map((location) => {
                  const locationBalances = (positiveHardwareByLocation.get(location.id) || [])
                    .toSorted((a, b) => (
                      (hardwareItemById.get(a.hardware_item_id)?.name || '')
                        .localeCompare(hardwareItemById.get(b.hardware_item_id)?.name || '')
                    ));
                  if (locationBalances.length === 0) return null;

                  return (
                    <div key={location.id} className="overflow-hidden rounded-lg border border-slate-700">
                      <div className="flex min-w-0 items-center gap-2 border-b border-slate-700 bg-slate-950/40 px-3 py-3 min-[380px]:px-4">
                        <MapPin className="h-4 w-4 shrink-0 text-inventory" />
                        <span className="min-w-0 break-words font-semibold text-white">{location.name}</span>
                      </div>
                      <div className="divide-y divide-slate-800">
                        {locationBalances.map((balance) => (
                          <HardwareQuantityRow
                            key={`${balance.hardware_item_id}:${location.id}`}
                            label={hardwareItemById.get(balance.hardware_item_id)?.name || 'Hardware item'}
                            quantity={balance.quantity}
                            location={location}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="claim" className="mt-0">
          <Card className="border-slate-700 bg-slate-900/70">
            <CardHeader>
              <CardTitle className="text-white">Claim An Item</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={claimSearch}
                onChange={(event) => setClaimSearch(event.target.value)}
                placeholder="Search item name, ID, or current location"
                className="bg-slate-800 border-slate-600"
              />
              <LegacyQuoteLocationOptIn
                enabled={includeLegacyQuoteClaims}
                onEnabledChange={setIncludeLegacyQuoteClaims}
              />
              {claimableItems.map((item) => (
                <div key={item.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-slate-700 bg-slate-800/50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="break-words font-medium text-white">{item.name}</div>
                    <div className="break-words text-xs text-muted-foreground">{item.item_number} · Currently at {item.location?.name || 'No location assigned'}</div>
                  </div>
                  <Button size="sm" className="min-h-11 w-full bg-inventory text-white hover:bg-inventory-dark sm:w-auto" onClick={() => handleClaim(item)}>
                    Claim
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {onTransferHardware ? (
        <HardwareTransferDialog
          open={hardwareTransferOpen}
          items={hardwareItems}
          balances={hardwareBalances}
          locations={hardwareTransferLocations}
          responsibleLocationIds={responsibleHardwareLocations.map((location) => location.id)}
          onClose={() => setHardwareTransferOpen(false)}
          onSubmit={onTransferHardware}
        />
      ) : null}
    </div>
  );
}
