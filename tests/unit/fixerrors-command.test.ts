import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { FIXERRORS_COMMAND_MANDATED_REVIEW_REASON } from '@/scripts/automation/workflow-review';

const root = process.cwd();
const command = readFileSync(path.join(root, '.cursor', 'commands', 'fixerrors.md'), 'utf8');
const analysisScript = readFileSync(path.join(root, 'scripts', 'fixerrors.ts'), 'utf8');

describe('fixerrors command orchestration', () => {
  it('documents the guarded default lifecycle separately from capture-only and live release', () => {
    for (const text of ['clean local main', 'MPDEE Worker', 'new-first', 'oldest-first',
      '30 days without matching new evidence', 'awaiting-deployment', 'account-merge',
      '--capture-only', '--resume-lifecycle', 'No application fixes, no commits, no production SQL']) {
      expect(command.toLowerCase()).toContain(text.toLowerCase());
    }
    expect(command).toContain('without the legacy generic `Say "fix"` invitation');
    expect(command).toContain('fail closed');
    expect(command).toContain('separately approved deployment');
  });
  it('FIXERR-CMD-001 keeps the v4 snapshot/archive safety contract', () => {
    expect(command).toContain('safetyContract":"fixerrors-exact-snapshot-v5"');
    expect(command).toContain('Errors found');
    expect(command).toContain('Errors fixed live');
    expect(command).toContain('Errors still outstanding');
    expect(command).toContain('Outstanding work remains: YES');
    expect(command).toContain('Final recommendation');
    expect(command).toContain('Say "fix" to proceed with this recommendation now.');
    expect(command).toContain('npm run fixerrors');
    expect(command).toContain('npm run fixerrors -- --cleanup');
    expect(command).toContain('Automatically implement FAST, STANDARD, and GUARDED clusters.');
    expect(command).toContain('Pause for explicit owner approval before any CRITICAL implementation');
    expect(command).toContain('final-diff-reviewer');
    expect(command).toContain('Never push.');
    expect(command).toContain('npm run fixerrors:validate-decision');
    expect(command).toContain('Never stage `docs_private`');
    expect(command).toContain('suppress-logging');
  });

  it('FIXERR-CMD-002 permits premium parent or worker analysis without recursive delegation', () => {
    expect(command).toContain('the capable premium parent or its assigned premium worker performs the analysis');
    expect(command).toContain('no separate analysis Task is required');
    expect(command).toContain('Workers and reviewers must not launch other agents');
    expect(command).not.toContain('launch **exactly one** `Task`');
    expect(command).not.toContain('Parent Cursor Grok');
    expect(command).toContain('docs_private/error-analysis-decision.json');
    expect(command).toContain('No application fixes, no commits, no production SQL');
    expect(command).toContain('Always review already-triaged outstanding rows');
    expect(command).toContain('even when the new snapshot is empty');
  });

  it('FIXERR-CMD-003 selects review by risk and preserves candidate-bound blockers', () => {
    expect(command).toContain('Routine bounded repairs with sufficient evidence need no second model review');
    expect(command).toContain('material risk, unresolved uncertainty, an explicit owner request, or an applicable repository gate');
    expect(command).not.toContain('Launch **exactly one** `final-diff-reviewer`');
    expect(command).toContain('The root invokes the read-only reviewer directly');
    expect(command).toContain('its result and tests must match the actual candidate');
    expect(command).toContain('Unresolved review blockers still prevent commit');
    expect(command).toContain('one closure/delta `final-diff-reviewer`');
    expect(command).toContain('After two failed premium reviews, stop and report');
    expect(command).toContain('Only when independent review was selected');
    expect(command).toContain(`reviewEscalationReasons: ["${FIXERRORS_COMMAND_MANDATED_REVIEW_REASON}"]`);
    expect(command).toContain('Otherwise do not emit that reason or claim independent review occurred');
    expect(command).toContain('Never fabricate review approval or bypass a mechanical release gate');
  });

  it('FIXERR-CMD-004 marks mechanical report clusters as advisory input for the decision file', () => {
    expect(analysisScript).toContain(
      'Mechanical clusters and TEE lanes below are advisory input for analysis by the premium parent or assigned worker, which writes `docs_private/error-analysis-decision.json`.'
    );
  });
});
