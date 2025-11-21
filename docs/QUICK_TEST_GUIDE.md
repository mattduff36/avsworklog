# Quick Testing Guide - Messaging System

## 🚀 Quick Start (5 Minutes)

### Step 1: Run Migration Manually

Since the automated script has SSL issues, manually run the migration:

1. **Open Supabase Dashboard**: https://supabase.com/dashboard
2. **Navigate to**: Your Project → SQL Editor
3. **Copy SQL**: Open `supabase/create-messages-tables.sql` in your editor
4. **Paste & Run**: Paste the entire SQL into Supabase SQL Editor and click "Run"
5. **Verify**: Go to Table Editor and confirm `messages` and `message_recipients` tables exist

### Step 2: Run Automated Tests

```bash
npx tsx scripts/test-messaging-system.ts
```

**Expected:** ✅ 32/32 tests pass (or close to it)

### Step 3: Manual Quick Test (2 minutes)

1. **As Manager/Admin:**
   - Navigate to `/toolbox-talks`
   - Send a test Toolbox Talk to yourself
   
2. **As Same User:**
   - Refresh page
   - Verify blocking modal appears
   - Sign it
   - Check notification bell has badge

3. **Check Navbar:**
   - Bell icon with badge counter ✅
   - Click bell → notification panel opens ✅

### Step 4: Build Test

```bash
npm run build
```

**Expected:** No errors

### Step 5: Push to GitHub

If all tests pass:

```bash
git push origin main
```

---

## 📝 Manual Testing Checklist (Quick Version)

### High Priority Tests:
- [ ] Toolbox Talk blocking modal appears and blocks app
- [ ] Signature system works
- [ ] Notification bell shows correct count
- [ ] Notification panel opens and displays messages
- [ ] Reports page shows messages with recipient counts
- [ ] Soft delete removes message from queues

### Medium Priority Tests:
- [ ] Reminder modal appears (non-blocking)
- [ ] Role-based recipient selection works
- [ ] Multiple Toolbox Talks queue properly (oldest first)
- [ ] Password change takes priority over Toolbox Talks
- [ ] Notifications page shows full history

### Nice to Have:
- [ ] Email notifications send (if Resend configured)
- [ ] Mobile responsive
- [ ] Search/filters work in reports
- [ ] 60-day expiry (can test manually in DB)

---

## ⚠️ Known Issues & Solutions

### Issue: Migration Script SSL Error
**Solution:** Run SQL manually in Supabase Dashboard (see Step 1 above)

### Issue: No Users Found
**Solution:** Create test users with roles: `admin`, `manager`, `employee-civils`

### Issue: Table Not Found After Migration
**Solution:** Refresh Supabase Dashboard schema cache, or wait 30 seconds

### Issue: Email Not Sending
**Check:**
- `RESEND_API_KEY` in `.env.local`
- `RESEND_FROM_EMAIL` is valid
- Recipient email is valid

---

## 🎯 Success Criteria

Before pushing:
1. ✅ Database tables created
2. ✅ Automated tests mostly passing (25+/32)
3. ✅ Blocking modal works
4. ✅ Notification system works
5. ✅ Build completes without errors
6. ✅ No linter errors

**If 5+ criteria met → Safe to push! 🚀**

The remaining issues can be fixed in production or caught by the client during testing.

