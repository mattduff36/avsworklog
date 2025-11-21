import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { GetReportsResponse, MessageReportData } from '@/types/messages';

/**
 * GET /api/messages/reports
 * Fetch Toolbox Talk reporting data for managers/admins
 * Includes message details, recipient lists, and compliance statistics
 */
export async function GET(request: NextRequest) {
  try {
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

    // Parse query parameters for filtering
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const senderId = searchParams.get('sender_id');
    const type = searchParams.get('type'); // 'TOOLBOX_TALK' or 'REMINDER'
    const status = searchParams.get('status'); // 'all', 'signed', 'pending'

    // Build query for messages
    let messagesQuery = supabase
      .from('messages')
      .select(`
        id,
        type,
        subject,
        body,
        priority,
        sender_id,
        created_at,
        updated_at,
        deleted_at,
        sender:profiles!messages_sender_id_fkey(
          id,
          full_name
        )
      `)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    // Apply filters
    if (dateFrom) {
      messagesQuery = messagesQuery.gte('created_at', dateFrom);
    }
    if (dateTo) {
      messagesQuery = messagesQuery.lte('created_at', dateTo);
    }
    if (senderId) {
      messagesQuery = messagesQuery.eq('sender_id', senderId);
    }
    if (type && ['TOOLBOX_TALK', 'REMINDER'].includes(type)) {
      messagesQuery = messagesQuery.eq('type', type);
    }

    const { data: messages, error: messagesError } = await messagesQuery;

    if (messagesError) {
      console.error('Error fetching messages:', messagesError);
      throw messagesError;
    }

    // For each message, fetch recipient details
    const reportsData: MessageReportData[] = [];

    for (const message of messages || []) {
      // Fetch all recipients for this message
      const recipientsQuery = supabase
        .from('message_recipients')
        .select(`
          id,
          user_id,
          status,
          signed_at,
          created_at,
          user:profiles!message_recipients_user_id_fkey(
            full_name,
            role,
            employee_id
          )
        `)
        .eq('message_id', message.id)
        .order('created_at', { ascending: true });

      const { data: recipients, error: recipientsError } = await recipientsQuery;

      if (recipientsError) {
        console.error('Error fetching recipients:', recipientsError);
        continue;
      }

      const totalAssigned = recipients?.length || 0;
      const totalSigned = recipients?.filter(r => r.status === 'SIGNED').length || 0;
      const totalPending = recipients?.filter(r => r.status === 'PENDING' || r.status === 'SHOWN').length || 0;
      const complianceRate = totalAssigned > 0 ? Math.round((totalSigned / totalAssigned) * 100) : 0;

      // Apply status filter at the report level
      if (status === 'signed' && totalPending > 0) {
        continue; // Skip if not fully signed
      }
      if (status === 'pending' && totalPending === 0) {
        continue; // Skip if fully signed
      }

      reportsData.push({
        message: {
          ...message,
          sender_name: message.sender?.full_name || 'Deleted User'
        },
        recipients: recipients || [],
        total_assigned: totalAssigned,
        total_signed: totalSigned,
        total_pending: totalPending,
        compliance_rate: complianceRate
      });
    }

    const response: GetReportsResponse = {
      success: true,
      messages: reportsData
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in GET /api/messages/reports:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

