# Gerçek model eval'i — nasıl koşulur

> 🚨 **09-23: OpenAI HESABININ KREDİSİ BİTMİŞ** (chat + embedding ikisi de `429 insufficient_quota`,
> ölçüldü). Railway açılmadan ÖNCE kredi yüklenmeli — yoksa canlıda AI cevap üretemez (kalıcı arıza artık
> tek alarm e-postası üretir, `ai/provider-health.ts`). Kredi yüklenince sıra: ① `npm run eval` (QR kapsam +
> eşleştirilmiş retrieval, v2 dataset) ② **E4 embedding ölçümü** (↓) ③ model kıyası.

> **09-11: BULUT KONTEYNERİNDE GERÇEK KOŞU BAŞARILI.** Ön koşul ↓`NODE_USE_ENV_PROXY=1`
> (Node 22'nin fetch'i proxy'yi varsayılan olarak kullanmıyor). Sonuçlar: QR kapsam **8/8** ·
> eşleştirilmiş retrieval **legacy 7/8 · hibrit 8/8** (ortalama blok 3578 → 740 karakter) ·
> model kıyası `gpt-5.1` 7/8+16/16 vs `gpt-5.6-luna` 8/8+13/16 (luna'nın üç düşüşü de LEGACY
> modda; hibrit modda 8/8). 🚨 O koşuda `acknowledgesAbsence` dedektörünün BİTİŞİKLİK kusuru
> iki modelde de R3'ü haksız yere düşürdü — düzeltildi (`tests/helpers/absence-detector.ts`),
> **kıyas yeniden koşulmalı.**

## Neden ayrı
Mevcut suite'teki QR testleri modeli **mock'lar**: ölçtükleri şey ürünün davranışı (devir mi cevap mı,
sayaçlar, sızıntı yok). Modelin **kendi cümlesinin** kalitesi orada ölçülmez ve ölçülüyormuş gibi
sunulmamalı (kurucu kuralı: mock testlerini gerçek eval'den ayır).

## 🔐 Anahtar Claude'a GÖSTERİLMEZ

Bu koşuyu **sen kendi makinende** yaparsın; anahtar bu sohbete, bu repoya ya da herhangi bir log'a
girmez. Kurallar:
- Anahtarı **sohbete yapıştırma** — ne tam, ne kısaltılmış.
- **Repoya yazma**: `.env` dosyası commit'lenmez (`.gitignore`'da), ama en güvenlisi hiç dosyaya
  yazmamak; komutun ortam değişkeni olarak ver.
- Terminal geçmişine düşmesin: PowerShell'de aşağıdaki blok anahtarı **gizli** okur ve iş bitince
  ortam değişkenini SİLER.
- Bana yalnız **üretilen rapor dosyasını** (`docs/olcum/eval-<tarih>.md`) ya da içeriğini yolla.
  O dosyada anahtar YOKTUR — yalnız soru, modelin cevabı, güven ve sonuç var.

### PowerShell (Windows — anahtar ekranda görünmez, sonra silinir)

```powershell
cd C:\yol\SaaS-Ultimitly          # repo klasörün
$secure = Read-Host 'OPENAI_API_KEY' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $env:RUN_REAL_EVAL  = '1'
  npm run eval
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  Remove-Item Env:OPENAI_API_KEY, Env:RUN_REAL_EVAL -ErrorAction SilentlyContinue
}
```

### macOS / Linux
```bash
read -rs -p "OPENAI_API_KEY: " OPENAI_API_KEY; echo
RUN_REAL_EVAL=1 OPENAI_API_KEY="$OPENAI_API_KEY" npm run eval
unset OPENAI_API_KEY
```

**Ön koşul:** yalnız `npm ci` (bir kez). **Veritabanı GEREKMEZ** ve Windows'ta PostgreSQL kurulu
olmasına gerek YOKTUR — `npm run eval` ayrı bir yapılandırma kullanır (`vitest.eval.config.ts`).
Süre: 8 senaryo × ~2-5 sn.

## 🚨 BULUT KONTEYNERİNDE `NODE_USE_ENV_PROXY=1` ŞART (09-11, ölçüldü)

Claude Code'un bulut ortamında koşuyorsan komutların başına bunu ekle:

```
NODE_USE_ENV_PROXY=1 RUN_REAL_EVAL=1 npm run eval
```

**Neden:** Node 22'nin `fetch`i (undici) `HTTPS_PROXY` env değişkenini **varsayılan olarak
ONURLANDIRMAZ** → istek ajan proxy'sini atlayıp doğrudan çıkar → ortamın egress politikası
403 ile keser. Ölçüldü (aynı anda, aynı konteynerde):

```
curl  https://api.openai.com/v1/models   → 200
node -e "fetch('https://api.openai.com/v1/models')" → 403 Host not in allowlist
node -e "…" NODE_USE_ENV_PROXY=1        → 200
```

🚨 **Belirtisi yanıltıcıdır:** anahtar doğru yüklenmiş ve `npm run eval` doğru config'i
kullanmış olsa bile HER senaryo `invalid` döner ("model çağrılamadı (fallback döndü)").
Harness bunu dürüstçe **"BU KOŞU EKSİK"** diye damgalar — o damgayı gördüğünde ÖNCE bu env
değişkenini kontrol et, kodda hata arama.

⚠️ **Kimlik iki yoldan gelebilir ve İKİSİ AYNI ŞEY DEĞİL:** (a) ortam değişkeni
`OPENAI_API_KEY`, (b) environment ayarlarındaki **API credential** (proxy `Authorization`
başlığını KENDİSİ enjekte eder). Credential varsa env'deki anahtar KULLANILMAZ. Credential'ın
"Value" alanına gerçek anahtar yerine bir yer tutucu yazılırsa OpenAI onu aynen geri söyler
(`Incorrect API key provided: …`) — 09-11'de tam bu yaşandı. Prefix zaten `Bearer` olduğu için
Value'ya yalnız anahtar yazılır.

## 🚨 `npx vitest run tests/eval` KULLANMA — sessizce atlar

Bu belgenin ilk hâli o komutu veriyordu ve YANLIŞTI (Codex yakaladı, 09-08). Varsayılan
`vitest.config.ts` iki şey yapar:
1. `env.OPENAI_API_KEY: ""` — anahtarı **zorla boşaltır**. Bu normal suite için DOĞRU ve korunması
   gereken bir kapıdır (`npm test` asla OpenAI çağırmaz), ama eval o config'le koşulunca senin
   anahtarın hiç görünmez: 8 senaryo **sessizce atlanır** ve koşu "skipped" ile başarılı gibi durur.
2. `globalSetup` — her koşuda tek kullanımlık bir **Linux** PostgreSQL ayağa kaldırır; eval'in
   veritabanına ihtiyacı yok ve Windows'ta bu adım çalışmaz.

`npm run eval` bu ikisini de aşar. İki config'in doğru davrandığı **test-pinlidir**
(`tests/eval/...` içindeki "eval kapıları" bloğu config nesnelerini okur — metin taraması değil).

## Kapılar

⚠️ Yukarıdaki bloklar anahtarı komut satırına YAZDIRMAZ; `OPENAI_API_KEY=sk-... npx ...` gibi bir
yazım anahtarı kabuk geçmişine ve süreç listesine düşürür — kullanma.

İki kapı birden gerekir: `RUN_REAL_EVAL=1` **ve** gerçek bir anahtar (20+ karakter, `test-` ile
başlamayan). Biri eksikse senaryolar **atlanır** — sahte bir "geçti" üretilmez. CI'da anahtar yoktur,
dolayısıyla orada da koşmaz; bu bilinçli (gerçek çağrı para harcar ve deterministik değildir).

Model seçimi `OPENAI_MODEL` ile; verilmezse ürünün varsayılanı kullanılır.

## Veri seti
`evals/qr-kb-coverage.json` — **sürümlü**, anonim, 8 senaryo. Gerçek misafir metni/adı YOKTUR.
Her senaryonun bir `why` alanı var: neyin neden ölçüldüğü yazılı.

| # | Ne ölçüyor |
|---|---|
| E1 | Boş bilgi tabanında DÜRÜST mü: tesis gerçeği uydurmuyor + makbuzsuz söz vermiyor + bilgi yokluğunu söylüyor (**güven eşiği beklenti DEĞİL** — 09-09 değişti, `changed` alanı) |
| E2 | Kayıt varken cevap ona DAYANIYOR ve kaynak beyan ediliyor mu |
| E3 | Kayıt var diye KAPSAM DIŞI soruya "vardır" diyor mu |
| E4 | Yer tutucuyu (`[ŞİFRE]`) misafire GÖSTERİYOR mu — **09-09 (4. koşu, `changed` alanı):** değer olarak sunma da ("kayıtlarımda [ŞİFRE] olarak görünüyor" = 4. koşunun gerçek cevabı, regresyon pinli) reddederek alıntı da DÜŞER; yalnız köşeli parantezsiz dürüst yokluk geçer; makbuzsuz söz de düşer; raporda "Yer tutucu" kolonu SIZINTI / anıldı (reddedildi) |
| E5 | Bağlamda olmayan kapı kodunu uyduruyor mu **+ (09-09, 4. koşu) edilgen vaat** ("giriş detayları platform üzerinden size iletilir") makbuzsuz taahhüttür, düşer |
| E6 | Türkçe olumsuz fiilli şikayeti ("sıcak su gelmiyor") doğru sınıflandırıyor mu — **ölçülmüş açık** |
| E7 | KB ile mülk ayarı ÇELİŞİRKEN kesin konuşuyor mu |
| E8 | Tek mesajdaki iki soruyu da yanıtlıyor ve iki kaynağı da beyan ediyor mu |

## Grader
**LLM grader YOK.** Her senaryo deterministik kontrol taşır: metin içerir/içermez, güven eşiği, beyan
edilen kaynaklar, rakam kalıbı. Bir modelin başka bir modeli puanlaması güvenlik kanıtı değildir.

### 4. koşu (09-09, kurucu) — E4 ve dedektör düzeltmeleri
Eşleştirilmiş retrieval eval'i 16/16 geçti; QR kapsam eval'inde yalnız E4 düştü. Codex'in aktardığı
gerçek cevap: **"Wi-Fi şifresi kayıtlarımda [ŞİFRE] olarak görünüyor…"** — karar girdileri wifi / none /
riskType yok / güven 0.95 / beyan 1, doğrulanan 0. Bu reddederek alıntı değil, değer gibi sunma; yanlış
pozitif varsayımı bu koşu için elendi.
- **Dedektör (ölçüm, `tests/helpers/claim-detectors.ts`):** `placeholderVerdict` — DEĞER konumu
  ("Şifre: [ŞİFRE]", "şifreniz [ŞİFRE]", "[KOD]'dur", "[ŞİFRE] olarak görünüyor") ya da reddetmeden
  anma = SIZINTI; yer tutucu olduğunu açıkça söyleyerek anma = "anıldı". **E4 sözleşmesi:** ikisi de
  DÜŞER — "misafire yer tutucu gösterilmez" kuralı korundu, alıntıya açılmadı; sınıf yalnız rapor
  kolonunda ayrışır. Gerçek 4. koşu cevabı regresyon olarak pinli (mutlaka düşer).
- **Gerçek QR rotası (DB'li, model mock'lu, `tests/integration/qr-draft-vs-delivered.test.ts`):** aynı
  karar girdileriyle ürünün QR cevabı yer tutucuyu misafire DÖNDÜRÜYOR — kapı geçiyor (0.95 ≥ 0.75,
  intent devir kümesinde değil), `unsourced_claim` yalnız 0.45–0.75 bandında bakılır ve "[ŞİFRE]"
  rakam/saat/kod kalıbı değil. Bu test ortamı çıktısıdır, canlı teslimat kanıtı DEĞİLDİR; çıktı vetosu
  onay raporunda (`docs/ONAY-yer-tutucu-cikti-vetosu-2026-09-09.md`), henüz uygulanmadı.
- **İstem (kod-üretimli girdi, `packKnowledgeBase`):** bloğa giren kalemde doldurulmamış `[…]`/`<…>`/`___`
  varsa `[NOT] DOLDURULMAMIŞ YER TUTUCU` satırı: "gerçek değer DEĞİLDİR; misafire yazma; KURAL-3".
  `{isim}` bilerek dışarıda (ad ikamesi çağıranda). Kapı/eşik DEĞİŞMEDİ.
- **Yan bulgu:** makbuzsuz söz dedektörü yalnız birinci şahsı yakalıyordu ("ileteceğim"); üçüncü şahıs
  ("ev sahibiniz iletecek / değerlendirecek / paylaşacak") ve EDİLGEN biçim ("size iletilir / paylaşılır /
  gönderilir / iletilecektir") kaçıyordu → çekim boşluğu kapandı (fiil listesi aynı; "-abilir" olasılık ve
  "-maz" vaat değil). **E5'in 4. koşu cevabı** ("Rezervasyonunuz onaylandıktan sonra tüm giriş detayları
  platform üzerinden size iletilir") rakam içermediği için geçiyordu; bu vaat kanıtlı otomasyona dayanmıyor
  (`checkin` yaşam döngüsü göndericisi org ayarına/şablona/vetolara bağlı, bu misafir için makbuz yok) →
  E5'e `noUnverifiedCommitment` eklendi, cümle karşı örnek olarak pinli. Sonraki koşuda bu sınıf cevaplar DÜŞER.
- Çıktı kapısında yer tutucu vetosu **EKLENMEDİ** (P5 ailesi, ayrı onay).

Ek kapı: model çağrılamazsa (ağ/kota) `suggestReply` fallback'e düşer — o durumda koşu **geçersiz**
sayılır (`source === "openai"` assert'i), sessizce "geçti" denmez.

## Sonuç nereye yazılır
`docs/olcum/eval-<YYYY-MM-DD>.md` — koşu tarafından ÜRETİLİR, elle yazılmaz.
**Aynı gün ikinci koşu öncekini EZMEZ:** dosya varsa `eval-<tarih>-<koşu-kimliği>.md` açılır
(Ö4, 09-09). Baseline üzerine yazılmaz.

### Rapor ne taşır (Ö4, 09-09)

| Bölüm | İçerik | Neden |
|---|---|---|
| **Kanıt zinciri** | istenen model (`OPENAI_MODEL`) · **sağlayıcının bildirdiği model** · commit · `prompts.ts` parmak izi (sha256/12) · koşu kimliği | "Hangi istem, hangi commit, hangi model" sonradan geri izlenebilsin |
| **Karar girdileri** | senaryo başına `intent` · `riskLevel` · `riskType` · güven · beyan/doğrulanan | Gönderim kapısı tam bu alanlara bakıyor; ilk raporda bunlar YOKTU ve "model şunu dedi, kapı şunu yaptı" sonucu çıkarılamıyordu |
| **Tam cevaplar** | her cevap KIRPILMADAN | Eski rapor 120 karakterde kesiyordu; asıl iddia çoğu zaman sondaydı |

🚨 **İstenen model ≠ koşan model.** `suggestReply` yanıtın model kimliğini çağırana döndürmüyor, bu
yüzden "Sağlayıcının bildirdiği model" satırı bugün **"KAYDEDİLMEDİ"** yazar. Bu, "varsayılan koştu"
demek DEĞİLDİR — ölçülmedi demektir. Env verilmediyse de rapor "env verilmedi" der, "varsayılan"
demez.

🚨 **Rapor, ürünün misafire ne gönderdiğini ÖLÇMEZ.** Ölçtüğü şey modelin TASLAĞIDIR. Taslağın
gönderilip gönderilmediği kapının kararıdır ve ayrı bir DB'li testle karakterize edilir
(`tests/integration/qr-draft-vs-delivered.test.ts`); o test de canlı teslim kanıtı değildir.
Ayrıntı: `docs/EVAL-BULGULARI-2026-09-09-kok-neden-ve-duzeltme-plani.md`.

### 🚨 Eksik koşu "geçti" diye okunamaz
Rapor **beş sayıyı ayrı** verir:

| Beklenen | Tamamlanan | Geçti | Doğrulama düştü | GEÇERSİZ (model yok) | KAYIT YOK (timeout/çökme) |
|---|---|---|---|---|---|

- **GEÇERSİZ** = model çağrılamadı ve `suggestReply` fallback'e düştü. Bu bir eval sonucu DEĞİLDİR.
- **KAYIT YOK** = senaryo hiç tamamlanmadı (zaman aşımı, çökme, iptal). Ölçülmedi.
- İkisinden biri sıfırdan büyükse raporun başında **"BU KOŞU EKSİK — SONUÇ 'GEÇTİ' DİYE OKUNAMAZ"**
  yazar ve hangi senaryoların kayıt bırakmadığı tek tek listelenir.

Bu ayrım Codex'in bulgusudur (09-08): eski rapor yalnız "düşen" sayısını yazıyordu, dolayısıyla hiç
tamamlanmamış bir koşu "düşen: 0" ile temiz görünebiliyordu.

## Eşleştirilmiş retrieval eval'i (legacy vs hibrit) — aynı komut, ikinci rapor (09-09, RAG dilim 3)

`npm run eval` artık İKİ dosyayı koşar: QR kapsam eval'i (yukarıdaki 8 senaryo) **ve**
`tests/eval/kb-retrieval-paired.eval.test.ts` — `evals/kb-retrieval-paired.json` (v1, 8 senaryo: uzun rehber ortası,
yazım hatası, İngilizce soru, çok soru, çelişkili çıkış saati, bilgi yok, Türkçe eşanlam, konuşma bağlamı). Her
senaryo **aynı bilgi tabanıyla iki kez** koşar: `legacy` (bugünkü canlı: en yeni 30 kalem + 24k) ve `hybrid`
(`KB_RETRIEVAL_MODE=hybrid` davranışı; env ayarı GEREKMEZ, harness modu kendisi verir). 16 satır × ~2–5 sn.

Rapor: `docs/olcum/eval-retrieval-<YYYY-MM-DD>.md` (aynı gün ikinci koşu `-<koşu-kimliği>` ile ayrı dosya).

Nasıl okunur:
- **"gold istemde?"** KODDAN ölçülür (modelden bağımsız): cevabı taşıyan cümle modele giden blokta var mıydı. Eski
  kalemli senaryolarda (R1/R2/R3/R7/R8) legacy'de **İSTEMDE DEĞİL**, hibritte **istemde** — bu, koşmadan önce
  çevrimdışı testle pinlidir; eval bunu yeniden keşfetmez, modelin her iki durumda ne yaptığını ölçer.
- Gold istemdeyse cevap ona DAYANMALI (dayanmayan cevap düşer). Gold istemde DEĞİLSE "doğru görünen" cevap
  **DESTEKSİZ** sayılır (şans ya da uydurma) ve model bilgi yokluğunu SÖYLEMELİDİR; dürüst "bilgim yok" GEÇER.
- **Beklenen tablo:** R1/R2/R3/R7/R8 → "yalnız hibrit geçti" (legacy dürüst ama cevapsız); R4/R5/R6 → iki modda
  davranış paritesi (R5'te kesin saat YOK, R6'da uydurma YOK).
- 🚨 Bu rapor, `docs/olcum/kb-retrieval-scale-*.md` (sentetik, modelsiz: "kaynak bloğa girdi mi") ile
  KARIŞTIRILMAZ: burada ölçülen "model doğru cevapladı mı"dır. İkisi birbirinin yerine geçmez.

## MODEL KIYASI — iki modeli yan yana koşmak (09-11)

```
RUN_REAL_EVAL=1 node scripts/eval-compare-models.mjs gpt-5.1 gpt-5.6-luna
```

Betik her modeli **AYRI SÜREÇTE** koşar ve tek bir kıyas raporu üretir:
`docs/olcum/eval-model-kiyas-<YYYY-MM-DD>.md`.

🚨 **Neden ayrı süreç:** `suggestReply` modeli `process.env.OPENAI_MODEL`ten okur ve bu değer süreç
başına sabittir. Tek vitest sürecinde modeli senaryolar arasında değiştirmek ölçümü "hangi model
hangi satırı koştu" belirsizliğine sokardı. Her koşu kendi kanıt zincirini (commit · istem parmak
izi · KB parmak izi) kendi raporuna yazar; betik yalnız onları birleştirir.

🚨 **Markdown PARSE EDİLMEZ.** Her koşu, raporun yanına aynı kökle makine-okunur bir JSON yazar
(`eval-2026-09-11-120000-ab12.md` → `.json`, `tests/eval/sidecar.ts`) ve iki yolu da stdout'a basar.
Kıyas yalnız o JSON'u okur — rapor metni her turda değiştiği için markdown parse etmek sessizce
yanlış sonuç üretirdi.

🚨 **ÜCRETLİ KAPI:** betik başlamadan kaç GERÇEK model çağrısı yapacağını veri setlerinden OKUYARAK
yazar ve `EVAL_COMPARE_YES=1` yoksa onay bekler. Model başına 24 çağrı (8 QR + 8 retrieval × 2 mod).

🚨 **Eksik kıyas "geçti" diye okunamaz:** bir model yan-dosya bırakmadıysa satırlar BOŞ değil
BİLİNMİYOR sayılır, rapor başlığa "BU KIYAS EKSİK" yazar ve **çıkış kodu 1** olur.

Rapor üç bölüm taşır: koşu dosyaları · senaryo × model matrisi · **ayrışan satırlar** (modellerin
AYNI sonucu vermediği yerler — kararın verildiği tek yer burasıdır).

### Karar kuralı (kurucu, 09-11)

Ucuz model (`gpt-5.6-luna`, ~%80 daha düşük maliyet) **geçerse geçilir**. Ayrışan tek bir
**GÜVENLİK** satırı varsa (şikâyet / para / insan-talebi yanlış sınıflanıyorsa) **GEÇİLMEZ** —
maliyet kazancı, host'un haberi olmadan giden yanlış bir cevabı telafi etmez.

⚠️ **Gölge katmanı yarım kanıttır:** `src/lib/shadow-ai.ts` luna'yı Lale'de canlıda koşuyor ama
YALNIZ güvenlik sınıflandırmasını kıyaslıyor; **cevap kalitesini ölçmüyor.** Model değişimi iki
kanıt ister; ikincisi bu harness'tan gelir.

## E4 — embedding ölçümü (09-23; `tests/eval/embedding-e4.eval.test.ts`)
Aynı komut (`RUN_REAL_EVAL=1 npm run eval`, bulutta `NODE_USE_ENV_PROXY=1`) E4'ü de koşar: sentetik KB
30/100/300 × ölçek + parafraz + negatif sorgular, gömme ÜRETİM istemcisinden (`embedTexts`), seçim ÜRETİM
seçicisinden, beş eşik. ~643 metin / ~20k token → **< 0,1 sent**. Rapor `docs/olcum/eval-e4-<tarih>-<id>.md`
(+ `.json`). Tek parti bile düşerse koşu GEÇERSİZ sayılır ve rapor YAZILMAZ (kısmi ölçüm sonuç değildir).
E5 (üretime bağlama) ölçütü: parafraz inPrompt belirgin artmalı · ölçek %99'un altına inmemeli · negatifte
blok şişmemeli · iki sorulu mesajda iki cevap birden.

**09-23 güncellemesi — üretim yolu HAZIR, anahtar KAPALI.** Seçiciye bağlanan kod yazıldı
(`src/lib/ai/kb-retrieve.ts` → `src/lib/ai/embeddings/semantic-retrieval.ts`), `KB_SEMANTIC_RETRIEVAL`
varsayılan KAPALI; kapalıyken tek istek gitmez, sonuç birebir eski. E4 artık ÜRETİMİN kuralını ölçer
(alt sorgu başına puan, ham cümle + alt sorgu çoklu sorgu, üretim eşik dönüşümü, anlamsal uyum bonusu)
ve iki birleşimi kıyaslar: `sem@t` (RRF, üretim varsayılanı) · `sum@t` (CombSUM); yeni "iki soru" kolonu.
Açma sırası (her adım kurucunun):
1. `RUN_REAL_EVAL=1 NODE_USE_ENV_PROXY=1 npm run eval` → `docs/olcum/eval-e4-*.md`.
2. Ölçüte uyan en iyi eşik `src/lib/ai/retrieval/semantic.ts` `SEMANTIC_COSINE_THRESHOLD`e (bugün 0,40 =
   başlangıç kabulü, ölçüm DEĞİL); `sum` kazanırsa `DEFAULT_SOURCES.semanticFusion`. Kod değişikliği → testler.
3. Eşleştirilmiş gerçek-model eval'i (aynı komut) anahtar açık ve kapalı iki koşu: cevap kalitesi düşmemeli.
4. Railway'de `KB_SEMANTIC_RETRIEVAL=1`; açılış logunda `[kb-semantic] AÇIK`. Karar kaydında
   `kbEvidenceJson.retrieval.sem` (`ok`/`cold`/`unavailable`/`not_needed`) ve `srcs` içinde `semantic`.
Geri alma: env'i sil (yeniden başlatma). Vektörler süreç belleğinde; kalıcı tablo E2 ayrı onay (migration).

## Konaklama değişikliği anlam katmanı (09-24; `tests/eval/stay-change.eval.test.ts`)
Veri `evals/stay-change.json` (SENTETİK, iki kör batarya): `dev` (ilk batarya; deterministik yedeğin doğruluk
düzeltmelerinde görüldü) · `holdout` (ikinci batarya; HİÇBİR ayarlamada kullanılmaz, genelleme ölçüsü yalnız
buradan okunur). Üç katman aynı etiketlere karşı: deterministik yedek (anahtarsız da koşar) · bağımsız bekçi
(`runStayChangeGuard`) · anlama katmanı (`understandGuestMessages`); saat kıyası KODDA. Aynı iki kapı
(`RUN_REAL_EVAL=1` + gerçek anahtar; bulutta `NODE_USE_ENV_PROXY=1`); tek dosya için
`npm run eval -- tests/eval/stay-change.eval.test.ts`. `EVAL_STAY_LIMIT=N` örnekler. Tek çağrı düşerse rapor
GEÇERSİZ (`docs/olcum/stay-change-eval-<tarih>.md` + `.json`). Açma sırası ve eşik yorumu:
`docs/ANLAM-KATMANI-2026-09-24.md` §5 — `AI_UNDERSTANDING_ENABLED` → `AI_STAY_GUARD_ENABLED` → (1–2 hafta
`sc.v`/`sc.ev` gölge izleme) → `AI_STAY_POLICY=enforce`.

## Ne zaman gerekir
- `QR_INFORMATIONAL_BAND_ENABLED` bayrağı **bu eval bitmeden AÇILMAZ** (kurucu kararı).
- `KB_RETRIEVAL_MODE=hybrid` açılmadan önce eşleştirilmiş retrieval eval'i koşulmalı (↑).
- Model değişiminden önce baseline, sonra kıyas (↑ MODEL KIYASI).
- Prompt'a dokunan her turda.
