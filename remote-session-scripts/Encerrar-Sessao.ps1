[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Server = "SRV-IBM"
$ExpectedDomain = "ADCONTEC"
$TimeoutMilliseconds = 30000

function Complete-Action {
    param(
        [bool]$Success,
        [string]$Code,
        [string]$Message,
        [Nullable[int]]$SessionId = $null
    )

    $payload = [ordered]@{
        success           = $Success
        code              = $Code
        message           = $Message
        affectedProcesses = $null
        sessionId         = $SessionId
    }

    [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 3))
    if ($Success) { exit 0 }
    exit 1
}

function Get-CurrentUserSessionId {
    $queryOutput = @(& "$env:SystemRoot\System32\quser.exe" $env:USERNAME "/server:$Server" 2>&1)
    if ($LASTEXITCODE -ne 0) {
        Complete-Action $false "session-query-failed" "Não foi possível localizar sua sessão no SRV-IBM. Verifique a conexão de rede ou contate o suporte."
    }

    $sessionIds = @()
    foreach ($rawLine in $queryOutput) {
        $line = ([string]$rawLine).Trim().TrimStart('>').Trim()
        if ([string]::IsNullOrWhiteSpace($line)) { continue }

        $parts = @($line -split '\s+')
        if ($parts.Count -lt 2 -or $parts[0] -ine $env:USERNAME) { continue }

        for ($index = 1; $index -lt [Math]::Min($parts.Count, 4); $index++) {
            $parsedId = 0
            if ([int]::TryParse($parts[$index], [ref]$parsedId)) {
                $sessionIds += $parsedId
                break
            }
        }
    }

    $sessionIds = @($sessionIds | Sort-Object -Unique)
    if ($sessionIds.Count -eq 0) {
        Complete-Action $false "session-not-found" "Nenhuma sessão sua foi encontrada no SRV-IBM."
    }
    if ($sessionIds.Count -gt 1) {
        Complete-Action $false "multiple-sessions" "Foram encontradas várias sessões para seu usuário. Por segurança, nenhuma ação foi executada; contate o suporte."
    }

    return [int]$sessionIds[0]
}

function Invoke-Logoff {
    param([int]$SessionId)

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = "$env:SystemRoot\System32\logoff.exe"
    $startInfo.Arguments = "$SessionId /server:$Server /v"
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        return [pscustomobject]@{ TimedOut = $false; ExitCode = -1 }
    }

    if (-not $process.WaitForExit($TimeoutMilliseconds)) {
        try { $process.Kill() } catch { }
        return [pscustomobject]@{ TimedOut = $true; ExitCode = -1 }
    }

    return [pscustomobject]@{ TimedOut = $false; ExitCode = $process.ExitCode }
}

try {
    if ($env:USERDOMAIN -ine $ExpectedDomain -or [string]::IsNullOrWhiteSpace($env:USERNAME)) {
        Complete-Action $false "invalid-identity" "Esta ação está disponível somente para usuários do domínio ADCONTEC."
    }

    $sessionId = Get-CurrentUserSessionId
    $execution = Invoke-Logoff -SessionId $sessionId

    if ($execution.TimedOut) {
        Complete-Action $false "logoff-timeout" "O servidor demorou para responder ao pedido de encerramento. Aguarde e tente abrir o Domínio novamente." $sessionId
    }
    if ($execution.ExitCode -ne 0) {
        Complete-Action $false "logoff-failed" "Não foi possível encerrar sua sessão no SRV-IBM. Contate o suporte." $sessionId
    }

    Complete-Action $true "logoff-requested" "O encerramento da sua sessão foi solicitado ao SRV-IBM. Aguarde alguns segundos antes de abrir o Domínio novamente." $sessionId
}
catch {
    Complete-Action $false "unexpected-error" "Ocorreu um erro inesperado ao tentar encerrar sua sessão. Contate o suporte."
}
