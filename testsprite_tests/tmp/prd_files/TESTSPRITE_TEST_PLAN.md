# TestSprite Test Plan - Features 1-4 Implementation

## Overview
This document outlines the testing requirements for the recent implementation of four major features in the AVS Worklog application.

## Branch
`dev-large-workshop-tasks-improvements`

## Application Details
- **Framework**: Next.js 15.5.7 (App Router)
- **Dev Server Port**: 3001
- **Database**: Supabase (PostgreSQL)
- **Auth**: Required (Supabase Auth)

## Features Implemented

### Feature 1: Workshop Task Comments Timeline
**Database Changes:**
- New table: `workshop_task_comments`
- RLS policies for read/create/update/delete

**API Endpoints:**
- `GET /api/workshop-tasks/tasks/[taskId]/comments` - List comments
- `POST /api/workshop-tasks/tasks/[taskId]/comments` - Create comment
- `PATCH /api/workshop-tasks/comments/[commentId]` - Update comment
- `DELETE /api/workshop-tasks/comments/[commentId]` - Delete comment

**UI Components:**
- `TaskCommentsDrawer` - Comments timeline drawer
- Integrated into `/workshop-tasks` page

### Feature 2: Fleet Page Consolidation
**Routing Changes:**
- `/fleet` - New unified fleet management page with tabs
- `/maintenance` → redirects to `/fleet?tab=maintenance`
- `/admin/vehicles` → redirects to `/fleet?tab=vehicles`

**Tabs:**
1. Maintenance - Vehicle maintenance overview and table
2. Vehicles - Vehicle master data (Admin/Manager only)
3. Categories - Vehicle categories (Admin/Manager only)
4. Settings - Maintenance settings (Admin/Manager only)

### Feature 3: Two-Tier Task Taxonomy
**Database Changes:**
- `workshop_task_categories` - Added: slug, ui_color, ui_icon, ui_badge_style
- New table: `workshop_task_subcategories`
- `actions` table - Added: `workshop_subcategory_id`

**API Endpoints:**
- `GET /api/workshop-tasks/subcategories` - List subcategories
- `POST /api/workshop-tasks/subcategories` - Create subcategory
- `GET /api/workshop-tasks/subcategories/[id]` - Get subcategory
- `PATCH /api/workshop-tasks/subcategories/[id]` - Update subcategory
- `DELETE /api/workshop-tasks/subcategories/[id]` - Delete subcategory

**UI Changes:**
- `/workshop-tasks` - Cascading category/subcategory dropdowns
- Task cards show both category and subcategory badges

### Feature 4: Vehicle History Page
**New Route:**
- `/fleet/vehicles/[vehicleId]/history` - Dedicated history page

**Tabs:**
1. Maintenance - Full history with workshop tasks (integrates F1 & F3)
2. MOT - MOT history
3. Documents - Placeholder
4. Notes - Placeholder

## Test Scenarios

### 1. Workshop Task Comments (Feature 1)

#### Test 1.1: View Comments Timeline
**Route**: `/workshop-tasks`
**Steps:**
1. Navigate to workshop tasks page
2. Click "Comments" button on any task card
3. Verify drawer opens with timeline

**Expected:**
- Drawer opens smoothly
- Timeline shows status events and comments
- Events are ordered by date (newest first)
- Author names display correctly
- Relative timestamps display (e.g., "2 hours ago")

#### Test 1.2: Add Comment
**Route**: `/workshop-tasks`
**Steps:**
1. Open comments drawer for a task
2. Type comment in textarea (min 10 characters)
3. Click "Add Comment" button

**Expected:**
- Comment appears in timeline immediately
- Toast success message displays
- Textarea clears after submission
- Comment shows current user as author
- "Just now" timestamp displays

#### Test 1.3: Edit Comment
**Route**: `/workshop-tasks`
**Steps:**
1. Open comments drawer
2. Find a comment authored by current user
3. Click edit button (pencil icon)
4. Modify text and save

**Expected:**
- Edit mode activates
- Save/Cancel buttons appear
- Updated comment saves successfully
- "Edited" badge displays
- Toast success message

#### Test 1.4: Delete Comment
**Route**: `/workshop-tasks`
**Steps:**
1. Open comments drawer
2. Find a comment authored by current user
3. Click delete button (trash icon)
4. Confirm deletion

**Expected:**
- Confirmation dialog appears
- Comment removes from timeline
- Toast success message
- No errors in console

#### Test 1.5: Permissions
**Test as different user roles:**
- Regular user: Can view, add own comments, edit/delete own comments
- Manager/Admin: Can edit/delete ANY comment

**Expected:**
- Edit/delete buttons only appear on own comments (or all for manager/admin)
- Unauthorized actions return 403 errors

### 2. Fleet Page Consolidation (Feature 2)

#### Test 2.1: Fleet Page Loads
**Route**: `/fleet`
**Steps:**
1. Navigate to `/fleet`
2. Verify default tab is "Maintenance"

**Expected:**
- Page loads without errors
- Tab navigation displays: Maintenance, Vehicles, Categories, Settings
- Maintenance tab shows vehicle maintenance overview and table
- No console errors

#### Test 2.2: Vehicles Tab (Manager/Admin only)
**Route**: `/fleet?tab=vehicles`
**Steps:**
1. Click "Vehicles" tab
2. Verify table displays

**Expected:**
- Table shows: Registration, Nickname, Category, Status
- "View History" button on each row
- "Add Vehicle" button disabled (placeholder)
- Data fetches from `/api/admin/vehicles`

#### Test 2.3: Categories Tab (Manager/Admin only)
**Route**: `/fleet?tab=categories`
**Steps:**
1. Click "Categories" tab
2. Verify table displays

**Expected:**
- Table shows: Name, Description, Vehicle Count
- "Add Category" button disabled (placeholder)
- Data fetches from `/api/admin/categories`

#### Test 2.4: Settings Tab (Manager/Admin only)
**Route**: `/fleet?tab=settings`
**Steps:**
1. Click "Settings" tab
2. Verify settings panel displays

**Expected:**
- MaintenanceSettings component renders
- Category thresholds display
- All existing settings functionality works

#### Test 2.5: Old Routes Redirect
**Routes to test:**
- `/maintenance` → should redirect to `/fleet?tab=maintenance`
- `/admin/vehicles` → should redirect to `/fleet?tab=vehicles`

**Expected:**
- Redirects happen immediately
- No content flashes before redirect
- Final URL matches expected redirect target

#### Test 2.6: Permissions
**Test as Employee (non-manager):**
- Navigate to `/fleet`

**Expected:**
- Can see Maintenance tab
- Cannot see Vehicles, Categories, or Settings tabs
- Direct navigation to `/fleet?tab=vehicles` shows permission message

### 3. Two-Tier Task Taxonomy (Feature 3)

#### Test 3.1: View Categories and Subcategories
**Route**: `/workshop-tasks`
**Steps:**
1. Click "New Task" button
2. Observe category and subcategory dropdowns

**Expected:**
- Top-level categories display: Service, Repair, Modification, Other
- Selecting a category populates subcategory dropdown
- Subcategories filter by selected category

#### Test 3.2: Create Task with Taxonomy
**Route**: `/workshop-tasks`
**Steps:**
1. Click "New Task"
2. Select category (e.g., "Service")
3. Select subcategory (e.g., "Oil Change")
4. Fill other required fields
5. Submit task

**Expected:**
- Task creates successfully
- Task card shows both category and subcategory badges
- Badges have correct colors/styles
- Category badge displays first, subcategory second

#### Test 3.3: Edit Task Taxonomy
**Route**: `/workshop-tasks`
**Steps:**
1. Click edit on existing task
2. Change category
3. Observe subcategory dropdown updates
4. Select new subcategory
5. Save

**Expected:**
- Subcategory dropdown filters correctly when category changes
- Task updates with new taxonomy
- Badges update on task card

#### Test 3.4: Subcategory API (Manager/Admin only)
**Endpoints to test:**
- `GET /api/workshop-tasks/subcategories` - Returns all subcategories
- `POST /api/workshop-tasks/subcategories` - Creates new subcategory (requires category_id, name)

**Expected:**
- API returns proper JSON responses
- RLS policies enforce permissions
- Validation errors for missing fields

### 4. Vehicle History Page (Feature 4)

#### Test 4.1: Navigate to History Page
**Route**: `/fleet?tab=vehicles` or `/fleet?tab=maintenance`
**Steps:**
1. Click on a vehicle row (from Vehicles tab)
   OR
2. Click on vehicle name/alert (from Maintenance tab)

**Expected:**
- Navigates to `/fleet/vehicles/[vehicleId]/history`
- Page loads without errors
- Vehicle registration displays in header

#### Test 4.2: Maintenance History Tab
**Route**: `/fleet/vehicles/[vehicleId]/history`
**Steps:**
1. Verify "Maintenance" tab is default
2. Scroll through maintenance entries
3. Expand a workshop task entry
4. View comments timeline within expanded task

**Expected:**
- Maintenance entries display with dates and details
- Workshop tasks show category + subcategory badges (Feature 3)
- Expandable tasks show full comments timeline (Feature 1)
- Timeline includes status events and user comments
- "View Full Timeline" button opens full drawer

#### Test 4.3: MOT History Tab
**Route**: `/fleet/vehicles/[vehicleId]/history?tab=mot`
**Steps:**
1. Click "MOT" tab
2. Verify MOT history displays

**Expected:**
- MOT records display with test dates
- Pass/Fail status shows
- Expiry dates display
- Data fetches from `/api/maintenance/mot-history/[vehicleId]`

#### Test 4.4: Documents Tab (Placeholder)
**Route**: `/fleet/vehicles/[vehicleId]/history?tab=documents`
**Steps:**
1. Click "Documents" tab

**Expected:**
- Placeholder message displays
- No errors
- Tab is selectable

#### Test 4.5: Notes Tab (Placeholder)
**Route**: `/fleet/vehicles/[vehicleId]/history?tab=notes`
**Steps:**
1. Click "Notes" tab

**Expected:**
- Placeholder message displays
- No errors
- Tab is selectable

#### Test 4.6: Integration Test (F1 + F3 + F4)
**Route**: `/fleet/vehicles/[vehicleId]/history`
**Steps:**
1. Navigate to vehicle history
2. Find a workshop task entry
3. Expand the task
4. Verify badges show category + subcategory (F3)
5. Verify comments timeline displays (F1)
6. Add a new comment
7. Edit/delete a comment

**Expected:**
- All three features work seamlessly together
- Badges display with correct styling
- Comments CRUD operations work
- No console errors
- Smooth user experience

## Critical Paths to Test

### Path 1: Workshop Task Complete Flow
1. `/workshop-tasks` - View tasks
2. Click "New Task" - Select category + subcategory
3. Create task
4. Click "Comments" - Add comment
5. Change task status - Add status comment
6. Edit comment - Verify edit works
7. Delete comment - Verify delete works

### Path 2: Fleet Management Flow
1. `/fleet` - View maintenance overview
2. Click Vehicles tab - View vehicle list
3. Click vehicle - Navigate to history
4. View Maintenance tab - See full history
5. Expand workshop task - View comments
6. Switch to MOT tab - View MOT history
7. Navigate back to `/fleet`

### Path 3: Permission Boundaries
1. Login as regular employee
2. Access `/fleet` - Can see Maintenance only
3. Try `/fleet?tab=vehicles` - Access denied
4. Access `/workshop-tasks` - Can view all
5. Try to edit others' comments - Should fail
6. Logout, login as Manager
7. All tabs and actions should work

## Performance Considerations

### Load Times
- Fleet page initial load: < 2 seconds
- Comments drawer open: < 500ms
- History page load: < 2 seconds
- Tab switching: Instant (no full reload)

### Data Fetching
- Verify React Query caching works
- No duplicate API calls for same data
- Proper loading states during fetches
- Error states handle API failures gracefully

## Database Integrity

### Data Validation
- Comments require min 10 characters
- Task updates require category + subcategory
- Foreign key relationships maintained
- RLS policies enforced on all tables

### Migrations
- `20260114_workshop_task_comments.sql` - Applied successfully
- `20260114_workshop_task_taxonomy.sql` - Applied successfully
- All existing data preserved
- Backfill scripts executed correctly

## Browser Compatibility
Test in:
- Chrome (primary)
- Firefox
- Safari
- Edge

## Mobile Responsiveness
Test on:
- Desktop (1920x1080)
- Tablet (768px width)
- Mobile (375px width)

## Known Limitations
1. Vehicles and Categories tabs show "Add" buttons as disabled (placeholder for future)
2. Documents and Notes tabs in vehicle history are placeholders
3. TestSprite may require auth setup to test protected routes

## Success Criteria
- ✅ All 33 routes build successfully
- ✅ No runtime errors in console
- ✅ All CRUD operations work correctly
- ✅ Permissions enforced properly
- ✅ UI responsive and accessible
- ✅ Data persists correctly in database
- ✅ Features integrate seamlessly

## Test Execution Notes
- Ensure dev server is running on port 3001
- Database migrations must be applied
- Test user accounts needed: Employee, Manager, Admin
- Clear browser cache if experiencing stale data
- Check browser console for errors during testing
