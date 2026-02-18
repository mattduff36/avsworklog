# Error System Testing Checklist

## Quick Start

**Dev Server:** Running on http://localhost:3001  
**Login:** Use your admin credentials (admin@mpdee.co.uk)

---

## Critical Test: Notifications Now Work! 🎉

### What Was Broken
- **Notification bell NEVER showed any count**
- **No notifications ever appeared in the panel**
- **Entire system was broken due to RLS policies**

### Test It:
1. Login as admin
2. Look at the bell icon in navbar
3. **Expected:** Shows count if any messages exist (may be 0 if no messages yet)
4. Click the bell
5. **Expected:** Notification panel opens and displays messages

✅ **If you see ANY notifications, the critical fix worked!**

---

## Test Checklist

### ✅ 1. Submit Error Report

- [ ] Go to `/help`
- [ ] Click "Errors" tab
- [ ] Fill in:
  - Title: "Test Error"
  - Description: "Testing the new system"
  - **Select a page from dropdown** (e.g., "Timesheets - New Timesheet")
- [ ] Notice: Submit button is disabled until page selected
- [ ] Click "Submit Error Report"
- [ ] **Expected:** Success toast appears

### ✅ 2. Verify In-App Notification

- [ ] After submitting, click bell icon (top right)
- [ ] **Expected:** New notification appears
- [ ] Subject should be: "🐛 Error Report: Test Error"
- [ ] Click notification to view details

### ✅ 3. Verify Email Notification

- [ ] Check email inbox for admin account
- [ ] **Expected:** Email with subject "🐛 Error Report: Test Error"
- [ ] Email should have:
  - Reporter name
  - Error title and description
  - Page/feature selected
  - "Manage Error Reports" button

### ✅ 4. Dashboard Tile

- [ ] Go to `/dashboard`
- [ ] Scroll to "Management Tools" section
- [ ] **Expected:** See "Error Reports" tile (with triangle icon)
- [ ] Click tile
- [ ] **Expected:** Navigate to `/admin/errors/manage`

### ✅ 5. Admin Management Page

- [ ] On `/admin/errors/manage`, verify:
  - [ ] "My Notification Preferences" card shows at top
  - [ ] Two toggle switches: "In-App Notifications" and "Email Notifications"
  - [ ] Stats cards show counts (All, New, Investigating, Resolved)
  - [ ] Error reports list shows your test error
- [ ] Click your test error
- [ ] **Expected:** Detail dialog opens
- [ ] Change status to "Investigating"
- [ ] Add internal note: "Reviewing this error"
- [ ] Click "Save Changes"
- [ ] **Expected:** Success toast, dialog closes

### ✅ 6. Test Preferences (Critical New Feature)

**Turn off in-app notifications:**
- [ ] Go to `/admin/errors/manage`
- [ ] Toggle "In-App Notifications" OFF (leave Email ON)
- [ ] Wait for "Notification preferences saved" toast
- [ ] Submit another error from `/help` → Errors
- [ ] **Expected:** Bell shows NO new notification, but email arrives

**Turn off email:**
- [ ] Toggle "In-App Notifications" ON, "Email" OFF
- [ ] Submit another error
- [ ] **Expected:** Bell shows notification, NO email arrives

**Turn both back ON:**
- [ ] Toggle both ON
- [ ] Submit another error
- [ ] **Expected:** Both notification AND email arrive

### ✅ 7. "My Errors" View

- [ ] Go to `/help` → "Errors" tab
- [ ] Scroll down to "My Error Reports"
- [ ] **Expected:** See all your submitted errors with status badges
- [ ] Statuses should match what you set in admin panel

### ✅ 8. Route Redirect

- [ ] Navigate directly to `/errors/manage`
- [ ] **Expected:** Automatic redirect to `/admin/errors/manage`

### ✅ 9. Dropdown Options

- [ ] Go to `/help` → "Errors" tab
- [ ] Click the Page/Feature dropdown
- [ ] **Expected:** Grouped select with:
  - 12 main modules (Timesheets, Inspections, RAMS, etc.)
  - Sub-pages under each (e.g., "List", "New", "View/Edit")
  - "Other" category at bottom with "Something else"

### ✅ 10. Debug Error Alerts (If Super Admin)

**Note:** This requires super admin access (admin@mpdee.co.uk)

- [ ] Open `/debug` page
- [ ] In another tab/browser, trigger an error:
  - Visit a page and intentionally cause an error (e.g., invalid route)
  - Or use browser console: `throw new Error('Test')`
- [ ] Return to `/debug` and wait ~10 seconds for refresh
- [ ] New error should appear in error logs
- [ ] **Expected:** Notification bell shows new notification
- [ ] **Expected:** Email received (if email pref enabled)
- [ ] If you refresh and same error appears, no duplicate notification (dedupe working)

---

## Troubleshooting

### No Notifications Appearing?

1. Check bell icon - is it loading? (spinning)
2. Open browser console - any errors?
3. Check: `GET /api/messages/notifications` - returns 200?
4. Verify you're logged in as admin
5. Try refreshing the page

### No Email Received?

1. Check spam folder
2. Verify `RESEND_API_KEY` is set in `.env.local`
3. Check server logs for email send errors
4. Verify admin account has valid email in database
5. Check preferences: is email notifications ON?

### Submit Button Disabled?

- Verify you've filled in all required fields:
  - Title (required)
  - Description (required)
  - **Page/Feature dropdown (required)** ← Must select an option

### Can't Access `/admin/errors/manage`?

- Verify you're logged in as admin
- Check your role has `is_manager_admin = true` OR `name = 'admin'` OR `is_super_admin = true`

---

## Success Criteria

**All of these should work now:**

- ✅ Bell icon shows notification count
- ✅ Clicking bell opens panel with notifications
- ✅ Submitting error creates notification
- ✅ Submitting error sends email
- ✅ Admin can toggle notifications on/off
- ✅ Dashboard has Error Reports tile
- ✅ Error reports show in admin management page
- ✅ Dropdown for page/feature is mandatory
- ✅ Debug page auto-alerts on new errors

---

## If Everything Works...

**You should see:**
1. Notification bell with count (when messages exist)
2. Notifications panel with actual messages
3. Error reports creating instant notifications
4. Emails arriving in inbox
5. Preferences toggles working as expected
6. New dashboard tile visible

**This means:**
- 🎉 The broken notification system is FIXED
- 🎉 Error reporting is fully functional
- 🎉 Admin controls are working
- 🎉 All features integrated and tested

---

## Next Steps After Testing

If all tests pass:
1. Test with a non-admin user account
   - Verify they can submit errors
   - Verify they see "My Errors" list
   - Verify they DON'T see admin management links
2. Test with multiple admin accounts
   - Verify all super-admins receive notifications
   - Verify preferences work independently per admin
3. Monitor production after deployment
   - Check error_reports table for submissions
   - Check error_log_alerts for debug notifications
   - Verify email delivery rates

---

**Status:** All implementation complete. Ready for user testing.
