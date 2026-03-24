import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  createQuoteNotification,
  sendQuoteStartAlertEmail,
} from '@/lib/server/quote-workflow';

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const authHeader = request.headers.get('authorization');
    const expected = `Bearer ${process.env.CRON_SECRET}`;

    if (!process.env.CRON_SECRET || authHeader !== expected) {
      return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const admin = createAdminClient();
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const limit = Math.min(
      Math.max(Number.parseInt(request.nextUrl.searchParams.get('limit') || '100', 10) || 100, 1),
      250
    );

    const { data: quotes, error } = await admin
      .from('quotes')
      .select(`
        id,
        quote_reference,
        requester_id,
        created_by,
        updated_by,
        start_date,
        start_alert_days,
        start_alert_sent_at,
        commercial_status,
        subject_line,
        customer:customers(id, company_name),
        manager:profiles!quotes_requester_id_fkey(id, full_name)
      `)
      .not('start_date', 'is', null)
      .is('start_alert_sent_at', null)
      .neq('commercial_status', 'closed')
      .gte('start_date', todayIso)
      .order('start_date', { ascending: true })
      .limit(limit);

    if (error) throw error;

    const requesterIds = Array.from(
      new Set((quotes || []).map((quote) => quote.requester_id).filter((value): value is string => Boolean(value)))
    );
    const requesterEmailById = new Map<string, string>();

    await Promise.all(
      requesterIds.map(async (requesterId) => {
        const { data } = await admin.auth.admin.getUserById(requesterId);
        const email = data.user?.email;
        if (email) {
          requesterEmailById.set(requesterId, email);
        }
      })
    );

    let processed = 0;

    for (const quote of quotes || []) {
      const manager = Array.isArray(quote.manager) ? quote.manager[0] || null : quote.manager;
      const customer = Array.isArray(quote.customer) ? quote.customer[0] || null : quote.customer;
      const managerEmail = quote.requester_id ? requesterEmailById.get(quote.requester_id) || null : null;

      if (!quote.start_date || !quote.start_alert_days || !managerEmail) {
        continue;
      }

      const startDate = new Date(`${quote.start_date}T00:00:00`);
      const diffDays = Math.ceil((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > quote.start_alert_days || diffDays < 0) {
        continue;
      }

      const emailResult = await sendQuoteStartAlertEmail({
        to: managerEmail,
        managerName: manager?.full_name || 'Manager',
        quoteReference: quote.quote_reference,
        customerName: customer?.company_name || 'Unknown customer',
        subjectLine: quote.subject_line || 'No subject provided',
        startDate: quote.start_date,
      });

      if (emailResult.success) {
        await admin
          .from('quotes')
          .update({ start_alert_sent_at: new Date().toISOString() })
          .eq('id', quote.id);

        await createQuoteNotification({
          senderId: quote.requester_id || quote.created_by || quote.updated_by || quote.id,
          recipientIds: quote.requester_id ? [quote.requester_id] : [],
          subject: `Job start reminder: ${quote.quote_reference}`,
          body: `This quote is due to start on ${quote.start_date}.`,
        });

        processed += 1;
      }
    }

    const responseBody = {
      success: true,
      processed,
      scanned: quotes?.length || 0,
      remaining_possible: (quotes?.length || 0) === limit,
    };
    console.log('Quote start alerts processed', {
      duration_ms: Date.now() - startedAt,
      scanned: responseBody.scanned,
      processed: responseBody.processed,
      remaining_possible: responseBody.remaining_possible,
    });

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error('Error processing quote start alerts:', error);
    return NextResponse.json({ error: 'Unable to process quote start alerts right now.' }, { status: 500 });
  }
}
