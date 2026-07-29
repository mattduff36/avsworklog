import type {
  WorkflowCommitStatus,
  WorkflowCompletionMarker,
  WorkflowEvidenceState,
  WorkflowFinalReviewStatus,
  WorkflowGateDecision,
  WorkflowHandoffStatus,
  WorkflowRequiredTest,
  WorkflowRisk,
  WorkflowTaskType,
  WorkflowUnresolvedRisk,
} from './types';

export const WORKFLOW_MARKER_PREFIX = '<!-- workflow-completion-marker:v1';
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
  const architectureGate = asString(value.architectureGate) as WorkflowGateDecision | null;
  const verification = asString(value.verification) as WorkflowEvidenceState | null;
  const finalReview = asString(value.finalReview) as WorkflowFinalReviewStatus | null;
  const commit = asString(value.commit) as WorkflowCommitStatus | null;
  const handoff = asString(value.handoff) as WorkflowHandoffStatus | null;
  const exploreCanonical = value.exploreCanonical;

  if (schemaVersion !== '1') errors.push('schemaVersion must be "1"');
  if (!taskId) errors.push('taskId is required');
  if (!taskType || !TASK_TYPES.has(taskType)) errors.push('taskType must be change|planning|review');
  if (!risk || !RISKS.has(risk)) errors.push('risk must be high|routine');
  if (typeof exploreCanonical !== 'boolean') errors.push('exploreCanonical must be boolean');
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

  if (errors.length > 0) {
    return { status: 'malformed', marker: null, errors };
  }

  return {
    status: 'present',
    marker: {
      schemaVersion: '1',
      taskId: taskId!,
      taskType: taskType!,
      risk: risk!,
      exploreCanonical: exploreCanonical as boolean,
      architectureGate: architectureGate!,
      requiredTests: requiredTests.tests,
      unresolvedRisks: unresolvedRisks.risks,
      verification: verification!,
      finalReview: finalReview!,
      commit: commit!,
      handoff: handoff!,
    },
    errors: [],
  };
}

export function extractWorkflowCompletionMarker(text: string): ParsedWorkflowMarker {
  const start = text.lastIndexOf(WORKFLOW_MARKER_PREFIX);
  if (start < 0) {
    return { status: 'missing', marker: null, errors: ['workflow completion marker not found'] };
  }

  const afterPrefix = text.slice(start + WORKFLOW_MARKER_PREFIX.length);
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
  return `${WORKFLOW_MARKER_PREFIX}\n${JSON.stringify(marker, null, 2)}\n${WORKFLOW_MARKER_SUFFIX}`;
}
