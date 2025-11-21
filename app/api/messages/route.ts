import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendToolboxTalkEmail } from '@/lib/utils/email';
import { getProfileWithRole } from '@/lib/utils/permissions';
import type { CreateMessageInput, CreateMessageResponse } from '@/types/messages';

/**
 * POST /api/messages
 * Create a new Toolbox Talk or Reminder message
 * Only managers/admins can create messages
 */
export async function POST(request: NextRequest) {
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

    // Parse request body
    const body: CreateMessageInput = await request.json();
    const { type, subject, body: messageBody, recipient_type, recipient_user_ids, recipient_roles } = body;

    // Validate required fields
    if (!type || !subject || !messageBody || !recipient_type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!['TOOLBOX_TALK', 'REMINDER'].includes(type)) {
      return NextResponse.json({ error: 'Invalid message type' }, { status: 400 });
    }

    // Resolve recipients based on selection type
    let recipientUserIds: string[] = [];

    if (recipient_type === 'individual') {
      if (!recipient_user_ids || recipient_user_ids.length === 0) {
        return NextResponse.json({ error: 'No recipients specified' }, { status: 400 });
      }
      recipientUserIds = recipient_user_ids;

    } else if (recipient_type === 'role') {
      if (!recipient_roles || recipient_roles.length === 0) {
        return NextResponse.json({ error: 'No roles specified' }, { status: 400 });
      }

      // Fetch users with the specified roles
      const { data: roleUsers, error: roleError } = await supabase
        .from('profiles')
        .select('id')
        .in('role', recipient_roles);

      if (roleError) throw roleError;
      
      recipientUserIds = roleUsers?.map(u => u.id) || [];

    } else if (recipient_type === 'all_staff') {
      // Fetch all active users
      const { data: allUsers, error: allError } = await supabase
        .from('profiles')
        .select('id');

      if (allError) throw allError;
      
      recipientUserIds = allUsers?.map(u => u.id) || [];
    }

    if (recipientUserIds.length === 0) {
      return NextResponse.json({ error: 'No valid recipients found' }, { status: 400 });
    }

    // Set priority based on type
    const priority = type === 'TOOLBOX_TALK' ? 'HIGH' : 'LOW';

    // Create message
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .insert({
        type,
        subject,
        body: messageBody,
        priority,
        sender_id: user.id,
        created_via: 'web'
      })
      .select()
      .single();

    if (messageError || !message) {
      console.error('Error creating message:', messageError);
      return NextResponse.json({ error: 'Failed to create message' }, { status: 500 });
    }

    // Create message recipients
    const recipientRecords = recipientUserIds.map(userId => ({
      message_id: message.id,
      user_id: userId,
      status: 'PENDING' as const
    }));

    const { error: recipientsError } = await supabase
      .from('message_recipients')
      .insert(recipientRecords);

    if (recipientsError) {
      console.error('Error creating recipients:', recipientsError);
      // Clean up message if recipients creation failed
      await supabase.from('messages').delete().eq('id', message.id);
      return NextResponse.json({ error: 'Failed to assign recipients' }, { status: 500 });
    }

    // Send email notifications for Toolbox Talks only
    if (type === 'TOOLBOX_TALK') {
      // Fetch recipient email addresses
      const { data: recipientProfiles, error: emailError } = await supabase
        .from('profiles')
        .select('id, full_name, email:auth.users(email)')
        .in('id', recipientUserIds);

      if (!emailError && recipientProfiles) {
        // Extract email addresses (handle the auth.users join)
        const recipientEmails: string[] = [];
        
        // Use admin client to fetch emails from auth.users
        const { createClient: createAdminClient } = await import('@supabase/supabase-js');
        const adminClient = createAdminClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        for (const userId of recipientUserIds) {
          const { data: authUser } = await adminClient.auth.admin.getUserById(userId);
          if (authUser?.user?.email) {
            recipientEmails.push(authUser.user.email);
          }
        }

        if (recipientEmails.length > 0) {
          // Send emails (with batching handled inside the function)
          const emailResult = await sendToolboxTalkEmail({
            to: recipientEmails,
            senderName: profile.full_name,
            subject
          });

          console.log('Email sending result:', emailResult);
        }
      }
    }

    const response: CreateMessageResponse = {
      success: true,
      message,
      recipients_created: recipientUserIds.length
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in POST /api/messages:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

