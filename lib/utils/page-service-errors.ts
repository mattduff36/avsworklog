export interface PageServiceErrorEntry {
  status: number | null;
  message: string;
}

export type PageServiceErrorMap<TKey extends string> = Partial<
  Record<TKey, PageServiceErrorEntry>
>;

export function setPageServiceError<TKey extends string>(
  current: PageServiceErrorMap<TKey>,
  key: TKey,
  error: PageServiceErrorEntry
): PageServiceErrorMap<TKey> {
  return {
    ...current,
    [key]: error,
  };
}

export function clearPageServiceError<TKey extends string>(
  current: PageServiceErrorMap<TKey>,
  key: TKey
): PageServiceErrorMap<TKey> {
  if (!(key in current)) {
    return current;
  }

  const next = { ...current };
  delete next[key];
  return next;
}

export function getFirstPageServiceError<TKey extends string>(
  current: PageServiceErrorMap<TKey>,
  priority: readonly TKey[]
): PageServiceErrorEntry | null {
  for (const key of priority) {
    const error = current[key];
    if (error) {
      return error;
    }
  }

  return null;
}
