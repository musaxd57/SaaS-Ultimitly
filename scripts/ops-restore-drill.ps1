# ---------------------------------------------------------------------------
# OPS: YEDEKTEN GERI YUKLEME PROVASI - MANUEL OPERATOR ARACI, hicbir sey bunu
# otomatik cagirmaz. PROD'A SIFIR TEMAS: tum baglantilar 127.0.0.1'deki
# gecici, GUID klasorlu, kosum sonunda SILINEN bir PostgreSQL kumesine gider.
#
# Akis: Masaustundeki en yeni post-contract dump'i bulur -> SHA256'sini
# -ExpectedSha ile KARSILASTIRIR (yanlis/bozuk dosyaya prova imkansiz) ->
# izole kumeye restore eder (sure olculur) -> fail-closed dogrulamalar:
#   - migration sayisi == bu klondaki prisma/migrations klasor sayisi
#     (OTOMATIK guncel kalir - once klonu GUVENLI sekilde guncelle:
#        git status --short        <- cikti verirse DUR, reset/pull YAPMA
#        git fetch origin claude/great-edison-3zqpZ
#        git pull --ff-only origin claude/great-edison-3zqpZ
#      ASLA git reset --hard kullanma: yerel degisiklikleri siler.)
#   - bitmemis migration == 0
#   - sentinel == toplam CalendarSource (post-contract yapisal degismezi)
#   - istege bagli -ExpectCalendarSources N ile toplam da pinlenir
#   - verify-calendar-url-enc.ts --post-contract: her sifreli alan kasadaki
#     ENCRYPTION_KEY ile GERCEKTEN acilir (anahtar gizli istenir)
#
# Kosum (LixusPreflight klasorunden, normal/yonetici-OLMAYAN PowerShell):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ops-restore-drill.ps1 -ExpectedSha <YEDEGIN-SHA256'SI>
#
# Icine islenmis Windows dersleri (2026-07-30 canli provasindan):
#   - pg_ctl start/stop'a cikti yonlendirmesi BAGLANMAZ (daemon konsol
#     tanitici mirasi -> PowerShell sonsuz asili kalir); -s -w kullanilir.
#   - Turkce Windows'ta initdb --locale=C ister (non-ASCII locale hatasi).
#   - PS 5.1 native argumanlardaki gomulu cift tirnagi bozar -> buyuk/kucuk
#     harfli tablo adi iceren SQL dosyaya yazilip psql -f ile kosulur.
#   - PostgreSQL surumu OTOMATIK bulunur (en yuksek kurulu surum; secim ekrana
#     basilir). Gerekirse: -PgBin 'C:\Program Files\PostgreSQL\18\bin'
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ExpectedSha,
  [int]$ExpectCalendarSources = -1,
  # BOS = otomatik bul (en yuksek kurulu surum, asagidaki Resolve-PgBin).
  # Elle verilen deger HER ZAMAN kazanir.
  [string]$PgBin = '',
  [string]$DumpPattern = "lixus-prod-post-contract-*.dump"
)

# ---------------------------------------------------------------------------
# PostgreSQL bin klasorunu BUL.
#
# Sabit surum numarasi yazmak her yil bayatliyor: script 17'ye pinliydi,
# operator makinesi 18'e gecince -PgBin elle verilmeden kosmuyordu (2026-08-02).
#
# YON KURALI (neden EN YUKSEK surum): pg_restore, dump'i ureten surumden YENI
# olabilir ama ESKI OLAMAZ. Provada ayrica initdb ile YEREL bir kume kuruluyor;
# initdb/pg_ctl/psql/pg_restore'un HEPSI AYNI surumden gelmek zorunda (karisik
# surum kume acmaz) - bu yuzden tek bir klasor secilir ve hepsi oradan cagrilir.
#
# TUM gerekli exe'ler AYNI klasorde aranir: "client only" kurulumlarda
# psql/pg_restore vardir ama initdb/pg_ctl YOKTUR - yalniz pg_restore'a bakan
# eski kontrol boyle bir kurulumu secer, prova da initdb adiminda patlardi.
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
    throw ("Gerekli araclarin (" + ($Required -join ', ') + ") tamami tek bir PostgreSQL SUNUCU kurulumunda bulunamadi (share\postgres.bki dahil). -PgBin ile elle ver.")
  }
  $bin = Join-Path $best.FullName 'bin'
  # Secim GORUNUR olmali: sessiz otomatik secim, kurtarma aracinda yanlis
  # surumle kosuldugunu fark etmemek demektir.
  Write-Host "PostgreSQL $($best.Name) kullaniliyor: $bin"
  return $bin
}
$dir = Join-Path $env:TEMP ("lixus-prova-" + [guid]::NewGuid().ToString("N"))
$sqlDir = "$dir-sql"
$pKey = [IntPtr]::Zero; $secKey = $null; $started = $false
try {
  if (-not (Test-Path "scripts\verify-calendar-url-enc.ts")) { throw "Bu scripti LixusPreflight klasorunden calistir." }
  # Provanin kullandigi BES arac da ayni surumden gelmeli (karisik surum kume
  # acmaz) - hepsi tek seferde aranir, eksik olan varsa BURADA durulur.
  $PgBin = Resolve-PgBin -Explicit $PgBin -Required @(
    "pg_restore.exe", "initdb.exe", "pg_ctl.exe", "createdb.exe", "psql.exe"
  ) -NeedsServer
  $expectedMigrations = (Get-ChildItem "prisma\migrations" -Directory).Count
  if ($expectedMigrations -lt 1) { throw "prisma/migrations bos gorunuyor - klon guncel mi?" }
  Write-Host "Beklenen migration sayisi (repodan turetildi): $expectedMigrations"
  $dump = Get-ChildItem (Join-Path ([Environment]::GetFolderPath("Desktop")) $DumpPattern) | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $dump) { throw "Masaustunde '$DumpPattern' desenine uyan dump bulunamadi." }
  Write-Host "Dump: $($dump.FullName)"
  $sha = (Get-FileHash $dump.FullName -Algorithm SHA256).Hash
  if ($sha -ne $ExpectedSha.ToUpperInvariant()) { throw "SHA256 UYUSMUYOR - bu, dogrulanan yedek DEGIL. Bulunan: $sha" }
  Write-Host "SHA256 dogrulandi - dogrulanmis yedegin ta kendisi." -ForegroundColor Green
  # !! CIKTIYI YUTMA, DOSYAYA YAZ (2026-09-19 canli provasinin dersi).
  # Burasi `*> $null` idi: initdb patladiginda NEDENI de birlikte siliniyordu ve
  # elde yalniz "exit=1" kaliyordu - teshis edilemez bir kurtarma araci.
  # Ayni dosyanin pg_restore adimi DOGRUSUNU yapiyordu (loga yaz, hata olursa
  # kuyrugu bas); o desen buraya da uygulandi. Normal akista ekran yine sessiz.
  $initLog = "$dir.initdb.log"
  & (Join-Path $PgBin "initdb.exe") -D "$dir" -U postgres -A trust -E UTF8 --locale=C *> $initLog
  if ($LASTEXITCODE -ne 0) {
    Write-Host "initdb ciktisi:" -ForegroundColor Yellow
    if (Test-Path $initLog) { Get-Content $initLog -Tail 25 }
    throw "initdb basarisiz (exit=$LASTEXITCODE)"
  }
  & (Join-Path $PgBin "pg_ctl.exe") -D "$dir" -o "-p 5599 -c listen_addresses=127.0.0.1" -l (Join-Path $dir "pg.log") -s -w start
  if ($LASTEXITCODE -ne 0) {
    # pg_ctl'in kendi mesaji yetmez: asil sebep sunucu gunlugundedir.
    Write-Host "pg.log kuyrugu:" -ForegroundColor Yellow
    $pgLog = Join-Path $dir "pg.log"
    if (Test-Path $pgLog) { Get-Content $pgLog -Tail 25 }
    throw "pg_ctl start basarisiz (exit=$LASTEXITCODE)"
  }
  $started = $true
  & (Join-Path $PgBin "createdb.exe") -h 127.0.0.1 -p 5599 -U postgres prova
  if ($LASTEXITCODE -ne 0) { throw "createdb basarisiz (exit=$LASTEXITCODE)" }
  New-Item -ItemType Directory -Path $sqlDir | Out-Null
  $q = [char]34
  $countsSql = ('SELECT (SELECT count(*) FROM {0}Organization{0}) AS org, (SELECT count(*) FROM {0}Property{0}) AS mulk, (SELECT count(*) FROM {0}Reservation{0}) AS rezervasyon, (SELECT count(*) FROM {0}Conversation{0}) AS konusma, (SELECT count(*) FROM {0}Message{0}) AS mesaj, (SELECT count(*) FROM {0}CalendarSource{0}) AS takvim;' -f $q)
  Set-Content -Path (Join-Path $sqlDir "counts.sql") -Value $countsSql -Encoding ASCII
  $assertSql = ('SELECT (SELECT count(*) FROM _prisma_migrations)::text || ''|'' || (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL)::text || ''|'' || (SELECT count(*) FROM {0}CalendarSource{0})::text || ''|'' || (SELECT count(*) FROM {0}CalendarSource{0} WHERE url = ''enc:'')::text;' -f $q)
  Set-Content -Path (Join-Path $sqlDir "assert.sql") -Value $assertSql -Encoding ASCII
  $rlog = Join-Path $sqlDir "restore.log"
  $t = Measure-Command { & (Join-Path $PgBin "pg_restore.exe") -h 127.0.0.1 -p 5599 -U postgres -d prova --no-owner --no-privileges $dump.FullName *> $rlog }
  $restoreCode = $LASTEXITCODE
  Write-Host ("RESTORE SURESI: {0:n1} saniye (pg_restore exit={1})" -f $t.TotalSeconds, $restoreCode) -ForegroundColor Cyan
  if ($restoreCode -ne 0) { Write-Host "pg_restore log kuyrugu:" -ForegroundColor Yellow; Get-Content $rlog -Tail 20; throw "pg_restore basarisiz (exit=$restoreCode) - FAIL-CLOSED, dogrulamalara GECILMEDI." }
  & (Join-Path $PgBin "psql.exe") -h 127.0.0.1 -p 5599 -U postgres -d prova -v ON_ERROR_STOP=1 -f (Join-Path $sqlDir "counts.sql")
  if ($LASTEXITCODE -ne 0) { throw "sayim sorgusu basarisiz (exit=$LASTEXITCODE)" }
  $raw = & (Join-Path $PgBin "psql.exe") -h 127.0.0.1 -p 5599 -U postgres -d prova -v ON_ERROR_STOP=1 -t -A -f (Join-Path $sqlDir "assert.sql")
  if ($LASTEXITCODE -ne 0) { throw "assertion sorgusu basarisiz (exit=$LASTEXITCODE)" }
  $vals = (($raw | Where-Object { $_ -and $_.Trim() }) | Select-Object -First 1).Trim().Split("|")
  if ($vals.Count -ne 4) { throw "assertion ciktisi beklenmedik bicimde: $raw" }
  if ($vals[0] -ne "$expectedMigrations") { throw "ASSERT BASARISIZ: migration_sayisi=$($vals[0]), beklenen $expectedMigrations (klon guncel mi?)" }
  if ($vals[1] -ne "0") { throw "ASSERT BASARISIZ: bitmemis_migration=$($vals[1]), beklenen 0" }
  if ($vals[2] -ne $vals[3]) { throw "ASSERT BASARISIZ: sentinel=$($vals[3]) != CalendarSource=$($vals[2]) - post-contract degismezi bozuk" }
  if ($ExpectCalendarSources -ge 0 -and $vals[2] -ne "$ExpectCalendarSources") { throw "ASSERT BASARISIZ: CalendarSource=$($vals[2]), beklenen $ExpectCalendarSources" }
  # DENETIM BULGUSU: "sentinel == toplam" degismezi BOS tabloda trivially saglanir
  # (0 == 0) ve `verify --post-contract` de total=0 iken "TEMIZ" der. Yani takvim
  # verisi tamamen kaybolmus bir yedek provanin HER adimindan yesil gecerdi.
  # -ExpectCalendarSources verilmediyse en azindan "hic satir yok" hali uyari olsun.
  if ($ExpectCalendarSources -lt 0 -and $vals[2] -eq "0") {
    Write-Host "UYARI: yedekte HIC CalendarSource satiri yok - 'sentinel == toplam' kontrolu bos tabloda anlamsizdir." -ForegroundColor Yellow
    Write-Host "       Beklenen sayiyi -ExpectCalendarSources <N> ile vererek provayi anlamli hale getirin." -ForegroundColor Yellow
  }
  Write-Host "ASSERT OK: migration=$($vals[0]), bitmemis=0, CalendarSource=$($vals[2]), sentinel=$($vals[3])" -ForegroundColor Green
  Write-Host "Yapisal kontroller gecti - simdi sifreli alanlarin anahtarla acilma kaniti..." -ForegroundColor Cyan
  $secKey = Read-Host -AsSecureString "ENCRYPTION_KEY (kasadaki deger)"
  $pKey = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($secKey)
  $env:ENCRYPTION_KEY = [Runtime.InteropServices.Marshal]::PtrToStringUni($pKey)
  $env:DATABASE_URL = "postgresql://postgres@127.0.0.1:5599/prova"
  npx tsx scripts/verify-calendar-url-enc.ts --post-contract
  if ($LASTEXITCODE -ne 0) { throw "POST-CONTRACT dogrulama BASARISIZ (exit=$LASTEXITCODE)" }
  Write-Host "PROVA TAMAM - restore + migrationlar + tablolar + sifreli takvim alanlari DOGRULANDI" -ForegroundColor Green
} catch {
  Write-Host "PROVA DURDU: $_" -ForegroundColor Red
  exit 1
} finally {
  if ($pKey -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($pKey) }
  if ($secKey) { $secKey.Dispose() }
  Remove-Item Env:DATABASE_URL, Env:ENCRYPTION_KEY -ErrorAction SilentlyContinue
  # DENETIM BULGUSU: stop'un cikis kodu okunmuyordu ve silme -SilentlyContinue ile
  # sessizce basarisiz olabiliyordu; script yine de kosulsuz "TEMIZLIK TAMAM"
  # yaziyordu. Bu, en kotu senaryoda TUM PROD PII'sinin %TEMP% altinda ve
  # parolasiz bir Postgres'in 127.0.0.1:5599'da dinlemeye devam ettigi hali
  # "temizlendi" diye gostermek demekti. Artik temizlik DOGRULANIYOR.
  $cleanupOk = $true
  if ($started) {
    & (Join-Path $PgBin "pg_ctl.exe") -D "$dir" -s -w stop
    if ($LASTEXITCODE -ne 0) {
      $cleanupOk = $false
      Write-Host "UYARI: pg_ctl stop basarisiz (exit $LASTEXITCODE) - kume hala calisiyor olabilir" -ForegroundColor Red
    }
  }
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue }
  if (Test-Path $sqlDir) { Remove-Item -Recurse -Force $sqlDir -ErrorAction SilentlyContinue }
  # initdb gunlugu $dir'in KARDESIDIR (initdb hedef klasoru kendi yarattigi icin
  # icine yazilamaz). PII TASIMAZ - yalniz initdb'nin kendi mesajlari - bu yuzden
  # silinememesi $cleanupOk'i DUSURMEZ; yine de ardimizda cop birakmayiz.
  if (Test-Path "$dir.initdb.log") { Remove-Item -Force "$dir.initdb.log" -ErrorAction SilentlyContinue }
  if (Test-Path $dir) { $cleanupOk = $false }
  if (Test-Path $sqlDir) { $cleanupOk = $false }
  if ($cleanupOk) {
    Write-Host "TEMIZLIK TAMAM - gecici kume, GUID klasorleri ve gizli degiskenler silindi"
  } else {
    Write-Host ""
    Write-Host "!!! TEMIZLIK TAMAMLANAMADI - PROD VERISI DISKTE KALDI !!!" -ForegroundColor Red
    Write-Host "Kalan klasor(ler):" -ForegroundColor Red
    if (Test-Path $dir)    { Write-Host "  $dir" -ForegroundColor Red }
    if (Test-Path $sqlDir) { Write-Host "  $sqlDir" -ForegroundColor Red }
    Write-Host "ELLE YAP: once kumeyi durdur, sonra klasorleri sil:" -ForegroundColor Yellow
    Write-Host "  & '$PgBin\pg_ctl.exe' -D '$dir' -m immediate stop" -ForegroundColor Yellow
    Write-Host "  Remove-Item -Recurse -Force '$dir','$sqlDir'" -ForegroundColor Yellow
    $global:LASTEXITCODE = 1
  }
}
