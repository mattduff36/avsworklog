export interface FinaliseChangeSummary {
  commitMessage: string;
  fileCount: number;
  areas: string[];
}

const SKIP_VERSION_MARKER = '[skip version]';

interface ChangeDescriptor {
  scope: string;
  type: 'chore' | 'docs' | 'feat' | 'fix' | 'test';
  label: string;
  subject: string;
  priority: number;
  patterns: RegExp[];
}

const CHANGE_DESCRIPTORS: ChangeDescriptor[] = [
  {
    scope: 'finalise',
    type: 'chore',
    label: 'finalise commit summaries',
    subject: 'improve finalise commit summaries',
    priority: 10,
    patterns: [/^scripts\/finalise(?:-summary)?\.ts$/u],
  },
  {
    scope: 'layout',
    type: 'fix',
    label: 'sidebar navigation styling',
    subject: 'improve sidebar navigation styling',
    priority: 15,
    patterns: [/^components\/layout\/SidebarNav\.tsx$/u, /^app\/globals\.css$/u],
  },
  {
    scope: 'mobile',
    type: 'feat',
    label: 'mobile text size controls',
    subject: 'add mobile text size controls',
    priority: 20,
    patterns: [
      /mobile-text-size/iu,
      /^components\/layout\/MobileTextSizeDialog\.tsx$/u,
      /^app\/\(dashboard\)\/dashboard\/page\.tsx$/u,
    ],
  },
  {
    scope: 'timesheets',
    type: 'feat',
    label: 'mobile time entry',
    subject: 'improve mobile time entry',
    priority: 30,
    patterns: [/numeric-time-input/iu, /MobileNumericTimeInput/u],
  },
  {
    scope: 'timesheets',
    type: 'feat',
    label: 'did not work absence handling',
    subject: 'update did not work absence handling',
    priority: 40,
    patterns: [/did-not-work/iu, /DidNotWorkReasonDialog/u],
  },
  {
    scope: 'absence',
    type: 'feat',
    label: 'absence workflow',
    subject: 'update absence workflow',
    priority: 50,
    patterns: [/absence/iu],
  },
  {
    scope: 'timesheets',
    type: 'feat',
    label: 'timesheet workflow',
    subject: 'update timesheet workflow',
    priority: 60,
    patterns: [/timesheet/iu],
  },
  {
    scope: 'maintenance',
    type: 'feat',
    label: 'maintenance workflow',
    subject: 'update maintenance workflow',
    priority: 70,
    patterns: [/maintenance/iu],
  },
  {
    scope: 'inspections',
    type: 'feat',
    label: 'inspection workflows',
    subject: 'update inspection workflows',
    priority: 80,
    patterns: [/inspections?/iu],
  },
  {
    scope: 'fleet',
    type: 'feat',
    label: 'fleet workflow',
    subject: 'update fleet workflow',
    priority: 90,
    patterns: [/fleet/iu],
  },
  {
    scope: 'db',
    type: 'chore',
    label: 'database migrations',
    subject: 'update database migrations',
    priority: 100,
    patterns: [/^supabase\//u],
  },
  {
    scope: 'api',
    type: 'feat',
    label: 'API routes',
    subject: 'update API routes',
    priority: 110,
    patterns: [/^app\/api\//u],
  },
  {
    scope: 'docs',
    type: 'docs',
    label: 'documentation',
    subject: 'update documentation',
    priority: 120,
    patterns: [/^docs\//u, /README/iu],
  },
  {
    scope: 'tests',
    type: 'test',
    label: 'test coverage',
    subject: 'update test coverage',
    priority: 130,
    patterns: [/^tests\//u, /^testsuite\//u],
  },
  {
    scope: 'automation',
    type: 'chore',
    label: 'automation scripts',
    subject: 'update automation scripts',
    priority: 140,
    patterns: [/^scripts\//u],
  },
];

function normalizePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/');
}

function uniqueValues<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function getMatchingDescriptors(changedFiles: string[]): ChangeDescriptor[] {
  const normalizedFiles = changedFiles.map(normalizePath);
  const matchedDescriptors = CHANGE_DESCRIPTORS
    .filter((descriptor) =>
      normalizedFiles.some((filePath) => descriptor.patterns.some((pattern) => pattern.test(filePath)))
    )
    .sort((left, right) => left.priority - right.priority);

  const matchedLabels = new Set(matchedDescriptors.map((descriptor) => descriptor.label));

  return matchedDescriptors.filter((descriptor) => {
    if (descriptor.label === 'automation scripts' && matchedLabels.has('finalise commit summaries')) {
      return false;
    }

    if (
      descriptor.label === 'timesheet workflow' &&
      (matchedLabels.has('mobile time entry') || matchedLabels.has('did not work absence handling'))
    ) {
      return false;
    }

    if (descriptor.label === 'absence workflow' && matchedLabels.has('did not work absence handling')) {
      return false;
    }

    return true;
  });
}

function joinAreas(areas: string[]): string {
  if (areas.length === 0) return 'repository files';
  if (areas.length === 1) return areas[0];
  if (areas.length === 2) return `${areas[0]} and ${areas[1]}`;
  return `${areas.slice(0, 2).join(', ')}, and ${areas.length - 2} more areas`;
}

function getFallbackScope(changedFiles: string[]): string {
  const topLevelFolders = uniqueValues(
    changedFiles
      .map(normalizePath)
      .map((filePath) => filePath.split('/')[0])
      .filter(Boolean)
  );

  if (topLevelFolders.length === 1) return topLevelFolders[0].replace(/[^a-z0-9-]/giu, '-').toLowerCase();
  return 'repo';
}

export function summarizeFinaliseChanges(changedFiles: string[]): FinaliseChangeSummary {
  const normalizedFiles = uniqueValues(changedFiles.map(normalizePath).filter(Boolean));
  const descriptors = getMatchingDescriptors(normalizedFiles);
  const primaryDescriptor = descriptors[0];
  const coreAreas = uniqueValues(descriptors.map((descriptor) => descriptor.label)).filter(
    (area) => area !== 'test coverage' || descriptors.length === 1
  );

  if (!primaryDescriptor) {
    const fallbackScope = getFallbackScope(normalizedFiles);
    return {
      commitMessage: `chore(${fallbackScope}): update ${joinAreas(coreAreas)}`,
      fileCount: normalizedFiles.length,
      areas: coreAreas,
    };
  }

  const commitSubject =
    coreAreas.length <= 1 ? primaryDescriptor.subject : `update ${joinAreas(coreAreas)}`;

  return {
    commitMessage: `${primaryDescriptor.type}(${primaryDescriptor.scope}): ${commitSubject}`,
    fileCount: normalizedFiles.length,
    areas: coreAreas.length > 0 ? coreAreas : [primaryDescriptor.label],
  };
}

export function formatReleaseVersionCommitMessage(primaryCommitMessage: string | null, version: string): string {
  const primarySubject = primaryCommitMessage
    ?.replace(new RegExp(`\\s*${SKIP_VERSION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'giu'), ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const subject = primarySubject || `chore(release): publish ${version}`;

  return `${subject} ${SKIP_VERSION_MARKER}\n\nRelease version: ${version}`;
}
