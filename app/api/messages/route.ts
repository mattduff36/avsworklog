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
      console.error('Auth error:', userError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is manager/admin
    const profile = await getProfileWithRole(user.id);
    console.log('Profile fetched:', { 
      id: profile?.id, 
      full_name: profile?.full_name,
      role_id: profile?.role_id,
      role: profile?.role,
      is_manager_admin: profile?.role?.is_manager_admin 
    });

    if (!profile) {
      console.error('Profile not found for user:', user.id);
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 });
    }

    if (!profile.role) {
      console.error('User has no role assigned:', user.id);
      return NextResponse.json({ error: 'No role assigned to user' }, { status: 403 });
    }

    if (!profile.role.is_manager_admin) {
      console.error('User is not manager/admin:', user.id, profile.role);
      return NextResponse.json({ error: 'Forbidden: Manager/Admin access required' }, { status: 403 });
    }

    // Parse request body (could be JSON or FormData)
    const contentType = request.headers.get('content-type') || '';
    let type: string;
    let subject: string;
    let messageBody: string;
    let recipient_type: string;
    let recipient_user_ids: string[] | undefined;
    let recipient_roles: string[] | undefined;
    let pdfFile: File | null = null;

    if (contentType.includes('multipart/form-data')) {
      // Handle FormData (with PDF upload)
      const formData = await request.formData();
      type = formData.get('type') as string;
      subject = formData.get('subject') as string;
      messageBody = formData.get('body') as string;
      recipient_type = formData.get('recipient_type') as string;
      
      const recipientUserIdsStr = formData.get('recipient_user_ids') as string | null;
      recipient_user_ids = recipientUserIdsStr ? JSON.parse(recipientUserIdsStr) : undefined;
      
      const recipientRolesStr = formData.get('recipient_roles') as string | null;
      recipient_roles = recipientRolesStr ? JSON.parse(recipientRolesStr) : undefined;
      
      pdfFile = formData.get('pdf_file') as File | null;
    } else {
      // Handle JSON (for backwards compatibility)
      const body: CreateMessageInput = await request.json();
      type = body.type;
      subject = body.subject;
      messageBody = body.body;
      recipient_type = body.recipient_type;
      recipient_user_ids = body.recipient_user_ids;
      recipient_roles = body.recipient_roles;
    }

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

    // Handle PDF upload if present
    let pdfFilePath: string | null = null;
    if (pdfFile) {
      // Validate PDF file
      if (pdfFile.type !== 'application/pdf') {
        return NextResponse.json({ error: 'Only PDF files are allowed' }, { status: 400 });
      }

      if (pdfFile.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: 'PDF file size must be less than 10MB' }, { status: 400 });
      }

      // Generate safe filename
      const timestamp = Date.now();
      const sanitizedFilename = pdfFile.name
        .replace(/[^a-z0-9_.-]/gi, '_')
        .substring(0, 50);
      const fileName = `${user.id}/${timestamp}_${sanitizedFilename}`;

      // Upload to Supabase Storage
      const fileBuffer = await pdfFile.arrayBuffer();
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('toolbox-talk-pdfs')
        .upload(fileName, fileBuffer, {
          contentType: 'application/pdf',
          upsert: false
        });

      if (uploadError) {
        console.error('PDF upload error:', uploadError);
        return NextResponse.json({ error: 'Failed to upload PDF file' }, { status: 500 });
      }

      pdfFilePath = uploadData.path;
    }

    // Create message
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .insert({
        type,
        subject,
        body: messageBody,
        priority,
        sender_id: user.id,
        created_via: 'web',
        pdf_file_path: pdfFilePath
      })
      .select()
      .single();

    if (messageError || !message) {
      console.error('Error creating message:', messageError);
      
      // Clean up uploaded PDF if message creation failed
      if (pdfFilePath) {
        await supabase.storage.from('toolbox-talk-pdfs').remove([pdfFilePath]);
      }
      
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
      
      // Clean up message and PDF if recipients creation failed
      await supabase.from('messages').delete().eq('id', message.id);
      if (pdfFilePath) {
        await supabase.storage.from('toolbox-talk-pdfs').remove([pdfFilePath]);
      }
      
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

