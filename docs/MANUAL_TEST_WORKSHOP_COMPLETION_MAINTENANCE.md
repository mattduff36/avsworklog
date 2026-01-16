# Manual Test Plan: Workshop Task Completion → Maintenance Updates

## Feature Overview
When completing a **Service** workshop task, users can now update the vehicle's **Next Service Due (miles)** field directly from the completion modal. This creates an audit trail in `maintenance_history`.

## Test Scenarios

### Test 1: Service Task Completion with Maintenance Update

**Prerequisites:**
- Have a vehicle in the system (e.g., TE57 VAN)
- Have an active Service workshop task for this vehicle

**Steps:**
1. Navigate to `/workshop-tasks`
2. Find a Service category task with status "In Progress" or "Pending"
3. Click "Mark Complete" button
4. **Verify Modal Shows:**
   - Standard completion comment field
   - **NEW: "Update Vehicle Maintenance" section**
   - **NEW: "Next Service Due (miles)" input field**
5. Fill in:
   - Completion comment: "Oil change and filter replacement completed"
   - Next Service Due: `125000`
6. Click "Mark Complete"
7. **Verify:**
   - Success toast appears
   - Task moves to "Completed" section
8. Navigate to `/fleet` → Maintenance tab
9. Find the test vehicle
10. **Verify:**
    - Service Due status updated (if near mileage threshold, should show due/overdue)
11. Click vehicle → View details → "View Full History"
12. **Verify in Maintenance History:**
    - New entry: `next_service_mileage` changed
    - Comment: "Updated from workshop task completion: [task title]"

### Test 2: Service Task from /fleet?tab=maintenance Page

**Steps:**
1. Navigate to `/fleet?tab=maintenance`
2. Find a vehicle with "Overdue" or "Due Soon" service alert
3. Expand the card
4. If no task exists: create one using "Create Task" button
5. Click "Mark Complete" on the service task
6. **Verify:** Same maintenance update fields appear in modal
7. Enter mileage and complete
8. **Verify:** Vehicle maintenance updated immediately (expand/collapse card to refresh)

### Test 3: Non-Service Task (No Maintenance Fields)

**Steps:**
1. Navigate to `/workshop-tasks`
2. Find or create a task with category "Repair" (or any non-Service category)
3. Click "Mark Complete"
4. **Verify:**
   - Modal shows normal completion fields
   - **NO "Update Vehicle Maintenance" section** (only Service tasks have this)
5. Complete the task normally
6. **Verify:** Task completes without maintenance updates

### Test 4: Pending→Complete (Multi-step with Maintenance Update)

**Steps:**
1. Create a new Service task with status "Pending"
2. Click "Mark Complete" (skipping "In Progress")
3. **Verify Modal Shows:**
   - Step 1: In Progress Note field
   - Step 2: Completion Note field
   - "Update Vehicle Maintenance" section with mileage field
4. Fill all fields and submit
5. **Verify:**
   - Task timeline shows: Created → In Progress → Completed
   - Maintenance updated

### Test 5: Invalid Mileage Validation

**Steps:**
1. Start completing a Service task
2. Try entering invalid mileage:
   - Negative number: `-100`
   - Zero: `0`
   - Decimal: `125000.5`
   - Non-numeric: `abc`
3. **Verify:** Submit button remains disabled or shows validation error

### Test 6: Optional Field (Leave Empty)

**Steps:**
1. Complete a Service task
2. Fill completion comment but **leave mileage field empty**
3. Click "Mark Complete"
4. **Verify:**
   - Task completes successfully
   - No maintenance update occurs (or maintenance record created with null mileage)
   - No errors

## API Endpoint Verification

### Direct API Test

```bash
# Get a vehicle ID and auth token from your session
# Then test the new endpoint:

curl -X POST http://localhost:3000/api/maintenance/by-vehicle/[VEHICLE_ID] \
  -H "Content-Type: application/json" \
  -H "Cookie: [YOUR_SESSION_COOKIE]" \
  -d '{
    "next_service_mileage": 130000,
    "comment": "Testing completion maintenance update feature"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "maintenance": { /* vehicle_maintenance record */ },
  "message": "Maintenance record updated successfully"
}
```

## Database Verification

### Check Service Category Config

```sql
SELECT id, name, completion_updates 
FROM workshop_task_categories 
WHERE name ILIKE '%service%' AND applies_to = 'vehicle';
```

**Expected Result:**
```json
{
  "completion_updates": [
    {
      "target": "vehicle_maintenance",
      "field_name": "next_service_mileage",
      "value_type": "mileage",
      "label": "Next Service Due (miles)",
      "required": false,
      "help_text": "Enter the mileage when the next service is due"
    }
  ]
}
```

### Check Maintenance Update After Completion

```sql
-- Check maintenance record
SELECT next_service_mileage, last_updated_at, last_updated_by
FROM vehicle_maintenance
WHERE vehicle_id = '[TEST_VEHICLE_ID]';

-- Check audit history
SELECT field_name, old_value, new_value, comment, updated_by_name, created_at
FROM maintenance_history
WHERE vehicle_id = '[TEST_VEHICLE_ID]'
  AND field_name = 'next_service_mileage'
ORDER BY created_at DESC
LIMIT 1;
```

## Known Limitations

1. **Test Suite**: Automated tests encounter Vitest configuration issues (pre-existing)
2. **Category UI**: Full UI for configuring completion_updates on new categories not implemented (Service pre-configured via migration)
3. **Validation**: Currently only validates positive integers for mileage; could add max value checks

## Success Criteria

- ✅ Service task completion modal shows "Next Service Due (miles)" field
- ✅ Entering mileage and completing updates `vehicle_maintenance.next_service_mileage`
- ✅ Audit entry created in `maintenance_history` with proper comment
- ✅ Non-Service tasks don't show maintenance fields
- ✅ Validation prevents invalid mileage values
- ✅ Optional field (can leave empty without errors)
- ✅ Works on both `/workshop-tasks` and `/fleet?tab=maintenance` pages
- ✅ No linter errors in new code

## Future Enhancements

1. Add UI in category management to configure `completion_updates` for new categories
2. Extend to other categories:
   - MOT → `mot_due_date`
   - Tax → `tax_due_date`
   - Cambelt → `cambelt_due_mileage`
   - First Aid → `first_aid_kit_expiry`
3. Add warning if maintenance field already has recent value
4. Support multiple field updates per category (e.g., Service sets both `last_service_mileage` and `next_service_mileage`)
