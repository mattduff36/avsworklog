'use client';

import { useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Boxes,
  ChevronDown,
  Search,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  InventoryHardwareBalance,
  InventoryHardwareItem,
  InventoryHardwareTransferPayload,
  InventoryLocation,
} from '../types';
import { isLegacyQuoteInventoryLocation } from '../utils';
import { HardwareTransferDialog } from './HardwareTransferDialog';
import { HardwareQuantityRow } from './HardwareQuantityRow';
import { LegacyQuoteLocationOptIn } from './LegacyQuoteLocationOptIn';

interface HardwareOverviewPanelProps {
  items: InventoryHardwareItem[];
  balances: InventoryHardwareBalance[];
  locations: InventoryLocation[];
  onTransfer: (payload: InventoryHardwareTransferPayload) => Promise<void>;
}

const ALL_LOCATIONS = 'all-locations';

export function HardwareOverviewPanel({
  items,
  balances,
  locations,
  onTransfer,
}: HardwareOverviewPanelProps) {
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState(ALL_LOCATIONS);
  const [includeLegacyQuotes, setIncludeLegacyQuotes] = useState(false);
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set());
  const [transferOpen, setTransferOpen] = useState(false);

  const locationById = useMemo(() => {
    const mappedLocations = new Map(locations.map((location) => [location.id, location]));
    for (const balance of balances) {
      if (balance.location) mappedLocations.set(balance.location.id, balance.location);
    }
    return mappedLocations;
  }, [balances, locations]);

  const activeLocations = useMemo(
    () => [...locationById.values()]
      .filter((location) => location.is_active && (
        includeLegacyQuotes || !isLegacyQuoteInventoryLocation(location)
      ))
      .toSorted((a, b) => (
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        || a.id.localeCompare(b.id)
      )),
    [includeLegacyQuotes, locationById],
  );

  const positiveBalancesByItem = useMemo(() => {
    const grouped = new Map<string, InventoryHardwareBalance[]>();
    for (const balance of balances) {
      if (balance.quantity <= 0) continue;
      const itemBalances = grouped.get(balance.hardware_item_id) || [];
      itemBalances.push(balance);
      grouped.set(balance.hardware_item_id, itemBalances);
    }
    for (const itemBalances of grouped.values()) {
      itemBalances.sort((a, b) => (
        (a.location?.name || locationById.get(a.location_id)?.name || '')
          .localeCompare(b.location?.name || locationById.get(b.location_id)?.name || '')
      ));
    }
    return grouped;
  }, [balances, locationById]);

  const activeItems = useMemo(
    () => items
      .filter((item) => item.is_active)
      .toSorted((a, b) => (
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        || a.id.localeCompare(b.id)
      )),
    [items],
  );

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return activeItems.filter((item) => {
      const itemBalances = positiveBalancesByItem.get(item.id) || [];
      if (
        locationFilter !== ALL_LOCATIONS
        && !itemBalances.some((balance) => balance.location_id === locationFilter)
      ) {
        return false;
      }
      if (!query) return true;
      return item.name.toLowerCase().includes(query)
        || itemBalances.some((balance) => (
          (includeLegacyQuotes || !isLegacyQuoteInventoryLocation(
            balance.location || locationById.get(balance.location_id),
          )
            ? balance.location?.name || locationById.get(balance.location_id)?.name || ''
            : '')
            .toLowerCase()
            .includes(query)
        ));
    });
  }, [
    activeItems,
    includeLegacyQuotes,
    locationById,
    locationFilter,
    positiveBalancesByItem,
    search,
  ]);

  function toggleExpandedItem(itemId: string) {
    setExpandedItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-slate-700 bg-slate-900/70">
        <CardHeader className="border-b border-slate-700 bg-slate-950/40">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-white">
                <Boxes className="h-5 w-5 text-inventory" />
                Hardware Stock
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                View company-wide quantities and transfer Hardware.
              </p>
            </div>
            <Button variant="outline" onClick={() => setTransferOpen(true)} className="border-slate-600">
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              Transfer Stock
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px_auto] lg:items-center">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search Hardware or location..."
                className="border-slate-600 bg-slate-800 pl-9"
              />
            </div>
            <Select
              value={locationFilter}
              onValueChange={setLocationFilter}
              onOpenChange={(open) => {
                if (!open) setIncludeLegacyQuotes(false);
              }}
            >
              <SelectTrigger className="border-slate-600 bg-slate-800" aria-label="Filter Hardware by location">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_LOCATIONS}>All locations</SelectItem>
                {activeLocations.map((location) => (
                  <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <LegacyQuoteLocationOptIn
              enabled={includeLegacyQuotes}
              onEnabledChange={setIncludeLegacyQuotes}
            />
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-700">
            {filteredItems.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {activeItems.length === 0
                  ? 'No active Hardware items have been configured.'
                  : 'No Hardware items match the current search and filters.'}
              </p>
            ) : (
              <div className="divide-y divide-slate-800">
                {filteredItems.map((item) => {
                  const itemBalances = positiveBalancesByItem.get(item.id) || [];
                  const visibleBalances = locationFilter === ALL_LOCATIONS
                    ? itemBalances
                    : itemBalances.filter((balance) => balance.location_id === locationFilter);
                  const total = itemBalances.reduce((sum, balance) => sum + balance.quantity, 0);
                  const isExpanded = expandedItemIds.has(item.id);

                  return (
                    <div key={item.id}>
                      <div className="px-4 py-3">
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => toggleExpandedItem(item.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <ChevronDown
                            aria-hidden="true"
                            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          />
                          <span className="truncate font-semibold text-white">{item.name}</span>
                          <Badge className="shrink-0 bg-inventory/15 text-inventory-light hover:bg-inventory/20">
                            {total.toLocaleString()} total
                          </Badge>
                        </button>
                      </div>
                      {isExpanded ? (
                        <div className="border-t border-slate-800 bg-slate-950/30 p-3 sm:pl-10">
                          {visibleBalances.length === 0 ? (
                            <p className="py-2 text-sm text-muted-foreground">
                              No positive stock is recorded{locationFilter === ALL_LOCATIONS ? '.' : ' at this location.'}
                            </p>
                          ) : (
                            <div
                              role="table"
                              aria-label={`Locations and quantities for ${item.name}`}
                              className="divide-y divide-slate-800 overflow-hidden rounded-md border border-slate-700"
                            >
                              {visibleBalances.map((balance) => {
                                const location = balance.location || locationById.get(balance.location_id);
                                return (
                                  <HardwareQuantityRow
                                    key={`${item.id}:${balance.location_id}`}
                                    label={location?.name || 'Unknown location'}
                                    quantity={balance.quantity}
                                    showLocationIcon
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <HardwareTransferDialog
        open={transferOpen}
        items={items}
        balances={balances}
        locations={[...locationById.values()]}
        onClose={() => setTransferOpen(false)}
        onSubmit={onTransfer}
      />
    </div>
  );
}
