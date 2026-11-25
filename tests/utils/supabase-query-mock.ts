import { vi, type Mock } from 'vitest';

export type SupabaseQueryMock<T> = Promise<T> & Record<string, Mock>;

export function createSupabaseQueryMock<T>(
  result: T | (() => T | Promise<T>),
  chainMethods: readonly string[]
): SupabaseQueryMock<T> {
  const query = new Promise<T>((resolve, reject) => {
    queueMicrotask(() => {
      try {
        const resolved = typeof result === 'function' ? (result as () => T | Promise<T>)() : result;
        Promise.resolve(resolved).then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }) as unknown as SupabaseQueryMock<T>;

  chainMethods.forEach((method) => {
    query[method] = vi.fn(() => query);
  });

  return query;
}

export function createInventoryKioskConfigTableMock(kioskUserId: string | null = null) {
  return {
    select() {
      return {
        eq() {
          return {
            async maybeSingle() {
              return {
                data: kioskUserId ? { kiosk_user_id: kioskUserId } : null,
                error: null,
              };
            },
          };
        },
      };
    },
  };
}

/** Provide the profile-visibility predicates for fixtures that model active data only. */
export function withDeletedProfileFilters<T>(query: T): T {
  if (!query || typeof query !== 'object') return query;
  const filters = query as Record<string, unknown>;
  const is = filters.is;
  const not = filters.not;
  const or = filters.or;
  filters.is = vi.fn((...args: unknown[]) => {
    if (typeof args[0] === 'string' && /(^|\.)deleted_at$/.test(args[0]) && args[1] === null) {
      return query;
    }
    if (typeof is === 'function') return Reflect.apply(is, query, args);
  });
  filters.not = vi.fn((...args: unknown[]) => {
    if (typeof args[0] === 'string' && /(^|\.)full_name$/.test(args[0]) && args[2] === '%(Deleted User)%') {
      return query;
    }
    if (typeof not === 'function') return Reflect.apply(not, query, args);
  });
  filters.or = vi.fn((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('deleted_at.not.is.null,full_name.ilike.')) {
      return Promise.resolve({ data: [], error: null });
    }
    if (typeof or === 'function') return Reflect.apply(or, query, args);
  });
  return query;
}

export function withDeletedProfileSelect<T extends (...args: never[]) => unknown>(select: T): T {
  return new Proxy(select, {
    apply: (target, receiver, args) => withDeletedProfileFilters(Reflect.apply(target, receiver, args)),
  });
}
