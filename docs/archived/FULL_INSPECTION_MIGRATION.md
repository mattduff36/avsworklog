# Full 26-Point to 14-Point Van Inspection Migration

## Overview
This migration converts ALL remaining 26-point truck inspections to the new 14-point van checklist, as all vehicles are vans.

## What This Migration Does

### Identification
- Finds all inspections with exactly 182 items (26 items × 7 days)
- Excludes test vehicles: `TE57 VAN` and `TE57 HGV`

### Migration Process
For each identified inspection:
1. **Preserves ALL metadata:**
   - Dates (inspection_date, inspection_end_date)
   - User information (user_id)
   - Status (draft, submitted, approved, rejected)
   - Signatures (signature_data, signed_at)
   - Review data (reviewed_by, reviewed_at, manager_comments)
   - Mileage (current_mileage)
   - Timestamps (created_at, updated_at, submitted_at)

2. **Deletes old 26-point items:**
   - Removes all 182 old inspection items

3. **Creates new 14-point van items:**
   - Inserts 98 new items (14 items × 7 days)
   - Uses standard van checklist descriptions

4. **Sets item status based on inspection status:**
   - **Pending/Approved/Rejected:** ALL items marked as 'ok' for all 7 days
   - **Draft:** Only days with existing data marked as 'ok'

### New Van Checklist (14 Items)
1. Oil, Fuel & Coolant Levels/Leaks
2. Wheels & Nuts
3. Tyres
4. Windows & Wipers
5. Mirrors
6. Visual Body Condition
7. Lights/Flashing Beacons
8. Instrument Gauges/Horns
9. Seat Belt
10. Visual Interior Condition
11. Locking Devices
12. Steering
13. Parking Brake
14. Brake Test

## Prerequisites
- `.env.local` file with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- Node.js and npm installed
- `tsx` package available

## How to Run

```bash
npx tsx scripts/migrate-all-26-point-inspections.ts
```

## Output
The script will:
1. Show total inspections in database
2. List inspections being migrated with their status
3. Report any inspections with defects found
4. Show progress for each migration
5. Verify no 182-item inspections remain (except test vehicles)
6. Display final summary

## Safety Features
- **Read-only scan first:** Identifies all inspections before migrating
- **Test vehicle exclusion:** Skips TE57 VAN and TE57 HGV
- **Defect reporting:** Lists any inspections with defects (without blocking migration)
- **Verification step:** Confirms no old inspections remain after migration
- **Preserves all data:** No inspection metadata is lost

## Example Output
```
🔍 Finding inspections with 26-point checklists (182 items)...

📊 Total inspections in database: 150

✅ Found 47 inspections to migrate

📝 Migrating: MJ66 FLG (submitted) - abc-123-xyz
   ✓ Deleted 182 old items
   ✓ Created 98 new van checklist items (14 items × 7 days)
   ✓ Marked ALL items as 'ok'

...

🔍 Verifying migration...

============================================================
✅ Migration Complete!
============================================================
   Successful: 47
   Failed: 0
   Remaining 26-point inspections: 0
============================================================
```

## Rollback
If needed, inspections can be restored from database backups. This migration does not create its own backup - ensure regular database backups are in place before running.

## Related Documents
- [Van Inspection Migration Guide](./VAN_INSPECTION_MIGRATION.md) - Original draft-only migration
- [Migrations Guide](./MIGRATIONS_GUIDE.md) - General migration information

