import { z } from 'zod';
import effortPolicy from '../config/fixerrors-effort-policy.json';

export const TRIAGE_POLICY_VERSION = 'proportionate-v1';
export const diagnosticSchema = z.object({
  classes: z.array(z.enum([
    'unknown', 'validation', 'network', 'authentication', 'runtime',
    'security-compromise', 'data-corruption', 'service-outage', 'financial-loss',
  ])).min(1).max(9),
  operation: z.enum(['unknown', 'usage-analytics', 'notification-count', 'timesheet-submit', 'quotes']),
  stage: z.enum(['origin-check', 'authentication', 'record-usage', 'validation', 'submit']).optional(),
  databaseCode: z.string().regex(/^(?:[A-Z0-9]{5}|PGRST[0-9]{3})$/u).optional(),
  recentAction: z.object({
    kind: z.enum(['click', 'submit']), label: z.string().min(1).max(64),
  }).strict().optional(),
  visibleMessage: z.string().min(1).max(160).optional(),
  noncriticalHandled: z.boolean(),
  continuingFailure: z.boolean().optional(),
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
    ['security-compromise', 'data-corruption', 'service-outage', 'financial-loss'].includes(value))) {
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
  short: 'One short evidence pass and relevant checks. Resolve reviewed expected or unreproducible incidents with an explicit reason. A useful tested diagnostic improvement may resolve the incident after deployment, even when its original cause remains unknown.',
  focused: 'Investigate source and relevant regressions. Lower-impact incidents may resolve as mitigated, diagnostics improved, expected behaviour or reviewed unable to reproduce. Record what was checked and what remains unknown. Keep concrete continuing failures and recurrence after diagnostic closure outstanding.',
  strong: 'Verify the reported serious impact, prioritize relevant regression and safety checks, and retain the existing explicit approvals.',
} satisfies Record<IncidentTriage['effort'], string>;

export const DEPLOYMENT_VERIFICATION_STEP =
  'Verify the original candidate, its receipts and deployment evidence; if missing or stale, enrich evidence. Deploy requires separate exact-candidate approval and relevant live verification.';

// A requested reason is not deployment evidence or authority to close an incident.
export const resolutionSchema = z.object({
  reason: z.enum(['fixed', 'mitigated', 'diagnostics_improved', 'expected_behaviour', 'reviewed_unable_to_reproduce']),
  summary: z.string().trim().min(12).max(2000),
  changeCommit: z.string().regex(/^[a-f0-9]{40}$/u).optional(),
}).strict();
export type IncidentResolution = z.infer<typeof resolutionSchema>;
export const needsDeployedImprovement = (resolution?: IncidentResolution): boolean =>
  resolution?.reason === 'diagnostics_improved' || resolution?.reason === 'mitigated';

export function proportionateClosureBlocker(input: {
  diagnostics?: IncidentDiagnostics; advisoryLane?: string; lane?: string;
  recurrenceAfterResolution?: boolean;
}): string | null {
  const triage = classifyIncident(input.diagnostics);
  // Advisory repair lanes also flag ordinary Forbidden/validation messages.
  // They still constrain edits, but do not by themselves establish serious impact.
  if (triage.importance === 'Urgent' || input.lane === 'critical') {
    return 'Serious impact or critical work requires relevant verification before resolution.';
  }
  // Historical repetition increases investigation effort. It does not prove
  // continuing impact after a new tested improvement has been deployed.
  if (input.diagnostics?.continuingFailure || input.recurrenceAfterResolution) {
    return 'Continuing or recurring failure requires fresh investigation; the previous diagnostic improvement is not a resolution.';
  }
  return null;
}
