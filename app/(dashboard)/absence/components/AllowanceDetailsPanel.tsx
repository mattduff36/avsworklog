import type { AbsenceSummary } from '@/types/absence';

interface AllowanceDetailsPanelProps {
  summary?: AbsenceSummary | null;
  loading?: boolean;
  empty?: boolean;
}

const PANEL_CLASS_NAME =
  'rounded-lg border border-[hsl(var(--absence-primary)/0.25)] bg-[hsl(var(--absence-primary)/0.06)] p-2.5';

function LoadingPlaceholder() {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="space-y-1.5">
          <div className="h-3 w-20 animate-pulse rounded bg-slate-700/60" />
          <div className="h-7 w-20 animate-pulse rounded bg-slate-700/80" />
        </div>
      ))}
    </div>
  );
}

export function AllowanceDetailsPanel({
  summary,
  loading = false,
  empty = false,
}: AllowanceDetailsPanelProps) {
  if (empty) {
    return (
      <div className={PANEL_CLASS_NAME}>
        <div className="min-h-[44px]" aria-hidden="true" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className={PANEL_CLASS_NAME}>
        <LoadingPlaceholder />
      </div>
    );
  }

  const allowance = summary?.allowance ?? 0;
  const approvedTaken = summary?.approved_taken ?? 0;
  const pending = summary?.pending_total ?? 0;
  const remaining = summary?.remaining ?? allowance - approvedTaken - pending;

  const stats = [
    { label: 'Allowance', value: allowance },
    { label: 'Approved Taken', value: approvedTaken },
    { label: 'Pending', value: pending },
    { label: 'Remaining', value: remaining, highlight: remaining < 0 ? 'text-red-400' : 'text-foreground' },
  ];

  return (
    <div className={PANEL_CLASS_NAME}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="space-y-0.5">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400/90">
              {stat.label}
            </p>
            <div className="flex items-baseline gap-1.5">
              <p className={`text-2xl font-semibold leading-none ${stat.highlight || 'text-foreground'}`}>
                {stat.value}
              </p>
              <p className="text-xs text-slate-400/80">days</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
