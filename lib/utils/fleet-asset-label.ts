export interface FormatFleetAssetLabelInput {
  /** Caller-resolved identifier (reg_number or plant_id) with any surface-specific fallback already applied. */
  identifier: string;
  nickname?: string | null;
  /** Only pass for van filters/selects. */
  category?: string | null;
}

function trimOrEmpty(value: string | null | undefined): string {
  return value?.trim() || '';
}

/**
 * Presentation-only fleet asset label.
 * - With category (van filters/selects): `AB12 CDE (Nickname Category)`
 * - Without category: `AB12 CDE (Nickname)`
 * Never use the result for IDs, routes, filtering, auth, or filenames.
 */
export function formatFleetAssetLabel({
  identifier,
  nickname,
  category,
}: FormatFleetAssetLabelInput): string {
  const id = trimOrEmpty(identifier);
  const nick = trimOrEmpty(nickname);
  const cat = trimOrEmpty(category);

  if (cat) {
    const inside = [nick, cat].filter(Boolean).join(' ');
    return inside ? `${id} (${inside})` : id;
  }

  return nick ? `${id} (${nick})` : id;
}
