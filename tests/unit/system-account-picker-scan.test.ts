import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const SCAN_ROOTS = ['app', 'lib', 'components'] as const;

const HIDE_MARKERS = [
  "eq('is_system_account', false)",
  'eq("is_system_account", false)',
  'filterSystemAccounts',
  'filterOperationalProfiles',
  'getSystemAccountIds',
  'isSystemAccountProfile',
  'filterRowsForReportProfileScope',
  'isProfileVisibleInReportScope',
  'buildTeamManagerOptionsFromProfiles',
  'filterSystemAccountIds',
] as const;

const ADMIN_SHOW_FILES = new Set([
  'app/(dashboard)/admin/users/page.tsx',
  'lib/server/team-permissions.ts',
]);

export function queryWindow(source: string, fromIndex: number): string {
  const nextFrom = source.indexOf('.from(', fromIndex + 6);
  const end = nextFrom === -1 ? Math.min(source.length, fromIndex + 500) : nextFrom;
  return source.slice(fromIndex, end);
}

export function isNonPickerWindow(window: string): boolean {
  return (
    /\.(eq|in)\(\s*['"]id['"]/.test(window) ||
    window.includes("eq('is_system_account', true)") ||
    window.includes('eq("is_system_account", true)') ||
    window.includes('.upsert(') ||
    window.includes('.update(') ||
    window.includes('.insert(') ||
    window.includes('.delete(') ||
    (window.includes("count: 'exact'") && window.includes('head: true')) ||
    window.includes('.maybeSingle()') ||
    window.includes('.single()')
  );
}

function hasHideMarker(window: string): boolean {
  return HIDE_MARKERS.some((marker) => window.includes(marker));
}

function isAllowedAdminShowWindow(relativePath: string, window: string): boolean {
  return ADMIN_SHOW_FILES.has(relativePath) && window.includes('is_system_account');
}

export function listOperationalPickerGapsInSource(source: string, relativePath = 'virtual.ts'): string[] {
  const gaps: string[] = [];
  const fromMatches = [...source.matchAll(/\.from\(\s*['"]profiles['"]\s*\)/g)];
  for (const [index, match] of fromMatches.entries()) {
    const window = queryWindow(source, match.index ?? 0);
    if (isNonPickerWindow(window)) continue;
    if (hasHideMarker(window) || isAllowedAdminShowWindow(relativePath, window)) continue;
    gaps.push(`${relativePath}#${index + 1}`);
  }
  return gaps;
}

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const fullPath = path.join(dir, name);
    if (statSync(fullPath).isDirectory()) {
      walkSourceFiles(fullPath, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(fullPath);
    }
  }
  return out;
}

function toPosixRelative(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).split(path.sep).join('/');
}

function listOperationalPickerGaps(): string[] {
  return SCAN_ROOTS.flatMap((root) => walkSourceFiles(root)).flatMap((file) => {
    const relativePath = toPosixRelative(file);
    return listOperationalPickerGapsInSource(readFileSync(file, 'utf8'), relativePath);
  }).sort();
}

describe('SYSACC-R3 operational picker scan', () => {
  it('SYSACC-R3 fails when a new profiles list omits the system-account hide', () => {
    expect(listOperationalPickerGaps()).toEqual([]);
  });

  it('SYSACC-R3-SCAN-01 does not let one hidden query cover another list in the same file', () => {
    const source = `
      db.from('profiles').select('id').eq('is_system_account', false)
      db.from('profiles').select('id, full_name').order('full_name')
    `;
    expect(listOperationalPickerGapsInSource(source, 'virtual-two-lists.ts')).toEqual([
      'virtual-two-lists.ts#2',
    ]);
  });

  it('SYSACC-R3-SCAN-02 does not treat a later lookup as the current list query', () => {
    const source = `
      db.from('profiles').select('id, full_name').order('full_name')
      db.from('profiles').select('full_name').eq('id', userId).maybeSingle()
    `;
    expect(listOperationalPickerGapsInSource(source, 'virtual-list-then-lookup.ts')).toEqual([
      'virtual-list-then-lookup.ts#1',
    ]);
  });
});
