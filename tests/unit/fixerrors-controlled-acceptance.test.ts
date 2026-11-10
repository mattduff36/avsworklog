import { describe, expect, it } from 'vitest';
import { syntheticDisplayLabel } from '@/lib/utils/fixerrors-controlled-acceptance';

describe('SYNTHETIC Fixerrors controlled acceptance; not a production incident', () => {
  it('requires trimming both ends; an accepted repair removes this expected-failure marker', () => {
    expect(syntheticDisplayLabel(' fixture ')).toBe('fixture');
  });
});
