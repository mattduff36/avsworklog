import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import {
  buildReleaseHistoryEntries,
  type ReleaseHistoryEntry,
  RELEASE_HISTORY_PATH,
  RELEASE_LOG_PATH,
} from '../lib/config/release-version-logic';

const REPO_ROOT = process.cwd();
const releaseLogPath = path.join(REPO_ROOT, RELEASE_LOG_PATH);
const releaseHistoryPath = path.join(REPO_ROOT, RELEASE_HISTORY_PATH);

interface ReleaseLogRepair {
  primaryCommitMessage: string;
  whatChanged: string;
  commitMessages: string[];
}

const REPAIRS: Record<string, ReleaseLogRepair> = {
  '0626.25.0': {
    primaryCommitMessage: 'feat(debug): update debug tools and inventory',
    whatChanged: 'Updated Debug tools and Inventory.',
    commitMessages: [
      'feat(debug): add job-code correction tools',
      'feat(inventory): improve inventory screens',
    ],
  },
};

function readExistingTimestampLookup(): Record<string, string | null> {
  if (!existsSync(releaseHistoryPath)) return {};

  const entries = JSON.parse(readFileSync(releaseHistoryPath, 'utf8')) as ReleaseHistoryEntry[];
  return entries.reduce<Record<string, string | null>>((acc, entry) => {
    acc[entry.version] = entry.pushedAt;
    return acc;
  }, {});
}

function replaceSection(lines: string[], label: string, replacement: string[]): string[] {
  const labelIndex = lines.findIndex((line) => line.trim() === label);
  if (labelIndex === -1) return lines;

  let endIndex = labelIndex + 1;
  while (endIndex < lines.length) {
    const line = lines[endIndex]?.trim() ?? '';
    if (line.startsWith('**') && line.endsWith('**')) break;
    endIndex += 1;
  }

  return [
    ...lines.slice(0, labelIndex + 1),
    ...replacement,
    '',
    ...lines.slice(endIndex).filter((line, index) => index !== 0 || line.trim() !== ''),
  ];
}

function repairReleaseBlock(version: string, block: string): string {
  const repair = REPAIRS[version];
  if (!repair) return block;

  let lines = block.split(/\r?\n/u);
  lines = replaceSection(lines, '**GIT COMMIT MESSAGE**', [`\`${repair.primaryCommitMessage}\``]);
  lines = replaceSection(lines, '**WHAT CHANGED**', [repair.whatChanged]);
  lines = replaceSection(
    lines,
    '**COMMITS IN THIS RELEASE**',
    repair.commitMessages.map((message) => `- \`${message}\``)
  );

  return lines.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd();
}

function repairReleaseLog(content: string): string {
  const headings = Array.from(content.matchAll(/^##\s+(\d{4}\.\d+\.\d+)\s*$/gmu));
  if (headings.length === 0) return content;

  let repaired = '';
  let cursor = 0;
  headings.forEach((heading, index) => {
    const start = heading.index ?? 0;
    const nextStart = headings[index + 1]?.index ?? content.length;
    repaired += content.slice(cursor, start);
    repaired += repairReleaseBlock(heading[1] ?? '', content.slice(start, nextStart));
    repaired += '\n\n';
    cursor = nextStart;
  });
  repaired += content.slice(cursor);

  return `${repaired.trimEnd()}\n`;
}

function main() {
  const releaseLog = readFileSync(releaseLogPath, 'utf8');
  const repairedReleaseLog = repairReleaseLog(releaseLog);
  const timestampLookup = readExistingTimestampLookup();
  const releaseHistory = buildReleaseHistoryEntries(repairedReleaseLog, timestampLookup);

  writeFileSync(releaseLogPath, repairedReleaseLog);
  writeFileSync(releaseHistoryPath, `${JSON.stringify(releaseHistory, null, 2)}\n`);

  console.log(`Repaired ${Object.keys(REPAIRS).join(', ')} and regenerated ${RELEASE_HISTORY_PATH}.`);
}

main();
