# Codex'ten sonra ne yaptık — tam döküm (09-10 → 09-12)

> **Bu belgenin amacı:** kurucu sordu — *"codex gittiğinden beri neler yaptık, o en uzun promptumun
> dışına çıktığımızdan beri, V2.1'e devam etmeden ayrışarak yaptığımız her şeyi yaz: eskiden nasıldı,
> şimdi nasıl, neden yaptık."*
> **Kapsam sınırı:** Codex'in son turu RAG dilim 3'tü (`9699896`, 09-09 17:04) + E4 yer tutucu turu
> (`81a5f22`/`cc45ce6`, 09-09 20:22–20:49). Bu belge **09-10 18:23'ten (`1395dc8`) 09-12 09:56'ya
> (`5258fd2`) kadar**, yani Codex'siz geçen 45 commit'i anlatır.
> **Çelişkide `CLAUDE.md` kazanır** (o dosya KURAL, bu dosya TARİHÇE ve GEREKÇE).

---

## 0. Bir cümlelik cevap

**Roadmap fazı ilerletmedik ve bu bilinçliydi.** V2.1'den (09-09) bu yana yapılan her şey, kendi uzun
talimatının **⑤. maddesinin ön koşuludur**: *"geniş otonom AI yalnız yetki + guardrail + grounding +
eval doğrulandıktan sonra."* İki gün boyunca yapılan iş tam olarak **guardrail + grounding + eval**
idi. V2'nin kalanı (Exception Feed para etkisi), V3–V8 ve Availability Engine'e **hiç dokunulmadı**.

**Neden ayrıştık:** 09-09'daki ilk gerçek model koşusu (kurucu, 8 senaryo) ürünün misafire **yanlış
şeyler söylediğini** ölçtü — "[ŞİFRE]" metnini misafire gönderiyordu, "ilettim" diyordu ama
iletmemişti, "bilgim yok" diyordu. Bunlar roadmap maddesi değil, **canlı üründe misafire giden
kusurlardı**. Üstüne yeni özellik koymak, hatayı çoğaltmak olurdu.

**Rakamsal sonuç:** 4005 test → **4879 test** (361 → 410 dosya). Migration: yalnız **1 tane** (55).
Ücretli servise **tek istek gitmedi**. Bayrak değişikliği: **1 tane** (RAG varsayılan açık, senin
talimatınla).

---

## 1. En büyük blok: Türkçe şikâyet sınıflandırma (8 tur, 09-10 → 09-11)

Bu tek başına 12 commit. Neden bu kadar büyüdü: **her tur, bir önceki turun kendi gerilemesini
ölçtü.** Bu bir başarısızlık değil, yöntemin kendisi — her turda bağımsız bir ajan gerçekçi mesaj
bataryası üretip ölçtü, ben kodu yazdım.

### Kusurun kendisi

**ESKİDEN:** "Sıcak su gelmiyor", "elektrikler gitti", "kombi bozuldu", "kapı açılmıyor" gibi
Türkçenin **en olağan arıza bildirimi biçimleri** `general` sınıfına düşüyordu. `general` =
oto-yanıt kapısı geçer = **AI misafire kendi başına cevap yazıp gönderiyordu**, host hiç görmüyordu.
Sebep: kelime ağı İngilizce kalıplar üzerine kurulmuştu ("broken", "not working"), Türkçedeki
**olumsuz fiil** boşluğu hiç kapatılmamıştı.

**ŞİMDİ:** `KEYWORDS.complaint` içinde çapalı kalıp ailesi + `hasDeviceBreakdown` cihaz kuralı.
145 girdilik cihaz envanteri, üç dar dilbilgisi kapısı (özne yuvası · çekim doğrulaması · koşul/soru
eki guard'ı).

### Turların her biri ne ölçtü

| Tur | Ne bulundu | Ölçülen bedel |
|---|---|---|
| 1 (`1395dc8`) | Olumsuz fiil boşluğunun kendisi | — |
| 2 (`0bc8bfb`, `2c50b28`) | Cihaz adı **altdizi** aranıyordu: değişiklik→ışık, telefon→fön, sürpriz→priz | 12 yanlış pozitif |
| 3 (`c4b32b7`) | 2. turun "aynı cümlecik" şartı **GERİLEMEYDİ** | 44 bildirimin **30'u** düşüyordu, kapı oto-gönderim izni veriyordu |
| 4 (`6b67694`) | 11 kelimelik allowlist sınıfı kapatmıyordu | 30 mesajın **24'ü** hâlâ yanlış complaint |
| 5 (`f17448d`) | 4. turun özne kuralının üç kör noktası | **15 gerçek bildirim** düşüyordu |
| 6 (`27eb5f3`) | Görünmez karakter (U+00AD) ağı deliyordu · izafet/tamlama komple kaçıyordu | 17 çiftin 17'si; 14'ü oto-gönderiliyordu |
| 7 (`43098ab`, `59a6bae`) | Envanter boşluğu + homoglif bypass'ı | 30 bildirimin 26'sı kaçıyordu |
| 8 (`82f4779`, `ce00328`) | Envanterin kalanı + **kesme işareti kusuru** | 51 adayın **49'u** kaçıyordu |

### 🚨 En öğretici üç bulgu

**(a) Kesme işareti Türkiye yer adlarını cihaz adına çeviriyordu.** 6. turda "Klima'mız bozuldu"
kazanmak için kesme kelime içinde koşulsuz siliniyordu. Sonuç: **"Van'a giderken bozuldu" → `vana`
= VANA → complaint.** Van bir il, "Kaş'a" → `kasa`, "Bor'u" → `boru`. "Yolda bozulduk" Türkiye
misafir trafiğinin olağan cümlesi. Düzeltme tek şartlı: birleştirme yalnız kesmenin solundaki parça
**zaten cihaz adıysa** yapılır.

**(b) "Sahiplik körlüğü" mimaridir, kelime listesi sorunu değil.** Ajan ölçtü: HEAD'in mevcut 16
cihazı da "Getirdiğimiz kettle bozuldu" · "Arabamızın kilidi bozuldu" kalıplarında **80/80** yanlış
pozitif veriyor. Yeni kelimeler bu körlüğü **miras alır, açmaz**. Ayrı tur olarak kayda geçti.

**(c) Ölçülüp REDDEDİLEN kelimeler (geri ekleme):** `batarya` (hem banyo armatürü hem telefon pili) ·
`kasa`/`masa`/`zil`/`küvet`/`çekmece` (yer adı ve yazım hatası çarpışmaları) · `kablo`/`hoparlör`
(baskın okuma misafirin kendi eşyası) · `fön` (ASCII "fon" beş gerçek sözcüğü cihaz sayıyordu).
Her birinin **bedeli test-pinli**: o cihazların gerçek bildirimleri kaçar, biliyoruz.

**Kanıt:** her turda kırmızı-önce + iki yönlü mutasyon (21/21 · 26/26 · 28/28 · 25/25 · 20/20).

---

## 2. "Bilgim yok" misafire ASLA gitmez — senin kuralın (09-11)

**ESKİDEN:** 2. gerçek koşuda ölçüldü — model güven **.8**, kaynak **0/0**, cevap *"kayıtlı bilgim
yok; mesajınız kaydedildi…"* → kapı eşiği 0.75 olduğu için **GEÇİYOR** ve misafire gidiyordu.

**Senin sözün:** *"müşteriye hiçbir zaman bilgim yok mesajı gitmemeli; bilgi yoksa da cevap
gitmemeli — host neden 'bilgim yok' mesajı göndersin ki?"*

**ŞİMDİ:** `src/lib/ai/absence.ts` — `admitsMissingKnowledge` İKİ yüzeyde de kapı. Kanal yolunda hiç
mesaj gitmez (host'un kutusuna düşer), QR'da deterministik devir metni gider.

### 🚨 İstem kuralı KALDIRILMADI — bilinçli

`prompts.ts` KURAL-3/KURAL-5 modele temellendiremediğinde yokluk söylemesini emreder ve **o kural
uydurmayı engeller**. Silseydik model uydururdu — işe yaramaz bir cevaptan çok daha kötü. Kural
istemde kalır, **gönderim kapıda kapanır**. Fail-safe doğru yönde: kapı delinirse misafir bozuk bir
belirteç değil dürüst bir cümle görür.

### Yüklem AYNI GÜN yeniden yazıldı (inceleme ajanı ölçtü)

İlk yazdığım düz kalıp listesi **iki yönde de kırıktı**:
- İşe yarar cevabı bloklama: **18/67 (%27) → 0**
- Gerçekçi yokluk ifadesini kaçırma: **29/38 → 0**

Dört ölçülmüş kusur: `\bno` sağ sınırsızdı (*"**No**thing extra is needed"* bloklanıyordu) ·
`kayıtlı…bilgi` olumlu Türkçe kalıptır (*"Kayıtlı rezervasyon bilgileriniz DOĞRU"*) · 🚨
`toLocaleLowerCase("tr")` **İngilizceyi bozuyordu** (tr yerelinde `I`→`ı`: *"I have no **I**nformation"*
→ *"ı have no ınformation"* kaçıyordu).

Yeni yapı kalıp listesi değil **nesne + olumsuzlama dilbilgisi**. `yok` nesneye bitişik (≤1 kelime) —
yoksa *"sorun yok"* nezaket kapanışları yokluk sayılıyordu.

---

## 3. Çıktı vetosu — §A (09-12)

**ESKİDEN:** iki güvenlik kapısının cevabın **metnine** bakan tek dalı yoktu.
`hasUnsourcedSpecificClaim` yüklemi vardı ama **üretimde hiç koşmuyordu** (bayrağı yalnız testlerde
set ediliyor, 0 üretim yolu). Gerçek QR rotasında ölçüldü: model `wifi/none/0.95` dönünce ürün
**"[ŞİFRE]" metnini misafire döndürüyordu.**

**ŞİMDİ:** `src/lib/ai/output-veto.ts` (saf, DB'siz, iki kapıda da canlı). İki gerekçe:
- `placeholder_in_reply` — doldurulmamış alan cevabın İÇİNDE
- `unverified_commitment` — **ETKEN** makbuzsuz iddia ("ilettim", "kontrol ettim")

### 🚨 Neden yalnız ETKEN çatı

Bağlamadan **ÖNCE** batarya koşuldu: 77 meşru cevapta **9 yanlış pozitif**. Kök neden Türkçe
**edilgen çatı** yüzeyde ayrışmıyor:
- *"Gürültü şikâyetleri site yönetimine bildirilir"* = MEŞRU SSS
- *"Konu apartman yönetimine bildirilmiştir"* = makbuzsuz iddia

**Birebir aynı şablon.** Ölçülmüş karar: kapıya yalnız etken dallar → **0 yanlış pozitif**; edilgen
dallar ölçümde kalır. "Muhatap çapası" varyantı ölçülüp reddedildi (iyelik eki gövdenin son harfine
göre değişiyor = kural değil kaza).

### İlk bağlama fazla genişti ve suit yakaladı

`human_request` devir akışında modelin cevabı *"Talebinizi ev sahibimize ilettim…"* diyor; veto onu
durdurunca **tasarlanmış devir akışı sessizce ölüyordu** (misafir hiçbir şey almıyor, host devir
sinyalini kaybediyor). Muafiyet: `intent === "human_request"`.

---

## 4. §B — makbuzsuz iddia kaynağında kapandı (09-12)

**ESKİDEN (iki ayrı kusur, aynı sınıf):**

**(a) Bekletme mesajı yalan söylüyordu.** `HOLDING_ACK_TEXTS` hem *"ilettim / I've passed / Ich habe
weitergeleitet"* (AI'ın kendi eylem iddiası) hem *"en kısa sürede sizinle ilgilenecek"* (üçüncü
şahsın gelecek eylemi) diyordu. Üstelik escalation e-postası `if (to)` bloğunun içindeydi →
**alıcısız org'da host'a hiçbir şey gitmezken misafir o cümleyi okuyordu.**

**ŞİMDİ:** metin yalnız çağrı anında **garanti olanı** söyler — konuşma atomik olarak `problem`e
claim edilmiştir, yani mesaj kayıtlı ve panelde öncelikli. Bu e-postadan da modelden de bağımsız
sert bir olgu. Özür + fotoğraf/ayrıntı isteği korundu (dürüstleştirme, metni işe yaramaz hâle
getirmenin bahanesi değil).

**(b) 🚨 İstem modele tam olarak ürünün BLOKLAYACAĞI cümleyi öğretiyordu.** Dört İngilizce few-shot
örneği *"I've asked our team… I've flagged it… I've passed this on"* diyordu. Bu bir **pin
boşluğunun** sonucuydu: few-shot dürüstlük pini TR-only dedektörle koşuyordu, İngilizce satırlar
fiilen hiç taranmıyordu. Kozmetik değil: veto 09-12'den beri canlı → model üretir, kapı durdurur,
**misafir hiçbir şey almaz.**

Kalan ikisi vetonun yapısal sınırında, istemde düzeltildi: ÖRNEK 11 (TR) *"ekibimiz anında devreye
girecek"* — `devreye gir-` fiili vetoya **eklenmedi** çünkü meşru tesis cümlesi üretir ("Sigorta
devreye girer"); ÖRNEK 9 (AR) — vetonun **Arapça kapsamı yok**.

---

## 5. §C — karar kaydı artık gerçeği söylüyor (09-12)

Denetim raporu "pack `omitted` atılıyor" demişti. Ölçüm **daha büyük bir yalan** buldu.

**ESKİDEN:** hibritte `kb-fetch` 200 kalem çeker, sözcüksel isabet yoksa seçici "hepsini gönder"e
düşer ve `cappedForFallback` 30'a indirir — ama `legacyResult` **`droppedItems: 0` sabitliyordu**.
170 kalem isteme girmiyor, karar kaydı "hiç kalem düşmedi" diyor.

**Bedeli kozmetik değil:** sayı `classifyGrounding`e gidiyor ve `dropped === 0` dalı etiketi
**`ungrounded`** ("kalem vardı, model kullanmadı") yapıyordu; gerçek **`capacity`** (tavana çarptı).
`select.ts`in kendi yorumu bu dalın kısa mesajların **%72'sinde** çalıştığını yazıyor.

**ŞİMDİ:** kırpma ile sayaç **tek yerde** (`cappedForFallback` → `{items, dropped}`). Ayrı yerde
hesaplanmaları bu hatanın kendi sınıfıydı.

Ayrıca: `buildReplyPrompt(input) → {text, kbOmitted}` (pack bütçesi de kayda giriyor) · kalite
denetçisi artık `Message.aiSourcesJson` görüyor · iki bayat yorum düzeltildi.

⚠️ **Gönderim kararı DEĞİŞMEDİ** — bu tur yalnız karar kaydını düzeltir.

---

## 6. §D — QR displacement açığı (09-12, rapor bunu GÖRMEDİ)

**ESKİDEN:** QR güvenlik kapısı yalnız **güncel mesaja** bakıyordu. Kanal yolunda `dfd1683` ile
kapattığım aynı açık QR'da açıktı:

1. Misafir 1. turda injection yazar → devredilir, ama **mesaj kaydedilir**
2. 2. turda zararsız bir soru yazar
3. Pencere, 1. turdaki yükü **modele taşır**, kapı görmez
4. QR devri yapışkan olmadığı için 2. tur temiz sayılır

**ŞİMDİ:** kapı modele giden **aynı diziyi** tarar. 🚨 İkinci pencere **hesaplanmaz** — ayrışabilecek
her kopya bu açığın kendisidir. Kapsam dar: geçmişte yalnız injection (şikâyet/risk ağlarını eski
mesajlara koşturmak normal sohbeti kalıcı bloklardı).

**Bu turun en önemli test dersi:** mutasyon turu, *"rota geçmişi kapıya VERMEZ"* mutantının yalnız
unit pinlerle **hayatta kaldığını** ölçtü — ve bu zaten kusurun kendi sınıfıydı: **yüklem vardı,
argüman yoktu.** (Aynı sınıf §C'de de çıktı.)

---

## 7. Bağlam penceresi — `.slice(-6)` (09-11)

**ESKİDEN:** `prompts.ts` çıplak `.slice(-6)` ile geçmişi kesiyordu ve **gerekçesi yoktu**. Ölçüldü:
QR'ın 24 mesaj / 8.000 karakterlik penceresinin **mesaj bacağı ÖLÜYDÜ** (7.–24. mesajlar tam burada
atılıyordu); oto-yanıt ve inbox öneri konuşmanın tamamını taşıyıp aynı yerde kaybediyordu.

**ŞİMDİ:** `selectHistoryForPrompt` (saf) — tavan 25 mesaj + bütçe 6.000 karakter (**bütçe sayıdan
önce gelir**: tek 4.000 karakterlik mesaj 25 kısa mesajdan pahalı).

🚨 **Güvenlik penceresi bütçeye tabi DEĞİL:** son operatif mesajdan sonraki cevapsız misafir
mesajlarının tamamı daima girer — displacement saldırısı (uzun zararsız metinle riskli cümleyi
pencere dışına itme).

### 🚨 Bu değişiklik kapıda bir açık AÇTI ve inceleme turunda kapandı

Kapı `context.history`yi injection için tarar ve o ayna `messages.slice(-6)` idi. İstem 6 iken iki
pencere birebir eşitti. **İstem 25'e çıkınca yalnız model tarafı büyüdü** → misafir N-10'uncu mesaja
yük koyup araya 9 zararsız mesaj sıkıştırırsa model görür, kapı görmez. Ayna artık aynı seçiciden
beslenir; pin üç yönlü (**eski 6'lık ayna kaçırıyor** = açığın gerçekliği ölçülü).

🚨 **Gövde kırpılmaz** — "pencere karakter bakımından sınırsız" uyarısı doğru ama çözümü kırpmak
DEĞİL: bu seçimin çıktısı aynı zamanda kapının tarama yüzeyidir, kırpılan her karakter kapının
görmediği bir yüzeydir.

---

## 8. Retrieval / RAG

### (a) Kaçak turu (09-10) — kök sökücü sabit nokta

**ESKİDEN:** tur tavanı 3 simetriyi bozuyordu — "çıkışımızı"→`ciki` ≠ "çıkış"→`cik` → `no_lexical_hits`
geri çekilmesi. *"Aşırı kök alma kaçırma üretmez"* varsayımı yalnız **simetrik** sökümde doğru.

**ŞİMDİ:** sabit nokta + ünlü-sonu iyelik + kaynaştırma "y" + düzensiz `suy→su`.

**Ölçüm (30/100/300 kalem):** hit@1 92–93 → **96–97** · inPrompt 97–99 → **99–100** · gürültü
1.5/2.9/4.7 → 0.9/2.2/2.6 · geri çekilme 3/1/1 → **0**.

**İncelemesi (aynı gün) P1 buldu:** sabit noktanın **kendi kaçağı** — kısa ekler ardışık sökülüp
gövdeyi yiyordu: **"havalimanından" → `hav` = HAVLU kovası.** (Eski tur tavanı bunu kazara
engelliyordu.) Düzeltme tek dilbilgisel fren: **tamlayan eki yalnız ilk turda**.

**Ölçülüp reddedilen dört aday** (tekrar denenmesin): `ndan/nda/ni` eklemek 11 kelimeyi bozar
(balkonu→balko) · `alim/elim` için taban 4 on yaygın fiili bozar (gidelim→gidel) · iki mutant
pinlenemedi → kod tutulmadı.

### (b) 🚨 RAG VARSAYILAN AÇIK (09-11, senin talimatın)

**ESKİDEN:** `KB_RETRIEVAL_MODE` bir **AÇMA** düğmesiydi, varsayılan legacy.

**ŞİMDİ:** aynı bayrak **ACİL DURDURMA** düğmesi — `legacy/off/0/false/no/disabled` eski davranış,
**başka her değer (boş dâhil) hibrit**. Kill switch bilinçli **gevşek** yazıldı: olay anında
"kapattım sanıp kapatamamak", bilinmeyen bir değerin yanlışlıkla legacy'ye düşmesinden pahalıdır.

**Dayanak ölçüm** (`docs/olcum/hibrit-yan-etki-2026-09-11.md`): gerileme 19.583 çiftte **%0,11** ve
hepsi aynı tartışmalı soru · blok boyutu legacy'nin %9–32'si · ek gecikme soğuk 15 ms / sıcak 1,8 ms.
Legacy inPrompt 100 kalemde **%51**, hibrit **%99–100**.

⚠️ **Ölçülmeyen: cevap KALİTESİ** (bu ortamda model yok) — gerçek eval hâlâ borç.

### (c) Geri çekilme dalı legacy tavanını aşmıyor

**ESKİDEN:** sözcüksel isabet yoksa hibrit **200 kalemi** isteme gönderiyordu (legacy 30).
Hibritin "çok gönderdiği" tek yer buydu.

**ŞİMDİ:** `cappedForFallback` legacy tavanına iner. (Denetim raporunun 14. bulgusunun büyük kısmı
rapordan **53 dk önce** zaten kapanmıştı.)

### (d) ⛔ Bulgu 14'ün ÖNERİSİ REDDEDİLDİ

Rapor *"eşleşme yoksa boş dön"* diyordu. Ölçüldü: **ru/ar/de sorguların tamamı** `no_lexical_hits`e
düşüyor ve bugün fail-open sayesinde doğru cevabı alıyorlar. Öneri uygulansaydı bilgi **yazılı
olduğu hâlde her yabancı misafir insana devredilirdi.**

### (e) Dil tespiti: Almanca İngilizce sanılıyordu

`detectGuestLanguage` `de` dalı `ich|sie|bitte|danke|hallo` listesine bağlıydı → Almanca **sorular**
İngilizce sayılıyordu ve bu `queryIsTurkish`i besliyordu. Düzeltildi.

🚨 **Embedding'in en güçlü gerekçesi burası:** Rusça/Arapça'da sözcüksel eşleşme **yapısal olarak
yok** (sözlük 47 kavram/302 terim, TR+EN; kök sökücü Türkçe ekler). DE/FR yalnız kazaen çalışıyor.

---

## 9. Yer tutucu ve şablon — beş yüzey tek kaynağa bağlandı

**ESKİDEN:** `{isim}`/`{daire}` ikamesi **üç yerde ayrı ayrı kopyalanmıştı** ve **dördüncü yüzeyde —
halka açık QR asistanında — hiç yoktu**: host'un karşılama şablonu KB'deyse misafire ham `{isim}`
gidiyordu. 09-12'de **beşinci ayrışan yüzey** bulundu (`api/ai/test`, kendi `match(/\d+/g)?.pop()`
kuralıyla **7 ilan adının 7'sinde** farklı sonuç).

**ŞİMDİ:** tek kaynak `src/lib/kb-placeholders.ts`, beş yüzey de bağlı.

### Ölçülmüş alt kusurlar

| Kusur | Eskiden | Şimdi |
|---|---|---|
| Daire numarası | **son sayı** alınıyordu: "Lale 3 \| 2+1 Deniz Manzaralı" → "1" | etiket önceliği (`daire/apartment/apt/D:`) → yoksa tek sayı → belirsizde `null` |
| Sayaç tuzağı | "Trabzon **4 Kişilik** Daire" → "4" | sayaç sözcüğü görülürse `null` |
| Yıl tuzağı | "**2024** Yılı Dairesi" → "2024" | 3 haneden uzun sayı zayıf etikette reddedilir |
| Sayısız ad | **mülk adının tamamı** dönüyordu → *"Kapı kodu: Cozy Seaside Flat"* misafire gidiyordu | `null` |
| Türkçe İ | `/i` bayrağı noktalı İ'yi katlamaz → "DAİRE 5" → null | iki katlama |
| QR'da gerçek ad | — | 🚨 **`GUEST_NAME_FALLBACK`** ("misafirimiz"): QR dairede asılı, sohbeti açan rezervasyon sahibi olmayabilir (eş, temizlikçi) |

🚨 **Sır kapısı QR'da İKİ KEZ çalışır.** Ölçüldü: mülk adı "Daire 4590" iken "Kapı: {daire}" kalemi
modele **"Kapı: 4590"** gidiyordu — giriş adı + 4-8 hane = `SECRET_PATTERNS`in yakalamak için
yazıldığı biçim. Sızıntı üretmiyordu ama *"modele giden metin taranmıştır"* değişmezi kırıktı.

---

## 10. Oto-mesaj dürüstlüğü + migration 55

### (a) Misafir-görünür kusur

**ESKİDEN:** `KB_PRESETS`in "Giriş talimatı" ve "Çıkış" şablonlarının ikisi de doldurulmamış
`[AÇIK ADRES]` / `[ANAHTAR TESLİM ŞEKLİ]` taşıyor, host doldurmadan kaydedebiliyor ve **bu yol
modelden hiç geçmiyor** — yani ürünün `[…]` koruması devrede değildi. Misafir **`Adres: [AÇIK ADRES]`**
okuyordu.

**ŞİMDİ:** üç göndericinin üçü de **fail-closed** (`hasUnfilledPlaceholders`, gövde kurulduktan
sonra). `*SentAt` damgalanmaz, host düzeltince normal gider. Bilgi Tabanı'nda "Doldurulmamış alan"
rozeti — **uyarı düzeltmenin yapılacağı yerde.**

### (b) Koşulsuz vaat

**ESKİDEN:** *"Bu metin misafire otomatik gönderilir"* org ayarına **hiç bakmadan** yazılıyordu
(bileşen ayarı props olarak almıyordu bile) — oysa `autoWelcome/autoCheckin/autoCheckout` şemada
`false`.

**ŞİMDİ:** kontrol edilebilir yönlendirme.

**Senin sorunun cevabı (varsayılanı açalım mı):** ⛔ **çevrilmedi.** `*EnabledAt` baseline'ı yalnız
Ayarlar PATCH'i yazdığı için sessiz no-op olurdu ("Açık" der, sıfır mesaj gider); ayrıca yukarıdaki
`[AÇIK ADRES]` sınıfı yüzünden ham belirteç misafire giderdi. Rakip araştırması (8/8 marka):
**"içerik VER, göndermeyi AÇMA"** (`docs/ARASTIRMA-2026-09-11-rakip-ux-ve-gorevler-paneli.md`).

### (c) 🚨 Aktif saat — migration 55 (TEK migration)

**ESKİDEN:** şema varsayılanı `autoReplyStartHour=0, autoReplyEndHour=9` → `hour >= 0 && hour < 9`
yani **AI günün yalnız 9 saatinde çalışıyor, 15 saatinde susuyor** — ve susan 15 saat misafir
trafiğinin tamamına yakını. **Kurucu org dâhil** eski org'ların hepsi bu tuzaktaydı.

**ŞİMDİ:** varsayılan **0/0** (7/24). Backfill **dar** — yalnız eski şema varsayılanı 0/9 olanlar;
host'un bilinçli seçtiği her pencere dokunulmadan kalır.

⚠️ **Prod damgası henüz yok** — kardeş migration'larda olduğu gibi salt-okuma doğrulaması yapılmadı,
o yüzden "CANLI" demiyorum. Boot `prisma migrate deploy` uyguluyor; **elle SQL çalıştırmaya gerek
yok** (PowerShell'e yapıştırıp hata almıştın).

### (d) Oto-yanıt anahtarı Ayarlar'da

**ESKİDEN:** dashboard onboarding `/settings`'e gönderiyordu, anahtar orada **değildi** = çıkmaz
sokak. Ayrıca 🚨 **oto-yanıt anahtarı KAPALIYKEN karşılama/giriş/çıkış mesajları gidiyordu** (üç
gönderici `autoReplyHospitable`'ı SELECT etmiyor bile).

**ŞİMDİ:** anahtar Ayarlar'a kopyalandı. Alt anahtarlar **kilitlenmedi** — salt-UI kilit yalan söyler,
sunucu kapısı canlı org'ları sessizce durdurur; çözüm **dürüst ad**.

---

## 11. UI — senin ekran görüntülerinden gelen işler

| İş | Eskiden | Şimdi |
|---|---|---|
| **Misafir 404** | Beş koşul B2B 404'üne düşüyordu ve iki çıkışı da `/` idi → dairedeki QR'ı okutan misafir **satış sayfasına** iniyordu | Markalı `GuestNotice`, **tek metin beş koşul** (numaralandırma koruması), **dış bağlantı yok** (tek doğru yönlendirme ev sahibi), 200 döner |
| **Panel yerleşimi** | `lg`de sayfa kayıyordu; kart yüksekliği `calc(100vh/0.95 − 11rem)` sabitiydi ve **aradaki bandları saymıyordu** (tek band `<main>`i 46 px, iki band 109 px taşırıyor) | Sihirli sayı yok: `lg:fixed lg:inset-0` + esnek doldurma. 9 durumda `docScroll=0`, `mainOverflow=0` ölçüldü. **Regresyon pini eklendi — yoktu (K2 ihlali)** |
| **QR paneli** | Enter=gönder yoktu (misafir tarafında vardı, **ödeyen müşterinin yüzeyinde yoktu**); 30 sn yenileme yoktu; açılışta **200 balonun en eskisinde** duruyordu; 🤖 emoji | Enter=gönder (IME güvenli) · 30 sn yenileme · sona konumlanma · **AI'ın yüzü `BrandMark` = bizim logomuz** ("robot niye koydun") |
| **"Siz yazarsanız AI susar"** | Uyarı üründe vardı ama yalnız `resume-ai-button`da = **iş işten geçtikten sonra** | Yazma kutusunda **önceden** |
| **Kaydırma çubuğu** | Başparmak `--border` = açık temada kontrast **≈1,2:1**; oluk hiç yazılmamıştı | `--muted-foreground` + gerçek oluk + hover |
| **"Beklemede" durumu** | 🚨 **Belgelenmemiş bir AI KİLİDİYDİ** — `dueAutoReplyWhere` yalnız `status:"new"` seçiyordu, host işaretleyince oto-yanıt konuşmayı bir daha hiç seçmiyordu ve hiçbir ekran bunu söylemiyordu | Kaldırıldı. Migration gerekmedi; aday sorgusuna `waiting` eklendi ki eski satırlar tuzakta kalmasın |
| **Mobil demo** | `rescale()` yalnız üst sınır koyuyordu → 390px'te yazı **4,22px** | `MIN_SCALE` 0.8 → **10,00px** (2,37×) + sahne kırpılır, demo kendi odağını takip eder |
| **Bozuk besleme** | Ölçüt satırın **varlığıydı**, sorgu `lastStatus`/`lastSyncedAt`'i **çekmiyordu bile** → kalıcı bozuk besleme **"5/5 hazır" YEŞİLİ** üretiyordu | Üçüncü hâl **kırmızı** ("Takvim beslemesi hatalı") |
| **Raporlar** | Performans rozeti `tone="success"` sabit literal'dı → **F "Kritik" bile yeşil**; "~N saat kazandırdı" dayanağı bir yorumdu; "En Çok Sorulanlar" **tüm zamanlar** | `GRADE_TONE` · `MINUTES_PER_MESSAGE_ASSUMPTION` ("4 dk varsayımıyla") · 30 gün penceresi başlıkta yazılı |
| **Gereksiz UI** | Davet kartı (düğmesi 30 px altındaki ile **aynı `handleSuggest()`i** çağırıyordu) · durum rozeti (seçim kutusuyla birebir aynı değer) | Silindi |
| **Landing demo** | 6 çip / saatte 6 istek = ziyaretçinin **kendi sorusuna hak kalmıyordu** | 8 çip · `DEMO_HOURLY_LIMIT` 12 tek kaynak, ekranda yazılı |

### 🚨 Acil ≠ sıradan istek

**ESKİDEN:** yangın ile *"bir yastık daha"* **aynı devir cümlesini** alıyordu.

**ŞİMDİ:** `escalationReply({critical})`. Tetikleyici `isPhysicalEmergency` — `detectRiskType ===
"safety_emergency"` **DEĞİL**, çünkü (i) o küme öz-zarar ifadelerini de içeriyor ve `prompts.ts` o
sınıf için açıkça *"acil-talimat içermez"* diyor → **kriz içindeki misafire "acil servisleri arayın"
gidiyordu**; (ii) `SAFETY_CRITICAL_WORDS` bilerek geniştir ve gerekçesi *"over-matching is the safe
side"* — o maliyet modeli **misafire giden metin için geçersiz** ("İnternet **düştü**", "Havuz ne
zaman **açıl**ıyor?", "**Polis** merkezi nerede?" hepsi eşleşiyordu).

---

## 12. Knowledge Hub — üç bacak, biri canlı ikisi kapalı

| Bacak | Durum | Neden |
|---|---|---|
| **Şablon → KB önerisi** (`kb-from-templates.ts`) | ✅ **CANLI** | Ölçülen boşluk: `MessageTemplate` misafire aynen gider ve **modelden hiç geçmez** → host "Wi-Fi bilgisi" şablonu yazmışsa bilgi sistemde VAR ama asistan **kullanamıyor** |
| **Geçmiş host cevapları** (Bacak B) | ⛔ **YÜZEY KAPATILDI** | ↓ |
| **A3 eksik listesi / A5 metinden çıkarım** | ⛔ Yüzey kaldırıldı | Senin kararın: *"kaldırıcaz mı, bok gibi"* / *"olmasa da olur"* |

### 🚨 Bacak B neden kapatıldı (senin canlı ekranında ölçüldü)

Ürettiği çiftler **yanlıştı ve yön tehlikeliydi**:
- *"Otopark · örnek soru: do you have parking"* satırında gösterilen cevap bir **yorum isteği**
- *"Konum · konum atabilir misiniz"* satırında **"müşteri hizmetlerine tam para iadesini kabul
  ettiğini söyleyin"**

Host "Bilgi tabanına ekle"ye bassa **para iadesi talimatı `Konum` kategorisinde ONAYLI BİLGİ olur**
ve asistan misafire söylerdi.

İki ayrı kusur: (a) `precedingGuestMessage`in **zaman sınırı yok** — host'un çıkıştan günler sonra
attığı proaktif mesaj, arada misafir mesajı olmadığı için günler önceki soruyla eşleşiyor;
(b) kart, kovayı ilk açan sorunun yanına **en yeni cevabı** basıyor.

⚠️ **CLAUDE.md bunu zaten söylüyordu** (*"`+1 ms` nedensellik kanıtı değildir… doğru çözüm
`Message.replyToMessageId`"*) — uyarı okunup üstüne kurulmuştu. **Geri açma ön koşulları dört madde
hâlinde yazılı.**

### 🚨 İki bacak aynı kartta taşınmaz — benim hatam

Bacak B'nin kartını kaldırırken içinde yaşayan **şablon bacağı da ölü koda döndü** — senin açıkça
istediğin özellik aynı push içinde erişilemez oldu ve commit mesajı bunu söylemedi. Ayrı bileşene
bölündü, kartın çizildiği **test-pinli**. **Ders: bir kartı kaldırırken içindeki her bacağın
tüketicisini say.**

---

## 13. Marka adı + mekanik pinler + CI dersleri

**ESKİDEN:** gerçek işletme adın **95 dosyada 296 kez** geçiyordu (fikstür mülk adları, örnek
SSID'ler, yorumlarda "… canlı hesabı").

**ŞİMDİ:** hepsi temizlendi (fikstürde kurgusal **`Lale`**, canlı hesap atıflarında "kurucu org") +
🚨 **mekanik pin** (`brand-name-absent.test.ts`).

**Pin neden gerekti:** temizlikten **SONRA** ad `34fc701` ile fikstüre **geri geldi ve push edildi**
(benim hatam, ajan buldu); mutasyon turunda "adı geri koy" mutantı **hayatta kalmıştı**.

### 🚨 Repoda git çağıran her test İKİ KATMANLI olmak zorunda (CI'da İKİ KEZ ölçüldü)

E1 pinini düz `git ls-files` ile yazdım, yerelde yeşildi, **CI kırmızı verdi**:
`fatal: detected dubious ownership` (checkout'u yapan kullanıcı ≠ testi koşan kullanıcı) → `4c5262c`
CI'yı geçemedi, "Wait for CI" açık olduğu için **deploy da atlandı**.

⚠️ **Ders repoda zaten yazılıydı** — `brand-name-absent.test.ts` aynı hatayı koşu **#1058**'de ölçüp
çözümünü kendi başlığına yazmıştı; ben yeni bir git tabanlı pin yazarken **o satırları okumadım.**

Zorunlu idiom: ① `git -c safe.directory=<repo> ls-files -z` (global git ayarına asla dokunulmaz)
② git çalışmazsa **dosya sistemi taraması** ③ **fail-open yok**. Ve pinin kendisi git'in varlığını
şart koşmaz — ilk düzeltmemdeki "iki katman aynı sonucu veriyor" testi **git'i zorunlu kılıyordu,
yani düzeltmeye çalıştığım ortam bağımlılığının ta kendisiydi** (sahte `git` stub'ıyla ölçüldü).

---

## 14. Eval — vekilden gerçek kapıya

**ESKİDEN:** eval yalnız `suggestReply` = **TASLAK** ölçüyordu. Taslak ≠ kapı kararı ≠ ürünün cevabı.
Daha kötüsü: E1 sözleşmesi `acknowledgesAbsence` ile **yokluk beyanını ÖDÜLLENDİRİYORDU** — yani
ürünün göndermeyeceği bir cevabı "geçti" sayıyordu.

**ŞİMDİ:** `notDeliverable` o metnin **gönderilmemesini** ölçüyor + **iki eksen** (teslimat ve
uydurma; ilk yazımım teslimat eksenini eklerken uydurma eksenini kapatıyordu). Tek kaynak: harness
yalnız yeniden-dışa-aktarım (`tests/helpers/absence-detector.ts`).

🚨 **Codex bu taşımayı REDDETMİŞTİ** — karar gerekçeyle bozuldu ve açıkça raporlandı; eski belgedeki
madde silinmedi, "geçersizleşti" diye işaretlendi. **Son söz senin.**

### Model kıyası altyapısı (`76490a2`, ücretli servis çağrılmadı)

`tests/eval/sidecar.ts` makine-okunur JSON yazar; `scripts/eval-compare-models.mjs` her modeli
**ayrı süreçte** koşar. 🚨 Markdown parse edilmez (rapor metni her turda değişiyor) · ayrı süreç şart
(`suggestReply` modeli `OPENAI_MODEL`den okur, süreç başına sabit) · ücretli kapı (`EVAL_COMPARE_YES=1`)
· eksik kıyas "geçti" diye okunamaz (çıkış kodu 1).

**Gölge katmanı luna'yı zaten koşuyor ama yalnız GÜVENLİK sınıflandırmasını kıyaslıyor; CEVAP
KALİTESİ bu harness'la ölçülür** — model değişimi iki kanıt ister, gölge yalnız birini verir.

---

## 15. Embedding — kademeli ve hâlâ üretimde bağlı DEĞİL

Senin *"RAG EKLE… EMBEDDİNGDE FALANDA PROJEYİ UÇUR"* talimatının karşılığı. Kapılar:

| Aşama | Durum | İçerik |
|---|---|---|
| **E0** | ✅ | Ücretsiz iki düzeltme: `SEMANTIC_QUALIFY_MIN` 0.3 (yoktu → kosinüs hep >0 → **`no_lexical_hits` bir daha asla tetiklenmezdi**) · anlamsal kaynak varken birleşim **RRF** (CombSUM embedding ile ezilir: BM25 seyrek, kosinüs yoğun) |
| **E1** | ✅ | `provider.ts` sözleşmesi — **üretimde çağıranı YOK ve bu mekanik pinli** |
| **E1b** | ✅ | Senin beş maddenden **üçü uygulandı, ikisi ölçülerek reddedildi** |
| **E2** | ⏳ **SENDE** | Vektör tablosu = migration 56 → taze `pg_dump` + açık onay |
| **E3/E4/E5** | ⏳ | Yazma → **ölçüm** → bağlama. **E5'ten önce E4 şart** |

### E1 sözleşmesi (neden böyle yazıldı)

① **Asla fırlatmaz** — anahtar yok · timeout · 4xx/5xx · bozuk gövde · NaN · sıfır vektör hepsi
`null`; çağıran bunu "anlamsal kaynak yok" diye okur (fail-open **yapısal**).
② **Kısmî sonuç dönmez** — yarım küme çağıranda sessiz eşleşme hatası üretirdi.
③ 🚨 **Sıra `index` alanından kurulur** — dizi sırasına körü körüne güvenilmez ("2. parçanın vektörü"
aslında 3. parçanınki olurdu ve hiçbir test görmezdi).
④ Vektör L2 normalize döner → kosinüs = nokta çarpımı.
⑤ 🚨 **Hata GÖVDESİ alarma geçilmez**, yalnız durum kodu — burada istek gövdesi **KB metni + misafirin
sorusudur**, hata ekosu PII taşıyabilir.

### E1b — senin beş maddenin sonucu

| Madde | Karar | Gerekçe |
|---|---|---|
| LRU önbellek | ✅ | 🚨 Anahtar **içeriktir** (model + SHA-256 özet) → bayatlama **yapısal olarak imkânsız** → **TTL YOK**. Ham metin saklanmaz. Arıza önbelleğe girmez. ⚠️ **Dürüstlük: bu asıl para tasarrufu değil** — kazanç gecikmedir, deploy başına boşalır |
| Tekrar deneme | ✅ | Yalnız 408/429/5xx; 4xx tek atış. 🚨 **Toplam bütçe 9 sn, denemeler dâhil** ("3×8 sn" 24 sn ederdi; bu kod bir **sohbetin içinde** koşuyor) |
| In-place normalizasyon | ✅ | Ölçüldü: `.map()` 1,16 ms → **0,32 ms** (3,6×) |
| Zod doğrulama | ⛔ | Ölçüldü: **1544× yavaş** (11,47 ms vs 0,007 ms); mevcut kontrol zaten strict |
| "Normalize'ı kaldır" | ⛔ | Doğru ama eksik — o fonksiyon aynı zamanda **geçerlilik kapısıdır** (NaN/Infinity + sıfır vektör reddi) |

### 🚨 KVKK'da yeni bir şey YOK — sen haklıydın

09-12'de kodda doğrulandı: misafir mesajı (`prompts.ts` istem gövdesi) ve KB içeriği
(`packKnowledgeBase`) **zaten `api.openai.com`a gidiyor**. Embedding yeni veri **sınıfı** da yeni
**sağlayıcı** da eklemiyor. Benim önceki "ayrı KVKK kararı" çerçevem **dayanaksızdı.**

### Maliyet (ölçüldü)

Kurucu org'un **tüm KB'si 0,18 sent**; en ağır müşteri 3 sent. Sorgu tarafı mesaj başına 67 token =
sohbet isteminin **%0,37'si**. Depo **pgvector DEĞİL** (aday kümesi ≤300 parça → brute-force 1,37 ms;
pgvector Railway'de prod DB taşıma projesi ister) → yeni tablo + `Bytea`.

### Bağlamsal parçalama (senin madde 1'in, `5258fd2`)

**Ölçülmüş gerekçe:** sözcüksel tarafta sorun **yok** (rerank başlık kökünü zaten 0.15 ile
ödüllendiriyor, başlık ayrı alanda) ama **embedding yalnız verilen METNİ görür** → uzun rehberin
**orta parçası** başlığı olmadan gömülürse zayıf eşleşir.

🚨 **`text` DEĞİŞTİRİLMEZ** — "parça = `content.slice`, metin değişmez" pini **isteme giden metin**
içindir (host'un kendi sözleri misafire aynen görünmeli); bağlam **yalnız vektöre** eklenir.
Ne gösterildiği ≠ ne gömüldüğü.

---

## 16. 🚨 Senin dört RAG önerin — ikisi ölçülerek reddedildi

| Öneri | Karar | Ölçülmüş gerekçe |
|---|---|---|
| **① Bağlamsal parçalama** | ✅ Yapıldı | ↑ §15 |
| **② Semantik önbellek** | ⛔ **RED** | *"%95 benziyor mu"* diye sorabilmek için yeni soruyu **önce gömmek** gerekir — kaçınılmak istenen çağrı zaten yapılır (sorgu gömme mesaj başına ~0,00013 sent). Asıl tasarruf **cevabı** önbelleklemek olurdu ve cevap mülke/rezervasyona/saate/KB sürümüne bağlıdır → soru metnine göre anahtarlamak **mülkler arası sızıntı** üretir. Redis de yok |
| **③ Eval/tracing (Langfuse/LangSmith)** | ⚠️ **İlke evet, araç hayır** | Üç metriğin karşılığı zaten bizde: `srcVerified` ≈ faithfulness · ölçek harness'ı `inPrompt` ≈ context precision · eşleştirilmiş eval ≈ answer relevance. Eksik olan tek şey **PANO**. Langfuse = misafir konuşmasını **yeni bir üçüncü tarafa** göndermek (alt-işleyen, KVKK) → kendi `RiskEvent` verimiz üstüne pano doğrusu |
| **④ Streaming (SSE)** | ⛔ **RED (misafir yüzeyi)** | Tüm güvenlik mimarisi model **bittikten sonra** karar veriyor (`admitsMissingKnowledge`, `vetoOutgoingReply`, güven eşiği cevabın **tamamını** okur). Token akıtmak = kapının **bloklayacağı** metni misafire çoktan göndermek. Kanal yolunda ayrıca teknik olarak imkânsız (sağlayıcıya tek mesaj). ✅ Host'un inbox **taslağında** güvenli — ayrı iş |

---

## 17. Codex denetim raporu (09-12) — 21 bulgu

**Rapor kopyalanmadı, her bulgu kodda doğrulandı.** Rapor 09-11 12:05 UTC'ye bakıyordu, araya
**23 commit** girmişti:
- **Bulgu 13 (RAG varsayılan kapalı): BAYAT** — aynı gün 19:29'da ters çevrilmişti
- **Bulgu 16'nın ana iddiası: BAYAT** — `a1c274d` kapatmıştı
- **Bulgu 11'in "~75 KB"ı: YANLIŞ** — gerçek 46.135 karakter (%40 sapma)
- **Bulgu 14'ün önerisi: REDDEDİLDİ** (↑ §8d)
- 🚨 **§E'de yanlış yüzey vardı:** "12 çağrı = 1 birim" olan yüzey Ayarlar "AI'yı Deneyin" **değil**,
  Inbox "Oto-yanıt testi (önizleme)" düğmesi. **Yanlış yüzeye bakan bir düzeltme doğru olanı bozardı.**

**Kapatılanlar:** §A (çıktı vetosu) · §B (makbuzsuz iddia) · §C (temellendirme muhasebesi) ·
§D (QR displacement — **rapor bunu görmedi, ölçüm ajanı buldu**) · §E (bütçe gerekçeleri + latent
`cap` kusuru).

---

## 18. Ne YAPILMADI ve neden (roadmap)

| Faz | Durum | Not |
|---|---|---|
| V0.1–V0.7 | ✅ Canlı | — |
| V1 Property Memory | ✅ Canlı | migration 52, 09-08 |
| **V2.1 "Dikkat Gerektirenler"** | ✅ Canlı (09-09) | **Bu belgenin başlangıç noktası** |
| **V2 kalanı (para etkisi)** | ❌ | `grep moneyImpact` = 0; kodun kendi yorumunda bilinçli dışarıda: *"`Reservation.totalAmount` BRÜT tutardır, kayıp DEĞİL"* |
| V3–V8 | ❌ Başlamadı | — |
| ④ Availability Engine | ❌ Başlamadı | — |
| ⑤ Geniş otonom AI | ❌ | **Ön koşulu bu iki gündü** |

**Ayrıca dokunulmayanlar:** Codex P2 (F09–F18) · V0'ın kalan kolon contract işleri · webhook girişi ·
`Property.hospitableId` global unique · doğrudan kanal + iCal birlikte yaşama gereksinimi.

---

## 19. Sende bekleyenler (ben yapamam)

1. 🚨 **E2 migration onayı** — taze `pg_dump` + açık "push et".
   Paket: `docs/ONAY-E2-embedding-vektor-tablosu-2026-09-12.md`. Bu olmadan E3/E4/E5 yok.
2. **`OPENAI_API_KEY`** — konteyner görmüyor (env açılışta yükleniyor). Session yeniden başlayınca:
   `npm run eval` + `RUN_REAL_EVAL=1 node scripts/eval-compare-models.mjs gpt-5.1 gpt-5.6-luna`.
3. **Migration 55 prod damgası** — salt-okuma doğrulama sorgusu (boot zaten uyguluyor).
4. **Migration 53/54 §B salt-okuma doğrulamaları** (A2 kolonlarının gerçekten dolduğu).
5. **Bekleyen onay paketleri:** `ONAY-acil-asci-carpismasi` (iş #51, `açıl`→`acil`) ·
   `ONAY-qr-mulk-kimlik-alanlari-sir-taramasi` · `RETENTION-MESSAGE-AGE-ANCHOR-ONAY-PAKETI`.
6. **Eski dal uçlarındaki marka adı** — `origin/main` temiz, iki eski uzak dal ucu hâlâ taşıyor
   (silinebilir, karar senin).

---

## 20. Kapılar (son ölçüm, `5258fd2`)

| Kapı | Sonuç |
|---|---|
| `npm test` | **4879 test / 410 dosya** yeşil |
| `tsc` | 0 hata |
| `lint` | 0 uyarı |
| `build` | temiz |
| `audit:check` | temiz |
| **CI #1096** | **success 5/5** (migration-chain · build · security-audit · e2e · verify) |

**Migration:** 1 (55, pushlandı) · **Bayrak değişikliği:** 1 (RAG varsayılan açık, senin talimatın) ·
**Ücretli servise istek:** 0.
