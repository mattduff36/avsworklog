// @ts-nocheck
/**
 * Static Guard: No runtime references to vehicle_inspections + stale labels
 *
 * Scans production code (app/, lib/, components/) for forbidden references
 * to the old vehicle_inspections table and stale "Vehicle" UI labels that
 * should now say "Van" or "Asset" after the inspections split.
 *
 * FK constraint hint names (e.g. !vehicle_inspections_user_id_fkey) are
 * allowed because Supabase preserves original constraint names after renames.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

function rgSearch(pattern: string, extraFlags = ''): string[] {
  try {
    const result = execSync(
      `rg "${pattern}" --no-filename -l ${extraFlags} app/ lib/ components/ 2>/dev/null || true`,
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
    const hits = rgSearch("from\\(['\"]vehicle_inspections['\"]\\)");
    expect(hits, `Forbidden from('vehicle_inspections') found in: ${hits.join(', ')}`).toHaveLength(0);
  });

  it('no Tables["vehicle_inspections"] type references in app/, lib/, components/', () => {
    const hits = rgSearch("Tables\\[.vehicle_inspections.\\]");
    expect(hits, `Forbidden Tables['vehicle_inspections'] found in: ${hits.join(', ')}`).toHaveLength(0);
  });

  it('no "Vehicle Inspection(s)" UI text in app/, lib/, components/', () => {
    const hits = rgSearch('Vehicle Inspections?', '--glob "!*.test.*"');
    expect(hits, `Forbidden "Vehicle Inspection" text found in: ${hits.join(', ')}`).toHaveLength(0);
  });

  it('no "Vehicle Tasks" UI label in app/, lib/, components/', () => {
    const hits = rgSearch('Vehicle Tasks', '--glob "!*.test.*"');
    expect(hits, `Stale "Vehicle Tasks" label found in: ${hits.join(', ')}`).toHaveLength(0);
  });

  it('no "Unknown Vehicle" fallback text in app/, lib/, components/', () => {
    const hits = rgSearch('Unknown Vehicle', '--glob "!*.test.*"');
    expect(hits, `Stale "Unknown Vehicle" text found in: ${hits.join(', ')}`).toHaveLength(0);
  });
});
