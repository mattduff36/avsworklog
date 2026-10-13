$ErrorActionPreference = 'Stop'
$previewRoot = $PSScriptRoot
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $previewRoot '../..'))
$nextExecutable = Join-Path $repositoryRoot 'node_modules/next/dist/bin/next'
if (-not (Test-Path -LiteralPath $nextExecutable)) { throw 'Install the app dependencies before starting the preview.' }
$previewPublic = Join-Path $previewRoot 'public'
New-Item -ItemType Directory -Force -Path $previewPublic | Out-Null
foreach ($asset in @('pdf.min.mjs', 'pdf.worker.min.mjs')) {
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "public/$asset") -Destination (Join-Path $previewPublic $asset) -Force
}
Set-Location -LiteralPath $previewRoot
Write-Host 'External Documents LOCAL PREVIEW — sample assets; browser-local files.'
Write-Host 'Open http://127.0.0.1:4001 when Ready appears. Keep this window open.'
& node $nextExecutable dev --hostname 127.0.0.1 --port 4001
