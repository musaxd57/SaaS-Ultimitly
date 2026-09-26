# KURAL — "bilgim yok" misafire ASLA gitmez (kurucu, 2026-09-11)

> Durum: **UYGULANDI.** `src/lib/ai/absence.ts` + iki gönderim kapısı + E1 eval sözleşmesi.

## Kurucunun cümlesi

> *"müşteriye hiçbir zaman bilgim yok mesajı gitmemeli; bilgi yoksa da cevap gitmemeli.
> Host neden 'bilgim yok' mesajı göndersin ki?"*
>
> *"kesinlikle öyle yazmıycak … hiçbir şekilde bilgim yok yazamaz. AI'ı o kadar gelişmiş
> yapmalıyız ki zaten ona gerektirecek yer bırakmamalıyız."*

## Ölçülen davranış (değişiklikten ÖNCE)

2. gerçek model koşusu (09-09, `7ohi`), senaryo E1 (boş bilgi tabanı, "Otopark var mı?"):

| Alan | Değer |
|---|---|
| Güven | **0.80** |
| Kaynak (beyan/doğrulanan) | **0 / 0** |
| Cevap | *"Otopark konusunda kayıtlı bilgim yok; mesajınız kaydedildi, ev sahibiniz görebilir."* |
| Kapı | ≥0.75 → **GEÇTİ** → misafire **gitti** |

Kapı yalnız **karar girdilerine** (intent · riskLevel · riskType · güven) bakıyordu; cevabın
**dayanağına** hiç bakmıyordu. `unsourced_claim` kontrolü vardı ama **yalnız 0.45–0.75 bandında**.

## Neden kurucu haklı

O cevabın iki parçası var:

1. *"bu bilgi bende yok"* → misafire **hiçbir işe yaramıyor**
2. *"mesajınız kaydedildi, ev sahibiniz görebilir"* → bu zaten **devir metninin kendisi**
   (`escalationReply()`)

Yani model, devir metnini taklit edip başına işe yaramaz bir cümle ekliyordu. **Devretmek hem
misafir için daha iyi hem host için AYNI sonuç.**

## Uygulanan kural

```
cevap bilginin KAYITLARDA olmadığını AÇIKÇA söylüyorsa → MİSAFİRE GÖNDERİLMEZ
```

| Yüzey | Sonuç |
|---|---|
| Kanal (Airbnb/Booking) | `passesAutoReplySafetyGate` → `false` → **hiç mesaj gitmez**, konuşma host'un gelen kutusuna düşer |
| QR (halka açık) | `evaluateEscalation` → `absence_admission` → misafir **deterministik devir metnini** alır ("Mesajınız kaydedildi; ev sahibiniz sohbet ekranından görüntüleyebilir"), konuşma `urgent` |

## 🚨 İSTEM KURALI KALDIRILMADI — bilinçli

`prompts.ts` KURAL-3 ve KURAL-5 modele temellendiremediğinde yokluk söylemesini **emreder**.
Bu kural **UYDURMAYI ENGELLEMEK** için vardır. Silinseydi model temellendiremediğinde bir şey
**UYDURURDU** — işe yaramaz bir cevaptan **çok daha kötü**.

Kural istemde kalır (model dürüst davranmaya devam eder), **gönderim kapıda kapanır**. Bu ayrıca
fail-safe'i doğru yöne kurar: kapı bir gün delinirse misafir **bozuk bir belirteç değil, dürüst
bir cümle** görür.

## 🚨 Ölçüt "kaynak yok" DEĞİL, cevabın KENDİ itirafı

`usedSources` yalnız **KB kalemlerini** sayar. Giriş/çıkış saati **mülk alanından** gelir:

```
"Giriş saati 15:00, çıkış saati 11:00."   usedSources = []   ama cevap DAYANAKLI
```

"Kaynak yoksa devret" deseydik ürünün **en sık sorusu** kırılırdı. Test-pinli.

## ⚠️ Savuşturma yokluk itirafı DEĞİLDİR

Bunlar kapıya takılmaz (bilinçli — kapı gereksiz yere geniş tutulmadı):

```
"Otopark konusunda ev sahibiniz yardımcı olabilir; mesajınız kaydedildi."
"Bu konuyu ev sahibinizle konuşabilirsiniz."
```

Savuşturma **ayrı bir sorundur** ve gerçek koşuda ölçüldü: `gpt-5.6-luna` legacy modda R1/R3/R7'de
tam bunu yapıyordu ("ev sahibinizle iletişime geçebilirsiniz"). Ayrı tur.

## TEK KAYNAK — eval ürünle ayrışamaz

`tests/helpers/absence-detector.ts` yalnız **yeniden-dışa-aktarımdır**. Ayrı listeler tutulsaydı
eval, ürünün **göndermeyeceği** bir cevabı "geçti" sayabilirdi. Bu tam olarak 09-11 öncesi
durumdu: aynı liste iki eval harness'ında ayrı yazılmıştı ve **biri bayattı**.

## E1 eval sözleşmesi TERS ÇEVRİLDİ

| | 09-09 | 09-11 |
|---|---|---|
| Alan | `acknowledgesAbsence: true` | `notDeliverable: true` |
| Ölçtüğü | yokluk beyanı **ÖDÜLLENDİRİLİR** | o metnin **GÖNDERİLMEMESİ** |

Dataset'in `changed` alanında gerekçesiyle yazılı — sessiz gevşetme yok.

## Asıl çözüm: Knowledge Hub

Kurucunun kendi teşhisi doğru: *"AI'ı o kadar gelişmiş yapmalıyız ki zaten ona gerektirecek yer
bırakmamalıyız."* Bu kapı **semptomu** kesiyor; **sebebi** kesen iş Knowledge Hub'dır:

| Parça | Durum |
|---|---|
| `source=extracted_draft` · `reviewState=draft/approved` şeması | ✅ canlı (migration 53) |
| Taslak modele ULAŞAMAZ (host onaylayana kadar) | ✅ tek kapı `kb-review.ts` |
| Metinden LLM'siz çıkarım + önizleme | ✅ `kb-extract.ts` (A5) |
| Eksik bilgi tespiti (gerçek sorulardan) | ✅ `kb-gaps.ts` (A3) |
| Çok mülklü hafıza | ✅ `PropertyMemory` (V1) |
| **Hibrit retrieval** (ölçek için ŞART) | ✅ kodlandı, **bayrak kapalı** — 09-11 gerçek koşusu: gold istemde legacy 3/8 → hibrit **7/8**, blok 3578 → **740** karakter |
| ❌ Airbnb ilan açıklamasından çıkarım | YOK |
| ❌ Geçmiş host cevaplarından çıkarım | YOK (`docs/DEGERLENDIRME-2026-09-11-gecmis-cevap-yeniden-kullanimi.md`) |
| ❌ PDF guidebook yükleme | YOK |

## 🚨 YÜKLEM YENİDEN YAZILDI (aynı gün, inceleme ajanı + bağımsız doğrulama)

İlk sürüm düz bir kalıp listesiydi. **İKİ YÖNDE DE ölçülerek kırıldı** (iddialar bağımsız
tekrarlandı: 9/9 yanlış pozitif ve 15/15 kaçak birebir üretildi):

| | ÖNCE | SONRA |
|---|---|---|
| İşe yarar cevabı bloklama (67'lik batarya) | **18 (%27)** | **0** |
| Gerçekçi yokluk ifadesini kaçırma (38'lik batarya) | **29 (13'ü YÜKSEK olasılıklı)** | **0** |

**Ölçülen dört kusur:**
1. `\bno` sağ sınırı YOKTU → "**No**thing extra is needed; the information…" ·
   "**No**te: all the check-in information…" · "no extra charge; the information pack…"
2. Çıplak `not listed` → "The pool is **not listed** as closed, it is open 09:00-20:00."
3. `kayıtlı…bilgi` OLUMLU bir Türkçe kalıptır → "**Kayıtlı** rezervasyon **bilgi**leriniz doğru."
4. 🚨 `toLocaleLowerCase("tr")` **İngilizceyi bozuyordu**: Türkçe yerelde büyük `I` → `ı`, yani
   "I have no **I**nformation" → "ı have no **ı**nformation" → KAÇIYORDU.

**Yeni yapı kalıp listesi DEĞİL, dilbilgisi:** bir BİLGİ NESNESİ (bilgi/kayıt/veri/not/detay/belge ·
information/record/detail/data/note) + bir YOKLUK YÜKLEMİ, aralarında SINIRLI mesafe.
- `yok` nesneye **BİTİŞİK** olmalı (≤1 kelime) — yoksa "sorun yok" / "görevli yok" gibi Türkçenin
  en yaygın nezaket kapanışları yokluk itirafı sayılıyordu.
- **Cümle sınırı boşluğu keser** ("There is no smoking. Details are in the rules." ≠ yokluk), ama
  `15.00` **bölünmez** — eski `[^.!?]` sınıfı tam tersini yapıyor ve Türkçe saat yazımı yüzünden
  gerçek bir yokluk cümlesini kaçırıyordu.
- **İKİ KATLAMA** (`foldTurkishLower` + `foldTurkishLowerTr`, projenin `includesAnyFold` doktrini).
  İkisi de yük taşıyor ve ayrı ayrı pinli: `BILGIM YOK` (ASCII I) yalnız standart okumada,
  `KAYITLI DEĞİL` / `BULAMADIM` yalnız tr okumasında çözülür.
- ⚠️ **Belirsizlik ve savuşturma BİLİNÇLİ dışarıda:** "emin değilim" netleştirme sorusuyla aynı
  kalıbı paylaşıyor ("Sorunuzu tam anladığımdan emin değilim, hangi tarihten bahsediyorsunuz?") —
  bloklamak ürünün MEŞRU davranışını keserdi. `confirm` de çapa ister.

## 🚨 ÖNİZLEME PARİTESİ (ölçülmüş ikinci kusur)

`api/ai/test` ve `api/demo/ai` kapıyı çağırıyor **ama `reply` alanını VERMİYORDU** (alan opsiyonel →
ne derleme ne test uyarıyordu). Sonuç: gerçek gönderici bu cevabı BLOKLARKEN Ayarlar kartı ve landing
rozeti *"kendiliğinden gönderilirdi"* diyordu — iki rotanın da kendi yorumundaki "the exact production
gate" / "must state what the product would truly do" iddiasının ihlali. İkisi de bağlandı, davranışsal pinli.

## Kanıt

Kırmızı-önce **2 + 4 blok** (kapı satırları geçici devre dışı bırakılıp ölçüldü; ikinci turda tam
olarak yeni/çevrilmiş 4 assert düştü) · **mutasyon 22/22** (kaldırma 9 · aşırı uygulama 7 · katlama 3 ·
parite 2 · tek kaynak 1) · tam kapılar yeşil.
⚠️ İlk mutasyon koşusunda **kontrol KIRMIZIYDI** ve sonuçlar geçersizdi (bir eval pini eski hata
metnini arıyordu); düzeltilip tekrarlandı — CLAUDE.md'nin M0 kuralı bir kez daha işe yaradı.
Sonraki koşuda iki mutant HAYATTA KALDI ve ikisi de gerçek pin eksiğini gösterdi: `yok` mesafesi
(ötekilerde kararı noktalama veriyordu) ve tr katlaması (İ'li örnekler ayrımı göstermiyor).
