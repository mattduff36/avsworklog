/**
 * HGV Retired Display Fix – Tests
 *
 * Verifies the full HGV retirement workflow:
 * 1. DeleteVehicleDialog receives correct endpoint/entityLabel props
 * 2. HGV archive API sets status to 'retired' with retired_at + retire_reason
 * 3. Retired HGVs query catches both 'retired' and 'archived' statuses
 * 4. Retired HGV table shows Retired Date, Reason, and Actions columns
 * 5. Restore and Permanent Delete handlers exist for HGVs
 * 6. Database types include retired_at and retire_reason fields
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..', '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf-8');
}

describe('DeleteVehicleDialog receives correct props for HGV table', () => {
  const src = readSource('app/(dashboard)/maintenance/components/MaintenanceTable.tsx');

  it('passes endpoint={isHgvTable ? "hgvs" : "vans"} to DeleteVehicleDialog', () => {
    expect(src).toContain("endpoint={isHgvTable ? 'hgvs' : 'vans'}");
  });

  it('passes entityLabel={isHgvTable ? "HGV" : "Van"} to DeleteVehicleDialog', () => {
    expect(src).toContain("entityLabel={isHgvTable ? 'HGV' : 'Van'}");
  });

  it('refreshes retired HGVs list after successful retirement', () => {
    expect(src).toContain('if (isHgvTable) fetchRetiredHgvs()');
  });
});

describe('HGV archive API sets status to "retired" with tracking fields', () => {
  const src = readSource('app/api/admin/hgvs/[id]/route.ts');

  it('uses status "retired" not "archived"', () => {
    expect(src).toContain("status: 'retired'");
    expect(src).not.toContain("status: 'archived'");
  });

  it('sets retired_at timestamp', () => {
    expect(src).toContain('retired_at: now');
  });

  it('sets retire_reason from request body', () => {
    expect(src).toContain('retire_reason: reason');
  });

  it('checks for open workshop tasks before retiring', () => {
    expect(src).toContain("eq('hgv_id', hgvId)");
    expect(src).toContain("in('action_type', ['workshop_vehicle_task', 'inspection_defect'])");
    expect(src).toContain("neq('status', 'completed')");
  });

  it('blocks retirement when open tasks exist', () => {
    expect(src).toContain('Cannot retire HGV with open workshop tasks');
  });
});

describe('Retired HGVs query catches both status values', () => {
  const src = readSource('app/(dashboard)/maintenance/components/MaintenanceTable.tsx');

  it('queries for both "retired" and "archived" statuses', () => {
    expect(src).toContain(".in('status', ['retired', 'archived'])");
  });

  it('selects retired_at and retire_reason', () => {
    expect(src).toContain('retired_at, retire_reason');
  });
});

describe('Retired HGV table has full columns and actions', () => {
  const src = readSource('app/(dashboard)/maintenance/components/MaintenanceTable.tsx');

  it('shows Retired Date column', () => {
    expect(src).toContain('>Retired Date</TableHead>');
  });

  it('shows Reason column', () => {
    expect(src).toContain('>Reason</TableHead>');
  });

  it('shows Actions column', () => {
    expect(src).toContain('>Actions</TableHead>');
  });

  it('renders retire_reason as a styled badge', () => {
    expect(src).toContain('hgv.retire_reason');
    expect(src).toContain("hgv.retire_reason === 'Sold'");
    expect(src).toContain("hgv.retire_reason === 'Scrapped'");
  });

  it('renders retired_at as a formatted date', () => {
    expect(src).toContain('hgv.retired_at');
    expect(src).toContain('new Date(hgv.retired_at).toLocaleDateString()');
  });
});

describe('HGV restore and permanent delete handlers', () => {
  const src = readSource('app/(dashboard)/maintenance/components/MaintenanceTable.tsx');

  it('has handleRestoreHgv function', () => {
    expect(src).toContain('handleRestoreHgv');
    expect(src).toContain("status: 'active', retired_at: null, retire_reason: null");
  });

  it('has handlePermanentDeleteHgv function', () => {
    expect(src).toContain('handlePermanentDeleteHgv');
    expect(src).toContain(".delete({ count: 'exact' })");
  });

  it('restore handler calls fetchRetiredHgvs and onVehicleAdded', () => {
    expect(src).toMatch(/handleRestoreHgv[\s\S]*?fetchRetiredHgvs\(\)/);
    expect(src).toMatch(/handleRestoreHgv[\s\S]*?onVehicleAdded\?\.\(\)/);
  });

  it('renders Restore and Permanently Remove buttons in retired HGV rows', () => {
    expect(src).toContain('handleRestoreHgv(hgv)');
    expect(src).toContain('handlePermanentDeleteHgv(hgv)');
  });
});

describe('Database types include retire tracking fields', () => {
  const src = readSource('types/database.ts');

  it('hgvs Row type includes retired_at', () => {
    expect(src).toMatch(/hgvs[\s\S]*?Row[\s\S]*?retired_at: string \| null/);
  });

  it('hgvs Row type includes retire_reason', () => {
    expect(src).toMatch(/hgvs[\s\S]*?Row[\s\S]*?retire_reason: string \| null/);
  });
});

describe('Migration SQL adds retire fields to hgvs', () => {
  const sql = readSource('supabase/migrations/20260320_add_hgv_retire_fields.sql');

  it('adds retired_at column', () => {
    expect(sql).toContain('retired_at TIMESTAMPTZ NULL');
  });

  it('adds retire_reason column', () => {
    expect(sql).toContain('retire_reason VARCHAR(50) NULL');
  });
});
