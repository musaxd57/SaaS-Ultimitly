# KURAL-5 KALDIRMA — "model o paragrafı ÜRETMESİN" (kurucu, 2026-09-11)

> Durum: **PLAN.** Kod değişmedi. Bu bir **gönderim hot-path'i istem değişikliğidir** →
> GOLDEN SET + iki yönlü senaryo + gerçek eval ŞART (CLAUDE.md kuralı).

## Kurucunun cümlesi

> *"misafire kural 5 gibi bir cevap gitmemeli kesinlikle 3 cümlesi de saçma bu arada devir
> mesajında bile böyle yazıcaksa yazmasın aq — `Emin olmadığın her durumda: "Bu konuda kayıtlı
> bilgim yok; mesajınız kaydedildi, ev sahibiniz görebilir."` bu ne aq"*
>
> ve ayrıca: *"AI'ımız sus pus olmasın aq adamlar para ödeyecek konuşması lazım bi zahmet, her
> bokta bırakmasın."*

## Kurucu HAKLI — ve benim 09-11'deki gerekçem yarım doğruydu

09-11 turunda "istem kuralı KALDIRILMADI, çünkü silinirse model UYDURUR" dedim. Bu **ikili bir
yanlış varsayımdı**: tek seçenek "o paragrafı yaz" ya da "uydur" değil. **Üçüncü ve doğru seçenek:
modele GERÇEĞİ söylemek** — "temellendiremiyorsan cevabı ÜRETME, güveni düşür; ürün konuyu ev
sahibine devredecek ve misafir teslim makbuzunu alacak."

Uydurma yasağı (KURAL-1) **kalır**. Kalkan şey, modele ezberletilen **hazır 3 cümlelik paragraf**.

## Bugün istem o cümleyi BEŞ yerde emrediyor (ölçüldü)

| Yer | Ne yapıyor |
|---|---|
| `prompts.ts:21` | "bu konuda bilgim yok" demeyi meşru örnek olarak anıyor |
| `prompts.ts:76` | Çatışma örneği: "nezaketle bilgin olmadığını söyle (…)" — cümleyi AYNEN veriyor |
| `prompts.ts:91` | KURAL-1 sonu: "…en ufak şüphe varsa: `"Bu konuda kayıtlı bilgim yok; …"` yaz." |
| `prompts.ts:121` | **KURAL-5 [BELİRSİZLİKTE GÜVENLİ KAÇIŞ]** — "Emin olmadığın HER durumda … yaz." |
| `prompts.ts:494` | 🚨 **ÖRNEK 2 few-shot'ı** — modele o cevabı `confidence: 0.6` ile ÖĞRETİYOR |

Yani cevap modelin hatası değil, **istemin talimatı**. 09-11 kapısı (`src/lib/ai/absence.ts`) o
metni misafire ulaşmadan durduruyor — ama model onu üretmeye devam ediyor, yani her böyle mesajda
bir OpenAI çağrısı yanıyor ve sonuç çöpe gidiyor.

## Değişiklik (önerilen)

1. **KURAL-5 yeniden yazılır** — hazır cümle yerine DAVRANIŞ:
   > *Temellendiremediğin bilgiyi UYDURMA. Böyle bir durumda cevabı TEK kısa cümlede tut, hiçbir
   > somut şey (saat, rakam, kod, yer tarifi) iddia etme ve `confidence` değerini 0.4'ün ALTINA
   > yaz. Ürün o cevabı misafire göndermez; konuyu ev sahibine devreder ve misafir teslim
   > makbuzunu alır. "Bilgim yok / kaydım yok" gibi bir açıklama YAZMA — misafirin işine yaramaz.*
2. `:91` ve `:76`'daki aynı cümle aynı biçimde nötrleştirilir (çapa "UYDURMA", metin değil).
3. 🚨 **ÖRNEK 2 few-shot'ı DEĞİŞTİRİLİR**, silinmez: few-shot bir davranış çapasıdır; silinirse
   model o sınıfta serbest kalır. Yeni örnek aynı girdiye **kısa + iddiasız + düşük güvenli** bir
   çıktı gösterir.
4. `:21`'deki anma düzeltilir.

## Ne DEĞİŞMEZ

- **KURAL-1 uydurma yasağı** — aynen.
- **`src/lib/ai/absence.ts` kapısı** — aynen (kemer + askı: istem dürüst davranır, kapı yine de
  bakar; bir gün model yine yokluk cümlesi yazarsa misafire gitmez).
- Eşik `0.75`, gate mantığı, `unsourced_claim`, dar bant — **hiçbiri**.

## 🚨 BEKLENEN YAN ETKİ ve onu karşılayan iş

Bu değişiklik **devir SAYISINI ARTIRMAZ** (bugün de o cevaplar kapıda duruyor) ama kurucunun asıl
şikâyetini —*"AI sus pus olmasın"*— **tek başına ÇÖZMEZ.** Devri azaltan şey istem değil **BİLGİ**:

| İş | Etki |
|---|---|
| `KB_RETRIEVAL_MODE=hybrid` açılması | ölçüldü: gold istemde **3/8 → 7/8** |
| Knowledge Hub Bacak B (geçmiş host cevapları) | migration YOK, girdi hazır |
| Bacak A (ilan açıklaması) / C (PDF rehber) | bilgiyi kaynağından getirir |

Sıra bu yüzden: **istem düzeltmesi → bilgi bacakları → hibrit** (üçü birlikte "az devir, çok cevap").

## Kanıt planı (K2)

- **Kırmızı-önce:** `tests/unit/ai-prompts.test.ts` + `prompt-honest-commitments.test.ts` — istemde
  o cümlenin ARTIK BULUNMADIĞI ve UYDURMA yasağının DURDUĞU pinlenir (iki yönlü).
- **GOLDEN SET** (`golden-scenarios.test.ts`): istem/kelime ağı değiştiği için tam koşu.
- **İki yönlü senaryo:** (a) bilgi YOKken model kısa + iddiasız + düşük güvenli döner → kapı
  devreder; (b) bilgi VARken cevap DEĞİŞMEZ (regresyon).
- **Gerçek eval:** E1 senaryosu bu değişikliğin tam hedefi → `npm run eval` ŞART, koşu öncesi/sonrası
  kıyas. ⚠️ Bu ortamda `OPENAI_API_KEY` YOK (arandı: `/etc/environment`, tüm `.env` yolları, PID 1
  ortamı, shell profilleri) — env konteyner AÇILIŞINDA yükleniyor, **eklendikten sonra session
  yeniden başlatılmalı**.
