# Test Suite for Fleet and Workshop Tasks Modules

This directory contains comprehensive integration tests for the Fleet and Workshop Tasks modules.

## Test Files

### 1. `integration/fleet-workflows.test.ts`
Tests all workflows for the `/fleet` page:
- **Vehicles Tab**: Fetching vehicles, viewing vehicle details, updating vehicle data
- **Maintenance Tab**: Fetching tasks, filtering by status/vehicle, overdue/due soon calculations
- **Vehicle Categories**: CRUD operations for vehicle categories (manager/admin only)

### 2. `integration/workshop-tasks-workflows.test.ts`
Tests all workflows for the `/workshop-tasks` page:
- **Task Viewing**: Fetching tasks, filtering by status/vehicle
- **Status Changes**: 
  - Pending → In Progress
  - In Progress → On Hold
  - On Hold → Resume (In Progress)
  - In Progress → Completed
  - Multi-step completion (Pending → In Progress → Completed)
- **Category Management**: CRUD operations for categories and subcategories (manager/admin only)
- **Task Creation**: Creating new workshop tasks

### 3. `integration/vehicle-history-workflows.test.ts`
Tests all workflows for the `/fleet/vehicles/[vehicleId]/history` page:
- **Vehicle Data**: Fetching complete vehicle information and service data
- **History Tab** (formerly Maintenance): 
  - Fetching maintenance history
  - Filtering by task type, status, and category
- **MOT History Tab**: Fetching MOT data
- **Notes Tab**: Checking for notes functionality
- **Edit Vehicle Modal**: 
  - Updating vehicle data
  - Updating service dates
  - Preventing retirement with open tasks
- **Task Cards**: Fetching task details for expansion

## Running the Tests

### Prerequisites

1. Copy `.env.test` and fill in your test credentials:
   ```bash
   cp .env.test .env.test.local
   ```

2. Ensure you have a test user with appropriate permissions

### Run All Tests
```bash
npm test
```

### Run Specific Test File
```bash
npm test tests/integration/fleet-workflows.test.ts
npm test tests/integration/workshop-tasks-workflows.test.ts
npm test tests/integration/vehicle-history-workflows.test.ts
```

### Run with Coverage
```bash
npm test -- --coverage
```

### Watch Mode
```bash
npm test -- --watch
```

## Test Coverage

The test suite covers:

### Fleet Page (`/fleet`)
- ✅ Fetch all active vehicles
- ✅ Fetch vehicle with categories
- ✅ Update vehicle maintenance data
- ✅ Fetch workshop tasks with relationships
- ✅ Filter tasks by status
- ✅ Filter tasks by vehicle
- ✅ Calculate overdue/due soon vehicles
- ✅ CRUD operations for vehicle categories

### Workshop Tasks Page (`/workshop-tasks`)
- ✅ Fetch and filter all workshop tasks
- ✅ Status workflow: Pending → In Progress
- ✅ Status workflow: In Progress → On Hold
- ✅ Status workflow: On Hold → Resume
- ✅ Status workflow: In Progress → Completed
- ✅ Multi-step completion workflow
- ✅ CRUD operations for categories
- ✅ CRUD operations for subcategories
- ✅ Create new workshop tasks

### Vehicle History Page (`/fleet/vehicles/[vehicleId]/history`)
- ✅ Fetch complete vehicle data
- ✅ Fetch vehicle service information
- ✅ Fetch maintenance history with all relationships
- ✅ Filter history by task type
- ✅ Filter history by status
- ✅ Filter history by category
- ✅ Fetch MOT history
- ✅ Update vehicle via Edit Modal
- ✅ Update service dates
- ✅ Prevent retirement with open tasks
- ✅ Fetch task details for expansion

## Notes

- Tests that require manager/admin permissions will skip if the test user doesn't have the required role
- Some tests will skip if no test data is available (e.g., no vehicles, no categories)
- Test tasks are created and cleaned up automatically
- All tests use the actual database to ensure real-world behavior

## Troubleshooting

### "User not authorized" errors
- Ensure your test user has the appropriate role (manager or admin) for protected operations
- Check that role permissions are correctly configured in the database

### "No test vehicle" errors  
- Ensure you have at least one active vehicle in the database
- Check that the vehicle is not marked as deleted (`deleted_at IS NULL`)

### "No categories" errors
- Ensure workshop task categories are set up in the database
- Run the category setup migration if needed

### Connection errors
- Verify your `.env.test.local` file has the correct Supabase credentials
- Check that your Supabase project is running and accessible
- Ensure RLS policies allow your test user to access the required tables
