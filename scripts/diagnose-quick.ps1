[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'win-common.ps1')
Set-Location -LiteralPath $WinCommon.ProjectDir

Import-DotEnv (Join-Path $WinCommon.ProjectDir '.env')
$port = Get-EnvInt -Name 'PORT' -Default 3000

function Get-QuickTunnelOrigin {
    param([Parameter(Mandatory)][string]$Path)
    $text = Get-LogText -Path $Path
    if (-not $text) { return $null }
    foreach ($match in [regex]::Matches($text, 'https://[a-z0-9-]+\.trycloudflare\.com')) {
        if ($match.Value -ne 'https://api.trycloudflare.com') { return $match.Value }
    }
    return $null
}

Write-Host '== Processes =='
$processRows = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine -match 'cloudflared.*tunnel|node.*dist[\\/]index\.js|godot.*apps[\\/]godot'
})
if ($processRows.Count -gt 0) {
    $processRows | ForEach-Object { Write-Host ("{0} {1} {2}" -f $_.ProcessId, $_.Name, $_.CommandLine) }
} else {
    Write-Host 'No Quick Tunnel, game server, or Godot process found.'
}

Write-Host ''
Write-Host '== Local server =='
$healthText = Get-HealthText "http://127.0.0.1:$port/api/health"
if ($healthText) {
    Write-Host $healthText
    Write-Host "Local port $port is healthy."
} else {
    Write-Host "Local port $port is not reachable."
}

Write-Host ''
Write-Host '== Quick Tunnel logs =='
$tunnelLog = Get-LatestLogFile -Name 'quick-tunnel.log'
if ($tunnelLog) {
    $publicOrigin = Get-QuickTunnelOrigin -Path $tunnelLog.FullName
    if ($publicOrigin) {
        Write-Host "Latest URL: $publicOrigin"
    } elseif (Test-LogPattern -Path $tunnelLog.FullName -Pattern 'api\.trycloudflare\.com.*connection reset by peer|connection reset by peer') {
        Write-Host 'Status: tunnel request failed; no public URL was created.'
        Write-Host 'Cause: the connection to api.trycloudflare.com:443 was blocked or reset.'
        Write-Host 'Hint: try a phone hotspot, then run scripts\start-quick-public.cmd again.'
    } else {
        Write-Host 'No valid trycloudflare.com URL was found in the log.'
    }
    Write-Host "Log file: $($tunnelLog.FullName)"
    Show-LogTail -Path $tunnelLog.FullName -Lines 80
} else {
    Write-Host 'No Quick Tunnel log found. The Quick script may not have run yet.'
}

Close-WinCommon
