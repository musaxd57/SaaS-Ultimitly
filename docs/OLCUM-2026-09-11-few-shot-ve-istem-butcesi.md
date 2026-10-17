# ÖLÇÜM — Few-shot prompting ve istem bütçesi (kurucu sorusu, 2026-09-11)

> Kurucu: *"Few-Shot Prompting mi yapıyoruz biz, bunda fazlalığımız varsa bunu raglara doğru
> yöneltelim diyorum."*
>
> Durum: **ÖLÇÜM + PLAN. Kod değişmedi.** Her sayı çalıştırılmış bir script'ten.

## CEVAP: EVET, yapıyoruz — ve fazlalık ÖLÇÜLDÜ

`src/lib/ai/prompts.ts:482-584` → **BÖLÜM 13 — ÖRNEKLER**: **24 tam girdi→çıktı örneği,
16.191 karakter.** Bloğun kendi başlığı zaten niyeti söylüyor: *"Aşağıdaki örnekler doğru
davranışı gösterir."*

| Ölçü | Değer |
|---|---|
| `REPLY_SYSTEM_PROMPT` toplam | **46.135 karakter** (53 KB) |
| Few-shot bloğu | **16.191 karakter = sistem isteminin %35,1'i** |
| Kurallar (BÖLÜM 1–12) | 29.944 karakter (%64,9) |
| Bir çağrının STATİK oranı (küçük KB) | **%96,4** (47.818 / 49.604) |
| Bu misafire/mülke ÖZGÜ içerik | **1.786 karakter (%3,6)** |
| **Few-shot ÷ dinamik içerik** | **9,1×** |
| Few-shot ÷ hibrit RAG bütçesi (`KB_RETRIEVAL_CHAR_BUDGET` 6.000) | **2,70×** |

Yani **misafirin sorusuna özgü her şeyden dokuz kat büyük** bir blok, her çağrıda gidiyor.

## 🚨 BELGEDEKİ "75 KB" RAKAMI YANLIŞ

`src/lib/ai/limits.ts:29` ve `prompts.ts:3-4` *"sistem istemi ~75KB"* diyor. 75 KB **dosyanın
tamamı** (88.641 bayt — çoğu Türkçe yorum). Sabitin kendisi **53 KB**. Bu rakama dayanan her
bütçe kararı %40 sapmalı.

## 🚨 BEŞ ÖRNEK MODELE SAHTE WI-FI ŞİFRESİ ÖĞRETİYOR

`"12345678"` ve `"LaleApt"` **24 örneğin 5'inde** geçiyor (ÖRNEK 1, 8, 11, 13, 24). Bu yeni bir
keşif DEĞİL — kod bunu zaten biliyor ve KODDA savunma yazılmış:

> `src/lib/automation.ts:1589-1590` ve `src/lib/guest-chat.ts:331-333`:
> *"önbellekli sistem önekindeki 24 few-shot örneğin BEŞİ wifi şifresini VEREREK gösteriyor"*

Yani rezervasyon-öncesi sır filtresi, **kendi istemimizin öğrettiği davranışı** temizlemek için var.

**Test kaplaması zayıf:** 24 örneğin yalnız **5'i** adıyla pinli (ÖRNEK 11/12/14 →
`ai-prompts.test.ts:100-102`, ÖRNEK 20 → `:59-60`, ÖRNEK 24 → `ai-multi-question.test.ts:113`).
**19 örnek hiçbir testle bağlı değil.**

## 🚨 EN BÜYÜK BULGU: RUSÇA ve ARAPÇA'da RETRIEVAL HİÇ ÇALIŞMIYOR

Hibrit bayrağı zorla açık, 9.245 karakterlik KB ile ölçüldü:

```
tr           detect=tr  fb=none             sel=3  → doğru 3 parça
en           detect=en  fb=none             sel=3  → doğru 3 parça
de           detect=en  fb=none             sel=3  → doğru (KAZA: "wlan" sözlükte)
fr           detect=fr  fb=none             sel=3  → doğru (KAZA: "checkout" normalleşiyor)
ru           detect=ru  fb=no_lexical_hits  sel=0  → TÜM KB gider
ar           detect=ar  fb=no_lexical_hits  sel=0  → TÜM KB gider
de "Wo sind die Handtücher?"  detect=en  fb=no_lexical_hits  sel=0  → TÜM KB gider
```

**Sebep:** `retrieval/lexicon.ts` 47 kavram / 302 terim / 111 `detectOnly` — **hepsi TR+EN**.
Kök sökücü (`retrieval/text.ts:103-119`) Türkçe ekler + `EN_SUFFIXES = {ing, ed, es, s}`.
Almanca/Kiril/Arapça için taramada yalnız `wlan` ve `klima` çıkıyor, ikisi de tesadüf.

**İkinci kusur:** `detectGuestLanguage` (`fallback.ts:1598-1611`) Almancayı **İngilizce
sanıyor** — `"Wie lautet das WLAN-Passwort?"` → `en`, `"Wo sind die Handtücher?"` → `en`, çünkü
`de` dalı `ich|sie|bitte|danke|hallo|ist |und |für |schön|grüße` listesinden birini arıyor. Bu
değer `select.ts:326` `queryIsTurkish`'e ve oradan n-gram kaynağına gidiyor.

⚠️ Yön GÜVENLİ (fail-open: tüm KB gider, bilgi kaybı yok) ama **hibrit bayrağının vaadi
Rusça/Arapça'da GEÇERSİZ** — orada legacy davranışı alıyoruz.

## İstemdeki kurallar %100 TÜRKÇE

46k karakterlik talimat setinin tamamı Türkçe; Alman/Rus/İngiliz misafirin mesajında da model
Türkçe talimat alıyor, yalnız CEVABI misafirin dilinde yazması iki satırla isteniyor
(`prompts.ts:256-260`, `:1092-1093`). Few-shot'ların yalnız 6.155/16.191 karakteri TR dışı.

🚨 **`input.language` alanı neredeyse dekoratif:** `"en"` ile `"tr"` arasında istem farkı
**−5 karakter** (yalnız `"(Sistem tercih dili: tr)"` parantezi). Ayrıca o alan misafirin
ALGILANAN dili değil, org ayarı — QR rotasında (`chat/[token]/route.ts:800`), Ayarlar testinde
ve landing demoda **sabit `"tr"`** yazılı.

## Prompt cache — sıralama DOĞRU, ama ÖLÇÜM YOK

`src/lib/ai/index.ts:148-155` system'i ÖNCE koyuyor → önbelleklenebilir önek ~47.533 karakter.
Kusur yok. **Ama** `cached_tokens` / `prompt_tokens` hiçbir yerde OKUNMUYOR (grep: 0 eşleşme;
`index.ts:184-194` yalnız `choices[0]`'ı okuyor). Yani *"önbelleklidir"* bir GÖZLEM değil
VARSAYIM — ve Lale hacminde (10 daire, 2 dk cron) çağrıların çoğu OpenAI'nin 5–10 dakikalık
otomatik pencere dışında kalabilir.

## Retrieval'a devredilebilecek STATİK bloklar (tetikleyicileri KODDA zaten var)

| Karakter | Blok | Ne zaman gerekli |
|---|---|---|
| **16.191** | BÖLÜM 13 — 24 örnek | her örneğin kendi başlığı tetikleyicisini söylüyor (kilitli kalma · öz-zarar · squatting · base64 · platform dışı ödeme · Arapça) |
| 3.020 | BÖLÜM 7.5 erken giriş/geç çıkış | yalnız `early_checkin`/`late_checkout`/beyan edilen saat |
| 743 | BÖLÜM 9 Kültürel Farkındalık | kendi metni dil-özel ("Arap misafirler için…") ama HER dile gidiyor |
| ~700 | KURAL-4 platform-dışı ödeme alt bloğu | yalnız para/IBAN mesajları (ÖRNEK 20'de İKİNCİ KEZ var) |
| 407 | BÖLÜM 7 Zaman Farkındalık | konaklama fazı zaten KODDA hesaplanıp `:934`'te enjekte ediliyor |

**Koşullu enjeksiyon deseni ZATEN VAR ve çalışıyor** — `offerBlock` (+1.383), `preBookingBlock`
(+873), `conflictBlock` (+804), `styleBlock` (+752), `adjacencyBlock` (+659), `activeStayBlock`
(+524), `openTopicsBlock` (+258), `conversationStateBlock` (+230). Yani mekanizma yazılmış,
yalnız en büyük bloğa uygulanmamış.

## Önerilen sıra (her adım ayrı ölçümle)

1. **Pinsiz 19 örneği daralt**, 5 pinliyi koru; `12345678`/`LaleApt`'i öğreten 5 örnekten sahte
   değeri çıkar. 🚨 Bu bir **gönderim hot-path'i istem değişikliğidir** → GOLDEN SET + eval ŞART.
   ⚠️ Few-shot bir DAVRANIŞ ÇAPASIDIR; komple silmek o sınıfta modeli serbest bırakır — daraltma
   ölçümle yapılır, tek hamlede değil.
2. **BÖLÜM 7.5 ve BÖLÜM 9'u koşullu enjeksiyona taşı** (`offerBlock` deseniyle; tetikleyiciler
   `countGuestAsks`, `findTimeConflicts`, `detectGuestLanguage` olarak zaten kodda).
3. **`cached_tokens` logla** — "önbellekli" iddiasını gözleme çevir (ücretsiz, yalnız `usage` okuma).
4. **Dil bazında RAG:** sözlüğe DE/RU/AR eklemek YETMEZ — kök sökücü de dil-özel. Önce
   `detectGuestLanguage`'ın Almanca kusuru (ucuz, deterministik), sonra dil başına terim seti.
   🚨 **Embedding'in en güçlü gerekçesi tam BURASI**: Rusça/Arapça'da sözcüksel eşleşme
   yapısal olarak yok; oysa bu sınıfta embedding'in katkısı ölçülebilir ve büyük olur.
5. `limits.ts:29` ve `prompts.ts:3-4`'teki **"75 KB" → 53 KB** düzeltilsin (bayat rakam).

## Ölçüm nasıl tekrarlanır

Script'ler: `<scratchpad>/{measure,m2,m3,m4}.ts`, çalıştırma
`./node_modules/.bin/tsx --tsconfig <scratchpad>/tsconfig.json` (path alias `@/*` +
`server-only` → `tests/stubs/server-only.ts`). DB'siz, ağsız.
⚠️ `node_modules`'da tokenizer YOK → token sayıları 2,5–4,0 karakter/token aralığından TÜRETİLMİŞ
(Türkçe kötü uçta): ~11,5k–18,5k token. Karakter sayıları ÖLÇÜLMÜŞ, token sayıları TAHMİN.
