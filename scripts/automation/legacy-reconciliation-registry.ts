import type {
  WorkflowLegacyReconciliationKind,
  WorkflowProtocolPhase,
} from './types';

export const TRUSTED_LEGACY_RELEASE_SHA = '1b20790f899b6c4d54e27233acb41d68969d5af3';

export const CURRENT_HARDENING_WORKSTREAM_IDS = [
  'ws_96e9f347f9da5b8f',
  'ws_96e9f347f9da5b8f_lr002',
  'ws_96e9f347f9da5b8f_lc001',
  'ws_96e9f347f9da5b8f_lc002',
  'ws_96e9f347f9da5b8f_lc003',
  'ws_96e9f347f9da5b8f_lc004',
  'ws_96e9f347f9da5b8f_lc005',
  'ws_7ecf361b08ebf3b5',
  'ws_160682e6d1d29306',
  'ws_35b2dd36862f74bf',
] as const;

export type LegacyIdentityProof =
  | {
      kind: 'plan-in-commit';
      implementationCommit: string;
      planPath: string;
    }
  | {
      kind: 'manifest-to-commit';
      implementationCommit: string;
      manifestPath: string;
      manifestSha256: string;
      identityFiles: readonly string[];
    };

export interface LegacyReconciliationRegistryEntry {
  registryId: string;
  workstreamId: string;
  kind: WorkflowLegacyReconciliationKind;
  trustedReleaseSha: string;
  expectedPreviousPhase: WorkflowProtocolPhase;
  expectedNextAction: string;
  expectedBaseCommit: string;
  expectedHeadCommit: string;
  expectedCheckpointId: string | null;
  protocolPreimageSha256: string;
  identityProof: LegacyIdentityProof;
  reason: string;
  childWorkstreamId?: string;
  childExpectedPhase?: WorkflowProtocolPhase;
  childExpectedBaseCommit?: string;
  childExpectedHeadCommit?: string;
  childProtocolPreimageSha256?: string;
  childExpectedSourceWorkstreamIds?: string[] | null;
  descendantChain?: string[];
  expectedBlockerContinuity?: string[];
}

export const LIVE_LEGACY_RECONCILIATION_REGISTRY: readonly LegacyReconciliationRegistryEntry[] = [
  {
    registryId: 'released:ts-payroll-client-fixes-20260827',
    workstreamId: 'ts-payroll-client-fixes-20260827',
    kind: 'released',
    trustedReleaseSha: TRUSTED_LEGACY_RELEASE_SHA,
    expectedPreviousPhase: 'review_closed',
    expectedNextAction: 'finalise_start',
    expectedBaseCommit: '5237a42d8283ec67fa4b23509c080ea51d6ca7f2',
    expectedHeadCommit: '74ac3c2c2c53c2a61b34dc431856c00ce70b8378',
    expectedCheckpointId: null,
    protocolPreimageSha256: '3790e8d056fa84078d523dc691b8a059b989c47df16375206299a66d131f2197',
    identityProof: {
      kind: 'plan-in-commit',
      implementationCommit: '5f571fa8a430ad86aec9a783b71b538067104c63',
      planPath: 'plans/ts-payroll-client-fixes-20260827.md',
    },
    reason:
      'Timesheet/payroll client work already shipped; protocol never completed finalise-start.',
  },
  {
    registryId: 'released:ws_tee_v2_cache_serialization_20260811',
    workstreamId: 'ws_tee_v2_cache_serialization_20260811',
    kind: 'released',
    trustedReleaseSha: TRUSTED_LEGACY_RELEASE_SHA,
    expectedPreviousPhase: 'review_closed',
    expectedNextAction: 'finalise_start',
    expectedBaseCommit: '5ac1b207b888994cbe8916b28339ef17c8366ad3',
    expectedHeadCommit: '5ac1b207b888994cbe8916b28339ef17c8366ad3',
    expectedCheckpointId: null,
    protocolPreimageSha256: '2cf3ce447a71c4b489417ffc607617421e4580aff7c462cd19bc40344c7d3cdf',
    identityProof: {
      kind: 'manifest-to-commit',
      implementationCommit: 'f16c9c8c8ea7aa915464bf7a7edc44bdc38be381',
      manifestPath:
        'docs_private/automation/workstreams/ws_tee_v2_cache_serialization_20260811/preflight-f346d9b23efc689ddd328875acf57a4f.json',
      manifestSha256: '301d4342f13cd9d2a42f232d9e3f7a66bf43009828204604797a7ac03ea26213',
      identityFiles: [
        'plans/TEE_V2_IMPLEMENTATION_PLAN.md',
        'scripts/automation/workflow-events.ts',
      ],
    },
    reason: 'TEE v2 serialization leaf already shipped via f16c9c8c; protocol never finalise-started.',
  },
  {
    registryId: 'released:ws_a8d31c05f91e7b24',
    workstreamId: 'ws_a8d31c05f91e7b24',
    kind: 'released',
    trustedReleaseSha: TRUSTED_LEGACY_RELEASE_SHA,
    expectedPreviousPhase: 'finalise_ready',
    expectedNextAction: 'run_finalise',
    expectedBaseCommit: '022f28002b81406e735d953543328c2332597f12',
    expectedHeadCommit: '022f28002b81406e735d953543328c2332597f12',
    expectedCheckpointId: 'ckpt_ws_a8d31c05f91e7b24_mt0azayx_693411ad',
    protocolPreimageSha256: 'f801e3efb2cfc31c55b496d9e15a16dae0128c852d60157057341ee52611c370',
    identityProof: {
      kind: 'manifest-to-commit',
      implementationCommit: '8cf0d1e542293a75760bd2d37051902031e67534',
      manifestPath:
        'docs_private/automation/workstreams/ws_a8d31c05f91e7b24/preflight-86334f2100fe1d246f3a96bca0e87765.json',
      manifestSha256: '4cd42cfcff310cfa4faeb56feed69e5902d395709a5a31af6be3bb8eaef9b604',
      identityFiles: [
        'supabase/migrations/20260819190000_system_accounts_allowance_exclusions.sql',
        'tests/unit/system-accounts.test.ts',
      ],
    },
    reason:
      'System-account residual-risk leaf shipped after its recorded head; protocol stayed finalise_ready.',
  },
  {
    registryId: 'released:ws_hgv_service_rotation_8f3c1a',
    workstreamId: 'ws_hgv_service_rotation_8f3c1a',
    kind: 'released',
    trustedReleaseSha: TRUSTED_LEGACY_RELEASE_SHA,
    expectedPreviousPhase: 'finalise_ready',
    expectedNextAction: 'run_finalise',
    expectedBaseCommit: '49c2fa8b325979d436025b2de2c5a0825bd78a8c',
    expectedHeadCommit: '49c2fa8b325979d436025b2de2c5a0825bd78a8c',
    expectedCheckpointId: 'ckpt_ws_hgv_service_rotation_8f3c1a_msjo0jyz_27860a87',
    protocolPreimageSha256: '87318f3dd176b797a4aa69fee2d02c21824f7d501423025bfa18bd15b79c5633',
    identityProof: {
      kind: 'manifest-to-commit',
      implementationCommit: 'c4597c6475db664281ee147dd3131053d801ef07',
      manifestPath:
        'docs_private/automation/workstreams/ws_hgv_service_rotation_8f3c1a/preflight-60f2a7ea130dada86e1a907c978ed8a6.json',
      manifestSha256: 'f2d92bc2a7face60526ac72e6ca40b3edd54a71b017ca3c83bbda3a4379c15df',
      identityFiles: [
        'app/(dashboard)/maintenance/components/add-asset/AddHgvDialog.tsx',
        'app/(dashboard)/workshop-tasks/hooks/useWorkshopTaskLifecycleActions.ts',
      ],
    },
    reason: 'HGV/asset service rotation already shipped; recorded head is a skip-version wrapper.',
  },
  {
    registryId: 'released:ws_4720608c76e8b80b',
    workstreamId: 'ws_4720608c76e8b80b',
    kind: 'released',
    trustedReleaseSha: TRUSTED_LEGACY_RELEASE_SHA,
    expectedPreviousPhase: 'initialized',
    expectedNextAction: 'run_preflight',
    expectedBaseCommit: 'f1fea5ae513e2f5d4c9b417343273421f91e53a5',
    expectedHeadCommit: 'f1fea5ae513e2f5d4c9b417343273421f91e53a5',
    expectedCheckpointId: null,
    protocolPreimageSha256: 'a7af88fa97721d65ab0b5e14a88b65cde58129096924c73588151b8254467d25',
    identityProof: {
      kind: 'plan-in-commit',
      implementationCommit: '55676fca29bd29f3627229a4b7a073fe4ba31609',
      planPath: 'plans/error-log-archive.md',
    },
    reason:
      'Error-log archive already shipped in 55676fca; initialized protocol is leftover, not init-only and not a split parent of retention.',
  },
  {
    registryId: 'released:ws_a19f4c72e8b06d31',
    workstreamId: 'ws_a19f4c72e8b06d31',
    kind: 'released',
    trustedReleaseSha: TRUSTED_LEGACY_RELEASE_SHA,
    expectedPreviousPhase: 'finalise_ready',
    expectedNextAction: 'run_finalise',
    expectedBaseCommit: '3832d169',
    expectedHeadCommit: '77dd94f33317d9dfcc18a78d5b3af3c01f8af56a',
    expectedCheckpointId: 'ckpt_ws_a19f4c72e8b06d31_mt09wtu7_58b2b224',
    protocolPreimageSha256: 'b59c6499b6ce17ce561947fb455a6cccd689582ac3153dfd0b109be55cb53435',
    identityProof: {
      kind: 'manifest-to-commit',
      implementationCommit: '77dd94f33317d9dfcc18a78d5b3af3c01f8af56a',
      manifestPath:
        'docs_private/automation/workstreams/ws_a19f4c72e8b06d31/preflight-83f33d7fb356b0050ed7b8b90b2cf030.json',
      manifestSha256: 'e060c0fd7c8526a48f19bca8dbb0c233fb54977441dd0fba0b1178dd28ff6cf4',
      identityFiles: [
        'app/(dashboard)/admin/users/page.tsx',
        'app/api/admin/users/[id]/route.ts',
      ],
    },
    reason:
      'System-accounts parent already shipped; keep finalise_ready and close via a separate record. Do not invent split.',
  },
  {
    registryId: 'reconstruct:ws_vans_rls_fixerrors_20260810',
    workstreamId: 'ws_vans_rls_fixerrors_20260810',
    kind: 'reconstruct-lineage',
    trustedReleaseSha: TRUSTED_LEGACY_RELEASE_SHA,
    expectedPreviousPhase: 'split',
    expectedNextAction: 'use_split_workstream',
    expectedBaseCommit: 'c8baf451ae952a2c23871f189b0da2d27585087d',
    expectedHeadCommit: 'c8baf451ae952a2c23871f189b0da2d27585087d',
    expectedCheckpointId: null,
    protocolPreimageSha256: '5d5f06f2ad86dd76d32feb173cd7d922d1c599a62cfa77065fcdf094d579c3a9',
    identityProof: {
      kind: 'manifest-to-commit',
      implementationCommit: 'e00aa887d0f6dd7f56a9b122b84190e161d88861',
      manifestPath:
        'docs_private/automation/workstreams/ws_vans_rls_fixerrors_20260810_v2/fix-delta-bdc03974632c1e7cb11e9c1d7ccf9df6.json',
      manifestSha256: 'cea17c0393f485c53c32e8ccbb2f798aff463709bb54f9f2a9d3e3a86be2b28e',
      identityFiles: [
        'supabase/migrations/20260810_restore_inspection_van_insert_rls.sql',
        'scripts/run-restore-inspection-van-insert-rls-migration.ts',
        'tests/unit/restore-inspection-van-insert-rls-migration.test.ts',
      ],
    },
    childWorkstreamId: 'ws_vans_rls_fixerrors_20260810_v2',
    childExpectedPhase: 'finalised',
    childExpectedBaseCommit: 'c8baf451ae952a2c23871f189b0da2d27585087d',
    childExpectedHeadCommit: 'c8baf451ae952a2c23871f189b0da2d27585087d',
    childProtocolPreimageSha256: '20a8e992360731125d9feaf0d89796dd9ae0bb6773eb4a381f7ffdd85d518960',
    childExpectedSourceWorkstreamIds: null,
    expectedBlockerContinuity: ['VAN-RLS-VERIFY-001'],
    reason:
      'Orphan split: v2 continuation was finalised without sourceWorkstreamIds. Closure records the child; both protocol files stay unchanged.',
  },
];

export function findLegacyRegistryEntry(
  registry: readonly LegacyReconciliationRegistryEntry[],
  workstreamId: string,
  kind: WorkflowLegacyReconciliationKind
): LegacyReconciliationRegistryEntry | null {
  return (
    registry.find((entry) => entry.workstreamId === workstreamId && entry.kind === kind) ?? null
  );
}
