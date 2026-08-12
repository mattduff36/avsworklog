'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { LoadMorePagination } from '@/components/ui/load-more-pagination';
import {
  MultiSelectFilter,
  type MultiSelectFilterOption,
} from '@/components/ui/multi-select-filter';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Link2, Loader2, MapPin, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import type { FleetAssetOption, InventoryLocation } from '../types';
import { getInventoryLocationTypePresentation } from '../utils';
import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';
import { InventoryLocationTypeBadge } from './InventoryLocationTypeBadge';
import {
  InventoryMobileFilterChips,
  InventoryMobileFilters,
  type InventoryMobileFilterChip,
} from './InventoryMobileFilters';
import { LegacyQuoteLocationOptIn } from './LegacyQuoteLocationOptIn';

interface InventoryLocationsPanelProps {
  fleetAssets: FleetAssetOption[];
  onEdit: (location: InventoryLocation) => void;
  onRemove: (location: InventoryLocation) => void;
  onAdd: () => void;
  refreshVersion?: number;
}

type DirectoryLocationTypeFilter = 'van' | 'site' | 'manual' | 'hgv' | 'plant';

const LOCATION_PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

const LOCATION_TYPE_FILTER_OPTIONS: MultiSelectFilterOption<DirectoryLocationTypeFilter>[] = [
  { value: 'van', label: 'Van' },
  { value: 'site', label: 'Site' },
  { value: 'manual', label: 'Other' },
  { value: 'hgv', label: 'HGV' },
  { value: 'plant', label: 'Plant' },
];

function appendLocationTypeFilterParams(
  params: URLSearchParams,
  locationTypes: readonly DirectoryLocationTypeFilter[],
) {
  if (locationTypes.length === 0) return;
  params.set('locationTypes', locationTypes.join(','));
}

function buildVisibleLocationTypeFilterOptions(
  counts: Partial<Record<DirectoryLocationTypeFilter, number>>,
): MultiSelectFilterOption<DirectoryLocationTypeFilter>[] {
  return LOCATION_TYPE_FILTER_OPTIONS
    .filter((option) => (counts[option.value] || 0) > 0)
    .map((option) => ({
      ...option,
      count: counts[option.value],
    }));
}

interface InventoryLocationsResponse {
  locations?: InventoryLocation[];
  pagination?: {
    offset: number;
    limit: number;
    total: number;
    has_more: boolean;
  };
  locationTypeCounts?: Partial<Record<DirectoryLocationTypeFilter, number>>;
  error?: string;
}

function getLinkedAssetLabel(location: InventoryLocation, fleetAssets: FleetAssetOption[]): string | null {
  if (location.linked_asset_label?.trim()) {
    return formatFleetAssetLabel({
      identifier: location.linked_asset_label,
      nickname: location.linked_asset_nickname,
    });
  }

  const linkedAssetId = location.linked_van_id || location.linked_hgv_id || location.linked_plant_id;
  if (!linkedAssetId) return null;
  return fleetAssets.find((asset) => asset.id === linkedAssetId)?.label || 'Linked fleet asset';
}

export function InventoryLocationsPanel({
  fleetAssets,
  onEdit,
  onRemove,
  onAdd,
  refreshVersion = 0,
}: InventoryLocationsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [includeLegacyQuotes, setIncludeLegacyQuotes] = useState(false);
  const [selectedLocationTypes, setSelectedLocationTypes] = useState<DirectoryLocationTypeFilter[]>([]);
  const [locationTypeCounts, setLocationTypeCounts] = useState<
    Partial<Record<DirectoryLocationTypeFilter, number>>
  >({});
  const queryVersionRef = useRef(0);
  const normalizedSearch = searchQuery.trim();
  const locationTypeFilterOptions = buildVisibleLocationTypeFilterOptions(locationTypeCounts);

  useEffect(() => {
    const queryVersion = queryVersionRef.current + 1;
    queryVersionRef.current = queryVersion;
    setLocations([]);
    setTotal(0);
    setHasMore(false);
    setLoading(true);
    setLoadingMore(false);
    setError('');
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          search: normalizedSearch,
          limit: String(LOCATION_PAGE_SIZE),
          offset: '0',
        });
        if (includeLegacyQuotes) params.set('includeLegacyQuotes', 'true');
        appendLocationTypeFilterParams(params, selectedLocationTypes);
        const response = await fetch(
          `/api/inventory/locations?${params}`,
          { cache: 'no-store', signal: controller.signal },
        );
        const payload = await response.json() as InventoryLocationsResponse;
        if (!response.ok) throw new Error(payload.error || 'Failed to search inventory locations');
        if (queryVersionRef.current !== queryVersion) return;
        setLocations(payload.locations || []);
        setTotal(payload.pagination?.total || payload.locations?.length || 0);
        setHasMore(payload.pagination?.has_more || false);
        if (payload.locationTypeCounts) {
          const nextCounts = payload.locationTypeCounts;
          setLocationTypeCounts(nextCounts);
          setSelectedLocationTypes((current) => {
            const next = current.filter((type) => (nextCounts[type] || 0) > 0);
            return next.length === current.length ? current : next;
          });
        }
      } catch (searchError) {
        if (controller.signal.aborted || queryVersionRef.current !== queryVersion) return;
        setLocations([]);
        setTotal(0);
        setHasMore(false);
        setError(searchError instanceof Error ? searchError.message : 'Failed to search inventory locations');
      } finally {
        if (!controller.signal.aborted && queryVersionRef.current === queryVersion) setLoading(false);
      }
    }, normalizedSearch ? SEARCH_DEBOUNCE_MS : 0);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [includeLegacyQuotes, normalizedSearch, refreshVersion, selectedLocationTypes]);

  async function loadMoreLocations() {
    if (loadingMore || !hasMore) return;

    const queryVersion = queryVersionRef.current;
    setLoadingMore(true);
    setError('');
    try {
      const params = new URLSearchParams({
        search: normalizedSearch,
        limit: String(LOCATION_PAGE_SIZE),
        offset: String(locations.length),
      });
      if (includeLegacyQuotes) params.set('includeLegacyQuotes', 'true');
      appendLocationTypeFilterParams(params, selectedLocationTypes);
      const response = await fetch(`/api/inventory/locations?${params}`, { cache: 'no-store' });
      const payload = await response.json() as InventoryLocationsResponse;
      if (!response.ok) throw new Error(payload.error || 'Failed to load more inventory locations');
      if (queryVersionRef.current !== queryVersion) return;

      setLocations((current) => {
        const locationsById = new Map(current.map((location) => [location.id, location]));
        (payload.locations || []).forEach((location) => locationsById.set(location.id, location));
        return [...locationsById.values()];
      });
      setTotal(payload.pagination?.total || total);
      setHasMore(payload.pagination?.has_more || false);
    } catch (loadError) {
      if (queryVersionRef.current !== queryVersion) return;
      setError(loadError instanceof Error ? loadError.message : 'Failed to load more inventory locations');
    } finally {
      if (queryVersionRef.current === queryVersion) setLoadingMore(false);
    }
  }

  const status = loading
    ? 'Loading locations...'
    : error && locations.length === 0
      ? error
      : locations.length === 0
        ? normalizedSearch
          ? `No locations found matching “${normalizedSearch}”.`
          : 'No active Inventory locations are available.'
        : '';

  const mobileActiveFilterCount = selectedLocationTypes.length + (includeLegacyQuotes ? 1 : 0);
  const mobileFilterChips: InventoryMobileFilterChip[] = [
    ...selectedLocationTypes.map((type) => ({
      id: `type:${type}`,
      label: locationTypeFilterOptions.find((option) => option.value === type)?.label || type,
      onRemove: () => setSelectedLocationTypes((current) => current.filter((value) => value !== type)),
    })),
    ...(includeLegacyQuotes ? [{ id: 'legacy', label: 'Legacy locations', onRemove: () => setIncludeLegacyQuotes(false) }] : []),
  ];

  return (
    <div className="min-w-0 space-y-4 md:space-y-0 md:overflow-hidden md:rounded-lg md:border md:border-slate-700 md:bg-slate-900/70">
      <div className="flex items-center justify-between gap-3 md:border-b md:border-slate-700 md:bg-slate-950/30 md:p-6">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-bold text-white md:text-lg">
            <MapPin className="h-4 w-4 shrink-0 text-inventory md:h-5 md:w-5" />
            All Locations
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground md:text-sm">
            <span className="md:hidden">{total.toLocaleString()} {total === 1 ? 'location' : 'locations'}</span>
            <span className="hidden md:inline">
              Browse every active Inventory location and find locations by name, type, reference, or linked asset.
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="hidden w-fit border-inventory/40 bg-inventory/10 text-inventory md:inline-flex">
            {total.toLocaleString()} {total === 1 ? 'location' : 'locations'}
          </Badge>
          <Button size="sm" onClick={onAdd} className="h-11 bg-inventory text-white hover:bg-inventory-dark md:h-9">
            <Plus className="mr-1.5 h-4 w-4" />
            Add
          </Button>
        </div>
      </div>

      <div className="relative z-20 md:border-b md:border-slate-700 md:p-4">
        <div className="flex items-center gap-2 md:hidden">
          <SearchInput
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search all locations..."
            containerClassName="h-11 flex-1 border-slate-600 bg-slate-800"
            className="text-white placeholder:text-slate-500"
            iconClassName="text-slate-500"
            aria-label="Search inventory locations"
          />
          <InventoryMobileFilters
            open={mobileFiltersOpen}
            onOpenChange={setMobileFiltersOpen}
            activeFilterCount={mobileActiveFilterCount}
            hasAnyFilters={mobileActiveFilterCount > 0}
            onClearAll={() => { setSelectedLocationTypes([]); setIncludeLegacyQuotes(false); }}
          >
            {locationTypeFilterOptions.length > 0 ? (
              <MultiSelectFilter
                label="Type"
                panelId="mobile-location-type-filter-menu"
                allLabel="All types"
                selectedValues={selectedLocationTypes}
                options={locationTypeFilterOptions}
                onSelectedValuesChange={setSelectedLocationTypes}
                triggerClassName="!w-full min-h-11"
              />
            ) : null}
            <LegacyQuoteLocationOptIn
              enabled={includeLegacyQuotes}
              onEnabledChange={setIncludeLegacyQuotes}
              className="w-full"
            />
          </InventoryMobileFilters>
        </div>
        <InventoryMobileFilterChips chips={mobileFilterChips} onClearAll={() => { setSelectedLocationTypes([]); setIncludeLegacyQuotes(false); }} className="mt-2 md:hidden" />

        <div className="hidden items-center gap-3 md:flex">
          <div className="min-w-0 flex-1">
            <SearchInput
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search all locations..."
              containerClassName="border-slate-600 bg-slate-800"
              className="text-white placeholder:text-slate-500"
              iconClassName="text-slate-500"
              aria-label="Search inventory locations"
            />
          </div>
          {locationTypeFilterOptions.length > 0 ? (
            <MultiSelectFilter
              label="Type"
              allLabel="All types"
              selectedValues={selectedLocationTypes}
              options={locationTypeFilterOptions}
              onSelectedValuesChange={setSelectedLocationTypes}
              triggerClassName="min-h-9 w-[170px] border-slate-600 bg-slate-800 text-white"
              panelClassName="border-slate-700 bg-slate-900"
            />
          ) : null}
          <LegacyQuoteLocationOptIn
            enabled={includeLegacyQuotes}
            onEnabledChange={setIncludeLegacyQuotes}
          />
        </div>
        <p className="mt-2 hidden text-xs text-muted-foreground md:block">
          Search starts immediately; results load from the server in groups of 25.
        </p>
      </div>

      {status ? (
        <div
          className={`flex items-center justify-center gap-2 px-4 py-10 text-center text-sm ${error ? 'text-red-300' : 'text-muted-foreground'}`}
          role={error ? 'alert' : 'status'}
          aria-live="polite"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {status}
        </div>
      ) : (
        <>
        <div className="hidden overflow-hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/80">
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Location</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Type</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Linked Asset</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Items</th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {locations.map((location) => {
                const linkedAssetLabel = getLinkedAssetLabel(location, fleetAssets);
                const presentation = getInventoryLocationTypePresentation(location);
                return (
                  <tr
                    key={location.id}
                    data-location-type={location.location_type}
                    className={cn('border-l-2 transition-colors', presentation.surfaceClassName)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{location.name}</div>
                      {location.description ? (
                        <div className="text-xs text-muted-foreground">{location.description}</div>
                      ) : null}
                      {location.external_reference ? (
                        <div className="text-xs text-muted-foreground">Ref: {location.external_reference}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <InventoryLocationTypeBadge location={location} />
                      <div className="mt-1 text-xs text-muted-foreground">{location.sync_status}</div>
                    </td>
                    <td className="px-4 py-3">
                      {linkedAssetLabel ? (
                        <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-300">
                          <Link2 className="mr-1 h-3 w-3" />
                          {linkedAssetLabel}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">No linked asset</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{location.item_count || 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => onEdit(location)} className="border-slate-600">
                          <Pencil className="mr-2 h-3 w-3" />
                          Edit
                        </Button>
                        {location.location_type === 'manual' ? (
                          <Button size="sm" variant="outline" onClick={() => onRemove(location)} className="border-red-500/30 text-red-300 hover:bg-red-500/10">
                            <Trash2 className="mr-2 h-3 w-3" />
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="space-y-2.5 md:hidden">
          {locations.map((location) => {
            const linkedAssetLabel = getLinkedAssetLabel(location, fleetAssets);
            const presentation = getInventoryLocationTypePresentation(location);
            const canRemove = location.location_type === 'manual';
            return (
              <div
                key={location.id}
                data-location-type={location.location_type}
                className={cn(
                  'rounded-xl border p-3.5 transition-colors',
                  presentation.surfaceClassName,
                )}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <MapPin className={cn('mt-0.5 h-4 w-4 shrink-0', presentation.iconClassName)} />
                    <div className="min-w-0">
                      <div className="break-words text-[15px] font-semibold leading-snug text-white">{location.name}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <InventoryLocationTypeBadge location={location} className="border-0 bg-transparent px-0 text-[11px] font-medium text-slate-400" />
                        <span>·</span>
                        <span>{location.item_count || 0} item{location.item_count === 1 ? '' : 's'}</span>
                      </div>
                      <div className="mt-1 break-words text-xs text-muted-foreground">
                        {linkedAssetLabel ? `Linked to ${linkedAssetLabel}` : 'No linked asset'}
                        {location.external_reference ? ` · Ref: ${location.external_reference}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onEdit(location)}
                      className="h-11 border-slate-600 px-3"
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      Edit
                    </Button>
                    {canRemove ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-11 w-11 border-slate-600 text-slate-300"
                            aria-label={`More actions for ${location.name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => onRemove(location)}
                            className="text-red-300 focus:bg-red-500/10 focus:text-red-200"
                          >
                            <Trash2 className="h-4 w-4" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="space-y-3 md:p-4">
          {error ? (
            <p className="text-center text-sm text-red-300" role="alert">{error}</p>
          ) : null}
          {loadingMore ? (
            <div className="flex items-center justify-center gap-2 border-t border-slate-700/60 pt-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading more locations...
            </div>
          ) : (
            <LoadMorePagination
              visibleCount={locations.length}
              totalCount={hasMore ? total : locations.length}
              itemLabel="locations"
              pageSize={LOCATION_PAGE_SIZE}
              onShowMore={() => { void loadMoreLocations(); }}
            />
          )}
        </div>
        </>
        )}
    </div>
  );
}
