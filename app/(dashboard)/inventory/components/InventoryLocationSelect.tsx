'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { InventoryLocation } from '../types';
import {
  formatInventoryLocationOptionLabel,
  getInventoryLocationsWithYardFirst,
} from '../utils';

interface InventoryLocationSelectExtraOption {
  value: string;
  label: string;
  className?: string;
}

interface InventoryLocationSelectProps {
  locations?: InventoryLocation[];
  value: string;
  onValueChange: (value: string, location?: InventoryLocation) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  ariaLabel?: string;
  triggerClassName?: string;
  disabled?: boolean;
  extraOptions?: InventoryLocationSelectExtraOption[];
  serverSearch?: boolean;
  locationFilter?: (location: InventoryLocation) => boolean;
}

interface InventoryLocationSelectOption {
  value: string;
  label: string;
  searchLabel: string;
  className?: string;
  location?: InventoryLocation;
}

const MINIMUM_SERVER_SEARCH_CHARACTERS = 3;
const SERVER_SEARCH_DEBOUNCE_MS = 300;

export function InventoryLocationSelect({
  locations = [],
  value,
  onValueChange,
  placeholder = 'Select location',
  searchPlaceholder = 'Search locations...',
  ariaLabel,
  triggerClassName,
  disabled = false,
  extraOptions = [],
  serverSearch = false,
  locationFilter,
}: InventoryLocationSelectProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<InventoryLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedServerLocation, setSelectedServerLocation] = useState<InventoryLocation | null>(
    locations.find((location) => location.id === value) || null,
  );
  const normalizedSearchQuery = searchQuery.trim();

  useEffect(() => {
    if (!value) {
      setSelectedServerLocation(null);
      return;
    }
    const knownSelectedLocation = locations.find((location) => location.id === value);
    if (knownSelectedLocation) setSelectedServerLocation(knownSelectedLocation);
  }, [locations, value]);

  useEffect(() => {
    if (!serverSearch || !open || normalizedSearchQuery.length < MINIMUM_SERVER_SEARCH_CHARACTERS) {
      setSearchResults([]);
      setSearching(false);
      setSearchError('');
      return;
    }

    setSearchResults([]);
    setSearching(true);
    setSearchError('');
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/inventory/locations?search=${encodeURIComponent(normalizedSearchQuery)}&limit=50`,
          { cache: 'no-store', signal: controller.signal },
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Failed to search locations');
        setSearchResults(payload.locations || []);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSearchResults([]);
        setSearchError(error instanceof Error ? error.message : 'Failed to search locations');
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, SERVER_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [normalizedSearchQuery, open, serverSearch]);

  const options = useMemo<InventoryLocationSelectOption[]>(() => {
    const sourceLocations = serverSearch ? searchResults : locations;
    const locationOptions = getInventoryLocationsWithYardFirst(sourceLocations)
      .filter((location) => locationFilter?.(location) ?? true)
      .map((location) => {
        const label = formatInventoryLocationOptionLabel(location);

        return {
          value: location.id,
          label,
          location,
          searchLabel: [
            label,
            location.name,
            location.location_type,
            location.external_reference,
            location.linked_asset_label,
            location.linked_asset_nickname,
            ...(location.assigned_user_names || []),
          ].filter(Boolean).join(' '),
        };
      });

    return [
      ...locationOptions,
      ...extraOptions.map((option) => ({
        ...option,
        searchLabel: option.label,
      })),
    ];
  }, [extraOptions, locationFilter, locations, searchResults, serverSearch]);

  const selectedLocation = [...searchResults, ...locations].find((location) => location.id === value)
    || (selectedServerLocation?.id === value ? selectedServerLocation : null);
  const selectedOption = options.find((option) => option.value === value) || (
    selectedLocation
      ? {
        value: selectedLocation.id,
        label: formatInventoryLocationOptionLabel(selectedLocation),
        searchLabel: selectedLocation.name,
        location: selectedLocation,
      }
      : undefined
  );
  const normalizedClientSearchQuery = normalizedSearchQuery.toLowerCase();
  const filteredOptions = !serverSearch && normalizedClientSearchQuery
    ? options.filter((option) => option.searchLabel.toLowerCase().includes(normalizedClientSearchQuery))
    : options;

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) setSearchQuery('');
  }

  function handleSelect(option: InventoryLocationSelectOption) {
    setSelectedServerLocation(option.location || null);
    onValueChange(option.value, option.location);
    handleOpenChange(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            'w-full justify-between border-slate-600 bg-slate-800 text-left font-normal text-white hover:bg-slate-700',
            !selectedOption && 'text-muted-foreground',
            triggerClassName
          )}
        >
          <span className="min-w-0 flex-1 truncate">{selectedOption?.label || placeholder}</span>
          <ChevronDown className={cn('ml-2 h-4 w-4 shrink-0 opacity-70 transition-transform', open && 'rotate-180')} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] border-slate-700 bg-slate-950 p-0 text-slate-200"
      >
        <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={searchQuery}
              onChange={(event) => {
                const nextSearchQuery = event.target.value;
                setSearchQuery(nextSearchQuery);
                if (serverSearch) {
                  setSearchResults([]);
                  setSearchError('');
                  setSearching(nextSearchQuery.trim().length >= MINIMUM_SERVER_SEARCH_CHARACTERS);
                }
              }}
              placeholder={serverSearch ? 'Type at least 3 characters...' : searchPlaceholder}
              className="h-9 border-slate-700 bg-slate-900 pl-9 text-white placeholder:text-slate-500"
              aria-label={searchPlaceholder}
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {serverSearch && normalizedSearchQuery.length < MINIMUM_SERVER_SEARCH_CHARACTERS ? (
            <div>
              <div className="px-3 py-6 text-center text-sm text-slate-400" aria-live="polite">
                Enter at least 3 characters to search locations.
              </div>
              {options.filter((option) => !option.location).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => handleSelect(option)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-slate-800 focus:bg-slate-800 focus:outline-none',
                    option.className,
                  )}
                >
                  <Check className={cn('h-4 w-4 shrink-0', option.value === value ? 'opacity-100' : 'opacity-0')} />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </button>
              ))}
            </div>
          ) : searching ? (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-slate-300" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching locations...
            </div>
          ) : searchError ? (
            <div className="px-3 py-6 text-center text-sm text-red-300" role="alert">{searchError}</div>
          ) : filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => handleSelect(option)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-slate-800 focus:bg-slate-800 focus:outline-none',
                  option.className
                )}
              >
                <Check className={cn('h-4 w-4 shrink-0', option.value === value ? 'opacity-100' : 'opacity-0')} />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            ))
          ) : (
            <div className="px-3 py-6 text-center text-sm text-slate-400">No locations found</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
