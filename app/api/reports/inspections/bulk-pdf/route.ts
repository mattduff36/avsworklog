import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { InspectionPDF } from '@/lib/pdf/inspection-pdf';
import { VanInspectionPDF } from '@/lib/pdf/van-inspection-pdf';
import { isVanCategory } from '@/lib/checklists/vehicle-checklists';
import { getProfileWithRole } from '@/lib/utils/permissions';

const MAX_INSPECTIONS_PER_PDF = 80;

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    // Validate parameters
    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: 'dateFrom and dateTo are required' },
        { status: 400 }
      );
    }

    // Get the current user and verify they're an admin/manager
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profile = await getProfileWithRole(user.id);
    if (!profile?.role?.is_manager_admin) {
      return NextResponse.json({ error: 'Unauthorized - Admin/Manager access required' }, { status: 403 });
    }

    // Fetch all non-draft inspections within the date range
    const { data: inspections, error: inspectionsError } = await supabase
      .from('vehicle_inspections')
      .select(`
        *,
        vehicle:vehicles(
          reg_number, 
          vehicle_type,
          vehicle_categories(name)
        ),
        profile:profiles!vehicle_inspections_user_id_fkey(full_name)
      `)
      .neq('status', 'draft')
      .gte('inspection_end_date', dateFrom)
      .lte('inspection_end_date', dateTo)
      .order('inspection_end_date', { ascending: true });

    if (inspectionsError) {
      console.error('Error fetching inspections:', inspectionsError);
      return NextResponse.json(
        { error: 'Failed to fetch inspections', details: inspectionsError.message },
        { status: 500 }
      );
    }

    if (!inspections || inspections.length === 0) {
      return NextResponse.json(
        { error: 'No inspections found in the selected date range' },
        { status: 404 }
      );
    }

    // If more than MAX_INSPECTIONS_PER_PDF, we need to create multiple PDFs in a ZIP
    const needsZip = inspections.length > MAX_INSPECTIONS_PER_PDF;
    
    // Split inspections into chunks of MAX_INSPECTIONS_PER_PDF
    const chunks: typeof inspections[] = [];
    for (let i = 0; i < inspections.length; i += MAX_INSPECTIONS_PER_PDF) {
      chunks.push(inspections.slice(i, i + MAX_INSPECTIONS_PER_PDF));
    }

    // Generate PDFs for each chunk
    const pdfBuffers: { name: string; buffer: Buffer }[] = [];
    
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const mergedPdf = await PDFDocument.create();

      for (let i = 0; i < chunk.length; i++) {
        const inspection = chunk[i];
        
        // Fetch inspection items
        const { data: items, error: itemsError } = await supabase
          .from('inspection_items')
          .select('*')
          .eq('inspection_id', inspection.id)
          .order('item_number', { ascending: true });

        if (itemsError || !items || items.length === 0) {
          console.error(`Failed to fetch items for inspection ${inspection.id}:`, itemsError);
          continue; // Skip this inspection
        }

        // Determine which PDF template to use based on vehicle category
        const categoryName = (inspection as any).vehicle?.vehicle_categories?.name;
        const vehicleType = categoryName || (inspection as any).vehicle?.vehicle_type || '';
        const useVanTemplate = isVanCategory(vehicleType);

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

        // Render to buffer
        const pdfBuffer = await renderToBuffer(pdfComponent);
        
        // Load this PDF and copy pages into merged document
        const singlePdf = await PDFDocument.load(pdfBuffer);
        const pages = await mergedPdf.copyPages(singlePdf, singlePdf.getPageIndices());
        pages.forEach((page) => mergedPdf.addPage(page));
      }

      // Save the merged PDF
      const mergedPdfBytes = await mergedPdf.save();
      const suffix = chunks.length > 1 ? `_Part${chunkIndex + 1}` : '';
      pdfBuffers.push({
        name: `All_Inspections_${dateFrom}_to_${dateTo}${suffix}.pdf`,
        buffer: Buffer.from(mergedPdfBytes),
      });
    }

    // If we only have one PDF, return it directly
    if (pdfBuffers.length === 1) {
      return new NextResponse(pdfBuffers[0].buffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${pdfBuffers[0].name}"`,
        },
      });
    }

    // Multiple PDFs - create a ZIP file
    const zip = new JSZip();
    pdfBuffers.forEach(({ name, buffer }) => {
      zip.file(name, buffer);
    });

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    return new NextResponse(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="All_Inspections_${dateFrom}_to_${dateTo}.zip"`,
      },
    });

  } catch (error) {
    console.error('Bulk PDF generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate PDFs', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// POST endpoint for streaming progress updates
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const supabase = await createClient();
        const body = await request.json();
        const { dateFrom, dateTo } = body;

        // Validate parameters
        if (!dateFrom || !dateTo) {
          controller.enqueue(encoder.encode(JSON.stringify({ error: 'dateFrom and dateTo are required' }) + '\n'));
          controller.close();
          return;
        }

        // Get the current user and verify they're an admin/manager
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
          controller.enqueue(encoder.encode(JSON.stringify({ error: 'Unauthorized' }) + '\n'));
          controller.close();
          return;
        }

        const profile = await getProfileWithRole(user.id);
        if (!profile?.role?.is_manager_admin) {
          controller.enqueue(encoder.encode(JSON.stringify({ error: 'Unauthorized - Admin/Manager access required' }) + '\n'));
          controller.close();
          return;
        }

        // Fetch all non-draft inspections within the date range
        const { data: inspections, error: inspectionsError } = await supabase
          .from('vehicle_inspections')
          .select(`
            *,
            vehicle:vehicles(
              reg_number, 
              vehicle_type,
              vehicle_categories(name)
            ),
            profile:profiles!vehicle_inspections_user_id_fkey(full_name)
          `)
          .neq('status', 'draft')
          .gte('inspection_end_date', dateFrom)
          .lte('inspection_end_date', dateTo)
          .order('inspection_end_date', { ascending: true });

        if (inspectionsError) {
          controller.enqueue(encoder.encode(JSON.stringify({ error: 'Failed to fetch inspections' }) + '\n'));
          controller.close();
          return;
        }

        if (!inspections || inspections.length === 0) {
          controller.enqueue(encoder.encode(JSON.stringify({ error: 'No inspections found in the selected date range' }) + '\n'));
          controller.close();
          return;
        }

        const totalInspections = inspections.length;
        const needsZip = totalInspections > MAX_INSPECTIONS_PER_PDF;
        const numParts = Math.ceil(totalInspections / MAX_INSPECTIONS_PER_PDF);

        // Send initial progress
        controller.enqueue(encoder.encode(JSON.stringify({ 
          type: 'init', 
          total: totalInspections,
          needsZip,
          numParts
        }) + '\n'));

        // Split inspections into chunks
        const chunks: typeof inspections[] = [];
        for (let i = 0; i < inspections.length; i += MAX_INSPECTIONS_PER_PDF) {
          chunks.push(inspections.slice(i, i + MAX_INSPECTIONS_PER_PDF));
        }

        const pdfBuffers: { name: string; buffer: Buffer }[] = [];
        let processedCount = 0;

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
          const chunk = chunks[chunkIndex];
          const mergedPdf = await PDFDocument.create();

          for (let i = 0; i < chunk.length; i++) {
            const inspection = chunk[i];

            // Fetch inspection items
            const { data: items, error: itemsError } = await supabase
              .from('inspection_items')
              .select('*')
              .eq('inspection_id', inspection.id)
              .order('item_number', { ascending: true });

            if (itemsError || !items || items.length === 0) {
              console.error(`Failed to fetch items for inspection ${inspection.id}:`, itemsError);
              continue;
            }

            // Only increment and report progress after successful item fetch
            processedCount++;
            
            // Send progress update
            controller.enqueue(encoder.encode(JSON.stringify({ 
              type: 'progress', 
              current: processedCount, 
              total: totalInspections,
              currentPart: chunkIndex + 1,
              totalParts: numParts
            }) + '\n'));

            // Determine which PDF template to use
            const categoryName = (inspection as any).vehicle?.vehicle_categories?.name;
            const vehicleType = categoryName || (inspection as any).vehicle?.vehicle_type || '';
            const useVanTemplate = isVanCategory(vehicleType);

            // Generate PDF
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

            const pdfBuffer = await renderToBuffer(pdfComponent);
            const singlePdf = await PDFDocument.load(pdfBuffer);
            const pages = await mergedPdf.copyPages(singlePdf, singlePdf.getPageIndices());
            pages.forEach((page) => mergedPdf.addPage(page));
          }

          // Save the merged PDF
          const mergedPdfBytes = await mergedPdf.save();
          const suffix = chunks.length > 1 ? `_Part${chunkIndex + 1}` : '';
          pdfBuffers.push({
            name: `All_Inspections_${dateFrom}_to_${dateTo}${suffix}.pdf`,
            buffer: Buffer.from(mergedPdfBytes),
          });
        }

        // Prepare final output
        let finalBuffer: Buffer;
        let fileName: string;
        let contentType: string;

        if (pdfBuffers.length === 1) {
          finalBuffer = pdfBuffers[0].buffer;
          fileName = pdfBuffers[0].name;
          contentType = 'application/pdf';
        } else {
          const zip = new JSZip();
          pdfBuffers.forEach(({ name, buffer }) => {
            zip.file(name, buffer);
          });
          finalBuffer = await zip.generateAsync({ type: 'nodebuffer' });
          fileName = `All_Inspections_${dateFrom}_to_${dateTo}.zip`;
          contentType = 'application/zip';
        }

        // Send final result with base64 encoded data
        controller.enqueue(encoder.encode(JSON.stringify({ 
          type: 'complete', 
          data: finalBuffer.toString('base64'),
          fileName,
          contentType
        }) + '\n'));

        controller.close();
      } catch (error) {
        console.error('Streaming PDF generation error:', error);
        controller.enqueue(encoder.encode(JSON.stringify({ 
          error: 'Failed to generate PDFs', 
          details: error instanceof Error ? error.message : 'Unknown error' 
        }) + '\n'));
        controller.close();
      }
    }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

