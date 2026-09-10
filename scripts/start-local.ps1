[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectDir

$script:RunLogDir = $null
$script:RunLogPath = $null
$script:ServerProcess = $null
$script:GodotProcess = $null
$script:HealthClient = $null
$script:HealthUseWebRequest = $false

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
    if ($script:RunLogPath) {
        Add-Content -LiteralPath $script:RunLogPath -Value $line -Encoding UTF8
    }
}

function Add-RunLogLine {
    param([Parameter(Mandatory)][string]$Line)
    Write-Host $Line
    if ($script:RunLogPath) {
        Add-Content -LiteralPath $script:RunLogPath -Value $Line -Encoding UTF8
    }
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

function Stop-RunProcesses {
    if ($script:GodotProcess -and (Test-ProcessRunning $script:GodotProcess.Id)) {
        Stop-ProcessTree $script:GodotProcess.Id
        try { $script:GodotProcess.WaitForExit() } catch { }
    }
    if ($script:ServerProcess -and (Test-ProcessRunning $script:ServerProcess.Id)) {
        Stop-ProcessTree $script:ServerProcess.Id
        try { $script:ServerProcess.WaitForExit() } catch { }
    }
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
    $startInfo.WorkingDirectory = $ProjectDir
    if ([System.IO.Path]::GetExtension($FilePath) -ieq '.exe') {
        $startInfo.FileName = $FilePath
        $startInfo.Arguments = $argumentText
    } else {
        $startInfo.FileName = 'cmd.exe'
        $startInfo.Arguments = '/d /s /c ""' + $FilePath + '" ' + $argumentText + '"'
    }
    return [System.Diagnostics.Process]::Start($startInfo)
}

function Test-HealthEndpoint {
    param([Parameter(Mandatory)][string]$Url)
    if (-not $script:HealthClient -and -not $script:HealthUseWebRequest) {
        try {
            Add-Type -AssemblyName System.Net.Http -ErrorAction Stop
            $handler = New-Object System.Net.Http.HttpClientHandler
            $handler.UseProxy = $false
            $client = New-Object System.Net.Http.HttpClient -ArgumentList $handler
            $client.Timeout = [TimeSpan]::FromSeconds(3)
            $script:HealthClient = $client
        } catch {
            $script:HealthUseWebRequest = $true
        }
    }
    if ($script:HealthUseWebRequest) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
            return $response.StatusCode -eq 200
        } catch {
            return $false
        }
    }
    try {
        $response = $script:HealthClient.GetAsync($Url).GetAwaiter().GetResult()
        return $response.IsSuccessStatusCode
    } catch {
        return $false
    }
}

function Import-DotEnv {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
        $separator = $trimmed.IndexOf('=')
        if ($separator -lt 1) { continue }
        $name = $trimmed.Substring(0, $separator).Trim()
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

function Get-ServerFailureStatus {
    $status = 1
    if ($script:ServerProcess) {
        try {
            $script:ServerProcess.WaitForExit()
            $status = $script:ServerProcess.ExitCode
        } catch { }
    }
    Write-Log ERROR "Game server exited unexpectedly with status $status."
    $serverLog = Join-Path $script:RunLogDir 'server.log'
    if (Test-Path -LiteralPath $serverLog) {
        Write-Log ERROR 'Last server log lines:'
        Get-Content -LiteralPath $serverLog -Tail 20 | ForEach-Object { Add-RunLogLine $_ }
    }
    return $status
}

function Invoke-Preflight {
    param([Parameter(Mandatory)][int]$Port)
    $failed = $false

    foreach ($commandName in @('node', 'pnpm', 'godot')) {
        $commandInfo = Get-Command $commandName -CommandType Application -ErrorAction SilentlyContinue
        if ($commandInfo) {
            Write-Log OK "$commandName`: $($commandInfo.Source)"
        } else {
            Write-Log ERROR "Missing command: $commandName"
            $failed = $true
        }
    }

    $nodeInfo = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
    if ($nodeInfo) {
        $nodeMajor = 0
        try { $nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]') } catch { $nodeMajor = 0 }
        if ($nodeMajor -lt 24) {
            Write-Log ERROR 'Node.js 24 or newer is required.'
            $failed = $true
        } else {
            $nodeVersion = ((& node --version) -join '').Trim()
            Write-Log OK "Node.js $nodeVersion"
        }
    }

    $envPath = Join-Path $ProjectDir '.env'
    if (-not (Test-Path -LiteralPath $envPath)) {
        Write-Log ERROR 'Missing .env. Run scripts/setup-local.sh first.'
        $failed = $true
    } else {
        Write-Log OK '.env is present.'
        if (Select-String -LiteralPath $envPath -Pattern 'change-this|development-' -Quiet) {
            Write-Log ERROR '.env still contains development credentials.'
            $failed = $true
        } else {
            Write-Log OK 'Runtime credentials are configured.'
        }
    }

    if (Test-PortInUse -Port $Port) {
        Write-Log ERROR "Port $Port is already in use."
        $failed = $true
    } else {
        Write-Log OK "Port $Port is available."
    }

    if ((Test-Path -LiteralPath 'apps/web/dist') -and (Test-Path -LiteralPath 'packages/game-core/dist/index.js') -and (Test-Path -LiteralPath 'apps/server/dist/index.js')) {
        Write-Log OK 'Production build is present.'
    } else {
        Write-Log WARN 'Production build is missing. The start script will build it.'
    }

    $localIp = Get-LocalIpAddress
    Write-Log INFO "Detected local URL: http://${localIp}:$Port"
    if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
        Write-Log OK 'cloudflared is installed. Public mode is available.'
    } else {
        Write-Log INFO 'cloudflared is not installed. Local Wi-Fi mode is still available.'
    }

    return (-not $failed)
}

$runId = if ($env:RUN_ID) { $env:RUN_ID } else { '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $PID }
$script:RunLogDir = if ($env:RUN_LOG_DIR) { $env:RUN_LOG_DIR } else { Join-Path $ProjectDir ('runtime/logs/' + $runId) }
New-Item -ItemType Directory -Force -Path $script:RunLogDir | Out-Null
$env:RUN_ID = $runId
$env:RUN_LOG_DIR = $script:RunLogDir
$script:RunLogPath = Join-Path $script:RunLogDir 'run.log'

$publicOriginOverride = $env:PUBLIC_ORIGIN
Import-DotEnv (Join-Path $ProjectDir '.env')
if ($publicOriginOverride) { $env:PUBLIC_ORIGIN = $publicOriginOverride }

$port = 3000
if ($env:PORT) {
    $parsedPort = 0
    if ([int]::TryParse($env:PORT.Trim(), [ref]$parsedPort)) { $port = $parsedPort }
}

$exitCode = 1
try {
    if (-not (Invoke-Preflight -Port $port)) {
        throw 'Preflight checks failed.'
    }

    if ($env:SKIP_BUILD -ne 'true') {
        $buildStatus = Invoke-NativeCommand -Command 'pnpm' -Arguments @('build')
        if ($buildStatus -ne 0) {
            throw "pnpm build failed with exit code $buildStatus."
        }
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $ProjectDir 'runtime') | Out-Null

    $pnpmInfo = Get-Command pnpm -CommandType Application -ErrorAction SilentlyContinue
    if (-not $pnpmInfo) { throw 'Missing command: pnpm' }
    $script:ServerProcess = Start-TrackedProcess -FilePath $pnpmInfo.Source -Arguments @('start')
    $serverProcess = $script:ServerProcess

    if (-not (Test-ProcessRunning $serverProcess.Id)) {
        $null = Get-ServerFailureStatus
        throw 'Game server exited unexpectedly.'
    }

    $healthUrl = "http://127.0.0.1:$port/api/health"
    $serverReady = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (Test-HealthEndpoint $healthUrl) { $serverReady = $true; break }
        if (-not (Test-ProcessRunning $serverProcess.Id)) {
            $null = Get-ServerFailureStatus
            throw 'Game server exited unexpectedly.'
        }
        Start-Sleep -Milliseconds 250
    }

    if (-not $serverReady) {
        if (-not (Test-ProcessRunning $serverProcess.Id)) {
            $null = Get-ServerFailureStatus
        } else {
            Write-Log ERROR 'Game server did not become ready within 10 seconds.'
        }
        throw 'Game server failed to start.'
    }

    if ($env:PUBLIC_HEALTHCHECK -eq 'true') {
        $publicCheckOrigin = if ($env:PUBLIC_HEALTHCHECK_ORIGIN) { $env:PUBLIC_HEALTHCHECK_ORIGIN } else { $env:PUBLIC_ORIGIN }
        Write-Log INFO "Checking player path: $publicCheckOrigin"
        if ($publicCheckOrigin -ne $env:PUBLIC_ORIGIN) {
            Write-Log WARN "Public URL is not checked from this computer. Verify it from a phone: $($env:PUBLIC_ORIGIN)"
        }
        $publicCheckLog = Join-Path $script:RunLogDir 'public-check.log'
        $publicReady = $false
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            & node --use-env-proxy scripts/check-public.mjs $publicCheckOrigin *> $publicCheckLog
            if ($LASTEXITCODE -eq 0) { $publicReady = $true; break }
            Start-Sleep -Seconds 1
        }

        if (-not $publicReady) {
            Write-Log ERROR 'Player path validation failed. The QR code will not be shown.'
            Write-Log ERROR 'Check result:'
            if (Test-Path -LiteralPath $publicCheckLog) {
                Get-Content -LiteralPath $publicCheckLog -Tail 20 | ForEach-Object { Add-RunLogLine $_ }
            }
            Write-Log INFO 'Run the matching diagnose-*-public.sh script for tunnel details.'
            throw 'Public player path validation failed.'
        }
        if ($publicCheckOrigin -eq $env:PUBLIC_ORIGIN) {
            Write-Log INFO 'Public player path is ready: HTTP + session + bootstrap + WebSocket.'
        } else {
            Write-Log INFO 'Local player gateway is ready: HTTP + session + bootstrap + WebSocket.'
        }
    }

    $env:GAME_SERVER_WS = "ws://127.0.0.1:$port/ws"
    Write-Log INFO "Admin: http://127.0.0.1:$port/admin"
    Write-Log INFO 'Importing Godot textures and fonts.'
    $importStatus = Invoke-NativeCommand -Command 'godot' -Arguments @('--headless', '--path', 'apps/godot', '--import')
    if ($importStatus -ne 0) {
        throw "Godot import failed with exit code $importStatus."
    }
    Write-Log INFO 'Starting Godot display. Press F11 for fullscreen.'

    $godotInfo = Get-Command godot -CommandType Application -ErrorAction SilentlyContinue
    if (-not $godotInfo) { throw 'Missing command: godot' }
    $script:GodotProcess = Start-TrackedProcess -FilePath $godotInfo.Source -Arguments @('--path', 'apps/godot', '--fullscreen')
    $godotProcess = $script:GodotProcess

    while (Test-ProcessRunning $godotProcess.Id) {
        if (-not (Test-ProcessRunning $serverProcess.Id)) {
            $null = Get-ServerFailureStatus
            Stop-ProcessTree $godotProcess.Id
            try { $godotProcess.WaitForExit() } catch { }
            throw 'Game server exited unexpectedly.'
        }
        Start-Sleep -Milliseconds 250
    }

    try { $godotProcess.WaitForExit() } catch { }
    $godotStatus = 0
    try { $godotStatus = $godotProcess.ExitCode } catch { $godotStatus = 1 }

    if ($env:KEEP_SERVER_AFTER_GODOT -eq 'true') {
        if (-not (Test-ProcessRunning $serverProcess.Id)) {
            $null = Get-ServerFailureStatus
            throw 'Game server exited unexpectedly.'
        }
        Write-Log INFO "Godot exited with status $godotStatus. The game server remains running."
        Write-Log INFO 'Keep this terminal open. Press Ctrl+C to stop the run.'
        while (Test-ProcessRunning $serverProcess.Id) {
            Start-Sleep -Seconds 1
        }
        $null = Get-ServerFailureStatus
        throw 'Game server exited unexpectedly.'
    }

    $exitCode = $godotStatus
} catch {
    Write-Log ERROR $_.Exception.Message
    $exitCode = 1
} finally {
    Stop-RunProcesses
    if ($script:HealthClient -and $script:HealthClient -is [System.IDisposable]) {
        try { $script:HealthClient.Dispose() } catch { }
    }
}

exit $exitCode
