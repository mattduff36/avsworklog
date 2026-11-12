import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('preserves fixed provider failures through native dispatch without leaking private text or reporting no-change', () => {
  const output = execFileSync('python', ['-I', '-B', 'tests/fixtures/fixerrors_worker_failure.py'], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000,
  });
  expect(output).toContain('failed batch result verified');
  expect(output).not.toContain('PRIVATE_');
});
