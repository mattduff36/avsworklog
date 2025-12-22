// API Route: Sync Vehicle Data from DVLA
// POST /api/maintenance/sync-dvla
// Syncs vehicle tax and MOT data from DVLA API

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createDVLAApiService } from '@/lib/services/dvla-api';
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

    const body = await request.json();
    const { vehicleId, vehicleIds, syncAll } = body;

    // Determine which vehicles to sync
    let vehiclesToSync: Array<{ id: string; reg_number: string }> = [];

    if (syncAll) {
      // Sync all active vehicles
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('id, reg_number')
        .eq('status', 'active');

      if (error) throw error;
      vehiclesToSync = vehicles || [];
    } else if (vehicleIds && Array.isArray(vehicleIds)) {
      // Sync multiple specific vehicles
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('id, reg_number')
        .in('id', vehicleIds);

      if (error) throw error;
      vehiclesToSync = vehicles || [];
    } else if (vehicleId) {
      // Sync single vehicle
      const { data: vehicle, error } = await supabase
        .from('vehicles')
        .select('id, reg_number')
        .eq('id', vehicleId)
        .single();

      if (error) throw error;
      if (vehicle) vehiclesToSync = [vehicle];
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
      
      try {
        // Fetch data from DVLA API
        const dvlaData = await dvlaService.getVehicleData(vehicle.reg_number);
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
        };

        const fieldsUpdated: string[] = [];

        // Update tax due date if available
        if (dvlaData.taxDueDate) {
          updates.tax_due_date = dvlaData.taxDueDate;
          if (oldTaxDate !== dvlaData.taxDueDate) {
            fieldsUpdated.push('tax_due_date');
          }
        }

        // Update MOT due date if available
        if (dvlaData.motExpiryDate) {
          updates.mot_due_date = dvlaData.motExpiryDate;
          if (oldMotDate !== dvlaData.motExpiryDate) {
            fieldsUpdated.push('mot_due_date');
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
            mot_due_date_old: oldMotDate,
            mot_due_date_new: dvlaData.motExpiryDate,
            api_provider: process.env.DVLA_API_PROVIDER,
            api_response_time_ms: responseTime,
            raw_response: dvlaData.rawData,
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

