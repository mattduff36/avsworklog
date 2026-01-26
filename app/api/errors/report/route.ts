import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { sendErrorReportEmailToAdmins } from '@/lib/utils/email';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { CreateErrorReportResponse } from '@/types/error-reports';

/**
 * POST /api/errors/report
 * Report an error from a user - persists to database and notifies all admins
 * 
 * Flow:
 * 1. Persists error report to error_reports table
 * 2. Finds all admin users (roles.name = 'admin' OR roles.is_super_admin = true)
 * 3. Creates in-app notification for all admins
 * 4. Sends email notification to all admin email addresses
 * 
 * Accepts both:
 * - Legacy format: { error_message, error_code, page_url, user_agent, additional_context }
 * - New format: { title, description, error_code, page_url, user_agent, additional_context }
 */
export async function POST(request: NextRequest) {
  try {
    // First verify the user is authenticated using their session
    const authClient = await createServerClient();
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service role client for database operations to bypass RLS
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    const body = await request.json();
    
    // Support both legacy and new formats
    const title = body.title || body.error_message;
    const description = body.description || body.error_message;
    const { error_code, page_url, user_agent, additional_context } = body;

    if (!title || !description) {
      return NextResponse.json({ error: 'Missing title or description' }, { status: 400 });
    }

    // 1. Persist error report to database
    const { data: errorReport, error: reportError } = await supabase
      .from('error_reports')
      .insert({
        created_by: user.id,
        title: title.substring(0, 500), // Limit title length
        description,
        error_code,
        page_url,
        user_agent,
        additional_context,
        status: 'new'
      })
      .select()
      .single();

    if (reportError || !errorReport) {
      console.error('Error creating error report:', reportError);
      return NextResponse.json({ 
        error: 'Failed to save error report' 
      }, { status: 500 });
    }

    console.log(`Error report created: ${errorReport.id}`);

    // 2. Find all admin users
    // NOTE: PostgREST's `.or(...)` does not support dotted paths like `role.name` reliably.
    // We query role IDs first, then fetch profiles by role_id.
    const { data: adminRoles, error: adminRolesError } = await supabase
      .from('roles')
      .select('id')
      .or('name.eq.admin,is_super_admin.is.true,is_manager_admin.is.true');

    if (adminRolesError) {
      console.error('Error finding admin roles:', adminRolesError);
      return NextResponse.json({ 
        success: false,
        error: 'Failed to find admin users',
        details: adminRolesError.message
      }, { status: 500 });
    }

    const adminRoleIds = (adminRoles ?? []).map(r => r.id);
    if (adminRoleIds.length === 0) {
      console.warn('No admin users found! This should not happen.');
      return NextResponse.json({ 
        success: false,
        error: 'No admin users found to notify',
      }, { status: 500 });
    }

    const { data: adminProfiles, error: adminProfilesError } = await supabase
      .from('profiles')
      .select('id, full_name, role_id')
      .in('role_id', adminRoleIds);

    if (adminProfilesError) {
      console.error('Error finding admin profiles:', adminProfilesError);
      return NextResponse.json({ 
        success: false,
        error: 'Failed to find admin users',
        details: adminProfilesError.message
      }, { status: 500 });
    }

    if (!adminProfiles || adminProfiles.length === 0) {
      console.warn('No admin profiles found! This should not happen.');
      return NextResponse.json({ 
        success: false,
        error: 'No admin users found to notify',
      }, { status: 500 });
    }

    const adminUserIds = adminProfiles.map(p => p.id);
    console.log(`Found ${adminUserIds.length} admin users for notification:`, adminUserIds);

    // 2.5. Fetch admin notification preferences
    const { data: allPrefs } = await supabase
      .from('admin_error_notification_prefs')
      .select('*')
      .in('user_id', adminUserIds);
    
    // Build preference maps (default to true if no preference record exists)
    const inAppPrefs = new Map<string, boolean>();
    const emailPrefs = new Map<string, boolean>();
    
    adminUserIds.forEach(id => {
      const pref = allPrefs?.find(p => p.user_id === id);
      inAppPrefs.set(id, pref?.notify_in_app ?? true);
      emailPrefs.set(id, pref?.notify_email ?? true);
    });
    
    // Filter admins who want in-app notifications
    const inAppAdminIds = adminUserIds.filter(id => inAppPrefs.get(id) === true);
    console.log(`${inAppAdminIds.length} admins opted in for in-app notifications`);
    
    // Filter admins who want email notifications
    const emailAdminIds = adminUserIds.filter(id => emailPrefs.get(id) === true);
    console.log(`${emailAdminIds.length} admins opted in for email notifications`);

    // 3. Create in-app notifications for opted-in admins
    let notificationSuccess = false;
    let notificationMessageId: string | null = null;

    if (inAppAdminIds.length > 0) {
      try {
        // Create message
        const { data: message, error: messageError } = await supabase
          .from('messages')
          .insert({
            type: 'NOTIFICATION',
            priority: 'HIGH',
            subject: `🐛 Error Report: ${title.substring(0, 50)}${title.length > 50 ? '...' : ''}`,
            body: `**User:** ${profile?.full_name || 'Unknown'} (${user.email})

**Title:** ${title}

**Description:** ${description}

${error_code ? `**Error Code:** ${error_code}\n` : ''}
**Page:** ${page_url || 'Unknown'}

**User Agent:** ${user_agent || 'Unknown'}

${additional_context ? `**Additional Context:**\n${JSON.stringify(additional_context, null, 2)}` : ''}

---
*View and manage this error report in the Errors Management section.*`,
            sender_id: user.id,
          })
          .select()
          .single();

        if (messageError) {
          console.error('Error creating message:', messageError);
          throw messageError;
        }

        notificationMessageId = message.id;

        // Create recipient entries for opted-in admins only
        const recipientRecords = inAppAdminIds.map(adminId => ({
          message_id: message.id,
          user_id: adminId,
          status: 'PENDING' as const
        }));

        const { error: recipientsError } = await supabase
          .from('message_recipients')
          .insert(recipientRecords);

        if (recipientsError) {
          console.error('Error creating recipients:', recipientsError);
          throw recipientsError;
        }

        // Update error report with notification message ID
        await supabase
          .from('error_reports')
          .update({ notification_message_id: message.id })
          .eq('id', errorReport.id);

        notificationSuccess = true;
        console.log(`In-app notifications created for ${inAppAdminIds.length} admins`);
      } catch (notificationError) {
        console.error('Failed to create in-app notifications:', notificationError);
      }
    }

    // 4. Send email notifications to opted-in admins
    let emailSuccess = false;
    let emailSent = 0;
    let emailFailed = 0;

    if (emailAdminIds.length > 0) {
      try {
        // Fetch email addresses for opted-in admins only
        const adminEmails: string[] = [];
        for (const adminId of emailAdminIds) {
          const { data: authUser } = await supabase.auth.admin.getUserById(adminId);
          if (authUser?.user?.email) {
            adminEmails.push(authUser.user.email);
          }
        }

        if (adminEmails.length > 0) {
          const emailResult = await sendErrorReportEmailToAdmins({
            to: adminEmails,
            reportId: errorReport.id,
            title,
            description,
            errorCode: error_code,
            userName: profile?.full_name || 'Unknown',
            userEmail: user.email || 'Unknown',
            pageUrl: page_url,
            userAgent: user_agent,
            additionalContext: additional_context
          });

          emailSuccess = emailResult.success;
          emailSent = emailResult.sent || 0;
          emailFailed = emailResult.failed || 0;

          console.log(`Emails sent: ${emailSent}, failed: ${emailFailed}`);
        } else {
          console.warn('No admin email addresses found');
        }
      } catch (emailError) {
        console.error('Failed to send email notifications:', emailError);
      }
    }

    const response: CreateErrorReportResponse = {
      success: true,
      report_id: errorReport.id,
      notification_sent: notificationSuccess,
      email_sent: emailSuccess
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in POST /api/errors/report:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/errors/report',
      additionalData: {
        endpoint: '/api/errors/report',
      },
    });
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

