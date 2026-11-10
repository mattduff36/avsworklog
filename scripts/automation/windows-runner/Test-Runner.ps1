[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$compiler=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$root=Join-Path ([IO.Path]::GetTempPath()) ('SquiresRunnerFixture-'+[guid]::NewGuid().ToString())
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if (([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run native fixtures as standard enrolled user, never elevated' }
$null=New-Item -ItemType Directory -Path $root
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($identity.User); $acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity.User,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
Set-Acl -LiteralPath $root -AclObject $acl
$exe=Join-Path $root 'RunnerHost.exe'
$process=$null
$owned=@()
$oldSystemDrive=$env:SystemDrive
$oldNodeOptions=$env:NODE_OPTIONS
$env:SystemDrive=[IO.Path]::GetPathRoot($env:SystemRoot).TrimEnd('\')
$env:NODE_OPTIONS='synthetic-fixture-inheritance-must-be-removed'
function Assert([bool]$Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Await([scriptblock]$Condition,[string]$Message) {
    $deadline=[DateTime]::UtcNow.AddSeconds(15)
    while (-not (& $Condition)) { if ([DateTime]::UtcNow -ge $deadline) { throw $Message }; Start-Sleep -Milliseconds 100 }
}
function Start-Fixture {
    foreach ($name in @('child.txt','grandchild.txt','window.txt','stderr.txt')) {
        $file=Join-Path $root $name
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
    }
    $script:process=Get-Process -Id ([SquiresRunnerTestConsole]::Start($exe))
    Await {
        if ($script:process.HasExited) {
            throw ('Disposable host exited: '+[IO.File]::ReadAllText((Join-Path $root 'stderr.txt')))
        }
        Test-Path -LiteralPath (Join-Path $root 'grandchild.txt')
    } 'Fixture tree did not start'
    $script:owned=@($script:process.Id,[int](Get-Content -LiteralPath (Join-Path $root 'child.txt')),[int](Get-Content -LiteralPath (Join-Path $root 'grandchild.txt')))
    foreach ($id in $script:owned) { Assert ($null -ne (Get-Process -Id $id -ErrorAction SilentlyContinue)) 'Missing disposable process' }
}
function Assert-TreeGone {
    try {
        Await {
            @($script:owned | Where-Object { $null -ne (Get-Process -Id $_ -ErrorAction SilentlyContinue) }).Count -eq 0
        } 'Disposable host or descendant survived stop'
    } catch {
        $alive=@($script:owned | Where-Object { $null -ne (Get-Process -Id $_ -ErrorAction SilentlyContinue) })
        $signals=Join-Path $root 'signals.txt'
        $observed=if (Test-Path -LiteralPath $signals) { Get-Content -LiteralPath $signals -Raw } else { 'none' }
        throw "Disposable fixture survivors=$($alive -join ','); console signals=$observed"
    }
}
try {
    $sources=@('Native.cs','RunnerHost.cs','ServiceInstall.cs') | ForEach-Object { Join-Path $PSScriptRoot $_ }
    Add-Type -Path (Join-Path $PSScriptRoot 'TestConsole.cs')
    & $compiler /nologo /warnaserror /target:exe /platform:x64 /r:System.ServiceProcess.dll /r:System.Web.Extensions.dll "/out:$(Join-Path $root 'ProductionHost.exe')" @sources
    Assert ($LASTEXITCODE -eq 0) 'Production host compile failed'
    & $compiler /nologo /warnaserror /define:RUNNER_FIXTURE /target:exe /platform:x64 /r:System.ServiceProcess.dll /r:System.Web.Extensions.dll "/out:$exe" @sources
    Assert ($LASTEXITCODE -eq 0) 'Fixture host compile failed'
    $controller=Join-Path $root 'FixtureConsole.exe'
    & $compiler /nologo /warnaserror /target:exe /platform:x64 "/out:$controller" (Join-Path $PSScriptRoot 'TestConsole.cs')
    Assert ($LASTEXITCODE -eq 0) 'Disposable console controller compile failed'
    $null=New-Item -ItemType Directory -Path (Join-Path $root 'data')
    Set-Acl -LiteralPath (Join-Path $root 'data') -AclObject $acl
    $ownerProfile=[Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath ("Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\"+$identity.User.Value)).ProfileImagePath)
    [IO.File]::WriteAllText((Join-Path $root 'runner.json'),([ordered]@{version=1;ownerSid=$identity.User.Value;ownerAccount=$identity.Name;ownerProfile=$ownerProfile;nodeExe=(Join-Path $env:SystemRoot 'System32\cmd.exe')} | ConvertTo-Json -Compress))
    $before=@(Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object { $_.FullName+':'+(Get-FileHash -LiteralPath $_.FullName).Hash })
    $status=& $exe --status | ConvertFrom-Json
    Assert ($LASTEXITCODE -eq 0 -and -not $status.running -and -not $status.ready) 'Stopped status dishonest'
    $after=@(Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object { $_.FullName+':'+(Get-FileHash -LiteralPath $_.FullName).Hash })
    Assert (($before -join "`n") -eq ($after -join "`n")) 'Read-only status mutated files'
    Write-Output 'PASS production/fixture compilation; read-only stopped status has no file mutations'
    $token=& $exe --fixture-token
    Assert ($LASTEXITCODE -eq 0 -and $token -eq 'restricted-medium-nonadmin') 'Native restricted token or privilege ABI failed'
    $disabled=Join-Path $root 'disabled.fixture'
    [IO.File]::WriteAllText($disabled,'fixture opt-out')
    $process=Get-Process -Id ([SquiresRunnerTestConsole]::Start($exe))
    $owned=@($process.Id)
    Await {
        $idle=& $exe --status | ConvertFrom-Json
        $idle.running -and $idle.state -eq 'idle-enrollment-disabled'
    } 'Disabled host did not become idle'
    $idle=& $exe --status | ConvertFrom-Json
    Assert (-not $idle.enabled -and -not $idle.ready -and -not (Test-Path -LiteralPath (Join-Path $root 'child.txt'))) 'Disabled host dispatched or advertised readiness'
    $null=& $exe --stop
    Assert ($LASTEXITCODE -eq 0) 'Idle authenticated stop failed'
    Assert-TreeGone
    Remove-Item -LiteralPath $disabled
    Write-Output 'PASS native restricted medium/non-admin token; disabled host stays idle without child or readiness'
    Start-Fixture
    Await {
        $status=& $exe --status | ConvertFrom-Json
        $status.running -and $status.ready
    } 'Fixture did not become ready before opt-out'
    [IO.File]::WriteAllText($disabled,'fixture opt-out while running')
    $revoked=& $exe --status | ConvertFrom-Json
    Assert ($LASTEXITCODE -eq 0 -and -not $revoked.ready) 'Revoked opt-in still advertised readiness'
    Assert-TreeGone
    Remove-Item -LiteralPath $disabled
    Write-Output 'PASS live opt-out immediately removes readiness and stops the complete managed tree'
    Start-Fixture
    Await {
        $status=& $exe --status | ConvertFrom-Json
        $LASTEXITCODE -eq 0 -and $status.running -and $status.ready -and $status.host -eq 'console'
    } 'Running status failed'
    $environment=Get-Content -LiteralPath (Join-Path $root 'environment.json') -Raw | ConvertFrom-Json
    Assert ($environment.profile -eq $ownerProfile -and $environment.drive -eq $env:SystemDrive -and -not $environment.inheritedUnsafe -and $environment.path -match 'WindowsPowerShell\\v1.0') 'Clean owner environment failed'
    $duplicate=Start-Process -FilePath $exe -ArgumentList '--console repair' -PassThru -Wait -WindowStyle Hidden
    Assert ($duplicate.ExitCode -ne 0) 'Duplicate host admitted'
    Start-Sleep -Seconds 16
    $stale=& $exe --status | ConvertFrom-Json
    Assert ($stale.running -and -not $stale.ready) 'Readiness survived its 15-second freshness bound'
    $null=& $exe --stop
    Assert ($LASTEXITCODE -eq 0) 'Authenticated stop failed'
    Assert-TreeGone
    Write-Output 'PASS duplicate-host guard; authenticated local stop; real child and grandchild terminated'
    Write-Output 'PASS clean owner environment and Windows PowerShell PATH; readiness expires after 15 seconds'
    Start-Fixture
    Stop-Process -Id $process.Id
    Assert-TreeGone
    Write-Output 'PASS abrupt host termination closes Job Object and kills real descendant tree'
    Start-Fixture
    & $controller break $process.Id
    Assert ($LASTEXITCODE -eq 0) 'Actual native console CTRL_BREAK dispatch failed'
    Assert-TreeGone
    Write-Output 'PASS actual Windows CTRL_BREAK event; host and descendant tree terminated'
    Start-Fixture
    $window=[long](Get-Content -LiteralPath (Join-Path $root 'window.txt'))
    Assert ($window -ne 0) 'A real console window is unavailable; window-close acceptance is blocked'
    Assert ($window -ne [SquiresRunnerTestConsole]::GetConsoleWindow().ToInt64()) 'Refusing to signal the test parent console'
    $signals=Join-Path $root 'signals.txt'
    if (Test-Path -LiteralPath $signals) { Remove-Item -LiteralPath $signals }
    if ([SquiresRunnerTestConsole]::IsWindowVisible([IntPtr]$window)) {
        Assert ([SquiresRunnerTestConsole]::PostMessage([IntPtr]$window,0x112,[IntPtr]0xF060,[IntPtr]::Zero)) 'SC_CLOSE could not be delivered'
        Start-Sleep -Seconds 2
    }
    if (Test-Path -LiteralPath $signals) {
        Assert-TreeGone
        Write-Output 'PASS real visible console system-menu Close; host, child and grandchild terminated'
    } else {
        $null=& $exe --fixture-close
        Assert ($LASTEXITCODE -eq 0) 'Noninteractive close-handler fixture dispatch failed'
        Assert-TreeGone
        Write-Output 'PASS close-handler with real descendant tree; LIMIT: this desktop does not deliver window Close, interactive acceptance remains parent-owned'
    }
    $process=Start-Process -FilePath $exe -ArgumentList 'fixture-grandchild' -PassThru -WindowStyle Hidden
    $owned=@($process.Id)
    $unresponsive=& $exe --status | ConvertFrom-Json
    Assert ($unresponsive.running -and -not $unresponsive.ready -and $unresponsive.state -eq 'host-unresponsive-owner-review') 'Missing IPC was mistaken for a stopped executable'
    $null=& $exe --stop
    Assert ($LASTEXITCODE -ne 0 -and -not $process.HasExited) 'An unresponsive/unmanaged executable was killed without authenticated identity'
    Stop-Process -Id $process.Id
    Assert-TreeGone
    Write-Output 'PASS missing IPC reports running/unresponsive, not stopped; unauthenticated stop never kills it'
    $log=Get-Content -LiteralPath (Join-Path $root 'data\runner.log') -Raw
    Assert ($log -notmatch 'credential|Authorization|fixture-child|fixture-grandchild') 'Raw child data leaked into logs'
    $installPlan=& (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File (Join-Path $PSScriptRoot 'Install.ps1')
    Assert ($LASTEXITCODE -eq 0 -and $installPlan -match 'PLAN ONLY:') 'Default installer was not a pure plan'
    # The service plan API is pure: no service creation, rights changes or credential prompts.
    $planScript=Join-Path $root 'plan.ps1'
    [IO.File]::WriteAllText($planScript,("[void][Reflection.Assembly]::LoadFrom('"+(Join-Path $root 'ProductionHost.exe')+"'); [Squires.WindowsRunner.ServiceInstall]::Plan('C:\Program Files\Squires\FixerrorsRunner','"+$identity.Name+"')"))
    $plan=& (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $planScript
    Assert ($LASTEXITCODE -eq 0 -and $plan -match 'start=Manual; recovery=None' -and $plan -match 'child=restricted-medium') 'Service configuration dry-run failed'
    foreach ($script in @('Install.ps1','Manager.ps1','Test-Runner.ps1')) {
        $errors=$null; $tokens=$null
        $parsed=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $script),[ref]$tokens,[ref]$errors)
        Assert ($errors.Count -eq 0) "PowerShell parse failed: $script"
        if ($script -eq 'Install.ps1') {
            $functions=@($parsed.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] })
            Assert (@($functions | Where-Object { $_.Name -in @('Assert-Ordinary','Assert-PackageAcl','Set-PackageAcl') }).Count -eq 3) 'Installer helpers must be top-level and callable before mutations'
            foreach ($helper in @($functions | Where-Object { $_.Name -in @('Assert-Ordinary','Assert-PackageAcl') })) {
                . ([scriptblock]::Create($helper.Extent.Text))
            }
            Assert-Ordinary $root
            $rejected=$false
            try { Assert-PackageAcl $root }
            catch { $rejected=$_.Exception.Message -eq 'Existing package ownership/ACL drift; investigate, do not overwrite' }
            Assert $rejected 'Installer did not reject user-owned package without mutation'
        }
    }
    Write-Output 'PASS fixed safe lifecycle logs; pure manual-service plan; PowerShell syntax'
} finally {
    $env:SystemDrive=$oldSystemDrive
    $env:NODE_OPTIONS=$oldNodeOptions
    # Only exact disposable process IDs created by this fixture are eligible for cleanup.
    foreach ($id in $owned) {
        $p=Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($p -and $p.Path -eq $exe) {
            try { Stop-Process -Id $id -ErrorAction Stop }
            catch { if (Get-Process -Id $id -ErrorAction SilentlyContinue) { throw } }
        }
    }
    if ($root -match '\\SquiresRunnerFixture-[0-9a-f-]{36}$' -and (Test-Path -LiteralPath $root)) { Remove-Item -LiteralPath $root -Recurse -Force }
}
