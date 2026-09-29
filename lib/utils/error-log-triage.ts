export type ErrorLogTone = 'red' | 'orange' | 'neutral';

export function getErrorLogTone(log: {
  status?: string | null;
  triage_state?: string | null;
}): ErrorLogTone {
  if (log.status === 'archived') return 'neutral';
  if (log.triage_state === 'outstanding') return 'orange';
  return 'red';
}

export function errorLogCardClass(tone: ErrorLogTone): string {
  if (tone === 'orange') {
    return 'overflow-hidden rounded-lg border border-orange-500/40 bg-orange-500/10 transition-colors hover:border-orange-400';
  }
  if (tone === 'neutral') {
    return 'overflow-hidden rounded-lg border border-slate-700/70 bg-slate-950/30 transition-colors hover:border-slate-500';
  }
  return 'overflow-hidden rounded-lg border border-red-500/30 bg-red-500/5 transition-colors hover:border-red-500/60';
}

export function errorLogMessageClass(tone: ErrorLogTone): string {
  if (tone === 'orange') return 'mb-2 font-semibold text-orange-700 dark:text-orange-300';
  if (tone === 'neutral') return 'mb-2 font-semibold text-slate-200';
  return 'mb-2 font-semibold text-red-700 dark:text-red-400';
}
