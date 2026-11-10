import { execFileSync, spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const workspace = 'D:\\Websites\\avsworklog';
const remote = 'https://github.com/mattduff36/avsworklog.git';
const ref = 'refs/heads/main';
const liveOrigin = 'https://www.squiresapp.com';
const gitExe = 'C:\\Program Files\\Git\\cmd\\git.exe';
const oid = /^[a-f0-9]{40}$/u;
const deploymentIdPattern = /^dpl_[A-Za-z0-9]{1,120}$/u;
const result = (status, deploymentId = null) => ({ status, deploymentId });

export function approvedReleaseContext(ticket, expectedRemoteHead, nowSeconds) {
  if (ticket?.version !== 1 || ticket?.audience !== 'squires-windows-fap' ||
      ticket?.job !== 'fap' || ticket?.environment !== 'squires-production' ||
      !Number.isSafeInteger(ticket.issuedAt) || !Number.isSafeInteger(ticket.expiresAt) ||
      ticket.issuedAt > nowSeconds || ticket.expiresAt <= nowSeconds ||
      ticket.expiresAt - ticket.issuedAt > 300 ||
      ![ticket.head, ticket.tree, expectedRemoteHead].every((value) => typeof value === 'string' && oid.test(value)) ||
      ticket.head === expectedRemoteHead) {
    throw new Error('Invalid production release approval');
  }
  return { head: ticket.head, tree: ticket.tree, remote, ref, expectedRemoteHead };
}

async function readLive(pathname) {
  const response = await fetch(liveOrigin + pathname, {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Live deployment identity unavailable');
  return response.json();
}

export async function verifyLiveDeployment(head, read = readLive) {
  const identity = await read('/api/daily-allocation/deployment-identity');
  return identity.commit_sha === head && deploymentIdPattern.test(identity.deployment_id)
    ? identity.deployment_id : null;
}

function osEnvironment() {
  const keep = new Set(['SYSTEMROOT', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC', 'TEMP', 'TMP',
    'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => keep.has(key.toUpperCase())));
  const drive = (process.env.SystemRoot || 'C:\\Windows').slice(0, 2);
  return { ...env, SystemDrive: drive, ProgramData: `${drive}\\ProgramData` };
}

async function run(ticket) {
  const npm = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (process.platform !== 'win32' || realpathSync(process.cwd()) !== workspace ||
      !existsSync(gitExe) || !existsSync(npm)) return result('blocked');
  const env = osEnvironment();
  const git = (...args) => execFileSync(gitExe, args, {
    cwd: workspace, env, encoding: 'utf8', timeout: 20_000,
    windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 65_536,
  }).trim();
  const base = git('rev-parse', '--verify', 'HEAD~2');
  const context = approvedReleaseContext(ticket, base, Math.floor(Date.now() / 1000));
  if (git('rev-parse', '--verify', 'HEAD') !== context.head ||
      git('rev-parse', '--verify', 'HEAD^{tree}') !== context.tree) return result('blocked');
  // The bridge already verified the signed ticket and consumed the one-use approval.
  // finalise independently enforces the exact context before any push.
  const exit = await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [npm, 'run', 'finalise:push', '--', '--guarded-push'], {
      cwd: workspace, env: { ...env, SQUIRES_FINALISE_GUARDED_PUSH_CONTEXT: JSON.stringify(context) },
      windowsHide: true, stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  const remoteState = git('-c', 'http.followRedirects=false', '-c', 'http.sslVerify=true',
    'ls-remote', '--refs', '--exit-code', remote, ref);
  if (remoteState === `${base}\t${ref}` && exit !== 0) return result('failed');
  if (remoteState !== `${context.head}\t${ref}`) return result('unknown');
  const deadline = Date.now() + 5 * 60_000;
  do {
    const deploymentId = await verifyLiveDeployment(context.head).catch(() => null);
    if (deploymentId) return result('released', deploymentId);
    await delay(10_000);
  } while (Date.now() < deadline);
  return result('unknown');
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 4096) return result('blocked');
  }
  return run(JSON.parse(input));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then((value) => { console.log(JSON.stringify(value)); })
    .catch(() => { console.log(JSON.stringify(result('unknown'))); process.exitCode = 2; });
}
