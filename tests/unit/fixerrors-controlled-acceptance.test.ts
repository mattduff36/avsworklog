import { describe, expect, it } from 'vitest';
import { syntheticDisplayLabel } from '@/lib/utils/fixerrors-controlled-acceptance';

describe('SYNTHETIC Fixerrors controlled acceptance; not a production incident', () => {
  it.fails('trims both ends', () => {
    expect(syntheticDisplayLabel(' fixture ')).toBe('fixture');
  });

  it.fails('trims leading whitespace only', () => {
    expect(syntheticDisplayLabel(' \tfixture')).toBe('fixture');
  });

  it('trims trailing whitespace only', () => {
    expect(syntheticDisplayLabel('fixture\t ')).toBe('fixture');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(syntheticDisplayLabel(' \t\n ')).toBe('');
  });

  it('preserves input without surrounding whitespace', () => {
    expect(syntheticDisplayLabel('fixture label')).toBe('fixture label');
    expect(syntheticDisplayLabel('')).toBe('');
  });
});
