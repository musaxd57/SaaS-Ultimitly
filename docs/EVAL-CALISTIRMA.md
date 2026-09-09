# Gerçek model eval'i — nasıl koşulur

> 🚨 **Bu ortamda (Claude konteyneri) KOŞULAMADI: `OPENAI_API_KEY` yok.** Harness hazır ve tek komutla
> çalışır; sonuçları koşan kişi paylaşınca `docs/olcum/eval-<tarih>.md` olarak repoya girer.
> Bu belgede yazan hiçbir sayı "ölçüldü" diye sunulmuyor — henüz ölçülmedi.

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

## Ne zaman gerekir
- `QR_INFORMATIONAL_BAND_ENABLED` bayrağı **bu eval bitmeden AÇILMAZ** (kurucu kararı).
- Model değişiminden önce baseline, sonra kıyas.
- Prompt'a dokunan her turda.
