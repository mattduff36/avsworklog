import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { VIEW_AS_ROLE_COOKIE_NAME, VIEW_AS_TEAM_COOKIE_NAME } from '@/lib/utils/view-as-cookie'

export async function createClient() {
  const cookieStore = await cookies()
  const viewAsRoleId = cookieStore.get(VIEW_AS_ROLE_COOKIE_NAME)?.value || ''
  const viewAsTeamId = cookieStore.get(VIEW_AS_TEAM_COOKIE_NAME)?.value || ''

  return createServerClient(
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
          } catch {
            // The `set` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
      global: {
        // Inject view-as headers so PostgREST forwards them to the DB
        fetch: (input, init) => {
          if (viewAsRoleId || viewAsTeamId) {
            const headers = new Headers(init?.headers)
            if (viewAsRoleId) {
              headers.set('x-view-as-role-id', viewAsRoleId)
            }
            if (viewAsTeamId) {
              headers.set('x-view-as-team-id', viewAsTeamId)
            }
            return fetch(input, { ...init, headers })
          }
          return fetch(input, init)
        },
      },
    }
  )
}

