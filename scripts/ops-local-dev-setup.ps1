# ---------------------------------------------------------------------------
# OPS: LOCAL GELISTIRME KURULUMU - Railway OLMADAN calisan tam ortam.
# MANUEL OPERATOR ARACI; hicbir sey bunu otomatik cagirmaz.
#
# NE ZAMAN: Railway ucretli plandan cikildi, gelistirme local'de suruyor.
#
# NE YAPAR (IDEMPOTENT - ikinci kez kosmak zarar vermez):
#   1) Yerel PostgreSQL KUMESI kurar/baslatir  (yoksa initdb, varsa sadece start)
#   2) lixus_dev veritabanini olusturur (varsa dokunmaz)
#   3) .env.local YOKSA yazar - TAZE URETILMIS gelistirme sirlariyla
#   4) prisma db push + demo seed
#   5) "npm run dev" komutunu ve demo girisini basar
#
# !! PORT 5434, 5433 DEGIL. 5433'u TEST HARNESS'I SAHIPLENIR: her `vitest run`
#    o kumeyi `pg_ctl stop -m immediate` + `initdb` ile SIFIRLAR. Gelistirme
#    veritabanini oraya kurarsan ilk `npm test` onu SILER. (Olculmus davranis,
#    tests/global-setup.ts.)
#
# !! PROD SIRLARI BURAYA KOPYALANMAZ. Script AUTH_SECRET ve ENCRYPTION_KEY'i
#    KENDISI uretir. Prod ENCRYPTION_KEY'i local'e kopyalamak iki sey yapar:
#    (a) sirri gelistirme makinesine yayar, (b) hicbir ise yaramaz - local DB'de
#    sifrelenmis prod verisi zaten YOK. Anahtar kasada kalir.
#
# !! PROD VERISI LOCAL'E YUKLENMEZ (bilincli): dump'ta gercek misafir adlari,
#    telefonlari ve mesajlari var. Gelistirme icin demo seed YETER; prod dump'i
#    soguk yedek olarak kalir. Gercek veriye ihtiyac duyan bir olcum cikarsa o
#    AYRI bir karardir (KVKK).
#
# Kosum (normal, yonetici OLMAYAN PowerShell, repo kokunden):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ops-local-dev-setup.ps1
#
# Bilgisayar yeniden baslatilinca kume durur; ayni komut tekrar kosulur
# (kurulum atlanir, yalniz baslatir). Veriyi sifirlamak icin: -Reseed
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
  [string]$PgBin = '',
  [int]$Port = 5434,
  [string]$DataDir = '',
  [string]$DbName = 'lixus_dev',
  [switch]$Reseed
)

# ---------------------------------------------------------------------------
# DIKKAT: Bu fonksiyon UC operator scriptinde de KOPYA duruyor, BILEREK
# (felaket-kurtarma araclari ortak dosyaya bagimli olmamali). Birini degistiren
# OTEKILERI de degistirir. Gerekli exe listesi burada FARKLI: initdb/pg_ctl de
# lazim, yani "client only" kurulum bu is icin YETMEZ ve ONCEDEN anlasilir.
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
  Write-Host "PostgreSQL $($best.Name) kullaniliyor: $bin"
  return $bin
}

function New-Secret {
  # 48 bayt -> 64 karakter base64url; env-check'in 32 karakter alt siniri rahat asilir.
  $bytes = New-Object byte[] 48
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ([Convert]::ToBase64String($bytes) -replace '\+', '-' -replace '/', '_' -replace '=', '')
}

try {
  if (-not (Test-Path "package.json")) { throw "Repo kokunde degilsin (package.json yok). Once repo klasorune gec." }
  $PgBin = Resolve-PgBin -Explicit $PgBin -Required @("initdb.exe", "pg_ctl.exe", "psql.exe", "createdb.exe") -NeedsServer
  if (-not $DataDir) { $DataDir = Join-Path $env:LOCALAPPDATA "lixus-dev-pg" }

  if ($Port -eq 5433) {
    throw "PORT 5433 KULLANILAMAZ: test harness'i o kumeyi her kosuda sifirliyor. Varsayilan 5434'u kullan."
  }

  # --- 1) Kume -----------------------------------------------------------
  if (-not (Test-Path (Join-Path $DataDir "PG_VERSION"))) {
    Write-Host "[1/5] Yerel kume kuruluyor: $DataDir" -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    # !! --locale=C SART: Turkce Windows'ta initdb non-ASCII locale ile patliyor
    # (2026-07-30 canli provasinin dersi).
    & (Join-Path $PgBin "initdb.exe") -D "$DataDir" -U postgres --locale=C --encoding=UTF8
    if ($LASTEXITCODE -ne 0) { throw "initdb BASARISIZ (exit=$LASTEXITCODE)" }
  } else {
    Write-Host "[1/5] Kume zaten var: $DataDir" -ForegroundColor DarkGray
  }

  # !! pg_ctl start/stop'a cikti YONLENDIRILMEZ (daemon konsol tanitici mirasi
  # -> PowerShell sonsuza kadar asili kalir); -s -w kullanilir.
  $status = & (Join-Path $PgBin "pg_ctl.exe") -D "$DataDir" status 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "      kume baslatiliyor (port $Port)..." -ForegroundColor Cyan
    & (Join-Path $PgBin "pg_ctl.exe") -D "$DataDir" -o "-p $Port" -s -w start
    if ($LASTEXITCODE -ne 0) { throw "pg_ctl start BASARISIZ (exit=$LASTEXITCODE)" }
  } else {
    Write-Host "      kume zaten calisiyor" -ForegroundColor DarkGray
  }

  # --- 2) Veritabani ------------------------------------------------------
  $env:PGHOST = "127.0.0.1"; $env:PGPORT = "$Port"; $env:PGUSER = "postgres"
  $exists = & (Join-Path $PgBin "psql.exe") -X -A -t -d postgres -c "SELECT 1 FROM pg_database WHERE datname='$DbName'"
  if (-not ($exists -match '1')) {
    Write-Host "[2/5] Veritabani olusturuluyor: $DbName" -ForegroundColor Cyan
    & (Join-Path $PgBin "createdb.exe") "$DbName"
    if ($LASTEXITCODE -ne 0) { throw "createdb BASARISIZ (exit=$LASTEXITCODE)" }
  } else {
    Write-Host "[2/5] Veritabani zaten var: $DbName" -ForegroundColor DarkGray
  }

  # --- 3) .env.local ------------------------------------------------------
  $dbUrl = "postgresql://postgres@127.0.0.1:$Port/$DbName"
  if (Test-Path ".env.local") {
    Write-Host "[3/5] .env.local ZATEN VAR - DOKUNULMADI" -ForegroundColor Yellow
    Write-Host "      Icindeki DATABASE_URL su olmali: $dbUrl"
  } else {
    Write-Host "[3/5] .env.local yaziliyor (TAZE uretilmis gelistirme sirlari)" -ForegroundColor Cyan
    $envLines = @(
      "# LOCAL GELISTIRME - bu dosya .gitignore'da, commit EDILMEZ.",
      "# Sirlar bu makineye OZGU ve script tarafindan uretildi; prod degerleri",
      "# buraya KOPYALANMAZ (prod ENCRYPTION_KEY kasada kalir).",
      "DATABASE_URL=`"$dbUrl`"",
      "AUTH_SECRET=`"$(New-Secret)`"",
      "ENCRYPTION_KEY=`"$(New-Secret)`"",
      "APP_URL=`"http://localhost:3000`"",
      "",
      "# AI kapali: anahtar yoksa urun deterministik fallback'e duser ve",
      "# gelistirme ucretli servise TEK ISTEK gondermez. Gercek model denemek",
      "# istersen kendi anahtarini buraya koy.",
      "OPENAI_API_KEY=`"`"",
      "",
      "# Misafir QR yuzeyini local'de denemek icin 1 yap.",
      "GUEST_CHAT_ENABLED=`"`"",
      "AUTO_REPLY_ENABLED=`"`""
    )
    Set-Content -Path ".env.local" -Value $envLines -Encoding UTF8
  }

  # --- 4) Sema + seed -----------------------------------------------------
  $env:DATABASE_URL = $dbUrl
  Write-Host "[4/5] Sema uygulaniyor + demo veri yukleniyor..." -ForegroundColor Cyan
  if ($Reseed) {
    & npm run db:reset
  } else {
    & npx prisma db push
    if ($LASTEXITCODE -ne 0) { throw "prisma db push BASARISIZ (exit=$LASTEXITCODE)" }
    & npm run db:seed
  }
  if ($LASTEXITCODE -ne 0) { throw "seed BASARISIZ (exit=$LASTEXITCODE)" }

  # --- 5) Hazir -----------------------------------------------------------
  Write-Host ""
  Write-Host "[5/5] LOCAL ORTAM HAZIR" -ForegroundColor Green
  Write-Host "  DB       : $dbUrl"
  Write-Host "  Kume     : $DataDir  (port $Port)"
  Write-Host ""
  Write-Host "  Baslat   : npm run dev        -> http://localhost:3000"
  Write-Host "  Giris    : demo@guestops.ai / demo1234"
  Write-Host "  Testler  : npm test           (AYRI kume, port 5433 - buna dokunmaz)"
  Write-Host ""
  Write-Host "  Bilgisayari yeniden baslattiktan sonra ayni komutu tekrar kos;"
  Write-Host "  kurulum atlanir, yalniz kume baslatilir."
} catch {
  Write-Host "KURULUM BASARISIZ: $_" -ForegroundColor Red
  exit 1
} finally {
  Remove-Item Env:PGHOST, Env:PGPORT, Env:PGUSER -ErrorAction SilentlyContinue
}
