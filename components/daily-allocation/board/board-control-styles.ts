export const boardControlStyles = {
  primary:
    'border border-[hsl(var(--daily-allocation-primary))] bg-[hsl(var(--daily-allocation-primary))] text-white shadow-sm hover:border-[hsl(var(--daily-allocation-dark))] hover:bg-[hsl(var(--daily-allocation-dark))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--daily-allocation-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617] disabled:border-[#64748b] disabled:bg-[#334155] disabled:text-[#cbd5e1] disabled:opacity-100',
  outline:
    'border border-[#64748b] bg-[#0f172a] text-[#f1f5f9] shadow-sm hover:border-[#cbd5e1] hover:bg-[#334155] hover:text-[#ffffff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--daily-allocation-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617] disabled:border-[#475569] disabled:bg-[#1e293b] disabled:text-[#94a3b8] disabled:opacity-100',
  ghost:
    'border border-transparent bg-transparent text-[#e2e8f0] hover:border-[#475569] hover:bg-[#334155] hover:text-[#ffffff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--daily-allocation-primary))] focus-visible:ring-offset-1 focus-visible:ring-offset-[#020617] disabled:border-transparent disabled:bg-transparent disabled:text-[#64748b] disabled:opacity-100',
  danger:
    'border border-[#dc2626] bg-[#b91c1c] text-[#ffffff] shadow-sm hover:border-[#ef4444] hover:bg-[#dc2626] hover:text-[#ffffff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f87171] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617] disabled:border-[#7f1d1d] disabled:bg-[#450a0a] disabled:text-[#fca5a5] disabled:opacity-100',
  warning:
    'border border-[#fcd34d] bg-[#fbbf24] text-[#451a03] shadow-sm hover:border-[#fde68a] hover:bg-[#fcd34d] hover:text-[#451a03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fcd34d] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617] disabled:border-[#92400e] disabled:bg-[#78350f] disabled:text-[#fde68a] disabled:opacity-100',
  resourceJob:
    'border border-sky-700/60 bg-sky-950/35 text-sky-50 shadow-sm hover:border-sky-500/70 hover:bg-sky-900/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617]',
  resourceEmployee:
    'border border-teal-700/60 bg-teal-950/35 text-teal-50 shadow-sm hover:border-teal-500/70 hover:bg-teal-900/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617]',
  resourcePlant:
    'border border-amber-700/60 bg-amber-950/30 text-amber-50 shadow-sm hover:border-amber-500/70 hover:bg-amber-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617]',
} as const;

export const RESOURCE_GUIDANCE_CLASS =
  'rounded-md border border-dashed border-slate-700 bg-slate-950/40 p-2 text-xs leading-relaxed text-slate-300';
