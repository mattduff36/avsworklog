import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

describe('delete-user modal copy', () => {
  it('DEL-AL-05: modal states the annual-leave exception without unqualified preservation', () => {
    const page = fs.readFileSync(
      path.join(process.cwd(), 'app/(dashboard)/admin/users/page.tsx'),
      'utf8'
    );

    expect(page).toContain('Booked annual leave is removed');
    expect(page).toContain('Company data kept except booked annual leave');
    expect(page).not.toContain('✓ Company data preserved  •');
  });
});
