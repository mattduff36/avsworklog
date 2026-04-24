export interface DebugConsoleAccessParams {
  email: string | null | undefined;
  isActualSuperAdmin?: boolean | null | undefined;
  isViewingAs?: boolean | null | undefined;
}

const CHARLOTTE_DEBUG_ACCESS_EMAIL = 'charlotte@avsquires.co.uk';

export function isCharlotteDebugAccessUser(email: string | null | undefined): boolean {
  return (email || '').trim().toLowerCase() === CHARLOTTE_DEBUG_ACCESS_EMAIL;
}

export function canAccessDebugConsole(params: DebugConsoleAccessParams): boolean {
  if (params.isViewingAs) {
    return false;
  }

  return Boolean(params.isActualSuperAdmin) || isCharlotteDebugAccessUser(params.email);
}
