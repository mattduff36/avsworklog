import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Send RAMS document via email to the logged-in user
 * POST /api/rams/[id]/email
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: documentId } = await params;
    const supabase = await createClient();

    // Get user session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if Resend is configured
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Email service not configured' },
        { status: 500 }
      );
    }

    // Fetch document
    const { data: document, error: docError } = await supabase
      .from('rams_documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    const doc = document as {
      id: string;
      title: string;
      description: string | null;
      file_name: string;
      file_path: string;
      file_type: 'pdf' | 'docx';
    };

    // Check if user has access (assigned or is manager/admin)
    const { data: assignment } = await supabase
      .from('rams_assignments')
      .select('*')
      .eq('rams_document_id', documentId)
      .eq('employee_id', session.user.id)
      .single();

    // Check if user is manager/admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();

    const isManagerOrAdmin = (profile as { role?: string } | null)?.role === 'manager' || 
                             (profile as { role?: string } | null)?.role === 'admin';

    if (!assignment && !isManagerOrAdmin) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    // Get user email
    const userEmail = session.user.email;
    if (!userEmail) {
      return NextResponse.json(
        { error: 'User email not found' },
        { status: 400 }
      );
    }

    // Get signed URL for the document
    const { data: urlData, error: urlError } = await supabase.storage
      .from('rams-documents')
      .createSignedUrl(doc.file_path, 3600); // 1 hour expiry

    if (urlError || !urlData?.signedUrl) {
      return NextResponse.json(
        { error: 'Failed to generate document URL' },
        { status: 500 }
      );
    }

    // Fetch the document file
    const fileResponse = await fetch(urlData.signedUrl);
    if (!fileResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch document' },
        { status: 500 }
      );
    }

    const fileBlob = await fileResponse.blob();
    const fileBuffer = await fileBlob.arrayBuffer();
    
    // Convert ArrayBuffer to base64
    const bytes = new Uint8Array(fileBuffer);
    const binary = bytes.reduce((acc, byte) => acc + String.fromCharCode(byte), '');
    const fileBase64 = btoa(binary);

    // Determine MIME type
    const mimeType = doc.file_type === 'pdf' 
      ? 'application/pdf' 
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    // Send email via Resend
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'AVS Worklog <onboarding@resend.dev>',
        to: [userEmail],
        subject: `RAMS Document: ${doc.title}`,
        html: `
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
                <h2 style="color: #252525; margin-top: 0;">RAMS Document</h2>
                
                <p>Hello,</p>
                
                <p>You have requested to receive the following RAMS document via email:</p>
                
                <div style="background-color: #fff; border: 2px solid #F1D64A; border-radius: 8px; padding: 20px; margin: 20px 0;">
                  <h3 style="margin: 0 0 10px 0; color: #252525;">${doc.title}</h3>
                  ${doc.description ? `<p style="margin: 0; color: #666; font-size: 14px;">${doc.description}</p>` : ''}
                </div>
                
                <p>The document is attached to this email. Please review it carefully before signing in the app.</p>
                
                <div style="background-color: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0;">
                  <p style="margin: 0; font-weight: bold; color: #1e40af;">📋 Next Steps</p>
                  <p style="margin: 5px 0 0 0; color: #1e40af;">After reviewing the document, return to SquiresApp to sign and acknowledge that you have read and understood the safety requirements.</p>
                </div>
                
                <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
                  If you have any questions about this document, please contact your manager.
                </p>
              </div>
              
              <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
                <p>© ${new Date().getFullYear()} A&V Squires Plant Co. Ltd. All rights reserved.</p>
              </div>
            </body>
          </html>
        `,
        attachments: [
          {
            filename: doc.file_name,
            content: fileBase64
          }
        ]
      })
    });

    if (!emailResponse.ok) {
      const error = await emailResponse.json();
      console.error('Resend API error:', error);
      return NextResponse.json(
        { error: `Failed to send email: ${error.message || 'Unknown error'}` },
        { status: 500 }
      );
    }

    const emailData = await emailResponse.json();
    console.log('RAMS document email sent successfully:', emailData);

    return NextResponse.json({
      success: true,
      message: 'Document sent via email successfully'
    });

  } catch (error: any) {
    console.error('Error sending RAMS document via email:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to send email' },
      { status: 500 }
    );
  }
}

