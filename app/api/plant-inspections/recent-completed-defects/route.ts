import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import { buildRecentCompletedDefectMap } from '@/lib/utils/inspectionRecentCompletedDefects';

const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_LOOKBACK_DAYS = 30;

export async function GET(request: NextRequest) {
  try {
    const { errorResponse } = await getInspectionRouteActorAccess('plant-inspections');
    if (errorResponse) {
      return errorResponse;
    }

    const { searchParams } = new URL(request.url);
    const plantId = searchParams.get('plantId');
    const requestedDays = Number(searchParams.get('days') || DEFAULT_LOOKBACK_DAYS);
    const lookbackDays = Number.isFinite(requestedDays)
      ? Math.min(Math.max(Math.floor(requestedDays), 1), MAX_LOOKBACK_DAYS)
      : DEFAULT_LOOKBACK_DAYS;

    if (!plantId) {
      return NextResponse.json({ error: 'plantId is required' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { data: tasks, error: tasksError } = await supabaseAdmin
      .from('actions')
      .select('description, actioned_at, updated_at')
      .eq('plant_id', plantId)
      .eq('action_type', 'inspection_defect')
      .eq('status', 'completed')
      .order('actioned_at', { ascending: false, nullsFirst: false })
      .limit(100);

    if (tasksError) {
      console.error('Error fetching recently completed plant defect tasks:', tasksError);
      return NextResponse.json({ error: 'Failed to fetch completed defects' }, { status: 500 });
    }

    const recentlyCompletedMap = buildRecentCompletedDefectMap(tasks || [], { lookbackDays });

    return NextResponse.json({
      recentlyCompletedItems: Array.from(recentlyCompletedMap.entries()).map(([signature, summary]) => ({
        signature,
        completedAt: summary.completedAt,
      })),
    });
  } catch (error) {
    console.error('Error in plant recent-completed-defects endpoint:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
