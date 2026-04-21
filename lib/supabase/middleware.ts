import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import {
  APP_SESSION_COOKIE_LOGICAL_NAME,
  APP_SESSION_COOKIE_NAME,
  getAppSessionSigningSecret,
} from '@/lib/server/app-auth/constants'
import { verifyJwtHS256 } from '@/lib/server/app-auth/jwt'
import type { Database } from '@/types/database'

interface MiddlewareSessionPayload extends Record<string, unknown> {
  sid: string
  secret: string
  locked: boolean
  exp: number
  v: number
}

const CRON_ROUTE_PATHS = new Set([
  '/api/maintenance/sync-dvla-scheduled',
  '/api/quotes/start-alerts-scheduled',
  '/api/absence/bank-holidays/seed-scheduled',
])

function getAppSessionCookieValue(request: NextRequest): string | null {
  return (
    request.cookies.get(APP_SESSION_COOKIE_NAME)?.value ||
    request.cookies.get(APP_SESSION_COOKIE_LOGICAL_NAME)?.value ||
    null
  )
}

async function getMiddlewareSession(request: NextRequest): Promise<MiddlewareSessionPayload | null> {
  const cookieValue = getAppSessionCookieValue(request)
  if (!cookieValue) {
    return null
  }

  try {
    return await verifyJwtHS256<MiddlewareSessionPayload>(cookieValue, getAppSessionSigningSecret())
  } catch {
    return null
  }
}

function hasLegacySupabaseSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(({ name }) => /^sb-.*-auth-token(?:\.[0-9]+)?$/.test(name))
}

function isAuthorizedCronRequest(request: NextRequest): boolean {
  if (!CRON_ROUTE_PATHS.has(request.nextUrl.pathname)) {
    return false
  }

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return false
  }

  return request.headers.get('authorization') === `Bearer ${cronSecret}`
}

function withMiddlewareCookies(target: NextResponse, source: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie)
  })

  return target
}

function redirectWithMiddlewareCookies(
  source: NextResponse,
  url: URL,
  status?: number
): NextResponse {
  return withMiddlewareCookies(NextResponse.redirect(url, status), source)
}

function jsonWithMiddlewareCookies(
  source: NextResponse,
  body: { error: string; code?: string },
  init: { status: number }
): NextResponse {
  return withMiddlewareCookies(NextResponse.json(body, init), source)
}

async function getSupabaseUser(
  request: NextRequest,
  response: NextResponse
): Promise<{ id: string } | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return null
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll().map(({ name, value }) => ({ name, value }))
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value)
        })

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user ? { id: user.id } : null
}

export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request })
  const session = await getMiddlewareSession(request)
  const supabaseUser = await getSupabaseUser(request, response)
  const hasLegacyCookie = hasLegacySupabaseSessionCookie(request)
  const isAuthenticated = Boolean(session || supabaseUser)
  const isLocked = session?.locked === true

  if (request.nextUrl.pathname.startsWith('/rams')) {
    const url = request.nextUrl.clone()
    url.pathname = request.nextUrl.pathname.replace(/^\/rams/, '/projects')
    return redirectWithMiddlewareCookies(response, url, 301)
  }

  if (request.nextUrl.pathname === '/') {
    const url = request.nextUrl.clone()
    if (isAuthenticated) {
      url.pathname = isLocked ? '/lock' : '/dashboard'
      return redirectWithMiddlewareCookies(response, url, 307)
    }
    if (hasLegacyCookie) {
      url.pathname = '/api/auth/bootstrap'
      url.search = ''
      url.searchParams.set('returnTo', '/dashboard')
      return redirectWithMiddlewareCookies(response, url, 307)
    }
    url.pathname = '/login'
    return redirectWithMiddlewareCookies(response, url, 307)
  }

  const publicPaths = ['/login', '/change-password', '/offline']
  const isPublicPath = publicPaths.some((path) => request.nextUrl.pathname.startsWith(path))
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/')
  const isLockRoute = request.nextUrl.pathname.startsWith('/lock')
  const isAuthRoute = request.nextUrl.pathname.startsWith('/api/auth/')
  const isAccountSwitchRoute = request.nextUrl.pathname.startsWith('/api/account-switch/')
  const isVersionRoute = request.nextUrl.pathname === '/api/version'
  const allowLockedApi =
    isAuthRoute || isAccountSwitchRoute || isVersionRoute

  if (!session && !supabaseUser && hasLegacyCookie && !isPublicPath && !isLockRoute && !isAuthRoute) {
    if (!isApiRoute) {
      const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`
      const url = request.nextUrl.clone()
      url.pathname = '/api/auth/bootstrap'
      url.search = ''
      url.searchParams.set('returnTo', returnTo)
      return redirectWithMiddlewareCookies(response, url, 307)
    }
  }

  if (isAuthenticated && isLocked && !isLockRoute && !isApiRoute && request.nextUrl.pathname !== '/login') {
    const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`
    const url = request.nextUrl.clone()
    url.pathname = '/lock'
    url.search = ''
    url.searchParams.set('returnTo', returnTo)

    return redirectWithMiddlewareCookies(response, url, 307)
  }

  if (isAuthenticated && isLocked && isApiRoute && !allowLockedApi) {
    return jsonWithMiddlewareCookies(
      response,
      { error: 'Session is locked', code: 'SESSION_LOCKED' },
      { status: 423 }
    )
  }

  if (isAuthorizedCronRequest(request)) {
    return response
  }

  if (!isPublicPath && !isAuthenticated && !isAuthRoute) {
    if (isApiRoute) {
      return jsonWithMiddlewareCookies(
        response,
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirect', request.nextUrl.pathname)
    return redirectWithMiddlewareCookies(response, url)
  }

  if (request.nextUrl.pathname === '/login' && isAuthenticated && !isLocked) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return redirectWithMiddlewareCookies(response, url)
  }

  return response
}

