# Tasarım 2026-11-20 — Rezervasyon detay ekranı (KOD YOK, kurucu onayına)

> Kaynak: `docs/KURUCU-TALIMATI-2026-11-20-sabah-cevaplar.md` B-2, AYNEN: "Doğrudan rezervasyonu açsın (önerim). Önce sade bir rezervasyon
> detay ekranı tasarlansın. Daire, tarih, durum ve kayıt kaynağı görünsün; “Beklemede” kayıtlar da açılsın. Mesajlar ve görevler daha sonra
> eklenebilir. bu kısmı bana daha iyi açıkla son çıktında"
>
> Bu belge yalnız tasarımdır; kod yazılmadı. Onaydan sonra §9'daki planla yazılır.

## 1. Kısaca (kurucuya açıklama)

Bugün uygulamada **tek bir rezervasyonu açan sayfa yok**. "Kayıtları karşılaştır" sayfasındaki "Rezervasyonu aç" düğmesi şimdilik kaydın
dairesine süzülmüş takvime, varış ayına gidiyor. Bu iki yerde eksik kalıyor:

- Takvim yalnız **Onaylı** ve **Tamamlandı** kayıtları gösteriyor. **Beklemede** kayıt takvimde hiç görünmüyor; düğmeye basan ev sahibi
  aradığı kaydı bulamıyor.
- Takvimde kayıt yalnız giriş ve çıkış gününde misafir adıyla bir satırdır. Kaydın durumu, nereden geldiği ve kaç gece olduğu orada yazmıyor.

Öneri: `/reservations/<kayıt>` adresinde **tek kartlık, salt okunur** bir sayfa. Kartta daire, giriş → çıkış (gece sayısıyla), durum, kayıt
kaynağı, misafir adı ve son güncelleme bulunur. Kayıt iki dairede birden görünüyorsa kartın üstünde Dikkat panelindeki satırın aynısı ve
"Kayıtları karşılaştır" bağlantısı yer alır. Mesajlar, görevler, iç notlar ve hiçbir düzenleme / iptal eylemi bu ilk sürümde yok.

## 2. Bugün ne var (envanter, kodla doğrulandı)

| Yer | Ne gösteriyor | Neden tek kayıt için yetmiyor |
|---|---|---|
| Takvim (`/calendar?property=…&month=…`) | Ay ızgarası, giriş/çıkış günlerinde misafir adı | Yalnız `confirmed` / `completed`; satır bağlantı değil; durum ve kaynak yok |
| Daire sayfası "Son Rezervasyonlar" | Son 5 kayıt (QR PIN açıkken etkin + yaklaşan 25) | Kayıt listede olmayabilir; kaynak yok |
| Daire sayfası "Tüm Rezervasyonlar (KVKK Silme)" | Sayfalı tam geçmiş | Yalnız sahip + silme anahtarı açıkken |
| Girişler (`/arrivals`) | Bugün + iki gün | Pencere dışı kayıt yok |
| İptaller (`/cancellations`) | Yalnız iptal edilenler | — |
| Karşılaştırma (`/reservations/compare/[key]`) | Aynı kaynak kimlikli bütün satırlar yan yana | Yalnız kaynak kimliği taşıyan kayıt; amaç çakışma |
| Konuşma (`/inbox/[id]`) | Mesajlar | Yalnız kanaldan mesajlaşan kayıt; elle girilen kaydın konuşması yok |

## 3. Rota ve erişim

- **Rota:** `/reservations/[id]`. `[id]` rezervasyon **satırının** kimliğidir. Kanalın kaynak kimliği (`sourceReference`) adrese girmez;
  karşılaştırma sayfasıyla aynı ilke.
- **Üst klasör:** `/reservations` üç listede zaten var, yeni üst klasör açılmıyor. Doğrulandı: `src/lib/private-routes.ts:28`,
  `src/lib/theme.ts:46`, `src/middleware.ts:149` (`config.matcher`). Robots, karanlık mod ve ara katman pinleri değişmez.
- **Kim görür:** sahip ve yönetici (`requireManagerSession`). **Personel görmez.** Bugünkü kurala göre personel yalnız `/tasks` görür;
  ara katman ve sayfa kapısı onu oraya yönlendirir. Misafir verisini yalnız görev kartında, `staff-view.ts` süzgeciyle görür. → soru R-1.
- **Bürünme (destek görünümü):** sayfa okunur. Sayfada yazma eylemi olmadığı için ayrıca bir şey gizlemek gerekmez.
- **Başka işletmenin kaydı:** 404. Sorgu `findFirst({ id, property: { organizationId } })` biçiminde; varlık sızdırılmaz. Olmayan ya da
  silinmiş kimlik de 404 (mevcut `not-found` sayfası, yeni metin yok).

## 4. Kartta ne görünür

| Satır (etiket) | Kaynak | Gösterim |
|---|---|---|
| Daire | `property.name` | Daire sayfasına bağlantı |
| Giriş → çıkış | `arrivalDate`, `departureDate` | "23 Kas 2026 → 26 Kas 2026 · 3 gece". Gün **tek tarih kuralıyla** okunur (`calendarDateOf`, işletmenin saat dilimi); takvimle aynı gün çıkar. Bugünkü `formatDate` UTC okur: an olarak saklanan takvim (iCal TZID) kaydında bir gün kayabilir, burada kullanılmaz |
| Durum | `status` | Bugünkü rozetler, `RESERVATION_STATUS`: Onaylı · Beklemede · İptal · Tamamlandı |
| Kaynak | `bookingRowSourceClass` (`lib/booking-row-source.ts`) + `channel` | Karşılaştırma sayfasındaki etiketler AYNEN: "Elle girildi" · "Dosyadan içe aktarıldı" · "Takvimden geliyor: <besleme adı>" · "Kanaldan geliyor". Kanal sınıfında kanal adı eklenir: "Kanaldan geliyor · Airbnb" (`RESERVATION_CHANNEL` etiketi) |
| Misafir | `guestName` | Olduğu gibi. Saklama süresi dolmuş ya da silinmiş kayıtta bugünkü yer tutucu "Eski misafir" (`ANON_NAME`) görünür; yeni metin yok |
| Son güncelleme | `updatedAt` | `formatDateTime(…, işletmenin dilimi)`, karşılaştırma sayfasıyla aynı |

**Bilinçli olarak gösterilmeyenler:**

- **Kanal referansı (`sourceReference`): gösterilmez.** Bu alan sağlayıcının kendi kimliğidir (Hospitable kayıt kimliği, iCal UID ya da dosya
  satırı). Ev sahibinin Airbnb'de aradığı onay kodu bu değildir; gösterilirse yanlış eşleştirmeye yol açar. Onay kodu ayrı bir alanda
  saklanmıyor. → soru R-3
- **Tutar:** gösterilmez. `financials:read` izni yok, gelir özelliği bilinçli kaldırıldı.
- **Kişi / evcil hayvan sayısı:** alan var, ama eşleme anahtar arkasında kapalı (`HOSPITABLE_GUEST_COUNTS_ENABLED`) ve NULL "bilinmiyor"
  demek. İlk sürümde yok. → soru R-4

## 5. Durum kuralları

- **Beklemede:** açılır (kurucunun şartı), rozet "Beklemede". Ek cümle yok. "Onaylanınca otomatik mesaj gider" gibi bir söz verilmez;
  kurucu B-1'deki "sonradan gönderme sözü vermesin" ilkesi.
- **İptal:** açılır, rozet "İptal". Kart soluk gösterilir (karşılaştırma sayfasındaki etkin olmayan kart gibi), ek cümle yok. Kurucu "İptal
  edildi" yazdı; bugünkü rozet "İptal". Tutarlılık için bugünkü rozet önerilir. → soru R-2
- **Tamamlandı / konaklaması bitmiş:** yalnız rozet ve tarihler.
- **İki dairede kayıtlı** (etkin kayıt, tutma kuralıyla aynı yüklem `booking-property-conflict.ts`): kartın üstünde Dikkat panelindeki
  satırın aynısı, yeni metin yok:
  ```
  Aynı rezervasyon birden fazla dairede görünüyor
  Sahil Evi · Lale 5 · Giriş: 5 Ara
  [Otomatik gönderim durduruldu · ]Kayıtları karşılaştır   → /reservations/compare/<bu kaydın kimliği>
  ```
  "Otomatik gönderim durduruldu" yalnız gönderim gerçekten engelleniyorsa görünür; yüklem Dikkat satırıyla aynı
  (`lib/booking-conflict-auto-send.ts`). İptal edilmiş ya da konaklaması bitmiş eski kopya bu uyarıyı doğurmaz (yüklem yalnız etkin kayda bakar).

## 6. Nereden gelinir (bağlantılar)

| Giriş noktası | Bugün | Öneri | Dilim |
|---|---|---|---|
| Karşılaştırma sayfası, çakışma çözülünce "Rezervasyonu aç" | Takvim, varış ayı | `/reservations/<kalan etkin kayıt>` | 1 |
| Takvim: giriş / çıkış satırı | Bağlantı değil | Satır bağlantı olur (`dedupeBookings` sonrası satırın kimliği) | 2, soru R-5 |
| Daire sayfası "Son Rezervasyonlar" satırı | Bağlantı değil | Satır bağlantı olur | 2 |
| Dikkat "kanal iptali yeniden etkin gösteriyor" (`channel_reactivation`) | Takvim | Detay sayfası daha doğru hedef | 2, soru R-5 |
| Dikkat "iki dairede kayıtlı" | Karşılaştırma sayfası | **Değişmez**: doğru hedef karşılaştırma | — |
| Girişler satırı | Konuşma / takvim | Şimdilik değişmez | — |

İlk dilim yalnız sayfayı ve karşılaştırma sayfasındaki düğmeyi değiştirir. Öteki giriş noktaları ikinci dilimdedir ve kurucu onayıyla açılır;
her biri ev sahibinin bugün tıkladığı yeri değiştirdiği için tek tek sorulur.

## 7. Bilinçli dışarıda (ilk sürüm)

Mesajlar · görevler · iç notlar (`InternalNote.reservationId` var) · QR PIN ve KVKK silme kontrolleri (daire sayfasında kalır) · otomatik
mesaj damgaları (karşılama / giriş / çıkış gönderildi mi) · tutar · kişi sayısı · **her türlü yazma eylemi**. "Rezervasyonu iptal et" ve
"Yanlış kopyayı kaldır" ayrı işlemlerdir (kurucu 11-19 madde 4); bu ekranda ikisi de yok. Elle girilen kopyanın kaldırılması karşılaştırma
sayfasında kalır.

## 8. Ekran taslağı

Masaüstü (telefonda iki sütun alt alta iner; 16 px kenar boşluğu, yatay kaydırma yok):

```
┌──────────────────────────────────────────────────────────────────────┐
│ Rezervasyon                                                          │  ← sayfa başlığı (yeni metin, R-6)
│ Ada Lale · Lale 3                                                    │  ← açıklama: misafir · daire
├──────────────────────────────────────────────────────────────────────┤
│ ⚠ Aynı rezervasyon birden fazla dairede görünüyor                    │  ← yalnız iki dairede kayıtlıysa
│   Lale 3 · Sahil Evi · Giriş: 23 Kas                                 │
│   Otomatik gönderim durduruldu · Kayıtları karşılaştır →             │
├──────────────────────────────────────────────────────────────────────┤
│ Lale 3                                                     [Onaylı]  │
│   Daire            Lale 3 ↗                                          │
│   Giriş → çıkış    23 Kas 2026 → 26 Kas 2026 · 3 gece                │
│   Durum            Onaylı                                            │
│   Kaynak           Kanaldan geliyor · Airbnb                         │
│   Misafir          Ada Lale                                          │
│   Son güncelleme   19 Kas 23:01                                      │
└──────────────────────────────────────────────────────────────────────┘
```

Beklemede kayıt: rozet `[Beklemede]` (sarı), başka fark yok. İptal kaydı: kart soluk, rozet `[İptal]`, uyarı kutusu yok.

Gerçek uygulama bileşenleriyle (`PageHeader`, `Card`, `Badge`, Dikkat satırının metin kaynakları, karşılaştırma sayfasının bilgi satırı
düzeni, projenin Tailwind yapılandırması) üretilmiş statik taslak görüntüleri — kurgusal veri, kod tabanına girmez; ana oturumun klasöründe
(`scratchpad/codex-1117/sabah/bs/`): `detay-masaustu.png` (iki dairede kayıtlı, gönderim durduruldu) · `detay-telefon.png` (390 px, yatay
taşma yok) · `detay-beklemede-koyu.png` (Beklemede, karanlık mod). Taslakta uygulamanın yazı tipi yüklenmedi (tarayıcının varsayılan yazı
tipi görünüyor); yerleşim ve renkler gerçek bileşenlerden.

## 9. Kod planı (onaydan sonra)

**Dosyalar**

- `src/app/(app)/reservations/[id]/page.tsx`: sunucu sayfası, `requireManagerSession`, `dynamic = "force-dynamic"`, `notFound()`.
- `src/lib/reservations/detail.ts`: `loadReservationDetail(db, { organizationId, id, now })`. Tek satırı ve dairesini okur. İki dairede
  kayıtlıysa uyarının verisini (dairelerin adları, en erken etkin varış, karşılaştırma anahtarı) var olan parçalardan kurar:
  `activePropertyIdsOf`, `bookingRowSourceClass`, `autoSendStoppedByConflict`. İkinci bir kural yazılmaz.
- `src/lib/reservations/source-label.ts` (saf): kaynak etiketini karşılaştırma sayfasından buraya taşır; iki sayfa aynı fonksiyonu kullanır.
- Karşılaştırma sayfası: "Rezervasyonu aç" hedefi `/reservations/<id>` olur. `reservationCalendarHref` başka kullanıcısı kalmazsa testiyle
  birlikte silinir (ölü kod bırakılmaz).
- Dikkat paneli: uyarı kutusu, paneldeki satırın üç satırlık bileşenini yeniden kullanır (`BOOKING_SPAN_HEADLINE`,
  `bookingSpanDetailLine`, `AUTO_SEND_STOPPED_TEXT`).

**Testler (K2: kırmızı-önce, iki yönlü)**

- `tests/integration/reservation-detail-page.test.ts`, gerçek PostgreSQL, sayfa ağacı yürünür (`calendar-page.test.ts` deseni):
  - Kendi kaydı açılır: alanlar ve etiketler AYNEN. Beklemede açılır, İptal açılır (rozet + soluk kart).
  - Başka işletmenin kaydı ve olmayan kimlik 404. Testte reddin sebebi kiracıdır (kimlik var ama başka işletmede).
  - Personel `/tasks`'a yönlendirilir. Bürünme okur; sayfada form ya da düğme yoktur.
  - İki dairede kayıtlı → uyarı + `compare/<id>` bağlantısı. Tek dairede ya da yalnız iptal edilmiş kopyayla → uyarı yok.
  - "Otomatik gönderim durduruldu" iki yönde, Dikkat satırıyla aynı yüklemden.
  - Tarih: New York dilimli işletmede yalnız tarih (00:00Z) varış takvimle aynı gün; an olarak saklı iCal varışı işletmenin gününde.
  - Kanal referansı ve tutar ağaçta yok (`treeText` bütün dize prop'larını toplar; `not.toContain`).
- Birim: kaynak etiketi (dört sınıf + besleme adı yok), gece sayısı.
- Karşılaştırma sayfası testi: "Rezervasyonu aç" yeni hedef.
- Pinler: `manager-page-gate` (yeni sayfa kapıdan geçer) · `private-routes` · `seo` · `theme-scope` · `middleware-matcher-private` · `brand-name-absent`.
  Hepsi yeni sayfayla yeşil kalmalı; üst klasör listeleri değişmez. Yeni API rotası yok → `cross-tenant-coverage` eşlemesi gerekmez
  (o pin yalnız API rotalarını tarar; kiracı ayrımı sayfa testinde davranışsal sınanır).

## 10. Kurucu onayına sorular ve yeni metinler

**Yeni metinler (yalnız bunlar; ötekiler var olan metinlerdir):**

1. Sayfa başlığı: **"Rezervasyon"**
2. Gece sayısı: **"3 gece"** (`<n> gece`; panelde "gece" sözcüğü zaten kullanılıyor)
3. Kaynak satırına eklenen kanal adı: **"Kanaldan geliyor · Airbnb"** (yeni olan yalnız `· <kanal>` eki; kanal adları bugünkü rozetlerden)

**Sorular**

- **R-1** Personel bu sayfayı görmesin (öneri; bugünkü "personel yalnız /tasks" kuralı). Kabul mü?
- **R-2** İptal rozeti bugünkü gibi "İptal" kalsın (öneri), ya da her yerde "İptal edildi" olsun (bütün listeleri değiştirir)?
- **R-3** Kanal referansı gösterilmesin (öneri: ev sahibinin aradığı onay kodu değil). Onay kodunu da görmek isterseniz kanaldan ayrı bir alan
  okumak gerekir; bu ayrı bir iştir.
- **R-4** Kişi / evcil hayvan sayısı ilk sürümde olmasın (öneri; eşleme anahtarı kapalı). Açılınca eklensin mi?
- **R-5** İkinci dilimde takvim satırı, daire sayfası listesi ve "kanal iptali yeniden etkin" satırı detay sayfasına gitsin mi (öneri: evet,
  üçü birlikte)?
- **R-6** Başlık "Rezervasyon" mu olsun, misafir adı mı ("Ada Lale")? Öneri: "Rezervasyon". Silinmiş kayıtta başlık "Eski misafir"
  olurdu, bu da garip dururdu.
