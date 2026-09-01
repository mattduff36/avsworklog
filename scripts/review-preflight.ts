#!/usr/bin/env tsx
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
  buildEvidenceManifest,
  runCommand,
  type EvidenceCommandResult,
} from './automation/workflow-evidence-manifest';
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
`);
}

const EXTRA_REQUIRED_TEST_COMMANDS: Record<
  string,
  { name: string; command: string; args: string[] }
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
  },
};

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
    if (contract.status === 'present' && contract.contract) {
      requiredTestIds = contract.contract.requiredTests.map((test) => test.id);
      const reasons = contract.contract.independentReviewReasons ?? [];
      if (
        reasons.includes('permissions') ||
        reasons.includes('money') ||
        reasons.includes('auth')
      ) {
        needsTimesheetsPay = true;
      }
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

  const extraCommands: EvidenceCommandResult[] = [];
  const extraExecutedIds: string[] = [];
  const extraIds = requiredTestIds.filter((id) => EXTRA_REQUIRED_TEST_COMMANDS[id]);
  const vitestTestIds = requiredTestIds.filter((id) => !EXTRA_REQUIRED_TEST_COMMANDS[id]);

  if (!skipChecks) {
    for (const id of extraIds) {
      const spec = EXTRA_REQUIRED_TEST_COMMANDS[id];
      if (!spec) continue;
      const extraResult = runCommand(repoRoot, spec.name, spec.command, spec.args);
      extraCommands.push(extraResult);
      if (extraResult.status === 'passed') {
        extraExecutedIds.push(id);
      }
    }
  }

  const built = buildEvidenceManifest({
    repoRoot,
    workstreamId,
    kind,
    baseCommit: protocol.baseCommit,
    requiredTestIds,
    vitestTestIds,
    runChecks: !skipChecks,
    runRequiredTests: !skipChecks && vitestTestIds.length > 0,
    executedTestIds: extraExecutedIds,
    commandResults: extraCommands,
    liveVerification,
    closedBlockerIds: kind === 'fix-delta' ? closedBlockerIds : undefined,
    blockerEvidence:
      kind === 'fix-delta'
        ? closedBlockerIds.map((blockerId) => ({
            blockerId,
            evidenceLabel: `required test ${blockerId}`,
            commandName: EXTRA_REQUIRED_TEST_COMMANDS[blockerId]?.name ?? 'required-tests',
          }))
        : undefined,
  });

  if (built.manifest.status !== 'passed') {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: false,
          message: 'preflight failed',
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
    command: kind === 'fix-delta' ? 'fix-record' : 'preflight-record',
    workstreamId,
    manifestPath: built.relativePath,
    closedBlockerIds: kind === 'fix-delta' ? closedBlockerIds : undefined,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: recorded.ok,
        message: recorded.message,
        manifestPath: built.relativePath,
        protocolPhase: recorded.record?.phase,
        contentHash: built.manifest.contentHash,
        exists: existsSync(built.absolutePath),
      },
      null,
      2
    )}\n`
  );
  process.exit(recorded.ok ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
