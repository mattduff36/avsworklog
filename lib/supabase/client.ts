import {
  createClient as createSupabaseClient,
  type Session,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js'
import { getViewAsRoleId, getViewAsTeamId } from '@/lib/utils/view-as-cookie'
import { withAuthOverrides } from '@/lib/supabase/with-auth-overrides'
import type { Database } from '@/types/database'

interface AuthSessionResponse {
  authenticated: boolean;
  locked: boolean;
  user: {
    id: string;
    email: string | null;
  } | null;
  profile?: unknown;
  data_token_available?: boolean;
}

type BrowserSupabaseClient = SupabaseClient<Database>

let client: BrowserSupabaseClient | null = null
let cachedDataToken: { token: string; expiresAt: number } | null = null
let pendingDataTokenPromise: Promise<string> | null = null

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.headers || {}),
      'Cache-Control': 'no-cache',
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.json() as Promise<T>
}

function buildSyntheticUser(sessionResponse: AuthSessionResponse): User | null {
  if (!sessionResponse.user?.id) {
    return null
  }

  const nowIso = new Date().toISOString()
  return {
    id: sessionResponse.user.id,
    app_metadata: {
      provider: 'app_session',
      providers: ['app_session'],
    },
    user_metadata: {},
    aud: 'authenticated',
    created_at: nowIso,
    email: sessionResponse.user.email || undefined,
  } as User
}

async function getCurrentAuthSessionResponse(): Promise<AuthSessionResponse> {
  try {
    return await fetchJson<AuthSessionResponse>('/api/auth/session')
  } catch {
    return {
      authenticated: false,
      locked: false,
      user: null,
      data_token_available: false,
    }
  }
}

async function getDataToken(): Promise<string> {
  if (cachedDataToken && cachedDataToken.expiresAt * 1000 > Date.now() + 30_000) {
    return cachedDataToken.token
  }

  if (pendingDataTokenPromise) {
    return pendingDataTokenPromise
  }

  pendingDataTokenPromise = (async () => {
    try {
      const response = await fetchJson<{ token: string; expires_at: number }>('/api/auth/data-token')
      cachedDataToken = {
        token: response.token,
        expiresAt: response.expires_at,
      }
      return response.token
    } catch {
      cachedDataToken = null
      return ''
    } finally {
      pendingDataTokenPromise = null
    }
  })()

  return pendingDataTokenPromise
}

function invalidateCachedDataToken(): void {
  cachedDataToken = null
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

  try {
    const baseClient = createSupabaseClient<Database>(
      supabaseUrl,
      supabaseAnonKey,
      {
        accessToken: async () => {
          const token = await getDataToken()
          if (token) {
            baseClient.realtime.setAuth(token)
          }
          return token
        },
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
        global: {
          // Inject view-as headers on every request (read cookies dynamically)
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
    )

    client = withAuthOverrides(baseClient, {
      getUser: (async () => {
        const sessionResponse = await getCurrentAuthSessionResponse()
        return {
          data: {
            user: buildSyntheticUser(sessionResponse) as User,
          },
          error: null,
        }
      }) as typeof baseClient.auth.getUser,
      getSession: (async () => {
        const sessionResponse = await getCurrentAuthSessionResponse()
        const user = buildSyntheticUser(sessionResponse)
        if (!user || sessionResponse.locked) {
          return {
            data: {
              session: null,
            },
            error: null,
          }
        }

        const token = await getDataToken()
        const expiresAt = cachedDataToken?.expiresAt ?? Math.floor(Date.now() / 1000)
        return {
          data: {
            session: {
              access_token: token,
              refresh_token: '',
              token_type: 'bearer',
              expires_in: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
              expires_at: expiresAt,
              user,
            } as Session,
          },
          error: null,
        }
      }) as typeof baseClient.auth.getSession,
      signOut: (async () => {
        invalidateCachedDataToken()
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }).catch(() => undefined)
        return {
          error: null,
        }
      }) as typeof baseClient.auth.signOut,
    }) as BrowserSupabaseClient
  } catch (error) {
    throw error
  }

  return client as BrowserSupabaseClient
}

