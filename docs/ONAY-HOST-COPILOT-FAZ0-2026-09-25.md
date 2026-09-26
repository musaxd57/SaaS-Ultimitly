# Host Copilot — Faz 0 onay paketi (09-25)

> **Durum:** ONAY BEKLİYOR. Kod YOK, migration YOK.
> **Kaynaklar:** `docs/HOST-COPILOT-GEREKSINIMLERI-2026-09-25.md` §14 (Faz 0) ve `docs/MESAJLASMA-CEKIRDEGI-V2-2026-09-25.md`
> §3 (Host Karar Motoru; aşağıda **MÇ §x**).
> **Kurucu:** "Her şeyi bitirince bu sisteme bakarız."
> Mesajlaşma çekirdeği v2'nin onay gerektirmeyen kalemleri bitti. Hepsi migration'sız ve bayrakları kapalı:
> - kapanışa sessizlik;
> - zaman bağlamı;
> - bekleme sözü vetosu;
> - konuşma kayıtları;
> - anlama katmanına tarih satırı;
> - eylem beyanı.
>
> Bu belge "bakarız" anını hızlandırmak için var: kararlar en üstte, gerekçe ve tasarım altta.

## 0. Kurucunun vereceği kararlar

| # | Karar | Öneri | Neden |
|---|---|---|---|
| K1 | Faz 1'in kapsamı: yalnız **web kartı** (gelen kutusu). WhatsApp, ses ve sohbet sonraki fazlar. | **Evet** | Karar çekirdeği kanalsız doğrulanır. WhatsApp yalnız yeni bir kapı olur (gereksinim §11). |
| K2 | Yeni tablo `DecisionRequest` (tek migration; taze `pg_dump` + açık "push et"). | **Evet** | Mevcut tablolar kararı taşıyamıyor (§2.2). |
| K3 | Karar gecikirse misafire ne gider. | **Bugünkü davranış**: kanalda sessizlik, QR'da olgu cümlesi. Tek yapılandırma noktası. | Kurucu: "şimdi sabitlemeyelim" (MÇ §3.4). |
| K4 | Onay / red / karşı teklif metinleri, 6 dil (koddan kurulur). | Taslakları bu belgenin onayından sonra yazılır, **metin onayı ayrı**. | Misafire giden metin. |
| K5 | Yeni e-posta: "Karar bekliyor" (ev sahibine). | **Evet**. İlk canlı denemeler birlikte. | E-posta akışı kuralı. |
| K6 | Karar sonrası giden mesaj raporda nasıl sayılır. | "Ev sahibi yazdı + `aiAssisted`". | Karar ev sahibinin; metni kod kurdu. |
| K7 | "Ben ilgileneceğim" (devralma) ne zaman biter. | Ev sahibi o konuşmaya yazınca **ya da** 24 saat dolunca. Hangisi önce olursa. | Sonsuz kilit yok; "Sorunlu" kalıcı durdurmadan ayrı. |
| K8 | Uzatma / geç çıkış ücretinin kaynağı. | Ev sahibinin **kayıtlı kuralı**. Yoksa kartta **elle tutar** girilir. Kanal fiyatı YOK. | Sağlayıcıdan fiyat okunmuyor; model tutar üretmez. |
| K9 | Operatör (süper-admin) müşteri adına karar verebilir mi? | **Hayır**: canlandırma oturumunda karar düğmeleri salt-okuma. | Misafire giden kararın yazarı müşteri olmalı. |
| K10 | Personel (staff) kartları görür mü? | **Hayır** (yalnız owner / manager). | Kart misafir mesajı taşır; personel görünümü kuralı. |

Şimdi karar GEREKMEYENLER (sonraki fazlar):
- WhatsApp sağlayıcısı (Meta Cloud API ya da BSP), şablon onayı, açık rıza — Faz 5;
- ses dökümü sağlayıcısı (alt-işleyen listesi) — Faz 6.

## 1. Bugün (kodda doğrulandı; MÇ §3.1)
- **Erken giriş çekirdeği** dört durum üretir: `approvable · pending · needs_host · not_early`. Otomatik RED yok.
  - Kendiliğinden gidebilen tek metin: kural `auto` iken iki modelin aynı saati okuduğu, tek konulu mesaj.
- **Ev sahibinin gördüğü:**
  - "AI emin olamadı" bandı;
  - kontrol listesi ve hazır cevap ("AI cevap öner" modeli yeniden çağırır, kota harcar).
  - **Onay / red düğmesi yok.**
- **`/api/conversations/[id]/reply`** ev sahibi adına gönderir ama olguları **yeniden doğrulamaz**. Sabah hazırlanan
  taslak akşam değişmeden gidebilir (TOCTOU).
- **Geç çıkış:**
  - doğrulama yok;
  - tek ayar org genelindeki serbest metin teklif;
  - verilen istisna hiçbir yerde yapısal kaydedilmiyor. Onaylanan geç çıkış sonraki misafirin erken giriş kontrolünde
    görünmez.
- **Mevcut yapı taşları (yeniden kullanılacak):**
  - kural deposu `AutomationRule` (erken giriş kuralı `early_checkin_request`, mülk başına tek satır);
  - giden mesaj yolu: `MessageOutbox`, idempotency `(organizationId, idempotencyKey)` tekil, claim-then-send;
  - denetim: `AuditLog`;
  - görev geçmişi: `TaskUpdate`;
  - kanıt: `RiskEvent.kbEvidenceJson` (`ec` dayanakları).

## 2. Veri modeli (Faz 1 — tek migration)

### 2.1 `DecisionRequest` (yeni tablo)
- **Kimlik ve kapsam:**
  - `id`, `organizationId` (her sorgu bununla);
  - `propertyId`, `conversationId`, `reservationId?`.
- **İstek:**
  - `kind`: `early_checkin | late_checkout | extend` (Faz 1'de ilk ikisi; uzatma müsaitlik motoruyla);
  - `requestMessageId` (kartı doğuran misafir mesajı);
  - `requestedTime` ("HH:MM" ya da null);
  - `dayKey` (hedef takvim günü, tek tarih kuralı).
- **Olgu fotoğrafı (yalnız saat / sayı / kimlik — METİN YOK):**
  - `factsJson`: önceki çıkış, sonraki giriş, temizlik durumu, kural özeti, çakışma;
  - `factsHash` ve `ruleHash`: yeniden doğrulamada karşılaştırılır;
  - `failedCodes`: çekirdeğin kapalı-küme gerekçeleri.
- **Sürüm ve yaşam döngüsü:**
  - `version`, `status` (§3), `supersedesId?`;
  - `lang` (misafirin dili; metin dilini kod seçer).
- **Karar:**
  - `resolution`: `approve | reject | counter | custom | takeover`;
  - `decidedTime?` (karşı teklif saati), `feeAmount?` + `feeCurrency?` (yalnız K8 kaynağından);
  - `decidedById`, `decidedAt`.
- **Sonuç:**
  - `resultMessageId?` (giden Message), `outboxId?`;
  - `notifiedAt?` (e-posta, K5).
- **Zaman damgaları:** `createdAt`, `updatedAt`, `expiresAt` (istenen gün geçince `expired`).
- **İndeksler:**
  - `(organizationId, status)`;
  - `(conversationId, status)`;
  - tekillik: `(organizationId, requestMessageId, kind, version)`.
- **Silme ve saklama:**
  - konuşma / mülk silinince `Cascade`;
  - misafir erasure'ında kayıt kalır (metin taşımaz);
  - `decidedById` kullanıcı silinince `SetNull`.

### 2.2 Neden mevcut tablolar yetmiyor
- **`RiskEvent`:** tekillik anahtarı ikinci bir insan kararını kaydedemiyor; karar kaydıdır, iş akışı değil.
- **`AuditLog`:** durum ve tekil anahtar yok; "hangi kart açık, kim karar verdi, gönderildi mi" sorgulanamaz.
- **`AutomationRule`:** kural deposu; tek tek kararlar için değil.
- **`Task`:** personel iş kalemi. Karar kartı misafir mesajı taşır ve personel görmemeli (K10).
- **`MessageOutbox`:** yalnız gönderimi dışlar (claim 120 sn). Kararın yaşam döngüsünü tutmaz.

### 2.3 Sonraki fazların kayıtları (şimdi onay İSTENMEZ; yön belli olsun diye)
- **Faz 2 — `HostInstruction`:** serbest talimatın yapılandırılmış yorumu.
  - tür: karar / talimat / bilgi / sorgu / devralma (gereksinim §9);
  - alanlar, önizleme ve onay durumu;
  - kaynak: web yazısı; ileride WhatsApp ya da ses dökümü.
- **Faz 7 — `Action` + `ActionReceipt`:** gerçek eylem ve makbuzu (temizlikçiye bildirim, görev).
  - `claimedActions` (eylem beyanı) bu makbuzla eşleşir.
- **Taslak, onay ve son mesaj** ayrı tablo olmaz:
  - taslak = koddan kurulan önizleme (saklanmaz, her açılışta yeniden kurulur);
  - onay = `DecisionRequest.decided*`;
  - son mesaj = mevcut `Message` + `MessageOutbox`.

## 3. Durum makinesi (`DecisionRequest.status`)

| Durum | Anlamı | Giriş | Çıkış |
|---|---|---|---|
| `pending` | Kart açık, karar bekliyor | Akış `needs_host` / `pending` üretti | `deciding`, `superseded`, `cancelled`, `expired`, `answered_manually`, `resolved_by_policy` |
| `deciding` | Ev sahibi tıkladı; kilitli (CAS) | `pending` + sürüm eşleşti | `sent`, `send_unverified`, `pending` (409: olgu değişti → taze kart) |
| `sent` | Metin gitti (makbuzlu) | Outbox `sent` | — |
| `send_unverified` | Belirsiz gönderim | Outbox `ambiguous` | Uzlaştırma → `sent` |
| `superseded` | Aynı türde yeni istek (yeni saat) | Yeni sürüm açıldı | — |
| `cancelled` | Misafir vazgeçti ya da rezervasyon iptal | Akış / senkron | — |
| `expired` | İstenen gün / saat geçti | Zamanlayıcı | — |
| `answered_manually` | Ev sahibi kartı kullanmadan yazdı | `/reply` | — |
| `resolved_by_policy` | Kural `auto` sonradan onayladı (ör. temizlik bitti) | Yeniden değerlendirme | — |

Kurallar:
- terminal durumlar geri dönmez;
- her geçiş tek `updateMany WHERE status = <beklenen> AND version = <beklenen>` (CAS);
- 0 satır = başkası önce davrandı → 409.

## 4. Yeniden doğrulama sözleşmesi (TOCTOU, MÇ §3.2 adım 6)
Ev sahibi düğmeye bastığında, göndermeden hemen önce aynı işlemde:
1. **Kilit:** `pending → deciding` CAS (sürüm eşleşmeli). Çift tıklama ikinci kez gönderemez.
2. **Yeni misafir mesajı:** istek mesajından SONRA misafir yazdıysa işlem durur, kart "misafir yeniden yazdı" gösterir.
3. **Olgular yeniden yüklenir, `factsHash` karşılaştırılır.**
   - Kesin durdurma:
     - rezervasyon iptal;
     - istenen gün / saat geçti;
     - yeni çakışma (müsaitlik motoru).
   - Başka bir önemli değişiklik → 409 ve tazelenmiş kart (ev sahibi yeni olgularla yeniden bakar).
4. **Metin koddan kurulur:** 6 dil, günü adlandırır, ücret yalnız K8 kaynağından. Kapının güvenlik kontrolleri bu metinle
   yeniden koşar (çıktı vetosu, ödeme süzgeci, dil).
5. **Gönderim** mevcut outbox yolundan:
   - idempotency anahtarı `decision:<id>:v<version>`;
   - yazar ev sahibi, `aiAssisted`.
6. **Yan etkiler aynı işlemde:**
   - onaylanan geç çıkış yapısal kaydedilir; sonraki misafirin erken giriş kontrolü görür;
   - görev notu ve `AuditLog` (`decision.approved` gibi; metadata yalnız kimlik + tür + sonuç).

## 5. Güvenlik modeli
- **Yetki:**
  - karar düğmeleri yalnız owner / manager (`withManage`);
  - personel kartı görmez (K10);
  - canlandırma oturumunda salt-okuma (K9).
- **Kiracı izolasyonu:** her okuma ve yazma `organizationId` ile. Yeni rotalar `api-route-scoping` listesine girer.
  Davranışsal çapraz-kiracı testi zorunlu.
- **Denetim:** her karar `AuditLog`'a yazılır. Metadata kapalı-küme; misafir metni ve tutar YOK. Tutar yalnız
  `DecisionRequest`'te.
- **PII:** `factsJson` metin taşımaz. Kart misafir mesajını kendi `Message` satırından okur (ikinci kopya yok).
- **Faz 5 notu (şimdi uygulanmaz):**
  - WhatsApp numarası ↔ kullanıcı eşlemesi doğrulanır;
  - para ve iptal kararları WhatsApp'tan tek dokunuşla değil web onay bağlantısıyla (ek doğrulama);
  - 24 saat penceresi dışında yalnız onaylı şablon.

## 6. Test ve kanıt planı (Faz 1)
- **Davranışsal:**
  - TOCTOU: iptal, geçmiş saat, yeni çakışma, yeni misafir mesajı, kural değişti;
  - çift tıklama ve eşzamanlı iki karar (CAS);
  - kart geçersizleşmesi: supersede, cancel, expire;
  - "ben ilgileneceğim" bitişi (K7);
  - belirsiz gönderim (`send_unverified`) ve uzlaştırma;
  - çapraz kiracı;
  - canlandırma salt-okuma;
  - personelin göremediği.
- **Metin:** 6 dil. Kod metni çıktı vetosundan, ödeme süzgecinden ve dil kapısından geçer (pinli).
- **Rapor:** gönderim "ev sahibi + `aiAssisted`" sayılır (K6).
- **Kanıt sözleşmesi:** kırmızı-önce, iki yönlü mutasyon, entegrasyon, tam kapılar, migration zinciri + sıfır-drift.

## 7. Açma sırası
1. Bayrak `HOST_DECISIONS_ENABLED` (varsayılan KAPALI). Kapalıyken kart yok, bugünkü davranış birebir.
2. Kurucu org (iç kiracı): ilk kararlar ve ilk e-postalar birlikte (K5).
3. Küçük pilot, sonra genel.

## 8. Tahmini iş (Faz 1)
- 1 migration (`DecisionRequest`);
- 3 rota: kart listesi, karar, devralma;
- 1 kart bileşeni (gelen kutusu);
- metin kurucusu (6 dil);
- yeniden doğrulama modülü;
- testler.
- Kabaca 2–3 iş günü + inceleme turu.
