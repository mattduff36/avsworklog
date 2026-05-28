import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getSelectedQuoteInvoiceNotificationRecipientIds,
  listQuoteAccountsNotificationRecipientOptions,
} from '@/lib/server/quote-workflow';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { isEffectiveRoleAdminOrSuper } from '@/lib/utils/rbac';

async function requireQuoteSettingsContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      response: NextResponse.json({ error: 'You must be signed in to use quote settings.' }, { status: 401 }),
      userId: null,
      canManage: false,
    };
  }

  const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
  if (sensitiveAccessResponse) {
    return { response: sensitiveAccessResponse, userId: user.id, canManage: false };
  }

  const canManage = await isEffectiveRoleAdminOrSuper();
  return { response: null, userId: user.id, canManage };
}

export async function GET() {
  try {
    const context = await requireQuoteSettingsContext();
    if (context.response) return context.response;

    const admin = createAdminClient();
    const eligibleRecipients = await listQuoteAccountsNotificationRecipientOptions(admin);
    const selectedRecipientIds = context.canManage
      ? await getSelectedQuoteInvoiceNotificationRecipientIds(admin)
      : [];
    const eligibleIds = new Set(eligibleRecipients.map(recipient => recipient.id));

    return NextResponse.json({
      can_manage: context.canManage,
      eligible_recipients: eligibleRecipients,
      selected_recipient_ids: selectedRecipientIds.filter(id => eligibleIds.has(id)),
    });
  } catch (error) {
    console.error('Error fetching quote notification settings:', error);
    return NextResponse.json({ error: 'Unable to load quote notification settings right now.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const context = await requireQuoteSettingsContext();
    if (context.response) return context.response;
    if (!context.canManage || !context.userId) {
      return NextResponse.json({ error: 'Only admins can manage quote notification settings.' }, { status: 403 });
    }

    const body = await request.json() as { recipient_ids?: unknown };
    const recipientIds = Array.isArray(body.recipient_ids)
      ? Array.from(new Set(body.recipient_ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map(id => id.trim())))
      : [];

    if (recipientIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one Accounts recipient.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const eligibleRecipients = await listQuoteAccountsNotificationRecipientOptions(admin);
    const eligibleIds = new Set(eligibleRecipients.map(recipient => recipient.id));
    const invalidRecipientIds = recipientIds.filter(id => !eligibleIds.has(id));

    if (invalidRecipientIds.length > 0) {
      return NextResponse.json(
        { error: 'Selected recipients must be Accounts team users with Quotes access.' },
        { status: 400 }
      );
    }

    const { error: deleteError } = await admin
      .from('quote_invoice_notification_recipients')
      .delete()
      .not('profile_id', 'is', null);

    if (deleteError) throw deleteError;

    const { error: insertError } = await admin
      .from('quote_invoice_notification_recipients')
      .insert(recipientIds.map(profileId => ({
        profile_id: profileId,
        created_by: context.userId,
        updated_by: context.userId,
      })));

    if (insertError) throw insertError;

    return NextResponse.json({
      can_manage: true,
      eligible_recipients: eligibleRecipients,
      selected_recipient_ids: recipientIds,
    });
  } catch (error) {
    console.error('Error saving quote notification settings:', error);
    return NextResponse.json({ error: 'Unable to save quote notification settings right now.' }, { status: 500 });
  }
}
