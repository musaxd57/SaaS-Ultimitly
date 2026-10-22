# Çalışma ortamı (Railway duraklatma, yerel geliştirme, yedek)

> CLAUDE.md'den 2026-10-23'te AYNEN taşındı (kurucu 10-22 gece: "her turda okumak yerine gerektiğinde oku"). Bu dosyadaki kurallar
> CLAUDE.md'deki kadar BAĞLAYICIDIR. Railway / yedek / yerel veritabanı / geri açma işinden ÖNCE oku.

## 🚨 ÇALIŞMA BİÇİMİ (09-19 → 09-24 güncel): RAILWAY AYIN 1'İNE KADAR AKTİF, GELİŞTİRME LOCAL'DE
🚨 **10-02 AKŞAM: Railway aboneliği BİTTİ** (kurucu) → CANLI YOK; dal push'u yalnız CI'dan geçer, deploy olmaz (geri açılınca dalın son yeşil
commit'i gider — migration'lı RC'lerden önce taze yedek kuralı aynen). Kurucu yerelde çalışıyor (`.env.local`, yerel PG 5434); prod `ENCRYPTION_KEY`
yerelde YOK (doğru). Son itilen RC72 (`d905c41`, CI #1290 yeşil).
🚨 **10-02 sabah: Railway HÂLÂ AKTİF** (kurucu canlıya bayrak ekledi) → dal push'u = CI yeşilse CANLI deploy. (Akşam bitti ↑.)
🚨 **09-24 kurucu: "Railway ayın 1'ine kadar aktif"** → dal push'u = CI yeşilse CANLI deploy (tarihli "duraklatıldı,
canlıya bir şey gitmedi" varsayımı YANLIŞTI). Aşağıdaki 09-19 duraklatma notu ayın 1'inden sonrası için geçerlidir.
Kurucu Railway **ücretli planından çıktı** (servis SİLİNMEDİ, proje bitmeye yakın geri açılacak).
Duraklatma öncesi tam yedek ALINDI ve **GERİ YÜKLENEBİLİRLİĞİ KANITLANDI** (aşağıda).
Kontrol listesi + geri açma adımları: `docs/OPS-2026-09-19-DURAKLATMA-VE-LOCAL-GELISTIRME.md`.
- **Local ortam tek komut:** `scripts/ops-local-dev-setup.ps1` (idempotent). Yerel küme
  `%LOCALAPPDATA%\lixus-dev-pg`, **PORT 5434**, DB `lixus_dev`, `.env.local` TAZE ÜRETİLMİŞ sırlarla
  (prod `ENCRYPTION_KEY` local'e KOPYALANMAZ — local DB'de şifreli prod verisi yok, kopyalamak yalnız
  sırrı yayar). Giriş `demo@guestops.ai / demo1234`. 🚨 **PORT 5434, 5433 DEĞİL:** 5433'ü test
  harness'ı sahipleniyor ve her `vitest run` onu `stop -m immediate` + `initdb` ile SIFIRLIYOR —
  dev DB'si oraya kurulsaydı ilk `npm test` onu silerdi. İki küme ayrı → `npm test` ve `npm run dev`
  aynı anda sorunsuz.
- 🚨 **PROD DUMP'I LOCAL'E YÜKLENMEZ** (bilinçli): içinde gerçek misafir adları/telefonları/17.462
  mesaj var; demo seed geliştirme için yeterli. Gerçek veriyle ölçüm AYRI karar (KVKK).
- **Yedek (09-19 10:42Z):** `lixus-prod-pause-2026-09-19-104239.{dump,sql,-manifest.txt}`; arşiv 1,48 MB
  SHA256 `F91DAF20…DCCB3F7`. **Prova: restore exit=0, 0,7 sn; satır sayıları manifestle BİREBİR**
  (org 9 · mülk 11 · rezervasyon 1542 · konuşma 1329 · mesaj 17462 · takvim 0); ASSERT migration=56,
  bitmemiş=0. ⚠️ **Şifreli-alan kanıtı ALINMADI (vakumlu):** `CalendarSource=0` — kurucu doğruladı,
  iCal beslemeleri BİLEREK kaldırılmış. Pratik sonuç: DB'de şifreli veri kalmamış görünüyor, yani
  **dump tek başına kurtarma için YETİYOR**; anahtar yine kasada, ayrı yerde.
- **Operatör araçlarında ölçülen dört kusur düzeltildi (hepsi araçların kendindeydi):** ① `initdb`
  hatası `*> $null` ile yutuluyordu (teşhis edilemez kurtarma aracı) → log + kuyruk basılır ·
  ② sürüm seçimi yalnız `.exe` varlığına bakıyordu, PG 18 **istemci-kurulumu** seçilip tam kurulu 17
  atlanıyordu → `share\postgres.bki` de aranır (`-NeedsServer`; yedek ALMA scriptleri bu şartı GEÇMEZ,
  onlara sunucu gerekmiyor) · ③ o ayrım iki aracı farklı sürüme ayırdı → yedek script'i uyarır
  (⚠️ "pg_dump 18 → pg_restore 17 düşer" TAHMİNİM YANLIŞ ÇIKTI, ölçüm 0,7 sn'de çalıştığını gösterdi;
  uyarı kesin hüküm değil RİSK NOTU olarak dürüstleştirildi) · ④ boş takvim tablosunda prova
  "şifreli alanlar DOĞRULANDI" diye YEŞİL basıyordu → `CalendarSource=0` iken artık VAKUMLU olduğunu
  açıkça yazar (tuzak dosyanın kendi yorumunda vardı, NİHAİ HÜKME yansımamıştı).
- **Duraklatmada duranlar:** QR misafir sohbeti (dairedeki sticker ölü sayfaya düşer) · oto-yanıt/senkron
  (540 günlük geri pencere toparlar) · e-posta kuyruğu · **Paddle webhook'ları (durum KAYABİLİR → geri
  dönüşte reconcile)** · Hospitable OAuth refresh (süresi dolabilir, KONTROL ET).
