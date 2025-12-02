import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/errors/report
 * Report an error from a user - creates a notification for admin
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

    // Get admin user ID - find a user with admin role
    const { data: adminByRole, error: adminError } = await supabase
      .from('profiles')
      .select(`
        id,
        roles!inner (
          name
        )
      `)
      .eq('roles.name', 'admin')
      .limit(1)
      .single();

    if (adminError || !adminByRole) {
      console.error('Admin profile not found:', adminError?.message);
      // Last resort fallback - hardcoded admin ID (Matt Duffill)
      // This should be replaced with env variable in production
      console.log('Using fallback admin lookup...');
    }

    const adminUserId = adminByRole?.id;
    
    if (!adminUserId) {
      console.error('No admin user found in system');
      return NextResponse.json({ error: 'Admin not found' }, { status: 500 });
    }

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

    return NextResponse.json({ 
      success: true,
      message: 'Error reported successfully'
    });

  } catch (error) {
    console.error('Error in POST /api/errors/report:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

