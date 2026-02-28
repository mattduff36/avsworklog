/**
 * Vehicles-to-Vans Refactor — Static Guard Tests
 *
 * Verifies that the vehicles→vans+hgvs migration has been applied correctly
 * across the codebase: no stale table references, module names, applies_to
 * values, or user-facing text remain.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

function rgSearch(pattern: string, extraFlags = ''): string[] {
  try {
    const result = execSync(
      `rg "${pattern}" --no-filename -l ${extraFlags} app/ lib/ components/ types/ 2>/dev/null || true`,
      { cwd: ROOT, encoding: 'utf-8' }
    ).trim();
    if (!result) return [];
    return result.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function rgSearchContent(pattern: string, paths: string, extraFlags = ''): string {
  try {
    return execSync(
      `rg "${pattern}" ${extraFlags} ${paths} 2>/dev/null || true`,
      { cwd: ROOT, encoding: 'utf-8' }
    ).trim();
  } catch {
    return '';
  }
}

describe('No .from("vehicles") in production code', () => {
  it('no from("vehicles") calls in app/, lib/, components/', () => {
    const hits = rgSearch("from\\(['\"]vehicles['\"]\\)");
    expect(hits, `Stale from('vehicles') found in: ${hits.join(', ')}`).toHaveLength(0);
  });

  it('no Tables["vehicles"] type references in app/, lib/, components/', () => {
    const hits = rgSearch("Tables\\[.vehicles.\\]");
    expect(hits, `Stale Tables['vehicles'] found in: ${hits.join(', ')}`).toHaveLength(0);
  });
});

describe('No "admin-vehicles" module name in production code', () => {
  it('no admin-vehicles string in types/', () => {
    const content = rgSearchContent('admin-vehicles', 'types/');
    expect(content, 'Stale admin-vehicles in types/').toBe('');
  });

  it('no admin-vehicles string in lib/', () => {
    const content = rgSearchContent('admin-vehicles', 'lib/');
    expect(content, 'Stale admin-vehicles in lib/').toBe('');
  });

  it('no admin-vehicles string in app/', () => {
    const content = rgSearchContent('admin-vehicles', 'app/');
    expect(content, 'Stale admin-vehicles in app/').toBe('');
  });
});

describe('No stale applies_to="vehicle" in production code', () => {
  it('no .eq("applies_to", "vehicle") in app/', () => {
    const hits = rgSearch("eq\\(['\"]applies_to['\"],\\s*['\"]vehicle['\"]\\)", '--glob "!*.test.*"');
    expect(hits, `Stale applies_to='vehicle' in: ${hits.join(', ')}`).toHaveLength(0);
  });

  it('no applies_to default of ["vehicle"] in app/ or lib/', () => {
    const content = rgSearchContent("\\|\\| \\[.vehicle.\\]", 'app/ lib/ components/', '--glob "!*.test.*"');
    expect(content, 'Stale vehicle default found').toBe('');
  });
});

describe('No "tab=vehicles" URL references in production code', () => {
  it('no tab=vehicles in app/ or lib/', () => {
    const content = rgSearchContent('tab=vehicles', 'app/ lib/ components/');
    expect(content, 'Stale tab=vehicles URL found').toBe('');
  });
});

describe('No user-facing "Vehicles" text in production code', () => {
  it('no "Vehicles" string literal in app/ pages and components', () => {
    const hits = rgSearch('"Vehicles"', '--glob "!*.test.*" --glob "!*.spec.*"');
    expect(hits, `Stale "Vehicles" string found in: ${hits.join(', ')}`).toHaveLength(0);
  });

  it("no 'Vehicles' string literal in app/ pages and components", () => {
    const hits = rgSearch("'Vehicles'", '--glob "!*.test.*" --glob "!*.spec.*"');
    expect(hits, `Stale 'Vehicles' string found in: ${hits.join(', ')}`).toHaveLength(0);
  });
});
