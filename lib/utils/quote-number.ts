import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Atomically generates the next quote reference for a given requester.
 * Format: NNNN-XX where NNNN starts at 6000 per requester and XX is their initials.
 *
 * Uses the admin client to bypass RLS for the sequence table update.
 */
export async function generateQuoteReference(initials: string): Promise<string> {
  const supabase = createAdminClient();
  const key = initials.toUpperCase().slice(0, 10);

  // Upsert the sequence row: insert starting at 6000 or fetch existing
  const { data: existing } = await supabase
    .from('quote_sequences')
    .select('id, next_number')
    .eq('requester_initials', key)
    .single();

  let nextNum: number;

  if (existing) {
    nextNum = existing.next_number;
    // Increment for next call
    await supabase
      .from('quote_sequences')
      .update({ next_number: nextNum + 1 })
      .eq('id', existing.id);
  } else {
    nextNum = 6000;
    await supabase
      .from('quote_sequences')
      .insert({ requester_initials: key, next_number: 6001 });
  }

  return `${nextNum}-${key}`;
}

/**
 * Derives initials from a full name, e.g. "George Healey" -> "GH".
 */
export function getInitialsFromName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return 'XX';
  const first = parts[0]?.[0] || '';
  const last = parts[parts.length - 1]?.[0] || '';
  return (first + last).toUpperCase();
}
