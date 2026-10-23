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

**Düzeltme (2. tur):** cihaz adı **KELİME BAŞI** eşleşir (aynı üç katlama) **ve** fiil ile cihaz **AYNI
CÜMLECİKTE** olmalıdır. Çekimli biçimler ("klimamız", "makinesi", "kombimiz") kelime başında olduğu için korunur.
⚠️ **CÜMLECİK ŞARTI 3. TURDA GERİ ALINDI** — o "bilinen sınır" sanılan şey aslında şikâyetin OLAĞAN biçimiydi
(§ Üçüncü tur).

### K2 — KOŞUL kipi bildirim sayılıyordu (P1)

"Su gelmiyorsa ne yapmamız gerekiyor?" · "Kombi yanmıyorsa ne yapalım?" · "Buzdolabı arızalanırsa kimi arayalım?" ·
"Tuvalet tıkanırsa ne yapmalıyız?" — hiçbiri OLMUŞ bir arızayı bildirmiyor; bunlar oto-yanıtın **asıl işi** olan SSS
sorularıdır. `complaint` = `NEVER_AUTO_REPLY_INTENTS` olduğu için her biri oto-yanıtı kapatıp host'a acil e-posta
üretiyordu.

**Düzeltme (2. tur):** 3. şahıs koşul ekleri (‑ıyorsa/‑ırsa/‑erse/‑mazsa/‑masa/‑saydı + "eğer"), **cümlecik**
başına. ⚠️ **CÜMLECİK KAPSAMI 3. TURDA EŞLEŞMEYE BAĞLANDI** (§ Üçüncü tur).
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

---

## Üçüncü inceleme turu (09-11, ölçümlü ajan) — 2. turun cümlecik şartı GERİLEMEYDİ

### Ü1 — CÜMLECİK şartı gerçek bildirimlerin çoğunu düşürüyordu (P1, gerileme)

Ölçüm: 44 gerçekçi arıza bildiriminin **30'u** 2. turdan sonra `complaint` olmaktan çıktı. Sebep dilbilgisel —
Türkçede cihaz **nesne** olarak ilk cümlecikte, fiil ikincide durur:

| Mesaj | 2. tur öncesi | 2. tur sonrası |
|---|---|---|
| Klimayı açtık, bozuldu. | complaint | amenity |
| Buzdolabını kontrol ettim, tamamen bozulmuş. | complaint | amenity |
| Kombiye baktım, arızalı görünüyor. | complaint | general |
| Şofbeni açtık, arızalandı. | complaint | general |

🚨 **Bedel sınıflandırmada kalmıyordu:** `passesAutoReplySafetyGate` (model `amenity / low / 0.9` ile) bu üç
bildirime **OTO-GÖNDERİM İZNİ** veriyordu; 2. tur öncesi üçü de bloklanıyordu. Yani daraltma, ürünün çekirdek
güvenlik vaadini gerçek bir girdi sınıfında deliyordu.

**Düzeltme:** cümlecik şartı KALDIRILDI, yerine iki DAR kapı:

1. **ÖZNE KURALI** — fiilin HEMEN SOLUNDAKİ belirteç cihaz-dışı bir özneyse şikâyet değil.
   ⚠️ İlk hâli 11 kelimelik bir ALLOWLIST'ti; **4. tur bunun sınıfı kapatmadığını ölçtü** ve kuralı
   VARSAYILAN RET'e çevirdi (§ Dördüncü tur).
2. **ÇEKİM DOĞRULAMASI** — cihaz adından sonra yalnız çekim eki dizisi gelebilir ([çoğul][iyelik][hâl]); türetme eki
   yeni bir SÖZCÜK kurar ve elenir:

| Kelime | Cihaz öneki | Kalan | Sonuç |
|---|---|---|---|
| kapıcı | kapı | cı | türetme → RET |
| kapitalizm | kapi (ASCII) | talizm | RET |
| makineli | makine | li | türetme → RET |
| ocakbaşı | ocak | başı | RET |
| fonksiyon | fon (ASCII) | ksiyon | RET |
| klimayı / ütüyü | klima / ütü | yı / yü | çekim → KABUL |
| makinesini | makine | sini | çekim → KABUL |

🚨 İki kapı **birlikte** gerekir: "kombine" dilbilgisel olarak `kombi+n+e`dir (2. tekil iyelik + yönelme,
"kombine baktım") → çekim kapısı eleyemez; onu özne kuralı ("bilet") eler.

### Ü2 — KOŞUL kipini CÜMLE değil FİİL taşır (P1, gerileme)

Cümlecik kapsamlı guard, 24 gerçek bildirimin **17'sini** düşürüyordu, çünkü "eğer" çoğu zaman eşleşmeden SONRA
gelir: *"Su gelmiyor **eğer** akşama kadar düzelmezse otele geçeceğiz"* — bu bir BİLDİRİM + tehdit, SSS sorusu değil.

**Düzeltme:** guard yalnız eşleşmenin HEMEN ARDINDAKİ eke bakar (`^[ry]?s[ae]` = ‑sa/‑se, kaynaştırmalı ‑rsa/‑ysa):
"gelmiyor" bildirim, "gelmiyor**sa**" koşuldur. Serbest "eğer" artık hüküm vermez. Her GEÇİŞ ayrı okunur (ilk geçiş
koşul, ikincisi bildirim ise şikâyet kalır). **Bilinen sınır (pinli):** ayrı yazılan "ise" (*"Eğer su gelmiyor ise"*)
bildirim sayılır.

`CLAUSE_SPLIT` tamamen kalktı — `\n` bacağı zaten ÖLÜYDÜ (`normalizeForMatch` satır sonunu boşluğa indiriyor, yani
bölme hiç görmüyordu; ölçüldü).

### Ü3 — Mutasyonun gösterdiği ÖLÜ KOD (silindi, geri getirilmeyecek)

- `N_BUFFERED_CASE` + `LEXICAL_POSSESSIVE_DEVICES` ("buzdolabı+nı" için yazılmıştı): n ile başlayan hâl eklerinin
  TAMAMI (nı/ni/na/ne/nda/nde/ndan/nden/nın/nin) zaten 2. tekil iyelik dalından ("n" + hâl) geçiyor.
- "Fiil okumalarından koşul taşımayanı tercih et" dalı: arıza fiilleri tam biçim ve birbirinin öneki değil, üç
  katlama da aynı kuyruğu verir → bir belirteç tek okuma üretir, dal ULAŞILAMAZ.
- 🚨 "ASCII bacağını yalnız Türkçe harf taşımayan belirteçte dene" kapısı: `matchCandidates`in `stripCombining`
  adayı (görünmez-işaret saldırı sınıfı için VAR ve kaldırılamaz) metni zaten diakritiksiz sunuyor → kapı yalnız
  KORUMA YANILSAMASI olurdu. Çarpışmaları eleyen şey çekim doğrulamasıdır. Bilinen sınır pinli: "Tatil düşümüz
  bozuldu." complaint kalır ("dus"+"umuz" geçerli bir çekimdir).

**Kanıt:** kırmızı-önce 27 düşen test + ayrı oto-yanıt kapısı bloğu (2 kırmızı: bildirim oto-gönderiliyordu, masum
cümle bloklanıyordu). Mutasyon **21/21** — ilk koşuda 3 mutant hayatta kaldı ve **üçü de gerçek boşluk gösterdi**:
ikisi yukarıdaki ölü kodu (silindi), biri 3. kişi iyelik dalının test setinde hiç yüklenmediğini ("Kahve makinesi
bozulmuş." satırı eklendi). Fiilin de kelime BAŞINDA aranması iki yönlü pinli: bitişik yazımda ("klimabozuldu")
ayrıştırma YAPILMAZ, çünkü altdizi araması özneyi de yutardı ("Klima harika ama planımızbozuldu.").

---

## Dördüncü inceleme turu (09-11, ölçümlü ajan) — allowlist sınıfı kapatmıyordu

### D1 — 11 kelimelik özne listesi yanlış-pozitif sınıfını kapatmıyor (P1)

Tur 3, cümlecik şartını kaldırırken yerine `NON_DEVICE_SUBJECTS` adlı 11 kelimelik bir allowlist
koymuştu. Ölçüm: mesajında gerçek bir cihaz adı geçen **30 gerçekçi misafir mesajının 24'ü** hâlâ
yanlış `complaint` oluyordu — çünkü Türkçede fiilin solunda durabilecek özne sınırsızdır:

| Mesaj | Özne | Eski sonuç |
|---|---|---|
| Klima süper. **Taksimiz** bozuldu, biraz geç geleceğiz. | taksi | complaint ✗ |
| Televizyon kocaman… **Bavulumuz** bozuldu, tamirci önerir misiniz? | bavul | complaint ✗ |
| Fırın harika, ama **tatilimiz** bozuldu. | tatil | complaint ✗ |
| Ütü buldum teşekkürler, **uyku düzenimiz** bozuldu sadece. | düzen | complaint ✗ |
| Mikrodalga var mı? **Yemeğin tadı** bozuldu çünkü. | tat | complaint ✗ |

Liste uzatmak bu sınıfı kapatmaz; her yeni kelime yeni bir kaçak bırakır.

🚨 İkinci kusur: **tek bir ZARF kuralı devre dışı bırakıyordu.** Kural yalnız `toks[i-1]`e bakıyordu,
yani "Planımız **tamamen** bozuldu" / "**galiba**" / "**dün gece**" varyantlarının 17'sinin 16'sı
kuralı deliyordu — ve hiçbir test bunu görmüyordu (tüm pinler özne↔fiil bitişik biçimdeydi).

**Düzeltme — VARSAYILAN RET:** fiilin solunda bir ÖZNE varsa ve o özne CİHAZ DEĞİLSE bildirim
sayılmaz. Özne YOKLUĞU iki biçimden anlaşılır: sol komşu çekimli bir FİİL/ULAÇtır ("Klimayı
**açtık**, bozuldu") ya da fiil cümlenin başındadır. Araya giren ZARF/BAĞLAÇ atlanır ve ASIL özneye
bakılır. Ölçüm (aynı bataryalar): **yanlış pozitif 24 → 2**, kaçırılan gerçek bildirim **0**.
⚠️ **BU SAYILAR O BATARYAYA AİTTİR** (5. tur düzeltmesi): bağımsız bir batarya, aynı kuralın
15 gerçek bildirimi düşürdüğünü ölçtü (§ Beşinci tur). "Sınıf kapandı" denemez; "o bataryada
24 → 2" denir.

Kalan iki yanlış pozitifin ikisi de dilbilgisiyle çözülemez ve ikisi de pinli:
- "…biraz **gürültüden**" → complaint'i üreten şey cihaz kuralı değil, önceden var olan "gürültü"
  kelimesi (ölçüldü: kelime çıkınca `amenity`).
- "Saç kurutma **makinemiz** bozuldu" → misafirin KENDİ cihazı; "klimamız bozuldu" ile AYNI eki
  taşır, ayırt edici bir dilbilgisi sinyali yoktur. Yön güvenli (insana devir).

**Liste ölçülerek küçüldü (11 → 8) ve ADI DEĞİŞTİ** (`VERBLIKE_NOUN_OVERRIDES`): varsayılan-RET
gelince plan/hava/mide/uçuş/program/rezervasyon/telefon girdileri ÖLÜ kaldı. Geriye yalnız Türkçenin
gerçek EŞSESLİLİĞİ kaldı — t/d ile biten ismin 3. tekil iyeliği geçmiş zamanla aynı yazılır:
`saat+i` ≡ "‑ti", `tad+ı` ≡ "‑dı", `cild+im` ≡ "‑dim", `fiyat+ı`, `moral+im`, `bilet+i`.

### D2 — Ünsüz yumuşamasında beş gövde daha eksikti (P1, kapı etkisi ölçüldü)

Tur 3 yalnız "kilid"i eklemişti. Ölçüm: 17 yumuşamış biçimin 13'ü kaçıyordu ve
`passesAutoReplySafetyGate` gerçek bildirimlere **oto-gönderim izni** veriyordu:

```
🚨 OTO-GÖNDERİLİR  Musluğu açtık, bozuldu.
🚨 OTO-GÖNDERİLİR  Mutfaktaki ocağı denedim, bozulmuş.
🚨 OTO-GÖNDERİLİR  Ocağı yakamadık, arızalı.
   bloklanır       Kilidi çevirdim, bozuldu.
```
Sınıf kapatıldı: `ocağ · musluğ · bulaşığ · peteğ · ışığ` + `dolap/dolab`. Ayrıca cihazın PARÇASI da
cihazdır (`motor`: "Bulaşık makinesinin **motoru** bozuldu").

### D3 — "fön" ölçülüp ÇIKARILDI

ASCII katlamada "fon" olduğu için beş gerçek sözcüğü cihaz sayıyordu (fonda · fonu · fonum · fonlar ·
fondan) ve karşılığında hiçbir şey kazandırmıyordu: "fön makinesi" zaten `makine` ile yakalanıyor.

### D4 — Üç TRAP satırı iddia ettiği kapıyı SINAMIYORDU (P2, sahte yeşil)

`INFLECTION_ONLY`yi tamamen açan mutantla ölçüldü: "Ocakbaşı restoranda **midem** bozuldu",
"Fonksiyon tuşları derken **planımız** bozuldu", "Uçuşu düşünürken **planımız** bozuldu" satırlarında
kararı özne kuralı veriyordu — çekim kapısı silinse bile satır yeşil kalırdı. Çekim kapısını YALNIZ
BAŞINA sınayan satırlar eklendi (sol komşu çekimli bir fiil, yani özne yuvası AÇIK):
`Kapıcıyı aradık, bozuldu.` · `Kapitalizmi tartıştık, bozuldu.` · `Ocakbaşını denedik, bozuldu.` ·
`Fonksiyonları inceledik, bozuldu.`

### D5 — Ek pinler

- **Eksiz yüklem** (`var`/`yok`/`değil`): "Buzdolabı **var** ya, bozulmuş." çekim eki taşımaz ama
  fiil yerindedir — bu olmadan gerçek bildirim düşüyordu.
- **Şimdiki zaman KİŞİ ekleri** (‑yoruz/‑yorum): "Musluğu **kapatamıyoruz**, bozuldu."
- **Bilinen sınır, iki yönlü pinli:** soru biçimi ("Klima bozuldu **mu** diye merak ettim") şikâyet
  sayılır — ağ sözdizimi bilmez; yön güvenli (aşırı eskalasyon), karşı yön ("bozulur mu") temiz.

**Kanıt:** kırmızı-önce 26 düşen test; **mutasyon 26/26** (ilk koşuda 1 hayatta kaldı — fiilin kelime
başı şartı; doğal ayırt edici bulundu: bitişik yazımda altdizi araması İÇERİDEKİ özneyi yutuyor,
"Klimayı açtık, günümüzbozuldu."). Tam kapılar yeşil. Migration YOK, ücretli servis YOK.

---

## Beşinci inceleme turu (09-11, ölçümlü ajan) — özne yuvasının üç kör noktası

### B1 — "özne var + cihaz değil → RET" varsayılanı 15 gerçek bildirimi düşürüyordu (P1, gerileme)

Bağımsız batarya, `c4b32b7` (özne kuralı ÖNCESİ) ile birebir kıyas:

| Sınıf | Mesaj | 4. tur | c4b32b7 |
|---|---|---|---|
| iyelik zinciri | Klimanın fanı bozuldu, çok ses yapıyor. | amenity | complaint |
| iyelik zinciri | Mutfaktaki fırının kapağı bozulmuş. | amenity | complaint |
| iyelik zinciri | Kapı kilidinin dili bozulmuş. | general | complaint |
| zarf öbeği | Kombi bu sabah bozuldu. | general | complaint |
| zarf öbeği | Kombi iki gündür bozuldu. | general | complaint |
| zarf öbeği | Kombi saat üçte bozuldu. | general | complaint |
| zarf öbeği | Kombi öğleden sonra bozuldu. | general | complaint |
| niceleyici | Prizlerin ikisi bozuldu. | general | complaint |
| ulaç | Klimayı açınca, bozuldu. | amenity | complaint |
| ulaç | Klimayı kullandıktan sonra, bozuldu. | amenity | complaint |

🚨 Hepsi `passesAutoReplySafetyGate`te **OTO-GÖNDERİLİR** yönüne geçmişti — yani 3. turun kapattığı
sınıfın aynısı, başka dilbilgisel biçimlerde.

**Düzeltme — üç DAR kapı (liste değil, BİÇİM):**

1. **İYELİK ZİNCİRİ.** 3. tekil iyelikli bir ad, solundaki TAMLAYANIN parçasıdır; tamlayan cihazsa
   bildirim cihaz hakkındadır. İki dal: tamlayan eki AÇIK ("klimaNIN fanı") ve BELİRTİSİZ tamlama
   ("klima kumandası"). 🚨 Zincir FİİL testinden ÖNCE bakılır: "babamın SIHHATİ" biçimsel olarak
   "‑ti" fiil ekine benzer ve yanlış complaint üretiyordu; zincir tamlayanı cihaz olmadığı için
   REDDEDER. Karşı yön pinli: "sütün tadı" · "çocuğumuzun keyfi" · "valizimizin tekerleği" ·
   "valiz tekerleği" (3. tekil iyelik TEK BAŞINA yetmez).
2. **ZARF ÖBEĞİ BİÇİMDEN.** Zaman ve sayı KAPALI sözcük sınıflarıdır; 58 kelimelik liste
   "bu sabah"ı kaçırıyordu. 🚨 **Zarf çekimi İYELİK ALMAZ** — "öğleDEN/üçTE/günLERCE" zarf,
   "günÜMÜZ/geceMİZ" ÖZNEdir; tam çekim tablosu kullanmak "günümüz bozuldu"yu yanlış complaint
   yapıyordu → ayrı ek kümesi (`ADVERBIAL_SUFFIX`).
3. **ULAÇ EKLERİ.** `‑ınca · ‑dığında · ‑dıktan · ‑madan` eksikti. Ayrıca **MASTAR dalı
   (`‑mak/‑mek`) ÇIKARILDI**: "yemek/ekmek" gerçek isimlerdir ve fiil sanılıyordu.

Sonuç (aynı bataryalar): 15 gerileme → **0**; yanlış pozitif bataryası 2/36 (ikisi de önceden
belgelenmiş, dilbilgisiyle çözülemez sınıf); kaçırılan bildirim 0/38.

### B2 — `apartmentNumberOf` iki YANLIŞ ÇIKTI daha

- **Etiket önceliği yoktu:** `No:12 D:5` → **"12"** (bina numarası). "no/#" ZAYIF etikettir; güçlü
  etiket (`daire/apartment/apt/D:`) önce denenir → "5". `No 7 Daire 3` → "3".
- 🚨 **Sayısız adda MÜLK ADININ TAMAMI dönüyordu** ve doğrudan ikame ediliyordu: "Cozy Seaside Flat"
  adlı mülkte KB'deki `Kapı kodu: {daire}` satırı misafire **"Kapı kodu: Cozy Seaside Flat"** olarak
  gidiyordu → artık `null` (belirteç görünür kalır).
- **Sayaç sözcüğü listesi KORUNDU** (bare "oda/kat/banyo" dahil): ölçülen dört vakada yön GÜVENLİ
  (`null` → belirteç görünür), uydurma numara söylemekten iyidir. Bilinen bedel: "Lale 3 Oda
  Servisi" gibi adlarda ikame yapılmaz.

**Kanıt:** kırmızı-önce 25 düşen test; **mutasyon 26/26** — iki mutant hayatta kaldı ve ikisi de
gerçek boşluk gösterdi: niceleyici sözcük listesi ÖLÜYDÜ (silindi, "hepsi/ikisi" zincirden geçiyor)
ve belirtisiz tamlama dalı ("klima kumandası") PİNSİZDİ (satır eklendi).

---

## Altıncı inceleme turu (09-11, DÖRT paralel ölçümlü ajan) — satır satır denetim

Dört ajan ayrı kapsamda koştu (kod akışı · yer tutucu/QR yolu · test kalitesi · belge doğruluğu),
hepsi salt-okuma. Bulguların tamamı ana oturumda YENİDEN ÖLÇÜLDÜ; ikisi reddedildi.

### A1 — Görünmez karakter `sorun/problem` ağını deliyordu (P1, oto-gönderim)

```
complaint  "Dairede bir sorun var."
general    "Dairede bir so<U+00AD>run var."     ← SOFT HYPHEN, oto-gönderilir
general    "There is a pro<U+00AD>blem in the flat."
complaint  "Su ge<U+00AD>lmiyor."   ← diğer bacaklar DAYANIKLI
complaint  "Klima bo<U+00AD>zuldu."
```
Bu, dosyanın `normalizeForMatch` başlığında KENDİ belgelediği bypass sınıfıdır; düzeltme
`includesAnyFold`a ve 09-10/09-11 turlarında öteki bacaklara uygulanmış, `hasUnnegatedProblemWord`
ATLANMIŞTI. **Düzeltme:** normalize edilmiş ÜÇÜNCÜ okuma OR'landı — yalnız EŞLEŞME EKLER.
⚠️ HAM okumalar YERİNDE: normalizasyon olumsuzlama kontrolüne uygulanmaz (katlama kuralı), yani
"Sorun  yok" (çift boşluk) complaint kalır — aşırı eskalasyon, güvenli yön, artık **pinli**.

### A2 — İzafet/tamlama biçimleri komple kaçıyordu (P1, oto-gönderim)

| Çıplak yalın (listede) | Tamlama (Türkçenin OLAĞAN biçimi) |
|---|---|
| "Musluk akmıyor." complaint | "Mutfak **musluğu** akmıyor." general ✗ |
| "Ocak yanmıyor." complaint | "Mutfak **ocağı** yanmıyor." general ✗ |
| "Lavabo tıkandı." complaint | "Banyo **lavabosu** tıkandı." general ✗ |
| "Sifon çekmiyor." complaint | "Tuvalet **sifonu** çekmiyor." general ✗ |
| "Petek ısınmıyor." complaint | "Oda **peteği** ısınmıyor." general ✗ |

17 çiftin 17'si düşüyordu, 14'ü oto-gönderiliyordu. 4. tur `BREAKDOWN_DEVICES`e yumuşama gövdelerini
eklemişti ama KARDEŞ LİSTE (`NEGATIVE_VERB_COMPLAINTS`) 1. turun donmuş tasarımında kalmıştı — aynı
cihaz "bozuldu" ile complaint, "akmıyor" ile general. İzafet + çoğul kalıpları eklendi.
⚠️ **BİLİNEN SINIR:** bu bacak hâlâ KALIP tabanlı; yazılmamış her tamlama kaçar. Cihaz kuralının
belirteç/çekim mekanizmasıyla birleştirme ayrı tur ister.

### A3/A4 — "ve" bağlacı ve kesme işareti (P1, oto-gönderim)

- `SUBJECT_SLOT_FILLERS`te `de·da·ama·ancak·fakat·ya` vardı, **"ve" YOKTU** → "Klimayı açtık **ve**
  bozuldu." özne sanılıp reddediliyordu (6/6 kaçak, 6/6 oto-gönderilir).
- `WORD_SPLIT` kesmede bölüyordu → "Klima'mız bozuldu." belirteçleri `["Klima","mız","bozuldu"]`,
  özne yuvasında ÖKSÜZ EK duruyor, cihaz adı kayboluyor (5/5 oto-gönderilir). Kesme artık kelime
  İÇİNDE **silinir** (`deviceTokens`); ayıraç okuması `matchCandidates`in `splitApostrophes`
  adayında zaten var.
- Gereksiz `"su"` filler girdisi çıkarıldı: `"şu"` std katlamayla zaten eşleşiyor, SU ise gerçek bir
  tesis adı ve özne yuvasında atlanması kabulü kolaylaştırıyordu.

### A5 — ÖLÇÜLÜP REDDEDİLEN iki düzeltme (tekrar denenmesin)

1. **`PROBLEM_NEGATIONS` önek ihlali.** "Sorun olmaz demiştiniz ama oldu" · "Sorunsuz bir tatil
   olmadı" gerçek şikâyet ama olumsuz kalıbın ÖNEKİ olduğu için siliniyor. Girdileri TAM olumsuz
   biçime daraltmak DENENDİ: "…ama **sorun değil**" gibi ÇOK YAYGIN nezaket kapanışları complaint'e
   döndü (test-pinli tuzak düştü). Kazanç nadir, bedel yaygın → eski hâl KORUNDU, sınır pinli.
2. **"3. tekil iyelik kontrolünü `VERB_LIKE`ın ÖNÜNE al"** (t/d eşsesliliğini kapatmak için).
   Ölçüldü: 10 yaygın geçmiş-zaman fiilinin 7'si ("çalışıyordu · onardı · açtı · denedi · baktı ·
   getirdi · kapattı") iyelik sanılıyor ve **3/3 gerçek bildirim kayboluyor** ("Kombiyi tamirci
   onardı, sonra bozuldu."). Bugünkü yön (aşırı eskalasyon) GÜVENLİ → kod DEĞİŞMEDİ, belge düzeltildi:
   kalan yanlış pozitifler AÇIK bir sınıftır, "iki FP" ile sınırlı değildir.

### A6 — Yer tutucu (`apartmentNumberOf`, `guestFirstNameOf`, başlık)

- **Sayaç ve hane kuralları ETİKETLİ yolda HİÇ çalışmıyordu:** etiket eşleşince anında dönülüyordu →
  "Sahilde Daire **6 Kişilik**" → "6" (kapasite), "Lale Rezidans **No 2024**" → yıl. Aynı adın
  etiketsiz hâli doğru davranıyordu (ölçülen asimetri). Sayaç kontrolü artık ÇAPALI: yalnız sayıyı
  HEMEN izleyen sözcüğe bakar (araya rakam girerse bakmaz → "Daire 5 - 2 Yatak Odalı" hâlâ "5").
- **Sayaç listesi TR-only iken etiket dalı İngilizceyi kabul ediyordu:** 15 gerçekçi İngilizce ilan
  adının 15'i yanlış numara üretti ("Luxury 2 Bedroom Flat" → "Daireniz 2") → İngilizce sözcükler.
- **`guestFirstNameOf` TEK katlamaydı:** "MISAFIR" → misafire "Merhaba MISAFIR," gidiyordu → iki katlama.
- 🚨 **BAŞLIK da çözülür ve taranır:** `packKnowledgeBase` başlığı isteme YAZIYOR ama hem ikame hem
  doldurulmamış-yer-tutucu notu yalnız `content`e bakıyordu.
- Ölü `"m2"` sayaç girdisi çıkarıldı (yakalama grubu `(\p{L}+)` yalnız harf alır).

### A7 — Test kusurları (ölçülmüş, düzeltildi)

İki TUZAK satırı "mesajda cihaz var" sözünü tutmuyordu (`Işıklandırma`/`Buzdolabındaki` türetme eki
taşıdığı için cihaz sayılmıyor) · `fön` listeden çıkarıldığı için iki satır ÖLÜ kalmıştı (silindi) ·
`VERBLIKE_NOUN_OVERRIDES`in 8 girdisinin **5'i PİNSİZDİ** (ayırt edici biçimler ölçülüp yazıldı:
"saatim" · "bileti" · "kahve tadı" · "tatı" · "ciltim") · kelime sınırı ve zayıf etiket dalı pinsizdi ·
QR ad bacağı KB ile aynı sabiti kullandığı için izole değildi · bir QR testinde anti-vacuity çapası
yoktu · üçüncü kolonun (`riskType`) çoğu satırda `isComplaint`ten TÜRETİLMİŞ olduğu yazıldı.

**Kanıt:** kırmızı-önce 26 düşen test; **mutasyon 28/28** — ilk koşuda bir mutant hayatta kaldı ve
PİNSİZ BİLİNÇLİ BİR KARARI gösterdi (ham okumanın koruduğu şey: boşlukla bozulmuş olumsuzlamaya
güvenilmemesi) → pinlendi.

---

## 7. TUR (09-11, otonom /loop — DÖRT paralel ölçümlü ajan)

### (a) `BREAKDOWN_DEVICES` bir ENVANTERDİR — 19 ad eklendi

Liste dilbilgisi değil envanterdir: yazılmamış her cihaz adı, arıza fiiliyle birlikte gelse bile
`general` kalır ve `passesAutoReplySafetyGate` OTO-GÖNDERİM İZNİ verir.

| Parti | Ölçülen | Kaçan | Oto-gönderim izni alan |
|---|---|---|---|
| 1 (davlumbaz · aspiratör · jaluzi · panjur · diyafon · termostat · vantilatör · duşakabin) | 14 bildirim | **14/14** | **13** |
| 2 (süpürge · pencere · çaydanlık · havalandırma · boyler · kepenk · rezervuar · interkom · avize · perde · router) | 16 bildirim | **12/16** | — |

Kalan dördü BAŞKA bir bacaktan complaint'ti ve **asimetrinin kendisi kusurdu**:
`"Çaydanlık bozuldu, ısıtmıyor."` complaint ama `"Çaydanlığı fişe taktık, bozulmuş."` general.

**Ünsüz yumuşaması gövdeleri ayrı yazıldı:** `çaydanlığ` (k→ğ), `kepeng` (k→g).

🚨 **`router` politika değişikliği DEĞİL, `modem` ile PARİTE.** `modem` 1. turdan beri listedeydi;
aynı cihazın iki adı farklı sınıf üretiyordu. `"İnternet gelmiyor"` / `"wifi çekmiyor"` BİLİNÇLİ
olarak `wifi` intent'i olmaya devam eder (test-pinli).

🚨 **`batarya` ÖLÇÜLÜP REDDEDİLDİ (geri ekleme).** Türkçede hem banyo armatürü hem telefon pili:

| Mesaj | `batarya` eklenince |
|---|---|
| "Telefonumun bataryası bozuldu, şarj aleti var mı?" | ❌ complaint |
| "Powerbank bataryamız bozuldu, sizde var mı?" | ❌ complaint |

İyelik ZİNCİRİ kurtarmaz: belirtecin KENDİSİ cihaz sayılınca `reportSubjectSlot` zincir dalına hiç
ulaşmaz. Bedeli dürüstçe pinlendi: **banyo armatürü bildirimi bu yüzden KAÇIYOR.**

`çay` mutasyon turunda pinsiz çıktı → tüketim maddesi pini yazıldı ("Çayımız bozuldu, buzdolabında
unutmuşuz.").

**Bağımsız anti-sıkılaşma ölçümü** (130 gerçekçi mesaj + 42 sözcük çarpışma probu): bu 19 kelime
için **0 yeni yanlış pozitif, 0 yanlış eşleşme**.

### (b) İNCELEME — üç P1, ikisi 6. turun KENDİ gerilemesi

**① Homoglif bypass'ı hâlâ açıktı.** 6. tur üçüncü okumayı yalnız `normalizeForMatch` üzerinden aldı,
`deconfuse` adayını atladı:

```
complaint  "Dairede bir sorun var."
general    "Dairede bir sоrun var."          ← tek Kiril о (U+043E), OTO-GÖNDERİM İZNİ
general    "There is a prоblem in the flat."
```

🚨 `matchCandidates`i olduğu gibi dolaşmak YANLIŞ (ölçüldü): `stripCombining` "yaşamadık"ı MELEZ
"yasamadık" yapar; o biçim ne TR ne ASCII olumsuzlama girdisiyle eşleşir → **"Hiçbir sorun yaşamadık."
ÖVGÜSÜ complaint'e döner.** Yalnız `deconfuse` alındı.

**② `"su"`yu filler'dan çıkarmak 6 gerçek bildirimi düşürdü.**

```
complaint → general   "Şofbeni açtık, su bozuldu."
complaint → general   "Musluğu açtık, su bozuldu."
complaint → general   "Duşta su bozuldu."                     (6/6)
```

6. turun gerekçesi ("SU gerçek bir tesis adıdır") KODDA TERSİNE çalışıyordu: `su` cihaz listesinde
olmadığı için özne yuvasında "cihaz-DIŞI özne" sayılıp bildirimi REDDETTİRİYORDU. Gerekçe kodda
doğru yapıldı: `su` + `suy` (kaynaştırma gövdesi) artık CİHAZ. 6. turun pini yanlış yönü kodluyordu,
ters çevrildi.

**③ İzafet kalıpları ÇAPASIZ — 14 bilgi sorusunun 13'ü complaint.**

```
general → complaint   "Havuzun suyu akmıyor mu, şelale gibi mi?"
general → complaint   "Sokak lambası yanmıyor mu gece, karanlık mı oluyor?"
general → complaint   "Otoparkın kapısı açılmıyor mu uzaktan kumandayla?"
general → complaint   "Kahve makinemizin suyu akmıyor, biz getirmiştik."   (misafirin KENDİ cihazı)
```

Çözüm: **SORU EKİ guard'ı** (`QUESTION_TAIL`), `CONDITIONAL_TAIL` emsaliyle ve YALNIZ izafet alt
kümesine (`POSSESSIVE_FACILITY_COMPLAINTS`).

🚨 **Guard'ı TÜM ağa açmak ÖLÇÜLDÜ ve REDDEDİLDİ** — beş gerçek şikâyet düşüyor:
"Sıcak su gelmiyor mu acaba, duş alamadık." · "Elektrikler gitti mi ne oldu, hiçbir şey çalışmıyor."

🚨 **Harf sınırı (`(?!\p{L})`) ŞART:** onsuz "mutfakta/mumla" soru eki sayılıp üç bildirimi susturuyor
("Banyo lavabosu tıkandı mutfakta da su birikiyor.").

`"duşu akmıyo"` ÖLÜ girdi çıktı (mevcut `"su akmıyo"` ASCII katlamada altdizi) → silindi.

### (c) `sorun/problem` KOŞUL AİLESİ — ölçülen EN BÜYÜK yanlış pozitif sınıfı

İZİN sorusu ailesi ("sorun olur mu") 08-01'den beri `PROBLEM_NEGATIONS`ta korunuyordu; KOŞUL ailesi
unutulmuştu. 11 mesaj, hepsi oto-yanıtın VAR OLMA SEBEBİ olan SSS soruları:

```
complaint → general   "Bir sorun olursa sizi arayabilir miyiz?"
complaint → general   "Bir sorun çıkarsa hangi numarayı arayalım?"
complaint → general   "Sorun yaşarsak size yazalım mı?"
complaint → general   "If there is a problem, who should we contact?"
```

🚨 **ALINTI FRENİ:** `" diye "` görülürse koşul elemesi HİÇ uygulanmaz (fail-closed). Fren olmadan
7 karışık mesajın 2'si `general`e düşüyordu — koşul bir SORU değil, yazma GEREKÇESİDİR:
"Sorun olursa **diye** yazıyorum, perde rayından çıkmış." Boşluklu yazılır ("diyet" içinde de geçer).

🚨 **İngilizce girdilerin "ı"lı İKİZİ ŞART:** `foldTurkishLowerTr` cümle başındaki "I"yı "ı" yapar;
ikizsiz hâlde İngilizce koşul cümlesi complaint kalıyordu.

Karşı yön korundu: "Dairede bir sorun var." · "Sorunumuz devam ediyor." · "Sorun çözülmedi."

### Kanıt

- Kırmızı-önce: **5 blok** (envanter) + **9 blok** (inceleme), kaynak stash'lenip ölçüldü.
- Mutasyon: **20/20** + **21/23**. Kalan iki mutant ÖLÇÜLMÜŞ EŞDEĞER ve ikisi de bir iddiayı KANITLIYOR:
  U+00B4'ün geri konması davranışı değiştirmiyor (= "ölü girdi" iddiasının kendisi); sol-sayaç
  kontrolünü etiketli yola eklemek ULAŞILAMAZ.
- Tam kapılar: `npm test` 4434/371 · tsc · lint · build · audit — hepsi yeşil.

### Kalan borç (bu turda AÇILMADI)

- `breakdownVerbRest` **fiil tarafında ek doğrulaması YOK** (çıplak `startsWith`): "Klima
  bozulduğunda kimi aramalıyız?" · "Kombi bozulduktan sonra tamirci ne kadar sürede gelir?" 4 SSS
  sorusu complaint oluyor. 🚨 DÜZELTMESİ ÖLÇÜLDÜ VE ERTELENDİ: aynı ek GERÇEK bildirimde de kullanılır
  ("Klima bozulduğunda hemen haber verdik") — ayrım ekte değil ANA CÜMLENİN kipinde; ayırt edici
  mekanizma bulunmadan gevşetmek tehlikeli.
- Eski `KEYWORDS.complaint` ham kelimeleri (`bozuk`/`kirli`/`koku`/`böcek`/`kötü`) 15 yanlış pozitif
  üretiyor ve bunlar 6 turun ürünü DEĞİL, 08-08'den beri var. Cihaz tarafına uygulanan çekim↔türetme
  ayrımı bu bacağa HİÇ uygulanmamış ("Kirli çamaşırlarımızı nereye koyalım?" · "Kokulu mum yakmamızda
  sakınca var mı?" · "Hiçbir şey bozuk değil, her şey harika!").
- 51 cihaz adı daha ölçüldü ve GÜVENLİ çıktı (ampul · yatak+yatağ · koltuk+koltuğ · havuz · zil ·
  kablo · küvet · evye · şalter · hidrofor · boru · pompa · depo …), ayrı tur.

---

## 8. TUR (09-11) — ENVANTERİN KALAN BÜYÜK BOŞLUĞU

7. tur 19 cihaz adı eklemişti; bağımsız bir tamlık taraması **51 aday daha** buldu. İzole
bildirim cümleleriyle ölçüldü (başka bacağı tetiklemeyecek biçimde yazıldı):

**49/51 kaçıyordu.** Örnekler:

```
KACAK  general  "Salondaki ampul bozuldu."
KACAK  general  "Küvet bozuldu."
KACAK  general  "Mutfak evyesi bozuldu."
KACAK  general  "Balkon aydınlatması bozuldu."
KACAK  general  "Duman dedektörü bozulmuş."
KACAK  general  "Yürüyen merdiven bozuldu."
KACAK  general  "Hidrofor arızalı."
KACAK  general  "Elektrik panosu bozuldu."
```

Zaten kapsanan ikisi: `ankastre fırın` (→ `fırın`) ve bir tanesi başka bir bacaktan.

### Eklenen 47 girdi (44 ad + 3 yumuşama gövdesi)

`ampul · yatak(+**yatağ**) · koltuk(+**koltuğ**) · havuz · kanepe · sandalye · evye · şalter ·
hidrofor · ısıtma · aydınlatma · boru · pompa · depo · sauna · soba · şömine · anten · ayna ·
gardırop(+**gardırob**) · menteşe · hortum · süzgeç · vana · armatür · sayaç · doğalgaz · pano ·
dedektör · jeneratör · tezgah · merdiven · abajur · ankastre · blender · mikser · kurutucu ·
fritöz · ızgara · sensör · korniş · mangal · barbekü · projeksiyon`

### 🚨 KESME BİRLEŞTİRMESİ TÜRKİYE YER ADLARINI CİHAZ ADINA ÇEVİRİYORDU (6. turun kusuru)

Bağımsız bir ajan ölçtü. 6. tur kesmeyi kelime İÇİNDE **koşulsuz** siliyordu ("Klima'mız" →
"klimamız"). Ama Türkçe imlada kesme **özel addan sonra eki AYIRIR**:

```
complaint  "Van'a giderken bozuldu."     -> "vana"        = VANA   (Van bir İL)
complaint  "Kaş'a giderken bozuldu."     -> ASCII "kasa"  = KASA   (Kaş yoğun bir belde)
complaint  "Bor'u gezdik, bozuldu."      -> "boru"        = BORU
```

"Yolda bozulduk" Türkiye misafir trafiğinin **olağan** cümlesidir. Düzeltme TEK ŞARTLI:
birleştirme yalnız kesmenin **solundaki parça zaten bir CİHAZ ADIYSA** yapılır. 6. turun
"Klima'mız" kazanımı korundu (iki yönlü test-pinli); yön yalnız **elemedir**.

### 🚨 BEŞ KELİME ÖLÇÜLÜP ÇIKARILDI (`fön`→`fon` emsali)

Bunların çarpışması kesmeden **bağımsız**, düzeltme kurtarmıyor:

| Kelime | Ölçülmüş çarpışma |
|---|---|
| `kasa` | "Markette kasa bozuldu, yarım saat bekledik." |
| `masa` | "Maşayı kullandık, bozuldu." (ASCII ş→s) · "Konuyu masaya yatırdık…" |
| `zil` | "Zile vardık, bozuldu." (ilçe) · "Telefonumun zili bozuldu." |
| `küvet` | "Kuvetimiz kalmadı, iyice bozuldu." ("kuvvet" yazım hatası) |
| `çekmece` | "Çekmece'ye taşındık, sonra bozuldu." (ilçe) |

Bedeli kabul edildi ve pinlendi: "Küvet bozuldu." · "Mutfak çekmecesi bozuldu." · "Masayı açtık,
bozuldu." artık KAÇIYOR. `vana` ve `boru` listede KALDI.

### ⚠️ SAHİPLİK KÖRLÜĞÜ MİMARİDİR — bu partiye özgü değil

Ajan HEAD'in **mevcut** 16 cihazıyla aynı düşmanca kalıpları ölçtü: **80/80 yanlış pozitif.**

```
complaint  "Getirdiğimiz kettle bozuldu, sizde var mı acaba?"
complaint  "Kendi ütümüzü kullandık, bozuldu."
complaint  "Arabamızın kilidi bozuldu, otoparka çekebilir miyiz?"
```

Yani "misafirin kendi eşyası" gerekçesi bu partiyi reddetmek için KULLANILAMAZ; kural
sahiplik/mahal körüdür ve yeni kelimeler bunu **miras alır**. Ayrı tur: *1. çoğul iyelik +
cihaz-dışı ad* biçimsel kuralı.

### Çarpışma bataryası — 40 tuzak, çekim kapısı hepsini eledi

```
ok  general  "Kasaptan et aldık ama bozuldu."          (kasa)
ok  general  "Kasabaya gittik, planımız bozuldu."      (kasa)
ok  general  "Kasım ayında geliyoruz, programımız bozuldu."
ok  general  "Masaj randevumuz bozuldu."               (masa)
ok  general  "Aynı gün rezervasyonumuz bozuldu."       (ayna)
ok  general  "Aynen öyle, tatilimiz bozuldu."          (ayna)
ok  general  "Depozito konusu bozuldu mu acaba?"       (depo)
ok  general  "Panoramik manzara … havamız bozuldu."    (pano)
ok  general  "Kuvvetimiz kalmadı, planımız bozuldu."   (küvet)
ok  general  "Borcumuz mu var, hesap bozuldu mu?"      (boru)
ok  general  "Zilyet meselesi bozuldu."                (zil)
ok  general  "Tezgahtar çok ilgiliydi ama günümüz bozuldu."
ok  general  "Havuzlu bir yer arıyorduk, planımız bozuldu."
ok  general  "Yatakhanede kalmıştık, oradaki düzen bozuldu."
ok  general  "Vanilyalı dondurma aldık, bozuldu."      (vana)
ok  general  "Saunalı otelde kalmıştık…"
ok  general  "Mangalcıya gittik, etler bozuldu."
ok  general  "Sensörlü çöp kovası arıyorduk…"
```

🚨 Eleyen şey **ASCII kapısı değil, ÇEKİM DOĞRULAMASIDIR** (`INFLECTION_ONLY`): türetme eki
(`-cı · -lı · -lu · -hane · -tar · -zito · -rama`) reddediliyor.

### 🚨 `kablo` ve `hoparlör` ÖLÇÜLÜP REDDEDİLDİ — `batarya` sınıfı

| Mesaj | Eklenince |
|---|---|
| "Telefon şarj kablomuz bozuldu." | ❌ complaint |
| "Bluetooth hoparlörümüz bozuldu." | ❌ complaint |

`batarya` kuralı: **nesnenin baskın okuması misafirin kendi eşyasıysa listeye girmez.** "kablo"da
şarj kablosu, "hoparlör"de bluetooth hoparlör baskın. Bedeli açık ve KABUL EDİLDİ + pinlendi:

```
KACAK  general  "Uzatma kablosu bozuldu."   (host'un uzatma kablosu)
KACAK  general  "Hoparlör bozuldu."          (gömülü ses sistemi)
```

### Bilinen sınır (yeni DEĞİL, her cihaz adı için geçerli)

AÇIK sahiplik işareti taşıyan misafir eşyası hâlâ complaint sayılıyor ("Getirdiğimiz kamp masası
bozuldu." · "Kendi blenderımız bozuldu"). Bu sınıf 1. turdan beri ölçülü ("Kahve makinemizin suyu
akmıyor") ve YENİ bir mekanizma değil; yön GÜVENLİ (fazla eskalasyon).

### Ölçülüp reddedilen diğer adaylar (geri ekleme)

`fan` (Fanta) · `cam` (cami) · `gider` (giderler) · `uydu` (uydum) · `raf` (rafine) · `stor`
(store) · `halı` (ASCII "hali" → halinde/haliyle) · `sigorta` (seyahat sigortası) · `kart` ·
`kamera` · `alarm` · `adaptör` — hepsi cihaz-DIŞI baskın okuma taşıyor.

### Kanıt

Kırmızı-önce **4 blok** (kaynak stash'lendi) · **mutasyon 25/25** (kaldırma 8 · aşırı uygulama 9 ·
kesme iki yönlü 2 · önceki tur kapsamı 6) · tam kapılar yeşil.

### 🚨 İZAFET ÇAPASI ÖLÇÜLDÜ ve REDDEDİLDİ (ayrı ajan — tekrar tasarlanmasın)

7. turda "doğru çözüm" diye bırakılan çapa kuralı 106 mesajlık korpusta ölçüldü:

| | HEAD | (A) daire-DIŞI dışlama | (B) daire-İÇİ içerme |
|---|---|---|---|
| bilgi sorusu yanlış pozitifi (27) | 27 | 13 | **2** |
| 🚨 gerçek bildirime OTO-GÖNDERİM İZNİ (85) | **0** | 7 | 18 |
| ilan-adı kaybı (15) | **0** | 1 | 7 |

Dört ret gerekçesi: ① ayrım sözcüksel değil (aynı cümle havuzlu mülkte bildirim, havuzsuzda soru);
② çapa çoğu zaman tamlama zincirinin ara halkası, zinciri yürümek ilan adlarını yiyor (8/15);
③ Türkiye ilan adları tam bu sözcüklerden kurulur (Deniz Apart · Park Evleri · Marina Sokak);
④ dosyanın kendi kuralıyla çelişir — 8. tur `havuz`u cihaz yaptı, çapa onu tesis sayıyor.
Dar varyant A′'nın güvenliği bilinen bir BUG'a (`açıl`→`acil`, iş #51) dayanıyor.
