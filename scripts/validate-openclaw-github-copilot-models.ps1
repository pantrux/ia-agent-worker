<#
.SYNOPSIS
  Valida modelos GitHub Copilot usando el mismo flujo que Openclaw (token ghu_* + intercambio copilot_internal).

.DESCRIPTION
  Openclaw (github.com/openclaw/openclaw) guarda un perfil tipo:
    "github-copilot:github": { "type": "token", "provider": "github-copilot", "token": "ghu_..." }
  Luego resolveCopilotApiToken (src/plugin-sdk/provider-auth.ts) llama:
    GET https://api.github.com/copilot_internal/v2/token
    con Bearer <github user token> y cabeceras IDE Copilot + X-Github-Api-Version.
  Con la respuesta usa el JWT de sesion como Bearer hacia baseUrl (proxy-ep en el token o
  DEFAULT https://api.individual.githubcopilot.com) y enruta por modelo:
    - extensions/github-copilot/model-metadata.ts: Claude -> anthropic-messages -> POST .../v1/messages
    - Gemini -> openai-completions -> POST .../chat/completions (mismo estilo NAS en Copilot)
    - GPT (gpt-*, o*, grok, etc.) -> openai-responses -> POST .../v1/responses

  El script intenta extraer ghu_* desde openclaw.json o auth.json, o desde -TokenFile.

  Seguridad: no pegues tokens en issues ni chats; si se filtro, revoca y genera otro en GitHub.

.PARAMETER OpenclawConfigPath
  Ruta a openclaw.json (Windows: $env:USERPROFILE\.openclaw\openclaw.json).

.PARAMETER OpenclawAuthPath
  Ruta alternativa al almacen de perfiles (p. ej. ...\.openclaw\agent\auth.json).

.PARAMETER ProfileId
  Id de perfil a buscar (defecto: github-copilot:github).

.PARAMETER TokenFile
  JSON con "token" o "access_token" ghu_* (evita parsear toda la config Openclaw).

.PARAMETER ModelsCsv
  Lista de ids sin prefijo github-copilot/ (coma). Vacio = lista estatica alineada con models-defaults.ts + picker.

.PARAMETER GitHubApiVersion
  Cabecera X-Github-Api-Version para el intercambio (Openclaw usa 2025-04-01).

.PARAMETER DryRun
  Solo muestra token encontrado (redactado), pasos y modelos; sin red.

.EXAMPLE
  .\scripts\validate-openclaw-github-copilot-models.ps1 -DryRun

.EXAMPLE
  .\scripts\validate-openclaw-github-copilot-models.ps1 -TokenFile .\data\github_copilot_ghu.json

.EXAMPLE
  .\scripts\validate-openclaw-github-copilot-models.ps1 -ModelsCsv "gpt-5.4,claude-sonnet-4"
#>

[CmdletBinding()]
param(
    [string] $OpenclawConfigPath = "",
    [string] $OpenclawAuthPath = "",
    [string] $ProfileId = "github-copilot:github",
    [string] $TokenFile = "",
    [string] $ModelsCsv = "",
    [string] $GitHubApiVersion = "2025-04-01",
    [switch] $PreferCatalog,
    [int] $DelayMs = 350,
    [switch] $DryRun
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    param([string] $ScriptPath)
    $scriptsDir = Split-Path -Parent $ScriptPath
    return (Split-Path -Parent $scriptsDir)
}

function Redact-Token {
    param([string] $t)
    if (-not $t) { return "(vacio)" }
    if ($t.Length -le 12) { return "***" }
    return ("(len=" + $t.Length + ", prefijo=" + $t.Substring(0, 7) + "...)")
}

function Get-OpenclawExchangeHeaders {
    param([string] $GithubUserToken)
    return @{
        Authorization                = "Bearer $GithubUserToken"
        Accept                       = "application/json"
        "Copilot-Integration-Id"     = "vscode-chat"
        "Editor-Version"             = "vscode/1.107.0"
        "Editor-Plugin-Version"      = "copilot-chat/0.35.0"
        "User-Agent"                 = "GitHubCopilotChat/0.35.0"
        "X-Github-Api-Version"       = $GitHubApiVersion
    }
}

function Get-CopilotSessionHeaders {
    param([string] $SessionBearer)
    return @{
        Authorization                = "Bearer $SessionBearer"
        Accept                       = "application/json"
        "Copilot-Integration-Id"     = "vscode-chat"
        "Editor-Version"             = "vscode/1.107.0"
        "Editor-Plugin-Version"      = "copilot-chat/0.35.0"
        "User-Agent"               = "GitHubCopilotChat/0.35.0"
        "Openai-Organization"      = "github-copilot"
        "x-initiator"              = "user"
    }
}

function Find-GithubCopilotTokenInObject {
    param(
        [object] $Node,
        [string] $PreferredProfileId,
        [int] $Depth = 0
    )
    if ($Depth -gt 12) { return $null }
    if ($null -eq $Node) { return $null }

    if ($Node -is [System.Collections.IDictionary]) {
        foreach ($k in $Node.Keys) {
            if ($k -eq $PreferredProfileId) {
                $v = $Node[$k]
                if ($v -and $v.token) { return [string]$v.token }
            }
        }
        foreach ($k in $Node.Keys) {
            $r = Find-GithubCopilotTokenInObject -Node $Node[$k] -PreferredProfileId $PreferredProfileId -Depth ($Depth + 1)
            if ($r) { return $r }
        }
        return $null
    }

    if ($Node.PSObject -and $Node.PSObject.Properties) {
        foreach ($p in $Node.PSObject.Properties) {
            if ($p.Name -eq $PreferredProfileId -and $p.Value) {
                $v = $p.Value
                if ($v.token) { return [string]$v.token }
            }
        }
        foreach ($p in $Node.PSObject.Properties) {
            $r = Find-GithubCopilotTokenInObject -Node $p.Value -PreferredProfileId $PreferredProfileId -Depth ($Depth + 1)
            if ($r) { return $r }
        }
        $prov = $Node.provider
        $typ = $Node.type
        $tok = $Node.token
        if ($prov -eq "github-copilot" -and $typ -eq "token" -and $tok) {
            return [string]$tok
        }
    }
    return $null
}

function Read-GithubUserToken {
    param(
        [string] $ProfileId,
        [string] $TokenFile,
        [string] $OpenclawConfigPath,
        [string] $OpenclawAuthPath
    )
    if ($TokenFile.Trim()) {
        if (-not (Test-Path -LiteralPath $TokenFile)) { Write-Error "No existe TokenFile: $TokenFile" }
        $j = Get-Content -LiteralPath $TokenFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $t = [string]$j.token
        if (-not $t) { $t = [string]$j.access_token }
        if (-not $t) { Write-Error "TokenFile debe contener propiedad token o access_token." }
        return $t.Trim()
    }
    foreach ($path in @($OpenclawAuthPath, $OpenclawConfigPath)) {
        if (-not $path) { continue }
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $j = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
        $found = Find-GithubCopilotTokenInObject -Node $j -PreferredProfileId $ProfileId
        if ($found) { return $found.Trim() }
    }
    Write-Error "No se encontro token github-copilot. Usa -TokenFile o rutas -OpenclawConfigPath / -OpenclawAuthPath."
}

function Parse-ExchangeBaseUrl {
    param([object] $Json)
    foreach ($k in @("base_url", "baseUrl", "api_url", "endpoint")) {
        $v = $Json.$k
        if ($v -and ($v -is [string]) -and $v.Trim()) { return $v.Trim().TrimEnd("/") }
    }
    $ep = $Json.endpoints
    if ($ep) {
        foreach ($ek in @("api", "chat", "models")) {
            $v2 = $ep.$ek
            if ($v2 -and ($v2 -is [string]) -and $v2.Trim()) { return $v2.Trim().TrimEnd("/") }
        }
    }
    return "https://api.individual.githubcopilot.com"
}

function Invoke-CopilotTokenExchange {
    param(
        [string] $GithubUserToken,
        [string] $ApiVersion
    )
    $h = Get-OpenclawExchangeHeaders -GithubUserToken $GithubUserToken
    $uri = "https://api.github.com/copilot_internal/v2/token"
    try {
        $r = Invoke-WebRequest -Uri $uri -Headers $h -Method Get -TimeoutSec 120
        $json = $r.Content | ConvertFrom-Json
        $tok = [string]$json.token
        if (-not $tok) { throw "Respuesta sin campo token" }
        $base = Parse-ExchangeBaseUrl -Json $json
        return @{ SessionToken = $tok; BaseUrl = $base; Raw = $json }
    }
    catch {
        Write-Warning "Intercambio con Authorization Bearer fallo: $($_.Exception.Message). Reintento con Authorization token ..."
        $h2 = $h.Clone()
        $h2["Authorization"] = "token $GithubUserToken"
        $r = Invoke-WebRequest -Uri $uri -Headers $h2 -Method Get -TimeoutSec 120
        $json = $r.Content | ConvertFrom-Json
        $tok = [string]$json.token
        if (-not $tok) { throw "Respuesta sin campo token" }
        $base = Parse-ExchangeBaseUrl -Json $json
        return @{ SessionToken = $tok; BaseUrl = $base; Raw = $json }
    }
}

function Resolve-Transport {
    param([string] $ModelId)
    $m = $ModelId.ToLowerInvariant()
    if ($m -match "claude") { return "anthropic" }
    if ($m -match "gemini") { return "chat" }
    return "responses"
}

function Get-DefaultOpenclawModelIds {
    # extensions/github-copilot/models-defaults.ts (DEFAULT_MODEL_IDS)
    return @(
        "claude-haiku-4.5",
        "claude-opus-4.5",
        "claude-opus-4.6",
        "claude-opus-4.7",
        "claude-sonnet-4",
        "claude-sonnet-4.6",
        "claude-sonnet-4.5",
        "gemini-2.5-pro",
        "gemini-3-flash",
        "gemini-3.1-pro",
        "gpt-4.1",
        "gpt-5-mini",
        "gpt-5.2",
        "gpt-5.2-codex",
        "gpt-5.3-codex",
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.4-nano",
        "gpt-5.5",
        "grok-code-fast-1",
        "raptor-mini",
        "goldeneye"
    )
}

function Get-HttpStatusFromError {
    param($ErrorRecord)
    try {
        $resp = $ErrorRecord.Exception.Response
        if ($null -eq $resp) { return $null }
        return [int]$resp.StatusCode
    }
    catch { return $null }
}

$repoRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { Get-RepoRoot -ScriptPath $MyInvocation.MyCommand.Path }

if (-not $OpenclawConfigPath) {
    $OpenclawConfigPath = Join-Path $env:USERPROFILE ".openclaw\openclaw.json"
}
if (-not $OpenclawAuthPath) {
    $OpenclawAuthPath = Join-Path $env:USERPROFILE ".openclaw\agent\auth.json"
}

Write-Host "=== Validacion modelos GitHub Copilot (flujo Openclaw + ghu_*) ===" -ForegroundColor Cyan
Write-Host "Perfil buscado: $ProfileId"
Write-Host "Config probada: $OpenclawAuthPath ; $OpenclawConfigPath"
Write-Host ""

if ($DryRun) {
    try {
        $ghTry = Read-GithubUserToken -ProfileId $ProfileId -TokenFile $TokenFile -OpenclawConfigPath $OpenclawConfigPath -OpenclawAuthPath $OpenclawAuthPath
        Write-Host "Token GitHub (redactado): $(Redact-Token $ghTry)" -ForegroundColor DarkGray
    }
    catch {
        Write-Host "Token: no encontrado en esta maquina (usa -TokenFile o instala perfil Openclaw)." -ForegroundColor DarkYellow
    }
    Write-Host "DryRun: sin intercambio ni llamadas a modelos." -ForegroundColor Green
    exit 0
}

$ghu = Read-GithubUserToken -ProfileId $ProfileId -TokenFile $TokenFile -OpenclawConfigPath $OpenclawConfigPath -OpenclawAuthPath $OpenclawAuthPath

Write-Host "Token GitHub (redactado): $(Redact-Token $ghu)"
Write-Host ""

Write-Host ">>> Intercambio copilot_internal/v2/token (cabeceras Openclaw) ..." -ForegroundColor Green
$ex = Invoke-CopilotTokenExchange -GithubUserToken $ghu -ApiVersion $GitHubApiVersion
$session = $ex.SessionToken
$base = $ex.BaseUrl.TrimEnd("/")
Write-Host "OK baseUrl sesion: $base"
Write-Host "Bearer sesion (redactado): $(Redact-Token $session)"
Write-Host ""

$hSession = Get-CopilotSessionHeaders -SessionBearer $session
$hAnthropic = Get-CopilotSessionHeaders -SessionBearer $session
$hAnthropic["anthropic-version"] = "2023-06-01"
$hAnthropic["anthropic-dangerous-direct-browser-access"] = "true"

$modelIds = New-Object System.Collections.Generic.List[string]
if ($ModelsCsv.Trim()) {
    foreach ($p in ($ModelsCsv.Split(","))) {
        $x = $p.Trim()
        if ($x.StartsWith("github-copilot/")) { $x = $x.Substring("github-copilot/".Length) }
        if ($x) { $modelIds.Add($x) }
    }
}
elseif ($PreferCatalog) {
    Write-Host ">>> GET $base/models ..." -ForegroundColor Green
    try {
        $catalog = Invoke-RestMethod -Uri ($base + "/models") -Headers $hSession -Method Get -TimeoutSec 60
        $data = @($catalog.data)
        foreach ($e in $data) {
            if (-not $e) { continue }
            $id = [string]$e.id
            if (-not $id) { continue }
            if ($e.object -and $e.object -ne "model") { continue }
            if ($id.StartsWith("accounts/")) { continue }
            $modelIds.Add($id.Trim())
        }
        Write-Host "Catalogo live: $($modelIds.Count) modelos"
    }
    catch {
        Write-Warning "GET /models fallo; usa lista estatica. $($_.Exception.Message)"
        foreach ($m in (Get-DefaultOpenclawModelIds)) { $modelIds.Add($m) }
    }
}
else {
    foreach ($m in (Get-DefaultOpenclawModelIds)) { $modelIds.Add($m) }
}

Write-Host ""
Write-Host ">>> Pruebas por modelo (transporte segun model-metadata de Openclaw) ..." -ForegroundColor Green
Write-Host ""

$ok = New-Object System.Collections.Generic.List[string]
$fail = New-Object System.Collections.Generic.List[string]

foreach ($mid in $modelIds) {
    $kind = Resolve-Transport -ModelId $mid
    $url = ""
    $bodyObj = $null
    $headers = $null

    if ($kind -eq "anthropic") {
        $url = $base + "/v1/messages"
        $headers = $hAnthropic
        $bodyObj = @{
            model      = $mid
            max_tokens = 256
            stream     = $false
            messages   = @(@{ role = "user"; content = "Responde exactamente PING y nada mas." })
        }
    }
    elseif ($kind -eq "chat") {
        $url = $base + "/chat/completions"
        $headers = $hSession
        $bodyObj = @{
            model    = $mid
            messages = @(@{ role = "user"; content = "Responde exactamente PING y nada mas." })
            stream   = $false
        }
    }
    else {
        $url = $base + "/v1/responses"
        $headers = $hSession
        $bodyObj = @{
            model  = $mid
            input  = "Responde exactamente PING y nada mas."
            stream = $false
        }
    }

    $json = $bodyObj | ConvertTo-Json -Depth 12 -Compress
    $label = "[$kind] $mid"
    try {
        $null = Invoke-RestMethod -Uri $url -Headers $headers -Method Post -Body $json -ContentType "application/json; charset=utf-8" -TimeoutSec 120
        Write-Host "[OK]   $label  -> $url" -ForegroundColor Green
        $ok.Add($mid)
    }
    catch {
        $code = Get-HttpStatusFromError -ErrorRecord $_
        $detail = ""
        if ($_.ErrorDetails.Message) {
            $detail = $_.ErrorDetails.Message
            if ($detail.Length -gt 220) { $detail = $detail.Substring(0, 220) + "..." }
        }
        else { $detail = $_.Exception.Message }
        $cs = if ($null -ne $code) { " HTTP $code" } else { "" }
        Write-Host "[FAIL]$cs  $label  -> $url" -ForegroundColor Yellow
        Write-Host "       $detail" -ForegroundColor DarkGray
        $fail.Add($mid)
    }
    if ($DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }
}

Write-Host ""
Write-Host "--- Resumen ---" -ForegroundColor Cyan
Write-Host "OK ($($ok.Count)): $($ok -join ', ')"
Write-Host "Fallo ($($fail.Count)): $($fail -join ', ')"

if ($ok.Count -eq 0) {
    exit 1
}
exit 0
