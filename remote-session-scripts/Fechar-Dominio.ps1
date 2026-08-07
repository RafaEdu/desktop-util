[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Server = "SRV-IBM"
$ExpectedDomain = "ADCONTEC"
$ExecutableName = "contabil.exe"
$TimeoutMilliseconds = 90000

function Complete-Action {
    param(
        [bool]$Success,
        [string]$Code,
        [string]$Message,
        [Nullable[int]]$AffectedProcesses = $null,
        [Nullable[int]]$SessionId = $null
    )

    $payload = [ordered]@{
        success           = $Success
        code              = $Code
        message           = $Message
        affectedProcesses = $AffectedProcesses
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
        Complete-Action $false "session-not-found" "Nenhuma sessão sua foi encontrada no SRV-IBM. Abra o Domínio e tente novamente."
    }
    if ($sessionIds.Count -gt 1) {
        Complete-Action $false "multiple-sessions" "Foram encontradas várias sessões para seu usuário. Por segurança, nenhuma ação foi executada; contate o suporte."
    }

    return [int]$sessionIds[0]
}

function Get-DominioProcesses {
    param([int]$SessionId)

    $identity = "$env:USERDOMAIN\$env:USERNAME"
    $taskOutput = @(& "$env:SystemRoot\System32\tasklist.exe" /s $Server /fi "USERNAME eq $identity" /fi "IMAGENAME eq $ExecutableName" /fo CSV /nh 2>&1)
    if ($LASTEXITCODE -ne 0) {
        Complete-Action $false "process-query-failed" "Não foi possível consultar os processos do Domínio no SRV-IBM. Contate o suporte." $null $SessionId
    }

    $processes = @()
    foreach ($rawLine in $taskOutput) {
        $line = ([string]$rawLine).Trim()
        if (-not $line.StartsWith('"')) { continue }

        try {
            $row = $line | ConvertFrom-Csv -Header ImageName, ProcessId, SessionName, RemoteSessionId, Memory
            if ($row.ImageName -ieq $ExecutableName -and [int]$row.RemoteSessionId -eq $SessionId) {
                $processes += $row
            }
        }
        catch {
            continue
        }
    }

    return @($processes)
}

function Invoke-TaskKill {
    param([int]$SessionId)

    $identity = "$env:USERDOMAIN\$env:USERNAME"
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = "$env:SystemRoot\System32\taskkill.exe"
    $startInfo.Arguments = "/s $Server /fi `"USERNAME eq $identity`" /fi `"SESSION eq $SessionId`" /im $ExecutableName"
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
    $before = @(Get-DominioProcesses -SessionId $sessionId)

    if ($before.Count -eq 0) {
        Complete-Action $true "nothing-to-close" "Nenhum módulo do Domínio foi encontrado na sua sessão." 0 $sessionId
    }

    $execution = Invoke-TaskKill -SessionId $sessionId
    $remaining = @(Get-DominioProcesses -SessionId $sessionId)

    if ($remaining.Count -eq 0) {
        Complete-Action $true "closed" "Os módulos do Domínio foram encerrados. Chrome e os demais aplicativos permaneceram abertos." $before.Count $sessionId
    }

    if ($execution.TimedOut) {
        Complete-Action $false "close-timeout" "O Domínio não terminou de fechar em 90 segundos. Aguarde um pouco; se continuar travado, use a opção Encerrar minha sessão." ($before.Count - $remaining.Count) $sessionId
    }

    Complete-Action $false "close-incomplete" "Não foi possível encerrar todos os módulos do Domínio. Use a opção Encerrar minha sessão ou contate o suporte." ($before.Count - $remaining.Count) $sessionId
}
catch {
    Complete-Action $false "unexpected-error" "Ocorreu um erro inesperado ao tentar fechar o Domínio. Contate o suporte."
}
