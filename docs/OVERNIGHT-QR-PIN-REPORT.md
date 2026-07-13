# Gece Turu Raporu — FAZ 5: Rezervasyona Özel QR PIN (#14)

> **Durum: TAMAMLANDI, PUSH EDİLMEDİ.** Tüm iş `claude/great-edison-3zqpZ` üzerinde
> LOCAL commit'lerde. Sabah onayınla push edilecek. Bu belge: local SHA'lar,
> mimari kararlar, test/migration sonuçları, tavizler, sabah kontrol noktaları.

## Local commit'ler (henüz push yok)
> Not: commit'ler "Unverified" görünmesin diye re-author edildi (rebase --exec
> reset-author); aşağıdaki SHA'lar re-author SONRASI günceldir.

| SHA | Parça |
|---|---|
| `c97da7c` | m27 additive şema (Reservation.chatPin* + Organization.qrChatPinRequired) |
| `d6057aa` | PIN lib (HMAC+pepper, timing-safe, kalıcı lockout) |
| `0e9eb2d` | PIN kapısı (bindOrCheckStay allowClaim + chat route GET/POST gate + unlock) |
| `b7c40bd` | Host PIN üretme/temizleme rotası (withManage, tenant-scoped, audit) |
| `6302b8b` | Org strict toggle + export/cascade sızıntı testleri |
| `5ea3fbf` | UI (host ReservationPinControl + misafir PIN girişi + strict toggle) |
| _(tip)_ | Concurrency-fix (lockout TOCTOU) + env docs + bu rapor — SHA için `git log -1` (commit kendi hash'ini içeremez) |

Base (Faz 5 öncesi son commit): `8dacd63` (= origin tip). Diff: `git diff 8dacd63..HEAD`.
Stash: **yok** (`git stash list` boş). **Push YOK** — HEAD origin'in 7 commit önünde.

## Ne yapar
Dairenin QR'ı **statik ve property-başına** (bearer credential). Cihaz-bağlama, geçmiş
misafirin mevcut misafirin sohbetini OKUMASINI engelliyordu ama "ilk tarayan kazanır"
hâlâ temizlikçi/komşu/erken-tarayanın stay'i **sahiplenmesine** açıktı. PIN bir **bilgi
faktörü** ekler: host booked misafire bir kod verir; yalnız kodu bilen sohbeti cihazında
açabilir. Açıldıktan sonra cookie devralır, PIN bir daha sorulmaz.

## Mimari kararlar (Codex planından bilinçli sapmalarla)
1. **HMAC + göster-bir-kez (Codex'in re-viewable PIN'i yerine).** PIN yalnız
   `HMAC-SHA256(pepper, "qr-pin:v1:<reservationId>:<pin>")` olarak saklanır — **düz PIN
   DB'de YOK**, tersinir sır yok. Host kodu üretimde bir kez görür (recovery-codes
   desenim); kaybederse yeniler. Gerekçe: tersinir sır saklamaktan güvenli + basit.
2. **reservationId HMAC mesajına gömülü** → A rezervasyonunun hash'i B'de doğrulanamaz
   (çapraz-stay replay imkânsız), pepper sızsa bile.
3. **Pepper = `QR_PIN_PEPPER || AUTH_SECRET`.** DB'de değil → DB okuması tek başına
   6-haneli PIN'i offline brute-force edemez. Rotasyon PIN'leri geçersiz kılar (host
   yeniler) — kısa ömürlü kod olduğu için kabul (ENCRYPTION_KEY gibi sabit tutma şartı yok).
4. **PIN cihaz-bağlamanın İLK CLAIM kapısı.** `bindOrCheckStay` yeni opsiyonel
   `allowClaim` (default **true** = tüm eski çağrı yerleri aynen); `allowClaim:false` +
   unbound → yeni `"unclaimed"` statüsü, kimse sadece tarayarak claim edemez.
5. **3 katlı geriye-uyum:** env `QR_PIN_ENABLED` (master, default OFF) · org
   `qrChatPinRequired` (strict mod, default OFF) · per-reservation PIN varlığı.
   PIN gerekir ⟺ env AND (bu rezervasyonun PIN'i var VEYA org strict).
6. **Brute-force iki katman:** IP limiti (`guestchat-pin` 8/5dk) + **kalıcı per-reservation
   sayaç/lockout** (10 hata → 15 dk kilit; multi-replica atomik increment). Malformed
   giriş attempt yakmaz (fat-finger'a adil; brute-forcer'ın well-formed tahminleri sayılır).

## Eski kayıt davranışı (geriye-uyum)
- **`QR_PIN_ENABLED` KAPALI (varsayılan):** özellik tamamen dormant. Deploy anında mevcut
  QR sohbetlerinde SIFIR değişiklik. Host PIN kontrolü + strict toggle UI'da görünmez;
  chat-pin route 404; resolveGuestChat `pinRequired=false`.
- **Env AÇIK ama org strict KAPALI:** yalnız host'un PIN ürettiği rezervasyonlarda kod
  istenir; PIN'siz eski/yeni rezervasyonlar ilk-tarayan cihaz-bağlama akışında kalır
  (gentle opt-in, sürpriz yok).
- **Env AÇIK + org strict AÇIK:** her claim-edilmemiş stay PIN ister; PIN'siz rezervasyon
  fail-closed (host kod üretene kadar sohbet kilitli). Aktif misafir toggle'dan ÖNCE
  cihazını bağladıysa etkilenmez (bound-ok PIN'i atlar; yalnız yeni claim'ler PIN ister).

## Migration (m27) — additive, kanıtlı
`ALTER TABLE ... ADD COLUMN` yalnız: Reservation.{chatPinHash TEXT null, chatPinSetAt
TIMESTAMP null, chatPinFailedCount INTEGER NOT NULL DEFAULT 0, chatPinLockedUntil
TIMESTAMP null} + Organization.qrChatPinRequired BOOLEAN NOT NULL DEFAULT false.
- **Taze temiz DB 00→27 migrate deploy:** başarılı (28 klasör 00-27).
- **Dolu tabloya 27 uygulama:** eski satır `chatPinFailedCount=0`, hash/kilit NULL, org
  `qrChatPinRequired=false` aldı.
- **Eski-şekil INSERT (yeni kolonsuz) 27 sonrası:** çalışıyor → eski deployment uyumlu.
- **Zero-drift:** `migrate diff --exit-code` → "No difference detected".

## Test sonuçları
- **Full suite: 1089 test yeşil** · typecheck temiz · `next build` temiz.
- Faz 5 hedefli testler (kırmızı-önce yazıldı):
  - `guest-chat-pin.test.ts` (13) — lib crypto/storage/verify/lockout/regeneration.
  - `guest-chat-pin-gate.test.ts` (12) — route kapısı: flag off eski akış; flag on PIN'li
    (GET pinRequired+claim yok, mesaj bloklu AI yok, yanlış PIN generic, doğru PIN
    unlock+bind, unlock sonrası GET/mesaj, lockout doğru PIN'i bile kilitler, PARALEL 2
    cihaz tek kazanan, per-IP 429); org strict fail-closed; iptal PIN sormaz; regeneration.
  - `reservation-chat-pin-route.test.ts` (8) — owner/manager üret, staff 403, regeneration,
    cross-tenant 404, flag off 404, DELETE + cross-tenant DELETE, audit'te PIN yok.
  - `guest-chat-pin-security.test.ts` (4) — strict toggle on/off + staff 403, export
    secret-scan (chatPinHash yok), hesap silme cascade.
  - `tests/ui/guest-chat.test.tsx` (+2) — misafir PIN ekranı: yanlış/doğru unlock + 429.
- Mevcut guest-chat suite'leri regresyonsuz (46/46 PIN kapalıyken eski davranış).

## Bağımsız diff-review (8-alan adversarial) — 1 gerçek bulgu, düzeltildi
Gece sonunda bağımsız bir ajan tüm Faz 5 diff'ini 8 saldırı ekseninde denetledi:
- **Bulgu 1 (GERÇEK, düzeltildi) — lockout concurrency TOCTOU:** eski `verify`
  önce `findUnique` ile kilidi okuyor, HMAC karşılaştırmasını yapıyor, SONRA ayrı
  atomik increment ediyordu. Eşzamanlı/multi-replica bir patlama (hepsi
  "kilitli değil" okuyup) karşılaştırmayı kilit yazılmadan ÖNCE çalıştırıyordu →
  bir pencerede 10 yerine ~burst-boyutu kadar tahmin denenip 6-haneli uzay hızla
  taranabiliyordu. **Düzeltme:** karşılaştırmadan ÖNCE **atomik slot rezervasyonu**
  (`chatPinFailedCount < MAX` koşullu increment, satır kilidinde serialize olur) →
  pencere başına en fazla MAX **karşılaştırma**; gerisi hiç karşılaştırmadan
  "locked". Kırmızı-önce kanıt: eski kodda 40 eşzamanlı yanlış tahmin → 40 "invalid"
  (test kırmızı); düzeltme sonrası ≤10 "invalid", gerisi "locked" (yeşil).
  `guest-chat-pin.ts:120-175` · test `guest-chat-pin.test.ts` "CONCURRENCY CAP".
- **Diğer 7 eksen TEMİZ:** claim yarışı (tek kazanan, PIN'siz claim yolu yok),
  tenant izolasyonu (host route org-scoped 404, public route global-unique token),
  secret sızıntısı (export/audit/response/pinRequired boolean'da hash yok, invalid+
  no_pin tek generic), lifecycle (iptal kapalı, regeneration atomik, turnover
  bloklu), migration (additive-safe), geriye-uyum (env-off tam inert), HMAC/pepper
  (reservation-bound, üretilen PIN kendini doğrular).

## Bilinen tavizler (belgeli)
- **Per-reservation lockout DoS:** kötü niyetli biri yanlış PIN spam'iyle gerçek misafiri
  15 dk kilitleyebilir. Kısa pencere self-heal; host "kodu yenile" ile de sıfırlar; misafir
  cihazını bağladıktan sonra PIN gereksiz. Mevcut "turnover erken-tarayan claim=DoS, host
  reset çözer" tavizinin aynı sınıfı.
- **Pepper rotasyonu tüm PIN'leri geçersiz kılar** (host yeniler) — bilinçli.
- **Lockout increment sonrası kilit-set best-effort:** eşzamanlı çift-eşik geçişi kilidi iki
  kez set eder (zararsız). Sayaç increment'i atomik → sayı doğru.
- **Host UI yeri:** PIN kontrolü property sayfası "Son Rezervasyonlar" listesinde (son 5).
  Ayrı rezervasyon-detay sayfası yok; mevcut yüzeye eklendi (kapsam genişletilmedi).

## Sabah kontrol noktaları (push ÖNCESİ)
1. Bağımsız diff-review bulguları: rapor commit'inden sonra `docs`e eklenmiş olacak — GERÇEK
   bulgu varsa kırmızı-önce düzeltilmiş olmalı (bkz. son commit).
2. Push kararı: `git push -u origin claude/great-edison-3zqpZ` (senin onayınla).
3. Railway env: **`QR_PIN_ENABLED` EKLEME** (varsayılan OFF kalsın) — hazır olunca
   birlikte aç + ilk PIN akışını canlı doğrula. İstersen `QR_PIN_PEPPER` set et (opsiyonel).
4. m24-27 canlıya uygulandı + deployment Active olduğunu Railway panelinden teyit.
5. CLAUDE.md'ye Faz 5 satırı eklenecek (push turunda).

## Değişen/eklenen dosyalar
**Yeni:** `src/lib/guest-chat-pin.ts` · `src/app/api/reservations/[id]/chat-pin/route.ts` ·
`src/components/properties/reservation-pin-control.tsx` · `prisma/migrations/27_reservation_chat_pin/`
· 4 test dosyası.
**Değişen:** `prisma/schema.prisma` · `src/lib/guest-chat.ts` · `src/app/api/chat/[token]/route.ts`
· `src/app/api/settings/route.ts` · `src/lib/audit.ts` · `src/components/guest-chat/guest-chat.tsx`
· `src/components/properties/guest-chat-settings.tsx` · `src/app/(app)/properties/[id]/page.tsx`
· `.env.example` · `DEPLOYMENT.md` · `tests/ui/guest-chat.test.tsx`.
