import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import { createDVLAApiService } from '@/lib/services/dvla-api';
import { createMotHistoryService } from '@/lib/services/mot-history-api';
import { formatRegistrationForStorage, formatRegistrationForApi, validateRegistrationNumber } from '@/lib/utils/registration';

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

// GET - List all vans with category and last inspector info
export async function GET(request: NextRequest) {
  try {
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

    const { data: vehicles, error } = await supabase
      .from('vans')
      .select(`
        *,
        van_categories (
          id,
          name
        )
      `)
      .order('reg_number');

    if (error) throw error;

    // For each van, get the last inspector
    const vehiclesWithInspector = await Promise.all(
      (vehicles || []).map(async (vehicle) => {
        const { data: inspections } = await supabase
          .from('van_inspections')
          .select(`
            user_id,
            inspection_date,
            profiles!vehicle_inspections_user_id_fkey (
              full_name
            )
          `)
          .eq('van_id', vehicle.id)
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
    console.error('Error fetching vans:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/vans',
      additionalData: {
        endpoint: '/api/admin/vans',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Create new van
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
      reg_number, 
      category_id, 
      nickname,
      status = 'active'
    } = body;

    if (!category_id) {
      return NextResponse.json(
        { error: 'Category is required' },
        { status: 400 }
      );
    }

    if (!reg_number) {
      return NextResponse.json(
        { error: 'Registration number is required' },
        { status: 400 }
      );
    }

    const validationError = validateRegistrationNumber(reg_number);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
    
    const cleanReg = formatRegistrationForStorage(reg_number);

    const { data, error } = await supabase
      .from('vans')
      .insert({
        reg_number: cleanReg,
        category_id: category_id,
        status: status,
        nickname: nickname?.trim() || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Van with this registration already exists' },
          { status: 400 }
        );
      }
      throw error;
    }

    console.log(`[INFO] Van created: ${data.reg_number} (ID: ${data.id})`);

    // Automatically sync TAX and MOT data from APIs (non-blocking)
    const syncResult = await syncVanData(data.id, data.reg_number, user.id, supabase);

    return NextResponse.json({ 
      vehicle: data,
      syncResult: syncResult,
      message: syncResult.success 
        ? 'Van created and data synced successfully'
        : 'Van created. Note: ' + (syncResult.warning || 'API sync will retry automatically')
    });
  } catch (error) {
    console.error('Error creating van:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/vans',
      additionalData: {
        endpoint: '/api/admin/vans',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Sync van data from DVLA and MOT APIs
 * Runs automatically when a new van is added
 */
async function syncVanData(
  vanId: string, 
  regNumber: string, 
  userId: string,
  supabase: any
) {
  const TEST_VEHICLES = ['TE57VAN', 'TE57HGV'];
  
  const regNumberNoSpaces = formatRegistrationForApi(regNumber);
  
  if (TEST_VEHICLES.includes(regNumberNoSpaces)) {
    console.log(`[INFO] Skipping API sync for test van: ${regNumber}`);
    return { 
      success: true, 
      skipped: true,
      reason: 'test vehicle' 
    };
  }

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
    console.log(`[INFO] Auto-syncing DVLA data for new van: ${regNumber}`);
    const dvlaData = await dvlaService.getVehicleData(regNumberNoSpaces);
    console.log(`[INFO] DVLA data retrieved for ${regNumber}, tax due: ${dvlaData.taxDueDate || 'N/A'}`);

    let motExpiryData = null;
    let motApiError: string | null = null;
    if (motService) {
      try {
        console.log(`[INFO] Auto-syncing MOT data for new van: ${regNumber}`);
        motExpiryData = await motService.getMotExpiryData(regNumberNoSpaces);
        console.log(`[INFO] MOT data retrieved for ${regNumber}, MOT due: ${motExpiryData.motExpiryDate || 'N/A'}`);
      } catch (motError: any) {
        motApiError = motError?.message || 'MOT API error';
        console.error(`[WARN] MOT API failed for ${regNumber}:`, motApiError);
      }
    }

    const responseTime = Date.now() - startTime;

    const updates: any = {
      dvla_sync_status: 'success',
      last_dvla_sync: new Date().toISOString(),
      dvla_sync_error: null,
      dvla_raw_data: dvlaData.rawData || null,
      
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

    if (dvlaData.taxDueDate) {
      updates.tax_due_date = dvlaData.taxDueDate;
      fieldsUpdated.push('tax_due_date');
    }

    if (motService) {
      if (motApiError) {
        updates.mot_api_sync_status = 'error';
        updates.last_mot_api_sync = new Date().toISOString();
        updates.mot_api_sync_error = motApiError;
        console.log(`[WARN] ${regNumber}: MOT API error: ${motApiError}`);
        
        if (motApiError.includes('No MOT history found') && dvlaData.monthOfFirstRegistration) {
          try {
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
          if (motRawData.firstUsedDate) {
            updates.mot_first_used_date = motRawData.firstUsedDate;
          }
        }
        
        if (motExpiryData.motExpiryDate) {
          updates.mot_due_date = motExpiryData.motExpiryDate;
          updates.mot_expiry_date = motExpiryData.motExpiryDate;
          fieldsUpdated.push('mot_due_date');
        } else if (motRawData?.firstUsedDate) {
          const firstUsedDate = new Date(motRawData.firstUsedDate);
          const firstMotDue = new Date(firstUsedDate);
          firstMotDue.setFullYear(firstMotDue.getFullYear() + 3);
          
          const calculatedMotDue = firstMotDue.toISOString().split('T')[0];
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

    const { error: upsertError } = await supabase
      .from('vehicle_maintenance')
      .upsert({
        van_id: vanId,
        ...updates,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'van_id'
      });

    if (upsertError) {
      console.error(`[ERROR] Failed to save maintenance data for ${regNumber}:`, upsertError);
      throw upsertError;
    }

    await supabase
      .from('dvla_sync_log')
      .insert({
        van_id: vanId,
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

    await supabase
      .from('vehicle_maintenance')
      .upsert({
        van_id: vanId,
        dvla_sync_status: 'error',
        dvla_sync_error: error.message,
        last_dvla_sync: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'van_id'
      });

    await supabase
      .from('dvla_sync_log')
      .insert({
        van_id: vanId,
        registration_number: regNumber,
        sync_status: 'error',
        error_message: error.message,
        api_provider: process.env.DVLA_API_PROVIDER,
        triggered_by: userId,
        trigger_type: 'auto_on_create',
      });

    await logServerError({
      error: error as Error,
      componentName: 'syncVanData',
      additionalData: {
        vanId,
        regNumber,
        context: 'auto_sync_on_van_create'
      },
    });

    return {
      success: false,
      error: error.message,
      warning: 'Could not fetch vehicle data from DVLA/MOT APIs. Please check the registration number or try manual sync later.'
    };
  }
}
