# Notification Toggle Sync Fix - January 26, 2026

## Problem

The notification toggle switches on the `/notifications` page were showing different states than the checkboxes on the `/debug` page for the same user and module, causing synchronization issues.

## Root Cause

The issue occurred when updating a single field (`notify_in_app` or `notify_email`) for a user who didn't have an existing preference record:

1. **Previous behavior**: When updating only ONE field via the API, the request body contained only that field:
   ```json
   {
     "user_id": "xxx",
     "module_key": "errors",
     "notify_in_app": false
   }
   ```

2. **Database upsert behavior**: When the record didn't exist, the database would create a new record with:
   - The provided field: set to the requested value (`false`)
   - The missing field: set to the database DEFAULT value (`true`)
   
3. **Result**: The UI would show both toggles as "on" (from the default state), but after updating one, the database would have:
   - Updated field: `false` (as requested)
   - Other field: `true` (database default, not the UI default)

4. **Sync Issue**: This mismatch caused the `/debug` page and `/notifications` page to show different states because they were working with partially-initialized records.

## Database Schema

From `supabase/migrations/20260126_notification_preferences.sql`:

```sql
CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL CHECK (module_key IN ('errors', 'maintenance', 'rams', 'approvals', 'inspections')),
  enabled BOOLEAN DEFAULT true,
  notify_in_app BOOLEAN DEFAULT true,  -- Database default
  notify_email BOOLEAN DEFAULT true,   -- Database default
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, module_key)
);
```

## Solution

Modified both the `/debug` page and `/notifications` page to **always send BOTH fields** when upserting a preference, even if only one field is being changed:

### Changes Made

#### 1. Debug Page (`app/(dashboard)/debug/page.tsx`)

**`updatePreference` function**: Now reads the current preference state and sends both fields:

```typescript
const updatePreference = async (
  userId: string,
  moduleKey: string,
  field: 'notify_in_app' | 'notify_email',
  value: boolean
) => {
  // Get current preference to ensure we send both fields
  const user = users.find(u => u.user_id === userId);
  const currentPref = user?.preferences.find(p => p.module_key === moduleKey);
  
  // Prepare data with both fields
  const updateData = {
    user_id: userId,
    module_key: moduleKey,
    notify_in_app: field === 'notify_in_app' ? value : (currentPref?.notify_in_app ?? true),
    notify_email: field === 'notify_email' ? value : (currentPref?.notify_email ?? true),
  };

  const response = await fetch('/api/notification-preferences/admin', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updateData),  // Now includes BOTH fields
  });
  // ... rest of function
};
```

**`batchUpdatePreference` function**: Also updated to send both fields for each update.

#### 2. Notifications Page (`app/(dashboard)/notifications/page.tsx`)

**`updatePreference` function**: Same approach - always sends both fields:

```typescript
const updatePreference = async (
  moduleKey: NotificationModuleKey,
  field: 'notify_in_app' | 'notify_email',
  value: boolean
) => {
  // Get current preference to ensure we send both fields
  const currentPref = preferences.find(p => p.module_key === moduleKey);
  
  // Prepare data with both fields
  const updateData = {
    module_key: moduleKey,
    notify_in_app: field === 'notify_in_app' ? value : (currentPref?.notify_in_app ?? true),
    notify_email: field === 'notify_email' ? value : (currentPref?.notify_email ?? true),
  };

  const response = await fetch('/api/notification-preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updateData),  // Now includes BOTH fields
  });
  // ... rest of function
};
```

## How It Works Now

1. **User changes a toggle/checkbox**: E.g., unchecks "In-App" notifications
2. **UI reads current state**: Checks if a preference record exists
3. **Builds complete update data**: 
   - Changed field: new value (`false`)
   - Other field: existing value from record, OR default (`true`) if no record exists
4. **Sends BOTH fields to API**: 
   ```json
   {
     "user_id": "xxx",
     "module_key": "errors",
     "notify_in_app": false,
     "notify_email": true
   }
   ```
5. **Database upserts correctly**: 
   - If record exists: updates both fields
   - If record doesn't exist: creates record with explicit values for both fields
6. **Result**: Both pages now show consistent state because both fields are always explicitly set

## Files Modified

1. `app/(dashboard)/debug/page.tsx`
   - Modified `updatePreference` function
   - Modified `batchUpdatePreference` function
   
2. `app/(dashboard)/notifications/page.tsx`
   - Modified `updatePreference` function

## Testing

To verify the fix:

1. **Test with new user (no preferences):**
   - Go to `/debug` page
   - Find a user with no notification preferences
   - Uncheck ONE checkbox (e.g., "In-App" for "Error Reports")
   - Navigate to `/notifications` page (logged in as that user)
   - Verify BOTH toggles show the correct state (In-App: OFF, Email: ON)

2. **Test with existing user:**
   - Go to `/notifications` page
   - Toggle ONE switch
   - Go to `/debug` page
   - Verify the corresponding checkbox shows the correct state

3. **Test batch updates:**
   - Go to `/debug` page
   - Enable "Batch Mode"
   - Select multiple users
   - Update a field (e.g., disable "Email" for all selected users)
   - Check individual user preferences to verify both fields are correct

## Related Files

- API Endpoints (no changes needed):
  - `app/api/notification-preferences/route.ts` (user API)
  - `app/api/notification-preferences/admin/route.ts` (admin API)
  
- Type Definitions (no changes needed):
  - `types/notifications.ts`

- Database Migration:
  - `supabase/migrations/20260126_notification_preferences.sql`

## Previous Related Work

- **NOTIFICATION_SYNC_FIX_2026-01-26.md**: Removed the `enabled` field from the UI and APIs
- **NOTIFICATION_RLS_FIX_2026-01-26.md**: Fixed RLS policy violations by using admin client

## Notes

- The fix ensures that database records are always created with explicit values for both fields, preventing reliance on database defaults
- This approach works regardless of whether the preference record exists or not
- The nullish coalescing operator (`??`) provides a fallback to `true` when no current preference exists, matching the UI default behavior
- Both the admin API and user API handle the update correctly since they simply upsert all provided fields

## Status

✅ **COMPLETE** - All changes implemented and linter checks passed
