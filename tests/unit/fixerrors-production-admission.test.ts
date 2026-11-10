import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { issueClaimedFixerrorsAdmission, fixerrorsDeviceSigningBytes } from '@/lib/fixerrors/admission';
import { applyDeviceCommand } from '@/lib/fixerrors/control';
import { claimSchema } from '@/lib/fixerrors/protocol';
import { admitFixerrorsDeviceJob, FIXERRORS_WORKSPACE } from '@/scripts/automation/fixerrors-device-admission';
import { credential, deviceId, FixtureStore, harness, now, workspace } from './fixerrors-control-fixtures';

const repairKey = generateKeyPairSync('ed25519');
const releaseKey = generateKeyPairSync('ed25519');
const issuer = {
  keyId: 'squires-repair-v1', privateKey: repairKey.privateKey,
  releaseKeyId: 'squires-release-v1', releasePublicKey: releaseKey.publicKey,
};

async function claimed(action: 'review' | 'repair' = 'review') {
  const store = new FixtureStore();
  await harness(store).enqueue(action);
  const result = await store.transact((tx) => applyDeviceCommand(
    tx, deviceId, credential, { op: 'claim' }, now, undefined,
    (job, at) => issueClaimedFixerrorsAdmission(job, at, issuer),
  ));
  if (!('claim' in result) || !result.claim) throw new Error('Fixture admission missing');
  return { store, claim: claimSchema.parse(result.claim) };
}

describe('production review/repair signed admission (offline; never launches a worker)', () => {
  it.each(['review', 'repair'] as const)('signs only the claimed %s with the canonical v1 binding', async (action) => {
    const { store, claim } = await claimed(action);
    if (!claim.admissionTicket) throw new Error('Signed fixture admission missing');
    const envelope = JSON.parse(claim.admissionTicket);
    expect(verify(null, fixerrorsDeviceSigningBytes(envelope.keyId, envelope.payload), repairKey.publicKey,
      Buffer.from(envelope.signature, 'base64url'))).toBe(true);
    const payload = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8'));
    expect(payload.expiresAt - payload.issuedAt).toBe(action === 'repair' ? 600 : 300);
    expect(payload).toMatchObject({
      jobId: claim.job.id, deviceId, authority: action === 'review' ? 'read-only' : 'bounded-repair',
      head: workspace.head, tree: workspace.tree, packetSha256: workspace.packetSha256,
      issuedAt: now / 1000, expiresAt: claim.job.expiresAt / 1000,
    });
    expect(JSON.stringify(store.state)).not.toContain('admissionTicket');
    const admitted = await admitFixerrorsDeviceJob(claim.admissionTicket, {
      enabled: true, deviceId, environment: 'squires-production', keyId: issuer.keyId,
      publicKeyPem: repairKey.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      allowReadOnly: true, allowBoundedRepair: true, workerEligible: true,
    }, {
      nowSeconds: () => now / 1000, replayStore: { claimOnce: async () => true },
      packetSha256: () => workspace.packetSha256,
      inspectWorkspace: () => ({
        platform: 'win32', workspace: FIXERRORS_WORKSPACE, topLevel: FIXERRORS_WORKSPACE,
        gitDirectory: `${FIXERRORS_WORKSPACE}\\.git`, branch: 'main', porcelain: '',
        head: workspace.head, tree: workspace.tree,
      }),
    });
    expect(admitted.launchAuthorized).toBe(false);
  });

  it('rolls back lease and audit on signing failure and never signs unauthorized claims', async () => {
    const store = new FixtureStore();
    await harness(store).enqueue();
    const fail = vi.fn(() => { throw new Error('Fixture signing failure'); });
    const claim = (secret: string) => store.transact((tx) =>
      applyDeviceCommand(tx, deviceId, secret, { op: 'claim' }, now, undefined, fail));
    await expect(claim('wrong')).rejects.toThrow('Unauthorized');
    expect(fail).not.toHaveBeenCalled();
    await expect(claim(credential)).rejects.toThrow('signing failure');
    expect(store.state.jobs[0]).toMatchObject({ state: 'queued', lease: null });
    expect(store.events.some((event) => event.event === 'job-claimed')).toBe(false);
  });

  it('rejects missing admissions and separate-key, action, lease and expiry mismatches', async () => {
    const { claim } = await claimed();
    for (const change of [
      { action: 'deploy' as const }, { state: 'queued' as const }, { lease: null },
      { expiresAt: now }, { createdAt: now + 1 },
      { lease: { ...claim.job.lease!, until: now } },
      { lease: { ...claim.job.lease!, deployStartedAt: now } },
    ]) {
      expect(() => issueClaimedFixerrorsAdmission({ ...claim.job, ...change }, now, issuer)).toThrow();
    }
    expect(() => issueClaimedFixerrorsAdmission(claim.job, now, {
      ...issuer, releasePublicKey: repairKey.publicKey,
    })).toThrow('Separate');
    expect(() => issueClaimedFixerrorsAdmission(claim.job, now, {
      ...issuer, releaseKeyId: issuer.keyId,
    })).toThrow('Separate');
    const store = new FixtureStore();
    await harness(store).enqueue();
    await expect(store.transact((tx) => applyDeviceCommand(
      tx, deviceId, credential, { op: 'claim' }, now, undefined, () => '',
    ))).rejects.toThrow('Signed admission unavailable');
    expect(store.state.jobs[0].state).toBe('queued');
  });
});
