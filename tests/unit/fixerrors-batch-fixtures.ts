import { describeBatch, type CapturedBatch } from '@/lib/fixerrors/batch';
import { parseAutomaticFixerrorsRetrieval } from '@/scripts/fixerrors-auto';
import { workspace } from './fixerrors-control-fixtures';

export function capturedBatch(snapshotId: string, count = 1): CapturedBatch {
  const clusters = Array.from({ length: count }, (_, index) => ({
    id: `cluster-${index + 1}`, rootCauseFamily: 'source:lib/utils/display-label.ts',
    advisoryLane: 'fast', advisoryAction: 'report-only',
    query: { errorContextId: null, httpStatus: 500, route: '/dashboard', component: 'Label',
      sourceFile: 'lib/utils/display-label.ts', normalizedMessage: 'Synthetic label failed',
      rootCauseFamily: 'source:lib/utils/display-label.ts' },
    sourceFiles: ['lib/utils/display-label.ts'], patterns: [], priorResolutions: [],
  }));
  const retrieval = parseAutomaticFixerrorsRetrieval({
    schemaVersion: 1, snapshotId, baseHead: workspace.head, treeFingerprint: 'b'.repeat(64),
    archiveMeansResolved: false, clusters,
  });
  const manifest = JSON.stringify({ schemaVersion: 1, snapshotChecksum: 'c'.repeat(64), retrieval });
  return {
    manifest, target: 'd'.repeat(64), sequence: 0, suppressed: [],
    bindings: clusters.map((cluster, index) => ({
      clusterId: cluster.id, observedAt: '2027-01-15T08:00:00.000Z',
      records: [{ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        error_message: 'Synthetic private row', status: 'active', triage_state: null }],
    })),
    delivery: describeBatch(manifest, count),
  };
}
