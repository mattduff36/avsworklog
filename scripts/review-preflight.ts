#!/usr/bin/env tsx
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { buildEvidenceManifest } from './automation/workflow-evidence-manifest';
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

Creates a content-addressed preflight evidence manifest and records it on the protocol workstream.
`);
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

  if (!workstreamId) {
    printUsage();
    process.exit(1);
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

  const built = buildEvidenceManifest({
    repoRoot,
    workstreamId,
    kind: 'preflight',
    baseCommit: protocol.baseCommit,
    requiredTestIds,
    runChecks: !skipChecks,
    runRequiredTests: !skipChecks && requiredTestIds.length > 0,
    liveVerification,
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
    command: 'preflight-record',
    workstreamId,
    manifestPath: built.relativePath,
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
