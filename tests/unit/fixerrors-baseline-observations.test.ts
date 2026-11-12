import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Fixerrors baseline observations', () => {
  it('records a failing assertion, requires a green repair and rejects an uncollected suite', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'FixerrorsBaseline-'));
    const modules = path.join(root, 'node_modules');
    const file = 'tests/unit/response.test.ts';
    const script = path.resolve('scripts/automation/fixerrors-scoped-check.mjs');
    const run = (mode: string) => spawnSync(process.execPath, [script, mode, file], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 45_000,
    });
    symlinkSync(path.resolve('node_modules'), modules, 'junction');
    try {
      execFileSync('git', ['init', '-q'], { cwd: root });
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit',
        '--allow-empty', '-qm', 'Empty disposable baseline'], { cwd: root });
      mkdirSync(path.join(root, 'tests/unit'), { recursive: true });
      const testPath = path.join(root, file);
      const source = 'import { expect, it } from "vitest"; it("surfaces the rejection", () => expect(401).toBe(500));';
      writeFileSync(testPath, source);
      const red = run('observe-tests');
      expect(red.status, red.stderr).toBe(0);
      expect(red.stdout).toContain('0 passed, 1 failed');
      expect(run('targeted-tests').status).toBe(1);
      writeFileSync(testPath, source.replace('toBe(500)', 'toBe(401)'));
      expect(run('targeted-tests').status).toBe(0);
      writeFileSync(testPath, 'import "./missing-dependency";\n' + source);
      expect(run('observe-tests').status).toBe(1);
    } finally {
      unlinkSync(modules);
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
