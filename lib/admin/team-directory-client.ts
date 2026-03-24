export interface AdminTeamDirectoryTeam {
  id: string;
  team_id?: string;
  name: string;
  code?: string | null;
  timesheet_type?: string | null;
  active: boolean;
  member_count: number;
  manager_count: number;
  without_manager_count: number;
  manager_1_id?: string | null;
  manager_2_id?: string | null;
  manager_1_name?: string | null;
  manager_2_name?: string | null;
}

export interface AdminTeamDirectoryManagerOption {
  id: string;
  full_name: string;
  employee_id?: string | null;
  is_placeholder: boolean;
  role_class: 'admin' | 'manager' | 'employee';
  label: string;
}

export interface AdminTeamDirectoryResponse {
  configured?: boolean;
  warning?: string;
  teams?: AdminTeamDirectoryTeam[];
  manager_options?: AdminTeamDirectoryManagerOption[];
}

interface AdminTeamDirectoryCache {
  data?: AdminTeamDirectoryResponse;
  fetchedAt: number;
  promise?: Promise<AdminTeamDirectoryResponse>;
}

const CACHE_TTL_MS = 30_000;

declare global {
  var __adminTeamDirectoryCache__: AdminTeamDirectoryCache | undefined;
}

function getCache(): AdminTeamDirectoryCache {
  if (!globalThis.__adminTeamDirectoryCache__) {
    globalThis.__adminTeamDirectoryCache__ = {
      fetchedAt: 0,
    };
  }

  return globalThis.__adminTeamDirectoryCache__;
}

export function invalidateAdminTeamDirectoryCache(): void {
  const cache = getCache();
  cache.data = undefined;
  cache.fetchedAt = 0;
  cache.promise = undefined;
}

export async function fetchAdminTeamDirectory(options?: {
  force?: boolean;
}): Promise<AdminTeamDirectoryResponse> {
  const cache = getCache();
  const isFresh = Date.now() - cache.fetchedAt < CACHE_TTL_MS;

  if (!options?.force && cache.data && isFresh) {
    return cache.data;
  }

  if (!options?.force && cache.promise) {
    return cache.promise;
  }

  const requestPromise = fetch('/api/admin/hierarchy/teams', { cache: 'no-store' })
    .then(async (response) => {
      const data = (await response.json()) as AdminTeamDirectoryResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load team directory');
      }

      cache.data = data;
      cache.fetchedAt = Date.now();
      return data;
    })
    .finally(() => {
      if (cache.promise === requestPromise) {
        cache.promise = undefined;
      }
    });

  cache.promise = requestPromise;
  return requestPromise;
}
