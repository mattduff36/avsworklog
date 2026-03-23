import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface RouteParams {
  params: Promise<{ id: string; attachmentId: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id, attachmentId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: attachment, error: fetchError } = await supabase
      .from('quote_attachments')
      .select('*')
      .eq('id', attachmentId)
      .eq('quote_id', id)
      .single();

    if (fetchError || !attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    const { error: deleteError } = await supabase
      .from('quote_attachments')
      .delete()
      .eq('id', attachmentId)
      .eq('quote_id', id);

    if (deleteError) throw deleteError;

    await supabase.storage.from('quote-attachments').remove([attachment.file_path]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting quote attachment:', error);
    return NextResponse.json({ error: 'Failed to delete attachment' }, { status: 500 });
  }
}
