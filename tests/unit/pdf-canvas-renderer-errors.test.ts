import { describe, expect, it } from 'vitest';
import { isExpectedPdfRenderError } from '@/lib/pdf/render-errors';

describe('isExpectedPdfRenderError', () => {
  it('returns true for RenderingCancelledException by name', () => {
    const error = new Error('Some PDF render error');
    error.name = 'RenderingCancelledException';

    expect(isExpectedPdfRenderError(error)).toBe(true);
  });

  it('returns true for rendering cancelled message', () => {
    const error = new Error('Rendering cancelled, page 8');

    expect(isExpectedPdfRenderError(error)).toBe(true);
  });

  it('returns false for non-cancellation render errors', () => {
    const error = new Error('Failed to fetch');

    expect(isExpectedPdfRenderError(error)).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isExpectedPdfRenderError('Rendering cancelled')).toBe(false);
    expect(isExpectedPdfRenderError(null)).toBe(false);
  });
});
