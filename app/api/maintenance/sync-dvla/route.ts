// API Route: Sync Vehicle Data from DVLA
// POST /api/maintenance/sync-dvla
// Syncs vehicle tax and MOT data from DVLA API

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createDVLAApiService } from '@/lib/services/dvla-api';
import { createMotHistoryService } from '@/lib/services/mot-history-api';
import { logServerError } from '@/lib/utils/server-error-logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/maintenance/sync-dvla
 * Sync vehicle data from DVLA API for one or multiple vehicles
 * 
 * Body:
 * - vehicleId: string (optional) - Sync single vehicle
 * - vehicleIds: string[] (optional) - Sync multiple vehicles
 * - syncAll: boolean (optional) - Sync all active vehicles
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if DVLA API is configured
    const dvlaService = createDVLAApiService();
    if (!dvlaService) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'DVLA API not configured',
          message: 'Please configure DVLA_API_PROVIDER, DVLA_API_KEY, and DVLA_API_BASE_URL in .env.local'
        },
        { status: 503 }
      );
    }

    // Check if MOT API is configured (optional, sync will continue if not available)
    const motService = createMotHistoryService();

    const body = await request.json();
    const { vehicleId, vehicleIds, syncAll } = body;

    // Test vehicles to exclude from DVLA sync
    const TEST_VEHICLES = ['TE57VAN', 'TE57HGV'];
    
    // Determine which vehicles to sync
    let vehiclesToSync: Array<{ id: string; reg_number: string }> = [];

    if (syncAll) {
      // Sync all active vehicles (excluding test vehicles)
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('id, reg_number')
        .eq('status', 'active');

      if (error) throw error;
      
      // Filter out test vehicles
      vehiclesToSync = (vehicles || []).filter(v => 
        !TEST_VEHICLES.includes(v.reg_number.replace(/\s+/g, '').toUpperCase())
      );
    } else if (vehicleIds && Array.isArray(vehicleIds)) {
      // Sync multiple specific vehicles (excluding test vehicles)
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('id, reg_number')
        .in('id', vehicleIds);

      if (error) throw error;
      
      // Filter out test vehicles
      vehiclesToSync = (vehicles || []).filter(v => 
        !TEST_VEHICLES.includes(v.reg_number.replace(/\s+/g, '').toUpperCase())
      );
    } else if (vehicleId) {
      // Sync single vehicle
      const { data: vehicle, error } = await supabase
        .from('vehicles')
        .select('id, reg_number')
        .eq('id', vehicleId)
        .single();

      if (error) throw error;
      
      // Check if it's a test vehicle
      if (vehicle && !TEST_VEHICLES.includes(vehicle.reg_number.replace(/\s+/g, '').toUpperCase())) {
        vehiclesToSync = [vehicle];
      }
    } else {
      return NextResponse.json(
        { success: false, error: 'No vehicles specified' },
        { status: 400 }
      );
    }

    if (vehiclesToSync.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No vehicles found' },
        { status: 404 }
      );
    }

    // Process each vehicle
    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const vehicle of vehiclesToSync) {
      const startTime = Date.now();
      
      // Remove spaces from registration number for API calls
      const regNumberNoSpaces = vehicle.reg_number.replace(/\s+/g, '');
      
      try {
        // Fetch data from DVLA VES API (tax & vehicle details)
        console.log(`[INFO] Fetching VES data for ${vehicle.reg_number}`);
        const dvlaData = await dvlaService.getVehicleData(regNumberNoSpaces);
        const dvlaResponseTime = Date.now() - startTime;
        console.log(`[INFO] VES data retrieved for ${vehicle.reg_number}, tax due: ${dvlaData.taxDueDate || 'N/A'}`);

        // Fetch MOT expiry data from MOT History API (if configured)
        let motExpiryData = null;
        let motResponseTime = null;
        let motApiError: string | null = null;
        if (motService) {
          try {
            const motStart = Date.now();
            motExpiryData = await motService.getMotExpiryData(regNumberNoSpaces);
            motResponseTime = Date.now() - motStart;
            console.log(`[INFO] MOT expiry for ${vehicle.reg_number}: ${motExpiryData.motExpiryDate || 'N/A'}`);
          } catch (motError: any) {
            // Ensure we always capture a non-empty error message
            motApiError = motError?.message || motError?.toString() || 'Unknown MOT API error';
            console.error(`MOT API fetch failed for ${vehicle.reg_number}:`, motApiError);
            // Continue with DVLA data even if MOT fetch fails
          }
        }

        const responseTime = Date.now() - startTime;

        // Get existing maintenance record
        const { data: existingRecord } = await supabase
          .from('vehicle_maintenance')
          .select('tax_due_date, mot_due_date')
          .eq('vehicle_id', vehicle.id)
          .single();

        const oldTaxDate = existingRecord?.tax_due_date || null;
        const oldMotDate = existingRecord?.mot_due_date || null;

        // Prepare update data
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

        // Update tax due date if available from DVLA VES
        if (dvlaData.taxDueDate) {
          updates.tax_due_date = dvlaData.taxDueDate;
          if (oldTaxDate !== dvlaData.taxDueDate) {
            fieldsUpdated.push('tax_due_date');
            console.log(`[INFO] ${vehicle.reg_number}: Tax updated from ${oldTaxDate} to ${dvlaData.taxDueDate}`);
          } else {
            console.log(`[INFO] ${vehicle.reg_number}: Tax unchanged (${oldTaxDate})`);
          }
        } else {
          console.log(`[WARN] ${vehicle.reg_number}: No tax due date from VES API`);
        }

        // Update MOT due date from MOT History API (if available)
        if (motService) {
          if (motApiError) {
            // MOT API call failed with an error
            updates.mot_api_sync_status = 'error';
            updates.last_mot_api_sync = new Date().toISOString();
            updates.mot_api_sync_error = motApiError;
            console.log(`[ERROR] ${vehicle.reg_number}: MOT API error: ${motApiError}`);
          } else if (motExpiryData?.motExpiryDate || motExpiryData?.rawData) {
            // MOT API succeeded - update vehicle-level data from API
            const motRawData = motExpiryData.rawData;
            
            if (motRawData) {
              // Store vehicle-level MOT data
              updates.mot_make = motRawData.make || null;
              updates.mot_model = motRawData.model || null;
              updates.mot_fuel_type = motRawData.fuelType || null;
              updates.mot_primary_colour = motRawData.primaryColour || null;
              updates.mot_registration = motRawData.registration || null;
              
              // Additional fields from MOT API
              if (motRawData.manufactureYear) updates.mot_year_of_manufacture = parseInt(motRawData.manufactureYear);
              if (motRawData.registrationDate) updates.mot_first_used_date = motRawData.registrationDate;
            }
            
            // Always update MOT due date if API provides one (overrides manual entries)
            if (motExpiryData.motExpiryDate) {
              updates.mot_due_date = motExpiryData.motExpiryDate;
              updates.mot_expiry_date = motExpiryData.motExpiryDate;
              
              if (oldMotDate !== motExpiryData.motExpiryDate) {
                fieldsUpdated.push('mot_due_date');
                console.log(`[INFO] ${vehicle.reg_number}: MOT updated from ${oldMotDate} to ${motExpiryData.motExpiryDate}`);
              } else {
                console.log(`[INFO] ${vehicle.reg_number}: MOT unchanged (${oldMotDate})`);
              }
            }
            
            updates.mot_api_sync_status = 'success';
            updates.last_mot_api_sync = new Date().toISOString();
            updates.mot_api_sync_error = null;
            updates.mot_raw_data = motRawData || null;
          } else {
            // MOT API succeeded but returned no data
            updates.mot_api_sync_status = 'success';
            updates.last_mot_api_sync = new Date().toISOString();
            updates.mot_api_sync_error = 'No MOT history found';
            updates.mot_raw_data = motExpiryData?.rawData || null;
            console.log(`[WARN] ${vehicle.reg_number}: No MOT expiry date found`);
          }
        }
        
        console.log(`[INFO] ${vehicle.reg_number}: Fields updated: ${fieldsUpdated.length > 0 ? fieldsUpdated.join(', ') : 'none (data up to date)'}`);


        // Upsert vehicle_maintenance record
        const { error: upsertError } = await supabase
          .from('vehicle_maintenance')
          .upsert({
            vehicle_id: vehicle.id,
            ...updates,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'vehicle_id'
          });

        if (upsertError) throw upsertError;

        // Log sync to audit trail
        await supabase
          .from('dvla_sync_log')
          .insert({
            vehicle_id: vehicle.id,
            registration_number: vehicle.reg_number,
            sync_status: 'success',
            fields_updated: fieldsUpdated,
            tax_due_date_old: oldTaxDate,
            tax_due_date_new: dvlaData.taxDueDate,
            mot_due_date_old: oldMotDate,
            mot_due_date_new: motExpiryData?.motExpiryDate || null,
            api_provider: `${process.env.DVLA_API_PROVIDER}${motService ? '+MOT' : ''}`,
            api_response_time_ms: responseTime,
            raw_response: {
              dvla: dvlaData.rawData,
              mot: motExpiryData?.rawData || null,
            },
            triggered_by: user.id,
            trigger_type: syncAll ? 'bulk' : (vehicleIds ? 'bulk' : 'manual'),
          });

        results.push({
          success: true,
          vehicleId: vehicle.id,
          registrationNumber: vehicle.reg_number,
          updatedFields: fieldsUpdated,
          syncedAt: new Date().toISOString(),
        });

        successCount++;

      } catch (error: any) {
        console.error(`DVLA sync failed for ${vehicle.reg_number}:`, error.message);

        // Update status to error
        await supabase
          .from('vehicle_maintenance')
          .upsert({
            vehicle_id: vehicle.id,
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
            vehicle_id: vehicle.id,
            registration_number: vehicle.reg_number,
            sync_status: 'error',
            error_message: error.message,
            api_provider: process.env.DVLA_API_PROVIDER,
            triggered_by: user.id,
            trigger_type: syncAll ? 'bulk' : (vehicleIds ? 'bulk' : 'manual'),
          });

        results.push({
          success: false,
          vehicleId: vehicle.id,
          registrationNumber: vehicle.reg_number,
          errors: [error.message],
          syncedAt: new Date().toISOString(),
        });

        failCount++;
      }
    }

    return NextResponse.json({
      success: true,
      total: vehiclesToSync.length,
      successful: successCount,
      failed: failCount,
      results,
    });

  } catch (error: any) {
    await logServerError(error, {
      endpoint: '/api/maintenance/sync-dvla',
      method: 'POST',
    });

    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

