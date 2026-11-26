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

  # !! SURUM UYUMU UYARISI (2026-09-19 canli kosusunun dersi).
  # Bu script SUNUCU bileseni ARAMAZ (yedek almak icin gerekmiyor) ve "en yuksek
  # istemci" surumunu secer. Restore PROVASI ise sunucu bileseni SART oldugu
  # icin baska (daha eski) bir surumu secebilir. O zaman kural ihlal edilir:
  # pg_restore, dump'i ureten surumden YENI olabilir ama ESKI OLAMAZ; ihlalde
  # "unsupported version in file header" beklenir ve yedek DOGRULANAMAZ.
  #
  # !! AMA BU BIR KESINLIK DEGIL, RISK NOTUDUR - OLCULDU (2026-09-19): pg_dump
  # 18 ile alinan arsiv, pg_restore 17 ile 0,7 saniyede SORUNSUZ geri yuklendi
  # ve satir sayilari manifestle BIREBIR tuttu. Yani bir surum fark bu arsiv
  # bicimi icin tolere edildi. Uyari yine de duruyor cunku (a) fark buyudukce
  # kirilma gercek, (b) sessiz kalirsak bir sonraki operator bunu ancak provada
  # ogrenir. Alarm degil, bilgi.
  #
  # Yedegi almayi ENGELLEMIYORUZ (dogrulanmamis yedek, yedeksizlikten iyidir).
  $chosenVer = 0; $serverVer = 0
  [void][int]::TryParse((Split-Path (Split-Path $PgBin -Parent) -Leaf), [ref]$chosenVer)
  Get-ChildItem -Path (Split-Path (Split-Path $PgBin -Parent) -Parent) -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d+$' -and (Test-Path (Join-Path $_.FullName "share\postgres.bki")) } |
    ForEach-Object { if ([int]$_.Name -gt $serverVer) { $serverVer = [int]$_.Name } }
  if ($chosenVer -gt 0 -and $serverVer -gt 0 -and $chosenVer -gt $serverVer) {
    Write-Host ""
    Write-Host "UYARI: yedek pg_dump $chosenVer ile alinacak, ama bu makinede SUNUCU bileseni olan en yuksek surum $serverVer." -ForegroundColor Yellow
    Write-Host "       Restore provasi $serverVer ile kosar. TEK surum farki 2026-09-19 da OLCULDU ve CALISTI;" -ForegroundColor Yellow
    Write-Host "       fark buyurse arsiv okunamayabilir - garanti degil, risk notu." -ForegroundColor Yellow
    Write-Host "       Caresi (biri): PostgreSQL $chosenVer'in SERVER bilesenini kur, ya da bu yedegi" -ForegroundColor Yellow
    Write-Host "       -PgBin 'C:\Program Files\PostgreSQL\$serverVer\bin' ile tekrar al." -ForegroundColor Yellow
    Write-Host ""
  } elseif ($serverVer -eq 0) {
    Write-Host ""
    Write-Host "UYARI: bu makinede SUNUCU bileseni olan PostgreSQL kurulumu YOK." -ForegroundColor Yellow
    Write-Host "       Yedek alinir ama restore provasi KOSULAMAZ (initdb sunucu dosyalarini ister)." -ForegroundColor Yellow
    Write-Host ""
  }

  if (-not $OutDir) { $OutDir = [Environment]::GetFolderPath("Desktop") }
  if (-not (Test-Path $OutDir)) { throw "Hedef klasor yok: $OutDir" }
  # !! BULUT ESITLEMESI UYARISI (2026-09-23 denetimi). Yedek SIFRESIZ ve sunlari icerir:
  # misafir adlari/telefonlari/mesajlari, QR ve iCal erisim tokenlari (DUZ METIN), parola
  # hash'leri. Windows 10/11'de Masaustu cogu zaman OneDrive'a esitlenir -> yedek kisisel
  # bulut hesabina da gider. Akis DEGISMEZ (yalniz uyari); karar operatorun.
  $resolvedOut = (Resolve-Path -LiteralPath $OutDir).Path
  foreach ($syncRoot in @($env:OneDrive, $env:OneDriveConsumer, $env:OneDriveCommercial)) {
    if ($syncRoot -and $resolvedOut.StartsWith($syncRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      Write-Host ""
      Write-Host "UYARI: hedef klasor OneDrive ile esitleniyor: $resolvedOut" -ForegroundColor Yellow
      Write-Host "       Yedek misafir verisi ve erisim tokenlari icerir; esitlenmeyen bir klasor sec:" -ForegroundColor Yellow
      Write-Host "       -OutDir 'C:\LixusYedek'   (sonra sifrele ve harici diske kopyala)" -ForegroundColor Yellow
      Write-Host ""
      break
    }
  }
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
  $lines += ""
  $lines += "BU DOSYALAR SIFRESIZDIR (.dump ve .sql):"
  $lines += "  ENCRYPTION_KEY yalniz *Enc kolonlarini korur. Geri kalan HER SEY okunur:"
  $lines += "  misafir adlari/telefonlari/mesajlari, QR ve iCal erisim tokenlari (duz metin;"
  $lines += "  servis geri acilinca CALISIRLAR), parola hash'leri. Sifrele, OneDrive'a koyma."
  Set-Content -Path $manifest -Value $lines -Encoding UTF8

  Write-Host ""
  Write-Host "YEDEK TAMAM" -ForegroundColor Green
  $lines | ForEach-Object { Write-Host $_ }
  Write-Host ""
  Write-Host "SIRADAKI ADIM - PROVA (bunu KOSMADAN yedek dogrulanmis SAYILMAZ):" -ForegroundColor Yellow
  Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ops-restore-drill.ps1 -ExpectedSha $dumpSha -DumpPattern 'lixus-prod-pause-*.dump'"
  Write-Host ""
  Write-Host "PROVADAN SONRA - SIFRELE (7-Zip, AES-256; dosya adlari da gizlenir, parolayi 7-Zip sorar):" -ForegroundColor Yellow
  Write-Host "  & 'C:\Program Files\7-Zip\7z.exe' a -t7z -mhe=on -p `"$base.7z`" `"$dump`" `"$sqlOut`" `"$manifest`""
  Write-Host "  Parola ENCRYPTION_KEY'den FARKLI olsun ve ondan AYRI yerde saklansin."
  Write-Host "  Arsivi 7z t ile dogruladiktan sonra duz dosyalari sil: Remove-Item `"$dump`", `"$sqlOut`""
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
