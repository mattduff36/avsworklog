import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils/logger';
import { logServerError } from '@/lib/utils/server-error-logger';
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
      }
    };
    
    return NextResponse.json(response);
    
  } catch (error: any) {
    logger.error('GET /api/maintenance/history/[vehicleId] failed', error, 'MaintenanceAPI');
    
    await logServerError({
      error: error as Error,
      request,
      componentName: 'GET /api/maintenance/history/[vehicleId]',
    });
    
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
