'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  Building2,
  HardHat,
  MapPin,
  Search,
  Star,
  Truck,
  Warehouse,
} from 'lucide-react';
import type { YardKioskDirection, YardKioskLocation } from '@/lib/inventory/kiosk-types';
import type { YardKioskLocationUiState } from '@/lib/inventory/kiosk-remote-types';
import { cn } from '@/lib/utils';
import { getInventoryLocationTypePresentation } from '@/app/(dashboard)/inventory/utils';
import {
  rememberYardKioskLocation,
  togglePinnedYardKioskLocation,
} from '../yard-kiosk-storage';
import { LegacyQuoteLocationOptIn } from '@/app/(dashboard)/inventory/components/LegacyQuoteLocationOptIn';
import {
  YARD_KIOSK_INLINE_CONTROL_HEIGHT,
  YARD_KIOSK_INLINE_CONTROL_RADIUS,
  YARD_KIOSK_INLINE_CONTROL_SURFACE,
  YardKioskPagerNavigation,
} from './YardKioskPagerNavigation';

const PAGE_SIZE = 8;

type LocationFilter = YardKioskLocationUiState['active_filter'];

const LOCATION_FILTERS: Array<{ value: LocationFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'manual', label: 'Manual' },
  { value: 'vans', label: 'Vans' },
  { value: 'sites', label: 'Sites' },
];

interface LocationPage {
  id: string;
  title: string;
  locations: YardKioskLocation[];
}

interface YardKioskLocationPagerProps {
  direction: YardKioskDirection;
  locations: YardKioskLocation[];
  uiState: YardKioskLocationUiState;
  onUiStateChange: (state: YardKioskLocationUiState) => void;
  onSelect: (location: YardKioskLocation) => void;
  onIncludeLegacyQuotesChange: (includeLegacyQuotes: boolean) => Promise<void>;
  persistPreferences?: boolean;
}

function chunkLocations(
  id: string,
  title: string,
  locations: YardKioskLocation[],
): LocationPage[] {
  if (locations.length === 0) return [];
  const pageCount = Math.ceil(locations.length / PAGE_SIZE);
  return Array.from({ length: pageCount }, (_, index) => ({
    id: `${id}-${index}`,
    title: pageCount > 1 ? `${title} ${index + 1} / ${pageCount}` : title,
    locations: locations.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE),
  }));
}

function getLocationIcon(type: YardKioskLocation['location_type']) {
  if (type === 'van' || type === 'hgv') return Truck;
  if (type === 'plant') return HardHat;
  if (type === 'site') return Building2;
  if (type === 'manual') return Warehouse;
  return MapPin;
}

function matchesLocationFilter(
  location: YardKioskLocation,
  filter: LocationFilter,
): boolean {
  if (filter === 'manual') return location.location_type === 'manual';
  if (filter === 'vans') return location.location_type === 'van';
  if (filter === 'sites') return location.location_type === 'site';
  return true;
}

export function YardKioskLocationPager({
  direction,
  locations,
  uiState,
  onUiStateChange,
  onSelect,
  onIncludeLegacyQuotesChange,
  persistPreferences = true,
}: YardKioskLocationPagerProps) {
  const pagerRef = useRef<HTMLDivElement>(null);
  const legacyRequestIdRef = useRef(0);
  const {
    query,
    active_filter: activeFilter,
    page_index: pageIndex,
    include_legacy_quotes: includeLegacyQuotes,
    recent_ids: recentIds,
    pinned_ids: pinnedIds,
  } = uiState;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      pagerRef.current?.scrollTo({ left: 0, behavior: 'auto' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [direction]);

  const matchingLocations = useMemo(() => {
    const filteredLocations = locations.filter(
      (location) => (
        (includeLegacyQuotes || location.source_type !== 'legacy_quote')
        && matchesLocationFilter(location, activeFilter)
      ),
    );
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return filteredLocations;
    return filteredLocations.filter((location) => (
        location.name.toLowerCase().includes(normalizedQuery)
        || location.external_reference?.toLowerCase().includes(normalizedQuery)
        || location.description?.toLowerCase().includes(normalizedQuery)
    ));
  }, [activeFilter, includeLegacyQuotes, locations, query]);

  const pages = useMemo(() => {
    const normalizedQuery = query.trim();
    if (normalizedQuery) {
      return chunkLocations(
        'search',
        `Search results · ${matchingLocations.length}`,
        matchingLocations,
      );
    }
    if (activeFilter !== 'all') {
      const filterLabel =
        LOCATION_FILTERS.find((filter) => filter.value === activeFilter)?.label
        ?? 'Locations';
      return chunkLocations(activeFilter, filterLabel, matchingLocations);
    }

    const byId = new Map(matchingLocations.map((location) => [location.id, location]));
    const priorityIds = [...pinnedIds, ...recentIds.filter((id) => !pinnedIds.includes(id))];
    const priority = priorityIds.flatMap((id) => {
      const location = byId.get(id);
      return location ? [location] : [];
    });
    const prioritySet = new Set(priority.map((location) => location.id));
    const remainingLocations = matchingLocations.filter(
      (location) => !prioritySet.has(location.id),
    );
    const vans = remainingLocations.filter((location) => location.location_type === 'van');
    const sites = remainingLocations.filter((location) => location.location_type === 'site');
    const fleet = remainingLocations.filter(
      (location) => ['hgv', 'plant'].includes(location.location_type),
    );
    const other = remainingLocations.filter(
      (location) => !['van', 'site', 'hgv', 'plant'].includes(location.location_type),
    );

    return [
      ...chunkLocations('recent', 'Pinned & recent', priority),
      ...chunkLocations('vans', 'Vans', vans),
      ...chunkLocations('sites', 'Sites', sites),
      ...chunkLocations('fleet', 'Fleet & plant', fleet),
      ...chunkLocations('other', 'Other locations', other),
    ];
  }, [activeFilter, matchingLocations, pinnedIds, query, recentIds]);
  const currentPageIndex = Math.min(pageIndex, Math.max(0, pages.length - 1));

  function handleQueryChange(value: string) {
    onUiStateChange({ ...uiState, query: value, page_index: 0 });
    pagerRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
  }

  function handleFilterChange(filter: LocationFilter) {
    onUiStateChange({ ...uiState, active_filter: filter, page_index: 0 });
    pagerRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
  }

  function goToPage(index: number) {
    const nextIndex = Math.max(0, Math.min(pages.length - 1, index));
    onUiStateChange({ ...uiState, page_index: nextIndex });
    pagerRef.current?.scrollTo({
      left: pagerRef.current.clientWidth * nextIndex,
      behavior: 'smooth',
    });
  }

  function handleScroll() {
    const element = pagerRef.current;
    if (!element?.clientWidth) return;
    onUiStateChange({
      ...uiState,
      page_index: Math.min(
        Math.max(0, pages.length - 1),
        Math.round(element.scrollLeft / element.clientWidth),
      ),
    });
  }

  function handleSelect(location: YardKioskLocation) {
    const nextRecentIds = persistPreferences
      ? rememberYardKioskLocation(location.id)
      : [
          location.id,
          ...recentIds.filter((id) => id !== location.id),
        ].slice(0, 8);
    onUiStateChange({
      ...uiState,
      recent_ids: nextRecentIds,
    });
    onSelect(location);
  }

  function handlePin(locationId: string) {
    const nextPinnedIds = persistPreferences
      ? togglePinnedYardKioskLocation(locationId)
      : pinnedIds.includes(locationId)
        ? pinnedIds.filter((id) => id !== locationId)
        : [...pinnedIds, locationId];
    onUiStateChange({
      ...uiState,
      pinned_ids: nextPinnedIds,
    });
  }

  async function handleIncludeLegacyQuotesChange(nextIncludeLegacyQuotes: boolean) {
    const requestId = legacyRequestIdRef.current + 1;
    legacyRequestIdRef.current = requestId;
    onUiStateChange({
      ...uiState,
      include_legacy_quotes: nextIncludeLegacyQuotes,
      query: '',
      page_index: 0,
    });
    pagerRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
    try {
      await onIncludeLegacyQuotesChange(nextIncludeLegacyQuotes);
    } catch {
      if (legacyRequestIdRef.current === requestId) {
        onUiStateChange({
          ...uiState,
          include_legacy_quotes: !nextIncludeLegacyQuotes,
        });
      }
    }
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_auto_1fr_auto] gap-3 px-6 pb-5 pt-4">
      <div className="flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">
            {direction === 'take' ? 'Destination' : 'Returning from'}
          </p>
          <h2 className="text-3xl font-black tracking-tight text-white">
            {direction === 'take' ? 'Where is it going?' : 'Where is it coming from?'}
          </h2>
        </div>
        <div className="flex flex-none flex-row flex-nowrap items-center gap-2">
          <LegacyQuoteLocationOptIn
            enabled={includeLegacyQuotes}
            onEnabledChange={(enabled) => { void handleIncludeLegacyQuotesChange(enabled); }}
            size="default"
            label="Include legacy locations"
            className={[
              'border px-4 text-sm font-black',
              includeLegacyQuotes
                ? 'border-amber-300/50 bg-amber-300/10 text-amber-100 hover:bg-amber-300/15'
                : 'border-white/10 bg-transparent text-slate-500 hover:bg-white/5 hover:text-slate-300',
              YARD_KIOSK_INLINE_CONTROL_HEIGHT,
              YARD_KIOSK_INLINE_CONTROL_RADIUS,
            ].join(' ')}
          />
          <YardKioskPagerNavigation
            label="Location page navigation"
            previousLabel="Previous location page"
            nextLabel="Next location page"
            canGoPrevious={currentPageIndex > 0}
            canGoNext={currentPageIndex < pages.length - 1}
            onPrevious={() => goToPage(currentPageIndex - 1)}
            onNext={() => goToPage(currentPageIndex + 1)}
          />
        </div>
      </div>

      <div className="flex flex-nowrap items-center gap-3 max-[900px]:flex-wrap">
        <label className="relative min-w-0 flex-1 max-[900px]:w-full max-[900px]:flex-none">
          <Search className="pointer-events-none absolute left-5 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-400" />
          <span className="sr-only">Search locations</span>
          <input
            type="search"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder="Search a van, site, fleet asset or location…"
            className={[
              'w-full bg-slate-900/80 pl-14 pr-5 text-lg text-white outline-none',
              'placeholder:text-slate-500 focus:border-amber-300/70 focus:ring-2',
              'focus:ring-amber-300/20',
              YARD_KIOSK_INLINE_CONTROL_HEIGHT,
              YARD_KIOSK_INLINE_CONTROL_RADIUS,
              YARD_KIOSK_INLINE_CONTROL_SURFACE,
            ].join(' ')}
          />
        </label>
        <div
          role="radiogroup"
          aria-label="Filter locations"
          className="flex flex-none flex-row flex-nowrap items-center gap-3"
        >
          {LOCATION_FILTERS.map((filter) => {
            const selected = activeFilter === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => handleFilterChange(filter.value)}
                className={`${YARD_KIOSK_INLINE_CONTROL_HEIGHT} ${YARD_KIOSK_INLINE_CONTROL_RADIUS} w-20 border px-2 text-center text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                  selected
                    ? 'border-amber-300 bg-amber-300 text-slate-950'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        ref={pagerRef}
        onScroll={handleScroll}
        className="flex min-h-0 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {pages.length > 0 ? pages.map((page) => (
          <div
            key={page.id}
            className="grid h-full w-full flex-none snap-start grid-rows-[auto_1fr] gap-2 px-1"
            role="group"
            aria-label={page.title}
          >
            <div className="text-sm font-bold uppercase tracking-[0.16em] text-amber-200">
              {page.title}
            </div>
            <div className="grid min-h-0 grid-cols-4 grid-rows-2 gap-3">
              {page.locations.map((location) => {
                const Icon = getLocationIcon(location.location_type);
                const isPinned = pinnedIds.includes(location.id);
                const presentation = getInventoryLocationTypePresentation(location);
                return (
                  <div key={location.id} className="relative min-h-0">
                    <button
                      type="button"
                      data-location-type={location.location_type}
                      onClick={() => handleSelect(location)}
                      className={cn(
                        'flex h-full w-full flex-col items-start justify-between overflow-hidden rounded-2xl border p-4 pr-12 text-left transition',
                        presentation.surfaceClassName,
                        'hover:border-amber-300/50 hover:bg-amber-300/10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-amber-300',
                      )}
                    >
                      <Icon className={cn('h-8 w-8', presentation.iconClassName)} aria-hidden />
                      <span className="min-w-0">
                        <span className="line-clamp-2 block text-lg font-black leading-tight text-white">
                          {location.name}
                        </span>
                        <span className="mt-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
                          {location.external_reference || location.location_type}
                        </span>
                        {location.primary_user_names.length > 0
                          || location.secondary_user_names.length > 0 ? (
                          <span className="mt-2 block space-y-1 border-t border-white/10 pt-2 text-[11px] leading-tight">
                            {location.primary_user_names.length > 0 ? (
                              <span className="flex min-w-0 items-start gap-1.5">
                                <span className="flex-none font-black uppercase tracking-wide text-amber-200">
                                  Primary
                                </span>
                                <span className="line-clamp-2 text-slate-300">
                                  {location.primary_user_names.join(', ')}
                                </span>
                              </span>
                            ) : null}
                            {location.secondary_user_names.length > 0 ? (
                              <span className="flex min-w-0 items-start gap-1.5">
                                <span className="flex-none font-black uppercase tracking-wide text-cyan-200">
                                  Secondary
                                </span>
                                <span className="line-clamp-2 text-slate-300">
                                  {location.secondary_user_names.join(', ')}
                                </span>
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${location.name}`}
                      aria-pressed={isPinned}
                      onClick={() => handlePin(location.id)}
                      className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-xl bg-slate-950/70 text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                    >
                      <Star className={`h-5 w-5 ${isPinned ? 'fill-amber-300 text-amber-300' : ''}`} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )) : (
          <div className="grid w-full place-items-center rounded-3xl border border-dashed border-white/15 bg-white/[0.03] text-center">
            <div>
              <MapPin className="mx-auto h-12 w-12 text-slate-500" />
              <p className="mt-3 text-xl font-bold text-white">No matching locations</p>
              <p className="mt-1 text-slate-400">Try another name or reference.</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex h-3 items-center justify-center gap-2" aria-label="Location pages">
        {pages.map((page, index) => (
          <button
            key={page.id}
            type="button"
            aria-label={`Go to ${page.title}`}
            aria-current={index === currentPageIndex ? 'page' : undefined}
            onClick={() => goToPage(index)}
            className={`h-2 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
              index === currentPageIndex ? 'w-8 bg-amber-300' : 'w-2 bg-white/20'
            }`}
          />
        ))}
      </div>
    </section>
  );
}
