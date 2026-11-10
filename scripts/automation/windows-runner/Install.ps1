[CmdletBinding()]
param([switch]$Install, [string]$NodeExe = 'C:\Program Files\nodejs\node.exe')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User.Value
$account = $identity.Name
$root = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Squires\FixerrorsRunner'
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$sources = @('Native.cs','RunnerHost.cs','ServiceInstall.cs') | ForEach-Object { Join-Path $PSScriptRoot $_ }
if (-not $Install) {
    Write-Output "PLAN ONLY: Build reviewed .NET Framework host into $root; SCM SquiresFixerrorsRunner; account $account ($sid); Manual; no recovery/autostart; owner profile and restricted medium child."
    Write-Output 'Install creates a Desktop .cmd, private lifecycle logs, immutable admin-owned package, and the manual service. No enrollment, packet, replay or production setting changes.'
    Write-Output 'After review, run this script with -Install in elevated Windows PowerShell as the enrolled owner. New service only: Get-Credential prompts securely for that same account; an absent Log on as a service right needs explicit GRANT.'
    return
}
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run elevated Windows PowerShell as the enrolled owner; no alternate-account installation.' }
if ($account -ne "$env:COMPUTERNAME\mattd") { throw 'Only the enrolled local mattd account may install; SID is resolved, never hardcoded.' }
function Assert-Ordinary([string]$Path) {
    while ($Path) {
        $item = Get-Item -LiteralPath $Path -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked installation input refused' }
        $Path = Split-Path -Parent $item.FullName
    }
}
function Assert-PackageAcl([string]$Path) {
    Assert-Ordinary $Path
    $acl = Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-32-544','S-1-5-18')) { throw 'Existing package ownership/ACL drift; investigate, do not overwrite' }
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        $write = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
        if ($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $write) -ne 0 -and $rule.IdentityReference.Value -notin @('S-1-5-32-544','S-1-5-18')) { throw 'Untrusted package writer; investigate before installation' }
    }
}
foreach ($file in @($compiler,$NodeExe) + $sources + @((Join-Path $PSScriptRoot 'Manager.ps1'),(Join-Path $PSScriptRoot 'Launch.cmd'))) { Assert-Ordinary $file }
$profile = [Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sid").ProfileImagePath)
if ($profile -ne $env:USERPROFILE) { throw 'Owner profile mismatch' }
$hostExe = Join-Path $root 'RunnerHost.exe'
$configPath = Join-Path $root 'runner.json'
$parent = Split-Path -Parent $root
$data = Join-Path $profile '.codex\cursor-worker\squires-runner-manager'
$desktop = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Squires Runner.cmd'
$desktopText = "@echo off`r`ncall `"$root\Launch.cmd`"`r`n"
if (Test-Path -LiteralPath $parent) { Assert-PackageAcl $parent }
if (Test-Path -LiteralPath $desktop) {
    Assert-Ordinary $desktop
    if ([IO.File]::ReadAllText($desktop) -cne $desktopText) { throw 'An unrelated Desktop launcher exists; not overwritten' }
} else { Assert-Ordinary (Split-Path -Parent $desktop) }
if (Test-Path -LiteralPath $data) {
    Assert-Ordinary $data
    $acl = Get-Acl -LiteralPath $data
    if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'Existing private data ACL drift; not changed' }
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -ne $sid) { throw 'Existing private data is not owner-only; not changed' }
    }
} else {
    $ancestor = Split-Path -Parent $data
    while (-not (Test-Path -LiteralPath $ancestor)) { $ancestor = Split-Path -Parent $ancestor }
    Assert-Ordinary $ancestor
}
$existing = Get-Service -Name SquiresFixerrorsRunner -ErrorAction SilentlyContinue
if ($existing) {
    if ($existing.Status -ne 'Stopped') { throw 'Stop and confirm the known service before updating' }
    if (-not (Test-Path -LiteralPath $hostExe)) { throw 'Unknown pre-existing service; no changes made' }
}
if (Test-Path -LiteralPath $root) {
    Assert-PackageAcl $root
    if (-not $existing) { throw 'Existing package without known service requires owner reconciliation' }
    foreach ($name in @('RunnerHost.exe','runner.json','Manager.ps1','Launch.cmd')) { Assert-PackageAcl (Join-Path $root $name) }
    $old = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($old.version -ne 1 -or @($old.PSObject.Properties).Count -ne 5 -or $old.ownerSid -ne $sid -or $old.ownerAccount -ne $account -or $old.ownerProfile -ne $profile -or $old.nodeExe -ne $NodeExe) { throw 'Immutable config drift; no account/path replacement permitted' }
    & $hostExe --service-check
    if ($LASTEXITCODE -ne 0) { throw 'Service ownership check failed' }
    $status = & $hostExe --status | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $status.running) { throw 'Existing host is running or cannot be identified; no update' }
}
$pending = Join-Path $root 'RunnerHost.reviewed-pending.exe'
if (Test-Path -LiteralPath $pending) { throw 'Interrupted installation pending file requires investigation' }
function Set-PackageAcl([string]$Path, [bool]$Directory) {
    if ($Directory) { $acl = [Security.AccessControl.DirectorySecurity]::new() } else { $acl = [Security.AccessControl.FileSecurity]::new() }
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($principal in @('S-1-5-18','S-1-5-32-544',$sid)) {
        $rights = if ($principal -eq $sid) { 'ReadAndExecute' } else { 'FullControl' }
        if ($Directory) { $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($principal),$rights,'ContainerInherit,ObjectInherit','None','Allow') }
        else { $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($principal),$rights,'Allow') }
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
if (-not (Test-Path -LiteralPath $parent)) { [void](New-Item -ItemType Directory -Path $parent); Set-PackageAcl $parent $true }
Assert-Ordinary $parent
if (-not (Test-Path -LiteralPath $root)) { [void](New-Item -ItemType Directory -Path $root) }
Set-PackageAcl $root $true
# Compilation is local and uses only the installed Framework compiler.
& $compiler /nologo /warnaserror /target:exe /platform:x64 /r:System.ServiceProcess.dll /r:System.Web.Extensions.dll "/out:$pending" @sources
if ($LASTEXITCODE -ne 0) { throw 'Host compilation failed; service remains stopped' }
if ($existing) { Move-Item -LiteralPath $pending -Destination $hostExe -Force }
else { Move-Item -LiteralPath $pending -Destination $hostExe }
foreach ($name in @('Manager.ps1','Launch.cmd')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $root $name) -Force }
if (-not $existing) {
    [IO.File]::WriteAllText($configPath,([ordered]@{version=1;ownerSid=$sid;ownerAccount=$account;ownerProfile=$profile;nodeExe=$NodeExe} | ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
}
foreach ($name in @('RunnerHost.exe','runner.json','Manager.ps1','Launch.cmd')) { Set-PackageAcl (Join-Path $root $name) $false }
if (-not (Test-Path -LiteralPath $data)) {
    [void](New-Item -ItemType Directory -Path $data)
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($identity.User); $acl.SetAccessRuleProtection($true,$false)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity.User,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
    Set-Acl -LiteralPath $data -AclObject $acl
}
Assert-Ordinary $data
if (-not $existing) {
    [void][Reflection.Assembly]::LoadFrom($hostExe)
    if (-not [Squires.WindowsRunner.ServiceInstall]::HasServiceLogon($sid)) {
        Write-Host "Installing SCM service for $account requires SeServiceLogonRight. This changes only that account's local service logon right."
        if ((Read-Host 'Type GRANT to approve, anything else cancels') -cne 'GRANT') { throw 'Service logon grant not approved; service was not created' }
        [Squires.WindowsRunner.ServiceInstall]::GrantServiceLogon($sid)
    }
    $credential = Get-Credential -UserName $account -Message 'Create manual Squires SCM service as the same enrolled Windows owner. Password goes only to Windows SCM.'
    if ($null -eq $credential -or $credential.UserName -ine $account) { throw 'Same enrolled owner credential required' }
    $password = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential.Password)
    try { [Squires.WindowsRunner.ServiceInstall]::Create($root,$account,$sid,$password) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($password); $credential = $null }
}
& $hostExe --service-check
if ($LASTEXITCODE -ne 0) { throw 'Installed service verification failed' }
if (-not (Test-Path -LiteralPath $desktop)) { [IO.File]::WriteAllText($desktop,$desktopText,[Text.Encoding]::ASCII) }
Write-Output 'Installed and verified Manual SCM service; stopped, no autostart or recovery. Desktop launcher ready. Protected opt-ins and production configuration are unchanged.'
