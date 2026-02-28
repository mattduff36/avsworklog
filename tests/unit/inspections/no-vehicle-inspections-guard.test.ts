/**
 * Static Guard: No runtime references to vehicle_inspections
 *
 * This test scans production code (app/, lib/, components/) for forbidden
 * references to the old `vehicle_inspections` table name. FK constraint hint
 * names (e.g. !vehicle_inspections_user_id_fkey) are allowed because Supabase
 * preserves original constraint names after table renames.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

function findForbiddenReferences(): string[] {
  try {
    const result = execSync(
      `rg "from\\(['\"]vehicle_inspections['\"]\\)" --no-filename -l app/ lib/ components/ 2>/dev/null || true`,
      { cwd: ROOT, encoding: 'utf-8' }
    ).trim();

    if (!result) return [];
    return result.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function findForbiddenTableTypeReferences(): string[] {
  try {
    const result = execSync(
      `rg "Tables\\[.vehicle_inspections.\\]" --no-filename -l app/ lib/ components/ 2>/dev/null || true`,
      { cwd: ROOT, encoding: 'utf-8' }
    ).trim();

    if (!result) return [];
    return result.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function findForbiddenVehicleInspectionText(): string[] {
  try {
    const result = execSync(
      `rg "Vehicle Inspections?" --no-filename -l app/ lib/ components/ --glob "!*.test.*" 2>/dev/null || true`,
      { cwd: ROOT, encoding: 'utf-8' }
    ).trim();

    if (!result) return [];
    return result.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

describe('No vehicle_inspections in runtime code', () => {
  it('no from("vehicle_inspections") calls in app/, lib/, components/', () => {
    const hits = findForbiddenReferences();
    expect(hits, `Forbidden from('vehicle_inspections') found in: ${hits.join(', ')}`).toHaveLength(0);
  });

  it('no Tables["vehicle_inspections"] type references in app/, lib/, components/', () => {
    const hits = findForbiddenTableTypeReferences();
    expect(hits, `Forbidden Tables['vehicle_inspections'] found in: ${hits.join(', ')}`).toHaveLength(0);
  });

  it('no "Vehicle Inspection(s)" UI text in app/, lib/, components/', () => {
    const hits = findForbiddenVehicleInspectionText();
    expect(hits, `Forbidden "Vehicle Inspection" text found in: ${hits.join(', ')}`).toHaveLength(0);
  });
});
