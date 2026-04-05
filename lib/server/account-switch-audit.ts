import { createAdminClient } from '@/lib/supabase/admin';

export type AccountSwitchAuditEventType =
  | 'pin_setup'
  | 'pin_reset'
  | 'pin_verify_success'
  | 'pin_verify_failed'
  | 'pin_locked'
  | 'session_registered'
  | 'session_switch_success'
  | 'session_switch_failed'
  | 'shortcut_removed'
  | 'device_registered'
  | 'device_revoked'
  | 'password_fallback_success'
  | 'password_fallback_failed'
  | 'app_session_created'
  | 'app_session_locked'
  | 'app_session_unlocked'
  | 'app_session_revoked'
  | 'device_pin_cleared';

export async function createAccountSwitchAuditEvent({
  profileId,
  actorProfileId,
  eventType,
  metadata,
}: {
  profileId: string;
  actorProfileId: string | null;
  eventType: AccountSwitchAuditEventType;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabaseAdmin = createAdminClient();
  const { error } = await supabaseAdmin.from('account_switch_audit_events').insert({
    profile_id: profileId,
    actor_profile_id: actorProfileId,
    event_type: eventType,
    metadata: metadata || {},
  });

  if (error) {
    // Audit trail should not block user flows.
    console.warn('Failed to write account switch audit event:', error.message);
  }
}
