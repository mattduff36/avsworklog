import { createReadStream, existsSync, statSync } from 'fs';
import { createInterface } from 'readline';
import { extractWorkflowCompletionMarker } from './workflow-marker';
import type { WorkflowTranscriptSignals } from './types';

export const WORKFLOW_TRANSCRIPT_ADAPTER_VERSION = '1';
const MAX_TRANSCRIPT_BYTES = 8_000_000;
const MAX_LINE_LENGTH = 500_000;

export interface TranscriptParseResult {
  signals: WorkflowTranscriptSignals;
  assistantText: string;
}

function emptySignals(parseErrors: string[] = []): WorkflowTranscriptSignals {
  return {
    adapterVersion: WORKFLOW_TRANSCRIPT_ADAPTER_VERSION,
    skillRead: false,
    architectureGateTask: false,
    finalDiffReviewerTask: false,
    exploreTask: false,
    truncatedShellEvidence: false,
    bulkInsertionScriptEvidence: false,
    duplicateBroadSearchAfterExplore: false,
    gitCommitEvidence: false,
    markerPresent: false,
    parseErrors,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      const record = asRecord(part);
      if (!record) return '';
      if (record.type === 'text' && typeof record.text === 'string') return record.text;
      return '';
    })
    .join('\n');
}

function inspectToolUse(
  part: Record<string, unknown>,
  signals: WorkflowTranscriptSignals,
  counters: {
    exploreSeen: boolean;
    broadSearchSignatures: Set<string>;
  }
): void {
  if (part.type !== 'tool_use') return;
  const name = typeof part.name === 'string' ? part.name : '';
  const input = asRecord(part.input) ?? {};

  if (name === 'Read' || name === 'ReadFile') {
    const filePath = typeof input.path === 'string' ? input.path : '';
    if (/token-efficient-engineering[\\/]+SKILL\.md/iu.test(filePath)) {
      signals.skillRead = true;
    }
  }

  if (name === 'Task' || name === 'Subagent') {
    const subagentType = typeof input.subagent_type === 'string' ? input.subagent_type : '';
    if (subagentType === 'architecture-gate') signals.architectureGateTask = true;
    if (subagentType === 'final-diff-reviewer') signals.finalDiffReviewerTask = true;
    if (subagentType === 'explore') {
      signals.exploreTask = true;
      counters.exploreSeen = true;
    }
  }

  if ((name === 'Grep' || name === 'rg' || name === 'Glob') && counters.exploreSeen) {
    const signature = JSON.stringify({
      name,
      pattern: input.pattern ?? null,
      glob: input.glob ?? input.glob_pattern ?? null,
      path: input.path ?? null,
    });
    if (counters.broadSearchSignatures.has(signature)) {
      signals.duplicateBroadSearchAfterExplore = true;
    } else {
      counters.broadSearchSignatures.add(signature);
    }
  }

  if (name === 'Shell') {
    const command = typeof input.command === 'string' ? input.command : '';
    if (
      /\|\s*head\b|\|\s*tail\b|\bhead\s+-[nc]\b|\btail\s+-n\b|\.slice\(\s*0\s*,\s*\d+/iu.test(command) ||
      /\bhead\s+-c\b/iu.test(command)
    ) {
      signals.truncatedShellEvidence = true;
    }
    if (/\bgit\s+commit\b/iu.test(command)) {
      signals.gitCommitEvidence = true;
    }
    if (
      /\bbulk[-_ ]?(?:text[-_ ]?)?(?:import|insert|insertion)\b/iu.test(command) ||
      /python(?:3)?\b[^\n]*\b(?:insert|rewrite).*(?:import|across files|many files)/iu.test(command)
    ) {
      signals.bulkInsertionScriptEvidence = true;
    }
  }
}

export async function parseWorkflowTranscript(transcriptPath: string | null): Promise<TranscriptParseResult> {
  if (!transcriptPath) {
    return {
      signals: emptySignals(['transcript_path was null']),
      assistantText: '',
    };
  }

  if (!existsSync(transcriptPath)) {
    return {
      signals: emptySignals(['transcript file not found']),
      assistantText: '',
    };
  }

  const stats = statSync(transcriptPath);
  if (stats.size > MAX_TRANSCRIPT_BYTES) {
    return {
      signals: emptySignals([`transcript exceeds ${MAX_TRANSCRIPT_BYTES} bytes`]),
      assistantText: '',
    };
  }

  const signals = emptySignals();
  const counters = { exploreSeen: false, broadSearchSignatures: new Set<string>() };
  const assistantChunks: string[] = [];
  let sawBom = false;

  const stream = createReadStream(transcriptPath, { encoding: 'utf8' });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const rawLine of reader) {
    let line = rawLine;
    if (!sawBom && line.charCodeAt(0) === 0xfeff) {
      line = line.slice(1);
      sawBom = true;
    }
    if (!line.trim()) continue;
    if (line.length > MAX_LINE_LENGTH) {
      signals.parseErrors.push('skipped oversized JSONL line');
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      signals.parseErrors.push('skipped malformed JSONL line');
      continue;
    }

    const record = asRecord(parsed);
    if (!record) continue;

    if (record.role === 'assistant') {
      const message = asRecord(record.message);
      const content = message?.content;
      const text = collectText(content);
      if (text) assistantChunks.push(text);
      if (Array.isArray(content)) {
        for (const part of content) {
          const partRecord = asRecord(part);
          if (partRecord) inspectToolUse(partRecord, signals, counters);
        }
      }
    }
  }

  const assistantText = assistantChunks.join('\n');
  const marker = extractWorkflowCompletionMarker(assistantText);
  signals.markerPresent = marker.status === 'present';

  return { signals, assistantText };
}
