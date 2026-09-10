$WinCommon = @{
    ProjectDir = (Split-Path -Parent $PSScriptRoot)
    RunId = $null
    RunLogDir = $null
    RunLogPath = $null
    ServerProcess = $null
    GodotProcess = $null
    HealthClient = $null
    HealthUseWebRequest = $false
}

function Initialize-RunContext {
    $runId = if ($env:RUN_ID) { $env:RUN_ID } else { '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $PID }
    $WinCommon.RunId = $runId
    $WinCommon.RunLogDir = if ($env:RUN_LOG_DIR) { $env:RUN_LOG_DIR } else { Join-Path $WinCommon.ProjectDir ('runtime/logs/' + $runId) }
    New-Item -ItemType Directory -Force -Path $WinCommon.RunLogDir | Out-Null
    $env:RUN_ID = $runId
    $env:RUN_LOG_DIR = $WinCommon.RunLogDir
    $WinCommon.RunLogPath = Join-Path $WinCommon.RunLogDir 'run.log'
}

function Write-Log {
    param(
        [Parameter(Mandatory)][string]$Level,
        [Parameter(Mandatory)][string]$Message
    )
    $line = "[$Level] $Message"
    $color = switch ($Level) {
        'INFO' { 'Cyan' }
        'WARN' { 'Yellow' }
        'ERROR' { 'Red' }
        'OK' { 'Green' }
        'HINT' { 'Magenta' }
        default { 'Gray' }
    }
    Write-Host $line -ForegroundColor $color
    if ($WinCommon.RunLogPath) {
        Add-Content -LiteralPath $WinCommon.RunLogPath -Value $line -Encoding UTF8
    }
}

function Add-RunLogLine {
    param([Parameter(Mandatory)][string]$Line)
    Write-Host $Line
    if ($WinCommon.RunLogPath) {
        Add-Content -LiteralPath $WinCommon.RunLogPath -Value $Line -Encoding UTF8
    }
}

function Get-CommandPath {
    param([Parameter(Mandatory)][string]$Name)
    $info = @(Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue)
    if ($info.Count -gt 0) { return $info[0].Source }
    return $null
}

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory)][string]$Command,
        [string[]]$Arguments = @()
    )
    & $Command @Arguments 2>&1 | ForEach-Object {
        $text = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { [string]$_ }
        Add-RunLogLine $text
    }
    return $LASTEXITCODE
}

function Test-ProcessRunning {
    param([int]$ProcessId)
    if (-not $ProcessId) { return $false }
    return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Stop-ProcessTree {
    param([int]$ProcessId)
    if (-not (Test-ProcessRunning $ProcessId)) { return }
    & taskkill.exe /PID $ProcessId /T /F *> $null
}

function Stop-TrackedProcess {
    param($Process)
    if ($Process -and (Test-ProcessRunning $Process.Id)) {
        Stop-ProcessTree $Process.Id
        try { $Process.WaitForExit() } catch { }
    }
}

function Stop-AllTrackedProcesses {
    Stop-TrackedProcess $WinCommon.GodotProcess
    Stop-TrackedProcess $WinCommon.ServerProcess
    $WinCommon.GodotProcess = $null
    $WinCommon.ServerProcess = $null
}

function Start-TrackedProcess {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @()
    )
    $argumentText = ($Arguments | ForEach-Object {
        if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
    }) -join ' '
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.UseShellExecute = $false
    $startInfo.WorkingDirectory = $WinCommon.ProjectDir
    if ([System.IO.Path]::GetExtension($FilePath) -ieq '.exe') {
        $startInfo.FileName = $FilePath
        $startInfo.Arguments = $argumentText
    } else {
        $startInfo.FileName = 'cmd.exe'
        $startInfo.Arguments = '/d /s /c ""' + $FilePath + '" ' + $argumentText + '"'
    }
    return [System.Diagnostics.Process]::Start($startInfo)
}

function Start-LoggedProcess {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @(),
        [Parameter(Mandatory)][string]$LogPath
    )
    $argumentText = ($Arguments | ForEach-Object {
        if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
    }) -join ' '
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = 'cmd.exe'
    $startInfo.Arguments = '/d /s /c ""' + $FilePath + '" ' + $argumentText + ' > "' + $LogPath + '" 2>&1"'
    $startInfo.UseShellExecute = $false
    $startInfo.WorkingDirectory = $WinCommon.ProjectDir
    return [System.Diagnostics.Process]::Start($startInfo)
}

function Initialize-HealthClient {
    if ($WinCommon.HealthClient -or $WinCommon.HealthUseWebRequest) { return }
    try {
        Add-Type -AssemblyName System.Net.Http -ErrorAction Stop
        $handler = New-Object System.Net.Http.HttpClientHandler
        $handler.UseProxy = $false
        $client = New-Object System.Net.Http.HttpClient -ArgumentList $handler
        $client.Timeout = [TimeSpan]::FromSeconds(3)
        $WinCommon.HealthClient = $client
    } catch {
        $WinCommon.HealthUseWebRequest = $true
    }
}

function Get-HealthText {
    param([Parameter(Mandatory)][string]$Url)
    Initialize-HealthClient
    if ($WinCommon.HealthUseWebRequest) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            return $response.Content
        } catch {
            return $null
        }
    }
    try {
        $response = $WinCommon.HealthClient.GetAsync($Url).GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) { return $null }
        return $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    } catch {
        return $null
    }
}

function Test-HealthEndpoint {
    param([Parameter(Mandatory)][string]$Url)
    return ($null -ne (Get-HealthText -Url $Url))
}

function Import-DotEnv {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        $trimmed = $line.Trim()
        if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
        $separator = $trimmed.IndexOf('=')
        if ($separator -lt 1) { continue }
        $name = $trimmed.Substring(0, $separator).Trim().TrimStart([char]0xFEFF)
        $value = $trimmed.Substring($separator + 1).Trim()
        if ($value.Length -ge 2) {
            $first = $value[0]
            $last = $value[$value.Length - 1]
            if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

function Get-EnvInt {
    param(
        [Parameter(Mandatory)][string]$Name,
        [int]$Default = 0
    )
    $raw = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ($raw) {
        $parsed = 0
        if ([int]::TryParse($raw.Trim(), [ref]$parsed)) { return $parsed }
    }
    return $Default
}

function Get-LocalIpAddress {
    try {
        $socket = [System.Net.Sockets.Socket]::new(
            [System.Net.Sockets.AddressFamily]::InterNetwork,
            [System.Net.Sockets.SocketType]::Dgram,
            [System.Net.Sockets.ProtocolType]::Udp)
        try {
            $socket.Connect('1.1.1.1', 80)
            return $socket.LocalEndPoint.Address.ToString()
        } finally {
            $socket.Dispose()
        }
    } catch {
        return '127.0.0.1'
    }
}

function Test-PortInUse {
    param([Parameter(Mandatory)][int]$Port)
    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
        return $listeners.Count -gt 0
    }
    $netstat = & netstat.exe -ano 2>$null | Select-String -Pattern ":$Port\s"
    return [bool]$netstat
}

function New-HexToken {
    param([Parameter(Mandatory)][int]$Bytes)
    $buffer = [byte[]]::new($Bytes)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

function Write-Utf8NoBomFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string[]]$Lines
    )
    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllLines($Path, [string[]]$Lines, $encoding)
}

function Get-LogText {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    try {
        return (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop)
    } catch {
        return ''
    }
}

function Test-LogPattern {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Pattern
    )
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    try {
        return [bool](Select-String -LiteralPath $Path -Pattern $Pattern -Quiet -ErrorAction Stop)
    } catch {
        return $false
    }
}

function Get-FirstRegexMatch {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Pattern
    )
    $text = Get-LogText -Path $Path
    if (-not $text) { return $null }
    $match = [regex]::Match($text, $Pattern)
    if ($match.Success) { return $match.Value }
    return $null
}

function Show-LogTail {
    param(
        [Parameter(Mandatory)][string]$Path,
        [int]$Lines = 40
    )
    if (-not (Test-Path -LiteralPath $Path)) { return }
    try {
        Get-Content -LiteralPath $Path -Tail $Lines -ErrorAction Stop | ForEach-Object { Add-RunLogLine $_ }
    } catch { }
}

function Get-LatestLogFile {
    param([Parameter(Mandatory)][string]$Name)
    $root = Join-Path $WinCommon.ProjectDir 'runtime/logs'
    if (-not (Test-Path -LiteralPath $root)) { return $null }
    $files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Filter $Name -ErrorAction SilentlyContinue)
    if ($files.Count -eq 0) { return $null }
    return ($files | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
}

function Get-ServerFailureStatus {
    $status = 1
    if ($WinCommon.ServerProcess) {
        try {
            $WinCommon.ServerProcess.WaitForExit()
            $status = $WinCommon.ServerProcess.ExitCode
        } catch { }
    }
    Write-Log ERROR "Game server exited unexpectedly with status $status."
    $serverLog = Join-Path $WinCommon.RunLogDir 'server.log'
    if (Test-Path -LiteralPath $serverLog) {
        Write-Log ERROR 'Last server log lines:'
        Get-Content -LiteralPath $serverLog -Tail 20 | ForEach-Object { Add-RunLogLine $_ }
    }
    return $status
}

function Close-WinCommon {
    Stop-AllTrackedProcesses
    if ($WinCommon.HealthClient -and $WinCommon.HealthClient -is [System.IDisposable]) {
        try { $WinCommon.HealthClient.Dispose() } catch { }
        $WinCommon.HealthClient = $null
    }
}
