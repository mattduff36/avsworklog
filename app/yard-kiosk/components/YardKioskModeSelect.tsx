'use client';

import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import type { YardKioskDirection } from '@/lib/inventory/kiosk-types';

interface YardKioskModeSelectProps {
  yardName: string;
  onSelect: (direction: YardKioskDirection) => void;
}

export function YardKioskModeSelect({ yardName, onSelect }: YardKioskModeSelectProps) {
  return (
    <section className="grid h-full grid-cols-2 gap-6 p-6" aria-labelledby="yard-kiosk-mode-title">
      <h2 id="yard-kiosk-mode-title" className="sr-only">Choose a transfer direction</h2>
      <button
        type="button"
        onClick={() => onSelect('take')}
        className="group flex min-h-64 flex-col items-start justify-between rounded-[2rem] border border-amber-300/35 bg-gradient-to-br from-amber-300/25 via-amber-400/10 to-slate-900 p-8 text-left shadow-2xl shadow-black/20 transition hover:border-amber-200 hover:from-amber-300/35 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300"
      >
        <span className="grid h-20 w-20 place-items-center rounded-3xl bg-amber-300 text-slate-950 shadow-lg shadow-amber-400/20">
          <ArrowUpFromLine className="h-11 w-11" aria-hidden />
        </span>
        <span>
          <span className="block text-5xl font-black tracking-tight text-white">Collect</span>
          <span className="mt-2 block text-xl font-medium text-amber-100/80">
            Move stock from {yardName}
          </span>
        </span>
        <span className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-amber-100">
          Start a collection
        </span>
      </button>

      <button
        type="button"
        onClick={() => onSelect('return')}
        className="group flex min-h-64 flex-col items-start justify-between rounded-[2rem] border border-cyan-300/35 bg-gradient-to-br from-cyan-300/20 via-cyan-400/10 to-slate-900 p-8 text-left shadow-2xl shadow-black/20 transition hover:border-cyan-200 hover:from-cyan-300/30 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300"
      >
        <span className="grid h-20 w-20 place-items-center rounded-3xl bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-400/20">
          <ArrowDownToLine className="h-11 w-11" aria-hidden />
        </span>
        <span>
          <span className="block text-5xl font-black tracking-tight text-white">Return</span>
          <span className="mt-2 block text-xl font-medium text-cyan-100/80">
            Bring stock back to {yardName}
          </span>
        </span>
        <span className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-cyan-100">
          Start a return
        </span>
      </button>
    </section>
  );
}
