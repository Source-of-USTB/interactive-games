[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'win-common.ps1')
Set-Location -LiteralPath $WinCommon.ProjectDir

Import-DotEnv (Join-Path $WinCommon.ProjectDir '.env')
$port = Get-EnvInt -Name 'PORT' -Default 3000
$gatewayPort = Get-EnvInt -Name 'PUBLIC_GATEWAY_PORT' -Default 3100

Write-Host '== Processes =='
$processRows = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine -match 'ssh.*localhost\.run|node.*dist[\\/]index\.js|node.*player-gateway\.mjs|godot.*apps[\\/]godot'
})
if ($processRows.Count -gt 0) {
    $processRows | ForEach-Object { Write-Host ("{0} {1} {2}" -f $_.ProcessId, $_.Name, $_.CommandLine) }
} else {
    Write-Host 'No localhost.run tunnel, game server, or Godot process found.'
}

Write-Host ''
Write-Host '== Player gateway =='
$gatewayText = Get-HealthText "http://127.0.0.1:$gatewayPort/api/health"
if ($gatewayText) {
    Write-Host $gatewayText
    Write-Host 'Player gateway is reachable.'
} else {
    Write-Host 'Player gateway is not reachable.'
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
Write-Host '== localhost.run logs =='
$tunnelLog = Get-LatestLogFile -Name 'localhost-run.log'
if ($tunnelLog) {
    $publicOrigin = Get-FirstRegexMatch -Path $tunnelLog.FullName -Pattern 'https://[A-Za-z0-9][A-Za-z0-9.-]*\.lhr\.life'
    if ($publicOrigin) {
        Write-Host "Latest URL: $publicOrigin"
    } elseif (Test-LogPattern -Path $tunnelLog.FullName -Pattern 'connection timed out|operation timed out|connection refused|connection reset') {
        Write-Host 'Status: the SSH connection to localhost.run:22 was blocked or reset.'
        Write-Host 'Hint: try a phone hotspot, then run this script again.'
    } else {
        Write-Host 'No valid public URL was found in the log.'
    }
    Write-Host "Log file: $($tunnelLog.FullName)"
    Show-LogTail -Path $tunnelLog.FullName -Lines 100
} else {
    Write-Host 'No localhost.run log found. The Easy Public script may not have run yet.'
}

Close-WinCommon
