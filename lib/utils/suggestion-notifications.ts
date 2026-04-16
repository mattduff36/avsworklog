const SUGGESTION_NOTIFICATION_PREFIX = 'suggestion:';

export function buildSuggestionNotificationCreatedVia(suggestionId: string): string {
  return `${SUGGESTION_NOTIFICATION_PREFIX}${suggestionId}`;
}

export function parseSuggestionIdFromCreatedVia(createdVia?: string | null): string | null {
  if (!createdVia?.startsWith(SUGGESTION_NOTIFICATION_PREFIX)) {
    return null;
  }

  const suggestionId = createdVia.slice(SUGGESTION_NOTIFICATION_PREFIX.length).trim();
  return suggestionId || null;
}

export function extractSuggestionTitleFromNotificationBody(body?: string | null): string | null {
  if (!body) {
    return null;
  }

  const match = body.match(/^Suggestion:\s+"(.+)"$/m);
  const title = match?.[1]?.trim();
  return title || null;
}
