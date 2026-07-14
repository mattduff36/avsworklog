'use client';

import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Box,
  Boxes,
  Check,
  Minus,
  PackageSearch,
  Plus,
  Search,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  YardKioskBasketLine,
  YardKioskCategory,
  YardKioskStockItem,
} from '@/lib/inventory/kiosk-types';
import { YardKioskPagerNavigation } from './YardKioskPagerNavigation';

const ITEMS_PER_PAGE = 6;
const MAX_VISIBLE_ITEMS = 24;

interface ItemPage {
  id: string;
  category: string;
  title: string;
  items: YardKioskStockItem[];
}

interface YardKioskItemPickerProps {
  categories: YardKioskCategory[];
  items: YardKioskStockItem[];
  basket: YardKioskBasketLine[];
  searchQuery: string;
  activeCategory: string;
  loading: boolean;
  onSearchChange: (query: string) => void;
  onCategoryChange: (category: string) => void;
  onAddSerialized: (item: Extract<YardKioskStockItem, { kind: 'serialized' }>) => void;
  onSetHardwareQuantity: (
    item: Extract<YardKioskStockItem, { kind: 'hardware' }>,
    quantity: number,
  ) => void;
}

function chunkItemPages(
  category: string,
  title: string,
  items: YardKioskStockItem[],
): ItemPage[] {
  if (items.length === 0) return [];
  const count = Math.ceil(items.length / ITEMS_PER_PAGE);
  return Array.from({ length: count }, (_, index) => ({
    id: `${category}-${index}`,
    category,
    title: count > 1 ? `${title} ${index + 1} / ${count}` : title,
    items: items.slice(index * ITEMS_PER_PAGE, (index + 1) * ITEMS_PER_PAGE),
  }));
}

export function YardKioskItemPicker({
  categories,
  items,
  basket,
  searchQuery,
  activeCategory,
  loading,
  onSearchChange,
  onCategoryChange,
  onAddSerialized,
  onSetHardwareQuantity,
}: YardKioskItemPickerProps) {
  const pagerRef = useRef<HTMLDivElement>(null);
  const [hardwareItem, setHardwareItem] = useState<Extract<YardKioskStockItem, { kind: 'hardware' }> | null>(null);
  const [quantity, setQuantity] = useState(1);

  const categoryLabels = useMemo(
    () => new Map(categories.map((category) => [category.slug, category.name])),
    [categories],
  );

  const matchingItems = useMemo(() => {
    const categoryItems = activeCategory === 'all'
      ? items
      : activeCategory === 'hardware'
        ? items.filter((item) => item.kind === 'hardware')
        : items.filter(
          (item) => item.kind === 'serialized' && item.category === activeCategory,
        );
    const query = searchQuery.trim().toLowerCase();
    if (!query) return categoryItems;
    return categoryItems.filter((item) => (
        item.name.toLowerCase().includes(query)
        || (item.kind === 'serialized' && item.item_number.toLowerCase().includes(query))
    ));
  }, [activeCategory, items, searchQuery]);
  const requiresNarrowing = matchingItems.length > MAX_VISIBLE_ITEMS;

  const pages = useMemo(() => {
    if (requiresNarrowing) return [];
    const title = searchQuery.trim()
      ? `Search results · ${matchingItems.length}`
      : activeCategory === 'all'
        ? 'All available stock'
        : activeCategory === 'hardware'
          ? 'Hardware'
          : categoryLabels.get(activeCategory) || activeCategory.replaceAll('_', ' ');
    return chunkItemPages(activeCategory, title, matchingItems);
  }, [
    activeCategory,
    categoryLabels,
    matchingItems,
    requiresNarrowing,
    searchQuery,
  ]);
  const pagerContextKey = `${activeCategory}:${searchQuery}:${requiresNarrowing}`;
  const [pagerState, setPagerState] = useState({ contextKey: pagerContextKey, index: 0 });
  const currentPageIndex = pagerState.contextKey === pagerContextKey
    ? Math.min(pagerState.index, Math.max(0, pages.length - 1))
    : 0;

  function resetPager() {
    setPagerState({ contextKey: pagerContextKey, index: 0 });
    pagerRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
  }

  function handleSearchChange(query: string) {
    resetPager();
    onSearchChange(query);
  }

  function handleCategoryChange(category: string) {
    resetPager();
    onCategoryChange(category);
  }

  function goToPage(index: number) {
    const nextIndex = Math.max(0, Math.min(pages.length - 1, index));
    setPagerState({ contextKey: pagerContextKey, index: nextIndex });
    pagerRef.current?.scrollTo({
      left: pagerRef.current.clientWidth * nextIndex,
      behavior: 'smooth',
    });
  }

  function handleScroll() {
    const element = pagerRef.current;
    if (!element?.clientWidth) return;
    const nextIndex = Math.round(element.scrollLeft / element.clientWidth);
    setPagerState({
      contextKey: pagerContextKey,
      index: Math.min(Math.max(0, pages.length - 1), nextIndex),
    });
  }

  function getBasketLine(item: YardKioskStockItem) {
    return basket.find((line) => line.kind === item.kind && line.item_id === item.id);
  }

  function openHardwareQuantity(item: Extract<YardKioskStockItem, { kind: 'hardware' }>) {
    const existing = getBasketLine(item);
    setQuantity(existing?.kind === 'hardware' ? existing.quantity : 1);
    setHardwareItem(item);
  }

  function saveHardwareQuantity() {
    if (!hardwareItem) return;
    onSetHardwareQuantity(hardwareItem, quantity);
    setHardwareItem(null);
  }

  return (
    <>
      <section
        data-testid="yard-kiosk-item-picker"
        className="grid h-full min-h-0 min-w-0 grid-rows-[auto_auto_1fr_auto] gap-3 overflow-hidden"
      >
        <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[
            { slug: 'all', name: 'All stock' },
            ...categories.filter((category) => items.some(
              (item) => item.kind === 'serialized' && item.category === category.slug,
            )),
            ...(items.some((item) => item.kind === 'hardware')
              ? [{ slug: 'hardware', name: 'Hardware' }]
              : []),
          ].map((category) => (
            <button
              key={category.slug}
              type="button"
              onClick={() => handleCategoryChange(category.slug)}
              aria-pressed={activeCategory === category.slug}
              className={`h-11 flex-none rounded-xl px-4 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                activeCategory === category.slug
                  ? 'bg-amber-300 text-slate-950'
                  : 'border border-white/10 bg-white/5 text-slate-300'
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <label className="relative block min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <span className="sr-only">Search available stock</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder="Search item name or item number…"
              className="h-12 w-full rounded-xl border border-white/10 bg-slate-950/70 pl-12 pr-4 text-base text-white outline-none placeholder:text-slate-500 focus:border-amber-300/70"
            />
          </label>
          {!requiresNarrowing && pages.length > 0 ? (
            <YardKioskPagerNavigation
              label="Item page navigation"
              previousLabel="Previous item page"
              nextLabel="Next item page"
              canGoPrevious={currentPageIndex > 0}
              canGoNext={currentPageIndex < pages.length - 1}
              onPrevious={() => goToPage(currentPageIndex - 1)}
              onNext={() => goToPage(currentPageIndex + 1)}
            />
          ) : null}
        </div>

        <div className="relative min-h-0 overflow-hidden">
          {loading ? (
            <div className="grid h-full place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
              <div className="text-center">
                <PackageSearch className="mx-auto h-12 w-12 animate-pulse text-amber-300" />
                <p className="mt-3 text-lg font-bold text-white">Loading available stock…</p>
              </div>
            </div>
          ) : requiresNarrowing ? (
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="grid h-full place-items-center rounded-2xl border border-amber-300/25 bg-amber-300/[0.06] px-8 text-center"
            >
              <div className="max-w-2xl">
                <Search className="mx-auto h-14 w-14 text-amber-300" aria-hidden />
                <p className="mt-4 text-3xl font-black tracking-tight text-white">
                  {searchQuery.trim()
                    ? 'Keep typing to narrow the stock list'
                    : 'Start typing to narrow the stock list'}
                </p>
                <p aria-hidden="true" className="mt-2 text-lg font-bold text-amber-100/75">
                  {matchingItems.length} matching items
                </p>
              </div>
            </div>
          ) : pages.length === 0 ? (
            <div className="grid h-full place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] text-center">
              <div>
                <Box className="mx-auto h-12 w-12 text-slate-500" />
                <p className="mt-3 text-xl font-bold text-white">No stock found</p>
                <p className="mt-1 text-sm text-slate-400">
                  {searchQuery ? 'Try another search.' : 'There is no available stock at this source.'}
                </p>
              </div>
            </div>
          ) : (
            <div
              ref={pagerRef}
              onScroll={handleScroll}
              className="flex h-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {pages.map((page) => (
                <div
                  key={page.id}
                  className="grid h-full w-full flex-none snap-start grid-rows-[auto_1fr] gap-2 px-1"
                  role="group"
                  aria-label={page.title}
                >
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-200">
                    {page.title}
                  </p>
                  <div className="grid min-h-0 grid-cols-3 grid-rows-2 gap-3">
                    {page.items.map((item) => {
                      const selected = getBasketLine(item);
                      const blocked = item.kind === 'serialized' && item.is_check_blocked;
                      return (
                        <button
                          key={`${item.kind}-${item.id}`}
                          type="button"
                          onClick={() => item.kind === 'serialized'
                            ? onAddSerialized(item)
                            : openHardwareQuantity(item)}
                          className={`relative flex min-h-0 flex-col items-start justify-between overflow-hidden rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-amber-300 ${
                            blocked
                              ? 'border-red-400/30 bg-red-500/10'
                              : selected
                                ? 'border-emerald-300/60 bg-emerald-400/15'
                                : 'border-white/10 bg-white/[0.06] hover:border-amber-300/50 hover:bg-amber-300/10'
                          }`}
                        >
                          <span className="flex w-full items-start justify-between">
                            {item.kind === 'hardware'
                              ? <Boxes className="h-7 w-7 text-cyan-300" />
                              : <Wrench className="h-7 w-7 text-amber-300" />}
                            {selected ? (
                              <span className="grid h-7 min-w-7 place-items-center rounded-full bg-emerald-300 px-2 text-xs font-black text-slate-950">
                                {selected.kind === 'hardware' ? selected.quantity : <Check className="h-4 w-4" />}
                              </span>
                            ) : blocked ? (
                              <AlertTriangle className="h-6 w-6 text-red-300" />
                            ) : null}
                          </span>
                          <span className="min-w-0">
                            <span className="line-clamp-2 block text-lg font-black leading-tight text-white">
                              {item.name}
                            </span>
                            <span className="mt-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
                              {item.kind === 'hardware'
                                ? `${item.available_quantity} available`
                                : item.item_number}
                            </span>
                            {blocked ? (
                              <span className="mt-1 block text-xs font-bold text-red-200">
                                Check required
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {pages.length > 0 ? (
          <div className="flex h-2 items-center justify-center gap-1.5" aria-label="Item pages">
            {pages.map((page, index) => (
              <button
                key={page.id}
                type="button"
                aria-label={`Go to ${page.title}`}
                aria-current={index === currentPageIndex ? 'page' : undefined}
                onClick={() => goToPage(index)}
                className={`h-1.5 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                  index === currentPageIndex ? 'w-7 bg-amber-300' : 'w-1.5 bg-white/20'
                }`}
              />
            ))}
          </div>
        ) : <div className="h-2" aria-hidden="true" />}
      </section>

      <Dialog open={Boolean(hardwareItem)} onOpenChange={(open) => { if (!open) setHardwareItem(null); }}>
        <DialogContent className="max-w-md border-white/10 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black">{hardwareItem?.name || 'Hardware quantity'}</DialogTitle>
            <DialogDescription className="text-base text-slate-400">
              Choose how many to move. {hardwareItem?.available_quantity || 0} available.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-[4rem_1fr_4rem] items-center gap-3 py-4">
            <button
              type="button"
              aria-label="Decrease quantity"
              onClick={() => setQuantity((value) => Math.max(0, value - 1))}
              className="grid h-16 place-items-center rounded-2xl border border-white/10 bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              <Minus className="h-8 w-8" />
            </button>
            <input
              type="number"
              min={0}
              max={hardwareItem?.available_quantity || 0}
              value={quantity}
              onChange={(event) => setQuantity(Math.min(
                hardwareItem?.available_quantity || 0,
                Math.max(0, Number.parseInt(event.target.value || '0', 10)),
              ))}
              className="h-20 rounded-2xl border border-amber-300/40 bg-amber-300/10 text-center text-4xl font-black text-white outline-none focus:ring-2 focus:ring-amber-300"
            />
            <button
              type="button"
              aria-label="Increase quantity"
              onClick={() => setQuantity((value) => Math.min(hardwareItem?.available_quantity || 0, value + 1))}
              className="grid h-16 place-items-center rounded-2xl border border-white/10 bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              <Plus className="h-8 w-8" />
            </button>
          </div>
          <Button
            type="button"
            onClick={saveHardwareQuantity}
            className="h-14 bg-amber-300 text-lg font-black text-slate-950 hover:bg-amber-200"
          >
            {quantity === 0 ? 'Remove from basket' : `Add ${quantity} to basket`}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
