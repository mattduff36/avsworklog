export interface FormatFleetAssetLabelInput {
  /** Caller-resolved identifier (reg_number or plant_id) with any surface-specific fallback already applied. */
  identifier: string;
  nickname?: string | null;
  /** Only pass for van filters/selects. */
  category?: string | null;
  /**
   * Standalone labels include the friendly nickname. When the assignee is
   * already visible beside the asset, the identifier alone avoids repeating
   * the same person's name.
   */
  context?: 'standalone' | 'with-assignee';
}

function trimOrEmpty(value: string | null | undefined): string {
  return value?.trim() || '';
}

export function getFleetAssetLabelContext(
  assigneeName: string | null | undefined,
  assigneeVisible = true
): 'standalone' | 'with-assignee' {
  if (!assigneeVisible) {
    return 'standalone';
  }

  const normalizedName = trimOrEmpty(assigneeName).toLowerCase();
  const hasKnownAssignee = normalizedName !== ''
    && normalizedName !== 'unknown'
    && normalizedName !== 'unknown user';

  return hasKnownAssignee ? 'with-assignee' : 'standalone';
}

/**
 * Presentation-only fleet asset label.
 * - With nickname: `AB12 CDE (Nickname)`
 * - With category but no nickname: `AB12 CDE (Category)`
 * - With a visible assignee: `AB12 CDE`
 * Never use the result for IDs, routes, filtering, auth, or filenames.
 */
export function formatFleetAssetLabel({
  identifier,
  nickname,
  category,
  context = 'standalone',
}: FormatFleetAssetLabelInput): string {
  const id = trimOrEmpty(identifier);

  if (context === 'with-assignee') {
    return id;
  }

  const nick = trimOrEmpty(nickname);
  const cat = trimOrEmpty(category);

  if (nick) {
    return `${id} (${nick})`;
  }

  return cat ? `${id} (${cat})` : id;
}
