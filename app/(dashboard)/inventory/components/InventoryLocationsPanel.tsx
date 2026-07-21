'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadMorePagination } from '@/components/ui/load-more-pagination';
import { Link2, Loader2, MapPin, Pencil, Search, Trash2 } from 'lucide-react';
import type { FleetAssetOption, InventoryLocation } from '../types';
import { formatInventoryLocationTypeLabel } from '../utils';
import { LegacyQuoteLocationOptIn } from './LegacyQuoteLocationOptIn';

interface InventoryLocationsPanelProps {
  fleetAssets: FleetAssetOption[];
  onEdit: (location: InventoryLocation) => void;
  onRemove: (location: InventoryLocation) => void;
  refreshVersion?: number;
}

const LOCATION_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

interface InventoryLocationsResponse {
  locations?: InventoryLocation[];
  pagination?: {
    offset: number;
    limit: number;
    total: number;
    has_more: boolean;
  };
  error?: string;
}

function getLinkedAssetLabel(location: InventoryLocation, fleetAssets: FleetAssetOption[]): string | null {
  const enrichedLabel = [location.linked_asset_label, location.linked_asset_nickname]
    .filter(Boolean)
    .join(' - ');
  if (enrichedLabel) return enrichedLabel;

  const linkedAssetId = location.linked_van_id || location.linked_hgv_id || location.linked_plant_id;
  if (!linkedAssetId) return null;
  return fleetAssets.find((asset) => asset.id === linkedAssetId)?.label || 'Linked fleet asset';
}

export function InventoryLocationsPanel({
  fleetAssets,
  onEdit,
  onRemove,
  refreshVersion = 0,
}: InventoryLocationsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [includeLegacyQuotes, setIncludeLegacyQuotes] = useState(false);
  const queryVersionRef = useRef(0);
  const normalizedSearch = searchQuery.trim();

  useEffect(() => {
    const queryVersion = queryVersionRef.current + 1;
    queryVersionRef.current = queryVersion;
    setLocations([]);
    setTotal(0);
    setHasMore(false);
    setLoading(true);
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
  }, [includeLegacyQuotes, normalizedSearch, refreshVersion]);

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

  return (
    <Card className="border-slate-700 bg-slate-900/70">
      <CardHeader className="border-b border-slate-700 bg-slate-950/30">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-white">
              <MapPin className="h-5 w-5 text-inventory" />
              All Locations
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Browse every active Inventory location and find locations by name, type, reference, or linked asset.
            </p>
          </div>
          <Badge variant="outline" className="w-fit border-inventory/40 bg-inventory/10 text-inventory-light">
            {total.toLocaleString()} {total === 1 ? 'location' : 'locations'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="border-b border-slate-700 p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search all locations..."
                className="border-slate-600 bg-slate-800 pl-9 text-white placeholder:text-slate-500"
                aria-label="Search inventory locations"
              />
            </div>
            <LegacyQuoteLocationOptIn
              enabled={includeLegacyQuotes}
              onEnabledChange={setIncludeLegacyQuotes}
            />
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            <p>Search starts immediately; results load from the server in groups of 50.</p>
          </div>
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
        <div className="hidden md:block">
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
                return (
                  <tr key={location.id} className="hover:bg-slate-800/50">
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
                      <Badge variant="outline" className="border-slate-600 text-slate-200">
                        {formatInventoryLocationTypeLabel(location)}
                      </Badge>
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

        <div className="space-y-3 p-4 md:hidden">
          {locations.map((location) => {
            const linkedAssetLabel = getLinkedAssetLabel(location, fleetAssets);
            return (
              <div key={location.id} className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-white">
                      <MapPin className="h-4 w-4 text-inventory" />
                      {location.name}
                    </div>
                    {location.description ? (
                      <div className="mt-1 text-xs text-muted-foreground">{location.description}</div>
                    ) : null}
                  </div>
                  <Badge variant="outline">{location.item_count || 0} items</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="outline" className="border-slate-600 text-slate-200">
                    {formatInventoryLocationTypeLabel(location)}
                  </Badge>
                  <Badge variant="outline" className="border-slate-600 text-slate-200">
                    {location.sync_status}
                  </Badge>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  {linkedAssetLabel ? `Linked to ${linkedAssetLabel}` : 'No linked asset'}
                  {location.external_reference ? ` · Ref: ${location.external_reference}` : ''}
                </div>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(location)} className="flex-1 border-slate-600">
                    Edit
                  </Button>
                  {location.location_type === 'manual' ? (
                    <Button size="sm" variant="outline" onClick={() => onRemove(location)} className="flex-1 border-red-500/30 text-red-300">
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <div className="space-y-3 p-4">
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
      </CardContent>
    </Card>
  );
}
