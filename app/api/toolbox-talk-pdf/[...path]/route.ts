import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';

/**
 * GET /api/toolbox-talk-pdf/[...path]
 * Serves Toolbox Talk PDF files with authentication
 * Only accessible to users who have the message assigned to them or managers/admins
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Await params (Next.js 15 requirement)
    const resolvedParams = await params;
    
    // Reconstruct the file path
    const filePath = resolvedParams.path.join('/');

    if (!filePath) {
      return NextResponse.json({ error: 'File path required' }, { status: 400 });
    }

    // Download the file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('toolbox-talk-pdfs')
      .download(filePath);

    if (downloadError) {
      console.error('Error downloading PDF:', downloadError);
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Return the PDF file
    return new NextResponse(fileData, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline',
      },
    });

  } catch (error) {
    console.error('Error in GET /api/toolbox-talk-pdf:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/toolbox-talk-pdf/[...path]',
      additionalData: {
        endpoint: '/api/toolbox-talk-pdf/[...path]',
      },
    });
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

