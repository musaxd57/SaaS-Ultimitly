# ---------------------------------------------------------------------------
# OPS: PROD YEDEK ALMA (salt-okuma) - MANUEL OPERATOR ARACI, hicbir sey bunu
# otomatik cagirmaz. Windows operator makinesinde kosulur.
#
# Ne yapar: Railway PUBLIC/PROXY DATABASE_URL'i GIZLI ister (argv'ye/gecmise
# yazilmaz; PG* env degiskenleriyle gecirilir), pg_dump -Fc ile Masaustune
# tarihli dump alir, pg_restore -l kapisindan gecmeden "YEDEK TAMAM" demez,
# boyut + TOC + SHA256 basar. Prod'a YAZMAZ (pg_dump salt-okumadir).
#
# Kosum (normal, yonetici OLMAYAN PowerShell):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ops-backup-prod.ps1
#
# PostgreSQL surumu OTOMATIK bulunur (en yuksek kurulu surum; secim ekrana
# basilir). Gerekirse elle: -PgBin 'C:\Program Files\PostgreSQL\18\bin'
#
# Cikan SHA256'yi not et - restore provasi (ops-restore-drill.ps1) onu ister.
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
  # BOS = otomatik bul (en yuksek kurulu surum, asagidaki Resolve-PgBin).
  # Elle verilen deger HER ZAMAN kazanir.
  [string]$PgBin = ''
)

# ---------------------------------------------------------------------------
# PostgreSQL bin klasorunu BUL.
#
# Sabit surum numarasi yazmak her yil bayatliyor: script 17'ye pinliydi,
# operator makinesi 18'e gecince -PgBin elle verilmeden kosmuyordu (2026-08-02).
#
# YON KURALI (neden EN YUKSEK surum): pg_dump/pg_restore sunucudan YENI
# olabilir ama ESKI OLAMAZ - eski istemci "server version mismatch" ile yedegi
# hic aldirmaz. Railway sunucusu yukseltilse bile en yuksek yerel surum dogru
# secimdir; yanlis yon sessiz degil gurultulu bir arizadir ama yedegi
# aldirmadigi icin bedeli yuksektir.
#
# TUM gerekli exe'ler AYNI klasorde aranir: "client only" kurulumlarda
# psql/pg_dump vardir ama initdb/pg_ctl YOKTUR - yalniz tek bir exe'ye bakan
# bir kontrol boyle bir kurulumu secer ve is ilerideki bir adimda patlardi.
#
# DIKKAT: Bu fonksiyon iki operator scriptinde de KOPYA duruyor, BILEREK: bunlar
# felaket-kurtarma araclari ve ortak bir dosyaya bagimli olmamalilar (o dosya
# eksikse arac hic calismaz - kurtarma aninda en istemedigin sey). Birini
# degistiren OTEKINI de degistirir.
# ---------------------------------------------------------------------------
function Resolve-PgBin {
  param([string]$Explicit, [string[]]$Required, [switch]$NeedsServer)
  # !! SUNUCU BILESENI KONTROLU (2026-09-19 canli provasinin dersi): initdb.exe
  # "Command Line Tools" kurulumunda da VARDIR ama sunucunun veri dosyalari
  # (share\postgres.bki) YOKTUR -> initdb "postgres.bki does not exist" ile
  # patlar. Eski kontrol yalniz exe'lere bakiyordu: EN YUKSEK surum olan
  # ISTEMCI kurulumu seciliyor, TAM KURULU eski surum atlaniyordu. Yedek alma
  # scriptleri bu switch'i GECMEZ (onlara sunucu gerekmiyor) - ayrim bilincli.
  if ($Explicit) {
    foreach ($exe in $Required) {
      if (-not (Test-Path (Join-Path $Explicit $exe))) { throw "$exe bulunamadi: $Explicit" }
    }
    if ($NeedsServer -and -not (Test-Path (Join-Path (Split-Path $Explicit -Parent) "share\postgres.bki"))) {
      throw "SUNUCU BILESENI YOK: $Explicit -> share\postgres.bki bulunamadi (yalniz Command Line Tools kurulu). initdb bu kurulumla kosamaz."
    }
    return $Explicit
  }
  $roots = @($env:ProgramW6432, $env:ProgramFiles, 'C:\Program Files') |
    Where-Object { $_ } | Select-Object -Unique |
    ForEach-Object { Join-Path $_ 'PostgreSQL' } |
    Where-Object { Test-Path $_ }
  if (-not $roots) { throw "PostgreSQL kurulumu bulunamadi. -PgBin ile bin klasorunu elle ver." }
  $best = Get-ChildItem -Path $roots -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d+$' } |
    Sort-Object { [int]$_.Name } -Descending |
    Where-Object {
      $b = Join-Path $_.FullName 'bin'
      (Test-Path $b) -and (@($Required | Where-Object { -not (Test-Path (Join-Path $b $_)) }).Count -eq 0) -and
      ((-not $NeedsServer) -or (Test-Path (Join-Path $_.FullName "share\postgres.bki")))
    } | Select-Object -First 1
  if (-not $best) {
    throw ("Gerekli araclarin (" + ($Required -join ', ') + ") tamami tek bir PostgreSQL surumunde bulunamadi. -PgBin ile elle ver.")
  }
  $bin = Join-Path $best.FullName 'bin'
  # Secim GORUNUR olmali: sessiz otomatik secim, kurtarma aracinda yanlis
  # surumle kosuldugunu fark etmemek demektir.
  Write-Host "PostgreSQL $($best.Name) kullaniliyor: $bin"
  return $bin
}

$sec = Read-Host -AsSecureString "Railway PUBLIC/PROXY DATABASE_URL"
$ptr = [IntPtr]::Zero
try {
  $PgBin = Resolve-PgBin -Explicit $PgBin -Required @("pg_dump.exe", "pg_restore.exe")
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($sec)
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringUni($ptr)
  $u = [Uri]$plain
  $plain = $null
  $userInfo = $u.UserInfo.Split(":", 2)
  $env:PGHOST = $u.Host
  $env:PGPORT = if ($u.Port -gt 0) { $u.Port } else { 5432 }
  $env:PGUSER = [Uri]::UnescapeDataString($userInfo[0])
  $env:PGPASSWORD = if ($userInfo.Count -gt 1) { [Uri]::UnescapeDataString($userInfo[1]) } else { "" }
  $env:PGDATABASE = [Uri]::UnescapeDataString($u.AbsolutePath.TrimStart("/"))
  $env:PGSSLMODE = "require"
  $stamp = Get-Date -Format "yyyy-MM-dd-HHmmss"
  $out = Join-Path ([Environment]::GetFolderPath("Desktop")) "lixus-prod-post-contract-$stamp.dump"
  & (Join-Path $PgBin "pg_dump.exe") -Fc -f "$out"
  if ($LASTEXITCODE -ne 0) { throw "PG_DUMP BASARISIZ (exit=$LASTEXITCODE) - YEDEK GECERSIZ" }
  $toc = & (Join-Path $PgBin "pg_restore.exe") -l "$out"
  if ($LASTEXITCODE -ne 0) { throw "ARSIV DOGRULAMA BASARISIZ (pg_restore -l exit=$LASTEXITCODE) - YEDEK GECERSIZ" }
  $tocCount = ($toc | Where-Object { $_ -and -not $_.StartsWith(";") }).Count
  $size = (Get-Item "$out").Length
  $sha = (Get-FileHash "$out" -Algorithm SHA256).Hash
  Write-Host "YEDEK TAMAM" -ForegroundColor Green
  Write-Host "Dosya : $out"
  Write-Host "Boyut : $size bayt"
  Write-Host "TOC   : $tocCount girdi (yorum satirlari haric)"
  Write-Host "SHA256: $sha"
  Write-Host ""
  Write-Host "Sonraki adim: prova icin bu SHA'yi kullan:" -ForegroundColor Cyan
  Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ops-restore-drill.ps1 -ExpectedSha $sha"
} catch {
  Write-Host "YEDEK ALINAMADI: $_" -ForegroundColor Red
  exit 1
} finally {
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($ptr) }
  $sec.Dispose()
  Remove-Item Env:PGHOST, Env:PGPORT, Env:PGUSER, Env:PGPASSWORD, Env:PGDATABASE, Env:PGSSLMODE -ErrorAction SilentlyContinue
  Write-Host "GIZLI DEGISKENLER TEMIZLENDI"
}
