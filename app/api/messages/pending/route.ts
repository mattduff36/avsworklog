import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { GetPendingMessagesResponse } from '@/types/messages';
import { logServerError } from '@/lib/utils/server-error-logger';

/**
 * GET /api/messages/pending
 * Fetch pending Toolbox Talks and Reminders for the current user
 * Used by blocking modal to check what messages need attention
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch pending Toolbox Talks (PENDING status, not soft-deleted)
    const { data: toolboxTalks, error: toolboxError } = await supabase
      .from('message_recipients')
      .select(`
        id,
        message_id,
        status,
        messages!inner(
          id,
          type,
          subject,
          body,
          priority,
          sender_id,
          created_at,
          deleted_at,
          pdf_file_path,
          sender:sender_id(
            id,
            full_name
          )
        )
      `)
      .eq('user_id', user.id)
      .eq('status', 'PENDING')
      .eq('messages.type', 'TOOLBOX_TALK')
      .is('messages.deleted_at', null)
      .order('messages(created_at)', { ascending: true }); // Oldest first

    if (toolboxError) {
      console.error('Error fetching toolbox talks:', toolboxError);
      throw toolboxError;
    }

    // Fetch pending Reminders (PENDING status, not soft-deleted)
    const { data: reminders, error: remindersError } = await supabase
      .from('message_recipients')
      .select(`
        id,
        message_id,
        status,
        messages!inner(
          id,
          type,
          subject,
          body,
          priority,
          sender_id,
          created_at,
          deleted_at,
          sender:sender_id(
            id,
            full_name
          )
        )
      `)
      .eq('user_id', user.id)
      .eq('status', 'PENDING')
      .eq('messages.type', 'REMINDER')
      .is('messages.deleted_at', null)
      .order('messages(created_at)', { ascending: false }); // Newest first

    if (remindersError) {
      console.error('Error fetching reminders:', remindersError);
      throw remindersError;
    }

    // Transform the data to include recipient_id for updates
    const formattedToolboxTalks = toolboxTalks?.map(item => ({
      ...item.messages,
      recipient_id: item.id,
      sender_name: item.messages.sender?.full_name || 'Deleted User'
    })) || [];

    const formattedReminders = reminders?.map(item => ({
      ...item.messages,
      recipient_id: item.id,
      sender_name: item.messages.sender?.full_name || 'Deleted User'
    })) || [];

    const response: GetPendingMessagesResponse = {
      success: true,
      toolbox_talks: formattedToolboxTalks,
      reminders: formattedReminders
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in GET /api/messages/pending:', error);

    
    // Log error to database
    await logServerError({
      error: error as Error,
      request,
      componentName: '/messages/pending',
      additionalData: {
        endpoint: '/messages/pending',
      },
    );
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

