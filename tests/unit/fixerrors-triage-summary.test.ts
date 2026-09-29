import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { buildSnapshotDisposition } from '@/scripts/fixerrors-finalize';
import { verifyErrorSnapshot } from '@/scripts/fixerrors-safety';
import { proveOutstandingIds } from '@/scripts/fixerrors-reconcile';
import { renderFixerrorsRunSummary } from '@/scripts/fixerrors-summary';
import type { ErrorSnapshotExport } from '@/scripts/fixerrors-safety';
import type { FixerrorsDecision } from '@/scripts/fixerrors-decision';
import { errorLogCardClass, getErrorLogTone } from '@/lib/utils/error-log-triage';

const rowId = '00000000-0000-4000-8000-000000000001';

function decision(disposition: 'outstanding' | 'no_fix_required' | 'fixed_live', nextStep: string | null): FixerrorsDecision {
  return {
    schemaVersion: 1,
    snapshotId: 'snapshot',
    analyst: 'test',
    baseHead: 'a'.repeat(40),
    treeFingerprint: 'b'.repeat(64),
    clusters: [
      {
        id: 'cluster-1',
        lane: 'fast',
        action: disposition === 'no_fix_required' ? 'report-only' : 'fix',
        disposition,
        nextStep,
        evidencePaths: ['app/(dashboard)/timesheets/page.tsx'],
        files: ['app/(dashboard)/timesheets/page.tsx'],
        requiredTestIds: ['tests/unit/http-error-transient-classification.test.ts'],
        forbiddenChanges: ['suppress-logging', 'empty-success', 'weaken-authorization'],
        rationale: 'Employee directory load failed',
        priorIncidentIds: [],
        evidenceEnrichmentAttempted: true,
      },
    ],
  };
}

describe('fixerrors triage summary', () => {
  it('FXERR-V5-SUMMARY-007 prints found, fixed live, outstanding, then the yes/no line', () => {
    const rendered = renderFixerrorsRunSummary({
      found: [{ id: 'cluster-1', title: 'Employee directory', count: 1, nextStep: null }],
      fixedLive: [],
      outstanding: [{ id: 'cluster-1', title: 'Employee directory', count: 1, nextStep: 'Deploy and verify live.' }],
    });
    const found = rendered.indexOf('Errors found');
    const fixed = rendered.indexOf('Errors fixed live');
    const outstanding = rendered.indexOf('Errors still outstanding');
    const remains = rendered.indexOf('Outstanding work remains: YES');
    expect(found).toBeGreaterThanOrEqual(0);
    expect(found).toBeLessThan(fixed);
    expect(fixed).toBeLessThan(outstanding);
    expect(outstanding).toBeLessThan(remains);
    expect(rendered).toContain('Next step: Deploy and verify live.');
    expect(rendered).toContain('Final recommendation: Deploy and verify live.');
    expect(rendered).toContain('Say "fix" to proceed with this recommendation now.');
  });

  it('FXERR-V5-SUMMARY-007 reports no outstanding work when every found item is closed', () => {
    const rendered = renderFixerrorsRunSummary({
      found: [{ id: 'cluster-1', title: 'Expected denial', count: 4, nextStep: null }],
      fixedLive: [],
      outstanding: [],
    });
    expect(rendered).toContain('Outstanding work remains: NO');
    expect(rendered).toContain('Errors fixed live\n- none');
    expect(rendered).toContain('Final recommendation: No further fixerrors action is required.');
    expect(rendered).not.toContain('Say "fix"');
  });

  it('FXERR-V5-LIVE-004 rejects a live disposition that has no deployment evidence', () => {
    const snapshot = {
      exactIds: [rowId],
      coverage: { clusters: [{ id: 'cluster-1', errorLogIds: [rowId] }], suppressedIds: [] },
    } as ErrorSnapshotExport;
    expect(() => buildSnapshotDisposition({
      snapshot,
      decision: decision('fixed_live', null),
    })).toThrow(/live evidence/u);
  });

  it('FXERR-V5-DISPOSITION-003 keeps suppressed rows in the exact partition', () => {
    const suppressed = '00000000-0000-4000-8000-000000000002';
    const snapshot = {
      exactIds: [rowId, suppressed],
      coverage: { clusters: [{ id: 'cluster-1', errorLogIds: [rowId] }], suppressedIds: [suppressed] },
    } as ErrorSnapshotExport;
    const disposition = buildSnapshotDisposition({
      snapshot,
      decision: decision('outstanding', 'Deploy and verify live.'),
    });
    expect(disposition.rows.map((row) => row.action).sort()).toEqual(['no_fix_required', 'outstanding']);
    expect(new Set(disposition.rows.map((row) => row.id))).toEqual(new Set([rowId, suppressed]));
  });

  it('FXERR-V5-RECONCILE-006 reopens only fix clusters and leaves report-only rows archived', () => {
    const proved = proveOutstandingIds({
      errors: [
        { id: rowId, error_message: 'Console Error: Error fetching employees: TypeError: Load failed' },
        { id: '00000000-0000-4000-8000-000000000002', error_message: 'Manager or admin required to update service state' },
      ],
      clusters: [
        {
          id: 'cluster-1',
          action: 'report-only',
          normalizedMessage: 'Manager or admin required to update service state',
        },
        {
          id: 'cluster-2',
          action: 'fix',
          normalizedMessage: 'Console Error: Error fetching employees: TypeError: Load failed',
        },
      ],
    });
    expect(proved.ids).toEqual([rowId]);
    expect(proved.unverifiedClusterIds).toEqual([]);
  });

  it('FXERR-V5-STALE-005 rejects a v4 snapshot before any database work', () => {
    expect(() => verifyErrorSnapshot({
      version: 3,
      safetyContract: 'fixerrors-exact-snapshot-v4',
      errors: [],
      exactIds: [],
    })).toThrow(/verification failed/u);
  });

  it('FXERR-V5-ROUTING-009 alerts only untriaged rows and still counts outstanding rows', () => {
    const notify = readFileSync('app/api/errors/notify-new/route.ts', 'utf8');
    const daily = readFileSync('app/api/errors/daily-summary/route.ts', 'utf8');
    const dashboard = readFileSync('app/api/dashboard/summary/route.ts', 'utf8');
    const debugRoute = readFileSync('app/api/debug/error-logs/route.ts', 'utf8');
    expect(notify).toContain(".is('triage_state', null)");
    expect(daily).toContain(".is('triage_state', null)");
    expect(dashboard).toContain(".eq('status', 'active')");
    expect(dashboard).not.toContain(".is('triage_state', null)");
    expect(debugRoute).toContain('status: 409');
    expect(debugRoute).not.toContain('clearAllErrorLogs');
  });

  it('FXERR-V5-DEBUG-008 colors untriaged red and outstanding orange', () => {
    expect(getErrorLogTone({ status: 'active', triage_state: null })).toBe('red');
    expect(getErrorLogTone({ status: 'active', triage_state: 'outstanding' })).toBe('orange');
    expect(errorLogCardClass('orange')).toContain('orange');
    expect(errorLogCardClass('red')).toContain('red');
  });
});
