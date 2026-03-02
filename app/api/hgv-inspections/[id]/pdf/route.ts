import { NextRequest, NextResponse } from 'next/server';
import { renderToStream } from '@react-pdf/renderer';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { HgvInspectionPDF } from '@/lib/pdf/hgv-inspection-pdf';

interface HgvInspectionWithRelations {
  id: string;
  user_id: string;
  inspection_date: string;
  current_mileage: number | null;
  inspector_comments: string | null;
  signature_data: string | null;
  signed_at: string | null;
  hgv?: {
    reg_number: string;
    nickname: string | null;
    hgv_categories: { name: string } | null;
  } | null;
  profile?: {
    full_name: string;
  } | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: inspection, error: inspectionError } = await supabase
      .from('hgv_inspections')
      .select(`
        *,
        hgv:hgvs!hgv_inspections_hgv_id_fkey (
          reg_number,
          nickname,
          hgv_categories(name)
        ),
        profile:profiles!hgv_inspections_user_id_fkey(full_name)
      `)
      .eq('id', id)
      .single();

    if (inspectionError || !inspection) {
      return NextResponse.json({ error: 'HGV inspection not found' }, { status: 404 });
    }

    const { data: items, error: itemsError } = await supabase
      .from('inspection_items')
      .select('*')
      .eq('inspection_id', id)
      .order('item_number', { ascending: true });

    if (itemsError) {
      return NextResponse.json({ error: 'Failed to fetch inspection items' }, { status: 500 });
    }

    const profile = await getProfileWithRole(user.id);
    const isOwner = inspection.user_id === user.id;
    const isManager = profile?.role?.is_manager_admin || false;

    if (!isOwner && !isManager) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const inspectionWithRelations = inspection as unknown as HgvInspectionWithRelations;

    const pdfComponent = HgvInspectionPDF({
      inspection: {
        id: inspectionWithRelations.id,
        inspection_date: inspectionWithRelations.inspection_date,
        current_mileage: inspectionWithRelations.current_mileage,
        inspector_comments: inspectionWithRelations.inspector_comments,
        signature_data: inspectionWithRelations.signature_data,
        signed_at: inspectionWithRelations.signed_at,
      },
      hgv: {
        reg_number: inspectionWithRelations.hgv?.reg_number || 'Unknown',
        nickname: inspectionWithRelations.hgv?.nickname || null,
        hgv_categories: inspectionWithRelations.hgv?.hgv_categories || null,
      },
      operator: {
        full_name: inspectionWithRelations.profile?.full_name || 'Unknown',
      },
      items: (items || []).map(item => ({
        item_number: item.item_number,
        item_description: item.item_description,
        day_of_week: item.day_of_week,
        status: item.status as 'ok' | 'attention' | 'na',
        comments: item.comments,
      })),
    });

    const stream = await renderToStream(pdfComponent);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    const reg = (inspectionWithRelations.hgv?.reg_number || 'hgv').replace(/[^a-zA-Z0-9-_]/g, '');
    const date = inspectionWithRelations.inspection_date.replace(/-/g, '');

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="hgv-inspection-${reg}-${date}.pdf"`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
