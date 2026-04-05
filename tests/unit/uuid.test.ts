import { describe, expect, it } from 'vitest';

import { isUuid } from '@/lib/utils/uuid';

describe('isUuid', () => {
  it('accepts valid UUID values', () => {
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
  });

  it('rejects category slugs and empty values', () => {
    expect(isUuid('civils')).toBe(false);
    expect(isUuid('transport')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
