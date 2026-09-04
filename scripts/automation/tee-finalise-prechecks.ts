/**
 * Catalog of finalise READ-ONLY prechecks that may overlap.
 * Mutating finalise steps are listed so tests can prove they stay serial.
 */
import type { TeeVerifyJob, TeeVerifyJobKind } from './tee-parallel-verify';

export const FINALISE_READONLY_PRECHECK_IDS = [
  'git-unmerged',
  'git-changed-files',
  'git-branch-head',
  'protocol-readiness',
  'migration-inventory',
  'dev-server-inventory',
] as const;

export const FINALISE_SERIAL_MUTATING_IDS = [
  'finalise-start',
  'protocol-write',
  'migration-apply',
  'db-validate-write',
  'release-version-mutation',
  'commit',
  'finish',
  'push',
] as const;

export function planFinaliseReadOnlyPrechecks(readers: {
  unmergedFiles: () => unknown;
  changedFiles: () => unknown;
  branchAndHead: () => unknown;
  protocolReadiness: () => unknown;
  migrationInventory: () => unknown;
  devServerInventory: () => unknown;
}): Array<TeeVerifyJob<unknown>> {
  return [
    {
      id: 'git-unmerged',
      label: 'Git merge conflicts',
      kind: 'read_only',
      weight: 1,
      run: readers.unmergedFiles,
    },
    {
      id: 'git-changed-files',
      label: 'Git change scope',
      kind: 'read_only',
      weight: 1,
      run: readers.changedFiles,
    },
    {
      id: 'git-branch-head',
      label: 'Branch/HEAD binding',
      kind: 'read_only',
      weight: 1,
      run: readers.branchAndHead,
    },
    {
      id: 'protocol-readiness',
      label: 'Protocol readiness',
      kind: 'read_only',
      weight: 2,
      run: readers.protocolReadiness,
    },
    {
      id: 'migration-inventory',
      label: 'Migration inventory',
      kind: 'read_only',
      weight: 2,
      run: readers.migrationInventory,
    },
    {
      id: 'dev-server-inventory',
      label: 'Dev server inventory',
      kind: 'read_only',
      weight: 1,
      run: readers.devServerInventory,
    },
  ];
}

export function planFinaliseMutatingStages(): Array<{
  id: (typeof FINALISE_SERIAL_MUTATING_IDS)[number];
  kind: TeeVerifyJobKind;
  exclusive: true;
}> {
  return FINALISE_SERIAL_MUTATING_IDS.map((id) => ({
    id,
    kind: id === 'migration-apply' || id === 'db-validate-write' ? 'db' : 'protocol',
    exclusive: true as const,
  }));
}
