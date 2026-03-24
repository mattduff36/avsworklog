interface PaginationPayload {
  error?: string;
  pagination?: {
    offset?: number;
    limit?: number;
    has_more?: boolean;
  };
  [key: string]: unknown;
}

interface FetchAllPaginatedOptions {
  cache?: RequestCache;
  limit: number;
  offset?: number;
  errorMessage?: string;
}

export async function fetchAllPaginatedItems<TItem>(
  endpoint: string,
  itemsKey: string,
  options: FetchAllPaginatedOptions
): Promise<{ items: TItem[]; firstPagePayload: PaginationPayload | null }> {
  const items: TItem[] = [];
  let offset = options.offset || 0;
  let firstPagePayload: PaginationPayload | null = null;

  while (true) {
    const separator = endpoint.includes('?') ? '&' : '?';
    const response = await fetch(
      `${endpoint}${separator}limit=${options.limit}&offset=${offset}`,
      { cache: options.cache || 'no-store' }
    );
    const payload = (await response.json()) as PaginationPayload;

    if (!response.ok) {
      throw new Error(payload.error || options.errorMessage || 'Failed to load paginated data');
    }

    if (!firstPagePayload) {
      firstPagePayload = payload;
    }

    items.push(...(((payload[itemsKey] as TItem[] | undefined) || [])));

    if (!payload.pagination?.has_more) {
      break;
    }

    offset += options.limit;
  }

  return { items, firstPagePayload };
}
