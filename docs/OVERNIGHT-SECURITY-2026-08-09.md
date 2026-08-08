# Gece güvenlik turu — checkpoint (2026-08-08 → 09)

> **Başlangıç:** 2026-08-08 21:19:53 UTC · **HEAD (tur başı):** `a6c0294` · ağaç temizdi.
> Sürekli güncellenir, tarihçe biriktirmez (≤200 satır). Migration/prod/env YOK;
> belirsiz olan kodlanmaz, soru olarak yazılır.

---

## FAZ 1 — Envanter (bitti)

### Belge doğrulaması (Codex: "yeniden yazma, sadece doğrula")
Sekiz revizyon maddesinin **hepsi** dosyalarda mevcut (ölçüldü): üç yeni kolon
(16 geçiş) · elle `ALTER TABLE` yok · "KOD HAZIR" iddiası yok · `Number.isFinite` ·
güvenli JSON · KVKK/erasure/ihraç · `ACIK-ISLER` §7c–§7h. → **yeniden yazılmadı.**

### Oturum yaşam döngüsü — ölçülen gerçekler
`sessionEpoch`'u artıran YALNIZ 4 yer (`password-reset-challenge:250` ·
`account/password:204` · `forgot-password:354` · `admin/reset-2fa:87`) —
**logout DEĞİL** (`auth/logout:6-8` sadece çerezi siler). Cookie yenilemesi
edge'de DB okumadan yapılıyor (`middleware:92-101`) ama payload AYNEN yeniden
imzalandığı için bayat epoch taşınır → **iptal edilmiş oturumu AKLAMAZ**.
Epoch `api.ts:12`'de fail-closed zorlanıyor. Trusted-device token'ı
`sessionEpoch`'u hiç görmüyor (`trusted-device.ts:32`).

### 🚨 SEVERİTE DÜZELTMESİ (kendi önceki raporumun aşırılığı)
`ACIK-ISLER §7c` "çalınan çerez süresiz yenilenir" diyor — doğru ama eksik
okunursa abartılı: yenilenen şey bayat epoch taşıdığı için korumalı her yüzeyde
ÖLÜ. Asıl kusur iptalin logout'ta HİÇ çalışmaması. Bu ayrım P0'ı değiştirdi.

---

## ÇALIŞMA LİSTESİ (Faz 1 çıktısı)
**P0** logout sunucuda iptal etmiyor → migration'sız tek kaldıraç "her yerden
çıkış", DAVRANIŞ DEĞİŞİKLİĞİ → ↓S1 sorusu. **P1** 2FA reauth · `mfa` iddiası.
**P2** trusted-device iptali (↓S2) · stil profili · sır dedektörü.
**Migration isteyenler (kodlanmadı):** per-session `jti`; m48 altı kolon.

---

## FAZ 2–4 — UYGULANANLAR (hepsi kırmızı-önce + iki yönlü mutasyon)

| # | Değişiklik | Kırmızı-önce | Mutasyon A (korumayı kaldır) | Mutasyon B (koşulsuzlaştır) |
|---|---|---|---|---|
| 1 | `account/2fa` `setup` → şifre ister (+ istemci alanı) | 2 test 400 yerine 200 | kırmızı | kırmızı |
| 2 | `requireSession` `mfa` iddiasını DB'ye karşı düşürür | iddia `true` kalıyordu | kırmızı (her iki dal) | kırmızı |
| 3 | `automation.ts` stil profilini SÜZEREK geçirir | ham geçiş | kırmızı | kırmızı (üslup kaybı) |
| 4 | sır dedektörü karakterizasyon testi (davranış DEĞİŞMEDİ) | — | kırmızı | kırmızı |
| 5 | `login` — hesap başına ikinci-faktör kotası (`login-2fa:{userId}` 10/10dk) | 12 deneme 401 | kırmızı | kırmızı |
| 6 | rezervasyon ÖNCESİ KB sır kapısı (`withoutSecretKbItems`) | ham geçiş | kırmızı | kırmızı |
| 7 | `requireAuth` — iddia SAYFA yolunda da düşer | iddia `true` kalıyordu | kırmızı | kırmızı |
| 8 | `setup` yazması KOŞULLU (yarış penceresi) | — | kırmızı (kaynak pini) | — |
| 9 | dal boşluğu fail-safe kapatıldı (epoch iddiasız token) | oturum canlı + iddia `true` | kırmızı | — |

**#5 notu:** kova KULLANICI ID'siyle; bu dala ulaşmak DOĞRU PAROLA gerektirdiği
için `forgot-req:{email}`'deki kurban-kilitleme tuzağı BURADA YOK.
**#6 notu:** bedel ÖLÇÜLDÜ — 12 kalemlik gerçekçi KB'de düşen 2 (Wi-Fi, Giriş
Talimatı); adres, acil telefon, kurallar, çevre, klima, çıkış hepsi kalıyor.
⚠️ `address` KB'den değil property kaydından ayrıca geçiyor; bu kapı onu
durdurmaz ve durdurmayı amaçlamaz (bilinen sınır).
**#7 notu:** İKİ BAĞIMSIZ İNCELEME de ilk hâlimi BLOKLAYICI saydı ve haklıydılar:
düzeltme yalnız API yolundaydı → `/admin` sayfası TAM RENDER oluyor ama her
düğme 401 dönüyordu. Yarım uygulanmış kapı, uygulanmamış olandan kötü.
**#8/#9 notu:** ikisi de denetçi bulgusu. #8 davranışsal testle vurulamıyor
(tek HTTP çağrısının içindeki yarış) → kaynak pini, ve bunun NEDEN kaynak pini
olduğu teste yazıldı. #9 bugün üretimde oluşamaz (LATENT) ama iki denetçi de
"sonraki düzenleyicinin tuzağı" dedi.

### Denetçi itirazlarından KABUL EDİLENLER
· sayfa yolu kapsanmıyordu (BLOKLAYICI) → kapatıldı
· `setup` yarış penceresi bcrypt ile ~100× büyümüştü → koşullu yazma
· iki `findUnique` → tek select
· fixture gerekçem GERÇEK DIŞIYDI ("üretimde oluşamaz") → dürüst gerekçeyle değişti
· adım listesi şifreden söz etmiyordu → metin güncellendi
· şifre alanı `error` bağı taşımıyordu (a11y) → `Field error` bağlandı
· dal boşluğu → fail-safe kapatıldı

### REDDEDİLEN (gerekçeli)
· "`disable`'da `sessionEpoch` artır" — tek satır ve emsali var, AMA 2FA'sını
  kapatan SIRADAN müşteriyi de çıkışa atar; fayda yalnız operatör yetkisinde.
  İddiayı düşürmek aynı korumayı bedelsiz veriyor. (Denetçi de "ikisi de uygun"
  dedi, ben ucuz olanı seçtim.)

**Notlar:** #1 kapı `setup`ta (sırrı üreten yol), `enable`de değil · #2 ilk
yazımım iddiayı MÜŞTERİNİN satırına karşı doğruluyordu ve impersonation'ı
kırıyordu, mevcut bir pin yakaladı · #5 kova kullanıcı-id'siyle ve bu dala
ulaşmak DOĞRU PAROLA gerektirdiği için kurban-kilitleme tuzağı YOK · #6 bedel
ölçüldü: 12 kalemlik KB'de düşen 2 (Wi-Fi, Giriş) · #7 iki bağımsız inceleme de
ilk hâlimi BLOKLAYICI saydı: `/admin` TAM RENDER oluyor ama her düğme 401.

### FAZ 4 — sır dedektörü: İKİ ADAY DA ÖLÇÜLDÜ ve REDDEDİLDİ (kod değişmedi)
`temel 11/18 kaçan · 1/14 yanlış elenen` → **A) isim ekle** 10/18 · 2/14
(+1 yakalama, +1 FP = NET KAZANÇ YOK; sebep yapısal: kalıp ismin HEMEN ARDINDAN
rakam istiyor) → **B) öbekli rakam** 8/18 · 4/14, yeni FP'ler TAM OLARAK 08-07
regresyonunun aynısı (ADRES, ACİL TELEFON, KAPICI TELEFONU).
Ölçüm `tests/unit/secret-detection-golden.test.ts`'te kalıcı (karakterizasyon:
hedef değil FOTOĞRAF). ⚠️ Faz 6'da AYRI bir kusur bulundu ve DÜZELTİLDİ: 4000
karakterlik tarama sınırı deterministik atlatmaydı → iki uç taranıyor.

---

## FAZ 5 — m48 UYGULAMA-ÖNCESİ DENETİM (kod/migration YAZILMADI)

Codex'in yedi noktası belgeye karşı tek tek ölçüldü. **Altısı zaten
karşılanıyordu**, biri eksikti ve eklendi:

| # | Codex'in şartı | Durum |
|---|---|---|
| 1 | Model sonucu yarışı — koşullu + atomik yazma | **EKSİKTİ → §3(c2) eklendi** |
| 2 | `aiTriageSource` allowlist (`model\|keyword`), NULL = bilinmiyor | ✅ §2(a) |
| 3 | Confidence: yalnız `isFinite` yetmez, 0–1 aralığı | ✅ §3(c), 6 geçiş |
| 4 | Boyut sınırları (300 kr / 5 madde × 120 kr), HTML değil escaped | ✅ §3(a) |
| 5 | Bayatlık ile temizleme çelişmiyor mu | ✅ §3(d)+(f) |
| 6 | KVKK kanaryası `Float` görmüyor | ✅ §2b, ölçülerek |
| 7 | Trigger mesajı silinince 500 vermemeli | ✅ §2(b) FK'siz + fail-safe |

**§3(c2) özeti:** model çağrısı 20–60 sn sürebiliyor; o sırada misafir yeni
mesaj yazarsa dönen sonuç BAŞKA bir konuşma durumuna aittir. Koşulsuz yazma
yeni mesajın triyajını eski analizle **sessizce** ezer (tüm alanlar dolu ve taze
görünür). Çözüm: `updateMany`'nin WHERE'ine `lastMessageAt: observedLastMessageAt`
tazelik koşulu; `count === 0` → yazma YOK ve bu bir hata değil. Aynı sınıf iki
mevcut kural: `autoReplyAttemptedAt` damgasının sunucu saatinden yazılmaması ve
`syncCursorAt` dersi. Test senaryosu + kontrol + mutasyon belgede yazılı.

**Sonuç: m48 UYGULAMAYA HAZIR — ama ayrı migration/yedek/onay turu bekliyor.**
Bu gece migration yazılmadı, üretilmedi, çalıştırılmadı.

---

## AÇIK SORULAR (sabah kararı) — hepsi ÖLÇÜLDÜ, hiçbiri kodlanmadı

### S1. Logout sunucuda iptal etmeli mi? (P0)
Bugün etmiyor: `logout` yalnız çerezi siliyor, `sessionEpoch` artıran 4 yerin
hiçbiri değil. Migration'sız TEK kaldıraç epoch artırmak, o da **"her yerden
çıkış"** demek (telefonda çıkış → dizüstünde de düşer).
⚠️ Şu ayrımı not et: middleware'in kayan yenilemesi iptal edilmiş bir oturumu
**AKLAMIYOR** (payload aynen imzalanıyor, bayat epoch taşınıyor), yani sorun
"çerez süresiz yaşıyor" değil, **iptal mekanizmasının logout'ta hiç
çalışmaması**. Gerçek çözüm per-session `jti` + iptal listesi = MIGRATION.
**Karar gerekiyor:** (a) epoch artır (her yerden çıkış, tek satır), (b) `jti`
migration'ı, (c) olduğu gibi bırak.

### S2. Trusted-device şifre sıfırlamayla düşmeli mi? (P2 — ÖLÇÜLDÜ)
`signTrustedDeviceToken` payload'ı `{ userId, purpose, epoch }` ve `epoch`
**2FA epoch'u** (`twoFactorEnabledAt`), `sessionEpoch` DEĞİL. Doğrulama üçünü de
eşitlik ile arıyor (`trusted-device.ts:52-56`), yani şifre sıfırlama token'ı
etkilemiyor: kurban ürünün söylediği tek şeyi yapıyor ama 2FA-atlama kimlik
bilgisi yaşamaya devam ediyor (30 gün, üstelik her güvenilen girişte yenileniyor).
**Düzeltme yolu:** payload'a `sessionEpoch` eklemek.
**BEDELİ (dürüstçe):** doğrulama alan eşitliği aradığı için, deploy anında
MEVCUT tüm güvenilen cihazlar geçersizleşir → her kullanıcı bir kez 6 hane girer.
Bir defalık ve küçük, ama görünür.
**BU GECE YAPILMADI ve gerekçesi disiplin:** halihazırda 7 değişiklik iki
bağımsız incelemede; incelenmemiş 8.'yi eklemek o incelemeyi anlamsız kılardı.

### S3. Sır dedektörü yapısal dengesi
İki aday da ölçülüp reddedildi (↑FAZ 4). Gerçek çözüm ayrı tur. Ad-hoc regex YOK.

---

## DOKUNULMAYAN RİSKLER (bilinçli)
· `middleware` kayan yenilemesi (iptal ile ilgisi yok, ↑S1) · `INJECTION_PATTERNS`
kara listesinin yapısal yetersizliği (yapısal sınıflandırıcı işi) · `address`ın
property kaydından prompt'a girmesi · `logout`/`2FA disable` epoch artırmaması
(↑S1) · `docs/ACIK-ISLER-2026-08-08.md`'deki diğer 16 madde.

## FAZ 6 — BAĞIMSIZ SALDIRGAN DENETİMİ (iki ajan) → HEPSİ KAPATILDI

Saldırgan ve savunmacı ayrı ayrı koştu. Savunmacı önce **DO NOT SHIP** dedi.
Bulguların hepsi kodla doğrulandı ve düzeltildi; sonra revize hüküm: SHIP.

| Bulgu | Sonuç |
|---|---|
| 🔴 Süzülen kalemler `knowledgeBaseDropped`e eklenmiyordu | DÜZELTİLDİ + davranışsal pin |
| 🔴 Kapı ÖLÜ KODA çevrilebiliyordu (`kbVisible` kullanılmıyor) mutasyon YEŞİL | pin eklendi → kırmızı |
| 🔴 Sayfa yolu `mfa` düzeltmesi PİNSİZ (2 mutasyon yeşil) | iki test eklendi → ikisi de kırmızı |
| 🔴 4000 karakter tarama sınırı = deterministik ATLATMA | iki uç taranıyor (tavan 8000) |
| 🟡 429 süreyi söylemiyordu (deponun 08-07 kuralı) | "≈N dakika" + pin |
| 🟡 Kota kurtarma kodu dalında pinsizdi | pin eklendi → kırmızı |
| 🟡 `armed.count === 0` işlenmesi pinsizdi | kaynak pini genişletildi |
| ⚪ Probe dosyaları commit'e süpürülmüştü | commit'ten çıkarıldı |

**🚨 BLOCKER 1 benim ürettiğim gerçek kusurdu:** kapı iki kalemi elerken modele
"0 kalem düştü" deniyordu → prompt bilgi tabanını TAM sanıyor, "bilgi yok DEME,
insana devret" notu HİÇ gitmiyordu. En kötü hâl: yalnız Wi-Fi + Giriş şablonunu
doldurmuş host'ta prompt **aday müşteriye "kayıtlı bilgi yok"** diyordu —
insan olmadan, oto-gönderilerek. Kardeş yol (`guest-chat.ts`) bu hatayı 07-31'de
zaten yaşamış ve düzeltmişti; formül birebir ondan alındı.

⚠️ **KENDİ TESTİM YANLIŞ SEBEPLE YEŞİLDİ:** `armed.count === 0` için yazdığım
test o dala HİÇ ULAŞMIYORDU (daha önceki okuma kapısı devreye giriyor). Yanıltıcı
test KALDIRILDI, yerine dürüst kaynak pini + "neden davranışsal olamaz" notu.

## KAPATILMAYAN (ölçüldü, gerekçeli)
· `mapReservationStatus` bilinmeyen durumu VARSAYILAN `"confirmed"` sayıyor →
kapının yüklemi gereğinden geniş (senkron hot-path'i, ayrı tur) · `looksLikeSecret`
yapısal dengesi · `address` property kaydından geçiyor · `requireAuth` catch
dalında iddia düşmüyor (fail-open, BİLİNÇLİ — rol clamp'i devrede).

## PUSH DURUMU
İki inceleme de SHIP dedi (savunmacının ilk hükmü DO NOT SHIP idi; bulgular
kapatıldı). Kapılar: typecheck 0 · lint 0 · **3161 test yeşil** · build temiz.
Migration/şema/env/Railway/prod: DOKUNULMADI.
