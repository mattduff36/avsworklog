import { describe, expect, it } from 'vitest';
import { isPublicBrowserPath } from '@/lib/routes/public-routes';

describe('Fresh UI public route boundary', () => {
  it('allows only the exact demo login route', () => {
    expect(isPublicBrowserPath('/demo/login')).toBe(true);
    expect(isPublicBrowserPath('/demo/login?redirect=%2Fdemo')).toBe(true);
    expect(isPublicBrowserPath('/demo/login/extra')).toBe(false);
    expect(isPublicBrowserPath('/demo')).toBe(false);
    expect(isPublicBrowserPath('/demo/dashboard')).toBe(false);
  });
});
