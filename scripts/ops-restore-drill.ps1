# ---------------------------------------------------------------------------
# OPS: YEDEKTEN GERI YUKLEME PROVASI - MANUEL OPERATOR ARACI, hicbir sey bunu
# otomatik cagirmaz. PROD'A SIFIR TEMAS: tum baglantilar 127.0.0.1'deki
# gecici, GUID klasorlu, kosum sonunda SILINEN bir PostgreSQL kumesine gider.
#
# Akis: Masaustundeki en yeni post-contract dump'i bulur -> SHA256'sini
# -ExpectedSha ile KARSILASTIRIR (yanlis/bozuk dosyaya prova imkansiz) ->
# izole kumeye restore eder (sure olculur) -> fail-closed dogrulamalar:
#   - migration sayisi == bu klondaki prisma/migrations klasor sayisi
#     (OTOMATIK guncel kalir - once git fetch/reset ile klonu guncelle!)
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
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ExpectedSha,
  [int]$ExpectCalendarSources = -1,
  [string]$PgBin = 'C:\Program Files\PostgreSQL\17\bin',
  [string]$DumpPattern = "lixus-prod-post-contract-*.dump"
)
$dir = Join-Path $env:TEMP ("lixus-prova-" + [guid]::NewGuid().ToString("N"))
$sqlDir = "$dir-sql"
$pKey = [IntPtr]::Zero; $secKey = $null; $started = $false
try {
  if (-not (Test-Path "scripts\verify-calendar-url-enc.ts")) { throw "Bu scripti LixusPreflight klasorunden calistir." }
  if (-not (Test-Path (Join-Path $PgBin "pg_restore.exe"))) { throw "PostgreSQL bin klasoru bulunamadi: $PgBin" }
  $expectedMigrations = (Get-ChildItem "prisma\migrations" -Directory).Count
  if ($expectedMigrations -lt 1) { throw "prisma/migrations bos gorunuyor - klon guncel mi?" }
  Write-Host "Beklenen migration sayisi (repodan turetildi): $expectedMigrations"
  $dump = Get-ChildItem (Join-Path ([Environment]::GetFolderPath("Desktop")) $DumpPattern) | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $dump) { throw "Masaustunde '$DumpPattern' desenine uyan dump bulunamadi." }
  Write-Host "Dump: $($dump.FullName)"
  $sha = (Get-FileHash $dump.FullName -Algorithm SHA256).Hash
  if ($sha -ne $ExpectedSha.ToUpperInvariant()) { throw "SHA256 UYUSMUYOR - bu, dogrulanan yedek DEGIL. Bulunan: $sha" }
  Write-Host "SHA256 dogrulandi - dogrulanmis yedegin ta kendisi." -ForegroundColor Green
  & (Join-Path $PgBin "initdb.exe") -D "$dir" -U postgres -A trust -E UTF8 --locale=C *> $null
  if ($LASTEXITCODE -ne 0) { throw "initdb basarisiz (exit=$LASTEXITCODE)" }
  & (Join-Path $PgBin "pg_ctl.exe") -D "$dir" -o "-p 5599 -c listen_addresses=127.0.0.1" -l (Join-Path $dir "pg.log") -s -w start
  if ($LASTEXITCODE -ne 0) { throw "pg_ctl start basarisiz (exit=$LASTEXITCODE)" }
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
  if ($started) { & (Join-Path $PgBin "pg_ctl.exe") -D "$dir" -s -w stop }
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue }
  if (Test-Path $sqlDir) { Remove-Item -Recurse -Force $sqlDir -ErrorAction SilentlyContinue }
  Write-Host "TEMIZLIK TAMAM - gecici kume, GUID klasorleri ve gizli degiskenler silindi"
}
