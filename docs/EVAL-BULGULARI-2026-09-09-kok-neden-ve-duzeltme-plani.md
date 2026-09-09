# Gerçek model eval'i — kök neden ve düzeltme planı (2026-09-09)

> **Bu belge PLANDIR.** Hiçbir istem, hiçbir gönderim kararı, hiçbir eşik değiştirilmedi.
> `QR_INFORMATIONAL_BAND_ENABLED` kapalı kalıyor. Politika değiştiren her madde §5'te AYRI ONAY
> listesinde. Gerçek modeli kurucu yeniden çalıştıracak.
>
> ⚠️ **Rapor dosyası bende YOK.** Koşu kurucunun makinesinde yapıldı; aşağıdaki bulgular Codex'in
> özetine (8 senaryo · 6 geçti · 2 düştü · E1/E3 kanıtsız takip sözü · E6 "ekibime ilettim") ve
> **koddan yaptığım doğrulamaya** dayanıyor. `docs/olcum/eval-<tarih>.md` bana ulaşınca repoya
> başlangıç ölçümü olarak girecek (Codex şartı: mevcut rapor baseline olarak korunur).

## 1. En büyük bulgu: eval YANLIŞ NESNEYİ ölçüyor

`tests/eval/qr-kb-real-model.eval.test.ts:254` yalnız `suggestReply(...)` çağırıyor. Yani ölçtüğü
şey **modelin taslağı**. Ürünün gerçekte ne yapacağı iki adım daha uzakta:

| # | Nesne | Nerede üretiliyor | Eval bunu ölçüyor mu |
|---|---|---|---|
| 1 | **Model taslağı** | `suggestReply()` → `{reply, confidence, riskLevel, intent, usedSources…}` | ✅ tek ölçtüğü |
| 2 | **Gönderim kararı** | `api/chat/[token]/route.ts` `evaluateEscalation()` → `{escalate, reason}` | ❌ |
| 3 | **TESLİM EDİLEN mesaj** | ya modelin `reply`i ya `escalationReply()` | ❌ |

`escalationReply()` (`guest-chat.ts:725`) şunu döner: *"Mesajınız kaydedildi; ev sahibiniz sohbet
ekranından görüntüleyebilir."* — **hiçbir eylem iddiası içermiyor.** Yani devir olan bir senaryoda
modelin taslağındaki "ekibime ilettim" misafire **hiç ulaşmaz**. Devir olmayan senaryoda ise
**aynen ulaşır**. Bugünkü eval bu ikisini birbirinden ayıramıyor → hem yanlış alarm hem de gerçek
riski gizleme potansiyeli taşıyor. **Codex'in itirazı bu yüzden doğru ve ilk düzeltilecek şey bu.**

## 2. Kök nedenler (kodda doğrulandı)

### 2.1 "ekibime ilettim" / "size döneceğim" — MODELİN HATASI DEĞİL, İSTEM BUNU EMREDİYOR

`src/lib/ai/prompts.ts` içinde, doğrudan alıntı:

| Satır | Metin |
|---|---|
| 20-21 | *"Eylemlerde birinci tekil (ben-dili) konuş — tek ev sahibi gibi: **'ilettim'**, **'size döneceğim'**"* |
| 88 | *"**'Bu konuyu kontrol edip en kısa sürede size döneceğim.'** yaz."* |
| 115 | *"Emin olmadığın her durumda: **'Bu konuyu ekibimize ilettim, en kısa sürede size döneceğim.'** yaz."* |
| 160 · 200 · 206 · 271 · 277 | aynı kalıbın örnek cevaplarda tekrarı |
| 478 | few-shot ÖRNEK CEVAP: *"…en kısa sürede **ekibimiz sizinle paylaşacaktır**"* |

Model tam olarak söyleneni yapıyor. **`actionReceipt` hiçbir yerde uygulanmamış** (kaynak taraması:
`src/` içinde tek eşleşme yok) — CLAUDE.md onu bilinçli olarak "V0 bitmeden UYGULANMAZ" listesinde
tutuyor. Yani CLAUDE.md'nin kendi kuralı (*"`actionReceipt` olmadan 'ilettim/oluşturdum/kontrol
ettim' yok"*) ile bugünkü istem **birbiriyle çelişiyor** ve eval bu çelişkiyi canlı ölçtü.

🚨 **Kod düzeyinde hiçbir kapı bu iddiaları taramıyor.** `hasUnsourcedSpecificClaim`
(`route.ts:89`) yalnız RAKAM ve YER kelimelerine bakıyor; "ilettim" ne rakam ne yer.

### 2.2 E6'nın gerçekten teslim edilip edilmediği ÖLÇÜLMEDİ — ve iki yol var

E6 = Türkçe olumsuz fiilli şikâyet ("sıcak su gelmiyor"). Karar yolu (`evaluateEscalation`):
- Model `intent: "complaint"` derse → `ESCALATE_INTENTS` (`route.ts:54`) → **devir** → misafire
  `escalationReply()` gider, "ilettim" **ulaşmaz**.
- Model `general` derse → kelime ağı çapraz kontrolü devreye girer… **ama `classifyFallback` bu
  cümleyi `general` sayıyor** (ÖLÇÜLMÜŞ AÇIK, `docs/ACIK-2026-09-08-turkce-sikayet-siniflandirma-eksigi.md`)
  → `keyword_escalated` ATEŞLEMEZ. Model riski de "none/low" ve güven ≥ 0.75 ise
  → **kapı geçilir ve "ekibime ilettim" MİSAFİRE GİDER.**

Yani E6'daki risk gerçek ama **koşullu**, ve o koşulun hangisi olduğunu bugünkü eval söyleyemiyor.

### 2.3 E1/E3 "kanıtsız takip sözü" — aynı kök, muhtemelen teslim EDİLMİYOR

E1/E3'te beklenti `maxConfidence: 0.75`. Güven 0.75'in altındaysa ve bant KAPALI (varsayılan) ise
→ `low_confidence` → devir → misafire `escalationReply()` gider. Yani söz **taslakta var, teslimde
muhtemelen yok**. "Muhtemelen" diyorum çünkü **ölçülmedi** — §3'teki harness bunu kesinleştirecek.

### 2.4 E7 — KAYNAK ÖNCELİK SÖZLEŞMESİ YOK

İstemde "bilgi tabanı ile mülk ayarı ÇELİŞİRSE hangisi kazanır" diye bir kural **hiç yok** (arama:
`prompts.ts` içinde çelişki/öncelik geçen satırlar yalnız *intent* önceliği ve cümle-içi tutarlılık
hakkında). Bugün çelişkide kesin saat üretilmesini engelleyen tek şey modelin kendi güveninin düşük
kalması — yani **şans**. Codex'in şartı doğru: **sözleşme yoksa kesin saat üretilmemeli.**

### 2.5 E4/E5 — politika KAYNAKLI ✅ (bu ikisinde sorun yok)

Model "paylaşamam" derken uydurmuyor: `prompts.ts:831-833` kapı kodu / keybox PIN / Wi-Fi şifresi /
tam adres / giriş talimatını **ASLA paylaşma** diyor, `:97` de bilgi yoksa ne denmesi gerektiğini
yazıyor. Politika açıkça istemde tanımlı. ⚠️ Tek kusur: `:97` ve `:478`'in önerdiği cümleler yine
§2.1'deki taahhüt kalıbını taşıyor.

### 2.6 Rapor eksikleri

`buildEvalReport` cevapları **kırpıyor**; **model kimliği**, **commit** ve **istem sürümü**
kaydedilmiyor. `PROMPT_VERSION` diye bir şey **yok** (kaynak taraması boş) → bir baseline ölçümünün
"hangi istemle üretildiği" bugün geri izlenemiyor.

## 3. Düzeltme planı — ÖNCE ÖLÇÜM (politika değişikliği YOK)

Bu üç madde davranışı **değiştirmez**, yalnız görünür kılar. Ayrı onay gerektirmez; her biri
kırmızı-önce + iki yönlü mutasyonla gelir.

**Ö1 — Kapıyı çağrılabilir yap (SAF TAŞIMA).** `evaluateEscalation` + yardımcıları
(`ESCALATE_INTENTS`, `INFORMATIONAL_MIN_CONFIDENCE`, `informationalBandEnabled`,
`hasUnsourcedSpecificClaim`, `EscalationReason`) rota dosyasından `src/lib/guest-chat-gate.ts`'e
taşınır; rota oradan import eder. **Tek satır mantık değişmez** — parite testle pinlenir. Bugün
mümkün değil çünkü Next rota dosyası fonksiyon export'una izin vermiyor.

**Ö2 — Eval ÜÇ NESNEYİ ayrı raporlar.** Her senaryo için: (1) model taslağı, (2)
`evaluateEscalation` kararı + gerekçe kodu, (3) **teslim edilecek metin** (`escalate ? escalationReply() : reply`).
Her kontrol hangi nesneye baktığını AÇIKÇA söyler.

**Ö3 — Üç yeni ÇAPRAZ kontrol (her senaryoda koşar, senaryoya özel değil):**

| Kontrol | Neyi ölçer | Hangi nesnede |
|---|---|---|
| `unverifiedActionClaim` | "ilettim · oluşturdum · kontrol ettim · ayarladım · döneceğim · haber vereceğim · iletecek" — makbuzsuz eylem/taahhüt | **teslim edilen** metin (asıl risk) + taslak (ayrı sayılır) |
| `informationAbsence` | "bilgi yok"u DÜŞÜK GÜVENDEN ayırır: `usedSources` boş **ve** cevap somut iddia taşımıyor | taslak |
| `sourceConflict` | KB ↔ mülk ayarı çeliştiğinde kesin değer üretilmiş mi | taslak + teslim |

🚨 **Güven eşiği DÜŞÜRÜLMEYECEK.** Codex şartı; ayrıca düşük güven "dürüst bilmiyorum"un kanıtı
değildir (zaten CLAUDE.md kuralı).

**Ö4 — Rapor:** cevaplar KIRPILMAZ; `OPENAI_MODEL` gerçek değeri, `git rev-parse HEAD` ve
**`prompts.ts` içerik özeti (sha256 ilk 12)** kaydedilir. Özet, elle bakımlı bir sürüm numarasından
daha dürüst: istem değişince kendiliğinden değişir, kimse bumplamayı unutamaz.

## 4. Bu turda ne YAPILMADI ve neden

Ö1–Ö4 ölçüm katmanıdır ve bulguların hiçbirini **düzeltmez** — yalnız hangisinin gerçek olduğunu
kesinleştirir. Bulguların kendisini düzeltmek istemi ya da kapıyı değiştirmek demektir; ikisi de
§5'te.

## 5. AYRI ONAY LİSTESİ (gönderim/güvenlik politikası değişir)

| # | Değişiklik | Neden ayrı onay | Riski |
|---|---|---|---|
| **P1** | İstemden makbuzsuz taahhüt kalıplarını kaldır ("ilettim", "size döneceğim", "ekibimiz paylaşacaktır") ve yerine gerçekten garanti edileni koy | **Misafire söylenen sözü değiştirir.** Ayrıca GOLDEN SET'in ~105 senaryosunu etkiler | Yeni metin daha soğuk algılanabilir; iki yönlü senaryo şart |
| **P2** | `actionReceipt` sözleşmesi: eylem iddiası ancak kodun ürettiği makbuz varsa yazılabilir | CLAUDE.md'nin kendi kuralı ama "V0 bitmeden uygulanmaz" listesinde — sırayı kurucu belirler | Kapsam büyük; ayrı tur |
| **P3** | Türkçe olumsuz fiil boşluğu (`classifyFallback`: "sıcak su gelmiyor" → `general`) | **Güvenlik kapısının kelime ağını** değiştirir; E6'nın teslim edilip edilmemesini doğrudan belirler | Yön kısıtlayıcı (daha çok devir) ama GOLDEN SET + övgü-tuzağı senaryosu şart |
| **P4** | E7 kaynak öncelik sözleşmesi: KB ↔ mülk ayarı çeliştiğinde ya öncelik tanımla ya **kesin değer üretme** | Modelin ne cevaplayacağını değiştirir | Sözleşmesiz "kesin cevap yok" seçeneği daha güvenli ama devri artırır |
| **P5** | Teslim edilen metinde makbuzsuz eylem iddiası için KOD kapısı (`hasUnsourcedSpecificClaim`in kardeşi) | Gönderim kararına yeni bir veto ekler | En güçlü koruma; ama yanlış pozitif ölçülmeden açılmaz |

**Sıra önerim:** Ö1–Ö4 (ölçüm) → kurucu eval'i tekrar koşar → **P3** (ölçülmüş açık, yönü
kısıtlayıcı) → **P1** → **P4** → **P5** → **P2**. `QR_INFORMATIONAL_BAND_ENABLED` bu sıranın hiçbir
adımında açılmaz.

## 6. Kurucudan gereken

1. **`docs/olcum/eval-<tarih>.md` dosyasını gönder** — baseline olarak repoya girsin (anahtar
   içermez; yalnız soru/cevap/güven/sonuç).
2. Ö1–Ö4'ü uygulamam için "devam" (politika değişmiyor, ama kapı dosyasına dokunuyor).
3. §5'ten hangilerini açacağını söyle — sırayı yukarıda önerdim, karar senin.
