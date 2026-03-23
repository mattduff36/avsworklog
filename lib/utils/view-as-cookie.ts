/**
 * View As cookie utilities.
 * Cookie names:
 *  - avs_view_as_role_id
 *  - avs_view_as_team_id
 *
 * The cookie is read by:
 *  - Browser Supabase client (injected as x-view-as-role-id / x-view-as-team-id headers)
 *  - Server Supabase client (same)
 *  - API route helpers (for service-role endpoints)
 */

const ROLE_COOKIE_NAME = 'avs_view_as_role_id';
const TEAM_COOKIE_NAME = 'avs_view_as_team_id';

export interface ViewAsSelection {
  roleId: string;
  teamId: string;
}

function setCookie(name: string, value: string, storageKey: string) {
  if (!value) {
    document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
    localStorage.removeItem(storageKey);
    return;
  }

  document.cookie = `${name}=${value}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
  localStorage.setItem(storageKey, value);
}

/** Set the view-as role id cookie (client-side). Pass empty string to clear. */
export function setViewAsRoleId(roleId: string) {
  if (typeof document === 'undefined') return;
  setCookie(ROLE_COOKIE_NAME, roleId, 'viewAsRoleId');
  // Also clean up legacy key
  localStorage.removeItem('viewAsRole');
}

/** Read the view-as role id from cookie (client-side). Returns empty string if unset. */
export function getViewAsRoleId(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${ROLE_COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

export function setViewAsTeamId(teamId: string) {
  if (typeof document === 'undefined') return;
  setCookie(TEAM_COOKIE_NAME, teamId, 'viewAsTeamId');
}

export function getViewAsTeamId(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${TEAM_COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

export function getViewAsSelection(): ViewAsSelection {
  return {
    roleId: getViewAsRoleId(),
    teamId: getViewAsTeamId(),
  };
}

export function setViewAsSelection(selection: ViewAsSelection) {
  if (typeof document === 'undefined') return;
  setViewAsRoleId(selection.roleId);
  setViewAsTeamId(selection.teamId);
}

export function clearViewAsSelection() {
  if (typeof document === 'undefined') return;
  setViewAsRoleId('');
  setViewAsTeamId('');
}

/** The cookie names – exported for server-side readers. */
export const VIEW_AS_COOKIE_NAME = ROLE_COOKIE_NAME;
export const VIEW_AS_ROLE_COOKIE_NAME = ROLE_COOKIE_NAME;
export const VIEW_AS_TEAM_COOKIE_NAME = TEAM_COOKIE_NAME;
