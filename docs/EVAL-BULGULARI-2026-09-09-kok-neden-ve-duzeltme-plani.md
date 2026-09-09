# Gerçek model eval'i — kök neden ve düzeltme planı (2026-09-09)

> **Bu belge PLANDIR.** Hiçbir istem, hiçbir gönderim kararı, hiçbir eşik değiştirilmedi.
> `QR_INFORMATIONAL_BAND_ENABLED` kapalı kalıyor. Politika değiştiren her madde §5'te AYRI ONAY
> listesinde. Gerçek modeli kurucu yeniden çalıştıracak.
>
> ⚠️ **Orijinal rapor dosyası bende YOK.** Elimde Codex'in ilettiği ÖZET var; bunu üretilmiş dosya
> gibi sunmuyorum ve eksik kısımlarını TAHMİN ETMİYORUM. Bilinen sınırlar: eski raporda bazı
> cevaplar zaten **kırpılmış** ve model alanı yalnız **"varsayılan"** yazıyor (gerçek model kimliği
> kayıtlı değil). `docs/olcum/eval-<tarih>.md` ulaşınca repoya baseline olarak girecek.

## 0. BASELINE ÖZETİ (kurucu koşusu, 2026-09-09, `a52a30c`)

8/8 tamamlandı · **6 geçti, 2 düştü** · geçersiz 0 · kayıt yok 0.

| # | Modelin taslağı (aynen) | Güven | Kaynak |
|---|---|---|---|
| E1 | "Merhaba, otopark ile ilgili detayları kontrol edip en kısa sürede size dönüş yapacağım." | **0.8** | **0/0** |
| E6 | "Bunun için özür dileriz. Sıcak suyla ilgili durumu hemen ekibime ilettim, en kısa sürede kontrol edip size döneceğim." | 0.9 | 0/0 |
| E7 | "Merhaba, çıkış saatimiz 11:00." | **0.95** | 1/1 |

## 0.1 🚨 ÖNCEKİ DEĞERLENDİRMEM TERSTİ — ÖLÇÜLDÜ VE DÜZELTİLDİ

İlk turda "E6 riskli, E1/E3 muhtemelen teslim edilmiyor" demiştim. **Yanlıştı.** Baseline'daki
güven değerleri gelince gerçek rotaya karşı ölçtüm
(`tests/integration/qr-draft-vs-delivered.test.ts`, model mock'lu, kapı GERÇEK, 4/4 geçti):

🚨 **KANITIN SINIRI (Codex düzeltmesi):** baseline raporunda **`intent` ve `risk` alanları YOKTU** —
rapor yalnız cevabı, güveni ve kaynak sayısını taşıyordu. Kapının kararı ise tam da o eksik alanlara
bakıyor. Testte bu değerleri **ben seçtim** (`ASSUMED` bloğu, dosyada açıkça ilan ediliyor). Yani
aşağıdaki tablo **koşulludur**: "model bu alanları şu değerlerle döndürürse ürün şunu yapar."
Ö4 ile eval raporuna intent/riskLevel/riskType eklendi → **bir sonraki gerçek koşu bu varsayımları
gerçek değerlerle değiştirecek.**

| # | Raporlanan | Varsayılan | Ürünün cevabı taslak mı | Sonuç |
|---|---|---|---|---|
| **E6** | cevap · güven 0.9 · kaynak 0/0 | `intent: complaint` | **HAYIR** | ✅ *Eğer* intent `complaint` ise `ESCALATE_INTENTS` → devir → "ekibime ilettim" **gitmiyor**. Model `general` deseydi bu dal çalışmazdı **ve** `classifyFallback` "sıcak su gelmiyor"u ölçülmüş olarak `general` sayıyor → kelime ağı da tutmazdı |
| **E1** | cevap · **güven 0.8** · **kaynak 0/0** | `intent: parking`, risk yok | **EVET** | ❌ Karar veren alan **raporlanan güven**: 0.8 ≥ 0.75 → kapı geçiyor, **sıfır kaynakla verilen taahhüt ürünün cevabında** |
| **E7** | cevap · **güven 0.95** · kaynak 1/1 | `intent: checkout`, risk yok | **EVET** | ❌ **kesin saat** çıkıyor, oysa kaynak öncelik sözleşmesi yok |

E1 ve E7'de sonucu belirleyen alan (güven) **raporlanmıştı**, yani bu ikisinin kanıtı daha güçlü;
E6'nınki tamamen varsayılan `intent`e bağlı.

Aynı E1 taslağı güven 0.6'ya çekilince ürün **devrediyor** ve söz gitmiyor — yani *"kanıtsız söz
misafire ulaşır mı"* sorusunun cevabı **taslakta değil KAPIDA**. Düşen 2 senaryo (E1, E7) tam da
kapının korumadığı ikisi; E6 çirkin bir taslak ama kapı onu tutuyor.

⚠️ Bu bir TEST ORTAMI ölçümüdür: "ürünün döndürdüğü cevap" diyorum, "gerçek misafire teslim edildi"
DEMİYORUM.

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

Yani E6'daki risk gerçek ama **koşullu**, ve o koşulu belirleyen alan (`intent`) baseline raporunda
**YOKTU** — bu yüzden §0.1'deki E6 satırı bir ÖLÇÜM değil, VARSAYIMA bağlı bir dal analizidir.

### 2.3 E1 "kanıtsız takip sözü" — ~~muhtemelen teslim edilmiyor~~ → **ÜRÜNÜN CEVABINDA** (ölçüldü)

İlk yazdığım buydu: *"güven 0.75 altındaysa devir olur, söz muhtemelen gitmez."* **Raporlanan güven
0.8 çıktı** — yani eşiğin ÜSTÜNDE. Kapı geçiyor ve söz ürünün cevabına giriyor (§0.1, ölçüldü).
Buradaki dersi ayrıca not ediyorum: *"eşiğin altındadır herhalde"* bir ölçüm değildi ve yanlış
çıktı; karar veren sayı raporda zaten vardı, ben ona bakmadan yorum yapmıştım.

### 2.4 E7 — ~~KAYNAK ÖNCELİK SÖZLEŞMESİ YOK~~ → **VAR, ben görememişim (düzeltme 09-09, P4 turu)**

İlk yazdığım yanlıştı: sistem istemini (`REPLY_SYSTEM_PROMPT`) taramış, **kullanıcı istemini**
(`buildReplyUserPrompt`) taramamıştım. Orada açık bir kural var:

> *"ÖNCELİK: Check-in/check-out SAATİ için YUKARIDAKİ mülk bilgisi esastır — bilgi tabanında farklı
> bir saat geçse bile bu saatleri kullan (saat için tek doğru kaynak burasıdır)."*

Yani E7'de model 0.95 güvenle "11:00" derken **uydurmuyordu, tanımlı kuralı uyguluyordu** (mülk
ayarı 11:00). Sonuçları:
- Eval E7'nin beklentisi (`maxConfidence: 0.75`, "kesin cevap verilmemeli, insana devir") ile
  **yayındaki sözleşme çelişiyor**. O beklentiyi 09-08'de "sözleşme yok" varsayımıyla ben yazdım;
  kurucu "çelişkide devir" diye bir karar **vermedi**. Bu bir **ürün kararıdır (P4-b)**, testi
  düzeltmek ya da davranışı sessizce çevirmek değil.
- P4'ün onaylı hâli ("öncelik yoksa icat etme") burada "var olanı KORU" demek. Uygulanan dilim:
  çelişkiyi **kodda tespit** edip (`findTimeConflicts`, yalnız giriş/çıkış saati) modele ve ev
  sahibine (missingInfo/actionSuggestion) görünür kılmak; misafire giden saat mevcut kuralla aynı
  kalır; üçüncü saat uydurulmaz; "kesinlikle/her zaman" pekiştirmesi yasaklanır.
- Kalan tek gerçek boşluk: giriş/çıkış saati DIŞINDAKİ olgular (Wi-Fi adı, otopark ücreti vb.)
  için hâlâ hiçbir öncelik kuralı yok — o da P4-b'nin kapsamına girer.

### 2.5 E4/E5 — YASAK kaynaklı, ama YANINDAKİ VAAT değil (Codex düzeltmesi)

İlk yazdığımda "sorun yok" demiştim; **fazla cömertti.** Ayrım şu: *paylaşmama* kuralı kaynaklıdır,
*paylaşılacağı vaadi* değildir. Tam cümleler:

| Satır | Tür | Metin |
|---|---|---|
| `:832-833` | **YASAK — kaynaklı ✅** | "Kapı kodu, keybox/PIN, Wi-Fi şifresi, tam açık adres ve giriş talimatlarını **ASLA paylaşma** — bilgi tabanında yazıyor olsa bile." |
| `:833-834` | **VAAT — kanıtsız ❌** | "…bu bilgiler yalnızca onaylı rezervasyon sonrasında, **girişten önce paylaşılır**." |
| `:97` | **VAAT — kanıtsız ❌** | "Bilgi tabanında yoksa: **'Giriş bilgilerinizi/şifreyi check-in öncesi ayrıca paylaşacağız.'**" |
| `:100` | **VAAT — kanıtsız ❌** | "…sonra **'size net yol tarifini ekibimiz iletecek'** de." |

Yani model E4/E5'te doğru davranıp sırrı vermiyor, **ama yerine koyduğu cümle bir SÜREÇ TAAHHÜDÜ**
ve onu garanti eden hiçbir mekanizma yok — §2.1'deki "ilettim" ile aynı sınıf. `:832`'nin kapsamı
ayrıca **onaylanmamış rezervasyon** dalı; QR'daki onaylı konaklamada geçerli kural `:96-97`.

### 2.6 Rapor eksikleri

`buildEvalReport` cevapları **kırpıyor**; **model kimliği**, **commit** ve **istem sürümü**
kaydedilmiyor. `PROMPT_VERSION` diye bir şey **yok** (kaynak taraması boş) → bir baseline ölçümünün
"hangi istemle üretildiği" bugün geri izlenemiyor.

## 3. Düzeltme planı — ÖNCE ÖLÇÜM (politika değişikliği YOK)

Bu üç madde davranışı **değiştirmez**, yalnız görünür kılar. Ayrı onay gerektirmez; her biri
kırmızı-önce + iki yönlü mutasyonla gelir.

**Ö1 — ~~Kapıyı taşı~~ → GERÇEK ROTAYI KULLAN. ✅ YAPILDI.**
İlk taslağımda `evaluateEscalation`'ı `lib/guest-chat-gate.ts`'e taşımayı önermiştim. **Codex
reddetti ve haklı:** gönderim/güvenlik kodunun taşınması bile otomatik yetkinin dışında, ayrı
onayda kalmalı. Taşımaya gerek de yokmuş — `tests/integration/qr-draft-vs-delivered.test.ts`
**gerçek rotayı** (`POST /api/chat/[token]`) çağırıp modeli mock'luyor, böylece kapı olduğu yerde
kalıyor ve karar + çıkan metin yine ölçülüyor. Ürün kodunda **tek satır değişmedi**.
🚨 Bu bir KARAKTERİZASYON testidir: bugünkü davranışı sabitler, P1/P4/P5 uygulandığında hangi
satırın değiştiğini tek bakışta gösterir.

**Ö2 — Eval ÜÇ NESNEYİ ayrı raporlar.** Her senaryo için: (1) model taslağı, (2)
`evaluateEscalation` kararı + gerekçe kodu, (3) **teslim edilecek metin** (`escalate ? escalationReply() : reply`).
Her kontrol hangi nesneye baktığını AÇIKÇA söyler.

**Ö3 — Üç çapraz dedektör. ✅ YAPILDI** (`tests/helpers/claim-detectors.ts`):

| Fonksiyon | Neyi ölçer |
|---|---|
| `unverifiedActionClaims` | İKİ SINIF AYRI: `past_action` ("ilettim/oluşturdum/kontrol ettim" — olmuş gibi anlatır) · `future_commitment` ("döneceğim/iletecek/paylaşacağız" — söz verir) |
| `looksLikeInformationAbsence` | "bilgi yok"u DÜŞÜK GÜVENDEN ayırır — kaynak sayısından okunur, güvenden DEĞİL (baseline E1: güven 0.8, kaynak 0/0 → yüksek güven bilgi varlığını kanıtlamıyor) |
| `assertsDefiniteValue` | Çelişkili kaynakta kesin değer (saat kalıbı / "kesinlikle") üretilmiş mi |

🚨 **BİLEREK `tests/` ALTINDA, `src/` DEĞİL.** Bunları ürün koduna koymak, gönderim kararına yeni
bir veto eklemenin ilk adımı olurdu — o da P5, ayrı onayda. Amaç davranışı değiştirmek değil,
bugünkü davranışı görünür kılmak. `unverifiedActionClaims` makbuz parametresi ALMIYOR: alsaydı
olmayan bir mekanizmayı (`actionReceipt`) varmış gibi gösterirdi.

🚨 **Güven eşiği DÜŞÜRÜLMEYECEK.** Codex şartı; ayrıca düşük güven "dürüst bilmiyorum"un kanıtı
değildir (zaten CLAUDE.md kuralı).

**Ö4 — Rapor kanıt zinciri. ✅ YAPILDI** (gerçek model çağrısı YAPILMADAN test edildi):
· cevaplar **KIRPILMAZ** (ayrı "Tam cevaplar" bölümü) · **karar girdileri** (intent/riskLevel/
riskType) tabloda — ölçülmemiş alan `—` yazar, `none` diye UYDURULMAZ · **istenen model** ile
**sağlayıcının bildirdiği model AYRI SATIR**: `suggestReply` yanıtın model kimliğini çağırana
döndürmüyor → rapor açıkça **"KAYDEDİLMEDİ"** yazar (eski rapor tek alana "(varsayılan)" yazıyordu
ve bu, ölçülmemiş bir şeyi ölçülmüş gibi gösteriyordu) · **commit** · **`prompts.ts` parmak izi**
(sha256/12 — elle bumplanmaz, unutulamaz) · **koşu kimliği** · **aynı gün ikinci koşu öncekini
EZMEZ** (`pickReportFileName`).
Üç mutasyon, üçü de yakalandı: kırpmayı geri getir → "KIRPILMAZ" düştü · aynı adı hep döndür →
"EZMEZ" düştü · kaydedilmeyeni "(varsayılan)" yaz → model-ayrımı testi düştü.

## 4. Bu turda ne YAPILMADI ve neden

Ö1–Ö4 ölçüm katmanıdır ve bulguların hiçbirini **düzeltmez** — yalnız hangisinin gerçek olduğunu
kesinleştirir. Bulguların kendisini düzeltmek istemi ya da kapıyı değiştirmek demektir; ikisi de
§5'te.

## 5. AYRI ONAY LİSTESİ (gönderim/güvenlik politikası değişir)

| # | Değişiklik | Ölçülmüş dayanak | Neden ayrı onay |
|---|---|---|---|
| **P1** | İstemden makbuzsuz taahhüt kalıplarını kaldır ("ilettim", "size döneceğim", "ekibimiz iletecek", "check-in öncesi paylaşacağız") | **E1 ölçüldü: kapı geçiliyor, söz ürünün cevabında** | Misafire söylenen sözü değiştirir; GOLDEN SET'in ~105 senaryosunu etkiler |
| **P4** | E7 kaynak öncelik sözleşmesi: KB ↔ mülk ayarı çeliştiğinde ya öncelik TANIMLA ya **kesin değer ÜRETME** | **E7 ölçüldü: 0.95 güvenle kesin saat çıkıyor, sözleşme yok** | Modelin ne cevaplayacağını değiştirir |
| **P5** | Ürünün cevabında makbuzsuz iddia için KOD kapısı (`tests/helpers/claim-detectors.ts` ürün koduna taşınır) | E1'de `hasUnsourcedSpecificClaim` **yapısal olarak yakalayamaz**: yalnız rakam/yer arar VE yalnız 0.45–0.75 bandının içinde çalışır — 0.8'de hiç danışılmaz | Gönderim kararına YENİ VETO ekler; yanlış pozitif ölçülmeden açılmaz |
| **P3** | Türkçe olumsuz fiil boşluğu (`classifyFallback`: "sıcak su gelmiyor" → `general`) | E6 bu turda **modelin `complaint` demesi sayesinde** tutuldu — yani koruma kelime ağından değil MODELDEN geldi; model bir gün "general" derse boşluk açılır | Güvenlik kapısının kelime ağını değiştirir; GOLDEN SET + övgü-tuzağı senaryosu şart |
| **P2** | `actionReceipt` sözleşmesi | P1 metni değiştirir, P2 mekanizmayı kurar | CLAUDE.md'de "V0 bitmeden uygulanmaz"; sırayı kurucu belirler |

**Sıra önerim DEĞİŞTİ** (ölçüm sonrası): **P1 → P4 → P5 → P3 → P2**. Gerekçe: P1 ve P4 bugün
GERÇEKTEN misafire çıkan iki kusuru kapatıyor; P3'ün koruduğu senaryoyu ise bu turda model zaten
tuttu, yani aciliyeti daha düşük (ama boşluk gerçek ve kapanmalı).
`QR_INFORMATIONAL_BAND_ENABLED` hiçbir adımda açılmaz.

## 6. Kurucudan gereken

1. **`docs/olcum/eval-<tarih>.md` dosyasını gönder** — baseline olarak repoya girsin. Özet
   yeterliydi ve ölçümü engellemedi, ama orijinal dosya bende yok ve tahmin etmiyorum.
2. **§5'ten hangilerini açacağın** — önerim P1 → P4 → P5 → P3 → P2. Karar senin.
3. Ö4 (rapor: kırpma yok + gerçek model kimliği + commit + istem parmak izi) **kaldı**; bir sonraki
   turda yapılabilir, gerçek model çağrısı gerektirmiyor.

## 7. Bu turda yapılan / yapılmayan

**Yapıldı (davranış DEĞİŞMEDİ):** Ö1 (gerçek rota ölçümü, kapı taşınmadı) · Ö3 (üç dedektör,
`tests/` altında) · Ö4 (rapor kanıt zinciri) · §0.1'in İKİ düzeltmesi: (a) önceki değerlendirmem
terstiydi, (b) kanıt KOŞULLU — intent/risk raporda yoktu, varsayıldı.
**Yapılmadı:** P1–P5'in hiçbiri. Gerçek model çağrısı YAPILMADI.
**Dokunulmayanlar:** istem · gönderim kararı · eşikler · bayraklar · migration · şema · prod/env.
