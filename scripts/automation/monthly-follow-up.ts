import { appendFileSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { createInterface } from 'readline/promises';
import {
  loadAutomationMemory,
  mergeAutomationMemorySuggestions,
  saveAutomationMemory,
} from './memory';
import type { AutomationMemorySuggestion } from './types';

type FollowUpAction = 'approve' | 'reject' | 'skip';
type TerminalReadableStream = NodeJS.ReadableStream & { isTTY?: boolean };
type TerminalWritableStream = NodeJS.WritableStream & { isTTY?: boolean };

export interface MonthlyFollowUpDecision {
  suggestionId: string;
  action: FollowUpAction;
  reason?: string;
}

export interface MonthlyFollowUpResult {
  mode: 'interactive' | 'non-interactive';
  decisions: MonthlyFollowUpDecision[];
  planPath?: string;
  updatedSuggestions: AutomationMemorySuggestion[];
}

export interface MonthlyFollowUpParams {
  scriptName: string;
  monthKey: string;
  reviewPath: string;
  suggestionsPath: string;
  suggestions: AutomationMemorySuggestion[];
  knowledgeDirectory: string;
  repoRoot?: string;
  input?: TerminalReadableStream;
  output?: TerminalWritableStream;
  isInteractive?: boolean;
  decisionProvider?: (
    suggestion: AutomationMemorySuggestion,
    context: { index: number; total: number }
  ) => Promise<MonthlyFollowUpDecision> | MonthlyFollowUpDecision;
  now?: () => Date;
}

const DECISION_REASON: Record<FollowUpAction, string> = {
  approve: 'Approved during monthly automation follow-up.',
  reject: 'Rejected during monthly automation follow-up.',
  skip: 'Skipped during monthly automation follow-up.',
};

function writeLine(output: TerminalWritableStream, line = ''): void {
  output.write(`${line}\n`);
}

function formatRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/gu, '/');
}

function getPlanPath(repoRoot: string, scriptName: string, monthKey: string): string {
  return path.join(repoRoot, 'plans', 'automation', `${scriptName}-${monthKey}-upgrade-plan.md`);
}

function renderPlan(params: {
  scriptName: string;
  monthKey: string;
  reviewPath: string;
  suggestionsPath: string;
  planPath: string;
  suggestions: AutomationMemorySuggestion[];
  repoRoot: string;
}): string {
  const planRelativePath = formatRelativePath(params.repoRoot, params.planPath);
  const reviewRelativePath = formatRelativePath(params.repoRoot, params.reviewPath);
  const suggestionsRelativePath = formatRelativePath(params.repoRoot, params.suggestionsPath);
  const todos = params.suggestions.map((suggestion) => ({
    id: suggestion.id.replace(new RegExp(`^${params.scriptName}-`, 'u'), ''),
    content: suggestion.title,
  }));

  return [
    '---',
    `name: ${params.scriptName} ${params.monthKey} automation upgrades`,
    `overview: Implement approved monthly automation advisor suggestions from ${reviewRelativePath}.`,
    'todos:',
    ...todos.flatMap((todo) => [
      `  - id: ${todo.id}`,
      `    content: ${todo.content}`,
      '    status: pending',
    ]),
    'isProject: false',
    '---',
    '',
    `# ${params.scriptName} ${params.monthKey} Automation Upgrade Plan`,
    '',
    '## Source Artifacts',
    '',
    `- Advisor review: ${reviewRelativePath}`,
    `- Suggestions JSON: ${suggestionsRelativePath}`,
    `- Plan path: ${planRelativePath}`,
    '',
    '## Approved Suggestions',
    '',
    ...params.suggestions.flatMap((suggestion, index) => [
      `### ${index + 1}. ${suggestion.title}`,
      '',
      `- ID: ${suggestion.id}`,
      `- Reason: ${suggestion.reason}`,
      `- Evidence: ${suggestion.evidence.join('; ') || 'No evidence recorded.'}`,
      '',
    ]),
    '## Ready-To-Use Cursor Prompt',
    '',
    '```text',
    `Build the approved ${params.scriptName} automation upgrades from ${planRelativePath}.`,
    `Use ${reviewRelativePath} and ${suggestionsRelativePath} as source context.`,
    'Implement only the approved suggestions in this plan, keep changes scoped, add focused tests, and do not run npm run build, commit, or push.',
    '```',
    '',
  ].join('\n');
}

function appendDecisionSummary(params: {
  reviewPath: string;
  repoRoot: string;
  decisions: MonthlyFollowUpDecision[];
  suggestionsById: Map<string, AutomationMemorySuggestion>;
  planPath?: string;
  recordedAt: string;
}): void {
  const lines = [
    '',
    '## User Decisions',
    '',
    `Recorded: ${params.recordedAt}`,
    '',
    ...params.decisions.flatMap((decision) => {
      const suggestion = params.suggestionsById.get(decision.suggestionId);
      const label = decision.action === 'approve'
        ? 'approved'
        : decision.action === 'reject'
          ? 'rejected'
          : 'skipped';
      const rendered = [`- ${label}: ${suggestion?.title ?? decision.suggestionId} (${decision.suggestionId})`];
      if (decision.reason) rendered.push(`  - Reason: ${decision.reason}`);
      if (decision.action === 'approve' && params.planPath) {
        rendered.push(`  - Plan: ${formatRelativePath(params.repoRoot, params.planPath)}`);
      }
      return rendered;
    }),
    '',
  ];

  appendFileSync(params.reviewPath, lines.join('\n'), 'utf8');
}

function applyDecisions(params: {
  suggestions: AutomationMemorySuggestion[];
  decisions: MonthlyFollowUpDecision[];
  decisionAt: string;
  planPath?: string;
  repoRoot: string;
}): AutomationMemorySuggestion[] {
  const decisionsById = new Map(params.decisions.map((decision) => [decision.suggestionId, decision]));
  const relativePlanPath = params.planPath ? formatRelativePath(params.repoRoot, params.planPath) : undefined;

  return params.suggestions.map((suggestion) => {
    const decision = decisionsById.get(suggestion.id);
    if (!decision) return suggestion;

    const decisionReason = decision.reason?.trim() || DECISION_REASON[decision.action];
    if (decision.action === 'approve') {
      return {
        ...suggestion,
        status: 'approved',
        statusReason: decisionReason,
        decisionAt: params.decisionAt,
        decisionReason,
        planPath: relativePlanPath,
      };
    }

    if (decision.action === 'reject') {
      return {
        ...suggestion,
        status: 'rejected',
        statusReason: decisionReason,
        decisionAt: params.decisionAt,
        decisionReason,
      };
    }

    return {
      ...suggestion,
      status: 'pending',
      decisionAt: params.decisionAt,
      decisionReason,
    };
  });
}

function normalizeDecision(
  suggestion: AutomationMemorySuggestion,
  decision: MonthlyFollowUpDecision
): MonthlyFollowUpDecision {
  return {
    suggestionId: decision.suggestionId || suggestion.id,
    action: decision.action,
    reason: decision.reason,
  };
}

async function promptForDecision(
  suggestion: AutomationMemorySuggestion,
  context: { index: number; total: number },
  question: (query: string) => Promise<string>
): Promise<MonthlyFollowUpDecision> {
  while (true) {
    const rawAnswer = (await question(
      `Suggestion ${context.index + 1}/${context.total}: approve, decline, or skip? [a/d/s] `
    )).trim().toLowerCase();
    if (['a', 'approve', 'y', 'yes'].includes(rawAnswer)) {
      return { suggestionId: suggestion.id, action: 'approve' };
    }
    if (['d', 'decline', 'r', 'reject', 'n', 'no'].includes(rawAnswer)) {
      const reason = (await question('Decline reason (optional): ')).trim();
      return { suggestionId: suggestion.id, action: 'reject', reason: reason || undefined };
    }
    if (['', 's', 'skip'].includes(rawAnswer)) {
      return { suggestionId: suggestion.id, action: 'skip' };
    }
  }
}

export async function runMonthlyAutomationFollowUp(params: MonthlyFollowUpParams): Promise<MonthlyFollowUpResult> {
  const repoRoot = params.repoRoot ?? process.cwd();
  const input = params.input ?? process.stdin;
  const output = params.output ?? process.stdout;
  const suggestions = params.suggestions.filter((suggestion) => suggestion.source === 'advisor');
  const isInteractive = params.decisionProvider
    ? true
    : params.isInteractive ?? Boolean(input.isTTY && output.isTTY && process.env.CI !== 'true');

  if (suggestions.length === 0) {
    return { mode: isInteractive ? 'interactive' : 'non-interactive', decisions: [], updatedSuggestions: params.suggestions };
  }

  writeLine(output);
  writeLine(output, `Monthly automation advisor suggestions for ${params.scriptName} (${params.monthKey})`);
  writeLine(output, `Review: ${formatRelativePath(repoRoot, params.reviewPath)}`);
  for (const [index, suggestion] of suggestions.entries()) {
    writeLine(output, `${index + 1}. ${suggestion.title}`);
    writeLine(output, `   ${suggestion.reason}`);
  }

  if (!isInteractive) {
    writeLine(output, 'Non-interactive run detected; leaving suggestions pending.');
    return { mode: 'non-interactive', decisions: [], updatedSuggestions: params.suggestions };
  }

  const decisions: MonthlyFollowUpDecision[] = [];
  let closeReadline: (() => void) | undefined;
  let question: ((query: string) => Promise<string>) | undefined;

  if (!params.decisionProvider) {
    const readline = createInterface({ input, output });
    closeReadline = () => readline.close();
    question = (query) => readline.question(query);
  }

  try {
    for (const [index, suggestion] of suggestions.entries()) {
      writeLine(output);
      writeLine(output, `${suggestion.title}`);
      writeLine(output, `Reason: ${suggestion.reason}`);
      if (suggestion.evidence.length > 0) {
        writeLine(output, `Evidence: ${suggestion.evidence.join('; ')}`);
      }

      const decision = params.decisionProvider
        ? await params.decisionProvider(suggestion, { index, total: suggestions.length })
        : await promptForDecision(suggestion, { index, total: suggestions.length }, question!);
      decisions.push(normalizeDecision(suggestion, decision));
    }
  } finally {
    closeReadline?.();
  }

  const approvedSuggestions = suggestions.filter((suggestion) =>
    decisions.some((decision) => decision.suggestionId === suggestion.id && decision.action === 'approve')
  );
  const planPath = approvedSuggestions.length > 0 ? getPlanPath(repoRoot, params.scriptName, params.monthKey) : undefined;

  if (planPath) {
    mkdirSync(path.dirname(planPath), { recursive: true });
    writeFileSync(planPath, renderPlan({
      scriptName: params.scriptName,
      monthKey: params.monthKey,
      reviewPath: params.reviewPath,
      suggestionsPath: params.suggestionsPath,
      planPath,
      suggestions: approvedSuggestions,
      repoRoot,
    }), 'utf8');
  }

  const decisionAt = (params.now ?? (() => new Date()))().toISOString();
  const updatedSuggestions = applyDecisions({
    suggestions: params.suggestions,
    decisions,
    decisionAt,
    planPath,
    repoRoot,
  });
  const suggestionsById = new Map(updatedSuggestions.map((suggestion) => [suggestion.id, suggestion]));

  writeFileSync(params.suggestionsPath, JSON.stringify(updatedSuggestions, null, 2), 'utf8');
  appendDecisionSummary({
    reviewPath: params.reviewPath,
    repoRoot,
    decisions,
    suggestionsById,
    planPath,
    recordedAt: decisionAt,
  });

  const memory = loadAutomationMemory(params.knowledgeDirectory, params.scriptName);
  saveAutomationMemory(params.knowledgeDirectory, {
    ...memory,
    suggestions: mergeAutomationMemorySuggestions(memory.suggestions, updatedSuggestions),
  });

  if (planPath) {
    const planRelativePath = formatRelativePath(repoRoot, planPath);
    const reviewRelativePath = formatRelativePath(repoRoot, params.reviewPath);
    writeLine(output);
    writeLine(output, `Approved plan written: ${planRelativePath}`);
    writeLine(output, 'Ready-to-use Cursor prompt:');
    writeLine(output, '```text');
    writeLine(output, `Build the approved ${params.scriptName} automation upgrades from ${planRelativePath}.`);
    writeLine(output, `Use ${reviewRelativePath} as review context, run focused tests, and do not run npm run build, commit, or push.`);
    writeLine(output, '```');
  } else {
    writeLine(output);
    writeLine(output, 'No suggestions approved; no upgrade plan was written.');
  }

  return {
    mode: 'interactive',
    decisions,
    planPath,
    updatedSuggestions,
  };
}
