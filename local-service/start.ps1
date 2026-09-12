param(
    [string]$RecordRoot = 'G:\내 드라이브\00_개인지식운영체계(PKOS)\02_구글 기록장',
    [switch]$Once
)
$ErrorActionPreference = 'Stop'
$serverPath = Join-Path $PSScriptRoot 'server.py'
$runtimePath = Join-Path $PSScriptRoot 'runtime'
$pythonPath = 'C:\Python314\python.exe'
$mutex = New-Object System.Threading.Mutex($false, 'Local\PKOS-Local-Folder-Service-8788')
$ownsMutex = $false
$lastState = ''
function Write-State([string]$State) {
    if ($State -ne $script:lastState) {
        $script:lastState = $State
        $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $State
        # A Drive file lock must not stop the supervisor.
        for ($attempt = 0; $attempt -lt 3; $attempt++) {
            try {
                [System.IO.File]::AppendAllText((Join-Path $runtimePath 'supervisor.log'), $line + [Environment]::NewLine, [System.Text.Encoding]::UTF8)
                break
            } catch { if ($attempt -lt 2) { Start-Sleep -Milliseconds 200 } }
        }
        if ($Once) { Write-Output $State }
    }
}
try {
    if (-not $Once) {
        try { $ownsMutex = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
        if (-not $ownsMutex) { exit 0 }
    }
    New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
    do {
        try {
            if (-not (Test-Path -LiteralPath $RecordRoot -PathType Container)) {
                Write-State 'Waiting for selected Drive folder'
            } else {
                $running = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object {
                    $_.CommandLine -and $_.CommandLine.Contains($serverPath) -and $_.CommandLine.Contains($RecordRoot)
                })
                if ($running.Count -gt 0) {
                    Write-State ('Running PID ' + $running[0].ProcessId)
                } else {
                    $listener = Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue
                    if ($listener) {
                        Write-State 'Port 8788 belongs to another process; leaving it untouched'
                    } elseif (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
                        Write-State 'Python runtime unavailable'
                    } else {
                        $statePath = Join-Path $runtimePath 'state.json'
                        $arguments = '"' + $serverPath + '" --root "' + $RecordRoot + '" --state "' + $statePath + '"'
                        $started = Start-Process -FilePath $pythonPath -ArgumentList $arguments -WindowStyle Hidden -PassThru `
                            -RedirectStandardError (Join-Path $runtimePath 'error.log') -RedirectStandardOutput (Join-Path $runtimePath 'output.log')
                        Write-State ('Started PID ' + $started.Id)
                    }
                }
            }
        } catch { Write-State ('Check failed: ' + $_.Exception.Message) }
        if (-not $Once) { Start-Sleep -Seconds 10 }
    } while (-not $Once)
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
