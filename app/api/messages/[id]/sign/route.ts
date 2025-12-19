import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { SignMessageResponse } from '@/types/messages';
import { logServerError } from '@/lib/utils/server-error-logger';

/**
 * POST /api/messages/[id]/sign
 * Record signature for a Toolbox Talk message
 * Updates recipient status to SIGNED with signature data and timestamp
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: recipientId } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { signature_data } = body;

    if (!signature_data) {
      return NextResponse.json({ error: 'Signature data is required' }, { status: 400 });
    }

    // Fetch the recipient record to verify ownership and status
    const { data: recipient, error: fetchError } = await supabase
      .from('message_recipients')
      .select(`
        *,
        messages!inner(
          id,
          type,
          deleted_at
        )
      `)
      .eq('id', recipientId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !recipient) {
      return NextResponse.json({ 
        error: 'Message recipient not found or unauthorized' 
      }, { status: 404 });
    }

    // Check if message has been deleted
    if (recipient.messages.deleted_at) {
      return NextResponse.json({ 
        error: 'This message has been deleted' 
      }, { status: 410 });
    }

    // Verify this is a Toolbox Talk
    if (recipient.messages.type !== 'TOOLBOX_TALK') {
      return NextResponse.json({ 
        error: 'Only Toolbox Talk messages require signatures' 
      }, { status: 400 });
    }

    // Check if already signed
    if (recipient.status === 'SIGNED') {
      return NextResponse.json({ 
        error: 'This message has already been signed' 
      }, { status: 400 });
    }

    // Update recipient status to SIGNED
    const { data: updatedRecipient, error: updateError } = await supabase
      .from('message_recipients')
      .update({
        status: 'SIGNED',
        signature_data,
        signed_at: new Date().toISOString(),
        first_shown_at: recipient.first_shown_at || new Date().toISOString()
      })
      .eq('id', recipientId)
      .select()
      .single();

    if (updateError || !updatedRecipient) {
      console.error('Error updating recipient:', updateError);
      return NextResponse.json({ 
        error: 'Failed to record signature' 
      }, { status: 500 });
    }

    const response: SignMessageResponse = {
      success: true,
      recipient: updatedRecipient
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in POST /api/messages/[id]/sign:', error);

    
    // Log error to database
    await logServerError({
      error: error as Error,
      request,
      componentName: '/messages/:id/sign',
      additionalData: {
        endpoint: '/messages/:id/sign',
      },
    );
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

