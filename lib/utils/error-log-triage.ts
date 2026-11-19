export type ErrorLogTone = 'red' | 'orange' | 'neutral';

const RESOLUTION_LABELS: Record<string, string> = {
  fixed: 'Fixed',
  mitigated: 'Mitigated',
  diagnostics_improved: 'Diagnostics improved',
  expected_behaviour: 'Expected behaviour',
  reviewed_unable_to_reproduce: 'Reviewed unable to reproduce',
};

const LEGACY_RESOLUTION_LABELS: Record<string, string> = {
  expected_behavior: 'Expected behaviour',
  insufficient_evidence: 'Reviewed unable to reproduce',
  evidence_gap_expired: 'Reviewed unable to reproduce',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function reasonLabel(value: unknown, labels: Record<string, string>): string | undefined {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(labels, value)
    ? labels[value] : undefined;
}

export function getErrorLogStatusLabel(log: {
  status?: string | null;
  triage_state?: string | null;
  additional_data?: unknown;
}): string | null {
  const lifecycle = asRecord(asRecord(log.additional_data)?.fixerrorsLifecycle);
  if (log.status !== 'archived') {
    if (log.triage_state !== 'outstanding') return null;
    if (lifecycle?.state === 'awaiting-deployment') return asRecord(lifecycle.deployment)
      ? 'Deployed — awaiting review' : 'Awaiting deployment';
    if (lifecycle?.state === 'awaiting-evidence') return 'Awaiting evidence';
    return 'Needs attention';
  }
  if (log.triage_state === 'fixed_live') return 'Resolved — Fixed';
  if (log.triage_state !== 'no_fix_required') return 'Archived';
  const resolution = asRecord(lifecycle?.resolution);
  const reason = reasonLabel(resolution?.reason, RESOLUTION_LABELS)
    ?? reasonLabel(lifecycle?.closureReason, LEGACY_RESOLUTION_LABELS);
  return reason ? `Resolved — ${reason}` : 'Resolved';
}

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
