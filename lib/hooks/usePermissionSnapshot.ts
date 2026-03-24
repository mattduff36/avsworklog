'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/hooks/useAuth';
import { ALL_MODULES, type ModuleName } from '@/types/roles';

interface PermissionSnapshotResponse {
  permissions?: Record<ModuleName, boolean>;
  enabled_modules?: ModuleName[];
  effective_team_id?: string | null;
  effective_team_name?: string | null;
}

async function fetchPermissionSnapshot(): Promise<PermissionSnapshotResponse> {
  const response = await fetch('/api/me/permissions', { cache: 'no-store' });
  const data = (await response.json()) as PermissionSnapshotResponse & { error?: string };

  if (!response.ok) {
    throw new Error(data.error || 'Failed to load permissions');
  }

  return data;
}

export function usePermissionSnapshot() {
  const { profile, isAdmin, isSuperAdmin, isViewingAs, effectiveRole, loading: authLoading } = useAuth();

  const query = useQuery({
    queryKey: [
      'permission-snapshot',
      profile?.id || null,
      isViewingAs,
      effectiveRole?.name || null,
      effectiveRole?.team_id || null,
    ],
    enabled: !authLoading && Boolean(profile?.id) && !isAdmin && !isSuperAdmin,
    queryFn: fetchPermissionSnapshot,
    staleTime: 60_000,
  });

  const enabledModules = useMemo(() => {
    if (isAdmin || isSuperAdmin) {
      return ALL_MODULES;
    }

    return query.data?.enabled_modules || [];
  }, [isAdmin, isSuperAdmin, query.data?.enabled_modules]);

  const enabledModuleSet = useMemo(() => new Set<ModuleName>(enabledModules), [enabledModules]);

  const permissions = useMemo(() => {
    if (isAdmin || isSuperAdmin) {
      return ALL_MODULES.reduce<Record<ModuleName, boolean>>((acc, moduleName) => {
        acc[moduleName] = true;
        return acc;
      }, {} as Record<ModuleName, boolean>);
    }

    return query.data?.permissions || null;
  }, [isAdmin, isSuperAdmin, query.data?.permissions]);

  return {
    permissions,
    enabledModules,
    enabledModuleSet,
    effectiveTeamId: query.data?.effective_team_id || effectiveRole?.team_id || null,
    effectiveTeamName: query.data?.effective_team_name || effectiveRole?.team_name || null,
    isLoading: authLoading || query.isLoading,
    error: query.error,
  };
}
