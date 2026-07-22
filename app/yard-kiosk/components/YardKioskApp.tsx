'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
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
import {
  buildYardKioskUserError,
  createYardKioskDiagnosticId,
} from '@/lib/inventory/kiosk-errors';
import {
  logYardKioskHandledError,
  yardKioskErrorFromApiPayload,
  yardKioskOfflineError,
} from '@/lib/inventory/kiosk-client-diagnostics';
import { useAuth } from '@/lib/hooks/useAuth';
import { useYardKioskRemoteControl } from '@/lib/hooks/useYardKioskRemoteControl';
import { YardKioskBasket } from './YardKioskBasket';
import { YardKioskAdminMenu } from './YardKioskAdminMenu';
import { YardKioskInactivityGuard } from './YardKioskInactivityGuard';
import { YardKioskItemPicker } from './YardKioskItemPicker';
import { YardKioskInstructionOverlay } from './YardKioskInstructionOverlay';
import { YardKioskLocationPager } from './YardKioskLocationPager';
import { YardKioskModeSelect } from './YardKioskModeSelect';
import { YardKioskReceipt as YardKioskReceiptView } from './YardKioskReceipt';
import {
  getYardKioskGuidance,
  INITIAL_YARD_KIOSK_STATE,
  yardKioskReducer,
} from '../yard-kiosk-state';

interface YardKioskAppProps {
  bootstrap: YardKioskBootstrapResponse;
}

interface ApiErrorPayload {
  error?: string;
  code?: string;
  diagnostic_id?: string;
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
  const legacyLocationRequestIdRef = useRef(0);
  const workflowSessionIdRef = useRef(0);

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

  const handleWorkflowReset = useCallback(() => {
    legacyLocationRequestIdRef.current += 1;
    workflowSessionIdRef.current += 1;
    setLocations(bootstrap.locations);
    dispatch({ type: 'RESET' });
  }, [bootstrap.locations]);

  const loadStock = useCallback(async (
    direction: YardKioskDirection,
    counterpart: YardKioskLocation,
    expectedSessionId = workflowSessionIdRef.current,
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
      if (!response.ok) {
        const userError = yardKioskErrorFromApiPayload(response.status, {
          ...payload,
          code: payload.code || (response.status === 409 ? 'STOCK_STALE' : 'STOCK_LOAD_FAILED'),
        });
        void logYardKioskHandledError(userError, { action: 'load_stock' });
        if (workflowSessionIdRef.current !== expectedSessionId) return;
        dispatch({
          type: 'STOCK_FAILED',
          message: userError.title,
          userError,
        });
        return;
      }
      if (workflowSessionIdRef.current !== expectedSessionId) return;
      dispatch({ type: 'STOCK_LOADED', stock: payload.items || [] });
    } catch (error) {
      if (workflowSessionIdRef.current !== expectedSessionId) return;
      const userError = !window.navigator.onLine
        ? yardKioskOfflineError()
        : buildYardKioskUserError('STOCK_LOAD_FAILED', {
          diagnosticId: createYardKioskDiagnosticId(),
          technicalDetail: error instanceof Error ? error.message : undefined,
        });
      void logYardKioskHandledError(userError, { action: 'load_stock' });
      dispatch({
        type: 'STOCK_FAILED',
        message: userError.title,
        userError,
      });
    }
  }, []);

  useYardKioskRemoteControl({
    phase: state.phase,
    offline,
    lastErrorCode: state.userError?.code || null,
    onResetWorkflow: handleWorkflowReset,
    onReloadStock: () => {
      if (state.direction && state.counterpart) {
        void loadStock(state.direction, state.counterpart);
      }
    },
    onRemoteNotice: (userError) => {
      dispatch({ type: 'SET_USER_ERROR', userError });
      void logYardKioskHandledError(userError, { action: 'remote_command' });
    },
  });

  function handleDirection(direction: YardKioskDirection) {
    legacyLocationRequestIdRef.current += 1;
    workflowSessionIdRef.current += 1;
    setLocations(bootstrap.locations);
    dispatch({ type: 'SELECT_DIRECTION', direction });
  }

  function handleLocation(location: YardKioskLocation) {
    if (!state.direction) return;
    legacyLocationRequestIdRef.current += 1;
    setLocations(bootstrap.locations);
    dispatch({ type: 'SELECT_LOCATION', location });
    void loadStock(state.direction, location, workflowSessionIdRef.current);
  }

  async function handleLegacyQuoteLocationOptIn(includeLegacyQuotes: boolean) {
    const requestId = legacyLocationRequestIdRef.current + 1;
    legacyLocationRequestIdRef.current = requestId;
    const response = await fetch(
      `/api/inventory/kiosk/bootstrap${includeLegacyQuotes ? '?includeLegacyQuotes=true' : ''}`,
      { cache: 'no-store' },
    );
    const payload = await response.json() as ApiErrorPayload & YardKioskBootstrapResponse;
    if (!response.ok) throw new Error(payload.error || 'Failed to load locations');
    if (legacyLocationRequestIdRef.current === requestId) {
      setLocations(payload.locations || []);
    }
  }

  async function handleSubmit() {
    if (
      !state.direction
      || !state.counterpart
      || state.basket.length === 0
      || state.phase === 'submitting'
    ) return;

    if (!window.navigator.onLine) {
      const userError = yardKioskOfflineError();
      dispatch({
        type: 'SUBMIT_FAILED',
        message: userError.title,
        userError,
      });
      void logYardKioskHandledError(userError, { action: 'submit' });
      return;
    }

    const expectedSessionId = workflowSessionIdRef.current;
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
      if (workflowSessionIdRef.current !== expectedSessionId) return;
      if (!response.ok) {
        const userError = yardKioskErrorFromApiPayload(response.status, {
          ...payload,
          code: payload.code
            || (response.status === 409 ? 'STOCK_STALE' : 'SUBMIT_FAILED'),
        });
        dispatch({
          type: 'SUBMIT_FAILED',
          message: userError.whatHappened,
          blockedItems: payload.blocked_items,
          userError,
        });
        void logYardKioskHandledError(userError, { action: 'submit', httpStatus: response.status });
        if (response.status === 409) {
          void loadStock(state.direction, state.counterpart, expectedSessionId);
        }
        return;
      }
      dispatch({ type: 'SUBMIT_SUCCEEDED', receipt: payload });
    } catch (error) {
      if (workflowSessionIdRef.current !== expectedSessionId) return;
      const userError = buildYardKioskUserError('SUBMIT_UNCERTAIN', {
        diagnosticId: createYardKioskDiagnosticId(),
        technicalDetail: error instanceof Error ? error.message : undefined,
      });
      dispatch({
        type: 'SUBMIT_FAILED',
        message: userError.whatHappened,
        userError,
      });
      void logYardKioskHandledError(userError, { action: 'submit' });
    }
  }

  function handleRemove(line: YardKioskBasketLine) {
    dispatch({ type: 'REMOVE_LINE', kind: line.kind, itemId: line.item_id });
  }

  function handleWorkflowBack() {
    legacyLocationRequestIdRef.current += 1;
    workflowSessionIdRef.current += 1;
    setLocations(bootstrap.locations);
    dispatch({ type: 'BACK' });
  }

  function handleWorkflowForward() {
    if (state.phase === 'items') {
      void handleSubmit();
      return;
    }
    if (state.phase === 'receipt') handleWorkflowReset();
  }

  const guidance = getYardKioskGuidance(state);
  const workflowBackLabel = state.phase === 'location'
    ? 'Back to direction selection'
    : state.phase === 'items'
      ? 'Back to location selection'
      : null;
  const workflowForwardLabel = state.phase === 'items'
    ? 'Confirm transfer and continue'
    : state.phase === 'receipt'
      ? 'Start new transfer'
      : null;
  const workflowForwardDisabled =
    state.phase === 'items' && (state.basket.length === 0 || offline);

  return (
    <main
      data-yard-kiosk="true"
      className="fixed inset-x-0 top-0 z-[100] grid h-[var(--yard-kiosk-viewport-height,100svh)] w-screen grid-rows-[4.75rem_1fr] overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.12),_transparent_32%),linear-gradient(135deg,#020617_0%,#0f172a_52%,#111827_100%)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] text-white"
    >
      <BiometricEnrollmentPrompt
        profileId={profile?.id}
        canCheck={!authLoading && Boolean(profile?.id)}
      />
      <header
        data-testid="yard-kiosk-workflow-nav"
        className="grid grid-cols-[3.5rem_19rem_minmax(0,1fr)_15rem_3.5rem] items-center gap-3 border-b border-white/10 bg-slate-950/75 px-3 backdrop-blur-xl"
      >
        <div
          data-testid="workflow-back-slot"
          className="grid h-14 w-14 place-items-center justify-self-start"
        >
          {workflowBackLabel ? (
            <button
              type="button"
              aria-label={workflowBackLabel}
              onClick={handleWorkflowBack}
              className="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              <ArrowLeft className="h-7 w-7" />
            </button>
          ) : (
            <span aria-hidden="true" className="h-14 w-14" />
          )}
        </div>

        <div
          data-testid="workflow-brand-slot"
          className="flex w-full items-center gap-4"
        >
          <YardKioskAdminMenu disabled={state.phase === 'submitting'} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black tracking-tight">Yard Inventory</h1>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">
                Kiosk
              </span>
            </div>
            <p className="text-sm font-medium text-slate-400">{guidance.stepLabel}</p>
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-end">
          {offline ? (
            <span className="flex items-center gap-2 rounded-xl bg-red-500/15 px-3 py-2 text-sm font-bold text-red-100">
              <WifiOff className="h-4 w-4" />
              Offline
            </span>
          ) : null}
        </div>

        <div
          data-testid="workflow-status-slot"
          className="flex w-60 items-center justify-end gap-3 justify-self-end"
        >
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

        <div
          data-testid="workflow-forward-slot"
          className="grid h-14 w-14 place-items-center justify-self-end"
        >
          {workflowForwardLabel ? (
            <button
              type="button"
              aria-label={workflowForwardLabel}
              disabled={workflowForwardDisabled}
              onClick={handleWorkflowForward}
              className="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white disabled:cursor-not-allowed disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              <ArrowRight className="h-7 w-7" />
            </button>
          ) : (
            <span aria-hidden="true" className="h-14 w-14" />
          )}
        </div>
      </header>

      <div className="relative min-h-0 overflow-hidden">
        {state.phase !== 'mode' ? (
          <YardKioskInactivityGuard onTimeout={handleWorkflowReset} />
        ) : null}

        {guidance.instructionKey && guidance.message ? (
          <YardKioskInstructionOverlay
            instructionKey={guidance.instructionKey}
            message={guidance.message}
          />
        ) : null}

        {state.phase === 'mode' ? (
          <YardKioskModeSelect yardName={bootstrap.yard.name} onSelect={handleDirection} />
        ) : null}

        {state.phase === 'location' && state.direction ? (
          <YardKioskLocationPager
            key={`${state.direction}:location`}
            direction={state.direction}
            locations={locations}
            onSelect={handleLocation}
            onIncludeLegacyQuotesChange={handleLegacyQuoteLocationOptIn}
          />
        ) : null}

        {(state.phase === 'items' || state.phase === 'submitting')
          && state.direction
          && state.counterpart ? (
          <div
            data-testid="yard-kiosk-items-layout"
            className="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_21rem] gap-4 overflow-hidden p-4"
          >
            <div
              data-testid="yard-kiosk-item-pane"
              className="h-full min-h-0 min-w-0 overflow-hidden"
            >
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
            </div>
            <div
              data-testid="yard-kiosk-basket-pane"
              className="h-full min-h-0 min-w-0 overflow-hidden"
            >
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
            onReset={handleWorkflowReset}
          />
        ) : null}

        {state.error || state.userError ? (
          <div
            role="alert"
            className="absolute bottom-5 left-1/2 z-30 w-[min(44rem,calc(100%-3rem))] -translate-x-1/2 rounded-2xl border border-red-300/30 bg-red-950/95 p-4 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-6 w-6 flex-none text-red-300" />
              <div className="min-w-0 flex-1">
                <p className="font-black text-red-50">
                  {state.userError?.title || state.error}
                </p>
                {state.userError ? (
                  <>
                    <p className="mt-1 text-sm text-red-100/90">
                      {state.userError.whatHappened}
                    </p>
                    <p className="mt-1 text-sm text-red-100/70">
                      {state.userError.whatToDoNext}
                    </p>
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-red-200/60">
                      Ref {state.userError.diagnosticId}
                    </p>
                  </>
                ) : null}
                {state.blockedItems.length > 0 ? (
                  <p className="mt-1 text-sm text-red-100/75">
                    {state.blockedItems.map((item) => `${item.item_number} · ${item.name}`).join(', ')}
                  </p>
                ) : null}
              </div>
              {(state.loadingStock || state.userError?.retryable)
                && state.counterpart
                && state.direction ? (
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
