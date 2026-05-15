<#
.SYNOPSIS
  Prueba que modelos responden contra la API de GitHub Copilot (chat completions y/o OpenAI Responses).

.DESCRIPTION
  Referencia Openclaw (github.com/openclaw/openclaw):
    - extensions/github-copilot/model-metadata.ts: los ids GPT (p. ej. gpt-5.4) usan transporte "openai-responses"
      (cliente OpenAI responses.create), no chat/completions.
    - extensions/github-copilot/openclaw.plugin.json: baseUrl por defecto del catalogo
      https://api.individual.githubcopilot.com (no api.githubcopilot.com).
    - src/plugin-sdk/provider-auth.ts: token corto via GET api.github.com/copilot_internal/v2/token (Bearer github);
      baseUrl por defecto DEFAULT_COPILOT_API_BASE_URL = api.individual.githubcopilot.com.

  Este script usa por defecto el mismo Bearer que el NAS (access_token del JSON), como validate-nas-copilot-token.ps1 [3].

  -Api chat: POST {HostBase}/chat/completions (sin /v1), flujo contenedor NAS.
  -Api responses: POST {ResponsesHostBase}/v1/responses (OpenAI Responses API), alineado con Openclaw para modelos GPT nuevos.
  -Api both: ambos por cada modelo.

.PARAMETER Preset
  default = pocos modelos tipicos; wide = barrido amplio de ids (ruidoso en 400).

.PARAMETER Api
  chat | responses | both

.PARAMETER HeaderStyle
  nas = cabeceras como validate-nas-copilot-token (vscode/1.90, Copilot/1.155).
  openclaw = cabeceras como Openclaw actual (vscode/1.107, GitHubCopilotChat/0.35, Openai-Organization github-copilot).

.PARAMETER TokenFile
  JSON con access_token (defecto: data/github_token.json bajo la raiz del repo).

.PARAMETER HostBase
  Base URL para chat/completions (defecto: https://api.githubcopilot.com).

.PARAMETER ResponsesHostBase
  Base URL principal para POST /v1/responses (defecto: https://api.individual.githubcopilot.com, como Openclaw).
  Si falla (p. ej. 421 Misdirected Request con token OAuth), el script reintenta en https://api.githubcopilot.com.

.PARAMETER Message
  Mensaje de usuario corto para cada prueba.

.PARAMETER Models
  Ids de modelo. En PowerShell no uses -Models dos veces: usa coma en un solo argumento,
  matriz o -ModelsCsv. Ejemplos: -Models "gpt-4o,gpt-4o-mini"  o  -Models @('gpt-4o','gpt-4o-mini').

.PARAMETER ModelsFile
  Archivo UTF-8: un id de modelo por linea; lineas vacias y # comentario ignoradas.
  Ruta relativa: se busca respecto al directorio actual y, si no existe, respecto a la raiz del repo.

.PARAMETER ModelsCsv
  Lista separada por comas (ej: gpt-4o,gpt-4o-mini).

.PARAMETER DelayMs
  Pausa entre peticiones (rate limit).

.PARAMETER DryRun
  Imprime modelos y URL; no hace POST.

.EXAMPLE
  .\scripts\probe-copilot-chat-models.ps1

.EXAMPLE
  .\scripts\probe-copilot-chat-models.ps1 -Api responses -ModelsCsv "gpt-5.4,gpt-5.5" -HeaderStyle openclaw

.EXAMPLE
  .\scripts\probe-copilot-chat-models.ps1 -Preset wide

.EXAMPLE
  .\scripts\probe-copilot-chat-models.ps1 -ModelsCsv "gpt-4o,gpt-4o-mini,o3-mini"

.EXAMPLE
  .\scripts\probe-copilot-chat-models.ps1 -Models "gpt-4o,gpt-4o-mini"

.EXAMPLE
  .\scripts\probe-copilot-chat-models.ps1 -Models @('gpt-4o','gpt-4o-mini')

.EXAMPLE
  .\scripts\probe-copilot-chat-models.ps1 -ModelsFile .\mis-modelos.txt
#>

[CmdletBinding()]
param(
    [string] $TokenFile = "",
    [string] $HostBase = "https://api.githubcopilot.com",
    [string] $ResponsesHostBase = "https://api.individual.githubcopilot.com",
    [ValidateSet("chat", "responses", "both")]
    [string] $Api = "chat",
    [ValidateSet("nas", "openclaw")]
    [string] $HeaderStyle = "nas",
    [string] $Message = "Responde exactamente la palabra PING y nada mas.",
    [string[]] $Models = @(),
    [string] $ModelsFile = "",
    [string] $ModelsCsv = "",
    [ValidateSet("default", "wide")]
    [string] $Preset = "default",
    [int] $DelayMs = 400,
    [switch] $DryRun
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    param([string] $ScriptPath)
    $scriptsDir = Split-Path -Parent $ScriptPath
    return (Split-Path -Parent $scriptsDir)
}

function Get-CopilotRequestHeaders {
    param(
        [string] $Bearer,
        [ValidateSet("nas", "openclaw")]
        [string] $Style
    )
    $h = @{
        Authorization            = "Bearer $Bearer"
        "Copilot-Integration-Id" = "vscode-chat"
    }
    if ($Style -eq "openclaw") {
        $h["Editor-Version"] = "vscode/1.107.0"
        $h["Editor-Plugin-Version"] = "copilot-chat/0.35.0"
        $h["User-Agent"] = "GitHubCopilotChat/0.35.0"
        $h["Openai-Organization"] = "github-copilot"
        $h["x-initiator"] = "user"
        return $h
    }
    $h["Editor-Version"] = "vscode/1.90.0"
    $h["Editor-Plugin-Version"] = "copilot-chat/0.17.2024051401"
    $h["User-Agent"] = "GitHubCopilot/1.155.0"
    return $h
}

function Get-ResponsesOutputSnippet {
    param([object] $ResponseObj)
    try {
        foreach ($item in @($ResponseObj.output)) {
            if (-not $item) { continue }
            $content = $item.content
            if (-not $content) { continue }
            foreach ($c in @($content)) {
                if ($null -eq $c) { continue }
                if ($null -ne $c.text -and [string]$c.text -ne "") {
                    $t = [string]$c.text
                    if ($t.Length -gt 0) { return $t }
                }
            }
        }
    }
    catch { }
    return ""
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

function Resolve-ModelsFilePath {
    param([string] $RawPath, [string] $RepoRoot)
    $p = $RawPath.Trim()
    if ([System.IO.Path]::IsPathRooted($p)) { return $p }
    $here = (Get-Location).Path
    $cand1 = [System.IO.Path]::GetFullPath((Join-Path $here $p))
    if (Test-Path -LiteralPath $cand1) { return $cand1 }
    $cand2 = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $p))
    if (Test-Path -LiteralPath $cand2) { return $cand2 }
    return $cand1
}

function Read-ModelsFromFile {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Error ("No existe ModelsFile: {0}. Crealo (UTF-8, un id por linea) o usa -ModelsCsv / -Models ""a,b"" / -Preset wide." -f $Path)
    }
    $lines = Get-Content -LiteralPath $Path -Encoding UTF8
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
        $t = $line.Trim()
        if (-not $t) { continue }
        if ($t.StartsWith("#")) { continue }
        $out.Add($t)
    }
    return $out
}

function Get-NarrowDefaultModelList {
    # Coincide con lo que suele aceptar api.githubcopilot.com en planes Copilot tipicos (probar con -Preset wide si quieres mas ids).
    return @(
        "gpt-4o",
        "gpt-4o-mini",
        "gpt-3.5-turbo"
    )
}

function Get-WideModelCatalog {
    return @(
        "gpt-4o",
        "gpt-4o-mini",
        "gpt-4",
        "gpt-4-turbo",
        "gpt-4.1",
        "gpt-4.1-mini",
        "gpt-3.5-turbo",
        "o1",
        "o1-mini",
        "o1-preview",
        "o3-mini",
        "o3",
        "o4-mini",
        "gpt-5",
        "gpt-5-mini",
        "gpt-5-nano",
        "gpt-5.1",
        "gpt-5.2",
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.4-nano",
        "gpt-5.5",
        "gpt-5.1-codex",
        "gpt-5.1-codex-mini",
        "claude-3.5-sonnet",
        "claude-3-7-sonnet-20250219",
        "claude-sonnet-4-20250514",
        "claude-opus-4-20250514",
        "gemini-2.0-flash-001",
        "gemini-2.5-pro-preview-05-06"
    )
}

$repoRoot = if ($PSScriptRoot) {
    Split-Path -Parent $PSScriptRoot
}
else {
    Get-RepoRoot -ScriptPath $MyInvocation.MyCommand.Path
}
if (-not $TokenFile) {
    $TokenFile = Join-Path $repoRoot "data\github_token.json"
}

if (-not (Test-Path -LiteralPath $TokenFile)) {
    Write-Error "No existe TokenFile: $TokenFile"
}

$raw = Get-Content -LiteralPath $TokenFile -Raw -Encoding UTF8
$data = $raw | ConvertFrom-Json
$gh = [string]$data.access_token
if (-not $gh) {
    Write-Error "El JSON no contiene access_token."
}

$modelList = New-Object System.Collections.Generic.List[string]
if ($ModelsCsv.Trim()) {
    foreach ($p in ($ModelsCsv.Split(","))) {
        $m = $p.Trim()
        if ($m) { $modelList.Add($m) }
    }
}
elseif ($ModelsFile.Trim()) {
    $mf = Resolve-ModelsFilePath -RawPath $ModelsFile -RepoRoot $repoRoot
    foreach ($m in (Read-ModelsFromFile -Path $mf)) {
        $modelList.Add($m)
    }
}
elseif ($Models -and $Models.Count -gt 0) {
    foreach ($entry in $Models) {
        if (-not $entry) { continue }
        foreach ($p in ($entry -split ",")) {
            $m = $p.Trim()
            if ($m) { $modelList.Add($m) }
        }
    }
}
else {
    $catalog = if ($Preset -eq "wide") { Get-WideModelCatalog } else { Get-NarrowDefaultModelList }
    foreach ($m in $catalog) { $modelList.Add($m) }
}

$chatUrl = ($HostBase.TrimEnd("/") + "/chat/completions")
$responsesHostList = New-Object System.Collections.Generic.List[string]
$rh0 = $ResponsesHostBase.TrimEnd("/")
$responsesHostList.Add($rh0)
$rhAgg = "https://api.githubcopilot.com"
if (-not $responsesHostList.Contains($rhAgg)) {
    $responsesHostList.Add($rhAgg)
}
$headers = Get-CopilotRequestHeaders -Bearer $gh -Style $HeaderStyle

Write-Host "=== Probe GitHub Copilot (Openclaw: GPT -> /v1/responses; NAS: -> /chat/completions) ===" -ForegroundColor Cyan
Write-Host "TokenFile: $TokenFile"
Write-Host "Api: $Api  |  HeaderStyle: $HeaderStyle"
if ($Api -in @("chat", "both")) { Write-Host "Chat URL: POST $chatUrl" }
if ($Api -in @("responses", "both")) {
    Write-Host ("Responses URLs (orden): " + (($responsesHostList | ForEach-Object { "$_/v1/responses" }) -join " ; "))
}
Write-Host "Modelos a probar: $($modelList.Count)"
if (-not $ModelsCsv.Trim() -and -not $ModelsFile.Trim() -and (-not $Models -or $Models.Count -eq 0)) {
    Write-Host "Origen de lista: preset $Preset" -ForegroundColor DarkGray
}
Write-Host ""

if ($DryRun) {
    foreach ($m in $modelList) { Write-Host "  - $m" }
    Write-Host "DryRun: sin peticiones." -ForegroundColor Green
    exit 0
}

$okChat = New-Object System.Collections.Generic.List[string]
$failChat = New-Object System.Collections.Generic.List[string]
$okResp = New-Object System.Collections.Generic.List[string]
$failResp = New-Object System.Collections.Generic.List[string]

foreach ($model in $modelList) {
    if ($Api -in @("chat", "both")) {
        $bodyChat = @{
            model    = $model
            messages = @(@{ role = "user"; content = $Message })
            stream   = $false
        }
        $jsonChat = $bodyChat | ConvertTo-Json -Depth 10 -Compress
        try {
            $r = Invoke-RestMethod -Uri $chatUrl -Headers $headers -Method Post -Body $jsonChat -ContentType "application/json; charset=utf-8" -TimeoutSec 120
            $resolved = $null
            if ($null -ne $r.model) { $resolved = [string]$r.model }
            $snippet = ""
            try {
                $c0 = $r.choices[0].message.content
                if ($null -ne $c0) {
                    $s = [string]$c0
                    $snippet = $s.Replace("`n", " ").Substring(0, [Math]::Min(80, $s.Length))
                }
            }
            catch { }
            Write-Host "[chat OK]   $model" -ForegroundColor Green -NoNewline
            if ($resolved) { Write-Host "  -> model: $resolved" -ForegroundColor DarkGreen } else { Write-Host "" }
            if ($snippet) { Write-Host "            $snippet" -ForegroundColor DarkGray }
            $okChat.Add($model)
        }
        catch {
            $code = Get-HttpStatusFromError -ErrorRecord $_
            $detail = ""
            if ($_.ErrorDetails.Message) {
                $detail = $_.ErrorDetails.Message
                if ($detail.Length -gt 200) { $detail = $detail.Substring(0, 200) + "..." }
            }
            else { $detail = $_.Exception.Message }
            $codeStr = if ($null -ne $code) { " HTTP $code" } else { "" }
            Write-Host "[chat FAIL]$codeStr  $model" -ForegroundColor Yellow
            Write-Host "            $detail" -ForegroundColor DarkGray
            $failChat.Add($model)
        }
        if ($DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }
    }

    if ($Api -in @("responses", "both")) {
        $bodyResp = @{
            model  = $model
            input  = $Message
            stream = $false
        }
        $jsonResp = $bodyResp | ConvertTo-Json -Depth 6 -Compress
        $respOk = $false
        $lastRespDetail = ""
        $lastRespCode = $null
        foreach ($rb in $responsesHostList) {
            $responsesUrl = ($rb.TrimEnd("/") + "/v1/responses")
            try {
                $r2 = Invoke-RestMethod -Uri $responsesUrl -Headers $headers -Method Post -Body $jsonResp -ContentType "application/json; charset=utf-8" -TimeoutSec 120
                $rid = $null
                if ($null -ne $r2.model) { $rid = [string]$r2.model }
                $sn = Get-ResponsesOutputSnippet -ResponseObj $r2
                if ($sn.Length -gt 80) { $sn = $sn.Substring(0, 80) }
                $sn = $sn.Replace("`n", " ")
                Write-Host "[responses OK]   $model  @ $rb" -ForegroundColor Green -NoNewline
                if ($rid) { Write-Host "  -> model: $rid" -ForegroundColor DarkGreen } else { Write-Host "" }
                if ($sn) { Write-Host "                 $sn" -ForegroundColor DarkGray }
                $okResp.Add($model)
                $respOk = $true
                break
            }
            catch {
                $lastRespCode = Get-HttpStatusFromError -ErrorRecord $_
                if ($_.ErrorDetails.Message) {
                    $lastRespDetail = $_.ErrorDetails.Message
                    if ($lastRespDetail.Length -gt 200) { $lastRespDetail = $lastRespDetail.Substring(0, 200) + "..." }
                }
                else { $lastRespDetail = $_.Exception.Message }
                Write-Host "[responses try] HTTP $lastRespCode en $rb" -ForegroundColor DarkYellow
            }
        }
        if (-not $respOk) {
            $cs = if ($null -ne $lastRespCode) { " HTTP $lastRespCode" } else { "" }
            Write-Host "[responses FAIL]$cs  $model" -ForegroundColor Yellow
            Write-Host "                 $lastRespDetail" -ForegroundColor DarkGray
            $failResp.Add($model)
        }
        if ($DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }
    }
}

Write-Host ""
Write-Host "--- Resumen ---" -ForegroundColor Cyan
if ($Api -in @("chat", "both")) {
    Write-Host "chat/completions OK ($($okChat.Count)): $($okChat -join ', ')"
    Write-Host "chat/completions Fallo ($($failChat.Count)): $($failChat -join ', ')"
}
if ($Api -in @("responses", "both")) {
    Write-Host "/v1/responses OK ($($okResp.Count)): $($okResp -join ', ')"
    Write-Host "/v1/responses Fallo ($($failResp.Count)): $($failResp -join ', ')"
}

$totalOk = $okChat.Count + $okResp.Count
if ($totalOk -eq 0) {
    exit 1
}
exit 0
