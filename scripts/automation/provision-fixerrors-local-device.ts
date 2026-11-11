import { execFileSync } from 'child_process';
import { randomBytes, randomUUID } from 'crypto';
import path from 'path';
import { pathToFileURL } from 'url';
import { hash } from '../../lib/fixerrors/control';
import { localFixerrorsStore } from '../../lib/server/fixerrors/store';

// Manually run locally after the dedicated local schema is installed. No dotenv.
export function writeProtectedFixerrorsEnrollment(
  file: 'device.dpapi' | 'production-device.dpapi' | 'production-issuers.dpapi',
  payload: object,
): void {
  if (process.platform !== 'win32') throw new Error('Windows provisioning required');
  const powershell = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH')),
    NODE_ENV: 'production',
  };
  // DPAPI CurrentUser plus an owner-only directory ACL. Secret travels over stdin,
  // never command-line arguments, browser, console or the database.
  execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; $dir=Join-Path $env:USERPROFILE '.codex\\cursor-worker\\squires-device-secrets'; " +
    `$file=Join-Path $dir '${file}'; if(Test-Path -LiteralPath $file){throw 'Already provisioned'}; ` +
    `if(Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'Squires\\Fixerrors\\${file}')){throw 'Existing legacy enrollment requires migration, not replacement'}; ` +
    '$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; ' +
    '$acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); ' +
    "$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); " +
    '$acl.AddAccessRule($rule); ' +
    'if(!(Test-Path -LiteralPath $dir)){[IO.Directory]::CreateDirectory($dir) | Out-Null; Set-Acl -LiteralPath $dir -AclObject $acl}; ' +
    '$actual=Get-Acl -LiteralPath $dir; ' +
    "if(!$actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]) -ne $sid -or " +
    "@($actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference -ne $sid }).Count){throw 'Unsafe enrollment ACL'}; " +
    '$text=[Console]::In.ReadToEnd(); $secure=ConvertTo-SecureString -String $text -AsPlainText -Force; ' +
    '$encrypted=ConvertFrom-SecureString $secure; ' +
    '$stream=[IO.File]::Open($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None); ' +
    'try {$bytes=[Text.Encoding]::UTF8.GetBytes($encrypted); $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true)} finally {$stream.Dispose()}',
  ], {
    input: JSON.stringify(payload), env, timeout: 10_000, maxBuffer: 4096,
    windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export async function provisionFixerrorsLocalDevice(): Promise<string> {
  const deviceId = randomUUID();
  const credential = randomBytes(32).toString('base64url');
  writeProtectedFixerrorsEnrollment('device.dpapi', { deviceId, credential });
  // If commit is uncertain the local enrollment remains unusable; do not silently retry.
  await localFixerrorsStore.transact((tx) => {
    if (tx.state.devices.length >= 20) throw new Error('Local device capacity reached');
    tx.state.devices.push({
      id: deviceId, name: 'Squires Windows companion', credentialSha256: hash(credential),
      revoked: false, lastSeenAt: null, workspace: null,
      allowReadOnly: false, allowRepair: false, allowDeploy: false, bridgeAvailable: false,
    });
    tx.audit({ at: Date.now(), actor: deviceId, deviceId, event: 'device-provisioned-locally', jobId: null });
  });
  return deviceId;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  provisionFixerrorsLocalDevice().then((id) => {
    console.info(`Local Fixerrors device provisioned: ${id}. All execution opt-ins remain off.`);
  }).catch(() => {
    console.error('Local device provisioning failed. Inspect local schema/enrollment; do not retry an uncertain commit.');
    process.exitCode = 1;
  });
}
