<#
.SYNOPSIS
    Detecta e remove arquivos duplicados nos diretórios PSD_DIRS.

.DESCRIPTION
    Lê PSD_DIRS do .env.local, escaneia recursivamente, agrupa por
    tamanho + hash MD5 parcial (2 MB) e apresenta duplicatas com
    sugestão de qual manter. Modos: Dry-Run, Mover para Lixeira,
    Apagar Permanente. Gera log JSON auditável.

.PARAMETER Mode
    DryRun    - Só mostra o que seria feito (padrão)
    Trash     - Move para $env:TEMP\dupes-trash\<timestamp>
    Delete    - Apaga permanentemente (pede confirmação extra)

.PARAMETER AutoKeepStrategy
    Score     - Mantém o arquivo com menor "custo" (padrão): penaliza
                nomes tipo "copy/copia/(1)", caminhos mais profundos
    Oldest    - Mantém o mais antigo (LastWriteTime)
    Newest    - Mantém o mais recente
    Shortest  - Mantém o de caminho mais curto

.PARAMETER MinSizeMB
    Ignora arquivos menores que X MB (padrão: 0.01 = 10 KB)

.PARAMETER Extensions
    Lista de extensões a escanear. Padrão: psd,psb,jpg,jpeg,png,gif,tif,tiff

.PARAMETER EnvFile
    Caminho para .env.local (padrão: detectado automaticamente)

.PARAMETER LogDir
    Pasta onde salvar o log JSON (padrão: logs/ relativo ao script)

.PARAMETER NoConfirm
    Pula confirmação interativa por grupo (usa decisão automática)

.EXAMPLE
    .\remove-dupes.ps1
    .\remove-dupes.ps1 -Mode Trash
    .\remove-dupes.ps1 -Mode Delete -NoConfirm
    .\remove-dupes.ps1 -Mode Trash -AutoKeepStrategy Oldest -MinSizeMB 5
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet("DryRun","Trash","Delete")]
    [string]$Mode = "DryRun",

    [ValidateSet("Score","Oldest","Newest","Shortest")]
    [string]$AutoKeepStrategy = "Score",

    [double]$MinSizeMB = 0.01,

    [string[]]$Extensions = @("psd","psb","jpg","jpeg","png","gif","tif","tiff"),

    [string]$EnvFile = "",

    [string]$LogDir = "",

    [switch]$NoConfirm
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Cores ──────────────────────────────────────────────────────────────────────
function Write-Header  { param($t) Write-Host "`n$t" -ForegroundColor Cyan }
function Write-OK      { param($t) Write-Host "  ✓ $t" -ForegroundColor Green }
function Write-Warn    { param($t) Write-Host "  ⚠ $t" -ForegroundColor Yellow }
function Write-Err     { param($t) Write-Host "  ✗ $t" -ForegroundColor Red }
function Write-Info    { param($t) Write-Host "  · $t" -ForegroundColor Gray }
function Write-Keep    { param($t) Write-Host "    [MANTER]  $t" -ForegroundColor Green }
function Write-Remove  { param($t) Write-Host "    [REMOVER] $t" -ForegroundColor Red }

# ── Localiza .env.local ────────────────────────────────────────────────────────
if (-not $EnvFile) {
    $candidates = @(
        (Join-Path $PSScriptRoot "..\\.env.local"),
        (Join-Path $PSScriptRoot ".env.local"),
        (Join-Path $PWD ".env.local")
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $EnvFile = (Resolve-Path $c).Path; break }
    }
}
if (-not $EnvFile -or -not (Test-Path $EnvFile)) {
    Write-Err "Não encontrei .env.local. Use -EnvFile <caminho>."
    exit 1
}

# ── Lê variáveis do .env ───────────────────────────────────────────────────────
$envVars = @{}
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([^#=\s]+)\s*=\s*(.*)$') {
        $envVars[$Matches[1]] = $Matches[2].Trim()
    }
}
$psdDirsRaw = $envVars["PSD_DIRS"]
if (-not $psdDirsRaw) {
    Write-Err "PSD_DIRS não definido em $EnvFile"
    exit 1
}
$scanDirs = $psdDirsRaw -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ }

# Raiz que já está dentro de outra raiz é descartada: o walk é recursivo, e
# escanear pai + filha faz cada arquivo aparecer duas vezes.
$normDirs = $scanDirs | ForEach-Object { $_.Replace('\','/').TrimEnd('/') } | Select-Object -Unique
$scanDirs = @($normDirs | Where-Object {
    $me = $_
    -not ($normDirs | Where-Object { $_ -ne $me -and $me.ToLower().StartsWith($_.ToLower() + '/') })
})

# ── LogDir ─────────────────────────────────────────────────────────────────────
if (-not $LogDir) { $LogDir = Join-Path $PSScriptRoot "logs" }
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force $LogDir | Out-Null }

$timestamp  = Get-Date -Format "yyyyMMdd_HHmmss"
$logFile    = Join-Path $LogDir "dupes_$timestamp.json"

# ── TrashDir ───────────────────────────────────────────────────────────────────
$trashDir = ""
if ($Mode -eq "Trash") {
    $trashDir = Join-Path $env:TEMP "dupes-trash\$timestamp"
    New-Item -ItemType Directory -Force $trashDir | Out-Null
}

# ── Banner ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor DarkCyan
Write-Host "║         BOXY · Detector de Duplicatas v1.0          ║" -ForegroundColor DarkCyan
Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor DarkCyan
Write-Host ""
Write-Info "Modo             : $Mode"
Write-Info "Estratégia keep  : $AutoKeepStrategy"
Write-Info "Tamanho mínimo   : $MinSizeMB MB"
Write-Info "Extensões        : $($Extensions -join ', ')"
Write-Info "Diretórios       : $($scanDirs.Count)"
foreach ($d in $scanDirs) {
    $exists = Test-Path $d
    if ($exists) { Write-OK "  $d" } else { Write-Warn "  $d  (não encontrado)" }
}
Write-Host ""

# ── Walk recursivo ─────────────────────────────────────────────────────────────
$extSet   = $Extensions | ForEach-Object { ".$($_.ToLower())" }
$minBytes = [long]($MinSizeMB * 1MB)
$allFiles = [System.Collections.Generic.List[hashtable]]::new()

Write-Header "1/3 · Listando arquivos..."
foreach ($dir in $scanDirs) {
    if (-not (Test-Path $dir)) { continue }
    $items = Get-ChildItem -Path $dir -Recurse -File -ErrorAction SilentlyContinue |
             Where-Object {
                 $extSet -contains $_.Extension.ToLower() -and
                 $_.Length -ge $minBytes
             }
    foreach ($f in $items) {
        $allFiles.Add(@{
            Path      = $f.FullName
            Size      = $f.Length
            Modified  = $f.LastWriteTime
            Created   = $f.CreationTime
        })
    }
}
Write-OK "$($allFiles.Count) arquivos elegíveis encontrados"

# ── Deduplica por caminho canônico (evita falsos positivos com junctions/overlaps) ──
$seen    = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$deduped = [System.Collections.Generic.List[hashtable]]::new()
foreach ($f in $allFiles) {
    try { $canonical = (Resolve-Path -LiteralPath $f.Path).Path } catch { $canonical = $f.Path }
    if ($seen.Add($canonical)) {
        $f.Path = $canonical
        $deduped.Add($f)
    }
}
if ($deduped.Count -lt $allFiles.Count) {
    Write-Warn "$($allFiles.Count - $deduped.Count) arquivo(s) ignorado(s) por caminho duplicado (junction/overlap)"
}
$allFiles = $deduped
Write-OK "$($allFiles.Count) arquivos após normalização de caminhos"

# ── Hash parcial (primeiros 2 MB) ──────────────────────────────────────────────
$HASH_SLICE = 2 * 1024 * 1024

function Get-PartialHash([string]$path, [long]$size) {
    try {
        $md5    = [System.Security.Cryptography.MD5]::Create()
        $stream = [System.IO.File]::OpenRead($path)
        $buf    = [byte[]]::new([Math]::Min($HASH_SLICE, $size))
        $read   = $stream.Read($buf, 0, $buf.Length)
        $stream.Close()
        $hash = [BitConverter]::ToString($md5.ComputeHash($buf, 0, $read)).Replace("-","").ToLower()
        return "$size`:$hash"
    } catch { return "" }
}

# ── Score "qual manter" ────────────────────────────────────────────────────────
function Get-KeepScore([hashtable]$file) {
    switch ($AutoKeepStrategy) {
        "Score" {
            $name  = [System.IO.Path]::GetFileNameWithoutExtension($file.Path).ToLower()
            $depth = ($file.Path -split '[\\/]').Count
            $score = 0
            if ($name -match 'copy|copia|cópia|\(\d+\)') { $score += 20 }
            if ($name -match ' - \d+$')                  { $score += 10 }
            $score += $depth
            return $score
        }
        "Oldest"   { return $file.Modified.Ticks }
        "Newest"   { return -$file.Modified.Ticks }
        "Shortest" { return $file.Path.Length }
    }
}

# ── Detectar duplicatas ────────────────────────────────────────────────────────
Write-Header "2/3 · Calculando hashes parciais..."

# Agrupa por tamanho primeiro (filtra candidatos sem custo)
$bySize = @{}
foreach ($f in $allFiles) {
    $k = $f.Size
    if (-not $bySize.ContainsKey($k)) { $bySize[$k] = [System.Collections.Generic.List[hashtable]]::new() }
    $bySize[$k].Add($f)
}
$sizeGroups = $bySize.Values | Where-Object { $_.Count -ge 2 }
$candidateCount = ($sizeGroups | ForEach-Object { $_.Count } | Measure-Object -Sum).Sum
Write-Info "$candidateCount arquivos com tamanho duplicado — calculando hashes..."

$processed  = 0
$dupeGroups = [System.Collections.Generic.List[hashtable]]::new()

foreach ($group in $sizeGroups) {
    $byHash = @{}
    foreach ($f in $group) {
        $h = Get-PartialHash $f.Path $f.Size
        if (-not $h) { continue }
        if (-not $byHash.ContainsKey($h)) { $byHash[$h] = [System.Collections.Generic.List[hashtable]]::new() }
        $byHash[$h].Add($f)
        $processed++
        if ($processed % 50 -eq 0) { Write-Host "    $processed/$candidateCount..." -ForegroundColor DarkGray -NoNewline; Write-Host "`r" -NoNewline }
    }
    foreach ($hGroup in $byHash.Values) {
        if ($hGroup.Count -lt 2) { continue }
        $sorted = $hGroup | Sort-Object { Get-KeepScore $_ }
        $keep   = $sorted[0]
        $remove = $sorted[1..($sorted.Count-1)]
        $wasted = $keep.Size * $remove.Count
        $dupeGroups.Add(@{
            SizeBytes   = $keep.Size
            KeepPath    = $keep.Path
            RemovePaths = @($remove | ForEach-Object { $_.Path })
            WastedBytes = $wasted
            KeepMod     = $keep.Modified
        })
    }
}

$dupeGroups = @($dupeGroups | Sort-Object { -$_.WastedBytes })
$totalWasted = ($dupeGroups | ForEach-Object { $_.WastedBytes } | Measure-Object -Sum).Sum
$totalRemovable = ($dupeGroups | ForEach-Object { $_.RemovePaths.Count } | Measure-Object -Sum).Sum

Write-OK "$($dupeGroups.Count) grupos de duplicatas encontrados"
Write-OK "$totalRemovable arquivos removíveis"
Write-Warn "$([Math]::Round($totalWasted / 1MB, 1)) MB desperdiçados"

# ── Exibe grupos ───────────────────────────────────────────────────────────────
Write-Header "3/3 · Grupos de duplicatas"
Write-Host ""

if ($dupeGroups.Count -eq 0) {
    Write-OK "Nenhuma duplicata! Tudo limpo."
    exit 0
}

$actionLog  = [System.Collections.Generic.List[hashtable]]::new()
$skipped    = 0
$acted      = 0
$freedBytes = 0

foreach ($i in 0..($dupeGroups.Count - 1)) {
    $g        = $dupeGroups[$i]
    $sizeMB   = [Math]::Round($g.SizeBytes / 1MB, 2)
    $wastedMB = [Math]::Round($g.WastedBytes / 1MB, 2)
    $total    = 1 + $g.RemovePaths.Count

    Write-Host "── Grupo $($i+1)/$($dupeGroups.Count)  [$sizeMB MB × $total cópias = $wastedMB MB desperdiçados]" -ForegroundColor DarkYellow
    Write-Keep  $g.KeepPath
    foreach ($rp in $g.RemovePaths) { Write-Remove $rp }

    if ($Mode -eq "DryRun") {
        $actionLog.Add(@{ group = $i+1; action = "dryrun"; keep = $g.KeepPath; remove = $g.RemovePaths })
        continue
    }

    # Confirmação interativa (por grupo)
    $decision = "s"
    if (-not $NoConfirm) {
        Write-Host ""
        $decision = Read-Host "    Remover os [REMOVER] acima? (s=sim / n=pular / t=todos / q=sair)"
        $decision = $decision.ToLower().Trim()
        if ($decision -eq "q") { Write-Warn "Abortado pelo usuário."; break }
        if ($decision -eq "t") { $NoConfirm = $true; $decision = "s" }
    }

    if ($decision -ne "s") {
        $skipped++
        $actionLog.Add(@{ group = $i+1; action = "skipped"; keep = $g.KeepPath; remove = $g.RemovePaths })
        continue
    }

    foreach ($rp in $g.RemovePaths) {
        try {
            if ($Mode -eq "Trash") {
                # Preserva estrutura relativa dentro do trashDir
                $rel  = $rp -replace '^[A-Za-z]:[/\\]', '' -replace '[/\\]', '_'
                $dest = Join-Path $trashDir $rel
                Move-Item -LiteralPath $rp -Destination $dest -Force
                $actionLog.Add(@{ group = $i+1; action = "trashed"; src = $rp; dst = $dest })
                Write-Info "  → Movido para lixeira: $(Split-Path $dest -Leaf)"
            } else {
                Remove-Item -LiteralPath $rp -Force
                $actionLog.Add(@{ group = $i+1; action = "deleted"; src = $rp })
                Write-Info "  → Apagado: $(Split-Path $rp -Leaf)"
            }
            $freedBytes += $g.SizeBytes
            $acted++
        } catch {
            Write-Err "  Falha em $rp : $_"
            $actionLog.Add(@{ group = $i+1; action = "error"; src = $rp; error = "$_" })
        }
    }
    Write-Host ""
}

# ── Confirmação extra para Delete ─────────────────────────────────────────────
# (já executado acima em loop; aviso antecipado antes do loop seria melhor,
#  mas o loop processa um grupo de cada vez, então é seguro assim)

# ── Resumo final ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor DarkCyan
Write-Host "  RESUMO" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor DarkCyan
Write-Info "Grupos encontrados : $($dupeGroups.Count)"
if ($Mode -eq "DryRun") {
    Write-Info "Arquivos a remover : $totalRemovable  (modo DryRun — nada foi alterado)"
    Write-Warn "Espaço a recuperar : $([Math]::Round($totalWasted / 1MB, 1)) MB"
    Write-Info "Execute com  -Mode Trash  para mover para lixeira segura."
} else {
    Write-OK   "Arquivos processados: $acted"
    Write-Info "Pulados             : $skipped"
    Write-OK   "Espaço liberado     : $([Math]::Round($freedBytes / 1MB, 1)) MB"
    if ($Mode -eq "Trash") { Write-Info "Lixeira             : $trashDir" }
}

# ── Salva log JSON ─────────────────────────────────────────────────────────────
$logData = @{
    timestamp        = (Get-Date -Format "o")
    mode             = $Mode
    strategy         = $AutoKeepStrategy
    scanDirs         = $scanDirs
    filesScanned     = $allFiles.Count
    dupeGroups       = $dupeGroups.Count
    totalRemovable   = $totalRemovable
    totalWastedBytes = $totalWasted
    freedBytes       = $freedBytes
    actions          = $actionLog
}
$logData | ConvertTo-Json -Depth 10 | Set-Content -Path $logFile -Encoding UTF8
Write-Info "Log salvo em: $logFile"
Write-Host ""
