# KAPANDI (2026-09-10) — Türkçe şikayet sınıflandırmasında olumsuz fiil boşluğu (bulgu 2026-09-08)

> **Durum 2026-09-10: KOD düzeyinde kapandı (yerel commit; push kurucu kararı).** Aşağıdaki ölçüm tablosu
> bulgunun o günkü hâlidir; yeni sözleşme ve kanıt "Kapanış" bölümünde. Bulgu metni tarihsel doğruluk için
> DEĞİŞTİRİLMEDİ.

> Nasıl bulundu: V1 QR canlı testi için örnek cümle seçilirken `classifyFallback` ölçüldü ve plandaki
> "Sıcak su gelmiyor, duş soğuk." cümlesinin `general` döndüğü görüldü. **Test cümlesini değiştirmek bu
> eksikliği KAPATMAZ** (Codex, 09-08): cümle değişikliği yalnız testin sessizce yanlış-yeşil olmasını önler;
> açığın kendisi burada AÇIK kalır. Düzeltme YAPILMADI (ayrı tur: kelime ağı değişikliği GOLDEN SET koşmayı
> ve dil paritesi kuralını gerektirir).

## Ölçüm (`src/lib/ai/fallback.ts` · `classifyFallback`, 2026-09-08)
| Girdi | Sonuç | Güven |
|---|---|---|
| "Sıcak su yok." | `complaint` | 0.7 |
| "No hot water." | `complaint` | 0.7 |
| **"Sıcak su gelmiyor, duş soğuk."** | **`general`** | 0.3 |
| **"Su akmıyor."** | **`general`** | 0.3 |
| **"Isıtma gelmiyor."** | **`general`** | 0.3 |
| **"Elektrikler gitti."** | **`general`** | 0.3 |
| **"Kapı açılmıyor."** | **`general`** | 0.3 |
| "Klima bozuk, çalışmıyor." | `complaint` | 0.7 |
| "Klimadan soğuk hava gelmiyor." | `amenity` | 0.55 |
| "İnternet gelmiyor." | `wifi` | 0.55 |

## Örüntü
Kelime ağı `çalışmıyo` / `bozuk` / `yok` kalıplarını yakalıyor; Türkçede en az onlar kadar yaygın olan
**olumsuz fiil biçimlerini** (`gelmiyor`, `akmıyor`, `açılmıyor`, `gitti`) yakalamıyor. Aynı şikayet, fiili
değişince sınıf değiştiriyor ("Sıcak su **yok**" → complaint; "Sıcak su **gelmiyor**" → general).
Dil paritesi de bozuk: İngilizce listede `no hot water` ve **`no heating`** var, Türkçe karşılığı
("ısıtma gelmiyor") yok — CLAUDE.md'deki "`SAFETY_CRITICAL_WORDS` ↔ `KEYWORDS.complaint` dil kapsamı paralel"
kuralıyla çelişiyor.

## Etki (kapsam dürüstçe)
1. **V1 sinyali:** `general` sinyal ÜRETMEZ (gürültü sayılır) → bu cümlelerle gelen gerçek şikayetler mülk
   hafızasına düşmez, örüntü sayacına girmez.
2. **AI güvenlik kapısı:** `classifyFallback` yalnız **çapraz kontrol/veto** tarafında kullanılır; asıl
   sınıflandırmayı model yapar (`source == openai`). Yani bu boşluk tek başına "şikayet oto-yanıtlandı"
   demek DEĞİLDİR — ama kelime ağının sağladığı ikinci savunma bu cümlelerde devrede olmaz.
3. **Fallback yolu (model yoksa/başarısızsa):** sınıflandırma tamamen kelime ağına düşer; orada bu cümleler
   `general` kalır.

## Düzeltme yapılmadı — nedeni ve tur şartı
Kelime ağına dokunmak `tests/unit/golden-scenarios.test.ts` (~105 senaryo) koşmayı, yeni sınıfa **hem tehdit
hem övgü-tuzağı** senaryosu eklemeyi ve dil paritesini birlikte gözden geçirmeyi gerektirir (CLAUDE.md kuralı).
Ayrıca `gelmiyor` gibi ekler olumsuzlama guard'larıyla (`REQUEST_NEGATIONS`, `hasUnnegatedProblemWord`)
etkileşir → "sorun yok / şikayetim yok" gibi olumlu kapanışları yanlışlıkla şikayet saymamak için ölçüm ister.
Bu, V1 canlı doğrulama turunun kapsamı dışındadır.

## Kalan iş (sahibi: AI kalite turu)
- [x] Olumsuz fiil ailesini (`gelmiyor`, `akmıyor`, `açılmıyor`, `gitti`, `kesildi`…) tesis
      adlarıyla birlikte değerlendiren kural + iki yönlü golden senaryolar. (`çekmiyor` BİLEREK dışarıda ↓)
- [x] Dil paritesi denetimi: İngilizce listedeki her kritik ifadenin Türkçe karşılığı var mı (`no heating`).
- [x] Ölçüm: yanlış-pozitif riski ("sorun yok", "şikayetim yok", "eksik bir şey yok") golden sette pinli.

## Kapanış (2026-09-10)

**Sözleşme** (`src/lib/ai/fallback.ts` `KEYWORDS.complaint`, "TÜRKÇE OLUMSUZ FİİL BOŞLUĞU" bloğu + `hasDeviceBreakdown`):
kalıplar **ÇAPALI** — tesis adı + olumsuz fiil ("su gelmiyo", "ısıtma gelmiyo", "elektrikler gitti", "kapı açılmıyo",
"sigorta attı"…; gövdeler "-yo" ile yazılır ki "gelmiyor" da "gelmiyo" da tutsun) + araya zarf giren doğal biçimler
("su hiç gelmiyo", "su hâlâ akmıyo", "kombi hiç yanmıyo", "elektrik hâlâ yok"). **Arıza ailesi CİHAZ KURALI:**
`bozuldu / bozulmuş / arızalı / arızalandı` yalnız aynı mesajda bir cihaz adı (klima, kombi, buzdolabı, makine, kilit,
ocak, fırın, duş, musluk, sifon, priz, televizyon, asansör…) varsa şikâyettir — çekimli cihaz ("klimamız") da sayılır,
"Hava bozuldu" / "Midem bozuldu" / "Planımız bozuldu" sayılmaz. Çıplak `gelmiyor / gitti / kesildi / su yok / arıza /
yanmıyor / bozuldu / blackout / no heat / elektrik yok / cereyan yok / ısınmıyor / elektrik kesintisi / power cut`
listeye GİRMEZ; her biri için tuzak cümle pinli. Elektrik kesintisi hiçbir dilde yoktu → TR + EN eklendi; DE/FR/ES/RU/AR
elektrik paritesi **borç** (`language-parity.test.ts` içinde `it.todo`, CLAUDE.md açık işler).

**İnceleme turu (09-10, ajan — kod-doğrulandı, ilk sürüm düzeltildi):** ilk sürümde altı kalıp çıplaktı ve ölçülen yanlış
pozitifler üretiyordu — "Hava bozuldu, bugün evde kalıyoruz" · "Midem bozuldu, en yakın eczane nerede?" · "Planımız bozuldu,
bir gün erken çıkacağız" (early_departure yerine complaint) · "Do you have blackout curtains?" · "Is there no heated pool?"
("no heat" ⊂ heated) · "Otoparkta elektrik yok mu, şarj için priz var mı?" · "Odada cereyan yok, rahat uyuduk" · "Yerden ısıtma
yok mu?" · "Havuz ısınmıyor mu?" · "Elektrik kesintisi olursa ne yapmalıyız?" · "Are power cuts common here?" · "There is no
water dispenser". Bedeli kodla gösterildi: oto-yanıt kapanır (`automation.ts` bekleyen mesaj taraması), konuşma "Sorunlu" + host'a
acil e-posta, `autoHoldingReplyEnabled` açıksa misafire özür mesajı, QR'da devir, V1 negatif sinyal → ≥3'te sahte PropertyMemory
örüntüsü. Hepsi tuzak olarak pinlendi (`TRAPS`), riskType satır başına TEK değerle pinlendi (gevşek `toContain` kalktı).
Kapsam boşlukları da kapandı: "Sıcak su hiç gelmiyor", "-yo" gövdesi, "Kapı sıkıştı", "Tuvalet tıkandı", "Lavabo tıkalı",
"Musluk damlatıyor" (EN "door is stuck / clogged / leaking" ikizleri TR'de yoktu).

| Girdi | 09-08 | 09-10 |
|---|---|---|
| "Sıcak su gelmiyor, duş soğuk." | `general` | `complaint` (sinyal complaint/negative/0.7) |
| "Su akmıyor." | `general` | `complaint` |
| "Isıtma gelmiyor." | `general` | `complaint` |
| "Elektrikler gitti." | `general` | `complaint` |
| "Kapı açılmıyor." | `general` | `complaint` (riskType `safety_emergency` — 🚨 kilit ağı DEĞİL: "açıl" ASCII katlamada "acil"e katlanır, `SAFETY_CRITICAL_WORDS` çıplak "acil" altdizi eşleşir; "Havuz ne zaman açılıyor?" da aynı — pre-existing çarpışma, ayrı iş #51) |
| "Klimadan soğuk hava gelmiyor." | `amenity` | `complaint` |
| "İnternet gelmiyor." | `wifi` | `wifi` (**bilinçli**: bilgi tabanından yanıtlanır) |
| "Yarın gelmiyoruz, ertesi gün geleceğiz." | `general` | `general` (tuzak, pinli) |

**Bilinçli kararlar:** (1) `İnternet gelmiyor` / `wifi çekmiyor` complaint DEĞİL — 08-07 gerekçesi geçerli
(complaint = oto-yanıt kapanır; wifi sorusu KB'den cevaplanır). (2) Övgü tuzağı olarak seçilen cümleler
mevcut ağlarla çakışmayacak biçimde ölçüldü: "Kapı kolayca açıldı" `safety_emergency` olur — sebep kilit ağı DEĞİL,
"açıl"→"acil" ASCII katlama çarpışması (inceleme 09-10 düzeltti; ayrı iş #51) — ve "kapı kodu" `checkin`e takılır;
bu ağlar bu turda GEVŞETİLMEDİ; tuzak "Giriş çok kolaydı, teşekkürler." oldu. (3) ASCII ikizi yazılmadı:
`includesAnyFold` kelimeyi de `foldTurkishAscii`den geçirir ("kapi acilmiyor" girdisi "kapı açılmıyor" kalıbıyla
eşleşir, test-pinli); eski `KEYWORDS` satırlarındaki ikizler dosya geleneği, işlevsel değil — ⚠️ `PROBLEM_NEGATIONS`
için GEÇERLİ DEĞİL (`hasUnnegatedProblemWord` düz `split`, ASCII katlamasız; oradaki ikizler işlevsel).
(4) Bitişik eşleşme (`allowWordGap=false`) KORUNDU: gevşetme ölçüldü — olumsuzlama parçacığını isminden koparıp
"No problem, the heating was great!" / "Yerden ısıtma da yok mu"yu da yakalıyor ve ESKİ listeyi de vuruyor; bunun yerine
çapalı zarf biçimleri eklendi; "Elektrikler dün gece gitti" / "Kapı bir türlü açılmıyor" bilinen sınır (pinli).
(5) Çözülmüş bildirim ("Sigorta attı ama kaldırdık, sorun yok") complaint kalır — ağ çözümü ayırt etmez, yön güvenli.
(6) Pre-existing çıplak "bozuk" ("Bozuk para var mı?") DOKUNULMADI (bu turun ekleri değil; ayrı karar).

**Kanıt:** `tests/unit/complaint-negative-verbs.test.ts` (sözleşme tablosu `CONTRACT` 31 satır — riskType satır başına
TEK değer — + tuzak tablosu `TRAPS` 29 satır + EN paritesi + bilinen sınır pinleri + V1 sinyal) ·
`tests/unit/golden-scenarios.test.ts` "TÜRKÇE OLUMSUZ FİİL ŞİKÂYETLERİ (09-10)" (tehdit + övgü-tuzağı çiftleri; inceleme
tuzakları dahil) · `tests/integration/qr-draft-vs-delivered.test.ts` "E6 KELİME AĞI İKİNCİ SAVUNMA" (model `general/none/0.9`
dese bile gerçek QR rotası devreder, `RiskEvent.reason = keyword_escalated`) · `language-parity.test.ts` elektrik/su
kesintisi/kapı satırları (TR+EN) + `it.todo` borç. **Kırmızı-önce:** inceleme paketi testleri HEAD'in `fallback.ts`ine
karşı 35 kırmızı (stash ile ölçüldü). **Mutasyon, iki tur:** ilk sürüm 13/13 (8 kaldırma + 5 aşırı-uygulama; "tek imlâyı
sil" eşdeğer çıktı → ASCII ikizi kaldırıldı; "bozuldu" kapsama boşluğu → test eklendi); inceleme sonrası 21 mutant
(9 kaldırma: cihaz kuralı kapalı · `arızalan` yok · "-yo" gövdesi yerine "-yor" · zarf çapası yok · kapı sıkış / tuvalet
tıkan / musluk damlat / elektrik hâlâ yok / there's a power cut yok · 12 aşırı-uygulama: çıplak bozuldu / blackout /
no heat / elektrik yok / ısıtma yok / ısınmıyor / elektrik kesintisi / power cut / cereyan yok / there is no water geri,
cihaz listesine "ev" ve "internet") — 20/21 ilk koşuda, "there's a power cut" mutantı EŞDEĞER çıktı (iki test cümlesi de
"power cut since" ile tutuyordu) → yalnız o kalıbı isteyen cümle eklendi → yakalandı; kontrol önce/sonra yeşil.

**Kapsam dürüstlüğü:** bu düzeltme kelime ağının İKİNCİ SAVUNMASINI onarır; modelin `general` dediği bir
şikâyeti artık QR ve oto-yanıt kapıları yakalar, V1 sinyali üretilir. Model yolundaki sınıflandırma kalitesi
(modelin kendisi) bu turda ÖLÇÜLMEDİ (gerçek koşu kurucunundur).

## İkinci inceleme turu (2026-09-10, ölçümlü ajan) — 25 kırmızı düzeltildi

İlk kapanış YETERSİZDİ. Ajan (salt-okuma, `npx tsx` probe'larıyla) iki yapısal kusur ve üç kapsam kaybı ölçtü.

### K1 — Cihaz kuralı iki yerden sızıyordu (P1)

**(a) Cihaz adı ALTDİZİ aranıyordu.** `foldTurkishAscii` iki tarafa da uygulandığı için cihaz adı BAŞKA kelimenin
içinde yakalanıyordu:

| Kelime | Katlanmış | Tetiklenen cihaz |
|---|---|---|
| değişiklik | degisiklik | ışık (isik) |
| düşün / düşük / düştü | dus… | duş |
| telefon, fonksiyon | telefon | fön (fon) |
| sürpriz | surpriz | priz |
| kutu, unutuldu | …utu… | ütü |
| kombine | kombi… | kombi |
| Ocak (ay adı) | ocak | ocak (pişirici) |

**(b) Fiil ∧ cihaz mesajın HERHANGİ bir yerinde olabiliyordu.** Ölçülen: "Klima harika. Ama planımız bozuldu,
erken çıkıyoruz." · "Ev çok güzel, tv büyük… Bu arada midem bozuldu, yakında eczane var mı?" → ikisi de `complaint`.

**Düzeltme:** cihaz adı **KELİME BAŞI** eşleşir (`startsWithAnyFold`, aynı üç katlama) **ve** fiil ile cihaz
**AYNI CÜMLECİKTE** olmalıdır (`CLAUSE_SPLIT`, virgül de böler). Çekimli biçimler ("klimamız", "makinesi",
"kombimiz") kelime başında olduğu için korunur. **BİLİNEN SINIR:** cihaz ile fiil ayrı cümleciğe düşen gerçek
şikâyet ("Buzdolabı çok gürültülü, sanırım bozuldu") bu ağdan kaçar — model yolu ve "çalışmıyor" gibi bağımsız
kalıplar ikinci savunmadır.

### K2 — KOŞUL kipi bildirim sayılıyordu (P1)

"Su gelmiyorsa ne yapmamız gerekiyor?" · "Kombi yanmıyorsa ne yapalım?" · "Buzdolabı arızalanırsa kimi arayalım?" ·
"Tuvalet tıkanırsa ne yapmalıyız?" — hiçbiri OLMUŞ bir arızayı bildirmiyor; bunlar oto-yanıtın **asıl işi** olan SSS
sorularıdır. `complaint` = `NEVER_AUTO_REPLY_INTENTS` olduğu için her biri oto-yanıtı kapatıp host'a acil e-posta
üretiyordu.

**Düzeltme:** `isConditionalClause` (3. şahıs koşul ekleri ‑ıyorsa/‑ırsa/‑erse/‑mazsa/‑masa/‑saydı + "eğer"), cümlecik
başına. Gerçek bildirim başka cümlecikteyse şikâyet KALIR ("Su gelmiyor, kesilirse haber verir misiniz?").
🚨 **Guard YALNIZ 09-10 kalıplarına uygulanır** (`NEGATIVE_VERB_COMPLAINTS`, `KEYWORDS.complaint`ten AYRI liste).
Eski ağa uygulamak DENENDİ ve golden set YAKALADI: **"Böyle giderse bir yıldız veririm"** (gerçek yorum tehdidi)
`general`e düşüyordu — "giderse" biçimsel olarak koşul ama cümle bir TEHDİT. Eski ağ DOKUNULMADAN bırakıldı.
1. şahıs koşul ("alamazsam") guard'a girmez.

### K3 — GÖVDE kalıpları kendi olumsuzlarını yakalıyordu (P1)

`"arızalan"` · `"tuvalet tıkan"` · `"kapı sıkış"` · `"musluk damlat"` gövdeleri OLUMSUZ ve türetilmiş biçimleri de
yakalıyordu: "Klima **arızalanmadı**, gayet iyi çalışıyor" · "Tuvalet **tıkanıklığı yok**" · "Kapı **sıkışmıyor**,
rahatça açılıyor" · "Musluk **damlatmıyor**, gayet iyi" — dördü de ÖVGÜ, dördü de `complaint`.
**Düzeltme:** olumlu TAM biçimler (`arızalandı/arızalanmış`, `tıkandı/tıkalı/tıkanıyor`, `sıkıştı/sıkışıyor`,
`damlıyor/damlatıyor`).

### K4 — Çapalama üç kapsam kaybı bırakmıştı (P2)

- `"no heat"` çıplaktı ("no heated pool" yakalıyordu) → SİLİNMİŞTİ; silinince "There is no heat in the flat." ve
  "No heat since yesterday" YANLIŞ NEGATİF kaldı → `no heat in/since/at all`, `there is/there's no heat`.
- Oda çapası dardı (yalnız dairede/evde/odada) → "Salonda elektrik yok", "Salonda ısıtma yok", "Yatak odası
  ısınmıyor" `general` idi → salon/mutfak/banyo/koridor/…odasında biçimleri eklendi.
- `PROBLEM_NEGATIONS` BELİRTME HÂLİNİ kaçırıyordu (pre-existing): "Hiçbir sorun yaşamadık" olumsuzlanıyor ama
  "Hiçbir **sorunu** yaşamadık" ŞİKAYET sayılıyordu — aradaki tek harf.

**Kanıt:** kırmızı-önce 25 düşen test (ölçülen cümlelerin tamamı `TRAPS`/`CONTRACT` tablolarına yazıldı); mutasyon
19 mutant (cihaz kuralının iki yarısı · virgül bölmesi · koşul guard'ı ve eki · guard'ın eski ağa taşınması ·
gövde/tam biçim · üç kapsam kaybı · yer tutucu daire/ad kuralları · QR ikinci taraması).
