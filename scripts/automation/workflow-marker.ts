import type {
  WorkflowCommitStatus,
  WorkflowCompletionMarker,
  WorkflowEvidenceState,
  WorkflowFinalReviewStatus,
  WorkflowGateDecision,
  WorkflowHandoffStatus,
  WorkflowParentTier,
  WorkflowRequiredTest,
  WorkflowRisk,
  WorkflowReviewSource,
  WorkflowRoutingDecision,
  WorkflowTaskType,
  WorkflowUnresolvedRisk,
} from './types';
import { isWorkflowRoutingDecisionCoherent } from './workflow-model-tier';

export const WORKFLOW_MARKER_PREFIX_V1 = '<!-- workflow-completion-marker:v1';
export const WORKFLOW_MARKER_PREFIX_V2 = '<!-- workflow-completion-marker:v2';
export const WORKFLOW_MARKER_PREFIX = WORKFLOW_MARKER_PREFIX_V2;
export const WORKFLOW_MARKER_SUFFIX = '-->';

const TASK_TYPES = new Set<WorkflowTaskType>(['change', 'planning', 'review']);
const RISKS = new Set<WorkflowRisk>(['high', 'routine']);
const GATE_DECISIONS = new Set<WorkflowGateDecision>([
  'approved',
  'approved_with_conditions',
  'blocked',
  'skipped',
  'not_applicable',
  'unknown',
]);
const EVIDENCE_STATES = new Set<WorkflowEvidenceState>(['passed', 'failed', 'unknown']);
const FINAL_REVIEW_STATES = new Set<WorkflowFinalReviewStatus>([
  'passed',
  'failed',
  'skipped',
  'not_applicable',
  'unknown',
]);
const COMMIT_STATES = new Set<WorkflowCommitStatus>(['completed', 'not_applicable', 'pending', 'unknown']);
const HANDOFF_STATES = new Set<WorkflowHandoffStatus>(['completed', 'pending', 'unknown']);
const PARENT_TIERS = new Set<WorkflowParentTier>(['premium', 'economical', 'unknown']);
const ROUTING_DECISIONS = new Set<WorkflowRoutingDecision>([
  'switched_to_economical',
  'continued_premium',
  'economical_default',
  'explicit_premium',
  'not_applicable',
  'unknown',
]);
const REVIEW_SOURCES = new Set<WorkflowReviewSource>([
  'independent_subagent',
  'parent_structured',
  'local',
  'not_applicable',
  'unknown',
]);

export interface ParsedWorkflowMarker {
  status: 'present' | 'missing' | 'malformed';
  marker: WorkflowCompletionMarker | null;
  errors: string[];
  raw?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseRequiredTests(value: unknown): { tests: WorkflowRequiredTest[]; errors: string[] } {
  if (!Array.isArray(value)) return { tests: [], errors: ['requiredTests must be an array'] };
  const tests: WorkflowRequiredTest[] = [];
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!isObject(entry)) {
      errors.push(`requiredTests[${index}] must be an object`);
      continue;
    }
    const id = asString(entry.id);
    const status = asString(entry.status);
    if (!id || (status !== 'completed' && status !== 'unresolved')) {
      errors.push(`requiredTests[${index}] requires id and status completed|unresolved`);
      continue;
    }
    if (ids.has(id)) {
      errors.push(`requiredTests[${index}] duplicates id ${id}`);
      continue;
    }
    ids.add(id);
    tests.push({
      id,
      status,
      note: asString(entry.note) ?? undefined,
    });
  }
  return { tests, errors };
}

function parseUnresolvedRisks(value: unknown): { risks: WorkflowUnresolvedRisk[]; errors: string[] } {
  if (value === undefined) return { risks: [], errors: [] };
  if (!Array.isArray(value)) return { risks: [], errors: ['unresolvedRisks must be an array'] };
  const risks: WorkflowUnresolvedRisk[] = [];
  const errors: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isObject(entry)) {
      errors.push(`unresolvedRisks[${index}] must be an object`);
      continue;
    }
    const id = asString(entry.id);
    const note = asString(entry.note);
    if (!id || !note) {
      errors.push(`unresolvedRisks[${index}] requires id and note`);
      continue;
    }
    risks.push({ id, note });
  }
  return { risks, errors };
}

export function validateWorkflowCompletionMarker(value: unknown): ParsedWorkflowMarker {
  if (!isObject(value)) {
    return { status: 'malformed', marker: null, errors: ['marker must be a JSON object'] };
  }

  const errors: string[] = [];
  const schemaVersion = asString(value.schemaVersion);
  const taskId = asString(value.taskId);
  const taskType = asString(value.taskType) as WorkflowTaskType | null;
  const risk = asString(value.risk) as WorkflowRisk | null;
  const initialParentTier = asString(value.initialParentTier) as WorkflowParentTier | null;
  const executionParentTier = asString(value.executionParentTier) as WorkflowParentTier | null;
  const routingDecision = asString(value.routingDecision) as WorkflowRoutingDecision | null;
  const architectureGate = asString(value.architectureGate) as WorkflowGateDecision | null;
  const architectureReviewSource = asString(
    value.architectureReviewSource
  ) as WorkflowReviewSource | null;
  const verification = asString(value.verification) as WorkflowEvidenceState | null;
  const finalReview = asString(value.finalReview) as WorkflowFinalReviewStatus | null;
  const finalReviewSource = asString(value.finalReviewSource) as WorkflowReviewSource | null;
  const commit = asString(value.commit) as WorkflowCommitStatus | null;
  const handoff = asString(value.handoff) as WorkflowHandoffStatus | null;
  const exploreCanonical = value.exploreCanonical;
  const rawEscalationReasons = value.reviewEscalationReasons;
  const reviewEscalationReasons = Array.isArray(rawEscalationReasons)
    ? rawEscalationReasons
        .map(asString)
        .filter((reason): reason is string => Boolean(reason))
    : [];
  const finalReviewRequired =
    risk === 'high' ||
    reviewEscalationReasons.length > 0 ||
    value.finalReviewRequired === true;
  const rawIndependentReasons = value.independentReviewReasons;
  const independentReviewReasons = Array.isArray(rawIndependentReasons)
    ? rawIndependentReasons
        .map(asString)
        .filter((reason): reason is string => Boolean(reason))
    : [];
  const independentReviewRequired =
    value.independentReviewRequired === true || independentReviewReasons.length > 0;

  if (schemaVersion !== '1' && schemaVersion !== '2') {
    errors.push('schemaVersion must be "1" or "2"');
  }
  if (!taskId) errors.push('taskId is required');
  if (!taskType || !TASK_TYPES.has(taskType)) errors.push('taskType must be change|planning|review');
  if (!risk || !RISKS.has(risk)) errors.push('risk must be high|routine');
  if (typeof exploreCanonical !== 'boolean') errors.push('exploreCanonical must be boolean');
  if (
    value.finalReviewRequired !== undefined &&
    typeof value.finalReviewRequired !== 'boolean'
  ) {
    errors.push('finalReviewRequired must be boolean when provided');
  }
  if (
    value.reviewEscalationReasons !== undefined &&
    !Array.isArray(rawEscalationReasons)
  ) {
    errors.push('reviewEscalationReasons must be an array when provided');
  }
  if (
    Array.isArray(rawEscalationReasons) &&
    reviewEscalationReasons.length !== rawEscalationReasons.length
  ) {
    errors.push('reviewEscalationReasons must contain only non-empty strings');
  }
  if (
    value.independentReviewReasons !== undefined &&
    !Array.isArray(rawIndependentReasons)
  ) {
    errors.push('independentReviewReasons must be an array when provided');
  }
  if (
    Array.isArray(rawIndependentReasons) &&
    independentReviewReasons.length !== rawIndependentReasons.length
  ) {
    errors.push('independentReviewReasons must contain only non-empty strings');
  }
  if (
    value.independentReviewRequired !== undefined &&
    typeof value.independentReviewRequired !== 'boolean'
  ) {
    errors.push('independentReviewRequired must be boolean when provided');
  }
  if (schemaVersion === '2') {
    if (typeof value.finalReviewRequired !== 'boolean') {
      errors.push('finalReviewRequired is required for schemaVersion 2');
    }
    if (!Array.isArray(rawEscalationReasons)) {
      errors.push('reviewEscalationReasons is required for schemaVersion 2');
    }
    if (!initialParentTier || !PARENT_TIERS.has(initialParentTier)) {
      errors.push('initialParentTier is invalid');
    }
    if (!executionParentTier || !PARENT_TIERS.has(executionParentTier)) {
      errors.push('executionParentTier is invalid');
    }
    if (!routingDecision || !ROUTING_DECISIONS.has(routingDecision)) {
      errors.push('routingDecision is invalid');
    }
    if (!architectureReviewSource || !REVIEW_SOURCES.has(architectureReviewSource)) {
      errors.push('architectureReviewSource is invalid');
    }
    if (!finalReviewSource || !REVIEW_SOURCES.has(finalReviewSource)) {
      errors.push('finalReviewSource is invalid');
    }
    if (typeof value.independentReviewRequired !== 'boolean') {
      errors.push('independentReviewRequired is required for schemaVersion 2');
    }
    if (!Array.isArray(rawIndependentReasons)) {
      errors.push('independentReviewReasons is required for schemaVersion 2');
    }
    if (value.independentReviewRequired === true && independentReviewReasons.length === 0) {
      errors.push('independentReviewReasons is required when independentReviewRequired is true');
    }
    if (
      initialParentTier &&
      executionParentTier &&
      routingDecision &&
      !isWorkflowRoutingDecisionCoherent({
        initialParentTier,
        executionParentTier,
        routingDecision,
      })
    ) {
      errors.push('routingDecision conflicts with initialParentTier or executionParentTier');
    }
  }
  if (!architectureGate || !GATE_DECISIONS.has(architectureGate)) {
    errors.push('architectureGate is invalid');
  }
  if (!verification || !EVIDENCE_STATES.has(verification)) errors.push('verification is invalid');
  if (!finalReview || !FINAL_REVIEW_STATES.has(finalReview)) errors.push('finalReview is invalid');
  if (!commit || !COMMIT_STATES.has(commit)) errors.push('commit is invalid');
  if (!handoff || !HANDOFF_STATES.has(handoff)) errors.push('handoff is invalid');

  const requiredTests = parseRequiredTests(value.requiredTests);
  const unresolvedRisks = parseUnresolvedRisks(value.unresolvedRisks);
  errors.push(...requiredTests.errors, ...unresolvedRisks.errors);
  if (schemaVersion === '2' && risk === 'high' && requiredTests.tests.length === 0) {
    errors.push('high-risk schemaVersion 2 markers require stable requiredTests IDs');
  }
  if (
    schemaVersion === '2' &&
    architectureReviewSource === 'parent_structured' &&
    executionParentTier !== 'premium'
  ) {
    errors.push('parent_structured architecture review requires a premium execution parent');
  }
  if (
    schemaVersion === '2' &&
    finalReviewSource === 'parent_structured' &&
    executionParentTier !== 'premium'
  ) {
    errors.push('parent_structured final review requires a premium execution parent');
  }
  if (
    schemaVersion === '2' &&
    independentReviewRequired &&
    risk === 'high' &&
    architectureReviewSource !== 'independent_subagent'
  ) {
    errors.push('independent architecture review must use independent_subagent');
  }
  if (
    schemaVersion === '2' &&
    independentReviewRequired &&
    finalReviewRequired &&
    finalReviewSource !== 'independent_subagent'
  ) {
    errors.push('independent final review must use independent_subagent');
  }

  if (errors.length > 0) {
    return { status: 'malformed', marker: null, errors };
  }

  return {
    status: 'present',
    marker: {
      schemaVersion: schemaVersion as '1' | '2',
      taskId: taskId!,
      taskType: taskType!,
      risk: risk!,
      initialParentTier: initialParentTier ?? undefined,
      executionParentTier: executionParentTier ?? undefined,
      routingDecision: routingDecision ?? undefined,
      exploreCanonical: exploreCanonical as boolean,
      architectureGate: architectureGate!,
      architectureReviewSource: architectureReviewSource ?? undefined,
      requiredTests: requiredTests.tests,
      unresolvedRisks: unresolvedRisks.risks,
      verification: verification!,
      finalReviewRequired,
      reviewEscalationReasons,
      independentReviewRequired,
      independentReviewReasons,
      finalReview: finalReview!,
      finalReviewSource: finalReviewSource ?? undefined,
      commit: commit!,
      handoff: handoff!,
    },
    errors: [],
  };
}

export function extractWorkflowCompletionMarker(text: string): ParsedWorkflowMarker {
  const v1Start = text.lastIndexOf(WORKFLOW_MARKER_PREFIX_V1);
  const v2Start = text.lastIndexOf(WORKFLOW_MARKER_PREFIX_V2);
  const start = Math.max(v1Start, v2Start);
  if (start < 0) {
    return { status: 'missing', marker: null, errors: ['workflow completion marker not found'] };
  }

  const prefix = start === v2Start ? WORKFLOW_MARKER_PREFIX_V2 : WORKFLOW_MARKER_PREFIX_V1;
  const afterPrefix = text.slice(start + prefix.length);
  const end = afterPrefix.indexOf(WORKFLOW_MARKER_SUFFIX);
  if (end < 0) {
    return { status: 'malformed', marker: null, errors: ['workflow completion marker is not closed'] };
  }

  const raw = afterPrefix.slice(0, end).trim();
  try {
    const parsed = validateWorkflowCompletionMarker(JSON.parse(raw));
    return { ...parsed, raw };
  } catch (error) {
    return {
      status: 'malformed',
      marker: null,
      errors: [error instanceof Error ? error.message : 'marker JSON parse failed'],
      raw,
    };
  }
}

export function renderWorkflowCompletionMarker(marker: WorkflowCompletionMarker): string {
  const prefix =
    marker.schemaVersion === '2' ? WORKFLOW_MARKER_PREFIX_V2 : WORKFLOW_MARKER_PREFIX_V1;
  return `${prefix}\n${JSON.stringify(marker, null, 2)}\n${WORKFLOW_MARKER_SUFFIX}`;
}
