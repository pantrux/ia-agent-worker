<#
.SYNOPSIS
  Valida el mismo token y llamadas HTTP que TradingAgents-crypto (NAS) con llm_provider github-copilot.

.DESCRIPTION
  Referencia exacta en codigo del NAS:
    /volume1/docker/TradingAgents-crypto/tradingagents/graph/trading_graph.py
    rama: elif llm_provider == "github-copilot"

  Origen del token (igual que el contenedor):
    Fichero JSON con "access_token" (en Docker: /app/data/github_token.json -> volumen ./data del NAS).

  El contenedor NO usa OPENAI_API_KEY del .env para esta rama: lee github_token.json y hace intercambio Copilot.

  Variables de entorno del PROCESO Docker (docker-compose env_file: .env):
    Se inyectan al contenedor las claves del .env del proyecto (p. ej. OPENAI_API_KEY, GITHUB_CLIENT_*, etc.).
    Para github-copilot, el codigo Python ignora api_key inicial del front para el LLM y usa el JSON + intercambio.

  Peticiones HTTP que ejecuta el contenedor (orden):

  1) GET https://api.github.com/user/copilot
     Cabeceras (unicas en codigo):
       Authorization: token {access_token del JSON}

  2) GET https://api.github.com/copilot_internal/v2/token
     Cabeceras:
       Authorization: token {access_token}
       Accept: application/json
       Editor-Version: vscode/1.90.0
       Editor-Plugin-Version: copilot-chat/0.17.2024051401
       User-Agent: GitHubCopilot/1.155.0

  3) ChatOpenAI (LangChain + cliente OpenAI compatible):
       base_url = https://api.githubcopilot.com
       api_key  = token devuelto por (2) si HTTP 200, si no el mismo access_token (fallback en codigo)
       model    = gpt-4o (el contenedor sobrescribe deep_think_llm y quick_think_llm a gpt-4o)

     URL efectiva estandar OpenAI: POST https://api.githubcopilot.com/v1/chat/completions
     Cabeceras minimas que envia este script (equivalente funcional al cliente OpenAI):
       Authorization: Bearer {api_key de arriba}
       Content-Type: application/json
     Cuerpo JSON (no streaming):
       {"model":"gpt-4o","messages":[{"role":"user","content":"..."}],"stream":false}

.PARAMETER TokenFile
  Ruta al JSON (por defecto: data/github_token.json relativo al directorio del repo = padre de /scripts).

.PARAMETER DryRun
  Solo imprime referencia y datos que se enviarian (sin red de red).

.EXAMPLE
  cd D:\Proyectos\ia-agent-worker
  .\scripts\validate-nas-copilot-token.ps1

.EXAMPLE
  .\scripts\validate-nas-copilot-token.ps1 -TokenFile .\data\github_token.json -Message "hola"
#>

[CmdletBinding()]
param(
    [string] $TokenFile = "",
    [string] $Message = "Responde solo: OK",
    [string] $CopilotApiBase = "https://api.githubcopilot.com",
    [string] $Model = "gpt-4o",
    [switch] $SkipStatus,
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

Write-Host "=== Referencia NAS (github-copilot) ===" -ForegroundColor Cyan
Write-Host "Origen token: $TokenFile"
Write-Host "access_token (redactado): $(Redact-Token $gh)"
Write-Host ""

Write-Host "[1] GET https://api.github.com/user/copilot" -ForegroundColor Yellow
Write-Host "    Authorization: token $(Redact-Token $gh)"
Write-Host ""

Write-Host "[2] GET https://api.github.com/copilot_internal/v2/token" -ForegroundColor Yellow
Write-Host "    Authorization: token $(Redact-Token $gh)"
Write-Host "    Accept: application/json"
Write-Host "    Editor-Version: vscode/1.90.0"
Write-Host "    Editor-Plugin-Version: copilot-chat/0.17.2024051401"
Write-Host "    User-Agent: GitHubCopilot/1.155.0"
Write-Host ""

$chatUrl = ($CopilotApiBase.TrimEnd("/") + "/v1/chat/completions")
Write-Host "[3] POST $chatUrl" -ForegroundColor Yellow
Write-Host "    Authorization: Bearer <token de (2) o fallback access_token>"
Write-Host "    Content-Type: application/json"
Write-Host "    Body: { `"model`": `"$Model`", `"messages`": [ { `"role`": `"user`", `"content`": `"...`" } ], `"stream`": false }"
Write-Host ""

if ($DryRun) {
    Write-Host "DryRun: no se envian peticiones." -ForegroundColor Green
    exit 0
}

function Invoke-JsonGet {
    param([string] $Uri, [hashtable] $Headers)
    return Invoke-RestMethod -Uri $Uri -Headers $Headers -Method Get -TimeoutSec 120
}

function Invoke-JsonPost {
    param([string] $Uri, [hashtable] $Headers, [hashtable] $BodyObj)
    $json = $BodyObj | ConvertTo-Json -Depth 10 -Compress
    return Invoke-RestMethod -Uri $Uri -Headers $Headers -Method Post -Body $json -ContentType "application/json; charset=utf-8" -TimeoutSec 120
}

if (-not $SkipStatus) {
    Write-Host ">>> Ejecutando [1]..." -ForegroundColor Green
    $h1 = @{ Authorization = "token $gh" }
    try {
        $r1 = Invoke-JsonGet -Uri "https://api.github.com/user/copilot" -Headers $h1
        $r1 | ConvertTo-Json -Depth 10
    }
    catch {
        Write-Warning "Fallo [1]: $($_.Exception.Message)"
        if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
    }
    Write-Host ""
}

$bearer = $gh
$bearerSource = "github access_token (fallback como en trading_graph.py)"

if (-not $SkipExchange) {
    Write-Host ">>> Ejecutando [2]..." -ForegroundColor Green
    $h2 = @{
        Authorization                = "token $gh"
        Accept                       = "application/json"
        "Editor-Version"             = "vscode/1.90.0"
        "Editor-Plugin-Version"     = "copilot-chat/0.17.2024051401"
        "User-Agent"                 = "GitHubCopilot/1.155.0"
    }
    try {
        $ex = Invoke-WebRequest -Uri "https://api.github.com/copilot_internal/v2/token" -Headers $h2 -Method Get -TimeoutSec 120
        $exJson = $ex.Content | ConvertFrom-Json
        if ($exJson.token) {
            $bearer = [string]$exJson.token
            $bearerSource = "campo token de copilot_internal/v2/token"
        }
        Write-Host "HTTP $($ex.StatusCode); bearer: $(Redact-Token $bearer) ($bearerSource)"
    }
    catch {
        Write-Warning "Intercambio [2] fallo; se usara access_token como Bearer (mismo fallback que el contenedor)."
        if ($_.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            Write-Host $reader.ReadToEnd()
        }
    }
    Write-Host ""
}

Write-Host ">>> Ejecutando [3]..." -ForegroundColor Green
Write-Host "Bearer ($bearerSource): $(Redact-Token $bearer)"

$h3 = @{
    Authorization = "Bearer $bearer"
}
$body = @{
    model    = $Model
    messages = @(@{ role = "user"; content = $Message })
    stream   = $false
}

try {
    $r3 = Invoke-JsonPost -Uri $chatUrl -Headers $h3 -BodyObj $body
    $r3 | ConvertTo-Json -Depth 20
    Write-Host ""
    Write-Host "OK: respuesta 2xx y JSON de chat completions." -ForegroundColor Green
    exit 0
}
catch {
    Write-Error "Fallo [3] POST chat: $($_.Exception.Message)"
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
    exit 1
}
