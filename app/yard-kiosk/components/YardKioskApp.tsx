'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  MapPinned,
  PackageOpen,
  RefreshCw,
  WifiOff,
  X,
} from 'lucide-react';
import { BiometricEnrollmentPrompt } from '@/components/auth/BiometricEnrollmentPrompt';
import type {
  YardKioskBasketLine,
  YardKioskBootstrapResponse,
  YardKioskDirection,
  YardKioskLocation,
  YardKioskReceipt,
  YardKioskStockItem,
} from '@/lib/inventory/kiosk-types';
import { useAuth } from '@/lib/hooks/useAuth';
import { YardKioskBasket } from './YardKioskBasket';
import { YardKioskItemPicker } from './YardKioskItemPicker';
import { YardKioskLocationPager } from './YardKioskLocationPager';
import { YardKioskModeSelect } from './YardKioskModeSelect';
import { YardKioskReceipt as YardKioskReceiptView } from './YardKioskReceipt';
import {
  INITIAL_YARD_KIOSK_STATE,
  yardKioskReducer,
} from '../yard-kiosk-state';

interface YardKioskAppProps {
  bootstrap: YardKioskBootstrapResponse;
}

interface ApiErrorPayload {
  error?: string;
  code?: string;
  blocked_items?: Array<{
    id: string;
    item_number: string;
    name: string;
    check_status: 'ok' | 'due_soon' | 'overdue' | 'needs_check' | 'not_required';
  }>;
}

export function YardKioskApp({ bootstrap }: YardKioskAppProps) {
  const { profile, loading: authLoading } = useAuth();
  const [state, dispatch] = useReducer(yardKioskReducer, INITIAL_YARD_KIOSK_STATE);
  const [offline, setOffline] = useState(false);
  const [locations, setLocations] = useState<YardKioskLocation[]>(bootstrap.locations);

  useEffect(() => {
    const updateOnlineStatus = () => setOffline(!window.navigator.onLine);
    updateOnlineStatus();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  const loadStock = useCallback(async (
    direction: YardKioskDirection,
    counterpart: YardKioskLocation,
  ) => {
    try {
      const params = new URLSearchParams({
        direction,
        counterpart_location_id: counterpart.id,
      });
      const response = await fetch(`/api/inventory/kiosk/stock?${params}`, {
        cache: 'no-store',
      });
      const payload = await response.json() as ApiErrorPayload & { items?: YardKioskStockItem[] };
      if (!response.ok) throw new Error(payload.error || 'Failed to load available stock');
      dispatch({ type: 'STOCK_LOADED', stock: payload.items || [] });
    } catch (error) {
      dispatch({
        type: 'STOCK_FAILED',
        message: error instanceof Error ? error.message : 'Failed to load available stock',
      });
    }
  }, []);

  function handleDirection(direction: YardKioskDirection) {
    setLocations(bootstrap.locations);
    dispatch({ type: 'SELECT_DIRECTION', direction });
  }

  function handleLocation(location: YardKioskLocation) {
    if (!state.direction) return;
    setLocations(bootstrap.locations);
    dispatch({ type: 'SELECT_LOCATION', location });
    void loadStock(state.direction, location);
  }

  async function handleLegacyQuoteLocationOptIn(includeLegacyQuotes: boolean) {
    const response = await fetch(
      `/api/inventory/kiosk/bootstrap${includeLegacyQuotes ? '?includeLegacyQuotes=true' : ''}`,
      { cache: 'no-store' },
    );
    const payload = await response.json() as ApiErrorPayload & YardKioskBootstrapResponse;
    if (!response.ok) throw new Error(payload.error || 'Failed to load locations');
    setLocations(payload.locations || []);
  }

  async function handleSubmit() {
    if (
      !state.direction
      || !state.counterpart
      || state.basket.length === 0
      || state.phase === 'submitting'
    ) return;

    dispatch({ type: 'SUBMIT_START' });
    try {
      const response = await fetch('/api/inventory/kiosk/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: state.direction,
          counterpart_location_id: state.counterpart.id,
          serialized_item_ids: state.basket.flatMap((line) => (
            line.kind === 'serialized' ? [line.item_id] : []
          )),
          hardware_lines: state.basket.flatMap((line) => (
            line.kind === 'hardware'
              ? [{ item_id: line.item_id, quantity: line.quantity }]
              : []
          )),
        }),
      });
      const payload = await response.json() as ApiErrorPayload & YardKioskReceipt;
      if (!response.ok) {
        dispatch({
          type: 'SUBMIT_FAILED',
          message: payload.error || 'The transfer could not be completed',
          blockedItems: payload.blocked_items,
        });
        if (response.status === 409) {
          void loadStock(state.direction, state.counterpart);
        }
        return;
      }
      dispatch({ type: 'SUBMIT_SUCCEEDED', receipt: payload });
    } catch (error) {
      dispatch({
        type: 'SUBMIT_FAILED',
        message: error instanceof Error ? error.message : 'The transfer could not be completed',
      });
    }
  }

  function handleRemove(line: YardKioskBasketLine) {
    dispatch({ type: 'REMOVE_LINE', kind: line.kind, itemId: line.item_id });
  }

  const showBack = state.phase === 'location' || state.phase === 'items';
  const stepLabel = state.phase === 'mode'
    ? 'Choose direction'
    : state.phase === 'location'
      ? 'Choose location'
      : state.phase === 'receipt'
        ? 'Complete'
        : 'Choose stock';

  return (
    <main
      data-yard-kiosk="true"
      className="fixed inset-0 z-[100] grid h-dvh w-screen grid-rows-[4.75rem_1fr] overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.12),_transparent_32%),linear-gradient(135deg,#020617_0%,#0f172a_52%,#111827_100%)] text-white"
    >
      <BiometricEnrollmentPrompt
        profileId={profile?.id}
        canCheck={!authLoading && Boolean(profile?.id)}
      />
      <header className="flex items-center justify-between border-b border-white/10 bg-slate-950/75 px-6 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          {showBack ? (
            <button
              type="button"
              aria-label="Go back"
              onClick={() => {
                setLocations(bootstrap.locations);
                dispatch({ type: 'BACK' });
              }}
              className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              <ArrowLeft className="h-7 w-7" />
            </button>
          ) : (
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-300 text-slate-950">
              <PackageOpen className="h-7 w-7" />
            </span>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black tracking-tight">Yard Inventory</h1>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">
                Kiosk
              </span>
            </div>
            <p className="text-sm font-medium text-slate-400">{stepLabel}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {offline ? (
            <span className="flex items-center gap-2 rounded-xl bg-red-500/15 px-3 py-2 text-sm font-bold text-red-100">
              <WifiOff className="h-4 w-4" />
              Offline
            </span>
          ) : null}
          <span className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-300">
            <MapPinned className="h-4 w-4 text-amber-300" />
            {bootstrap.yard.name}
          </span>
          <div className="hidden items-center gap-1.5 min-[1120px]:flex" aria-label="Progress">
            {['mode', 'location', 'items'].map((step, index) => {
              const currentIndex = state.phase === 'mode' ? 0 : state.phase === 'location' ? 1 : 2;
              return (
                <span
                  key={step}
                  className={`h-2.5 rounded-full transition-all ${
                    index === currentIndex ? 'w-8 bg-amber-300' : index < currentIndex ? 'w-2.5 bg-emerald-300' : 'w-2.5 bg-white/20'
                  }`}
                />
              );
            })}
          </div>
        </div>
      </header>

      <div className="relative min-h-0 overflow-hidden">
        {state.phase === 'mode' ? (
          <YardKioskModeSelect yardName={bootstrap.yard.name} onSelect={handleDirection} />
        ) : null}

        {state.phase === 'location' && state.direction ? (
          <YardKioskLocationPager
            direction={state.direction}
            locations={locations}
            onSelect={handleLocation}
            onIncludeLegacyQuotesChange={handleLegacyQuoteLocationOptIn}
          />
        ) : null}

        {(state.phase === 'items' || state.phase === 'submitting')
          && state.direction
          && state.counterpart ? (
          <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_21rem] gap-4 p-4">
            <YardKioskItemPicker
              categories={bootstrap.categories}
              items={state.stock}
              basket={state.basket}
              searchQuery={state.searchQuery}
              activeCategory={state.category}
              loading={state.loadingStock}
              onSearchChange={(query) => dispatch({ type: 'SET_SEARCH', query })}
              onCategoryChange={(category) => dispatch({ type: 'SET_CATEGORY', category })}
              onAddSerialized={(item) => dispatch({ type: 'ADD_SERIALIZED', item })}
              onSetHardwareQuantity={(item, quantity) => dispatch({
                type: 'SET_HARDWARE_QUANTITY',
                item,
                quantity,
              })}
            />
            <YardKioskBasket
              direction={state.direction}
              counterpart={state.counterpart}
              basket={state.basket}
              offline={offline}
              submitting={state.phase === 'submitting'}
              onRemove={handleRemove}
              onClear={() => dispatch({ type: 'CLEAR_BASKET' })}
              onSubmit={() => void handleSubmit()}
            />
          </div>
        ) : null}

        {state.phase === 'receipt'
          && state.direction
          && state.counterpart
          && state.receipt ? (
          <YardKioskReceiptView
            direction={state.direction}
            counterpart={state.counterpart}
            receipt={state.receipt}
              onReset={() => {
                setLocations(bootstrap.locations);
                dispatch({ type: 'RESET' });
              }}
          />
        ) : null}

        {state.error ? (
          <div
            role="alert"
            className="absolute bottom-5 left-1/2 z-30 w-[min(44rem,calc(100%-3rem))] -translate-x-1/2 rounded-2xl border border-red-300/30 bg-red-950/95 p-4 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-6 w-6 flex-none text-red-300" />
              <div className="min-w-0 flex-1">
                <p className="font-black text-red-50">{state.error}</p>
                {state.blockedItems.length > 0 ? (
                  <p className="mt-1 text-sm text-red-100/75">
                    {state.blockedItems.map((item) => `${item.item_number} · ${item.name}`).join(', ')}
                  </p>
                ) : null}
              </div>
              {state.loadingStock && state.counterpart && state.direction ? (
                <button
                  type="button"
                  aria-label="Retry loading stock"
                  onClick={() => void loadStock(state.direction!, state.counterpart!)}
                  className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
                >
                  <RefreshCw className="h-5 w-5" />
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={() => dispatch({ type: 'DISMISS_ERROR' })}
                className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        ) : null}

        {state.phase === 'submitting' ? (
          <div className="absolute inset-0 z-20 grid place-items-center bg-slate-950/70 backdrop-blur-sm" aria-live="assertive">
            <div className="rounded-3xl border border-white/10 bg-slate-900 p-8 text-center shadow-2xl">
              <RefreshCw className="mx-auto h-12 w-12 animate-spin text-amber-300" />
              <p className="mt-4 text-2xl font-black">Moving the complete basket…</p>
              <p className="mt-1 text-slate-400">Keep this screen open.</p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="absolute inset-0 z-[200] hidden place-items-center bg-slate-950 p-8 text-center max-[1023px]:grid max-h-[599px]:grid">
        <div>
          <PackageOpen className="mx-auto h-16 w-16 text-amber-300" />
          <h2 className="mt-4 text-3xl font-black">Use landscape mode</h2>
          <p className="mt-2 max-w-lg text-lg text-slate-400">
            The Yard kiosk requires a landscape screen of at least 1024 by 600 pixels.
          </p>
        </div>
      </div>
    </main>
  );
}
