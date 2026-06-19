import {
  getProductReleaseFiles,
  getReleaseDescriptorMatches,
  normalizeReleasePath,
  uniqueReleaseValues,
  type ReleaseImpactInput,
} from '../lib/config/release-module-descriptors';

export interface FinaliseChangeSummary {
  commitMessage: string;
  fileCount: number;
  areas: string[];
}

export interface FinaliseChangedFile {
  path: string;
  additions?: number;
  deletions?: number;
}

export interface FinaliseTimingEntry {
  label: string;
  durationMs: number;
  status?: 'completed' | 'failed' | 'reused' | 'skipped';
}

interface FinaliseTimingSummaryOptions {
  limit?: number;
  slowThresholdMs?: number;
}

const SKIP_VERSION_MARKER = '[skip version]';
const DEFAULT_SLOW_TIMING_THRESHOLD_MS = 30_000;
const DEFAULT_TIMING_SUMMARY_LIMIT = 5;

function joinAreas(areas: string[]): string {
  if (areas.length === 0) return 'repository files';
  if (areas.length === 1) return areas[0];
  if (areas.length === 2) return `${areas[0]} and ${areas[1]}`;
  return `${areas.slice(0, -1).join(', ')}, and ${areas[areas.length - 1]}`;
}

function getFallbackScope(changedFiles: string[]): string {
  const topLevelFolders = uniqueReleaseValues(
    changedFiles
      .map(normalizeReleasePath)
      .map((filePath) => filePath.split('/')[0])
      .filter(Boolean)
  );

  if (topLevelFolders.length === 1) return topLevelFolders[0].replace(/[^a-z0-9-]/giu, '-').toLowerCase();
  return 'repo';
}

function normalizeChangedFiles(changedFiles: Array<string | FinaliseChangedFile>): ReleaseImpactInput[] {
  return changedFiles
    .map((entry) => typeof entry === 'string'
      ? { path: entry }
      : {
        path: entry.path,
        additions: entry.additions,
        deletions: entry.deletions,
      })
    .filter((entry) => Boolean(entry.path));
}

function getSummaryType(matches: ReturnType<typeof getReleaseDescriptorMatches>): 'chore' | 'docs' | 'feat' | 'fix' | 'test' {
  if (matches.length === 0) return 'chore';
  if (matches.some((match) => match.descriptor.type === 'feat' && !match.descriptor.excludeFromProductSummary)) return 'feat';
  return matches[0]?.descriptor.type || 'chore';
}

function removeGenericFallbackMatches(matches: ReturnType<typeof getReleaseDescriptorMatches>): ReturnType<typeof getReleaseDescriptorMatches> {
  const concreteMatches = matches.filter((match) =>
    !['app-screens', 'background-services'].includes(match.descriptor.id)
  );

  return concreteMatches.length > 0 ? concreteMatches : matches;
}

export function summarizeFinaliseChanges(changedFiles: Array<string | FinaliseChangedFile>): FinaliseChangeSummary {
  const normalizedInputs = normalizeChangedFiles(changedFiles);
  const productFiles = getProductReleaseFiles(normalizedInputs.map((entry) => entry.path));
  const allMatches = getReleaseDescriptorMatches(normalizedInputs);
  const productMatches = removeGenericFallbackMatches(
    allMatches.filter((match) => !match.descriptor.excludeFromProductSummary)
  );
  const matches = productMatches.length > 0 ? productMatches : removeGenericFallbackMatches(allMatches);
  const primaryMatch = matches[0] || null;
  const coreAreas = uniqueReleaseValues(matches.map((match) => match.descriptor.versionHistoryArea));

  if (!primaryMatch) {
    const fallbackScope = getFallbackScope(productFiles);
    return {
      commitMessage: `chore(${fallbackScope}): update ${productFiles.length > 0 ? joinAreas(coreAreas) : 'repository files'}`,
      fileCount: productFiles.length,
      areas: coreAreas,
    };
  }

  const commitSubject =
    coreAreas.length <= 1 ? primaryMatch.descriptor.subject : `update ${joinAreas(coreAreas)}`;
  const commitType = getSummaryType(matches);

  return {
    commitMessage: `${commitType}(${primaryMatch.descriptor.scope}): ${commitSubject}`,
    fileCount: productFiles.length,
    areas: coreAreas.length > 0 ? coreAreas : [primaryMatch.descriptor.versionHistoryArea],
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

export function formatFinaliseDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

export function getFinaliseTimingSummaryLines(
  entries: FinaliseTimingEntry[],
  options: FinaliseTimingSummaryOptions = {}
): string[] {
  const slowThresholdMs = options.slowThresholdMs ?? DEFAULT_SLOW_TIMING_THRESHOLD_MS;
  const limit = options.limit ?? DEFAULT_TIMING_SUMMARY_LIMIT;
  const slowEntries = entries
    .filter((entry) => entry.durationMs >= slowThresholdMs)
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, limit);

  if (slowEntries.length === 0) {
    return [`Timing summary: no finalise steps exceeded ${formatFinaliseDuration(slowThresholdMs)}.`];
  }

  return [
    `Timing summary (steps over ${formatFinaliseDuration(slowThresholdMs)}):`,
    ...slowEntries.map((entry) => {
      const status = entry.status && entry.status !== 'completed' ? ` (${entry.status})` : '';
      return `- ${entry.label}: ${formatFinaliseDuration(entry.durationMs)}${status}`;
    }),
  ];
}
