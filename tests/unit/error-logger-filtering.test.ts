import { describe, expect, it } from 'vitest';
import {
  shouldIgnoreConsoleErrorForLogging,
  shouldIgnoreRuntimeErrorForLogging,
} from '@/lib/utils/error-logger';

describe('error logger filtering', () => {
  it('ignores generic script errors with no source location', () => {
    expect(shouldIgnoreRuntimeErrorForLogging('Script error.')).toBe(true);
  });

  it('keeps script errors that include a source location', () => {
    expect(shouldIgnoreRuntimeErrorForLogging('Script error.', '/third-party/widget.js')).toBe(false);
  });

  it('ignores generic script errors from minified Next assets', () => {
    expect(shouldIgnoreRuntimeErrorForLogging('Script error.', '/_next/static/chunks/app/page.js')).toBe(true);
  });

  it('ignores stale Next chunk load failures', () => {
    expect(
      shouldIgnoreRuntimeErrorForLogging(
        'Loading chunk 2773 failed.\n(error: https://www.squiresapp.com/_next/static/chunks/2773.js)'
      )
    ).toBe(true);
  });

  it('ignores Next router RSC fetch fallback console noise', () => {
    expect(
      shouldIgnoreConsoleErrorForLogging(
        'Failed to fetch RSC payload for https://www.squiresapp.com/plant-inspections. Falling back to browser navigation. TypeError: Load failed'
      )
    ).toBe(true);
  });
});
