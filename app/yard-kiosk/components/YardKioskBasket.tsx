'use client';

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  PackageCheck,
  Trash2,
  Wrench,
} from 'lucide-react';
import type {
  YardKioskBasketLine,
  YardKioskDirection,
  YardKioskLocation,
} from '@/lib/inventory/kiosk-types';
import { getBasketSummary } from '../yard-kiosk-state';

interface YardKioskBasketProps {
  direction: YardKioskDirection;
  counterpart: YardKioskLocation;
  basket: YardKioskBasketLine[];
  offline: boolean;
  submitting: boolean;
  onRemove: (line: YardKioskBasketLine) => void;
  onClear: () => void;
  onSubmit: () => void;
}

export function YardKioskBasket({
  direction,
  counterpart,
  basket,
  offline,
  submitting,
  onRemove,
  onClear,
  onSubmit,
}: YardKioskBasketProps) {
  const summary = getBasketSummary(basket);
  const DirectionIcon = direction === 'take' ? ArrowUpFromLine : ArrowDownToLine;

  return (
    <aside className="grid h-full min-h-0 grid-rows-[auto_auto_1fr_auto] overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/80 shadow-2xl shadow-black/25">
      <div className="border-b border-white/10 p-4">
        <div className="flex items-start gap-3">
          <span className={`grid h-12 w-12 flex-none place-items-center rounded-2xl ${
            direction === 'take' ? 'bg-amber-300 text-slate-950' : 'bg-cyan-300 text-slate-950'
          }`}>
            <DirectionIcon className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
              {direction === 'take' ? 'Taking to' : 'Returning from'}
            </p>
            <h2 className="truncate text-xl font-black text-white">{counterpart.name}</h2>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 border-b border-white/10 p-3 text-center">
        <div className="rounded-xl bg-white/[0.05] p-2">
          <div className="text-xl font-black text-white">{summary.serialized}</div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Items</div>
        </div>
        <div className="rounded-xl bg-white/[0.05] p-2">
          <div className="text-xl font-black text-white">{summary.hardwareLines}</div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Hardware</div>
        </div>
        <div className="rounded-xl bg-white/[0.05] p-2">
          <div className="text-xl font-black text-white">{summary.hardwareUnits}</div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Units</div>
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto p-3">
        {basket.length === 0 ? (
          <div className="grid h-full min-h-40 place-items-center text-center">
            <div>
              <PackageCheck className="mx-auto h-10 w-10 text-slate-600" />
              <p className="mt-2 font-bold text-slate-300">Basket is empty</p>
              <p className="mt-1 text-xs text-slate-500">Tap stock to add it.</p>
            </div>
          </div>
        ) : (
          <ul className="space-y-2" aria-label="Transfer basket">
            {basket.map((line) => (
              <li
                key={`${line.kind}-${line.item_id}`}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] p-3"
              >
                {line.kind === 'hardware'
                  ? <Boxes className="h-5 w-5 flex-none text-cyan-300" />
                  : <Wrench className="h-5 w-5 flex-none text-amber-300" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-white">{line.name}</div>
                  <div className="text-xs text-slate-400">
                    {line.kind === 'hardware' ? `Quantity ${line.quantity}` : line.item_number}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${line.name}`}
                  onClick={() => onRemove(line)}
                  className="grid h-10 w-10 flex-none place-items-center rounded-xl text-slate-400 hover:bg-red-500/15 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t border-white/10 p-3">
        {offline ? (
          <p className="rounded-xl bg-red-500/15 px-3 py-2 text-center text-xs font-bold text-red-100" role="status">
            Offline — reconnect before submitting
          </p>
        ) : null}
        <button
          type="button"
          onClick={onSubmit}
          disabled={basket.length === 0 || offline || submitting}
          className="h-14 w-full rounded-2xl bg-amber-300 text-lg font-black text-slate-950 shadow-lg shadow-amber-400/10 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-200"
        >
          {submitting ? 'Moving stock…' : 'Confirm transfer'}
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={basket.length === 0 || submitting}
          className="h-10 w-full rounded-xl text-sm font-bold text-slate-400 hover:bg-white/5 hover:text-white disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          Clear basket
        </button>
      </div>
    </aside>
  );
}
