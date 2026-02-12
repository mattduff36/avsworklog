import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { Database } from '@/types/database'
import { VIEW_AS_COOKIE_NAME } from '@/lib/utils/view-as-cookie'

export async function createClient() {
  const cookieStore = await cookies()
  const viewAsRoleId = cookieStore.get(VIEW_AS_COOKIE_NAME)?.value || ''

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch (error) {
            // The `set` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
      global: {
        // Inject x-view-as-role-id header so PostgREST forwards it to the DB
        fetch: (input, init) => {
          if (viewAsRoleId) {
            const headers = new Headers(init?.headers)
            headers.set('x-view-as-role-id', viewAsRoleId)
            return fetch(input, { ...init, headers })
          }
          return fetch(input, init)
        },
      },
    }
  )
}

