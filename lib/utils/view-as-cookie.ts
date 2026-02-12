/**
 * View As cookie utilities.
 * Cookie name: avs_view_as_role_id
 * Value: UUID of the selected role, or empty string / absent for "actual role".
 *
 * The cookie is read by:
 *  - Browser Supabase client (injected as x-view-as-role-id header)
 *  - Server Supabase client (same)
 *  - API route helpers (for service-role endpoints)
 */

const COOKIE_NAME = 'avs_view_as_role_id';

/** Set the view-as role id cookie (client-side). Pass empty string to clear. */
export function setViewAsRoleId(roleId: string) {
  if (typeof document === 'undefined') return;
  if (!roleId) {
    // Clear cookie
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
    localStorage.removeItem('viewAsRoleId');
  } else {
    // 30 day expiry – plenty for a debug tool
    document.cookie = `${COOKIE_NAME}=${roleId}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
    localStorage.setItem('viewAsRoleId', roleId);
  }
  // Also clean up legacy key
  localStorage.removeItem('viewAsRole');
}

/** Read the view-as role id from cookie (client-side). Returns empty string if unset. */
export function getViewAsRoleId(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

/** The cookie name – exported for server-side readers. */
export const VIEW_AS_COOKIE_NAME = COOKIE_NAME;
