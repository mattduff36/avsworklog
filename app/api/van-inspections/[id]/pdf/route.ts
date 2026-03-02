import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderToStream } from '@react-pdf/renderer';
import { InspectionPDF } from '@/lib/pdf/inspection-pdf';
import { VanInspectionPDF } from '@/lib/pdf/van-inspection-pdf';
import { isVanCategory } from '@/lib/checklists/vehicle-checklists';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { getVehicleCategoryName } from '@/lib/utils/deprecation-logger';
import { logServerError } from '@/lib/utils/server-error-logger';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Get the current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch inspection with items and employee details
    const { data: inspection, error: inspectionError } = await supabase
      .from('van_inspections')
      .select(`
        *,
        vehicle:vans(
          reg_number, 
          vehicle_type,
          van_categories(name)
        ),
        profile:profiles!van_inspections_user_id_fkey(full_name)
      `)
      .eq('id', id)
      .single();

    if (inspectionError || !inspection) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 });
    }

    // Guard: vehicle must exist with category data for PDF generation
    if (!(inspection as any).vehicle) {
      return NextResponse.json(
        { error: 'Vehicle data not found for this inspection. The vehicle may have been deleted.' },
        { status: 404 }
      );
    }

    // Fetch inspection items
    const { data: items, error: itemsError } = await supabase
      .from('inspection_items')
      .select('*')
      .eq('inspection_id', id)
      .order('item_number', { ascending: true });

    if (itemsError) {
      await logServerError({
        error: new Error(`Failed to fetch inspection items: ${itemsError.message}`),
        request,
        componentName: '/api/van-inspections/[id]/pdf',
        additionalData: {
          inspectionId: id,
          supabaseError: {
            code: (itemsError as any).code,
            message: itemsError.message,
            details: (itemsError as any).details,
            hint: (itemsError as any).hint,
          },
        },
      });
      return NextResponse.json({ error: 'Failed to fetch inspection items' }, { status: 500 });
    }

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'Inspection items not found' }, { status: 404 });
    }

    // Check authorization - user must be owner, manager, or admin
    const profile = await getProfileWithRole(user.id);

    const isOwner = (inspection as { user_id?: string | null }).user_id === user.id;
    const isManager = profile?.role?.is_manager_admin || false;

    if (!isOwner && !isManager) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Determine which PDF template to use based on vehicle category
    const vehicleType = getVehicleCategoryName((inspection as any).vehicle);
    const useVanTemplate = isVanCategory(vehicleType);
    
    console.log(`PDF Generation - Vehicle Type: ${vehicleType}, Using Van Template: ${useVanTemplate}`);
    
    // Generate PDF using the appropriate template
    const pdfComponent = useVanTemplate
      ? VanInspectionPDF({
          inspection,
          items,
          vehicleReg: (inspection as any).vehicle?.reg_number,
          employeeName: (inspection as any).profile?.full_name,
        })
      : InspectionPDF({
          inspection,
          items,
          vehicleReg: (inspection as any).vehicle?.reg_number,
          employeeName: (inspection as any).profile?.full_name,
        });
    
    const stream = await renderToStream(pdfComponent);

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    for await (const chunk of stream as any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    // Return PDF
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="inspection-${id}.pdf"`,
      },
    });
  } catch (error) {
    console.error('PDF generation error:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/van-inspections/[id]/pdf',
      additionalData: {
        endpoint: '/api/van-inspections/[id]/pdf',
      },
    });
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}

