# Airbnb Direct — boş sözleşme adaptörü (09-24)

Airbnb başvurusu öncesi 6 kapının ilki: "channel independence (boş `AirbnbDirectAdapter` sözleşmesi
dahil)". Kurucu: *endpoint'leri olmayacak ama Lixus'un Airbnb'den ne beklediği belli olacak.*

## Ne var

| Dosya | Görev |
|---|---|
| `src/lib/channels/providers.ts` | `ChannelProviderId = "hospitable" \| "airbnb_direct"`. "airbnb" DEĞİL: o bir OTA etiketi; sağlayıcı kimliği yapmak değişmez 20'nin yasakladığı "etiketten yetenek çıkarımı"nı geri getirirdi. |
| `src/lib/channels/capabilities.ts` | 13 ayrı yetenek (değişmez 4), durum `supported/planned/unavailable`, sınır, veri sınıfı politikası (değişmez 14), rollout aşaması (değişmez 19); henüz kimsenin uygulamadığı yetenekler için sağlayıcı-nötr kanonik şekiller (uzlaştırma, webhook zarfı, değişiklik ipucu, bağlantı yaşam döngüsü). |
| `src/lib/channels/manifests.ts` | Hospitable (betimleyici — adaptörün çalışma zamanı yetenek kümesiyle PARİTE pinli), Airbnb Direct (hepsi `planned`, veri politikası "şartlar okunmadan karar yok"), iCal (yalnız rezervasyon, değişmez 5). |
| `src/lib/channels/requirements.ts` | Lixus'un Airbnb'den BEKLEDİKLERİ: kanonik tiplere `satisfies` ile bağlı — alan adı değişirse ya da yeni hata sınıfı eklenirse sözleşme derlenmez. |
| `src/lib/channels/airbnb-direct/adapter.ts` | Gönderim `definitive_failure` (hiçbir şey gönderilmedi), okuma `IngestError("unsupported")`, webhook reddedilir. |

## Değişmezler (mekanik pinli)

- **Ağa çıkmaz:** adaptör dosyası `fetch`/HTTP modülü/ortam değişkeni/veritabanı/URL literal içermez;
  tahminî uç nokta, yük ya da imza şeması YOK (değişmez 18).
- **Kaydedilemez:** giden kayıt defteri yalnız CANLI sağlayıcı kümesini (`OutboundProvider`) kabul eder →
  `airbnb_direct` derleme zamanında kaydedilemez (`@ts-expect-error` pinli); yanlışlıkla kaydedilse bile boş
  yetenek kümesi yüzünden `dispatchOutbound` reddeder. Hiçbir üretim modülü adaptörü içe aktarmaz.
- **Canlıya alma kapısı:** `supported` yeteneği olan HİÇBİR kaynakta veri politikası `requires_terms_review`
  kalamaz; kiracılar arası kullanım her kaynakta ve her sınıfta yasak.
- Müşteriye "Hospitable'a ulaşılamıyor" denmez: `unsupported` hata sınıfı genel metne düşer. ⚠️ Öteki hata
  sınıflarının müşteri metinleri (`provider-errors`) hâlâ "Hospitable" der; Airbnb Direct adaptörü canlıya
  alınmadan önce sağlayıcıya göre metin gerekir (bugün ulaşılamaz: adaptör yalnız `unsupported` üretir).
- Canlı `hospitable-*.ts` dosyaları bu dilimde bayt-bayt aynı.

## Sıradaki adımlar (sandbox + resmî doküman geldiğinde)

1. `requirements.ts`teki beklentileri Airbnb dokümanıyla eşle; açık kalanları başvuru dosyasına yaz.
2. Aynı uyum kitlerini (`tests/helpers/outbound-conformance.ts`, `ingest-conformance.ts`) gerçek adaptöre koş.
3. Manifestoyu `planned` → `supported` çevirmeden önce veri politikasını doldur (kapı bunu zorlar).
4. Rollout: sandbox → iç kiracı → küçük pilot → gölge/çift koşu → uzlaştırma → kontrollü geçiş (değişmez 19).

## Kanıt

Kırmızı-önce + iki yönlü mutasyon (manifesto paritesi, kayıt, ağ çağrısı, ortam okuma, belirsiz sonuç,
`unsupported` koruması, URL literal, iCal yetenek sızıntısı, kiracılar arası kullanım) — hepsi yakalandı.
