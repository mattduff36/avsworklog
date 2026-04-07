'use client';

import { useQuery } from '@tanstack/react-query';
import {
  createStatusError,
  getErrorStatus,
  isServerErrorStatus,
} from '@/lib/utils/http-error';
import type {
  AbsenceSecondaryPermissionKey,
  AbsenceSecondaryPermissionMap,
  AbsenceSecondaryRoleTier,
} from '@/types/absence-permissions';

export interface AbsenceSecondaryFlags {
  can_view_bookings: boolean;
  can_add_edit_bookings: boolean;
  can_view_allowances: boolean;
  can_add_edit_allowances: boolean;
  can_view_manage_overview: boolean;
  can_view_manage_overview_all: boolean;
  can_view_manage_overview_team: boolean;
  can_view_manage_reasons: boolean;
  can_view_manage_work_shifts: boolean;
  can_view_manage_work_shifts_all: boolean;
  can_view_manage_work_shifts_team: boolean;
  can_edit_manage_work_shifts: boolean;
  can_edit_manage_work_shifts_all: boolean;
  can_edit_manage_work_shifts_team: boolean;
  can_authorise_bookings: boolean;
}

export interface AbsenceSecondarySnapshot {
  role_tier: AbsenceSecondaryRoleTier;
  role_name: string | null;
  role_display_name: string | null;
  team_id: string | null;
  team_name: string | null;
  has_exception_row: boolean;
  defaults: AbsenceSecondaryPermissionMap;
  permissions: AbsenceSecondaryPermissionMap;
  flags: AbsenceSecondaryFlags;
}

export interface ScopedPermissionKeys {
  all: AbsenceSecondaryPermissionKey;
  team: AbsenceSecondaryPermissionKey;
  own: AbsenceSecondaryPermissionKey;
}

export interface ScopedPermissionTarget {
  profile_id: string;
  team_id: string | null;
}

export function canUseScopedAbsencePermission(
  snapshot: Pick<AbsenceSecondarySnapshot, 'permissions' | 'team_id'>,
  actorProfileId: string,
  target: ScopedPermissionTarget,
  keys: ScopedPermissionKeys
): boolean {
  if (snapshot.permissions[keys.all]) return true;
  if (target.profile_id === actorProfileId && snapshot.permissions[keys.own]) return true;
  return Boolean(snapshot.team_id && target.team_id && snapshot.team_id === target.team_id && snapshot.permissions[keys.team]);
}

export function useAbsenceSecondaryPermissions(enabled = true) {
  const query = useQuery({
    queryKey: ['absence-secondary-permissions', 'me'],
    enabled,
    refetchOnMount: 'always',
    queryFn: async () => {
      const response = await fetch('/api/absence/permissions/secondary/me', { cache: 'no-store' });
      const rawPayload = await response.text();
      let payload: ({ error?: string } & Partial<AbsenceSecondarySnapshot>) | null = null;

      if (rawPayload) {
        try {
          payload = JSON.parse(rawPayload) as { error?: string } & Partial<AbsenceSecondarySnapshot>;
        } catch (error) {
          throw createStatusError('Invalid absence secondary permissions response payload', response.status, error);
        }
      }

      if (!response.ok) {
        throw createStatusError(payload?.error || 'Failed to load absence secondary permissions', response.status);
      }

      if (!payload?.permissions || !payload.flags || !payload.role_tier) {
        throw createStatusError('Absence secondary permissions response is incomplete', response.status);
      }

      return payload as AbsenceSecondarySnapshot;
    },
    staleTime: 30_000,
  });

  const errorStatus = getErrorStatus(query.error);
  const serviceUnavailable = Boolean(query.error) && (errorStatus === null || isServerErrorStatus(errorStatus));

  return {
    ...query,
    errorStatus,
    serviceUnavailable,
  };
}

