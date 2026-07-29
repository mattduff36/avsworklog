import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import {
  runMonthlyAutomationFollowUp,
  type MonthlyFollowUpDecision,
  type PendingMonthlyFollowUp,
} from './monthly-follow-up';
import {
  getWorkflowPaths,
  loadWorkflowReviewState,
  saveWorkflowReviewState,
  withWorkflowLock,
  WORKFLOW_SCRIPT_NAME,
} from './workflow-events';

interface ResolveOptions {
  pendingPath?: string;
  decisions: MonthlyFollowUpDecision[];
}

function parseDecision(value: string): MonthlyFollowUpDecision {
  const [suggestionId, actionValue] = value.split('=');
  const action = actionValue?.trim();
  if (!suggestionId || !['approve', 'reject', 'skip'].includes(action)) {
    throw new Error(`Invalid decision "${value}". Use suggestion-id=approve|reject|skip.`);
  }

  return {
    suggestionId: suggestionId.trim(),
    action: action as MonthlyFollowUpDecision['action'],
  };
}

function parseArgs(argv: string[]): ResolveOptions {
  const decisions: MonthlyFollowUpDecision[] = [];
  let pendingPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pending') {
      pendingPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--decision') {
      decisions.push(parseDecision(argv[index + 1] ?? ''));
      index += 1;
      continue;
    }
  }

  return { pendingPath, decisions };
}

function loadPendingFollowUp(pendingPath: string): PendingMonthlyFollowUp {
  return JSON.parse(readFileSync(pendingPath, 'utf8')) as PendingMonthlyFollowUp;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_|_$/gu, '')
    .slice(0, 80);
}

function writeCursorPlanCopy(planPath: string, pending: PendingMonthlyFollowUp): string {
  const cursorPlansDirectory = path.join(homedir(), '.cursor', 'plans');
  const fileName = `${slugify(`${pending.scriptName}_${pending.monthKey}_automation_upgrades`)}_${Date.now()}.plan.md`;
  const cursorPlanPath = path.join(cursorPlansDirectory, fileName);
  const planContent = readFileSync(planPath, 'utf8');

  mkdirSync(cursorPlansDirectory, { recursive: true });
  writeFileSync(cursorPlanPath, planContent, 'utf8');
  return cursorPlanPath;
}

function openCursorPlan(cursorPlanPath: string): void {
  const result = spawnSync('cursor', ['--reuse-window', cursorPlanPath], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    console.warn(`Could not open Cursor plan file automatically.${details ? `\n${details}` : ''}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.pendingPath) {
    throw new Error('Missing --pending <path>');
  }
  if (options.decisions.length === 0) {
    throw new Error('Provide at least one --decision suggestion-id=approve|reject|skip');
  }

  const pending = loadPendingFollowUp(options.pendingPath);
  const decisionsById = new Map(options.decisions.map((decision) => [decision.suggestionId, decision]));

  const unknownDecisions = options.decisions.filter(
    (decision) => !pending.suggestions.some((suggestion) => suggestion.id === decision.suggestionId)
  );
  if (unknownDecisions.length > 0) {
    throw new Error(
      `Unknown suggestion id(s): ${unknownDecisions.map((decision) => decision.suggestionId).join(', ')}`
    );
  }

  const duplicateIds = options.decisions
    .map((decision) => decision.suggestionId)
    .filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    throw new Error(`Duplicate decision id(s): ${[...new Set(duplicateIds)].join(', ')}`);
  }

  const result = await runMonthlyAutomationFollowUp({
    scriptName: pending.scriptName,
    monthKey: pending.monthKey,
    reviewPath: pending.reviewPath,
    suggestionsPath: pending.suggestionsPath,
    suggestions: pending.suggestions,
    knowledgeDirectory: pending.knowledgeDirectory,
    repoRoot: pending.repoRoot,
    reviewWindowId: pending.reviewWindowId,
    decisionProvider: (suggestion) => decisionsById.get(suggestion.id) ?? {
      suggestionId: suggestion.id,
      action: 'skip',
    },
  });

  if (options.pendingPath && existsSync(options.pendingPath)) {
    const resolvedPath = `${options.pendingPath}.resolved`;
    renameSync(options.pendingPath, resolvedPath);
  }

  if (pending.scriptName === WORKFLOW_SCRIPT_NAME) {
    const paths = getWorkflowPaths(pending.repoRoot);
    withWorkflowLock(paths.lockPath, () => {
      const state = loadWorkflowReviewState(paths.statePath);
      if (state.pendingFollowUpPath === options.pendingPath || !state.pendingFollowUpPath) {
        saveWorkflowReviewState(paths.statePath, {
          ...state,
          pendingFollowUpPath: null,
        });
      }
    });
  }

  if (result.planPath) {
    const cursorPlanPath = writeCursorPlanCopy(result.planPath, pending);
    console.log(`Cursor plan file: ${cursorPlanPath}`);
    openCursorPlan(cursorPlanPath);
    console.log('Opened this Cursor plan file for review and the normal Build flow.');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
