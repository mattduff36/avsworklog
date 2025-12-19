import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { validateRAMSFile, generateSafeFilename } from '@/lib/utils/file-validation';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check user role (must be manager or admin)
    const profile = await getProfileWithRole(user.id);

    if (!profile) {
      return NextResponse.json({ error: 'Failed to verify user role' }, { status: 403 });
    }

    if (!profile.role?.is_manager_admin) {
      return NextResponse.json(
        { error: 'Only admins and managers can upload RAMS documents' },
        { status: 403 }
      );
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const title = formData.get('title') as string;
    const description = formData.get('description') as string | null;

    // Validate required fields
    if (!file || !title) {
      return NextResponse.json(
        { error: 'Missing required fields: file and title' },
        { status: 400 }
      );
    }

    // Validate file
    const validation = validateRAMSFile(file);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Generate safe filename
    const safeFilename = generateSafeFilename(file.name, user.id);
    const filePath = `${user.id}/${safeFilename}`;

    // Upload file to Supabase Storage
    const fileBuffer = await file.arrayBuffer();
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('rams-documents')
      .upload(filePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json(
        { error: `Failed to upload file: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // Create database record
    const { data: document, error: dbError } = await supabase
      .from('rams_documents')
      .insert({
        title,
        description: description || null,
        file_name: file.name,
        file_path: uploadData.path,
        file_size: file.size,
        file_type: validation.fileType!,
        uploaded_by: user.id,
      })
      .select()
      .single();

    if (dbError) {
      // If database insert fails, try to clean up the uploaded file
      await supabase.storage.from('rams-documents').remove([uploadData.path]);
      
      console.error('Database error:', dbError);
      return NextResponse.json(
        { error: `Failed to create document record: ${dbError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        document,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Unexpected error in upload:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/rams/upload',
      additionalData: {
        endpoint: '/api/rams/upload',
      },
    });
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

