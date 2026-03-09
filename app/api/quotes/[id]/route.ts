import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: quote, error } = await supabase
      .from('quotes')
      .select(`
        *,
        customer:customers(id, company_name, short_name, contact_name, contact_email, address_line_1, address_line_2, city, county, postcode)
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
      }
      throw error;
    }

    const { data: lineItems, error: liError } = await supabase
      .from('quote_line_items')
      .select('*')
      .eq('quote_id', id)
      .order('sort_order', { ascending: true });

    if (liError) throw liError;

    return NextResponse.json({
      quote: { ...quote, line_items: lineItems || [] },
    });
  } catch (error) {
    console.error('Error fetching quote:', error);
    return NextResponse.json({ error: 'Failed to fetch quote' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { line_items, ...quoteUpdates } = body;

    // Recalculate totals if line items provided
    if (line_items) {
      const subtotal = line_items.reduce((sum: number, item: { quantity: number; unit_rate: number }) => sum + item.quantity * item.unit_rate, 0);
      const vatRate = quoteUpdates.vat_rate ?? 20;
      const vatAmount = subtotal * (vatRate / 100);
      quoteUpdates.subtotal = Math.round(subtotal * 100) / 100;
      quoteUpdates.vat_amount = Math.round(vatAmount * 100) / 100;
      quoteUpdates.total = Math.round((subtotal + vatAmount) * 100) / 100;
    }

    // Add timestamp fields based on status transitions
    if (quoteUpdates.status === 'sent' && !quoteUpdates.sent_at) {
      quoteUpdates.sent_at = new Date().toISOString();
    }
    if (quoteUpdates.accepted === true && !quoteUpdates.accepted_at) {
      quoteUpdates.accepted_at = new Date().toISOString();
    }
    if (quoteUpdates.status === 'invoiced' && !quoteUpdates.invoiced_at) {
      quoteUpdates.invoiced_at = new Date().toISOString();
    }

    quoteUpdates.updated_by = user.id;

    const { data: quote, error } = await supabase
      .from('quotes')
      .update(quoteUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Replace line items if provided
    if (line_items) {
      await supabase.from('quote_line_items').delete().eq('quote_id', id);

      if (line_items.length > 0) {
        const rows = line_items.map((item: { description?: string; quantity: number; unit?: string; unit_rate: number; sort_order?: number }, idx: number) => ({
          quote_id: id,
          description: item.description || '',
          quantity: item.quantity,
          unit: item.unit || '',
          unit_rate: item.unit_rate,
          line_total: Math.round(item.quantity * item.unit_rate * 100) / 100,
          sort_order: item.sort_order ?? idx,
        }));

        const { error: liError } = await supabase.from('quote_line_items').insert(rows);
        if (liError) console.error('Error replacing line items:', liError);
      }
    }

    return NextResponse.json({ quote });
  } catch (error) {
    console.error('Error updating quote:', error);
    return NextResponse.json({ error: 'Failed to update quote' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { error } = await supabase.from('quotes').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting quote:', error);
    return NextResponse.json({ error: 'Failed to delete quote' }, { status: 500 });
  }
}
