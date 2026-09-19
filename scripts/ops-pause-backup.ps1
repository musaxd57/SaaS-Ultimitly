# ---------------------------------------------------------------------------
# OPS: DURAKLATMA ONCESI TAM YEDEK (salt-okuma) - MANUEL OPERATOR ARACI.
# Hicbir sey bunu otomatik cagirmaz. Windows operator makinesinde kosulur.
#
# NE ZAMAN: Railway ucretli plandan cikmadan / servisi duraklatmadan ONCE.
# Proje bir sure canli olmayacaksa, o andaki DB'nin tek kopyasi bu dosya olur.
#
# NE YAPAR (prod'a YAZMAZ; pg_dump/psql SELECT salt-okumadir):
#   1) -Fc arsiv dump  -> asil geri yukleme dosyasi (pg_restore ile)
#   2) DUZ SQL kopya   -> ikinci format, soguk saklama icin
#   3) SATIR SAYISI manifesti -> yedek KENDINI ANLATIR + geri donuste
#      "bir sey kayboldu mu" sorusu KARSILASTIRMAYLA yanitlanir
#   4) Her iki dosyanin SHA256'si + tek bir manifest dosyasi
#
# !! FAIL-CLOSED: `pg_restore -l` arsivi okuyamazsa "YEDEK TAMAM" DENMEZ.
# !! YEDEK TEK BASINA KURTARMA DEGILDIR: sifreli alanlar (Hospitable token'lari,
#    takvim feed URL'leri) ancak kasadaki ENCRYPTION_KEY ile acilir. Anahtari
#    bu dosyalarla AYNI yere koyma; ikisi bir arada ele gecerse yedek degil
#    sizintidir, ayri durursa biri kaybolunca oteki ise yaramaz. Ikisini de
#    sakla, AYRI yerlerde.
#
# NEDEN IKI FORMAT: -Fc secici geri yukleme ve paralellik verir ama pg_restore
# ister; duz SQL ise okunabilir ve yillar sonra herhangi bir psql ile geri
# yuklenebilir. Soguk saklamada ikinci formatin maliyeti birkac on MB, faydasi
# "tek arac calismazsa yedek olu" riskinin kalkmasi.
#
# Kosum (normal, yonetici OLMAYAN PowerShell, repo kokunden):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ops-pause-backup.ps1
#
# PostgreSQL surumu OTOMATIK bulunur. Gerekirse: -PgBin 'C:\Program Files\PostgreSQL\18\bin'
# Hedef klasor varsayilan Masaustu; degistirmek icin: -OutDir 'D:\yedek'
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
  [string]$PgBin = '',
  [string]$OutDir = ''
)

# ---------------------------------------------------------------------------
# PostgreSQL bin klasorunu BUL.
#
# DIKKAT: Bu fonksiyon UC operator scriptinde de KOPYA duruyor, BILEREK: bunlar
# felaket-kurtarma araclari ve ortak bir dosyaya bagimli olmamalilar (o dosya
# eksikse arac hic calismaz - kurtarma aninda en istemedigin sey). Birini
# degistiren OTEKILERI de degistirir.
#
# YON KURALI (neden EN YUKSEK surum): pg_dump sunucudan YENI olabilir ama ESKI
# OLAMAZ - eski istemci "server version mismatch" ile yedegi hic aldirmaz.
# TUM gerekli exe'ler AYNI klasorde aranir: "client only" kurulumlarda bazi
# exe'ler eksik olur ve is ilerideki bir adimda patlardi.
# ---------------------------------------------------------------------------
function Resolve-PgBin {
  param([string]$Explicit, [string[]]$Required)
  if ($Explicit) {
    foreach ($exe in $Required) {
      if (-not (Test-Path (Join-Path $Explicit $exe))) { throw "$exe bulunamadi: $Explicit" }
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
      (Test-Path $b) -and (@($Required | Where-Object { -not (Test-Path (Join-Path $b $_)) }).Count -eq 0)
    } | Select-Object -First 1
  if (-not $best) {
    throw ("Gerekli araclarin (" + ($Required -join ', ') + ") tamami tek bir PostgreSQL surumunde bulunamadi. -PgBin ile elle ver.")
  }
  $bin = Join-Path $best.FullName 'bin'
  Write-Host "PostgreSQL $($best.Name) kullaniliyor: $bin"
  return $bin
}

# Manifeste girecek tablolar. Prisma'da @@map YOK -> tablo adi = model adi,
# BUYUK/kucuk harfe DUYARLI, bu yuzden SQL'de cift tirnak SART.
# Liste "veri kaybi olur mu" sorusunu yanitlayanlarla sinirli; gecici/turetilmis
# tablolar (RateLimitCounter, SystemLock, WebhookEvent) bilerek disarida.
$TABLES = @(
  'Organization', 'User', 'Property', 'CalendarSource', 'Reservation',
  'Conversation', 'Message', 'KnowledgeBaseItem', 'MessageTemplate', 'Task',
  'TaskUpdate', 'AutomationRule', 'Subscription', 'Invoice', 'CheckoutConsent',
  'RiskEvent', 'ChannelConnection', 'IngestEvent', 'Signal', 'PropertyMemory',
  'MessageOutbox', 'EmailOutbox', 'AuditLog', 'ErasureTombstone'
)

$sec = Read-Host -AsSecureString "Railway PUBLIC/PROXY DATABASE_URL"
$ptr = [IntPtr]::Zero
$sqlFile = $null
try {
  $PgBin = Resolve-PgBin -Explicit $PgBin -Required @("pg_dump.exe", "pg_restore.exe", "psql.exe")
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

  if (-not $OutDir) { $OutDir = [Environment]::GetFolderPath("Desktop") }
  if (-not (Test-Path $OutDir)) { throw "Hedef klasor yok: $OutDir" }
  $stamp = Get-Date -Format "yyyy-MM-dd-HHmmss"
  # !! Dosya adindaki "pause" ETIKETTIR: restore provasi varsayilan olarak
  # "post-contract" desenini arar, bu yuzden asagida provanin TAM komutu
  # -DumpPattern ile birlikte basilir. Adi degistirirsen o satiri da degistir.
  $base = Join-Path $OutDir "lixus-prod-pause-$stamp"
  $dump = "$base.dump"
  $sqlOut = "$base.sql"
  $manifest = "$base-manifest.txt"

  Write-Host ""
  Write-Host "[1/4] Arsiv dump (-Fc) aliniyor..." -ForegroundColor Cyan
  & (Join-Path $PgBin "pg_dump.exe") -Fc -f "$dump"
  if ($LASTEXITCODE -ne 0) { throw "PG_DUMP (-Fc) BASARISIZ (exit=$LASTEXITCODE) - YEDEK GECERSIZ" }

  Write-Host "[2/4] Arsiv dogrulaniyor (pg_restore -l)..." -ForegroundColor Cyan
  $toc = & (Join-Path $PgBin "pg_restore.exe") -l "$dump"
  if ($LASTEXITCODE -ne 0) { throw "ARSIV DOGRULAMA BASARISIZ (pg_restore -l exit=$LASTEXITCODE) - YEDEK GECERSIZ" }
  $tocCount = ($toc | Where-Object { $_ -and -not $_.StartsWith(";") }).Count

  Write-Host "[3/4] Duz SQL kopya aliniyor (soguk saklama icin)..." -ForegroundColor Cyan
  & (Join-Path $PgBin "pg_dump.exe") --format=plain --no-owner --no-privileges -f "$sqlOut"
  if ($LASTEXITCODE -ne 0) { throw "PG_DUMP (plain) BASARISIZ (exit=$LASTEXITCODE) - YEDEK GECERSIZ" }

  Write-Host "[4/4] Satir sayisi manifesti cikariliyor..." -ForegroundColor Cyan
  # PS 5.1 native argumanlardaki gomulu cift tirnagi BOZAR (restore provasinin
  # 2026-07-30 canli dersi) -> SQL dosyaya yazilip psql -f ile kosulur.
  $union = ($TABLES | ForEach-Object { "SELECT '$_' AS t, count(*) AS n FROM `"$_`"" }) -join " UNION ALL "
  $sqlFile = Join-Path $env:TEMP "lixus-rowcount-$stamp.sql"
  Set-Content -Path $sqlFile -Value "$union ORDER BY 1;" -Encoding ASCII
  $counts = & (Join-Path $PgBin "psql.exe") -X -A -F '|' -t -v ON_ERROR_STOP=1 -f "$sqlFile"
  if ($LASTEXITCODE -ne 0) { throw "SATIR SAYIMI BASARISIZ (psql exit=$LASTEXITCODE) - manifest eksik, yedek dogrulanmadi" }

  $dumpSha = (Get-FileHash "$dump" -Algorithm SHA256).Hash
  $sqlSha = (Get-FileHash "$sqlOut" -Algorithm SHA256).Hash
  $dumpSize = (Get-Item "$dump").Length
  $sqlSize = (Get-Item "$sqlOut").Length

  $lines = @()
  $lines += "LIXUS AI - DURAKLATMA ONCESI YEDEK MANIFESTI"
  $lines += "Tarih (yerel): " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
  $lines += "Tarih (UTC)  : " + ((Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss") + "Z")
  $lines += "Veritabani   : " + $env:PGDATABASE + " @ " + $env:PGHOST
  $lines += ""
  $lines += "DOSYALAR"
  $lines += "  arsiv : " + (Split-Path $dump -Leaf)
  $lines += "          boyut=$dumpSize bayt  TOC=$tocCount girdi"
  $lines += "          SHA256=$dumpSha"
  $lines += "  duz   : " + (Split-Path $sqlOut -Leaf)
  $lines += "          boyut=$sqlSize bayt"
  $lines += "          SHA256=$sqlSha"
  $lines += ""
  $lines += "SATIR SAYILARI (geri donuste BUNUNLA karsilastir)"
  foreach ($row in $counts) {
    if ($row) {
      $p = $row.Split("|")
      $lines += ("  " + $p[0].PadRight(22) + $p[1])
    }
  }
  $lines += ""
  $lines += "KURTARMA ICIN BU DOSYA TEK BASINA YETMEZ:"
  $lines += "  - ENCRYPTION_KEY (kasada, bu dosyalardan AYRI yerde) olmadan"
  $lines += "    Hospitable token'lari ve takvim feed URL'leri ACILMAZ."
  $lines += "  - .env degerleri (AUTH_SECRET, Paddle, Resend/SMTP, Tigris) ayrica saklanir."
  $lines += "  - Tigris 'lixus-uploads' bucket'i AYRI bir saglayicidir, bu dump'ta YOKTUR."
  Set-Content -Path $manifest -Value $lines -Encoding UTF8

  Write-Host ""
  Write-Host "YEDEK TAMAM" -ForegroundColor Green
  $lines | ForEach-Object { Write-Host $_ }
  Write-Host ""
  Write-Host "SIRADAKI ADIM - PROVA (bunu KOSMADAN yedek dogrulanmis SAYILMAZ):" -ForegroundColor Yellow
  Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ops-restore-drill.ps1 -ExpectedSha $dumpSha -DumpPattern 'lixus-prod-pause-*.dump'"
} catch {
  Write-Host "YEDEK ALINAMADI: $_" -ForegroundColor Red
  exit 1
} finally {
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($ptr) }
  $sec.Dispose()
  if ($sqlFile -and (Test-Path $sqlFile)) { Remove-Item $sqlFile -ErrorAction SilentlyContinue }
  Remove-Item Env:PGHOST, Env:PGPORT, Env:PGUSER, Env:PGPASSWORD, Env:PGDATABASE, Env:PGSSLMODE -ErrorAction SilentlyContinue
  Write-Host "GIZLI DEGISKENLER TEMIZLENDI"
}
