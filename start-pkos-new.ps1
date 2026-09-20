param([string]$Root, [int]$Port = 8791)
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runDir = Join-Path $env:LOCALAPPDATA 'PKOS_NEW'
if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = Join-Path $runDir '시험 기록'
  Write-Host "시험 기록 폴더를 엽니다: $Root"
  Write-Host '실제 기록은 -Root에 전체 경로를 넣어 연결하세요.'
}
$resolvedRoot = [System.IO.Path]::GetFullPath($Root)
$stateDir = Join-Path $runDir 'runtime'
$stateFile = Join-Path $stateDir 'state.json'
New-Item -ItemType Directory -Path $resolvedRoot,$stateDir -Force | Out-Null
$pythonCandidates = @(
  (Get-Command python -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
  (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python314\python.exe'),
  'C:\Python314\python.exe'
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
if (-not $pythonCandidates) { throw 'Python을 찾지 못했습니다. Python 3.11 이상을 설치한 뒤 다시 실행하세요.' }
$url = "http://127.0.0.1:$Port/?localBridge=1"
Write-Host "PKOS NEW 주소: $url"
Write-Host "연결 폴더: $resolvedRoot"
Set-Location -LiteralPath $projectDir
Start-Process $url
& $pythonCandidates[0] '.\local-service\server.py' --root $resolvedRoot --state $stateFile --port $Port
