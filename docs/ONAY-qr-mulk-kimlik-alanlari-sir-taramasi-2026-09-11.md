# ONAY PAKETİ — QR'da mülk KİMLİK ALANLARININ sır taraması — UYGULANMADI

> Durum: **öneri**, kod değişikliği YOK. Kurucu onayı olmadan uygulanmaz (gönderim/erişim politikası
> değişikliği). Kaynak: 09-11 inceleme turu; ölçüm `tests/unit/qr-property-fields-unscanned.test.ts`
> (karakterizasyon — bugünkü davranışı pinler, DEĞİŞTİRMEZ).

## Ölçülen bugünkü davranış (kanıt)

QR asistanı halka açık bir yüzeydir: bağlantı dairenin İÇİNDE asılıdır, sohbeti açan kişi rezervasyon
sahibi olmayabilir (eş, arkadaş, temizlik görevlisi). Sır kapısı (`withoutSecretKbItems` içerik
sezgiseli + `QR_SECRET_CATEGORIES` kategori bacağı) tam bu yüzden vardır.

Kapı **KALEM LİSTESİNİ** süzer. Mülk KİMLİK ALANLARI istemin AYRI bir bölümünde, hiçbir taramadan
geçmeden modele gider (`src/app/api/chat/[token]/route.ts` → `suggestReply({ property: { name,
checkInTime, checkOutTime, address, city } })` → `src/lib/ai/prompts.ts:1090-1091`):

| Girdi | Sır kapısı | İstemde |
|---|---|---|
| KB kalemi: "Giriş kodu 8821." | **ELENİR** (kalem düşer) | yok ✓ |
| Mülk ADI: "Nuve 5 - kapı kodu **8821**" | taranmaz | **VAR** ✗ |
| ADRES: "Moda Cd. 12, zil kodu **4590**" | taranmaz | **VAR** ✗ |

Yani host aynı kodu KB'ye yazarsa korunuyor, mülk adına yazarsa korunmuyor. Ölçülen bir SIZINTI
DEĞİLDİR (bunun için host'un kodu mülk adına yazması gerekir) ama kapının kapsamı ile CLAUDE.md'nin
özetlediği "modele giden metin taranmıştır" değişmezi ÖRTÜŞMÜYOR.

⚠️ **İki iddiayı ayır:** "adres modele gidiyor" bir açık DEĞİLDİR — adres misafirin zaten bildiği ve
ürünün söylemesi gereken bilgidir (test-pinli). Açık, o alanın sır TARAMASINDAN geçmemesidir.

## Seçenekler

**A — Kimlik alanlarını da tara (fail-closed).** `name`/`address` `SECRET_PATTERNS` sezgiselinden
geçer; eşleşirse alan istemden DÜŞER (ya da maskelenir).
- Kazanç: kapsam boşluğu kapanır, değişmez gerçekten doğru olur.
- 🚨 **BEDEL BELGEDE FAZLA BÜYÜK YAZILMIŞTI — ÖLÇÜLDÜ ve DÜZELTİLDİ (09-11 denetimi):** ilk yazımda
  "sezgisel 4–8 haneli bitişik sayı arar, meşru adlar düşer" deniyordu. `SECRET_PATTERNS`in 6. kalıbı
  rakamlardan ÖNCE bir **giriş sözcüğü** şart koşuyor (`kapı|giriş|anahtar kutu|keybox|door|lock|entry|
  gate`) — kalıbın "can damarı" olarak kodda yazılı bitişiklik şartı. Ölçüm: 24 gerçekçi mülk adının
  yalnız **4'ü** düşüyor ve dördü de gerçekten giriş sözcüğü + kod taşıyor ("Kapı 4590", "Anahtar
  kutusu 7788", "Gate 1203", "Nuve 5 - kapı kodu 8821"); "Nuve 4590" · "Daire 1203" · "Moda Cd. 12/3"
  KALIYOR. 9 gerçekçi adresin yalnız biri düşüyor ("Moda Cd. 12, **zil kodu** 4590").
- 🚨 **"A seçeneği `{daire}` ikamesini bozar" İDDİASI DA YANLIŞTI:** ikame `property.name`i Prisma
  satırından AYRI okuyor, istem ise `sanitizePromptValue(property.name)` ile ayrı basıyor — iki yol
  BAĞIMSIZ. Alanı İSTEMDEN düşürmek `apartmentNumberOf`a dokunmaz. İddia yalnız "kaynakta maskele"
  varyantı için doğru olurdu; A seçeneği onu tanımlamıyor.
- Kalan gerçek bedel DAR: ad/adreste giriş sözcüğü + 4-8 hane taşıyan meşru satırlar. Prod ölçümü
  (kaç mülk adı/adresi sezgisele takılıyor) yine de kurucu adımıdır.

**B — Yalnız ADI tara, adresi bırak.** Adres meşru bilgi; kod saklamak için doğal yer mülk ADIdır.
- Kazanç: A'nın ana riskini (adresin düşmesi) almadan boşluğun büyük kısmını kapatır.
- Bedel (ÖLÇÜLDÜ): "Nuve 4590" DÜŞMEZ (giriş sözcüğü yok); yalnız ad gerçekten giriş sözcüğü + 4-8
  hane taşıyorsa düşer. `{daire}` ikamesi ETKİLENMEZ (iki yol bağımsız, ↑A).

**C — Host'a UYARI, modele dokunma.** Mülk adı/adresi kaydedilirken sezgisel çalışır ve host'a
"burada bir kod var gibi görünüyor, bilgi tabanına taşıyın" der; istem yolu DEĞİŞMEZ.
- Kazanç: hiçbir gerileme riski yok; sorunu KAYNAĞINDA çözer (kod zaten mülk adına ait değil).
- Bedel: mevcut kayıtlar için geriye dönük koruma yok; host uyarıyı yok sayabilir.

**D — Hiçbir şey yapma, değişmezi DARALT.** Belge "KB kalemleri taranır; mülk kimlik alanları
taranmaz (bilinçli)" der; test-pinli kalır.
- Kazanç: sıfır risk.
- Bedel: boşluk açık kalır.

## Öneri

🚨 **BU ÖNERİ YANLIŞ BİR MALİYET MODELİNE DAYANIYORDU** (09-11 denetimi, ↑): ilk hâli "C + D birlikte,
A/B ertelensin" diyordu; gerekçesi "A/B'nin bedeli gerçek ve ölçülmemiş" idi. Ölçüldü: bedel DAR
(24 adın 4'ü, 9 adresin 1'i ve hepsi gerçekten kod taşıyor) ve `{daire}` gerekçesi geçersiz.

Güncel öneri: **B + C + D** — yalnız mülk ADINI tara (kod saklamak için doğal yer odur), adresi
BIRAK (misafirin zaten bildiği ve ürünün söylemesi gereken bilgi), host'a kayıt anında uyarı ver,
belgeyi dürüst tut. A (ad + adres) hâlâ prod ölçümü ister. **KARAR KURUCUNUN** — bu turda yalnız
D'nin belge yarısı + karakterizasyon testi uygulandı, kod yolu DEĞİŞMEDİ.

Bu turda uygulanan tek şey **D'nin belge yarısı** + karakterizasyon testi. C dahil hiçbir kod
değişikliği yapılmadı.

## Karar

- [ ] A (ad + adres taranır)
- [ ] B (yalnız ad taranır) ← ölçüm sonrası ÖNERİLEN
- [ ] C (host'a kayıt anında uyarı)
- [ ] D (yalnız belge; bugün uygulanan)
