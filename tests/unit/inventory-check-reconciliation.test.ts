import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = readFileSync(
  resolve(process.cwd(), 'scripts/reconcile-inventory-check-dates.ts'),
  'utf8',
);

describe('INV-CHECK-RECON inventory check date reconciliation script', () => {
  it('INV-CHECK-RECON-001 dry-run classifies every production category including matching future history', () => {
    expect(script).toContain("'match'");
    expect(script).toContain("'item_behind_history'");
    expect(script).toContain("'history_behind_item'");
    expect(script).toContain("'future_history'");
    expect(script).toContain("'no_history'");
    expect(script).toContain('has_future_history');
    expect(script).toContain('Dry-run only');
  });

  it('INV-CHECK-RECON-002 apply requires confirmation, stable UUID order, verifies before commit, and aborts on drift', () => {
    expect(script).toContain('--confirm-apply');
    expect(script).toContain('Refusing to apply without --confirm-apply');
    expect(script).toContain('FOR UPDATE');
    expect(script).toContain('Drift:');
    expect(script).toContain('ROLLBACK');
    expect(script).toContain('History row count changed during reconciliation');
    expect(script).toContain('Verification passed before commit.');
    expect(script).toContain('left.item_id.localeCompare(right.item_id)');
    expect(script).toContain('Unapproved item changed during repair');
    expect(script.indexOf('History row count changed during reconciliation')).toBeLessThan(
      script.indexOf("await client.query('COMMIT')"),
    );
  });
});
