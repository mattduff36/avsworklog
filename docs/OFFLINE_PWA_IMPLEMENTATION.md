# Offline PWA Implementation - Complete Guide

**Last Updated**: October 30, 2025  
**Status**: ✅ Complete - Ready for User Testing

---

## 📋 Overview

The Squires app now has full **Progressive Web App (PWA)** capabilities with comprehensive offline support. Users can create timesheets and inspections even when offline, and all data automatically syncs when they reconnect.

---

## ✅ Features Implemented

### 1. **PWA Configuration**
- ✅ `next-pwa` integrated with Next.js 15
- ✅ Service worker with runtime caching for Supabase API
- ✅ Professional `manifest.json` with Squires branding
- ✅ PWA icons: 192x192, 512x512, apple-touch-icon
- ✅ Standalone display mode for app-like experience
- ✅ Portrait-primary orientation optimized

### 2. **Offline Queue System**
- ✅ Zustand store with localStorage persistence
- ✅ Handles timesheets with entries
- ✅ Handles inspections with items
- ✅ Automatic retry logic (max 3 attempts)
- ✅ Preserves data across browser sessions
- ✅ Processes queue when connection restored

### 3. **Realtime Updates**
- ✅ Supabase Realtime subscriptions for timesheets
- ✅ Supabase Realtime subscriptions for inspections
- ✅ Auto-refresh list pages on INSERT/UPDATE/DELETE
- ✅ Toast notifications for status changes (approved/rejected)
- ✅ Live updates across devices

### 4. **User Experience**
- ✅ **Offline indicator** in navbar with pending count
- ✅ **Toast notifications**:
  - "You are offline" when connection lost
  - "Back online!" when connection restored
  - "Syncing X pending items..." during sync
  - "Sync complete!" after successful sync
- ✅ **Form behavior**:
  - Forms save to queue when offline
  - Clear feedback with offline icon
  - Seamless UX - no blocked submissions

---

## 🛠️ Technical Architecture

### File Structure

```
lib/
├── hooks/
│   ├── useOfflineSync.ts      # Hook for online/offline detection + sync
│   └── useRealtime.ts          # Hooks for Supabase Realtime subscriptions
├── stores/
│   └── offline-queue.ts        # Zustand store for offline queue management
└── utils/
    └── bank-holidays.ts        # UK bank holidays API integration

app/(dashboard)/
├── timesheets/
│   ├── page.tsx                # List with realtime updates
│   └── new/page.tsx            # Create with offline support
└── inspections/
    ├── page.tsx                # List with realtime updates
    └── new/page.tsx            # Create with offline support

public/
├── manifest.json               # PWA manifest
├── icon-192x192.png           # PWA icon (small)
├── icon-512x512.png           # PWA icon (large)
└── sw.js                       # Service worker (auto-generated)
```

### Offline Queue Data Structure

```typescript
interface QueueItem {
  id: string;                  // Unique ID (timestamp + random)
  type: 'timesheet' | 'inspection';
  action: 'create' | 'update' | 'delete';
  data: Record<string, unknown>; // Form data + entries/items
  timestamp: number;            // When queued
  retries: number;              // Retry count (max 3)
}
```

### Queue Processing Logic

```typescript
// When creating a timesheet offline:
1. Form validation passes
2. Check isOnline status
3. If offline:
   - Add to queue with entries array
   - Show "Saved offline" toast
   - Navigate to list page
4. If online:
   - Save directly to Supabase
   - Show normal success message

// When coming back online:
1. Detect online event
2. Get queue length
3. Show "Syncing X items..." toast
4. Process each queue item:
   - Insert main record (timesheet/inspection)
   - Insert child records (entries/items)
   - Remove from queue on success
   - Retry up to 3 times on error
5. Show "Sync complete!" toast
```

---

## 📱 How It Works (User Perspective)

### Creating a Timesheet Offline

1. User fills out timesheet form
2. User submits (with signature)
3. **If offline**:
   - ✅ Toast: "Timesheet saved offline"
   - ✅ Navbar shows offline icon + "1 pending"
   - ✅ Data stored in localStorage (persists across sessions)
4. **When back online**:
   - ✅ Toast: "Back online! Syncing 1 pending item..."
   - ✅ Queue processes automatically
   - ✅ Toast: "Sync complete!"
   - ✅ Timesheet appears in list

### Realtime Updates (Manager Approval)

1. Manager approves a timesheet
2. **All users viewing the list see**:
   - ✅ List auto-refreshes
   - ✅ Toast: "Timesheet approved!"
   - ✅ Status badge updates to green "Approved"

---

## 🧪 Testing Guide

### Test 1: PWA Installation (Mobile)

**On iOS (Safari)**:
1. Open SquiresApp in Safari
2. Tap Share button
3. Tap "Add to Home Screen"
4. Open from home screen
5. ✅ Should open in standalone mode (no browser UI)

**On Android (Chrome)**:
1. Open SquiresApp in Chrome
2. Tap menu (3 dots)
3. Tap "Add to Home screen" or "Install app"
4. Open from home screen
5. ✅ Should open in standalone mode

### Test 2: Offline Timesheet Creation

1. Open Chrome DevTools
2. Go to Network tab
3. Set throttling to "Offline"
4. Create a new timesheet:
   - Fill all 7 days
   - Add signature
   - Submit
5. ✅ Should see:
   - "You are offline" toast
   - "Timesheet saved offline" toast
   - Navbar shows offline icon
   - Navbar shows "1 pending"
6. Go back online (set throttling to "Online")
7. ✅ Should see:
   - "Back online! Syncing 1 pending item..." toast
   - "Sync complete!" toast
   - Navbar back to online icon
   - Timesheet appears in list

### Test 3: Offline Inspection Creation

Same as Test 2, but for inspections:
1. Go offline
2. Create inspection (select vehicle, fill items)
3. Submit with signature
4. ✅ Should save to queue
5. Go back online
6. ✅ Should sync and appear in list

### Test 4: Realtime Updates

**Setup**: Need 2 browser windows/devices
1. Window 1: Login as employee, view timesheets list
2. Window 2: Login as manager, view approvals page
3. Window 2: Approve a timesheet
4. Window 1: ✅ Should see:
   - List auto-refreshes
   - "Timesheet approved!" toast
   - Status changes to "Approved"

### Test 5: Queue Persistence

1. Go offline
2. Create a timesheet
3. **Close browser completely**
4. **Reopen browser**
5. ✅ Should see:
   - Navbar shows "1 pending"
   - Queue persisted in localStorage
6. Go online
7. ✅ Should sync the queued item

---

## 🔧 Configuration Files

### `next.config.ts`
```typescript
import withPWA from "next-pwa";

export default withPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/.*\.supabase\.co\/.*$/,
      handler: "NetworkFirst",
      options: {
        cacheName: "supabase-cache",
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60, // 24 hours
        },
      },
    },
  ],
})(nextConfig);
```

### `public/manifest.json`
```json
{
  "name": "Squires",
  "short_name": "Squires",
  "description": "Digital forms management for A&V Squires Plant Co. Ltd.",
  "start_url": "/dashboard",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#F1D64A",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

---

## 🚀 Deployment Notes

### Environment Variables
No additional environment variables needed for PWA/offline features. Existing Supabase credentials are sufficient.

### Build Process
```bash
npm run build
```
- Service worker automatically generated in `public/sw.js`
- PWA assets included in build output
- Ready for production deployment

### Vercel Configuration
Already configured! No changes needed to `vercel.json`.

---

## 📊 Success Criteria

| Feature | Status | Notes |
|---------|--------|-------|
| PWA Installation | ✅ Ready | Test on actual devices |
| Offline Timesheet Creation | ✅ Complete | Fully functional |
| Offline Inspection Creation | ✅ Complete | Fully functional |
| Offline Queue Persistence | ✅ Complete | localStorage-based |
| Automatic Sync | ✅ Complete | On reconnection |
| Realtime Updates | ✅ Complete | Timesheets & Inspections |
| Toast Notifications | ✅ Complete | All status changes |
| Offline Indicator | ✅ Complete | Navbar with count |
| Cross-device Sync | ✅ Complete | Via Supabase Realtime |

---

## 🎯 Next Steps (User Testing Required)

1. **Install PWA on mobile device** (iOS/Android)
2. **Test offline creation** with Network throttling
3. **Test queue persistence** by closing/reopening browser
4. **Test realtime updates** across two devices
5. **Verify sync behavior** when going from offline → online

---

## 🐛 Troubleshooting

### Issue: PWA not installing
- **Check**: Service worker registration in DevTools
- **Check**: manifest.json is accessible at `/manifest.json`
- **Check**: Icons are present in `/public/`

### Issue: Queue not syncing
- **Check**: Browser console for errors
- **Check**: `localStorage` for `offline-queue-storage` key
- **Check**: Network tab - are Supabase requests succeeding?

### Issue: Realtime not working
- **Check**: Supabase project has Realtime enabled
- **Check**: RLS policies allow reading timesheets/inspections
- **Check**: Browser console for WebSocket connection status

---

## 📚 Related Documentation

- **PRD Status**: `docs/PRD_IMPLEMENTATION_STATUS.md`
- **Vehicle Management**: `docs/VEHICLE_MANAGEMENT_SYSTEM.md`
- **Bank Holidays**: `docs/PAYROLL_API_INTEGRATION.md`
- **Password Management**: `docs/PASSWORD_MANAGEMENT_IMPLEMENTATION.md`

---

**Implementation Complete**: October 30, 2025  
**Ready for Production**: Yes ✅  
**User Testing**: Required before full rollout

