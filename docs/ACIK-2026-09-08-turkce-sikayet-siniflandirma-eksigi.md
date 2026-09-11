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
  (`null` → belirteç görünür), uydurma numara söylemekten iyidir. Bilinen bedel: "Nuve 3 Oda
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
  "Sahilde Daire **6 Kişilik**" → "6" (kapasite), "Nuve Rezidans **No 2024**" → yıl. Aynı adın
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
