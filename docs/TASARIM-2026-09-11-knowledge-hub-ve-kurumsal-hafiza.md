# TASARIM — Knowledge Hub & Gelişmiş Kurumsal Hafıza (kurucu isteği, 2026-09-11)

> Durum: **TASARIM. HİÇBİR ŞEY UYGULANMADI.** Migration ve ücretli servis ayrı onayda.
> Ölçüm: dört paralel ajanın kod-doğrulanmış envanteri (her iddia `dosya:satır` ile).

## Kurucunun cümlesi

> *"Evinizin mevcut Airbnb ilan açıklamasını ve geçmiş misafir mesajlaşmalarını yapay zeka ile
> otomatik analiz ederek temel bir bilgi tabanı oluşturur. Ayrıca elinizdeki PDF rehber
> kitapçıklarını (guidebook) doğrudan sisteme yükleyebilirsiniz."*
>
> *"Gelişmiş Kurumsal Hafıza: çok sayıda mülkü olanlar için her evin kurallarını (check-in saati,
> havuz kuralı vb.) ayrı ayrı beslediğiniz, büyük ölçekli bir kurumsal bilgi tabanı."*

Bu iş **"bilgim yok" kuralının** (`docs/KURAL-2026-09-11-bilgim-yok-misafire-gitmez.md`) asıl
tamamlayıcısıdır: o kural **semptomu** kesiyor (işe yaramaz cevap gitmiyor), bu iş **sebebi** kesiyor
(bilgi zaten orada olsun). Kurucunun kendi teşhisi: *"AI'ı o kadar gelişmiş yapmalıyız ki zaten ona
gerektirecek yer bırakmamalıyız."*

---

## 0. Hedef varış noktası HAZIR — eksik olan KAYNAK bacakları

🚨 **A1 (migration 53) bu işin varış şemasını ZATEN canlıya aldı.** Yeni bir "taslak" mekanizması
tasarlanmayacak; var olan kullanılacak:

| Alan | Değer | Bugün yazan |
|---|---|---|
| `KnowledgeBaseItem.source` | `legacy · host_manual · **extracted_draft** · suggestion_accepted` | yalnız `host_manual` (`api/kb/route.ts:65`) |
| `KnowledgeBaseItem.reviewState` | `legacy · approved · **draft**` | yalnız `approved` (`:66`) |
| `sourceRef` (PII'siz kaynak işaretçisi) | nullable | **HİÇ KİMSE** (şema yorumu: "Bugün yazan yok") |
| `supersededById` (sürüm zinciri) | nullable | **HİÇ KİMSE** (yalnız retrieval OKUYOR) |

`extracted_draft` ve `draft` değerleri **kapalı kümede tanımlı ama üretilmiyor** —
`grep -rn "extracted_draft" src/` tek eşleşme veriyor, o da liste tanımının kendisi
(`src/lib/kb-review.ts:23`). Yani şema bu iş için yazılmış ve **boş duruyor**.

**Erişim kapısı de hazır ve doğru yönde:** `AI_READABLE_REVIEW_STATES = ["legacy","approved"]`
(`kb-review.ts:41`) `fetchKnowledgeBaseForPrompt` içinde `AND`'leniyor (`ai/kb-fetch.ts:82`) →
**taslak kalem modele ULAŞAMAZ**, çağıran ezemez. Yani üç bacağın ürettiği taslaklar host onaylayana
kadar misafire dönmez — güvenlik tarafı zaten kapalı.

**Ölçek tarafı da hazır:** hibrit retrieval (`KB_RETRIEVAL_MODE=hybrid`) kodlandı ve gerçek koşuda
ölçüldü (gold istemde legacy 3/8 → hibrit 7/8; blok 3578 → 740 karakter). Knowledge Hub KB'yi
30 kalemden 200'e çıkaracağı için **bu bayrak açılmadan üç bacak da anlamsızdır** — legacy seçici
"en yeni 30" alır ve yeni bilginin çoğu modele hiç gitmez.

---

## 1. Bacak B — GEÇMİŞ HOST CEVAPLARI (EN UCUZ, MIGRATION YOK, İLK SIRA)

**Neden ilk:** tek girdi bile eksik değil ve **birebir emsali kodda çalışıyor**.

`refreshStyleProfile` (`src/lib/automation.ts:2717-2795`) tam olarak "host'un kendi cevaplarından
öğren" işini yapıyor ve üç zor parçayı çözmüş durumda:

```ts
// src/lib/automation.ts:2766-2772 — SAHİCİ HOST cevabı seçici
OR: [
  { authorType: "host" },
  { authorType: null, senderName: { notIn: [...LEGACY_AI_SENDER_NAMES, LEGACY_AI_RESUME_SENDER] } },
]
```
+ org kapsamı (`conversation.property.organizationId`) + `redactSensitive()` her gövdede
(`:2781-2783`) + minimum örnek eşiği (`:2784`).

**Yapılacak iş:** aynı seçiciyle çekilen cevapları `{id,title,content,updatedAt}` biçimine sokup
`src/lib/ai/retrieval/` girdisine vermek ya da `extracted_draft`/`draft` kalem önerisine çevirmek.

🚨 **Embedding GEREKMİYOR** — `docs/DEGERLENDIRME-2026-09-11-gecmis-cevap-yeniden-kullanimi.md`
bunu zaten kayıt altına aldı: retrieval girdisi bir metin listesidir, geçmiş cevap tam o biçime girer.
Ücretsiz, KVKK'sız, mevcut kod.

### Üç ZORUNLU kural (yeniden yazılmıyor, belgeden aynen)
1. **Geçmiş cevap GERÇEK değil GÖZLEMDİR** — canlı alanla (giriş saati vb.) çelişiyorsa DÜŞER.
2. **Yanlış cevabın ÇOĞALMASI** — yalnız host'un yazdığı/onayladığı, devir/şikâyetle SONUÇLANMAMIŞ
   cevaplar (A1'in `reviewState` sözleşmesinin aynısı).
3. **KVKK** — sır kapısı + ad redaksiyonu + retention purge + erasure bu yüzeye de uygulanır.

### 🚨 ÖLÇÜLEN SINIR: atıf tek yönde kayıplı
`write-service.ts:351-357` sağlayıcıdan gelen her outbound satırı **koşulsuz** `authorType:"host"`
damgalıyor. Bizim AI gönderimlerimiz normalde adopt-and-heal ile korunuyor (`:283-297`, gövde
eşleşmesi) **ama yerel yazma başarısızsa** satır "host" olarak geri geliyor — kodun kendi yorumu
bunu söylüyor (`automation.ts:526-529`). Yani `authorType:"host"` kümesi **Hospitable tarafındaki
otomasyonu ve kaybolmuş AI gönderimlerimizi de içerir**.
→ Bu bacak açılırsa **kendi çıktımızı geri öğrenme** riski gerçektir; `refreshStyleProfile`
yorumu (`:2747-2757`) aynı tuzağa bir kez düşüldüğünü kaydediyor ("GuestOps AI" tek başına denylist
yetmemişti). Bacak B'nin seçicisi bu yüzden **stil profilinden DAHA DAR** olmalı.

### Soru ↔ cevap eşleştirmesi bugün ÇIKARIMDIR
`Message.replyToMessageId` **YOK** (`grep replyTo|inReplyTo|parentMessageId` → hiç eşleşme).
Tek eşleştirme `collectAuditSample` (`quality-audit.ts:101-200`): `lte` + `id` kopma noktası,
`PRIOR_INBOUND_CAP` kadar önceki inbound. Bu bir **yakınlık heuristiğidir**, kayıt değil.
→ Kaydedilmiş bağ isteniyorsa **migration gerekir** (`replyToMessageId String?` + index); CLAUDE.md
bunu zaten açık iş olarak taşıyor. **Bacak B bunu BEKLEMEZ** — yakınlıkla başlayıp ölçmek yeterli.

---

## 2. Bacak A — AIRBNB İLAN AÇIKLAMASI (bugün VERİ YOK, migration KOŞULLU)

🚨 **Bu bacağın engeli şema değil, verinin HİÇ İSTENMEMESİ.**

- `Property` modelinde ilan metni taşıyan **tek bir alan yok** (`schema.prisma:324-345`).
- `HospitableProperty` tipi yalnız `id · name · public_name · address` ilan ediyor
  (`hospitable.ts:272-277`) ve `listProperties` `/properties`'e **`include=` parametresi OLMADAN**
  gidiyor (`:283-285`) — karşılaştırma: `listReservations` açıkça `include=guest` yazıyor (`:350`).
- Kalan alanlar `hospitableIngestAdapter.listProperties`'te düşüyor: `CanonicalProperty` iki alanlı
  bir arayüz (`channels/ingest.ts:32-35`), map `{externalId, name}` üretiyor
  (`hospitable-ingest.ts:159-169`).
- `api/hospitable/diagnostics` payload şekli prober'ı var ama **`/properties` için değil** (`:61`
  yalnız üç anahtarı map'liyor) → **sağlayıcının o uçta ne döndürdüğünü hiç kaydetmedik.**

**Doğru ilk adım ÖLÇÜMDÜR, kod değil:** diagnostics prober'ına `/properties` şeklini eklemek
(salt-okuma, PII'siz anahtar dökümü) ve açıklama/ev kuralları alanının **gerçekten gelip gelmediğini**
görmek. 🚨 Değişmez #18'in ruhu: **doküman/gözlem olmadan tahminî alan adı yazılmaz.**

**Migration:** KB tarafı için **GEREKMEZ** (fetch → çıkarım → `extracted_draft`/`draft` → host onayı).
Ham ilan metnini SAKLAMAK istenirse gerekir (`Property.listingDescription String?` +
`listingDescriptionFetchedAt` + provenance). **Saklamamak daha doğru:** metin sağlayıcıda değişir,
bizdeki kopya bayatlar ve değişmez #14 (Airbnb-kaynaklı veri ile host verisinin politika düzeyinde
ayrılması) ekstra yük getirir. Çıkarım yap, taslağı sakla, ham metni **saklama**.

### 🚨 BEDAVA DURAN BİR KAYNAK: `Property.notes`
Host'un kendi yazdığı 5.000 karakterlik serbest metin (`schema.prisma:334`, validator
`validators.ts:98`) — ve **modele HİÇ gitmiyor**: `PropertyContext` tam olarak 5 alan
(`ai/types.ts:26-32`), istem bloğu da o beşi basıyor (`prompts.ts:1099-1102`).
→ Sıfır migration, sıfır ücret, host'un ZATEN yazdığı bilgi. **AMA doğrudan isteme basmak POLİTİKA
DEĞİŞİKLİĞİDİR:** `notes` host'un özel not alanıdır (kapı kodu, komşu telefonu, temizlikçi adı orada
olabilir) ve bugün **hiçbir sır taramasından geçmiyor** —
`docs/ONAY-qr-mulk-kimlik-alanlari-sir-taramasi-2026-09-11.md`'deki aynı sınıf.
→ Doğru yol: `notes`'u **çıkarım kaynağı** yapmak (host'a taslak öner, o onaylasın), isteme
doğrudan basmak DEĞİL. Onaylanan kalem normal KB kalemi olur ve sır kapısından geçer.

---

## 3. Bacak C — PDF GUIDEBOOK (en pahalı, dört kapı + bir bağımlılık)

Depolama altyapısı var ama **görsel için** kurulmuş ve PDF **dört yerden** bloke:

| Kapı | Bugün | Gereken |
|---|---|---|
| MIME allowlist | `["image/jpeg","image/png","image/webp"]` (`api/upload/route.ts:12,47`) | `application/pdf` |
| Sihirli bayt | `sniffImageExt` → `jpg\|png\|webp`, null ise 400 (`image-validation.ts:8-24`) | `%PDF-` sniffer |
| Anahtar şekli | `isSafeObjectKey` **tam 5 segment** `org/{id}/task/{id}/{dosya}` (`storage/keys.ts:33-45`) | yeni builder + genişletme (silme kuyruğu da buna bakıyor) |
| Servis rotası | yalnız `/api/storage/photo/[...key]` | PDF için ayrı rota |
| Boyut | 5 MB (`:13`) | rehber kitapçığı için muhtemelen yetersiz |
| Sahiplik | yükleme bir **Task'a** bağlı ve staff atanmış olmalı (`:72-83`) | mülke bağlı yeni yol |

**PDF metin çıkarımı için bağımlılık YOK** — `package.json`'da `pdf-parse`/`pdfjs-dist`/`unpdf` yok.
🚨 Bu **tedarik zinciri kararıdır**: yeni bağımlılık = zafiyet kapısı + triaj yükü. Ayrıca
`kb-extract` gibi **tarayıcıda** koşamaz (A5'in "çıkarım tarayıcıda, sunucuya yalnız kabul edilen
kalem gider" modeli bozulur) — ya client lib bundle'lanır ya çıkarım sunucuya taşınır.

**Migration:** PDF **geçiciyse** (yükle → metni çıkar → taslak öner → baytları at) **GEREKMEZ.**
Dosya saklanacaksa gerekir: repoda `Document`/`Attachment`/`Upload` modeli **hiç yok**.
→ **Geçici işleme** öner: guidebook'un değeri metnindedir, PDF'i saklamak KVKK yükü ekler.

---

## 4. Bacak D — "GELİŞMİŞ KURUMSAL HAFIZA" (org düzeyi KB) → MIGRATION ŞART

🚨 `KnowledgeBaseItem.propertyId` **NOT NULL** ve modelde `organizationId` **YOK**
(`schema.prisma:779`). Org kapsamı bugün JOIN ile yapılıyor (`api/kb/route.ts:15`).

Bugünkü "çok mülke yay" cevabı **kopyalamadır**: `POST /api/kb/[id]/copy` satırı her hedef mülke
klonluyor (`copy/route.ts:87-104`). 10 daire = aynı kuralın 10 kopyası, biri güncellenince
diğerleri bayatlıyor. Kurucunun istediği şey tam olarak bunun çözülmesi.

**Emsal ŞEMADA VAR:** `MessageTemplate` `organizationId` + `propertyId String? // null = org-wide`
(`schema.prisma:863-864`). `KnowledgeBaseItem` bu şekli bilinçli olarak izlememiş.

**Maliyet:**
- `propertyId` nullable + `organizationId` eklenmesi = **DOLU tabloya** değişiklik. Nullable kolon +
  backfill güvenli; ⚠️ CLAUDE.md kuralı: dolu tabloya `required-no-default` EKLEME. Yani
  `organizationId` nullable eklenip backfill edilir, NOT NULL'a çevirme **ayrı ve sonraki** adım.
- **Dört çağrı yerinin hepsi** düz `propertyId` eşitliği kullanıyor ve OR dalı ister:
  `guest-chat.ts:876` · `automation.ts:1552` · `conversations/[id]/ai-suggest/route.ts:60` ·
  `ai/test/route.ts:76`.
- Plan limitleri mülk başına sayıyor (`api/kb/route.ts:44-51`, `plan-limits.ts:66,72,78`) — org
  kalemi hangi mülkün kotasından düşecek? **Ürün kararı, teknik değil.**
- 🚨 **Sır kapısı ve çakışma:** org kalemi ile mülk kalemi aynı konuda çelişirse hangisi kazanır?
  Retrieval'ın çelişki koruması alan bazlı çalışıyor ve **aynı alanın iki değerini** insana devrediyor
  — org/mülk önceliği **kodda açık bir kural** olmalı, yoksa her org kuralı her mülkte çelişki üretir.
  Öneri: **mülk kalemi org kalemini EZER** (daha spesifik kazanır), ve bu `supersededById` değil
  ayrı bir öncelik alanıdır.

---

## 5. Önerilen sıra (bağımlılık sırası, gerekçeli)

| # | İş | Migration | Ücretli | Neden bu sırada |
|---|---|---|---|---|
| 0 | **`KB_RETRIEVAL_MODE=hybrid` pilotu → genel** | yok | yok | Bu olmadan yeni bilgi "en yeni 30" tavanına takılır; üç bacak da boşa gider. Kanıt hazır. |
| 1 | **Bacak B — geçmiş host cevapları** | yok | yok | Girdi tam, emsal kodda çalışıyor, en yüksek değer. |
| 2 | **`Property.notes` → çıkarım kaynağı** | yok | yok | Host'un ZATEN yazdığı metin; isteme basmak değil taslak önermek. |
| 3 | **Bacak A ölçümü** (diagnostics `/properties` şekli) | yok | yok | Alan gerçekten geliyor mu — tahmin yasak (#18). |
| 4 | Bacak A uygulaması | koşullu | yok | Yalnız 3 pozitif çıkarsa. |
| 5 | **Bacak D — org düzeyi KB** | **ŞART** | yok | Kopyalama sorununu çözer; önceliği kuralı ürün kararı ister. |
| 6 | Bacak C — PDF | koşullu | yok | Dört kapı + yeni bağımlılık; en pahalı, en az acil. |
| — | Embedding / LightRAG | — | **EVET** | Yalnız 0–5 ölçüldükten SONRA ve "kalan başarısızlar" listesiyle. |

## 6. Bu belge NEYİ ONAYLAMIYOR

- Hiçbir migration yazılmadı.
- Hiçbir ücretli servis çağrılmadı; embedding **hâlâ yok** (`SemanticScorer` no-op, pin).
- `KB_RETRIEVAL_MODE` bayrağı **hâlâ varsayılan kapalı**.
- `Property.notes` isteme **bağlanmadı**.
- Bacak B'nin seçicisi yazılmadı — ⚠️ yazılırken `authorType:"host"` kümesinin
  **kendi AI çıktımızı içerebildiği** ölçülmüş gerçeği (↑§1) kapıya girmeli.
