[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'win-common.ps1')
Set-Location -LiteralPath $WinCommon.ProjectDir

Initialize-RunContext

$gatewayProcess = $null
$tunnelProcess = $null
$exitCode = 1

function Show-TunnelFailureHint {
    param([Parameter(Mandatory)][string]$Path)
    if (Test-LogPattern -Path $Path -Pattern 'connection timed out|operation timed out|connection refused|connection reset') {
        Write-Log ERROR 'The SSH connection to localhost.run:22 was blocked or reset.'
        Write-Log HINT 'Try a phone hotspot, then run this script again.'
    } elseif (Test-LogPattern -Path $Path -Pattern 'permission denied') {
        Write-Log ERROR 'localhost.run rejected this anonymous tunnel request.'
    }
}

try {
    if (-not (Get-CommandPath 'ssh')) {
        throw 'OpenSSH client (ssh) is missing.'
    }

    Import-DotEnv (Join-Path $WinCommon.ProjectDir '.env')
    $gamePort = Get-EnvInt -Name 'PORT' -Default 3000
    $gatewayPort = Get-EnvInt -Name 'PUBLIC_GATEWAY_PORT' -Default 3100

    $tunnelLog = Join-Path $WinCommon.RunLogDir 'localhost-run.log'
    $gatewayLog = Join-Path $WinCommon.RunLogDir 'player-gateway.log'
    $knownHosts = Join-Path $WinCommon.ProjectDir 'runtime/ssh-known-hosts'
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

    $sshPath = Get-CommandPath 'ssh'
    $tunnelProcess = Start-LoggedProcess -FilePath $sshPath -Arguments @(
        '-T',
        '-p', '22',
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=15',
        '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=3',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', "UserKnownHostsFile=$knownHosts",
        '-R', "80:127.0.0.1:$gatewayPort",
        'nokey@localhost.run',
        '--', '--output', 'json'
    ) -LogPath $tunnelLog

    $publicOrigin = ''
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        $publicOrigin = Get-FirstRegexMatch -Path $tunnelLog -Pattern 'https://[A-Za-z0-9][A-Za-z0-9.-]*\.lhr\.life'
        if ($publicOrigin) { break }
        if (-not (Test-ProcessRunning $gatewayProcess.Id)) {
            Write-Log ERROR 'Player gateway exited before the tunnel was ready.'
            Show-LogTail -Path $gatewayLog -Lines 40
            throw 'Player gateway exited before the tunnel was ready.'
        }
        if (-not (Test-ProcessRunning $tunnelProcess.Id)) {
            Write-Log ERROR 'localhost.run tunnel failed to start.'
            Show-TunnelFailureHint -Path $tunnelLog
            Show-LogTail -Path $tunnelLog -Lines 100
            throw 'localhost.run tunnel failed to start.'
        }
        Start-Sleep -Milliseconds 250
    }

    if (-not $publicOrigin) {
        Write-Log ERROR 'No localhost.run URL appeared within 30 seconds.'
        Show-TunnelFailureHint -Path $tunnelLog
        Show-LogTail -Path $tunnelLog -Lines 100
        throw 'No localhost.run URL appeared within 30 seconds.'
    }

    Write-Log INFO "Temporary public URL: $publicOrigin"
    Write-Log INFO 'Starting the game and validating HTTP, session, bootstrap, and WebSocket.'
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
