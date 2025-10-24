import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { 
  generateExcelFile, 
  formatExcelDate, 
  formatExcelStatus
} from '@/lib/utils/excel';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is manager or admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || !['admin', 'manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    // Build query
    let query = supabase
      .from('vehicle_inspections')
      .select(`
        id,
        inspection_date,
        inspection_end_date,
        status,
        submitted_at,
        reviewed_at,
        vehicle_id,
        vehicle:vehicles!vehicle_inspections_vehicle_id_fkey (
          id,
          reg_number,
          vehicle_type
        ),
        user_id,
        inspector:profiles!vehicle_inspections_user_id_fkey (
          id,
          full_name,
          employee_id
        )
      `)
      .order('inspection_date', { ascending: false });

    // Apply filters
    if (dateFrom) {
      query = query.gte('inspection_date', dateFrom);
    }
    if (dateTo) {
      query = query.lte('inspection_date', dateTo);
    }

    const { data: inspections, error } = await query;

    if (error) {
      console.error('Error fetching inspections:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!inspections || inspections.length === 0) {
      return NextResponse.json({ error: 'No inspections found for the specified criteria' }, { status: 404 });
    }

    // Transform data for Excel
    const excelData = inspections.map((inspection: any) => ({
      'Vehicle Reg': inspection.vehicle?.reg_number || '-',
      'Vehicle Type': inspection.vehicle?.vehicle_type || '-',
      'Inspector': inspection.inspector?.full_name || 'Unknown',
      'Employee ID': inspection.inspector?.employee_id || '-',
      'Inspection Date': formatExcelDate(inspection.inspection_date),
      'End Date': inspection.inspection_end_date ? formatExcelDate(inspection.inspection_end_date) : '-',
      'Status': formatExcelStatus(inspection.status),
      'Submitted': inspection.submitted_at ? formatExcelDate(inspection.submitted_at) : '-',
      'Reviewed': inspection.reviewed_at ? formatExcelDate(inspection.reviewed_at) : '-',
    }));

    // Add summary statistics
    const totalInspections = inspections.length;
    const submittedCount = inspections.filter((i: any) => i.status !== 'draft').length;
    const approvedCount = inspections.filter((i: any) => i.status === 'approved').length;
    const complianceRate = totalInspections > 0 ? ((submittedCount / totalInspections) * 100).toFixed(1) : '0';

    excelData.push({
      'Vehicle Reg': '',
      'Vehicle Type': '',
      'Inspector': '',
      'Employee ID': '',
      'Inspection Date': '',
      'End Date': '',
      'Status': '',
      'Submitted': '',
      'Reviewed': '',
    });

    excelData.push({
      'Vehicle Reg': 'SUMMARY',
      'Vehicle Type': '',
      'Inspector': '',
      'Employee ID': '',
      'Inspection Date': `Total: ${totalInspections}`,
      'End Date': `Submitted: ${submittedCount}`,
      'Status': `Approved: ${approvedCount}`,
      'Submitted': `Compliance: ${complianceRate}%`,
      'Reviewed': '',
    });

    // Generate Excel file
    const buffer = generateExcelFile([
      {
        sheetName: 'Inspection Compliance',
        columns: [
          { header: 'Vehicle Reg', key: 'Vehicle Reg', width: 12 },
          { header: 'Vehicle Type', key: 'Vehicle Type', width: 15 },
          { header: 'Inspector', key: 'Inspector', width: 20 },
          { header: 'Employee ID', key: 'Employee ID', width: 12 },
          { header: 'Inspection Date', key: 'Inspection Date', width: 14 },
          { header: 'End Date', key: 'End Date', width: 14 },
          { header: 'Status', key: 'Status', width: 10 },
          { header: 'Submitted', key: 'Submitted', width: 12 },
          { header: 'Reviewed', key: 'Reviewed', width: 12 },
        ],
        data: excelData,
      },
    ]);

    // Generate filename
    const dateRange = dateFrom && dateTo 
      ? `${dateFrom}_to_${dateTo}`
      : new Date().toISOString().split('T')[0];
    const filename = `Inspection_Compliance_${dateRange}.xlsx`;

    // Return Excel file
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating compliance report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    );
  }
}
