import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  extractSourceFilesForError,
  groupIntoPatterns,
  type ErrorLogEntry,
} from '@/scripts/fixerrors';

function createFixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'fixerrors-source-'));

  for (const [file, content] of Object.entries(files)) {
    const absolutePath = join(root, file);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, 'utf-8');
  }

  return root;
}

function makeError(overrides: Partial<ErrorLogEntry>): ErrorLogEntry {
  return {
    id: 'error-1',
    timestamp: '2026-06-07T12:00:00.000Z',
    error_message: 'Console Error: Example error',
    error_stack: null,
    error_type: 'Error',
    user_id: null,
    user_email: 'user@example.com',
    page_url: 'https://www.squiresapp.com/example',
    user_agent: 'vitest',
    component_name: 'Console Error',
    additional_data: null,
    ...overrides,
  };
}

describe('fixerrors source extraction', () => {
  it('infers App Router source files from minified Next app chunk URLs', () => {
    const root = createFixture({
      'app/(dashboard)/van-inspections/new/page.tsx': 'export default function Page() { return null; }\n',
    });

    try {
      const refs = extractSourceFilesForError(makeError({
        error_message: [
          'Console Error: Silent draft save failed: Error: Draft not found',
          '@/https://www.squiresapp.com/_next/static/chunks/app/(dashboard)/van-inspections/new/page-67ff4a7213f5a4ef.js:1:21980',
        ].join('\n'),
        error_stack: '@https://www.squiresapp.com/_next/static/chunks/8496-ed158f365cb9a503.js:1:15981',
      }), root);

      expect(refs).toContainEqual({ file: 'app/(dashboard)/van-inspections/new/page.tsx' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('matches console labels to the most relevant source file for the affected route', () => {
    const root = createFixture({
      'app/(dashboard)/plant-inspections/new/page.tsx': [
        'function savePlant() {',
        "  console.error('Error saving inspection:', new Error('Load failed'));",
        '}',
      ].join('\n'),
      'app/(dashboard)/van-inspections/new/page.tsx': [
        'function saveVan() {',
        "  console.error('Error saving inspection:', new Error('Load failed'));",
        '}',
      ].join('\n'),
    });

    try {
      const refs = extractSourceFilesForError(makeError({
        error_message: 'Console Error: Error saving inspection: Error: TypeError: Load failed',
        page_url: 'https://www.squiresapp.com/plant-inspections/new',
      }), root);

      expect(refs).toEqual([
        {
          file: 'app/(dashboard)/plant-inspections/new/page.tsx',
          line: 2,
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to the affected App Router page when no stack source is available', () => {
    const root = createFixture({
      'app/(dashboard)/fleet/page.tsx': 'export default function FleetPage() { return null; }\n',
    });

    try {
      const patterns = groupIntoPatterns([
        makeError({
          error_message: 'Console Error: Error fetching retired plant assets: Error: TypeError: Failed to fetch',
          page_url: 'https://www.squiresapp.com/fleet',
        }),
      ], root);

      expect(patterns[0].sourceFiles).toContainEqual({ file: 'app/(dashboard)/fleet/page.tsx' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('maps Vercel server App Router stacks to route source files', () => {
    const root = createFixture({
      'app/api/me/usage-events/route.ts': 'export async function POST() { return null; }\n',
    });

    try {
      const refs = extractSourceFilesForError(makeError({
        error_message: 'Error in /api/me/usage-events POST /api/me/usage-events - TypeError: fetch failed',
        error_stack: [
          'Error: TypeError: fetch failed',
          '    at t (/var/task/.next/server/chunks/2141.js:13:1499)',
          '    at async z (/var/task/.next/server/app/api/me/usage-events/route.js:2:1783)',
          '    at async rH.do (/var/task/node_modules/next/dist/compiled/next-server/app-route.runtime.prod.js:5:21048)',
        ].join('\n'),
        page_url: '/api/me/usage-events',
        component_name: '/api/me/usage-events',
      }), root);

      // Compiled :line:column are bundle coordinates, not TypeScript source maps.
      expect(refs).toContainEqual({ file: 'app/api/me/usage-events/route.ts' });
      expect(refs.find((ref) => ref.file === 'app/api/me/usage-events/route.ts')).toEqual({
        file: 'app/api/me/usage-events/route.ts',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips compiled server-app stacks when no corresponding source file exists', () => {
    const root = createFixture({});

    try {
      const refs = extractSourceFilesForError(makeError({
        error_message: 'Error in /api/me/missing-route - TypeError: fetch failed',
        error_stack: [
          'Error: TypeError: fetch failed',
          '    at async z (/var/task/.next/server/app/api/me/missing-route/route.js:2:1783)',
        ].join('\n'),
        page_url: '',
        component_name: null,
      }), root);

      expect(refs).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('infers API route source files from component path when stack has no app sources', () => {
    const root = createFixture({
      'app/api/me/permissions/route.ts': 'export async function GET() { return null; }\n',
    });

    try {
      const refs = extractSourceFilesForError(makeError({
        error_message: 'Error in /api/me/permissions - TypeError: fetch failed',
        error_stack: 'Error: TypeError: fetch failed\n    at t (/var/task/.next/server/chunks/2141.js:13:1499)',
        page_url: '',
        component_name: '/api/me/permissions',
      }), root);

      expect(refs).toContainEqual({ file: 'app/api/me/permissions/route.ts' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('tolerates malformed percent-encoding in Next chunk paths without throwing', () => {
    const root = createFixture({
      'app/(dashboard)/fleet/page.tsx': 'export default function FleetPage() { return null; }\n',
    });

    try {
      expect(() => extractSourceFilesForError(makeError({
        error_message: [
          'Console Error: Example',
          '@/https://www.squiresapp.com/_next/static/chunks/app/%E0%A4%A/page-67ff4a7213f5a4ef.js:1:100',
        ].join('\n'),
        error_stack: null,
        page_url: '',
        component_name: null,
      }), root)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not let generic stack parsing claim compiled Next server paths under app/*', () => {
    const root = createFixture({
      'app/app/settings/route.ts': 'export async function GET() { return null; }\n',
    });

    try {
      const refs = extractSourceFilesForError(makeError({
        error_message: 'Error in /app/settings',
        error_stack: 'Error: boom\n    at async z (/var/task/.next/server/app/app/settings/route.js:2:1783)',
        page_url: '',
        component_name: null,
      }), root);

      expect(refs).toEqual([{ file: 'app/app/settings/route.ts' }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not let generic stack parsing claim compiled Next client chunk paths under components/*', () => {
    const root = createFixture({
      'app/components/widget/page.tsx': 'export default function Page() { return null; }\n',
    });

    try {
      const refs = extractSourceFilesForError(makeError({
        error_message: 'Console Error: Example',
        error_stack: [
          'Error: Example',
          '    at https://www.squiresapp.com/_next/static/chunks/app/components/widget/page-67ff4a7213f5a4ef.js:1:99',
        ].join('\n'),
        page_url: '',
        component_name: null,
      }), root);

      expect(refs).toEqual([{ file: 'app/components/widget/page.tsx' }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('still extracts a valid direct source frame that follows a compiled Next frame', () => {
    const root = createFixture({});

    try {
      const refs = extractSourceFilesForError(makeError({
        error_message: 'Error: boom',
        error_stack: [
          'Error: boom',
          '    at async z (/var/task/.next/server/app/api/me/usage-events/route.js:2:1783)',
          '    at run (/app/lib/utils/helper.ts:10:5)',
        ].join('\n'),
        page_url: '',
        component_name: null,
      }), root);

      expect(refs).toContainEqual({
        file: 'lib/utils/helper.ts',
        line: 10,
        column: 5,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
