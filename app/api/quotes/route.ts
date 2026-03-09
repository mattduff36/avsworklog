import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customer_id');

    let query = supabase
      .from('quotes')
      .select(`
        *,
        customer:customers(id, company_name, short_name)
      `)
      .order('created_at', { ascending: false });

    if (customerId) {
      query = query.eq('customer_id', customerId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ quotes: data || [] });
  } catch (error) {
    console.error('Error fetching quotes:', error);
    return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { line_items, ...quoteData } = body;

    // Generate quote reference
    const initials = (quoteData.requester_initials || 'XX').toUpperCase();
    const { generateQuoteReference } = await import('@/lib/utils/quote-number');
    const quoteReference = await generateQuoteReference(initials);

    // Calculate totals
    const items: Array<{ quantity: number; unit_rate: number }> = line_items || [];
    const subtotal = items.reduce((sum: number, item: { quantity: number; unit_rate: number }) => sum + item.quantity * item.unit_rate, 0);
    const vatRate = quoteData.vat_rate ?? 20;
    const vatAmount = subtotal * (vatRate / 100);
    const total = subtotal + vatAmount;

    const { data: quote, error } = await supabase
      .from('quotes')
      .insert({
        ...quoteData,
        quote_reference: quoteReference,
        subtotal: Math.round(subtotal * 100) / 100,
        vat_amount: Math.round(vatAmount * 100) / 100,
        total: Math.round(total * 100) / 100,
        created_by: user.id,
        updated_by: user.id,
        requester_id: user.id,
      })
      .select()
      .single();

    if (error) throw error;

    // Insert line items
    if (items.length > 0) {
      const lineItemRows = items.map((item: { description?: string; quantity: number; unit?: string; unit_rate: number; sort_order?: number }, idx: number) => ({
        quote_id: quote.id,
        description: item.description || '',
        quantity: item.quantity,
        unit: item.unit || '',
        unit_rate: item.unit_rate,
        line_total: Math.round(item.quantity * item.unit_rate * 100) / 100,
        sort_order: item.sort_order ?? idx,
      }));

      const { error: liError } = await supabase
        .from('quote_line_items')
        .insert(lineItemRows);

      if (liError) {
        console.error('Error inserting line items:', liError);
      }
    }

    return NextResponse.json({ quote }, { status: 201 });
  } catch (error) {
    console.error('Error creating quote:', error);
    return NextResponse.json({ error: 'Failed to create quote' }, { status: 500 });
  }
}
