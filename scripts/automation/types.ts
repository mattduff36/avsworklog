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
  /** Optional TEE workstream correlation for finalise runs. */
  workflowCorrelation?: WorkflowFinaliseCorrelation;
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
export type WorkflowLane = 'fast' | 'standard' | 'guarded' | 'critical';
export type WorkflowExecutionMode = 'agent' | 'multitask';
export type WorkflowExecutionModeDetected = WorkflowExecutionMode | 'unknown';
export type WorkflowParentTier = 'premium' | 'economical' | 'unknown';
export type WorkflowRoutingDecision =
  | 'switched_to_economical'
  | 'continued_premium'
  | 'economical_default'
  | 'explicit_premium'
  | 'not_applicable'
  | 'unknown';
export type WorkflowReviewSource =
  | 'independent_subagent'
  | 'parent_structured'
  | 'local'
  | 'not_applicable'
  | 'unknown';
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
export type WorkflowPlanRecommendationAdherence =
  | 'matched'
  | 'deviated'
  | 'not_applicable'
  | 'unknown';
export type WorkflowReviewPassStage =
  | 'architecture-gate'
  | 'final-diff-reviewer'
  | 'local-review'
  | 'other';
export type WorkflowSwitchTiming =
  | 'before_substantive_implementation'
  | 'after_plan_approval'
  | 'not_applicable';

export interface WorkflowRequiredTest {
  id: string;
  status: 'completed' | 'unresolved';
  note?: string;
}

export interface WorkflowUnresolvedRisk {
  id: string;
  note: string;
}

export interface WorkflowRecommendedBuildModel {
  implementation: {
    role: string;
    tier: WorkflowParentTier;
    family?: string;
  };
  premiumGates: Array<{
    phase: string;
    role: string;
    tier: WorkflowParentTier;
    mandatory: boolean;
  }>;
  switchTiming: WorkflowSwitchTiming;
  rationale: string;
  fallbackEscalation: string;
}

export interface WorkflowReviewPassRecord {
  passId: string;
  stage: WorkflowReviewPassStage;
  source: WorkflowReviewSource;
  tier: WorkflowParentTier;
  iteration: number;
  result: 'passed' | 'failed' | 'blocked' | 'unknown';
}

export type WorkflowProtocolPhase =
  | 'initialized'
  | 'preflight_ready'
  | 'first_review'
  | 'fix_sweep_required'
  | 'fix_recorded'
  | 'closure_review'
  | 'delta_review'
  | 'review_closed'
  | 'routing_required'
  | 'split'
  | 'finalise_ready'
  | 'finalised'
  | 'reconciled'
  | 'removed_from_release'
  | 'reverted'
  | 'superseded'
  | 'rehomed'
  | 'already_in_release';

export const SUCCESSOR_ENGINE_PATHS = [
  'scripts/automation/types.ts',
  'scripts/automation/workflow-finalise-correlation.ts',
  'scripts/automation/workflow-review-protocol.ts',
  'scripts/automation/workflow-suite-manifest.json',
  'scripts/automation/workflow-v24-disposition.ts',
  'scripts/review-preflight.ts',
  'scripts/workflow-protocol.ts',
  'tests/unit/workflow-v24-leftover-refresh.test.ts',
] as const;

export type WorkflowRouteDispositionTarget =
  | 'removed_from_release'
  | 'reverted'
  | 'superseded'
  | 'rehomed'
  | 'already_in_release';

export type WorkflowRouteGitEvidenceKind =
  | 'absent_from_release_range'
  | 'full_revert'
  | 'safe_supersede'
  | 'isolated_successor'
  | 'trusted_release_content_identity';

export interface WorkflowRouteGitEvidence {
  kind: WorkflowRouteGitEvidenceKind;
  baselineCommit: string;
  releaseHeadCommit: string;
  implementationCommits: string[];
  revertCommit?: string;
  supersedeCommit?: string;
  successorBranch?: string;
  successorBaseline?: string;
  successorRepoCanonicalPath?: string;
  predecessorHead?: string;
  predecessorHeadIsAncestor?: boolean;
  latestLegalReviewCandidateHead?: string;
  trustedReleaseSha?: string;
  originMainCommit?: string;
  identityPaths?: string[];
  canonVersion?: 'tee-v24-rehome-evidence-v2';
  evidenceHash: string;
}

export interface WorkflowRouteDisposition {
  schemaVersion: '1';
  command: 'route';
  recordedAt: string;
  target: WorkflowRouteDispositionTarget;
  reason: string;
  gitEvidence: WorkflowRouteGitEvidence;
}

export type WorkflowRehomeProvenanceStatus = 'declared' | 'bound';

export interface WorkflowRehomeProvenance {
  schemaVersion: '1';
  status: WorkflowRehomeProvenanceStatus;
  predecessorRootWorkstreamId: string;
  predecessorDescendantWorkstreamId: string;
  predecessorHeadCommit: string;
  predecessorReleaseContext: string;
  successorBranchName: string;
  successorBaselineCommit: string;
  successorWorktreeCanonicalPath?: string;
  sourcePatchSha256: string;
  sourceProductTreeFingerprint: string;
  sourceReleaseContext?: string;
  sourceHeadCommit?: string;
  sourceBaselineCommit?: string;
  sourceReviewWorkstreamId?: string;
  sourceImplementationCommits?: string[];
  predecessorBranchResolvedSha?: string;
  predecessorHeadIsAncestor: false;
  predecessorPassedReview: false;
  boundAt?: string;
  evidence?: {
    canonVersion: 'tee-v24-rehome-evidence-v2';
    currentHead: string;
    currentBranch: string;
    successorBaseline: string;
    predecessorHead: string;
    predecessorBranchResolvedSha: string;
    sourceHeadCommit: string;
    sourceBaselineCommit: string;
    sourceReviewWorkstreamId?: string;
    sourcePatchSha256: string;
    sourceProductTreeFingerprint: string;
    implementationCommits: string[];
    latestLegalReviewCandidateHead?: string;
    mergeBaseCheck: 'predecessor_head_not_ancestor';
    predecessorExhausted: true;
    evidenceHash: string;
  };
}

export type WorkflowProtocolReviewPass = 'first' | 'closure' | 'delta';

export type WorkflowLegacyReconciliationKind =
  | 'released'
  | 'reconstruct-lineage'
  | 'superseded';

export type WorkflowLegacyClosureDisposition =
  | 'released'
  | 'superseded'
  | 'lineage-reconstructed';

export type WorkflowLegacyIdentityProofKind = 'plan-in-commit' | 'manifest-to-commit';

export interface WorkflowLegacyClosureObservedSnapshot {
  phase: WorkflowProtocolPhase;
  nextAction: string;
  checkpointId: string | null;
  sourceWorkstreamIds: string[] | null;
  baseCommit: string;
  headCommit: string | null;
  protocolPreimageSha256: string;
}

export interface WorkflowLegacyClosureIdentityAnchor {
  implementationCommit: string;
  proofKind: WorkflowLegacyIdentityProofKind;
  proofPath: string;
  proofWorkstreamId: string;
  manifestSha256?: string;
  identityFiles?: string[];
}

export interface WorkflowLegacyClosureRecord {
  schemaVersion: '1';
  workstreamId: string;
  disposition: WorkflowLegacyClosureDisposition;
  kind: WorkflowLegacyReconciliationKind;
  registryId: string;
  registryFingerprint: string;
  observedSnapshot: WorkflowLegacyClosureObservedSnapshot;
  identityAnchor: WorkflowLegacyClosureIdentityAnchor;
  childWorkstreamId?: string;
  releasedRef: string;
  releasedRefCommit: string;
  evidenceCommits: string[];
  reason: string;
  command: 'reconcile-legacy';
  protocolVersion: string;
  createdAt: string;
}

export interface WorkflowLegacyReconciliationAudit {
  previousPhase: WorkflowProtocolPhase;
  previousNextAction?: string | null;
  previousCheckpointId?: string | null;
  previousSourceWorkstreamIds?: string[] | null;
  kind: WorkflowLegacyReconciliationKind;
  reason: string;
  evidenceCommits: string[];
  releasedRef: string;
  releasedRefCommit: string;
  command: 'reconcile-legacy';
  protocolVersion: string;
  reconstructedChildWorkstreamId?: string;
  reconstructedParentWorkstreamId?: string;
  registryId: string;
  preimageSha256: string;
  reconciledAt: string;
}

export type WorkflowIdentityStatus = 'present' | 'missing' | 'unknown';
export type WorkflowTranscriptStatus = 'parsed' | 'null' | 'missing' | 'malformed';
export type WorkflowReviewClosureProtocol = 'two-pass-v1';

export interface WorkflowReviewClosureState {
  protocol: WorkflowReviewClosureProtocol;
  protocolVersion?: string;
  phase?: WorkflowProtocolPhase;
  evidenceManifestPath?: string;
  fixDeltaManifestPath?: string;
  firstPassId?: string;
  deltaPassId?: string;
  blockerFamilies?: string[];
  failedPremiumReviewCount?: number;
  activeReviewTokenPresent?: boolean;
}

export interface WorkflowCompletionMarker {
  schemaVersion: '1' | '2' | '3' | '4';
  /** Native V2 lane. Absent on legacy V1-V3 markers. */
  lane?: WorkflowLane;
  taskId: string;
  taskType: WorkflowTaskType;
  risk: WorkflowRisk;
  workstreamId?: string;
  /** v3: opaque lineage for follow-up workstreams derived from earlier work. */
  sourceWorkstreamIds?: string[];
  initialParentTier?: WorkflowParentTier;
  executionParentTier?: WorkflowParentTier;
  routingDecision?: WorkflowRoutingDecision;
  exploreCanonical: boolean;
  architectureGate: WorkflowGateDecision;
  architectureReviewSource?: WorkflowReviewSource;
  requiredTests: WorkflowRequiredTest[];
  unresolvedRisks: WorkflowUnresolvedRisk[];
  verification: WorkflowEvidenceState;
  /** Optional for backward compatibility; high-risk markers imply true. */
  finalReviewRequired?: boolean;
  reviewEscalationReasons?: string[];
  independentReviewRequired?: boolean;
  independentReviewReasons?: string[];
  finalReview: WorkflowFinalReviewStatus;
  finalReviewSource?: WorkflowReviewSource;
  commit: WorkflowCommitStatus;
  handoff: WorkflowHandoffStatus;
  /** v3: plan recommendation echo and adherence. */
  registryVersion?: string;
  recommendedBuildModel?: WorkflowRecommendedBuildModel;
  planRecommendationAdherence?: WorkflowPlanRecommendationAdherence;
  reviewPasses?: WorkflowReviewPassRecord[];
  /** Additive two-pass closure evidence; ignored by legacy readers. */
  reviewClosure?: WorkflowReviewClosureState;
  /** Optional V2.1 execution-mode advisory telemetry. */
  executionModeRecommended?: WorkflowExecutionMode;
  executionModeDetected?: WorkflowExecutionModeDetected;
  executionModeAdvised?: boolean;
  executionModeAccepted?: boolean | null;
  parallelWorkUnits?: number;
  parallelismReason?: string;
}

export interface WorkflowPlanContract {
  schemaVersion: '1';
  registryVersion: string;
  workstreamId: string;
  sourceWorkstreamIds?: string[];
  taskId: string;
  taskType: WorkflowTaskType;
  risk: WorkflowRisk;
  initialParentTier: WorkflowParentTier;
  routingDecision: WorkflowRoutingDecision;
  recommendedBuildModel: WorkflowRecommendedBuildModel;
  architectureGate: WorkflowGateDecision;
  architectureReviewSource: WorkflowReviewSource;
  independentReviewRequired: boolean;
  independentReviewReasons: string[];
  requiredTests: WorkflowRequiredTest[];
  unresolvedRisks: WorkflowUnresolvedRisk[];
  finalReviewRequired: boolean;
  finalReviewSource: WorkflowReviewSource;
  commit: WorkflowCommitStatus;
  handoff: WorkflowHandoffStatus;
  implementationContract?: {
    invariants?: string[];
    boundaries?: string[];
    rollback?: string;
  };
  /** Additive; high-risk plans should set two-pass-v1. */
  reviewClosureProtocol?: WorkflowReviewClosureProtocol;
  /** Additive V2.4 re-home declaration. Not a split-parent pointer. */
  rehomeProvenance?: WorkflowRehomeProvenance;
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
  planContractPresent: boolean;
  planPathSource: 'repo_relative' | 'external_hashed' | 'unavailable';
  planPathRef: string | null;
  parseErrors: string[];
}

export interface WorkflowHookDiagnostics {
  transcriptPathPresent: boolean;
  transcriptPathNull: boolean;
  transcriptPathEmpty: boolean;
  transcriptStatus: WorkflowTranscriptStatus;
}

export interface WorkflowStopEvent {
  /** Writers emit '2'; readers accept '1' | '2'. */
  schemaVersion: '1' | '2';
  eventId: string;
  recordedAt: string;
  conversationHash: string;
  generationHash: string;
  selectedModel: string;
  selectedModelSource: 'model_id' | 'model' | 'unavailable';
  selectedModelTier: WorkflowParentTier;
  selectedModelRole?: string;
  status: 'completed' | 'aborted' | 'error' | 'unknown';
  loopCount: number;
  qualifies: boolean;
  qualificationReasons: string[];
  marker: WorkflowCompletionMarker | null;
  /** Native V2 lane copied from V4 markers. */
  lane?: WorkflowLane;
  markerStatus: 'present' | 'missing' | 'malformed';
  transcriptSignals: WorkflowTranscriptSignals | null;
  findings: WorkflowFinding[];
  monthKey: string;
  /** Legacy v1 field; not written by v2 event writers. */
  reviewedInWindowId?: string;
  workstreamId?: string;
  sourceWorkstreamIds?: string[];
  planValidationStatus?: 'present' | 'missing' | 'malformed' | 'not_applicable' | 'unknown';
  planRecommendationAdherence?: WorkflowPlanRecommendationAdherence;
  registryVersion?: string;
  branchName?: string;
  headCommit?: string;
  reviewPasses?: WorkflowReviewPassRecord[];
  /** Additive telemetry; absent on legacy events. */
  transcriptStatus?: WorkflowTranscriptStatus;
  identityStatus?: WorkflowIdentityStatus;
  protocolPhase?: WorkflowProtocolPhase;
  hookDiagnostics?: WorkflowHookDiagnostics;
  anomalyFlags?: string[];
  executionModeRecommended?: WorkflowExecutionMode;
  executionModeDetected?: WorkflowExecutionModeDetected;
  executionModeAdvised?: boolean;
  executionModeAccepted?: boolean | null;
  parallelWorkUnits?: number;
  parallelismReason?: string;
}

export interface WorkflowAnomalySignal {
  eventId: string;
  recordedAt: string;
  flags: string[];
}

export interface WorkflowWorkstreamRecord {
  workstreamId: string;
  branchName: string | null;
  headCommit: string | null;
  taskIds: string[];
  eventIds: string[];
  status: 'open' | 'finalised' | 'abandoned' | 'unknown';
  finaliseRunId?: string;
  finaliseOutcome?: 'passed' | 'failed' | 'unknown';
  finaliseCommit?: string;
  sourceWorkstreamIds?: string[];
  updatedAt: string;
}

export interface WorkflowProtocolReviewAttempt {
  pass: WorkflowProtocolReviewPass;
  token: string;
  startedAt: string;
  headCommit?: string | null;
  treeFingerprint?: string | null;
  result?: 'passed' | 'failed';
  blockerFamilies?: string[];
  blockerIds?: string[];
  siblingSurfaces?: string[];
  recordedAt?: string;
}

export interface WorkflowProtocolRecord {
  schemaVersion: '1';
  workstreamId: string;
  identityStatus: 'present';
  sourceWorkstreamIds?: string[];
  inheritedFailedReviewCount: number;
  branchName: string | null;
  baseCommit: string;
  headCommit: string | null;
  phase: WorkflowProtocolPhase;
  nextAction: string;
  failedPremiumReviewCount: number;
  activeReviewToken: string | null;
  activeReviewPass: WorkflowProtocolReviewPass | null;
  reviewAttempts: WorkflowProtocolReviewAttempt[];
  reviewedTreeFingerprint?: string | null;
  blockerFamilies: string[];
  openBlockerIds: string[];
  evidenceManifestPath: string | null;
  fixDeltaManifestPath: string | null;
  activeCheckpointId: string | null;
  planPath: string | null;
  updatedAt: string;
  legacyReconciliation?: WorkflowLegacyReconciliationAudit | null;
  rehomeProvenance?: WorkflowRehomeProvenance | null;
  routeDisposition?: WorkflowRouteDisposition | null;
}

export interface WorkflowActiveFinaliseContext {
  workstreamId: string;
  checkpointId: string;
  activatedAt: string;
  activatedHeadCommit?: string | null;
  activatedTreeFingerprint?: string | null;
  ownedCommits?: string[];
}

export interface WorkflowReviewState {
  /** Writers emit '2'; readers accept '1' | '2'. */
  schemaVersion: '1' | '2';
  scriptName: 'workflow-review';
  updatedAt: string;
  lastReviewAt: string | null;
  lastReviewWindowId: string | null;
  lastReviewedEventId: string | null;
  unreviewedEventIds: string[];
  pendingFollowUpPath: string | null;
  processedGenerationHashes: string[];
  /** State-side review membership; never rewrite immutable events. */
  reviewWindowByEventId?: Record<string, string>;
  workstreams?: Record<string, WorkflowWorkstreamRecord>;
  /** Additive two-pass protocol records keyed by workstreamId. */
  protocolRecords?: Record<string, WorkflowProtocolRecord>;
  activeFinaliseContext?: WorkflowActiveFinaliseContext | null;
  pendingAnomalySignals?: WorkflowAnomalySignal[];
}

export interface WorkflowReviewMetrics {
  qualifyingTaskCount: number;
  highRiskCount: number;
  routineCount: number;
  laneCounts?: Record<WorkflowLane | 'unknown', number>;
  missingGateCount: number;
  missingFinalReviewCount: number;
  truncatedEvidenceCount: number;
  incompleteHandoffCount: number;
  selectedModelCounts: Record<string, number>;
  estimatedPremiumTokenReductionLowPercent: number;
  estimatedPremiumTokenReductionHighPercent: number;
  estimateFormulaVersion: string;
  estimateConfidence: 'low';
  planContractPresentCount?: number;
  planContractMissingCount?: number;
  recommendationAdherenceCounts?: Record<WorkflowPlanRecommendationAdherence, number>;
  registryVersionCounts?: Record<string, number>;
  premiumReReviewFlagCount?: number;
  executionModeRecommendationCounts?: Record<WorkflowExecutionMode | 'unknown', number>;
  executionModeDetectedCounts?: Record<WorkflowExecutionModeDetected, number>;
  executionModeAdvisedCount?: number;
  executionModeAcceptanceCounts?: Record<'accepted' | 'declined' | 'unknown', number>;
}

export interface WorkflowFinaliseCorrelation {
  workstreamIds: string[];
  matchedBy: 'branch_ancestry' | 'none' | 'multiple' | 'explicit_context';
  branchName: string | null;
  headCommit: string | null;
  resultingCommit: string | null;
  identityStatus?: WorkflowIdentityStatus;
  checkpointId?: string | null;
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
