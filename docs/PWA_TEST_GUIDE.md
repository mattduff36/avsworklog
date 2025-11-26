# PWA Offline Testing Guide

## Overview
This guide explains how to test the Progressive Web App (PWA) offline functionality on iPhone and Android devices.

## Architecture

### Offline Flow
1. **Start URL**: User opens PWA from home screen → loads `/` (home page)
2. **Auto-redirect**: Home page detects online status and redirects to `/dashboard`
3. **Service Worker**: Caches pages as they're visited while online
4. **Offline Fallback**: When offline, if a page isn't cached, the service worker serves `/offline`

### Key Files
- **Home Route**: `app/page.tsx` - Static client shell with auto-redirect
- **Offline Route**: `app/offline/page.tsx` - Standalone static fallback page (force-static)
- **Service Worker**: `public/sw-custom.js` - Custom SW with offline fallback
- **Manifest**: `public/manifest.json` - start_url: "/" and scope: "/"
- **Config**: `next.config.ts` - next-pwa with fallbacks.document: "/offline"

## Prerequisites

### Build Setup
1. **Production build required**: PWA only works in production mode
   ```bash
   npm run build
   ```

2. **HTTPS required**: Service workers require secure context
   - Use Vercel deployment, or
   - Use local HTTPS proxy (ngrok, localhost with cert, etc.)

### Device Requirements
- **iPhone**: Safari 15.4+ (iOS 15.4+)
- **Android**: Chrome 80+

## Testing on iPhone

### Initial Setup (While Online)
1. **Deploy or serve** the production build over HTTPS

2. **Open in Safari**:
   - Visit your HTTPS URL in Safari
   - Ensure you're connected to WiFi/mobile data

3. **Add to Home Screen**:
   - Tap the Share button (square with arrow)
   - Scroll down and tap "Add to Home Screen"
   - Confirm by tapping "Add"

4. **Launch PWA**:
   - Find the Squires icon on your home screen
   - Tap to open (should open in standalone mode, not Safari)

5. **Navigate while online**:
   - You should auto-redirect from `/` to `/dashboard`
   - Visit the pages you want to use offline:
     - Dashboard
     - Timesheets
     - Inspections
     - Any other pages you need
   - Each visited page gets cached by the service worker

### Testing Offline Behavior

#### Test 1: Open PWA while offline
1. **Close** the PWA completely (swipe up from app switcher)
2. **Enable Airplane Mode**
3. **Open PWA** from home screen
4. **Expected results**:
   - Home page `/` loads (static shell)
   - Auto-redirect to `/dashboard` attempts to run
   - If dashboard was cached: dashboard loads
   - If dashboard not cached: `/offline` page appears

#### Test 2: Navigate to cached page while offline
1. **While offline**, if you're on a cached page (e.g., dashboard)
2. **Tap a link** to another page you previously visited
3. **Expected result**: Page loads from cache

#### Test 3: Navigate to uncached page while offline
1. **While offline**, if you're on a cached page
2. **Tap a link** to a page you've never visited while online
3. **Expected result**: `/offline` fallback page appears with instructions

#### Test 4: Retry from offline page
1. **While on the `/offline` page**
2. **Turn off Airplane Mode** (reconnect to internet)
3. **Tap "Retry Connection"** button
4. **Expected result**: Redirects to `/dashboard`

### Common iPhone Issues & Solutions

**Issue**: PWA doesn't install from home screen
- **Solution**: Ensure you're using Safari (not Chrome), and the site is HTTPS

**Issue**: PWA opens in Safari instead of standalone
- **Solution**: Check manifest.json has `"display": "standalone"`

**Issue**: Service worker not registering
- **Solution**: Check browser console for errors; ensure HTTPS

**Issue**: Pages don't cache
- **Solution**: 
  - Check service worker is active (Safari Dev Tools → Storage → Service Workers)
  - Visit pages while online first
  - Check network tab to verify SW intercepts requests

**Issue**: Offline page doesn't appear
- **Solution**:
  - Verify `next.config.ts` has `fallbacks.document: "/offline"`
  - Ensure `/offline` route exists at `app/offline/page.tsx`
  - Check service worker console for errors

## Testing on Android

### Initial Setup (While Online)
1. **Open in Chrome**: Visit HTTPS URL

2. **Install PWA**:
   - Chrome will show "Add to Home Screen" banner automatically, or
   - Tap menu (⋮) → "Add to Home Screen" → "Install"

3. **Launch and navigate**: Same as iPhone steps 4-5

### Testing Offline (same as iPhone)
- Follow "Testing Offline Behavior" steps above
- Android Chrome is generally more lenient with PWA requirements than Safari

## Debugging Tips

### Check Service Worker Status
**iPhone (Safari)**:
- Enable Web Inspector: Settings → Safari → Advanced → Web Inspector
- Connect to Mac → Safari Dev Tools → Develop → [Your Device]

**Android (Chrome)**:
- Visit `chrome://inspect` on desktop Chrome
- Enable USB debugging on device
- Inspect the PWA

### Console Logging
- Check for service worker registration messages
- Look for fetch events and cache hits/misses
- Verify fallback routing

### Network Tab
- Filter by "Service Worker"
- Verify cached resources show "(from ServiceWorker)"

## Known Limitations

### Requires Online First
- User must visit the PWA while online at least once
- Each route must be visited while online to be cached
- No "install all pages" option (intentional to save bandwidth)

### Dynamic Content
- Cached pages show data from the last online visit
- Real-time features (notifications, approvals) won't update offline
- Users should reconnect periodically for fresh data

### Authentication
- Auth tokens cached with pages
- If token expires while offline, user will see errors when back online
- Recommended: Keep offline sessions short

### Storage Limits
- iPhone Safari: ~50MB cache limit
- Android Chrome: More generous, typically 100MB+
- If limit exceeded, oldest pages evicted first

## Best Practices for Users

1. **Stay online when possible** - Offline mode is for temporary disconnections
2. **Visit pages before going offline** - Pre-cache the routes you'll need
3. **Reconnect regularly** - Get fresh data and prevent token expiration
4. **Use offline page instructions** - Follow the on-screen guidance

## Troubleshooting Checklist

- [ ] Built with `npm run build` (not dev mode)
- [ ] Served over HTTPS
- [ ] Manifest.json has `start_url: "/"` and `scope: "/"`
- [ ] Service worker registered successfully
- [ ] Visited target pages while online first
- [ ] Tested in actual PWA mode (not browser tab)
- [ ] Checked console for errors
- [ ] Verified offline page exists at `/offline`

## Developer Notes

### Force-Static Offline Route
The `/offline` page uses `export const dynamic = 'force-static'` to ensure it's:
- Pre-rendered at build time
- Always available (no data fetching)
- Never throws during generation
- Guaranteed to work offline

### Client-Only Home Page
The `/` route is a client component to avoid Next.js server redirects that fail offline. It:
- Renders immediately (no server dependency)
- Checks `navigator.onLine` before redirecting
- Provides fallback UI and manual navigation

### Service Worker Fallback
The `sw-custom.js` includes fallback logic:
```javascript
fallbacks: {
  document: "/offline"
}
```
This catches failed navigation requests and serves the offline page.

## Further Reading
- [Next.js PWA Plugin](https://github.com/shadowwalker/next-pwa)
- [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Apple Safari PWA Support](https://webkit.org/blog/8217/new-webkit-features-in-safari-11-1/)

