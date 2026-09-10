[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'win-common.ps1')
Set-Location -LiteralPath $WinCommon.ProjectDir

Initialize-RunContext

$gatewayProcess = $null
$tunnelProcess = $null
$exitCode = 1

function Get-QuickTunnelOrigin {
    param([Parameter(Mandatory)][string]$Path)
    $text = Get-LogText -Path $Path
    if (-not $text) { return $null }
    foreach ($match in [regex]::Matches($text, 'https://[a-z0-9-]+\.trycloudflare\.com')) {
        if ($match.Value -ne 'https://api.trycloudflare.com') { return $match.Value }
    }
    return $null
}

function Show-TunnelFailureHint {
    param([Parameter(Mandatory)][string]$Path)
    if (Test-LogPattern -Path $Path -Pattern 'api\.trycloudflare\.com.*connection reset by peer|connection reset by peer') {
        Write-Log ERROR 'Quick Tunnel creation failed: the connection to api.trycloudflare.com:443 was reset.'
        Write-Log HINT 'Try a phone hotspot, then run this script again.'
    }
}

try {
    $cloudflaredPath = Get-CommandPath 'cloudflared'
    if (-not $cloudflaredPath) {
        throw 'cloudflared is missing.'
    }

    Import-DotEnv (Join-Path $WinCommon.ProjectDir '.env')
    $gamePort = Get-EnvInt -Name 'PORT' -Default 3000
    $gatewayPort = Get-EnvInt -Name 'PUBLIC_GATEWAY_PORT' -Default 3100

    $gatewayLog = Join-Path $WinCommon.RunLogDir 'player-gateway.log'
    $tunnelLog = Join-Path $WinCommon.RunLogDir 'quick-tunnel.log'
    New-Item -ItemType Directory -Force -Path (Join-Path $WinCommon.ProjectDir 'runtime') | Out-Null

    $nodePath = Get-CommandPath 'node'
    if (-not $nodePath) { throw 'Missing command: node' }
    $env:PORT = "$gamePort"
    $env:PUBLIC_GATEWAY_PORT = "$gatewayPort"
    $gatewayProcess = Start-LoggedProcess -FilePath $nodePath -Arguments @('scripts/player-gateway.mjs') -LogPath $gatewayLog

    $gatewayReady = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-LogPattern -Path $gatewayLog -Pattern '^\[INFO\] Player gateway listening on ') {
            $gatewayReady = $true
            break
        }
        if (-not (Test-ProcessRunning $gatewayProcess.Id)) {
            Write-Log ERROR 'Player gateway failed to start.'
            Show-LogTail -Path $gatewayLog -Lines 40
            throw 'Player gateway failed to start.'
        }
        Start-Sleep -Milliseconds 100
    }
    if (-not $gatewayReady) {
        Write-Log ERROR 'Player gateway did not become ready within 3 seconds.'
        Show-LogTail -Path $gatewayLog -Lines 40
        throw 'Player gateway did not become ready within 3 seconds.'
    }

    $tunnelProcess = Start-LoggedProcess -FilePath $cloudflaredPath -Arguments @(
        'tunnel',
        '--no-autoupdate',
        '--edge-ip-version', '4',
        '--protocol', 'http2',
        '--url', "http://127.0.0.1:$gatewayPort"
    ) -LogPath $tunnelLog

    $publicOrigin = ''
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        $publicOrigin = Get-QuickTunnelOrigin -Path $tunnelLog
        if ($publicOrigin) { break }
        if (-not (Test-ProcessRunning $tunnelProcess.Id)) {
            Write-Log ERROR 'Quick Tunnel failed to start.'
            Show-TunnelFailureHint -Path $tunnelLog
            Show-LogTail -Path $tunnelLog -Lines 120
            throw 'Quick Tunnel failed to start.'
        }
        Start-Sleep -Milliseconds 250
    }

    if (-not $publicOrigin) {
        Write-Log ERROR 'No Quick Tunnel URL appeared within 20 seconds.'
        Show-TunnelFailureHint -Path $tunnelLog
        Show-LogTail -Path $tunnelLog -Lines 80
        throw 'No Quick Tunnel URL appeared within 20 seconds.'
    }

    Write-Log INFO "Temporary public URL: $publicOrigin"
    Write-Log WARN 'This URL is for rehearsal only and changes on every run.'
    $env:PUBLIC_ORIGIN = $publicOrigin
    $env:PUBLIC_HEALTHCHECK = 'true'
    $env:KEEP_SERVER_AFTER_GODOT = 'true'
    & (Join-Path $PSScriptRoot 'start-local.ps1')
    $exitCode = $LASTEXITCODE
} catch {
    Write-Log ERROR $_.Exception.Message
    $exitCode = 1
} finally {
    Stop-TrackedProcess $tunnelProcess
    Stop-TrackedProcess $gatewayProcess
    Close-WinCommon
}

exit $exitCode
