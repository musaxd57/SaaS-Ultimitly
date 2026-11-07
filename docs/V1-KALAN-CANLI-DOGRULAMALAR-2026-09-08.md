# V1 — kalan canlı doğrulamalar: (A) QR misafir mesajı, (B) Gist "1 atlandı" kesinleştirme (2026-09-08)

> Kurucu talimatı: güvenlik kapıları GEVŞETİLMEZ; yalnız test mülkü + yapay misafir verisi; mevcut Gist kaynağı
> SİLİNMEZ/yeniden oluşturulmaz; prod verisi için yalnız ilgili test kaynağına salt-okuma sorgu; sır veya gerçek
> misafir verisi İSTENMEZ. Kod hatası kanıtlanırsa mevcut test kurallarıyla düzeltilir; V2'ye geçilmez.
> Bağlam: C adımı (dosya → iptal → sinyal) **arayüzden** doğrulandı (`docs/V1-CANLI-DOGRULAMA-OPERATOR-PLANI.md`).

---

## A. QR misafir mesajı → şikayet sinyali

> **✅ DOĞRULANDI — ARAYÜZDEN (kurucu + Codex, 2026-09-08; test mülkü `cmtsiavia0001qs2qxar7n8d9`).**
> Yapay aktif konaklama üzerinden QR sohbetinde **"Klima bozuk, çalışmıyor."** gönderildi; yanıt alındı ve
> **şikayet sinyali mülk sayfasındaki Mülk Hafızası kartında göründü**. Ara DB kayıtları (`IngestEvent`,
> `Signal`) DOĞRUDAN SORGULANMADI — kanıt arayüzdendir.
> **KAPSAM:** bu adım yalnız *şikayet → sinyal → kart* zincirini doğrular; **genel cevap kalitesini DEĞİL**
> (aynı oturumda çıkan cevap kalitesi bulguları ayrı belgede: `docs/ACIK-2026-09-08-qr-cevap-kalitesi.md`).

### A.1 Kapılar (kod-doğrulandı, `src/lib/guest-chat.ts` `resolveGuestChat`)
QR sohbetinin açılması için **hepsi** gerekir — hiçbiri gevşetilmez:

| # | Koşul | Kod | Bugünkü durum |
|---|---|---|---|
| 1 | `GUEST_CHAT_ENABLED` açık | env | ✅ canlıda açık |
| 2 | Mülkün `chatEnabled` = true ve `chatToken` (≥16 karakter) var | `resolveGuestChat` ilk sorgu | ⛔ **test mülkünde açılması gerek** (operatör adımı) |
| 3 | Org premium erişimi (`premiumAllowed`) | aynı fonksiyon | ✅ kurucu org'u muaf |
| 4 | **AKTİF konaklama**: `status ∈ {confirmed, completed}`, varış ≤ şimdi+12s, çıkış ≥ şimdi−24s | `candidates` sorgusu | ⛔ **YOK** (↓A.2) |
| 5 | **Pencere**: varış günündeyse mülkün check-in saati geçmiş; çıkış günündeyse check-out saatinden önce | `isOpenNow` | dünden başlayan konaklamada otomatik sağlanır |
| 6 | Konaklama silme talebiyle maskelenmemiş | erasure guard | ✅ (yapay veri) |
| 7 | PIN | `QR_PIN_ENABLED` | ✅ kapalı → PIN sorulmaz |

### A.2 EKSİK TEST VERİSİ — açıkça belirtiliyor
Test mülkündeki tek rezervasyon (14–17 Eki 2026) **iptal edildi** ve zaten gelecekteydi → koşul 4 sağlanmıyor,
**QR bugün açılmaz**. Yeni bir yapay konaklama gerekir: ekteki **`test-qr-aktif-konaklama.ics`**
(`UID:lixus-v1-qr-test-2026-09-08-002@lixusai.com`, 7–12 Eyl 2026, misafir adı "Lixus QR Test Misafiri (sahte)").
7 Eylül'de başladığı için koşul 5 saat kontrolüne takılmaz; 11 Eylül akşamına kadar açık kalır.

### A.3 Operatör adımları (test mülkü `cmtsbfyh60001pk2qw9z048fj`)
1. **Konaklama oluştur:** Mülk sayfası → Kanal Takvimleri → **Dosyadan içe aktar** → `test-qr-aktif-konaklama.ics`.
   Önizleme "1 eklenecek" demeli → İçe aktar → "1 eklendi". (Önceki iptal kaydı ayrı UID; ona dokunulmaz.)
2. **QR'ı aç:** Aynı sayfada QR Misafir Sohbeti bölümünden sohbeti etkinleştir ve misafir bağlantısını al.
3. **Misafir gibi yaz** (kendi tarayıcında, tercihen gizli pencere): **"Klima bozuk, çalışmıyor."**
   ⚠️ Cümle ölçülerek seçildi: `classifyFallback` → `complaint` (güven 0.7). Planın eski örneği
   "Sıcak su gelmiyor, duş soğuk." → **`general`** çıkıyor ve `general` sinyal ÜRETMEZ.
   🚨 **Cümleyi değiştirmek bu eksikliği KAPATMAZ:** Türkçe olumsuz fiil boşluğu ayrı bir AÇIK bulgudur
   (`docs/ACIK-2026-09-08-turkce-sikayet-siniflandirma-eksigi.md`; "su akmıyor", "ısıtma gelmiyor",
   "elektrikler gitti", "kapı açılmıyor" da `general`). Değişiklik yalnız QR testinin sessizce
   yanlış-yeşil vermesini önler.
4. **Beklenen:** AI kısa bir cevap verir veya insana devreder (test mülkü olduğu için e-posta gelmesi normal).
   ≤2 dakika içinde (zamanlanmış geçiş) mülk sayfasındaki **Mülk Hafızası** kartında yeni satır:
   **"Şikayet · &lt;bugünün tarihi&gt; · Misafir mesajı"** (kırmızı ton). Mesaj sinyalinde tarih = mesajın
   gerçek zamanı (rezervasyon olaylarındaki gözlem anından farklı).
5. **Ölçüt:** kart satırı göründüyse QR → `IngestEvent(message.received)` → `Signal(complaint)` → yüzey zinciri
   canlıda çalışıyor demektir. Görünmezse: (a) 2 dk bekle, (b) QR'ın açık olduğunu doğrula (kapalıysa sayfa
   "aktif konaklama yok" der), (c) mesajın gerçekten misafir tarafında gönderildiğini kontrol et (host yanıtı
   sinyal üretmez).
6. **Silme yok:** test mülkü, rezervasyonlar, sohbet ve dosyalar bırakılır.

---

## B. Gist kaynağındaki "1 atlandı" — iki ihtimali ayırma

### B.1 İhtimaller (kod: `src/lib/import/sync.ts`) — "atlandı" tek bir nedene ait DEĞİL
- **(A) Besleme eski sürümü veriyor** (Raw bağlantı revizyon SHA'sına sabit) → satır kaynağa BAĞLI, içerik aynı →
  `unchanged` dalı → "1 atlandı", rezervasyon Onaylı.
- **(B) Sahiplik uyuşmuyor** → besleme iptali veriyor ama satırın `calendarSourceId`'si o kaynak DEĞİL (NULL veya
  başka kaynak) → iptal dalı `skip` → "1 atlandı", rezervasyon Onaylı.
- **(C) Diğer atlama dalları** — aynı çıktıyı verebilir ve elenmeleri gerekir: satır zaten `cancelled`
  (idempotent dal), KVKK tombstone'u (`erased`), geçersiz satır (ad/tarih), `@@unique` dedupe (P2002),
  satır hatası. Ayrıca beslemenin O KOŞUDA hiç okunamamış olması (`lastStatus = error`).

⚠️ **KESİNLİK KURALI (Codex, 09-08): `calendarSourceId` eşleşmesi yalnız (B)'yi ELER — (A)'yı KANITLAMAZ.**
Sahiplik doğruysa geriye (A) ve (C) kalır; hangisi olduğu ancak **o kaynaktan gerçekten çekilen İÇERİK**
görülünce belli olur. Kök neden, içerik doğrulanmadan KAPATILMAZ.

### B.2 Salt-okuma sorgu (yalnız test mülkü; sır ve gerçek misafir verisi yok)
`psql` sarmalayıcısıyla (DATABASE_URL gizli istenir), tek sorgu:

```sql
SELECT r.id            AS rezervasyon_id,
       r.status,
       r.channel,
       r."sourceReference",
       r."calendarSourceId",
       cs.id           AS kaynak_id,
       cs.label        AS kaynak_etiketi,
       cs."lastSyncedAt",
       cs."lastStatus",
       cs."lastResult",
       length(cs."urlEnc") AS url_sifreli_uzunluk   -- yalnız UZUNLUK; URL'in kendisi İSTENMİYOR
  FROM "Reservation" r
  LEFT JOIN "CalendarSource" cs ON cs.id = r."calendarSourceId"
 WHERE r."propertyId" = 'cmtsbfyh60001pk2qw9z048fj'
 ORDER BY r."createdAt";

-- Mülkün TÜM takvim kaynakları (rezervasyona bağlı olmayanlar dahil):
SELECT id, label, "lastSyncedAt", "lastStatus", "lastResult", length("urlEnc") AS url_sifreli_uzunluk
  FROM "CalendarSource" WHERE "propertyId" = 'cmtsbfyh60001pk2qw9z048fj';
```

**Okuma kılavuzu (sorgu tek başına kök nedeni KAPATMAZ):**
- `calendarSourceId` = kaynağın `id`'si → **(B) elenir.** Geriye (A) ve (C) kalır; hangisi olduğu B.3'süz bilinmez.
- `calendarSourceId` **NULL veya başka kaynak** → **(B) doğrulanır**: iptal dalı bilinçli olarak yalnız kendi
  satırına dokunur (davranış doğru, düzeltme gerekmez).
- `r.status` zaten `cancelled` ise → **(C)** idempotent dalı; `cs."lastStatus" = 'error'` ise besleme o koşuda
  okunamamıştır → yine (C).
- `url_sifreli_uzunluk` yalnızca zayıf bir ipucudur (içerik değil): revizyon SHA'lı bağlantı düz hâlde ~41
  karakter daha uzundur ve bu şifreli uzunluğa yansır. **Kanıt değildir.**

### B.3 ZORUNLU ADIM — çekilen içeriğin doğrulanması (kök neden ancak burada kapanır)
Kaynağa eklerken kopyaladığın Gist bağlantısını **aynen** tarayıcıda aç (kaynağı silme/değiştirme):
- Metinde `STATUS:CANCELLED` **YOKSA** → besleme eski sürümü veriyor → **(A) KANITLANDI.** (Adreste 40
  karakterlik onaltılık dizi varsa nedeni de görünür: bağlantı o revizyona sabit.)
- Metinde `STATUS:CANCELLED` **VARSA** → besleme güncel → (A) elenir; neden B.2'deki sahiplik/durum
  alanlarındadır ((B) veya (C)).
- Bağlantı açılmıyor / hata veriyorsa → (C): besleme hiç okunamamış olabilir; `cs."lastStatus"` ile teyit et.

Bu adım yapılmadan **hiçbir kök neden "kesinleşti" diye yazılmayacak.** Bugünkü durum: (A) yalnızca EN OLASI
hipotezdir, kanıtlanmamıştır.

### B.4 Çözüm ve sınır (yalnız ilgili ihtimal kanıtlandıktan SONRA uygulanır)
Kaynağın bağlantısını **güncelleyen bir uç yok** (`/api/calendar-sources/[id]` yalnız DELETE) ve kaynak
silinmeyecek → (A) doğrulanırsa bu kaynak üzerinden iptal akışı tamamlanamaz; bu bir **ürün eksiği**dir, kod
hatası değil (davranış tasarımla uyumlu). Kayıt: "takvim kaynağının bağlantısını güncelleyen PATCH ucu" ve
"senkron sonucunda atlama NEDENİNİN gösterilmesi" kalan iş olarak açık.
(B) doğrulanırsa da davranış doğrudur (yabancı satıra dokunmama kuralı) ve düzeltme gerekmez.

---

## C. V1 kabul koşullarında kalan işler (bu iki adımdan sonra)
| Konu | Durum |
|---|---|
| KB → mülk hafızası (A adımı) | ✅ arayüzden doğrulandı (gerçek mülk) |
| Tek rezervasyonlu dosya → iptal → sinyal → kart | ✅ arayüzden doğrulandı (test mülkü) |
| QR misafir mesajı → şikayet sinyali | ✅ arayüzden doğrulandı (09-08, test mülkü `cmtsiavia0001qs2qxar7n8d9`) — yalnız sinyal zinciri; cevap kalitesi ayrı |
| URL üzerinden iCal → iptal sinyali | ⏳ AÇIK — kök neden **kanıtlanmadı** (B.3 içerik doğrulaması yapılmadı) |
| Türkçe şikayet sınıflandırma boşluğu | ⏳ AÇIK — `docs/ACIK-2026-09-08-turkce-sikayet-siniflandirma-eksigi.md` (düzeltme ayrı AI kalite turu) |
| Toplu / çok satırlı dosya | ⏳ doğrulanmadı |
| Tarih değişikliği (`date_change`) sinyali | ⏳ doğrulanmadı (kod + test var) |
| Örüntü hafızası (≥3 negatif / 180 gün) | ⏳ doğrulanmadı (tek sinyalle oluşmaz) |
| `IngestEvent`/`Signal` satırlarının doğrudan gözlenmesi | ⏳ hiç yapılmadı — kanıtlar arayüzdendir |
| Bakım sinyalleri (V3) · güçlü yönler (V6) · proaktif check-in (V2/V5) | kapsam dışı, yayını beklemez |
