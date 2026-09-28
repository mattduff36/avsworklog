import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stripOuterMigrationTransaction } from '../../scripts/finalise-migrations';
import {
  DATABASE_COMMENT_PREFIX,
  PROJECT_NAME_HASH_LENGTH,
  PROJECT_NAME_PREFIX,
  PROVENANCE_ENV_KEYS,
  STATE_VERSION,
  isInheritedDatabaseUrlKey,
  validateLocalTestDatabaseUrl,
} from '../../scripts/local-test-postgres';

const describePostgres = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const BASE_PATH = 'tests/db/inventory-kiosk-hardware-identity-base.sql';
const MIGRATION_PATH =
  'supabase/migrations/20260928193000_inventory_kiosk_hardware_identity.sql';

async function waitUntilBlockedBy(
  watcher: Client,
  blockedPid: number,
  blockerPid: number,
): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const result = await watcher.query<{ blocked: boolean }>(
      'SELECT $1::int = ANY (pg_blocking_pids($2::int)) AS blocked',
      [blockerPid, blockedPid],
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error('YK-PG-LOCK-001: revocation did not wait for the kiosk device lock');
}

describePostgres('Yard kiosk hardware identity disposable PostgreSQL runtime', () => {
  const connectionString = process.env.TEST_DATABASE_URL || '';
  const clients: Client[] = [];
  const kioskUserId = randomUUID();
  const managerId = randomUUID();
  let setup: Client;
  let submitter: Client;
  let revoker: Client;
  let activeDeviceId = '';

  function requireRunnerProvenance(): void {
    const marker = process.env[PROVENANCE_ENV_KEYS.marker];
    const projectName = process.env[PROVENANCE_ENV_KEYS.project];
    const portText = process.env[PROVENANCE_ENV_KEYS.port];
    if (!marker || !projectName || !portText || !/^[0-9]+$/u.test(portText)) {
      throw new Error('LTDB-SAFE-001: disposable local PostgreSQL runner provenance is required');
    }
    const leakedDatabaseKeys = Object.keys(process.env).filter(
      (key) => key !== 'TEST_DATABASE_URL' && isInheritedDatabaseUrlKey(key),
    );
    if (leakedDatabaseKeys.length > 0) {
      throw new Error(
        `LTDB-NATIVE-ENV-001: inherited database variables reappeared: ${leakedDatabaseKeys.join(', ')}`,
      );
    }
    validateLocalTestDatabaseUrl(connectionString, Number.parseInt(portText, 10));
    const match = new RegExp(
      `^${DATABASE_COMMENT_PREFIX}:v${STATE_VERSION}:([0-9a-f]{64}):([0-9a-f]{64})$`,
      'u',
    ).exec(marker);
    if (
      !match
      || projectName !== `${PROJECT_NAME_PREFIX}${match[1].slice(0, PROJECT_NAME_HASH_LENGTH)}`
    ) {
      throw new Error('LTDB-SAFE-001: runner project and database marker provenance disagree');
    }
  }

  async function connect(): Promise<Client> {
    const client = new Client({ connectionString, ssl: false });
    await client.connect();
    clients.push(client);
    return client;
  }

  beforeAll(async () => {
    requireRunnerProvenance();
    setup = await connect();
    submitter = await connect();
    revoker = await connect();
    await setup.query(readFileSync(resolve(process.cwd(), BASE_PATH), 'utf8'));
    await setup.query(
      stripOuterMigrationTransaction(
        readFileSync(resolve(process.cwd(), MIGRATION_PATH), 'utf8'),
      ),
    );
    await setup.query(
      `INSERT INTO public.inventory_kiosk_config (id, kiosk_user_id, is_enabled)
       VALUES (1, $1, TRUE)`,
      [kioskUserId],
    );
    await submitter.query(`SET lock_timeout = '8s'`);
    await revoker.query(`SET lock_timeout = '8s'`);
  }, 60_000);

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  });

  it('YK-PG-RLS-001 applies challenge/proof RLS and replay uniqueness', async () => {
    const rls = await setup.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity
       FROM pg_class
       WHERE relname IN (
         'inventory_kiosk_device_challenges',
         'inventory_kiosk_device_request_proofs'
       )
       ORDER BY relname`,
    );
    expect(rls.rows).toEqual([
      { relname: 'inventory_kiosk_device_challenges', relrowsecurity: true },
      { relname: 'inventory_kiosk_device_request_proofs', relrowsecurity: true },
    ]);

    await setup.query('SET ROLE authenticated');
    await expect(
      setup.query('SELECT * FROM public.inventory_kiosk_device_challenges'),
    ).rejects.toMatchObject({ code: '42501' });
    await setup.query('RESET ROLE');

    const pairingId = randomUUID();
    await setup.query(
      `INSERT INTO public.inventory_kiosk_pairing_sessions (
         id, kiosk_user_id, pairing_token_hash, confirmation_code,
         device_label, status, expires_at
       ) VALUES ($1, $2, 'rls-token', '000001', 'RLS fixture', 'active', NOW() + INTERVAL '5 minutes')`,
      [pairingId, kioskUserId],
    );
    const challengeHash = `challenge-${randomUUID()}`;
    await setup.query(
      `INSERT INTO public.inventory_kiosk_device_challenges (
         purpose, pairing_session_id, challenge_hash, expires_at
       ) VALUES ('android_enrollment', $1, $2, NOW() + INTERVAL '2 minutes')`,
      [pairingId, challengeHash],
    );
    await expect(
      setup.query(
        `INSERT INTO public.inventory_kiosk_device_challenges (
           purpose, pairing_session_id, challenge_hash, expires_at
         ) VALUES ('android_enrollment', $1, $2, NOW() + INTERVAL '2 minutes')`,
        [pairingId, challengeHash],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('YK-PG-ENROLL-001 lets exactly one hardware fingerprint claim a pairing', async () => {
    const pairingId = randomUUID();
    await setup.query(
      `INSERT INTO public.inventory_kiosk_pairing_sessions (
         id, kiosk_user_id, pairing_token_hash, confirmation_code, device_label,
         status, expires_at, candidate_identity_kind
       ) VALUES (
         $1, $2, 'race-token', '000003', 'Enrollment race fixture',
         'active', NOW() + INTERVAL '5 minutes', 'android_keystore'
       )`,
      [pairingId, kioskUserId],
    );

    const claim = (client: Client, fingerprint: string) => client.query(
      `UPDATE public.inventory_kiosk_pairing_sessions
       SET
         candidate_hardware_public_key_spki = $2,
         candidate_hardware_key_fingerprint = $2,
         candidate_hardware_seen_at = NOW()
       WHERE id = $1
         AND status = 'active'
         AND candidate_identity_kind = 'android_keystore'
         AND (
           candidate_hardware_key_fingerprint IS NULL
           OR candidate_hardware_key_fingerprint = $2
         )
       RETURNING id`,
      [pairingId, fingerprint],
    );
    const [first, second] = await Promise.all([
      claim(setup, 'fingerprint-a'),
      claim(submitter, 'fingerprint-b'),
    ]);

    expect([first.rowCount, second.rowCount].sort()).toEqual([0, 1]);
    const stored = await setup.query<{ fingerprint: string }>(
      `SELECT candidate_hardware_key_fingerprint AS fingerprint
       FROM public.inventory_kiosk_pairing_sessions
       WHERE id = $1`,
      [pairingId],
    );
    expect(['fingerprint-a', 'fingerprint-b']).toContain(stored.rows[0]!.fingerprint);
  });

  it('YK-PG-PAIR-001 confirms idempotently and atomically replaces one hardware identity', async () => {
    const incompletePairingId = randomUUID();
    await setup.query(
      `INSERT INTO public.inventory_kiosk_pairing_sessions (
         id, kiosk_user_id, pairing_token_hash, confirmation_code, device_label,
         status, expires_at, candidate_identity_kind
       ) VALUES (
         $1, $2, 'incomplete-token', '000002', 'Incomplete fixture',
         'active', NOW() + INTERVAL '5 minutes', 'android_keystore'
       )`,
      [incompletePairingId, kioskUserId],
    );
    await expect(
      setup.query(
        'SELECT * FROM public.inventory_kiosk_confirm_device_pairing($1, $2, $3, FALSE)',
        [managerId, incompletePairingId, '000002'],
      ),
    ).rejects.toThrow(/KIOSK_HARDWARE_IDENTITY_INCOMPLETE/);

    const firstPairingId = randomUUID();
    await setup.query(
      `INSERT INTO public.inventory_kiosk_pairing_sessions (
         id, kiosk_user_id, pairing_token_hash, confirmation_code, device_label,
         status, expires_at, candidate_identity_kind,
         candidate_hardware_public_key_spki, candidate_hardware_key_fingerprint,
         candidate_hardware_attestation, candidate_hardware_seen_at
       ) VALUES (
         $1, $2, 'first-token', '123456', 'Wall tablet',
         'active', NOW() + INTERVAL '5 minutes', 'android_keystore',
         'first-spki', 'first-fingerprint', '{"verified":true}', NOW()
       )`,
      [firstPairingId, kioskUserId],
    );
    const first = await setup.query<{ new_device_id: string }>(
      'SELECT * FROM public.inventory_kiosk_confirm_device_pairing($1, $2, $3, FALSE)',
      [managerId, firstPairingId, '123456'],
    );
    const firstDeviceId = first.rows[0]!.new_device_id;
    const repeated = await setup.query<{ new_device_id: string }>(
      'SELECT * FROM public.inventory_kiosk_confirm_device_pairing($1, $2, $3, FALSE)',
      [managerId, firstPairingId, '123456'],
    );
    expect(repeated.rows[0]!.new_device_id).toBe(firstDeviceId);

    await setup.query(
      `INSERT INTO public.app_auth_sessions (kiosk_device_id)
       VALUES ($1);
       INSERT INTO public.inventory_kiosk_device_commands (device_id, status)
       VALUES ($1, 'pending')`,
      [firstDeviceId],
    );

    const replacementPairingId = randomUUID();
    await setup.query(
      `INSERT INTO public.inventory_kiosk_pairing_sessions (
         id, kiosk_user_id, pairing_token_hash, confirmation_code, device_label,
         status, expires_at, replaces_device_id, candidate_identity_kind,
         candidate_hardware_public_key_spki, candidate_hardware_key_fingerprint,
         candidate_hardware_attestation, candidate_hardware_seen_at
       ) VALUES (
         $1, $2, 'replacement-token', '654321', 'Wall tablet replacement',
         'active', NOW() + INTERVAL '5 minutes', $3, 'android_keystore',
         'replacement-spki', 'replacement-fingerprint', '{"verified":true}', NOW()
       )`,
      [replacementPairingId, kioskUserId, firstDeviceId],
    );
    const replacement = await setup.query<{
      new_device_id: string;
      replaced_device_id: string;
    }>(
      'SELECT * FROM public.inventory_kiosk_confirm_device_pairing($1, $2, $3, TRUE)',
      [managerId, replacementPairingId, '654321'],
    );
    activeDeviceId = replacement.rows[0]!.new_device_id;
    expect(replacement.rows[0]!.replaced_device_id).toBe(firstDeviceId);

    const state = await setup.query<{
      id: string;
      hardware_identity_kind: string;
      revoked: boolean;
    }>(
      `SELECT id::text, hardware_identity_kind, revoked_at IS NOT NULL AS revoked
       FROM public.inventory_kiosk_devices
       ORDER BY id`,
    );
    expect(state.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstDeviceId, revoked: true }),
      expect.objectContaining({
        id: activeDeviceId,
        hardware_identity_kind: 'android_keystore',
        revoked: false,
      }),
    ]));

    const related = await setup.query<{
      session_revoked: boolean;
      command_status: string;
    }>(
      `SELECT
         session.revoked_at IS NOT NULL AS session_revoked,
         command.status AS command_status
       FROM public.app_auth_sessions AS session
       JOIN public.inventory_kiosk_device_commands AS command
         ON command.device_id = session.kiosk_device_id
       WHERE session.kiosk_device_id = $1`,
      [firstDeviceId],
    );
    expect(related.rows).toEqual([{ session_revoked: true, command_status: 'cancelled' }]);
  });

  it('YK-PG-LOCK-001 serializes an in-flight hardware transfer before revocation', async () => {
    const submitterPid = (
      await submitter.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    ).rows[0]!.pid;
    const revokerPid = (
      await revoker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    ).rows[0]!.pid;

    await submitter.query('BEGIN');
    await submitter.query(
      `SELECT * FROM public.inventory_kiosk_execute_hardware_bound_basket(
         $1, $2, FALSE, 'take', $3, '{}'::uuid[], '[]'::jsonb, NULL, 'fixture'
       )`,
      [kioskUserId, activeDeviceId, randomUUID()],
    );

    const revocation = revoker.query(
      `UPDATE public.inventory_kiosk_devices
       SET revoked_at = NOW(), revoked_by = $2, revoked_reason = 'manager_revoked'
       WHERE id = $1 AND revoked_at IS NULL`,
      [activeDeviceId, managerId],
    );
    await waitUntilBlockedBy(setup, revokerPid, submitterPid);
    await submitter.query('COMMIT');
    await revocation;

    await expect(
      setup.query(
        `SELECT * FROM public.inventory_kiosk_execute_hardware_bound_basket(
           $1, $2, FALSE, 'take', $3, '{}'::uuid[], '[]'::jsonb, NULL, 'fixture'
         )`,
        [kioskUserId, activeDeviceId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  }, 15_000);
});
