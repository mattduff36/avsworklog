import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/messages/clear-all
 * Clear all notifications from user's inbox
 * Sets cleared_from_inbox_at timestamp for all user's message_recipients
 * Does not delete the actual data (for admin/audit purposes)
 */
export async function POST() {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Update all user's message recipients to mark as cleared
    const { error: updateError } = await supabase
      .from('message_recipients')
      .update({
        cleared_from_inbox_at: new Date().toISOString()
      })
      .eq('user_id', user.id)
      .is('cleared_from_inbox_at', null); // Only clear ones that haven't been cleared already

    if (updateError) {
      console.error('Error clearing notifications:', updateError);
      return NextResponse.json({ 
        error: 'Failed to clear notifications' 
      }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true,
      message: 'All notifications cleared'
    });

  } catch (error) {
    console.error('Error in POST /api/messages/clear-all:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

