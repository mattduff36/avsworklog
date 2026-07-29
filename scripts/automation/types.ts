export type AutomationRunStatus = 'passed' | 'failed';

export interface AutomationExpectedArtifact {
  path: string;
  required?: boolean;
}

export interface AutomationCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface AutomationStepLog {
  name: string;
  status: AutomationRunStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  command?: string;
  exitCode?: number | null;
  output?: string;
  outputTruncated?: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface AutomationRunMetadata {
  branch: string;
  commit: string;
  dirtyFileCount: number;
  nodeVersion: string;
  npmVersion: string;
  platform: string;
}

export interface AutomationRunLog {
  id: string;
  scriptName: string;
  mode: string;
  args: string[];
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: AutomationRunStatus;
  metadata: AutomationRunMetadata;
  expectedArtifacts: AutomationExpectedArtifact[];
  artifacts: Array<{ path: string; exists: boolean; required: boolean }>;
  steps: AutomationStepLog[];
  review?: AutomationReviewSummary;
  error?: string;
}

export interface AutomationReviewSuggestion {
  severity: 'info' | 'warning' | 'action';
  message: string;
}

export interface AutomationReviewSummary {
  scriptName: string;
  generatedAt: string;
  runCount: number;
  recentRunCount: number;
  recentFailureCount: number;
  averageDurationMs: number;
  slowestStepName: string | null;
  suggestions: AutomationReviewSuggestion[];
  monthlyReviewPath?: string;
  monthlyPromptPath?: string;
  monthlySuggestionsPath?: string;
  monthlyReview?: AutomationReviewArtifacts;
  advisorReviewPath?: string;
  monthlyReviewGenerated: boolean;
}

export type AutomationSuggestionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'implemented'
  | 'superseded';

export type AutomationSuggestionOutcomeResult =
  | 'unknown'
  | 'improved'
  | 'no_change'
  | 'worse'
  | 'not_measured';

export interface AutomationSuggestionOutcome {
  result: AutomationSuggestionOutcomeResult;
  measuredAt?: string;
  beforeAvgMs?: number;
  afterAvgMs?: number;
  notes?: string;
}

export interface AutomationMemorySuggestion {
  id: string;
  scriptName: string;
  title: string;
  reason: string;
  evidence: string[];
  createdMonth: string;
  lastSeenMonth: string;
  status: AutomationSuggestionStatus;
  statusReason?: string;
  decisionAt?: string;
  decisionReason?: string;
  planPath?: string;
  implementedAt?: string;
  outcome?: AutomationSuggestionOutcome;
  source: 'deterministic' | 'advisor';
}

export interface AutomationReviewPrompt {
  month: string;
  path?: string;
  focusAreas: string[];
  deprioritizedAreas: string[];
  prompt: string;
}

export interface AutomationMonthlyMetrics {
  scriptName: string;
  month: string;
  generatedAt: string;
  runCount: number;
  failureCount: number;
  averageDurationMs: number;
  modeCounts: Record<string, number>;
  finalise?: {
    fullTestRuns: number;
    buildAverageMs: number;
    migrationRuns: number;
    dbValidateRuns: number;
    commitCommandCount: number;
    pushCommandCount: number;
  };
  fixerrors?: {
    totalFetched: number;
    totalFiltered: number;
    totalGrouped: number;
    fetchLimitHitCount: number;
    highFilteredRuns: number;
    untriagedCount: number;
    staleCount: number;
    repeatedPatternCount: number;
    repeatedSourceFileCount: number;
  };
  workflowReview?: WorkflowReviewMetrics;
}

export type WorkflowEvidenceState = 'passed' | 'failed' | 'unknown';
export type WorkflowTaskType = 'change' | 'planning' | 'review';
export type WorkflowRisk = 'high' | 'routine';
export type WorkflowGateDecision =
  | 'approved'
  | 'approved_with_conditions'
  | 'blocked'
  | 'skipped'
  | 'not_applicable'
  | 'unknown';
export type WorkflowCommitStatus = 'completed' | 'not_applicable' | 'pending' | 'unknown';
export type WorkflowHandoffStatus = 'completed' | 'pending' | 'unknown';
export type WorkflowFinalReviewStatus =
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'not_applicable'
  | 'unknown';

export interface WorkflowRequiredTest {
  id: string;
  status: 'completed' | 'unresolved';
  note?: string;
}

export interface WorkflowUnresolvedRisk {
  id: string;
  note: string;
}

export interface WorkflowCompletionMarker {
  schemaVersion: '1';
  taskId: string;
  taskType: WorkflowTaskType;
  risk: WorkflowRisk;
  exploreCanonical: boolean;
  architectureGate: WorkflowGateDecision;
  requiredTests: WorkflowRequiredTest[];
  unresolvedRisks: WorkflowUnresolvedRisk[];
  verification: WorkflowEvidenceState;
  finalReview: WorkflowFinalReviewStatus;
  commit: WorkflowCommitStatus;
  handoff: WorkflowHandoffStatus;
}

export interface WorkflowFinding {
  id: string;
  severity: 'info' | 'warning' | 'action';
  status: WorkflowEvidenceState;
  title: string;
  detail: string;
  evidenceLabels: string[];
}

export interface WorkflowTranscriptSignals {
  adapterVersion: string;
  skillRead: boolean;
  architectureGateTask: boolean;
  finalDiffReviewerTask: boolean;
  exploreTask: boolean;
  truncatedShellEvidence: boolean;
  bulkInsertionScriptEvidence: boolean;
  duplicateBroadSearchAfterExplore: boolean;
  gitCommitEvidence: boolean;
  markerPresent: boolean;
  parseErrors: string[];
}

export interface WorkflowStopEvent {
  schemaVersion: '1';
  eventId: string;
  recordedAt: string;
  conversationHash: string;
  generationHash: string;
  selectedModel: string;
  selectedModelSource: 'model_id' | 'model' | 'unavailable';
  status: 'completed' | 'aborted' | 'error' | 'unknown';
  loopCount: number;
  qualifies: boolean;
  qualificationReasons: string[];
  marker: WorkflowCompletionMarker | null;
  markerStatus: 'present' | 'missing' | 'malformed';
  transcriptSignals: WorkflowTranscriptSignals | null;
  findings: WorkflowFinding[];
  monthKey: string;
  reviewedInWindowId?: string;
}

export interface WorkflowReviewState {
  schemaVersion: '1';
  scriptName: 'workflow-review';
  updatedAt: string;
  lastReviewAt: string | null;
  lastReviewWindowId: string | null;
  lastReviewedEventId: string | null;
  unreviewedEventIds: string[];
  pendingFollowUpPath: string | null;
  processedGenerationHashes: string[];
}

export interface WorkflowReviewMetrics {
  qualifyingTaskCount: number;
  highRiskCount: number;
  routineCount: number;
  missingGateCount: number;
  missingFinalReviewCount: number;
  truncatedEvidenceCount: number;
  incompleteHandoffCount: number;
  selectedModelCounts: Record<string, number>;
  estimatedPremiumTokenReductionLowPercent: number;
  estimatedPremiumTokenReductionHighPercent: number;
  estimateFormulaVersion: string;
  estimateConfidence: 'low';
}

export interface AutomationMemory {
  version: string;
  scriptName: string;
  updatedAt: string;
  suggestions: AutomationMemorySuggestion[];
  prompts: AutomationReviewPrompt[];
  monthlyMetrics: AutomationMonthlyMetrics[];
}

export interface AutomationReviewArtifacts {
  monthKey: string;
  reviewPath: string;
  promptPath: string;
  metricsPath: string;
  suggestionsPath: string;
  suggestions: AutomationMemorySuggestion[];
  knowledgeDirectory: string;
  advisorReviewPath?: string;
}
