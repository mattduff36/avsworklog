# Van Inspection Migration Guide

## Overview

This guide explains how to migrate existing draft Van inspections from the old 26-point truck checklist to the new 14-point Van-specific checklist.

## When to Use This Migration

Use this migration when:
- You have draft Van inspections that were created before the Van checklist was implemented
- These inspections show 26 items instead of the correct 14 items for Vans
- You want to preserve as much user progress as possible

## What the Migration Does

### Item Mapping

The migration intelligently maps old checklist items to new Van-specific items:

| Old 26-Point Items | → | New Van Item |
|-------------------|---|--------------|
| Items 1, 6, 7 (Fuel, Oil, Water) | → | Item 1: Oil, Fuel & Coolant Levels/Leaks |
| Item 2 (Mirrors) | → | Item 5: Mirrors |
| Item 9 (Tyres) | → | Item 3: Tyres |
| Item 10 (Brakes) | → | Item 13: Parking Brake **AND** Item 14: Brake Test |
| Item 11 (Steering) | → | Item 12: Steering |
| Items 12, 14 (Lights, Indicators) | → | Item 7: Lights/Flashing Beacons |
| Items 15, 16 (Wipers, Washers) | → | Item 4: Windows & Wipers |
| Item 17 (Horn) | → | Item 8: Instrument Gauges/Horns |

### New Items Created

These Van-specific items will be created (empty/unchecked):
- Item 2: Wheels & Nuts
- Item 6: Visual Body Condition
- Item 9: Seat Belt
- Item 10: Visual Interior Condition
- Item 11: Locking Devices

### Items Discarded

Truck-specific items that don't apply to Vans will be removed:
- Safety Equipment - Cameras & Audible Alerts
- Warning Signage - VRU Sign
- FORS Stickers
- Battery
- Reflectors
- Markers
- Sheets / Ropes / Chains
- Security of Load
- Side underbar/Rails
- Brake Hoses
- Couplings Secure
- Electrical Connections
- Trailer No. Plate
- Nil Defects

## How to Run the Migration

### Prerequisites

1. Ensure your `.env.local` file has the required variables:
   ```
   NEXT_PUBLIC_SUPABASE_URL=your_url_here
   SUPABASE_SERVICE_ROLE_KEY=your_key_here
   POSTGRES_URL_NON_POOLING=your_postgres_url_here
   ```

2. Ensure you have `tsx` installed (should be in devDependencies)

### Running the Migration

```bash
npx tsx scripts/migrate-van-inspections.ts
```

### Expected Output

```
🚐 Starting Van Inspection Migration...

📋 Step 1: Finding draft Van inspections...
   Found 10 draft Van inspection(s)

🔄 Processing: BG21 EXH (34169a52...)
   Old items: 182 (26 items × 7 days)
   New items: 98 (14 items × 7 days)
   ✓ Deleted old items
   ✓ Inserted new items
   ✅ Migration complete for BG21 EXH

[... more inspections ...]

============================================================
📊 MIGRATION SUMMARY
============================================================
✅ Successfully migrated: 10
❌ Failed: 0
📝 Total processed: 10
============================================================

✨ Migration completed successfully!
👉 Users can now continue their draft Van inspections with the new 14-point checklist.

🎉 Done!
```

## Post-Migration

After running the migration:

1. **Verify in the UI**: Go to `/inspections` and filter by "Draft" status
2. **Open a migrated inspection**: Check that it shows 14 items instead of 26
3. **Check item mapping**: Verify that previously checked items are still checked in their new positions
4. **Test PDF generation**: Download a migrated inspection PDF to ensure it uses the Van template

## Status Merging Logic

When multiple old items map to one new item, statuses are merged using this priority:
1. **Attention** (highest priority - if any old item has attention, new item gets attention)
2. **OK** (if any old item is OK and none have attention, new item gets OK)
3. **N/A** (lowest priority - only if all old items were N/A)

## Rollback

If you need to rollback:
1. The migration doesn't create a backup automatically
2. Recommended: Take a database backup before running the migration
3. You can use Supabase's point-in-time recovery if needed

## Safety Notes

- ✅ Only affects **draft** inspections (submitted/approved inspections are not touched)
- ✅ Only affects **Van** vehicles (Truck/Artic/Trailer inspections are not affected)
- ✅ Preserves inspection metadata (date, mileage, employee, etc.)
- ✅ Preserves statuses where possible based on mapping rules
- ⚠️  Comments are not preserved (they're set to null in mapped items)
- ⚠️  No automatic backup is created - do this manually if needed

## Troubleshooting

### "Missing required environment variables"
- Check that your `.env.local` file exists and has the required variables
- Make sure you're running from the project root directory

### "No items found, skipping..."
- This means the inspection exists but has no items yet
- This is normal for inspections that were just created but not filled out
- The inspection will be skipped and can be filled out normally

### Failed migrations
- Check the error message in the output
- Common issues: database connection, permissions, invalid data
- Failed inspections can be re-run by running the script again

## Questions?

If you encounter any issues or have questions about the migration, check:
1. This documentation
2. The migration script source code: `scripts/migrate-van-inspections.ts`
3. The checklist configuration: `lib/checklists/vehicle-checklists.ts`

