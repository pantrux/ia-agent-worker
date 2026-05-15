<#
.SYNOPSIS
  Valida token GitHub OAuth (github_token.json) y flujo Copilot alineado con TradingAgents-crypto + cabeceras que GitHub exige hoy.

.DESCRIPTION
  Codigo NAS de referencia:
    /volume1/docker/TradingAgents-crypto/tradingagents/graph/trading_graph.py (rama github-copilot)

  Ajustes respecto al NAS (por 404 reales en api.github.com / chat):
    - [1] Por defecto: GET https://api.github.com/user (REST documentado + X-GitHub-Api-Version).
          El NAS llama GET /user/copilot; esa ruta NO aparece en la REST publica y suele devolver 404.
          Usa -LegacyNasUserCopilot para repetir exactamente esa llamada (solo depuracion).
    - [2] Intercambio: mismas cabeceras que trading_graph.py MAS Accept vnd.github+json y X-GitHub-Api-Version
        (GitHub enruta mal sin version y puede responder 404 generico).
    - [3] Chat: verificado dentro del contenedor NAS con logging OpenAI/httpx:
        POST https://api.githubcopilot.com/chat/completions (sin /v1; el SDK Python anexa /chat/completions a la base).
        Cabeceras de cliente Copilot (Editor-Version, Copilot-Integration-Id, etc.); host desde JSON de [2] si existe,
        luego api.githubcopilot.com y api.individual.githubcopilot.com (421 en individual es frecuente si el flujo va al host agrupado).

.PARAMETER TokenFile
  JSON con access_token (defecto: data/github_token.json bajo la raiz del repo).

.PARAMETER DryRun
  Solo imprime plan; no hace peticiones.

.EXAMPLE
  .\scripts\validate-nas-copilot-token.ps1
#>

[CmdletBinding()]
param(
    [string] $TokenFile = "",
    [string] $Message = "Responde solo: OK",
    [string] $Model = "gpt-4o",
    [string] $GitHubApiVersion = "2026-03-10",
    [switch] $LegacyNasUserCopilot,
    [switch] $SkipUser,
    [switch] $SkipExchange,
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
    if ($t.Length -le 8) { return "***" }
    return ("(len=" + $t.Length + ", prefijo=" + $t.Substring(0, 4) + "...)")
}

function Get-GitHubRestHeaders {
    param([string] $GhToken, [string] $ApiVersion)
    return @{
        Authorization          = "token $GhToken"
        Accept                 = "application/vnd.github+json"
        "X-GitHub-Api-Version" = $ApiVersion
    }
}

function Get-ExchangeHeadersNasPlus {
    param([string] $GhToken, [string] $ApiVersion)
    $h = @{
        Authorization                = "token $GhToken"
        Accept                       = "application/vnd.github+json"
        "X-GitHub-Api-Version"       = $ApiVersion
        "Editor-Version"             = "vscode/1.90.0"
        "Editor-Plugin-Version"      = "copilot-chat/0.17.2024051401"
        "User-Agent"                 = "GitHubCopilot/1.155.0"
    }
    return $h
}

function Get-ChatClientHeaders {
    param([string] $Bearer)
    return @{
        Authorization              = "Bearer $Bearer"
        "Editor-Version"           = "vscode/1.90.0"
        "Editor-Plugin-Version"    = "copilot-chat/0.17.2024051401"
        "User-Agent"               = "GitHubCopilot/1.155.0"
        "Copilot-Integration-Id"   = "vscode-chat"
    }
}

function Parse-ExchangeChatBases {
    param([object] $Json)
    $list = New-Object System.Collections.Generic.List[string]
    if ($null -eq $Json) { return $list }
    foreach ($k in @("base_url", "baseUrl", "api_url", "endpoint")) {
        $v = $Json.$k
        if ($v -and ($v -is [string]) -and $v.Trim()) {
            $list.Add($v.Trim().TrimEnd("/"))
        }
    }
    $ep = $Json.endpoints
    if ($ep) {
        foreach ($ek in @("api", "chat", "models")) {
            $v2 = $ep.$ek
            if ($v2 -and ($v2 -is [string]) -and $v2.Trim()) {
                $list.Add($v2.Trim().TrimEnd("/"))
            }
        }
    }
    return $list
}

function Invoke-ChatOnce {
    param(
        [string] $HostBase,
        [hashtable] $Headers,
        [hashtable] $BodyObj
    )
    $url = ($HostBase.TrimEnd("/") + "/chat/completions")
    $json = $BodyObj | ConvertTo-Json -Depth 10 -Compress
    return Invoke-RestMethod -Uri $url -Headers $Headers -Method Post -Body $json -ContentType "application/json; charset=utf-8" -TimeoutSec 120
}

$scriptPath = $MyInvocation.MyCommand.Path
$repoRoot = Get-RepoRoot -ScriptPath $scriptPath
if (-not $TokenFile) {
    $TokenFile = Join-Path $repoRoot "data\github_token.json"
}

if (-not (Test-Path -LiteralPath $TokenFile)) {
    Write-Error "No existe TokenFile: $TokenFile (copia desde el NAS data/github_token.json)."
}

$raw = Get-Content -LiteralPath $TokenFile -Raw -Encoding UTF8
$data = $raw | ConvertFrom-Json
$gh = [string]$data.access_token
if (-not $gh) {
    Write-Error "El JSON no contiene access_token."
}

Write-Host "=== Validacion Copilot (token + intercambio + chat) ===" -ForegroundColor Cyan
Write-Host "TokenFile: $TokenFile"
Write-Host "access_token (redactado): $(Redact-Token $gh)"
Write-Host "X-GitHub-Api-Version: $GitHubApiVersion"
Write-Host ""

Write-Host "[1a] GET https://api.github.com/user (REST documentado; valida credencial)" -ForegroundColor Yellow
Write-Host "     Authorization: token ... ; Accept: application/vnd.github+json ; X-GitHub-Api-Version"
Write-Host ""
if ($LegacyNasUserCopilot) {
    Write-Host "[1b] GET https://api.github.com/user/copilot (solo replica NAS; suele 404 en GitHub actual)" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "[2] GET https://api.github.com/copilot_internal/v2/token" -ForegroundColor Yellow
Write-Host "    (cabeceras NAS + Accept vnd.github + X-GitHub-Api-Version)" -ForegroundColor DarkGray
Write-Host ""

Write-Host "[3] POST {host}/chat/completions (modelo $Model); misma ruta que OpenAI SDK en el contenedor" -ForegroundColor Yellow
Write-Host "    Hosts: base del JSON de [2] si existe -> https://api.githubcopilot.com -> https://api.individual.githubcopilot.com" -ForegroundColor DarkGray
Write-Host "    + cabeceras cliente Copilot (Editor-Version, Copilot-Integration-Id, ...)" -ForegroundColor DarkGray
Write-Host ""

if ($DryRun) {
    Write-Host "DryRun: no se envian peticiones." -ForegroundColor Green
    exit 0
}

if (-not $SkipUser) {
    Write-Host ">>> [1a] GET /user ..." -ForegroundColor Green
    try {
        $hu = Get-GitHubRestHeaders -GhToken $gh -ApiVersion $GitHubApiVersion
        $u = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $hu -Method Get -TimeoutSec 120
        Write-Host "OK login: $($u.login)  id: $($u.id)"
    }
    catch {
        Write-Warning "Fallo [1a] /user: $($_.Exception.Message)"
        if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
    }
    Write-Host ""
}

if ($LegacyNasUserCopilot) {
    Write-Host ">>> [1b] GET /user/copilot (replica NAS) ..." -ForegroundColor Green
    try {
        $hLegacy = @{ Authorization = "token $gh" }
        $c = Invoke-RestMethod -Uri "https://api.github.com/user/copilot" -Headers $hLegacy -Method Get -TimeoutSec 120
        $c | ConvertTo-Json -Depth 10
    }
    catch {
        Write-Warning "Fallo [1b] (esperable 404): $($_.Exception.Message)"
        if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
    }
    Write-Host ""
}

$bearer = $gh
$bearerSource = "github access_token (fallback como trading_graph.py)"
$exchangeJson = $null

if (-not $SkipExchange) {
    Write-Host ">>> [2] Intercambio copilot_internal ..." -ForegroundColor Green
    $h2 = Get-ExchangeHeadersNasPlus -GhToken $gh -ApiVersion $GitHubApiVersion
    try {
        $ex = Invoke-WebRequest -Uri "https://api.github.com/copilot_internal/v2/token" -Headers $h2 -Method Get -TimeoutSec 120
        $exchangeJson = $ex.Content | ConvertFrom-Json
        if ($exchangeJson.token) {
            $bearer = [string]$exchangeJson.token
            $bearerSource = "token en JSON de copilot_internal/v2/token"
        }
        Write-Host "HTTP $($ex.StatusCode); bearer: $(Redact-Token $bearer) ($bearerSource)"
    }
    catch {
        Write-Warning "Intercambio [2] fallo; se usara access_token como Bearer (fallback NAS)."
        if ($_.Exception.Response) {
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                Write-Host $reader.ReadToEnd()
            }
            catch { }
        }
    }
    Write-Host ""
}

$chatBases = New-Object System.Collections.Generic.List[string]
foreach ($b in (Parse-ExchangeChatBases -Json $exchangeJson)) {
    if (-not $chatBases.Contains($b)) { $chatBases.Add($b) }
}
foreach ($fallback in @(
        "https://api.githubcopilot.com",
        "https://api.individual.githubcopilot.com"
    )) {
    if (-not $chatBases.Contains($fallback)) { $chatBases.Add($fallback) }
}

Write-Host ">>> [3] Chat completions ..." -ForegroundColor Green
Write-Host "Bearer ($bearerSource): $(Redact-Token $bearer)"

$hChat = Get-ChatClientHeaders -Bearer $bearer
$body = @{
    model    = $Model
    messages = @(@{ role = "user"; content = $Message })
    stream   = $false
}

$lastErr = $null
foreach ($base in $chatBases) {
    $chatUrl = ($base.TrimEnd("/") + "/chat/completions")
    Write-Host "Intentando: POST $chatUrl" -ForegroundColor DarkCyan
    try {
        $r3 = Invoke-ChatOnce -HostBase $base -Headers $hChat -BodyObj $body
        $r3 | ConvertTo-Json -Depth 20
        Write-Host ""
        Write-Host "OK en $chatUrl" -ForegroundColor Green
        exit 0
    }
    catch {
        $lastErr = $_.Exception.Message
        Write-Warning "Fallo en ${chatUrl}: $lastErr"
        if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
    }
}

Write-Error "Todos los hosts de chat fallaron. Ultimo error: $lastErr"
exit 1
