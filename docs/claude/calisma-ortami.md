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
- 🚨 **Çalışma ağaçları (`wt-dev`, `wt-next`, ana klon) AYNI `node_modules`'u paylaşır (sembolik bağ) → tam kapı koşarken `npx prisma generate`
  ÇALIŞTIRILMAZ** (11-13: şema değişikliğinden sonra geliştirme ağacında koşuldu, koşan kapının Prisma istemcisi yeni şemaya döndü). Test yardımcısı
  tabloları açık listeyle sildiği için davranış testleri etkilenmez; DMMF okuyan pinler yanlış KIRMIZI verir (yanlış yeşil değil). Şema değişince
  istemci, kapı bittikten sonra ya da yeni şemayı taşıyan kapının başında üretilir.

## Paralel kod yazan ajanlar (11-18; kurucu: "sen orkestratörsün, Opus kod yazabilir ama push etmez, kodunu hemen eleştirel incele")

- **Ağaç:** `git worktree add -b agent/<ad> <scratchpad>/wt-<ad> dev/gates` + `node_modules` sembolik bağ. Ajan yalnız kendi ağacına yazar,
  yerel commit atar, push etmez. Bitince ana oturum `git diff` ile satır satır okur → `git cherry-pick` → commit mesajına oturum satırları
  (`git filter-branch --msg-filter`) → kendi veritabanında yeniden test.
- **Veritabanı:** ayrı küme `initdb -D /tmp/lixus-pg-agents` + `pg_ctl … -o '-p 5441 -k /tmp' start`, içinde ajan başına boş veritabanı
  (`createdb lixus_t1 …`). Ajan `TEST_DATABASE_URL="postgresql://postgres@localhost:5441/lixus_tN?schema=public" npx vitest run <dosyalar>` koşar;
  `tests/global-setup.ts` dış veritabanında yalnız şemayı iter, 5433'e dokunmaz. İki ajan AYNI veritabanını paylaşamaz (her test tabloları boşaltır).
- **Sıra:** mutasyon koşucusu başka bir vitest görürse durur; tam kapı 5433'ü sıfırlar ve süre pinleri yükten etkilenir → ikisi de TEK başına.
  Bekleme işareti: ajan kural dosyası her `vitest` / `tsc` öncesi bir dosyanın varlığına baktırır; ana oturum koşudan önce dosyayı koyar
  (`touch`), süreçlerin bittiğini `ps` ile görür, koşar, kaldırır. Ajanlar o sırada kod yazmaya devam eder.
- **Mutasyon hızlı kipi:** `TEST_DATABASE_URL=… node scripts/mutation-run.mjs <liste>` — her mutantta `initdb` yerine şema itme (≈ 13 sn / mutant;
  varsayılan kipte ≈ 60 sn).
- **Kural dosyası** ajan isteminin ilk satırıdır: yasak dosyalar, push / şema / `npm install` yasağı, kanıt sözleşmesi (kırmızı-önce çıktısı,
  kontrol testi, mutasyon listesi), "yeni müşteri metni yazma", rapor biçimi ("yapılmayan / emin olmadıklarım" zorunlu).
- 🚨 **İzin sorusu çıkaran komut YAZILMAZ (kurucu 11-26: "bana soru olarak sorma, iznin var"):** `bash -c "…; rm …"` gibi içinde silme geçen
  iç içe kabuk satırı izin listesinden geçmez (Bash izinli olsa da ayrı güvenlik denetimi "denetlenemedi" der) ve kurucuya soru olarak
  düşer; kurucu uyurken iş saatlerce durur (11-25 gecesi 4 saat). Kapı + bayrak temizliği tek betiktedir
  (`scratchpad/codex-1117/tools/kapi-tam.sh [mutasyon listeleri]`); arka plan işi betik DOSYASI olarak başlatılır, komut satırına `rm`
  yazılmaz. CI kontrolü, izleme ve ajan araçları için soru gitmez. Uyandırıcı yalnız kurucunun söylediği saate kurulur.

