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
- Bedel (ÖLÇÜLMELİ, bu turda ölçülmedi): sezgisel 4–8 haneli bitişik sayı arıyor → "Nuve 4590",
  "Daire 1203", "Moda Cd. 12/3" gibi MEŞRU adlar/adresler düşebilir. Adres düşerse ürün konum
  sorularını cevaplayamaz ve "bilgi yok" der — E1 sınıfı bir gerileme. Ayrıca `{daire}` ikamesi mülk
  ADINDAN türetiliyor (`apartmentNumberOf`): ad maskelenirse ikame de bozulur.
- Bu yüzden A seçeneği ÖNCE bir ölçüm ister: prod'daki mülk adlarının/adreslerinin kaçı sezgisele
  takılıyor (salt-okuma sorgu, kurucu adımı).

**B — Yalnız ADI tara, adresi bırak.** Adres meşru bilgi; kod saklamak için doğal yer mülk ADIdır.
- Kazanç: A'nın ana riskini (adresin düşmesi) almadan boşluğun büyük kısmını kapatır.
- Bedel: "Nuve 4590" gibi ad bazlı yanlış pozitifler + `{daire}` ikamesinin bozulması SÜRER.

**C — Host'a UYARI, modele dokunma.** Mülk adı/adresi kaydedilirken sezgisel çalışır ve host'a
"burada bir kod var gibi görünüyor, bilgi tabanına taşıyın" der; istem yolu DEĞİŞMEZ.
- Kazanç: hiçbir gerileme riski yok; sorunu KAYNAĞINDA çözer (kod zaten mülk adına ait değil).
- Bedel: mevcut kayıtlar için geriye dönük koruma yok; host uyarıyı yok sayabilir.

**D — Hiçbir şey yapma, değişmezi DARALT.** Belge "KB kalemleri taranır; mülk kimlik alanları
taranmaz (bilinçli)" der; test-pinli kalır.
- Kazanç: sıfır risk.
- Bedel: boşluk açık kalır.

## Öneri

**C + D birlikte**, A/B ertelenir. Gerekçe: ölçülen bir sızıntı yok, ama A/B'nin bedeli GERÇEK ve
ölçülmemiş (adres/ad düşmesi + `{daire}` ikamesinin bozulması). C sorunu kaynağında çözer ve hiçbir
canlı yolu değiştirmez; D belgeyi dürüst tutar. A/B ancak prod'daki mülk adları/adresleri üzerinde
salt-okuma bir ölçüm (kaç ad sezgisele takılıyor) yapıldıktan sonra tartışılmalı.

Bu turda uygulanan tek şey **D'nin belge yarısı** + karakterizasyon testi. C dahil hiçbir kod
değişikliği yapılmadı.

## Karar

- [ ] A (ad + adres taranır)
- [ ] B (yalnız ad taranır)
- [ ] C (host'a kayıt anında uyarı)
- [ ] D (yalnız belge; bugün uygulanan)
