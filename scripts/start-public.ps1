[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'win-common.ps1')
Set-Location -LiteralPath $WinCommon.ProjectDir

Initialize-RunContext

$tunnelProcess = $null
$exitCode = 1
try {
    $cloudflaredPath = Get-CommandPath 'cloudflared'
    if (-not $cloudflaredPath) {
        throw 'cloudflared is missing. Configure the public tunnel first.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $WinCommon.ProjectDir 'deploy/cloudflared.yml'))) {
        throw 'Missing deploy/cloudflared.yml. Copy the example and set the tunnel UUID and hostname.'
    }

    $tunnelLog = Join-Path $WinCommon.RunLogDir 'named-tunnel.log'
    $tunnelProcess = Start-LoggedProcess -FilePath $cloudflaredPath -Arguments @('tunnel', '--config', 'deploy/cloudflared.yml', 'run') -LogPath $tunnelLog

    & (Join-Path $PSScriptRoot 'start-local.ps1')
    $exitCode = $LASTEXITCODE
} catch {
    Write-Log ERROR $_.Exception.Message
    $exitCode = 1
} finally {
    Stop-TrackedProcess $tunnelProcess
    Close-WinCommon
}

exit $exitCode
