import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('migration package scripts', () => {
  it('MIG-PACKAGE-001: migrate targets the safe runner and day-of-week is unwired', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const migrate = pkg.scripts?.migrate;
    expect(migrate).toBe('tsx scripts/run-sql-migration.ts');
    expect(existsSync(path.join(root, 'scripts', 'run-sql-migration.ts'))).toBe(true);
    expect(pkg.scripts?.['migrate:day-of-week']).toBeUndefined();
    expect(migrate).not.toContain('scripts/run-migration.ts');
    expect(migrate).not.toContain('scripts/migrations/');
  });
});
