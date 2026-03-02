import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils/logger';
import type {
  VehicleMaintenance,
  VehicleMaintenanceWithStatus,
  MaintenanceCategory,
  MaintenanceListResponse,
  UpdateMaintenanceRequest,
  MaintenanceUpdateResponse
} from '@/types/maintenance';
import {
  getDateBasedStatus,
  getMileageBasedStatus,
  calculateAlertCounts
} from '@/lib/utils/maintenanceCalculations';

/**
 * GET /api/maintenance
 * Returns all vehicle maintenance records with calculated status
 */
export async function GET(request: NextRequest) {
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
    
    // Check permission (RLS will handle this, but we check explicitly for better errors)
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, role:roles(name, role_permissions(module_name, enabled))')
      .eq('id', user.id)
      .single();
    
    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }
    
    // Get all maintenance categories (for threshold values)
    const { data: categories, error: categoriesError } = await supabase
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
    
    // ---------------------------------------------------------------
    // Fetch all three asset tables with their maintenance records
    // ---------------------------------------------------------------

    const [vansResult, hgvsResult, plantResult] = await Promise.all([
      supabase
        .from('vans')
        .select('id, reg_number, category_id, status, nickname, maintenance:vehicle_maintenance!van_id(*)')
        .eq('status', 'active'),
      supabase
        .from('hgvs')
        .select('id, reg_number, category_id, status, nickname, maintenance:vehicle_maintenance!hgv_id(*)')
        .eq('status', 'active'),
      supabase
        .from('plant')
        .select('id, plant_id, reg_number, nickname, serial_number, year, weight_class, category_id, status, maintenance:vehicle_maintenance!plant_id(*)')
        .eq('status', 'active'),
    ]);

    if (vansResult.error) { logger.error('Failed to fetch vans', vansResult.error); throw vansResult.error; }
    if (hgvsResult.error) { logger.error('Failed to fetch hgvs', hgvsResult.error); throw hgvsResult.error; }
    if (plantResult.error) { logger.error('Failed to fetch plant', plantResult.error); throw plantResult.error; }

    // Tag each asset with its source type
    type TaggedAsset = { _assetType: 'van' | 'hgv' | 'plant'; [key: string]: any };
    const taggedAssets: TaggedAsset[] = [
      ...(vansResult.data || []).map(v => ({ ...v, _assetType: 'van' as const })),
      ...(hgvsResult.data || []).map(v => ({ ...v, _assetType: 'hgv' as const })),
      ...(plantResult.data || []).map(v => ({ ...v, _assetType: 'plant' as const })),
    ];

    // Get last inspector for each asset (batched per inspection table)
    const vanIds = taggedAssets.filter(a => a._assetType === 'van').map(a => a.id);
    const hgvIds = taggedAssets.filter(a => a._assetType === 'hgv').map(a => a.id);
    const plantIds = taggedAssets.filter(a => a._assetType === 'plant').map(a => a.id);

    const lastInspectionMap = new Map<string, { inspector: string | null; date: string | null }>();

    // Van inspections
    if (vanIds.length > 0) {
      const { data: vanInsp } = await supabase
        .from('van_inspections')
        .select('van_id, inspection_date, profiles!van_inspections_user_id_fkey(full_name)')
        .in('van_id', vanIds)
        .order('inspection_date', { ascending: false });

      for (const row of (vanInsp || []) as any[]) {
        if (row.van_id && !lastInspectionMap.has(row.van_id)) {
          lastInspectionMap.set(row.van_id, {
            inspector: row.profiles?.full_name || null,
            date: row.inspection_date,
          });
        }
      }
    }

    // HGV inspections
    if (hgvIds.length > 0) {
      const { data: hgvInsp } = await supabase
        .from('hgv_inspections')
        .select('hgv_id, inspection_date, profiles!hgv_inspections_user_id_fkey(full_name)')
        .in('hgv_id', hgvIds)
        .order('inspection_date', { ascending: false });

      for (const row of (hgvInsp || []) as any[]) {
        if (row.hgv_id && !lastInspectionMap.has(row.hgv_id)) {
          lastInspectionMap.set(row.hgv_id, {
            inspector: row.profiles?.full_name || null,
            date: row.inspection_date,
          });
        }
      }
    }

    // Plant inspections
    if (plantIds.length > 0) {
      const { data: plantInsp } = await supabase
        .from('plant_inspections')
        .select('plant_id, inspection_date, profiles!plant_inspections_user_id_fkey(full_name)')
        .in('plant_id', plantIds)
        .order('inspection_date', { ascending: false });

      for (const row of (plantInsp || []) as any[]) {
        if (row.plant_id && !lastInspectionMap.has(row.plant_id)) {
          lastInspectionMap.set(row.plant_id, {
            inspector: row.profiles?.full_name || null,
            date: row.inspection_date,
          });
        }
      }
    }

    // Calculate status for each asset
    const vehiclesWithStatus: VehicleMaintenanceWithStatus[] = taggedAssets.map(asset => {
      const assetType = asset._assetType;
      const maintenance = Array.isArray(asset.maintenance) ? asset.maintenance[0] : asset.maintenance;
      const inspInfo = lastInspectionMap.get(asset.id);

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

      if (!maintenance) {
        return {
          id: null,
          van_id: assetType === 'van' ? asset.id : null,
          hgv_id: assetType === 'hgv' ? asset.id : null,
          plant_id: assetType === 'plant' ? asset.id : null,
          is_plant: assetType === 'plant',
          vehicle: vehicleObj,
          last_inspector: inspInfo?.inspector || null,
          last_inspection_date: inspInfo?.date || null,
          current_mileage: null,
          tax_due_date: null,
          mot_due_date: null,
          next_service_mileage: null,
          miles_last_service: null,
          cambelt_due_mileage: null,
          tracker_id: null,
          first_aid_kit_expiry: null,
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
          overdue_count: 0,
          due_soon_count: 0
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

      const alertCounts = calculateAlertCounts([
        tax_status, mot_status, service_status, cambelt_status, first_aid_status
      ]);

      return {
        ...maintenance,
        is_plant: assetType === 'plant',
        vehicle: vehicleObj,
        last_inspector: inspInfo?.inspector || null,
        last_inspection_date: inspInfo?.date || null,
        tax_status,
        mot_status,
        service_status,
        cambelt_status,
        first_aid_status,
        overdue_count: alertCounts.overdue,
        due_soon_count: alertCounts.due_soon
      };
    });
    
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
    
  } catch (error: any) {
    logger.error('GET /api/maintenance failed', error, 'MaintenanceAPI');
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
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
      .single();
    
    if (existingRecord) {
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
      maintenance: createdMaintenance,
      message: 'Maintenance record created successfully'
    };
    
    return NextResponse.json(response);
    
  } catch (error: any) {
    logger.error('POST /api/maintenance failed', error, 'MaintenanceAPI');
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
