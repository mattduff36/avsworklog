'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  HardHat,
  MapPin,
  Search,
  Star,
  Truck,
  Warehouse,
} from 'lucide-react';
import type { YardKioskDirection, YardKioskLocation } from '@/lib/inventory/kiosk-types';
import {
  getPinnedYardKioskLocationIds,
  getRecentYardKioskLocationIds,
  rememberYardKioskLocation,
  togglePinnedYardKioskLocation,
} from '../yard-kiosk-storage';
import { LegacyQuoteLocationOptIn } from '@/app/(dashboard)/inventory/components/LegacyQuoteLocationOptIn';

const PAGE_SIZE = 8;

interface LocationPage {
  id: string;
  title: string;
  locations: YardKioskLocation[];
}

interface YardKioskLocationPagerProps {
  direction: YardKioskDirection;
  locations: YardKioskLocation[];
  onSelect: (location: YardKioskLocation) => void;
  onIncludeLegacyQuotesChange: (includeLegacyQuotes: boolean) => Promise<void>;
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

export function YardKioskLocationPager({
  direction,
  locations,
  onSelect,
  onIncludeLegacyQuotesChange,
}: YardKioskLocationPagerProps) {
  const pagerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [includeLegacyQuotes, setIncludeLegacyQuotes] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRecentIds(getRecentYardKioskLocationIds());
      setPinnedIds(getPinnedYardKioskLocationIds());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const pages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery) {
      const matches = locations.filter((location) => (
        location.name.toLowerCase().includes(normalizedQuery)
        || location.external_reference?.toLowerCase().includes(normalizedQuery)
        || location.description?.toLowerCase().includes(normalizedQuery)
      ));
      return chunkLocations('search', `Search results · ${matches.length}`, matches);
    }

    const byId = new Map(locations.map((location) => [location.id, location]));
    const priorityIds = [...pinnedIds, ...recentIds.filter((id) => !pinnedIds.includes(id))];
    const priority = priorityIds.flatMap((id) => {
      const location = byId.get(id);
      return location ? [location] : [];
    });
    const vans = locations.filter((location) => location.location_type === 'van');
    const sites = locations.filter((location) => location.location_type === 'site');
    const fleet = locations.filter((location) => ['hgv', 'plant'].includes(location.location_type));
    const other = locations.filter((location) => !['van', 'site', 'hgv', 'plant'].includes(location.location_type));

    return [
      ...chunkLocations('recent', 'Pinned & recent', priority),
      ...chunkLocations('vans', 'Vans', vans),
      ...chunkLocations('sites', 'Sites', sites),
      ...chunkLocations('fleet', 'Fleet & plant', fleet),
      ...chunkLocations('other', 'Other locations', other),
    ];
  }, [locations, pinnedIds, query, recentIds]);

  function handleQueryChange(value: string) {
    setQuery(value);
    setPageIndex(0);
    pagerRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
  }

  function goToPage(index: number) {
    const nextIndex = Math.max(0, Math.min(pages.length - 1, index));
    setPageIndex(nextIndex);
    pagerRef.current?.scrollTo({
      left: pagerRef.current.clientWidth * nextIndex,
      behavior: 'smooth',
    });
  }

  function handleScroll() {
    const element = pagerRef.current;
    if (!element?.clientWidth) return;
    setPageIndex(Math.round(element.scrollLeft / element.clientWidth));
  }

  function handleSelect(location: YardKioskLocation) {
    setRecentIds(rememberYardKioskLocation(location.id));
    onSelect(location);
  }

  function handlePin(locationId: string) {
    setPinnedIds(togglePinnedYardKioskLocation(locationId));
  }

  async function handleIncludeLegacyQuotesChange(nextIncludeLegacyQuotes: boolean) {
    await onIncludeLegacyQuotesChange(nextIncludeLegacyQuotes);
    setIncludeLegacyQuotes(nextIncludeLegacyQuotes);
    setQuery('');
    setPageIndex(0);
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_auto_1fr_auto] gap-3 px-6 pb-5 pt-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">
            {direction === 'take' ? 'Destination' : 'Returning from'}
          </p>
          <h2 className="text-3xl font-black tracking-tight text-white">
            {direction === 'take' ? 'Where is it going?' : 'Where is it coming from?'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <LegacyQuoteLocationOptIn
            enabled={includeLegacyQuotes}
            onEnabledChange={(enabled) => { void handleIncludeLegacyQuotesChange(enabled); }}
            size="default"
            className="border-white/20 bg-white/5 text-white hover:bg-white/10"
          />
          <button
            type="button"
            aria-label="Previous location page"
            onClick={() => goToPage(pageIndex - 1)}
            disabled={pageIndex === 0}
            className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <ChevronLeft className="h-7 w-7" />
          </button>
          <button
            type="button"
            aria-label="Next location page"
            onClick={() => goToPage(pageIndex + 1)}
            disabled={pageIndex >= pages.length - 1}
            className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <ChevronRight className="h-7 w-7" />
          </button>
        </div>
      </div>

      <label className="relative block">
        <Search className="pointer-events-none absolute left-5 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-400" />
        <span className="sr-only">Search locations</span>
        <input
          type="search"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder="Search a van, site, fleet asset or location…"
          className="h-14 w-full rounded-2xl border border-white/10 bg-slate-900/80 pl-14 pr-5 text-lg text-white outline-none placeholder:text-slate-500 focus:border-amber-300/70 focus:ring-2 focus:ring-amber-300/20"
        />
      </label>

      <div
        ref={pagerRef}
        onScroll={handleScroll}
        className="flex min-h-0 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {pages.length > 0 ? pages.map((page) => (
          <div
            key={page.id}
            className="grid h-full w-full flex-none snap-start grid-rows-[auto_1fr] gap-2"
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
                return (
                  <div key={location.id} className="relative min-h-0">
                    <button
                      type="button"
                      onClick={() => handleSelect(location)}
                      className="flex h-full w-full flex-col items-start justify-between overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] p-4 pr-12 text-left transition hover:border-amber-300/50 hover:bg-amber-300/10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-amber-300"
                    >
                      <Icon className="h-8 w-8 text-amber-300" aria-hidden />
                      <span className="min-w-0">
                        <span className="line-clamp-2 block text-lg font-black leading-tight text-white">
                          {location.name}
                        </span>
                        <span className="mt-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
                          {location.external_reference || location.location_type}
                        </span>
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
            aria-current={index === pageIndex ? 'page' : undefined}
            onClick={() => goToPage(index)}
            className={`h-2 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
              index === pageIndex ? 'w-8 bg-amber-300' : 'w-2 bg-white/20'
            }`}
          />
        ))}
      </div>
    </section>
  );
}
