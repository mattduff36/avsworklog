import { useMemo, useSyncExternalStore } from 'react';
import { createClient } from '@/lib/supabase/client';

type BrowserSupabaseClient = ReturnType<typeof createClient>;

export function useBrowserSupabaseClient(): BrowserSupabaseClient {
  const hasMounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false
  );

  return useMemo(
    () => (hasMounted ? createClient() : (null as unknown as BrowserSupabaseClient)),
    [hasMounted]
  );
}
