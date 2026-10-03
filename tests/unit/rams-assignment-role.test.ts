import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assignmentRoleLabel } from '@/lib/rams/assignment-role';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('assignmentRoleLabel', () => {
  it('uses the Contractor display name instead of a stale employee role', () => {
    expect(assignmentRoleLabel({
      display_name: 'Contractor',
      name: 'contractor',
    })).toBe('Contractor');
  });

  it('falls back to the role name when the display name is blank', () => {
    expect(assignmentRoleLabel({
      display_name: '   ',
      name: 'contractor',
    })).toBe('contractor');
  });

  it('returns an empty label when the current role is missing', () => {
    expect(assignmentRoleLabel(null)).toBe('');
    expect(assignmentRoleLabel([])).toBe('');
  });
});

describe('RAMS assignment role surfaces', () => {
  it('loads the current job role for every document assignment list and export', () => {
    const files = [
      'app/(dashboard)/projects/[id]/page.tsx',
      'app/api/rams/[id]/assign/route.ts',
      'app/api/rams/[id]/export/route.ts',
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).toContain('RAMS_ASSIGNMENT_EMPLOYEE_EMBED');
      expect(source).toContain('assignmentRoleLabel');
      expect(source).not.toContain(
        'employee:profiles!rams_assignments_employee_id_fkey(id, full_name, role)',
      );
    }
  });
});
