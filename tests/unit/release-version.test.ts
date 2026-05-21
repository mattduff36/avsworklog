import { describe, expect, it } from 'vitest';
import {
  buildWhatChangedSummary,
  computeNextVersionState,
  determineBumpKind,
  formatReleaseLogEntry,
  formatReleaseVersion,
  getCurrentMmyy,
  parseConventionalCommit,
  parseCommitsFromMessages,
  prependReleaseLogEntry,
  selectPrimaryCommitMessage,
  selectReleasePrimaryCommitMessage,
  shouldSkipVersionBumpCommit,
} from '@/lib/config/release-version-logic';

describe('release version logic', () => {
  it('formats mmyy from Europe/London calendar month', () => {
    const may2026 = new Date('2026-05-21T12:00:00Z');
    expect(getCurrentMmyy(may2026)).toBe('0526');
  });

  it('formats release version string', () => {
    expect(formatReleaseVersion({ mmyy: '0526', major: 1, minor: 3 })).toBe('0526.1.3');
  });

  it('parses conventional commits and skips version bump commits', () => {
    expect(parseConventionalCommit('feat(fleet): add plant table layout')).toEqual({
      raw: 'feat(fleet): add plant table layout',
      type: 'feat',
      scope: 'fleet',
      subject: 'add plant table layout',
      isBreaking: false,
    });

    expect(shouldSkipVersionBumpCommit('chore(release): bump to 0526.1.0 [skip version]')).toBe(true);
    expect(parseConventionalCommit('chore(release): bump to 0526.1.0 [skip version]')).toBeNull();
  });

  it('parses scoped breaking changes with bang after the scope', () => {
    expect(parseConventionalCommit('fix(api)!: remove endpoint')).toEqual({
      raw: 'fix(api)!: remove endpoint',
      type: 'fix',
      scope: 'api',
      subject: 'remove endpoint',
      isBreaking: true,
    });
  });

  it('treats feat as major and fix as minor', () => {
    const featOnly = parseCommitsFromMessages(['feat(ui): new dashboard']);
    const fixOnly = parseCommitsFromMessages(['fix(api): handle timeout']);
    const scopedBreakingFix = parseCommitsFromMessages(['fix(api)!: remove endpoint']);

    expect(determineBumpKind(featOnly)).toBe('major');
    expect(determineBumpKind(fixOnly)).toBe('minor');
    expect(determineBumpKind(scopedBreakingFix)).toBe('major');
  });

  it('prefers feat commit for primary git commit message', () => {
    const commits = parseCommitsFromMessages([
      'fix(fleet): normalize serial numbers',
      'feat(fleet): improve plant table layout',
    ]);

    expect(selectPrimaryCommitMessage(commits)).toBe('feat(fleet): improve plant table layout');
  });

  it('bumps major and resets minor on feat', () => {
    const current = { mmyy: '0526', major: 1, minor: 4, lastProcessedSha: 'abc' };
    const commits = parseCommitsFromMessages(['feat(fleet): import assets']);
    const now = new Date('2026-05-21T12:00:00Z');

    const { next, bumpKind } = computeNextVersionState(current, commits, now);
    expect(bumpKind).toBe('major');
    expect(next).toEqual({ mmyy: '0526', major: 2, minor: 0, lastProcessedSha: 'abc' });
  });

  it('bumps minor on fix', () => {
    const current = { mmyy: '0526', major: 1, minor: 2, lastProcessedSha: 'abc' };
    const commits = parseCommitsFromMessages(['fix(fleet): serial numbers']);
    const now = new Date('2026-05-21T12:00:00Z');

    const { next, bumpKind } = computeNextVersionState(current, commits, now);
    expect(bumpKind).toBe('minor');
    expect(next.minor).toBe(3);
    expect(next.major).toBe(1);
  });

  it('resets to mmyy.0.0 when calendar month changes', () => {
    const current = { mmyy: '0526', major: 2, minor: 4, lastProcessedSha: 'abc' };
    const commits = parseCommitsFromMessages(['feat(fleet): june feature']);
    const june = new Date('2026-06-02T12:00:00Z');

    const { next, bumpKind } = computeNextVersionState(current, commits, june);
    expect(bumpKind).toBe('month_reset');
    expect(next).toEqual({ mmyy: '0626', major: 0, minor: 0, lastProcessedSha: 'abc' });
  });

  it('still resets the month when no conventional commits were parsed', () => {
    const current = { mmyy: '0526', major: 2, minor: 4, lastProcessedSha: 'abc' };
    const june = new Date('2026-06-02T12:00:00Z');

    const { next, bumpKind } = computeNextVersionState(current, [], june);
    expect(bumpKind).toBe('month_reset');
    expect(next).toEqual({ mmyy: '0626', major: 0, minor: 0, lastProcessedSha: 'abc' });
    expect(selectPrimaryCommitMessage([])).toBeNull();
    expect(selectReleasePrimaryCommitMessage([], bumpKind, next)).toBe(
      'chore(release): reset release version for 0626'
    );
  });

  it('returns none when no eligible commits', () => {
    const current = { mmyy: '0526', major: 0, minor: 0, lastProcessedSha: '' };
    const { bumpKind, next } = computeNextVersionState(current, [], new Date('2026-05-21T12:00:00Z'));
    expect(bumpKind).toBe('none');
    expect(next).toEqual(current);
  });

  it('builds what changed paragraph from commit subjects', () => {
    const commits = parseCommitsFromMessages([
      'feat(fleet): import plant assets',
      'fix(fleet): normalize serial numbers',
    ]);

    expect(buildWhatChangedSummary(commits)).toBe(
      'Import plant assets. Normalize serial numbers.'
    );
  });

  it('formats release log entry in the required structure', () => {
    const entry = formatReleaseLogEntry({
      version: '0526.1.0',
      primaryCommitMessage: 'feat(fleet): improve plant table layout',
      whatChanged: 'Improved plant table layout.',
      commitMessages: [
        'feat(fleet): import plant assets',
        'fix(fleet): normalize serial numbers',
      ],
    });

    expect(entry).toContain('## 0526.1.0');
    expect(entry).toContain('**GIT COMMIT MESSAGE**');
    expect(entry).toContain('`feat(fleet): improve plant table layout`');
    expect(entry).toContain('**WHAT CHANGED**');
    expect(entry).toContain('**COMMITS IN THIS RELEASE**');
    expect(entry).toContain('- `fix(fleet): normalize serial numbers`');
  });

  it('prepends newest log entry after preamble', () => {
    const updated = prependReleaseLogEntry(
      '# Production release log\n\nPrivate changelog for production builds. Newest entries first.\n\n## 0526.0.0\n',
      '## 0526.1.0\n\n**GIT COMMIT MESSAGE**\n`feat(app): test`\n'
    );

    expect(updated.indexOf('## 0526.1.0')).toBeLessThan(updated.indexOf('## 0526.0.0'));
  });
});
