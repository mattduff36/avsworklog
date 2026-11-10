import { randomUUID } from 'crypto';
import {
  applyAdminCommand, applyDeviceCommand, checkEvidenceDigest, hash,
  type AuditEvent, type QueueStore, type QueueTransaction,
} from '@/lib/fixerrors/control';
import {
  queueStateSchema, type AdminCommand, type Candidate, type CheckEvidence,
  type DeviceCommand, type QueueState, type Workspace,
} from '@/lib/fixerrors/protocol';

export const deviceId = '43c518b9-41be-4a11-bb3f-8706e00a9384';
export const actorId = '166b7b16-311e-4db6-8212-ce7d5acc5d44';
export const credential = 'x'.repeat(43);
export const workspace: Workspace = {
  head: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true, packetSha256: 'c'.repeat(64),
};
export const checks: CheckEvidence = {
  head: 'd'.repeat(40), tree: 'e'.repeat(40),
  checks: [
    { id: 'targeted-tests', outputSha256: '1'.repeat(64), passed: true },
    { id: 'typecheck', outputSha256: '2'.repeat(64), passed: true },
    { id: 'lint', outputSha256: '3'.repeat(64), passed: true },
  ],
};
export const candidate: Candidate = {
  head: checks.head, tree: checks.tree, checksSha256: checkEvidenceDigest(checks),
};
export const now = 1_800_000_000_000;

export function initialState(): QueueState {
  return {
    version: 1, jobs: [],
    devices: [{
      id: deviceId, name: 'Proof fixture', credentialSha256: hash(credential), revoked: false,
      lastSeenAt: now, workspace: { ...workspace }, allowReadOnly: true,
      allowRepair: true, allowDeploy: true, bridgeAvailable: true,
    }],
  };
}

// Transaction model fixture, NOT evidence of PostgreSQL locking/crash durability.
export class FixtureStore implements QueueStore {
  state = initialState();
  events: AuditEvent[] = [];
  private tail = Promise.resolve();
  async transact<T>(work: (tx: QueueTransaction) => T): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const state = structuredClone(this.state);
      const events: AuditEvent[] = [];
      const result = work({ state, audit: (event) => events.push(event) });
      this.state = queueStateSchema.parse(state);
      this.events.push(...events);
      return result;
    } finally {
      release();
    }
  }
}

export function harness(store: QueueStore = new FixtureStore()) {
  let time = now;
  const admin = (command: AdminCommand) => store.transact((tx) => applyAdminCommand(tx, actorId, command, time));
  const device = (command: DeviceCommand, secret = credential, id = deviceId) =>
    store.transact((tx) => applyDeviceCommand(tx, id, secret, command, time));
  const enqueue = async (action: 'review' | 'repair' = 'repair', requestId = randomUUID()) => {
    await admin({ op: 'enqueue', requestId, deviceId, action });
    return requestId;
  };
  const claim = async () => {
    const result = await device({ op: 'claim' });
    if (!('claim' in result) || !result.claim) throw new Error('Expected fixture claim');
    return result.claim;
  };
  const testedRepair = async () => {
    const id = await enqueue();
    const leased = await claim();
    await device({
      op: 'complete', jobId: id, leaseToken: leased.leaseToken,
      result: { status: 'tested', candidate, checks },
    });
    return id;
  };
  const approve = (repairJobId: string) => admin({
    op: 'approve-deploy', requestId: randomUUID(), repairJobId, candidate,
    confirmation: 'DEPLOY EXACT TESTED CANDIDATE',
  });
  return { admin, device, enqueue, claim, testedRepair, approve, advance: (ms: number) => { time += ms; } };
}
