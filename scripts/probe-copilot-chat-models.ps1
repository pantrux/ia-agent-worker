<#
.SYNOPSIS
  Prueba que modelos responden en GitHub Copilot (solo POST chat/completions, mismo flujo que validate-nas-copilot-token.ps1 [3]).

.DESCRIPTION
  Usa access_token de data/github_token.json como Bearer y las cabeceras de cliente Copilot (vscode/copilot-chat).
  POST https://api.githubcopilot.com/chat/completions (sin /v1), igual que el SDK OpenAI en el contenedor NAS.

  Por defecto recorre una lista amplia de ids de modelo; muchos devolveran 400/404 segun plan y disponibilidad.
  Personaliza con -Models, -ModelsFile o -ModelsCsv.

.PARAMETER TokenFile
  JSON con access_token (defecto: data/github_token.json bajo la raiz del repo).

.PARAMETER HostBase
  Base URL del API Copilot (defecto: https://api.githubcopilot.com).

.PARAMETER Message
  Mensaje de usuario corto para cada prueba.

.PARAMETER Models
  Lista explicita de ids de modelo (PowerShell: -Models a -Models b).

.PARAMETER ModelsFile
  Archivo UTF-8: un id de modelo por linea; lineas vacias y # comentario ignoradas.

.PARAMETER ModelsCsv
  Lista separada por comas (ej: gpt-4o,gpt-4o-mini).

.PARAMETER DelayMs
  Pausa entre peticiones (rate limit).

.PARAMETER DryRun
  Imprime modelos y URL; no hace POST.

.EXAMPLE
  .\scripts\probe-copilot-chat-models.ps1

.EXAMPLE
  .\scripts\probe-copilot-chat-models.ps1 -ModelsCsv "gpt-4o,gpt-4o-mini,o3-mini"

.EXAMPLE
  .\scripts\probe-copilot-chat-models.ps1 -ModelsFile .\mis-modelos.txt
#>

[CmdletBinding()]
param(
    [string] $TokenFile = "",
    [string] $HostBase = "https://api.githubcopilot.com",
    [string] $Message = "Responde exactamente la palabra PING y nada mas.",
    [string[]] $Models = @(),
    [string] $ModelsFile = "",
    [string] $ModelsCsv = "",
    [int] $DelayMs = 400,
    [switch] $DryRun
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    param([string] $ScriptPath)
    $scriptsDir = Split-Path -Parent $ScriptPath
    return (Split-Path -Parent $scriptsDir)
}

function Get-ChatClientHeaders {
    param([string] $Bearer)
    return @{
        Authorization            = "Bearer $Bearer"
        "Editor-Version"         = "vscode/1.90.0"
        "Editor-Plugin-Version"  = "copilot-chat/0.17.2024051401"
        "User-Agent"             = "GitHubCopilot/1.155.0"
        "Copilot-Integration-Id" = "vscode-chat"
    }
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

function Read-ModelsFromFile {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Error "No existe ModelsFile: $Path"
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

function Get-DefaultModelList {
    # Lista amplia: lo que responda depende del plan Copilot y de GitHub; sirve como barrido inicial.
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
    foreach ($m in (Read-ModelsFromFile -Path $ModelsFile.Trim())) {
        $modelList.Add($m)
    }
}
elseif ($Models -and $Models.Count -gt 0) {
    foreach ($m in $Models) {
        if ($m.Trim()) { $modelList.Add($m.Trim()) }
    }
}
else {
    foreach ($m in (Get-DefaultModelList)) { $modelList.Add($m) }
}

$url = ($HostBase.TrimEnd("/") + "/chat/completions")
$hChat = Get-ChatClientHeaders -Bearer $gh

Write-Host "=== Probe Copilot chat/completions (solo metodo 3) ===" -ForegroundColor Cyan
Write-Host "TokenFile: $TokenFile"
Write-Host "POST $url"
Write-Host "Modelos a probar: $($modelList.Count)"
Write-Host ""

if ($DryRun) {
    foreach ($m in $modelList) { Write-Host "  - $m" }
    Write-Host "DryRun: sin peticiones." -ForegroundColor Green
    exit 0
}

$ok = New-Object System.Collections.Generic.List[string]
$fail = New-Object System.Collections.Generic.List[string]

foreach ($model in $modelList) {
    $body = @{
        model    = $model
        messages = @(@{ role = "user"; content = $Message })
        stream   = $false
    }
    $json = $body | ConvertTo-Json -Depth 10 -Compress
    try {
        $r = Invoke-RestMethod -Uri $url -Headers $hChat -Method Post -Body $json -ContentType "application/json; charset=utf-8" -TimeoutSec 120
        $resolved = $null
        if ($null -ne $r.model) { $resolved = [string]$r.model }
        $snippet = ""
        try {
            $c0 = $r.choices[0].message.content
            if ($null -ne $c0) { $snippet = ([string]$c0).Replace("`n", " ").Substring(0, [Math]::Min(80, ([string]$c0).Length)) }
        }
        catch { }
        Write-Host "[OK]   $model" -ForegroundColor Green -NoNewline
        if ($resolved) { Write-Host "  -> model en respuesta: $resolved" -ForegroundColor DarkGreen }
        else { Write-Host "" }
        if ($snippet) { Write-Host "       contenido (recorte): $snippet" -ForegroundColor DarkGray }
        $ok.Add($model)
    }
    catch {
        $code = Get-HttpStatusFromError -ErrorRecord $_
        $detail = ""
        if ($_.ErrorDetails.Message) {
            $detail = $_.ErrorDetails.Message
            if ($detail.Length -gt 200) { $detail = $detail.Substring(0, 200) + "..." }
        }
        else {
            $detail = $_.Exception.Message
        }
        $codeStr = if ($null -ne $code) { " HTTP $code" } else { "" }
        Write-Host "[FAIL]$codeStr  $model" -ForegroundColor Yellow
        Write-Host "       $detail" -ForegroundColor DarkGray
        $fail.Add($model)
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
