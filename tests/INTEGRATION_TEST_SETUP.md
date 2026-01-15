# Integration Test Setup Guide

## Prerequisites

Before running the integration tests for Fleet and Workshop Tasks modules, ensure you have the following environment variables in your `.env.local` file:

```bash
# Required for integration tests
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Optional test user credentials
TEST_USER_EMAIL=test@example.com
TEST_USER_PASSWORD=test_password

# Site URL for API testing
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

## Current Status

The integration test suite has been created and is **almost ready to run**:

1. ✅ `NEXT_PUBLIC_SUPABASE_URL` is configured in `.env.local`
2. ✅ `NEXT_PUBLIC_SUPABASE_ANON_KEY` is configured in `.env.local`
3. ❌ **Test user credentials need to be added** - see Step 2 below

## Setup Instructions

### Step 1: Verify Supabase Configuration

Your `.env.local` should already have these (already configured):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

### Step 2: Add Test User Credentials (REQUIRED)

**You MUST add test user credentials to run the integration tests:**

1. **Option A: Use an existing user** (recommended for quick testing)
   - Use your own account credentials
   - Add to `.env.local`:
   ```bash
   TEST_USER_EMAIL=your.email@domain.com
   TEST_USER_PASSWORD=your_password
   ```

2. **Option B: Create a dedicated test user** (recommended for CI/CD)
   - Go to Supabase Auth dashboard
   - Create a new user with email/password
   - Assign appropriate permissions (manager/admin role for full test coverage)
   - Add to `.env.local`:
   ```bash
   TEST_USER_EMAIL=testuser@yourdomain.com
   TEST_USER_PASSWORD=secure_test_password
   ```

**Important**: Some tests require manager/admin permissions. If tests skip with "User not authorized", ensure your test user has the appropriate role.

### Step 3: Run Tests

Once environment is configured:

```bash
# Run all integration tests
npm test tests/integration/fleet-workflows.test.ts tests/integration/workshop-tasks-workflows.test.ts tests/integration/vehicle-history-workflows.test.ts

# Run specific test file
npm test tests/integration/fleet-workflows.test.ts

# Run with verbose output
npm test -- --reporter=verbose

# Run with coverage
npm test -- --coverage
```

## Test Coverage Summary

### ✅ Tests Created

- **Fleet Workflows** (11 test cases)
  - Vehicle fetching and updates
  - Task filtering and querying
  - Vehicle category management

- **Workshop Tasks Workflows** (21 test cases)
  - Task viewing and filtering
  - Complete status change workflows
  - Multi-step completion
  - Category and subcategory CRUD

- **Vehicle History Workflows** (12 test cases)
  - Vehicle data display
  - Maintenance history filtering
  - MOT history
  - Edit vehicle modal operations
  - Task card expansion

**Total: 44 automated integration tests**

## Manual Testing Checklist

Until the integration tests can be run automatically, use this manual checklist:

### Fleet Page (`/fleet`)

#### Vehicles Tab
- [ ] Load page and see list of vehicles
- [ ] Click on vehicle card to expand
- [ ] Edit vehicle information inline
- [ ] Update mileage, tax date, MOT date
- [ ] Click "More Details" button to navigate to vehicle history page
- [ ] Retire vehicle (if no open tasks)
- [ ] Verify error when retiring vehicle with open tasks

#### Maintenance Tab
- [ ] See all overdue tasks section (collapsed by default)
- [ ] Expand overdue tasks section
- [ ] See all due soon tasks section (collapsed by default)
- [ ] Expand due soon tasks section
- [ ] Each task card shows: reg, nickname, task type, days/miles info
- [ ] Expand individual task cards to see full service information
- [ ] Click "More Details" to navigate to vehicle history

#### Categories Tab
- [ ] See Vehicle Categories section (if manager/admin)
- [ ] Add new vehicle category
- [ ] Edit existing vehicle category
- [ ] Delete vehicle category (if not in use)
- [ ] See Maintenance Categories section
- [ ] Add new maintenance category
- [ ] Edit existing maintenance category
- [ ] Delete maintenance category (if not in use)
- [ ] Verify alphabetical sorting

### Workshop Tasks Page (`/workshop-tasks`)

#### Task List
- [ ] See all pending tasks
- [ ] Filter by status (Pending, In Progress, On Hold, Completed)
- [ ] Filter by vehicle
- [ ] Click task card to open modal
- [ ] See On Hold Tasks section (collapsed by default)
- [ ] Expand On Hold Tasks section

#### Task Modal
- [ ] View complete task details
- [ ] See all action buttons based on status
- [ ] Click "Start Task" (pending → in progress)
  - [ ] Comment modal appears
  - [ ] Enter comment and confirm
  - [ ] Task status updates
- [ ] Click "Place On Hold" (in progress → on hold)
  - [ ] Comment modal appears
  - [ ] Enter reason and confirm
  - [ ] Task moves to On Hold section
- [ ] Click "Resume Task" (on hold → in progress)
  - [ ] Comment modal appears
  - [ ] Enter notes and confirm
  - [ ] Task moves back to In Progress
- [ ] Click "Mark Complete" from In Progress
  - [ ] Single completion modal appears
  - [ ] Enter completion notes
  - [ ] Task marked as completed
- [ ] Click "Mark Complete" from Pending or On Hold
  - [ ] Multi-step modal appears
  - [ ] See info banner about two steps
  - [ ] Enter "Step 1" comment (required)
  - [ ] Enter "Step 2: Completion Note" (required)
  - [ ] Both steps execute in sequence
  - [ ] Task marked as completed

#### Settings Tab (Category Management)
- [ ] See two-column layout
- [ ] Left: Category list (alphabetical)
- [ ] Right: Selected category details
- [ ] Click category to select
- [ ] See subcategories for selected category (alphabetical)
- [ ] Add new category
  - [ ] No sort order field (auto-alphabetical)
  - [ ] Category appears in correct alphabetical position
- [ ] Edit category name
  - [ ] Category re-sorts alphabetically
- [ ] Delete category (if not in use)
- [ ] Add new subcategory
  - [ ] No sort order field (auto-alphabetical)
  - [ ] Slug auto-generated from name
  - [ ] Subcategory appears in correct position
- [ ] Edit subcategory
  - [ ] Name update works
  - [ ] Slug auto-updates if needed
  - [ ] Re-sorts alphabetically
- [ ] Delete subcategory (if not in use)
- [ ] Expand subcategory to see slug
- [ ] Verify "Uncategorised" category cannot be deleted
- [ ] Verify "Default" badge shows on Uncategorised
- [ ] Verify Repair category has subcategories: Bodywork, Brakes, Electrical, Engine, Other, Suspension & Steering

### Vehicle History Page (`/fleet/vehicles/[vehicleId]/history`)

#### Page Load
- [ ] Back button visible and functional (no "back" text)
- [ ] Vehicle reg and nickname displayed
- [ ] Service information section visible
- [ ] All service fields displayed (no duplicates in vehicle data section)
- [ ] "Edit Vehicle Record" button present

#### History Tab
- [ ] See all maintenance and workshop history
- [ ] Task cards show icon (not badge) for task type
- [ ] Status badge positioned on right
- [ ] Workshop task main category uses brown color
- [ ] Click anywhere on card to expand
- [ ] Expanded card shows: Notes, Comments, Created by, Status changes
- [ ] Click again to collapse
- [ ] Filter by status works
- [ ] Filter by task type works
- [ ] Filter by category works

#### MOT Tab
- [ ] MOT expiry date displayed
- [ ] MOT history displayed (if available)
- [ ] All MOT-related information visible

#### Notes Tab
- [ ] Tab loads (currently may be empty - documenting future feature)

#### Edit Vehicle Modal
- [ ] Click "Edit Vehicle Record" button
- [ ] Modal opens with all vehicle fields
- [ ] Update mileage
- [ ] Update service dates
- [ ] Update MOT date
- [ ] Update tax date
- [ ] Update category
- [ ] "Retire Vehicle" button on LEFT side
- [ ] "Retire Vehicle" button has RED border
- [ ] "Cancel" and "Save Changes" buttons on RIGHT side
- [ ] Click "Retire Vehicle" opens retire modal
- [ ] Cannot retire if open tasks exist
- [ ] Save changes successfully
- [ ] Modal closes and data refreshes

## Troubleshooting

### Tests Skip with "No test vehicle"
- Ensure you have at least one active vehicle in the maintenance table
- Check that `deleted_at IS NULL` for the vehicle

### Tests Skip with "User not authorized"
- Ensure your test user has manager or admin role
- Check role_permissions table for correct permissions

### Tests Skip with "No categories"
- Ensure workshop_task_categories table has active categories
- Run category setup migration if needed

### "Missing Supabase credentials"
- Verify `.env.local` has both URL and anon key
- Check variable names match exactly: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Next Steps

Once environment is configured:

1. Run integration tests to verify all database operations
2. Use manual testing checklist for UI/UX verification
3. Document any issues found
4. Create additional test cases as needed
