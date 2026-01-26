# Middleware Cookie Preservation - Critical Fix

**Date:** 2026-01-22  
**Status:** ✅ FIXED  
**Severity:** 🔴 CRITICAL  
**Component:** Supabase Authentication Middleware

## Executive Summary

Fixed a critical authentication bug where the middleware was creating new response objects (JSON 401s and redirects) **without preserving session cookies** from the Supabase client. This violated Supabase SSR best practices and caused premature session termination.

## Impact Before Fix

- ❌ Users randomly logged out during navigation
- ❌ Session cookies not synchronized between browser and server
- ❌ Auth state desynchronization after redirects
- ❌ Particularly problematic on first login or session refresh

## The Rule (From Supabase Documentation)

Lines 91-102 of `lib/supabase/middleware.ts` contain this critical warning:

> **IMPORTANT:** You *must* return the supabaseResponse object as it is. If you're creating a new response object with NextResponse.next() make sure to:
> 1. Pass the request in it
> 2. **Copy over the cookies** ← THIS WAS MISSING
> 3. Change the response to fit your needs, but avoid changing the cookies!
> 4. Finally return the response
>
> **If this is not done, you may be causing the browser and server to go out of sync and terminate the user's session prematurely!**

## All Three Response Paths Fixed

### ✅ Path 1: API 401 Response (Already Fixed)

**Lines:** 67-74

```typescript
if (isApiRoute) {
  const apiResponse = NextResponse.json(
    { error: 'Unauthorized' },
    { status: 401 }
  )
  // CRITICAL: Copy cookies from supabaseResponse to avoid session termination
  apiResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  return apiResponse
}
```

### ✅ Path 2: Login Redirect (NOW FIXED)

**Lines:** 77-84

**Before:**
```typescript
// ❌ Missing cookie preservation
const url = request.nextUrl.clone()
url.pathname = '/login'
url.searchParams.set('redirect', request.nextUrl.pathname)
return NextResponse.redirect(url)
```

**After:**
```typescript
// ✅ Cookies properly preserved
const url = request.nextUrl.clone()
url.pathname = '/login'
url.searchParams.set('redirect', request.nextUrl.pathname)
const redirectResponse = NextResponse.redirect(url)
// CRITICAL: Copy cookies from supabaseResponse to avoid session termination
redirectResponse.cookies.setAll(supabaseResponse.cookies.getAll())
return redirectResponse
```

### ✅ Path 3: Dashboard Redirect (NOW FIXED)

**Lines:** 87-94

**Before:**
```typescript
// ❌ Missing cookie preservation
if (request.nextUrl.pathname === '/login' && user) {
  const url = request.nextUrl.clone()
  url.pathname = '/dashboard'
  return NextResponse.redirect(url)
}
```

**After:**
```typescript
// ✅ Cookies properly preserved
if (request.nextUrl.pathname === '/login' && user) {
  const url = request.nextUrl.clone()
  url.pathname = '/dashboard'
  const dashboardRedirect = NextResponse.redirect(url)
  // CRITICAL: Copy cookies from supabaseResponse to avoid session termination
  dashboardRedirect.cookies.setAll(supabaseResponse.cookies.getAll())
  return dashboardRedirect
}
```

## Why This Matters

### Session Cookie Lifecycle

1. **User makes request** → Middleware runs
2. **Supabase client created** → May update auth cookies (refresh token, etc.)
3. **Auth check performed** → `supabase.auth.getUser()`
4. **Cookies updated in supabaseResponse** via the `setAll()` callback
5. **New response created** → MUST copy cookies from supabaseResponse
6. **Response returned** → Browser receives updated cookies

**If step 5 is skipped:** Browser keeps stale cookies → session expires → user logged out

### Real-World Scenarios

**Scenario 1: First Login**
1. User logs in successfully
2. Redirected from `/login` to `/dashboard`
3. ❌ **Without fix:** Session cookie not sent to browser → appears logged out
4. ✅ **With fix:** Session cookie preserved → user stays logged in

**Scenario 2: Token Refresh**
1. User navigates to protected page
2. Supabase refreshes expired access token
3. Redirects unauthenticated user to login (race condition)
4. ❌ **Without fix:** New token lost → must log in again
5. ✅ **With fix:** New token preserved → seamless experience

**Scenario 3: Session Extension**
1. User actively using app
2. Each request extends session via cookie update
3. ❌ **Without fix:** Session not extended → premature timeout
4. ✅ **With fix:** Session properly extended → stays logged in

## Pattern to Follow

**Every time you create a new response object in middleware:**

```typescript
// ✅ CORRECT PATTERN
const myResponse = NextResponse._____(/* your args */)
myResponse.cookies.setAll(supabaseResponse.cookies.getAll())
return myResponse

// ❌ WRONG - Will break sessions
return NextResponse._____(/* your args */)
```

## Complete Coverage

All response types in this middleware now preserve cookies:

| Response Type | Lines | Status |
|--------------|-------|--------|
| API 401 JSON | 67-74 | ✅ Fixed |
| Login Redirect | 77-84 | ✅ Fixed |
| Dashboard Redirect | 87-94 | ✅ Fixed |
| Default Pass-through | 106 | ✅ Returns `supabaseResponse` |

## Testing Recommendations

### Manual Testing

1. **Test unauthenticated access:**
   ```bash
   # Clear cookies, access protected route
   # Should redirect to /login with session preserved
   ```

2. **Test login flow:**
   ```bash
   # Log in successfully
   # Should redirect to /dashboard with session active
   ```

3. **Test API authentication:**
   ```bash
   # Make API call without auth
   # Should receive 401 with session preserved
   ```

### Automated Testing

Consider adding integration tests for:
- Redirect responses include auth cookies
- Session persists across navigation
- Token refresh works during redirects

## Lessons Learned

1. **Read ALL framework warnings carefully** - They exist for a reason
2. **Apply patterns consistently** - If one path needs it, all paths need it
3. **Session management is critical** - Small mistakes have big impacts
4. **Trust the framework** - Supabase's warning was explicit and correct

## References

- [Supabase SSR Documentation](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=router&router=nextjs-app)
- [Next.js Middleware](https://nextjs.org/docs/app/building-your-application/routing/middleware)
- Original warning in: `lib/supabase/middleware.ts` lines 91-102
