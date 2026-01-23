import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  // Check if environment variables are available
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase environment variables are not set in middleware')
    // Allow the request to continue without auth check
    return supabaseResponse
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch (error) {
    console.error('Error getting user in middleware:', error)
    // Continue without user
  }

  // PUBLIC routes - ONLY these routes are accessible without authentication
  // All other routes require authentication (safer default)
  const publicPaths = [
    '/login',
    '/change-password',  // Users must access this after temp password login
    '/offline',          // Service worker offline page
  ]
  
  const isPublicPath = publicPaths.some(path => request.nextUrl.pathname.startsWith(path))
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/')

  // If not a public path and no user
  if (!isPublicPath && !user) {
    // For API routes, return JSON 401 instead of HTML redirect
    if (isApiRoute) {
      const apiResponse = NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
      // CRITICAL: Copy cookies from supabaseResponse to avoid session termination
      supabaseResponse.cookies.getAll().forEach(cookie => {
        apiResponse.cookies.set(cookie.name, cookie.value, cookie)
      })
      return apiResponse
    }
    
    // For page routes, redirect to login
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirect', request.nextUrl.pathname)
    const redirectResponse = NextResponse.redirect(url)
    // CRITICAL: Copy cookies from supabaseResponse to avoid session termination
    supabaseResponse.cookies.getAll().forEach(cookie => {
      redirectResponse.cookies.set(cookie.name, cookie.value, cookie)
    })
    return redirectResponse
  }

  // If user is logged in and trying to access login page, redirect to dashboard
  if (request.nextUrl.pathname === '/login' && user) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    const dashboardRedirect = NextResponse.redirect(url)
    // CRITICAL: Copy cookies from supabaseResponse to avoid session termination
    supabaseResponse.cookies.getAll().forEach(cookie => {
      dashboardRedirect.cookies.set(cookie.name, cookie.value, cookie)
    })
    return dashboardRedirect
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is. If you're
  // creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    supabaseResponse.cookies.getAll().forEach(cookie => {
  //      myNewResponse.cookies.set(cookie.name, cookie.value, cookie)
  //    })
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse
}

