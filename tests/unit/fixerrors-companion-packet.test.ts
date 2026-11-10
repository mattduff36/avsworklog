import { createHash } from 'node:crypto';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  encodeCompanionPacket, FIXERRORS_COMPANION_PACKET_MAX_BYTES, parseCompanionPacket, prepareCompanionPacket,
  validateCompanionRepairDecision,
} from '@/scripts/automation/fixerrors-companion-packet';
import type { AutoRetrieval } from '@/scripts/fixerrors-auto';
import type { DecisionCluster, FixerrorsDecision } from '@/scripts/fixerrors-decision';

const local = vi.hoisted(() => ({
  files: new Map<string, Buffer>(), descriptors: new Map<number, string>(), nextDescriptor: 1,
  clean: true, ordinary: true, drift: false, synced: false,
}));
vi.mock('node:fs', async (original) => ({
  ...await original<typeof import('node:fs')>(),
  existsSync: (file: string) => local.files.has(file),
  mkdirSync: () => {},
  lstatSync: () => ({ isDirectory: () => local.ordinary, isSymbolicLink: () => !local.ordinary }),
  realpathSync: (file: string) => file,
  openSync: (file: string, flags: string) => {
    if (flags !== 'wx' || local.files.has(file)) throw new Error('Existing local file');
    local.files.set(file, Buffer.alloc(0));
    local.descriptors.set(local.nextDescriptor, file);
    return local.nextDescriptor++;
  },
  closeSync: (fd: number) => { local.descriptors.delete(fd); },
  unlinkSync: (file: string) => { local.files.delete(file); },
  writeFileSync: (fd: number, bytes: Buffer) => { local.files.set(local.descriptors.get(fd)!, Buffer.from(bytes)); },
  fsyncSync: () => { local.synced = true; },
  readFileSync: (file: string) => local.drift ? Buffer.from('changed') : local.files.get(file),
}));
vi.mock('@/scripts/fixerrors-decision', async (original) => ({
  ...await original<typeof import('@/scripts/fixerrors-decision')>(),
  captureCandidateFingerprint: () => ({ baseHead: 'a'.repeat(40), treeFingerprint: 'b'.repeat(64) }),
}));
vi.mock('@/scripts/automation/fixerrors-device-admission', async (original) => {
  const admission = await original<typeof import('@/scripts/automation/fixerrors-device-admission')>();
  return {
    ...admission, inspectFixedFixerrorsWorkspace: () => ({
      platform: 'win32', workspace: admission.FIXERRORS_WORKSPACE, topLevel: admission.FIXERRORS_WORKSPACE,
      gitDirectory: path.join(admission.FIXERRORS_WORKSPACE, '.git'), branch: 'main',
      porcelain: local.clean ? '' : ' M tracked.ts',
    }),
  };
});

const candidate = { baseHead: 'a'.repeat(40), treeFingerprint: 'b'.repeat(64) };
const source = 'lib/utils/display-label.ts';
const test = 'tests/unit/display-label.test.ts';
beforeEach(() => {
  local.files.clear();
  local.descriptors.clear();
  local.nextDescriptor = 1;
  local.clean = true;
  local.ordinary = true;
  local.drift = false;
  local.synced = false;
});
function fixture() {
  const retrieval: AutoRetrieval = {
    schemaVersion: 1, snapshotId: 'ff912f11-3927-45d4-bf15-8bb467b06697', ...candidate, archiveMeansResolved: false,
    clusters: [{
      id: 'cluster-1', rootCauseFamily: 'label formatting', advisoryLane: 'fast', advisoryAction: 'fix',
      query: { errorContextId: null, httpStatus: null, route: '/dashboard', component: 'Label',
        sourceFile: source, normalizedMessage: 'Invalid label', rootCauseFamily: 'label formatting' },
      sourceFiles: [source], patterns: [], priorResolutions: [],
    }],
  };
  const cluster: DecisionCluster = {
    id: 'cluster-1', lane: 'fast', action: 'fix', disposition: 'outstanding', nextStep: 'Repair label formatting',
    evidencePaths: [source, test], files: [source, test], requiredTestIds: [test],
    forbiddenChanges: ['suppress-logging', 'empty-success', 'weaken-authorization'],
    rationale: 'Reproducible missing-label dereference', priorIncidentIds: [], evidenceEnrichmentAttempted: true,
  };
  const decision: FixerrorsDecision = {
    schemaVersion: 1, snapshotId: retrieval.snapshotId, analyst: 'MPDEE Worker', ...candidate, clusters: [cluster],
  };
  const input = { schemaVersion: 1, snapshotChecksum: 'c'.repeat(64), retrieval };
  return { input, decision, cluster, retrieval, bytes: () => encodeCompanionPacket(input, candidate) };
}

describe('local sanitized companion packet and shared guarded decision validation', () => {
  it('encodes canonical bounded bytes and derives only a fixed-ID non-executable plan', () => {
    const f = fixture();
    const bytes = f.bytes();
    expect(bytes.length).toBeLessThanOrEqual(FIXERRORS_COMPANION_PACKET_MAX_BYTES);
    expect(parseCompanionPacket(bytes)).toEqual(f.input);
    const validated = validateCompanionRepairDecision(bytes, f.decision, candidate);
    expect(validated.plan).toEqual({
      editablePaths: [source, test], checkIds: ['targeted-tests', 'typecheck', 'lint'],
      decisionSha256: createHash('sha256').update(JSON.stringify(f.decision)).digest('hex'),
    });

    expect(validated).not.toHaveProperty('launchAuthorized');
    expect(validated).not.toHaveProperty('checks');
  });
  it('rejects oversized, invalid UTF-8, private, arbitrary-command and stale packets', () => {
    const f = fixture();
    expect(() => parseCompanionPacket(Buffer.alloc(FIXERRORS_COMPANION_PACKET_MAX_BYTES + 1))).toThrow('limit');
    expect(() => parseCompanionPacket(Buffer.from([0xff]))).toThrow();
    expect(() => encodeCompanionPacket({ ...f.input, argv: ['fap'] }, candidate)).toThrow();
    expect(() => encodeCompanionPacket(f.input, { ...candidate, baseHead: 'd'.repeat(40) })).toThrow('drift');
    f.retrieval.clusters[0].query.normalizedMessage = 'person@example.com failed';
    expect(() => f.bytes()).toThrow('Sensitive knowledge');
  });
  it.each(['critical-decision', 'critical-evidence', 'sensitive-path', 'deployment-pending', 'no-enrichment',
    'live-fix', 'stale-decision', 'duplicate-paths', 'missing-test', 'unrelated-file'])('holds %s before dispatch', (variant) => {
    const f = fixture();
    if (variant === 'critical-decision') f.cluster.lane = 'critical';
    if (variant === 'critical-evidence') f.retrieval.clusters[0].advisoryLane = 'critical';
    if (variant === 'sensitive-path') {
      f.cluster.files[0] = 'lib/server/display-label.ts';
      f.retrieval.clusters[0].sourceFiles = ['lib/server/display-label.ts'];
    }
    if (variant === 'deployment-pending') f.retrieval.clusters[0].existingState = 'awaiting-deployment';
    if (variant === 'no-enrichment') f.cluster.evidenceEnrichmentAttempted = false;
    if (variant === 'live-fix') { f.cluster.disposition = 'fixed_live'; f.cluster.nextStep = null; }
    if (variant === 'stale-decision') f.decision.treeFingerprint = 'f'.repeat(64);
    if (variant === 'duplicate-paths') f.cluster.files.push(source);
    if (variant === 'missing-test') f.cluster.requiredTestIds = [];
    if (variant === 'unrelated-file') f.cluster.files.push('lib/utils/unrelated.ts');
    expect(() => validateCompanionRepairDecision(f.bytes(), f.decision, candidate)).toThrow();
  });
  it('requires exactly one cluster, including exact held-case and candidate coverage', () => {
    const f = fixture();
    f.retrieval.clusters.push({ ...f.retrieval.clusters[0], id: 'cluster-2', held: true });
    f.decision.clusters.push({ ...f.cluster, id: 'cluster-2' });
    expect(() => validateCompanionRepairDecision(f.bytes(), f.decision, candidate)).toThrow('one independent');
    f.retrieval.clusters[0].held = true;
    f.retrieval.clusters[1].held = false;
    expect(() => f.bytes()).toThrow('new groups ordered');
  });
});

describe('fixed local packet preparation (memory filesystem only; no checkout writes)', () => {
  const directory = path.join('D:\\Websites\\avsworklog', '.git');
  const packetFile = path.join(directory, 'squires-fixerrors', 'sanitized-packet.json');
  const lockFile = path.join(directory, 'squires-fixerrors-companion.lock');
  async function* chunks(bytes: Buffer) { yield bytes.subarray(0, 10); yield bytes.subarray(10); }
  it('writes exclusive canonical bytes, fsyncs, verifies readback and releases its own lock', async () => {
    const bytes = fixture().bytes();
    expect(await prepareCompanionPacket(chunks(bytes))).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(local.files.get(packetFile)).toEqual(bytes);
    expect(local.synced).toBe(true);
    expect(local.files.has(lockFile)).toBe(false);
    expect(local.descriptors.size).toBe(0);
  });
  it('requires a clean checkout and never replaces an existing packet or another owner lock', async () => {
    const bytes = fixture().bytes();
    local.clean = false;
    await expect(prepareCompanionPacket(chunks(bytes))).rejects.toThrow('clean main');
    expect(local.files.size).toBe(0);
    local.clean = true;
    const existing = Buffer.from('owner-reviewed packet');
    local.files.set(packetFile, existing);
    await expect(prepareCompanionPacket(chunks(bytes))).rejects.toThrow('Existing local file');
    expect(local.files.get(packetFile)).toEqual(existing);
    local.files.set(lockFile, existing);
    await expect(prepareCompanionPacket(chunks(bytes))).rejects.toThrow('Existing local file');
    expect(local.files.get(lockFile)).toEqual(existing);
  });
  it('rejects overflow and linked storage before writing; failed readback is not success', async () => {
    await expect(prepareCompanionPacket(chunks(Buffer.alloc(FIXERRORS_COMPANION_PACKET_MAX_BYTES + 1))))
      .rejects.toThrow('input exceeds');
    expect(local.files.size).toBe(0);
    local.ordinary = false;
    await expect(prepareCompanionPacket(chunks(fixture().bytes()))).rejects.toThrow('unlinked');
    expect(local.files.size).toBe(0);
    local.ordinary = true;
    local.drift = true;
    await expect(prepareCompanionPacket(chunks(fixture().bytes()))).rejects.toThrow('owner reconciliation');
    expect(local.files.has(lockFile)).toBe(false);
    expect(local.descriptors.size).toBe(0);
  });
});
