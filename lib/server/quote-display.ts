import { isDeletedProfile } from '@/lib/users/deleted-user';

export const QUOTE_REQUESTER_VISIBILITY_SELECT = 'requester_profile:profiles!quotes_requester_id_fkey(full_name, deleted_at)';

export function withoutDeletedQuoteManager<T extends {
  requester_id: string | null;
  manager_name: string | null;
  manager_email: string | null;
  signoff_name: string | null;
}>(row: T) {
  const { requester_profile: profile, ...quote } = row as T & {
    requester_profile?: { full_name: string | null; deleted_at: string | null } | null;
  };
  if (!quote.requester_id || (profile !== null && !isDeletedProfile(profile))) return quote;
  return {
    ...quote,
    manager_name: null,
    manager_email: null,
    signoff_name: quote.signoff_name === quote.manager_name ? null : quote.signoff_name,
  };
}
