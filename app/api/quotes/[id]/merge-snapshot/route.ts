import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to view quote PDFs.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const admin = createAdminClient();
    const { data: snapshot, error } = await admin
      .from('quote_pdf_snapshots')
      .select('*')
      .eq('quote_id', id)
      .maybeSingle();
    if (error) throw error;
    if (!snapshot) {
      return NextResponse.json({ error: 'No pre-merge PDF snapshot exists for this version.' }, { status: 404 });
    }

    const { data: file, error: downloadError } = await admin.storage
      .from('quote-pdf-snapshots')
      .download(snapshot.storage_path);
    if (downloadError || !file) throw downloadError || new Error('PDF snapshot not found');

    return new NextResponse(await file.arrayBuffer(), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${snapshot.original_reference}-original.pdf"`,
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error downloading quote merge PDF snapshot:', error);
    return NextResponse.json({ error: 'Unable to download the original quote PDF.' }, { status: 500 });
  }
}
