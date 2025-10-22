import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderToStream } from '@react-pdf/renderer';
import { InspectionPDF } from '@/lib/pdf/inspection-pdf';

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

    // Fetch inspection with items
    const { data: inspection, error: inspectionError } = await supabase
      .from('vehicle_inspections')
      .select(`
        *,
        vehicle:vehicles(registration_number)
      `)
      .eq('id', id)
      .single();

    if (inspectionError || !inspection) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 });
    }

    // Fetch inspection items
    const { data: items, error: itemsError } = await supabase
      .from('inspection_items')
      .select('*')
      .eq('inspection_id', id)
      .order('item_number', { ascending: true });

    if (itemsError || !items) {
      return NextResponse.json({ error: 'Inspection items not found' }, { status: 404 });
    }

    // Check authorization - user must be owner, manager, or admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const isOwner = inspection.user_id === user.id;
    const isManager = profile?.role === 'manager' || profile?.role === 'admin';

    if (!isOwner && !isManager) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get employee details
    const { data: employee } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', inspection.user_id)
      .single();

    // Generate PDF
    const stream = await renderToStream(
      InspectionPDF({
        inspection,
        items,
        vehicleReg: inspection.vehicle?.registration_number,
        employeeName: employee?.full_name,
        employeeEmail: employee?.email,
      })
    );

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
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
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}

