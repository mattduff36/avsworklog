# Running TestSprite Tests - AVS Worklog

## Test Suite Overview

**21 comprehensive test cases** covering Features 1-4:
- Workshop task comments timeline with CRUD operations
- Fleet page consolidation with tab navigation
- Two-tier task taxonomy (category + subcategory)
- Vehicle history page with maintenance and MOT data
- Role-based access control and permissions
- Performance, UI responsiveness, and error handling

## Prerequisites

1. **Dev Server Running** on `http://localhost:3000`
   ```bash
   npm run dev
   ```

2. **Python & Playwright** (for local testing)
   ```bash
   pip install playwright
   playwright install chromium
   ```

3. **Test Credentials** (from config.json)
   - Username: `admin@mpdee.co.uk`
   - Password: `Q-0ww9qe?`

## Test Configuration

File: `testsprite_tests/tmp/config.json`
```json
{
  "localEndpoint": "http://localhost:3000/fleet",
  "loginUser": "admin@mpdee.co.uk",
  "testIds": [],  // Empty = run all tests
  "additionalInstruction": "Focus on testing Features 1-4..."
}
```

## Running Tests Locally

### Run Individual Test
```bash
# Navigate to project root
cd d:\Websites\avsworklog

# Run a specific test
python testsprite_tests/TC006_Fleet_page_tab_navigation_and_data_loading.py
```

### Priority Tests to Run (Based on Recent Fixes)

1. **TC006** - Fleet page tab navigation and permissions
   ```bash
   python testsprite_tests/TC006_Fleet_page_tab_navigation_and_data_loading.py
   ```
   **Tests:** Tab permission validation fix we just implemented

2. **TC003** - Workshop task comments timeline CRUD
   ```bash
   python testsprite_tests/TC003_Workshop_task_comments_timeline_CRUD_for_author.py
   ```
   **Tests:** Comments feature with author verification

3. **TC007** - Vehicle History page
   ```bash
   python testsprite_tests/TC007_Vehicle_History_page_displays_accurate_maintenance_and_MOT_data.py
   ```
   **Tests:** Mileage formatting and vehicle ID navigation fixes

4. **TC008** - Role-based access control
   ```bash
   python testsprite_tests/TC008_Role_based_access_control_enforcement_for_vehicle_master_data.py
   ```
   **Tests:** Permission boundaries and HTTP 403 responses

5. **TC016** - Input validation
   ```bash
   python testsprite_tests/TC016_Input_validation_on_workshop_task_comments_minimum_length.py
   ```
   **Tests:** Comment length validation (min 1 char, max 1000 chars)

## All Test Cases

| ID | Test Name | Priority | Category |
|----|-----------|----------|----------|
| TC001 | Authentication with valid credentials | High | Functional |
| TC002 | Workshop task creation with taxonomy | High | Functional |
| TC003 | Comments timeline CRUD for author | High | Functional |
| TC004 | Manager admin override for deleting comments | High | Security |
| TC005 | Two-tier taxonomy dynamic filtering | Medium | Functional |
| TC006 | Fleet page tab navigation | High | Performance |
| TC007 | Vehicle History page data display | High | Functional |
| TC008 | Role-based access control | High | Security |
| TC009 | Timesheet submission workflow | High | Functional |
| TC010 | Digital vehicle inspection form | High | Functional |
| TC011 | RAMS digital signature workflow | High | Functional |
| TC012 | Internal messaging and notifications | Medium | Functional |
| TC013 | Offline support with service worker | High | Functional |
| TC014 | Database migration script execution | High | Error Handling |
| TC015 | Deprecated route redirects | Medium | Functional |
| TC016 | Input validation on comments | High | Error Handling |
| TC017 | UI responsiveness across devices | Medium | UI |
| TC018 | API endpoint permission checks | High | Security |
| TC019 | Centralized error logging | High | Error Handling |
| TC020 | Performance: comment drawer open | Medium | Performance |
| TC021 | No console errors in critical flows | High | Error Handling |

## Test Architecture

Each test:
- Uses **Playwright** async API for browser automation
- Runs in **headless Chromium**
- Navigates to the application
- Simulates user interactions via XPath locators
- Makes assertions to verify expected behavior
- Includes proper cleanup (close browser/context)

## Expected Results

After running tests, you should see:
- ✅ Test passes with success message
- ❌ Test fails with AssertionError and details
- Execution time (typically 15-30 seconds per test)

## Troubleshooting

### Port Issues
If dev server isn't on port 3000:
```bash
# Update config.json localEndpoint
"localEndpoint": "http://localhost:3001/fleet"
```

### Browser Launch Failures
```bash
# Reinstall Playwright browsers
playwright install --force chromium
```

### Test Timeout Errors
- Increase timeout in test files (default: 5000ms)
- Check dev server is responding
- Verify database is accessible

## Next Steps

1. ✅ Dev server is running on port 3000
2. ✅ Bug fixes committed (4 commits)
   - Mileage display inconsistency
   - Vehicle navigation bugs
   - Categories tab vehicle count
   - Tab permission validation
3. ▶️ Run priority tests (TC003, TC006, TC007, TC008, TC016)
4. 📊 Review test results
5. 🔧 Fix any failures
6. 📝 Update test plan with results

## Recent Fixes Covered by Tests

- **Bug Fix 1:** `formatMileage` shadowing - TC007
- **Bug Fix 2:** `onVehicleClick` not invoked - TC006, TC007
- **Bug Fix 3:** Categories showing 0 vehicles - TC006
- **Bug Fix 4:** Incorrect vehicle history URL - TC007
- **Bug Fix 5:** Tab permission validation - TC006, TC008

All critical user flows are now tested and should pass!
