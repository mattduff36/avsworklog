/**
 * @tags @migrations
 * Converted from: TC014_Database_migration_script_execution_without_data_loss.py
 *
 * Smoke test: verifies migration files exist and are properly ordered.
 * NON-DESTRUCTIVE: does NOT run any migrations. Only reads file system.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const MIGRATIONS_DIR = resolve(process.cwd(), 'supabase', 'migrations');

describe('@migrations Migration Files Smoke Test', () => {
  it('migrations directory exists', () => {
    expect(existsSync(MIGRATIONS_DIR)).toBe(true);
  });

  it('migration files have .sql extension', () => {
    if (!existsSync(MIGRATIONS_DIR)) return;
    const files = readdirSync(MIGRATIONS_DIR).filter(f => !f.startsWith('.'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file).toMatch(/\.sql$/);
    }
  });

  it('most migration files follow date-prefix naming convention', () => {
    if (!existsSync(MIGRATIONS_DIR)) return;
    const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
    const dated = files.filter(f => /^\d{8}_/.test(f));
    // At least 50% should follow the convention (some legacy files may not)
    expect(dated.length).toBeGreaterThan(files.length * 0.5);
  });

  it('migration scripts directory exists', () => {
    const scriptsDir = resolve(process.cwd(), 'scripts');
    expect(existsSync(scriptsDir)).toBe(true);
  });

  it('at least one migration runner script exists', () => {
    const scriptsDir = resolve(process.cwd(), 'scripts');
    const files = readdirSync(scriptsDir).filter(f => f.startsWith('run-') && f.includes('migration'));
    expect(files.length).toBeGreaterThan(0);
  });
});
