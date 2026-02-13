import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderToStream } from '@react-pdf/renderer';
import { PlantInspectionPDF } from '@/lib/pdf/plant-inspection-pdf';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';

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

    // Fetch inspection with plant and employee details
    const { data: inspection, error: inspectionError } = await supabase
      .from('vehicle_inspections')
      .select(`
        *,
        plant (
          plant_id,
          nickname,
          serial_number,
          vehicle_categories(name)
        ),
        profile:profiles!vehicle_inspections_user_id_fkey(full_name)
      `)
      .eq('id', id)
      .not('plant_id', 'is', null)
      .single();

    if (inspectionError || !inspection) {
      return NextResponse.json({ error: 'Plant inspection not found' }, { status: 404 });
    }

    // Fetch inspection items
    const { data: items, error: itemsError } = await supabase
      .from('inspection_items')
      .select('*')
      .eq('inspection_id', id)
      .order('item_number', { ascending: true });

    if (itemsError) {
      console.error('Items error:', itemsError);
      return NextResponse.json({ error: 'Failed to fetch inspection items', details: itemsError.message }, { status: 500 });
    }

    if (!items || items.length === 0) {
      console.error('No items found for inspection:', id);
      return NextResponse.json({ error: 'Inspection items not found' }, { status: 404 });
    }

    // Fetch daily hours
    const { data: dailyHours, error: hoursError } = await supabase
      .from('inspection_daily_hours')
      .select('*')
      .eq('inspection_id', id)
      .order('day_of_week', { ascending: true });

    if (hoursError) {
      console.error('Daily hours error:', hoursError);
      return NextResponse.json({ error: 'Failed to fetch daily hours', details: hoursError.message }, { status: 500 });
    }

    // Check authorization - user must be owner, manager, or admin
    const profile = await getProfileWithRole(user.id);

    const isOwner = inspection.user_id === user.id;
    const isManager = profile?.role?.is_manager_admin || false;

    if (!isOwner && !isManager) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Generate PDF
    const pdfComponent = PlantInspectionPDF({
      inspection: {
        id: inspection.id,
        inspection_date: inspection.inspection_date,
        inspection_end_date: inspection.inspection_end_date,
        inspector_comments: inspection.inspector_comments,
        signature_data: inspection.signature_data,
      },
      plant: {
        plant_id: (inspection as any).plant?.plant_id || 'Unknown',
        nickname: (inspection as any).plant?.nickname,
        vehicle_categories: (inspection as any).plant?.vehicle_categories,
      },
      operator: {
        full_name: (inspection as any).profile?.full_name || 'Unknown',
      },
      items: items.map(item => ({
        item_number: item.item_number,
        item_description: item.item_description,
        day_of_week: item.day_of_week,
        status: item.status as 'ok' | 'attention' | 'na',
        comments: item.comments,
      })),
      dailyHours: (dailyHours || []).map(h => ({
        day_of_week: h.day_of_week,
        hours: h.hours,
      })),
    });
    
    const stream = await renderToStream(pdfComponent);

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const plantId = (inspection as any).plant?.plant_id || 'unknown';
    const date = inspection.inspection_end_date.replace(/-/g, '');

    // Return PDF
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="plant-inspection-${plantId}-${date}.pdf"`,
      },
    });
  } catch (error) {
    console.error('PDF generation error:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/plant-inspections/[id]/pdf',
      additionalData: {
        endpoint: '/api/plant-inspections/[id]/pdf',
      },
    });
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
