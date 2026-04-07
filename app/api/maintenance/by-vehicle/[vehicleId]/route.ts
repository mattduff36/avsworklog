import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils/logger';
import type { MaintenanceCategory, UpdateMaintenanceRequest } from '@/types/maintenance';
import { buildAutomaticMaintenancePlan } from '@/lib/utils/workshopMaintenanceSync';

type AssetType = 'van' | 'hgv' | 'plant';
type FkColumn = 'van_id' | 'hgv_id' | 'plant_id';
type ChangedFieldValueType = 'date' | 'mileage' | 'boolean' | 'text';

type ExtendedUpdateMaintenanceRequest = UpdateMaintenanceRequest & {
  assetType?: AssetType;
  completed_at?: string;
  task_title?: string | null;
  task_description?: string | null;
  task_category_name?: string | null;
  task_subcategory_name?: string | null;
  loler_due_date?: string | null;
};

function fkColumnForAssetType(assetType: AssetType): FkColumn {
  if (assetType === 'hgv') return 'hgv_id';
  if (assetType === 'plant') return 'plant_id';
  return 'van_id';
}

const FIELD_TO_CATEGORY_NAME: Record<string, string> = {
  tax_due_date: 'Tax Due Date',
  mot_due_date: 'MOT Due Date',
  first_aid_kit_expiry: 'First Aid Kit Expiry',
  six_weekly_inspection_due_date: '6 Weekly Inspection Due',
  fire_extinguisher_due_date: 'Fire Extinguisher Due',
  taco_calibration_due_date: 'Taco Calibration Due',
  next_service_mileage: 'Service Due',
  last_service_mileage: 'Service Due',
  cambelt_due_mileage: 'Cambelt Replacement',
  next_service_hours: 'Service Due (Hours)',
  last_service_hours: 'Service Due (Hours)',
  loler_due_date: 'LOLER Due',
};

function buildCategoryIdByField(categories: MaintenanceCategory[]): Map<string, string> {
  const categoryIdByName = new Map(
    categories.map((category) => [category.name.toLowerCase(), category.id])
  );

  return new Map(
    Object.entries(FIELD_TO_CATEGORY_NAME)
      .map(([fieldName, categoryName]) => [
        fieldName,
        categoryIdByName.get(categoryName.toLowerCase()),
      ])
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
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
    const body: ExtendedUpdateMaintenanceRequest = await request.json();

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
      'id, van_id, hgv_id, plant_id, current_mileage, current_hours, tax_due_date, mot_due_date, first_aid_kit_expiry, six_weekly_inspection_due_date, fire_extinguisher_due_date, taco_calibration_due_date, next_service_mileage, last_service_mileage, cambelt_due_mileage, next_service_hours, last_service_hours, tracker_id, notes';

    type ExistingRecord = {
      id: string;
      van_id: string | null;
      hgv_id: string | null;
      plant_id: string | null;
      current_mileage: number | null;
      current_hours: number | null;
      tax_due_date: string | null;
      mot_due_date: string | null;
      first_aid_kit_expiry: string | null;
      six_weekly_inspection_due_date: string | null;
      fire_extinguisher_due_date: string | null;
      taco_calibration_due_date: string | null;
      next_service_mileage: number | null;
      last_service_mileage: number | null;
      cambelt_due_mileage: number | null;
      next_service_hours: number | null;
      last_service_hours: number | null;
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

    const { data: categories, error: categoriesError } = await supabase
      .from('maintenance_categories')
      .select('*')
      .eq('is_active', true);

    if (categoriesError) {
      logger.error('Failed to fetch maintenance categories', categoriesError);
      throw categoriesError;
    }

    const maintenanceCategories = (categories || []) as MaintenanceCategory[];
    const categoryIdByField = buildCategoryIdByField(maintenanceCategories);

    const autoPlan = buildAutomaticMaintenancePlan({
      context: {
        title: body.task_title,
        description: body.task_description,
        workshopCategoryName: body.task_category_name,
        workshopSubcategoryName: body.task_subcategory_name,
      },
      categories: maintenanceCategories,
      state: {
        currentMileage: existingRecord?.current_mileage ?? null,
        currentHours: existingRecord?.current_hours ?? null,
      },
      completedAt: body.completed_at || new Date().toISOString(),
    });

    const requestedUpdates: Partial<UpdateMaintenanceRequest> = {
      ...(autoPlan?.maintenanceUpdates || {}),
    };

    const requestedPlantUpdates: { loler_due_date?: string | null } = {
      ...(autoPlan?.plantUpdates || {}),
    };

    const maintenanceFields: Array<keyof UpdateMaintenanceRequest> = [
      'current_mileage',
      'tax_due_date',
      'mot_due_date',
      'first_aid_kit_expiry',
      'six_weekly_inspection_due_date',
      'fire_extinguisher_due_date',
      'taco_calibration_due_date',
      'next_service_mileage',
      'last_service_mileage',
      'cambelt_due_mileage',
      'current_hours',
      'last_service_hours',
      'next_service_hours',
      'tracker_id',
      'notes',
    ];

    for (const fieldName of maintenanceFields) {
      const fieldValue = body[fieldName];
      if (fieldValue !== undefined) {
        (requestedUpdates as Record<string, unknown>)[fieldName] = fieldValue;
      }
    }

    if (body.loler_due_date !== undefined) {
      requestedPlantUpdates.loler_due_date = body.loler_due_date;
    }

    const historyAssetKeys = {
      van_id: fkColumn === 'van_id' ? vehicleId : null,
      hgv_id: fkColumn === 'hgv_id' ? vehicleId : null,
      plant_id: fkColumn === 'plant_id' ? vehicleId : null,
    };

    const { data: plantRecord, error: plantRecordError } =
      fkColumn === 'plant_id'
        ? await supabase
            .from('plant')
            .select('id, loler_due_date')
            .eq('id', vehicleId)
            .maybeSingle()
        : { data: null, error: null };

    if (plantRecordError) {
      logger.error('Failed to fetch plant record', plantRecordError);
      throw plantRecordError;
    }

    const isNewRecord = !existingRecord;

    // Track which fields changed for history
    const changedFields: Array<{
      field_name: string;
      old_value: string | null;
      new_value: string | null;
      value_type: ChangedFieldValueType;
      maintenance_category_id: string | null;
    }> = [];

    // Build update payload
    const updates: Record<string, string | number | boolean | null> = {
      last_updated_by: user.id,
      last_updated_at: new Date().toISOString(),
    };

    const assignChangedField = (
      fieldName: string,
      oldValue: string | number | null | undefined,
      newValue: string | number | null | undefined,
      valueType: ChangedFieldValueType
    ) => {
      changedFields.push({
        field_name: fieldName,
        old_value: oldValue != null ? String(oldValue) : null,
        new_value: newValue != null ? String(newValue) : null,
        value_type: valueType,
        maintenance_category_id: categoryIdByField.get(fieldName) || autoPlan?.linkedCategoryId || null,
      });
    };

    // Check each field for changes
    if (requestedUpdates.current_mileage !== undefined) {
      updates.current_mileage = requestedUpdates.current_mileage;
      if (!existingRecord || existingRecord.current_mileage !== requestedUpdates.current_mileage) {
        assignChangedField(
          'current_mileage',
          existingRecord?.current_mileage,
          requestedUpdates.current_mileage,
          'mileage'
        );
      }
    }

    if (requestedUpdates.tax_due_date !== undefined) {
      updates.tax_due_date = requestedUpdates.tax_due_date;
      if (!existingRecord || existingRecord.tax_due_date !== requestedUpdates.tax_due_date) {
        assignChangedField(
          'tax_due_date',
          existingRecord?.tax_due_date,
          requestedUpdates.tax_due_date,
          'date'
        );
      }
    }

    if (requestedUpdates.mot_due_date !== undefined) {
      updates.mot_due_date = requestedUpdates.mot_due_date;
      if (!existingRecord || existingRecord.mot_due_date !== requestedUpdates.mot_due_date) {
        assignChangedField(
          'mot_due_date',
          existingRecord?.mot_due_date,
          requestedUpdates.mot_due_date,
          'date'
        );
      }
    }

    if (requestedUpdates.first_aid_kit_expiry !== undefined) {
      updates.first_aid_kit_expiry = requestedUpdates.first_aid_kit_expiry;
      if (!existingRecord || existingRecord.first_aid_kit_expiry !== requestedUpdates.first_aid_kit_expiry) {
        assignChangedField(
          'first_aid_kit_expiry',
          existingRecord?.first_aid_kit_expiry,
          requestedUpdates.first_aid_kit_expiry,
          'date'
        );
      }
    }

    if (requestedUpdates.six_weekly_inspection_due_date !== undefined) {
      updates.six_weekly_inspection_due_date = requestedUpdates.six_weekly_inspection_due_date;
      if (!existingRecord || existingRecord.six_weekly_inspection_due_date !== requestedUpdates.six_weekly_inspection_due_date) {
        assignChangedField(
          'six_weekly_inspection_due_date',
          existingRecord?.six_weekly_inspection_due_date,
          requestedUpdates.six_weekly_inspection_due_date,
          'date'
        );
      }
    }

    if (requestedUpdates.fire_extinguisher_due_date !== undefined) {
      updates.fire_extinguisher_due_date = requestedUpdates.fire_extinguisher_due_date;
      if (!existingRecord || existingRecord.fire_extinguisher_due_date !== requestedUpdates.fire_extinguisher_due_date) {
        assignChangedField(
          'fire_extinguisher_due_date',
          existingRecord?.fire_extinguisher_due_date,
          requestedUpdates.fire_extinguisher_due_date,
          'date'
        );
      }
    }

    if (requestedUpdates.taco_calibration_due_date !== undefined) {
      updates.taco_calibration_due_date = requestedUpdates.taco_calibration_due_date;
      if (!existingRecord || existingRecord.taco_calibration_due_date !== requestedUpdates.taco_calibration_due_date) {
        assignChangedField(
          'taco_calibration_due_date',
          existingRecord?.taco_calibration_due_date,
          requestedUpdates.taco_calibration_due_date,
          'date'
        );
      }
    }

    if (requestedUpdates.next_service_mileage !== undefined) {
      updates.next_service_mileage = requestedUpdates.next_service_mileage;
      if (!existingRecord || existingRecord.next_service_mileage !== requestedUpdates.next_service_mileage) {
        assignChangedField(
          'next_service_mileage',
          existingRecord?.next_service_mileage,
          requestedUpdates.next_service_mileage,
          'mileage'
        );
      }
    }

    if (requestedUpdates.last_service_mileage !== undefined) {
      updates.last_service_mileage = requestedUpdates.last_service_mileage;
      if (!existingRecord || existingRecord.last_service_mileage !== requestedUpdates.last_service_mileage) {
        assignChangedField(
          'last_service_mileage',
          existingRecord?.last_service_mileage,
          requestedUpdates.last_service_mileage,
          'mileage'
        );
      }
    }

    if (requestedUpdates.cambelt_due_mileage !== undefined) {
      updates.cambelt_due_mileage = requestedUpdates.cambelt_due_mileage;
      if (!existingRecord || existingRecord.cambelt_due_mileage !== requestedUpdates.cambelt_due_mileage) {
        assignChangedField(
          'cambelt_due_mileage',
          existingRecord?.cambelt_due_mileage,
          requestedUpdates.cambelt_due_mileage,
          'mileage'
        );
      }
    }

    if (requestedUpdates.current_hours !== undefined) {
      updates.current_hours = requestedUpdates.current_hours;
      if (!existingRecord || existingRecord.current_hours !== requestedUpdates.current_hours) {
        assignChangedField(
          'current_hours',
          existingRecord?.current_hours,
          requestedUpdates.current_hours,
          'text'
        );
      }
    }

    if (requestedUpdates.last_service_hours !== undefined) {
      updates.last_service_hours = requestedUpdates.last_service_hours;
      if (!existingRecord || existingRecord.last_service_hours !== requestedUpdates.last_service_hours) {
        assignChangedField(
          'last_service_hours',
          existingRecord?.last_service_hours,
          requestedUpdates.last_service_hours,
          'text'
        );
      }
    }

    if (requestedUpdates.next_service_hours !== undefined) {
      updates.next_service_hours = requestedUpdates.next_service_hours;
      if (!existingRecord || existingRecord.next_service_hours !== requestedUpdates.next_service_hours) {
        assignChangedField(
          'next_service_hours',
          existingRecord?.next_service_hours,
          requestedUpdates.next_service_hours,
          'text'
        );
      }
    }

    if (requestedUpdates.tracker_id !== undefined) {
      updates.tracker_id = requestedUpdates.tracker_id;
      if (!existingRecord || existingRecord.tracker_id !== requestedUpdates.tracker_id) {
        assignChangedField(
          'tracker_id',
          existingRecord?.tracker_id,
          requestedUpdates.tracker_id,
          'text'
        );
      }
    }

    if (requestedUpdates.notes !== undefined) {
      updates.notes = requestedUpdates.notes;
      if (!existingRecord || existingRecord.notes !== requestedUpdates.notes) {
        assignChangedField(
          'notes',
          existingRecord?.notes,
          requestedUpdates.notes,
          'text'
        );
      }
    }

    if (requestedPlantUpdates.loler_due_date !== undefined && plantRecord) {
      if (plantRecord.loler_due_date !== requestedPlantUpdates.loler_due_date) {
        const { error: plantUpdateError } = await supabase
          .from('plant')
          .update({ loler_due_date: requestedPlantUpdates.loler_due_date })
          .eq('id', vehicleId);

        if (plantUpdateError) {
          logger.error('Failed to update plant LOLER due date', plantUpdateError);
          throw plantUpdateError;
        }

        assignChangedField(
          'loler_due_date',
          plantRecord.loler_due_date,
          requestedPlantUpdates.loler_due_date,
          'date'
        );
      }
    }

    // Create or update maintenance record
    let maintenanceRecord = existingRecord;
    const hasMaintenanceUpdates = Object.keys(updates).length > 2;

    if (isNewRecord && hasMaintenanceUpdates) {
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
    } else if (!isNewRecord && hasMaintenanceUpdates) {
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
    if (changedFields.length > 0) {
      const historyEntries = changedFields.map((change) => ({
        ...historyAssetKeys,
        field_name: change.field_name,
        old_value: change.old_value,
        new_value: change.new_value,
        value_type: change.value_type,
        maintenance_category_id: change.maintenance_category_id,
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
        ...historyAssetKeys,
        field_name: 'no_changes',
        old_value: null,
        new_value: null,
        value_type: 'text',
        maintenance_category_id: null,
        comment: body.comment.trim(),
        updated_by: user.id,
        updated_by_name: userName,
      });
    }

    return NextResponse.json({
      success: true,
      maintenance: maintenanceRecord,
      message: isNewRecord && hasMaintenanceUpdates
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
