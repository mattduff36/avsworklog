import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getViewAsRoleId, getViewAsTeamId } from '@/lib/utils/view-as-cookie'
import type { Database } from '@/types/database'

type BrowserSupabaseClient = SupabaseClient<Database>

let client: BrowserSupabaseClient | null = null

export function invalidateCachedDataToken(): void {
  // Native Supabase SSR sessions manage token refresh internally.
}

export function getLastDataTokenFailureStatus(): number | null {
  return null
}

export function createClient(): BrowserSupabaseClient {
  if (client) {
    return client
  }

  // During build/prerendering, environment variables may not be available
  // This is only used in client components, so we can safely skip during build
  if (typeof window === 'undefined') {
    throw new Error('createClient() can only be used in the browser')
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are not set')
  }

  client = createBrowserClient<Database>(
    supabaseUrl,
    supabaseAnonKey,
    {
      global: {
        fetch: (input, init) => {
          const viewAsRoleId = getViewAsRoleId()
          const viewAsTeamId = getViewAsTeamId()
          if (viewAsRoleId || viewAsTeamId) {
            const headers = new Headers(init?.headers)
            if (viewAsRoleId) {
              headers.set('x-view-as-role-id', viewAsRoleId)
            }
            if (viewAsTeamId) {
              headers.set('x-view-as-team-id', viewAsTeamId)
            }
            return globalThis.fetch(input, { ...init, headers })
          }

          return globalThis.fetch(input, init)
        },
      },
    }
  ) as BrowserSupabaseClient

  return client as BrowserSupabaseClient
}

