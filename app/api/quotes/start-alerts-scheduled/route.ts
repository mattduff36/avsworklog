import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  createQuoteNotification,
  sendQuoteStartAlertEmail,
} from '@/lib/server/quote-workflow';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const expected = `Bearer ${process.env.CRON_SECRET}`;

    if (!process.env.CRON_SECRET || authHeader !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);

    const { data: quotes, error } = await admin
      .from('quotes')
      .select(`
        *,
        customer:customers(id, company_name),
        manager:profiles!quotes_requester_id_fkey(id, full_name, email)
      `)
      .not('start_date', 'is', null)
      .is('start_alert_sent_at', null)
      .neq('commercial_status', 'closed')
      .gte('start_date', todayIso);

    if (error) throw error;

    let processed = 0;

    for (const quote of quotes || []) {
      if (!quote.start_date || !quote.start_alert_days || !quote.manager?.email) {
        continue;
      }

      const startDate = new Date(`${quote.start_date}T00:00:00`);
      const diffDays = Math.ceil((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > quote.start_alert_days || diffDays < 0) {
        continue;
      }

      const emailResult = await sendQuoteStartAlertEmail({
        to: quote.manager.email,
        managerName: quote.manager.full_name || 'Manager',
        quoteReference: quote.quote_reference,
        customerName: quote.customer?.company_name || 'Unknown customer',
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

    return NextResponse.json({ success: true, processed });
  } catch (error) {
    console.error('Error processing quote start alerts:', error);
    return NextResponse.json({ error: 'Failed to process quote start alerts' }, { status: 500 });
  }
}
