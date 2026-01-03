import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils/logger';
import type { MaintenanceHistoryResponse } from '@/types/maintenance';

/**
 * GET /api/maintenance/history/[vehicleId]
 * Returns maintenance history for a vehicle
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ vehicleId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Await params (Next.js 15 requirement)
    const { vehicleId } = await params;
    
    // Get vehicle info
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id, reg_number')
      .eq('id', vehicleId)
      .single();
    
    if (vehicleError || !vehicle) {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    }
    
    // Get maintenance record with VES data
    const { data: maintenanceData } = await supabase
      .from('vehicle_maintenance')
      .select(`
        ves_make,
        ves_colour,
        ves_fuel_type,
        ves_year_of_manufacture,
        ves_engine_capacity,
        ves_tax_status,
        ves_mot_status,
        ves_co2_emissions,
        ves_euro_status,
        ves_real_driving_emissions,
        ves_type_approval,
        ves_wheelplan,
        ves_revenue_weight,
        ves_marked_for_export,
        ves_month_of_first_registration,
        ves_date_of_last_v5c_issued,
        tax_due_date,
        mot_due_date,
        last_dvla_sync
      `)
      .eq('vehicle_id', vehicleId)
      .single();
    
    // Get history (RLS handles permission check)
    const { data: history, error } = await supabase
      .from('maintenance_history')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false });
    
    if (error) {
      logger.error('Failed to fetch history', error);
      throw error;
    }
    
    const response: MaintenanceHistoryResponse = {
      success: true,
      history: history || [],
      vehicle: {
        id: vehicle.id,
        reg_number: vehicle.reg_number
      },
      vesData: maintenanceData || null
    };
    
    return NextResponse.json(response);
    
  } catch (error: any) {
    logger.error('GET /api/maintenance/history/[vehicleId] failed', error, 'MaintenanceAPI');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
