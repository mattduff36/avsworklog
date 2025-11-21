import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
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
    const profile = await getProfileWithRole(user.id);

    if (!profile || !profile.role?.is_manager_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    // Build query for inspections with defects
    let query = supabase
      .from('vehicle_inspections')
      .select(`
        id,
        inspection_date,
        inspection_end_date,
        status,
        submitted_at,
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
        ),
        inspection_items!inner (
          item_number,
          item_description,
          status,
          comments
        )
      `)
      .eq('inspection_items.status', 'defect')
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
      console.error('Error fetching defects:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!inspections || inspections.length === 0) {
      return NextResponse.json({ error: 'No defects found for the specified criteria' }, { status: 404 });
    }

    // Transform data for Excel - one row per defect
    const excelData: any[] = [];

    inspections.forEach((inspection: any) => {
      const defectItems = (inspection.inspection_items || []).filter((item: any) => item.status === 'defect');
      
      defectItems.forEach((item: any) => {
        excelData.push({
          'Vehicle Reg': inspection.vehicle?.reg_number || '-',
          'Vehicle Type': inspection.vehicle?.vehicle_type || '-',
          'Inspector': inspection.inspector?.full_name || 'Unknown',
          'Inspection Date': formatExcelDate(inspection.inspection_date),
          'Item #': item.item_number,
          'Item Description': item.item_description,
          'Defect Comments': item.comments || '-',
          'Inspection Status': formatExcelStatus(inspection.status),
        });
      });
    });

    // Add summary
    const totalDefects = excelData.length;
    const uniqueVehicles = new Set(excelData.map((row: any) => row['Vehicle Reg'])).size;

    excelData.push({
      'Vehicle Reg': '',
      'Vehicle Type': '',
      'Inspector': '',
      'Inspection Date': '',
      'Item #': '',
      'Item Description': '',
      'Defect Comments': '',
      'Inspection Status': '',
    });

    excelData.push({
      'Vehicle Reg': 'SUMMARY',
      'Vehicle Type': '',
      'Inspector': '',
      'Inspection Date': `Total Defects: ${totalDefects}`,
      'Item #': '',
      'Item Description': `Affected Vehicles: ${uniqueVehicles}`,
      'Defect Comments': '',
      'Inspection Status': '',
    });

    // Generate Excel file
    const buffer = generateExcelFile([
      {
        sheetName: 'Defects Report',
        columns: [
          { header: 'Vehicle Reg', key: 'Vehicle Reg', width: 12 },
          { header: 'Vehicle Type', key: 'Vehicle Type', width: 15 },
          { header: 'Inspector', key: 'Inspector', width: 20 },
          { header: 'Inspection Date', key: 'Inspection Date', width: 14 },
          { header: 'Item #', key: 'Item #', width: 8 },
          { header: 'Item Description', key: 'Item Description', width: 30 },
          { header: 'Defect Comments', key: 'Defect Comments', width: 40 },
          { header: 'Inspection Status', key: 'Inspection Status', width: 12 },
        ],
        data: excelData,
      },
    ]);

    // Generate filename
    const dateRange = dateFrom && dateTo 
      ? `${dateFrom}_to_${dateTo}`
      : new Date().toISOString().split('T')[0];
    const filename = `Defects_Report_${dateRange}.xlsx`;

    // Return Excel file
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating defects report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    );
  }
}
