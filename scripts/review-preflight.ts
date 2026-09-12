#!/usr/bin/env tsx
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
  buildEvidenceManifestAsync,
  runCommandAsync,
} from './automation/workflow-evidence-manifest';
import {
  captureFrozenVerifyCandidate,
  createVerifyProgressReporter,
  resolveTeeVerifyJobs,
} from './automation/tee-parallel-verify';
import { collectPremiumPacketEvidence } from './automation/tee-premium-packet';
import {
  applyProtocolTransition,
  readProtocolRecord,
} from './automation/workflow-review-protocol';
import {
  buildFixtureTimesheetsPayInventory,
  runLiveTimesheetsPayInventory,
  validateTimesheetsPayInventoryCompleteness,
} from './automation/workflow-sensitive-inventory';
import {
  extractPlanContractMarker,
  resolvePlanPath,
} from './automation/workflow-plan-contract';
import { runVitestJsonAndPersistLedgerAsync } from './automation/workflow-verification-ledger';
import {
  buildChildTestEnv,
  createDefaultDependencies,
  createLocalTestPostgresOrchestrator,
  DAILY_ALLOCATION_SAFETY_TARGET_TEST_FILE,
  DELETE_USER_LEAVE_LOCK_TARGET_TEST_FILE,
  deriveCheckoutIdentity,
  formatLocalTestDatabaseUrl,
  buildDatabaseComment,
  getLifecyclePaths,
  isInheritedDatabaseUrlKey,
  parseLifecycleState,
  PROVENANCE_ENV_KEYS,
  validateLocalTestDatabaseUrl,
} from './local-test-postgres';
import { withNativeTestPostgres } from './local-native-test-postgres';

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function printUsage(): void {
  process.stdout.write(`Usage:
  npm run review:preflight -- --workstream <id> [--plan <path>] [--profile timesheets-pay] [--live-db] [--skip-checks]
  npm run review:preflight -- --workstream <id> --kind fix-delta --closed-blocker-ids <csv> [--plan <path>]

Creates a content-addressed evidence manifest and records it on the protocol workstream.

Use --kind fix-delta after a failed first review. --closed-blocker-ids is required for that kind.
On phase fix_recorded, this records a fix-delta-refresh bound to the current HEAD/tree.

Independent read-only checks run concurrently. Set TEE_VERIFY_JOBS=1 for serial fallback.
`);
}

const EXTRA_REQUIRED_TEST_COMMANDS: Record<
  string,
  { name: string; command: string; args: string[]; kind: 'db' }
> = {
  'HGV-SAVE-CONC-01': {
    name: 'required-test-HGV-SAVE-CONC-01',
    command: 'npx',
    args: [
      'tsx',
      'scripts/local-test-postgres.ts',
      'one-shot',
      '--target',
      'tests/db/hgv-inspection-save-rpc.test.ts',
    ],
    kind: 'db',
  },
};

const LOCAL_POSTGRES_LEDGER_TEST_IDS = {
  'DEL-AL-08': DELETE_USER_LEAVE_LOCK_TARGET_TEST_FILE,
} as const;

const DAILY_ALLOCATION_SAFETY_REQUIRED_IDS = [
  'DAFP-FLAG-001',
  'DAFP-DB-001',
  'DAFP-DB-002',
  'DAFP-DB-003',
  'DAFP-IDEM-001',
  'DAFP-IDEM-002',
  'DAFP-CAS-001',
  'DAFP-LOCK-001',
  'DAFP-PLANT-001',
  'DAFP-AUTH-001',
  'DAFP-PUB-001',
] as const;

function restoreProcessEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function runDisposablePostgresRequiredTestLedger(params: {
  repoRoot: string;
  workstreamId: string;
  requiredId: keyof typeof LOCAL_POSTGRES_LEDGER_TEST_IDS;
}): Promise<{
  kind: 'vitest';
  name: string;
  files: string[];
  run: Awaited<ReturnType<typeof runVitestJsonAndPersistLedgerAsync>>;
}> {
  const targetFile = LOCAL_POSTGRES_LEDGER_TEST_IDS[params.requiredId];
  const commandId = `required-test-${params.requiredId}`;
  const orch = createLocalTestPostgresOrchestrator(
    createDefaultDependencies({ repoRoot: params.repoRoot })
  );
  orch.setTargetTestFile(targetFile);
  let started = false;
  const previousEnv: Record<string, string | undefined> = {};
  const assignEnv = (key: string, value: string) => {
    if (!(key in previousEnv)) {
      previousEnv[key] = process.env[key];
    }
    process.env[key] = value;
  };
  try {
    await orch.start();
    started = true;
    const deps = createDefaultDependencies({ repoRoot: params.repoRoot });
    const identity = deriveCheckoutIdentity(await deps.realpath(params.repoRoot));
    const paths = getLifecyclePaths(deps.tmpDir, identity.projectName);
    const state = parseLifecycleState(await deps.readFile(paths.stateFile));
    const url = validateLocalTestDatabaseUrl(
      formatLocalTestDatabaseUrl(identity.hostPort),
      identity.hostPort
    );
    assignEnv('TEST_DATABASE_URL', url);
    assignEnv(PROVENANCE_ENV_KEYS.marker, buildDatabaseComment(state.projectId, state.nonce));
    assignEnv(PROVENANCE_ENV_KEYS.project, identity.projectName);
    assignEnv(PROVENANCE_ENV_KEYS.port, String(identity.hostPort));
    const run = await runVitestJsonAndPersistLedgerAsync({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      commandId,
      commandType: 'vitest_case',
      files: [targetFile],
      requiredIds: [params.requiredId],
    });
    return {
      kind: 'vitest',
      name: commandId,
      files: [targetFile],
      run,
    };
  } finally {
    restoreProcessEnv(previousEnv);
    if (started) {
      await orch.stop();
    }
  }
}

function isDockerUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as NodeJS.ErrnoException).code;
  return (
    message.includes('Docker is not available') ||
    /spawn docker(?:\.exe)? ENOENT/iu.test(message) ||
    (code === 'ENOENT' && /docker/iu.test(message))
  );
}

async function persistDailyAllocationSafetyLedger(params: {
  repoRoot: string;
  workstreamId: string;
  requiredIds: string[];
  assignEnv: (key: string, value: string | undefined) => void;
  databaseUrl: string;
  marker: string;
  projectName: string;
  hostPort: number;
}): Promise<{
  kind: 'vitest';
  name: string;
  files: string[];
  run: Awaited<ReturnType<typeof runVitestJsonAndPersistLedgerAsync>>;
}> {
  const childEnv = buildChildTestEnv({
    parentEnv: process.env,
    databaseUrl: params.databaseUrl,
    marker: params.marker,
    projectName: params.projectName,
    hostPort: params.hostPort,
  });
  for (const key of Object.keys(process.env)) {
    if (isInheritedDatabaseUrlKey(key) || key === 'TEST_DATABASE_URL') {
      params.assignEnv(key, undefined);
    }
  }
  for (const [key, value] of Object.entries(childEnv)) {
    params.assignEnv(key, value);
  }
  const run = await runVitestJsonAndPersistLedgerAsync({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    commandId: 'required-test-daily-allocation-safety',
    commandType: 'vitest_case',
    files: [DAILY_ALLOCATION_SAFETY_TARGET_TEST_FILE],
    requiredIds: params.requiredIds,
  });
  return {
    kind: 'vitest',
    name: 'required-test-daily-allocation-safety',
    files: [DAILY_ALLOCATION_SAFETY_TARGET_TEST_FILE],
    run,
  };
}

async function runDailyAllocationSafetyRequiredTestLedger(params: {
  repoRoot: string;
  workstreamId: string;
  requiredIds: string[];
}): Promise<{
  kind: 'vitest';
  name: string;
  files: string[];
  run: Awaited<ReturnType<typeof runVitestJsonAndPersistLedgerAsync>>;
}> {
  const previousEnv: Record<string, string | undefined> = {};
  const assignEnv = (key: string, value: string | undefined) => {
    if (!(key in previousEnv)) {
      previousEnv[key] = process.env[key];
    }
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };
  try {
    const orch = createLocalTestPostgresOrchestrator(
      createDefaultDependencies({ repoRoot: params.repoRoot })
    );
    orch.setTargetTestFile(DAILY_ALLOCATION_SAFETY_TARGET_TEST_FILE);
    try {
      await orch.start();
      const deps = createDefaultDependencies({ repoRoot: params.repoRoot });
      const identity = deriveCheckoutIdentity(await deps.realpath(params.repoRoot));
      const paths = getLifecyclePaths(deps.tmpDir, identity.projectName);
      const state = parseLifecycleState(await deps.readFile(paths.stateFile));
      const url = validateLocalTestDatabaseUrl(
        formatLocalTestDatabaseUrl(identity.hostPort),
        identity.hostPort
      );
      return await persistDailyAllocationSafetyLedger({
        repoRoot: params.repoRoot,
        workstreamId: params.workstreamId,
        requiredIds: params.requiredIds,
        assignEnv,
        databaseUrl: url,
        marker: buildDatabaseComment(state.projectId, state.nonce),
        projectName: identity.projectName,
        hostPort: identity.hostPort,
      });
    } catch (error) {
      if (!isDockerUnavailable(error)) throw error;
    } finally {
      await orch.stop().catch(() => undefined);
    }

    return await withNativeTestPostgres(params.repoRoot, async (session) =>
      persistDailyAllocationSafetyLedger({
        repoRoot: params.repoRoot,
        workstreamId: params.workstreamId,
        requiredIds: params.requiredIds,
        assignEnv,
        databaseUrl: session.databaseUrl,
        marker: session.marker,
        projectName: session.projectName,
        hostPort: session.hostPort,
      })
    );
  } finally {
    restoreProcessEnv(previousEnv);
  }
}

async function maybeLiveInventory(liveDb: boolean) {
  if (!liveDb) {
    const fixture = buildFixtureTimesheetsPayInventory();
    const completeness = validateTimesheetsPayInventoryCompleteness(fixture);
    // Fixture inventory is discovery-only; never treat as live authorization proof.
    return {
      inventory: {
        ...fixture,
        status: 'passed' as const,
        mode: 'fixture' as const,
        summary: `${fixture.summary} (fixture; live verification skipped)`,
      },
      completeness,
      liveStatus: 'skipped' as const,
    };
  }

  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING required for --live-db');
  }
  const pg = await import('pg');
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const inventory = await runLiveTimesheetsPayInventory({ client });
    const completeness = validateTimesheetsPayInventoryCompleteness(inventory);
    return {
      inventory,
      completeness,
      liveStatus:
        completeness.ok && inventory.status === 'passed'
          ? ('passed' as const)
          : ('failed' as const),
    };
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.length === 0) {
    printUsage();
    process.exit(args.includes('--help') ? 0 : 1);
  }

  const repoRoot = path.resolve(readFlag(args, '--repo-root') ?? process.cwd());
  const workstreamId = readFlag(args, '--workstream');
  const planPath = readFlag(args, '--plan');
  const profile = readFlag(args, '--profile');
  const skipChecks = hasFlag(args, '--skip-checks');
  const liveDb = hasFlag(args, '--live-db');
  const kind = readFlag(args, '--kind') === 'fix-delta' ? 'fix-delta' : 'preflight';
  const closedBlockerIds = (readFlag(args, '--closed-blocker-ids') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (!workstreamId) {
    printUsage();
    process.exit(1);
  }
  if (kind === 'fix-delta' && closedBlockerIds.length === 0) {
    throw new Error('--closed-blocker-ids is required for --kind fix-delta');
  }

  let requiredTestIds: string[] = [];
  let needsTimesheetsPay = profile === 'timesheets-pay';

  let protocol = readProtocolRecord(repoRoot, workstreamId);
  if (!protocol) {
    const init = applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId,
      planPath,
    });
    if (!init.ok || !init.record) {
      throw new Error(init.message);
    }
    protocol = init.record;
  }

  const effectivePlanPath = planPath ?? protocol.planPath ?? undefined;
  if (effectivePlanPath) {
    const resolved = resolvePlanPath({ candidatePath: effectivePlanPath, repoRoot });
    if (resolved.status !== 'ok' || !resolved.absolutePath) {
      throw new Error(`invalid plan path: ${resolved.errors.join('; ')}`);
    }
    const contract = extractPlanContractMarker(readFileSync(resolved.absolutePath, 'utf8'));
    if (contract.status !== 'present' || !contract.contract) {
      throw new Error(
        `plan contract is ${contract.status}: ${(contract.errors ?? []).join('; ')}`
      );
    }
    requiredTestIds = contract.contract.requiredTests.map((test) => test.id);
    if (contract.contract.risk === 'high' && requiredTestIds.length === 0) {
      throw new Error('high-risk plan requiredTests are empty');
    }
    const reasons = contract.contract.independentReviewReasons ?? [];
    if (
      reasons.includes('permissions') ||
      reasons.includes('money') ||
      reasons.includes('auth')
    ) {
      needsTimesheetsPay = true;
    }
  }

  let liveVerification:
    | {
        profile: string;
        status: 'passed' | 'failed' | 'skipped' | 'unknown';
        summary: string;
      }
    | undefined;

  if (needsTimesheetsPay) {
    const { inventory, completeness, liveStatus } = await maybeLiveInventory(liveDb);
    liveVerification = {
      profile: 'timesheets-pay',
      status: completeness.ok ? liveStatus : 'failed',
      summary: completeness.ok
        ? inventory.summary
        : `incomplete inventory: ${completeness.missing.join(', ')}`,
    };
    // Fixture/deferred mode must not execute or complete WF-PAY-* behavioral IDs.
    if (liveDb) {
      requiredTestIds = [
        ...new Set([...requiredTestIds, ...inventory.requiredBehavioralTestIds]),
      ];
    } else {
      requiredTestIds = requiredTestIds.filter((id) => !id.startsWith('WF-PAY-'));
    }
  }

  const extraIds = requiredTestIds.filter((id) => EXTRA_REQUIRED_TEST_COMMANDS[id]);
  const extraLedgerIds = requiredTestIds.filter(
    (id): id is keyof typeof LOCAL_POSTGRES_LEDGER_TEST_IDS =>
      Object.prototype.hasOwnProperty.call(LOCAL_POSTGRES_LEDGER_TEST_IDS, id)
  );
  const dailyAllocationSafetyIds = requiredTestIds.filter((id): id is (typeof DAILY_ALLOCATION_SAFETY_REQUIRED_IDS)[number] =>
    (DAILY_ALLOCATION_SAFETY_REQUIRED_IDS as readonly string[]).includes(id)
  );
  const extraJobs: NonNullable<Parameters<typeof buildEvidenceManifestAsync>[0]['extraJobs']> =
    [];
  if (!skipChecks) {
    for (const id of extraIds) {
      const spec = EXTRA_REQUIRED_TEST_COMMANDS[id];
      if (!spec) continue;
      extraJobs.push({
        id: spec.name,
        label: spec.name,
        kind: spec.kind,
        exclusive: true,
        weight: 3,
        run: () => runCommandAsync(repoRoot, spec.name, spec.command, spec.args),
      });
    }
    for (const id of extraLedgerIds) {
      extraJobs.push({
        id: `required-test-${id}`,
        label: `required-test-${id}`,
        kind: 'db',
        exclusive: true,
        weight: 3,
        run: () =>
          runDisposablePostgresRequiredTestLedger({
            repoRoot,
            workstreamId,
            requiredId: id,
          }),
      });
    }
    if (dailyAllocationSafetyIds.length > 0) {
      extraJobs.push({
        id: 'required-test-daily-allocation-safety',
        label: 'required-test-daily-allocation-safety',
        kind: 'db',
        exclusive: true,
        weight: 3,
        run: () =>
          runDailyAllocationSafetyRequiredTestLedger({
            repoRoot,
            workstreamId,
            requiredIds: dailyAllocationSafetyIds,
          }),
      });
    }
  }

  const candidateCapture = captureFrozenVerifyCandidate({ repoRoot, workstreamId });
  if (!candidateCapture.ok) {
    throw new Error(candidateCapture.message);
  }
  const progress = createVerifyProgressReporter({
    title: kind === 'fix-delta' ? 'TEE fix-delta' : 'TEE preflight',
    workstreamId,
    candidate: candidateCapture.candidate,
    stream: process.stderr,
  });
  progress.stageStart('candidate');
  progress.stageFinish('candidate', 'passed', candidateCapture.candidate.headCommit.slice(0, 12));
  progress.stageStart('foundation');
  if (!protocol.workstreamId || protocol.workstreamId !== workstreamId) {
    throw new Error('workstream identity does not match the protocol record');
  }
  progress.stageFinish('foundation', 'passed', `${resolveTeeVerifyJobs()} verify jobs`);

  const built = await buildEvidenceManifestAsync({
    repoRoot,
    workstreamId,
    kind,
    baseCommit: protocol.baseCommit,
    requiredTestIds,
    runChecks: !skipChecks,
    runRequiredTests: !skipChecks,
    extraJobs,
    liveVerification,
    closedBlockerIds: kind === 'fix-delta' ? closedBlockerIds : undefined,
    candidate: candidateCapture.candidate,
    progress,
  });

  progress.stageStart('required-ids');
  const requiredReady = built.manifest.requiredTests.every(
    (test) => test.status === 'completed' && test.executed
  );
  progress.stageFinish('required-ids', requiredReady ? 'passed' : 'failed');
  progress.stageStart('convergence');
  const converged =
    built.manifest.headCommit === candidateCapture.candidate.headCommit &&
    built.manifest.productTreeFingerprint === candidateCapture.candidate.fingerprint;
  progress.stageFinish('convergence', converged ? 'passed' : 'failed');

  if (built.manifest.status !== 'passed' || !converged) {
    progress.complete('failed');
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: false,
          message: converged ? 'preflight failed' : 'preflight candidate drifted',
          manifestPath: built.relativePath,
          manifest: {
            status: built.manifest.status,
            requiredTests: built.manifest.requiredTests,
            commands: built.manifest.commands,
            liveVerification: built.manifest.liveVerification,
          },
        },
        null,
        2
      )}\n`
    );
    process.exit(1);
  }

  const recorded = applyProtocolTransition({
    repoRoot,
    command:
      kind === 'fix-delta'
        ? protocol.phase === 'fix_recorded'
          ? 'fix-delta-refresh'
          : 'fix-record'
        : 'preflight-record',
    workstreamId,
    manifestPath: built.relativePath,
    closedBlockerIds: kind === 'fix-delta' ? closedBlockerIds : undefined,
  });

  let packetPath: string | null = null;
  if (recorded.ok) {
    const packet = await collectPremiumPacketEvidence({
      repoRoot,
      workstreamId,
      pass: kind === 'fix-delta' ? 'closure' : 'first',
      candidate: candidateCapture.candidate,
    });
    if (packet.ok) packetPath = packet.relativePath;
  }
  progress.complete(recorded.ok ? 'passed' : 'failed');

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: recorded.ok,
        message: recorded.message,
        manifestPath: built.relativePath,
        protocolPhase: recorded.record?.phase,
        contentHash: built.manifest.contentHash,
        exists: existsSync(built.absolutePath),
        packetPath,
      },
      null,
      2
    )}\n`
  );
  process.exit(recorded.ok ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
