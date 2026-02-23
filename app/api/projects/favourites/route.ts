import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { data: favourites, error } = await supabase
    .from('project_favourites')
    .select(`
      *,
      document:rams_documents(
        id, title, description, file_name, file_path, file_size, file_type,
        created_at, document_type_id,
        document_type:project_document_types(id, name, required_signature)
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching favourites:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, favourites });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { document_id } = body;

  if (!document_id) {
    return NextResponse.json({ success: false, error: 'document_id is required' }, { status: 400 });
  }

  const { data: favourite, error } = await supabase
    .from('project_favourites')
    .insert({ document_id, user_id: user.id })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ success: false, error: 'Already in favourites' }, { status: 409 });
    }
    console.error('Error adding favourite:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, favourite }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const documentId = searchParams.get('document_id');

  if (!documentId) {
    return NextResponse.json({ success: false, error: 'document_id is required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('project_favourites')
    .delete()
    .eq('document_id', documentId)
    .eq('user_id', user.id);

  if (error) {
    console.error('Error removing favourite:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
