/**
 * Fix Errors - Automated Error Analysis & Report Generator
 *
 * This script:
 * 1. Fetches recent errors from the error_logs table (matching /debug page filters)
 * 2. Filters out localhost and admin errors
 * 3. Parses stack traces to extract source file paths
 * 4. Groups errors into patterns (by type + normalized message + component)
 * 5. Writes a structured markdown report to docs_private/error-analysis.md
 * 6. Updates the JSON tracking data in docs_private/error-fix-log.md
 * 7. Leaves captured rows unchanged until a validated disposition is finalized
 * 8. Prints the found / fixed-live / outstanding summary
 *
 * Usage: npm run fixerrors
 */

import { awaitChatFixerrorsReview } from './fixerrors-chat';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { resolve } from 'path';
import * as fs from 'fs';
import pg from 'pg';
import { AutomationRun } from './automation/logger';
import { TRUSTED_OPERATIONAL_ACTIONS } from './automation/trusted-operational-actions';
import { captureCandidateFingerprint } from './fixerrors-decision';
import { buildFixerrorsBatchRetrieval, fetchFixerrorsBatchSnapshot } from './fixerrors-capture';
import { createAutoAdapters, continueFixerrorsCapture, runAutomaticFixerrors, type AutoRetrieval } from './fixerrors-auto';
import {
  buildRetrievalCluster, clusterErrorPatterns, filterErrors,
  groupIntoPatterns, safeRetrievalText, splitLifecycleClusters,
  type ErrorLogEntry, type ErrorPattern, type ErrorRootCauseCluster,
} from './fixerrors-retrieval';
export {
  assertLifecycleSnapshotRows, buildRetrievalCluster, clusterErrorPatterns, extractSourceFilesForError,
  groupIntoPatterns, splitLifecycleClusters,
  type ErrorLogEntry, type ErrorPattern, type ErrorClusterLane, type ErrorRootCauseCluster,
} from './fixerrors-retrieval';
import {
  applyLifecyclePlan, fetchLifecycleRecords, hashLifecycleRecord, parseLifecyclePlan,
} from './fixerrors-lifecycle';
import { buildAutomaticLifecyclePlan, renderAutomaticLifecycleSummary } from './fixerrors-lifecycle-run';
import { renderFixerrorsRunSummary } from './fixerrors-summary';
import {
  loadRuntimeKnowledgeStore,
  rejectSensitiveDocument,
  summarizeKnowledgeOutcomes,
} from './fixerrors-knowledge';
import {
  ERROR_ANALYSIS_PATH,
  ERROR_SNAPSHOT_PATH,
  acquireErrorSnapshotArtifactLock,
  createDatabaseTargetFingerprint,
  executeVerifiedSnapshotCleanup,
  fetchOutstandingErrorLogSummaries,
  fetchProductionErrorSnapshot,
  getErrorSnapshotArtifactPath,
  markSnapshotAnalysisCompleted,
  markSnapshotCleanupNotRequired,
  purgeExpiredArchivedErrorLogs,
  runRetentionAfterArchivePhase,
  writeAndVerifyErrorSnapshot,
  writeAndVerifyTextArtifactAtomic,
  type CleanupConfirmation,
  type PgClientLike,
} from './fixerrors-safety';

export {
  acquireErrorSnapshotArtifactLock,
  createDatabaseTargetFingerprint,
  executeVerifiedSnapshotCleanup,
  fetchProductionErrorSnapshot,
  getErrorSnapshotArtifactPath,
  markSnapshotAnalysisCompleted,
  markSnapshotCleanupNotRequired,
  readAndVerifyErrorSnapshot,
  verifyErrorSnapshot,
  writeAndVerifyErrorSnapshot,
  writeAndVerifyTextArtifactAtomic,
} from './fixerrors-safety';

const ERROR_FIX_LOG_PATH = resolve(process.cwd(), 'docs_private', 'error-fix-log.md');
const ERROR_RETRIEVAL_PATH = resolve(process.cwd(), 'docs_private', 'error-analysis-retrieval.json');

// ─── Types ───────────────────────────────────────────────────────────

type FixLogEntry = {
  signature: string;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  status: 'untriaged' | 'investigating' | 'fix_applied' | 'resolved' | 'wontfix' | 'stale';
  fixerId?: string;
  plan?: string;
  notes?: string;
};

type FixLogData = {
  version: string;
  entries: FixLogEntry[];
};

type FixLogStats = {
  totalEntries: number;
  statusCounts: Record<FixLogEntry['status'], number>;
};

export { parseStackTrace } from '../lib/fixerrors/stack';
export type { SourceFileRef } from '../lib/fixerrors/stack';

function getPatternReviewMetadata(patterns: ErrorPattern[]) {
  const clusters = clusterErrorPatterns(patterns);
  return {
    topPatterns: patterns.slice(0, 10).map((pattern) => ({
      errorType: pattern.errorType,
      component: pattern.component,
      normalizedMessage: pattern.normalizedMessage,
      occurrences: pattern.occurrences.length,
      affectedPages: pattern.affectedPages.slice(0, 10),
      sourceFiles: pattern.sourceFiles.slice(0, 10).map((sourceFile) => sourceFile.file),
    })),
    patternsWithoutSourceFiles: patterns.filter((pattern) => pattern.sourceFiles.length === 0).length,
    clusters: clusters.map((cluster) => ({
      id: cluster.id,
      rootCauseFamily: cluster.rootCauseFamily,
      lane: cluster.lane,
      action: cluster.action,
      patternCount: cluster.patterns.length,
      occurrences: cluster.occurrences,
    })),
  };
}

// ─── Report Generation ───────────────────────────────────────────────

function generateReport(
  patterns: ErrorPattern[], totalFetched: number, totalFiltered: number,
  clusters = clusterErrorPatterns(patterns)
): string {
  const now = new Date().toISOString();
  const lines: string[] = [];

  lines.push('# Error Analysis Report');
  lines.push('');
  lines.push(`> **Generated:** ${now}`);
  lines.push(`> **Errors fetched from DB:** ${totalFetched} | **After filtering:** ${totalFiltered} | **Patterns found:** ${patterns.length}`);
  lines.push('');
  lines.push('This file is overwritten each time `npm run fixerrors` runs.');
  lines.push('');

  if (patterns.length === 0) {
    lines.push('## No errors found');
    lines.push('');
    lines.push('The error log is clean. No production errors (excluding localhost and admin) are present.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(
    'Mechanical clusters and TEE lanes below are advisory input for analysis by the premium parent or assigned worker, which writes `docs_private/error-analysis-decision.json`.'
  );
  lines.push('');

  lines.push('## Root Cause Clusters and TEE Routing');
  lines.push('');
  lines.push('| Cluster | Root cause family | Lane | Action | Patterns | Occurrences |');
  lines.push('|---|---|---|---|---:|---:|');
  for (const cluster of clusters) {
    lines.push(
      `| ${cluster.id} | ${cluster.rootCauseFamily} | ${cluster.lane.toUpperCase()} | ${cluster.action} | ${cluster.patterns.length} | ${cluster.occurrences} |`
    );
  }
  lines.push('');
  lines.push('Clusters are routed independently; a CRITICAL cluster does not escalate unrelated clusters.');
  lines.push('');

  // ── Section 1: Summary Table ──
  lines.push('## Summary');
  lines.push('');
  lines.push('| # | Error Type | Component | Occurrences | Affected Pages | Source Files | First Seen | Last Seen |');
  lines.push('|---|-----------|-----------|-------------|----------------|-------------|------------|-----------|');

  patterns.forEach((p, i) => {
    const srcCount = p.sourceFiles.length;
    const first = new Date(p.firstSeen).toLocaleDateString('en-GB');
    const last = new Date(p.lastSeen).toLocaleDateString('en-GB');
    lines.push(
      `| ${i + 1} | ${p.errorType} | ${p.component} | ${p.occurrences.length} | ${p.affectedPages.length} | ${srcCount} | ${first} | ${last} |`
    );
  });

  lines.push('');

  // ── Section 2: Detailed Patterns ──
  lines.push('## Error Patterns (by frequency)');
  lines.push('');

  patterns.forEach((p, i) => {
    lines.push(`### ${i + 1}. ${p.errorType} in ${p.component} (${p.occurrences.length} occurrences)`);
    lines.push('');
    lines.push(`**Normalized message:** \`${p.normalizedMessage}\``);
    lines.push('');

    // Full original message from the most recent occurrence
    const latest = p.occurrences[0];
    const fullMsg = (latest.error_message || '').substring(0, 500);
    lines.push(`**Latest full message:**`);
    lines.push('```');
    lines.push(fullMsg);
    lines.push('```');
    lines.push('');

    // Affected pages
    lines.push(`**Affected pages:** ${p.affectedPages.join(', ')}`);
    lines.push('');

    // Affected users
    lines.push(`**Affected users:** ${p.affectedUsers.length} unique (${p.affectedUsers.slice(0, 5).join(', ')}${p.affectedUsers.length > 5 ? '...' : ''})`);
    lines.push('');

    // Source files
    if (p.sourceFiles.length > 0) {
      lines.push('**Source files (from stack trace or inference):**');
      for (const ref of p.sourceFiles.slice(0, 10)) {
        const loc = ref.line ? `${ref.file}:${ref.line}${ref.column ? ':' + ref.column : ''}` : ref.file;
        lines.push(`- \`${loc}\``);
      }
      if (p.sourceFiles.length > 10) {
        lines.push(`- ...and ${p.sourceFiles.length - 10} more`);
      }
      lines.push('');
    } else {
      lines.push('**Source files:** No source file references found in stack trace');
      lines.push('');
    }

    // Stack trace excerpt (from the most recent occurrence)
    if (latest.error_stack) {
      const stackExcerpt = latest.error_stack.split('\n').slice(0, 8).join('\n');
      lines.push('**Stack trace excerpt:**');
      lines.push('```');
      lines.push(stackExcerpt);
      lines.push('```');
      lines.push('');
    }

    // Timestamps
    lines.push(`**First seen:** ${p.firstSeen} | **Last seen:** ${p.lastSeen}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  // ── Section 3: Cross-Cutting Pattern Analysis ──
  lines.push('## Pattern Analysis');
  lines.push('');

  // Group by component
  const componentGroups = new Map<string, ErrorPattern[]>();
  for (const p of patterns) {
    const comp = p.component;
    if (!componentGroups.has(comp)) componentGroups.set(comp, []);
    componentGroups.get(comp)!.push(p);
  }

  if (componentGroups.size > 0) {
    lines.push('### Errors by Component');
    lines.push('');
    for (const [comp, pats] of componentGroups) {
      const totalOccurrences = pats.reduce((sum, p) => sum + p.occurrences.length, 0);
      lines.push(`- **${comp}**: ${pats.length} pattern(s), ${totalOccurrences} total occurrences`);
    }
    lines.push('');
  }

  // Group by error type
  const typeGroups = new Map<string, ErrorPattern[]>();
  for (const p of patterns) {
    if (!typeGroups.has(p.errorType)) typeGroups.set(p.errorType, []);
    typeGroups.get(p.errorType)!.push(p);
  }

  if (typeGroups.size > 0) {
    lines.push('### Errors by Type');
    lines.push('');
    for (const [type, pats] of typeGroups) {
      const totalOccurrences = pats.reduce((sum, p) => sum + p.occurrences.length, 0);
      lines.push(`- **${type}**: ${pats.length} pattern(s), ${totalOccurrences} total occurrences`);
    }
    lines.push('');
  }

  // Identify frequently affected pages
  const pageCount = new Map<string, number>();
  for (const p of patterns) {
    for (const page of p.affectedPages) {
      pageCount.set(page, (pageCount.get(page) || 0) + p.occurrences.length);
    }
  }

  const hotPages = Array.from(pageCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (hotPages.length > 0) {
    lines.push('### Most Error-Prone Pages');
    lines.push('');
    for (const [page, count] of hotPages) {
      lines.push(`- **${page}**: ${count} error(s)`);
    }
    lines.push('');
  }

  // Identify common source files across multiple patterns
  const filePatternCount = new Map<string, number>();
  for (const p of patterns) {
    const uniqueFiles = new Set(p.sourceFiles.map((s) => s.file));
    for (const file of uniqueFiles) {
      filePatternCount.set(file, (filePatternCount.get(file) || 0) + 1);
    }
  }

  const hotFiles = Array.from(filePatternCount.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1]);

  if (hotFiles.length > 0) {
    lines.push('### Source Files Appearing in Multiple Patterns');
    lines.push('');
    for (const [file, count] of hotFiles) {
      lines.push(`- \`${file}\` appears in ${count} different error patterns`);
    }
    lines.push('');
  }

  // ── Section 4: Actionable Items ──
  lines.push('## Actionable Items');
  lines.push('');
  lines.push('The following items are recommended for investigation or fixing:');
  lines.push('');

  let actionIndex = 1;

  for (const p of patterns) {
    if (p.sourceFiles.length > 0) {
      const topFile = p.sourceFiles[0];
      const loc = topFile.line ? `${topFile.file}:${topFile.line}` : topFile.file;
      lines.push(
        `${actionIndex}. **\`${loc}\`** - ${p.errorType}: ${p.normalizedMessage.substring(0, 100)} (${p.occurrences.length}x)`
      );
    } else {
      lines.push(
        `${actionIndex}. **${p.component}** - ${p.errorType}: ${p.normalizedMessage.substring(0, 100)} (${p.occurrences.length}x) - no stack trace available, investigate component`
      );
    }
    actionIndex++;
  }

  lines.push('');
  return lines.join('\n');
}

// ─── Fix Log (Historical Tracking) ──────────────────────────────────

function loadFixLog(): FixLogData {
  if (!fs.existsSync(ERROR_FIX_LOG_PATH)) {
    return { version: '1.0.0', entries: [] };
  }

  const content = fs.readFileSync(ERROR_FIX_LOG_PATH, 'utf-8');
  const jsonMatch = content.match(/```json[\r\n]+([\s\S]*?)[\r\n]+```/);

  if (!jsonMatch) {
    console.warn('  No JSON block found in error-fix-log.md, starting fresh');
    return { version: '1.0.0', entries: [] };
  }

  try {
    return JSON.parse(jsonMatch[1]);
  } catch {
    console.error('  Failed to parse JSON from error-fix-log.md, starting fresh');
    return { version: '1.0.0', entries: [] };
  }
}

function saveFixLog(data: FixLogData) {
  if (!fs.existsSync(ERROR_FIX_LOG_PATH)) {
    // Create the file from scratch
    const content = [
      '# Error Fix Log',
      '',
      '**Last Updated:** *Auto-updated by fixerrors script*',
      '',
      'This file tracks known errors historically. See `error-analysis.md` for the latest analysis.',
      '',
      '## Machine-Readable Data',
      '',
      '```json',
      JSON.stringify(data, null, 2),
      '```',
      '',
    ].join('\n');
    fs.writeFileSync(ERROR_FIX_LOG_PATH, content, 'utf-8');
    return;
  }

  const content = fs.readFileSync(ERROR_FIX_LOG_PATH, 'utf-8');
  const newJsonBlock = `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;

  const updated = content.replace(/```json[\r\n]+[\s\S]*?[\r\n]+```/, newJsonBlock);

  if (updated !== content) {
    fs.writeFileSync(ERROR_FIX_LOG_PATH, updated, 'utf-8');
  } else {
    // JSON block not found, write the whole file
    const freshContent = [
      '# Error Fix Log',
      '',
      '**Last Updated:** *Auto-updated by fixerrors script*',
      '',
      'This file tracks known errors historically. See `error-analysis.md` for the latest analysis.',
      '',
      '## Machine-Readable Data',
      '',
      newJsonBlock,
      '',
    ].join('\n');
    fs.writeFileSync(ERROR_FIX_LOG_PATH, freshContent, 'utf-8');
  }
}

/** Create a signature compatible with the existing fix log format */
function createLegacySignature(error: ErrorLogEntry): string {
  const type = error.error_type || 'Unknown';
  const message = (error.error_message || '').trim().substring(0, 200);
  const component = error.component_name || 'NoComponent';
  let page = 'NoPage';
  try {
    page = new URL(error.page_url).pathname;
  } catch {
    page = error.page_url || 'NoPage';
  }
  return `${type}::${component}::${page}::${message}`;
}

function updateFixLog(errors: ErrorLogEntry[]): FixLogStats {
  const fixLog = loadFixLog();

  for (const error of errors) {
    const signature = createLegacySignature(error);

    const existing = fixLog.entries.find((e) => e.signature === signature);

    if (existing) {
      existing.lastSeen = error.timestamp;
      existing.occurrences++;

      if (existing.status === 'stale') {
        existing.status = 'investigating';
      }
    } else {
      fixLog.entries.push({
        signature,
        firstSeen: error.timestamp,
        lastSeen: error.timestamp,
        occurrences: 1,
        status: 'untriaged',
        plan: 'Needs investigation',
        notes: `Error Type: ${error.error_type}\nComponent: ${error.component_name || 'N/A'}\nPage: ${error.page_url}`,
      });
    }
  }

  saveFixLog(fixLog);

  const statusCounts = fixLog.entries.reduce<FixLogStats['statusCounts']>(
    (acc, entry) => {
      acc[entry.status] += 1;
      return acc;
    },
    {
      untriaged: 0,
      investigating: 0,
      fix_applied: 0,
      resolved: 0,
      wontfix: 0,
      stale: 0,
    }
  );

  return {
    totalEntries: fixLog.entries.length,
    statusCounts,
  };
}

// ─── Error Log Cleanup ───────────────────────────────────────────────

const { Client } = pg;

function requireNonPoolingConnectionString(): string {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    throw new Error(
      'POSTGRES_URL_NON_POOLING is required for transaction-safe fixerrors execution'
    );
  }
  return connectionString;
}

function createPostgresClient(connectionString: string): InstanceType<typeof Client> {
  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.replace(/^\/+/u, '') || 'postgres',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });
}

function getArgumentValue(args: string[], name: string): string | null {
  const prefix = `${name}=`;
  return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function parseCleanupConfirmation(args: string[]): CleanupConfirmation | null {
  const cleanupRequested = args.includes('--cleanup');
  if (!cleanupRequested) return null;

  const snapshotId = getArgumentValue(args, '--snapshot-id');
  const checksum = getArgumentValue(args, '--checksum');
  const rowCountValue = getArgumentValue(args, '--row-count');
  const databaseTargetFingerprint = getArgumentValue(args, '--target');
  const expiresAt = getArgumentValue(args, '--expires-at');
  const safetyContract = getArgumentValue(args, '--safety-contract');
  const manifestChecksum = getArgumentValue(args, '--manifest');
  const rowCount = Number(rowCountValue);
  if (
    !snapshotId ||
    !checksum ||
    !/^[a-f0-9]{64}$/u.test(checksum) ||
    !databaseTargetFingerprint ||
    !/^[a-f0-9]{64}$/u.test(databaseTargetFingerprint) ||
    !expiresAt ||
    Number.isNaN(new Date(expiresAt).getTime()) ||
    new Date(expiresAt).toISOString() !== expiresAt ||
    !safetyContract ||
    !manifestChecksum ||
    !/^[a-f0-9]{64}$/u.test(manifestChecksum) ||
    rowCountValue === null ||
    !Number.isSafeInteger(rowCount) ||
    rowCount < 0
  ) {
    throw new Error(
      'Cleanup requires the exact snapshot ID, checksum, row count, target, expiry, safety contract, and manifest printed by export'
    );
  }
  return {
    snapshotId,
    checksum,
    rowCount,
    databaseTargetFingerprint,
    expiresAt,
    safetyContract,
    manifestChecksum,
  };
}

export function parseLifecycleReplay(args: string[]): { planHash: string; target: string } | null {
  if (!args.some(arg => arg.startsWith('--resume-lifecycle'))) return null;
  const planHash = getArgumentValue(args, '--resume-lifecycle');
  const target = getArgumentValue(args, '--confirm-target');
  if (args.length !== 2 || !planHash || !target ||
      !/^[a-f0-9]{64}$/u.test(planHash) || !/^[a-f0-9]{64}$/u.test(target)) {
    throw new Error('Lifecycle replay requires the exact saved plan hash and database target fingerprint');
  }
  return { planHash, target };
}

const DISPOSITION_MUTATIONS = TRUSTED_OPERATIONAL_ACTIONS.fixerrors.allowedMutations.filter(
  (mutation) => mutation.operation === 'update'
);
const RETENTION_MUTATION = TRUSTED_OPERATIONAL_ACTIONS.fixerrors.allowedMutations.find(
  (mutation) => mutation.purpose === 'expired-archived-retention'
);

function retentionStepMetadata() {
  if (!RETENTION_MUTATION) {
    throw new Error('fixerrors retention mutation is not registered');
  }
  return {
    operationalCommand: TRUSTED_OPERATIONAL_ACTIONS.fixerrors.commandId,
    operationalSafetyContract: TRUSTED_OPERATIONAL_ACTIONS.fixerrors.safetyContract,
    operationalExecutionCandidate: true,
    confirmationBoundToSnapshot: false,
    retentionBoundToCandidateSet: true,
    requestedMutations: [RETENTION_MUTATION],
  };
}

function summarizeClusterLanes(clusters: ErrorRootCauseCluster[]): Record<string, number> {
  return clusters.reduce<Record<string, number>>((summary, cluster) => {
    summary[cluster.lane] = (summary[cluster.lane] ?? 0) + 1;
    return summary;
  }, {});
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const cleanupConfirmation = parseCleanupConfirmation(args);
  const lifecycleReplay = parseLifecycleReplay(args);
  const replayPlan = lifecycleReplay ? parseLifecyclePlan(JSON.parse(fs.readFileSync(
    resolve('docs_private', `fixerrors-lifecycle-${lifecycleReplay.planHash}.pre.json`), 'utf8'
  )).plan) : null;
  if (lifecycleReplay && (hashLifecycleRecord(replayPlan) !== lifecycleReplay.planHash ||
      replayPlan?.databaseTargetFingerprint !== lifecycleReplay.target)) throw new Error('Lifecycle replay receipt binding mismatch');
  const captureOnly = args.includes('--capture-only');
  const chatLed = args.includes('--chat-led');
  const workerLed = args.includes('--worker-led');
  if (!args.length) {
    throw new Error('Run fixerrors from a Codex chat with access to the local repository, tests and approved diagnostics. Use --chat-led for the chat workflow, --worker-led for optional MPDEE automation, or --capture-only for a report.');
  }
  if (!cleanupConfirmation && !lifecycleReplay && args.some(arg => !['--capture-only', '--chat-led', '--worker-led'].includes(arg))) throw new Error('Unknown fixerrors argument');
  if ((chatLed || workerLed) && (args.length !== 1 || captureOnly || cleanupConfirmation || lifecycleReplay)) throw new Error('Select exactly one fixerrors run mode');
  const autoAdapters = cleanupConfirmation || captureOnly || lifecycleReplay ? null : createAutoAdapters();
  dotenv.config({ path: resolve(process.cwd(), '.env.local') });
  const run = new AutomationRun({
    scriptName: 'fixerrors',
    mode: lifecycleReplay ? 'exact-lifecycle-replay' : cleanupConfirmation ? 'trusted-operational-cleanup' :
      captureOnly ? 'analysis-export' : chatLed ? 'chat-led-local-repair' : 'capture-and-local-repair',
    args,
    expectedArtifacts: lifecycleReplay ? [] : [
      { path: 'docs_private/error-analysis.md' },
      { path: 'docs_private/error-fix-log.md', required: false },
      { path: 'docs_private/error-snapshot.json' },
    ],
  });

  console.log('FIXERRORS - Error Analysis & Report Generator');
  console.log('=============================================\n');

  let client: InstanceType<typeof Client> | null = null;
  let releaseSnapshotArtifactLock: (() => void) | null = null;
  try {
    const connectionString = requireNonPoolingConnectionString();
    const databaseTargetFingerprint =
      createDatabaseTargetFingerprint(connectionString);
    if (lifecycleReplay && lifecycleReplay.target !== databaseTargetFingerprint) throw new Error('Lifecycle replay database target changed');
    client = createPostgresClient(connectionString);
    await client.connect();
    const databaseClient = client as unknown as PgClientLike;

    if (replayPlan) {
      const registered = TRUSTED_OPERATIONAL_ACTIONS['fixerrors-lifecycle'];
      await run.step('Replay exact acknowledged lifecycle plan', () =>
        applyLifecyclePlan(databaseClient, replayPlan, databaseTargetFingerprint), {
          operationalCommand: registered.commandId, operationalSafetyContract: registered.safetyContract,
          operationalExecutionCandidate: true, confirmationBoundToSnapshot: true, requestedMutations: registered.allowedMutations,
        });
      const active = await fetchLifecycleRecords(databaseClient, undefined, true);
      const exact = await fetchLifecycleRecords(databaseClient, replayPlan.rows.map(row => row.id));
      const summary = renderAutomaticLifecycleSummary({
        records: active.concat(exact.filter(record => record.status === 'archived')),
        plan: replayPlan, transitionApplied: true,
      });
      writeAndVerifyTextArtifactAtomic(resolve('docs_private', 'error-run-summary.txt'), summary);
      console.log(summary.trimEnd());
      await run.finish('passed');
      return;
    }

    if (cleanupConfirmation) {
      console.log('Validating bound snapshot confirmation and cleanup scope...');
      try {
        const clearResult = await run.step(
          'Execute verified transactional snapshot cleanup',
          () =>
            executeVerifiedSnapshotCleanup({
              client: databaseClient,
              confirmation: cleanupConfirmation,
              databaseTargetFingerprint,
            }),
          {
            operationalCommand: TRUSTED_OPERATIONAL_ACTIONS.fixerrors.commandId,
            operationalSafetyContract:
              TRUSTED_OPERATIONAL_ACTIONS.fixerrors.safetyContract,
            operationalExecutionCandidate: true,
            confirmationBoundToSnapshot: true,
            requestedMutations: DISPOSITION_MUTATIONS,
          }
        );
        run.recordStep({
          name: 'Record trusted operational execution',
          status: 'passed',
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          durationMs: 0,
          metadata: {
            operationalCommand: TRUSTED_OPERATIONAL_ACTIONS.fixerrors.commandId,
            operationalExecutionTrusted: true,
            operationalTrustSuspended: false,
            operationalSafetyContract:
              TRUSTED_OPERATIONAL_ACTIONS.fixerrors.safetyContract,
          },
        });
        console.log(
          `  Archived ${clearResult.clearedCount} exact exported error log entr${clearResult.clearedCount === 1 ? 'y' : 'ies'}`
        );
        console.log(`  Reconciliation: ${clearResult.reconciliationState}`);
        console.log(`  Remaining active error logs: ${clearResult.remainingCount}`);
        const retention = await run.step(
          'Purge archived error logs older than 12 months',
          async () => {
            const purged = await runRetentionAfterArchivePhase(
              'committed',
              () => purgeExpiredArchivedErrorLogs(databaseClient)
            );
            if (!purged) {
              throw new Error('Retention skipped after a committed archive');
            }
            return purged;
          },
          retentionStepMetadata()
        );
        console.log(
          `  Retention purged: ${retention.purgedCount} (eligible ${retention.eligibleCount}, cutoff ${retention.cutoffAt})`
        );
        await run.finish('passed');
        return;
      } catch (error) {
        run.recordStep({
          name: 'Suspend trusted operational execution',
          status: 'failed',
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          durationMs: 0,
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            operationalCommand: TRUSTED_OPERATIONAL_ACTIONS.fixerrors.commandId,
            operationalExecutionTrusted: false,
            operationalTrustSuspended: true,
            operationalSafetyContract:
              TRUSTED_OPERATIONAL_ACTIONS.fixerrors.safetyContract,
          },
        });
        throw error;
      }
    }

    run.recordStep({
      name: 'Recognise registered operational command',
      status: 'passed',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 0,
      metadata: {
        operationalCommand: TRUSTED_OPERATIONAL_ACTIONS.fixerrors.commandId,
        operationalExecutionTrusted: false,
        operationalTrustSuspended: false,
        operationalSafetyContract:
          TRUSTED_OPERATIONAL_ACTIONS.fixerrors.safetyContract,
        phase: 'non-destructive-export',
      },
    });

    console.log('Capturing transaction-consistent error_logs snapshot...');
    const batchCapture = await run.step(
      'Fetch complete repeatable-read production error snapshot',
      async () => captureOnly
        ? { snapshot: await fetchProductionErrorSnapshot(databaseClient, databaseTargetFingerprint), records: null }
        : fetchFixerrorsBatchSnapshot(databaseClient, databaseTargetFingerprint),
    );
    let snapshot = batchCapture.snapshot;
    const snapshotArtifactPath = getErrorSnapshotArtifactPath(
      snapshot.snapshotId
    );
    releaseSnapshotArtifactLock = acquireErrorSnapshotArtifactLock(
      snapshot.snapshotId
    );
    snapshot = await run.step(
      'Write and read-verify production error snapshot',
      () => {
        const verified = writeAndVerifyErrorSnapshot(
          snapshot,
          snapshotArtifactPath
        );
        writeAndVerifyErrorSnapshot(verified, ERROR_SNAPSHOT_PATH);
        return verified;
      },
      {
        snapshotId: snapshot.snapshotId,
        snapshotBoundary: snapshot.boundary,
        expectedRowCount: snapshot.expectedRowCount,
        exactIdCount: snapshot.exactIds.length,
      }
    );
    console.log('  Verified snapshot: docs_private/error-snapshot.json');

    const rawErrors = snapshot.errors;
    console.log(`  Captured ${rawErrors.length} error(s)`);
    const errors = filterErrors(rawErrors).sort((left, right) =>
      right.timestamp.localeCompare(left.timestamp)
    );
    const filteredOut = rawErrors.length - errors.length;
    console.log(
      `  Filtered out ${filteredOut} (localhost/admin) -> ${errors.length} remaining`
    );

    console.log('Grouping errors into root-cause patterns...');
    const patterns = await run.step(
      'Group errors into root-cause patterns',
      () => groupIntoPatterns(errors),
      {
        totalFetched: rawErrors.length,
        filteredOut,
        afterFiltering: errors.length,
      }
    );
    const patternReviewMetadata = getPatternReviewMetadata(patterns);
    const groupedClusters = clusterErrorPatterns(patterns);
    const clusters = captureOnly ? groupedClusters : splitLifecycleClusters(groupedClusters);
    const clusterLanes = summarizeClusterLanes(clusters);
    console.log(
      `  Found ${patterns.length} pattern(s) across ${clusters.length} independent cluster(s)`
    );

    const knowledge = loadRuntimeKnowledgeStore();
    const knowledgeOutcomes = summarizeKnowledgeOutcomes(knowledge);
    const candidate = captureCandidateFingerprint();
    const retrieval: AutoRetrieval = {
      schemaVersion: 1,
      snapshotId: snapshot.snapshotId,
      baseHead: candidate.baseHead,
      treeFingerprint: candidate.treeFingerprint,
      archiveMeansResolved: false,
      clusters: clusters.map(cluster => buildRetrievalCluster(cluster, knowledge)),
    };
    rejectSensitiveDocument(retrieval, 'retrieval');
    writeAndVerifyTextArtifactAtomic(ERROR_RETRIEVAL_PATH, `${JSON.stringify(retrieval, null, 2)}\n`);
    console.log('  Written and verified: docs_private/error-analysis-retrieval.json');

    console.log('Generating and validating analysis report...');
    const report = generateReport(patterns, rawErrors.length, errors.length, clusters);
    await run.step(
      'Write and read-verify error analysis report',
      () => {
        writeAndVerifyTextArtifactAtomic(ERROR_ANALYSIS_PATH, report);
      },
      {
        totalFetched: rawErrors.length,
        filteredOut,
        afterFiltering: errors.length,
        patternsFound: patterns.length,
        clusterCount: clusters.length,
        clusterLanes,
        verifiedOutcomeCount: knowledgeOutcomes.verifiedOutcomeCount,
        recurrenceCount: knowledgeOutcomes.recurrenceCount,
        ...patternReviewMetadata,
      }
    );
    console.log('  Written and verified: docs_private/error-analysis.md');

    if (errors.length > 0) {
      console.log('Updating historical fix log...');
      const fixLogStats = await run.step(
        'Update historical error fix log',
        () => updateFixLog(errors),
        { entriesProcessed: errors.length }
      );
      run.recordStep({
        name: 'Summarise historical error fix log',
        status: 'passed',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 0,
        metadata: fixLogStats,
      });
      console.log('  Updated: docs_private/error-fix-log.md');
    }

    const coveredIds = new Set<string>();
    const coverageClusters = clusters.map((cluster) => {
      const errorLogIds = cluster.patterns.flatMap((pattern) =>
        pattern.occurrences.map((occurrence) => occurrence.id)
      );
      for (const id of errorLogIds) coveredIds.add(id);
      return { id: cluster.id, errorLogIds };
    });
    snapshot = {
      ...snapshot,
      coverage: {
        clusters: coverageClusters,
        suppressedIds: rawErrors
          .map((error) => error.id)
          .filter((id) => !coveredIds.has(id)),
      },
    };
    snapshot = markSnapshotAnalysisCompleted(
      snapshot,
      report,
      clusterLanes
    );
    if (snapshot.rowCount === 0) {
      snapshot = markSnapshotCleanupNotRequired(snapshot);
    }
    snapshot = await run.step(
      'Seal verified snapshot with analysis evidence',
      () => {
        const verified = writeAndVerifyErrorSnapshot(
          snapshot,
          snapshotArtifactPath
        );
        writeAndVerifyErrorSnapshot(verified, ERROR_SNAPSHOT_PATH);
        return verified;
      },
      {
        snapshotId: snapshot.snapshotId,
        analysisStatus: snapshot.analysis.status,
        reportChecksumPresent: Boolean(snapshot.analysis.reportChecksum),
        clusterCount: snapshot.analysis.clusterCount,
        clusterLanes: snapshot.analysis.clusterLanes,
      }
    );

    const existingOutstanding = batchCapture.records
      ? batchCapture.records.held.map(row => ({
        id: row.id, summary: String(row.triage_summary ?? 'Triaged error'),
        nextStep: String(row.triage_next_step ?? 'Review the triaged error'),
      }))
      : await fetchOutstandingErrorLogSummaries(databaseClient);
    const pendingFound = clusters.map((cluster) => ({
      id: cluster.id,
      title: cluster.rootCauseFamily,
      count: cluster.patterns.reduce((total, pattern) => total + pattern.occurrences.length, 0),
      nextStep: null,
    }));
    const pendingOutstanding = [
      ...clusters.map((cluster) => ({
        id: cluster.id,
        title: cluster.rootCauseFamily,
        count: cluster.patterns.reduce((total, pattern) => total + pattern.occurrences.length, 0),
        nextStep: captureOnly ? 'Record a validated disposition, then run npm run fixerrors:finalize.' :
          'Complete the queued scoped MPDEE Worker investigation and exact-row lifecycle transition.',
      })),
      ...existingOutstanding.map((row) => ({
        id: row.id,
        title: row.summary,
        count: 1,
        nextStep: row.nextStep,
      })),
    ];
    const runSummary = renderFixerrorsRunSummary({
      found: pendingFound,
      fixedLive: [],
      outstanding: pendingOutstanding,
    }, captureOnly);
    writeAndVerifyTextArtifactAtomic(
      resolve(process.cwd(), 'docs_private', 'error-run-summary.txt'),
      runSummary
    );

    console.log('\n=============================================');
    console.log('EXPORT SUMMARY');
    console.log('=============================================');
    console.log(`  Snapshot rows:       ${snapshot.rowCount}`);
    console.log(`  After filtering:     ${errors.length}`);
    console.log(`  Patterns found:      ${patterns.length}`);
    console.log(`  Root-cause clusters: ${clusters.length}`);
    console.log('  Captured rows were not mutated. Finalization is a separate exact-ID step.');
    console.log(runSummary.trimEnd());

    await continueFixerrorsCapture({
      captureOnly,
      retention: async () => {
        const retention = await run.step(
        'Purge archived error logs older than 12 months',
        async () => {
          const purged = await runRetentionAfterArchivePhase(
            snapshot.rowCount === 0 ? 'empty-noop' : 'committed',
            () => purgeExpiredArchivedErrorLogs(databaseClient)
          );
          if (!purged) {
            throw new Error('Retention skipped after a successful archive phase');
          }
          return purged;
        },
        retentionStepMetadata()
        );
        console.log(
        `  Retention purged:     ${retention.purgedCount} (eligible ${retention.eligibleCount})`
        );
        console.log(`  Retention cutoff:     ${retention.cutoffAt}`);
      },
      recordRetention: outcome => {
        writeAndVerifyTextArtifactAtomic(resolve('docs_private', 'fixerrors-retention-outcome.json'), JSON.stringify(outcome, null, 2));
        if (outcome.status === 'blocked') console.warn(outcome.error);
      },
      continueLocal: async () => {
        if (!autoAdapters) throw new Error('Missing clean-main automatic repair authorization');
        if (!batchCapture.records) throw new Error('Missing transaction-consistent batch records');
        const { retrieval: automaticRetrieval, bindings, suppressed } = buildFixerrorsBatchRetrieval({
          snapshot, records: batchCapture.records, candidate, knowledge, clusters,
        });
        writeAndVerifyTextArtifactAtomic(resolve('docs_private', 'fixerrors-automatic-retrieval.json'), JSON.stringify(automaticRetrieval, null, 2));
        // The worker receives only the sanitized packet, never this connection or exact private records.
        await client?.end();
        client = null;
        const automatic = await run.step('Investigate new groups, then revisit held cases', () =>
          chatLed
            ? awaitChatFixerrorsReview(automaticRetrieval, snapshot.checksum, autoAdapters)
            : runAutomaticFixerrors({ retrieval: automaticRetrieval, snapshotChecksum: snapshot.checksum, adapters: autoAdapters }));
        const plan = buildAutomaticLifecyclePlan({
          result: automatic, retrieval: automaticRetrieval, bindings,
          suppressed,
          target: databaseTargetFingerprint,
        });
        writeAndVerifyTextArtifactAtomic(resolve('docs_private', 'fixerrors-lifecycle-plan.json'), JSON.stringify(plan, null, 2));
        autoAdapters.assertUnchanged(automatic.candidate);
        client = createPostgresClient(connectionString);
        await client.connect();
        let transitionApplied = false;
        let blocker: string | undefined;
        try {
          if (plan) {
            const registered = TRUSTED_OPERATIONAL_ACTIONS['fixerrors-lifecycle'];
            const lifecycleClient = client;
            await run.step('Apply exact reviewed lifecycle partition', () =>
              applyLifecyclePlan(lifecycleClient, plan, databaseTargetFingerprint), {
                operationalCommand: registered.commandId, operationalSafetyContract: registered.safetyContract,
                operationalExecutionCandidate: true, confirmationBoundToSnapshot: true, requestedMutations: registered.allowedMutations,
              });
          }
          transitionApplied = true;
        } catch (error) {
          const detail = safeRetrievalText(error instanceof Error ? error.message : 'Unknown exact-row lifecycle failure');
          blocker = `Exact-row lifecycle transition blocked: ${detail}`;
          run.recordStep({
            name: 'Suspend exact-row lifecycle transition', status: 'failed',
            startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 0,
            error: detail, metadata: {
              operationalCommand: 'fixerrors-lifecycle', operationalSafetyContract: 'fixerrors-lifecycle-exact-id-v1',
              operationalExecutionTrusted: false, operationalTrustSuspended: true,
            },
          });
          writeAndVerifyTextArtifactAtomic(resolve('docs_private', 'fixerrors-lifecycle-blocked.json'), JSON.stringify({
            blocker, resumeArgs: plan ? [`--resume-lifecycle=${hashLifecycleRecord(plan)}`, `--confirm-target=${databaseTargetFingerprint}`] : null,
          }, null, 2));
        }
        const active = await fetchLifecycleRecords(client, undefined, true);
        const reviewed = batchCapture.records.captured.concat(batchCapture.records.held)
          .filter(record => !active.some(row => row.id === record.id) &&
          (!transitionApplied || plan?.rows.some(row => row.id === record.id &&
            ['resolved-no-fix', 'fixed-live'].includes(row.metadata.state))));
        const summary = renderAutomaticLifecycleSummary({ records: active.concat(reviewed), plan, transitionApplied, blocker });
        writeAndVerifyTextArtifactAtomic(resolve('docs_private', 'error-run-summary.txt'), summary);
        console.log(summary.trimEnd());
        if (blocker) throw new Error(blocker);
        return automatic;
      },
    });
    console.log('=============================================\n');
    await run.finish('passed');
  } catch (error) {
    await run.finish('failed', error);
    throw error;
  } finally {
    releaseSnapshotArtifactLock?.();
    if (client) await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
