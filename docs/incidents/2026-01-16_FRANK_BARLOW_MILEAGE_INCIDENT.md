# Incident Report: Frank Barlow Vehicle Mileage Corruption

**Date:** January 16, 2026  
**Severity:** Medium  
**Status:** ✅ RESOLVED  

---

## Summary

Vehicle FE24 TYV (Frank Barlow) had its mileage incorrectly set to 50,000 miles when the actual mileage was approximately 26,700 miles. This caused incorrect maintenance calculations and overdue task alerts.

## Timeline

- **Unknown Date:** Mileage corrupted to 50,000 (exact time unknown, no maintenance history)
- **January 16, 2026 10:56 AM:** Issue discovered and investigated
- **January 16, 2026 10:56 AM:** Mileage corrected to 26,700

## Impact

### Affected Vehicle
- **Registration:** FE24 TYV
- **Nickname:** Frank Barlow
- **Vehicle ID:** `bfd99f84-5807-42db-8c13-d38e70806ca1`

### Incorrect Data
- **Reported Mileage:** 50,000 miles
- **Actual Mileage:** 26,700 miles (from latest inspection 08/01/2026)
- **Difference:** 23,300 miles overreported

### Consequences
1. Service intervals calculated incorrectly
2. Overdue maintenance tasks flagged incorrectly
3. User confusion about vehicle status

## Root Cause Analysis

### Investigation Findings

1. **No test inspections found** with 50,000 mileage in the database
2. **No maintenance history** recorded for the change
3. **Last maintenance update:** 2026-01-11 13:12:26 (before fix)

### Likely Causes

1. **Test script execution** - Scripts like `test-inspection-draft.ts` use hardcoded 50,000 mileage
2. **Direct database update** - Manual update bypassing the API (no history recorded)
3. **Database trigger** - Inspection with 50,000 miles triggered auto-update, then inspection was deleted

### Database Trigger Mechanism

The database has an automatic trigger that updates vehicle mileage:

```sql
CREATE TRIGGER trigger_update_maintenance_mileage
AFTER INSERT OR UPDATE OF current_mileage
ON vehicle_inspections
FOR EACH ROW
WHEN (NEW.current_mileage IS NOT NULL)
EXECUTE FUNCTION update_vehicle_maintenance_mileage();
```

**Key behavior:** This trigger ALWAYS updates mileage, even if the new value is lower than the current value.

## Resolution

### Actions Taken

1. **Identified correct mileage** from latest real inspection (26,700 miles)
2. **Updated maintenance record** with correct mileage
3. **Verified fix** - maintenance record now shows 26,700 miles
4. **No test inspections deleted** - none were found in the database

### Fix Script

Created and ran: `scripts/fix-frank-barlow-mileage.ts`

```bash
npx tsx scripts/fix-frank-barlow-mileage.ts
```

**Result:**
- ✅ Mileage restored to 26,700
- ✅ Last update timestamp refreshed
- ✅ Maintenance calculations now correct

## Prevention Measures

### Immediate Actions

1. **Created safety documentation** - `scripts/testing/TESTING_SAFETY_RULES.md`
2. **Documented incident** - This file
3. **Identified risky scripts** - Listed scripts that use hardcoded test values

### Recommended Actions

1. **Add production URL checks** to all test scripts
2. **Create separate test database** for running test scripts
3. **Update test scripts** to use realistic, randomized values instead of 50,000
4. **Add maintenance history** for all mileage updates (even from triggers)
5. **Implement mileage validation** - warn if mileage decreases by >1000 miles

### Scripts Requiring Updates

- `scripts/testing/test-inspection-draft.ts` - Uses 50,000 mileage
- `scripts/seed/seed-sample-data.ts` - Uses 50,000-150,000 range
- `scripts/seed/seed-inspections-sql.ts` - Uses 50,000 + random

## Lessons Learned

1. **Test scripts are dangerous** - Hardcoded values can corrupt production data
2. **Database triggers are powerful** - They execute automatically and can propagate test data
3. **Audit trails are critical** - Lack of maintenance history made investigation difficult
4. **Safety checks needed** - Test scripts should refuse to run against production

## Related Files

- Fix script: `scripts/fix-frank-barlow-mileage.ts`
- Investigation script: `scripts/investigate-frank-barlow-mileage.ts`
- Safety rules: `scripts/testing/TESTING_SAFETY_RULES.md`
- Database trigger: `supabase/migrations/20251218_create_vehicle_maintenance_system.sql`

## Verification

### Before Fix
```
Current Mileage: 50,000
Last Updated: 2026-01-11 13:12:26
Service Due: 34,000 (incorrect - already passed)
```

### After Fix
```
Current Mileage: 26,700
Last Updated: 2026-01-16 10:56:38
Service Due: 34,000 (correct - upcoming)
```

### Inspection History
```
1. 08/01/2026 - 26,700 miles - submitted ✅ (used for correction)
2. 19/12/2025 - 24,630 miles - submitted
3. 19/12/2025 - 24,630 miles - submitted
4. 12/12/2025 - 24,580 miles - submitted
5. 05/12/2025 - 24,530 miles - submitted
6. 28/11/2025 - 24,500 miles - submitted
7. 21/11/2025 - 24,380 miles - submitted
8. 17/11/2025 - null miles - draft
```

## Status

✅ **RESOLVED** - Mileage corrected and vehicle data restored

---

**Reported By:** User (via screenshot)  
**Investigated By:** AI Assistant  
**Resolved By:** AI Assistant  
**Resolution Time:** <1 hour  
**Data Loss:** None (corrected from inspection history)
