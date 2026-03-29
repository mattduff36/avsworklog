interface PageVisitEntry {
  path: string;
  visited_at: string;
}

export interface QuickLinkItem {
  path: string;
  label: string;
  visitCount: number;
  lastVisitedAt: string;
}

const TRACKED_QUERY_KEYS = new Set(['tab']);

const PATH_LABELS: Array<{ startsWith: string; label: string }> = [
  { startsWith: '/dashboard', label: 'Dashboard' },
  { startsWith: '/profile', label: 'Profile' },
  { startsWith: '/timesheets', label: 'Timesheets' },
  { startsWith: '/van-inspections', label: 'Van Daily Checks' },
  { startsWith: '/plant-inspections', label: 'Plant Daily Checks' },
  { startsWith: '/hgv-inspections', label: 'HGV Daily Checks' },
  { startsWith: '/projects', label: 'Projects' },
  { startsWith: '/absence/manage', label: 'Manage Absence' },
  { startsWith: '/absence', label: 'Absence' },
  { startsWith: '/approvals', label: 'Approvals' },
  { startsWith: '/actions', label: 'Actions' },
  { startsWith: '/maintenance', label: 'Maintenance' },
  { startsWith: '/fleet', label: 'Fleet' },
  { startsWith: '/workshop-tasks', label: 'Workshop' },
  { startsWith: '/reports', label: 'Reports' },
  { startsWith: '/notifications', label: 'Notifications' },
  { startsWith: '/help', label: 'Help' },
  { startsWith: '/admin/users', label: 'Users' },
  { startsWith: '/admin/faq', label: 'FAQ Editor' },
  { startsWith: '/admin/errors/manage', label: 'Error Reports' },
];

function normalizeTrailingSlash(path: string): string {
  if (path === '/') return '/';
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

export function normalizeTrackedPath(rawPath: string): string {
  if (!rawPath) return '/';

  const candidate = rawPath.startsWith('http')
    ? new URL(rawPath)
    : new URL(rawPath, 'http://localhost');
  const pathname = normalizeTrailingSlash(candidate.pathname || '/');

  const nextParams = new URLSearchParams();
  candidate.searchParams.forEach((value, key) => {
    if (TRACKED_QUERY_KEYS.has(key)) {
      nextParams.set(key, value);
    }
  });

  const query = nextParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function shouldTrackPageVisit(path: string): boolean {
  const normalized = normalizeTrackedPath(path);
  const pathname = normalized.split('?')[0];

  if (!pathname.startsWith('/')) return false;
  if (pathname === '/login') return false;
  if (pathname.startsWith('/api')) return false;
  if (pathname.startsWith('/_next')) return false;
  if (pathname.startsWith('/static')) return false;
  if (pathname.startsWith('/favicon')) return false;

  return true;
}

export function getQuickLinkLabel(path: string): string {
  const pathname = normalizeTrackedPath(path).split('?')[0];
  const matching = PATH_LABELS.find((entry) => pathname.startsWith(entry.startsWith));
  if (matching) return matching.label;

  const cleaned = pathname.replace(/^\//, '').replace(/-/g, ' ');
  if (!cleaned) return 'Dashboard';
  return cleaned
    .split('/')
    .pop()
    ?.replace(/\b\w/g, (char) => char.toUpperCase()) || 'Page';
}

export function buildRecentQuickLinks(visits: PageVisitEntry[], limit = 5): QuickLinkItem[] {
  const sorted = [...visits].sort(
    (a, b) => new Date(b.visited_at).getTime() - new Date(a.visited_at).getTime()
  );

  const latestByPath = new Map<string, QuickLinkItem>();
  for (const visit of sorted) {
    const path = normalizeTrackedPath(visit.path);
    if (!shouldTrackPageVisit(path)) continue;
    if (latestByPath.has(path)) continue;

    latestByPath.set(path, {
      path,
      label: getQuickLinkLabel(path),
      visitCount: 1,
      lastVisitedAt: visit.visited_at,
    });
  }

  return Array.from(latestByPath.values()).slice(0, limit);
}

export function buildFrequentQuickLinks(visits: PageVisitEntry[], limit = 5): QuickLinkItem[] {
  const aggregation = new Map<string, QuickLinkItem>();

  visits.forEach((visit) => {
    const path = normalizeTrackedPath(visit.path);
    if (!shouldTrackPageVisit(path)) return;

    const current = aggregation.get(path);
    if (!current) {
      aggregation.set(path, {
        path,
        label: getQuickLinkLabel(path),
        visitCount: 1,
        lastVisitedAt: visit.visited_at,
      });
      return;
    }

    const previousLastVisitedAt = new Date(current.lastVisitedAt).getTime();
    const candidateLastVisitedAt = new Date(visit.visited_at).getTime();
    current.visitCount += 1;
    if (candidateLastVisitedAt > previousLastVisitedAt) {
      current.lastVisitedAt = visit.visited_at;
    }
  });

  return Array.from(aggregation.values())
    .sort((a, b) => {
      if (b.visitCount !== a.visitCount) return b.visitCount - a.visitCount;
      return new Date(b.lastVisitedAt).getTime() - new Date(a.lastVisitedAt).getTime();
    })
    .slice(0, limit);
}

