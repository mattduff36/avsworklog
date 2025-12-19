import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { sendErrorReportEmail } from '@/lib/utils/email';
import { logServerError } from '@/lib/utils/server-error-logger';

/**
 * POST /api/errors/report
 * Report an error from a user - creates a notification for admin@mpdee.co.uk ONLY
 * 
 * SECURITY: Error reports are ONLY sent to admin@mpdee.co.uk. No other user
 * will ever receive error report notifications.
 * 
 * Flow:
 * 1. Finds admin@mpdee.co.uk user account by email
 * 2. If found: Creates in-app notification for that account only
 * 3. If not found or notification fails: Sends email to admin@mpdee.co.uk
 * 
 * NOTE: This endpoint uses the service role key to bypass RLS policies
 * since error reporting is an administrative function that all authenticated
 * users should be able to use, regardless of their role.
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
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    const body = await request.json();
    const { error_message, error_code, page_url, user_agent, additional_context } = body;

    if (!error_message) {
      return NextResponse.json({ error: 'Missing error_message' }, { status: 400 });
    }

    // Find admin user ID - ONLY admin@mpdee.co.uk should receive error reports
    // We find the user by email to ensure it's specifically your account
    let adminUserId: string | null = null;
    const adminEmail = 'admin@mpdee.co.uk';

    try {
      // Use admin API to find user by email (requires service role)
      const { data: authUsers, error: listError } = await supabase.auth.admin.listUsers();
      
      if (!listError && authUsers?.users) {
        const adminUser = authUsers.users.find(u => u.email === adminEmail);
        if (adminUser?.id) {
          adminUserId = adminUser.id;
          console.log(`Found admin user: ${adminEmail} (ID: ${adminUserId})`);
        } else {
          console.warn(`Admin user not found: ${adminEmail}`);
        }
      } else {
        console.error('Error listing users:', listError);
      }
    } catch (error) {
      console.error('Error finding admin user:', error);

    
    // Log error to database
    await logServerError({
      error: error as Error,
      request,
      componentName: '/errors/report',
      additionalData: {
        endpoint: '/errors/report',
      },
    );
    }
    
    if (!adminUserId) {
      console.warn(`Admin user ${adminEmail} not found, will use email fallback only`);
    }

    // Try to create in-app notification first (ONLY for admin@mpdee.co.uk)
    // If admin@mpdee.co.uk account is found, create notification
    // Otherwise, skip notification and go straight to email
    let notificationSuccess = false;
    if (adminUserId) {
      try {
        // Create message
        const { data: message, error: messageError } = await supabase
          .from('messages')
          .insert({
            type: 'REMINDER',
            priority: 'HIGH',
            subject: `🐛 Error Report: ${error_message.substring(0, 50)}${error_message.length > 50 ? '...' : ''}`,
            body: `**User:** ${profile?.full_name || 'Unknown'} (${user.email})

**Error:** ${error_message}

${error_code ? `**Error Code:** ${error_code}\n` : ''}
**Page:** ${page_url || 'Unknown'}

**User Agent:** ${user_agent || 'Unknown'}

${additional_context ? `**Additional Context:**\n${JSON.stringify(additional_context, null, 2)}` : ''}

---
*This error was reported by the user from the application.*`,
            sender_id: user.id,
          })
          .select()
          .single();

        if (messageError) {
          console.error('Error creating message:', messageError);
          throw messageError;
        }

        // Create recipient entry for admin
        const { error: recipientError } = await supabase
          .from('message_recipients')
          .insert({
            message_id: message.id,
            user_id: adminUserId,
            status: 'PENDING',
          });

        if (recipientError) {
          console.error('Error creating recipient:', recipientError);
          throw recipientError;
        }

        notificationSuccess = true;
        console.log('Error report notification created successfully');
      } catch (notificationError) {
        console.error('Failed to create in-app notification, falling back to email:', notificationError);

    
    // Log error to database
    await logServerError({
      error: notificationError as Error,
      request,
      componentName: '/errors/report',
      additionalData: {
        endpoint: '/errors/report',
      },
    );
        // Fall through to email fallback
      }
    } else {
      console.log('No admin user found, skipping notification and using email fallback');
    }

    // If notification failed, send email as fallback
    if (!notificationSuccess) {
      console.log('Sending error report via email fallback to admin@mpdee.co.uk');
      const emailResult = await sendErrorReportEmail({
        errorMessage: error_message,
        errorCode: error_code,
        userName: profile?.full_name || 'Unknown',
        userEmail: user.email || 'Unknown',
        pageUrl: page_url,
        userAgent: user_agent,
        additionalContext: additional_context,
      });

      if (!emailResult.success) {
        console.error('Email fallback also failed:', emailResult.error);
        return NextResponse.json({ 
          error: 'Failed to deliver error report via notification or email',
          details: emailResult.error
        }, { status: 500 });
      }

      console.log('Error report sent via email fallback successfully');
      return NextResponse.json({ 
        success: true,
        message: 'Error reported successfully (sent via email)',
        method: 'email'
      });
    }

    return NextResponse.json({ 
      success: true,
      message: 'Error reported successfully',
      method: 'notification'
    });

  } catch (error) {
    console.error('Error in POST /api/errors/report:', error);

    
    // Log error to database
    await logServerError({
      error: error as Error,
      request,
      componentName: '/errors/report',
      additionalData: {
        endpoint: '/errors/report',
      },
    );
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

