# Notification Settings Sync Fix
## Date: 2026-01-26

---

## Problem

When changing notification settings via the `/debug` page (Admin API), the changes were not properly reflected when viewing the `/notifications` page (User API). Both pages appeared to be using different toggle states.

---

## Root Cause

**Field Mismatch:** The two API endpoints were handling different fields:

1. **Admin API** (`/api/notification-preferences/admin`):
   - Only updated: `notify_in_app`, `notify_email`
   - Did NOT update: `enabled`

2. **User API** (`/api/notification-preferences`):
   - Updated: `enabled`, `notify_in_app`, `notify_email`

This inconsistency was a remnant from when we removed the "On/Enabled" toggle from the UI. The admin API was correctly updated to remove the `enabled` field, but the regular user API still had logic for it.

---

## The Fix

**Synchronized both APIs** to handle the exact same fields:

### 1. Updated User API Route
**File:** `app/api/notification-preferences/route.ts`

**Before:**
```typescript
const { module_key, enabled, notify_in_app, notify_email } = body;

const upsertData: any = {
  user_id: user.id,
  module_key,
};

if (enabled !== undefined) upsertData.enabled = enabled;
if (notify_in_app !== undefined) upsertData.notify_in_app = notify_in_app;
if (notify_email !== undefined) upsertData.notify_email = notify_email;
```

**After:**
```typescript
const { module_key, notify_in_app, notify_email } = body;

const upsertData: any = {
  user_id: user.id,
  module_key,
};

if (notify_in_app !== undefined) upsertData.notify_in_app = notify_in_app;
if (notify_email !== undefined) upsertData.notify_email = notify_email;
```

### 2. Updated Function Signatures
**Files:**
- `app/(dashboard)/notifications/page.tsx`
- `app/(dashboard)/debug/page.tsx`

**Before:**
```typescript
field: 'enabled' | 'notify_in_app' | 'notify_email'
```

**After:**
```typescript
field: 'notify_in_app' | 'notify_email'
```

### 3. Cleaned Up Local State Management
**File:** `app/(dashboard)/debug/page.tsx`

**Before:**
```typescript
prefs.push({
  module_key: moduleKey,
  enabled: field === 'enabled' ? value : true,
  notify_in_app: field === 'notify_in_app' ? value : true,
  notify_email: field === 'notify_email' ? value : true,
});
```

**After:**
```typescript
prefs.push({
  module_key: moduleKey,
  notify_in_app: field === 'notify_in_app' ? value : true,
  notify_email: field === 'notify_email' ? value : true,
});
```

### 4. Updated Type Definitions
**File:** `types/notifications.ts`

**Before:**
```typescript
export interface UpdateNotificationPreferenceRequest {
  module_key: NotificationModuleKey;
  enabled?: boolean;
  notify_in_app?: boolean;
  notify_email?: boolean;
}
```

**After:**
```typescript
export interface UpdateNotificationPreferenceRequest {
  module_key: NotificationModuleKey;
  notify_in_app?: boolean;
  notify_email?: boolean;
}
```

---

## Files Modified

1. `app/api/notification-preferences/route.ts` - Removed `enabled` field logic
2. `app/(dashboard)/notifications/page.tsx` - Updated function signature
3. `app/(dashboard)/debug/page.tsx` - Updated function signature and local state
4. `types/notifications.ts` - Updated request interface

---

## How It Works Now

Both pages now use **identical field handling**:

1. **Admin changes settings on `/debug`**:
   - Updates `notify_in_app` and/or `notify_email` in database
   - Does NOT touch `enabled` field

2. **User views settings on `/notifications`**:
   - Fetches `notify_in_app` and `notify_email` from database
   - Displays the exact values saved by admin
   - Does NOT use `enabled` field

3. **User changes their own settings on `/notifications`**:
   - Updates `notify_in_app` and/or `notify_email` in database
   - Does NOT touch `enabled` field
   - Admin sees these changes on `/debug` after refresh

---

## Testing Steps

1. ✅ Go to `/debug` page
2. ✅ Change notification settings for your user
3. ✅ Navigate to `/notifications` page
4. ✅ Verify toggles match what was set on `/debug`
5. ✅ Change a toggle on `/notifications`
6. ✅ Navigate back to `/debug`
7. ✅ Verify the change is reflected for your user

---

## Important Notes

### The `enabled` Field Still Exists in Database
The `NotificationPreference` interface still includes `enabled: boolean` because this field exists in the database table. However:
- **Neither API updates it anymore**
- **Neither UI displays it anymore**
- It's essentially ignored by the application

### Data Refresh
The pages do **not** auto-sync in real-time. When you make a change on one page, you must **refresh** or **navigate away and back** to the other page to see the change. This is expected behavior for the current architecture.

If real-time sync is needed in the future, we would need to implement:
- WebSockets or Server-Sent Events
- Polling intervals
- Or a state management solution like Redux with subscriptions

---

## Database Migration Note

**No database migration needed.** The `enabled` column can remain in the `notification_preferences` table for backward compatibility. It simply won't be read or written by the application anymore.

If you want to clean it up in the future, you could:
1. Set all `enabled` values to `true` (one-time update)
2. Remove the column from the table
3. Update the `NotificationPreference` type to remove the field

But this is **optional** and not required for the fix to work.

---

## Success Criteria

✅ Both APIs use identical fields
✅ No linter errors
✅ Changes made on `/debug` are visible on `/notifications` after page refresh
✅ Changes made on `/notifications` are visible on `/debug` after page refresh
✅ Type definitions are consistent across the codebase

---

**Status:** ✅ **FIXED AND TESTED**
