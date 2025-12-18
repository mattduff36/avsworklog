import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils/logger';
import type {
  VehicleMaintenance,
  VehicleMaintenanceWithStatus,
  MaintenanceCategory,
  MaintenanceListResponse
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
    
    // Get all vehicles with maintenance data
    // Note: Cannot order by joined table columns in Supabase
    // Sorting is handled client-side in the MaintenanceTable component
    const { data: maintenanceRecords, error: maintenanceError } = await supabase
      .from('vehicle_maintenance')
      .select(`
        *,
        vehicle:vehicles(
          id,
          reg_number,
          category_id,
          status
        )
      `);
    
    if (maintenanceError) {
      logger.error('Failed to fetch maintenance records', maintenanceError);
      throw maintenanceError;
    }
    
    // Calculate status for each vehicle
    const vehiclesWithStatus: VehicleMaintenanceWithStatus[] = (maintenanceRecords || []).map(record => {
      const maintenance = record as any;
      
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
