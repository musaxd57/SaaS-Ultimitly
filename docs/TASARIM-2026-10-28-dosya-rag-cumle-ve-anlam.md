# Dosyadan gelen bilgi tabanı için getirme (RAG): cümle düzeyi ve anlam düzeyi — tasarım (10-28)

> Kurucunun isteği (10-28, aynen): *"neden bölüyoruz: misafir 'Wi-Fi şifresi ne?' diye sorunca 20 sayfalık tek metin yerine yalnız Wi-Fi
> kalemi bulunuyor. Cevap hem daha doğru hem daha ucuz oluyor. bunu çok iyi şekilde ele al bu kısımdaki ragı ve embeddingi cümle bazındada
> özellikle anlam bazındada"*
>
> Bu belge KOD YAZMADAN önceki düşünmedir (CLAUDE.md "KODDAN ÖNCE UZUN DÜŞÜN"). Kod değiştirilmedi, test / ücretli çağrı koşulmadı.
> Bağlayıcı kurallar: `docs/claude/retrieval.md` (özellikle "Kök sökücü kuralları — tekrar denemeyin", "Mutlak alaka eşiği REDDEDİLDİ",
> "Ölçülüp etkisiz çıkan (geri önerme)", "YARIM HARİTA YOK"). Üst tasarım: `docs/TASARIM-2026-10-23-bilgi-tabani-dosya-rag-ve-tarama.md`
> (§4 "tek doğru, model bilgi yazamaz", §10.1 `KbChunkVector`).
> Ücretler: gömme $0,02 / 1M belirteç (small), $0,13 (large) — kodda yazılı (`embeddings/model.ts`). Sohbet modeli fiyatları (gpt-5.1
> $1,25 giriş / $10 çıkış, mini $0,25 / $2 / 1M) bu belgede **VARSAYIMDIR**, faturaya karşı doğrulanmadı. Türkçe 3 karakter ≈ 1 belirteç
> (temkinli varsayım).

## 0. Kısaca

- **Dosyanın kendisi aranmaz;** dosya onaylı kalemlere (≤3.000 karakter) dönüşür, getirme kalemlerin 600/900'lük parçaları üzerinde çalışır.
  ≤30 kalem / 24.000 karakterlik bilgi tabanında bilerek seçim yapılmaz (hepsi gider). Kurucunun "yalnız Wi-Fi kalemi bulunur" cümlesi büyük
  bilgi tabanında doğru; orada asıl kazanç ucuzluktan da büyük: seçim olmasa 24k'yı aşan rehberin geri kalanı modele hiç ulaşmaz.
- **Bugün anlam araması parça düzeyinde:** parça başına TEK vektör (`kategori · başlık` önekli). Uzun paragrafta tek önemli cümle, bağlama
  dayalı cümle, tablo satırı, dil farkı bu düzeyde seyrelir.
- 🚨 **Ölçümün kör noktası:** gerçekçi geliştirme setinin hiçbir kalemi 900 karakteri aşmıyor (en uzunu 818) → bugüne kadarki %95–100'ler
  dosya RAG'ı hakkında bir şey söylemiyor. İlk iş uzun belge ölçüm seti.
- **Öneri: "küçük birimle anlamı yakala, parçayı gönder".** İsteme giden birim değişmez; anlam için (1) daha iyi deterministik önek,
  (2) cümle birimleri, (3) kayıt anında üretilmiş çok dilli misafir soruları eklenir; puanlar tür başına eşikten sonra parçaya toplanır.
  `select.ts` değişmez. Her adım anahtarla kapalı, ölçümle açılır.
- 🚨 **`KbChunkVector` şimdi yazılırken eklenmeli (§4.2):** `kind` · `recipe` · `ord` · `textHash`'in tanımı "tarif GİRDİSİNİN özeti" ·
  tekil anahtar `(kbItemId, model, recipe, kind, inputHash, ord)` · boyut doğrulaması tür başına (sabit 1.536 değil) · tür başına temizlik ·
  bayt tabanlı bellek tavanı. Metin kolonu EKLENMEZ (üretilmiş sorular ileride ayrı tabloda).

## 1. Bugün bir misafir sorusu nasıl kalem / parça buluyor (envanter, kodla doğrulandı)

### 1.1 Önce önemli bir gerçek: dosyanın kendisi aranmaz

Kurucu onaylı ilke (10-23 §4.1): **dosya bir kaynaktır, doğru değildir.** `planDocumentImport` (`src/lib/kb-import/document.ts:515`) dosyayı
paragraf bloklarına böler (`splitDocument` :112), başlıklara / kategori sözcüklerine göre konulara ayırır (`sectionByHeadings` :251) ve her
konudan ev sahibinin onayına giden bir **normal bilgi kalemi taslağı** kurar (`assembleDrafts` :370). Kalem metni paragrafların AYNEN
birleşimidir; tek kalem en çok **3.000 karakter** (`billing/kb-item-cap.ts:19` `KB_CHARS_PER_ITEM`), aşan konu "Mutfak (1/3)" gibi sıralı
kalemlere bölünür (`pushDrafts` :476). Plan sınırı daire başına 15 / 30 / 60 etkin kalem.

Sonuç: **getirme her zaman kalemlerin üzerinde çalışır**; "dosya RAG'ı" = içe aktarılmış kalemlerin parçaları üzerinde RAG. Bu belgedeki
her öneri bu ilkeyi korur (dosya metninden ikinci bir aranabilir kopya YOK).

### 1.2 Akış (kanal / QR / öneri / Ayarlar testi — dört yüzey aynı tek girişten)

1. **Okuma**: `kb-fetch` yetki + daire + onay kapısı + ele geçirme süzgeci; hibritte en yeni 200 kalem (`retrieval.md` :18).
2. **Tek giriş** `retrieveKbForPrompt` (`src/lib/ai/kb-retrieve.ts:123`): ad redaksiyonu, geniş bütçe kararı (:128, anahtar
   `KB_RETRIEVAL_WIDE_BUDGET` KAPALI), anlama katmanı (:148; yalnız getirme gerçekten sorguya ihtiyaç duyuyorsa beklenir :169-173).
3. **Küçük bilgi tabanı → seçim YOK**: ≤30 kalem VE biçimli blok ≤24.000 (+60) karakter ise bütün bilgi tabanı isteme gider
   (`select.ts:871`, kural `retrieval/kb-line.ts:65` `kbFitsWhole`; sabitler `ai/limits.ts:23,31`). Bu BİLİNÇLİ ve ölçülmüş (09-23:
   seçerek göndermek parafraz sorularda doğru cevabı düşürüyordu).
4. **Alt sorgular** (`retrievalQueries` `select.ts:472`): mesaj sert (?, satır, ;) ve yumuşak (virgül, "ve") ayraçlarla en çok 4 alt sorguya
   bölünür (`splitQuestions` :396), cevapsız önceki misafir mesajları (≤3) eklenir, anlama katmanının yeniden yazdığı sorgular en sona (≤6).
5. **Parçalama** (`getOrBuildKbIndex` `index-cache.ts:76` → `buildKbIndex` :68 → `chunkItems`): kalem ≤900 karakterse TEK parça (metni
   aynen); uzunsa cümle sınırında 600 hedef / 900 tavan bitişik dilimler (`chunker.ts:17-18`, sınır regex'i :43, `chunkSpans` :129). Parça =
   `content.slice` — metin DEĞİŞMEZ, örtüşme YOK. Parça kimliği `kalemId#sıra` (`chunkKey` :185).
6. **Anlamsal hazırlık** (`prepareSemanticScores` `embeddings/semantic-retrieval.ts:160`; `KB_SEMANTIC_RETRIEVAL` — canlıda açık beyanı):
   - her parçanın **gömme metni** = `kategori kodu · başlık\n` + parça (`embeddings/context-text.ts:46` `embeddingTextFor`; başlık gövdenin
     başında geçiyorsa tekrar edilmez; tavan 1.200 karakter). Yani basit bir "bağlamsal önek" BUGÜN zaten var.
   - parça vektörleri süreç belleğinde (LRU 4.096, :48), yalnız arka planda ısıtılır (:120 `scheduleWarm`, saatte 2.000 metin :55); tek bir
     parça eksikse karar `cold` = sözcüksel (**YARIM HARİTA YOK**, :193-196); bilgi tabanı >1.000 parçaysa `unavailable` (:53).
   - sorgu tarafı: her alt sorgunun ait olduğu HAM cümle (+ virgülle bölündüyse kendisi) tek çağrıda gömülür, 1,5 sn tavan (:46, :198-199);
     parça puanı = sorgu metinleri arasında en yüksek kosinüs → `thresholdTransform` (eşik small 0,40 / large 0,25, `retrieval/semantic.ts:60,68,77`).
7. **Sıralama** (`rankForSubquery` `select.ts:555`): üç kaynak — BM25 (Türkçe kök + sözlük genişletmesi + yazım toleransı, :591),
   karakter 3-gram (yalnız Türkçe sorgu, :604-614), anlamsal (:616-624). Aday şartı `hasEvidence` (:634: güçlü kök / 3-gram ≥0,3 / anlamsal
   ≥0,3); anlamsal varken birleşim **RRF** (:651); başlık / kavram / ikili bonusları (`rerank` :665); göreli taban (:675).
8. **Yeniden sıralayıcı** (`semantic/rerank.ts`; `KB_RERANK_ENABLED` canlıda açık beyanı): yalnız `sem: ok` + `fb: none` iken (`kb-retrieve.ts:180,196`),
   alt sorgu listelerinden ilk 20 aday tek çağrıda (`rerank.ts:37,324`; `KB_RERANK_PER_QUESTION` kapalı) modele "cevaplıyor / ilgili" diye işaretletilir; model her adayın `başlık — metin`inin
   **ilk 600 karakterini** görür (`rerank.ts:58,111`; parça 900'e kadar uzayabildiği için sonu görünmeyebilir). Seçiciye yalnız SIRA sinyali
   (kademe 3→2→1, `select.ts:905-917`).
9. **Seçim** (`select.ts:1011-1080`): alt sorgular arasında sırayla (round-robin), kalem başına en çok 3 parça × misafirin soru sayısı
   (:958-962), saat çelişkisi ortakları çapanın arkasına (:1038), bütçe **6.000 karakter / 12 parça** (`limits.ts:41-42`); isabet yoksa
   geri çekilme = en yeni ≤30 kalem (:924-943). İsteme giden: `chunkAsItem` (:737) — başlık "(2/5)" ekli, metin parçanın kendisi.
10. **Isıtma tetikleri**: bilgi tabanına yazan her yol `afterKbItemsChanged` (`src/lib/kb/after-change.ts:18`) → `warmPropertyKbVectors`
    (`embeddings/kb-warm.ts:30`; QR biçimi yer tutucu doluysa ayrıca :40-42) + süreç başına açılış ısıtması (:63). Küçük bilgi tabanında
    ısıtma hiçbir şey yapmaz (`warmKbVectors` :238 `retrievalNeeded`).

### 1.3 Kalıcı gömme deposu (10-23 §10.1, kurucu onaylı, şu an yazılıyor)

`KbChunkVector { id · kbItemId (FK cascade) · model · textHash · dims · vector (Bytes) · createdAt }`, tekil `(kbItemId, model, textHash)`;
`textHash` = `embeddingTextFor` metninin SHA-256'sı; metin saklanmaz; okuma eksik parçaların kalem kimlikleriyle, 250 ms; bozuk satır
(boyut ≠ 1.536 …) silinir; bayat satır temizliği `createdAt < kalem.updatedAt`; anahtar `KB_VECTOR_STORE_ENABLED` KAPALI. Çalışma ağacında
henüz şema / migration yok (son migration `86_reservation_guest_counts`) → **eklenecek kolonlar için en ucuz an şimdi** (↓§4.2).

### 1.4 Ölçerler (ne var, nasıl koşulur)

| Ölçer | Ne ölçer | Nasıl | Ücret |
|---|---|---|---|
| `tests/unit/kb-retrieval-scale.test.ts` | 38 konu, 30/100/300 kalem; cevap CÜMLESİ blokta mı; sözcüksel | `npm test` içinde | yok |
| `tests/eval/rag-lab.eval.test.ts` + `rag-lab/` | üretim boru hattını aynen koşar, kaçan cevabın kaybolduğu AŞAMAYI yazar (okuma · parça · geri çekilme · eşik · pencere · bütçe · kırpma); negatif soruda blok şişmesi, sızıntı | `RUN_REAL_EVAL=1 EVAL_RAG_KB=scale\|perq\|e4 EVAL_RAG_CONFIGS=live,live+… npm run eval`; yapılandırma belirteçleri `rag-lab/config.ts:15-31`; model / gömme çıktıları disk önbellekli, `RAG_LAB_OFFLINE=1` yalnız önbellek | gömme sentler; anlama + sıralayıcı ücretli |
| `tests/eval/rag-answer.eval.test.ts` | seçilen blokla cevap modeli; cevap KODLA ölçülür (sayı, "bilgim yok", devir, desteksiz iddia) | aynı | ücretli |
| `tests/eval/embedding-e4.eval.test.ts` | anlamsal eşik taraması | `npm run eval` | sentler |
| Veri | `evals/rag-scale/dev.json` (görülebilir) · `holdout.json` (AÇILMAZ, yalnız son kabul, toplu sayı) | | |

🚨 **Ölçümün kör noktası (bu turda ölçüldü, `dev.json` üzerinde salt okuma):** geliştirme setinin 302 kaleminin ortanca uzunluğu **222**
karakter, en uzunu **818**; **900'ü aşan (yani birden çok parçaya bölünen) tek kalem YOK.** Bugüne kadarki bütün gerçekçi RAG sayıları
(%95–100'ler) **tek parçalı kısa kalemlerde** alındı. Uzun kalem yolu yalnız sentetik bir "Ev rehberi"yle (`tests/helpers/kb-retrieval-synthetic.ts:125`,
12 paragraf ≈1,8k karakter, 3 gömülü olgu) ve 09-27 §6e'deki 4,8k'lık sözcüksel ölçümle sınandı. Dosyadan içe aktarmada kalemler 3.000
karaktere kadar çıkacak → **bugünkü ölçümler dosya RAG'ı hakkında bir şey söylemiyor.** İlk iş ölçüdür (§5).

### 1.5 Bu turda görülen küçük bayat yorumlar (bilgi; dokunulmadı)

- `src/lib/ai/embeddings/context-text.ts:17` "ÜRETİMDE ÇAĞIRANI YOK" ve `src/lib/ai/embeddings/provider.ts:4` "BU DOSYANIN BUGÜN HİÇBİR
  ÇAĞIRANI YOK" — ikisi de bayat: `semantic-retrieval.ts:42-43,179,246` ve `answer-reuse/shadow-hook.ts:11` kullanıyor.
- Gömme öneki kategori KODUNU yazıyor ("local_tips", "general"), Türkçe adını değil ("Yerel Tavsiye", "Genel" — `constants.ts:141-154`).

## 2. Uzun belge ile el yazımı kısa kalem: farklar ve bugünkü zayıf noktalar

| | El yazımı kalem (bugün tipik) | Dosyadan gelen kalem |
|---|---|---|
| Boy | 100–300 karakter, 1–3 cümle → TEK parça | 1.000–3.000 karakter → 2–5 parça (600/900) |
| Konu | tek konu, başlık = konu | bir başlığın altındaki her şey; kategorisi aynı olan başka sayfalardaki paragraflar da aynı kaleme toplanır (`document.ts:277-292`) |
| Başlık | ev sahibinin yazdığı | belgenin başlığı ya da kategori adı; 3.000'i aşınca "Mutfak (2/3)" |
| Bilgi tabanı boyu | çoğu 30 kalem / 24k altı → **seçim hiç yapılmaz**, hepsi gider | 20 sayfa ≈ 50.000 karakter → seçim devreye girer; 24k'yı aşan kısım seçimsiz yolda zaten modele ULAŞAMAZ |

Kurucunun cümlesi büyük bilgi tabanında doğru, bir inceltmeyle: seçilen şey "yalnız Wi-Fi kalemi" değil, soruya en uygun **parçalar**
(bütçe 6.000 karakter / 12 parça, birden çok kalemden). Ve asıl kazanç ucuzluktan büyük: 50.000 karakterlik bir rehberde seçimsiz yol
(legacy) en yeni 30 kalemi / 24.000 karakteri gönderir, **gerisi modele hiç gitmez** — getirme olmadan rehberin yarısı yok sayılırdı.
Ucuzluk tahmini (varsayımsal fiyatla): 50k karakteri her mesajda göndermek ≈ 16,7k belirteç ≈ 2,1 sent; 6k seçim ≈ 2k belirteç ≈ 0,25 sent.

**Zayıf noktalar — somut örnekler (Lale fikstürü):**

1. **Uzun paragrafta tek önemli cümle (anlam seyrelmesi).** "Isıtma ve sıcak su" kalemi 850 karakterlik tek paragraf; 6. cümle "Kombi
   termostatı salondaki duvarda, 24 dereceye kadar açabilirsiniz." Misafir: *"Evi biraz daha ılık yapabilir miyiz?"* Sözcük ortak değil
   (BM25 yok), parçanın TEK vektörü altı cümlenin karışımı → kosinüs eşiğin altında kalabilir (lab'daki "eşik" aşaması). Bugünkü gömme
   parça düzeyinde; içindeki cümleleri ayırmaz (10-23 §3'te havuz / havuz barı için de yazıldı).
2. **Bağlama dayalı cümle.** "Wi-Fi" başlığının altında ikinci paragraf: *"Şifresi modemin altındaki etikette yazar; bağlanamazsanız
   cihazı 10 saniye kapatıp açın."* Parça "Wi-Fi" kaleminin içindeyse önek kurtarır; ama kalem 3.000'i aşıp "Teknik (2/2)" olmuşsa ya da
   paragraf kategorisiz "Genel"e düştüyse "şifresi" neyin şifresi belli değil. *"bkz. yukarıdaki bölüm"*, *"Bunu da kapatın."*,
   *"Orada 2 numaralı yer sizindir."* gibi cümleler tek başına gömülürse anlamsızdır; işaret ettiği bölüm başka kalemde olabilir.
3. **Yönlendirme cümlesi yer kaplar.** *"Şifre için yukarıdaki Giriş bölümüne bakın."* hem sözcüksel hem anlamsal olarak "şifre"
   sorusuna çok benzer → bütçede bir yuva kaplar ama cevap taşımaz (sıralayıcı "ilgili" der, "cevaplıyor" demez).
4. **Tablo.** PDF / Word tablosu metne düzleşince *"Havuz 09:00 20:00"*, *"Sauna 16:00 22:00"* satırları başlık satırı (*"Tesis · Açılış ·
   Kapanış"*) olmadan kalır; R3 / S2'de bekleyen yardımcı ("tablo satırı → etiket: değer") yok. Satırın anlamı sütun başlığındadır.
5. **Çok dilli belge.** Ev sahibi İngilizce bir "House Manual" yükler; misafir Türkçe sorar. Ölçülmüş açık: Türkçe soru → İngilizce yazılmış
   kalem yönü %79 (diğer yönler %98–100; `docs/olcum/RAG-AYRISTIRMA-2026-10-10.md` §2). İngilizce köprü sorgusu var ama anahtarı KAPALI
   (`AI_UNDERSTANDING_EN_QUERY_ENABLED`). İki dilli belgede (her paragraf TR + EN) aynı olgu iki kez gelir: bütçede iki yuva; ev sahibi
   yalnız Türkçesini güncellerse İngilizcesi bayat kalır (saat dışı değerlerde çelişki koruması yok).
6. **Aynı konu belgenin iki yerinde.** Sayfa 3 "Çıkış 11:00", sayfa 17 "Geç çıkış için 12:00'ye kadar …". Kategorili paragraflar tek kaleme
   toplanır (iyi: tek doğru) ama 3.000'i aşınca iki kaleme bölünür; başlık altındaki paragraf ile başlıksız paragraf ise iki ayrı kalem olur.
   Saat çelişkisi parçalar arasında yakalanır (`preserveTimeConflicts`, `select.ts:1038`); saat DIŞI değerlerde (otopark no, ücret)
   yakalanmaz → taramanın işi (10-23 §5 T5 / T6).
7. **Kural + istisna ayrı cümlelerde.** "Havuz 09:00–20:00 açıktır. … Cumartesi 23:00'e kadar." İstisna parçanın sonunda, kural başında.
   🚨 Buradan çıkan TASARIM KURALI: **cümle düzeyinde EŞLEŞTİRMEK iyi, cümle düzeyinde GÖNDERMEK tehlikeli** — yalnız "Cumartesi 23:00'e
   kadar" cümlesi giderse model genel kuralı göremez (kurucunun istisna kuralı, Soru 9 ile aynı sınıf). Gönderilen birim çevresiyle
   birlikte olmalı.
8. **Parça sınırı.** Parçalar örtüşmez; bir cümle ancak bir parçada. "Otopark: bina arkasında. 12 numaralı yer sizindir." 600'ün tam
   sınırına düşerse ikinci cümle bir sonraki parçanın başına geçer ve "12 numaralı yer" neyin yeri, parçada yazmaz (lab'ın "parça" aşaması
   bunu sayar; kısa kalemlerde hiç oluşmadığı için bugüne kadar 0 ölçüldü).
9. **Sıralayıcı kırpması.** Sıralayıcı adayın ilk 600 karakterini görür; 900'lük parçanın son cümlesindeki cevabı göremeyebilir
   (lab'ın "kırpma" sütunu). Kısa kalemde sorun değildi; uzun kalemde olacak.
10. **Isıtma tavanı ve soğukluk.** Saatte 2.000 metin bütün kiracılarda ORTAK; 50k'lık bir rehber ≈ 85 parça. Belge yüklenince ilk
    mesajlar `cold` (sözcüksel) — kalıcı depo bunu çözer; ama ileride cümle birimleri eklenirse (≈550 metin) tavan sayısı yetmez (§4).

## 3. Seçenekler

Ortak hesap tabanı (§6 maliyet tablosuyla aynı): "dosyalı daire" = 50.000 karakter ≈ 25 kalem ≈ 85 parça ≈ 550 cümle birimi; "plan tavanı"
= 60 kalem × 3.000 = 180.000 karakter ≈ 300 parça ≈ 2.000 cümle birimi. Vektör: 1.536 boyut × 4 bayt = 6.144 bayt (+~180 bayt satır / dizin).
Bugünkü küçük bilgi tabanında (≤30 kalem / 24k) **hiçbir seçenek bir şey değiştirmez**: orada seçim yapılmaz, ısıtma da yapılmaz.

### Mimari ilke (bütün seçeneklerin altında): İSTEM BİRİMİ ≠ EŞLEŞME BİRİMİ

İsteme giden birim bugünkü parça olarak KALIR (`content.slice`, 600/900, metin aynen; çelişki koruması, bütçe, kalem tavanı, kanıt, sıralayıcı
hep parça kimliğiyle çalışıyor). Eşleşme için ek birimler (cümle, soru, kalem) üretilir; her birinin puanı **ait olduğu parçaya** toplanır.
Bu, seçicinin sözleşmesine birebir oturuyor: anlamsal kaynak seçiciye zaten `alt sorgu → parça anahtarı → puan` haritası veriyor
(`select.ts` `semanticBySubquery`, :893). Haritayı daha iyi doldurmak **`select.ts`'e dokunmadan**, yalnız `prepareSemanticScores` + ısıtma +
depo içinde yapılabilir. "Kod bilgi yazmaz, model bilgi yazmaz" ilkeleri de korunur: eşleşme birimleri hiçbir zaman isteme / misafire gitmez
(`context-text.ts` başlığındaki "ne gösterildiği ile ne gömüldüğü AYRI" kuralının genişlemesi).

### (a) Cümle düzeyi vektör + "küçükten büyüğe" (cümle eşleşir, parça döner)

- **Ne:** **en az 3 cümle birimi taşıyan her parçanın** (çok parçalı kalemin parçaları da, 900'ün altındaki tek parçalı uzun paragraf da —
  §2 madde 1'deki 850 karakterlik örnek tek parçadır) her cümlesi / satırı ayrı gömülür; parçanın anlamsal puanı = kendi vektörü ile
  cümlelerinin en iyisi (tür başına eşik dönüşümünden sonra en büyük — ↓"puan birleştirme"). İsteme parça gider (cümlenin çevresi + kural +
  istisna birlikte; §2 madde 7). 1–2 cümlelik parçada cümle vektörü parça vektörüyle neredeyse aynıdır → üretilmez (bugünkü tipik kısa
  kalemlerin çoğu böyle; dev setinde ortanca 222 karakter).
- **Birim tarifi (deterministik):** cümle = parçalayıcının KENDİ cümle / satır bölücüsü (`chunker.ts:43-72`, tek kaynak); 40 karakterden
  kısa birim sonrakine yapışır ("Şifre:" + "1234"); gömme metni = `Türkçe kategori adı · başlık ("(2/3)" eki atılmış) · en yakın kalem içi
  alt başlık` + **önceki birim** (bağlama dayalı cümle için: "Bunu…", "Orada…", "Şifresi…") + birimin kendisi.
- **Literatür:** LlamaIndex "sentence window" (tek cümle gömülür, ±k cümlelik pencere döner) ve LangChain "parent document retriever"
  (küçük parça eşleşir, ebeveyn belge döner) bu düzenin adıdır (bildiğim kadarıyla; sayfalar bu turda açılmadı).
- **Kazanç:** §2 madde 1 (seyrelme), 8 (parça sınırı — cümle birimi sınırdan bağımsız), kısmen 2 (önceki birim bağlamıyla).
- **Risk:** (1) EN BÜYÜK RİSK negatif sorgu: 550 birimin EN İYİSİ alınınca rastgele yüksek kosinüs bulma olasılığı artar → yanıtsız soruda
  blok şişer, `no_lexical_hits` geri çekilmesi seyrekleşir ("bilgi yok" dürüstlüğü). Mutlak eşik REDDEDİLDİ; çözüm cümle türünün KENDİ eşiği
  (E4 taraması gibi ölçülür) + lab'ın `neg parça` / `neg geri` sütunları kapı. (2) Kısa cümle vektörü gürültülü ("Teşekkürler!"). (3) Türkçe
  kısaltmalar cümleyi yanlış böler ("Apt. 4", "Dr. Ayşe") — önceki birim bağlamı yumuşatır.
- **Maliyet:** dosyalı daire ≈ 37,7k belirteç → small $0,00075 / large $0,0049 (tek sefer). Sorgu tarafı **ek çağrı YOK** (aynı sorgu vektörü).
- **Gecikme:** yalnız CPU: 85 parça × 1.536 + 550 cümle × 512 boyut × ~10 sorgu metni ≈ 6,7M çarpma-toplama (birkaç ms); plan tavanında ≈ 24M
  (onlarca ms) — ölçülmeli, `SEMANTIC_MAX_CHUNKS` (1.000) gibi cümleye ayrı tavan.
- **Depo:** dosyalı daire 1.536 boyutta 3,5 MB, **512 boyutta 1,2 MB** (text-embedding-3 vektörü kısaltılabilir: ilk 512 sayı + yeniden
  normalleştirme; OpenAI'nin `dimensions` parametresiyle aynı işlem — ikincil kaynaklar small 1.536 → 512'de MTEB 62,3 → 61,6 diyor, resmî sayfa
  bu turda açılamadı). Sorgu vektörü 1.536 gömülür, cümle puanı için ilk 512'si kullanılır → tek sorgu çağrısı iki boyuta da yeter.
- **KbChunkVector uyumu:** bugünkü şema satırı TAŞIYABİLİR (metin özeti deterministik), ama (i) tür ayrımı yok → eski tarif temizlenemez,
  tür başına eşik / sayım yapılamaz; (ii) okuma doğrulaması "boyut ≠ 1.536 → bozuk, sil" → 512'lik cümle satırları silinir. → §4.2.

### (b) Bağlamsal başlık ekleme ("contextual retrieval")

- **Bugün:** deterministik önek VAR (`kategori kodu · başlık`, `context-text.ts:46`). Eksikleri: kategori KODU ("local_tips"), "(2/3)" eki
  gürültü, kalem içi alt başlık yok, önceki cümle yok, tablo başlığı yok.
- **b1 — deterministik önek v2:** Türkçe kategori adı + temiz başlık + kalem içi en yakın alt başlık + (tablo satırında) sütun başlığı satırı.
  Ücretsiz, deterministik, metin isteme gitmez. **Önerilen ilk adım.**
- **b2 — Anthropic tarzı model yazımı bağlam:** her parça için modelin bütün belgeyi görüp 50–100 belirteçlik "bu parça nerede, ne hakkında"
  cümlesi yazması; hem gömmeye hem BM25'e eklenmesi. Anthropic'in yayımladığı ölçüm (sayfa bu turda açıldı): ilk 20'de getirme hatası
  %5,7 → bağlamsal gömme ile %3,7 (−%35), + bağlamsal BM25 ile %2,9 (−%49), + yeniden sıralayıcıyla %1,9 (−%67); istem önbelleğiyle ≈ $1,02 /
  1M belge belirteci; aynı yazı "bilgi tabanı 200k belirtecin altındaysa hepsini isteme koyun" der (bizim ≤24k kuralımızın büyük ölçekli ikizi).
- **Bizdeki fark:** Anthropic'in parçaları bağlamsız uzun belgelerden; bizimkiler zaten KONUYA ayrılmış ve başlıklı kalemlerden geliyor →
  b1'in b2 kazancının çoğunu almasını beklerim (tahmin, ölçülmedi). b2'de model yalnız ARAMA anahtarı yazar (isteme / misafire gitmez,
  "model bilgi yazamaz" ihlali değil) ama uydurma bağlam yanlış parçayı eşleştirebilir; maliyet ≈ dosyalı daire başına 20 sent (gpt-5.1,
  kalem bağlamıyla) / 4 sent (mini); belgenin bütünü bağlam olursa istem önbelleği şart. BM25'e metin eklemek ölçülmüş sözcüksel pinlerin
  çoğunu oynatır (`retrieval.md` kök / sözlük kuralları) → yalnız gömme tarafında, ayrı ölçümle.
- **KbChunkVector uyumu:** b1 deterministik → bugünkü özet anahtarı yeter, ama tarif DEĞİŞTİĞİNDE eski satırlar sonsuza kadar kalır (kalem
  değişmediği için `createdAt < updatedAt` silmez; açılış süpürmesi yalnız eski MODELİ siler) → `recipe` kolonu. b2 model çıktısı → okuyucu
  gömülen metni yeniden hesaplayamaz → anahtar ÇIKTININ değil GİRDİNİN özeti olmalı + üretilen metin ayrı tabloda (§4.2).

### (c) Çok ayrıntı düzeyi (kalem + parça + cümle) ve birleşik puan

- **Ne:** üç vektör türü; parçanın anlamsal puanı = tür başına eşik dönüşümünden geçmiş puanların birleşimi; kalem vektörü parçalarına
  "önsel" katkı (doğru kalemdeki ama kendi metninde sorunun sözcüğü olmayan "Mutfak (2/3)" parçası).
- **Puan birleştirme seçenekleri (lab belirteçleriyle kıyaslanır):** (c1) tür başına `thresholdTransform(cos, eşik_tür)` → EN BÜYÜK —
  `select.ts` değişmez, RRF ağırlıkları aynı; (c2) cümle ayrı bir RRF kaynağı ("semantic_sent") — `select.ts`'e yeni kaynak, BM25'in
  RRF'teki payı seyrelir (ölçülmeden yapılmaz); (c3) kalem önseli `parça += α·kalem`.
- **Neden "en büyük" ve tür başına eşik:** kosinüs dağılımı birim türüne göre değişir (kısa metin ↔ soru daha yüksek ve daha oynak). Ham
  kosinüslerin en büyüğünü almak, en "şanslı" türü kazandırır. Her tür kendi ölçülen eşiğiyle aynı ölçeğe (0,3 aday sınırı) taşındıktan
  sonra en büyük alınır — bugünkü model başına eşik (`semanticThresholdFor`) kuralının tür başına uzantısı.
- **Kazanç:** (c1) = (a)'nın kazancı; kalem önselinin kazancı belirsiz (3.000 karakterlik çok konulu kalemin vektörü de seyreltik). **Önerim:
  kalem türü yalnız lab'da denensin, üretime ölçümle girsin.**
- **Maliyet / depo:** kalem vektörü dosyalı dairede ≈ 0,16 MB, sentler.

### (d) Varsayımsal soru üretimi (soru-anahtar indeksleme, "HyPE / doc2query") — ve sorgu anında HyDE

- **Sorgu anında HyDE** (her misafir mesajında modelin "varsayımsal cevap" yazıp onu gömmesi): ÖNERMİYORUM. Gecikme + mesaj başı model
  çağrısı; anlama katmanı zaten bağımsız Türkçe + özgün dil sorgusu yazıyor; HyDE makalesi çok dilli görevlerde ince ayarlı getiriciyi
  geçemedi (`RAG-EMBEDDING-SON-DURUM-2026-09-28.md` §6 — orada da düşük öncelik).
- **Kayıt anında soru üretimi (önerilen "anlam" kaldıracı):** her parça için BİR KEZ, model "bu parça misafirin hangi sorularına cevap
  verir" listesi yazar (Türkçe 3–4 + İngilizce 2 + belge başka dildeyse o dilde 1–2; misafir ağzıyla, kısa). Sorular gömülür; misafir sorusu
  ↔ üretilmiş soru benzerliği (simetrik, soru ↔ soru) soru ↔ paragraf benzerliğinden (asimetrik) çok daha keskin. Eşleşen soru → ait
  olduğu PARÇA döner.
- **Örnek:** parça "Atıklar bina girişindeki yeşil konteynere bırakılır; geri dönüşüm mavi kutudadır." → üretilen: "Çöpü nereye atacağız?",
  "Geri dönüşüm kutusu nerede?", "Where do I put the trash?", "Wo kommt der Müll hin?". Misafir: *"Poşetleri dışarı nereye bırakıyoruz?"*
  → sözcük ortak değil, soru-soru benzerliği yüksek.
- **Güvenlik / ilke:** sorular yalnız ARAMA ANAHTARI — isteme, misafire, cevap modeline GİTMEZ; bilgi tabanına yazılmaz (kalem metni aynen
  kalır). Uydurma soru en kötü ihtimalle yanlış parçayı ADAY yapar; sıralayıcı + parça okuyucusu + gönderim kapıları aynen koşar. Kötü niyetli
  kalem metni ("önceki talimatları unut …") üretim isteminde veri olarak çitlenir (`fenceSafe` emsali), ele geçirme süzgecinden geçmiş kalemler
  için üretilir.
- **Kanıt:** kurum içi öncelik listesinde #2 (`RAG-EMBEDDING-SON-DURUM-2026-09-28.md` §2: HyPE ön baskısı bazı setlerde büyük kazanç; karşı
  kanıt: güçlü getiricide genişletme bazen zarar). Türkçe ölçüm YOK → kendi ölçümümüz şart.
- **Maliyet:** üretim dosyalı daire başına ≈ 23 sent (gpt-5.1, parça başına ~600 giriş / ~200 çıkış belirteci, varsayım) / ≈ 5 sent (mini);
  plan tavanında ≈ 83 / 17 sent; yalnız DEĞİŞEN parça için yeniden. Gömme ≈ 0,015 sent. Sorgu anında ek çağrı YOK.
- **Depo:** parça başına 6 soru × 85 = 510 vektör → 1.536'da 3,2 MB, 512'de 1,1 MB / daire.
- **KbChunkVector uyumu:** bugünkü şema TAŞIYAMAZ: okuyucu soru metnini yeniden üretemez (model çıktısı) → `textHash` ile arayamaz; soru
  vektörünün hangi parçaya ait olduğu satırda yazmaz. Gereken: girdi özeti + tarif + sıra (`ord`), soru METNİ ayrı tabloda (model değişince
  sorular yeniden ÜRETİLMEDEN yeniden gömülebilsin). → §4.2.

### (e) Çok dilli eşleşme (Türkçe soru ↔ İngilizce belge)

| Yol | Durum | Kazanç / risk |
|---|---|---|
| e1 İngilizce köprü sorgusu (sorgu tarafı) | kodda, `AI_UNDERSTANDING_EN_QUERY_ENABLED` KAPALI | TR→EN yönünü hedefler; 4–5 sorulu mesajda yalnız ilk 1–2 isteğe yetişir |
| e2 large gömme modeli | env'den açılır (`OPENAI_EMBEDDING_MODEL`) | ölçülmüş: Türkçe dışı diller 76→93/111 (`embeddings/model.ts` yorumu); maliyet ×6,5 ama hâlâ sent |
| e3 soru üretiminin çok dilli olması (d) | yok | belge dili ne olursa olsun TR + EN soru → dil köprüsü kayıt anında, misafiri beklemeden |
| e4 parçanın gömme için çevirisi | yok | (d) ile aynı maliyet sınıfı, kazancı (d)'nin içinde; ayrıca önermiyorum |
| Sözcüksel yabancı dil sözlüğü | var (DE/FR/ES/RU/AR, sorgu tarafı) | bilerek DAR; büyütmek çakışma tuzakları ister (`retrieval.md`) — önermiyorum |

İki dilli belgede yinelenen olgu (§2 madde 5): cümle vektörleri iki dildeki eş paragrafı bulabilir → taramaya "bu iki paragraf aynı şeyi
söylüyor, değerleri farklı mı?" bulucusu (değer karşılaştırması KODLA). Getirmenin değil taramanın işi; ayrı soru (§6).

### (f) Yeniden sıralayıcının yeri

- Yeri DOĞRU: birleşimden sonra, bütçeden önce, İSTEM BİRİMİ (parça) üzerinde. Cümle düzeyinde sıralama ÖNERMİYORUM (misafire gidecek
  birim parça; cümle sıralaması pencereyi 5–10 kat büyütür, gecikme 2,5 sn tavanına çarpar — Luna ölçümünde tavan aşımı zaten kayıp kaynağıydı).
- **İyileştirme f1 — eşleşen cümleye ortalanmış kırpma:** sıralayıcıya parçanın ilk 600 karakteri yerine, cümle birimi en iyi eşleşen cümleyi
  ortalayan 600 karakterlik bitişik pencere (yine `content.slice`) gösterilir. §2 madde 9'u kapatır, istek boyu aynı. Lab'ın "kırpma" sütunuyla ölçülür.
- **Yerel çapraz-kodlayıcı** ŞİMDİLİK HAYIR (bağlayıcı kural); barındırılan (Cohere / Voyage) yeni alt işleyen = KVKK işi (09-28 belgesi §3). Bu
  tasarım ona bağlı değil.
- Literatür / büyük şirketler (bildiğim kadarıyla, sayfalar açılmadı): OpenAI dosya arama aracı varsayılan ~800 belirteçlik parça + ~400
  örtüşme ve en çok 20 parça döndürür; Cohere getirme → yeniden sıralama → üretim düzenini önerir; Anthropic yukarıdaki ölçümünde sıralayıcıyı
  en büyük tek adım olarak gösterir. Bizim parçalarımız (≈150–300 belirteç) bunlardan zaten küçük — "daha küçük parça" değil, "küçük birimle
  eşleş, parçayı gönder" yönü tutarlı.

### Seçeneklerin özeti

| Seçenek | Hedeflediği zayıflık (§2) | Müşteriye giden metin değişir mi | Ücret (dosyalı daire, tek sefer) | Sorgu gecikmesi | Depo (daire) | Şemanın bugünkü hâli |
|---|---|---|---|---|---|---|
| (a) cümle + küçükten büyüğe | 1, 2, 8 | Hayır (aynı parçalar, daha iyi sıra) | $0,00075 | +ms (CPU) | 1,2 MB (512) | kısmen — tür + boyut doğrulaması eksik |
| (b1) önek v2 | 2, 4 | Hayır | ≈ bugünkü yeniden gömme | yok | aynı | tarif kolonu eksik |
| (b2) model yazımı bağlam | 2, 3 | Hayır | ≈ 4–20 sent | yok | aynı | taşıyamaz |
| (c) kalem önseli | 6 (kısmen) | Hayır | ≈ $0,0003 | yok | 0,16 MB | tür kolonu eksik |
| (d) soru üretimi | 1, 2, 5 | Hayır | ≈ 5–23 sent | yok | 1,1 MB (512) | taşıyamaz |
| (e) dil | 5 | Hayır | (d) içinde / large ×6,5 | yok | — | (d) ile aynı |
| (f1) ortalanmış kırpma | 9 | Hayır | 0 | 0 | 0 | — |

Hiçbiri misafire giden METNİ doğrudan değiştirmez; hepsi modele HANGİ parçaların gittiğini değiştirir → cevap dolaylı olarak değişir.
Bu yüzden her biri anahtarla KAPALI doğar, açılması ölçüm + kurucu kararıdır.

## 4. Öneri: en uzun vadeli yol

### 4.1 Özü

**"Küçük birimle anlamı yakala, parçayı gönder."** İstem birimi bugünkü parça kalır (metin aynen, bütün güvenceler yerinde). Anlam için
parçanın etrafına üç tür eşleşme birimi eklenir — sırasıyla ve her biri ölçümle: (1) daha iyi deterministik önek, (2) cümle birimleri,
(3) kayıt anında üretilmiş misafir soruları (çok dilli). Hepsi tek bir kalıcı depoda, tür + tarif sürümüyle; hepsi parça puanına
"tür başına eşik → en büyük" kuralıyla toplanır; seçici (`select.ts`), bütçe, çelişki koruması, sıralayıcı, parça okuyucusu ve gönderim
kapıları DEĞİŞMEZ.

Neden bu sıra: maliyet ve risk artan, beklenen anlam kazancı da artan sırada; ve **bugün uzun belge ölçümü olmadığı** için (§1.4) önce ölçü
kurulmadan hiçbir adımın kazancı bilinemez. Neden "daha küçük parça" değil: parça küçülünce isteme giden birim de küçülür (istisna kopar,
§2 madde 7), satır başına başlık yükü artar, 12 parçalık bütçe daha az bilgi taşır ve ölçülmüş bütün sözcüksel pinler oynar.

### 4.2 🚨 KbChunkVector — ŞİMDİ (yazılırken) eklenmesi gerekenler

10-23 §10.1 şeması yalnız "bugünkü tek tür, deterministik tarif" için doğru. Aşağıdakiler yeni tabloya şimdi eklenirse bedava (yeni tablo,
dolu tabloya kısıt yok, açılış güvenli); sonra eklenirse ikinci migration + dolu tabloya tekil anahtar değişikliği (CLAUDE.md: dolu tabloya
`@unique` EKLEME) gerekir.

| # | Ekle / değiştir | Neden (hangi seçeneği taşır) | Bugünkü davranışa etkisi |
|---|---|---|---|
| K1 | `kind String @default("chunk")` — kapalı küme kodda: `chunk` · `sentence` · `question` · `item` | (a)(c)(d) aynı tabloda; tür başına eşik, sayım, okuma süzgeci, temizlik | yok (hep `chunk`) |
| K2 | `recipe String @default("c1")` — gömme metni / üretim tarifinin sürümü (`c1` = bugünkü `embeddingTextFor`) | (b1) önek v2'ye geçişte eski tarifin satırları süpürülebilsin (kalem değişmediği için `createdAt < updatedAt` silmez); iki tarif gölge ölçümde yan yana yaşasın; model üretimli tarif istem sürümünü taşısın | yok |
| K3 | `textHash` → **tarif GİRDİSİNİN** özeti olarak tanımla (adı `inputHash` olursa daha açık) | (b2)(d): model çıktısı okuma anında yeniden hesaplanamaz; okuyucunun hesaplayabildiği tek şey girdi (kategori + başlık + parça metni + tarif). Deterministik tarifte girdi = gömülen metin → **bugünkü tasarımla birebir aynı değer** | yok |
| K4 | `ord Int @default(0)` | (d): aynı parçadan 6 soru vektörü | yok |
| K5 | Tekil anahtar `(kbItemId, model, recipe, kind, inputHash, ord)` — **sütun sırası önemli**: okuma `kbItemId IN … AND model = … AND recipe IN …` ilk üç sütunu ön ek olarak kullanır, ayrı dizin gerekmez | K1–K4 ile çakışmasız; cümle ile parça aynı metne sahipse bile ayrı satır (tür farklı) | yok |
| K6 | Okuma doğrulaması: "boyut ≠ 1.536 → bozuk, sil" yerine "boyut ∈ izinli(tür, tarif) VE bayt = boyut × 4 VE hepsi sonlu" | (a): cümle / soru satırları 512 boyutta saklanacak; sabit 1.536 kuralı onları ilk okumada bozuk sayıp silerdi | yok (bugün izinli küme {1536}) |
| K7 | Temizlik fonksiyonu TÜR BAŞINA: parça / cümle için `createdAt < kalem.updatedAt` (ucuz) yeterli; model üretimli türler için "kalemin GEÇERLİ girdi özetleri dışındakileri sil" (10-23 §10'un ilk hâli) | (d): 3.000 karakterlik kalemde tek cümle değişince 5 parçanın sorularını yeniden ÜRETMEK (ücretli) yerine yalnız değişen parçanınkini | yok (bugün yalnız `chunk`) |
| K8 | Bellek LRU anahtarı `model:recipe:kind:inputHash:ord`; tavan SAYI değil BAYT | 512'lik satır 1.536'lığın üçte biri; 4.096 SAYI tavanı cümle birimleriyle anlamsızlaşır | yok (aynı içerik) |

**Bilerek EKLENMEYENLER:**
- **Metin kolonu** — "metin saklanmaz" korunur; tablo her zaman yeniden kurulabilir bir önbellek kalır. Üretilmiş sorular (ve ileride
  model yazımı bağlam) D4'te AYRI tabloda (`KbDerivedText { kbItemId FK cascade · kind · recipe · inputHash · ord · text · createdAt }`) —
  model değişince sorular yeniden ÜRETİLMEDEN yalnız yeniden gömülür. O tablo D4'ün migration'ı (ayrı onay).
- **Konum (başlangıç / bitiş) ya da "ebeveyn parça özeti" kolonu** — cümle → parça eşlemesi kalem metninden deterministik yeniden hesaplanır
  (tarif sürümü buna bağlıdır); soru satırının ebeveyni, girdi özeti (K3) parçanın girdisi olduğu için zaten bellidir.
- **`propertyId` / `organizationId`** — 10.1 gerekçesi geçerli (kalem → daire → işletme cascade; okuma kiracı süzgeçli kalem kimlikleriyle).
- **pgvector / int8 sıkıştırma** — daire başına birkaç bin vektörde bellek içi tarama yeter (§4.4); gerekirse sonra eklenir (yeni kolon,
  varsayılanlı → açılış güvenli).

### 4.3 Dilimler (her biri anahtarla KAPALI doğar, ölçümle açılır)

Anahtarlar yalnız "1" ile açılır (`STRICT_ONE_FLAGS`), `docs/RAILWAY-ACILIS-2026-10-15.md`'ye adıyla girer (pin `railway-doc-flags.test.ts`).
Anahtar kapalıyken her dilimde ağ çağrısı / veritabanı okuması / seçim BAYT BAYT bugünkü (davranışsal pin — mevcut düzenin aynısı).

| Dilim | İçerik | Anahtar | Müşteriye dokunur mu | Kapı |
|---|---|---|---|---|
| **D0** | K1–K8 (S3 ile AYNI migration; yazma `kind=chunk, recipe=c1`) | `KB_VECTOR_STORE_ENABLED` (var) | hayır | 10-23 §10.1 testleri + K6 testi (512'lik satır bozuk sayılmaz, 1.536 dışı bilinmeyen boyut sayılır) |
| **D1** | Uzun belge ölçüm seti + lab belirteçleri + taban ölçümü (§5) | — | hayır | rapor `docs/olcum/` |
| **D2** | (b1) önek v2 (Türkçe kategori adı, temiz başlık, kalem içi alt başlık, tablo başlık satırı) + (f1) sıralayıcıya eşleşen cümleye ortalanmış kırpma | `KB_EMBED_RECIPE_V2` · `KB_RERANK_CENTERED_CROP` | dolaylı (hangi parçaların gittiği) | uzun belge dev setinde kazanç, kısa set + negatif grupta kayıp yok; kör set; kurucu |
| **D3** | (a)+(c1) cümle birimleri, yalnız ≥3 cümle birimli parçalarda; 512 boyut; tür başına eşik (E4 gibi tarama); **YARIM HARİTA YOK tür başına** (cümle türü eksikse o kararda cümle puanı HİÇ kullanılmaz, parça türü tamsa karar `ok`); ısıtma bütçesi metin SAYISI yerine belirteç / kiracı başına | `KB_SEMANTIC_SENTENCES` | dolaylı | aynı + negatif grupta `neg parça` / `neg geri` bozulmaz + gecikme |
| **D4** | (d)+(e3) kayıt anında soru üretimi (TR + EN + belge dili), `KbDerivedText` migration'ı, yalnız getirmenin koştuğu (büyük) bilgi tabanlarında, arka planda, işletme / gün ücret tavanı; üretim istemi sürümlü (`recipe`), ele geçirme süzgecinden geçmiş kalemlere | `KB_SEMANTIC_QUESTIONS` + model `KB_QUESTION_MODEL` | dolaylı | aynı + kör set + cevap düzeyi (`rag-answer`) + ücret raporu; migration = taze yedek + onay |
| D5 (koşullu) | (b2) model yazımı bağlam — yalnız D2–D4'ten sonra uzun belge setinde ölçülen kayıp kalırsa | ayrı | dolaylı | aynı |
| Lab-yalnız | (c3) kalem önseli · (c2) cümleyi ayrı RRF kaynağı yapmak · large gömme ile tekrar | — | — | yalnız rapor; üretime ayrı öneriyle |

Kural yorumu (kurucuya bilgi): "YARIM HARİTA YOK" kuralını tür başına uyguluyorum — bir türün haritası ya tam kullanılır ya hiç; parça
türü bugünkü gibi tam değilse karar yine `cold`. Kural gevşemiyor; cümle türü eksikken davranış = D3 anahtarı kapalıyken.

**Önermediklerim (gerekçeli):** parça boyunu küçültmek (§4.1) · sorgu anında HyDE (§3d) · cümle düzeyinde yeniden sıralama (§3f) · yerel
çapraz-kodlayıcı (bağlayıcı HAYIR) · BM25'e bağlam metni eklemek (sözcüksel pinler; ayrı ölçüm olmadan değil) · yabancı dil sözlüğünü
büyütmek · mutlak alaka eşiği (REDDEDİLDİ) · `retrieval.md` "geri önerme" listesindekiler (atla-paketle, kalem başına 5 parça, anlama payı
1/2, RRF taban, taban 20).

### 4.4 Maliyet tablosu — 100 ev sahibi × 10 daire = 1.000 daire

Varsayımlar: "karışım" = 300 dosyalı daire (50k karakter) + 50 plan tavanında (180k) + 650 küçük bilgi tabanı (vektör ÜRETİLMEZ — seçim
yok); "üst" = 1.000 dairenin hepsi dosyalı. Gömme fiyatı kodda yazılı; sohbet modeli fiyatı VARSAYIM. Tek sefer = ilk kurulum; sonrasında
yalnız değişen kalem / parça.

| Kalem | Karışım (350 daire vektörlü) | Üst (1.000 dosyalı) |
|---|---|---|
| Parça gömme (bugünkü, D0/D2), tek sefer | 8,3M belirteç → small **$0,17** / large $1,08 | 17,3M → $0,35 / $2,26 |
| Cümle birimleri (D3), tek sefer | 18,1M → small **$0,36** / large $2,36 | 37,7M → $0,75 / $4,91 |
| Soru gömme (D4), tek sefer | 3,6M → $0,07 / $0,47 | 7,7M → $0,15 / $0,99 |
| Soru ÜRETİMİ (D4, model), tek sefer | gpt-5.1 ≈ **$111** · mini ≈ $22 | ≈ $234 · ≈ $47 |
| Model yazımı bağlam (D5, koşullu), tek sefer | gpt-5.1 ≈ $94 · mini ≈ $19 | ≈ $197 · ≈ $39 |
| Depo: parça vektörü (1.536) | 0,26 GB | 0,54 GB |
| Depo: cümle (512 · 1.536'da) | 0,59 GB · 1,68 GB | 1,23 GB · 3,48 GB |
| Depo: soru (512 · 1.536'da) | 0,54 GB · 1,54 GB | 1,14 GB · 3,23 GB |
| Sorgu tarafı (mesaj başı) | ek çağrı YOK — bugünkü tek gömme çağrısı (~200 belirteç ≈ $0,000004) | aynı |
| Sorgu CPU (mesaj başı) | dosyalı daire ≈ 6,7M çarpma-toplama (ms) · tavan ≈ 24M (onlarca ms) | aynı |
| Soğuk okuma (karar başı, bellekte yoksa) | dosyalı daire ≈ 0,5 (parça) + 1,2 (cümle) + 1,1 (soru) ≈ 2,9 MB / 250 ms tavanı; plan tavanında ≈ 10 MB → tavanı aşarsa o karar `cold` (güvenli yön) — ölçülmeli | aynı |

Okuma: **gömme ücreti her seçenekte önemsiz** (sentler); belirleyici olanlar (1) soru üretiminin model ücreti (yüzlerce dolar ölçeğinde,
tek sefer — ucuz modelle beşte biri), (2) depo boyutu (512 boyut ve "yalnız ≥3 cümleli parçalar" kuralıyla GB altı / civarı) ve (3) soğuk
okuma süresi. Kıyas için cevap tarafı: dosyalı bir dairede seçim yerine bütün bilgi tabanını göndermek mesaj başına ≈ 2 sent fazla olurdu
(varsayımsal fiyat) — 1.000 mesajda soru üretiminin daire başı tek seferlik bedelinin onlarca katı.

## 5. Ölçüm planı

### 5.1 Sert kör set: uzun belgeler (D1 — her şeyin ön koşulu)

- **Dosyalar:** `evals/rag-docs/dev.json` (görülebilir, ayar) + `evals/rag-docs/holdout.json` (bugünkü `rag-scale/holdout.json` sözleşmesi:
  içeriği okunmaz, yalnız son kabulde toplu sayı).
- **Belgeler:** 12–16 kurgusal ev rehberi (8–25 sayfa; toplam ~400–600k karakter; yalnız `Lale` fikstür adları — `brand-name-absent` pini
  geçerli). Çeşit: yalnız Türkçe · yalnız İngilizce · her paragrafı TR + EN · Almanca · tablolu (pdf.js'in düzleştirdiği biçimde: paragraflar
  arası boş satır yok, satır sonu tirelemesi, sütunlar boşlukla) · "bkz. yukarıda" yönlendirmeli · aynı konu iki yerde (tutarlı ve ÇELİŞKİLİ
  değerle) · uzun paragrafta tek kritik cümle · kural ve istisnası ayrı cümlelerde · yer tutucu · kapı kodu (kapıların hâlâ çalıştığını görmek için).
- **Gerçek içe aktarma hattından geçer:** her belge `planDocumentImport` (`document.ts:515`) → taslaklar onaylanmış kalem sayılır → gerçekçi
  boya (25 / 60 kalem) mevcut `rag-scale/dev.json` kısa kalemleriyle tamamlanır. Böylece ölçüm konu ayırmanın etkisini de içerir (bir paragrafın
  yanlış kaleme düşmesi gerçek bir getirme kaybıdır).
- **Sorular (belge başına ~40):** kelime paylaşmayan parafraz · birebir · dil köprüsü (TR soru → EN belge; EN / DE / RU soru → TR belge) · çok
  sorulu mesaj · geçmişli ince soru ("Ücretli mi?") · kural + istisna (iki iğne grubu, İKİSİ de blokta olmalı) · yönlendirme tuzağı (cevap atıf
  yapılan bölümde, atıf cümlesinde değil) · negatif (belgede yok, komşu konu: hamam var / sauna soruluyor) · yakın-ıska negatif ("havuz barı"
  soruluyor, belgede yalnız "havuz").
- **Ayrı yazar (iyimserliğe karşı en önemli şart):** soruları ve iğneleri tarif / istem / kodu görmeyen biri yazar. 🚨 Kör setin soruları
  D4'ün soru üreticisiyle AYNI model ailesinden YAZILAMAZ — aksi hâlde "üretilmiş soru ↔ misafir sorusu" benzerliği yapay olarak şişer.
  Öneri: geliştirme setini başka bir model ailesi (Claude) yazar; kör seti kurucu ya da üçüncü bir yazar (§6 S4). Gerçek misafir mesajı
  kopyalanmaz (KVKK); yalnız üslup örnek alınır.

### 5.2 Mevcut ölçere bağlama (`tests/eval/rag-lab/`)

- Yeni küme: `EVAL_RAG_KB=docs` (`scale-set.ts` yanında yükleyici), yeni gruplar: `doc_para` · `doc_xl` · `doc_multi` · `doc_rule_exc` ·
  `doc_pointer` · `doc_neg`.
- Yeni yapılandırma belirteçleri (`config.ts`): `r:c2` (önek v2) · `sent` (cümle birimleri, varsayılan 512) · `sent1536` · `hq` (soru
  birimleri; üretim çıktısı diğer model çıktıları gibi disk önbellekli) · `cc` (ortalanmış kırpma) · `ts:0.45` / `tq:0.5` (tür başına eşik) ·
  `item` (kalem önseli). 512'lik vektörler önbellekteki 1.536'lıklardan YEREL kısaltmayla üretilir → ek ücret yok.
- Aşama tablosuna: en iyi kosinüs TÜR başına (parça / cümle / soru), "cümle eşleşti ama parça bütçede düştü", anlamsal hazırlık süresi,
  puanlanan birim sayısı, soğuk okuma baytı.
- Ücretsiz gerileme kapısı: `kb-retrieval-scale.test.ts` (sözcüksel) aynen; ayrıca **"≥3 cümle birimli parça yoksa D3 açıkken sonuç
  birebir"** pini. Bugünkü kısa kalemli setlerin ÇOĞU yapı gereği etkilenmez, ama 3+ cümleli kısa kalemler etkilenir → D3 de mevcut `scale` /
  `perq` setlerinde koşulur (kayıp yok şartı). D4 yalnız getirmenin koştuğu bilgi tabanlarında üretir; küçük bilgi tabanında birebir.

### 5.3 Metrikler

| Metrik | Tanım | Neden |
|---|---|---|
| Blokta (mevcut) | cevap CÜMLESİ istem bloğunda | ana getirme ölçüsü |
| Getirme isabeti@k | cevap parçasının birleşik aday listesindeki en iyi sırası ≤ k (k = 1, 3, 5, 10, 20) | bütçeden bağımsız sıralama kalitesi; sıralayıcı penceresi (20) ile ilişki |
| Kural + istisna tamlığı | iki iğnenin ikisi de blokta | §2 madde 7 — eksik koşul, eksik cevaptan daha tehlikeli |
| Yanlış parça oranı | blok karakterinin, sorulan soruların hiçbir iğnesini taşımayan parçalardan gelen payı | gürültü / dikkat dağıtma |
| Yanıltıcı parça (sızıntı) | yasak iğne (bayat sürüm, çelişen değer, yakın-ıska konu) blokta | yanlış cevaba en kısa yol |
| "Bilgi yok" doğruluğu | getirme: negatifte `neg parça` (şişme) + `neg geri` (geri çekilme); cevap (`rag-answer`, ücretli): dürüst devir / desteksiz iddia yok | cümle / soru birimlerinin en büyük riski |
| Soğukluk | yayından / düzenlemeden sonra `cold` karar oranı; depo açık / kapalı | kalıcı deponun asıl işi |
| Gecikme / ücret / depo | anlamsal hazırlık p50 / p95; gömülen ve üretilen belirteç; daire başı bayt | §4.4 tahminlerini gerçeğe bağlamak |

### 5.4 Önce / sonra

- Eşleştirilmiş: aynı sorular, aynı önbellekli sorgu vektörleri; yapılandırmalar `live` (canlı taban) → `live+r:c2` → `+sent` → `+hq` →
  `+cc`; her biri ayrıca SOĞUK yol (`lex`) ve sıralayıcısız. Birincil sonuç geniş bütçe KAPALI (canlı), ikincil açık.
- Rapor oranla değil **kazanç / kayıp sayısıyla** (+X / −Y soru, grup ve dil yönü başına; n yazılı), eşleştirilmiş fark için kesin McNemar;
  ≤2 soruluk fark "fark yok" sayılır. D2 kısa kalemlerin de gömme metnini değiştirir → mevcut `scale` / `perq` setlerinde de koşulur
  (kayıp yok şartı).
- Kabul: kurucunun 09-27 kuralı — vaka başına müşteriye giden sonuç (doğru kanıta dayalı cevap · bilinmeyende dürüst devir · çelişkide kesin
  konuşmama · sıfır sır sızıntısı); oran gelişim çizgisi, zorunlu geçme kuralı DEĞİL. Kör set dilim başına BİR kez.
- Hata analizi: `tests/eval/failure-analysis.ts` yeni kümeye bağlanır (kurucu 10-11 kuralı: kaçan her cevapta açıklama → karşı deneme →
  düzeltme katmanı önerisi → doğrulama).

### 5.5 İyimser olmamak için

- Eşikler ve birleştirme kuralı YALNIZ dev setinde seçilir; kör set dokunulmadan son kabulde.
- Model katmanları koşudan koşuya 1–2 soru oynar (`RAG-AYRISTIRMA` §1) → model içeren yapılandırma iki kez koşulur.
- "Blok / bilgi tabanı" oranı ≥ %90 olan satırda "blokta" başarı sayılmaz (bütçe bilgi tabanından büyük).
- Soğuk yol ve yalnız sözcüksel sonuç ayrıca raporlanır (yeniden başlatma / düzenleme sonrası gerçek hâl).
- Cevap düzeyi (`rag-answer`) açmadan önce bir alt kümede koşulur; getirme kazancı cevaba yansımıyorsa açılmaz.
- Tahmini ölçüm ücreti (varsayım): gömme < $0,1 · D4 soru üretimi dev seti için ≈ $2 · anlama + sıralayıcı ≈ $10–15 · cevap düzeyi alt küme
  ≈ $10–20 → toplam ≈ $25–40; kurucu "kredi var" demeden ücretli kısım koşulmaz.

## 6. Kurucuya sorular (sade; önce / sonra örnekli)

**S1 — Cümleyle bul, paragrafı gönder (D3).** Uzun rehberde aradığımız şeyi tek tek cümlelere bakarak bulalım, ama modele cümlenin içinde
durduğu paragrafı gönderelim mi?
```
Misafir: "Akşam havuza kaça kadar girebiliriz?"
Rehberde "Havuz ve bahçe" paragrafı (850 karakter; mangal, şezlong, bahçe kapısı…); 6. cümle: "Cumartesi havuz 23:00'e kadar açıktır."
Önce:  paragraf tek parça olarak aranıyor; anlamı mangal / şezlong cümleleriyle karışık → bazen bulunmuyor → soru size kalıyor.
Sonra: o cümle bulunuyor, modele bütün paragraf gidiyor (genel kural "09:00–20:00" + cumartesi istisnası birlikte)
       → "Havuz 09:00–20:00 arası açık; cumartesi 23:00'e kadar." (yalnız cümle gitseydi genel kural kaybolurdu)
```
Önerim: evet (anahtarla kapalı, ölçümle açılır).

**S2 — "Bu bölüm hangi sorulara cevap verir?" listesi (D4).** Ev sahibi dosyayı yükleyince, her bölüm için yapay zekâ bir kez misafir
ağzından birkaç soru yazsın (Türkçe + İngilizce); bu sorular YALNIZ aramada kullanılır, misafire de cevaba da gitmez, bilgi tabanına yazılmaz.
```
Rehber: "Atıklar bina girişindeki yeşil konteynere bırakılır."
Misafir: "Poşetleri dışarıda nereye bırakıyoruz?"   /   "Wo kommt der Müll hin?"
Önce:  ortak kelime yok, Almanca soru Türkçe metinle zayıf eşleşiyor → bulunamayabilir.
Sonra: yazılmış "Çöp poşetlerini nereye atacağız?" / "Where do I put the trash?" sorularına çok yakın → bulunuyor.
```
Ücret: 20 sayfalık rehber başına tek seferlik ≈ 5 sent (ucuz model) – 23 sent (gpt-5.1), yalnız değişen bölüm için yeniden. Sorular
veritabanında saklanır (ev sahibinin metninden türeyen, misafir verisi yok). Alt soru: bu soruları ev sahibine de gösterelim mi ("Bu bölüm
şu sorulara cevap veriyor" — eksik soruyu kendisi ekleyebilir)? Önerim: önce yalnız arama için, gösterme ayrı karar (yeni ekran).

**S3 — Kalıcı gömme deposuna şimdi dört küçük alan (§4.2).** Onayladığınız depo tablosu şu an yazılıyor; "tür", "tarif sürümü", "sıra" ve
boyut kontrolünün düzeltilmesi şimdi eklenirse S1 / S2 aynı tabloda yaşar, ikinci bir migration gerekmez. Müşteriye etkisi yok; onaylanmış
tasarımı değiştirdiği için soruyorum. Önerim: evet.

**S4 — Uzun belge ölçüm seti.** Bugünkü bütün getirme ölçümleri kısa kayıtlarda yapıldı (en uzunu 818 karakter); dosya RAG'ı için ölçü yok.
Kör seti kim yazsın: (a) siz — rehber başına ~10–15 dakika, misafir gibi soru, (b) bizim kullandığımızdan farklı bir yapay zekâ, (c) ikisi?
Önerim (c): geliştirme setini başka bir model, kör seti siz. Ücretli kısım ≈ $25–40 (onayınızla).

**S5 — Taramaya iki yeni uyarı (getirme değil, içe aktarma / tarama işi).** (1) "Bu paragraf başka bir bölüme yönlendiriyor ('bkz.
yukarıda'): cevabı buraya da yazalım mı?" (2) "Bu iki paragraf aynı şeyi iki dilde söylüyor, değerleri farklı (12 / 14)." Önerim: tarama
listesine (10-23 §5) eklensin; değer karşılaştırması KODLA, model yalnız aday bulur.

## 7. Özet ve sıradaki adım

1. **Şimdi (D0, S3 ile aynı migration, müşteriye dokunmaz):** `KbChunkVector`'a K1–K8 (§4.2). Bugünkü yazma `kind=chunk`, `recipe=c1`,
   `ord=0`, girdi özeti = bugünkü `embeddingTextFor` özeti → davranış birebir. Testine bir kalem: 512 boyutlu, `kind=sentence` satır "bozuk"
   sayılıp SİLİNMEZ; bilinmeyen boyut sayılır.
2. **Sonra (D1):** uzun belge dev + kör seti, gerçek içe aktarma hattından; lab'a `EVAL_RAG_KB=docs` ve tür başına aşama sütunları; bugünkü
   canlı yapılandırmanın uzun belgedeki TABAN sayısı. Bu sayı gelmeden D2–D4'ün kazancı tahmindir.
3. **Ölçüme göre (D2 → D3 → D4):** önek v2 + ortalanmış kırpma → cümle birimleri (512, yalnız ≥3 cümleli parçalar, tür başına eşik, tür
   başına "yarım harita yok") → kayıt anında çok dilli soru üretimi (`KbDerivedText`, ayrı migration + onay). D5 (model yazımı bağlam) yalnız
   ölçülmüş kayıp kalırsa.
4. Kurucu soruları §6 S1–S5; S3 (şema) en acil, çünkü tablo şu an yazılıyor.

Kaynaklar (bu turda erişilen): Anthropic, "Introducing Contextual Retrieval" (anthropic.com/news/contextual-retrieval — sayılar sayfadan);
text-embedding-3 kısaltma sayıları ikincil kaynaklardan (Pinecone "OpenAI's Text Embeddings v3", OpenAI topluluk forumu; openai.com bu
oturumun ağ izninde değildi). LlamaIndex sentence-window, LangChain parent-document, OpenAI dosya arama varsayılanları, Cohere getir-sırala
düzeni: bilgi birikimimden, bu turda açılmadı (işaretli). Kurum içi: `docs/RAG-EMBEDDING-SON-DURUM-2026-09-28.md`,
`docs/TASARIM-2026-09-26-rag-300-olcek.md`, `docs/olcum/RAG-AYRISTIRMA-2026-10-10.md`, `docs/ONAY-E2-embedding-vektor-tablosu-2026-09-12.md`.

## 8. Codex değerlendirmesi (10-28 akşam) — madde madde, kodla kontrol edildi

Kurucu: "onun dediklerine hemen ikna olmak zorunda değilsin, mantıklıysa katılıyorsan yap, burada testler yap". Her madde kodda / ölçümde
doğrulandı; katıldıklarım tasarıma girdi, katılmadığım yer gerekçeli.

| # | Codex | Hüküm | Gerekçe (kod / ölçüm) | Tasarıma etkisi |
|---|---|---|---|---|
| C1 | "Cümleyi bulmak yetmez: kural + istisna + koşul + tablo başlığı + açık gönderme birlikte gelmeli; eşleşme birimi / kaynak birimi / cevap için gerekli bağlam ayrı düşünülmeli" | **Katılıyorum** | Sabit pencere ya da "parçanın kendisi" uzaktaki istisnayı garanti etmez. Ölçü yoktu → `tests/eval/rag-long.eval.test.ts` tam olarak bunu ölçer: gereken bütün alıntılar modele giden blokta mı ("bağlam tam"), içe aktarmada aynı kaleme / parçaya düşüyor mu. | Sıra değişti: ÖNCE kaynak yapısı + bağlam bağları (içe aktarmada başlık yolu, istisna / koşul cümlesinin ait olduğu konuya bağlanması, tablo başlığının satıra bağlanması), SONRA cümle araması. |
| C2 | "Mutlak alaka eşiği reddedildi" ile "tür başına eşik" çelişiyor mu; yeni sinyal başka kaynağın bulduğunu elememeli; uzun kalem sırf çok cümlesi var diye öne geçmemeli | **Katılıyorum (ilk yarısı bugün zaten doğru)** | Bugünkü anlamsal eşik (`retrieval/semantic.ts thresholdTransform`) ELEMEZ: eşik altı kosinüs küçültülmüş puan olur (`m·s/t`), seçici sözcüksel adaylarla RRF ile birleştirir (`select.ts`); sözcükselin bulduğu kalem anlamsal puan yüzünden düşmez. Uzunluk yanlılığı gerçek risk: 20 cümleli parça 2 cümleliden daha çok "en iyi cümle" şansı alır. | Kural: yeni sinyaller (cümle / soru) yalnız aday EKLER ve sıralamayı destekler; kesin eleme ayrıca kanıtlanmadan yok. Birleşim tek formülle sabitlenmeyecek: max, max + uzunluk düzeltmesi, RRF üçü kör sette kıyaslanacak (havuz / havuz barı / havuz havlusu, cevapsız ve uzun-kısa karışık vakalar dahil). |
| C3 | "Üretilmiş sorular arama yardımcısıdır, cevap kanıtı ya da yeni bilgi DEĞİLDİR" | **Katılıyorum — boş konuşmuyor** | Örnek: kaynak "Wi-Fi şifresi etikette" diyor; model "İnternet hızlı mı?" sorusunu da üretirse, hız sorusu Wi-Fi parçasını getirir — ama parça hız hakkında bir şey SÖYLEMİYOR. Getirme isabeti "bilgi var" demek değildir. Bugün cevap kodla parça METNİNE karşı doğrulanıyor (`answer-binding.ts`: değer ↔ konu ↔ koşul); üretilmiş soru ne cevap modeline ne doğrulayıcıya girerse bu güvence korunur. | Sözleşme: üretilmiş soru yalnız arama anahtarı; isteme / doğrulayıcıya / bilgi tabanına GİRMEZ; kaynağı, üretim tarifi ve sürümü kayıtlı; kaynakta olmayan ücret / izin / koşul varsayan sorular ayrıca sınanır (pin + ölçüm). |
| C4 | "Boyutu tür değil model + `dimensions` ayarı belirler; textHash / inputHash belirsizliği; `ord` neyin sırası; düzenleme sonrası eski vektörü ne engelliyor" | **Kısmen katılıyorum** | Doğru: boyut modelin ve kısaltma ayarının sonucudur; bugünkü doğrulama (tür, tarif) üzerinden — tarif bugün "c1 = small, 1.536" anlamına geldiği için sonuç aynı ama ifade yanlış yere bağlı. Farklı modellerin satırları zaten karşılaştırılmıyor (okuma `model =` süzgeçli). Şemada YALNIZ `inputHash` var (`textHash` yok): belirlenimci tarifte "gömülen metnin SHA-256'sı". `ord` = aynı (kalem, tarif, tür, girdi) altındaki sıra (ileride bir parçadan üretilen N soru). Eski vektörü engelleyen iki şey (10-28 Haiku düzeltmesi, kodda): okuma bugünkü metnin özetiyle yapılır + satır üretildiği kalem sürümünü (`itemUpdatedAt`) taşır, sürüm tutmayan satır yazılmaz / temizlenir. | İzinli boyut (model, tarif) çiftine bağlanacak; tarif adı kısaltma ayarını içerecek (ör. `s1-512`). Üretilmiş soru dilimi (D4) iki özet taşıyacak: kaynak parçanın girdi özeti + üretilen metnin özeti (ayrı tablo `KbDerivedText`). |
| C5 | "Yarım harita yok sürüm bazında; eski tamamlanmış indeks de kaynak değiştiyse güvenilir değil; işletme / daire / onay / sır süzgeçleri her yeni arama türünde korunmalı" | **Katılıyorum, bugün korunuyor** | Karar başına bütün parça vektörleri bugünkü metnin özetiyle eşleşmeli; biri eksikse karar "cold" (sözcüksel, güncel kaynak). Getirme yalnız `fetchKnowledgeBaseForPrompt` çıktısında (onay kapısı) ve QR süzgeçlerinden SONRA koşar. | Yeni her tür (cümle / soru) aynı kalem kümesinden türetilir — pin testi zorunlu (cümle / soru satırı onaysız kalemden asla gelmez). |
| C6 | "Önceki sonuçlar dosya RAG'ı hakkında hiçbir şey söylemiyor" ifadesi fazla kesin | **Katılıyorum** | Doğru ifade: kısa kalemlerdeki başarıyı gösteriyor; uzun belge, parça sınırı ve bağlam kaybındaki başarıyı henüz göstermiyor. | §0 madde 4 bu anlamda okunmalı. |
| C7 | "İki gerekli kaynak bütçeye sığmıyorsa birini gönderip kesin cevap üretmek yanlış; bağlamın tamamlanamadığı anlaşılmalı, aynı mesajdaki bağımsız güvenli sorular etkilenmemeli" | **Katılıyorum** | Parça kipinde doğrulanamayan parça zaten tutulur (ihtiyaç başına); eksik olan "bağlam tam mı" sinyali. | Ölçer "bağlam tam" oranını kategori kategori verir; tamamlanamayan ihtiyaç için tutma kuralı ölçüm sonrası tasarlanacak. |
| C8 | "Arama başlığı görürken cevap modeli yalnız 'Şifresi etikette' görürse belirsizlik taşınır" | **Kısmen yanlış** | Cevap modeline giden her satır `[KATEGORİ] Başlık: metin` biçiminde (`retrieval/kb-line.ts kbLine`) — kalem başlığı gidiyor. Gerçek açık: uzun belgede ÜST bölüm adı (ör. "Havuz ve bahçe" altındaki "Saatler") kalem başlığına girmiyorsa kaybolur. | İçe aktarmada başlık yolu (üst başlık › alt başlık) kalem başlığına / önekine taşınacak; ölçülecek. |
| C9 | Sıralayıcı penceresi geometrik ortalanırsa koşulu kesebilir; tablo satırı sütun başlığından kopmamalı | **Katılıyorum** | Opus R26 (tablo başlık satırı satırlardan kopuyor) aynı sınıf. | Pencere "bağlı cümleyi kapsayan" biçimde tasarlanacak; tablo başlığı satıra bağlanacak (içe aktarma). |
| C10 | Depo hesabı: 85 parça + 550 cümle + 510 soru ≈ 2,7 MB / daire, 10.000 dairede ≈ 27 GB | **Doğru hesap** | 85×1.536×4 + 1.060×512×4 ≈ 2,7 MB. | Maliyet tablosuna işletme maliyeti (depo + okuma süresi) eklenecek; cümle / soru yalnız ölçülen kazançla açılır. |
| C11 | Önerilen sıra: kaynak yapısı ve bağlam bağları → belirlenimci önek + kalıcı sürümlü indeks → cümle araması → üretilmiş sorular, her biri ayrı ölçülerek | **Katılıyorum** | Hepsi birden açılırsa hangisinin fayda / zarar verdiği bilinmez. Kalıcı sürümlü indeks bugün kodda (migration 87 + sürüm alanı). | §4.3 dilim sırası buna göre güncellendi: D1 ölçüm → D1b bağlam bağları → D2 önek → D3 cümle → D4 soru. |

## 9. Ölçüm sonuçları (10-28 akşam) — uzun belge seti, gerçek model, tekrarlı

Ölçer `tests/eval/rag-long.eval.test.ts` (ürünün içe aktarması + aynı getirme hattı). Geliştirme seti `evals/rag-long/dev.json` (6 belge,
8,5–13,7 bin karakter, 125 soru; ayrı yazar, görülebilir) · kör set `evals/rag-long/blind.json` (5 belge, 105 soru; ayrı yazar, yalnız
özet — ayar için okunmadı). "Bağlam tam" = sorunun cevabı için gereken BÜTÜN alıntılar modele giden blokta. Arka plan: 250 başka kalem
(ürünün seçim yaptığı boyut; tek belgede bilgi tabanının tamamı gider, seçim yok).

### 9.1 Ölçer hatası (dürüstlük notu)

İlk ücretli koşular anlama katmanı KAPALI çalıştı: ölçer `AI_UNDERSTANDING_ENABLED` vermiyordu, katman sessizce "kapalı" dönüyordu
(üretimde açık). Düzeltildi; artık her soruda katmanın koşup koşmadığı sayılır, sonuç vermeyen oran %10'u aşarsa koşu düşer. Anlamasız
koşular `*-anlamasiz-*` adıyla tarihçe olarak kaldı (kör 90/95 · geliştirme 102/113 — anlama katmanının katkısı ayrıca görülsün).

### 9.2 Bugünkü üretim yapılandırması (anlama 5.1 + yeniden sıralayıcı 5.1 + small gömme)

| set | sözcükle (lex) | üretim (`live`) | not |
|---|---|---|---|
| geliştirme, tek belge (seçim yok) | 113/113 | — | bilgi tabanının tamamı gider |
| geliştirme, 250 arka plan | 83/113 | **106 · 103 · 100** (3 tekrar, ort. 103) | koşudan koşuya ±3 |
| kör, 250 arka plan | 66/95 | **90/95** | en az bir alıntı 94/95 |

Kaçanların sınıfı (geliştirme, 3 tekrarın birleşimi): tablo başlığı satırdan kopuk (5 soru) · uzak istisna / genel kural başka bölümde
(5) · açık gönderme "bkz. Bölüm 9" (1) · çok sorulu mesajda bir soru (1) · başka dil (1).

### 9.3 Tablo başlığı bağlamı (`KB_TABLE_HEADER`, kodda, KAPALI) — Codex C9

Kök neden (kodla doğrulandı): 900 karakteri aşan tablo **içe aktarmada** bölünüyor ve parçalar ayrı konu kalemlerine düşüyor; başlık
satırı ("| Hizmet | Düşük sezon | Orta sezon | Yüksek sezon |") bir kalemde, "| Geç çıkış | Ücretsiz | 500 TL | Yapılmıyor |" başka
kalemde kalıyor. Parçalayıcı da aynı kalem içindeki uzun tabloyu bölüyordu. Düzeltme iki yerde aynı kural: tablonun ortasından başlayan
parça / içe aktarma devam parçası aynı tablonun başlık satırını taşır. Kategori / erişim kararı yalnız parçanın kendi metnine bakar
(Haiku 10-28 gizlilik bulgusu: başlık "Wi-Fi | 4590" satırını aday misafire açık otopark kalemine taşıyordu — düzeltildi, pinli).

| | kapalı (3 tekrar) | açık (2 tekrar) |
|---|---|---|
| bağlam tam (geliştirme) | 106 · 103 · 100 (ort. 103) | **110 · 107 (ort. 108,5)** |
| tablo soruları | 13 · 12 · 12 / 15 | **15 · 15 / 15** |
| çok alıntılı soruda hepsi aynı parçada | 32/92 | **44/92** |
| cevapsız soruda seçilen parça / blok boyu | 11,7 / ~4.080 kr | 11,7 / ~4.080 kr (maliyet değişmedi) |
| kör set | 90/95 | 90/95 (gerileme yok; kör setin tabloları kısa) |

Mutasyon 12/12 (yaşayan iki mutant pinlendi). Açmak = kurucu kararı (müşteriye giden cevabı DOLAYLI değiştirir: modele giden parça başlık
satırını da taşır). Önce / sonra örneği: misafir "Ağustos'ta 14:00'e kadar kalabilir miyiz?" → bugün modele "| Geç çıkış | Ücretsiz |
500 TL | Yapılmıyor |" satırı başlıksız gidebiliyor (hangi sütun Ağustos belli değil, model "500 TL" diyebilir); açıkken satırın üstünde
"| Hizmet | Düşük sezon | Orta sezon | Yüksek sezon |" var → "yüksek sezonda geç çıkış yapılmıyor".

### 9.4 Ölçülen ama kodlanmayan: "Giriş Talimatı"na süpürülen bilgi (kurucuya soru)

İçe aktarma kapı / anahtar / kilit sözcüğü geçen PARAGRAFI bütünüyle "Giriş Talimatı" kalemine taşıyor (erişim kararı paragraf düzeyinde,
Opus 10-23 D1 — kod taşıyan devam cümlesi sızmasın diye). O kategori QR sohbetinde ve rezervasyon öncesinde misafire GİTMEZ. Ölçüm:
geliştirmede 13 alıntı / 10 soru, kör sette 47 alıntı / 35 soru yalnız o kalemde. Geliştirme örnekleri (meşru erişim soruları hariç):
"Elektrik gitti! Sigorta kutusu nerede?" (cümle "giriş kapısının arkasında" dediği için), yol tarifi, otopark, çöp, çıkış saati.
Seçenekler: (a) bugünkü gibi (güvenli, bilgi kaybı) · (b) cümle düzeyi ayırma: yalnız kapı / anahtar / kod cümlesi Giriş Talimatı'na, kalan
cümleler konusuna — risk: "Anahtar kutusu kapının solunda. Şifresi 4821." gibi kodu ikinci cümlede taşıyan metin; taslak kapısı cümle
bazında kodu yakalamazsa aday misafire sızar → ancak sızıntı testleriyle · (c) içe aktarma ekranında ev sahibine "bu paragraf Giriş
Talimatı'na taşındı, ayırmak ister misiniz?" düğmesi. Önerim (c) + (b)'nin yalnız kod taşımayan, erişim sözcüğü yan anlamda geçen cümleler
için ölçülmüş hâli — karar kurucunun.

### 9.5 Luna ile 5.1: anlama + yeniden sıralayıcı (kurucu: "eşitse Luna")

`rag-lab` perq geliştirme seti, iki sorulu 120 mesaj (cevapların İKİSİ de blokta), İngilizce köprü sorgusu açık, Luna sıralayıcı süre
tavanı 2,5 → 5 sn (10-10'daki kaybın sebebi gecikmeydi), iki tekrar (taze model önbelleği):

| anlama | sıralayıcı | koşu 1 | koşu 2 | ort. | sıralayıcı p95 |
|---|---|---|---|---|---|
| 5.1 | 5.1 | 118 | 114 | **116** | 1,6–1,7 sn |
| 5.1 | Luna `none` (5 sn) | 115 | 111 | 113 | 1,9–3,5 sn |
| Luna `low` | 5.1 | 108 | 114 | 111 | 1,6–1,7 sn |
| Luna `low` | Luna `none` (5 sn) | 113 | 112 | 112,5 | 2,3–2,9 sn |

Eşitlik YOK: tavan yükseltilince Luna'nın zaman aşımı kaybı kalktı ama sıralama kalitesi iki koşuda da 3 mesaj geride (kayıp "bütçe" sütununda:
Luna'nın sıraladığı aday cevabı bütçenin dışına itiyor); Luna anlama ortalama 5 geride (eşik altı kaçak 1 → 4–9). Bu iki katmanın mesaj
başı maliyeti küçük (anlama ~1–2 bin, sıralayıcı ~3 bin giriş belirteci). Öneri: anlama + sıralayıcı 5.1'de kalır; cevap modeli Luna
(10-10 kararı) değişmez. Raporlar: `docs/olcum/rag-lab-2026-10-28{,-2,-3,-4}.md`.

### 9.6 İnce ayar (fine-tuning) yolu kapalı (OpenAI API'si, 10-28)

`POST /v1/fine_tuning/jobs` (gpt-6-luna, gpt-5.1 ve gpt-4.1 için ayrı ayrı denendi, iş açılmadı) → `training_not_available`: "OpenAI is
winding down the fine-tuning platform and your organization is no longer able to create new fine-tuning training jobs." Yani "modelin nasıl
düşünmesi gerektiğini ince ayarla öğretmek" bu sağlayıcıda mümkün değil. Aynı amaca giden yol: (1) doğrulanmış örnek bankası — kurucunun
onayladığı soru → doğru davranış çiftleri, benzer olanı isteme ÖRNEK olarak girer (kör set asla girmez), (2) kod kuralı yalnız durdurur,
gönderimi model + okuyucu onaylar (7-D), (3) her değişiklik kör setle ölçülür.

### 9.7 Sıradaki (ölçülen kayba göre)

1. Kurucu kararları: `KB_TABLE_HEADER` aç / açma · 9.4 Giriş Talimatı seçeneği.
2. Uzak istisna / genel kural (5 soru): aynı belgedeki "genel kural ↔ istisna" bağını içe aktarmada kurmak (C1; başlık yolu + istisna
   cümlesinin konusuna bağlanması) — ölçerle.
3. Koşudan koşuya ±3 oynama: yeniden sıralayıcı çıktısı tekrarlanabilir değil; aynı soruya iki kez aynı bloğu vermek için sıralayıcıya
   sabit tohum / düşük sıcaklık seçeneği ya da iki çağrının birleşimi ölçülecek.
4. Cevap düzeyi (son gönderim doğru mu) uzun belgede `rag-answer` ile.
