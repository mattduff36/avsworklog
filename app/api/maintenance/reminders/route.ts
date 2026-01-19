import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/utils/logger';
import { sendMaintenanceReminderEmail } from '@/lib/utils/email';
import { logServerError } from '@/lib/utils/server-error-logger';

// Helper to create service role client for bypassing RLS
function getSupabaseServiceRole() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

interface SendReminderRequest {
  vehicleId: string;
  categoryName: string; // e.g., "Tax Due Date", "MOT Due Date"
  dueInfo: string; // e.g., "Overdue by 5 days" or "Due in 3 days"
  subjectOverride?: string;
  bodyOverride?: string;
}

interface SendReminderResponse {
  success: boolean;
  message?: {
    id: string;
    recipients_count: number;
  };
  emails?: {
    sent: number;
    failed: number;
  };
  error?: string;
}

/**
 * POST /api/maintenance/reminders
 * Send a maintenance reminder to configured recipients for a category
 */
export async function POST(request: NextRequest): Promise<NextResponse<SendReminderResponse>> {
  try {
    const supabase = await createClient();
    const supabaseServiceRole = getSupabaseServiceRole();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Get sender profile
    const { data: senderProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, role_id, role:roles(name, is_manager_admin)')
      .eq('id', user.id)
      .single();

    if (profileError || !senderProfile) {
      return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 403 });
    }

    // Check if user is manager/admin
    const roleData = senderProfile.role as { name: string; is_manager_admin: boolean } | null;
    if (!roleData?.is_manager_admin && roleData?.name !== 'admin' && roleData?.name !== 'manager') {
      return NextResponse.json({ 
        success: false, 
        error: 'Forbidden: Manager/Admin access required' 
      }, { status: 403 });
    }

    // Parse request body
    const body: SendReminderRequest = await request.json();
    const { vehicleId, categoryName, dueInfo, subjectOverride, bodyOverride } = body;

    // Validate required fields
    if (!vehicleId || !categoryName || !dueInfo) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing required fields: vehicleId, categoryName, dueInfo' 
      }, { status: 400 });
    }

    // Get vehicle info
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id, reg_number, nickname')
      .eq('id', vehicleId)
      .single();

    if (vehicleError || !vehicle) {
      return NextResponse.json({ success: false, error: 'Vehicle not found' }, { status: 404 });
    }

    // Get category with its settings
    const { data: category, error: categoryError } = await supabase
      .from('maintenance_categories')
      .select('id, name, reminder_in_app_enabled, reminder_email_enabled')
      .ilike('name', categoryName)
      .single();

    if (categoryError || !category) {
      return NextResponse.json({ 
        success: false, 
        error: `Category "${categoryName}" not found` 
      }, { status: 404 });
    }

    // Check if any reminders are enabled
    if (!category.reminder_in_app_enabled && !category.reminder_email_enabled) {
      return NextResponse.json({ 
        success: false, 
        error: 'Reminders are not enabled for this category. Enable them in Settings.' 
      }, { status: 400 });
    }

    // Get recipients for this category
    const { data: recipientLinks, error: recipientLinksError } = await supabase
      .from('maintenance_category_recipients')
      .select('user_id')
      .eq('category_id', category.id);

    if (recipientLinksError) {
      logger.error('Failed to fetch category recipients', recipientLinksError);
      throw recipientLinksError;
    }

    const recipientUserIds = recipientLinks?.map(r => r.user_id) || [];

    // If no recipients configured, send to all managers/admins
    if (recipientUserIds.length === 0) {
      const { data: managers, error: managersError } = await supabase
        .from('profiles')
        .select('id')
        .eq('roles.is_manager_admin', true);
      
      // Fallback: get profiles where role is admin or manager
      const { data: adminProfiles } = await supabaseServiceRole
        .from('profiles')
        .select('id, role:roles!inner(name, is_manager_admin)')
        .or('role.name.eq.admin,role.name.eq.manager,role.is_manager_admin.eq.true');

      if (adminProfiles && adminProfiles.length > 0) {
        recipientUserIds.push(...adminProfiles.map((p: any) => p.id));
      }
    }

    // Remove duplicates
    const uniqueRecipientIds = [...new Set(recipientUserIds)];

    if (uniqueRecipientIds.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'No recipients configured and no managers found' 
      }, { status: 400 });
    }

    // Prepare message content
    const vehicleDisplay = vehicle.nickname 
      ? `${vehicle.reg_number} (${vehicle.nickname})`
      : vehicle.reg_number;
    
    const subject = subjectOverride || `${category.name}: ${vehicleDisplay} - ${dueInfo}`;
    const messageBody = bodyOverride || 
      `Vehicle ${vehicleDisplay} requires attention.\n\n` +
      `Category: ${category.name}\n` +
      `Status: ${dueInfo}\n\n` +
      `Please review and take appropriate action.`;

    let messageId: string | null = null;
    let recipientsCreated = 0;
    let emailsSent = 0;
    let emailsFailed = 0;

    // Create in-app message if enabled
    if (category.reminder_in_app_enabled) {
      // Create message
      const { data: message, error: messageError } = await supabaseServiceRole
        .from('messages')
        .insert({
          type: 'REMINDER',
          subject,
          body: messageBody,
          priority: 'LOW',
          sender_id: user.id,
          created_via: 'maintenance_reminder',
        })
        .select()
        .single();

      if (messageError || !message) {
        logger.error('Failed to create reminder message', messageError);
        throw messageError || new Error('Failed to create message');
      }

      messageId = message.id;

      // Create message recipients
      const recipientRecords = uniqueRecipientIds.map(userId => ({
        message_id: message.id,
        user_id: userId,
        status: 'PENDING' as const,
      }));

      const { error: recipientsError, data: recipients } = await supabaseServiceRole
        .from('message_recipients')
        .insert(recipientRecords)
        .select();

      if (recipientsError) {
        logger.error('Failed to create message recipients', recipientsError);
        // Clean up the message
        await supabaseServiceRole.from('messages').delete().eq('id', message.id);
        throw recipientsError;
      }

      recipientsCreated = recipients?.length || 0;
      logger.info(`Created maintenance reminder message ${message.id} with ${recipientsCreated} recipients`);
    }

    // Send emails if enabled
    if (category.reminder_email_enabled) {
      // Fetch recipient email addresses using admin client
      const recipientEmails: string[] = [];

      for (const userId of uniqueRecipientIds) {
        const { data: authUser } = await supabaseServiceRole.auth.admin.getUserById(userId);
        if (authUser?.user?.email) {
          recipientEmails.push(authUser.user.email);
        }
      }

      if (recipientEmails.length > 0) {
        const emailResult = await sendMaintenanceReminderEmail({
          to: recipientEmails,
          senderName: senderProfile.full_name || 'SquiresApp',
          subject,
          vehicleReg: vehicle.reg_number,
          categoryName: category.name,
          dueInfo,
        });

        emailsSent = emailResult.sent || 0;
        emailsFailed = emailResult.failed || 0;

        logger.info(`Sent ${emailsSent} maintenance reminder emails, ${emailsFailed} failed`);
      }
    }

    return NextResponse.json({
      success: true,
      message: messageId ? {
        id: messageId,
        recipients_count: recipientsCreated,
      } : undefined,
      emails: category.reminder_email_enabled ? {
        sent: emailsSent,
        failed: emailsFailed,
      } : undefined,
    });

  } catch (error) {
    console.error('Error in POST /api/maintenance/reminders:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/maintenance/reminders',
      additionalData: {
        endpoint: '/api/maintenance/reminders',
      },
    });

    return NextResponse.json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
