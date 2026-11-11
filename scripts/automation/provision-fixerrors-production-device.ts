import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { writeProtectedFixerrorsEnrollment } from './provision-fixerrors-local-device';
import { productionBridgeFiles } from './fixerrors-production-bridge';

const appData = process.env.LOCALAPPDATA ?? '';
const protection = path.join(homedir(), '.codex', 'cursor-worker', 'squires-device-secrets');
const legacyProtection = path.join(appData, 'Squires', 'Fixerrors');
const bridge = path.join(homedir(), '.codex', 'cursor-worker', 'squires-production-bridge');
const enrollment = path.join(homedir(), '.codex', 'cursor-worker', 'squires-companion');
const gitExe = 'C:\\Program Files\\Git\\cmd\\git.exe';
const deviceFiles = ['production-device.dpapi', 'production-issuers.dpapi'] as const;

function fileDigest(file: string): string {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024 || realpathSync(file) !== file) {
    throw new Error('Invalid installed bridge file');
  }
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function pair() {
  if (process.platform !== 'win32' || !path.isAbsolute(appData) ||
      process.argv.length !== 4 || process.argv[2] !== '--prepare-local-production-enrollment') {
    throw new Error('Explicit Windows production enrollment preparation required');
  }
  const pythonExe = realpathSync(process.argv[3]);
  if (!path.isAbsolute(process.argv[3]) || path.basename(pythonExe).toLowerCase() !== 'python.exe') {
    throw new Error('A fixed Windows Python executable is required');
  }
  if (existsSync(enrollment) || deviceFiles.some((file) => existsSync(path.join(protection, file)) || existsSync(path.join(legacyProtection, file)))) {
    throw new Error('Existing enrollment requires owner review');
  }
  const bridgeHashes = productionBridgeFiles.map((file) => fileDigest(path.join(bridge, file)));
  const adapter = path.join(bridge, 'squires-fap-adapter.mjs');
  const adapterSha = fileDigest(adapter);
  const deviceId = randomUUID();
  const enrollmentId = randomUUID();
  const credential = randomBytes(32).toString('base64url');
  const keyPair = () => generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const deviceKey = keyPair();
  const repair = keyPair();
  const release = keyPair();
  writeProtectedFixerrorsEnrollment('production-device.dpapi', {
    deviceId, credential, pythonExe, bridgeHashes,
    devicePrivateKeyPem: deviceKey.privateKey, releasePublicKeyPem: release.publicKey, repairPublicKeyPem: repair.publicKey,
  });
  writeProtectedFixerrorsEnrollment('production-issuers.dpapi', {
    releasePrivateKeyPem: release.privateKey, repairPrivateKeyPem: repair.privateKey,
  });
  const powershell = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH')),
    NODE_ENV: 'production',
  };
  execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; $dir=Join-Path $env:USERPROFILE '.codex\\cursor-worker\\squires-companion'; " +
    "if(Test-Path -LiteralPath $dir){throw 'Existing bridge enrollment'}; " +
    '$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; ' +
    '$acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); ' +
    "$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')); " +
    '[IO.Directory]::CreateDirectory($dir) | Out-Null; Set-Acl -LiteralPath $dir -AclObject $acl;',
  ], { env, timeout: 10_000, windowsHide: true, stdio: 'ignore' });
  writeFileSync(path.join(enrollment, 'enrollment.json'), JSON.stringify({
    version: 1, enabled: false, environment: 'squires-production', deviceId, enrollmentId,
    workerEligible: false, allowReadOnly: false, allowBoundedRepair: false, allowRelease: false,
    issuer: { keyId: 'squires-repair-v1', publicKeyPem: repair.publicKey },
    releaseIssuer: { keyId: 'squires-release-v1', publicKeyPem: release.publicKey },
    devicePublicKeyPem: deviceKey.publicKey, gitExe, checks: Object.fromEntries(
      ['targeted-tests', 'typecheck', 'lint'].map(id => [id, {
        argv: [realpathSync(process.execPath), 'scripts/automation/fixerrors-scoped-check.mjs', id],
        timeout_seconds: 120, description: `Trusted scoped ${id}`,
      }]),
    ),
    releaseAdapter: { nodeExe: realpathSync(process.execPath), script: adapter, sha256: adapterSha },
  }), { flag: 'wx' });
  execFileSync(pythonExe, ['-I', '-B', '-c', [
    'import sqlite3, sys',
    'with sqlite3.connect(sys.argv[1]) as db:',
    '    db.executescript("CREATE TABLE enrollment(enrollment_id TEXT PRIMARY KEY,highwater INTEGER NOT NULL); CREATE TABLE claims(namespace TEXT,job_id TEXT,ticket_hash TEXT,claimed_at INTEGER,PRIMARY KEY(namespace,job_id));")',
    '    db.execute("INSERT INTO enrollment VALUES (?,0)",(sys.argv[2],))',
  ].join('\n'), path.join(enrollment, 'claims.sqlite3'), enrollmentId], {
    timeout: 10_000, windowsHide: true, stdio: 'ignore',
  });
  writeFileSync(path.join(enrollment, 'pending-registration.json'), JSON.stringify({
    deviceId, credentialSha256: createHash('sha256').update(credential, 'utf8').digest('hex'),
    repairPublicKeyPem: repair.publicKey, releasePublicKeyPem: release.publicKey,
  }), { flag: 'wx' });
  console.info(`Local production enrollment prepared for ${deviceId}. Registration and all execution remain disabled.`);
}

try { pair(); }
catch {
  console.error('Production enrollment preparation stopped. Check local enrollment before retrying.');
  process.exitCode = 1;
}
