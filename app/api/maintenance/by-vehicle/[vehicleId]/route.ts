import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils/logger';
import type { UpdateMaintenanceRequest } from '@/types/maintenance';

type AssetType = 'van' | 'hgv' | 'plant';
type FkColumn = 'van_id' | 'hgv_id' | 'plant_id';

function fkColumnForAssetType(assetType: AssetType): FkColumn {
  if (assetType === 'hgv') return 'hgv_id';
  if (assetType === 'plant') return 'plant_id';
  return 'van_id';
}

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
    const body: UpdateMaintenanceRequest & { van_id?: string; assetType?: AssetType } =
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

    // Resolve the FK column: use explicit assetType if provided, otherwise
    // auto-detect by looking up the vehicleId in all three FK columns.
    let fkColumn: FkColumn | null = body.assetType
      ? fkColumnForAssetType(body.assetType)
      : null;

    const selectCols =
      'id, van_id, hgv_id, plant_id, current_mileage, tax_due_date, mot_due_date, first_aid_kit_expiry, six_weekly_inspection_due_date, fire_extinguisher_due_date, taco_calibration_due_date, next_service_mileage, last_service_mileage, cambelt_due_mileage, tracker_id, notes';

    type ExistingRecord = {
      id: string;
      van_id: string | null;
      hgv_id: string | null;
      plant_id: string | null;
      current_mileage: number | null;
      tax_due_date: string | null;
      mot_due_date: string | null;
      first_aid_kit_expiry: string | null;
      six_weekly_inspection_due_date: string | null;
      fire_extinguisher_due_date: string | null;
      taco_calibration_due_date: string | null;
      next_service_mileage: number | null;
      last_service_mileage: number | null;
      cambelt_due_mileage: number | null;
      tracker_id: string | null;
      notes: string | null;
    };

    let existingRecord: ExistingRecord | null = null;

    if (fkColumn) {
      const { data, error: fetchError } = await supabase
        .from('vehicle_maintenance')
        .select(selectCols)
        .eq(fkColumn, vehicleId)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        logger.error('Failed to fetch maintenance record', fetchError);
        throw fetchError;
      }
      existingRecord = data as ExistingRecord | null;
    } else {
      // Auto-detect: try each FK column
      for (const col of ['van_id', 'hgv_id', 'plant_id'] as FkColumn[]) {
        const { data, error: fetchError } = await supabase
          .from('vehicle_maintenance')
          .select(selectCols)
          .eq(col, vehicleId)
          .single();

        if (fetchError && fetchError.code !== 'PGRST116') {
          logger.error('Failed to fetch maintenance record', fetchError);
          throw fetchError;
        }
        if (data) {
          existingRecord = data as ExistingRecord;
          fkColumn = col;
          break;
        }
      }
    }

    // If we still don't know the FK, auto-detect from asset tables
    if (!fkColumn) {
      const [{ data: van }, { data: hgv }, { data: plant }] = await Promise.all([
        supabase.from('vans').select('id').eq('id', vehicleId).maybeSingle(),
        supabase.from('hgvs').select('id').eq('id', vehicleId).maybeSingle(),
        supabase.from('plant').select('id').eq('id', vehicleId).maybeSingle(),
      ]);

      if (hgv) fkColumn = 'hgv_id';
      else if (plant) fkColumn = 'plant_id';
      else if (van) fkColumn = 'van_id';
      else {
        return NextResponse.json(
          { error: 'Vehicle not found in any asset table' },
          { status: 404 }
        );
      }
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
      if (!existingRecord || existingRecord.current_mileage !== body.current_mileage) {
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
      if (!existingRecord || existingRecord.tax_due_date !== body.tax_due_date) {
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
      if (!existingRecord || existingRecord.mot_due_date !== body.mot_due_date) {
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
      if (!existingRecord || existingRecord.first_aid_kit_expiry !== body.first_aid_kit_expiry) {
        changedFields.push({
          field_name: 'first_aid_kit_expiry',
          old_value: existingRecord?.first_aid_kit_expiry || null,
          new_value: body.first_aid_kit_expiry || null,
          value_type: 'date',
        });
      }
    }

    if (body.six_weekly_inspection_due_date !== undefined) {
      updates.six_weekly_inspection_due_date = body.six_weekly_inspection_due_date;
      if (!existingRecord || existingRecord.six_weekly_inspection_due_date !== body.six_weekly_inspection_due_date) {
        changedFields.push({
          field_name: 'six_weekly_inspection_due_date',
          old_value: existingRecord?.six_weekly_inspection_due_date || null,
          new_value: body.six_weekly_inspection_due_date || null,
          value_type: 'date',
        });
      }
    }

    if (body.fire_extinguisher_due_date !== undefined) {
      updates.fire_extinguisher_due_date = body.fire_extinguisher_due_date;
      if (!existingRecord || existingRecord.fire_extinguisher_due_date !== body.fire_extinguisher_due_date) {
        changedFields.push({
          field_name: 'fire_extinguisher_due_date',
          old_value: existingRecord?.fire_extinguisher_due_date || null,
          new_value: body.fire_extinguisher_due_date || null,
          value_type: 'date',
        });
      }
    }

    if (body.taco_calibration_due_date !== undefined) {
      updates.taco_calibration_due_date = body.taco_calibration_due_date;
      if (!existingRecord || existingRecord.taco_calibration_due_date !== body.taco_calibration_due_date) {
        changedFields.push({
          field_name: 'taco_calibration_due_date',
          old_value: existingRecord?.taco_calibration_due_date || null,
          new_value: body.taco_calibration_due_date || null,
          value_type: 'date',
        });
      }
    }

    if (body.next_service_mileage !== undefined) {
      updates.next_service_mileage = body.next_service_mileage;
      if (!existingRecord || existingRecord.next_service_mileage !== body.next_service_mileage) {
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
      if (!existingRecord || existingRecord.last_service_mileage !== body.last_service_mileage) {
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
      if (!existingRecord || existingRecord.cambelt_due_mileage !== body.cambelt_due_mileage) {
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
      if (!existingRecord || existingRecord.tracker_id !== body.tracker_id) {
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
      if (!existingRecord || existingRecord.notes !== body.notes) {
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
      const { data: created, error: createError } = await supabase
        .from('vehicle_maintenance')
        .insert({
          [fkColumn]: vehicleId,
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
        .eq('id', existingRecord!.id)
        .select()
        .single();

      if (updateError) {
        logger.error('Failed to update maintenance record', updateError);
        throw updateError;
      }

      maintenanceRecord = updated;
    }

    // Create history entries for all changed fields
    const historyFk = { [fkColumn]: vehicleId };

    if (changedFields.length > 0) {
      const historyEntries = changedFields.map((change) => ({
        ...historyFk,
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
      }
    } else {
      await supabase.from('maintenance_history').insert({
        ...historyFk,
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
