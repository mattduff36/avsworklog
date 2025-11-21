# Testing Guide: Internal Messaging System

## Prerequisites

Before testing, ensure you have:
- ✅ `.env.local` configured with all required variables
- ✅ Supabase project accessible
- ✅ At least one admin/manager user
- ✅ At least one employee user (any employee-* role)

## Step 1: Run Database Migration

Choose one of these methods:

### Method A: Automated Script (Recommended)
```bash
npx tsx scripts/run-messages-migration.ts
```

### Method B: Manual (if script fails due to SSL)
1. Open Supabase Dashboard → SQL Editor
2. Copy contents of `supabase/create-messages-tables.sql`
3. Paste and click "Run"
4. Verify: Check "Table Editor" for `messages` and `message_recipients` tables

## Step 2: Run Automated Tests

```bash
npx tsx scripts/test-messaging-system.ts
```

**Expected Result:** All 32 tests should pass ✅

If tests fail:
- Check database connection
- Verify migration ran successfully
- Check for schema cache issues (try refreshing Supabase dashboard)

## Step 3: Manual Testing Checklist

### A. Admin/Manager Tests (Send Messages)

#### Test 1: Create Toolbox Talk
- [ ] Log in as admin/manager
- [ ] Navigate to `/toolbox-talks`
- [ ] Click "Create Toolbox Talk" tab
- [ ] Fill in subject and message body
- [ ] Select recipients (try "employee-civils" role)
- [ ] Click "Send Toolbox Talk"
- [ ] Verify success toast appears
- [ ] Check "Reports" tab - message should appear with recipient counts

#### Test 2: Create Reminder
- [ ] Navigate to "Create Reminder" tab
- [ ] Fill in subject and message body
- [ ] Select "All Staff"
- [ ] Click "Send Reminder"
- [ ] Verify success toast appears
- [ ] Check "Reports" tab - reminder should appear

#### Test 3: View Reports
- [ ] Navigate to "Reports" tab
- [ ] Verify both messages appear in the list
- [ ] Click on a message to view details
- [ ] Verify recipient list shows with correct statuses
- [ ] Verify signed/pending counts are accurate
- [ ] Try the search filter
- [ ] Try the type filter (Toolbox Talk vs Reminder)

#### Test 4: Delete Message
- [ ] In Reports, click the trash icon on a message
- [ ] Confirm deletion
- [ ] Verify message disappears from list
- [ ] Verify success toast appears

### B. Employee Tests (Receive Messages)

#### Test 5: Blocking Toolbox Talk Modal
- [ ] Log out and log in as employee user (one who received the Toolbox Talk)
- [ ] Verify blocking modal appears immediately
- [ ] Verify cannot click outside modal to dismiss
- [ ] Verify message content is displayed correctly
- [ ] Try to navigate away - modal should block navigation
- [ ] Sign the message using signature pad
- [ ] Click "Sign and Continue"
- [ ] Verify modal closes and app is accessible

#### Test 6: Multiple Toolbox Talks Queue
- [ ] As admin, send 2 Toolbox Talks to same employee
- [ ] Log in as that employee
- [ ] Verify first Toolbox Talk shows (oldest first)
- [ ] Sign it
- [ ] Verify second Toolbox Talk appears automatically
- [ ] Sign it
- [ ] Verify both are now marked as signed

#### Test 7: Non-Blocking Reminder Modal
- [ ] As employee, wait for Reminder modal to appear (or reload page)
- [ ] Verify modal is non-blocking (can click outside to close if design allows)
- [ ] Verify "Close" button works
- [ ] Verify modal disappears after dismissal
- [ ] Verify can still use app normally

### C. Notification System Tests

#### Test 8: Notification Bell Icon
- [ ] Check navbar for bell icon
- [ ] Verify red badge shows unread count
- [ ] Count should match number of unread messages
- [ ] Badge should update when messages are signed/dismissed

#### Test 9: Notification Panel
- [ ] Click bell icon
- [ ] Verify dropdown panel opens
- [ ] Verify notifications show with:
  - Subject
  - First line of body
  - Sender name
  - Time ago
  - Status badge (Signed/Pending/Acknowledged)
  - Red "!" icon for Toolbox Talks
- [ ] Click "See all notifications" link
- [ ] Verify navigates to `/notifications` page

#### Test 10: Clear All Notifications
- [ ] Open notification panel
- [ ] Click "Clear all"
- [ ] Verify notifications disappear from panel
- [ ] Verify badge count updates
- [ ] Verify notifications still visible in `/notifications` page (but cleared from inbox)

#### Test 11: Notifications Page
- [ ] Navigate to `/notifications`
- [ ] Verify all messages from last 60 days are shown
- [ ] Verify search works (try searching by subject or sender name)
- [ ] Click on a notification
- [ ] Verify appropriate modal opens (Toolbox Talk or Reminder)
- [ ] For already-signed Toolbox Talks, verify signature is preserved

### D. Email Notification Tests

#### Test 12: Toolbox Talk Email (if RESEND_API_KEY configured)
- [ ] Send Toolbox Talk to employee with valid email
- [ ] Check recipient's email inbox
- [ ] Verify email received with:
  - Subject: "New Toolbox Talk: [subject]"
  - Body contains sender name
  - Body does NOT contain full message (GDPR compliance)
  - Link to app is included
  - AVS branding present

#### Test 13: Email Batching (if many recipients)
- [ ] Send Toolbox Talk to "All Staff" (10+ people)
- [ ] Monitor console logs for batching behavior
- [ ] Verify emails are sent in batches of 10
- [ ] Verify 1 second delay between batches
- [ ] Verify all recipients eventually receive email

### E. Priority System Tests

#### Test 14: Password Change Priority
- [ ] As admin, set an employee's `must_change_password` to true
- [ ] Assign a Toolbox Talk to that employee
- [ ] Log in as that employee
- [ ] Verify redirected to `/change-password` (password takes priority)
- [ ] Change password
- [ ] After password change, verify Toolbox Talk modal appears

#### Test 15: Blocking Priority
- [ ] Send Toolbox Talk and Reminder to same employee
- [ ] Log in as that employee
- [ ] Verify Toolbox Talk modal appears first (blocking)
- [ ] Sign Toolbox Talk
- [ ] Verify Reminder modal appears next (non-blocking)
- [ ] Dismiss Reminder
- [ ] Verify app is now fully accessible

### F. Edge Cases & Error Handling

#### Test 16: Deleted User Handling
- [ ] In Reports, view a message with recipients
- [ ] Note a recipient user
- [ ] Delete that user from database (or mark as deleted)
- [ ] Refresh Reports page
- [ ] Verify recipient shows as "Deleted User"
- [ ] Verify no errors occur

#### Test 17: Role-Based Recipient Selection
- [ ] Create Toolbox Talk for "employee-civils" only
- [ ] Verify only civils employees receive it
- [ ] Create Reminder for "All Staff"
- [ ] Verify all users receive it (including admins/managers)

#### Test 18: Soft Delete Behavior
- [ ] Create Toolbox Talk, assign to employee
- [ ] Employee does NOT sign yet
- [ ] As admin, soft-delete the message
- [ ] Log in as employee
- [ ] Verify deleted Toolbox Talk does NOT appear in queue
- [ ] Verify app is accessible without signing

#### Test 19: 60-Day Expiry
- [ ] In Supabase, manually create a message_recipient with `created_at` 61 days ago
- [ ] Log in as that recipient
- [ ] Open notifications panel
- [ ] Verify 61-day-old notification does NOT appear
- [ ] Navigate to `/notifications` page
- [ ] Verify 61-day-old notification does NOT appear

#### Test 20: Offline Behavior (if PWA enabled)
- [ ] Send Toolbox Talk to employee
- [ ] Log in as employee
- [ ] Disconnect from internet
- [ ] Refresh page (if online, blocking modal should still work from cache)
- [ ] Reconnect to internet
- [ ] Verify signature syncs when back online

### G. Mobile Responsiveness Tests

#### Test 21: Mobile - Toolbox Talks Page
- [ ] Open `/toolbox-talks` on mobile (or resize browser to mobile width)
- [ ] Verify tabs display correctly
- [ ] Verify forms are usable
- [ ] Verify recipient checkboxes are tappable
- [ ] Verify reports list is readable

#### Test 22: Mobile - Notification Panel
- [ ] Open notification panel on mobile
- [ ] Verify panel fits screen
- [ ] Verify notifications are readable
- [ ] Verify "Clear all" and "See all" buttons are tappable

#### Test 23: Mobile - Blocking Modal
- [ ] Receive Toolbox Talk on mobile
- [ ] Verify modal fits screen
- [ ] Verify signature pad works on touch screen
- [ ] Verify can scroll to read full message

## Step 4: Build Test

After all tests pass, run a production build test:

```bash
npm run build
```

**Expected Result:** Build completes without errors

Common build errors to check:
- Type errors in new files
- Missing imports
- Unused variables (should be caught by linter)
- Invalid component props

## Step 5: Ready for Push

If all tests pass:
1. ✅ Automated tests: 32/32 passed
2. ✅ Manual tests: All checklist items verified
3. ✅ Build test: No errors
4. ✅ Linter: No errors

**You're ready to push to GitHub!**

```bash
git push origin main
```

---

## Troubleshooting

### Migration Issues
- **Error: "exec_sql function not found"**
  - Use Manual method (Supabase Dashboard SQL Editor)
  
- **Error: "already exists"**
  - Migration already ran partially
  - Run test suite to verify tables exist

### Test Failures
- **"Table not found in schema cache"**
  - Migration didn't run
  - Or Supabase schema cache needs refresh
  - Try refreshing Supabase dashboard

- **"No manager/employee users found"**
  - Create test users in Supabase
  - Ensure roles match: admin, manager, employee-civils, etc.

### Email Issues
- **Emails not sending**
  - Check RESEND_API_KEY in `.env.local`
  - Check RESEND_FROM_EMAIL is valid
  - Check Resend dashboard for errors
  - Verify recipient emails are valid

### UI Issues
- **Modal not blocking**
  - Check MessageBlockingCheck is in layout
  - Check z-index values
  - Check pending messages API returns data

- **Badge not updating**
  - Check notification count API
  - Check 60-second polling interval
  - Check console for errors

---

## Quick Test Command Sequence

```bash
# 1. Run migration
npx tsx scripts/run-messages-migration.ts

# 2. Run automated tests
npx tsx scripts/test-messaging-system.ts

# 3. Run linter
npm run lint

# 4. Run build test
npm run build

# 5. If all pass, push
git push origin main
```

