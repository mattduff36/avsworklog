# PWA Offline Testing Guide

## Overview
This guide explains how to test the Progressive Web App (PWA) offline detection on iPhone and Android devices.

**Important:** The app requires an active internet connection to function. When offline, users will see a clear "No Connection" page after a 10-second network timeout.

## Architecture

### Online-First Approach
1. **Start URL**: User opens PWA from home screen → loads `/` (home page)
2. **Auto-redirect**: Home page checks `navigator.onLine` and redirects to `/dashboard`
3. **Network Timeout**: All page navigation attempts timeout after 10 seconds
4. **Offline Fallback**: If network fails, service worker serves `/offline` page
5. **No Page Caching**: Pages are NOT cached - fresh data every time when online

### What Gets Cached
- **Static assets only**: JS bundles, CSS, fonts, images
- **NOT cached**: HTML pages, API responses, dynamic data

### Key Files
- **Home Route**: `app/page.tsx` - Static client shell with auto-redirect
- **Offline Route**: `app/offline/page.tsx` - Standalone static fallback page (force-static)
- **Service Worker**: `public/sw-custom.js` - Custom SW with NetworkOnly for navigation
- **Manifest**: `public/manifest.json` - start_url: "/" and scope: "/"
- **Config**: `next.config.ts` - next-pwa with NetworkOnly runtimeCaching + 10s timeout

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

5. **Verify online behavior**:
   - You should auto-redirect from `/` to `/dashboard`
   - Navigate freely to any page
   - Everything should work normally

### Testing Offline Detection

#### Test 1: Open PWA while offline
1. **Close** the PWA completely (swipe up from app switcher)
2. **Enable Airplane Mode**
3. **Open PWA** from home screen
4. **Expected results**:
   - Home page `/` loads (pre-cached)
   - Auto-redirect attempts to load `/dashboard`
   - After 10 seconds, network timeout occurs
   - `/offline` page appears with message: "No Internet Connection"

#### Test 2: Lose connection while browsing
1. **Open PWA** while online
2. **Navigate to dashboard** (works normally)
3. **Enable Airplane Mode**
4. **Look for offline banner** at top of page
5. **Expected result**: 
   - Amber warning banner appears
   - Message: "No Internet Connection. This app requires an active connection..."
   - "Retry" button available

#### Test 3: Try to navigate while offline
1. **While offline**, with banner showing
2. **Tap a navigation link** (e.g., Timesheets)
3. **Expected result**:
   - Navigation attempts for up to 10 seconds
   - Then `/offline` page appears
   - Message explains app needs internet

#### Test 4: Retry from offline page
1. **While on the `/offline` page**
2. **Turn off Airplane Mode** (reconnect to internet)
3. **Wait 2-3 seconds** for connection to stabilize
4. **Tap "Try Again"** button
5. **Expected result**: Page refreshes, dashboard loads successfully

#### Test 5: Submit form while offline
1. **Open new timesheet** or **new inspection** page (while online)
2. **Fill in some data**
3. **Enable Airplane Mode**
4. **Try to save/submit**
5. **Expected results**:
   - Error dialog appears
   - Message: "Unable to save - no internet connection"
   - Toast notification: "Cannot save while offline. Please check your connection."

#### Test 6: Reconnect after offline warning
1. **While offline**, with banner showing on dashboard
2. **Turn off Airplane Mode**
3. **Wait 2-3 seconds**
4. **Expected result**: 
   - Banner disappears automatically
   - Or tap "Retry" button to refresh data

### Common iPhone Issues & Solutions

**Issue**: PWA doesn't install from home screen
- **Solution**: Ensure you're using Safari (not Chrome), and the site is HTTPS

**Issue**: PWA opens in Safari instead of standalone
- **Solution**: Check manifest.json has `"display": "standalone"`

**Issue**: Offline page doesn't appear immediately
- **Solution**: This is expected - 10-second timeout before fallback triggers

**Issue**: Offline banner doesn't show when offline
- **Solution**: Refresh the page or restart PWA - banner requires JS to detect

**Issue**: PWA shows white screen when offline
- **Solution**: Ensure service worker is registered. Check in Safari Dev Tools.

## Testing on Android

### Initial Setup (While Online)
1. **Deploy or serve** the production build over HTTPS

2. **Open in Chrome**:
   - Visit your HTTPS URL in Chrome
   - Ensure you're connected to WiFi/mobile data

3. **Install PWA**:
   - Tap the three-dot menu (⋮)
   - Select "Install app" or "Add to Home screen"
   - Confirm installation

4. **Launch PWA**:
   - Find the Squires icon in your app drawer or home screen
   - Tap to open

5. **Verify online behavior**:
   - You should auto-redirect from `/` to `/dashboard`
   - Navigate freely to any page
   - Everything should work normally

### Testing Offline Detection
Follow the same test scenarios as iPhone (Test 1-6 above). Android Chrome handles service workers slightly better than Safari, so offline detection may be faster.

### Common Android Issues & Solutions

**Issue**: PWA install prompt doesn't appear
- **Solution**: Ensure manifest.json is valid and served with correct MIME type

**Issue**: Service worker not updating
- **Solution**: Uninstall PWA, clear Chrome cache, reinstall

**Issue**: Offline page loads instantly without timeout
- **Solution**: Android may detect offline faster than iOS - this is fine

## Debugging Tools

### Chrome DevTools (Desktop)
1. Open site in Chrome
2. Press F12 for DevTools
3. Go to **Application** tab
4. Check **Service Workers** section
5. Use **Offline** checkbox to simulate offline

### Safari Web Inspector (Desktop)
1. Open site in Safari
2. Enable Developer menu: Safari > Settings > Advanced > Show Developer menu
3. Develop > Your Device Name > Connect to device
4. Check service worker status

### Console Logs
Watch browser console for:
- `Service worker registered`
- `Network request failed` (when offline)
- `Offline banner displayed`

## Expected Behavior Summary

| Scenario | Expected Result | Timeout |
|----------|----------------|---------|
| Open PWA offline | `/offline` page appears | 10 seconds |
| Navigate offline | `/offline` page appears | 10 seconds |
| Submit form offline | Error toast + dialog | Immediate |
| View page offline (banner) | Amber warning banner | Immediate |
| Retry while still offline | Same offline page | 10 seconds |
| Retry after reconnect | Dashboard loads | Immediate |

## Notes

- **No offline queue**: Forms do NOT save locally when offline
- **No cached pages**: Every navigation requires internet
- **Static assets cached**: JS/CSS/images load offline (for offline page UI)
- **10-second grace period**: Gives slow networks time to respond
- **Clear messaging**: User always knows why something failed

## Updating the App

After making changes and rebuilding:
1. **Uninstall old PWA** from home screen
2. **Clear browser cache** (if applicable)
3. **Deploy new build**
4. **Reinstall PWA** from browser
5. **Verify service worker** updated (check version)

## Troubleshooting

**Offline page doesn't show**
- Check service worker registered: DevTools > Application > Service Workers
- Check fallback configured: `next.config.ts` → `fallbacks.document: "/offline"`
- Verify `/offline` route exists and is force-static

**Banner doesn't appear**
- Check `useOnlineStatus` hook is imported
- Check `<OfflineBanner />` component is rendered
- Verify `online` state is false when offline

**Timeout too slow/fast**
- Adjust `networkTimeoutSeconds: 10` in `next.config.ts`
- Rebuild and redeploy
- Reinstall PWA

**Forms still try to save offline**
- Check error handling catches network errors
- Verify `isOnline` guard is in place
- Ensure toast shows clear offline message
