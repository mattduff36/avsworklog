import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { assertAutomaticPath, assertCleanLocalMain } from '../fixerrors-auto';
import { captureCandidateFingerprint, validateDecision } from '../fixerrors-decision';
import { parseCompanionPacket, validateCompanionRepairDecision } from './fixerrors-companion-packet';
import { FIXERRORS_WORKSPACE } from './fixerrors-device-admission';

const inputSchema = z.object({
  packet: z.string().min(1).max(131_072),
  decision: z.unknown().optional(),
}).strict();

export function inspectBridgePacket(input: unknown, cwd = FIXERRORS_WORKSPACE) {
  const value = inputSchema.parse(input);
  if (!/^[A-Za-z0-9_-]+$/u.test(value.packet)) throw new Error('Invalid packet encoding');
  const bytes = Buffer.from(value.packet, 'base64url');
  if (bytes.toString('base64url') !== value.packet) throw new Error('Noncanonical packet encoding');
  const packet = parseCompanionPacket(bytes);
  assertCleanLocalMain(cwd);
  const candidate = captureCandidateFingerprint(cwd);
  if (packet.retrieval.baseHead !== candidate.baseHead || packet.retrieval.treeFingerprint !== candidate.treeFingerprint ||
      packet.retrieval.clusters.length !== 1) throw new Error('Packet requires one exact current cluster');
  if (value.decision === undefined) return { packet, candidate };
  const decision = validateDecision({
    decision: value.decision, candidate, retrieval: packet.retrieval,
    snapshotId: packet.retrieval.snapshotId, snapshotChecksum: packet.snapshotChecksum,
  });
  if (decision.clusters.some(cluster => cluster.disposition === 'fixed_live')) throw new Error('Cannot claim a live fix');
  return { packet, candidate, decision };
}

export function validateBridgeRepair(input: unknown, cwd = FIXERRORS_WORKSPACE) {
  const inspected = inspectBridgePacket(input, cwd);
  const value = inputSchema.parse(input);
  const { decision, plan } = validateCompanionRepairDecision(
    Buffer.from(value.packet, 'base64url'), value.decision, inspected.candidate,
  );
  const tests = decision.clusters[0].requiredTestIds;
  const names = [...new Set([...plan.editablePaths, ...tests])];
  if (new Set(names.map(name => name.toLowerCase())).size !== names.length) throw new Error('Case-alias scope');
  for (const name of names) {
    assertAutomaticPath(name);
    if (!/^(?:app|components|lib|hooks|tests\/unit)\//u.test(name)) throw new Error('Native repair path unsupported');
    const file = path.resolve(cwd, name);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(file) !== file || stat.size > 1024 * 1024) {
      throw new Error('Repair requires bounded ordinary existing files');
    }
    execFileSync('git', ['ls-files', '--error-unmatch', '--', name], { cwd, stdio: 'ignore', timeout: 10_000 });
    if (/\b(?:service_role|createAdminClient|require[A-Za-z]*Access|SUPABASE|POSTGRES|SECURITY DEFINER|BEGIN|COMMIT|FOR UPDATE)\b/u
      .test(readFileSync(file, 'utf8'))) throw new Error('Sensitive file contents require owner approval');
  }
  return { decision, plan, tests };
}

async function main() {
  if (process.argv.length !== 3 || !['inspect', 'decision', 'repair'].includes(process.argv[2]) ||
      realpathSync(process.cwd()) !== FIXERRORS_WORKSPACE) throw new Error('Fixed bridge boundary required');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error('Boundary input exceeds limit');
    chunks.push(Buffer.from(chunk));
  }
  const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const output = process.argv[2] === 'repair' ? validateBridgeRepair(input) : inspectBridgePacket(input);
  if (process.argv[2] === 'decision' && !('decision' in output)) throw new Error('Decision required');
  console.log(JSON.stringify(output));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Trusted packet/decision boundary rejected input'); process.exitCode = 2; });
}
