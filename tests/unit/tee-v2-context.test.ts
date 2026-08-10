import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('TEE V2 project context', () => {
  it('TEE-V2-COMMANDS-RULES-001 exposes eight commands and removes procedural rules', () => {
    const commandDirectory = path.join(root, '.cursor', 'commands');
    expect(readdirSync(commandDirectory).sort()).toEqual([
      'cleancodebase.md',
      'createinvoice.md',
      'fap.md',
      'ffap.md',
      'finalise-full.md',
      'finalise.md',
      'fixerrors.md',
      'workflow-review.md',
    ]);
    for (const removed of [
      '.cursorrules',
      '.cursor/rules/token-efficient-engineering.mdc',
      '.cursor/rules/finalise-commands.mdc',
      '.cursor/rules/createinvoice.mdc',
      '.cursor/rules/fixerrors.mdc',
      '.cursor/rules/workflow-review.mdc',
      '.cursor/rules/cleancodebase.mdc',
      '.cursor/rules/minimal-diffs.mdc',
    ]) {
      expect(existsSync(path.join(root, removed)), removed).toBe(false);
    }

    const fap = readFileSync(path.join(commandDirectory, 'fap.md'), 'utf8');
    const finalise = readFileSync(path.join(commandDirectory, 'finalise.md'), 'utf8');
    expect(fap).toMatch(/authorizes.+pushing/iu);
    expect(finalise).toMatch(/not push/iu);
  });

  it('TEE-V2-LARGE-FILE-001 has no forced line-count refactor policy', () => {
    const activeRuleText = readdirSync(path.join(root, '.cursor', 'rules'))
      .filter((name) => name.endsWith('.mdc'))
      .map((name) => readFileSync(path.join(root, '.cursor', 'rules', name), 'utf8'))
      .join('\n');
    expect(activeRuleText).not.toMatch(/over\s+800\s+lines[\s\S]{0,80}refactor/iu);
    expect(activeRuleText).not.toContain('refactor it into smaller components/hooks before feature edits');
  });

  it('keeps database intent discoverable without always loading detailed procedure', () => {
    const core = readFileSync(path.join(root, '.cursor', 'rules', 'squires-core.mdc'), 'utf8');
    const database = readFileSync(
      path.join(root, '.cursor', 'rules', 'database-migrations.mdc'),
      'utf8'
    );
    expect(core).toContain('load `.cursor/rules/database-migrations.mdc`');
    expect(database).toContain('alwaysApply: false');
    expect(database).toContain('HOW_TO_RUN_MIGRATIONS.md');
    expect(database).toContain('npm run db:validate');
  });

  it('TEE-V2-COMMANDS-RULES-001 keeps active workflow source indexed while excluding historical telemetry', () => {
    const ignored = readFileSync(path.join(root, '.cursorignore'), 'utf8');
    expect(ignored).toContain('docs_private/automation/runs/**');
    expect(ignored).toContain('docs_private/automation/workflow-events/**');
    expect(ignored).toContain('docs_private/automation/reviews/*/20*/events.json');
    expect(ignored).toContain('.cursor/debug*.log');
    expect(ignored).not.toContain('scripts/automation/');
    expect(ignored).not.toContain('docs_private/automation/workstreams/');
    expect(ignored).not.toContain('docs_private/automation/knowledge/');
  });

  it('TEE-V2-SCOPE-SAFETY-001 keeps TEE workflow assets outside application and data surfaces', () => {
    for (const forbidden of [
      'app/tee',
      'components/tee',
      'lib/tee',
      'supabase/tee',
      'public/tee',
      'scripts/migrations/tee',
    ]) {
      expect(existsSync(path.join(root, forbidden)), forbidden).toBe(false);
    }

    expect(existsSync(path.join(root, '.cursor', 'commands', 'ffap.md'))).toBe(true);
    expect(existsSync(path.join(root, 'scripts', 'automation'))).toBe(true);
  });
});
