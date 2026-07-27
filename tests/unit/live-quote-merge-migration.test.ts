import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260727_live_quote_merge.sql'),
  'utf8',
);

describe('live quote merge migration', () => {
  it('uses permanent groups, aliases, provenance, and immutable PDF metadata', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.quote_merge_groups');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.quote_reference_aliases');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.quote_line_item_merge_sources');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.quote_pdf_snapshots');
    expect(migration).toContain('file_sha256');
  });

  it('serializes aliases with the project merge lock and validates administrators', () => {
    expect(migration).toContain("hashtextextended('quote-project-number-alias-write', 0)");
    expect(migration).toContain('Only administrators can merge live quotes.');
    expect(migration).toContain('All selected quotes must be the latest commercially open versions.');
  });

  it('preserves source rows while creating an optional consolidated revision', () => {
    expect(migration).toContain("IF p_merge_mode = 'consolidated' THEN");
    expect(migration).toContain('INSERT INTO public.quote_line_item_merge_sources');
    expect(migration).not.toMatch(/DELETE FROM public\.quotes/);
    expect(migration).not.toMatch(/UPDATE public\.quote_invoices[\s\S]*SET quote_id/);
  });

  it('canonicalises future job-code writes without rewriting historical entries', () => {
    expect(migration).toContain('private.resolve_merged_project_reference');
    expect(migration).toContain('public.quote_reference_aliases');
    expect(migration).not.toMatch(/UPDATE public\.timesheet_entries[\s\S]*SET job_number/);
  });
});
