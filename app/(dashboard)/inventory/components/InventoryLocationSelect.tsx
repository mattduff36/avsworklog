'use client';

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { InventoryLocation } from '../types';
import {
  formatInventoryLocationOptionLabel,
  getInventoryLocationTypePresentation,
  getInventoryLocationSearchLabel,
  getInventoryLocationsWithYardFirst,
  isLegacyQuoteInventoryLocation,
} from '../utils';
import { LegacyQuoteLocationOptIn } from './LegacyQuoteLocationOptIn';

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
  allowLegacyQuoteOptIn?: boolean;
  includeLegacyQuotes?: boolean;
  onIncludeLegacyQuotesChange?: (enabled: boolean) => void;
  getOptionDescription?: (location: InventoryLocation) => string | undefined;
}

interface InventoryLocationSelectOption {
  value: string;
  label: string;
  searchLabel: string;
  description?: string;
  className?: string;
  location?: InventoryLocation;
}

const MINIMUM_SERVER_SEARCH_CHARACTERS = 3;
const SERVER_SEARCH_DEBOUNCE_MS = 300;
const MOBILE_PICKER_MEDIA_QUERY = '(max-width: 639px)';
const MOBILE_PICKER_MARGIN_PX = 8;

function getIsMobilePickerViewport(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(MOBILE_PICKER_MEDIA_QUERY).matches;
  }
  return window.innerWidth < 640;
}

function getMobilePickerViewportStyle(isInsideDialog: boolean): CSSProperties {
  if (typeof window === 'undefined') return {};

  const visualViewport = window.visualViewport;
  const viewportTop = visualViewport?.offsetTop ?? 0;
  const viewportLeft = visualViewport?.offsetLeft ?? 0;
  const viewportWidth = visualViewport?.width ?? window.innerWidth;
  const viewportHeight = visualViewport?.height ?? window.innerHeight;
  const visibleWidth = Math.max(0, viewportWidth - (MOBILE_PICKER_MARGIN_PX * 2));
  const visibleHeight = Math.max(0, viewportHeight - (MOBILE_PICKER_MARGIN_PX * 2));

  return {
    position: isInsideDialog ? 'absolute' : 'fixed',
    top: `${(isInsideDialog ? 0 : viewportTop) + MOBILE_PICKER_MARGIN_PX}px`,
    left: `${(isInsideDialog ? 0 : viewportLeft) + MOBILE_PICKER_MARGIN_PX}px`,
    width: `${visibleWidth}px`,
    height: `${visibleHeight}px`,
    maxHeight: `${visibleHeight}px`,
  };
}

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
  allowLegacyQuoteOptIn = true,
  includeLegacyQuotes: controlledIncludeLegacyQuotes,
  onIncludeLegacyQuotesChange,
  getOptionDescription,
}: InventoryLocationSelectProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<InventoryLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [internalIncludeLegacyQuotes, setInternalIncludeLegacyQuotes] = useState(false);
  const includeLegacyQuotes = controlledIncludeLegacyQuotes ?? internalIncludeLegacyQuotes;
  const [selectedServerLocation, setSelectedServerLocation] = useState<InventoryLocation | null>(
    locations.find((location) => location.id === value) || null,
  );
  const [isMobilePicker, setIsMobilePicker] = useState(false);
  const [mobilePickerStyle, setMobilePickerStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const normalizedSearchQuery = searchQuery.trim();

  useEffect(() => {
    const mediaQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia(MOBILE_PICKER_MEDIA_QUERY)
      : null;
    const syncMobilePicker = () => {
      setIsMobilePicker(mediaQuery?.matches ?? getIsMobilePickerViewport());
    };

    syncMobilePicker();
    mediaQuery?.addEventListener('change', syncMobilePicker);
    window.addEventListener('resize', syncMobilePicker);

    return () => {
      mediaQuery?.removeEventListener('change', syncMobilePicker);
      window.removeEventListener('resize', syncMobilePicker);
    };
  }, []);

  useEffect(() => {
    if (!open || !isMobilePicker) {
      setMobilePickerStyle({});
      return;
    }

    let viewportAnimationFrame = 0;
    let focusAnimationFrame = 0;
    const visualViewport = window.visualViewport;
    const syncPickerViewport = () => {
      window.cancelAnimationFrame(viewportAnimationFrame);
      viewportAnimationFrame = window.requestAnimationFrame(() => {
        const isInsideDialog = Boolean(triggerRef.current?.closest('[role="dialog"]'));
        setMobilePickerStyle(getMobilePickerViewportStyle(isInsideDialog));
      });
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      setSearchQuery('');
      if (controlledIncludeLegacyQuotes === undefined) setInternalIncludeLegacyQuotes(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };

    syncPickerViewport();
    focusAnimationFrame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    visualViewport?.addEventListener('resize', syncPickerViewport);
    visualViewport?.addEventListener('scroll', syncPickerViewport);
    window.addEventListener('orientationchange', syncPickerViewport);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(viewportAnimationFrame);
      window.cancelAnimationFrame(focusAnimationFrame);
      visualViewport?.removeEventListener('resize', syncPickerViewport);
      visualViewport?.removeEventListener('scroll', syncPickerViewport);
      window.removeEventListener('orientationchange', syncPickerViewport);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [controlledIncludeLegacyQuotes, isMobilePicker, open]);

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
        const params = new URLSearchParams({
          search: normalizedSearchQuery,
          limit: '50',
        });
        if (includeLegacyQuotes) params.set('includeLegacyQuotes', 'true');
        const response = await fetch(
          `/api/inventory/locations?${params}`,
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
  }, [includeLegacyQuotes, normalizedSearchQuery, open, serverSearch]);

  const options = useMemo<InventoryLocationSelectOption[]>(() => {
    const sourceLocations = serverSearch
      ? Array.from(
        new Map(
          [...locations, ...searchResults].map((location) => [location.id, location]),
        ).values(),
      )
      : locations;
    const locationOptions = getInventoryLocationsWithYardFirst(sourceLocations)
      .filter((location) => includeLegacyQuotes || !isLegacyQuoteInventoryLocation(location))
      .filter((location) => locationFilter?.(location) ?? true)
      .map((location) => {
        const label = formatInventoryLocationOptionLabel(location);

        return {
          value: location.id,
          label,
          description: getOptionDescription?.(location),
          className: getInventoryLocationTypePresentation(location).optionClassName,
          location,
          searchLabel: getInventoryLocationSearchLabel(location),
        };
      });

    return [
      ...locationOptions,
      ...extraOptions.map((option) => ({
        ...option,
        searchLabel: option.label,
      })),
    ];
  }, [
    extraOptions,
    getOptionDescription,
    includeLegacyQuotes,
    locationFilter,
    locations,
    searchResults,
    serverSearch,
  ]);

  const selectedLocation = [...searchResults, ...locations].find((location) => location.id === value)
    || (selectedServerLocation?.id === value ? selectedServerLocation : null);
  const selectedOption = options.find((option) => option.value === value) || (
    selectedLocation
      ? {
        value: selectedLocation.id,
        label: formatInventoryLocationOptionLabel(selectedLocation),
        description: getOptionDescription?.(selectedLocation),
        searchLabel: selectedLocation.name,
        location: selectedLocation,
      }
      : undefined
  );
  const normalizedClientSearchQuery = normalizedSearchQuery.toLowerCase();
  const selectedPresentation = selectedOption?.location
    ? getInventoryLocationTypePresentation(selectedOption.location)
    : null;
  const filteredOptions = normalizedClientSearchQuery
    ? options.filter((option) => option.searchLabel.toLowerCase().includes(normalizedClientSearchQuery))
    : options;
  const showMinimumSearchHint = serverSearch
    && normalizedSearchQuery.length < MINIMUM_SERVER_SEARCH_CHARACTERS;

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && isMobilePicker) {
      const isInsideDialog = Boolean(triggerRef.current?.closest('[role="dialog"]'));
      setMobilePickerStyle(getMobilePickerViewportStyle(isInsideDialog));
    }
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearchQuery('');
      if (controlledIncludeLegacyQuotes === undefined) setInternalIncludeLegacyQuotes(false);
      if (isMobilePicker) {
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    }
  }

  function handleSelect(option: InventoryLocationSelectOption) {
    setSelectedServerLocation(option.location || null);
    onValueChange(option.value, option.location);
    handleOpenChange(false);
  }

  const pickerContent = (
    <>
      <div className="shrink-0 border-b border-slate-800 bg-slate-950 p-2">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              ref={searchInputRef}
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
              placeholder={searchPlaceholder}
              className="h-11 border-slate-700 bg-slate-900 pl-9 text-base text-white placeholder:text-slate-500 sm:h-9 sm:text-sm"
              aria-label={searchPlaceholder}
              aria-controls={listboxId}
              aria-expanded={open}
              aria-autocomplete="list"
            />
          </div>
          {isMobilePicker ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => handleOpenChange(false)}
              aria-label="Close location picker"
              className="h-11 w-11 shrink-0 border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        {allowLegacyQuoteOptIn ? (
          <LegacyQuoteLocationOptIn
            enabled={includeLegacyQuotes}
            onEnabledChange={(enabled) => {
              if (onIncludeLegacyQuotesChange) onIncludeLegacyQuotesChange(enabled);
              else setInternalIncludeLegacyQuotes(enabled);
            }}
            className="mt-2 w-full justify-center"
          />
        ) : null}
      </div>
      <div
        id={listboxId}
        role="listbox"
        aria-label="Inventory locations"
        data-mobile-scroll-lock="true"
        className={cn(
          'overflow-y-auto overscroll-contain p-1',
          isMobilePicker ? 'min-h-0 flex-1' : 'max-h-64',
        )}
      >
        {showMinimumSearchHint ? (
          <div className="px-3 py-2 text-center text-xs text-slate-500" aria-live="polite">
            Type at least 3 characters to search all locations.
          </div>
        ) : null}
        {searching ? (
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
              data-location-type={option.location?.location_type}
              aria-selected={option.value === value}
              onClick={() => handleSelect(option)}
              className={cn(
                'flex min-h-11 w-full items-center gap-2 rounded-sm border border-transparent px-3 py-2 text-left text-sm hover:bg-slate-800 focus:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-inventory/60',
                option.className,
              )}
            >
              <Check
                className={cn(
                  'h-4 w-4 shrink-0',
                  option.location && getInventoryLocationTypePresentation(option.location).iconClassName,
                  option.value === value ? 'opacity-100' : 'opacity-0',
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{option.label}</span>
                {option.description ? (
                  <span className="mt-0.5 block truncate text-xs text-slate-400">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </button>
          ))
        ) : (
          <div className="px-3 py-6 text-center text-sm text-slate-400">No locations found</div>
        )}
      </div>
    </>
  );
  const mobilePickerPortalHost = typeof document !== 'undefined'
    ? triggerRef.current?.closest('[role="dialog"]') || document.body
    : null;
  const isMobilePickerInsideDialog = Boolean(
    mobilePickerPortalHost && mobilePickerPortalHost !== document.body,
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            'w-full justify-between border-slate-600 bg-slate-800 text-left font-normal text-white hover:bg-slate-700',
            selectedPresentation?.surfaceClassName,
            selectedOption?.description && 'h-auto min-h-12 py-2',
            !selectedOption && 'text-muted-foreground',
            triggerClassName
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate">{selectedOption?.label || placeholder}</span>
            {selectedOption?.description ? (
              <span className="mt-0.5 block truncate text-xs text-slate-400">
                {selectedOption.description}
              </span>
            ) : null}
          </span>
          <ChevronDown className={cn('ml-2 h-4 w-4 shrink-0 opacity-70 transition-transform', open && 'rotate-180')} />
        </Button>
      </PopoverTrigger>
      {!isMobilePicker ? (
        <PopoverContent
          align="start"
          className="z-[210] w-[var(--radix-popover-trigger-width)] border-slate-700 bg-slate-950 p-0 text-slate-200"
        >
          {pickerContent}
        </PopoverContent>
      ) : null}
      {open && isMobilePicker && mobilePickerPortalHost ? createPortal(
        <>
          <div
            aria-hidden="true"
            data-mobile-scroll-lock="true"
            className={cn('inset-0 z-[218] bg-black/70', isMobilePickerInsideDialog ? 'absolute' : 'fixed')}
            onPointerDown={() => handleOpenChange(false)}
          />
          <div
            role="dialog"
            aria-modal="false"
            aria-label="Choose inventory location"
            data-mobile-scroll-lock="true"
            className="z-[220] flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950 text-slate-200 shadow-2xl"
            style={mobilePickerStyle}
          >
            {pickerContent}
          </div>
        </>,
        mobilePickerPortalHost,
      ) : null}
    </Popover>
  );
}
