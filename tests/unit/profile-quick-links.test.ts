import { describe, expect, it } from 'vitest';
import {
  buildFrequentQuickLinks,
  buildRecentQuickLinks,
  normalizeTrackedPath,
  shouldTrackPageVisit,
} from '@/lib/profile/quick-links';

describe('profile quick links helpers', () => {
  it('normalizes path and keeps whitelisted query keys only', () => {
    expect(normalizeTrackedPath('/approvals?tab=timesheets&foo=bar')).toBe('/approvals?tab=timesheets');
    expect(normalizeTrackedPath('/timesheets/')).toBe('/timesheets');
  });

  it('rejects untracked paths', () => {
    expect(shouldTrackPageVisit('/api/profile/overview')).toBe(false);
    expect(shouldTrackPageVisit('/_next/static/chunk.js')).toBe(false);
    expect(shouldTrackPageVisit('/dashboard')).toBe(true);
  });

  it('builds recent unique links in latest-first order', () => {
    const recent = buildRecentQuickLinks([
      { path: '/timesheets', visited_at: '2026-03-29T12:00:00.000Z' },
      { path: '/help?tab=errors', visited_at: '2026-03-29T13:00:00.000Z' },
      { path: '/timesheets', visited_at: '2026-03-29T14:00:00.000Z' },
      { path: '/absence', visited_at: '2026-03-29T15:00:00.000Z' },
    ]);

    expect(recent.map((item) => item.path)).toEqual(['/absence', '/timesheets', '/help?tab=errors']);
  });

  it('builds frequent links sorted by count then recency', () => {
    const frequent = buildFrequentQuickLinks([
      { path: '/timesheets', visited_at: '2026-03-29T12:00:00.000Z' },
      { path: '/help?tab=errors', visited_at: '2026-03-29T13:00:00.000Z' },
      { path: '/timesheets', visited_at: '2026-03-29T14:00:00.000Z' },
      { path: '/help?tab=errors', visited_at: '2026-03-29T15:00:00.000Z' },
      { path: '/timesheets', visited_at: '2026-03-29T16:00:00.000Z' },
    ]);

    expect(frequent[0].path).toBe('/timesheets');
    expect(frequent[0].visitCount).toBe(3);
    expect(frequent[1].path).toBe('/help?tab=errors');
    expect(frequent[1].visitCount).toBe(2);
  });
});

