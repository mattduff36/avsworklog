import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils/logger';
import type { UpdateMaintenanceRequest } from '@/types/maintenance';

/**
 * POST /api/maintenance/by-vehicle/[vehicleId]
 * Create or update maintenance record by vehicle ID
 * This endpoint is used when completing workshop tasks that need to update maintenance fields
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ vehicleId: string }> }
) {
  try {
    const { vehicleId } = await params;

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user profile for name
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    const userName = profile?.full_name || 'Unknown User';

    // Parse request body
    const body: UpdateMaintenanceRequest & { vehicle_id?: string } =
      await request.json();

    // Validate comment (mandatory, min 10 characters)
    if (!body.comment || body.comment.trim().length < 10) {
      return NextResponse.json(
        {
          error: 'Comment is required and must be at least 10 characters',
        },
        { status: 400 }
      );
    }

    // Check if maintenance record exists for this vehicle
    const { data: existingRecord, error: fetchError } = await supabase
      .from('vehicle_maintenance')
      .select('id, vehicle_id, current_mileage, tax_due_date, mot_due_date, first_aid_kit_expiry, next_service_mileage, last_service_mileage, cambelt_due_mileage, tracker_id, notes')
      .eq('vehicle_id', vehicleId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 = no rows returned (expected if no record exists)
      logger.error('Failed to fetch maintenance record', fetchError);
      throw fetchError;
    }

    const isNewRecord = !existingRecord;

    // Track which fields changed for history
    const changedFields: Array<{
      field_name: string;
      old_value: string | null;
      new_value: string | null;
      value_type: 'date' | 'mileage' | 'boolean' | 'text';
    }> = [];

    // Build update payload
    const updates: Record<string, string | number | boolean | null> = {
      last_updated_by: user.id,
      last_updated_at: new Date().toISOString(),
    };

    // Check each field for changes
    if (body.current_mileage !== undefined) {
      updates.current_mileage = body.current_mileage;
      if (isNewRecord || existingRecord.current_mileage !== body.current_mileage) {
        changedFields.push({
          field_name: 'current_mileage',
          old_value: existingRecord?.current_mileage?.toString() || null,
          new_value: body.current_mileage?.toString() || null,
          value_type: 'mileage',
        });
      }
    }

    if (body.tax_due_date !== undefined) {
      updates.tax_due_date = body.tax_due_date;
      if (isNewRecord || existingRecord.tax_due_date !== body.tax_due_date) {
        changedFields.push({
          field_name: 'tax_due_date',
          old_value: existingRecord?.tax_due_date || null,
          new_value: body.tax_due_date || null,
          value_type: 'date',
        });
      }
    }

    if (body.mot_due_date !== undefined) {
      updates.mot_due_date = body.mot_due_date;
      if (isNewRecord || existingRecord.mot_due_date !== body.mot_due_date) {
        changedFields.push({
          field_name: 'mot_due_date',
          old_value: existingRecord?.mot_due_date || null,
          new_value: body.mot_due_date || null,
          value_type: 'date',
        });
      }
    }

    if (body.first_aid_kit_expiry !== undefined) {
      updates.first_aid_kit_expiry = body.first_aid_kit_expiry;
      if (
        isNewRecord ||
        existingRecord.first_aid_kit_expiry !== body.first_aid_kit_expiry
      ) {
        changedFields.push({
          field_name: 'first_aid_kit_expiry',
          old_value: existingRecord?.first_aid_kit_expiry || null,
          new_value: body.first_aid_kit_expiry || null,
          value_type: 'date',
        });
      }
    }

    if (body.next_service_mileage !== undefined) {
      updates.next_service_mileage = body.next_service_mileage;
      if (
        isNewRecord ||
        existingRecord.next_service_mileage !== body.next_service_mileage
      ) {
        changedFields.push({
          field_name: 'next_service_mileage',
          old_value: existingRecord?.next_service_mileage?.toString() || null,
          new_value: body.next_service_mileage?.toString() || null,
          value_type: 'mileage',
        });
      }
    }

    if (body.last_service_mileage !== undefined) {
      updates.last_service_mileage = body.last_service_mileage;
      if (
        isNewRecord ||
        existingRecord.last_service_mileage !== body.last_service_mileage
      ) {
        changedFields.push({
          field_name: 'last_service_mileage',
          old_value: existingRecord?.last_service_mileage?.toString() || null,
          new_value: body.last_service_mileage?.toString() || null,
          value_type: 'mileage',
        });
      }
    }

    if (body.cambelt_due_mileage !== undefined) {
      updates.cambelt_due_mileage = body.cambelt_due_mileage;
      if (
        isNewRecord ||
        existingRecord.cambelt_due_mileage !== body.cambelt_due_mileage
      ) {
        changedFields.push({
          field_name: 'cambelt_due_mileage',
          old_value: existingRecord?.cambelt_due_mileage?.toString() || null,
          new_value: body.cambelt_due_mileage?.toString() || null,
          value_type: 'mileage',
        });
      }
    }

    if (body.tracker_id !== undefined) {
      updates.tracker_id = body.tracker_id;
      if (isNewRecord || existingRecord.tracker_id !== body.tracker_id) {
        changedFields.push({
          field_name: 'tracker_id',
          old_value: existingRecord?.tracker_id || null,
          new_value: body.tracker_id || null,
          value_type: 'text',
        });
      }
    }

    if (body.notes !== undefined) {
      updates.notes = body.notes;
      if (isNewRecord || existingRecord.notes !== body.notes) {
        changedFields.push({
          field_name: 'notes',
          old_value: existingRecord?.notes || null,
          new_value: body.notes || null,
          value_type: 'text',
        });
      }
    }

    // Create or update maintenance record
    let maintenanceRecord;

    if (isNewRecord) {
      // Create new record
      const { data: created, error: createError } = await supabase
        .from('vehicle_maintenance')
        .insert({
          vehicle_id: vehicleId,
          ...updates,
        })
        .select()
        .single();

      if (createError) {
        logger.error('Failed to create maintenance record', createError);
        throw createError;
      }

      maintenanceRecord = created;
    } else {
      // Update existing record
      const { data: updated, error: updateError } = await supabase
        .from('vehicle_maintenance')
        .update(updates)
        .eq('id', existingRecord.id)
        .select()
        .single();

      if (updateError) {
        logger.error('Failed to update maintenance record', updateError);
        throw updateError;
      }

      maintenanceRecord = updated;
    }

    // Create history entries for all changed fields
    if (changedFields.length > 0) {
      const historyEntries = changedFields.map((change) => ({
        vehicle_id: vehicleId,
        field_name: change.field_name,
        old_value: change.old_value,
        new_value: change.new_value,
        value_type: change.value_type,
        comment: body.comment.trim(),
        updated_by: user.id,
        updated_by_name: userName,
      }));

      const { error: historyError } = await supabase
        .from('maintenance_history')
        .insert(historyEntries);

      if (historyError) {
        logger.error('Failed to create history entries', historyError);
        // Don't fail the request if history fails, just log it
      }
    } else {
      // No fields changed, but still create a history entry for the comment
      await supabase.from('maintenance_history').insert({
        vehicle_id: vehicleId,
        field_name: 'no_changes',
        old_value: null,
        new_value: null,
        value_type: 'text',
        comment: body.comment.trim(),
        updated_by: user.id,
        updated_by_name: userName,
      });
    }

    return NextResponse.json({
      success: true,
      maintenance: maintenanceRecord,
      message: isNewRecord
        ? 'Maintenance record created successfully'
        : 'Maintenance record updated successfully',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(
      'POST /api/maintenance/by-vehicle/[vehicleId] failed',
      error,
      'MaintenanceAPI'
    );
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}
