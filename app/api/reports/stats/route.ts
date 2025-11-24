import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is manager or admin
    const profile = await getProfileWithRole(user.id);

    if (!profile || !profile.role?.is_manager_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get current date and week boundaries
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Monday
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6); // Sunday
    endOfWeek.setHours(23, 59, 59, 999);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Get statistics in parallel
    const [
      weekTimesheetsResult,
      monthTimesheetsResult,
      pendingTimesheetsResult,
      pendingInspectionsResult,
      activeEmployeesResult,
      weekInspectionsResult,
      monthInspectionsResult,
    ] = await Promise.all([
      // Total hours this week
      supabase
        .from('timesheets')
        .select('total_hours')
        .eq('status', 'approved')
        .gte('week_ending', startOfWeek.toISOString())
        .lte('week_ending', endOfWeek.toISOString()),
      
      // Total hours this month
      supabase
        .from('timesheets')
        .select('total_hours')
        .eq('status', 'approved')
        .gte('week_ending', startOfMonth.toISOString())
        .lte('week_ending', endOfMonth.toISOString()),
      
      // Pending timesheet approvals
      supabase
        .from('timesheets')
        .select('id', { count: 'exact' })
        .eq('status', 'submitted'),
      
      // Pending inspection approvals
      supabase
        .from('vehicle_inspections')
        .select('id', { count: 'exact' })
        .eq('status', 'submitted'),
      
      // Active employees (non-admin/manager roles)
      supabase
        .from('profiles')
        .select('id, roles!inner(is_manager_admin)', { count: 'exact' })
        .eq('roles.is_manager_admin', false),
      
      // Inspections completed this week
      supabase
        .from('vehicle_inspections')
        .select('id', { count: 'exact' })
        .gte('inspection_date', startOfWeek.toISOString())
        .lte('inspection_date', endOfWeek.toISOString()),
      
      // Inspections completed this month
      supabase
        .from('vehicle_inspections')
        .select('id', { count: 'exact' })
        .gte('inspection_date', startOfMonth.toISOString())
        .lte('inspection_date', endOfMonth.toISOString()),
    ]);

    // Calculate total hours
    const weekHours = weekTimesheetsResult.data?.reduce((sum, t) => sum + (t.total_hours || 0), 0) || 0;
    const monthHours = monthTimesheetsResult.data?.reduce((sum, t) => sum + (t.total_hours || 0), 0) || 0;

    // Get inspection pass/fail statistics for this month
    const { data: inspectionItems } = await supabase
      .from('inspection_items')
      .select(`
        status,
        inspection:vehicle_inspections!inner (
          inspection_date
        )
      `)
      .gte('inspection.inspection_date', startOfMonth.toISOString())
      .lte('inspection.inspection_date', endOfMonth.toISOString());

    const passCount = inspectionItems?.filter(i => i.status === 'pass').length || 0;
    const failCount = inspectionItems?.filter(i => i.status === 'fail').length || 0;
    const totalItems = passCount + failCount;
    const passRate = totalItems > 0 ? ((passCount / totalItems) * 100).toFixed(1) : 0;

    // Get defects requiring attention (failed items from last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: recentDefects } = await supabase
      .from('inspection_items')
      .select(`
        id,
        inspection:vehicle_inspections!inner (
          inspection_date,
          status
        )
      `)
      .eq('status', 'fail')
      .gte('inspection.inspection_date', thirtyDaysAgo.toISOString());

    const outstandingDefects = recentDefects?.filter(
      (d: any) => d.inspection.status !== 'approved'
    ).length || 0;

    // Return statistics
    return NextResponse.json({
      timesheets: {
        weekHours: Math.round(weekHours * 100) / 100,
        monthHours: Math.round(monthHours * 100) / 100,
        pendingApprovals: pendingTimesheetsResult.count || 0,
      },
      inspections: {
        weekCompleted: weekInspectionsResult.count || 0,
        monthCompleted: monthInspectionsResult.count || 0,
        pendingApprovals: pendingInspectionsResult.count || 0,
        passRate: parseFloat(passRate),
        outstandingDefects,
      },
      employees: {
        active: activeEmployeesResult.count || 0,
      },
      summary: {
        totalPendingApprovals: (pendingTimesheetsResult.count || 0) + (pendingInspectionsResult.count || 0),
        needsAttention: outstandingDefects,
      },
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500 }
    );
  }
}

