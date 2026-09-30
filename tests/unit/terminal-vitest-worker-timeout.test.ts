import { describe, expect, it } from 'vitest';
import { acceptKnownVitestWorkerTimeout } from '../../scripts/testing/run-terminal-tests';

const summary = `
 Test Files  625 passed | 27 skipped (652)
      Tests  3720 passed | 216 skipped (3936)
     Errors  1 error
`;

describe('acceptKnownVitestWorkerTimeout', () => {
  it('accepts a passing suite whose only unhandled error is the worker timeout', () => {
    const output = `
⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
${summary}`;
    expect(acceptKnownVitestWorkerTimeout(output, '')).toBe(true);
  });

  it('rejects a passing suite that also has an unhandled rejection', () => {
    const output = `
⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯
error: Retired inventory items cannot be checked
⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
${summary}`;
    expect(acceptKnownVitestWorkerTimeout(output, '')).toBe(false);
  });

  it('rejects a failed test file', () => {
    const output = `
⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
 Test Files  1 failed | 624 passed (652)
      Tests  1 failed | 3719 passed (3936)
`;
    expect(acceptKnownVitestWorkerTimeout(output, '')).toBe(false);
  });
});
