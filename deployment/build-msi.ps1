[CmdletBinding()]
param(
    [switch]$SkipNpmCi
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $PSScriptRoot "config.local.env"

function Read-DeploymentConfig {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "deployment/config.local.env não existe. Crie-o antes de gerar o MSI corporativo."
    }

    $values = @{}
    foreach ($rawLine in Get-Content -LiteralPath $Path -Encoding UTF8) {
        $line = $rawLine.Trim().TrimStart([char]0xFEFF)
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) {
            continue
        }

        $separator = $line.IndexOf("=")
        if ($separator -lt 1) {
            throw "deployment/config.local.env contém uma linha inválida."
        }

        $key = $line.Substring(0, $separator).Trim()
        $value = $line.Substring($separator + 1).Trim()
        if ($value.Length -ge 2) {
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }

        $values[$key] = $value
    }

    return $values
}

function Assert-DeploymentConfig {
    param([hashtable]$Values)

    $enabled = [string]$Values["REMOTE_SESSION_ENABLED"]
    if ($enabled.ToLowerInvariant() -notin @("true", "1", "yes", "on")) {
        throw "REMOTE_SESSION_ENABLED deve estar habilitado para o MSI corporativo."
    }

    foreach ($key in @(
        "REMOTE_SESSION_SERVER",
        "REMOTE_SESSION_EXPECTED_DOMAIN",
        "REMOTE_SESSION_EXECUTABLE"
    )) {
        if (-not $Values.ContainsKey($key) -or [string]::IsNullOrWhiteSpace([string]$Values[$key])) {
            throw "$key não foi preenchido em deployment/config.local.env."
        }
    }

    foreach ($key in @("REMOTE_SESSION_SERVER", "REMOTE_SESSION_EXPECTED_DOMAIN")) {
        if ([string]$Values[$key] -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$') {
            throw "$key contém caracteres inválidos."
        }
    }

    if ([string]$Values["REMOTE_SESSION_EXECUTABLE"] -notmatch '^[A-Za-z0-9._-]+\.exe$' -or
        [string]$Values["REMOTE_SESSION_EXECUTABLE"] -match '\.\.') {
        throw "REMOTE_SESSION_EXECUTABLE deve conter somente o nome do executável .exe, sem caminho."
    }
}

$config = Read-DeploymentConfig -Path $ConfigPath
Assert-DeploymentConfig -Values $config

Push-Location $RepoRoot
try {
    $ignored = git check-ignore -q -- "deployment/config.local.env"
    if ($LASTEXITCODE -ne 0) {
        throw "deployment/config.local.env não está protegido pelo .gitignore. Não prossiga com o build."
    }

    if (-not $SkipNpmCi) {
        & npm ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci falhou." }
    }

    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build falhou." }

    & npm run tauri build
    if ($LASTEXITCODE -ne 0) { throw "npm run tauri build falhou." }

    $MsiDirectory = Join-Path $RepoRoot "src-tauri\target\release\bundle\msi"
    $Msi = Get-ChildItem -LiteralPath $MsiDirectory -Filter *.msi -File |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1

    if (-not $Msi) {
        throw "O build terminou, mas nenhum MSI foi localizado."
    }

    $Hash = Get-FileHash -LiteralPath $Msi.FullName -Algorithm SHA256
    Write-Host "MSI gerado com sucesso: $($Msi.FullName)"
    Write-Host "SHA-256: $($Hash.Hash)"
}
finally {
    Pop-Location
}
