# Vehicle Registration Number Standardization

## Overview

All vehicle registration numbers in the system follow a standardized format to ensure consistency across storage, display, and external API calls.

## Standards

### Database Storage
- **Format:** UK standard with space (e.g., `AA12 AAA`)
- **Case:** UPPERCASE
- **Whitespace:** Single space between position 4 and 5 for modern plates

**Examples:**
- ✅ `BC21 YZU`
- ✅ `FE24 TYO`
- ✅ `SHZ 1180` (older format, preserved as-is)
- ❌ `BC21YZU` (no space - will be auto-formatted)
- ❌ `bc21 yzu` (lowercase - will be auto-formatted)

### Frontend Display
- **Format:** Same as database (UK standard with space)
- **Source:** Direct from database `reg_number` field
- No additional formatting required

### External API Calls (DVLA, MOT)
- **Format:** NO spaces, UPPERCASE
- **Transformation:** Automatic via `formatRegistrationForApi()`

**Examples:**
- Database: `BC21 YZU` → API: `BC21YZU`
- Database: `FE24 TYO` → API: `FE24TYO`

## Utility Functions

Located in `lib/utils/registration.ts`:

### `formatRegistrationForStorage(reg: string): string`
Formats a registration number for database storage.

```typescript
formatRegistrationForStorage("bc21yzU")  // => "BC21 YZU"
formatRegistrationForStorage("BC21 YZU") // => "BC21 YZU"
formatRegistrationForStorage(" bc21  yzu ") // => "BC21 YZU"
```

### `formatRegistrationForApi(reg: string): string`
Formats a registration number for external API calls (removes all spaces).

```typescript
formatRegistrationForApi("BC21 YZU")     // => "BC21YZU"
formatRegistrationForApi(" bc21  yzu ") // => "BC21YZU"
```

### `validateRegistrationNumber(reg: string): string | null`
Validates a UK registration number format.

```typescript
validateRegistrationNumber("BC21 YZU")  // => null (valid)
validateRegistrationNumber("ABC")       // => "Invalid..." (too short)
validateRegistrationNumber("BC21@YZU")  // => "Invalid..." (special chars)
```

### `formatRegistrationForDisplay(reg: string): string`
Alias for `formatRegistrationForStorage` - ensures consistent display format.

## Implementation

### Vehicle Creation (POST /api/admin/vehicles)
```typescript
const cleanReg = formatRegistrationForStorage(reg_number);
// Store in database with space
await supabase.from('vehicles').insert({ reg_number: cleanReg });
```

### Vehicle Update (PATCH /api/admin/vehicles/[id])
```typescript
if (reg_number !== undefined) {
  const validationError = validateRegistrationNumber(reg_number);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  updates.reg_number = formatRegistrationForStorage(reg_number);
}
```

### External API Calls
```typescript
// DVLA VES API
const regNumberNoSpaces = formatRegistrationForApi(vehicle.reg_number);
const dvlaData = await dvlaService.getVehicleData(regNumberNoSpaces);

// MOT History API
const motData = await motService.getMotExpiryData(regNumberNoSpaces);
```

## Audit Results (Jan 2026)

**Database Status:** ✅ Consistent
- 53 modern plates stored WITH spaces (correct)
- 0 modern plates stored WITHOUT spaces
- 2 non-standard/older formats (preserved as-is)
- 0 duplicates found

**Files Updated:**
- `lib/utils/registration.ts` - New utility functions
- `app/api/admin/vehicles/route.ts` - Vehicle creation
- `app/api/admin/vehicles/[id]/route.ts` - Vehicle updates
- `app/api/maintenance/sync-dvla/route.ts` - DVLA sync
- `app/api/maintenance/sync-dvla-scheduled/route.ts` - Scheduled sync

## Benefits

1. **Consistency:** All registrations stored in same format
2. **No Duplicates:** Prevents `BC21YZU` and `BC21 YZU` being treated as different vehicles
3. **API Compatibility:** Automatic space removal for external APIs
4. **User-Friendly:** Display matches UK standard format
5. **Validation:** Catches invalid formats at entry point

## Testing

Run the audit script to check current database state:

```bash
npx tsx scripts/audit-registration-formats.ts
```

## Future Enhancements

- [ ] Add support for Northern Ireland format (e.g., `NIZ 1234`)
- [ ] Validate against DVLA plate format rules
- [ ] Add historical plate format detection (pre-2001)
- [ ] Implement plate format migration script if needed

---

**Last Updated:** 7 January 2026  
**Status:** ✅ Implemented and Audited

