import { describe, expect, it } from 'vitest';
import {
  formatReleaseVersionCommitMessage,
  getFinaliseTimingSummaryLines,
  summarizeFinaliseChanges,
} from '@/scripts/finalise-summary';

describe('finalise change summaries', () => {
  it('describes finalise automation work instead of using a generic finalisation message', () => {
    const summary = summarizeFinaliseChanges([
      'scripts/finalise.ts',
      'scripts/finalise-summary.ts',
      'tests/unit/finalise-summary.test.ts',
    ]);

    expect(summary.commitMessage).toBe('chore(finalise): improve finalise commit summaries');
    expect(summary.areas).toEqual(['finalise commit summaries']);
  });

  it('summarises mobile text size work from related files', () => {
    const summary = summarizeFinaliseChanges([
      'app/(dashboard)/dashboard/page.tsx',
      'components/layout/MobileTextSizeDialog.tsx',
      'lib/config/mobile-text-size-preference.ts',
      'tests/unit/mobile-text-size-preference.test.ts',
    ]);

    expect(summary.commitMessage).toBe('feat(mobile): add mobile text size controls');
  });

  it('summarises sidebar layout styling instead of falling back to repository files', () => {
    const summary = summarizeFinaliseChanges([
      'app/globals.css',
      'components/layout/SidebarNav.tsx',
    ]);

    expect(summary.commitMessage).toBe('fix(layout): improve sidebar navigation styling');
  });

  it('summarises multiple feature areas when a finalise contains more than one task', () => {
    const summary = summarizeFinaliseChanges([
      'components/layout/MobileTextSizeDialog.tsx',
      'components/timesheets/MobileNumericTimeInput.tsx',
      'lib/utils/numeric-time-input.ts',
    ]);

    expect(summary.commitMessage).toBe('feat(mobile): update mobile text size controls and mobile time entry');
  });

  it('uses the primary change summary for release version commits', () => {
    expect(formatReleaseVersionCommitMessage('fix(layout): hide sidebar scrollbar', '0526.5.1')).toBe(
      'fix(layout): hide sidebar scrollbar [skip version]\n\nRelease version: 0526.5.1'
    );
  });

  it('does not duplicate skip markers in release version commits', () => {
    expect(formatReleaseVersionCommitMessage('fix(layout): hide sidebar scrollbar [skip version]', '0526.5.1')).toBe(
      'fix(layout): hide sidebar scrollbar [skip version]\n\nRelease version: 0526.5.1'
    );
  });

  it('summarises only slow finalise timing entries in descending order', () => {
    expect(getFinaliseTimingSummaryLines([
      { label: 'Commit workspace changes', durationMs: 1200 },
      { label: 'Run clean production build', durationMs: 286_755 },
      { label: 'Run API and Playwright testsuite', durationMs: 180_000 },
    ])).toEqual([
      'Timing summary (steps over 30.0s):',
      '- Run clean production build: 4.8m',
      '- Run API and Playwright testsuite: 3.0m',
    ]);
  });

  it('prints a clear timing summary when no finalise steps are slow', () => {
    expect(getFinaliseTimingSummaryLines([
      { label: 'Commit workspace changes', durationMs: 1200 },
    ])).toEqual(['Timing summary: no finalise steps exceeded 30.0s.']);
  });
});
