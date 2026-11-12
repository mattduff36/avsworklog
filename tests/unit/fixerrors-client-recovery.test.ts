import { describe, expect, it } from 'vitest';
import { assertClientRecoveryChange, isGuardedBusinessClient } from '@/scripts/automation/fixerrors-client-recovery';
import { assertAutomaticFixerrorsRepair, type AutoRetrieval } from '@/scripts/fixerrors-auto';
import type { DecisionCluster } from '@/scripts/fixerrors-decision';
import { assertTargetedReleasePaths } from '@/scripts/automation/fixerrors-targeted-release';

const page = 'app/(dashboard)/quotes/page.tsx';
const ui = 'tests/ui/quotes-page-permissions.test.tsx';
const api = 'tests/integration/api/quote-metadata-route.test.ts';
const source = `'use client';
async function loadItems() {
  if (!canViewItems) return false;
  try { return await loadRows(); } catch (error) {
    console.error('Failed to load items', error); return false;
  }
}
async function loadRelated() {
  try { return await fetchRelated(); } catch (error) {
    if (getErrorStatus(error) === 401) { await handleSessionRecovery(); return false; }
    console.error('Failed to load related items', error); return false;
  }
}`;
const insert = (branch: string) => source.replace("    console.error('Failed to load items'", `    ${branch}\n    console.error('Failed to load items'`);
const recovery = 'if (getErrorStatus(error) === 401) { await handleSessionRecovery(); return false; }';
const evidence: AutoRetrieval['clusters'][number] = {
  id: 'cluster-1', rootCauseFamily: 'auth-permissions-security', advisoryLane: 'critical', advisoryAction: 'investigate',
  query: { sourceFile: page, errorContextId: 'metadata-load', httpStatus: 401, route: '/quotes',
    component: 'page', normalizedMessage: 'Failed to load items', rootCauseFamily: 'auth-permissions-security' },
  sourceFiles: [page], relatedSourceFiles: ['lib/utils/http-error.ts'], patterns: [], priorResolutions: [],
};
const decision: DecisionCluster = { id: evidence.id, action: 'fix', lane: 'guarded', disposition: 'outstanding',
  nextStep: 'Test client recovery independently of the expected server denial', rationale: 'The client used a generic notification.',
  files: [page], requiredTestIds: [ui, api], evidencePaths: [page, ui], evidenceEnrichmentAttempted: true, priorIncidentIds: [],
  forbiddenChanges: ['suppress-logging', 'empty-success', 'weaken-authorization'] };

describe('guarded client response repair', () => {
  it('accepts the same verified response in unrelated business modules', () => {
    for (const name of [page, 'components/invoices/InvoicesList.tsx', 'app/(dashboard)/timesheets/page.tsx']) {
      expect(() => assertClientRecoveryChange(name, source, insert(recovery))).not.toThrow();
    }
  });
  it.each([403, 500])('accepts a visible, logged %i notification while preserving its response', status => {
    const branch = `if (getErrorStatus(error) === ${status}) { console.error('Item request failed', error); toast.error('Unable to show items'); return false; }`;
    expect(() => assertClientRecoveryChange(page, source, insert(branch))).not.toThrow();
    expect(() => assertClientRecoveryChange(page, source, insert(branch.replace("console.error('Item request failed', error); ", '')))).toThrow();
  });
  it('permits an established recovery API newly imported by this screen, and local UI cleanup', () => {
    const start = "const [open, setFormOpen] = useState(false);\n";
    const baseline = source.replace('async function loadItems()', start + 'async function loadItems()');
    const withImport = baseline.replace("'use client';", "'use client';\nimport { handleAuthFailureStatus } from '@/lib/app-auth/recovery-bridge';");
    const candidate = withImport.replace("    console.error('Failed to load items'",
      "    if (getErrorStatus(error) === 401) { setFormOpen(false); await handleAuthFailureStatus(401); return false; }\n    console.error('Failed to load items'");
    expect(() => assertClientRecoveryChange(page, baseline, candidate)).not.toThrow();
    expect(() => assertClientRecoveryChange(page, baseline, candidate.replace('setFormOpen(false); await', 'setFormOpen(true); await'))).toThrow();
    expect(() => assertClientRecoveryChange(page, baseline, candidate.replace('@/lib/app-auth/recovery-bridge', '@/lib/server/fake'))).toThrow();
  });
  it('accepts a fail-closed dialog guard and rejects removal of an existing gate', () => {
    const dashboard = source + "\nconst [recovering, setRecovering] = useState(false);\nconst [formOpen, setFormOpen] = useState(false);\nfunction openForm() {\n  setFormOpen(true);\n}";
    const guarded = dashboard.replace('  setFormOpen(true);', '  if (recovering) return;\n  setFormOpen(true);');
    const candidate = guarded.replace("    console.error('Failed to load items'", `    ${recovery}\n    console.error('Failed to load items'`);
    expect(() => assertClientRecoveryChange(page, dashboard, candidate)).not.toThrow();
    expect(() => assertClientRecoveryChange(page, guarded, candidate.replace('  if (recovering) return;\n', ''))).toThrow();
  });
  it.each([
    insert(recovery).replace('!canViewItems', 'false'),
    insert(recovery).replace('await loadRows()', 'await modifyInvoice()'),
    insert(recovery.replace('await handleSessionRecovery()', 'await changePermission()')),
    insert(recovery.replace('return false', 'return true')),
    insert(recovery.replace('await handleSessionRecovery();', 'if (false) await handleSessionRecovery();')),
    insert(recovery.replace('await handleSessionRecovery();', 'return false; await handleSessionRecovery();')),
    insert(recovery).replace("console.error('Failed to load items', error);", ''),
    insert(recovery).replace("'use client';", "'use server';"),
  ])('holds actual permission, data, server and fallback changes', candidate => {
    expect(() => assertClientRecoveryChange(page, source, candidate)).toThrow();
  });
  it.each(['app/api/quotes/route.ts', 'lib/server/invoice.ts', 'components/security/InvoiceAccess.tsx', 'app/(dashboard)/quotes/../page.tsx'])(
    'never opens protected or ambiguous file %s', name => expect(isGuardedBusinessClient(name)).toBe(false));
  it('keeps reviewed checks read-only, scoped to the source and independent of repair permission', () => {
    expect(() => assertAutomaticFixerrorsRepair(decision, evidence)).not.toThrow();
    const other = 'components/invoices/Unmapped.tsx';
    expect(() => assertAutomaticFixerrorsRepair({ ...decision, files: [other] },
      { ...evidence, sourceFiles: [page, other] })).toThrow();
    for (const change of [{ files: [page, api] }, { requiredTestIds: [api] }, { requiredTestIds: [ui] }, { requiredTestIds: ['tests/ui/arbitrary.test.tsx'] },
      { files: [page, 'lib/utils/http-error.ts'] }, { lane: 'critical' as const }]) {
      expect(() => assertAutomaticFixerrorsRepair({ ...decision, ...change }, evidence)).toThrow();
    }
  });
  it('revalidates the actual immutable blobs at targeted release', () => {
    const before = 'a'.repeat(40), after = 'b'.repeat(40);
    const raw = `:100644 100644 ${before} ${after} M\0${page}\0`;
    expect(() => assertTargetedReleasePaths(raw)).toThrow();
    expect(() => assertTargetedReleasePaths(raw, oid => oid === before ? source : insert(recovery))).not.toThrow();
    expect(() => assertTargetedReleasePaths(raw, oid => oid === before ? source : insert(recovery).replace('!canViewItems', 'false'))).toThrow();
  });
});
