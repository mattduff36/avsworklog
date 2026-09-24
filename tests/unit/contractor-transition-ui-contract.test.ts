import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(
  join(process.cwd(), 'app/(dashboard)/admin/users/page.tsx'),
  'utf8'
);
const dialogSource = readFileSync(
  join(process.cwd(), 'components/admin/ContractorTransitionConfirmationDialog.tsx'),
  'utf8'
);

describe('Admin Users Contractor transition UI contract', () => {
  it('routes both edit entry points through one explicit confirmation state', () => {
    expect(pageSource).toContain("source: 'edit'");
    expect(pageSource).toContain("source: 'quick-edit'");
    expect(pageSource).toContain('<ContractorTransitionConfirmationDialog');
    expect(dialogSource).toContain('data-testid="contractor-transition-confirmation"');
    expect(dialogSource).toContain('data-testid="confirm-contractor-transition"');
    expect(dialogSource).toContain('Convert this user to Contractor?');
  });

  it('uses the dedicated endpoint with an expected-role concurrency guard', () => {
    expect(pageSource).toContain('/contractor-transition`');
    expect(pageSource).toContain("method: 'POST'");
    expect(pageSource).toContain('expected_role_id: user.role_id');
    expect(pageSource).toContain('contractor_role_id: contractorRoleId');
  });

  it('explains the destructive scope and conflict preservation behavior', () => {
    expect(dialogSource).toContain('set annual leave allowance and current-year carryover to 0');
    expect(dialogSource).toContain('remove future auto-generated bank holidays and bulk-booked annual leave');
    expect(dialogSource).toContain('clear personal module permission overrides');
    expect(dialogSource).toContain('no transition changes will be made');
  });
});
