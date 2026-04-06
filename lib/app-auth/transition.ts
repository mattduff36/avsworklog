import type { ClientAuthSessionResponse } from '@/lib/app-auth/client-session';

export type AuthTransitionReason =
  | 'initial_load'
  | 'interval'
  | 'visibility'
  | 'focus'
  | 'online'
  | 'broadcast'
  | 'sign_in'
  | 'sign_out'
  | 'recover'
  | 'manual';

export interface AuthSessionSnapshot {
  authenticated: boolean;
  locked: boolean;
  userId: string | null;
  profileId: string | null;
}

export interface AuthSessionTransition {
  changed: boolean;
  authChanged: boolean;
  lockChanged: boolean;
  userChanged: boolean;
  profileChanged: boolean;
  becameAuthenticated: boolean;
  becameUnauthenticated: boolean;
  becameLocked: boolean;
  becameUnlocked: boolean;
  shouldInvalidateToken: boolean;
}

export function getUnauthenticatedSessionSnapshot(): AuthSessionSnapshot {
  return {
    authenticated: false,
    locked: false,
    userId: null,
    profileId: null,
  };
}

export function buildSessionSnapshot(payload: ClientAuthSessionResponse | null | undefined): AuthSessionSnapshot {
  if (!payload?.authenticated || !payload.user?.id) {
    return getUnauthenticatedSessionSnapshot();
  }

  const profileId =
    typeof payload.profile === 'object' &&
    payload.profile !== null &&
    'id' in payload.profile &&
    typeof (payload.profile as { id?: unknown }).id === 'string'
      ? (payload.profile as { id: string }).id
      : payload.user.id;

  return {
    authenticated: true,
    locked: payload.locked === true,
    userId: payload.user.id,
    profileId,
  };
}

export function getSessionTransition(
  previous: AuthSessionSnapshot | null,
  next: AuthSessionSnapshot
): AuthSessionTransition {
  const before = previous ?? getUnauthenticatedSessionSnapshot();
  const authChanged = before.authenticated !== next.authenticated;
  const lockChanged = before.locked !== next.locked;
  const userChanged = before.userId !== next.userId;
  const profileChanged = before.profileId !== next.profileId;
  const changed = authChanged || lockChanged || userChanged || profileChanged;

  return {
    changed,
    authChanged,
    lockChanged,
    userChanged,
    profileChanged,
    becameAuthenticated: !before.authenticated && next.authenticated,
    becameUnauthenticated: before.authenticated && !next.authenticated,
    becameLocked: !before.locked && next.locked,
    becameUnlocked: before.locked && !next.locked,
    shouldInvalidateToken:
      userChanged || profileChanged || authChanged || lockChanged || next.locked || !next.authenticated,
  };
}
