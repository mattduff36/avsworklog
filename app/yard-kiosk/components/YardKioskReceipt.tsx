'use client';

import { useEffect, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import type {
  YardKioskDirection,
  YardKioskLocation,
  YardKioskReceipt as YardKioskReceiptData,
} from '@/lib/inventory/kiosk-types';

const RESET_SECONDS = 8;

interface YardKioskReceiptProps {
  direction: YardKioskDirection;
  counterpart: YardKioskLocation;
  receipt: YardKioskReceiptData;
  onReset: () => void;
}

export function YardKioskReceipt({
  direction,
  counterpart,
  receipt,
  onReset,
}: YardKioskReceiptProps) {
  const [seconds, setSeconds] = useState(RESET_SECONDS);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          onReset();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [onReset]);

  return (
    <section className="grid h-full place-items-center p-6" aria-live="polite">
      <div className="w-full max-w-3xl rounded-[2.25rem] border border-emerald-300/30 bg-gradient-to-br from-emerald-300/20 via-emerald-400/10 to-slate-950 p-8 text-center shadow-2xl shadow-black/30">
        <span className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-emerald-300 text-slate-950 shadow-xl shadow-emerald-400/20">
          <Check className="h-14 w-14" strokeWidth={3} />
        </span>
        <h2 className="mt-5 text-5xl font-black tracking-tight text-white">Transfer complete</h2>
        <p className="mt-2 text-xl text-emerald-100/80">
          {direction === 'take' ? 'Stock moved from Yard to ' : 'Stock returned to Yard from '}
          <strong className="text-white">{counterpart.name}</strong>
        </p>

        <div className="mx-auto mt-6 grid max-w-xl grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-3xl font-black text-white">{receipt.serialized_count}</div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
              Serialized items
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-3xl font-black text-white">{receipt.hardware_line_count}</div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
              Hardware lines
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onReset}
          className="mx-auto mt-6 flex h-14 items-center justify-center gap-3 rounded-2xl bg-white px-8 text-lg font-black text-slate-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200"
        >
          <RotateCcw className="h-6 w-6" />
          New transfer
        </button>
        <p className="mt-3 text-sm font-medium text-slate-400">
          Resetting automatically in {seconds} second{seconds === 1 ? '' : 's'}
        </p>
      </div>
    </section>
  );
}
