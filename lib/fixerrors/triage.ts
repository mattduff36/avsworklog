import { z } from 'zod';
import effortPolicy from '../config/fixerrors-effort-policy.json';

export const TRIAGE_POLICY_VERSION = 'proportionate-v1';
export const diagnosticSchema = z.object({
  classes: z.array(z.enum([
    'unknown', 'validation', 'network', 'authentication', 'runtime',
    'security-compromise', 'data-corruption', 'service-outage',
  ])).min(1).max(8),
  operation: z.enum(['unknown', 'usage-analytics', 'notification-count', 'timesheet-submit', 'quotes']),
  stage: z.enum(['origin-check', 'authentication', 'record-usage', 'validation', 'submit']).optional(),
  databaseCode: z.string().regex(/^(?:[A-Z0-9]{5}|PGRST[0-9]{3})$/u).optional(),
  recentAction: z.object({
    kind: z.enum(['click', 'submit']), label: z.string().min(1).max(64),
  }).strict().optional(),
  visibleMessage: z.string().min(1).max(160).optional(),
  noncriticalHandled: z.boolean(),
  occurrences: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  firstDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  lastDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  frames: z.array(z.object({
    file: z.string().regex(/^(?:app|components|lib|hooks|utils|services)\/[A-Za-z0-9_()/.[\]-]+\.[jt]sx?$/u)
      .refine(value => !value.split('/').some(part => part.startsWith('.'))),
    line: z.number().int().positive().max(1_000_000).optional(),
  }).strict()).max(12),
}).strict();
export type IncidentDiagnostics = z.infer<typeof diagnosticSchema>;
export const triageSchema = z.object({
  policyVersion: z.literal(TRIAGE_POLICY_VERSION),
  importance: z.enum(['Routine', 'Important', 'Urgent']),
  reason: z.enum(['serious-impact-signal', 'repeated-failure', 'handled-noncritical', 'impact-uncertain']),
  effort: z.enum(['short', 'focused', 'strong']),
}).strict();
export type IncidentTriage = z.infer<typeof triageSchema>;
export function executionBudget(triage: IncidentTriage) {
  return effortPolicy[triage.importance];
}
export const timingsSchema = z.object({
  analysisMs: z.number().int().nonnegative(),
  repairAndChecksMs: z.number().int().nonnegative(),
  totalMs: z.number().int().nonnegative(),
}).strict();

export function classifyIncident(diagnostics?: IncidentDiagnostics): IncidentTriage {
  const result = (importance: IncidentTriage['importance'], reason: IncidentTriage['reason'],
    effort: IncidentTriage['effort']): IncidentTriage => ({ policyVersion: TRIAGE_POLICY_VERSION, importance, reason, effort });
  if (diagnostics?.classes.some(value =>
    ['security-compromise', 'data-corruption', 'service-outage'].includes(value))) {
    return result('Urgent', 'serious-impact-signal', 'strong');
  }
  if (diagnostics && diagnostics.occurrences >= 10) return result('Important', 'repeated-failure', 'focused');
  if (diagnostics?.noncriticalHandled && diagnostics.operation === 'usage-analytics' &&
      diagnostics.stage === 'record-usage' &&
      diagnostics.classes.every(value => value === 'network')) {
    return result('Routine', 'handled-noncritical', 'short');
  }
  return result('Important', 'impact-uncertain', 'focused');
}

export const TRIAGE_GUIDANCE = {
  short: 'One short evidence pass; at most one bounded repair if a defect is evidenced, with relevant checks. Expected behavior is report-only; uncertainty is held, never silently archived.',
  focused: 'Focused source and regression investigation; request exact missing diagnostics when impact or cause is uncertain.',
  strong: 'Verify the reported serious impact, prioritize relevant regression and safety checks, and retain the existing explicit approvals.',
} satisfies Record<IncidentTriage['effort'], string>;

export const DEPLOYMENT_VERIFICATION_STEP =
  'Verify the original candidate, its receipts and deployment evidence; if missing or stale, enrich evidence. Deploy requires separate exact-candidate approval and relevant live verification.';
