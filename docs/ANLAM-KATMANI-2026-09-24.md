# Anlam katmanı — şema tabanlı niyet çıkarıcı, sorgu yeniden yazma ve bağımsız bekçi (2026-09-24)

> Kurucu (09-24): *"Cümlenin anlamına ve amacına bakıyor muyuz? … kural çalıştırmak zorunda
> kalmazsınız, sistem üç cümlenin de aynı niyete hizmet ettiğini doğrudan anlar. … Trilyonluk
> şirketler LLM'lerle nasıl yapıyorsa öyle yap."*

## 1. Neden (ölçüm)

Müsaitlik vetosunun ilk sürümü kelime kalıplarıyla kuruldu. Uygulamayı görmeyen bir ajanın
yazdığı **kör batarya** (`evals/stay-change.json`, `dev` bölümü: 268 misafir mesajı, 326 cevap,
7 dil) ile ölçüldü:

| sınıf | kelime ağı — `dev` (ilk kör batarya) | kelime ağı — `holdout` (ikinci kör batarya, TEK ölçüm) |
|---|---|---|
| konaklama isteği (ek gece, erken giriş, geç çıkış, tarih değişikliği, müsaitlik sorusu) | 77/125 (%62) | **77/170 (%45)** |
| istek olmayan zor benzerde yanlış alarm | 10/143 | **28/161 (%17)** |
| takvim iddiası ("o gece boş", "doluyuz", "sizden sonra misafir yok") | 31/57 | **26/73 (%36)** |
| izin / söz ("see you at 11", "çıkışınızı 13:00'e aldım", "genelde sorun olmaz") | **19/60** | **13/95 (%14)** |
| erteleme cümlesi tanıma | 61/76 | 41/77 |
| tarafsız cevapta yanlış alarm | 1/118 | 3/127 |

`holdout`un yanlış alarmları kelime tabanlı yöntemin yapısal sınırıdır: olumsuz ya da vazgeçilmiş istek
("Geç çıkışa gerek yok, 10'da çıkarız"), karşı-olgusal ("Keşke daha uzun kalabilseydik ama…"), olanak
müsaitliği ("14 Ekim'de otopark müsait mi?"), bilgilendirme ("Tarihleri uygulamadan değiştirdim, onaylandı")
ve eş sesli kelime ("Verlängerungskabel", "wifi extender"). Hepsi ANLAM ayrımıdır. Holdout'a bakıp kalıp
yazılmadı; bu hatalar yalnız raporlandı. Yanlış alarmın bedeli taslaktır (güvenli yön). Model katmanları
açılıp ölçülünce kelime ağının istek bacağı yalnız "model katmanı düştüğünde" rolüne indirilebilir
(ayrı karar).

İnsan dili kalıpla kapatılamaz. Görülen hataları kalıpla kapatmak o bataryaya aşırı uyum üretir
("kural çöplüğü"). Kelime ağı bu yüzden **dondu**. Artık yalnız yedek olarak çalışıyor ve yalnız iki
doğruluk hatası düzeltildi (Almanca söz dizimi, Türkçe katlamada "If → ıf"). Ölçülmüş düzeyinin
düşmemesi circirle pinli: `tests/unit/stay-change-backstop-floor.test.ts`.

## 2. Mimari — dört katman, tek karar, hepsi yalnız SIKILAŞTIRIR

```
misafir mesajı ─► [3] ANLAMA KATMANI (LLM, şema) ─► niyetler + yeniden yazılmış sorgular + istek yuvaları
                        │ sorgular                      │ konaklama sinyali
                        ▼                               │
                  retrieval (BM25 + n-gram + [embedding]) ── deterministik alt sorgular ∪ model sorguları
                        ▼                               │
                  cevap modeli ─► reply + [2] ŞEMA BEYANI (stayChangeAsked, replyStance)
                        ▼                               │
                  kod kapısı ─► [4] BAĞIMSIZ BEKÇİ (ikinci LLM, şema) — yalnız otomatik gönderim ADAYI
                        ▼                               ▼
                  evaluateAvailability(yedek [1] + beyan + bekçi + anlama + mülkün standart saatleri)
                        ▼
                  gönder │ taslak (kanal) / devir (QR) + RiskEvent.reason + kbEvidenceJson.sc
```

| katman | dosya | nasıl | varsayılan |
|---|---|---|---|
| [1] deterministik yedek | `ai/availability-claims.ts` | dar kelime ağı; model yokken de çalışır | açık, **büyütülmez** |
| [2] cevap modelinin beyanı | `ai/prompts.ts` (Bölüm 4.5, 12/13, 24 few-shot) + `ai/index.ts` | aynı çağrı, ek maliyet yok; STRICT çözüm | açık (iddia duruşu zorlanır) |
| [3] anlama katmanı | `ai/semantic/understand.ts` + `understanding-schema.ts` | OpenAI Structured Outputs (`json_schema`, `strict`) | `AI_UNDERSTANDING_ENABLED=1` |
| [4] bağımsız bekçi | `ai/semantic/guard.ts` | ikinci model, yalnız aday taslak | `AI_STAY_GUARD_ENABLED=1` |

Ortak: `ai/semantic/stay-change.ts` (kapalı kümeler, çözücüler, KODDA saat kıyası, politika kipi),
`ai/semantic/structured-call.ts` (tek ağ kapısı; 64 KB tavan, kalıcı arıza geçiş alarmı `semantic`
kanalı), `ai/semantic/config.ts` (anahtar/model/zaman aşımı tek kaynak).

### 2.1 Karar kuralı (`evaluateAvailability`)

* **İDDİA** (her kipte, devir cevabında da): kelime ağının iddiası · beyan `grants`/`states_calendar`
  · bekçinin takvim/izin hükmü → `availability_claim`.
* **İSTEK** (devir cevabı muaf): kelime ağının isteği · bekçinin isteği ya da **kodda** standart
  dışı bulunan saat · (`AI_STAY_POLICY=enforce` ile) beyan edilen istek/ret ve anlama katmanının
  isteği → **erteleme kanıtı yoksa** `availability_unconfirmed`.
* **ERTELEME kanıtı izin yönlüdür:** kelime ağının tanıdığı erteleme cümlesi **ya da** iki bağımsız
  modelin (beyan `defers` + bekçi `reply_defers_to_host`) birlikte "erteliyor" hükmü. Tek model
  yetmez. Kelime ağının Türkçe/İngilizce dışında zayıf kaldığı yer burasıdır; bekçi bu açığı kapatır.
* **BEKÇİ DÜŞTÜYSE** (bayrak açık, çağrı başarısız): modelin herhangi bir konaklama sinyali varsa
  kip ne olursa olsun tutulur. Sinyal yoksa eski davranış sürer.
* Erteleme dedektörü tek biçimle çalışır: küçük harf + Türkçe ASCII katlama. Homoglif ve görünmez
  karakter adayları yalnız KISITLAYICI dedektörlerdedir (CLAUDE.md katlama kuralı).

### 2.2 Kipler ve gölge ölçümü

`AI_STAY_POLICY` varsayılanı **gölgedir**. Modelden türeyen istek sinyalleri kanıta yazılır ama karar
vermez. `enforce` kipinin kararı **her zaman** hesaplanır ve `kbEvidenceJson.sc.ev` alanına yazılır.
Böylece açmadan önce gerçek trafikte "açsaydık kaç taslak daha çıkardı" okunabilir: `sc.v` ile
`sc.ev` farkı.

`sc` kanıt alanı (PII yok, kapalı küme):

| alan | anlam |
|---|---|
| `v` / `ev` | uygulanan karar / `enforce` kipinin kararı (`-` = temiz) |
| `lx` | kelime ağı: `c` iddia, `r` istek, `d` erteleme |
| `d` | beyan `asked/stance` ya da `absent` |
| `g`, `gv` | bekçi `off/ok/failed`; hüküm `q` istek, `s` takvim, `a` izin, `d` erteleme, `x` ret, `t` kaydırılmış saat |
| `u` | anlama katmanı `off/req/none` |

Retrieval kanıtına (`retrieval`) anlama katmanından `uq` (eklenen sorgu sayısı), `un`
(`ok/cached/failed`), `unMs` ve `ui` (niyet etiketleri) girer. Sorgu **metni girmez**.

## 3. Sorgu yeniden yazma / çoklu sorgu (kurucunun Gemini örneği)

"Giriş saati kaçtı bir de evcil hayvan getirebiliyor muyduk?" → anlama katmanı iki istek üretir:
`checkin_time` → "giriş saati check-in", `pets` → "evcil hayvan kabul politikası". Bu sorgular
deterministik alt sorgulara **birleşim** olarak eklenir. Hiçbir alt sorgunun yerine geçmez, adayı
daraltmaz, bilgi tabanına kalem ekleyemez (seçilebilecek küme yetki, onay ve sır süzgeçlerinden
önce kurulur). Aynı sorgular embedding açıkken gömülür.

Kazanımlar (pinli: `tests/unit/understanding.test.ts`):

* **Eş anlamlı ve çok dilli sorular.** "Gibt es hier eine Schwitzkabine?" kelime aramasında
  hiçbir şey bulmuyor. Büyük bilgi tabanında eski sauna kalemi geri çekilme kümesine de girmiyor.
  Yeniden yazılmış "sauna" sorgusuyla kalem gerçek seçimle (`fb: none`) bulunuyor.
* **Bağlam çözümü.** "Peki büyük köpek?" önceki konuşmadan "evcil hayvan köpek kabul" olur.
* Katman kapalıyken sonuç `selectKbForPrompt` ile **birebir** aynı ve ağ çağrısı yok
  (davranışsal pin). Katman düşerse sonuç eski davranışla aynı, kanıtta `un: failed` yazar.

## 4. Veri, maliyet, gecikme

* **İşleyen:** OpenAI. Cevap üretiminin zaten kullandığı işleyen olduğu için **yeni alt-işleyen yok**.
  Modele gitmeden önce bilinen adlar ve değer biçimli PII (telefon, e-posta, uzun kod) redakte
  edilir (`shadow-ai.ts` ile aynı sıra).
* **Maliyet:** anlama katmanı mesaj başına bir küçük çağrı yapar (süreç içi 10 dk önbellek var).
  Bekçi yalnız otomatik gönderim adayında bir küçük çağrı yapar. Beyanın ek maliyeti yok.
* **Gecikme:** anlama katmanı retrieval'dan önce koşar, yani QR'da yaklaşık 1 sn ekler. Bekçi
  gönderimden önce koşar. Zaman aşımları `AI_SEMANTIC_TIMEOUT_MS` ile ayarlanır (reasoning 12 sn,
  klasik 6 sn).
* **Model:** `AI_SEMANTIC_MODEL`; boşsa `OPENAI_MODEL`. Küçük ve hızlı bir model seçmek maliyet ile
  gecikme kararıdır; önce eval ile ölçülür.

## 5. Açma sırası (kurucu kararı; hiçbiri ölçmeden açılmaz)

1. OpenAI kredisi yüklenir. Bu ortamdaki anahtar 09-23'ten beri `insufficient_quota` veriyor.
2. `RUN_REAL_EVAL=1 npm run eval -- tests/eval/stay-change.eval.test.ts` koşulur. Rapor
   `docs/olcum/stay-change-eval-<tarih>.md` dosyasına yazılır. Genelleme ölçüsü **yalnız `holdout`**
   satırlarıdır. Tek bir çağrı düşerse rapor GEÇERSİZ sayılır.
3. `AI_UNDERSTANDING_ENABLED=1` açılır: sorgu yeniden yazma ve anlama. Karar etkisi gölgede kalır.
4. `AI_STAY_GUARD_ENABLED=1` açılır: bekçi zorlar, gölgede değildir.
5. 1–2 hafta `RiskEvent.kbEvidenceJson.sc` izlenir: `v` ile `ev` farkı ve gereksiz taslak oranı.
6. `AI_STAY_POLICY=enforce` açılır.

Hepsi tek env ile geri alınır. Migration yok.

## 6. Doğrulanmış takvim gelince (Airbnb Direct)

Kural "iddia yasak" değildir. Kural, iddianın **yalnız doğrulanmış takvim sonucuyla eşleşmesi**dir.
Müsaitlik motorunun `verified` kararı `verifiedToolResults` olarak isteme girdiğinde:

* beyan `grants` ya da bekçinin izin hükmü, doğrulanmış sonuçla eşleşiyorsa geçirilir (ayrı dilim +
  golden set);
* anlama katmanının saat ve tarih yuvaları motorun sorgusu olur.

Sohbetteki "kalabilirsiniz" rezervasyonu değiştirmez. Uzatma, platform değişiklik talebinin
onaylanmasıyla kesinleşir; otomatik onay = V3 Aksiyonlar.

## 7. Bilinen sınırlar

* Model katmanları **ölçülmedi**: kredi yok. Bayraklar kapalı, kararlar gölgede.
* Beyan aynı modelden gelir; enjeksiyonla kandırılan üretici etiketini de yanlış yazabilir. Bu
  yüzden izin yönlü karar tek beyana dayanmaz. Bekçi ikinci, bağımsız hükümdür.
* Anlama katmanı küçük bilgi tabanında da koşar: sinyal retrieval'dan bağımsız değerlidir, ama
  maliyeti vardır.
* Önizleme yüzeyleri (Ayarlar testi, landing demo) bekçiyi çalıştırmaz. Beyan ve yedek aynıdır.
