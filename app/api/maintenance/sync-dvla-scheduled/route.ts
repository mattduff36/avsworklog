// API Route: Scheduled DVLA Sync (for Vercel Cron)
// POST /api/maintenance/sync-dvla-scheduled
// Syncs all active vehicles with tax dates updated more than 6 days ago

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createDVLAApiService } from '@/lib/services/dvla-api';
import { logServerError } from '@/lib/utils/server-error-logger';

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

      try {
        // Fetch data from DVLA API
        const dvlaData = await dvlaService.getVehicleData(vehicle.reg_number);
        const responseTime = Date.now() - startTime;

        // Get existing maintenance record
        const { data: existingRecord } = await supabase
          .from('vehicle_maintenance')
          .select('tax_due_date')
          .eq('vehicle_id', vehicle.id)
          .single();

        const oldTaxDate = existingRecord?.tax_due_date || null;

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
            api_provider: process.env.DVLA_API_PROVIDER,
            api_response_time_ms: responseTime,
            raw_response: dvlaData.rawData,
            triggered_by: null, // Automated sync
            trigger_type: 'automatic',
          });

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

