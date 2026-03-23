import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('quote_attachments')
      .select('*')
      .eq('quote_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ attachments: data || [] });
  } catch (error) {
    console.error('Error fetching quote attachments:', error);
    return NextResponse.json({ error: 'Failed to fetch attachments' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    const sanitizedFilename = file.name.replace(/[^a-z0-9_.-]/gi, '_');
    const filePath = `${id}/${Date.now()}_${sanitizedFilename}`;
    const fileBuffer = await file.arrayBuffer();

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('quote-attachments')
      .upload(filePath, fileBuffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: attachment, error: insertError } = await supabase
      .from('quote_attachments')
      .insert({
        quote_id: id,
        file_name: file.name,
        file_path: uploadData.path,
        content_type: file.type || null,
        file_size: file.size,
        uploaded_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      await supabase.storage.from('quote-attachments').remove([uploadData.path]);
      throw insertError;
    }

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    console.error('Error uploading quote attachment:', error);
    return NextResponse.json({ error: 'Failed to upload attachment' }, { status: 500 });
  }
}
