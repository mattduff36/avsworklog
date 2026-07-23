'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  LockKeyhole,
  MonitorSmartphone,
  Radio,
  RefreshCw,
  Unlock,
  WifiOff,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  YardKioskBasketLine,
} from '@/lib/inventory/kiosk-types';
import type {
  YardKioskControlAction,
  YardKioskControlLeaseView,
  YardKioskItemUiState,
  YardKioskLocationUiState,
  YardKioskWorkflowSnapshot,
} from '@/lib/inventory/kiosk-remote-types';
import {
  getYardKioskGuidance,
  type YardKioskState,
} from '@/app/yard-kiosk/yard-kiosk-state';
import { YardKioskBasket } from '@/app/yard-kiosk/components/YardKioskBasket';
import { YardKioskItemPicker } from '@/app/yard-kiosk/components/YardKioskItemPicker';
import { YardKioskLocationPager } from '@/app/yard-kiosk/components/YardKioskLocationPager';
import { YardKioskModeSelect } from '@/app/yard-kiosk/components/YardKioskModeSelect';
import { YardKioskReceipt } from '@/app/yard-kiosk/components/YardKioskReceipt';

interface KioskControlDevice {
  id: string;
  device_label: string;
  presence: 'online' | 'stale' | 'offline' | 'revoked';
  last_heartbeat_at: string | null;
  workflow_snapshot: YardKioskWorkflowSnapshot | null;
  workflow_state_version: number;
  last_snapshot_at: string | null;
  control_lease: YardKioskControlLeaseView;
}

interface KioskControlResponse {
  success?: boolean;
  device: KioskControlDevice | null;
  error?: string;
}

function createControlSessionId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function getWorkflowState(
  snapshot: YardKioskWorkflowSnapshot | null,
): YardKioskState | null {
  if (!snapshot?.state || typeof snapshot.state !== 'object') return null;
  const state = snapshot.state as unknown as YardKioskState;
  if (
    !['mode', 'location', 'items', 'submitting', 'receipt'].includes(state.phase)
    || !Array.isArray(state.stock)
    || !Array.isArray(state.basket)
  ) {
    return null;
  }
  return state;
}

export function YardKioskController() {
  const [controlSessionId] = useState(createControlSessionId);
  const [device, setDevice] = useState<KioskControlDevice | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const holdsControlRef = useRef(false);
  const activeDeviceId = device?.id ?? null;

  const loadState = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch('/api/inventory/kiosk/control', {
        cache: 'no-store',
      });
      const payload = await response.json() as KioskControlResponse;
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load Yard kiosk control');
      }
      setDevice(payload.device);
      setError('');
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load Yard kiosk control',
      );
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadState();
    const interval = window.setInterval(() => void loadState(true), 1_000);
    return () => window.clearInterval(interval);
  }, [loadState]);

  const leaseIsActive = Boolean(
    device?.control_lease.is_active
    && device.control_lease.expires_at
    && new Date(device.control_lease.expires_at).getTime() > Date.now(),
  );
  const holdsControl = Boolean(
    leaseIsActive
    && device?.control_lease.session_id === controlSessionId,
  );
  holdsControlRef.current = holdsControl;

  const runOperation = useCallback(async (
    operation: 'take' | 'renew' | 'release',
    quiet = false,
  ): Promise<boolean> => {
    if (!activeDeviceId) return false;
    if (!quiet) setSaving(true);
    try {
      const response = await fetch('/api/inventory/kiosk/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          operation,
          device_id: activeDeviceId,
          control_session_id: controlSessionId,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `Unable to ${operation} Yard kiosk control`);
      }
      await loadState(true);
      setError('');
      return true;
    } catch (operationError) {
      setError(
        operationError instanceof Error
          ? operationError.message
          : 'Unable to update Yard kiosk control',
      );
      await loadState(true);
      return false;
    } finally {
      if (!quiet) setSaving(false);
    }
  }, [activeDeviceId, controlSessionId, loadState]);

  useEffect(() => {
    if (!holdsControl) return;
    const interval = window.setInterval(() => {
      void runOperation('renew', true);
    }, 8_000);
    return () => window.clearInterval(interval);
  }, [holdsControl, runOperation]);

  useEffect(() => {
    if (!activeDeviceId) return;
    const releaseOnExit = () => {
      if (!holdsControlRef.current) return;
      const body = JSON.stringify({
        operation: 'release',
        device_id: activeDeviceId,
        control_session_id: controlSessionId,
      });
      navigator.sendBeacon(
        '/api/inventory/kiosk/control',
        new Blob([body], { type: 'application/json' }),
      );
    };
    window.addEventListener('pagehide', releaseOnExit);
    return () => {
      window.removeEventListener('pagehide', releaseOnExit);
      releaseOnExit();
    };
  }, [activeDeviceId, controlSessionId]);

  const sendAction = useCallback(async (
    action: YardKioskControlAction,
  ): Promise<void> => {
    if (!activeDeviceId || !holdsControlRef.current) return;
    try {
      const response = await fetch('/api/inventory/kiosk/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          operation: 'action',
          device_id: activeDeviceId,
          control_session_id: controlSessionId,
          control_action: action,
          idempotency_key: `${controlSessionId}:${Date.now()}:${action.type}`,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'The tablet did not accept this control action');
      }
      setError('');
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Unable to control the Yard kiosk',
      );
      await loadState(true);
    }
  }, [activeDeviceId, controlSessionId, loadState]);

  const snapshot = device?.workflow_snapshot || null;
  const state = useMemo(() => getWorkflowState(snapshot), [snapshot]);
  const isTabletOnline = device?.presence === 'online';
  const tabletAcknowledgedLease = Boolean(
    holdsControl
    && device?.last_heartbeat_at
    && device.control_lease.acquired_at
    && new Date(device.last_heartbeat_at).getTime()
      >= new Date(device.control_lease.acquired_at).getTime(),
  );
  const canControl = holdsControl
    && tabletAcknowledgedLease
    && isTabletOnline
    && Boolean(state);

  function sendLocationUiChange(next: YardKioskLocationUiState) {
    if (!snapshot || !canControl) return;
    const current = snapshot.location_ui;
    if (next.query !== current.query) {
      void sendAction({ type: 'set_location_search', query: next.query });
    } else if (next.active_filter !== current.active_filter) {
      void sendAction({ type: 'set_location_filter', filter: next.active_filter });
    } else if (next.page_index !== current.page_index) {
      void sendAction({ type: 'set_location_page', page_index: next.page_index });
    } else if (next.include_legacy_quotes !== current.include_legacy_quotes) {
      void sendAction({
        type: 'set_include_legacy_quotes',
        enabled: next.include_legacy_quotes,
      });
    } else {
      const changedPin = [...next.pinned_ids, ...current.pinned_ids]
        .find((id) => (
          next.pinned_ids.includes(id) !== current.pinned_ids.includes(id)
        ));
      if (changedPin) {
        void sendAction({ type: 'toggle_location_pin', location_id: changedPin });
      }
    }
  }

  function sendItemUiChange(next: YardKioskItemUiState) {
    if (!snapshot || !canControl) return;
    const current = snapshot.item_ui;
    if (next.page_index !== current.page_index) {
      void sendAction({ type: 'set_item_page', page_index: next.page_index });
    } else if (next.hardware_item_id && !current.hardware_item_id) {
      void sendAction({
        type: 'open_hardware_quantity',
        item_id: next.hardware_item_id,
      });
    } else if (!next.hardware_item_id && current.hardware_item_id) {
      void sendAction({ type: 'close_hardware_quantity' });
    } else if (next.hardware_quantity !== current.hardware_quantity) {
      void sendAction({
        type: 'set_hardware_dialog_quantity',
        quantity: next.hardware_quantity,
      });
    }
  }

  function removeLine(line: YardKioskBasketLine) {
    void sendAction({
      type: 'remove_line',
      kind: line.kind,
      item_id: line.item_id,
    });
  }

  const guidance = state ? getYardKioskGuidance(state) : null;
  const workflowBackLabel = state?.phase === 'location'
    ? 'Back to direction selection'
    : state?.phase === 'items'
      ? 'Back to location selection'
      : null;
  const workflowForwardLabel = state?.phase === 'items'
    ? 'Confirm transfer and continue'
    : state?.phase === 'receipt'
      ? 'Start new transfer'
      : null;

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <div className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-slate-900/70 p-3 shadow-xl sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-words text-xl font-black text-white sm:text-2xl">Yard kiosk live control</h1>
            <Badge
              variant="outline"
              className={
                isTabletOnline
                  ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-amber-400/40 bg-amber-500/10 text-amber-200'
              }
            >
              <Radio className="mr-1.5 h-3.5 w-3.5" />
              {device?.presence || 'No device'}
            </Badge>
            {holdsControl ? (
              <Badge className="bg-cyan-300 text-slate-950">
                <LockKeyhole className="mr-1.5 h-3.5 w-3.5" />
                {tabletAcknowledgedLease ? 'You have control' : 'Connecting to tablet'}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 break-words text-sm text-slate-400">
            {device
              ? `${device.device_label} · state-synchronised replica`
              : 'No active Yard kiosk is linked.'}
          </p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:flex-wrap">
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadState()}
            disabled={loading || saving}
            className="min-h-11 min-w-0"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {holdsControl ? (
            <Button
              type="button"
              onClick={() => void runOperation('release')}
              disabled={saving}
              className="min-h-11 min-w-0 bg-slate-200 px-2 text-slate-950 hover:bg-white sm:px-4"
            >
              <Unlock className="mr-2 h-4 w-4" />
              Release control
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void runOperation('take')}
              disabled={saving || !device || !isTabletOnline || leaseIsActive}
              className="min-h-11 min-w-0 whitespace-normal bg-cyan-300 px-2 text-slate-950 hover:bg-cyan-200 sm:px-4"
            >
              <MonitorSmartphone className="mr-2 h-4 w-4" />
              {leaseIsActive ? 'Controlled by another manager' : 'Take control'}
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-500/35 bg-red-500/10 p-3 text-sm text-red-100"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <p className="text-xs text-slate-400 lg:hidden">
        Swipe or scroll horizontally to inspect the fixed 1024 × 600 kiosk replica.
      </p>

      <div
        className="w-full max-w-full touch-pan-x overflow-x-auto overscroll-x-contain rounded-2xl border border-white/10 bg-slate-950 p-2 shadow-2xl sm:p-3"
        role="region"
        aria-label="Scrollable Yard kiosk replica"
        tabIndex={0}
      >
        <div
          data-testid="yard-kiosk-virtual-screen"
          className="mx-auto grid h-[600px] w-[1024px] shrink-0 grid-rows-[4.75rem_1fr] overflow-hidden rounded-xl bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.12),_transparent_32%),linear-gradient(135deg,#020617_0%,#0f172a_52%,#111827_100%)] text-white"
        >
          {!device || !snapshot || !state ? (
            <div className="col-span-full row-span-full grid place-items-center p-8 text-center">
              <div>
                {device?.presence === 'offline'
                  ? <WifiOff className="mx-auto h-14 w-14 text-amber-300" />
                  : <MonitorSmartphone className="mx-auto h-14 w-14 text-slate-500" />}
                <h2 className="mt-4 text-2xl font-black">
                  {!device
                    ? 'No linked Yard kiosk'
                    : 'Waiting for the tablet screen'}
                </h2>
                <p className="mt-2 text-slate-400">
                  Open Yard Inventory on the linked tablet to publish its live state.
                </p>
              </div>
            </div>
          ) : (
            <>
              <header className="grid grid-cols-[3.5rem_19rem_minmax(0,1fr)_15rem_3.5rem] items-center gap-3 border-b border-white/10 bg-slate-950/75 px-3">
                <div className="grid h-14 w-14 place-items-center">
                  {workflowBackLabel ? (
                    <button
                      type="button"
                      aria-label={workflowBackLabel}
                      disabled={!canControl}
                      onClick={() => void sendAction({ type: 'back' })}
                      className="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/5 disabled:opacity-30"
                    >
                      <ArrowLeft className="h-7 w-7" />
                    </button>
                  ) : null}
                </div>
                <div>
                  <h2 className="text-2xl font-black">Yard Inventory</h2>
                  <p className="text-sm font-medium text-slate-400">
                    {guidance?.stepLabel}
                  </p>
                </div>
                <div className="flex justify-center">
                  {!holdsControl ? (
                    <span className="rounded-full border border-white/10 bg-slate-950/80 px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-300">
                      Read-only mirror
                    </span>
                  ) : null}
                </div>
                <div className="justify-self-end rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-300">
                  {snapshot.bootstrap.yard.name}
                </div>
                <div className="grid h-14 w-14 place-items-center">
                  {workflowForwardLabel ? (
                    <button
                      type="button"
                      aria-label={workflowForwardLabel}
                      disabled={
                        !canControl
                        || (state.phase === 'items' && state.basket.length === 0)
                      }
                      onClick={() => void sendAction({ type: 'forward' })}
                      className="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/5 disabled:opacity-30"
                    >
                      <ArrowRight className="h-7 w-7" />
                    </button>
                  ) : null}
                </div>
              </header>

              <div className={`relative min-h-0 overflow-hidden ${canControl ? '' : 'pointer-events-none'}`}>
                {state.phase === 'mode' ? (
                  <YardKioskModeSelect
                    yardName={snapshot.bootstrap.yard.name}
                    onSelect={(direction) => {
                      void sendAction({ type: 'select_direction', direction });
                    }}
                  />
                ) : null}

                {state.phase === 'location' && state.direction ? (
                  <YardKioskLocationPager
                    direction={state.direction}
                    locations={snapshot.locations}
                    uiState={snapshot.location_ui}
                    onUiStateChange={sendLocationUiChange}
                    onSelect={(location) => {
                      void sendAction({
                        type: 'select_location',
                        location_id: location.id,
                      });
                    }}
                    onIncludeLegacyQuotesChange={async () => undefined}
                    persistPreferences={false}
                  />
                ) : null}

                {(state.phase === 'items' || state.phase === 'submitting')
                  && state.direction
                  && state.counterpart ? (
                  <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_21rem] gap-4 overflow-hidden p-4">
                    <div className="min-h-0 min-w-0 overflow-hidden">
                      <YardKioskItemPicker
                        categories={snapshot.bootstrap.categories}
                        items={state.stock}
                        basket={state.basket}
                        searchQuery={state.searchQuery}
                        activeCategory={state.category}
                        loading={state.loadingStock}
                        uiState={snapshot.item_ui}
                        onUiStateChange={sendItemUiChange}
                        onSearchChange={(query) => {
                          void sendAction({ type: 'set_item_search', query });
                        }}
                        onCategoryChange={(category) => {
                          void sendAction({ type: 'set_item_category', category });
                        }}
                        onAddSerialized={(item) => {
                          void sendAction({ type: 'add_serialized', item_id: item.id });
                        }}
                        onSetHardwareQuantity={(item, quantity) => {
                          void sendAction({
                            type: 'set_hardware_quantity',
                            item_id: item.id,
                            quantity,
                          });
                        }}
                      />
                    </div>
                    <div className="min-h-0 min-w-0 overflow-hidden">
                      <YardKioskBasket
                        direction={state.direction}
                        counterpart={state.counterpart}
                        basket={state.basket}
                        offline={!isTabletOnline || snapshot.offline}
                        submitting={state.phase === 'submitting'}
                        onRemove={removeLine}
                        onClear={() => void sendAction({ type: 'clear_basket' })}
                        onSubmit={() => void sendAction({ type: 'forward' })}
                      />
                    </div>
                  </div>
                ) : null}

                {state.phase === 'receipt'
                  && state.direction
                  && state.counterpart
                  && state.receipt ? (
                  <YardKioskReceipt
                    direction={state.direction}
                    counterpart={state.counterpart}
                    receipt={state.receipt}
                    onReset={() => void sendAction({ type: 'reset' })}
                    autoReset={false}
                  />
                ) : null}

                {state.error ? (
                  <div className="absolute bottom-5 left-1/2 z-30 w-[min(44rem,calc(100%-3rem))] -translate-x-1/2 rounded-2xl border border-red-300/30 bg-red-950/95 p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="mt-0.5 h-6 w-6 text-red-300" />
                      <p className="min-w-0 flex-1 font-black text-red-50">
                        {state.userError?.title || state.error}
                      </p>
                      <button
                        type="button"
                        aria-label="Dismiss error"
                        onClick={() => void sendAction({ type: 'dismiss_error' })}
                        className="rounded-xl bg-white/10 px-3 py-2 text-sm font-bold"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ) : null}

                {!canControl ? (
                  <div className="absolute inset-0 z-50 grid place-items-center bg-slate-950/5">
                    <span className="rounded-full border border-white/15 bg-slate-950/95 px-5 py-3 text-sm font-black text-slate-200 shadow-xl">
                      {isTabletOnline
                        ? holdsControl
                          ? 'Waiting for the tablet to lock local input'
                          : 'Take control to operate the physical tablet'
                        : 'Tablet is offline — mirror is read-only'}
                    </span>
                  </div>
                ) : null}

                {state.phase === 'submitting' ? (
                  <div className="absolute inset-0 z-40 grid place-items-center bg-slate-950/70">
                    <RefreshCw className="h-12 w-12 animate-spin text-amber-300" />
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        Inventory transfers are never submitted by this manager page. Actions are queued
        to the authenticated physical tablet, which validates current stock and performs
        the transfer. Control unlocks automatically if this page disconnects.
      </p>
    </div>
  );
}
