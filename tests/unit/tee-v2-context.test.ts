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
      '.cursor/rules/createinvoice.mdc',
      '.cursor/rules/fixerrors.mdc',
      '.cursor/rules/workflow-review.mdc',
      '.cursor/rules/cleancodebase.mdc',
      '.cursor/rules/minimal-diffs.mdc',
    ]) {
      expect(existsSync(path.join(root, removed)), removed).toBe(false);
    }

    const fap = readFileSync(path.join(commandDirectory, 'fap.md'), 'utf8');
    const ffap = readFileSync(path.join(commandDirectory, 'ffap.md'), 'utf8');
    const finalise = readFileSync(path.join(commandDirectory, 'finalise.md'), 'utf8');
    const finaliseFull = readFileSync(path.join(commandDirectory, 'finalise-full.md'), 'utf8');
    const core = readFileSync(path.join(root, '.cursor', 'rules', 'squires-core.mdc'), 'utf8');
    const finaliseCommands = readFileSync(
      path.join(root, '.cursor', 'rules', 'finalise-commands.mdc'),
      'utf8'
    );
    expect(fap).toMatch(/authorizes `npm run finalise:push`/iu);
    expect(ffap).toMatch(/authorizes `npm run finalise:full:push`/iu);
    expect(fap).toMatch(/authorized push phrase/iu);
    expect(ffap).toMatch(/authorized push phrase/iu);
    expect(fap).toMatch(/COMPLETE_AND_RELEASE\(normal\)/);
    expect(ffap).toMatch(/COMPLETE_AND_RELEASE\(full\)/);
    expect(fap).not.toMatch(/does \*\*not\*\* authorize pushing/iu);
    expect(ffap).not.toMatch(/does \*\*not\*\* authorize pushing/iu);
    expect(finalise).toMatch(/not push/iu);
    expect(finaliseFull).toMatch(/not push/iu);
    expect(core).toMatch(/`fap` \/ `\/fap`/);
    expect(core).toMatch(/`ffap` \/ `\/ffap`/);
    expect(core).not.toMatch(/do \*\*not\*\* authorize a push/iu);
    expect(finaliseCommands).toMatch(/Map `finalise and push` and `fap`/);
    expect(finaliseCommands).toMatch(/Map `finalise full and push` and `ffap`/);
    expect(finaliseCommands).not.toMatch(/do \*\*not\*\* authorize a push/iu);
    const agents = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    const development = readFileSync(path.join(root, 'docs', 'DEVELOPMENT.md'), 'utf8');
    expect(agents).toMatch(/`fap` \/ `\/fap`/);
    expect(agents).not.toMatch(/do not authorize a push/iu);
    expect(development).toMatch(/COMPLETE_AND_RELEASE/);
    expect(development).toContain('npm run finalise:push');
    expect(development).not.toMatch(/do not authorize GitHub push/iu);
    expect(existsSync(path.join(root, '.cursor', 'rules', 'finalise-commands.mdc'))).toBe(true);
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

  it('TEE-V2-CURRENT-TRUTH-001 keeps current-truth docs and rule frontmatter', () => {
    for (const relativePath of [
      'AGENTS.md',
      'DESIGN.md',
      'ARCHITECTURE.md',
      'docs/DEVELOPMENT.md',
      'docs/SECURITY.md',
    ]) {
      expect(existsSync(path.join(root, relativePath)), relativePath).toBe(true);
    }

    expect(existsSync(path.join(root, 'docs/PROJECT_RULES_SUMMARY.md'))).toBe(false);
    expect(existsSync(path.join(root, 'docs/DEVELOPMENT_STANDARDS_AND_TEMPLATES.md'))).toBe(
      false
    );
    expect(
      existsSync(path.join(root, 'docs/archived/PROJECT_RULES_SUMMARY_NOV_2025.md'))
    ).toBe(true);
    expect(
      existsSync(
        path.join(root, 'docs/archived/DEVELOPMENT_STANDARDS_AND_TEMPLATES_DEC_2025.md')
      )
    ).toBe(true);

    const development = readFileSync(path.join(root, 'docs/DEVELOPMENT.md'), 'utf8');
    expect(development).toContain('docs/archived/DEVELOPMENT_STANDARDS_AND_TEMPLATES_DEC_2025.md');
    expect(development).not.toContain('docs/DEVELOPMENT_STANDARDS_AND_TEMPLATES.md');
    expect(development).toContain('This file (`docs/DEVELOPMENT.md`) replaces it as current guidance');

    const ignored = readFileSync(path.join(root, '.cursorignore'), 'utf8');
    expect(ignored).toContain('docs/archived/**');
    expect(ignored).toMatch(/^\.env$/m);
    expect(ignored).toMatch(/^\.env\.\*$/m);
    expect(ignored).toContain('!.env.example');

    const uiDesign = readFileSync(path.join(root, '.cursor', 'rules', 'ui-design.mdc'), 'utf8');
    expect(uiDesign).toContain('globs: "{app,components}/**/*.{tsx,css}"');
    expect(uiDesign).toMatch(/alwaysApply:\s*false/);
    expect(uiDesign).toMatch(/trivial local/i);

    for (const rule of ['ui-design.mdc', 'architecture.mdc', 'security-data.mdc']) {
      const text = readFileSync(path.join(root, '.cursor', 'rules', rule), 'utf8');
      expect(text.startsWith('---')).toBe(true);
      expect(text).toMatch(/^---\r?\n[\s\S]*?\r?\n---/u);
    }
  });
});
