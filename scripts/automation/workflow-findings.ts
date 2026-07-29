import { sanitizeEvidenceLabel } from './workflow-privacy';
import type {
  WorkflowCompletionMarker,
  WorkflowFinding,
  WorkflowTranscriptSignals,
} from './types';

function finding(
  id: string,
  severity: WorkflowFinding['severity'],
  status: WorkflowFinding['status'],
  title: string,
  detail: string,
  evidenceLabels: string[]
): WorkflowFinding {
  return {
    id,
    severity,
    status,
    title,
    detail,
    evidenceLabels: evidenceLabels.map(sanitizeEvidenceLabel),
  };
}

export function buildWorkflowFindings(params: {
  marker: WorkflowCompletionMarker | null;
  markerStatus: 'present' | 'missing' | 'malformed';
  transcriptSignals: WorkflowTranscriptSignals | null;
}): WorkflowFinding[] {
  const { marker, markerStatus, transcriptSignals } = params;
  const findings: WorkflowFinding[] = [];

  if (markerStatus === 'missing') {
    findings.push(
      finding(
        'missing-completion-marker',
        'action',
        'unknown',
        'Missing workflow completion marker',
        'Substantive tasks must emit the versioned workflow-completion-marker:v1 block. Missing markers are unknown, never passes.',
        ['marker:missing']
      )
    );
  } else if (markerStatus === 'malformed') {
    findings.push(
      finding(
        'malformed-completion-marker',
        'action',
        'unknown',
        'Malformed workflow completion marker',
        'Marker was present but failed schema validation. Malformed markers are unknown, never passes.',
        ['marker:malformed']
      )
    );
  }

  if (!marker) {
    if (transcriptSignals?.truncatedShellEvidence) {
      findings.push(
        finding(
          'truncated-verification-output',
          'action',
          'failed',
          'Verification output appears truncated',
          'Shell commands that pipe through head/tail/slice can hide failures.',
          ['transcript:truncated-shell']
        )
      );
    }
    return findings;
  }

  if (marker.risk === 'high' && marker.architectureGate === 'skipped') {
    findings.push(
      finding(
        'missing-architecture-gate',
        'action',
        'failed',
        'High-risk task skipped architecture gate',
        'High-risk work must run architecture-gate before implementation.',
        ['marker:architectureGate=skipped', 'marker:risk=high']
      )
    );
  } else if (marker.risk === 'high' && marker.architectureGate === 'blocked') {
    findings.push(
      finding(
        'architecture-gate-blocked',
        'action',
        'failed',
        'Architecture gate blocked implementation',
        'A blocked architecture-gate decision must not be treated as a successful handoff.',
        ['marker:architectureGate=blocked']
      )
    );
  } else if (marker.risk === 'high' && marker.architectureGate === 'not_applicable') {
    findings.push(
      finding(
        'architecture-gate-not-applicable',
        'action',
        'failed',
        'High-risk task marked architecture gate not applicable',
        'High-risk work cannot mark architecture-gate as not_applicable.',
        ['marker:architectureGate=not_applicable', 'marker:risk=high']
      )
    );
  } else if (marker.risk === 'high' && marker.architectureGate === 'unknown') {
    findings.push(
      finding(
        'architecture-gate-unknown',
        'warning',
        'unknown',
        'Architecture gate evidence unknown',
        'High-risk tasks need an explicit gate decision in the completion marker. Transcript Task calls alone cannot convert unknown into passed.',
        [
          'marker:architectureGate=unknown',
          `transcript:architectureGateTask=${Boolean(transcriptSignals?.architectureGateTask)}`,
        ]
      )
    );
  }

  if (marker.risk === 'high' && (marker.finalReview === 'skipped' || marker.finalReview === 'not_applicable')) {
    findings.push(
      finding(
        'missing-final-review',
        'action',
        'failed',
        'High-risk task missing final review',
        'High-risk work must invoke final-diff-reviewer after deterministic verification.',
        [`marker:finalReview=${marker.finalReview}`]
      )
    );
  } else if (marker.risk === 'high' && marker.finalReview === 'failed') {
    findings.push(
      finding(
        'final-review-failed',
        'action',
        'failed',
        'Final review failed',
        'A failed final-diff-reviewer result blocks a clean handoff.',
        ['marker:finalReview=failed']
      )
    );
  } else if (marker.risk === 'high' && marker.finalReview === 'unknown') {
    findings.push(
      finding(
        'final-review-unknown',
        'warning',
        'unknown',
        'Final review evidence unknown',
        'High-risk tasks need an explicit finalReview value in the completion marker. Transcript Task calls alone cannot convert unknown into passed.',
        [
          'marker:finalReview=unknown',
          `transcript:finalDiffReviewerTask=${Boolean(transcriptSignals?.finalDiffReviewerTask)}`,
        ]
      )
    );
  }

  const unresolvedRequired = marker.requiredTests.filter((test) => test.status === 'unresolved');
  const unresolvedWithoutRiskNote = unresolvedRequired.filter(
    (test) => !marker.unresolvedRisks.some((risk) => risk.id === test.id)
  );
  if (unresolvedWithoutRiskNote.length > 0) {
    findings.push(
      finding(
        'unresolved-gate-tests',
        'action',
        'failed',
        'Architecture-gate tests left unresolved without risk records',
        `Required test IDs lack unresolved-risk notes: ${unresolvedWithoutRiskNote.map((test) => test.id).join(', ')}`,
        unresolvedWithoutRiskNote.map((test) => `requiredTest:${test.id}=unresolved`)
      )
    );
  }

  if (marker.verification === 'failed') {
    findings.push(
      finding(
        'verification-failed',
        'action',
        'failed',
        'Verification failed',
        'Marker reports verification failed before handoff.',
        ['marker:verification=failed']
      )
    );
  } else if (marker.verification === 'unknown') {
    findings.push(
      finding(
        'verification-unknown',
        'warning',
        'unknown',
        'Verification evidence unknown',
        'Verification was not recorded as passed or failed.',
        ['marker:verification=unknown']
      )
    );
  }

  if (transcriptSignals?.truncatedShellEvidence) {
    findings.push(
      finding(
        'truncated-verification-output',
        'action',
        'failed',
        'Verification output appears truncated',
        'Compiler/test/migration/reviewer evidence must not be truncated in a way that can hide failures.',
        ['transcript:truncated-shell']
      )
    );
  }

  if (transcriptSignals?.duplicateBroadSearchAfterExplore) {
    findings.push(
      finding(
        'duplicate-broad-search',
        'warning',
        'failed',
        'Broad search repeated after explore agent',
        'Treat explore output as canonical unless evidence is incomplete, stale, or contradicted.',
        ['transcript:duplicate-broad-search-after-explore']
      )
    );
  }

  if (transcriptSignals?.bulkInsertionScriptEvidence) {
    findings.push(
      finding(
        'bulk-text-insertion',
        'warning',
        'failed',
        'Bulk text-insertion script detected',
        'Prefer cohesive patches; bulk transforms need deterministic codemods with immediate verification.',
        ['transcript:bulk-insertion-script']
      )
    );
  }

  if (marker.taskType === 'change') {
    if (marker.commit === 'pending' || marker.commit === 'unknown') {
      const commitStatus =
        marker.commit === 'unknown' && !transcriptSignals?.gitCommitEvidence ? 'unknown' : 'failed';
      findings.push(
        finding(
          'incomplete-commit',
          commitStatus === 'unknown' ? 'warning' : 'action',
          commitStatus,
          'Change task missing local commit',
          'Completed change tasks must finish the local commit/handoff step.',
          [`marker:commit=${marker.commit}`, `transcript:gitCommitEvidence=${Boolean(transcriptSignals?.gitCommitEvidence)}`]
        )
      );
    }
  }

  if (marker.handoff !== 'completed') {
    findings.push(
      finding(
        'incomplete-handoff',
        marker.handoff === 'unknown' ? 'warning' : 'action',
        marker.handoff === 'unknown' ? 'unknown' : 'failed',
        'Handoff incomplete',
        'Tasks must end with a clear handoff summary.',
        [`marker:handoff=${marker.handoff}`]
      )
    );
  }

  if (findings.length === 0) {
    findings.push(
      finding(
        'no-issues',
        'info',
        'passed',
        'No workflow compliance issues detected',
        'Marker and corroborating signals did not produce failed or unknown findings.',
        ['review:clean']
      )
    );
  }

  return findings;
}

export const ESTIMATE_FORMULA_VERSION = 'workflow-savings-v1';

export function estimatePremiumTokenReduction(events: Array<{ marker: WorkflowCompletionMarker | null }>): {
  lowPercent: number;
  highPercent: number;
  formulaVersion: string;
  confidence: 'low';
  assumptions: string[];
} {
  const highRisk = events.filter((event) => event.marker?.risk === 'high').length;
  const routine = events.filter((event) => event.marker?.risk === 'routine').length;
  const unknown = events.length - highRisk - routine;
  const total = Math.max(events.length, 1);

  const premiumShareLow = Math.min(0.45, (highRisk * 0.35 + routine * 0.15 + unknown * 0.25) / total);
  const premiumShareHigh = Math.min(0.55, (highRisk * 0.45 + routine * 0.25 + unknown * 0.35) / total);
  const lowPercent = Math.round((1 - premiumShareHigh) * 100);
  const highPercent = Math.round((1 - premiumShareLow) * 100);

  return {
    lowPercent: Math.max(0, Math.min(lowPercent, highPercent)),
    highPercent: Math.max(lowPercent, highPercent),
    formulaVersion: ESTIMATE_FORMULA_VERSION,
    confidence: 'low',
    assumptions: [
      'Exact IDE token usage is unavailable in local transcripts.',
      'Estimate compares gated premium usage against an all-premium baseline.',
      'Unknown-risk tasks are treated conservatively.',
    ],
  };
}
