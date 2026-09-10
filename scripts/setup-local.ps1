[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'win-common.ps1')
Set-Location -LiteralPath $WinCommon.ProjectDir

Initialize-RunContext

$exitCode = 1
try {
    if (-not (Get-CommandPath 'godot')) {
        throw 'Missing command: godot. Install Godot before running setup.'
    }
    if (-not (Get-CommandPath 'pnpm')) {
        throw 'Missing command: pnpm. Install pnpm before running setup.'
    }

    $envPath = Join-Path $WinCommon.ProjectDir '.env'
    if (Test-Path -LiteralPath $envPath) {
        Write-Log INFO '.env already exists; leaving it unchanged.'
    } else {
        $examplePath = Join-Path $WinCommon.ProjectDir '.env.example'
        if (-not (Test-Path -LiteralPath $examplePath)) {
            throw 'Missing .env.example.'
        }
        $localIp = Get-LocalIpAddress
        $adminToken = New-HexToken -Bytes 24
        $screenToken = New-HexToken -Bytes 24
        $sessionSecret = New-HexToken -Bytes 32
        $origin = "http://${localIp}:3000"
        $lines = Get-Content -LiteralPath $examplePath -Encoding UTF8 | ForEach-Object {
            if ($_ -match '^PUBLIC_ORIGIN=') { "PUBLIC_ORIGIN=$origin" }
            elseif ($_ -match '^LOCAL_ORIGIN=') { "LOCAL_ORIGIN=$origin" }
            elseif ($_ -match '^ADMIN_TOKEN=') { "ADMIN_TOKEN=$adminToken" }
            elseif ($_ -match '^SCREEN_TOKEN=') { "SCREEN_TOKEN=$screenToken" }
            elseif ($_ -match '^SESSION_SECRET=') { "SESSION_SECRET=$sessionSecret" }
            else { $_ }
        }
        Write-Utf8NoBomFile -Path $envPath -Lines $lines
        & icacls.exe $envPath /inheritance:r /grant:r "$($env:USERNAME):(F)" *> $null
        Write-Log INFO "Created .env. Local URL: $origin"
    }

    $installStatus = Invoke-NativeCommand -Command 'pnpm' -Arguments @('install')
    if ($installStatus -ne 0) {
        throw "pnpm install failed with exit code $installStatus."
    }
    $buildStatus = Invoke-NativeCommand -Command 'pnpm' -Arguments @('build')
    if ($buildStatus -ne 0) {
        throw "pnpm build failed with exit code $buildStatus."
    }
    Write-Log INFO 'Importing Godot textures and fonts.'
    $importStatus = Invoke-NativeCommand -Command 'godot' -Arguments @('--headless', '--path', 'apps/godot', '--import')
    if ($importStatus -ne 0) {
        throw "Godot import failed with exit code $importStatus."
    }
    Write-Log INFO 'Setup complete. Run scripts\start-local.cmd to start the local stack.'
    $exitCode = 0
} catch {
    Write-Log ERROR $_.Exception.Message
    $exitCode = 1
} finally {
    Close-WinCommon
}

exit $exitCode
