# V1 — kalan canlı doğrulamalar: (A) QR misafir mesajı, (B) Gist "1 atlandı" kesinleştirme (2026-09-08)

> Kurucu talimatı: güvenlik kapıları GEVŞETİLMEZ; yalnız test mülkü + yapay misafir verisi; mevcut Gist kaynağı
> SİLİNMEZ/yeniden oluşturulmaz; prod verisi için yalnız ilgili test kaynağına salt-okuma sorgu; sır veya gerçek
> misafir verisi İSTENMEZ. Kod hatası kanıtlanırsa mevcut test kurallarıyla düzeltilir; V2'ye geçilmez.
> Bağlam: C adımı (dosya → iptal → sinyal) **arayüzden** doğrulandı (`docs/V1-CANLI-DOGRULAMA-OPERATOR-PLANI.md`).

---

## A. QR misafir mesajı → şikayet sinyali

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

### B.1 İhtimaller (kod: `src/lib/import/sync.ts`)
- **(A) Besleme eski sürümü veriyor** (Raw bağlantı revizyon SHA'sına sabit) → satır kaynağa BAĞLI, içerik aynı →
  `unchanged` dalı → "1 atlandı", rezervasyon Onaylı.
- **(B) Sahiplik uyuşmuyor** → besleme iptali veriyor ama satırın `calendarSourceId`'si o kaynak DEĞİL (NULL veya
  başka kaynak) → iptal dalı `skip` → "1 atlandı", rezervasyon Onaylı.

İkisi de aynı ekran çıktısını verir; ayıran tek şey satırın sahipliğidir.

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

**Okuma kılavuzu:**
- Gist'ten gelen rezervasyonun `calendarSourceId`'si o kaynağın `id`'sine **eşitse → (B) ELENİR, (A) kalır**:
  besleme hâlâ iptalsiz sürümü veriyor.
- `calendarSourceId` **NULL veya başka kaynak** ise **(B) doğrulanır**: iptal dalı bilinçli olarak yalnız kendi
  satırına dokunur.
- `url_sifreli_uzunluk` destekleyici ipucudur (içerik değil): Gist raw bağlantısı revizyon SHA'lıysa düz URL
  ~41 karakter daha uzundur, bu şifreli uzunluğa da yansır. Tek başına kanıt sayılmaz.

### B.3 Sorgusuz da yapılabilen kesin ayrım (operatör, 1 dakika)
Kaynağa eklerken kopyaladığın Gist bağlantısını tarayıcıda aç:
- Adres çubuğunda **40 karakterlik onaltılık dizi** varsa bağlantı o revizyona sabittir → **(A)**.
- Açılan metinde `STATUS:CANCELLED` **yoksa** besleme eski sürümdedir → **(A)** kesinleşir.
- Metinde `STATUS:CANCELLED` **varsa** besleme günceldir → **(B)**, yani sahiplik; o zaman B.2 sorgusu
  `calendarSourceId`'yi göstererek nedeni tamamlar.

### B.4 Çözüm ve sınır
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
| QR misafir mesajı → şikayet sinyali | ⏳ bu belgenin A bölümü (test verisi hazır, adımlar bekliyor) |
| URL üzerinden iCal → iptal sinyali | ⏳ B bölümü kesinleşene kadar AÇIK |
| Toplu / çok satırlı dosya | ⏳ doğrulanmadı |
| Tarih değişikliği (`date_change`) sinyali | ⏳ doğrulanmadı (kod + test var) |
| Örüntü hafızası (≥3 negatif / 180 gün) | ⏳ doğrulanmadı (tek sinyalle oluşmaz) |
| `IngestEvent`/`Signal` satırlarının doğrudan gözlenmesi | ⏳ hiç yapılmadı — kanıtlar arayüzdendir |
| Bakım sinyalleri (V3) · güçlü yönler (V6) · proaktif check-in (V2/V5) | kapsam dışı, yayını beklemez |
