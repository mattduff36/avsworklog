import { createBrowserClient } from '@supabase/ssr'
import { getViewAsRoleId } from '@/lib/utils/view-as-cookie'

let client: ReturnType<typeof createBrowserClient> | null = null

export function createClient(): ReturnType<typeof createBrowserClient> | null {
  if (client) {
    return client
  }

  // During build/prerendering, environment variables may not be available
  // This is only used in client components, so we can safely skip during build
  if (typeof window === 'undefined') {
    return null
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase environment variables are not set')
    return null
  }

  client = createBrowserClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      global: {
        // Inject x-view-as-role-id header on every request (read cookie dynamically)
        fetch: (input, init) => {
          const viewAsRoleId = getViewAsRoleId()
          if (viewAsRoleId) {
            const headers = new Headers(init?.headers)
            headers.set('x-view-as-role-id', viewAsRoleId)
            return globalThis.fetch(input, { ...init, headers })
          }
          return globalThis.fetch(input, init)
        },
      },
    }
  )

  return client
}

