# CalendarSource.url at-rest şifreleme — expand-contract TASARIMI

> **DURUM: YALNIZ TASARIM.** Migration YAZILMADI, kod DEĞİŞTİRİLMEDİ, prod'a
> DOKUNULMADI (Codex 07-27 talebi: "yalnız tasarımı çıkar ve dur"). Uygulama
> ayrı bir turda, aşağıdaki sırayla ve her fazı ayrı doğrulayarak yapılır.

## 1. Sorun (kod-doğrulanmış)

`CalendarSource.url` düz metin. Airbnb/Booking iCal linkleri **query-string'de
kimlik bilgisi taşır** (`?s=<secret>` deseni) — yani bu kolon fiilen bir sır
kolonudur. Bugünkü koruma katmanları:

* UI maskeleme ✓ (yalnız görüntüleme)
* Export maskeleme ✓ — `data-export.ts:33` ham URL'i maskeli metadata'ya çevirir
* HTTPS zorunlu ✓ (create + sync)

Korunmayan yüzey: **DB'nin kendisi** — yedek/dump/PITR kopyası, DB erişimi olan
herhangi bir süreç düz URL'i okur. Hospitable token'ları için bu kapalı
(şifreli, `getOrgHospitableToken`); feed URL'leri için açık. CLAUDE.md AÇIK
İŞLER'de "feed-URL at-rest şifreleme (UI maskeleme ✓)" olarak zaten kayıtlı.

## 2. Dokunulacak yüzey (kod-doğrulanmış, tamamı)

| nokta | dosya | işlem |
|---|---|---|
| **YAZMA (tek)** | `properties/[id]/calendar-sources/route.ts:40` | create — `data: { propertyId, label, url }` |
| OKUMA 1 | `lib/import/sync.ts:96` | `new URL(source.url).hostname` (private-host re-check) |
| OKUMA 2 | `lib/import/sync.ts:103` | `fetchFeedText(source.url, …)` |
| OKUMA 3 | `lib/data-export.ts:33` | `const raw = source.url` → maskeleme |

URL güncelleme rotası YOK (label/silme var, url rewrite yok) → dual-write tek
noktaya kurulur. Bu, projedeki en dar expand-contract yüzeylerinden biri.

## 3. Kripto: mevcut emsal aynen kullanılır, yeni mekanizma YOK

* **Fonksiyonlar:** `crypto.ts` `encryptSecretBound(plain, aad)` /
  `decryptSecretBound(payload, aad)` — AES-256-GCM, `ENCRYPTION_KEY`.
* **AAD (EmailOutbox m44 emsali, `email-outbox.ts:77 aadFor`):**
  `calendar-source-url:v1:{id}:{organizationId}` — id insert'ten ÖNCE üretilir
  (m44'te çözülmüş desen: id'yi üret → AAD'yi hesapla → `create` id ile).
  Böylece bir satırın şifreli URL'i başka satıra/org'a KOPYALANAMAZ
  (ciphertext-swap kapalı).
* **Anahtar:** `ENCRYPTION_KEY`. Rotasyon zaten YASAK (canlı token kuralı) —
  bu tasarım o kurala yeni bağımlılık EKLEMEZ, mevcut bağımlılığı paylaşır.
* **Anahtar-parmak-izi:** `urlKeyFp` kolonu (erasure `ERASURE_HMAC_SECRET`
  fingerprint emsali) — yanlış anahtarla açılış "sessiz çöp" değil, teşhisli
  hata olur.

## 4. Fazlar (her biri ayrı deploy; Faz 0–3 geri alınabilir, Faz 4 İLERİ-YÖNLÜ)

**Faz 0 — additive migration (m46 adayı):** `urlEnc String?` + `urlKeyFp
String?`. Nullable, default yok, index yok → dolu tabloya güvenli (boot
kuralı ihlali yok). Taze PG'de 00→N zero-drift ELLE doğrulanır (test harness
`db push` kullandığından zinciri yakalamaz — bilinen kural).

**Faz 1 — dual-write:** create rotası `url` + `urlEnc` + `urlKeyFp` üçünü
birden yazar. Okumalar hâlâ `url`. Rollback = eski kodu deploy et; `urlEnc`
kullanılmayan kolon olarak kalır, hiçbir şey kırılmaz.

**Faz 2 — backfill:** idempotent script — `WHERE urlEnc IS NULL` batch'le
(100'lük), her satır için encrypt + updateMany(id, urlEnc:null koşullu).
Satır sayısı bugün küçük (tek gerçek müşteri) → tek geçiş. Doğrulama sorgusu:
`COUNT(*) WHERE urlEnc IS NULL` = 0. Rollback = gereksiz (yalnız kolon doldu).

**Faz 3 — dual-read:** 3 okuma noktası tek erişimciden geçirilir:
`getCalendarSourceUrl(row)` → `urlEnc` varsa çöz, yoksa `url` (geçiş penceresi
fallback'i). Çözme hatası (yanlış AAD/anahtar) **fail-closed**: o source sync
DIŞI kalır + aggregate alarm (iCal aggregate-alarm emsali), ASLA düz kolona
sessiz düşme — aksi hâlde şifreleme "varmış gibi" olur. Rollback = eski kod;
`url` hâlâ dolu ve doğru.

**Faz 4 — contract (EN SON, acele YOK — GERİ ALINAMAZ, Codex düzeltmesi):**
create artık `url`'e **sabit sentinel** (`"enc:"`) yazar (kolon NOT NULL
kaldığı için NULL yapılamaz — drop etmek de ayrı migration ve boot riski;
sentinel en ucuz güvenli adım), backfill'in ikizi eski satırların `url`'ünü
sentinel'e çevirir. Bu bir **ileri-yönlü contract adımıdır**: sentinel
yazıldığı an düz URL bu satırdan silinmiştir ve "eski kodu deploy et"
rollback'i ARTIK ÇALIŞMAZ (eski kod sentinel'i URL sanır). Ön şartları bu
yüzden diğer fazlardan sert:

  1. **Taze pg_dump** — Faz 4'ten hemen önce, doğrulanmış (prod dupe-temizliği
     emsalindeki gibi restore-edilebilirliği bilinen) bir yedek.
  2. **TAM çöz-ve-karşılaştır doğrulaması** (sayım YETMEZ — Codex düzeltmesi):
     her satır için `decryptSecretBound(urlEnc, aad)` GERÇEKTEN çözülür,
     `urlKeyFp` mevcut anahtarın parmak iziyle eşleşir ve çözülen değer
     `url` kolonundaki düz metinle **birebir** (===) karşılaştırılır.
     Tek bir uyuşmazlık = Faz 4 İPTAL, önce neden ayrışmış bulunur.
     `COUNT(*) WHERE urlEnc IS NULL` yalnız ilk hızlı ön kontroldür.
  3. Prod'da Faz 3 en az bir tam sync döngüsü sorunsuz koşmuş olmalı.
  4. **Anahtar yedeği DOĞRULANMIŞ olmalı (Codex, ön şart):** `ENCRYPTION_KEY`
     DB yedeğinden AYRI ve güvenli bir yerde (Railway dışı, örn. parola kasası)
     yedekli — contract sonrası anahtarsız DB yedeği okunamaz şifreli metindir
     (ayrıntı §5). Yedeğin VARLIĞI Faz 4 başlamadan teyit edilir.

Gerçek drop İSTENİRSE ayrı bir m47 ve ayrı karar — zorunlu değil.

**DURUM (2026-07-29): Faz 4 KODU HAZIR, PROD'DA KOŞULMADI.** Ön şartların
dördü de sağlandı (post-sync dump + 8/8 tam çöz-karşılaştır + urlEnc yolundan
gerçek prod sync + ayrı anahtar yedeği). Uygulama iki parça:

* **Parça A (deploy edilebilir, davranış değiştirmez):** create'in sentinel
  yazımı `CALENDAR_URL_CONTRACT_ENABLED` bayrağının arkasında (**DEFAULT
  KAPALI**, yalnız `"1"` açar; mutasyon-testli parite — bayrak kapalıyken
  bugünkü dual-write birebir). Erişimciye `sentinel-without-ciphertext`
  fail-closed dalı eklendi (sentinel hiçbir koşulda URL gibi dönmez). Mülk
  sayfası maskeyi artık SUNUCUDA üretir (ham URL RSC payload'ına binmez);
  create 201 gövdesi sır taşımaz.
* **Parça B (geri alınamaz an, YALNIZ operatör + açık onay):**
  `scripts/contract-calendar-url-sentinel.ts` — dry-run varsayılan, sayı-kapılı
  apply, satır başına SON-AN çöz+`===` kanıtı olmadan sentinel YAZMAZ (toplu ön
  doğrulama bayatlayabilir; bu yazma anında koşar), CAS'lı update, apply
  sonrası otomatik post-contract tam doğrulama. Rollback aracı:
  `scripts/restore-calendar-url-plaintext.ts` — anahtar sağlamken sentinel
  satırları urlEnc'ten geri yazar (dump restore'a gerek kalmadan).
  `verify-calendar-url-enc.ts --post-contract` post durumunu her satırı açarak
  asserte eder. Üçü de taze yerel PG'de uçtan uca prova edildi (contract →
  post-verify → restore → pre-verify birebir başlangıç durumu).

## 5. Etkileşimler (denetlendi)

* **Export:** `data-export.ts` maskesi erişimciye bağlanır; ciphertext ASLA
  export'a girmez (secret-scan pin testi genişletilir — mevcut pin emsali var).
* **Erasure/retention:** feed URL'i misafir PII'si DEĞİL → SCRUB KAPSAMI
  KURALI'na (07-25) girmez; iki süpürgeye bağlanmaz. Org silmede Cascade
  zaten satırı götürüyor.
* **Sync güvenliği:** `sync.ts:96` hostname re-check'i erişimciden dönen ÇÖZÜLMÜŞ
  değerle aynen çalışır — DNS-rebind pinine dokunulmaz.
* **Boot kapısı:** yeni env YOK → env-check değişmez.
* **Anahtar yedeği (Codex, operasyonel):** Faz 4 sonrası DB yedeği TEK BAŞINA
  işe yaramaz — URL'ler ancak `ENCRYPTION_KEY` ile açılır. Kural: DB yedeğinin
  yanında `ENCRYPTION_KEY` de **ayrı ve güvenli bir yerde** (Railway dışı,
  örn. parola kasası) yedeklenmiş olmalı; bu Faz 4 ön-şart listesine dahildir.
  Anahtar ROTASYON yasağı zaten mutlak — bu yedek "kayıp" senaryosu içindir.

## 6. Test planı (uygulama turunda, kırmızı-önce)

1. round-trip: encrypt→decrypt AAD doğru/yanlış (yanlış AAD → throw).
2. dual-write: create sonrası üç kolon da dolu ve tutarlı.
3. dual-read: yalnız-`url` (legacy), yalnız-`urlEnc`, ikisi-dolu → hepsi aynı
   sync davranışı; bozuk `urlEnc` → source sync-dışı + alarm, `url`'e düşmez.
4. backfill idempotency: iki koşu = tek sonuç.
5. export secret-scan: ciphertext ve düz URL ikisi de dışarı sızmaz.
6. sentinel sonrası eski okuma yolunun ÖLDÜĞÜ (Faz 4 pini).
7. **erişimci-atlatma pini (Codex, yapısal):** kaynak-tarama testi —
   `src/` altında `.url` erişimi calendar-source satırlarında YALNIZ
   erişimci modülünde geçebilir (canonical-origin literal-pini ve
   deployment-timezone writer-haritası emsali). Faz 3'te yeşile bağlanır;
   sonradan erişimciyi atlayan yeni kod derhal kırmızı olur.

## 7. Bilinçli sınırlar

* `SystemLock`/kilit gerekmez — tek yazma noktası, yarış yüzeyi yok.
* Bu tasarım **iCal disappearance-reconcile bayrağından bağımsız** — o kapalı
  kalmaya devam eder.
* Prod dry-run/backfill, kullanıcı onayı + pg_dump SONRASI (değişmez kural).
