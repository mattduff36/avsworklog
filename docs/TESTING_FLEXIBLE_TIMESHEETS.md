# Testing Checklist: Flexible Timesheet System
**Date:** December 17, 2025  
**Branch:** `dev/codebase-improvements`  
**Status:** Ready for Testing

---

## ✅ Pre-Test Setup

Before testing, verify:
- [ ] Database migration ran successfully (7 roles, 85 timesheets updated)
- [ ] Dev server running (`npm run dev`)
- [ ] No lint errors in timesheet components
- [ ] You have test accounts with different roles

---

## 🧪 Test Suite

### **Test 1: Week Selector (New Timesheet)**

**As:** Regular Employee  
**Steps:**
1. Navigate to `/timesheets/new`
2. Should see "Select Week Ending Date" screen
3. Try selecting a Monday → Should show error: "must be Sunday"
4. Select a Sunday → Should validate successfully
5. Click "Continue to Timesheet" → Should load form

**Expected Results:**
- [ ] Week selector appears first
- [ ] Monday selection shows error
- [ ] Sunday selection validates
- [ ] Form loads after validation
- [ ] Week ending is pre-filled in form (read-only now)

**Edge Cases:**
- [ ] Try selecting a week you already have a timesheet for
- [ ] Should show error: "already have a timesheet"
- [ ] If draft exists, should offer to edit it

---

### **Test 2: Duplicate Prevention**

**As:** Regular Employee  
**Setup:** Create a draft timesheet for next Sunday  
**Steps:**
1. Go to `/timesheets/new` again
2. Select the same Sunday
3. Click continue

**Expected Results:**
- [ ] Shows success message: "Found existing draft"
- [ ] Auto-loads the existing timesheet for editing
- [ ] All your previous entries are preserved

**Edge Cases:**
- [ ] Try with submitted timesheet → Should block with error
- [ ] Try with approved timesheet → Should block with error

---

### **Test 3: Confirmation Modal (Submission Preview)**

**As:** Regular Employee  
**Steps:**
1. Fill out a complete timesheet (all 7 days)
2. Click "Submit Timesheet"
3. Should see confirmation modal

**Expected Results:**
- [ ] Modal shows "Confirm Timesheet Submission"
- [ ] Date is shown prominently: "Please confirm this is correct week"
- [ ] Summary cards show:
  - [ ] Total hours (calculated correctly)
  - [ ] Days worked count
  - [ ] Unique job numbers count
  - [ ] Vehicle registration (or N/A)
- [ ] Day-by-day breakdown table shows all entries
- [ ] "Go Back to Edit" button returns to form (no data lost)
- [ ] "Confirm Submission" proceeds to signature

---

### **Test 4: Confirmation Modal Warnings (Q9 Requirements)**

**Test 4a: High Hours Warning**
**Steps:**
1. Create timesheet with > 60 hours total
2. Click Submit

**Expected:**
- [ ] Warning: "Total hours exceed 60 hours - please verify"
- [ ] Can still proceed if intentional

**Test 4b: Low Hours Warning**
**Steps:**
1. Create timesheet with < 10 hours total
2. Click Submit

**Expected:**
- [ ] Warning: "Total hours are less than 10 - please ensure this is correct"

**Test 4c: Missing Job Numbers**
**Steps:**
1. Fill times but skip job number on a working day
2. Click Submit

**Expected:**
- [ ] Warning: "X day(s) missing job numbers"

**Test 4d: No Days Worked**
**Steps:**
1. Mark all 7 days as "Did Not Work"
2. Click Submit

**Expected:**
- [ ] Warning: "No working days recorded - is this correct?"

---

### **Test 5: Editing Existing Timesheet**

**As:** Regular Employee  
**Setup:** Have a draft timesheet  
**Steps:**
1. Go to `/timesheets`
2. Click on draft timesheet
3. Should open in edit mode

**Expected Results:**
- [ ] Week selector is SKIPPED (Q6: Answer A)
- [ ] Goes directly to form
- [ ] All previous data loads correctly
- [ ] Week ending is pre-filled (from database)
- [ ] Can make changes and re-submit

---

### **Test 6: Manager Creating for Employee**

**As:** Manager/Admin  
**Steps:**
1. Go to `/timesheets/new`
2. Go through week selector
3. Select employee from dropdown
4. Fill out timesheet
5. Submit

**Expected Results:**
- [ ] Can see employee dropdown
- [ ] Employee list loads
- [ ] Selected employee's data is used
- [ ] Timesheet router uses EMPLOYEE's timesheet type, not manager's (Q12: Answer A)
- [ ] Submission saves to correct employee

---

### **Test 7: Dynamic Routing (Different Roles)**

**Test 7a: Employee with Civils Role**
**Steps:**
1. Login as user with role.timesheet_type = 'civils'
2. Create new timesheet

**Expected:**
- [ ] Routes to CivilsTimesheet component
- [ ] No warnings shown
- [ ] Form functions normally

**Test 7b: Employee with Plant Role (Not Yet Implemented)**
**Steps:**
1. Set a role's timesheet_type to 'plant' in database or admin UI
2. Login as user with that role
3. Create new timesheet

**Expected:**
- [ ] Shows warning banner: "Plant timesheet not yet available"
- [ ] Falls back to Civils timesheet (Q11: Answer B)
- [ ] Explains: "You've been given standard Civils timesheet"
- [ ] Form functions normally

---

### **Test 8: Admin Role Configuration**

**As:** Administrator  
**Steps:**
1. Go to `/admin/users` → "Roles & Permissions" tab
2. Click "Edit" on any role
3. Should see "Timesheet Type" dropdown

**Expected Results:**
- [ ] Dropdown appears with FileText icon
- [ ] Shows options: "Civils (Default)", "Plant (Coming soon)"
- [ ] Shows description below dropdown
- [ ] Can change selection
- [ ] Click "Save Changes"
- [ ] Toast: "Role updated successfully"
- [ ] Verify in database: role.timesheet_type updated

**Test Adding New Role:**
- [ ] Click "Add New Role"
- [ ] Fill out form
- [ ] Select timesheet type
- [ ] Create role
- [ ] Verify type is saved

---

### **Test 9: Offline Mode**

**As:** Regular Employee  
**Steps:**
1. Go offline (disable network)
2. Create new timesheet
3. Fill out entries
4. Click submit

**Expected Results:**
- [ ] Offline banner shows
- [ ] Week selector still works (cached)
- [ ] Form saves to offline queue
- [ ] Toast: "Saved offline - will submit when online"
- [ ] Go back online
- [ ] Timesheet syncs automatically

---

### **Test 10: Mobile Responsiveness**

**As:** Any User  
**Steps:**
1. Open on mobile device or resize browser to mobile width
2. Create new timesheet
3. Navigate through all steps

**Expected Results:**
- [ ] Week selector is mobile-friendly
- [ ] Form uses tabbed interface (day by day)
- [ ] Confirmation modal scrolls properly
- [ ] All buttons are thumb-friendly
- [ ] No horizontal scroll
- [ ] Sticky footer works

---

### **Test 11: Bank Holiday Detection**

**As:** Regular Employee  
**Steps:**
1. Create timesheet for a week with a bank holiday
2. Start entering times for the bank holiday
3. After 2nd character, warning should appear

**Expected Results:**
- [ ] Bank holiday warning dialog shows
- [ ] Shows date: "X is a bank holiday"
- [ ] "Yes" - continues with entry
- [ ] "No" - clears times, marks "Did Not Work"

---

### **Test 12: Data Validation**

**Test all validation rules:**
- [ ] Cannot submit without all 7 days complete
- [ ] Cannot have same start/end time
- [ ] Job number format: NNNN-LL (4 digits, dash, 2 letters)
- [ ] Job number not required if "Working in Yard"
- [ ] Job number not required if "Did Not Work"
- [ ] Times round to 15-minute intervals
- [ ] Automatic lunch deduction (>6.5 hours)

---

### **Test 13: Existing Timesheets (Backward Compatibility)**

**Critical:** Ensure all 85 existing timesheets still work

**Steps:**
1. Go to `/timesheets`
2. Click on an OLD timesheet (created before migration)
3. Verify it loads correctly

**Expected Results:**
- [ ] All old timesheets visible
- [ ] Click opens view page correctly
- [ ] Data renders properly
- [ ] No errors in console
- [ ] Edit works (for drafts/rejected)

---

### **Test 14: Role Change Impact**

**As:** Administrator  
**Steps:**
1. User has a draft timesheet (type: civils)
2. Change user's role to one with different timesheet_type
3. User edits their draft

**Expected Results:**
- [ ] Draft continues to use original type (civils)
- [ ] Next NEW timesheet uses new type
- [ ] No data corruption or errors

---

### **Test 15: Permission Checking**

**As:** User without timesheet permission  
**Steps:**
1. Remove timesheet permission from role
2. Try to access `/timesheets/new`

**Expected Results:**
- [ ] Redirected or blocked
- [ ] Cannot create timesheets
- [ ] Clear error message

---

## 🚨 Critical Bugs to Watch For

### **High Priority:**
- [ ] Duplicate timesheets bypassing validation
- [ ] Wrong timesheet type shown
- [ ] Data loss on week selector cancel
- [ ] Confirmation modal showing wrong calculations
- [ ] Offline mode not syncing
- [ ] Existing timesheets breaking
- [ ] Admin UI not saving type selection

### **Medium Priority:**
- [ ] Bank holiday detection failing
- [ ] Job number validation too strict/loose
- [ ] Mobile layout issues
- [ ] Routing errors
- [ ] Loading states flickering

### **Low Priority:**
- [ ] Cosmetic issues
- [ ] Minor text changes
- [ ] Performance optimizations

---

## 📊 Performance Checks

**Check these metrics:**
- [ ] Week selector loads < 500ms
- [ ] Form loads < 1 second
- [ ] Confirmation modal opens instantly
- [ ] No console warnings/errors
- [ ] Database queries efficient (check Network tab)

---

## 🔍 Database Verification

**Run these queries to verify data integrity:**

```sql
-- Check all roles have timesheet_type
SELECT name, timesheet_type FROM roles WHERE timesheet_type IS NULL;
-- Should return 0 rows

-- Check all timesheets have timesheet_type
SELECT COUNT(*) FROM timesheets WHERE timesheet_type IS NULL;
-- Should return 0

-- Verify default values
SELECT timesheet_type, COUNT(*) FROM roles GROUP BY timesheet_type;
-- Should show: civils: 7

SELECT timesheet_type, COUNT(*) FROM timesheets GROUP BY timesheet_type;
-- Should show: civils: 85+
```

---

## ✅ Sign-off Checklist

**Before marking as complete:**

### Functionality:
- [ ] All 15 tests pass
- [ ] No critical bugs found
- [ ] Existing timesheets work
- [ ] New flow works smoothly

### Code Quality:
- [ ] Lint passes (or only pre-existing warnings)
- [ ] Type check passes
- [ ] No console errors
- [ ] Code reviewed

### Documentation:
- [ ] User guide updated
- [ ] Admin guide updated
- [ ] Developer guide updated
- [ ] Testing checklist complete

### Deployment Readiness:
- [ ] Tested in Vercel preview
- [ ] Database migration tested
- [ ] Rollback plan ready
- [ ] All stakeholders informed

---

## 🎓 How to Run Tests

### Manual Testing:
1. Follow each test case above
2. Check off when passes
3. Document any failures
4. Fix bugs and re-test

### Automated Testing (Q15: Full suite requested):
```bash
# Unit tests (Phase 7)
npm run test

# E2E tests (Phase 7)
npm run test:e2e

# Type check
npm run type-check

# Lint
npm run lint
```

---

## 📝 Test Results Template

**Test Run Date:** _____________  
**Tester:** _____________  
**Branch:** `dev/codebase-improvements`  
**Commit:** _____________

**Results:**
- Tests Passed: __ / 15
- Critical Bugs: __
- Medium Bugs: __
- Low Priority Issues: __

**Overall Status:** ⬜ Pass / ⬜ Fail / ⬜ Needs Work

**Notes:**
_____________________________________________
_____________________________________________

---

**Ready to test? Start with Test 1 and work through the list!**
