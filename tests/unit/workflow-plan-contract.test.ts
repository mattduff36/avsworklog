import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  createDefaultPlanContract,
  createWorkflowWorkstreamId,
  extractPlanContractMarker,
  pathHasSymlinkComponent,
  renderPlanContractMarker,
  resolvePlanPath,
  validatePlanFile,
  validatePlanMarkdown,
} from '@/scripts/automation/workflow-plan-contract';
import { WORKFLOW_MODEL_TIER_REGISTRY_VERSION } from '@/scripts/automation/workflow-model-tier';
import { runWorkflowPlanValidate } from '@/scripts/workflow-plan-validate';

function validPlanMarkdown(contract = createDefaultPlanContract({
  taskId: 'plan-demo',
  taskType: 'change',
  risk: 'high',
  initialParentTier: 'economical',
  routingDecision: 'economical_default',
  rationale: 'High-risk persistence change needs economical build with premium gates.',
  fallbackEscalation: 'Escalate if verification fails twice.',
  requiredTests: [{ id: 'PLAN-001', status: 'unresolved' }],
  independentReviewReasons: ['persistence'],
})): string {
  return [
    '---',
    'name: demo',
    'overview: demo',
    'todos: []',
    'isProject: false',
    '---',
    '',
    renderPlanContractMarker(contract),
    '',
    '# Demo plan',
    '',
    '## Classification',
    '',
    `- risk: ${contract.risk}`,
    `- routingDecision: ${contract.routingDecision}`,
    '',
    '## Recommended build model',
    '',
    `- Implementation: Cursor Grok ${contract.recommendedBuildModel.implementation.tier} economical-default`,
    '- Premium gates: architecture-gate and final-diff-reviewer',
    '',
    '## Architecture gate',
    '',
    '- independent architecture-gate before edits',
    '',
    '## Implementation contract',
    '',
    '- invariants and rollback',
    '',
    '## Required tests',
    '',
    ...contract.requiredTests.map((test) => `- ${test.id}`),
    '',
    '## Final review',
    '',
    '- independent final-diff-reviewer',
    '',
    '## Commit and handoff',
    '',
    '- local commit and marker',
    '',
  ].join('\n');
}

describe('workflow plan contract', () => {
  it('PLAN-001: valid Cursor-style plan round-trips through plan-contract-marker:v1', () => {
    const contract = createDefaultPlanContract({
      sourceWorkstreamIds: ['ws-source-a', 'ws-source-b'],
      taskId: 'plan-demo',
      taskType: 'change',
      risk: 'high',
      initialParentTier: 'economical',
      routingDecision: 'economical_default',
      rationale: 'High-risk persistence change needs economical build with premium gates.',
      fallbackEscalation: 'Escalate if verification fails twice.',
      requiredTests: [{ id: 'PLAN-001', status: 'unresolved' }],
      independentReviewReasons: ['persistence'],
    });
    const markdown = validPlanMarkdown(contract);
    const parsed = validatePlanMarkdown(markdown);
    expect(parsed.status).toBe('present');
    expect(parsed.contract?.registryVersion).toBe(WORKFLOW_MODEL_TIER_REGISTRY_VERSION);
    expect(parsed.contract?.workstreamId).toMatch(/^ws_/);
    expect(parsed.contract?.implementationContract?.rollback).toBeTruthy();
    expect(parsed.contract?.sourceWorkstreamIds).toEqual(['ws-source-a', 'ws-source-b']);
    expect(extractPlanContractMarker(markdown).status).toBe('present');
  });

  it('PLAN-002: missing marker, duplicate test IDs, high-risk contract gaps, and heading gaps fail validation', () => {
    const missing = validatePlanMarkdown('# No contract\n');
    expect(missing.status).toBe('missing');

    const contract = createDefaultPlanContract({
      taskId: 'bad',
      taskType: 'change',
      risk: 'high',
      rationale: 'x',
      fallbackEscalation: 'y',
      requiredTests: [
        { id: 'DUP', status: 'unresolved' },
        { id: 'DUP', status: 'unresolved' },
      ],
      independentReviewReasons: ['persistence'],
    });
    const duplicate = validatePlanContractObjectLike(contract);
    expect(duplicate.status).toBe('malformed');

    const highRiskMissingImpl = extractPlanContractMarker(
      `<!-- plan-contract-marker:v1\n${JSON.stringify({
        ...createDefaultPlanContract({
          taskId: 'no-impl',
          taskType: 'change',
          risk: 'high',
          rationale: 'x',
          fallbackEscalation: 'y',
          requiredTests: [{ id: 'T1', status: 'unresolved' }],
          independentReviewReasons: ['persistence'],
        }),
        implementationContract: { invariants: [], boundaries: [], rollback: '' },
      }, null, 2)}\n-->`
    );
    expect(highRiskMissingImpl.status).toBe('malformed');
    expect(
      highRiskMissingImpl.errors.some((error) => error.includes('implementationContract'))
    ).toBe(true);

    const noHeadings = validatePlanMarkdown(renderPlanContractMarker(createDefaultPlanContract({
      taskId: 'no-headings',
      taskType: 'change',
      risk: 'routine',
      rationale: 'x',
      fallbackEscalation: 'y',
      requiredTests: [{ id: 'T1', status: 'unresolved' }],
    })));
    expect(noHeadings.status).toBe('malformed');
    expect(noHeadings.errors.some((error) => error.includes('missing required headings'))).toBe(true);

    const contradictory = validatePlanMarkdown(
      validPlanMarkdown().replace('- risk: high', '- risk: routine')
        .replace('- routingDecision: economical_default', '- routingDecision: continued_premium')
        .replace(
          '- Implementation: Cursor Grok economical economical-default',
          '- Implementation: premium'
        )
        .replace('- PLAN-001', '- DIFFERENT-TEST')
    );
    expect(contradictory.status).toBe('malformed');
    expect(contradictory.contradictionErrors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('human risk routine contradicts machine risk high'),
        expect.stringContaining('human routingDecision continued_premium'),
        expect.stringContaining('human implementation tier premium'),
        expect.stringContaining('missing machine test ID PLAN-001'),
      ])
    );
  });

  it('PLAN-PATH-001: rejects traversal, symlinks, and oversized candidates', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'plan-path-'));
    const plansDir = path.join(root, 'plans');
    const outsideRoot = mkdtempSync(path.join(tmpdir(), 'plan-outside-'));
    mkdirSync(plansDir, { recursive: true });
    const planPath = path.join(plansDir, 'ok.plan.md');
    writeFileSync(planPath, validPlanMarkdown(), 'utf8');

    const ok = resolvePlanPath({ candidatePath: 'plans/ok.plan.md', repoRoot: root });
    expect(ok.status).toBe('ok');
    expect(ok.source).toBe('repo_relative');

    const outsideFile = path.join(outsideRoot, 'outside.plan.md');
    writeFileSync(outsideFile, validPlanMarkdown(), 'utf8');
    const relativeEscape = path.relative(root, outsideFile);
    expect(relativeEscape.split(path.sep)).toContain('..');
    const traversal = resolvePlanPath({
      candidatePath: relativeEscape,
      repoRoot: root,
      approvedRoots: [root, plansDir],
    });
    expect(traversal.status).toBe('rejected');
    expect(traversal.errors.some((error) => error.includes('traversal'))).toBe(true);

    const absoluteExternal = resolvePlanPath({
      candidatePath: outsideFile,
      repoRoot: root,
      approvedRoots: [root, plansDir],
    });
    expect(absoluteExternal.status).toBe('ok');
    expect(absoluteExternal.source).toBe('external_hashed');
    expect(absoluteExternal.pathRef).not.toContain(path.sep);

    const linkPath = path.join(plansDir, 'link.plan.md');
    const linkedDir = path.join(root, 'linked-plans');
    let symlinkSupported = true;
    try {
      symlinkSync(planPath, linkPath);
      symlinkSync(plansDir, linkedDir);
    } catch {
      symlinkSupported = false;
    }
    if (symlinkSupported) {
      const linked = resolvePlanPath({ candidatePath: linkPath, repoRoot: root });
      expect(linked.status).toBe('rejected');
      expect(linked.errors.some((error) => error.includes('symbolic links'))).toBe(true);

      const parentLinkedPlan = path.join(linkedDir, 'ok.plan.md');
      expect(pathHasSymlinkComponent(parentLinkedPlan)).toBe(true);
      const parentLinked = resolvePlanPath({
        candidatePath: parentLinkedPlan,
        repoRoot: root,
        approvedRoots: [root, plansDir, linkedDir],
      });
      expect(parentLinked.status).toBe('rejected');
      expect(parentLinked.errors.some((error) => error.includes('symbolic links'))).toBe(true);
    } else {
      // Windows environments without symlink privilege still cover traversal/size/external hashing.
      expect(symlinkSupported).toBe(false);
    }

    const huge = path.join(plansDir, 'huge.plan.md');
    writeFileSync(huge, 'x'.repeat(600_000), 'utf8');
    const oversized = resolvePlanPath({ candidatePath: huge, repoRoot: root });
    expect(oversized.status).toBe('rejected');
  });

  it('CLI-PLAN-001 / AUTO-PLAN-001: exported CLI runner returns deterministic 0/1/2 JSON diagnostics', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'plan-cli-'));
    const planPath = path.join(root, 'auto.plan.md');
    writeFileSync(planPath, validPlanMarkdown(createDefaultPlanContract({
      workstreamId: createWorkflowWorkstreamId('followup'),
      taskId: 'auto-upgrade',
      taskType: 'change',
      risk: 'routine',
      initialParentTier: 'economical',
      routingDecision: 'economical_default',
      rationale: 'Monthly automation upgrade.',
      fallbackEscalation: 'Escalate on repeated failure.',
      requiredTests: [
        { id: 'AUTO-PLAN-001', status: 'unresolved' },
        { id: 'REGRESSION-001', status: 'unresolved' },
      ],
    })), 'utf8');
    const result = validatePlanFile({ candidatePath: planPath, repoRoot: root });
    expect(result.status).toBe('present');
    expect(result.errors).toEqual([]);

    const validCli = runWorkflowPlanValidate([planPath, '--json'], root);
    expect(validCli.exitCode).toBe(0);
    expect(JSON.parse(validCli.text)).toEqual(validCli.payload);

    const invalidPath = path.join(root, 'invalid.plan.md');
    writeFileSync(invalidPath, '# Invalid plan\n', 'utf8');
    const invalidCli = runWorkflowPlanValidate([invalidPath, '--json'], root);
    expect(invalidCli.exitCode).toBe(1);
    expect(JSON.parse(invalidCli.text)).toEqual(invalidCli.payload);

    const usageCli = runWorkflowPlanValidate(['--json'], root);
    expect(usageCli.exitCode).toBe(2);
    expect(JSON.parse(usageCli.text)).toEqual(usageCli.payload);
    expect(runWorkflowPlanValidate(['--json'], root)).toEqual(usageCli);
  });
});

function validatePlanContractObjectLike(
  contract: ReturnType<typeof createDefaultPlanContract>
): ReturnType<typeof extractPlanContractMarker> {
  // Force duplicate IDs through the marker JSON path.
  const raw = JSON.parse(JSON.stringify(contract)) as Record<string, unknown>;
  raw.requiredTests = [
    { id: 'DUP', status: 'unresolved' },
    { id: 'DUP', status: 'unresolved' },
  ];
  return extractPlanContractMarker(
    `<!-- plan-contract-marker:v1\n${JSON.stringify(raw, null, 2)}\n-->`
  );
}
