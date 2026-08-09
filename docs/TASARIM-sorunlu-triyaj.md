# Tasarım — "Sorunlu konuşmalar" triyajı (m48)

> Durum: **İKİNCİ KEZ REVİZE EDİLDİ (08-09) — KOD YAZILMADI, MIGRATION YAZILMADI.**
>
> ⚠️ **08-09 KOD DENETİMİ ÜÇ SOMUT HATA BULDU** (Codex talimatı: "önce güncel m48
> tasarımını yeniden denetle; kolon semantiğini, yazma/okuma noktalarını,
> eşzamanlı model sonucu yarışını, KVKK kapsamını, NULL anlamlarını ve rollback
> planını KODDAN doğrula"). Hatalar §0'da; aşağıdaki bölümler o düzeltmelerle
> okunmalıdır.
> Yazan: Claude · 2026-08-08. İlk taslak Codex incelemesine gitti; Codex "mevcut
> haliyle yazma, önce tasarımı revize et" dedi ve altı eksik saydı:
> `aiTriageSource` · `aiTriageTriggerMessageId` · `aiTriagedAt` · bayat kayıt
> temizleme kuralları · KVKK/export/erasure kapsamı · sonlu-sayı (finite)
> doğrulaması · güvenli JSON ayrıştırma. Bu sürüm o altısını karşılıyor.
> ⚠️ Bu turda **hiçbir kod ve hiçbir migration yazılmadı** — belge, uygulama değil.

---

## 0. 🔴 08-09 KOD DENETİMİ — TASARIMDA BULUNAN ÜÇ HATA

Aşağıdakilerin hepsi `file:line` ile kod-doğrulandı. Tasarım bunlar düzeltilmeden
UYGULANAMAZ; ikisi sessiz veri hatası, biri yanlış arayüz iddiası üretirdi.

### (0a) 🚨 ESCALATE YOLU İKİ DEĞİL, **ÜÇ** — üçüncüsü tasarımda hiç yok

Belge boyunca "model yolu" + "kelime yolu" ikilisi varsayılıyor. Kodda `status`'ü
`"problem"` yapan ÜÇ yer var:

| # | Yer | Şekil | Kaynak |
|---|---|---|---|
| 1 | `automation.ts:1698` `applyChannelAutoReply` | koşullu `updateMany` (`status: { not: "problem" }`) | model |
| 2 | `automation.ts:3487` `sendDueAlerts` | koşullu `updateMany` (`status: "new"`) | kelime |
| 3 | **`automation.ts:1047` `applyInboundMessageRules`** | **koşulsuz `update`**, `$transaction` içinde | **kelime** |

🚨 **Üçüncüsü MODEL DEĞİL:** `classifyMessage` (`ai/index.ts:372-374`) gövdesi
tek satır — `return classifyFallback(message)`. Yani hiç model çağrısı yok;
escalate kararı `result.isComplaint` ile deterministik sınıflandırıcıdan geliyor.
Çağıran: `POST /api/conversations` (`route.ts:77`) — host'un elle açtığı konuşma.

**Sonuç:** bu yol bağlanmazsa o konuşmalar `status:"problem"` olur ama altı kolon
da NULL kalır. §2a'nın tüm amacı "NULL'dan anlam çıkarma"ydı; bağlanmayan bir
yol tam da o belirsizliği geri getirir. **Ve `aiTriageSource:"keyword"` yazan yol
BİR DEĞİL İKİ.**

⚠️ Ayrıca bu yol **koşulsuz `update`** — §3c2'nin tazelik koşulu oraya olduğu gibi
uygulanamaz; ya şekli `updateMany`ye çevrilir ya da o yol için tazelik iddiası
AÇIKÇA yapılmaz. Sessizce atlanamaz.

### (0b) 🚨 §3f'nin "tek `update` yeterli" iddiası YANLIŞ — **ALTI** çıkış noktası var

§3f "temizleme status geçişine bağlanır, geçişte tek `update` yeterli" diyor.
Konuşmayı `"problem"`den çıkarabilen yerler:

1. `conversations/[id]/reply/route.ts:227` → `"answered"` (host cevap yazdı)
2. `conversations/[id]/reply/route.ts:238` → `"answered"` (ikinci dal)
3. `outbox/worker.ts:334` → `"answered"` (durable outbox teslim etti; `status: { not: "closed" }` yani problem'i DE geçer)
4. `automation.ts:651` → `"new"` (geri alma)
5. `automation.ts:677` → `"new"` (geri alma)
6. **`conversations/[id]/route.ts:20-23` → `data: parsed.data`** — host'un arayüzden seçtiği durum. 🚨 §4'ün önerdiği *"Bu bir şikayet değil — sorunlu işaretini kaldır"* düğmesi TAM BURADAN geçer, yani tasarımın kendi arayüzü bu noktayı zorunlu kılıyor.

**Tek bir "geçiş hook'u" YOK.** Seçenekler (karar verilmedi):
- (i) Altı noktaya da temizleme ekle → dağınık, biri unutulur (bu deponun `SCRUB KAPSAMI` dersi).
- (ii) Temizlemeyi TAMAMEN BIRAK, yalnız §3d bayatlık göstergesine güven → tek maliyet: haftalar sonra yeniden escalate olan konuşmada eski öneri "bayat" rozetiyle görünür. Bugünkü fail-safe'e (id çözülemezse bayat say) uyumlu.
- (iii) Okuma yüzeyinde `status === "problem"` şartı ara → temizleme hiç gerekmez, çünkü kolonlar yalnız problem listesinde okunuyor.

**Önerim (iii)+(ii):** yazma tarafında hiçbir temizleme yok, okuma tarafı zaten
`status:"problem"` filtresiyle çalışıyor. Altı noktaya dokunmamak, altısını da
doğru bağlamaktan güvenli.

### (0c) `anonymizeOldGuestData` **BİR** değil **İKİ** dalda yazıyor

§2b "aynı `update`'e iki metin kolonu eklenir" diyor, tekil. Kodda iki ayrı
`updateMany` var:
- `data-retention.ts:224` — rezervasyona BAĞLI konuşmalar
- `data-retention.ts:367` — **ÖKSÜZ** konuşmalar (`reservationId: null`)

İkincisi tam olarak bu deponun daha önce yandığı yer: `TaskUpdate.note` öksüz
dalda unutulmuştu ve `scrub-scope-parity` testi onu GÖREMİYOR (test dosya
düzeyinde (model,kolon) KÜMELERİNİ karşılaştırıyor, DAL düzeyinde değil).
**Her iki dal da elle bağlanacak; parite testi bu hatayı yakalamaz.**
Açık silme tarafı tek noktadır: `erasure.ts:462`.

---

### ✅ Denetimde DOĞRULANAN iddialar (değişiklik gerekmiyor)

- **Temel önerme geçerli:** `actionSuggestion` `ai/index.ts:285-287`'de üretilip
  300 karaktere kırpılıyor, `missingInfo` `:299`'da `sanitizeStringList(…, 5, 80)`
  ile; `fallback.ts:1320-1352` de üretiyor. İkisi de yalnız CANLI olarak
  `conversation-thread.tsx:842,855` ve `ai-test-card.tsx:209` ile çiziliyor —
  hiçbir kolona yazılmıyor. ⚠️ Kırpma sınırı §3a'da "5 × 120" yazılı ama kodda
  **5 × 80**; tasarım koda uydurulmalı (yoksa iki farklı sınır doğar).
- **`lastMessageAt` tazelik anahtarı doğru seçilmiş:** `schema.prisma:506` mevcut,
  `:565` ve `:568`'de İKİ index'te — §3c2'nin WHERE koşulu bedava.
- **Kanarya `Float?`ü gerçekten görmüyor:** `scrub-scope-parity.test.ts:38` regex'i
  `(String\??|Json\??|Int\??|Boolean\??|DateTime\??)`. `aiConfidence` sayacı
  değiştirmez → kapsam kararı ELLE verilecek. (Diğer beş kolon kırmızı verecek.)
- **Veri ihracı açık `select` kullanıyor** (`data-export.ts:155-167`) → yeni
  kolonlar kendiliğinden sızmaz, bilinçli eklenir. §2b'nin önerisi geçerli.
- **`/inbox` sayfası server component** ve `prisma`yı doğrudan çağırıyor →
  §3e'nin "çıplak `JSON.parse` tüm sayfayı 500'ler" gerekçesi geçerli.
- **KVKK kapsam kararı doğru:** `aiConfidence` · `aiTriageSource` · `aiTriagedAt` ·
  `aiTriageTriggerMessageId` kişisel veri taşımıyor; `Message.aiSourcesJson`
  emsaliyle tutarlı.
- **Rollback planı geçerli:** kolonlar nullable + varsayılansız, hiçbir mevcut
  sorgu okumuyor → geri alma "okumayı bırak", DROP gerekmiyor.

---

## 1. Kapatılan boşluk — tek cümle

Model, escalate ettiği **her** konuşma için `actionSuggestion` (ne yapılmalı) ve
`missingInfo` (misafirden ne lazım) üretiyor; ikisi de **hiçbir yere yazılmıyor** ve
istek bitince yok oluyor. Bunlar `AiReplyResult` tipinde tanımlı
(`src/lib/ai/types.ts:84,98`) ama `automation.ts`'te ve `schema.prisma`'da **sıfır**
geçiş var (grep ile doğrulandı).

Yani: ev sahibine "3 sorunlu konuşma var" diyoruz, oysa model o üçü için
**bilgi tabanını, mülkü ve rezervasyonu görerek** ne yapılması gerektiğini zaten
yazmıştı. Onu attık.

🚨 **Bu, planı tersine çeviren bulgudur.** İlk niyet "ikinci bir model çağrısıyla
sorunları analiz ettirelim"di. Ama ikinci çağrı, KIRPILMIŞ metinden, KB'siz,
rezervasyonsuz çalışır — yani **birincisinden daha kötü** bir analiz üretir, üstelik
kota harcayarak. Doğru hamle yeni bir çağrı değil, **zaten ödediğimizi saklamak**.

---

## 2. Şema değişikliği (m48) — SAF ADDITIVE, ALTI KOLON

İlk taslakta üç kolon vardı. Codex incelemesi üçünü daha ekletti; gerekçeleri
aşağıda tek tek, çünkü hiçbiri kozmetik değil.

```prisma
model Conversation {
  // … mevcut alanlar …

  /// Modelin escalate ederken yazdığı "ne yapılmalı" önerisi (host'a gösterilir).
  aiActionSuggestion String?
  /// Modelin "misafirden şunlar eksik" listesi. JSON string dizisi.
  aiMissingInfoJson  String?
  /// Modelin kendi güveni (0..1). Yalnız SONLU değer yazılır (↓§3c).
  aiConfidence       Float?
  /// Bu triyajı HANGİ yol üretti: "model" | "keyword". Kapalı set, kod-clamp.
  aiTriageSource     String?
  /// Triyajı tetikleyen mesajın id'si. Bayatlık bunun üzerinden ölçülür (↓§3d).
  aiTriageTriggerMessageId String?
  /// Triyajın yazıldığı an. `updatedAt` DEĞİL — o her yazmada değişir.
  aiTriagedAt        DateTime?
}
```

### (a) `aiTriageSource` — NULL'dan anlam çıkarmayı BIRAK

İlk taslak "`aiConfidence IS NULL` = modele hiç sorulmadı" diyordu ve buna
**bedava sinyal** adını veriyordu. Bu çıkarım YANLIŞ olabilir: model KOŞUP da
`confidence` alanını sonlu bir sayı olarak döndürmeyebilir (şema gevşek, `NaN`
gelebilir, alan hiç gelmeyebilir) — o zaman §3c'nin sonluluk kapısı kolonu NULL
bırakır ve arayüz "modele hiç sorulmadı" diye YALAN söyler.

İki farklı gerçeği tek bir NULL'a bindirmek, bu deponun daha önce yandığı desen:
`twoFactorSecret` dolu ≠ 2FA açık (CLAUDE.md'deki asimetrik teşhis kuralı aynı
sınıf). Ayrı bir kolon bu belirsizliği tamamen kaldırır.

Kapalı set — `riskType`'ın emsalindeki gibi **kod-clamp**, DB enum DEĞİL:
`"model"` (model koştu, `passesAutoReplySafetyGate` yolu) ·
`"keyword"` (`sendDueAlerts` kelime yolu, model HİÇ koşmadı).
Bilinmeyen bir değer gelirse NULL yazılır — DB enum kullanmamanın sebebi, yeni bir
yol eklendiğinde migration gerektirmemesi.

### (b) `aiTriageTriggerMessageId` — analiz BİR mesaja aittir

Triyaj, o an gelen TEK mesajdan üretiliyor. Misafir sonra üç mesaj daha yazarsa
öneri sessizce bayatlar ve host, üç mesaj öncesine ait bir tavsiyeyi güncel sanır.
Tetikleyici mesajın id'si saklanırsa arayüz bunu **söyleyebilir** ("bu analiz şu
mesaja ait; sonrasında 3 mesaj daha geldi").

⚠️ **FK KURULMAZ, düz `String?` olur.** Gerekçe: `Message` satırları KVKK
süpürgeleriyle anonimleştiriliyor ve silinebiliyor; FK + `onDelete: Cascade`
konuşmanın triyajını da götürür, `Restrict` ise süpürgeyi kilitler. Düz id, ölü
referansta yalnız "bayatlık ölçülemiyor" demektir — fail-safe yön §3d'de.

### (c) `aiTriagedAt` — `updatedAt` bu işi GÖREMEZ

`Conversation.updatedAt` her yazmada değişiyor (mesaj sayacı, durum, okundu
işareti). Triyajın yaşını ondan okumak, alakasız bir yazmanın analizi taze
göstermesi demek. Ayrı damga şart. Ayrıca §4'teki bayat-temizleme kuralı bu alana
dayanıyor.

**Neden güvenli (altı kolon da):**
- Hepsi **nullable**, varsayılansız → dolu tabloya ALTER güvenli
  (CLAUDE.md: "Dolu tabloya ASLA `@unique`/required-no-default/drop ekleme").
- Hiçbir mevcut sorgu bu kolonları okumuyor → eski satırlar NULL kalır.
- Geri alma: okumayı bırakmak yeterli; DROP gerekmez.

**Index GEREKMİYOR:** hiçbiri `where`/`orderBy`'da kullanılmıyor, yalnız zaten
seçilmiş satırlarda okunuyor. ⚠️ Bu, arayüz "AI doğrulaması olmayanları filtrele"
gibi bir özellik isterse DEĞİŞİR — o gün `aiTriageSource` için index gerekir.

⚠️ Migration SQL bu belgeye **BİLEREK YAZILMADI**. CLAUDE.md'nin kuralı elle
yazmamak: `prisma migrate diff` ile üret, taze bir throwaway Postgres'te
`00→48` sıfır-drift doğrula. Elle yazılmış "beklenen çıktı" bu belgede dururken
birinin onu kopyalaması gerçek bir risk (ilk taslakta duruyordu, kaldırıldı).

---

## 2b. 🚨 KVKK / EXPORT / ERASURE KAPSAMI — bu bölüm olmadan m48 YAZILMAZ

`aiActionSuggestion` ve `aiMissingInfoJson` **misafirin mesajından türetilmiş
model metnidir**. İçlerinde misafirin adı, telefonu, rezervasyon ayrıntısı,
şikayetinin içeriği geçebilir — çünkü model tam da onları okuyarak yazıyor.
Yani bunlar **misafir kişisel verisidir** ve deponun kendi kuralına tabidir:

> **SCRUB KAPSAMI KURALI:** misafir metni/adı taşıyan HER yeni kolon İKİ süpürgeye
> birden bağlanır — `anonymizeOldGuestData` (süre-bazlı) VE `maskReservationRows`
> (açık silme talebi); biri eksikse vaat yalan olur.

Bağlanacak üç yer:
1. `anonymizeOldGuestData` — `Conversation.guestIdentifier` ile aynı `update`'e
   iki metin kolonu da eklenir (`null`'a çekilir; ANON sabiti gerekmez, bunlar
   görüntülenen bir ad değil).
2. `maskReservationRows` — aynısı.
3. **Veri ihracı** (`buildOrganizationDataExport`) — müşterinin kendi verisidir,
   ihraçta YER ALMALI. ⚠️ İhraç metni HAM gidiyor; `aiMissingInfoJson` bir JSON
   STRING, ihraçta ayrıştırılıp dizi olarak mı yoksa ham string olarak mı
   verileceği bir karardır. Öneri: **ham string** — ayrıştırma ihraç yolunda
   patlarsa tüm ihracı düşürür (↓§3e ile aynı gerekçe).

**`aiConfidence`, `aiTriageSource`, `aiTriagedAt`, `aiTriageTriggerMessageId`
süpürge KAPSAMI DIŞINDA** ve bu bilinçli: bir sayı, kapalı-set bir etiket, bir
zaman damgası ve opak bir id kişisel veri taşımaz. (`Message.aiSourcesJson`
emsali: yalnız ETİKET tutuyor, değer değil → kapsam dışı.)

### ⚠️ KANARYA İKİ KOLONU GÖRÜR, DÖRDÜNÜ GÖRMEZ — ÖLÇÜLDÜ

`tests/unit/scrub-scope-parity.test.ts:38` şema satırlarını şu regex ile tarıyor:
`/^\s+(\w+)\s+(String\??|Json\??|Int\??|Boolean\??|DateTime\??)\s*(.*)$/`

Yani `String?` ve `DateTime?` kolonları sayacı değiştirir ve kanarya **KIRMIZI**
verir (istenen davranış: "bu kolon misafir metni taşıyor mu?" diye sordurur).
**`Float?` bu listede YOK** → `aiConfidence` sayacı hiç değiştirmez, sessizce
geçer. Bugün zararsız (o kolon gerçekten kapsam dışı) ama **kural budur ve
yazılı olmalıdır**: kanarya `Float`/`Decimal`/`String[]` kolonlarını GÖRMEZ, bu
yüzden sayısal bir kolon eklerken kapsam kararı ELLE verilir.

(Bu sınır zaten `docs/ACIK-ISLER-2026-08-08.md` §12'de kayıtlı; burada tekrar
ediliyor çünkü m48 tam olarak o boşluğa denk gelen ilk değişiklik.)

---

## 3. Yazma noktaları, doğrulama ve okuma sözleşmesi

### (a) Model yolu — `automation.ts` escalate claim'i

Modelin ZATEN ürettiği alanlar (`actionSuggestion`, `missingInfo`, `confidence`)
claim `updateMany`'sine eklenir. Yeni model çağrısı YOK — bu tasarımın tek fikri
"zaten ödediğimizi saklamak". Yanına `aiTriageSource: "model"`,
`aiTriageTriggerMessageId: <tetikleyen mesajın id'si>`, `aiTriagedAt: <şimdi>`.

Kırpma sınırları (mevcut `ai/index.ts` emsali): öneri 300 karakter, eksik-bilgi
listesi en fazla 5 madde × 120 karakter. Sebep kozmetik değil — model çıktısı
sınırsız uzayabilir ve bu alanlar host'un ekranına basılıyor.

### (b) Kelime-eşleşme yolu — `sendDueAlerts`

Model HİÇ koşmadı. Uydurma değer YAZILMAZ: üç analiz kolonu NULL kalır.
**Ama `aiTriageSource: "keyword"` ve `aiTriagedAt` YAZILIR** — çünkü artık
"modele sorulmadı" ile "model sorulup sonuç alınamadı" ayrımı NULL'a değil bu
kolona bağlı (§2a). Tetikleyici mesaj id'si burada da yazılabilir; kelime yolu
zaten hangi mesajın eşleştiğini biliyor.

### (c) 🚨 SONLULUK DOĞRULAMASI — `typeof === "number"` YETMEZ

İlk taslak `typeof result.confidence === "number" ? result.confidence : null`
yazıyordu. Bu kapı **`NaN` ve `Infinity`'yi GEÇİRİR** — ikisinin de `typeof`'u
`"number"`dır. Model çıktısı JSON'dan geliyor ve bu alan şemaca zorunlu değil;
bozuk bir değer Postgres'e `double precision` olarak yazılır ve sonra:
- arayüzde `%NaN` görünür,
- ileride bir eşik karşılaştırması (`aiConfidence < 0.5`) `NaN` ile **daima false**
  döner, yani "düşük güvenli olanları işaretle" özelliği sessizce hiç çalışmaz.

**Kural: `Number.isFinite(x) ? x : null`.** Ayrıca 0..1 aralığına clamp edilir —
model 1.4 yazarsa arayüz "%140 güven" göstermemelidir. Bu, `riskType`'ın
kod-clamp emsalinin aynısı: model çıktısı DAİMA daraltılır, asla olduğu gibi
kabul edilmez.

### (c2) 🚨 MODEL SONUCU YARIŞI — YAZMA KOŞULLU VE ATOMİK OLMAK ZORUNDA

**Senaryo (bu tasarımın en kolay kaçırılan kusuru):** model çağrısı 20–60 sn
sürebiliyor. O sırada misafir YENİ bir mesaj yazarsa, dönen sonuç ARTIK BAŞKA
bir konuşma durumuna aittir. Koşulsuz yazma, yeni mesajın triyajını ESKİ mesajın
analiziyle ezer — üstelik sessizce, çünkü tüm alanlar dolu ve taze görünür.

Bu, deponun daha önce iki kez yandığı desenin aynısı: `autoReplyAttemptedAt`
damgasının sunucu saatiyle değil mesajın KENDİ damgasıyla yazılması kuralı ve
`syncCursorAt` dersi. İkisi de "işlem sürerken dünya değişti" hâlini anlatıyor.

**Kural: yazma tek bir koşullu `updateMany` olur, oku-sonra-yaz OLMAZ.**

```
updateMany({
  where: {
    id: conversation.id,
    status: { not: "problem" },        // mevcut claim koşulu (aynen korunur)
    lastMessageAt: observedLastMessageAt, // ⬅️ TAZELİK KOŞULU
  },
  data: { …triyaj alanları… },
})
```

`observedLastMessageAt`, model çağrısına GİRERKEN okunan değerdir. `count === 0`
ise araya yeni mesaj girmiştir → **triyaj YAZILMAZ ve bu bir hata değildir**.
Yön fail-safe: yanlış bir tavsiye göstermektense hiç göstermemek.

⚠️ **`aiTriagedAt` sunucu saatinden yazılabilir, `aiTriageTriggerMessageId`
YAZILAMAZ** — ikincisi çağrıya girerken bilinen mesajın id'sidir; yazma anında
"son mesaj" diye yeniden okumak tam da kapatmak istediğimiz yarışı geri açar.

⚠️ **Neden `lastMessageAt`, neden mesaj id'si DEĞİL:** `Conversation.lastMessageAt`
zaten var, indeksli ve aday sorgusunun kullandığı alan; ayrıca "son inbound
mesajın id'si" diye bir kolon YOK ve eklemek migration'ı büyütür.

#### Test senaryosu (yazılacak, bu gece DEĞİL)
1. Konuşma `lastMessageAt = T1`. Model sonucu T1 için hesaplanmış gibi kurulur.
2. Yazmadan ÖNCE araya yeni bir inbound mesaj girer → `lastMessageAt = T2`.
3. Koşullu yazma denenir → `count === 0`, **altı kolon da NULL kalır**.
4. **KONTROL (bu olmadan test vacuous):** araya mesaj GİRMEYEN aynı akış
   çalıştırılır → alanlar DOLAR. Kontrol olmadan "hiçbir zaman yazma"
   mutasyonu da yeşil geçerdi.
5. Mutasyon: tazelik koşulunu WHERE'den çıkar → adım 3 kırmızı vermeli.

### (d) Bayatlık — SAKLA, SİLME

Triyaj bir mesaja ait. Sonraki mesajlar geldiğinde öneri yanlış olabilir ama
**otomatik silinmez**; arayüz bayat olduğunu SÖYLER. Gerekçe: silmek, host'un
faydalanabileceği bir bilgiyi yok etmek; göstermeyip susmak ise sessiz kayıp.

Bayatlık ölçüsü: `aiTriageTriggerMessageId` ile konuşmanın son inbound mesajı
farklıysa BAYAT. Fail-safe: id çözülemiyorsa (mesaj silinmiş/anonimleştirilmiş)
`aiTriagedAt` ile `lastMessageAt` karşılaştırılır; o da yoksa **bayat sayılır**
(bilinmeyenin güvenli yönü "bu tavsiyeye güvenme"dir).

### (e) 🚨 GÜVENLİ JSON AYRIŞTIRMA — okuma yolu PATLAYAMAZ

`aiMissingInfoJson` bir metin kolonu. Çıplak `JSON.parse` üç durumda fırlatır:
bozuk satır, elle DB düzenlemesi, ve gelecekte biçim değişirse eski satırlar.
**Bu değer `/inbox` sayfasında okunuyor ve o bir async server component** — orada
fırlayan bir istisna TÜM SAYFAYI 500'ler, yalnız o kartı değil. Yani kozmetik bir
alan, gelen kutusunu komple indirir.

Sözleşme: ayrıştırma `try/catch` içinde, dönüş **her zaman `string[]`**, hata
durumunda `[]`. Ek olarak şekil doğrulaması — `Array.isArray` VE her elemanın
`typeof === "string"` olması (JSON geçerli olup `{"a":1}` dönebilir; `.map()`
o zaman patlar). Sessiz `catch {}` DEĞİL: `[]` dönmek burada doğru davranış,
çünkü "eksik bilgi listesi yok" zaten geçerli bir durum.

⚠️ Aynı sözleşme veri ihracına da uygulanır (↑§2b) — ihraçta ham string vermek
tam da bu yüzden öneriliyor.

### (f) Temizleme kuralları — konuşma "Sorunlu"dan çıkınca

Host sorunu çözüp konuşmayı kapattığında triyaj kolonları **NULL'lanır**.
Gerekçe: aynı konuşma haftalar sonra yeniden escalate olursa, o gün yazılmış
eski öneri "güncel analiz" gibi görünür — bayat-gösterme mekanizması (§3d) bunu
yakalar ama ancak tetikleyici mesaj hâlâ duruyorsa. Kapanışta temizlemek bu
belirsizliği tamamen kaldırır.

⚠️ Temizleme **status geçişine bağlanır, cron'a DEĞİL.** Ayrı bir süpürge
yazmak yeni bir zamanlanmış iş demek; bu turda takvim bacağının cron'a
bağlanmasının ne kadar yan etki ürettiği görüldü. Geçişte tek `update` yeterli.

⚠️ KVKK süpürgeleri bu temizlemeden BAĞIMSIZ çalışır (§2b) — konuşma hiç
kapanmasa bile süre dolunca metin anonimleşir.

---

## 4. Okuma yüzeyi — `/inbox?status=problem` sayfasının ÜSTÜ

**Neden panel değil:** ev sahibi sorunu okuyup **cevap yazacak**; cevap gelen
kutusunda yazılıyor. Paneldeki bir panelde analizi okuyup sonra başka sayfaya
gitmek zorunda kalır.

**Neden yeni bir menü sayfası değil:** kenar çubuğunda 14 satır var ve toplam
803 CSS px, bütçe 808.4 (`app-shell.tsx` yorumunda ölçülü). 15. satır 768px'te
kaydırma çubuğu doğurur — `mt-4` kararının önlediği şeyin ta kendisi.

**Neden `/reports` değil:** oradaki "AI Risk Görünümü" kartı **30 günlük geçmiş**
(`RiskEvent` sayımları). "Şu an açık olan" kavramı yok; yan yana koymak tam da
kaçınmak istediğimiz tekrarı üretir.

Render (model çağrısı YOK):

```
Açık sorunlar — triyaj                                    [3 konuşma]

  Temizlik/hijyen · 2 konuşma
    Nuve 3 · 4 saattir bekliyor
      Ne oldu       Misafir banyoda temizlik sorunu bildirdi.
      Önerilen adım Ekibi bugün yönlendirin, fotoğraf isteyin.
      Eksik bilgi   Fotoğraf · hangi oda
    Nuve 7 · 2 saattir bekliyor
      …

  Platform dışı ödeme · 1 konuşma
    Nuve 5 · 1 gündür bekliyor   ⚠ Yalnız kelime eşleşmesi — AI doğrulaması yok
```

Gruplama `lastRiskType` (11'lik kapalı set, etiketler `ui-labels.ts`), sıralama
`lastMessageAt` (en uzun bekleyen üstte).

---

## 5. Yanlış-pozitif işareti — bu özelliğin ÖN KOŞULU DEĞİL, ÇÖZÜMÜNÜN PARÇASI

Ölçülmüş gerçek vaka: `"Can you send location link. Its not working"` →
`intent=complaint`, çünkü `"not working"` `fallback.ts:90`'da düz bir kelime.
Bu yol `sendDueAlerts`'te **hiç model çapraz-kontrolü olmadan** escalate ediyor
ve ev sahibine "⚠️ Acil misafir mesajı" maili atıyor.

`aiTriageSource === "keyword"` bunu görünür kılar:

⚠️ **İlk taslak burada `aiConfidence IS NULL` diyordu ve buna "bedava sinyal"
adını veriyordu — REVİZEDE DEĞİŞTİ (§2a).** Model koşup da sonlu bir güven
değeri döndürmediğinde o kolon da NULL kalır; iki farklı gerçeği tek NULL'a
bindirmek arayüze "modele hiç sorulmadı" diye yalan söyletirdi. Sinyal artık
açık bir kolonda.

- O satırlar `⚠ Yalnız kelime eşleşmesi — AI doğrulaması yok` rozetiyle çizilir.
- Yanına çıkış yolu konur: `Bu bir şikayet değil — sorunlu işaretini kaldır`.
- İleride bir model çağrısı eklenirse bu satırlar **çağrıdan hariç tutulur** →
  hem gürültü hem maliyet düşer.

🚨 Kelime listesini DARALTMAK ayrı ve tehlikeli bir turdur (CLAUDE.md: bu depoda
bir sır dedektörünü genişletip 12 meşru kalemin 6'sını elemiştim). Golden set
zorunlu. **Bu tasarım o tura bağımlı değildir.**

---

## 6. Opsiyonel ikinci aşama — model çağrısı (ŞİMDİ YAPILMIYOR)

Tek meşru gerekçe **konuşmalar arası sentez**: "Nuve 3'te üç ayrı şikayetin ortak
sebebi kombi olabilir." Gruplama bunu yapamaz.

Kurulursa: `withManage` → `premiumAllowed` → `rateLimit("problem-triage:{org}", 10/saat)
→ **sıfır-sorun erken dönüş** → *sonra* `consumeDailyAiBudget` (repo kuralı: bütçe
doğrulamadan SONRA tüketilir). Tek çağrı, N konuşma. Gönderilen: sıra numarası
(cuid ASLA), mülk **adı**, `riskType`, yaş, ve **misafir adı redakte edilmiş** gövde.
`guestIdentifier` (ad/telefon/e-posta) hiç çıkmaz.

---

## 7. Uygulama sırası

0. **KVKK bağlantısı ÖNCE tasarlanır** (§2b). Süpürgelere bağlanmamış bir metin
   kolonu üretime çıkarsa, o günden sonra yazılan her satır vaadi ihlal eder ve
   geriye dönük düzeltmek mümkün olmaz (metin zaten yazılmıştır).
1. `schema.prisma` + `migrate diff` ile m48 üret, taze PG'de `00→48` sıfır-drift
   doğrula. ⚠️ Migration SQL'i ELLE yazma.
2. Yazma satırları: model yolu (altı alan) + kelime yolu (`aiTriageSource:"keyword"`
   + damga, analiz alanları NULL)
3. Sonluluk kapısı (`Number.isFinite` + 0..1 clamp) ve güvenli JSON ayrıştırıcı —
   **okuma yüzeyinden ÖNCE**, çünkü yüzey onlara dayanıyor
4. İki KVKK süpürgesi + veri ihracı (§2b). Kanarya `String?`/`DateTime?`
   kolonlarında kırmızı verecek; `Float?`ta VERMEYECEK — o kararı elle yaz.
5. `/inbox` üstü triyaj bileşeni (deterministik, model YOK) + bayat rozeti (§3d)
6. Kapanışta temizleme (§3f) — status geçişine bağlı, cron DEĞİL
7. Testler, her biri mutasyon-doğrulanmış İKİ YÖNDE:
   · escalate → altı alan dolu · kelime yolu → analiz alanları NULL, source dolu
   · `NaN`/`Infinity`/`1.4` güven → NULL veya clamp (kapıyı kaldır → kırmızı)
   · bozuk `aiMissingInfoJson` → sayfa ÇİZİLİR ve `[]` döner (try/catch'i kaldır
     → kırmızı; bu testin KONTROLÜ geçerli JSON'ın gerçekten okunmasıdır, yoksa
     "her zaman []" mutasyonu da yeşil geçer)
   · KVKK: süre dolunca iki metin kolonu da NULL (parite testi zaten kümeleri
     karşılaştırıyor, biri unutulursa kırmızı)
   · bayat rozeti: tetikleyici mesaj değişince görünür, değişmeyince görünmez
8. Deploy → Railway `migrate deploy` otomatik koşar

**Geri alma:** okuma yüzeyini kaldır. Kolonlar NULL kalır, kimse okumaz, DROP gerekmez.

---

## 8. Bu turda BULUNAN AMA AYRI OLAN — panelde iki farklı "Acil"

Kullanıcı "acile aldım gene de acil olmuyor" dedi. Sebep ölçüldü:

- Konuşma sayfasındaki **Öncelik: Acil** → `Conversation.priority`, yalnız gelen
  kutusu listesinde bir rozet çiziyor (`inbox/page.tsx:341`). Başka hiçbir yeri
  beslemiyor.
- Paneldeki **"Acil Görevler"** kutucuğu → `Task` sayıyor (`reports.ts:96`),
  konuşmaları DEĞİL.

Yani aynı kelime iki ayrı şeyi anlatıyor ve host haklı olarak birinin diğerini
etkilemesini bekliyor. Çözüm ürün kararı: ya kutucuk konuşmaları da saysın, ya
konuşma önceliği kaldırılsın, ya da etiketler ayrıştırılsın ("Acil görev" /
"Öncelikli konuşma"). **Karar verilmedi.**
