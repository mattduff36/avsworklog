import { describe, expect, it } from 'vitest';
import { FULL_ORG_V2_CUTOVER_STEPS } from '@/scripts/run-org-v2-full-cutover';

describe('FULL_ORG_V2_CUTOVER_STEPS', () => {
  it('runs schema migrations before data backfills and cleanup', () => {
    const labels = FULL_ORG_V2_CUTOVER_STEPS.map((step) => step.label);

    expect(labels.indexOf('Apply Org V2 hierarchy schema')).toBeLessThan(
      labels.indexOf('Seed canonical teams and core roles')
    );
    expect(labels.indexOf('Apply team permission matrix schema')).toBeLessThan(
      labels.indexOf('Apply canonical team managers')
    );
    expect(labels.indexOf('Create placeholder managers')).toBeLessThan(
      labels.indexOf('Apply canonical team managers')
    );
    expect(labels.indexOf('Remove legacy teams')).toBeGreaterThan(
      labels.indexOf('Seed canonical teams and core roles')
    );
  });

  it('includes database validation checkpoints throughout the cutover', () => {
    const validateSteps = FULL_ORG_V2_CUTOVER_STEPS.filter(
      (step) => step.command === 'npm' && step.args.join(' ') === 'run db:validate'
    );

    expect(validateSteps).toHaveLength(3);
  });

  it('uses the unified Org V2 sequence without legacy permission scripts', () => {
    const invokedScripts = FULL_ORG_V2_CUTOVER_STEPS.flatMap((step) => step.args);

    expect(invokedScripts).toContain('scripts/run-team-permission-matrix-migration.ts');
    expect(invokedScripts).not.toContain('scripts/run-rbac-migrations.ts');
    expect(invokedScripts).not.toContain('scripts/migrations/run-roles-migration.ts');
  });
});
