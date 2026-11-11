[CmdletBinding()]
param([ValidateSet('Menu','Console','Service','Stop','Status')][string]$Action='Menu',
      [ValidateSet('review','repair','deploy')][string]$Mode='review')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.ServiceProcess
$hostExe=Join-Path $PSScriptRoot 'RunnerHost.exe'
if (-not (Test-Path -LiteralPath $hostExe)) { throw 'Reviewed runner package is not installed. Ask the parent to run Install.ps1 after review.' }
[void][Reflection.Assembly]::LoadFrom($hostExe)
$config=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runner.json') -Raw | ConvertFrom-Json
if ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne $config.ownerSid) { throw 'Run as the enrolled Windows owner' }
if (([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run the manager in standard, non-elevated PowerShell. Only installation needs elevation.' }
function Get-HostStatus {
    $json=& $hostExe --status
    if ($LASTEXITCODE -ne 0) { throw 'Managed host status could not be authenticated' }
    return $json | ConvertFrom-Json
}
function Get-OwnedService {
    if (-not [Squires.WindowsRunner.ServiceInstall]::Validate($PSScriptRoot,$config.ownerAccount)) { return $null }
    return [ServiceProcess.ServiceController]::new('SquiresFixerrorsRunner')
}
function Show-Status {
    $status=Get-HostStatus
    $service=Get-OwnedService
    if ($service) { $service.Refresh(); Write-Host "SCM: $($service.Status); Manual start; no automatic recovery." }
    else { Write-Host 'SCM: not installed.' }
    Write-Host "Managed running: $($status.running); ready for admission: $($status.ready); state: $($status.state)"
    $enrollment=Join-Path $config.ownerProfile '.codex\cursor-worker\squires-companion\enrollment.json'
    if (Test-Path -LiteralPath $enrollment) {
        $public=Get-Content -LiteralPath $enrollment -Raw | ConvertFrom-Json
        foreach ($flag in @('enabled','workerEligible','allowReadOnly','allowBoundedRepair','allowRelease')) {
            $value=$public.$flag
            Write-Host "Protected enrollment $flag=$($value -is [bool] -and $value)"
        }
    } else { Write-Host 'Protected enrollment: unavailable; not ready.' }
    if (Test-Path -LiteralPath 'D:\Websites\avsworklog\.git\squires-fixerrors-companion.lock') {
        Write-Host 'Companion lock present. A stopped/unmanaged or interrupted job needs owner investigation; it is never deleted by this manager.'
    }
    Write-Host 'running-waiting means Connected - waiting for an authorized Debug request; no packet is required to connect.'
    Write-Host 'packet-blocked means retained/uncertain evidence or a tested candidate needs reconciliation or separate Deploy. Readiness is not worker success or Deploy approval.'
}
function Stop-Runner {
    $status=Get-HostStatus
    $service=Get-OwnedService
    if ($status.running -and $status.host -ne 'service') {
        $null=& $hostExe --stop
        if ($LASTEXITCODE -ne 0) { throw 'Authenticated stop request failed; stop not confirmed' }
    }
    if ($service) {
        $service.Refresh()
        if ($service.Status -ne 'Stopped') {
            if ($service.Status -ne 'StopPending') {
                try { $service.Stop() }
                catch [InvalidOperationException] {
                    $service.Refresh()
                    if ($service.Status -notin @('Stopped','StopPending')) { throw }
                }
            }
            $service.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(18))
        }
    }
    $deadline=[DateTime]::UtcNow.AddSeconds(18)
    do {
        $status=Get-HostStatus
        if (-not $status.running) { break }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($status.running) { throw 'Host still running; stop not confirmed' }
    if (Test-Path -LiteralPath 'D:\Websites\avsworklog\.git\squires-fixerrors-companion.lock') {
        throw 'Managed host is stopped, but a companion lock remains: active outcome unknown or unmanaged process. No PID/tree identity proof; not killed and no lock removed. Parent reconciliation required.'
    }
    Write-Host 'STOP CONFIRMED: managed host is gone; its Job Object contains no surviving descendants. No unmanaged processes were killed.'
}
function Start-Runner([bool]$AsService) {
    $status=Get-HostStatus
    if ($status.running) { throw 'Console/service host already running; stop it before switching' }
    if ($AsService) {
        $service=Get-OwnedService
        if (-not $service) { throw 'Manual SCM service is not installed; parent installation is required' }
        $service.Refresh()
        if ($service.Status -ne 'Stopped') { throw 'SCM is not stopped; investigate instead of racing another start' }
        $service.Start([string[]]@($Mode))
        $service.WaitForStatus('Running',[TimeSpan]::FromSeconds(20))
        $deadline=[DateTime]::UtcNow.AddSeconds(5)
        do { $status=Get-HostStatus; if ($status.running -and $status.host -eq 'service') { break }; Start-Sleep -Milliseconds 200 } while ([DateTime]::UtcNow -lt $deadline)
        if (-not $status.running -or $status.host -ne 'service') { throw 'SCM startup did not produce an authenticated service host; not confirmed' }
        Write-Host "SERVICE START CONFIRMED: manual SCM host is running ($($status.state)). Readiness may be blocked; reboot/manual stop ends it. No restart policy."
    } else {
        # This is a real standard PowerShell console, not a detached process called a service.
        $terminal=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $args="-NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File `"$PSCommandPath`" -Action Console -Mode $Mode"
        $process=Start-Process -FilePath $terminal -ArgumentList $args -PassThru
        $deadline=[DateTime]::UtcNow.AddSeconds(18)
        do {
            $status=Get-HostStatus
            if ($status.running -and $status.host -eq 'console') { break }
            if ($process.HasExited) { throw 'Terminal exited before host startup; start not confirmed' }
            Start-Sleep -Milliseconds 200
        } while ([DateTime]::UtcNow -lt $deadline)
        if (-not $status.running -or $status.host -ne 'console') { throw 'Console startup not confirmed' }
        Write-Host "TERMINAL START CONFIRMED: $($status.state). Closing its window stops the complete Job Object tree."
    }
}
function Choose-Mode {
    $selected=Read-Host 'Local runtime permission: Enter/R=review only; P=review + repair; D=review + repair + deploy (requires tested candidate and separate Debug approval)'
    switch ($selected.ToUpperInvariant()) {
        '' { return 'review' }; 'R' { return 'review' }; 'P' { return 'repair' }
        # D selects a runtime capability, not a release. Protected owner consent
        # and exact tested-candidate Debug approval remain authoritative.
        'D' { return 'deploy' }
        default { throw 'Unknown permission selection' }
    }
}
function Set-OwnerConsent {
    $status=Get-HostStatus
    if ($status.running) { throw 'Stop the runner before changing protected owner consent' }
    $selected=Read-Host 'Persistent owner consent: X=disable all; R=review; P=review + bounded repair; D=review + repair + release transport'
    $choice=switch ($selected.ToUpperInvariant()) {
        'X' { 'disabled' }; 'R' { 'review' }; 'P' { 'repair' }; 'D' { 'deploy' }
        default { throw 'Unknown consent selection; unchanged' }
    }
    Write-Host 'This changes only enabled, workerEligible, allowReadOnly, allowBoundedRepair and allowRelease in existing owner-only enrollment.'
    Write-Host 'It does not provision credentials, change keys/checks/pins, start a job or approve Deploy. Runtime mode still narrows this permission.'
    if ((Read-Host "Type SET $($choice.ToUpperInvariant()) to confirm") -cne "SET $($choice.ToUpperInvariant())") { throw 'Owner consent cancelled; unchanged' }
    [Squires.WindowsRunner.OwnerConsent]::Set($choice)
    Write-Host "OWNER CONSENT CONFIRMED: $choice. Start the chosen runtime separately; Debug authorization remains required."
}
if ($Action -eq 'Console') {
    & $hostExe --console $Mode
    if ($LASTEXITCODE -ne 0) { throw 'Console host stopped with an error; reconcile before restarting' }
    return
}
switch ($Action) {
    'Service' { Start-Runner $true; return }
    'Stop' { Stop-Runner; return }
    'Status' { Show-Status; return }
}
for (;;) {
    Write-Host "`nMPDEE Worker - Squires Windows runner"
    Write-Host '1  Open standard PowerShell terminal (close window to stop)'
    Write-Host '2  Start genuine manual Windows SCM service'
    Write-Host '3  Stop managed terminal/service and descendants'
    Write-Host '4  Read-only status / enabled / running / ready'
    Write-Host 'E  Set explicit protected owner consent (runner must be stopped)'
    Write-Host 'D  Open Squires Debug    L  Show private lifecycle log    Q  Exit menu'
    try {
        switch ((Read-Host 'Choose').ToUpperInvariant()) {
            '1' { $Mode=Choose-Mode; Start-Runner $false }
            '2' { $Mode=Choose-Mode; Start-Runner $true }
            '3' { Stop-Runner }
            '4' { Show-Status }
            'E' { Set-OwnerConsent }
            'D' { Start-Process 'https://www.squiresapp.com/debug' }
            'L' {
                $log=Join-Path $config.ownerProfile '.codex\cursor-worker\squires-runner-manager\runner.log'
                if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 40 } else { Write-Host 'No lifecycle log yet.' }
            }
            'Q' { return }
            default { Write-Host 'Choose 1, 2, 3, 4, E, D, L or Q.' }
        }
    } catch { Write-Host "NOT CONFIRMED: $($_.Exception.Message)" -ForegroundColor Red }
}
