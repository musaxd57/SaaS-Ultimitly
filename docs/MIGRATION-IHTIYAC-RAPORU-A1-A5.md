# Migration ihtiyaç raporu — A1…A5 (önceden, topluca)

> Kurucu şartı (09-08): *"Yeni migration ihtiyaçlarını önceden topluca bildir."* Bu belge, bilgi tabanı
> doldurma turunun (A1–A5) **tüm şema ihtiyaçlarını tek yerde** listeler. Kural değişmedi: migration içeren
> her push taze `pg_dump` + **ayrı açık onay** ister; migration içermemek bir dilimi bu kapıdan MUAF TUTMAZ —
> aynı dalda bekleyen bir migration commit'inin üstüne eklenen dilim de aynı kapıya tabidir.

## Özet tablo

| # | Dilim | Migration | Durum |
|---|---|---|---|
| A1 | KB onay sözleşmesi (`source · reviewState · approvedAt · sourceRef · supersededById`) | **53** | ✅ **PROD'DA** (09-08 16:42:44Z, 5/5 doğrulama geçti) |
| A2 | Temellendirme izlenebilirliği (`RiskEvent` × 7 kolon) | **54** | ⏳ **YEREL** — push onayı bekliyor |
| A3 | Eksik bilgi analizi (üç sınıf) | **YOK** | Salt-okuma hesap; yeni tablo/kolon gerekmiyor |
| A4 | Kurulum şablonlarının eksiklere bağlanması | **YOK** | `KB_PRESETS` zaten kodda sabit |
| A5a | Host metninden alan önerisi — **önizleme + host seçimi** | **YOK** | Kabul edilen kalem A1'in mevcut kolonlarına yazılır |
| A5b | Arka planda çıkarım → "İncelenecek öneriler" | **YOK** | A1'in `draft` durumu + `sourceRef` yeterli |

**Sonuç: A3, A4, A5 için YENİ MIGRATION GEREKMİYOR.** Bekleyen tek şema işi migration 54'tür.

---

## Neden A3–A5 migration istemiyor (tek tek)

### A3 — eksik bilgi analizi
Girdi zaten canlı akan üç tablodan geliyor: `Signal` (misafirin ne sorduğu, PII'siz, V1'den beri),
`KnowledgeBaseItem` (o kategoride ONAYLI kalem var mı — A1 sayesinde artık `reviewState` ile ayırt
edilebiliyor) ve `RiskEvent` (A2 sayaçları: getirildi mi, kullanıldı mı, onay mı bekliyor).
Çıktı **hesaplanır**, saklanmaz: mülk × kategori tekilleştirmesi ve önem sırası okuma anında üretilir.

🚨 **Saklama gerektiren TEK durum, bilinçli olarak İLK DİLİMİN DIŞINDA:** host bir öneriyi
"kapat / şimdilik erteleme" derse bu karar kalıcı olmalı ve o **migration ister** (küçük bir tablo ya da
`Property` üstünde JSON değil, ayrı satır — çünkü mülk × kategori × zaman taşır). İlk dilimde kapatma
YOK; liste her açılışta yeniden hesaplanır. Kapatma istenirse ayrıca bildirilir ve ayrı onaydan geçer.

### A4 — kurulum şablonları
`KB_PRESETS` kodda sabit bir dizi; formu dolduruyor, kaydetmiyor. Yapılacak iş yalnız "A3'ün bulduğu
eksik kategori ↔ ilgili preset" eşlemesi. Veri yok, şema yok.

### A5a — metinden alan önerisi (önizleme)
`.ics` "Dosyadan içe aktar" ile aynı emsal: **yazmadan önce göster**. Çıkarım tamamen bellekte olur,
host seçtiklerini kabul eder ve kabul edilen kalem `source="suggestion_accepted"` + `reviewState="approved"`
+ `approvedAt=now` olarak yazılır. Bu üç kolon A1 ile ZATEN VAR. Yer tutucu (`{isim}`) içeren çıkarım
düşürülür — gerçeğe dönüşmez.

### A5b — arka planda çıkarım → "İncelenecek öneriler"
Host'un önünde olmadan üretilen öneriler `source="extracted_draft"` + `reviewState="draft"` satırları
olarak doğar; `sourceRef` çıkarımın geldiği metnin PII'siz işaretçisini taşır. Üçü de A1'de eklendi.
Bu satırlar A1 kapısı gereği **modele ve misafire gitmez**; host onaylayınca `approved` olur.

---

## Bu turun DIŞINDA kalan, ayrıca migration isteyecek işler (bilgi amaçlı)

| İş | Neden migration | Durum |
|---|---|---|
| Öneri kapatma/erteleme durumu (A3'ün ikinci dilimi) | Kalıcı host kararı | Planlanmadı; istenirse ayrı onay |
| `Message.replyToMessageId` | Nedensellik bağı (`+1 ms` bunu KANITLAMAZ — 09-08 kaydı) | Açık iş, ayrı tur |
| Eval koşu sonuçlarının DB'de saklanması | Yeni tablo | **GEREKMEZ** — `evals/` dosya tabanlı tasarlanıyor |
| `expiresAt` (mevsimlik KB bilgisi) | Yeni kolon | Değerlendirmede var, kapsamda YOK |

---

## Push kapısı — değişmeyen kural
1. Taze `pg_dump` (dosya adı + boyut + TOC girdi sayısı + SHA256).
2. Kurucunun **açık** "push et" onayı (dilim adıyla).
3. Fast-forward push, force YOK; gönderilecek commit listesi önce doğrulanır.
4. CI 5/5 → Railway ACTIVE → salt-okuma prod doğrulaması (migration 53'ün `docs/MIGRATION-53-CANLI-DOGRULAMA.md`
   şablonu).
