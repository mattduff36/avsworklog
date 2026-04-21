import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('single-row query guards', () => {
  it('guards timesheet type resolution against duplicate override rows', () => {
    const src = read('app/(dashboard)/timesheets/hooks/useTimesheetType.ts');

    expect(src).toContain(".from('timesheet_type_exceptions')");
    expect(src).toContain(".order('updated_at', { ascending: false })");
    expect(src).toContain('.limit(2),');
    expect(src).toContain('Multiple timesheet_type_exceptions rows found for profile; using the latest row.');
  });

  it('guards van and HGV maintenance lookups against duplicate maintenance rows', () => {
    const vanSrc = read('app/(dashboard)/fleet/vans/[vanId]/history/page.tsx');
    const hgvSrc = read('app/(dashboard)/fleet/hgvs/[hgvId]/history/page.tsx');

    expect(vanSrc).toContain(".from('vehicle_maintenance')");
    expect(vanSrc).toContain(".order('updated_at', { ascending: false })");
    expect(vanSrc).toContain('.limit(2);');
    expect(vanSrc).toContain('Multiple vehicle_maintenance rows found for van; using the latest row.');

    expect(hgvSrc).toContain(".from('vehicle_maintenance')");
    expect(hgvSrc).toContain(".order('updated_at', { ascending: false })");
    expect(hgvSrc).toContain('.limit(2);');
    expect(hgvSrc).toContain('Multiple vehicle_maintenance rows found for HGV; using the latest row.');
  });
});
