# Testing Checklist: Vehicle Maintenance & Service Module
**Date:** December 18, 2025  
**Branch:** `feature/vehicle-maintenance-service`  
**Status:** Ready for Testing  
**Module:** Vehicle Maintenance & Service (`/maintenance`)

---

## ✅ Pre-Test Setup

Before testing, verify:
- [ ] Database migration ran successfully (`npx tsx scripts/migrations/run-vehicle-maintenance-migration.ts`)
- [ ] Excel data imported (51 vehicles: `npx tsx scripts/migrations/import-maintenance-spreadsheet.ts`)
- [ ] Dev server running (`npm run dev`)
- [ ] No lint errors in maintenance components
- [ ] Test accounts with different roles (Admin, Manager, Employee)
- [ ] Browser console open for error monitoring

**Database Verification:**
```sql
-- Should return 4 tables
SELECT table_name FROM information_schema.tables 
WHERE table_name LIKE 'maintenance_%' OR table_name = 'vehicle_archive';

-- Should return 5 default categories
SELECT * FROM maintenance_categories ORDER BY sort_order;

-- Should return 51 vehicles with maintenance data
SELECT COUNT(*) FROM vehicle_maintenance;
```

---

## 🧪 Manual Test Suite

### **Test 1: Access Control & RBAC**

**Test 1a: Admin Access**  
**As:** Admin User  
**Steps:**
1. Login with admin credentials
2. Navigate to Dashboard
3. Should see "Maintenance & Service" tile (red Wrench icon)
4. Click on tile → Navigate to `/maintenance`
5. Check Settings tab is enabled

**Expected Results:**
- [ ] Dashboard tile visible and clickable
- [ ] `/maintenance` page loads successfully
- [ ] No "Access Denied" error
- [ ] Settings tab is **enabled** (not grayed out)
- [ ] Can click Settings tab
- [ ] Can see category management table

---

**Test 1b: Manager Access**  
**As:** Manager User  
**Steps:**
1. Login with manager credentials
2. Navigate to `/maintenance`
3. Check Settings tab availability

**Expected Results:**
- [ ] Can access maintenance page
- [ ] Settings tab is **enabled**
- [ ] Can view and edit categories
- [ ] Same permissions as Admin

---

**Test 1c: Employee Without Permission**  
**As:** Employee (no maintenance permission)  
**Steps:**
1. Login as employee
2. Navigate to `/maintenance`

**Expected Results:**
- [ ] Should see "Access Denied" card
- [ ] Message: "You do not have permission to access vehicle maintenance & service"
- [ ] Cannot view maintenance data
- [ ] Cannot access Settings

---

**Test 1d: Employee With Permission**  
**As:** Employee (granted maintenance permission via role)  
**Setup:** Admin grants "Maintenance & Service" permission to employee role  
**Steps:**
1. Go to `/admin/users` → Roles tab
2. Edit employee role, enable "Maintenance & Service"
3. Logout and login as that employee
4. Navigate to `/maintenance`

**Expected Results:**
- [ ] Can access maintenance page
- [ ] Can view all vehicle data
- [ ] Can edit maintenance records
- [ ] Settings tab is **disabled** (grayed out)
- [ ] Cannot add/edit/delete categories

---

### **Test 2: Dashboard Integration**

**Test 2a: Dashboard Tile**  
**As:** Admin  
**Steps:**
1. Navigate to `/dashboard`
2. Locate "Maintenance & Service" tile

**Expected Results:**
- [ ] Tile appears in active forms section (not placeholders)
- [ ] Red background color (bg-maintenance)
- [ ] Wrench icon visible
- [ ] Title: "Maintenance & Service"
- [ ] Description: "Vehicle maintenance tracking"
- [ ] Clicking opens `/maintenance` page

---

**Test 2b: Vehicles Page Link**  
**As:** Admin  
**Steps:**
1. Navigate to `/admin/vehicles`
2. Look for tab navigation

**Expected Results:**
- [ ] Tab labeled "Maintenance & Service" (not "Maintenance Log (Demo)")
- [ ] Links to `/maintenance` (not `/admin/maintenance-demo`)
- [ ] Clicking tab navigates correctly
- [ ] Old demo page no longer exists (404 if accessed)

---

### **Test 3: Main Table View**

**Test 3a: Table Display**  
**As:** Admin  
**Steps:**
1. Navigate to `/maintenance`
2. Observe main table

**Expected Results:**
- [ ] Shows 51 vehicles (or actual count from import)
- [ ] Columns displayed: Registration, Mileage, Tax Due, MOT Due, Service Due, Cambelt Due, First Aid, Actions
- [ ] All columns sortable (up/down arrows on hover)
- [ ] Current mileage shows formatted numbers (e.g., "45,000")
- [ ] Maintenance dates show color-coded badges

---

**Test 3b: Color Coding**  
**Steps:**
1. Observe badge colors for different vehicles
2. Check legend understanding

**Expected Results:**
- [ ] **Red badge** = Overdue (past due date/mileage)
- [ ] **Amber badge** = Due Soon (within threshold)
- [ ] **Green badge** = OK (plenty of time)
- [ ] **Gray badge** = Not Set (no date entered)
- [ ] Colors match across all maintenance types

---

**Test 3c: Sorting**  
**Steps:**
1. Click "Registration" header → Sort A-Z
2. Click again → Sort Z-A
3. Click "Current Mileage" → Sort low to high
4. Click again → Sort high to low
5. Click "Tax Due" → Sort by date (earliest first)
6. Click again → Sort by date (latest first)

**Expected Results:**
- [ ] Registration sorts alphabetically (both directions)
- [ ] Mileage sorts numerically (both directions)
- [ ] Date columns sort chronologically (both directions)
- [ ] Mileage columns sort numerically (both directions)
- [ ] "Not Set" values appear last (or first depending on direction)
- [ ] No page refresh, instant sorting

---

**Test 3d: Search**  
**Steps:**
1. Type "Y207" in search box
2. Should filter to vehicles starting with Y207
3. Clear search → Should show all vehicles
4. Type "GAU" → Should show matching registrations

**Expected Results:**
- [ ] Real-time filtering as you type
- [ ] Case-insensitive search
- [ ] Shows matching vehicles only
- [ ] "No vehicles found" if no matches
- [ ] Clear search restores full list

---

### **Test 4: Alert Overview Panels**

**Test 4a: Overdue Tasks Panel**  
**Setup:** Ensure at least one vehicle has overdue maintenance  
**Steps:**
1. Navigate to `/maintenance`
2. Check top of page for red alert panel

**Expected Results:**
- [ ] Red panel with AlertTriangle icon visible
- [ ] Title: "Overdue Tasks"
- [ ] Count: "X task(s) requiring immediate attention"
- [ ] Lists each overdue item:
  - [ ] Vehicle registration
  - [ ] Maintenance type (Tax, MOT, Service, etc.)
  - [ ] Days/miles overdue (e.g., "5 days overdue", "500 miles overdue")
- [ ] Scrollable if many items
- [ ] Each item shows AlertCircle icon

---

**Test 4b: Due Soon Panel**  
**Setup:** Ensure vehicles have maintenance due soon  
**Steps:**
1. Check for amber alert panel

**Expected Results:**
- [ ] Amber panel with Calendar icon visible
- [ ] Title: "Due Soon"
- [ ] Count: "X task(s) coming up"
- [ ] Lists each due soon item:
  - [ ] Vehicle registration
  - [ ] Maintenance type
  - [ ] Days/miles until due (e.g., "Due in 15 days", "800 miles remaining")
- [ ] Wrench icon for each item

---

**Test 4c: All Caught Up**  
**Setup:** Ensure no overdue or due soon items (update all maintenance)  
**Steps:**
1. Update all vehicles so nothing is overdue/due soon
2. Refresh page

**Expected Results:**
- [ ] Green panel appears instead
- [ ] Wrench icon in green background
- [ ] Title: "All Caught Up!"
- [ ] Message: "No maintenance items are overdue or due soon. X vehicle(s) being monitored."
- [ ] No red or amber panels visible

---

**Test 4d: Missing Data Warning**  
**Setup:** Ensure some vehicles have missing maintenance dates  
**Steps:**
1. Check for warning banner above table

**Expected Results:**
- [ ] Amber warning banner visible
- [ ] AlertTriangle icon
- [ ] Title: "Missing Maintenance Dates"
- [ ] Message: "X vehicle(s) have incomplete maintenance records..."
- [ ] Professional wording about monitoring gaps
- [ ] Banner disappears when all data complete

---

### **Test 5: Edit Maintenance Dialog**

**Test 5a: Open Edit Dialog**  
**Steps:**
1. Click Edit (pencil icon) on any vehicle
2. Dialog should open

**Expected Results:**
- [ ] Dialog opens with dark theme (slate-900 background)
- [ ] Title: "Edit Maintenance - [REG NUMBER]"
- [ ] Description mentions mandatory comment
- [ ] Current mileage displayed (read-only, formatted)
- [ ] Last mileage update timestamp shown
- [ ] All maintenance fields present

---

**Test 5b: Date-Based Maintenance Fields**  
**Steps:**
1. Observe date fields section
2. Check for Tax Due, MOT Due, First Aid Expiry

**Expected Results:**
- [ ] Section header: "Date-Based Maintenance"
- [ ] 3 date inputs: Tax Due Date, MOT Due Date, First Aid Kit Expiry
- [ ] All are `type="date"` HTML5 date pickers
- [ ] Pre-filled with current values (if any)
- [ ] Can clear dates (set to null)

---

**Test 5c: Mileage-Based Maintenance Fields**  
**Steps:**
1. Observe mileage fields section
2. Check for Service and Cambelt

**Expected Results:**
- [ ] Section header: "Mileage-Based Maintenance"
- [ ] Next Service (Miles) - number input
- [ ] Last Service (Miles) - number input
- [ ] Cambelt Due (Miles) - number input
- [ ] Cambelt Done checkbox (reference only)
- [ ] All pre-filled with current values

---

**Test 5d: Mandatory Comment Validation**  
**Steps:**
1. Change a date (e.g., Tax Due Date)
2. Try to save without comment
3. Enter < 10 characters in comment
4. Enter >= 10 characters

**Expected Results:**
- [ ] Save button **disabled** initially
- [ ] Entering < 10 chars keeps button disabled
- [ ] Character counter shows: "X / 500" (red if < 10)
- [ ] Error message: "Comment must be at least 10 characters"
- [ ] Entering >= 10 chars enables save button
- [ ] Character counter turns green
- [ ] Cannot bypass validation

---

**Test 5e: Save Changes**  
**Steps:**
1. Change Tax Due Date to next month
2. Enter comment: "Tax renewed on [date]. Cost: £200"
3. Click "Save Changes"

**Expected Results:**
- [ ] Save button shows loading spinner
- [ ] Button text: "Saving..."
- [ ] Success toast appears (Sonner)
- [ ] Toast: "Maintenance updated successfully"
- [ ] Dialog closes automatically
- [ ] Table updates with new date
- [ ] Badge color updates if status changed
- [ ] No page refresh needed

---

**Test 5f: Cancel Without Saving**  
**Steps:**
1. Open edit dialog
2. Change several fields
3. Click "Cancel"

**Expected Results:**
- [ ] Dialog closes
- [ ] No changes saved to database
- [ ] Table shows original values
- [ ] No confirmation prompt (expected behavior)

---

**Test 5g: Form Validation - Invalid Mileage**  
**Steps:**
1. Open edit dialog
2. Enter negative mileage (e.g., -100)
3. Try to save

**Expected Results:**
- [ ] Validation error appears
- [ ] Message: "Must be positive"
- [ ] Cannot save
- [ ] Error shown inline under field

---

**Test 5h: Update Multiple Fields**  
**Steps:**
1. Open edit dialog
2. Update: Tax Due Date, MOT Due Date, and Next Service Mileage
3. Enter comment: "Full service completed. Tax and MOT renewed."
4. Save

**Expected Results:**
- [ ] All 3 fields update successfully
- [ ] Single history entry with comment
- [ ] All 3 changes tracked in history
- [ ] Can view in history dialog later

---

### **Test 6: Maintenance History (Audit Trail)**

**Test 6a: Open History Dialog**  
**Steps:**
1. Click History (clock icon) on any vehicle with changes
2. Dialog should open

**Expected Results:**
- [ ] Dialog opens with title: "Maintenance History - [REG]"
- [ ] Description: "Complete audit trail of all maintenance changes"
- [ ] Shows changes grouped by date
- [ ] Most recent changes at top

---

**Test 6b: History Entry Details**  
**Steps:**
1. Observe a single history entry

**Expected Results:**
- [ ] Date header with calendar icon (e.g., "Wednesday, 18 December 2025")
- [ ] Entry card shows:
  - [ ] User icon + name of who made change
  - [ ] Timestamp (HH:MM format)
  - [ ] Field badge (e.g., "Tax Due Date")
  - [ ] Type badge (e.g., "date", "mileage")
  - [ ] Old Value → New Value display
  - [ ] Values formatted correctly (dates, mileage with commas)
  - [ ] Comment in separate box at bottom
- [ ] Clean, readable layout

---

**Test 6c: Empty History**  
**Setup:** Find vehicle with no maintenance changes  
**Steps:**
1. Click History on that vehicle

**Expected Results:**
- [ ] Empty state shown
- [ ] History icon (faded)
- [ ] Message: "No maintenance history yet"
- [ ] Sub-message: "Changes will appear here when maintenance records are updated"

---

**Test 6d: Import History**  
**Steps:**
1. Find vehicle that was imported from Excel
2. Check history

**Expected Results:**
- [ ] Should see "Excel Import" entry
- [ ] Field: "all_fields" or similar
- [ ] Comment: "Initial data import from ALL VANS.xlsx"
- [ ] Shows import date/time
- [ ] User: System or Import User

---

**Test 6e: Multiple Changes Same Day**  
**Setup:** Edit same vehicle twice in one day  
**Steps:**
1. Update Tax Due Date (save with comment)
2. Update MOT Due Date (save with different comment)
3. View history

**Expected Results:**
- [ ] Both entries grouped under same date
- [ ] Both visible in chronological order (time shown)
- [ ] Each has its own comment
- [ ] Each shows different field changed

---

### **Test 7: Settings Tab (Admin/Manager Only)**

**Test 7a: Access Settings**  
**As:** Admin  
**Steps:**
1. Navigate to `/maintenance`
2. Click "Settings" tab

**Expected Results:**
- [ ] Tab switches to Settings view
- [ ] URL updates to `/maintenance?tab=settings` (or similar)
- [ ] Shows "Maintenance Categories" card
- [ ] Description: "Configure maintenance types and alert thresholds"
- [ ] "Add Category" button visible and enabled

---

**Test 7b: View Categories Table**  
**Steps:**
1. Observe categories table

**Expected Results:**
- [ ] Shows all 5 default categories (Tax, MOT, Service, Cambelt, First Aid)
- [ ] Columns: Name, Type, Alert Threshold, Status, Description, Actions
- [ ] Type badges: "date" or "mileage" (capitalized)
- [ ] Threshold formatted: "30 days" or "1,000 miles"
- [ ] Status badges: "Active" (green) or "Inactive"
- [ ] Edit and Delete buttons per row (not disabled)

---

**Test 7c: Settings as Employee**  
**As:** Employee with maintenance permission  
**Steps:**
1. Navigate to `/maintenance`
2. Try to click Settings tab

**Expected Results:**
- [ ] Settings tab is **disabled** (grayed out)
- [ ] Shows "(Admin Only)" in tab label
- [ ] Clicking does nothing
- [ ] Cannot access settings via URL manipulation
- [ ] If URL accessed directly, shows Access Denied

---

**Test 7d: Add New Category Dialog**  
**Steps:**
1. Click "Add Category" button
2. Dialog should open

**Expected Results:**
- [ ] Dialog title: "Add New Category"
- [ ] Description mentions custom alert threshold
- [ ] Fields visible:
  - [ ] Category Name (required)
  - [ ] Description (optional)
  - [ ] Type radio buttons: Date-based / Mileage-based (required)
  - [ ] Alert Threshold (Days or Miles based on type)
  - [ ] Display Order (optional)
- [ ] All fields empty/default
- [ ] "Add Category" button at bottom

---

**Test 7e: Create Date-Based Category**  
**Steps:**
1. Open Add Category dialog
2. Enter:
   - Name: "Insurance Renewal"
   - Description: "Annual insurance expiry tracking"
   - Type: Date-based
   - Threshold: 45 days
   - Display Order: 10
3. Click "Add Category"

**Expected Results:**
- [ ] Validation passes
- [ ] Button shows "Saving..." with spinner
- [ ] Success toast appears
- [ ] Dialog closes
- [ ] New category appears in table
- [ ] Shows "date" type badge
- [ ] Shows "45 days" threshold
- [ ] Status: "Active" by default

---

**Test 7f: Create Mileage-Based Category**  
**Steps:**
1. Open Add Category dialog
2. Enter:
   - Name: "Brake Service"
   - Type: Mileage-based
   - Threshold: 25000 miles
3. Save

**Expected Results:**
- [ ] Saves successfully
- [ ] Shows "mileage" type badge
- [ ] Shows "25,000 miles" threshold (formatted with comma)
- [ ] Can be used for tracking immediately

---

**Test 7g: Category Name Duplicate Prevention**  
**Steps:**
1. Open Add Category dialog
2. Enter existing name (e.g., "Tax Due Date")
3. Try to save

**Expected Results:**
- [ ] API returns error
- [ ] Error toast appears
- [ ] Message: "Category name already exists" (or similar)
- [ ] Dialog stays open
- [ ] Can fix and retry

---

**Test 7h: Edit Existing Category**  
**Steps:**
1. Click Edit (pencil) on "Service Due" category
2. Dialog opens in edit mode
3. Change threshold from 1000 to 1500 miles
4. Save

**Expected Results:**
- [ ] Dialog title: "Edit Category"
- [ ] Type field is **disabled** (cannot change after creation)
- [ ] Note shown: "Type cannot be changed after creation"
- [ ] Threshold updates to 1500
- [ ] Success toast
- [ ] Table updates immediately
- [ ] Alert calculations use new threshold

---

**Test 7i: Deactivate Category**  
**Steps:**
1. Edit a category
2. Uncheck "Active" checkbox
3. Save

**Expected Results:**
- [ ] Status badge changes to "Inactive" (gray)
- [ ] Category still appears in settings table
- [ ] No longer used for new vehicles (if applicable)
- [ ] Existing maintenance data unaffected

---

**Test 7j: Delete Unused Category**  
**Setup:** Create a test category not used by any vehicle  
**Steps:**
1. Click Delete (trash) button
2. Confirmation dialog appears
3. Review details
4. Click "Delete Category"

**Expected Results:**
- [ ] AlertDialog appears
- [ ] Title: "Delete Category" with warning icon
- [ ] Shows category details (name, type)
- [ ] Warning: "This action cannot be undone"
- [ ] "Cancel" and "Delete Category" buttons
- [ ] Deletes successfully
- [ ] Success toast
- [ ] Removed from table

---

**Test 7k: Prevent Deleting In-Use Category**  
**Steps:**
1. Try to delete "Tax Due Date" (default category with data)
2. Click Delete button
3. Confirm deletion

**Expected Results:**
- [ ] API returns 409 Conflict error
- [ ] Error toast appears
- [ ] Message: "Cannot delete category: X maintenance record(s) reference this category"
- [ ] Shows count of references
- [ ] Category remains in table
- [ ] Data integrity preserved

---

**Test 7l: Info Card Display**  
**Steps:**
1. Observe blue info card below categories table

**Expected Results:**
- [ ] Blue background (blue-50/blue-900)
- [ ] AlertTriangle icon (blue)
- [ ] Title: "About Categories & Thresholds"
- [ ] Explanation text visible and readable
- [ ] Mentions:
  - [ ] Categories define maintenance types
  - [ ] Thresholds determine "Due Soon" alerts
  - [ ] Cannot change type after creation
  - [ ] Changes apply immediately

---

### **Test 8: Auto-Mileage Update Trigger**

**Test 8a: Create Vehicle Inspection**  
**Setup:** Note current mileage of test vehicle  
**Steps:**
1. Navigate to `/inspections/new`
2. Select same test vehicle
3. Enter mileage: Current + 100
4. Complete and submit inspection
5. Navigate back to `/maintenance`
6. Find same vehicle in table

**Expected Results:**
- [ ] Current mileage updated to new value (auto-incremented by 100)
- [ ] Last mileage update timestamp shows recent time
- [ ] Service Due calculations updated (if mileage-based)
- [ ] Cambelt Due calculations updated
- [ ] No manual update needed
- [ ] Happens immediately (no delay)

---

**Test 8b: Lower Mileage Update**  
**Setup:** Note current mileage  
**Steps:**
1. Create inspection with **lower** mileage (e.g., current - 50)
2. Submit inspection
3. Check maintenance page

**Expected Results:**
- [ ] Mileage still updates (per PRD: "ALWAYS update, even if lower")
- [ ] No validation error
- [ ] No warning flag
- [ ] Timestamp updates
- [ ] Audit trail shows change

---

**Test 8c: Mileage History**  
**Steps:**
1. After auto-update, view maintenance history
2. Look for mileage change entry

**Expected Results:**
- [ ] History shows mileage was updated
- [ ] Field: "current_mileage"
- [ ] Old → New values shown
- [ ] Comment: "Auto-updated from vehicle inspection #[ID]" (or similar)
- [ ] User: System or inspection author
- [ ] Clear audit trail of change source

---

### **Test 9: Performance & Loading States**

**Test 9a: Initial Page Load**  
**Steps:**
1. Navigate to `/maintenance` (fresh load)
2. Observe loading behavior

**Expected Results:**
- [ ] Shows loading spinner initially
- [ ] Message: "Loading maintenance records..."
- [ ] No flash of empty content
- [ ] Loads within 2 seconds (typical)
- [ ] No console errors
- [ ] All data renders correctly after load

---

**Test 9b: Data Refresh After Edit**  
**Steps:**
1. Edit a vehicle maintenance
2. Save changes
3. Observe table update

**Expected Results:**
- [ ] Table updates immediately (no manual refresh)
- [ ] React Query invalidates and refetches
- [ ] No full page reload
- [ ] Smooth transition
- [ ] Updated values visible right away

---

**Test 9c: Large Dataset Sorting**  
**Setup:** Ensure 50+ vehicles in system  
**Steps:**
1. Sort by different columns repeatedly
2. Observe performance

**Expected Results:**
- [ ] Sorting is instant (< 100ms)
- [ ] No lag or freezing
- [ ] No loading spinner for sorting
- [ ] Client-side sorting (no API calls)

---

**Test 9d: Search Performance**  
**Steps:**
1. Type quickly in search box
2. Observe filtering speed

**Expected Results:**
- [ ] Real-time filtering (debounced)
- [ ] No lag while typing
- [ ] Results update smoothly
- [ ] No API calls for search (client-side)

---

### **Test 10: Error Handling**

**Test 10a: Network Error**  
**Setup:** Simulate offline mode  
**Steps:**
1. Open DevTools → Network tab
2. Set to "Offline"
3. Try to edit maintenance
4. Save changes

**Expected Results:**
- [ ] Offline banner appears at top
- [ ] API call fails
- [ ] Error toast appears (Sonner)
- [ ] Error message is user-friendly
- [ ] No data lost in form
- [ ] Can retry when online

---

**Test 10b: Validation Error from API**  
**Steps:**
1. Manually craft invalid request (via DevTools or curl)
2. Send malformed data to API

**Expected Results:**
- [ ] API returns 400 Bad Request
- [ ] Error message in response
- [ ] Frontend shows error toast
- [ ] Form does not clear
- [ ] User can correct and retry

---

**Test 10c: Unauthorized Access**  
**Setup:** Logout or invalidate session  
**Steps:**
1. Try to access `/maintenance` while logged out

**Expected Results:**
- [ ] Redirects to login page
- [ ] Or shows 401 error page
- [ ] No data exposed
- [ ] After login, can access page

---

**Test 10d: Missing Vehicle**  
**Steps:**
1. Try to edit maintenance for non-existent vehicle ID
2. Access `/maintenance/edit/[fake-uuid]` (if route exists)

**Expected Results:**
- [ ] 404 error page
- [ ] Or "Maintenance record not found" message
- [ ] No crash or unhandled error
- [ ] Can navigate back safely

---

### **Test 11: Mobile Responsiveness**

**Test 11a: Mobile View (< 640px)**  
**Steps:**
1. Open DevTools → Device Toolbar
2. Select iPhone 12 Pro (390px width)
3. Navigate to `/maintenance`

**Expected Results:**
- [ ] Page is readable (no text cutoff)
- [ ] Table scrolls horizontally
- [ ] Buttons are tappable (not too small)
- [ ] Alert panels stack vertically
- [ ] Edit dialog fits screen
- [ ] No horizontal scroll on main page (only table)

---

**Test 11b: Tablet View (640-1024px)**  
**Steps:**
1. Set viewport to iPad (768px width)

**Expected Results:**
- [ ] Table fits better (less horizontal scroll)
- [ ] Alert panels may show side-by-side (2 columns)
- [ ] Edit dialog uses full width
- [ ] Touch interactions work
- [ ] No layout breaks

---

**Test 11c: Touch Interactions**  
**Setup:** Use touch simulation or real device  
**Steps:**
1. Tap Edit button
2. Tap date picker
3. Tap Save button

**Expected Results:**
- [ ] All buttons respond to touch
- [ ] No double-tap needed
- [ ] Native date picker opens (iOS/Android)
- [ ] Dialogs scroll if content exceeds screen
- [ ] No accidental clicks

---

### **Test 12: Edge Cases & Data Quality**

**Test 12a: Vehicle with No Maintenance Data**  
**Setup:** Insert vehicle in DB without maintenance record  
**Steps:**
1. Navigate to `/maintenance`
2. Search for that vehicle

**Expected Results:**
- [ ] Shows in table (if has vehicle record)
- [ ] All maintenance fields show "Not Set" (gray)
- [ ] Can edit to add data
- [ ] No crashes or errors

---

**Test 12b: All Fields Null**  
**Steps:**
1. Edit vehicle with all null maintenance fields
2. Try to save without changing anything

**Expected Results:**
- [ ] Comment still required
- [ ] Can save with comment "No changes, just adding note"
- [ ] History entry created with comment
- [ ] No field changes recorded
- [ ] Message: "No changes detected, but comment saved to history"

---

**Test 12c: Very Long Comment**  
**Steps:**
1. Enter 500+ character comment
2. Try to save

**Expected Results:**
- [ ] Validation error at 500 chars
- [ ] Cannot exceed limit
- [ ] Error: "Comment must be less than 500 characters"
- [ ] Character counter shows: "501 / 500" (red)

---

**Test 12d: Special Characters in Comment**  
**Steps:**
1. Enter comment with emojis, quotes, apostrophes
2. Example: "MOT passed ✅ - technician said 'excellent' condition \"like new\""
3. Save

**Expected Results:**
- [ ] Saves successfully
- [ ] Special characters preserved
- [ ] Displays correctly in history
- [ ] No escaping issues
- [ ] No SQL injection (should be parameterized)

---

**Test 12e: Future Dates**  
**Steps:**
1. Set Tax Due Date to 2030
2. Save

**Expected Results:**
- [ ] Accepts future dates
- [ ] Shows as "OK" status (far in future)
- [ ] No warning (expected behavior)
- [ ] Calculations work correctly

---

**Test 12f: Past Dates**  
**Steps:**
1. Set MOT Due Date to 1 month ago
2. Save

**Expected Results:**
- [ ] Accepts past dates
- [ ] Shows as "Overdue" status (red badge)
- [ ] Days overdue calculated correctly
- [ ] Appears in Overdue panel

---

### **Test 13: Concurrent Edits**

**Test 13a: Two Users Edit Same Vehicle**  
**Setup:** Open two browser tabs, login as different users  
**Steps:**
1. Tab 1: User A edits vehicle, changes Tax Due Date
2. Tab 2: User B edits same vehicle, changes MOT Due Date
3. User A saves first
4. User B saves second

**Expected Results:**
- [ ] Both saves succeed
- [ ] No data loss
- [ ] History shows both changes
- [ ] Both users attributed correctly
- [ ] No conflict error (last write wins)

---

**Test 13b: Edit During Auto-Mileage Update**  
**Steps:**
1. Start editing vehicle maintenance
2. While dialog open, submit inspection for same vehicle
3. Mileage auto-updates in background
4. Save maintenance edit

**Expected Results:**
- [ ] Manual edit saves
- [ ] Mileage update also persists
- [ ] History shows both events
- [ ] No race condition
- [ ] No data corruption

---

### **Test 14: React Query Caching**

**Test 14a: Navigation Away and Back**  
**Steps:**
1. Load `/maintenance` page
2. Navigate to `/dashboard`
3. Navigate back to `/maintenance`

**Expected Results:**
- [ ] Shows cached data immediately (instant)
- [ ] Then refetches in background (if stale)
- [ ] No loading spinner (cached data shown)
- [ ] Smooth user experience

---

**Test 14b: Category Change Affects Main Table**  
**Steps:**
1. Go to Settings tab
2. Change "Service Due" threshold from 1000 to 2000 miles
3. Save
4. Go back to Maintenance tab

**Expected Results:**
- [ ] React Query invalidates maintenance cache
- [ ] Main table refetches
- [ ] New calculations apply immediately
- [ ] Some vehicles may change status (due soon ↔ ok)
- [ ] Badge colors update

---

## 🤖 Automated Test Suite (Unit & Integration)

### **Unit Tests: Calculation Functions**

**File:** `lib/utils/maintenanceCalculations.test.ts`

```typescript
describe('getDaysUntilDue', () => {
  it('returns positive days for future date', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    expect(getDaysUntilDue(futureDate.toISOString())).toBe(10);
  });

  it('returns negative days for past date', () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5);
    expect(getDaysUntilDue(pastDate.toISOString())).toBe(-5);
  });

  it('returns 0 for today', () => {
    const today = new Date().toISOString().split('T')[0];
    expect(getDaysUntilDue(today)).toBe(0);
  });

  it('returns null for null date', () => {
    expect(getDaysUntilDue(null)).toBe(null);
  });
});

describe('getDateBasedStatus', () => {
  it('returns overdue for past date', () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    const result = getDateBasedStatus(pastDate.toISOString(), 30);
    expect(result.status).toBe('overdue');
  });

  it('returns due_soon within threshold', () => {
    const soonDate = new Date();
    soonDate.setDate(soonDate.getDate() + 15);
    const result = getDateBasedStatus(soonDate.toISOString(), 30);
    expect(result.status).toBe('due_soon');
  });

  it('returns ok outside threshold', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 60);
    const result = getDateBasedStatus(futureDate.toISOString(), 30);
    expect(result.status).toBe('ok');
  });

  it('returns not_set for null date', () => {
    const result = getDateBasedStatus(null, 30);
    expect(result.status).toBe('not_set');
  });
});

describe('getMileageBasedStatus', () => {
  it('returns overdue when over due mileage', () => {
    const result = getMileageBasedStatus(50000, 45000, 1000);
    expect(result.status).toBe('overdue');
    expect(result.miles_until).toBe(-5000);
  });

  it('returns due_soon within threshold', () => {
    const result = getMileageBasedStatus(49500, 50000, 1000);
    expect(result.status).toBe('due_soon');
    expect(result.miles_until).toBe(500);
  });

  it('returns ok outside threshold', () => {
    const result = getMileageBasedStatus(40000, 50000, 1000);
    expect(result.status).toBe('ok');
    expect(result.miles_until).toBe(10000);
  });

  it('returns not_set for null mileage', () => {
    const result = getMileageBasedStatus(null, 50000, 1000);
    expect(result.status).toBe('not_set');
  });
});

describe('formatDaysUntil', () => {
  it('formats overdue days', () => {
    expect(formatDaysUntil(-5)).toBe('5 days overdue');
  });

  it('formats due today', () => {
    expect(formatDaysUntil(0)).toBe('Due today');
  });

  it('formats due tomorrow', () => {
    expect(formatDaysUntil(1)).toBe('Due tomorrow');
  });

  it('formats due in X days', () => {
    expect(formatDaysUntil(10)).toBe('Due in 10 days');
  });

  it('returns Not Set for null', () => {
    expect(formatDaysUntil(null)).toBe('Not Set');
  });
});
```

---

### **Integration Tests: API Routes**

**File:** `tests/api/maintenance.test.ts`

```typescript
describe('GET /api/maintenance', () => {
  it('returns 401 without authentication', async () => {
    const response = await fetch('/api/maintenance');
    expect(response.status).toBe(401);
  });

  it('returns maintenance list for authenticated user', async () => {
    const response = await authenticatedFetch('/api/maintenance');
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.vehicles).toBeInstanceOf(Array);
    expect(data.summary).toHaveProperty('total');
    expect(data.summary).toHaveProperty('overdue');
    expect(data.summary).toHaveProperty('due_soon');
  });

  it('calculates status correctly', async () => {
    const response = await authenticatedFetch('/api/maintenance');
    const data = await response.json();
    const vehicle = data.vehicles[0];
    expect(vehicle).toHaveProperty('tax_status');
    expect(vehicle).toHaveProperty('mot_status');
    expect(['overdue', 'due_soon', 'ok', 'not_set']).toContain(vehicle.tax_status.status);
  });
});

describe('PUT /api/maintenance/[id]', () => {
  it('returns 400 without comment', async () => {
    const response = await authenticatedFetch('/api/maintenance/test-id', {
      method: 'PUT',
      body: JSON.stringify({ tax_due_date: '2025-12-31' })
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Comment is required');
  });

  it('returns 400 with short comment', async () => {
    const response = await authenticatedFetch('/api/maintenance/test-id', {
      method: 'PUT',
      body: JSON.stringify({
        tax_due_date: '2025-12-31',
        comment: 'short'
      })
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('at least 10 characters');
  });

  it('updates maintenance with valid comment', async () => {
    const response = await authenticatedFetch('/api/maintenance/valid-id', {
      method: 'PUT',
      body: JSON.stringify({
        tax_due_date: '2025-12-31',
        comment: 'Tax renewed on 18 Dec 2025. Cost: £200'
      })
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.maintenance.tax_due_date).toBe('2025-12-31');
  });

  it('creates history entry for update', async () => {
    // Update maintenance
    await authenticatedFetch('/api/maintenance/valid-id', {
      method: 'PUT',
      body: JSON.stringify({
        mot_due_date: '2026-01-15',
        comment: 'MOT passed with no advisories'
      })
    });

    // Check history
    const historyResponse = await authenticatedFetch('/api/maintenance/history/valid-vehicle-id');
    const historyData = await historyResponse.json();
    expect(historyData.history.length).toBeGreaterThan(0);
    const latestEntry = historyData.history[0];
    expect(latestEntry.comment).toBe('MOT passed with no advisories');
  });
});

describe('POST /api/maintenance/categories', () => {
  it('returns 403 for non-admin user', async () => {
    const response = await employeeFetch('/api/maintenance/categories', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test Category',
        type: 'date',
        alert_threshold_days: 30
      })
    });
    expect(response.status).toBe(403);
  });

  it('creates category for admin user', async () => {
    const response = await adminFetch('/api/maintenance/categories', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Brake Service',
        description: 'Brake pad replacement',
        type: 'mileage',
        alert_threshold_miles: 25000
      })
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.category.name).toBe('Brake Service');
  });

  it('prevents duplicate category names', async () => {
    // Create first
    await adminFetch('/api/maintenance/categories', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Unique Category',
        type: 'date',
        alert_threshold_days: 30
      })
    });

    // Try duplicate
    const response = await adminFetch('/api/maintenance/categories', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Unique Category',
        type: 'mileage',
        alert_threshold_miles: 1000
      })
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe('DELETE /api/maintenance/categories/[id]', () => {
  it('prevents deleting in-use category', async () => {
    // Get a category that's in use (e.g., Tax Due)
    const categoriesResponse = await adminFetch('/api/maintenance/categories');
    const categoriesData = await categoriesResponse.json();
    const taxCategory = categoriesData.categories.find(c => c.name === 'Tax Due Date');

    // Try to delete
    const response = await adminFetch(`/api/maintenance/categories/${taxCategory.id}`, {
      method: 'DELETE'
    });
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.error).toContain('Cannot delete category');
  });
});
```

---

### **E2E Tests: User Flows (Playwright)**

**File:** `tests/e2e/maintenance.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Vehicle Maintenance Module', () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin
    await page.goto('/login');
    await page.fill('[name="email"]', process.env.SUPER_ADMIN_USERNAME);
    await page.fill('[name="password"]', process.env.SUPER_ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
  });

  test('can access maintenance page from dashboard', async ({ page }) => {
    await page.click('a[href="/maintenance"]');
    await expect(page).toHaveURL('/maintenance');
    await expect(page.locator('h1')).toContainText('Vehicle Maintenance');
  });

  test('can edit maintenance and save with comment', async ({ page }) => {
    await page.goto('/maintenance');
    
    // Click first Edit button
    await page.click('button[title="Edit Maintenance"]', { first: true });
    
    // Wait for dialog
    await expect(page.locator('dialog')).toBeVisible();
    
    // Change tax date
    await page.fill('#tax_due_date', '2025-12-31');
    
    // Try to save without comment (should be disabled)
    const saveButton = page.locator('button:has-text("Save Changes")');
    await expect(saveButton).toBeDisabled();
    
    // Add comment
    await page.fill('#comment', 'Tax renewed on 18 Dec 2025');
    
    // Now save should be enabled
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    
    // Should show success toast
    await expect(page.locator('.sonner-toast')).toContainText('successfully');
    
    // Dialog should close
    await expect(page.locator('dialog')).not.toBeVisible();
  });

  test('can view maintenance history', async ({ page }) => {
    await page.goto('/maintenance');
    
    // Click first History button
    await page.click('button[title="View History"]', { first: true });
    
    // Wait for history dialog
    await expect(page.locator('dialog')).toBeVisible();
    await expect(page.locator('h2')).toContainText('Maintenance History');
    
    // Should show at least one entry (from import)
    await expect(page.locator('.history-entry')).toHaveCount({ min: 1 });
  });

  test('admin can access settings tab', async ({ page }) => {
    await page.goto('/maintenance');
    
    // Settings tab should be enabled
    const settingsTab = page.locator('button:has-text("Settings")');
    await expect(settingsTab).toBeEnabled();
    
    // Click it
    await settingsTab.click();
    
    // Should see categories table
    await expect(page.locator('h2')).toContainText('Maintenance Categories');
    await expect(page.locator('table')).toBeVisible();
  });

  test('can add new maintenance category', async ({ page }) => {
    await page.goto('/maintenance');
    await page.click('button:has-text("Settings")');
    
    // Click Add Category
    await page.click('button:has-text("Add Category")');
    
    // Fill form
    await page.fill('#name', 'Tyre Replacement');
    await page.fill('#description', 'Tyre wear tracking');
    await page.click('input[value="mileage"]');
    await page.fill('#alert_threshold_miles', '30000');
    
    // Save
    await page.click('button:has-text("Add Category")');
    
    // Should see success
    await expect(page.locator('.sonner-toast')).toContainText('successfully');
    
    // Should appear in table
    await expect(page.locator('table')).toContainText('Tyre Replacement');
  });
});
```

---

## 📋 Test Execution Checklist

### Manual Testing Progress

- [ ] **Test 1:** Access Control (4 sub-tests)
- [ ] **Test 2:** Dashboard Integration (2 sub-tests)
- [ ] **Test 3:** Main Table View (4 sub-tests)
- [ ] **Test 4:** Alert Panels (4 sub-tests)
- [ ] **Test 5:** Edit Dialog (8 sub-tests)
- [ ] **Test 6:** History Viewer (5 sub-tests)
- [ ] **Test 7:** Settings Tab (12 sub-tests)
- [ ] **Test 8:** Auto-Mileage Trigger (3 sub-tests)
- [ ] **Test 9:** Performance (4 sub-tests)
- [ ] **Test 10:** Error Handling (4 sub-tests)
- [ ] **Test 11:** Mobile Responsive (3 sub-tests)
- [ ] **Test 12:** Edge Cases (6 sub-tests)
- [ ] **Test 13:** Concurrent Edits (2 sub-tests)
- [ ] **Test 14:** React Query (2 sub-tests)

**Total Manual Tests:** 63 sub-tests across 14 categories

### Automated Testing Progress

- [ ] Unit tests for calculation functions (5 test suites)
- [ ] Integration tests for API routes (4 test suites)
- [ ] E2E tests with Playwright (5 flows)

**Total Automated Tests:** 14+ test suites

---

## 🐛 Known Issues Log

| ID | Issue | Severity | Status | Notes |
|----|-------|----------|--------|-------|
| - | - | - | - | - |

---

## ✅ Test Results Summary

**Date Tested:** _[To be filled]_  
**Tester:** _[To be filled]_  
**Branch:** `feature/vehicle-maintenance-service`  
**Build Version:** _[To be filled]_

### Pass/Fail Summary

| Category | Pass | Fail | Skip | Total |
|----------|------|------|------|-------|
| Access Control | - | - | - | 4 |
| Dashboard | - | - | - | 2 |
| Table View | - | - | - | 4 |
| Alerts | - | - | - | 4 |
| Edit Dialog | - | - | - | 8 |
| History | - | - | - | 5 |
| Settings | - | - | - | 12 |
| Auto-Trigger | - | - | - | 3 |
| Performance | - | - | - | 4 |
| Error Handling | - | - | - | 4 |
| Mobile | - | - | - | 3 |
| Edge Cases | - | - | - | 6 |
| Concurrent | - | - | - | 2 |
| Caching | - | - | - | 2 |
| **TOTAL** | **-** | **-** | **-** | **63** |

---

## 📝 Notes

- All tests assume database migration has been run successfully
- Tests should be run in order for best results (dependencies)
- Some tests require manual setup (e.g., creating test data)
- Automated tests can run in parallel
- Browser testing requires Chrome/Firefox with DevTools

---

## 🚀 Ready for UAT

Once all tests pass:
- [ ] Document any bugs found in Known Issues
- [ ] Fix critical/high severity bugs
- [ ] Re-test fixed bugs
- [ ] Get sign-off from product owner
- [ ] Merge to main branch
- [ ] Deploy to production

---

**Last Updated:** December 18, 2025  
**Next Review:** After bug fixes
