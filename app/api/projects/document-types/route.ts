import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { data: types, error } = await supabase
    .from('project_document_types')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('Error fetching document types:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, types });
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
  const { name, description, required_signature } = body;

  if (!name?.trim()) {
    return NextResponse.json({ success: false, error: 'Name is required' }, { status: 400 });
  }

  const { data: maxSort } = await supabase
    .from('project_document_types')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .single();

  const nextSort = (maxSort?.sort_order ?? -1) + 1;

  const { data: newType, error } = await supabase
    .from('project_document_types')
    .insert({
      name: name.trim(),
      description: description?.trim() || null,
      required_signature: required_signature ?? true,
      sort_order: nextSort,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ success: false, error: 'A document type with this name already exists' }, { status: 409 });
    }
    console.error('Error creating document type:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, type: newType }, { status: 201 });
}

export async function PUT(request: NextRequest) {
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
  const { id, name, description, required_signature, is_active } = body;

  if (!id) {
    return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name.trim();
  if (description !== undefined) updateData.description = description?.trim() || null;
  if (required_signature !== undefined) updateData.required_signature = required_signature;
  if (is_active !== undefined) updateData.is_active = is_active;

  const { data: updated, error } = await supabase
    .from('project_document_types')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ success: false, error: 'A document type with this name already exists' }, { status: 409 });
    }
    console.error('Error updating document type:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, type: updated });
}

export async function DELETE(request: NextRequest) {
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

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
  }

  // Check if any documents are using this type
  const { count } = await supabase
    .from('rams_documents')
    .select('*', { count: 'exact', head: true })
    .eq('document_type_id', id);

  if (count && count > 0) {
    return NextResponse.json(
      { success: false, error: `Cannot delete: ${count} document(s) are using this type. Deactivate it instead.` },
      { status: 409 }
    );
  }

  const { error } = await supabase
    .from('project_document_types')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting document type:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
