'use client';

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { subscribeToAuthStateChange } from '@/lib/app-auth/client';
import { useAuth } from '@/lib/hooks/useAuth';
import { ALL_MODULES, type ModuleName } from '@/types/roles';
import {
  createStatusError,
  getErrorStatus,
  isAuthErrorStatus,
  isServerErrorStatus,
} from '@/lib/utils/http-error';

interface PermissionSnapshotResponse {
  permissions?: Record<ModuleName, boolean>;
  enabled_modules?: ModuleName[];
  effective_team_id?: string | null;
  effective_team_name?: string | null;
}

async function fetchPermissionSnapshot(): Promise<PermissionSnapshotResponse> {
  const response = await fetch('/api/me/permissions', { cache: 'no-store' });
  const rawPayload = await response.text();
  let data: (PermissionSnapshotResponse & { error?: string }) | null = null;

  if (rawPayload) {
    try {
      data = JSON.parse(rawPayload) as PermissionSnapshotResponse & { error?: string };
    } catch (error) {
      throw createStatusError('Invalid permissions response payload', response.status, error);
    }
  }

  if (!response.ok) {
    throw createStatusError(data?.error || 'Failed to load permissions', response.status);
  }

  return data || {};
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
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    if (authLoading || !profile?.id) {
      return;
    }

    const unsubscribe = subscribeToAuthStateChange(() => {
      void query.refetch();
    });

    return unsubscribe;
  }, [authLoading, profile?.id, query.refetch]);

  const enabledModules = useMemo(() => {
    if (isAdmin || isSuperAdmin) {
      return ALL_MODULES;
    }

    return query.data?.enabled_modules || [];
  }, [isAdmin, isSuperAdmin, query.data?.enabled_modules]);

  const enabledModuleSet = useMemo(() => new Set<ModuleName>(enabledModules), [enabledModules]);
  const errorStatus = getErrorStatus(query.error);
  const holdForRecovery = isAuthErrorStatus(errorStatus) && !query.data;
  const serviceUnavailable = Boolean(query.error) && (errorStatus === null || isServerErrorStatus(errorStatus));

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
    isLoading: authLoading || query.isLoading || holdForRecovery,
    error: query.error,
    errorStatus,
    serviceUnavailable,
    refetch: query.refetch,
  };
}
