# Canlı veritabanı yedeği — adım adım (Windows)

Ne zaman: veritabanı değişikliği (migration) içeren bir gönderimden ÖNCE, Claude "yedek al" dediğinde.
Yedek canlıya YAZMAZ (yalnız okur). Adres ve anahtar ekranda görünmez, hiçbir dosyaya yazılmaz.
🚨 Veritabanı adresini ve şifreleme anahtarını sohbete YAPIŞTIRMA — yalnız betiğin sorduğu yere yapıştır.

## 0. PowerShell'i aç

Başlat menüsü → **Windows PowerShell** (yönetici olarak DEĞİL, normal).

## 1. Proje klasörüne gir

Komutlar **proje klasörünün içinde** çalışır. Ev klasöründe (`C:\Users\MUSA CINAR`) çalıştırınca
"not a git repository" / "…ops-backup-prod.ps1 does not exist" hatası verir.

Proje klasörünün adı `LixusPreflight-43ccd3c`. Yerini bulmak için:

```powershell
Get-ChildItem -Path $HOME -Directory -Recurse -Depth 4 -Filter "LixusPreflight*" -ErrorAction SilentlyContinue | Select-Object FullName
```

Çıkan yolu tırnak içinde kullanarak içine gir (09-28'de bulunan yol):

```powershell
cd "C:\Users\MUSA CINAR\Documents\LixusPreflight-43ccd3c"
```

Doğru yerde olduğunu kontrol et — `True` yazmalı:

```powershell
Test-Path .\scripts\ops-backup-prod.ps1
```

**Hiçbir şey bulunamazsa** yeni bir kopya indir (Node 22 kurulu olmalı; birkaç dakika sürer):

```powershell
cd $HOME\Desktop
git clone https://github.com/musaxd57/SaaS-Ultimitly.git LixusYedek
cd LixusYedek
git checkout claude/great-edison-3zqpZ
npm ci
```

## 2. Klonu güncelle

```powershell
git status --short
```

Bir şey yazarsa **DUR** ve çıktıyı Claude'a gönder (hiçbir şeyi silme, `reset` yapma). Boşsa:

```powershell
git fetch origin claude/great-edison-3zqpZ
git checkout claude/great-edison-3zqpZ
git pull --ff-only origin claude/great-edison-3zqpZ
```

## 3. Yedeği al

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ops-backup-prod.ps1
```

`Railway PUBLIC/PROXY DATABASE_URL` sorusu gelir:
Railway → proje → **Postgres** servisi → **Variables** → **`DATABASE_PUBLIC_URL`** değerini kopyala
(`…proxy.rlwy.net:…` içeren adres), PowerShell'e yapıştır (ekranda görünmez) ve Enter'a bas.

Sonunda yeşil **`YEDEK TAMAM`** ve altında `Dosya`, `Boyut`, `TOC`, `SHA256` satırları çıkar.
**Bu dört satırı Claude'a gönder.** Yedek dosyası Masaüstündedir: `lixus-prod-post-contract-<tarih>.dump`.

## 4. Geri yükleme provası (canlıya dokunmaz)

🚨 Bunu Claude migration'ı göndermeden ÖNCE çalıştır (prova, klondaki migration sayısını yedekle karşılaştırır).

3. adımın sonunda ekranda **hazır komut** yazar (`Sonraki adim: prova icin bu SHA'yi kullan:` satırının altı) — onu kopyala ve
sonuna ` -ExpectCalendarSources 0` ekle. Örnek (SHA her yedekte FARKLIDIR, kendi çıkanı kullan):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ops-restore-drill.ps1 -ExpectedSha 168BD9EC5810FAF97E05FD0ECEE63AB80CBE25654BC0D10066C85221394734B2 -ExpectCalendarSources 0
```

⚠️ SHA'yı yazmadan çalıştırırsan prova "SHA256 UYUSMUYOR" diye DURUR — yedek bozuk değildir, yalnız kod eksik yazılmıştır. `ENCRYPTION_KEY (kasadaki deger)` sorusu gelirse kasandaki
anahtarı yapıştır. Sonunda çıkan özet satırlarını (migration sayısı, bitmemiş = 0, satır sayıları) Claude'a gönder.

## Sık hatalar

| Hata | Sebep | Çözüm |
|---|---|---|
| `not a git repository` · `ops-backup-prod.ps1 does not exist` | proje klasöründe değilsin | 1. adım |
| `pg_dump` / PostgreSQL bulunamadı | PostgreSQL farklı yerde | komutun sonuna `-PgBin 'C:\Program Files\PostgreSQL\18\bin'` ekle |
| `YEDEK ALINAMADI: …` | adres yanlış / bağlantı yok | hata satırını Claude'a gönder (ADRESİ GÖNDERME) |
| prova "SHA256 UYUSMUYOR" | SHA yerine başka metin yazıldı | 3. adımın sonundaki hazır komutu kopyala |
| yedek `OneDrive\Desktop`a düştü | Masaüstü OneDrive'a bağlı | prova bitince dosyayı OneDrive DIŞINA taşı (içinde misafir verisi var) |
