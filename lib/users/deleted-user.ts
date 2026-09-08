export const DELETED_USER_NAME_MARKER = '(Deleted User)';
export const DELETED_USER_NAME_SUFFIX = ` ${DELETED_USER_NAME_MARKER}`;

export function isDeletedUserName(fullName: string | null | undefined): boolean {
  return Boolean(fullName && fullName.includes(DELETED_USER_NAME_MARKER));
}

export function hasGeneratedDeletedUserNameSuffix(fullName: string | null | undefined): boolean {
  if (!fullName) return false;
  return fullName === DELETED_USER_NAME_MARKER || fullName.endsWith(DELETED_USER_NAME_SUFFIX);
}

export function toDeletedUserName(fullName: string): string {
  return isDeletedUserName(fullName) ? fullName : `${fullName}${DELETED_USER_NAME_SUFFIX}`;
}

export function isDeletedProfile(profile: {
  full_name?: string | null;
  deleted_at?: string | null;
} | null | undefined): boolean {
  if (!profile) return false;
  return Boolean(profile.deleted_at) || isDeletedUserName(profile.full_name);
}
