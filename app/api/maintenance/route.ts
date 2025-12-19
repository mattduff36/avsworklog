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
    
    // Get all active vehicles with their maintenance data (if any)
    // Using LEFT JOIN to include vehicles without maintenance records
    // Note: Cannot order by joined table columns in Supabase
    // Sorting is handled client-side in the MaintenanceTable component
    const { data: vehicles, error: vehiclesError } = await supabase
      .from('vehicles')
      .select(`
        id,
        reg_number,
        category_id,
        status,
        nickname,
        maintenance:vehicle_maintenance(*)
      `)
      .eq('status', 'active');
    
    if (vehiclesError) {
      logger.error('Failed to fetch vehicles with maintenance records', vehiclesError);
      throw vehiclesError;
    }
    
    // Get last inspector for each vehicle
    const vehiclesWithInspector = await Promise.all(
      (vehicles || []).map(async (vehicle) => {
        const v = vehicle as any;
        
        // Get the last inspection for this vehicle
        const { data: inspections } = await supabase
          .from('vehicle_inspections')
          .select(`
            inspection_date,
            profiles!vehicle_inspections_user_id_fkey (
              full_name
            )
          `)
          .eq('vehicle_id', v.id)
          .order('inspection_date', { ascending: false })
          .limit(1);
        
        const lastInspection = inspections?.[0] || null;
        
        return {
          ...v,
          last_inspector: (lastInspection?.profiles as any)?.full_name || null,
          last_inspection_date: lastInspection?.inspection_date || null,
        };
      })
    );
    
    // Calculate status for each vehicle
    const vehiclesWithStatus: VehicleMaintenanceWithStatus[] = vehiclesWithInspector.map(vehicle => {
      const v = vehicle as any;
      // Get maintenance data (will be null/empty if no maintenance record exists)
      const maintenance = Array.isArray(v.maintenance) ? v.maintenance[0] : v.maintenance;
      
      // If no maintenance record exists, create a placeholder structure
      if (!maintenance) {
        return {
          id: null,
          vehicle_id: v.id,
          vehicle: {
            id: v.id,
            reg_number: v.reg_number,
            category_id: v.category_id,
            status: v.status,
            nickname: v.nickname || null
          },
          last_inspector: v.last_inspector,
          last_inspection_date: v.last_inspection_date,
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
      
      // Calculate status for each maintenance type
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
      
      // Calculate counts
      const alertCounts = calculateAlertCounts([
        tax_status,
        mot_status,
        service_status,
        cambelt_status,
        first_aid_status
      ]);
      
      return {
        ...maintenance,
        vehicle: {
          id: v.id,
          reg_number: v.reg_number,
          category_id: v.category_id,
          status: v.status,
          nickname: v.nickname || null
        },
        last_inspector: v.last_inspector,
        last_inspection_date: v.last_inspection_date,
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
    const body: UpdateMaintenanceRequest & { vehicle_id: string } = await request.json();
    
    // Validate vehicle_id
    if (!body.vehicle_id) {
      return NextResponse.json(
        { error: 'vehicle_id is required' },
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
      .eq('vehicle_id', body.vehicle_id)
      .single();
    
    if (existingRecord) {
      return NextResponse.json(
        { error: 'Maintenance record already exists for this vehicle' },
        { status: 409 }
      );
    }
    
    // Create new maintenance record
    const newRecord = {
      vehicle_id: body.vehicle_id,
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
    
    // Create history entry for initial creation
    const historyEntries = [];
    
    if (body.tax_due_date) {
      historyEntries.push({
        vehicle_id: body.vehicle_id,
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
        vehicle_id: body.vehicle_id,
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
        vehicle_id: body.vehicle_id,
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
        vehicle_id: body.vehicle_id,
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
        vehicle_id: body.vehicle_id,
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
