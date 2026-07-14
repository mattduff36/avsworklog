'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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

const MINIMUM_SEARCH_CHARACTERS = 3;
const SEARCH_DEBOUNCE_MS = 300;

function getLinkedAssetLabel(location: InventoryLocation, fleetAssets: FleetAssetOption[]): string | null {
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
  const [error, setError] = useState('');
  const [includeLegacyQuotes, setIncludeLegacyQuotes] = useState(false);
  const normalizedSearch = searchQuery.trim();

  useEffect(() => {
    if (normalizedSearch.length < MINIMUM_SEARCH_CHARACTERS) {
      setLocations([]);
      setLoading(false);
      setError('');
      return;
    }

    setLocations([]);
    setLoading(true);
    setError('');
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ search: normalizedSearch, limit: '50' });
        if (includeLegacyQuotes) params.set('includeLegacyQuotes', 'true');
        const response = await fetch(
          `/api/inventory/locations?${params}`,
          { cache: 'no-store', signal: controller.signal },
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Failed to search inventory locations');
        setLocations(payload.locations || []);
      } catch (searchError) {
        if (controller.signal.aborted) return;
        setLocations([]);
        setError(searchError instanceof Error ? searchError.message : 'Failed to search inventory locations');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [includeLegacyQuotes, normalizedSearch, refreshVersion]);

  const status = normalizedSearch.length < MINIMUM_SEARCH_CHARACTERS
    ? 'Enter at least 3 characters to search locations.'
    : loading
      ? 'Searching locations...'
      : error
        ? error
        : locations.length === 0
          ? `No locations found matching “${normalizedSearch}”.`
          : '';

  return (
    <Card className="border-slate-700 bg-slate-900/70">
      <CardContent className="p-0">
        <div className="border-b border-slate-700 p-4">
          <div className="relative max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={searchQuery}
              onChange={(event) => {
                const nextSearchQuery = event.target.value;
                setSearchQuery(nextSearchQuery);
                setLocations([]);
                setError('');
                setLoading(nextSearchQuery.trim().length >= MINIMUM_SEARCH_CHARACTERS);
              }}
              placeholder="Search locations (minimum 3 characters)"
              className="border-slate-600 bg-slate-800 pl-9 text-white placeholder:text-slate-500"
              aria-label="Search inventory locations"
            />
          </div>
          <LegacyQuoteLocationOptIn
            enabled={includeLegacyQuotes}
            onEnabledChange={setIncludeLegacyQuotes}
            className="mt-3"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Search by location name. Up to 50 matching locations are shown.
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
        </>
        )}
      </CardContent>
    </Card>
  );
}
