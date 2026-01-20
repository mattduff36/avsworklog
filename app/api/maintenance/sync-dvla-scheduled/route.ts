// API Route: Scheduled DVLA & MOT Sync (for Vercel Cron)
// POST /api/maintenance/sync-dvla-scheduled
// Syncs all active vehicles with TAX and MOT data updated more than 6 days ago

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createDVLAApiService } from '@/lib/services/dvla-api';
import { createMotHistoryService } from '@/lib/services/mot-history-api';
import { logServerError } from '@/lib/utils/server-error-logger';
import { formatRegistrationForApi } from '@/lib/utils/registration';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max execution time

/**
 * POST /api/maintenance/sync-dvla-scheduled
 * Scheduled sync endpoint for Vercel Cron
 * 
 * Headers:
 * - Authorization: Bearer <CRON_SECRET> (for security)
 */
export async function POST(request: NextRequest) {
  try {
    // Verify cron secret for security
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const supabase = await createClient();

    // Check if DVLA API is configured
    const dvlaService = createDVLAApiService();
    if (!dvlaService) {
      console.log('DVLA API not configured - skipping scheduled sync');
      return NextResponse.json({
        success: true,
        message: 'DVLA API not configured',
        total: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
      });
    }

    // Check if MOT API is configured (optional, sync will continue if not available)
    const motService = createMotHistoryService();

    // Test vehicles to exclude from DVLA sync
    const TEST_VEHICLES = ['TE57VAN', 'TE57HGV'];
    
    // Get all active vehicles (excluding test vehicles)
    const { data: allVehicles, error: vehiclesError } = await supabase
      .from('vehicles')
      .select('id, reg_number')
      .eq('status', 'active');

    if (vehiclesError) throw vehiclesError;
    if (!allVehicles || allVehicles.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active vehicles to sync',
        total: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
      });
    }
    
    // Filter out test vehicles
    const vehicles = allVehicles.filter(v => 
      !TEST_VEHICLES.includes(v.reg_number.replace(/\s+/g, '').toUpperCase())
    );

    // Get maintenance records to check last sync times
    const { data: maintenanceRecords } = await supabase
      .from('vehicle_maintenance')
      .select('vehicle_id, last_dvla_sync')
      .in('vehicle_id', vehicles.map(v => v.id));

    const maintenanceMap = new Map(
      maintenanceRecords?.map(m => [m.vehicle_id, m.last_dvla_sync]) || []
    );

    // Filter vehicles that need syncing (not synced in last 6 days)
    const sixDaysAgo = new Date();
    sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);

    const vehiclesToSync = vehicles.filter(vehicle => {
      const lastSync = maintenanceMap.get(vehicle.id);
      if (!lastSync) return true; // Never synced
      return new Date(lastSync) < sixDaysAgo; // Synced more than 6 days ago
    });

    console.log(`Scheduled sync: ${vehiclesToSync.length}/${vehicles.length} vehicles need syncing`);

    if (vehiclesToSync.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All vehicles recently synced',
        total: vehicles.length,
        successful: 0,
        failed: 0,
        skipped: vehicles.length,
      });
    }

    // Process each vehicle with 1 second delay between requests
    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < vehiclesToSync.length; i++) {
      const vehicle = vehiclesToSync[i];
      const startTime = Date.now();

      // Remove spaces from registration number for API calls
      const regNumberNoSpaces = formatRegistrationForApi(vehicle.reg_number);

      try {
        // Fetch data from DVLA VES API (tax & vehicle details)
        const dvlaData = await dvlaService.getVehicleData(regNumberNoSpaces);
        const dvlaResponseTime = Date.now() - startTime;

        // Fetch MOT expiry data from MOT History API (if configured)
        let motExpiryData = null;
        let motResponseTime = null;
        let motApiError: string | null = null;
        if (motService) {
          try {
            const motStart = Date.now();
            motExpiryData = await motService.getMotExpiryData(regNumberNoSpaces);
            motResponseTime = Date.now() - motStart;
            console.log(`[CRON] MOT expiry for ${vehicle.reg_number}: ${motExpiryData.motExpiryDate || 'N/A'}`);
          } catch (motError: any) {
            motApiError = motError?.message || motError?.toString() || 'Unknown MOT API error';
            console.error(`[CRON] MOT API fetch failed for ${vehicle.reg_number}:`, motApiError);
            // Continue with DVLA data even if MOT fetch fails
          }
        }

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

        // Update tax due date if available
        if (dvlaData.taxDueDate) {
          updates.tax_due_date = dvlaData.taxDueDate;
          if (oldTaxDate !== dvlaData.taxDueDate) {
            fieldsUpdated.push('tax_due_date');
          }
        }

        // Update MOT due date from MOT History API (if available)
        if (motService) {
          if (motApiError) {
            // MOT API call failed with an error
            updates.mot_api_sync_status = 'error';
            updates.last_mot_api_sync = new Date().toISOString();
            updates.mot_api_sync_error = motApiError;
            console.log(`[CRON] ${vehicle.reg_number}: MOT API error: ${motApiError}`);
            
            // FALLBACK: Calculate first MOT from DVLA monthOfFirstRegistration for very new vehicles
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
                  
                  if (oldMotDate !== calculatedMotDue) {
                    fieldsUpdated.push('mot_due_date (calculated from DVLA)');
                    console.log(`[CRON] ${vehicle.reg_number}: First MOT due calculated from DVLA: ${calculatedMotDue} (3 years from ${dvlaData.monthOfFirstRegistration})`);
                  }
                }
              } catch (err) {
                console.error(`[CRON] Failed to calculate MOT due date from DVLA data:`, err);
              }
            }
          } else if (motExpiryData?.motExpiryDate || motExpiryData?.rawData) {
            const motRawData = motExpiryData.rawData;

            // Store vehicle-level MOT data
            updates.mot_make = motRawData.make || null;
            updates.mot_model = motRawData.model || null;
            updates.mot_fuel_type = motRawData.fuelType || null;
            updates.mot_primary_colour = motRawData.primaryColour || null;
            updates.mot_registration = motRawData.registration || null;
            updates.mot_year_of_manufacture = motRawData.manufactureYear ? parseInt(motRawData.manufactureYear) : null;
            // BUG FIX: Use firstUsedDate not registrationDate
            updates.mot_first_used_date = motRawData.firstUsedDate || null;

            // ALWAYS update MOT due date if API provides one (overrides manual entries)
            if (motExpiryData.motExpiryDate) {
              updates.mot_due_date = motExpiryData.motExpiryDate;
              updates.mot_expiry_date = motExpiryData.motExpiryDate;
              updates.mot_api_sync_status = 'success';
              updates.last_mot_api_sync = new Date().toISOString();
              updates.mot_api_sync_error = null;
              updates.mot_raw_data = motExpiryData.rawData || null;

              if (oldMotDate !== motExpiryData.motExpiryDate) {
                fieldsUpdated.push('mot_due_date');
                console.log(`[CRON] ${vehicle.reg_number}: MOT updated from ${oldMotDate} to ${motExpiryData.motExpiryDate}`);
              }
            } else if (motRawData?.firstUsedDate) {
              // NEW: Calculate first MOT due date for new vehicles (firstUsedDate + 3 years)
              // UK vehicles require their first MOT 3 years after first registration
              const firstUsedDate = new Date(motRawData.firstUsedDate);
              const firstMotDue = new Date(firstUsedDate);
              firstMotDue.setFullYear(firstMotDue.getFullYear() + 3);
              
              const calculatedMotDue = firstMotDue.toISOString().split('T')[0]; // YYYY-MM-DD
              updates.mot_due_date = calculatedMotDue;
              updates.mot_expiry_date = calculatedMotDue;
              updates.mot_api_sync_status = 'success';
              updates.last_mot_api_sync = new Date().toISOString();
              updates.mot_api_sync_error = null;
              updates.mot_raw_data = motExpiryData.rawData || null;
              
              if (oldMotDate !== calculatedMotDue) {
                fieldsUpdated.push('mot_due_date (calculated)');
                console.log(`[CRON] ${vehicle.reg_number}: First MOT due calculated: ${calculatedMotDue} (3 years from ${motRawData.firstUsedDate})`);
              }
            } else {
              // MOT API succeeded but returned no expiry date
              updates.mot_api_sync_status = 'success';
              updates.last_mot_api_sync = new Date().toISOString();
              updates.mot_api_sync_error = 'No MOT expiry date found';
              updates.mot_raw_data = motExpiryData?.rawData || null;
              console.log(`[CRON] ${vehicle.reg_number}: No MOT expiry date found`);
            }
          } else {
            // MOT API succeeded but returned no data
            updates.mot_api_sync_status = 'success';
            updates.last_mot_api_sync = new Date().toISOString();
            updates.mot_api_sync_error = 'No MOT history found';
            updates.mot_raw_data = motExpiryData?.rawData || null;
            console.log(`[CRON] ${vehicle.reg_number}: No MOT history found`);
          }
        }

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

        // Log sync to audit trail (dvla_sync_log)
        // Use the actual persisted mot_due_date value (which may be calculated from first registration)
        const persistedMotDate = updates.mot_due_date || null;
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
            mot_due_date_new: persistedMotDate,
            api_provider: process.env.DVLA_API_PROVIDER,
            api_response_time_ms: dvlaResponseTime,
            raw_response: dvlaData.rawData,
            triggered_by: null, // Automated sync
            trigger_type: 'automatic',
          });

        // Log to maintenance_history for visibility in vehicle history page
        const historyEntries: Array<{
          vehicle_id: string;
          field_name: string;
          old_value: string | null;
          new_value: string | null;
          value_type: 'date';
          comment: string;
          updated_by: null;
          updated_by_name: string;
        }> = [];

        // Add tax_due_date change to history if changed
        if (dvlaData.taxDueDate && oldTaxDate !== dvlaData.taxDueDate) {
          historyEntries.push({
            vehicle_id: vehicle.id,
            field_name: 'tax_due_date',
            old_value: oldTaxDate,
            new_value: dvlaData.taxDueDate,
            value_type: 'date',
            comment: `Tax due date updated automatically via scheduled DVLA API sync for ${vehicle.reg_number}`,
            updated_by: null,
            updated_by_name: 'Scheduled DVLA Sync',
          });
        }

        // Add mot_due_date change to history if changed
        // Use the same persistedMotDate value as logged to dvla_sync_log for consistency
        if (persistedMotDate && oldMotDate !== persistedMotDate) {
          const wasCalculated = fieldsUpdated.some(f => f.includes('calculated'));
          historyEntries.push({
            vehicle_id: vehicle.id,
            field_name: 'mot_due_date',
            old_value: oldMotDate,
            new_value: persistedMotDate,
            value_type: 'date',
            comment: wasCalculated 
              ? `MOT due date calculated from first registration via scheduled DVLA API sync for ${vehicle.reg_number}`
              : `MOT due date updated automatically via scheduled DVLA/MOT API sync for ${vehicle.reg_number}`,
            updated_by: null,
            updated_by_name: 'Scheduled DVLA Sync',
          });
        }

        // Insert history entries if any
        if (historyEntries.length > 0) {
          const { error: historyError } = await supabase
            .from('maintenance_history')
            .insert(historyEntries);

          if (historyError) {
            console.error(`[CRON] [WARN] Failed to create maintenance history for ${vehicle.reg_number}:`, historyError);
            // Don't fail the sync if history logging fails
          } else {
            console.log(`[CRON] ${vehicle.reg_number}: Added ${historyEntries.length} entries to maintenance history`);
          }
        }

        results.push({
          success: true,
          vehicleId: vehicle.id,
          registrationNumber: vehicle.reg_number,
          updatedFields: fieldsUpdated,
        });

        successCount++;

      } catch (error: any) {
        console.error(`Scheduled sync failed for ${vehicle.reg_number}:`, error.message);

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
            triggered_by: null,
            trigger_type: 'automatic',
          });

        results.push({
          success: false,
          vehicleId: vehicle.id,
          registrationNumber: vehicle.reg_number,
          error: error.message,
        });

        failCount++;
      }

      // Add 1 second delay between requests (except for last one)
      if (i < vehiclesToSync.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`Scheduled sync complete: ${successCount} successful, ${failCount} failed`);

    return NextResponse.json({
      success: true,
      total: vehicles.length,
      synced: vehiclesToSync.length,
      successful: successCount,
      failed: failCount,
      skipped: vehicles.length - vehiclesToSync.length,
      results,
    });

  } catch (error: any) {
    await logServerError(error, {
      endpoint: '/api/maintenance/sync-dvla-scheduled',
      method: 'POST',
    });

    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

