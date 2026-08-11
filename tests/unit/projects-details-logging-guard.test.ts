import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'app/(dashboard)/projects/[id]/page.tsx'),
  'utf-8'
);

function branchBody(condition: string): string {
  const match = source.match(
    new RegExp(`if \\(${condition}\\) \\{([\\s\\S]*?)\\n      \\}`)
  );
  expect(match, `Expected branch for ${condition}`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('project details logging guard', () => {
  it('keeps query failures error-level and treats zero rows as a handled state', () => {
    const queryErrorBranch = branchBody('docError');
    expect(queryErrorBranch).toContain("console.error('Error fetching document:'");

    const missingDocumentBranch = branchBody('!doc');
    expect(missingDocumentBranch).toContain(
      "console.warn('Document not found or unavailable. ID:', documentId)"
    );
    expect(missingDocumentBranch).not.toContain('console.error');
    expect(missingDocumentBranch).toContain('setLoading(false)');

    expect(source).toContain(
      'This document may have been deleted or you don&apos;t have permission to view it.'
    );
  });
});
