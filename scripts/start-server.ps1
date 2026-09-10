[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'win-common.ps1')
Set-Location -LiteralPath $WinCommon.ProjectDir

Initialize-RunContext

$exitCode = 1
try {
    if (-not (Test-Path -LiteralPath (Join-Path $WinCommon.ProjectDir '.env'))) {
        throw 'Missing .env. Run scripts/setup-local.ps1 first.'
    }
    Import-DotEnv (Join-Path $WinCommon.ProjectDir '.env')

    if ($env:SKIP_BUILD -ne 'true') {
        $buildStatus = Invoke-NativeCommand -Command 'pnpm' -Arguments @('build')
        if ($buildStatus -ne 0) {
            throw "pnpm build failed with exit code $buildStatus."
        }
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $WinCommon.ProjectDir 'runtime') | Out-Null

    $pnpmPath = Get-CommandPath 'pnpm'
    if (-not $pnpmPath) { throw 'Missing command: pnpm' }
    & $pnpmPath start
    $exitCode = $LASTEXITCODE
} catch {
    Write-Log ERROR $_.Exception.Message
    $exitCode = 1
} finally {
    Close-WinCommon
}

exit $exitCode
