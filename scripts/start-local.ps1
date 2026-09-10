[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'win-common.ps1')
Set-Location -LiteralPath $WinCommon.ProjectDir

function Invoke-Preflight {
    param([Parameter(Mandatory)][int]$Port)
    $failed = $false

    foreach ($commandName in @('node', 'pnpm', 'godot')) {
        $commandPath = Get-CommandPath $commandName
        if ($commandPath) {
            Write-Log OK "$commandName`: $commandPath"
        } else {
            Write-Log ERROR "Missing command: $commandName"
            $failed = $true
        }
    }

    if (Get-CommandPath 'node') {
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

    $envPath = Join-Path $WinCommon.ProjectDir '.env'
    if (-not (Test-Path -LiteralPath $envPath)) {
        Write-Log ERROR 'Missing .env. Run scripts/setup-local.ps1 first.'
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
    if (Get-CommandPath 'cloudflared') {
        Write-Log OK 'cloudflared is installed. Public mode is available.'
    } else {
        Write-Log INFO 'cloudflared is not installed. Local Wi-Fi mode is still available.'
    }

    return (-not $failed)
}

Initialize-RunContext

$publicOriginOverride = $env:PUBLIC_ORIGIN
Import-DotEnv (Join-Path $WinCommon.ProjectDir '.env')
if ($publicOriginOverride) { $env:PUBLIC_ORIGIN = $publicOriginOverride }

$port = Get-EnvInt -Name 'PORT' -Default 3000

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
    New-Item -ItemType Directory -Force -Path (Join-Path $WinCommon.ProjectDir 'runtime') | Out-Null

    $pnpmPath = Get-CommandPath 'pnpm'
    if (-not $pnpmPath) { throw 'Missing command: pnpm' }
    $WinCommon.ServerProcess = Start-TrackedProcess -FilePath $pnpmPath -Arguments @('start')
    $serverProcess = $WinCommon.ServerProcess

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
        $publicCheckLog = Join-Path $WinCommon.RunLogDir 'public-check.log'
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
            Write-Log INFO 'Run the matching diagnose-*-public script for tunnel details.'
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

    $godotPath = Get-CommandPath 'godot'
    if (-not $godotPath) { throw 'Missing command: godot' }
    $WinCommon.GodotProcess = Start-TrackedProcess -FilePath $godotPath -Arguments @('--path', 'apps/godot', '--fullscreen')
    $godotProcess = $WinCommon.GodotProcess

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
    Close-WinCommon
}

exit $exitCode
