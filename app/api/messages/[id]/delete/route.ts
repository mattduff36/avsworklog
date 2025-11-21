import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * DELETE /api/messages/[id]/delete
 * Soft-delete a message (sets deleted_at timestamp)
 * Only managers/admins can delete messages
 * Deleted messages immediately disappear from unsigned users' queues
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: messageId } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is manager/admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || !['admin', 'manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden: Manager/Admin access required' }, { status: 403 });
    }

    // Check if message exists
    const { data: message, error: fetchError } = await supabase
      .from('messages')
      .select('id, deleted_at')
      .eq('id', messageId)
      .single();

    if (fetchError || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // Check if already deleted
    if (message.deleted_at) {
      return NextResponse.json({ error: 'Message already deleted' }, { status: 400 });
    }

    // Soft-delete the message (set deleted_at timestamp)
    const { error: deleteError } = await supabase
      .from('messages')
      .update({
        deleted_at: new Date().toISOString()
      })
      .eq('id', messageId);

    if (deleteError) {
      console.error('Error deleting message:', deleteError);
      return NextResponse.json({ 
        error: 'Failed to delete message' 
      }, { status: 500 });
    }

    // Note: We don't delete message_recipients rows for audit trail
    // The deleted_at check in other APIs will prevent showing this message

    return NextResponse.json({ 
      success: true,
      message: 'Message deleted successfully'
    });

  } catch (error) {
    console.error('Error in DELETE /api/messages/[id]/delete:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

