import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { captureCandidateFingerprint } from '../fixerrors-decision';
import { FIXERRORS_WORKSPACE } from './fixerrors-device-admission';
import { encodeCompanionPacket, prepareCompanionPacket } from './fixerrors-companion-packet';

export function controlledAcceptancePacket(candidate: { baseHead: string; treeFingerprint: string }) {
  const source = 'lib/utils/fixerrors-controlled-acceptance.ts';
  return encodeCompanionPacket({
    schemaVersion: 1,
    snapshotChecksum: createHash('sha256').update('SYNTHETIC test-only Fixerrors acceptance; no production record').digest('hex'),
    retrieval: {
      schemaVersion: 1, snapshotId: randomUUID(), ...candidate, archiveMeansResolved: false,
      clusters: [{
        id: 'cluster-1', rootCauseFamily: 'SYNTHETIC test-only label fixture', advisoryLane: 'fast', advisoryAction: 'fix',
        query: {
          errorContextId: null, httpStatus: null, route: '/synthetic-acceptance-only', component: 'SyntheticLabelFixture',
          sourceFile: source, normalizedMessage: 'SYNTHETIC fixture requires trimming both ends; expected failure is test-only',
          rootCauseFamily: 'SYNTHETIC test-only label fixture',
        },
        sourceFiles: [source], patterns: [], priorResolutions: [],
      }],
    },
  }, candidate);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--prepare-synthetic-test-only-packet') {
    console.error('Explicit synthetic test-only packet preparation required');
    process.exitCode = 1;
  } else {
    (async () => {
      const bytes = controlledAcceptancePacket(captureCandidateFingerprint(FIXERRORS_WORKSPACE));
      async function* input() { yield bytes; }
      const digest = await prepareCompanionPacket(input());
      console.info(`SYNTHETIC test-only packet prepared: SHA-256 ${digest}. No incident capture, worker or release was run.`);
    })().catch(() => {
      console.error('Synthetic preparation blocked; requires clean fixed main and absent packet/lock. Do not reset existing state.');
      process.exitCode = 1;
    });
  }
}
