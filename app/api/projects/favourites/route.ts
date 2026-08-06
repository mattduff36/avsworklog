import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

async function requireRamsAccess() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, user: null, error: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
  }

  const profile = await getProfileWithRole(user.id);
  if (!profile) {
    return { supabase, user: null, error: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  }

  const canAccessRams = await canEffectiveRoleAccessModule('rams');
  if (!canAccessRams) {
    return { supabase, user: null, error: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  }

  return { supabase, user, error: null as null };
}

export async function GET() {
  const { supabase, user, error } = await requireRamsAccess();
  if (error || !user) return error!;

  const { data: favourites, error: fetchError } = await supabase
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

  if (fetchError) {
    console.error('Error fetching favourites:', fetchError);
    return NextResponse.json({ success: false, error: fetchError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, favourites });
}

export async function POST(request: NextRequest) {
  const { supabase, user, error } = await requireRamsAccess();
  if (error || !user) return error!;

  const body = await request.json();
  const { document_id } = body;

  if (!document_id) {
    return NextResponse.json({ success: false, error: 'document_id is required' }, { status: 400 });
  }

  const { data: favourite, error: insertError } = await supabase
    .from('project_favourites')
    .insert({ document_id, user_id: user.id })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ success: false, error: 'Already in favourites' }, { status: 409 });
    }
    console.error('Error adding favourite:', insertError);
    return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, favourite }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { supabase, user, error } = await requireRamsAccess();
  if (error || !user) return error!;

  const { searchParams } = new URL(request.url);
  const documentId = searchParams.get('document_id');

  if (!documentId) {
    return NextResponse.json({ success: false, error: 'document_id is required' }, { status: 400 });
  }

  const { error: deleteError } = await supabase
    .from('project_favourites')
    .delete()
    .eq('document_id', documentId)
    .eq('user_id', user.id);

  if (deleteError) {
    console.error('Error removing favourite:', deleteError);
    return NextResponse.json({ success: false, error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
