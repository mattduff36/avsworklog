[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('SquiresServiceSecurity-'+[Guid]::NewGuid().ToString())
[void](New-Item -ItemType Directory -Path $fixture)
try {
    $binary=Join-Path $fixture 'ServiceInstall.dll'
    & (Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe') /nologo /warnaserror /target:library /r:System.ServiceProcess.dll "/out:$binary" (Join-Path $PSScriptRoot 'ServiceInstall.cs')
    if($LASTEXITCODE -ne 0){throw 'Compilation failed'}
    [void][Reflection.Assembly]::Load([IO.File]::ReadAllBytes($binary))
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $bytes=[Squires.WindowsRunner.ServiceInstall]::OwnerDescriptor($identity.User.Value)
    $sd=[Security.AccessControl.RawSecurityDescriptor]::new($bytes,0)
    if($sd.DiscretionaryAcl.Count -ne 3){throw 'Unexpected trustee count'}
    $owner=@($sd.DiscretionaryAcl | Where-Object {$_.SecurityIdentifier.Value -eq $identity.User.Value})
    if($owner.Count -ne 1 -or $owner[0].AccessMask -ne 0x200BD){throw 'Owner rights must be exactly query/start/stop/interrogate/read-control'}
    if($owner[0].AccessMask -band (0x2 -bor 0x10000 -bor 0x40000 -bor 0x80000)){throw 'Owner may not change configuration/delete/DACL/owner'}
    foreach($trusted in @('S-1-5-18','S-1-5-32-544')) {
        $entry=@($sd.DiscretionaryAcl | Where-Object {$_.SecurityIdentifier.Value -eq $trusted})
        if($entry.Count -ne 1 -or $entry[0].AccessMask -ne 0x10000000){throw 'System/admin rights changed'}
    }
    $local='.\'+$identity.Name.Split('\')[-1]
    if(-not [Squires.WindowsRunner.ServiceInstall]::SameAccount($local,$identity.Name)){throw 'SCM dot account must resolve to same SID'}
    if([Squires.WindowsRunner.ServiceInstall]::SameAccount('NT AUTHORITY\SYSTEM',$identity.Name)){throw 'Different account accepted'}
    Write-Output 'PASS service descriptor native parsing, exact least-privilege owner rights, trusted principals, same/different account identities'
} finally {
    if($fixture -match '\\SquiresServiceSecurity-[0-9a-f-]{36}$' -and (Test-Path -LiteralPath $fixture)){Remove-Item -LiteralPath $fixture -Recurse -Force}
}
