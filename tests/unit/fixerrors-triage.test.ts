import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { classifyIncident, diagnosticSchema, executionBudget, type IncidentDiagnostics } from '@/lib/fixerrors/triage';
import { buildRetrievalCluster, clusterErrorPatterns, groupIntoPatterns, type ErrorLogEntry } from '@/scripts/fixerrors-retrieval';
import { approvedAnalysisTests, assertAutomaticPath, parseAutomaticFixerrorsRetrieval } from '@/scripts/fixerrors-auto';

const transient: IncidentDiagnostics = {
  classes: ['network'], operation: 'usage-analytics', stage: 'record-usage',
  noncriticalHandled: true, occurrences: 1, frames: [],
};
describe('proportionate incident importance', () => {
  it.each(['security-compromise', 'data-corruption', 'service-outage'] as const)(
    'captures structured %s into Urgent without releasing raw prose', impact => {
      const error: ErrorLogEntry = {
        id: 'synthetic', timestamp: '2026-11-12T00:00:00Z', created_at: '2026-11-12T00:00:00Z',
        error_message: 'Synthetic operational incident', error_stack: null, error_type: 'Error',
        user_id: null, user_email: null, page_url: '/debug', user_agent: 'test', component_name: 'Test',
        additional_data: { impact },
      };
      const cluster = clusterErrorPatterns(groupIntoPatterns([error]))[0];
      const captured = buildRetrievalCluster(cluster, { version: 1, incidents: [] });
      expect(captured.diagnostics?.classes).toContain(impact);
      expect(classifyIncident(captured.diagnostics).importance).toBe('Urgent');
      expect(executionBudget(classifyIncident(captured.diagnostics)).analysisMinutes).toBe(3);
    },
  );
  it('uses the same bounded budgets in native execution as the TypeScript policy', () => {
    const cases = [transient, undefined, { ...transient, classes: ['service-outage'] as const }];
    const code = [
      'import json,sys', 'from pathlib import Path',
      'sys.path.insert(0, str(Path("scripts/automation").resolve()))',
      'import squires_repair as r', 'r.s.WORKSPACE=Path.cwd()',
      'cases=json.loads(sys.stdin.read())',
      'r.s.request_for=lambda *args: {"task_id":"fixture", "objective":"fixture"}',
      'result=[]',
      'for d in cases:',
      '    packet={"retrieval":{"clusters":[{"diagnostics":d}]}}',
      '    result.append({"analysisMinutes":r.request({}, {}, packet, {}, {}, True)["timeout_minutes"], "repairMinutes":r.request({}, {}, packet, {}, {}, False)["timeout_minutes"]})',
      'print(json.dumps(result))',
    ].join('\n');
    const result = spawnSync('python', ['-I', '-B', '-c', code], {
      input: JSON.stringify(cases), encoding: 'utf8', timeout: 10_000, windowsHide: true,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      { analysisMinutes: 1, repairMinutes: 2 },
      { analysisMinutes: 2, repairMinutes: 3 },
      { analysisMinutes: 3, repairMinutes: 4 },
    ]);
  });
  it('defaults unknown and console-only evidence to Important', () => {
    expect(classifyIncident()).toMatchObject({ importance: 'Important', reason: 'impact-uncertain', effort: 'focused' });
    expect(classifyIncident({ ...transient, classes: ['unknown'] }).importance).toBe('Important');
  });
  it('requires evidenced handled noncritical failure, not an analytics path alone', () => {
    expect(classifyIncident(transient)).toMatchObject({ importance: 'Routine', effort: 'short' });
    expect(classifyIncident({ ...transient, stage: 'authentication' }).importance).toBe('Important');
    expect(classifyIncident({ ...transient, noncriticalHandled: false }).importance).toBe('Important');
    expect(classifyIncident({ ...transient, classes: ['network', 'authentication'] }).importance).toBe('Important');
  });
  it('escalates repeated Routine evidence without asserting an outage', () => {
    expect(classifyIncident({ ...transient, occurrences: 10 })).toMatchObject({
      importance: 'Important', reason: 'repeated-failure',
    });
  });
  it.each(['security-compromise', 'data-corruption', 'service-outage'] as const)(
    'prioritizes evidenced %s impact over Routine hints', impact => {
      expect(classifyIncident({ ...transient, classes: [impact] })).toMatchObject({
        importance: 'Urgent', reason: 'serious-impact-signal', effort: 'strong',
      });
    },
  );
  it('does not confuse validation, auth or financial source risk with confirmed urgent impact', () => {
    expect(classifyIncident({ ...transient, classes: ['validation'], operation: 'timesheet-submit' }).importance).toBe('Important');
    expect(classifyIncident({ ...transient, classes: ['authentication'], operation: 'quotes' }).importance).toBe('Important');
    expect(() => assertAutomaticPath('app/api/me/usage-events/route.ts')).toThrow('approval');
  });
  it('rejects arbitrary diagnostic detail and unsafe source frames', () => {
    expect(() => diagnosticSchema.parse({ ...transient, message: 'private detail' })).toThrow();
    expect(() => diagnosticSchema.parse({ ...transient, databaseCode: 'person@example.invalid' })).toThrow();
    expect(() => diagnosticSchema.parse({ ...transient, frames: [{ file: 'lib/../private.ts' }] })).toThrow();
  });
  it('registers only specific offline analysis tests, including the mocked usage route integration test', () => {
    expect(approvedAnalysisTests(['app/api/me/usage-events/route.ts'])).toEqual([
      'tests/unit/usage-events-route.test.ts', 'tests/integration/api/usage-events-route.test.ts',
    ]);
    expect(approvedAnalysisTests(['app/api/arbitrary/route.ts'])).toEqual([]);
  });
  it.each([
    ['targeted-tests', 'tests/integration/api/unregistered.test.ts'],
    ['lint', 'tests/integration/api/usage-events-route.test.ts'],
    ['targeted-tests', 'tests/unit/../private.test.ts'],
    ['powershell', '-Command'],
  ])('rejects unapproved scoped commands and paths: %s %s', (id, file) => {
    const result = spawnSync(process.execPath, [path.resolve('scripts\\automation\\fixerrors-scoped-check.mjs'), id, file], {
      encoding: 'utf8', windowsHide: true, timeout: 10_000,
      env: { ...process.env, AVSWORKLOG_TEST_SKIP_DOTENV: '1' },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Invalid locally scoped check');
  });
  it('keeps old manifests canonical without injecting policy defaults', () => {
    const value = { schemaVersion: 1, snapshotId: '00000000-0000-4000-8000-000000000001',
      baseHead: 'a'.repeat(40), treeFingerprint: 'b'.repeat(64), archiveMeansResolved: false, clusters: [] };
    const parsed = parseAutomaticFixerrorsRetrieval(value);
    expect(parsed).toEqual(value);
    expect(parsed).not.toHaveProperty('triage');
  });
});
