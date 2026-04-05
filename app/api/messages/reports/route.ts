import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { GetReportsResponse, MessageReportData } from '@/types/messages';
import type { MessageType } from '@/types/messages';

interface ProfileShape {
  id?: string;
  full_name?: string | null;
  role?: string | null;
  employee_id?: string | null;
}

function pickProfile(
  profile: ProfileShape | ProfileShape[] | null | undefined
): ProfileShape | null {
  if (!profile) return null;
  return Array.isArray(profile) ? profile[0] ?? null : profile;
}

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
    const profile = await getProfileWithRole(user.id);

    if (!profile || !profile.role?.is_manager_admin) {
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
    
    // Type filter: default to TOOLBOX_TALK and REMINDER only (exclude NOTIFICATION)
    if (type && ['TOOLBOX_TALK', 'REMINDER'].includes(type)) {
      messagesQuery = messagesQuery.eq('type', type as MessageType);
    } else if (!type || type === 'all') {
      // When no specific type or 'all', only show toolbox-related messages
      messagesQuery = messagesQuery.in('type', ['TOOLBOX_TALK', 'REMINDER'] as MessageType[]);
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

      const normalizedRecipients =
        (recipients ?? []).map((recipient) => ({
          ...recipient,
          user: pickProfile(recipient.user as ProfileShape | ProfileShape[] | null),
        }));

      const totalAssigned = normalizedRecipients.length;
      const totalSigned = normalizedRecipients.filter((r) => r.status === 'SIGNED').length;
      const totalPending = normalizedRecipients.filter(
        (r) => r.status === 'PENDING' || r.status === 'SHOWN'
      ).length;
      const complianceRate = totalAssigned > 0 ? Math.round((totalSigned / totalAssigned) * 100) : 0;

      // Apply status filter at the report level
      if (status === 'signed' && totalPending > 0) {
        continue; // Skip if not fully signed
      }
      if (status === 'pending' && totalPending === 0) {
        continue; // Skip if fully signed
      }

      const sender = pickProfile(message.sender as ProfileShape | ProfileShape[] | null);
      reportsData.push({
        message: {
          ...message,
          created_via: 'api',
          pdf_file_path: null,
          sender: sender
            ? {
                id: sender.id ?? '',
                full_name: sender.full_name ?? 'Deleted User',
                role: sender.role ?? 'unknown',
              }
            : null,
        },
        recipients: normalizedRecipients.map((recipient) => ({
          ...recipient,
          message_id: message.id,
          first_shown_at: null,
          cleared_from_inbox_at: null,
          signature_data: null,
          updated_at: recipient.created_at,
          user: recipient.user
            ? {
                full_name: recipient.user.full_name ?? 'Unknown',
                role: recipient.user.role ?? 'unknown',
                employee_id: recipient.user.employee_id ?? null,
              }
            : null,
        })),
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

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/messages/reports',
      additionalData: {
        endpoint: '/api/messages/reports',
      },
    });
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

