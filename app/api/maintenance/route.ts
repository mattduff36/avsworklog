import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/utils/logger';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import type {
  VehicleMaintenanceWithStatus,
  MaintenanceCategory,
  MaintenanceListResponse,
  UpdateMaintenanceRequest,
  MaintenanceUpdateResponse
} from '@/types/maintenance';
import {
  getDateBasedStatus,
  getMileageBasedStatus,
  getHoursBasedStatus,
  calculateAlertCounts
} from '@/lib/utils/maintenanceCalculations';

interface InspectionLookupRow {
  inspection_date: string | null;
  profiles:
    | {
        full_name: string | null;
      }
    | Array<{
        full_name: string | null;
      }>
    | null;
}

interface MaintenanceRow {
  id: string;
  van_id: string | null;
  hgv_id: string | null;
  plant_id: string | null;
  current_mileage: number | null;
  tax_due_date: string | null;
  mot_due_date: string | null;
  next_service_mileage: number | null;
  last_service_mileage: number | null;
  cambelt_due_mileage: number | null;
  tracker_id: string | null;
  first_aid_kit_expiry: string | null;
  six_weekly_inspection_due_date: string | null;
  fire_extinguisher_due_date: string | null;
  taco_calibration_due_date: string | null;
  current_hours: number | null;
  next_service_hours: number | null;
  last_service_hours: number | null;
  created_at: string;
  updated_at: string;
  last_updated_by: string | null;
  last_updated_at: string;
  last_mileage_update: string | null;
  notes: string | null;
}

/**
 * GET /api/maintenance
 * Returns all vehicle maintenance records with calculated status
 */
export async function GET() {
  try {
    // Auth check
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const hasPermission = await canEffectiveRoleAccessModule('maintenance');
    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    const admin = createAdminClient();
    
    // Get all maintenance categories (for threshold values)
    const { data: categories, error: categoriesError } = await admin
      .from('maintenance_categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');
    
    if (categoriesError) {
      logger.error('Failed to fetch maintenance categories', categoriesError);
      throw categoriesError;
    }
    
    // Create lookup for categories
    const categoryMap = new Map<string, MaintenanceCategory>();
    (categories || []).forEach(cat => {
      categoryMap.set(cat.name.toLowerCase(), cat);
    });
    
    // Get thresholds (with defaults)
    const taxThreshold = categoryMap.get('tax due date')?.alert_threshold_days || 30;
    const motThreshold = categoryMap.get('mot due date')?.alert_threshold_days || 30;
    const serviceThreshold = categoryMap.get('service due')?.alert_threshold_miles || 1000;
    const cambeltThreshold = categoryMap.get('cambelt replacement')?.alert_threshold_miles || 5000;
    const firstAidThreshold = categoryMap.get('first aid kit expiry')?.alert_threshold_days || 30;
    const sixWeeklyThreshold = categoryMap.get('6 weekly inspection due')?.alert_threshold_days || 7;
    const fireExtinguisherThreshold = categoryMap.get('fire extinguisher due')?.alert_threshold_days || 30;
    const tacoCalibrationThreshold = categoryMap.get('taco calibration due')?.alert_threshold_days || 60;
    const lolerThreshold = categoryMap.get('loler due')?.alert_threshold_days || 30;
    const serviceHoursThreshold = categoryMap.get('service due (hours)')?.alert_threshold_hours || 50;
    
    // ---------------------------------------------------------------
    // Fetch all three asset tables with their maintenance records
    // ---------------------------------------------------------------

    const [vansResult, hgvsResult, plantResult] = await Promise.all([
      admin
        .from('vans')
        .select(`
          id,
          reg_number,
          category_id,
          status,
          nickname,
          maintenance:vehicle_maintenance!van_id(*),
          van_inspections!van_inspections_van_id_fkey(
            inspection_date,
            profiles!van_inspections_user_id_fkey(full_name)
          )
        `)
        .eq('status', 'active')
        .order('inspection_date', { foreignTable: 'van_inspections', ascending: false })
        .limit(1, { foreignTable: 'van_inspections' }),
      admin
        .from('hgvs')
        .select(`
          id,
          reg_number,
          category_id,
          status,
          nickname,
          maintenance:vehicle_maintenance!hgv_id(*),
          hgv_inspections!hgv_inspections_hgv_id_fkey(
            inspection_date,
            profiles!hgv_inspections_user_id_fkey(full_name)
          )
        `)
        .eq('status', 'active')
        .order('inspection_date', { foreignTable: 'hgv_inspections', ascending: false })
        .limit(1, { foreignTable: 'hgv_inspections' }),
      admin
        .from('plant')
        .select(`
          id,
          plant_id,
          reg_number,
          nickname,
          serial_number,
          year,
          weight_class,
          category_id,
          status,
          loler_due_date,
          maintenance:vehicle_maintenance!plant_id(*),
          plant_inspections!plant_inspections_plant_id_fkey(
            inspection_date,
            profiles!plant_inspections_user_id_fkey(full_name)
          )
        `)
        .eq('status', 'active')
        .order('inspection_date', { foreignTable: 'plant_inspections', ascending: false })
        .limit(1, { foreignTable: 'plant_inspections' }),
    ]);

    if (vansResult.error) { logger.error('Failed to fetch vans', vansResult.error); throw vansResult.error; }
    if (hgvsResult.error) { logger.error('Failed to fetch hgvs', hgvsResult.error); throw hgvsResult.error; }
    if (plantResult.error) { logger.error('Failed to fetch plant', plantResult.error); throw plantResult.error; }

    // Tag each asset with its source type
    interface TaggedAsset {
      _assetType: 'van' | 'hgv' | 'plant';
      id: string;
      reg_number: string | null;
      category_id: string | null;
      status: string;
      nickname: string | null;
      plant_id?: string | null;
      serial_number?: string | null;
      year?: number | null;
      weight_class?: string | null;
      loler_due_date?: string | null;
      maintenance?: Record<string, unknown>[] | Record<string, unknown> | null;
      van_inspections?: InspectionLookupRow[] | null;
      hgv_inspections?: InspectionLookupRow[] | null;
      plant_inspections?: InspectionLookupRow[] | null;
    }
    const taggedAssets: TaggedAsset[] = [
      ...(vansResult.data || []).map(v => ({ ...v, _assetType: 'van' as const })),
      ...(hgvsResult.data || []).map(v => ({ ...v, _assetType: 'hgv' as const })),
      ...(plantResult.data || []).map(v => ({ ...v, _assetType: 'plant' as const })),
    ];

    // Calculate status for each asset
    const vehiclesWithStatus = taggedAssets.map(asset => {
      const assetType = asset._assetType;
      const maintenance = (
        Array.isArray(asset.maintenance) ? asset.maintenance[0] : asset.maintenance
      ) as MaintenanceRow | null;
      const latestInspection = (
        assetType === 'van'
          ? asset.van_inspections?.[0]
          : assetType === 'hgv'
            ? asset.hgv_inspections?.[0]
            : asset.plant_inspections?.[0]
      ) || null;
      const latestInspectorProfile = Array.isArray(latestInspection?.profiles)
        ? latestInspection?.profiles[0] || null
        : latestInspection?.profiles || null;

      const vehicleObj = {
        id: asset.id,
        reg_number: asset.reg_number || null,
        category_id: asset.category_id || null,
        status: asset.status,
        nickname: asset.nickname || null,
        asset_type: assetType as 'van' | 'hgv' | 'plant',
        plant_id: asset.plant_id || null,
        serial_number: asset.serial_number || null,
        year: asset.year || null,
        weight_class: asset.weight_class || null,
      };

      // LOLER due date comes from the plant table, not vehicle_maintenance
      const loler_due_date = assetType === 'plant' ? (asset.loler_due_date || null) : null;
      const loler_status = assetType === 'plant'
        ? getDateBasedStatus(loler_due_date, lolerThreshold)
        : { status: 'not_set' as const };

      if (!maintenance) {
        const noMaintenanceAlertCounts = assetType === 'plant'
          ? calculateAlertCounts([loler_status])
          : { overdue: 0, due_soon: 0 };

        return {
          id: asset.id,
          van_id: assetType === 'van' ? asset.id : null,
          hgv_id: assetType === 'hgv' ? asset.id : null,
          plant_id: assetType === 'plant' ? asset.id : null,
          is_plant: assetType === 'plant',
          vehicle: vehicleObj,
          last_inspector: latestInspectorProfile?.full_name || null,
          last_inspection_date: latestInspection?.inspection_date || null,
          current_mileage: null,
          current_hours: null,
          tax_due_date: null,
          mot_due_date: null,
          next_service_mileage: null,
          last_service_mileage: null,
          next_service_hours: null,
          last_service_hours: null,
          cambelt_due_mileage: null,
          tracker_id: null,
          first_aid_kit_expiry: null,
          six_weekly_inspection_due_date: null,
          fire_extinguisher_due_date: null,
          taco_calibration_due_date: null,
          loler_due_date,
          created_at: null,
          updated_at: null,
          last_updated_by: null,
          last_updated_at: '',
          last_mileage_update: null,
          notes: null,
          tax_status: { status: 'not_set' as const },
          mot_status: { status: 'not_set' as const },
          service_status: { status: 'not_set' as const },
          cambelt_status: { status: 'not_set' as const },
          first_aid_status: { status: 'not_set' as const },
          six_weekly_status: { status: 'not_set' as const },
          fire_extinguisher_status: { status: 'not_set' as const },
          taco_calibration_status: { status: 'not_set' as const },
          loler_status,
          service_hours_status: { status: 'not_set' as const },
          overdue_count: noMaintenanceAlertCounts.overdue,
          due_soon_count: noMaintenanceAlertCounts.due_soon
        };
      }

      const tax_status = getDateBasedStatus(maintenance.tax_due_date, taxThreshold);
      const mot_status = getDateBasedStatus(maintenance.mot_due_date, motThreshold);
      const service_status = getMileageBasedStatus(
        maintenance.current_mileage,
        maintenance.next_service_mileage,
        serviceThreshold
      );
      const cambelt_status = getMileageBasedStatus(
        maintenance.current_mileage,
        maintenance.cambelt_due_mileage,
        cambeltThreshold
      );
      const first_aid_status = getDateBasedStatus(
        maintenance.first_aid_kit_expiry,
        firstAidThreshold
      );
      const six_weekly_status = getDateBasedStatus(
        maintenance.six_weekly_inspection_due_date,
        sixWeeklyThreshold
      );
      const fire_extinguisher_status = getDateBasedStatus(
        maintenance.fire_extinguisher_due_date,
        fireExtinguisherThreshold
      );
      const taco_calibration_status = getDateBasedStatus(
        maintenance.taco_calibration_due_date,
        tacoCalibrationThreshold
      );
      const service_hours_status = assetType === 'plant'
        ? getHoursBasedStatus(
            maintenance.current_hours,
            maintenance.next_service_hours,
            serviceHoursThreshold
          )
        : { status: 'not_set' as const };

      const alertCounts = calculateAlertCounts([
        tax_status,
        mot_status,
        service_status,
        cambelt_status,
        first_aid_status,
        six_weekly_status,
        fire_extinguisher_status,
        taco_calibration_status,
        loler_status,
        service_hours_status,
      ]);

      return {
        ...maintenance,
        is_plant: assetType === 'plant',
        vehicle: vehicleObj,
        last_inspector: latestInspectorProfile?.full_name || null,
        last_inspection_date: latestInspection?.inspection_date || null,
        tax_status,
        mot_status,
        service_status,
        cambelt_status,
        first_aid_status,
        six_weekly_status,
        fire_extinguisher_status,
        taco_calibration_status,
        loler_status,
        loler_due_date,
        service_hours_status,
        overdue_count: alertCounts.overdue,
        due_soon_count: alertCounts.due_soon
      };
    }) as VehicleMaintenanceWithStatus[];
    
    // Calculate summary
    const summary = {
      total: vehiclesWithStatus.length,
      overdue: vehiclesWithStatus.filter(v => v.overdue_count > 0).length,
      due_soon: vehiclesWithStatus.filter(v => v.due_soon_count > 0 && v.overdue_count === 0).length
    };
    
    const response: MaintenanceListResponse = {
      success: true,
      vehicles: vehiclesWithStatus,
      summary
    };
    
    return NextResponse.json(response);
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('GET /api/maintenance failed', error, 'MaintenanceAPI');
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * POST /api/maintenance
 * Create a new maintenance record for a vehicle
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const canManageMaintenance = await canEffectiveRoleAccessModule('maintenance');
    if (!canManageMaintenance) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }
    
    // Get user profile for name
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();
    
    const userName = profile?.full_name || 'Unknown User';
    
    // Parse request body
    const body: UpdateMaintenanceRequest & { van_id?: string; hgv_id?: string } = await request.json();
    
    const assetId = body.van_id || body.hgv_id;
    const assetColumn = body.van_id ? 'van_id' : body.hgv_id ? 'hgv_id' : null;

    if (!assetId || !assetColumn) {
      return NextResponse.json(
        { error: 'van_id or hgv_id is required' },
        { status: 400 }
      );
    }
    
    // Validate comment (mandatory, min 10 characters)
    if (!body.comment || body.comment.trim().length < 10) {
      return NextResponse.json(
        { error: 'Comment is required and must be at least 10 characters' },
        { status: 400 }
      );
    }
    
    // Check if maintenance record already exists
    const { data: existingRecord } = await supabase
      .from('vehicle_maintenance')
      .select('id')
      .eq(assetColumn, assetId)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    
    if ((existingRecord?.length ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Maintenance record already exists for this vehicle' },
        { status: 409 }
      );
    }
    
    // Create new maintenance record
    const newRecord = {
      van_id: body.van_id || null,
      hgv_id: body.hgv_id || null,
      current_mileage: body.current_mileage || 0,
      tax_due_date: body.tax_due_date || null,
      mot_due_date: body.mot_due_date || null,
      first_aid_kit_expiry: body.first_aid_kit_expiry || null,
      six_weekly_inspection_due_date: body.six_weekly_inspection_due_date || null,
      fire_extinguisher_due_date: body.fire_extinguisher_due_date || null,
      taco_calibration_due_date: body.taco_calibration_due_date || null,
      next_service_mileage: body.next_service_mileage || null,
      last_service_mileage: body.last_service_mileage || null,
      cambelt_due_mileage: body.cambelt_due_mileage || null,
      tracker_id: body.tracker_id || null,
      notes: body.notes || null,
      last_updated_by: user.id
    };
    
    const { data: createdMaintenance, error: createError } = await supabase
      .from('vehicle_maintenance')
      .insert(newRecord)
      .select()
      .single();
    
    if (createError) {
      logger.error('Failed to create maintenance record', createError);
      throw createError;
    }

    if (body.hgv_id && body.current_mileage !== undefined && body.current_mileage !== null) {
      const { error: updateHgvError } = await supabase
        .from('hgvs')
        .update({ current_mileage: body.current_mileage })
        .eq('id', body.hgv_id);

      if (updateHgvError) {
        logger.error('Failed to sync hgvs.current_mileage from maintenance create', updateHgvError);
      }
    }
    
    // Create history entry for initial creation
    const historyEntries = [];
    
    if (body.tax_due_date) {
      historyEntries.push({
        van_id: body.van_id || null,
        hgv_id: body.hgv_id || null,
        field_name: 'tax_due_date',
        old_value: null,
        new_value: body.tax_due_date,
        value_type: 'date' as const,
        comment: body.comment,
        updated_by: user.id,
        updated_by_name: userName
      });
    }
    
    if (body.mot_due_date) {
      historyEntries.push({
        van_id: body.van_id || null,
        hgv_id: body.hgv_id || null,
        field_name: 'mot_due_date',
        old_value: null,
        new_value: body.mot_due_date,
        value_type: 'date' as const,
        comment: body.comment,
        updated_by: user.id,
        updated_by_name: userName
      });
    }
    
    if (body.first_aid_kit_expiry) {
      historyEntries.push({
        van_id: body.van_id || null,
        hgv_id: body.hgv_id || null,
        field_name: 'first_aid_kit_expiry',
        old_value: null,
        new_value: body.first_aid_kit_expiry,
        value_type: 'date' as const,
        comment: body.comment,
        updated_by: user.id,
        updated_by_name: userName
      });
    }

    if (body.six_weekly_inspection_due_date) {
      historyEntries.push({
        van_id: body.van_id || null,
        hgv_id: body.hgv_id || null,
        field_name: 'six_weekly_inspection_due_date',
        old_value: null,
        new_value: body.six_weekly_inspection_due_date,
        value_type: 'date' as const,
        comment: body.comment,
        updated_by: user.id,
        updated_by_name: userName
      });
    }

    if (body.fire_extinguisher_due_date) {
      historyEntries.push({
        van_id: body.van_id || null,
        hgv_id: body.hgv_id || null,
        field_name: 'fire_extinguisher_due_date',
        old_value: null,
        new_value: body.fire_extinguisher_due_date,
        value_type: 'date' as const,
        comment: body.comment,
        updated_by: user.id,
        updated_by_name: userName
      });
    }

    if (body.taco_calibration_due_date) {
      historyEntries.push({
        van_id: body.van_id || null,
        hgv_id: body.hgv_id || null,
        field_name: 'taco_calibration_due_date',
        old_value: null,
        new_value: body.taco_calibration_due_date,
        value_type: 'date' as const,
        comment: body.comment,
        updated_by: user.id,
        updated_by_name: userName
      });
    }
    
    if (body.next_service_mileage) {
      historyEntries.push({
        van_id: body.van_id || null,
        hgv_id: body.hgv_id || null,
        field_name: 'next_service_mileage',
        old_value: null,
        new_value: body.next_service_mileage.toString(),
        value_type: 'mileage' as const,
        comment: body.comment,
        updated_by: user.id,
        updated_by_name: userName
      });
    }
    
    if (body.cambelt_due_mileage) {
      historyEntries.push({
        van_id: body.van_id || null,
        hgv_id: body.hgv_id || null,
        field_name: 'cambelt_due_mileage',
        old_value: null,
        new_value: body.cambelt_due_mileage.toString(),
        value_type: 'mileage' as const,
        comment: body.comment,
        updated_by: user.id,
        updated_by_name: userName
      });
    }
    
    // Insert history entries if any
    if (historyEntries.length > 0) {
      const { error: historyError } = await supabase
        .from('maintenance_history')
        .insert(historyEntries);
      
      if (historyError) {
        logger.error('Failed to create history entries', historyError);
        // Don't fail the request if history fails
      }
    }
    
    const response: MaintenanceUpdateResponse = {
      success: true,
      maintenance: createdMaintenance
    };
    
    return NextResponse.json(response);
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('POST /api/maintenance failed', error, 'MaintenanceAPI');
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}
