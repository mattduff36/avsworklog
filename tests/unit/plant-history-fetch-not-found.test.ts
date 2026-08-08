import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('plant history fetch not-found handling', () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      'app/(dashboard)/fleet/plant/[plantId]/history/page.tsx'
    ),
    'utf-8'
  );

  it('uses maybeSingle for plant lookup so missing rows are not thrown', () => {
    expect(source).toContain('.eq(\'id\', unwrappedParams.plantId)');
    expect(source).toContain('.maybeSingle()');
    expect(source).not.toMatch(/\.eq\('id',\s*unwrappedParams\.plantId\)\s*\n\s*\.single\(\)/);
  });

  it('treats PostgREST coerce / PGRST116 as non-loggable expected misses', () => {
    expect(source).toContain('isPostgrestNoOrMultipleRowsError');
    expect(source).toContain('PGRST116');
    expect(source).toContain('cannot coerce the result to a single json object');
    expect(source).toContain('!isPostgrestNoOrMultipleRowsError(error)');
  });

  it('clears plant state when the id is missing or the fetch fails', () => {
    expect(source).toContain('if (!unwrappedParams.plantId)');
    expect(source).toContain('setPlant(null)');
  });
});
