import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import { createDVLAApiService } from '@/lib/services/dvla-api';
import { createMotHistoryService } from '@/lib/services/mot-history-api';
import { formatRegistrationForStorage, formatRegistrationForApi, validateRegistrationNumber } from '@/lib/utils/registration';

// Helper to create admin client with service role key
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// GET - List all vehicles with category and last inspector info
export async function GET(request: NextRequest) {
  try {
    // Check effective role (respects View As mode)
    const effectiveRole = await getEffectiveRole();

    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!effectiveRole.is_manager_admin) {
      return NextResponse.json(
        { error: 'Forbidden: Manager or Admin access required' },
        { status: 403 }
      );
    }

    const supabase = await createServerClient();

    // Fetch vehicles with category info and last inspection
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select(`
        *,
        vehicle_categories (
          id,
          name
        )
      `)
      .order('reg_number');

    if (error) throw error;

    // For each vehicle, get the last inspector
    const vehiclesWithInspector = await Promise.all(
      (vehicles || []).map(async (vehicle) => {
        const { data: inspections } = await supabase
          .from('vehicle_inspections')
          .select(`
            user_id,
            inspection_date,
            profiles!vehicle_inspections_user_id_fkey (
              full_name
            )
          `)
          .eq('vehicle_id', vehicle.id)
          .order('inspection_date', { ascending: false })
          .limit(1);

        const lastInspection = inspections?.[0] || null;

        return {
          ...vehicle,
          last_inspector: lastInspection?.profiles?.full_name || null,
          last_inspection_date: lastInspection?.inspection_date || null,
        };
      })
    );

    return NextResponse.json({ vehicles: vehiclesWithInspector });
  } catch (error) {
    console.error('Error fetching vehicles:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/vehicles',
      additionalData: {
        endpoint: '/api/admin/vehicles',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Create new vehicle or plant asset
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { 
      asset_type = 'vehicle', 
      reg_number, 
      plant_id,
      category_id, 
      nickname,
      serial_number,
      year,
      weight_class,
      status = 'active'
    } = body;

    // Validate category (required for both)
    if (!category_id) {
      return NextResponse.json(
        { error: 'Category is required' },
        { status: 400 }
      );
    }

    // Branch based on asset type
    if (asset_type === 'plant') {
      // === PLANT ASSET PATH ===
      
      // Validate required fields for plant
      if (!plant_id) {
        return NextResponse.json(
          { error: 'Plant ID is required for plant assets' },
          { status: 400 }
        );
      }

      // Validate registration number if provided (optional for plant)
      let cleanReg = null;
      if (reg_number && reg_number.trim()) {
        const validationError = validateRegistrationNumber(reg_number);
        if (validationError) {
          return NextResponse.json({ error: validationError }, { status: 400 });
        }
        cleanReg = formatRegistrationForStorage(reg_number);
      }

      // Insert plant
      const { data, error } = await supabase
        .from('plant')
        .insert({
          plant_id: plant_id.trim(),
          reg_number: cleanReg,
          category_id: category_id,
          status: status,
          nickname: nickname?.trim() || null,
          serial_number: serial_number?.trim() || null,
          year: year ? parseInt(year) : null,
          weight_class: weight_class?.trim() || null,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          return NextResponse.json(
            { error: 'Plant asset with this ID already exists' },
            { status: 400 }
          );
        }
        throw error;
      }

      console.log(`[INFO] Plant asset created: ${data.plant_id} (ID: ${data.id})`);

      // Return plant data in compatible format
      return NextResponse.json({ 
        vehicle: data,
        syncResult: { success: true, skipped: true, reason: 'plant asset' },
        message: 'Plant asset created successfully'
      });

    } else {
      // === VEHICLE PATH (existing logic) ===
      
      // Validate required fields for vehicle
      if (!reg_number) {
        return NextResponse.json(
          { error: 'Registration number is required' },
          { status: 400 }
        );
      }

      // Validate and format registration number
      const validationError = validateRegistrationNumber(reg_number);
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }
      
      const cleanReg = formatRegistrationForStorage(reg_number);

      // Insert vehicle (vehicle_type will auto-sync from category via trigger)
      const { data, error } = await supabase
        .from('vehicles')
        .insert({
          reg_number: cleanReg,
          category_id: category_id,
          status: 'active',
          nickname: nickname?.trim() || null,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          return NextResponse.json(
            { error: 'Vehicle with this registration already exists' },
            { status: 400 }
          );
        }
        throw error;
      }

      console.log(`[INFO] Vehicle created: ${data.reg_number} (ID: ${data.id})`);

      // Automatically sync TAX and MOT data from APIs (non-blocking)
      const syncResult = await syncVehicleData(data.id, data.reg_number, user.id, supabase);

      return NextResponse.json({ 
        vehicle: data,
        syncResult: syncResult,
        message: syncResult.success 
          ? 'Vehicle created and data synced successfully'
          : 'Vehicle created. Note: ' + (syncResult.warning || 'API sync will retry automatically')
      });
    }
  } catch (error) {
    console.error('Error creating vehicle/plant:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/vehicles',
      additionalData: {
        endpoint: '/api/admin/vehicles',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Sync vehicle data from DVLA and MOT APIs
 * This runs automatically when a new vehicle is added
 */
async function syncVehicleData(
  vehicleId: string, 
  regNumber: string, 
  userId: string,
  supabase: any
) {
  const TEST_VEHICLES = ['TE57VAN', 'TE57HGV'];
  
  // Remove spaces for API calls (APIs don't accept spaces)
  const regNumberNoSpaces = formatRegistrationForApi(regNumber);
  
  // Skip sync for test vehicles
  if (TEST_VEHICLES.includes(regNumberNoSpaces)) {
    console.log(`[INFO] Skipping API sync for test vehicle: ${regNumber}`);
    return { 
      success: true, 
      skipped: true,
      reason: 'test vehicle' 
    };
  }

  // Check if APIs are configured
  const dvlaService = createDVLAApiService();
  if (!dvlaService) {
    console.log(`[WARN] DVLA API not configured, skipping auto-sync for ${regNumber}`);
    return { 
      success: false, 
      warning: 'DVLA API not configured' 
    };
  }

  const motService = createMotHistoryService();
  const startTime = Date.now();

  try {
    // Fetch DVLA data (use registration without spaces for API)
    console.log(`[INFO] Auto-syncing DVLA data for new vehicle: ${regNumber}`);
    const dvlaData = await dvlaService.getVehicleData(regNumberNoSpaces);
    console.log(`[INFO] DVLA data retrieved for ${regNumber}, tax due: ${dvlaData.taxDueDate || 'N/A'}`);

    // Fetch MOT data (if service available, use registration without spaces for API)
    let motExpiryData = null;
    let motApiError: string | null = null;
    if (motService) {
      try {
        console.log(`[INFO] Auto-syncing MOT data for new vehicle: ${regNumber}`);
        motExpiryData = await motService.getMotExpiryData(regNumberNoSpaces);
        console.log(`[INFO] MOT data retrieved for ${regNumber}, MOT due: ${motExpiryData.motExpiryDate || 'N/A'}`);
      } catch (motError: any) {
        motApiError = motError?.message || 'MOT API error';
        console.error(`[WARN] MOT API failed for ${regNumber}:`, motApiError);
        // Continue with DVLA data even if MOT fails
      }
    }

    const responseTime = Date.now() - startTime;

    // Prepare maintenance record update
    const updates: any = {
      dvla_sync_status: 'success',
      last_dvla_sync: new Date().toISOString(),
      dvla_sync_error: null,
      dvla_raw_data: dvlaData.rawData || null,
      
      // Store all VES vehicle data
      ves_make: dvlaData.make || null,
      ves_colour: dvlaData.colour || null,
      ves_fuel_type: dvlaData.fuelType || null,
      ves_year_of_manufacture: dvlaData.yearOfManufacture || null,
      ves_engine_capacity: dvlaData.engineSize || null,
      ves_tax_status: dvlaData.taxStatus || null,
      ves_mot_status: dvlaData.motStatus || null,
      ves_co2_emissions: dvlaData.co2Emissions || null,
      ves_euro_status: dvlaData.euroStatus || null,
      ves_real_driving_emissions: dvlaData.realDrivingEmissions || null,
      ves_type_approval: dvlaData.typeApproval || null,
      ves_wheelplan: dvlaData.wheelplan || null,
      ves_revenue_weight: dvlaData.revenueWeight || null,
      ves_marked_for_export: dvlaData.markedForExport || false,
      ves_month_of_first_registration: dvlaData.monthOfFirstRegistration || null,
      ves_date_of_last_v5c_issued: dvlaData.dateOfLastV5CIssued || null,
    };

    const fieldsUpdated: string[] = [];

    // Update tax due date
    if (dvlaData.taxDueDate) {
      updates.tax_due_date = dvlaData.taxDueDate;
      fieldsUpdated.push('tax_due_date');
    }

    // Update MOT data if available
    if (motService) {
      if (motApiError) {
        updates.mot_api_sync_status = 'error';
        updates.last_mot_api_sync = new Date().toISOString();
        updates.mot_api_sync_error = motApiError;
        console.log(`[WARN] ${regNumber}: MOT API error: ${motApiError}`);
        
        // FALLBACK: Calculate first MOT from DVLA monthOfFirstRegistration for very new vehicles
        if (motApiError.includes('No MOT history found') && dvlaData.monthOfFirstRegistration) {
          try {
            // monthOfFirstRegistration format: "YYYY.MM"
            const [year, month] = dvlaData.monthOfFirstRegistration.split('.');
            if (year && month) {
              const firstRegDate = new Date(parseInt(year), parseInt(month) - 1, 1);
              const firstMotDue = new Date(firstRegDate);
              firstMotDue.setFullYear(firstMotDue.getFullYear() + 3);
              
              const calculatedMotDue = firstMotDue.toISOString().split('T')[0];
              updates.mot_due_date = calculatedMotDue;
              updates.mot_expiry_date = calculatedMotDue;
              updates.mot_first_used_date = firstRegDate.toISOString().split('T')[0];
              fieldsUpdated.push('mot_due_date (calculated from DVLA)');
              console.log(`[INFO] ${regNumber}: First MOT due calculated from DVLA: ${calculatedMotDue} (3 years from ${dvlaData.monthOfFirstRegistration})`);
            }
          } catch (err) {
            console.error(`[ERROR] Failed to calculate MOT due date from DVLA data:`, err);
          }
        }
      } else if (motExpiryData?.motExpiryDate || motExpiryData?.rawData) {
        const motRawData = motExpiryData.rawData;
        
        if (motRawData) {
          updates.mot_make = motRawData.make || null;
          updates.mot_model = motRawData.model || null;
          updates.mot_fuel_type = motRawData.fuelType || null;
          updates.mot_primary_colour = motRawData.primaryColour || null;
          updates.mot_registration = motRawData.registration || null;
          
          if (motRawData.manufactureYear) {
            updates.mot_year_of_manufacture = parseInt(motRawData.manufactureYear);
          }
          // BUG FIX: Use firstUsedDate not registrationDate
          if (motRawData.firstUsedDate) {
            updates.mot_first_used_date = motRawData.firstUsedDate;
          }
        }
        
        if (motExpiryData.motExpiryDate) {
          updates.mot_due_date = motExpiryData.motExpiryDate;
          updates.mot_expiry_date = motExpiryData.motExpiryDate;
          fieldsUpdated.push('mot_due_date');
        } else if (motRawData?.firstUsedDate) {
          // NEW: Calculate first MOT due date for new vehicles (firstUsedDate + 3 years)
          // UK vehicles require their first MOT 3 years after first registration
          const firstUsedDate = new Date(motRawData.firstUsedDate);
          const firstMotDue = new Date(firstUsedDate);
          firstMotDue.setFullYear(firstMotDue.getFullYear() + 3);
          
          const calculatedMotDue = firstMotDue.toISOString().split('T')[0]; // YYYY-MM-DD
          updates.mot_due_date = calculatedMotDue;
          updates.mot_expiry_date = calculatedMotDue;
          fieldsUpdated.push('mot_due_date (calculated from MOT API)');
          console.log(`[INFO] ${regNumber}: First MOT due calculated from MOT API: ${calculatedMotDue} (3 years from ${motRawData.firstUsedDate})`);
        }
        
        updates.mot_api_sync_status = 'success';
        updates.last_mot_api_sync = new Date().toISOString();
        updates.mot_api_sync_error = null;
        updates.mot_raw_data = motRawData || null;
      } else {
        updates.mot_api_sync_status = 'success';
        updates.last_mot_api_sync = new Date().toISOString();
        updates.mot_api_sync_error = 'No MOT history found';
      }
    }

    console.log(`[INFO] ${regNumber}: Auto-sync completed, fields: ${fieldsUpdated.join(', ') || 'none'}`);

    // Upsert vehicle_maintenance record
    const { error: upsertError } = await supabase
      .from('vehicle_maintenance')
      .upsert({
        vehicle_id: vehicleId,
        ...updates,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'vehicle_id'
      });

    if (upsertError) {
      console.error(`[ERROR] Failed to save maintenance data for ${regNumber}:`, upsertError);
      throw upsertError;
    }

    // Log sync to audit trail
    await supabase
      .from('dvla_sync_log')
      .insert({
        vehicle_id: vehicleId,
        registration_number: regNumber,
        sync_status: 'success',
        fields_updated: fieldsUpdated,
        tax_due_date_new: dvlaData.taxDueDate,
        mot_due_date_new: motExpiryData?.motExpiryDate || null,
        api_provider: `${process.env.DVLA_API_PROVIDER}${motService ? '+MOT' : ''}`,
        api_response_time_ms: responseTime,
        raw_response: {
          dvla: dvlaData.rawData,
          mot: motExpiryData?.rawData || null,
        },
        triggered_by: userId,
        trigger_type: 'auto_on_create',
      });

    return {
      success: true,
      fieldsUpdated,
      taxDueDate: dvlaData.taxDueDate || null,
      motDueDate: motExpiryData?.motExpiryDate || null,
      responseTime
    };

  } catch (error: any) {
    console.error(`[ERROR] Auto-sync failed for ${regNumber}:`, error.message);

    // Update status to error but don't fail vehicle creation
    await supabase
      .from('vehicle_maintenance')
      .upsert({
        vehicle_id: vehicleId,
        dvla_sync_status: 'error',
        dvla_sync_error: error.message,
        last_dvla_sync: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'vehicle_id'
      });

    // Log error to audit trail
    await supabase
      .from('dvla_sync_log')
      .insert({
        vehicle_id: vehicleId,
        registration_number: regNumber,
        sync_status: 'error',
        error_message: error.message,
        api_provider: process.env.DVLA_API_PROVIDER,
        triggered_by: userId,
        trigger_type: 'auto_on_create',
      });

    // Log to application error logger
    await logServerError({
      error: error as Error,
      componentName: 'syncVehicleData',
      additionalData: {
        vehicleId,
        regNumber,
        context: 'auto_sync_on_vehicle_create'
      },
    });

    return {
      success: false,
      error: error.message,
      warning: 'Could not fetch vehicle data from DVLA/MOT APIs. Please check the registration number or try manual sync later.'
    };
  }
}

