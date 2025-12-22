# VES API Key - Pending Setup

## Status
⏳ **Awaiting API Key Approval from DVLA**

Application submitted: December 22, 2025  
Expected: Within a few working days

---

## When API Key Arrives

### Step 1: Update Environment Variables

Add to `.env.local`:

```bash
# GOV.UK Vehicle Enquiry Service (VES) API
DVLA_API_PROVIDER=ves
DVLA_API_KEY=your_api_key_here
DVLA_API_BASE_URL=https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1
```

### Step 2: Add VES Provider to Service

Update `lib/services/dvla-api.ts` to add VES provider handler:

```typescript
// Add to DVLAProvider type
export type DVLAProvider = 'vehiclesmart' | 'checkcardetails' | 'vehicledataglobal' | 'ves';

// Add VES fetch method
private async fetchFromVES(reg: string): Promise<VehicleDataResponse> {
  const response = await fetch(`${this.baseUrl}/vehicles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
    },
    body: JSON.stringify({
      registrationNumber: reg,
    }),
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  const data = await response.json();
  return this.normalizeVESResponse(data);
}

// Add VES response normalizer
private normalizeVESResponse(data: any): VehicleDataResponse {
  return {
    registrationNumber: data.registrationNumber,
    taxStatus: data.taxStatus,
    taxDueDate: data.taxDueDate || null,
    motStatus: data.motStatus,
    motExpiryDate: data.motExpiryDate || null,
    make: data.make || null,
    model: data.model || null,
    colour: data.colour || null,
    yearOfManufacture: data.yearOfManufacture || null,
    engineSize: data.engineCapacity || null,
    fuelType: data.fuelType || null,
    co2Emissions: data.co2Emissions || null,
    rawData: data,
  };
}

// Add to switch statement in getVehicleData()
case 'ves':
  return await this.fetchFromVES(normalizedReg);
```

### Step 3: Test

1. Restart the application: `npm run dev`
2. Go to Maintenance module
3. Click sync button on any vehicle
4. Verify tax/MOT dates are updated

---

## Expected VES API Response Format

According to GOV.UK documentation:

```json
{
  "registrationNumber": "AB12CDE",
  "taxStatus": "Taxed",
  "taxDueDate": "2026-03-31",
  "motStatus": "Valid",
  "motExpiryDate": "2026-07-15",
  "make": "FORD",
  "model": "TRANSIT",
  "colour": "WHITE",
  "yearOfManufacture": 2018,
  "engineCapacity": 2000,
  "fuelType": "DIESEL",
  "co2Emissions": 150
}
```

---

## Benefits of Official VES API

✅ **Official DVLA data** - Direct from the source  
✅ **Free tier available** - Lower costs than third-party  
✅ **Reliable** - Government-backed uptime  
✅ **Accurate** - Real-time DVLA database  
✅ **Compliant** - Official data sharing agreement

---

## Architecture Ready

The system is already built with:
- ✅ Multi-provider support
- ✅ Database sync tracking
- ✅ UI components
- ✅ Audit logging
- ✅ Error handling

**Only 5 minutes of code needed when key arrives!**

---

## Contact

**VES API Support**: https://developer-portal.driver-vehicle-licensing.api.gov.uk/  
**DVLA API Queries**: dvlaapiaccess@dvla.gov.uk

---

**Status**: 🟡 Parked - Waiting for API key  
**Implementation**: ✅ 95% Complete  
**Documentation**: ✅ Complete  
**Testing**: ⏳ Pending API key

