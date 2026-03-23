import {
  generateQuoteReferenceForManager,
  getInitialsFromName,
} from '@/lib/server/quote-workflow';

/**
 * Backwards-compatible wrapper for legacy callers.
 */
export async function generateQuoteReference(initials: string): Promise<string> {
  const result = await generateQuoteReferenceForManager({
    managerProfileId: '00000000-0000-0000-0000-000000000000',
    fallbackInitials: initials,
  });

  return result.quoteReference;
}

export { getInitialsFromName };
