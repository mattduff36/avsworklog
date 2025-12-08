import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { sendErrorReportEmail } from '@/lib/utils/email';

/**
 * POST /api/errors/report
 * Report an error from a user - creates a notification for admin
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

    // Get admin user ID - find a user who can receive error reports
    // Priority: 1) super_admin, 2) admin role, 3) any manager/admin role
    let adminUserId: string | null = null;

    // Strategy 1: Find super admin user first (highest priority)
    const { data: superAdmin } = await supabase
      .from('profiles')
      .select('id')
      .eq('super_admin', true)
      .limit(1)
      .maybeSingle();

    if (superAdmin?.id) {
      adminUserId = superAdmin.id;
    } else {
      // Strategy 2: Get all profiles with their roles and find admin/manager
      // Since Supabase query builder has limitations with complex joins,
      // we fetch profiles with roles and filter in JavaScript
      const { data: profilesWithRoles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, role_id, roles(name, is_manager_admin)')
        .not('role_id', 'is', null)
        .limit(100);

      if (!profilesError && profilesWithRoles && profilesWithRoles.length > 0) {
        // Find admin user: prioritize admin role name, then is_manager_admin
        const adminProfile = profilesWithRoles.find((p: any) => {
          if (!p.roles) return false;
          const role = Array.isArray(p.roles) ? p.roles[0] : p.roles;
          return role && (role.name === 'admin' || role.is_manager_admin === true);
        });

        if (adminProfile?.id) {
          adminUserId = adminProfile.id;
        }
      }
    }
    
    if (!adminUserId) {
      console.warn('No admin user found in system, will use email fallback');
      // Don't return error here - we'll try email fallback instead
    }

    // Try to create in-app notification first (only if admin user found)
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
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

