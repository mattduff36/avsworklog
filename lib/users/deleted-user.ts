export const DELETED_USER_NAME_MARKER = '(Deleted User)';

export function isDeletedUserName(fullName: string | null | undefined): boolean {
  return Boolean(fullName && fullName.includes(DELETED_USER_NAME_MARKER));
}

export function toDeletedUserName(fullName: string): string {
  return isDeletedUserName(fullName) ? fullName : `${fullName} ${DELETED_USER_NAME_MARKER}`;
}
