import { NextResponse } from 'next/server';
import { sendTestTimesheetEmails } from '@/lib/utils/email';

export async function POST() {
  try {
    const adminEmail = 'admin@mpdee.co.uk';
    
    console.log(`Sending test timesheet emails to ${adminEmail}...`);
    
    const result = await sendTestTimesheetEmails(adminEmail);
    
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to send test emails' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: `Test emails sent successfully to ${adminEmail}`
    });
    
  } catch (error) {
    console.error('Error in test email endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

