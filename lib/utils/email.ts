/**
 * Email sending utilities using Resend
 * Documentation: https://resend.com/docs/send-with-nextjs
 */

interface SendPasswordEmailParams {
  to: string;
  userName: string;
  temporaryPassword: string;
  isReset?: boolean;
}

/**
 * Send temporary password email to user
 * @param params Email parameters
 * @returns Promise with success status
 */
export async function sendPasswordEmail(params: SendPasswordEmailParams): Promise<{
  success: boolean;
  error?: string;
}> {
  const { to, userName, temporaryPassword, isReset = false } = params;
  
  try {
    // Check if Resend API key is configured
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error('RESEND_API_KEY not configured');
      return {
        success: false,
        error: 'Email service not configured'
      };
    }
    
    const subject = isReset 
      ? 'Your Password Has Been Reset - SquiresApp'
      : 'Welcome to SquiresApp - Your Login Details';
    
    const htmlContent = isReset ? `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #F1D64A; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; color: #252525;">SquiresApp</h1>
          </div>
          
          <div style="background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <h2 style="color: #252525; margin-top: 0;">Password Reset</h2>
            
            <p>Hello ${userName},</p>
            
            <p>Your password has been reset by an administrator. You can now log in using the temporary password below:</p>
            
            <div style="background-color: #fff; border: 2px solid #F1D64A; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #666;">Temporary Password</p>
              <p style="margin: 0; font-size: 24px; font-weight: bold; color: #252525; letter-spacing: 1px;">${temporaryPassword}</p>
            </div>
            
            <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; font-weight: bold; color: #92400e;">⚠️ Important</p>
              <p style="margin: 5px 0 0 0; color: #92400e;">You will be required to change this password when you first log in.</p>
            </div>
            
            <p><strong>Next Steps:</strong></p>
            <ol style="color: #4b5563;">
              <li>Go to SquiresApp.com or open the app</li>
              <li>Enter your email address and the temporary password above</li>
              <li>Create a new password when prompted</li>
            </ol>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              If you did not request this password reset, please contact your administrator immediately.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
            <p>© ${new Date().getFullYear()} A&V Squires Plant Co. Ltd. All rights reserved.</p>
          </div>
        </body>
      </html>
    ` : `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #F1D64A; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; color: #252525;">Welcome to SquiresApp</h1>
          </div>
          
          <div style="background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <h2 style="color: #252525; margin-top: 0;">Your Account Has Been Created</h2>
            
            <p>Hello ${userName},</p>
            
            <p>Welcome to SquiresApp! Your account has been created and you can now log in using the credentials below:</p>
            
            <div style="background-color: #fff; border: 2px solid #F1D64A; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #666;">Email Address</p>
              <p style="margin: 0 0 20px 0; font-size: 16px; color: #252525;">${to}</p>
              
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #666;">Temporary Password</p>
              <p style="margin: 0; font-size: 24px; font-weight: bold; color: #252525; letter-spacing: 1px;">${temporaryPassword}</p>
            </div>
            
            <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; font-weight: bold; color: #92400e;">⚠️ Important</p>
              <p style="margin: 5px 0 0 0; color: #92400e;">You will be required to change this password when you first log in.</p>
            </div>
            
            <p><strong>Getting Started:</strong></p>
            <ol style="color: #4b5563;">
              <li>Go to SquiresApp.com or open the app</li>
              <li>Enter your email address and the temporary password above</li>
              <li>Create a new password when prompted</li>
            </ol>
            
            <p style="background-color: #dbeafe; border-radius: 8px; padding: 15px; margin: 20px 0;">
              <strong style="color: #1e40af;">💡 Tip:</strong><br>
              <span style="color: #1e3a8a;">Choose a password that's secure but easy for you to remember. We recommend using a combination of words and numbers.</span>
            </p>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              If you have any questions, please contact your administrator.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
            <p>© ${new Date().getFullYear()} A&V Squires Plant Co. Ltd. All rights reserved.</p>
          </div>
        </body>
      </html>
    `;
    
    // Send email using Resend API
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'AVS Worklog <onboarding@resend.dev>',
        to: [to],
        subject,
        html: htmlContent
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.error('Resend API error:', error);
      return {
        success: false,
        error: `Failed to send email: ${error.message || 'Unknown error'}`
      };
    }
    
    const data = await response.json();
    console.log('Email sent successfully:', data);
    
    return {
      success: true
    };
    
  } catch (error: any) {
    console.error('Error sending password email:', error);
    return {
      success: false,
      error: error.message || 'Failed to send email'
    };
  }
}

/**
 * Test email configuration
 * Useful for verifying Resend setup
 */
export async function testEmailConfiguration(): Promise<{
  configured: boolean;
  message: string;
}> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  
  if (!apiKey) {
    return {
      configured: false,
      message: 'RESEND_API_KEY environment variable is not set'
    };
  }
  
  if (!fromEmail) {
    return {
      configured: true,
      message: 'Resend configured (using default from address)'
    };
  }
  
  return {
    configured: true,
    message: `Resend configured with from address: ${fromEmail}`
  };
}

interface ProfileUpdateChanges {
  email?: { old: string; new: string };
  full_name?: { old: string; new: string };
  phone_number?: { old: string; new: string };
  role?: { old: string; new: string };
  employee_id?: { old: string; new: string };
}

interface SendProfileUpdateEmailParams {
  to: string;
  userName: string;
  changes: ProfileUpdateChanges;
}

/**
 * Send profile update notification email to user
 * @param params Email parameters
 * @returns Promise with success status
 */
export async function sendProfileUpdateEmail(params: SendProfileUpdateEmailParams): Promise<{
  success: boolean;
  error?: string;
}> {
  const { to, userName, changes } = params;
  
  try {
    // Check if Resend API key is configured
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error('RESEND_API_KEY not configured');
      return {
        success: false,
        error: 'Email service not configured'
      };
    }
    
    // Build changes list HTML
    const changesHtml = Object.entries(changes)
      .map(([field, change]) => {
        const fieldName = field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        return `
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #374151;">${fieldName}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">${change.old || '-'}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #059669; font-weight: 500;">${change.new || '-'}</td>
          </tr>
        `;
      })
      .join('');
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #F1D64A; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; color: #252525;">SquiresApp</h1>
          </div>
          
          <div style="background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <h2 style="color: #252525; margin-top: 0;">Your Profile Has Been Updated</h2>
            
            <p>Hello ${userName},</p>
            
            <p>An administrator has updated your profile information. Here are the changes:</p>
            
            <div style="background-color: #fff; border: 1px solid #e5e7eb; border-radius: 8px; margin: 20px 0; overflow: hidden;">
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="background-color: #f3f4f6;">
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Field</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Previous Value</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">New Value</th>
                  </tr>
                </thead>
                <tbody>
                  ${changesHtml}
                </tbody>
              </table>
            </div>
            
            ${changes.email ? `
              <div style="background-color: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; font-weight: bold; color: #1e40af;">📧 Email Address Changed</p>
                <p style="margin: 5px 0 0 0; color: #1e40af;">Your email address has been updated. Please use <strong>${changes.email.new}</strong> to log in from now on.</p>
              </div>
            ` : ''}
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              If you did not expect these changes or have any questions, please contact your administrator.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
            <p>© ${new Date().getFullYear()} A&V Squires Plant Co. Ltd. All rights reserved.</p>
          </div>
        </body>
      </html>
    `;
    
    // Send email using Resend API
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'AVS Worklog <onboarding@resend.dev>',
        to: [to],
        subject: 'Your SquiresApp Profile Has Been Updated',
        html: htmlContent
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.error('Resend API error:', error);
      return {
        success: false,
        error: `Failed to send email: ${error.message || 'Unknown error'}`
      };
    }
    
    const data = await response.json();
    console.log('Profile update email sent successfully:', data);
    
    return {
      success: true
    };
    
  } catch (error: any) {
    console.error('Error sending profile update email:', error);
    return {
      success: false,
      error: error.message || 'Failed to send email'
    };
  }
}

