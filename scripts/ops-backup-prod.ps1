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
# Cikan SHA256'yi not et - restore provasi (ops-restore-drill.ps1) onu ister.
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
  [string]$PgBin = 'C:\Program Files\PostgreSQL\17\bin'
)
$sec = Read-Host -AsSecureString "Railway PUBLIC/PROXY DATABASE_URL"
$ptr = [IntPtr]::Zero
try {
  if (-not (Test-Path (Join-Path $PgBin "pg_dump.exe"))) { throw "pg_dump bulunamadi: $PgBin" }
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
