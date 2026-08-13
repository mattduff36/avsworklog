export const boardControlStyles = {
  primary:
    'border border-[hsl(var(--daily-allocation-primary))] bg-[hsl(var(--daily-allocation-primary))] text-white shadow-sm hover:border-[hsl(var(--daily-allocation-dark))] hover:bg-[hsl(var(--daily-allocation-dark))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--daily-allocation-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:border-slate-600 disabled:bg-slate-700 disabled:text-slate-300 disabled:opacity-100',
  outline:
    'border border-slate-500 bg-slate-900 text-slate-100 shadow-sm hover:border-slate-300 hover:bg-slate-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--daily-allocation-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:border-slate-600 disabled:bg-slate-800 disabled:text-slate-400 disabled:opacity-100',
  ghost:
    'border border-transparent bg-transparent text-slate-200 hover:border-slate-600 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--daily-allocation-primary))] focus-visible:ring-offset-1 focus-visible:ring-offset-slate-950 disabled:text-slate-500 disabled:opacity-100',
  danger:
    'border border-red-600 bg-red-700 text-white shadow-sm hover:border-red-500 hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:border-red-950 disabled:bg-red-950 disabled:text-red-300 disabled:opacity-100',
  warning:
    'border border-amber-400 bg-amber-400 text-amber-950 shadow-sm hover:border-amber-300 hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
  resourceJob:
    'border border-sky-700/60 bg-sky-950/35 text-sky-50 shadow-sm hover:border-sky-500/70 hover:bg-sky-900/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
  resourceEmployee:
    'border border-teal-700/60 bg-teal-950/35 text-teal-50 shadow-sm hover:border-teal-500/70 hover:bg-teal-900/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
  resourcePlant:
    'border border-amber-700/60 bg-amber-950/30 text-amber-50 shadow-sm hover:border-amber-500/70 hover:bg-amber-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
} as const;
