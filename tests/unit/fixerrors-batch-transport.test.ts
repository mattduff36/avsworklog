import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invokeProductionBatch } from '@/scripts/automation/fixerrors-production-bridge';
import type { BatchExecutionContext } from '@/scripts/automation/fixerrors-companion';
import { harness } from './fixerrors-control-fixtures';

const processFixture = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawn: processFixture.spawn,
}));
afterEach(() => vi.restoreAllMocks());

async function fixture(output: (job: Awaited<ReturnType<ReturnType<typeof harness>['claim']>>['job']) => string, code = 0) {
  const h = harness();
  await h.enqueue();
  const { job } = await h.claim();
  const child = new EventEmitter();
  const stdout = new PassThrough();
  const received: unknown[] = [];
  let frames = 0;
  let started = false;
  let closed = false;
  const close = () => { if (!closed) { closed = true; child.emit('close', code); } };
  const kill = vi.fn(() => { close(); return true; });
  const stdin = new Writable({ write(chunk: Buffer, _encoding, callback) {
    const frame = JSON.parse(chunk.toString());
    received.push(frame);
    if ('chunks' in frame) frames = frame.chunks + 1;
    if (!started && received.length === frames) {
      started = true;
      setImmediate(() => { stdout.write(output(job)); close(); });
    }
    callback();
  } });
  processFixture.spawn.mockReturnValue(Object.assign(child, { stdin, stdout, kill }));
  const context: BatchExecutionContext = {
    manifest: Buffer.from('Synthetic manifest'), lease: vi.fn(async () => 'synthetic signed authority'),
  };
  return { context, job, received, kill, run: () => invokeProductionBatch(
    'C:\\fixture\\python.exe', 'C:\\fixture\\entry.py', Buffer.from('Synthetic device proof'),
    new AbortController().signal, job, context,
  ) };
}

const complete = (id: string) => ({ jobId: id, result: { status: 'no-change' }, outcomeSha256: 'a'.repeat(64) });
const pause = (id: string) => ({ jobId: id, paused: 'b'.repeat(64) });
const wire = (...frames: unknown[]) => frames.map(frame => JSON.stringify(frame) + '\n').join('');

describe('native framed batch terminal acknowledgement', () => {
  it('delivers framed chunks and marks stopped only after completion and exit zero', async () => {
    const f = await fixture(job => wire(complete(job.id)));
    expect(await f.run()).toEqual({ status: 'no-change' });
    expect(f.context).toMatchObject({ stopped: true, outcomeSha256: 'a'.repeat(64) });
    expect(f.received).toEqual([
      { proof: 'Synthetic device proof', bytes: f.context.manifest.length, chunks: 1 },
      { index: 0, data: f.context.manifest.toString('base64url') },
    ]);
    expect(f.kill).toHaveBeenCalledOnce();
  });

  it('confirms a stopped prefix only with the native pause exit code', async () => {
    const f = await fixture(job => wire(pause(job.id)), 2);
    expect(await f.run()).toEqual({ status: 'blocked', reason: 'execution-failed' });
    expect(f.context).toMatchObject({ stopped: true, paused: 'b'.repeat(64) });
  });

  it('answers authenticated lease requests and caches only identical requests', async () => {
    const f = await fixture(job => {
      const request = { lease: { runId: job.id, deviceId: job.deviceId,
        manifestSha256: job.workspace.packetSha256, checkpointSha256: 'c'.repeat(64),
        cursor: 0, resume: false, outcome: null } };
      return wire(request, request, complete(job.id));
    });
    await f.run();
    expect(f.context.lease).toHaveBeenCalledOnce();
    expect(f.received.slice(2)).toEqual([
      { lease: 'synthetic signed authority' }, { lease: 'synthetic signed authority' },
    ]);
  });

  it.each([
    ['failed completion exit', (id: string) => wire(complete(id)), 2],
    ['incorrect pause exit', (id: string) => wire(pause(id)), 0],
    ['missing terminal frame', () => '', 0],
    ['malformed frame', () => '{invalid}\n', 0],
    ['oversized frame', () => 'x'.repeat(192 * 1024 + 1) + '\n', 0],
    ['incomplete trailing frame', (id: string) => wire(complete(id)) + '{', 0],
    ['duplicate completion', (id: string) => wire(complete(id), complete(id)), 0],
    ['duplicate pause', (id: string) => wire(pause(id), pause(id)), 2],
    ['mixed terminal frames', (id: string) => wire(pause(id), complete(id)), 2],
    ['foreign run', () => wire(complete('00000000-0000-4000-8000-000000000000')), 0],
  ])('retains uncertain state after %s', async (_name, output, code) => {
    const f = await fixture(job => output(job.id), code);
    await expect(f.run()).rejects.toThrow('completion unconfirmed');
    expect(f.context.stopped).not.toBe(true);
  });

  it('rejects lease requests after a terminal frame without requesting further authority', async () => {
    const f = await fixture(job => wire(complete(job.id), { lease: {
      runId: job.id, deviceId: job.deviceId, manifestSha256: job.workspace.packetSha256,
      checkpointSha256: 'c'.repeat(64), cursor: 0, resume: false, outcome: null,
    } }));
    await expect(f.run()).rejects.toThrow('completion unconfirmed');
    expect(f.context.lease).not.toHaveBeenCalled();
    expect(f.context.stopped).not.toBe(true);
  });
});
