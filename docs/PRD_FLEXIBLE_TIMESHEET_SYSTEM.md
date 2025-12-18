# PRD: Flexible Timesheet System
**Date:** December 17, 2025  
**Status:** Planning  
**Priority:** HIGH  
**Branch:** `dev/codebase-improvements`

---

## Executive Summary

Transform the timesheet system from a single, hardcoded form into a flexible, extensible architecture that supports multiple timesheet types based on job roles. This enables future expansion for different employee categories (Civils, Plant, etc.) without code duplication or architectural changes.

---

## Problem Statement

### Current Limitations
1. **Single Timesheet Type**: All employees use the same timesheet form regardless of job role
2. **Hardcoded Logic**: Timesheet validation and fields are embedded in a single component
3. **No Type Association**: Roles don't specify which timesheet format to use
4. **Poor UX**: 
   - Default date pre-fills (users don't consciously select)
   - No duplicate checking before form opens
   - No submission confirmation/preview
5. **Future Scaling Issue**: Adding Plant timesheets would require duplicating the entire flow

### Business Impact
- Cannot onboard Plant employees until their specific timesheet is built
- Risk of data entry errors with wrong timesheet type
- Maintenance nightmare when updating timesheet logic
- Poor user experience with accidental submissions

---

## Goals & Success Criteria

### Primary Goals
1. ✅ **Enable multiple timesheet types** (Civils, Plant, future expansion)
2. ✅ **Role-based timesheet assignment** (admins configure which type per role)
3. ✅ **Improved submission UX** (confirmation modal with preview)
4. ✅ **Better date handling** (explicit selection, duplicate prevention)
5. ✅ **Zero breaking changes** (existing timesheets continue to work)

### Success Criteria
- [ ] Admin can assign timesheet type to each role in UI
- [ ] System routes users to correct timesheet based on role
- [ ] Users must select week ending date before seeing form
- [ ] Duplicate timesheet attempts are blocked with clear message
- [ ] Submission shows preview and requires confirmation
- [ ] All existing timesheets render and function correctly
- [ ] Can add new timesheet type in < 2 hours

---

## User Stories

### US-1: Admin Configures Timesheet Type
**As an** administrator  
**I want to** assign a specific timesheet type to each job role  
**So that** employees automatically use the correct timesheet for their position

**Acceptance Criteria:**
- Edit Role modal includes "Timesheet Type" dropdown
- Options: "Civils (Default)", "Plant", "Future types..."
- Selection saves to database
- Default value is "civils" for backward compatibility

---

### US-2: Employee Selects Week Ending Date
**As an** employee  
**I want to** explicitly select the week ending date before seeing the timesheet  
**So that** I'm conscious of which week I'm filling out

**Acceptance Criteria:**
- Landing page shows date picker (no form visible)
- Cannot proceed without selecting a date
- System checks for existing timesheet for that week
- If duplicate found, show error with link to edit existing
- Only after validation does form appear

---

### US-3: Employee Confirms Submission
**As an** employee  
**I want to** review a summary before final submission  
**So that** I can catch errors before submitting

**Acceptance Criteria:**
- "Submit" button opens confirmation modal
- Modal shows:
  - Week ending date
  - Total hours
  - Days worked
  - Special flags (bank holidays, night shifts)
  - Job numbers used
- "Confirm Submission" finalizes
- "Go Back" returns to edit mode

---

### US-4: System Routes to Correct Timesheet
**As a** Plant employee  
**I want to** automatically see the Plant timesheet  
**So that** I don't have to think about which form to use

**Acceptance Criteria:**
- System reads user's role → timesheet type
- Routes to correct timesheet component
- If timesheet type not implemented, show friendly error
- Managers creating for others: respect employee's role, not manager's

---

### US-5: Developer Adds New Timesheet Type
**As a** developer  
**I want to** add a new timesheet type quickly  
**So that** we can support new job categories

**Acceptance Criteria:**
- Create new component in `/timesheets/types/`
- Register in timesheet registry
- Add to admin dropdown options
- System automatically routes and validates
- < 2 hours for simple timesheet, < 1 day for complex

---

## Technical Design

### Architecture Overview

```
Current Architecture (Monolithic):
/timesheets/new/page.tsx (1,420 lines, all logic embedded)

New Architecture (Modular):
/timesheets/
  ├── new/
  │   └── page.tsx (Router - 150 lines)
  ├── types/
  │   ├── civils/
  │   │   ├── CivilsTimesheet.tsx (main form)
  │   │   ├── CivilsValidation.ts (validation rules)
  │   │   └── CivilsPreview.tsx (confirmation modal)
  │   ├── plant/
  │   │   ├── PlantTimesheet.tsx
  │   │   ├── PlantValidation.ts
  │   │   └── PlantPreview.tsx
  │   └── registry.ts (timesheet type registry)
  ├── components/
  │   ├── WeekSelector.tsx (date selection)
  │   ├── TimesheetRouter.tsx (routes to correct type)
  │   └── DuplicateChecker.tsx (validation logic)
  └── hooks/
      └── useTimesheetType.ts (gets user's timesheet type)
```

---

### Database Schema Changes

#### Option A: Minimal (Recommended) ✅

**Add to `roles` table:**
```sql
ALTER TABLE roles 
ADD COLUMN timesheet_type TEXT DEFAULT 'civils' 
CHECK (timesheet_type IN ('civils', 'plant'));
```

**Add to `timesheets` table:**
```sql
ALTER TABLE timesheets
ADD COLUMN timesheet_type TEXT DEFAULT 'civils'
CHECK (timesheet_type IN ('civils', 'plant'));
```

**Pros:**
- Simple, backward compatible
- Existing timesheets default to 'civils'
- Easy to query and filter
- Low risk

**Cons:**
- Need migration for new types (acceptable)

---

#### Option B: Flexible (Future-proof)

**Create new table:**
```sql
CREATE TABLE timesheet_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL, -- 'civils', 'plant'
  display_name TEXT NOT NULL, -- 'Civils Timesheet'
  description TEXT,
  component_name TEXT NOT NULL, -- 'CivilsTimesheet'
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default data
INSERT INTO timesheet_types (name, display_name, component_name) VALUES
  ('civils', 'Civils Timesheet (Default)', 'CivilsTimesheet'),
  ('plant', 'Plant Timesheet', 'PlantTimesheet');
```

**Modify existing tables:**
```sql
ALTER TABLE roles 
ADD COLUMN timesheet_type_id UUID REFERENCES timesheet_types(id) DEFAULT (SELECT id FROM timesheet_types WHERE name = 'civils');

ALTER TABLE timesheets
ADD COLUMN timesheet_type_id UUID REFERENCES timesheet_types(id) DEFAULT (SELECT id FROM timesheet_types WHERE name = 'civils');
```

**Pros:**
- Highly extensible (add types via UI)
- No schema changes for new types
- Can store metadata (validation rules, etc.)

**Cons:**
- More complex
- Overkill if only 2-3 types

---

### **RECOMMENDATION: Start with Option A**

- Simpler to implement
- Meets current needs
- Can migrate to Option B later if needed
- Lower risk for this phase

---

## Component Design

### 1. Week Selector Component

**File:** `components/timesheets/WeekSelector.tsx`

```typescript
interface WeekSelectorProps {
  onWeekSelected: (date: string, existingId: string | null) => void;
  userId: string;
}

export function WeekSelector({ onWeekSelected, userId }: WeekSelectorProps) {
  const [selectedDate, setSelectedDate] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const handleDateChange = async (date: string) => {
    setSelectedDate(date);
    setError('');
  };

  const handleProceed = async () => {
    setChecking(true);
    
    // Check for existing timesheet
    const existing = await checkForExistingTimesheet(userId, selectedDate);
    
    if (existing) {
      setError('You already have a timesheet for this week.');
      // Show option to edit existing
    } else {
      onWeekSelected(selectedDate, null);
    }
    
    setChecking(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Select Week Ending Date</CardTitle>
        <CardDescription>
          Choose the Sunday for the week you want to record
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DatePicker value={selectedDate} onChange={handleDateChange} />
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <Button onClick={handleProceed} disabled={!selectedDate || checking}>
          Continue to Timesheet
        </Button>
      </CardContent>
    </Card>
  );
}
```

---

### 2. Timesheet Router Component

**File:** `components/timesheets/TimesheetRouter.tsx`

```typescript
interface TimesheetRouterProps {
  weekEnding: string;
  existingId: string | null;
}

export function TimesheetRouter({ weekEnding, existingId }: TimesheetRouterProps) {
  const { profile } = useAuth();
  const timesheetType = useTimesheetType(profile?.role_id);

  if (!timesheetType) {
    return <LoadingSpinner />;
  }

  // Get the correct component from registry
  const TimesheetComponent = TimesheetRegistry[timesheetType];

  if (!TimesheetComponent) {
    return (
      <ErrorState>
        <p>Timesheet type "{timesheetType}" is not yet available.</p>
        <p>Please contact your administrator.</p>
      </ErrorState>
    );
  }

  return (
    <TimesheetComponent 
      weekEnding={weekEnding} 
      existingId={existingId} 
    />
  );
}
```

---

### 3. Timesheet Registry

**File:** `app/(dashboard)/timesheets/types/registry.ts`

```typescript
import { CivilsTimesheet } from './civils/CivilsTimesheet';
import { PlantTimesheet } from './plant/PlantTimesheet';

export const TimesheetRegistry: Record<string, React.ComponentType<TimesheetProps>> = {
  civils: CivilsTimesheet,
  plant: PlantTimesheet,
  // Future: Add more types here
};

export const TimesheetTypes = [
  { value: 'civils', label: 'Civils Timesheet (Default)' },
  { value: 'plant', label: 'Plant Timesheet' },
] as const;
```

---

### 4. Confirmation Modal Component

**File:** `components/timesheets/ConfirmationModal.tsx`

```typescript
interface ConfirmationModalProps {
  timesheet: {
    weekEnding: string;
    totalHours: number;
    daysWorked: number;
    entries: TimesheetEntry[];
    regNumber: string;
  };
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function ConfirmationModal({ timesheet, onConfirm, onCancel }: ConfirmationModalProps) {
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    await onConfirm();
    setSubmitting(false);
  };

  return (
    <Dialog open onOpenChange={() => !submitting && onCancel()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Confirm Timesheet Submission</DialogTitle>
          <DialogDescription>
            Please review your timesheet before submitting
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-4">
            <SummaryCard label="Total Hours" value={timesheet.totalHours} />
            <SummaryCard label="Days Worked" value={timesheet.daysWorked} />
            <SummaryCard label="Vehicle Reg" value={timesheet.regNumber || 'N/A'} />
          </div>

          {/* Day-by-Day Breakdown */}
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Job Number</TableHead>
                  <TableHead>Flags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {timesheet.entries.map((entry, index) => (
                  <TableRow key={index}>
                    <TableCell>{DAY_NAMES[index]}</TableCell>
                    <TableCell>{entry.daily_total || '-'}</TableCell>
                    <TableCell>{entry.job_number || '-'}</TableCell>
                    <TableCell>
                      {entry.bank_holiday && <Badge>Bank Holiday</Badge>}
                      {entry.night_shift && <Badge>Night Shift</Badge>}
                      {entry.did_not_work && <Badge variant="secondary">Did Not Work</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Warnings */}
          {timesheet.totalHours > 60 && (
            <Alert variant="warning">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Total hours exceed 60. Please verify all entries are correct.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Go Back to Edit
          </Button>
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'Submitting...' : 'Confirm Submission'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

### 5. Custom Hook for Timesheet Type

**File:** `lib/hooks/useTimesheetType.ts`

```typescript
export function useTimesheetType(roleId?: string) {
  const [timesheetType, setTimesheetType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function fetchTimesheetType() {
      if (!roleId) {
        setTimesheetType('civils'); // Default
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('roles')
        .select('timesheet_type')
        .eq('id', roleId)
        .single();

      if (error) {
        console.error('Error fetching timesheet type:', error);
        setTimesheetType('civils'); // Fallback
      } else {
        setTimesheetType(data?.timesheet_type || 'civils');
      }

      setLoading(false);
    }

    fetchTimesheetType();
  }, [roleId, supabase]);

  return { timesheetType, loading };
}
```

---

## Implementation Phases

### **Phase 1: Foundation & Database** (Day 1) ⭐ START HERE
**Goal:** Prepare database and basic routing without breaking existing functionality

**Tasks:**
1. Create migration to add `timesheet_type` column to `roles` table
2. Create migration to add `timesheet_type` column to `timesheets` table
3. Update existing records to default to 'civils'
4. Test migrations on development database
5. Create `TimesheetRegistry` and `TimesheetTypes` constants

**Deliverables:**
- [ ] Migration files created
- [ ] Database schema updated
- [ ] All existing timesheets still work
- [ ] Registry structure in place

**Risk:** LOW (additive changes only)

---

### **Phase 2: Extract Current Timesheet** (Day 1-2)
**Goal:** Move existing timesheet into modular structure without changes

**Tasks:**
1. Create folder structure: `/timesheets/types/civils/`
2. Copy current `new/page.tsx` content into `CivilsTimesheet.tsx`
3. Extract validation logic into `CivilsValidation.ts`
4. Create props interface for timesheet components
5. Update imports and ensure it still works
6. Test all existing functionality

**Deliverables:**
- [ ] `CivilsTimesheet.tsx` component working
- [ ] All validation working
- [ ] Existing timesheets load and save correctly
- [ ] No functionality lost

**Risk:** MEDIUM (large refactor, thorough testing needed)

---

### **Phase 3: Week Selector & Duplicate Check** (Day 2)
**Goal:** Improve date selection UX and prevent duplicates

**Tasks:**
1. Create `WeekSelector.tsx` component
2. Add duplicate checking logic
3. Update `/timesheets/new/page.tsx` to show selector first
4. Add error handling and user feedback
5. Test edge cases (editing existing, different users, same week)

**Deliverables:**
- [ ] Week selector UI implemented
- [ ] Duplicate detection working
- [ ] Clear error messages
- [ ] Link to edit existing timesheet if found

**Risk:** LOW (isolated component)

---

### **Phase 4: Confirmation Modal** (Day 2-3)
**Goal:** Add submission preview and confirmation

**Tasks:**
1. Create `ConfirmationModal.tsx` component
2. Add summary calculation logic (total hours, days worked, etc.)
3. Update submit flow to show modal first
4. Add validation warnings in modal
5. Test with various timesheet scenarios

**Deliverables:**
- [ ] Confirmation modal designed and implemented
- [ ] Summary calculations accurate
- [ ] Warnings for unusual cases (high hours, etc.)
- [ ] Smooth UX flow

**Risk:** LOW (UI enhancement)

---

### **Phase 5: Timesheet Router** (Day 3)
**Goal:** Dynamic routing based on role's timesheet type

**Tasks:**
1. Create `TimesheetRouter.tsx` component
2. Implement `useTimesheetType` hook
3. Update `/timesheets/new/page.tsx` to use router
4. Add error handling for missing types
5. Test with different roles

**Deliverables:**
- [ ] Router component working
- [ ] Hook fetches correct type from role
- [ ] Graceful error for unimplemented types
- [ ] Works for both creating and editing

**Risk:** MEDIUM (affects all users)

---

### **Phase 6: Admin UI for Role Configuration** (Day 3-4)
**Goal:** Allow admins to assign timesheet types to roles

**Tasks:**
1. Update RoleManagement component
2. Add timesheet type dropdown to Edit Role modal
3. Update role update API to handle timesheet_type
4. Add validation and error handling
5. Test role updates and permissions

**Deliverables:**
- [ ] Dropdown in Edit Role modal
- [ ] Selection saves correctly
- [ ] Existing roles default to 'civils'
- [ ] Only admins can change

**Risk:** LOW (admin-only feature)

---

### **Phase 7: Testing & Refinement** (Day 4-5)
**Goal:** Comprehensive testing and bug fixes

**Tasks:**
1. Test all timesheet operations (create, edit, submit, approve)
2. Test with different roles and timesheet types
3. Test edge cases (offline, network errors, etc.)
4. Performance testing with large datasets
5. Fix any bugs found
6. Update documentation

**Deliverables:**
- [ ] All features tested end-to-end
- [ ] Bug fixes completed
- [ ] Performance validated
- [ ] Documentation updated

**Risk:** LOW (testing phase)

---

### **Phase 8: Plant Timesheet (Future)** 🚀
**Goal:** Prove the system works by adding Plant timesheet

**Tasks:**
1. Define Plant timesheet requirements
2. Create `PlantTimesheet.tsx` component
3. Implement Plant-specific validation
4. Create Plant confirmation modal
5. Add 'plant' to timesheet types
6. Test thoroughly

**Deliverables:**
- [ ] Plant timesheet component
- [ ] Plant validation logic
- [ ] Registered in system
- [ ] Works end-to-end

**Risk:** LOW (follows established pattern)

---

## Migration Strategy

### Database Migration

**File:** `supabase/migrations/20251217_add_timesheet_types.sql`

```sql
-- Migration: Add timesheet type support
-- Description: Enable multiple timesheet types based on role
-- Date: 2025-12-17

BEGIN;

-- Add timesheet_type to roles table
ALTER TABLE roles 
ADD COLUMN IF NOT EXISTS timesheet_type TEXT DEFAULT 'civils' 
CHECK (timesheet_type IN ('civils', 'plant'));

-- Add timesheet_type to timesheets table  
ALTER TABLE timesheets
ADD COLUMN IF NOT EXISTS timesheet_type TEXT DEFAULT 'civils'
CHECK (timesheet_type IN ('civils', 'plant'));

-- Update existing records to 'civils' (no-op due to default, but explicit)
UPDATE roles SET timesheet_type = 'civils' WHERE timesheet_type IS NULL;
UPDATE timesheets SET timesheet_type = 'civils' WHERE timesheet_type IS NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_roles_timesheet_type ON roles(timesheet_type);
CREATE INDEX IF NOT EXISTS idx_timesheets_timesheet_type ON timesheets(timesheet_type);

COMMIT;
```

---

## Rollback Plan

If issues arise:

1. **Database Rollback:**
```sql
BEGIN;
ALTER TABLE roles DROP COLUMN IF EXISTS timesheet_type;
ALTER TABLE timesheets DROP COLUMN IF EXISTS timesheet_type;
COMMIT;
```

2. **Code Rollback:**
   - Revert to previous commit
   - Old timesheet code still works (not deleted)
   - Zero downtime

3. **Feature Flag (Optional):**
```typescript
const ENABLE_FLEXIBLE_TIMESHEETS = process.env.NEXT_PUBLIC_ENABLE_FLEXIBLE_TIMESHEETS === 'true';

if (ENABLE_FLEXIBLE_TIMESHEETS) {
  return <TimesheetRouter />;
} else {
  return <LegacyCivilsTimesheet />;
}
```

---

## Testing Strategy

### Unit Tests
- [ ] `useTimesheetType` hook
- [ ] Duplicate checking logic
- [ ] Summary calculations
- [ ] Validation functions

### Integration Tests
- [ ] Week selector → form flow
- [ ] Form → confirmation → submission
- [ ] Role update → timesheet type change
- [ ] Duplicate detection across users

### E2E Tests
- [ ] Complete timesheet submission flow
- [ ] Manager creating for employee
- [ ] Editing existing timesheet
- [ ] Different timesheet types

### Manual Testing Checklist
- [ ] Create new timesheet (all roles)
- [ ] Edit existing timesheet
- [ ] Submit with confirmation
- [ ] Duplicate detection
- [ ] Admin role configuration
- [ ] Manager creating for others
- [ ] Offline mode
- [ ] Mobile responsiveness

---

## Security Considerations

1. **RLS Policies:** Ensure timesheet_type doesn't bypass security
2. **Role Changes:** What happens when user's role changes mid-timesheet?
3. **Admin Only:** Only admins can change timesheet types
4. **Validation:** Server-side validation of timesheet type
5. **Audit Trail:** Log when timesheet types are changed

---

## Performance Considerations

1. **Lazy Loading:** Load timesheet components dynamically
2. **Caching:** Cache user's timesheet type in session
3. **Optimistic Updates:** Show form immediately, validate in background
4. **Database Indexes:** Index on timesheet_type columns

---

## Future Enhancements

### Phase 9+ (Post-Launch)
- [ ] Timesheet templates (pre-fill common entries)
- [ ] Bulk operations (copy previous week)
- [ ] Analytics by timesheet type
- [ ] Custom fields per timesheet type
- [ ] Timesheet type versioning
- [ ] Import/export different formats
- [ ] Mobile-specific optimizations per type

---

## Open Questions

1. **Q:** What happens if a user's role changes while they have a draft timesheet?  
   **A:** Draft continues with original type. New timesheets use new type.

2. **Q:** Can managers override timesheet type when creating for employees?  
   **A:** No. Always use employee's role setting.

3. **Q:** Should we support multiple timesheet types per role?  
   **A:** Not in Phase 1. Each role = one type.

4. **Q:** How to handle Plant timesheet if not yet implemented?  
   **A:** Show friendly error: "Plant timesheet coming soon. Please contact admin."

---

## Success Metrics

### Technical
- [ ] Zero breaking changes to existing timesheets
- [ ] < 200ms additional load time for routing
- [ ] All tests passing (unit, integration, E2E)
- [ ] No new TypeScript errors
- [ ] No new lint warnings

### Business
- [ ] Admins can configure timesheet types without developer help
- [ ] Users see correct timesheet based on role automatically
- [ ] Duplicate submissions reduced by 80%+
- [ ] Support tickets for wrong timesheet type = 0

### User Experience
- [ ] Users understand which week they're filling
- [ ] Confirmation modal catches errors before submission
- [ ] Clear feedback for all error states
- [ ] Mobile experience smooth

---

## Timeline & Estimates

**Total Estimated Time:** 4-5 days (developer effort)

| Phase | Tasks | Effort | Risk |
|-------|-------|--------|------|
| Phase 1: Database | Schema changes, migrations | 4 hours | LOW |
| Phase 2: Extract Civils | Refactor to modular | 8 hours | MEDIUM |
| Phase 3: Week Selector | Date selection UX | 4 hours | LOW |
| Phase 4: Confirmation | Modal + summary | 6 hours | LOW |
| Phase 5: Router | Dynamic routing | 4 hours | MEDIUM |
| Phase 6: Admin UI | Role configuration | 4 hours | LOW |
| Phase 7: Testing | Comprehensive testing | 8 hours | LOW |
| **Phase 8: Plant** | *Future session* | 8 hours | LOW |

**Recommended Schedule:**
- **Day 1:** Phases 1-2 (foundation + extract)
- **Day 2:** Phases 3-4 (UX improvements)
- **Day 3:** Phases 5-6 (routing + admin)
- **Day 4-5:** Phase 7 (testing + refinement)

---

## Dependencies

### External
- None (all internal changes)

### Internal
- Database access for migrations
- No breaking changes to existing code
- Existing timesheet component working

---

## Communication Plan

### Stakeholders
- **Users:** No announcement needed (transparent change)
- **Admins:** Email about new timesheet type configuration
- **Developers:** This PRD + implementation guide

### Documentation Updates
- [ ] Update admin guide with timesheet type configuration
- [ ] Update developer guide with how to add new types
- [ ] Update user guide with new submission flow
- [ ] Create video tutorial for admins

---

## Approval & Sign-off

**Product Owner:** Matt (User)  
**Technical Lead:** Lyra AI  
**Status:** Awaiting approval

**Questions before proceeding:**
1. ✅ Approve database schema approach (Option A: simple columns)?
2. ✅ Approve phased rollout (Phases 1-7 first, Phase 8 later)?
3. ✅ Approve week selector + confirmation modal changes?
4. ❓ Any additional requirements for Plant timesheet?

---

*Once approved, proceed to implementation starting with Phase 1.*
