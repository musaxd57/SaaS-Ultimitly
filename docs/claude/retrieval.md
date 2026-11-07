# Retrieval (RAG) kuralları

> CLAUDE.md'den 2026-10-08'de AYNEN taşındı (kurucu: ".md'ye yığma, gerekli yerlere taşı, gerekli şeyleri silme").
> Bu dosyadaki kurallar CLAUDE.md'deki kadar BAĞLAYICIDIR. İlgili alanda iş yapmadan önce oku.

## Retrieval (RAG — VARSAYILAN AÇIK 09-11; tasarım `docs/RAG-GRAPHRAG-TASARIM-2026-09-09.md`; ölçüm raporları `docs/olcum/`)
- 🚨 `KB_RETRIEVAL_MODE` bir ACİL DURDURMA düğmesidir: `legacy/off/0/false/no/disabled` eski davranış, başka HER
  değer (boş dâhil) hibrit. Gevşek yazım bilinçli; "tanınmayan → legacy" ölçülüp REDDEDİLDİ. Görünürlük:
  `kbRetrievalModeInfo().recognized` + boot `[kb-retrieval] mode=…` + `.env.example`.
- **TEK BOĞAZ `selectKbForPrompt`** — yetki/mülk/onay (`kb-fetch`) ve sır elemesi ÖNCE, `suggestReply` SONRA; dört
  AI yüzeyi geçer (pin). Hibrit legacy'den AZ bilgi taşımaz: küçük KB (🚨 ≤30 kalem VE ≤24k = legacy'nin KENDİ
  kümesi → seçim YOK; 09-27 #209: ölçü biçimli blok + satır ayracı, TEK kural `retrieval/kb-line.ts` `kbFitsWhole` — seçici ve
  paketleyici aynı; sınırı ≤60 karakter aşan ≤30 kalem de TAMAMEN gider, kurucu kararı, genel bütçe büyümez; 09-23'e kadar ≤12 kalem/≤6k idi ve tipik host KB'sinde parafraz soruların cevabını
  düşürüyordu — `docs/olcum/kb-retrieval-parafraz-2026-09-23.md`; seçim MEKANİĞİ testleri üretim varsayılanıyla,
  30 kalemi aşan nötr dolgulu fikstürde koşar — `tests/helpers/kb-padding.ts`, eşiği eğen sarmalayıcı YOK) ·
  cevapsız önceki misafir soruları (son cevaptan sonra, ≤3) alt sorgu olarak eklenir (kanıtta `pq`) · selamlaşma · sözcüksel
  isabet yok · hata → TAM küme (geri çekilme `cappedForFallback` ile legacy tavanı 30; kırpma `kbDropped`e sayılır).
  `kb-fetch` hibritte en yeni 200 kalem. İstem notu "SORUYA GÖRE SEÇİLDİ … 'bilgi yok' DEME — insana devret".
- `src/lib/ai/retrieval/` LLM'siz + deterministik + DB'siz (pin): parçalayıcı (cümle sınırı, 600/900; parça =
  `content.slice`, metin DEĞİŞMEZ) · Türkçe-öncelikli BM25 (sabit nokta kök sökücü, ünsüz yumuşaması, ~45 DAR
  kavram sözlüğü; `detectOnly` genişletmeyi KAPATMAZ) · OSA yazım toleransı · karakter 3-gram (`ngram:"auto"` =
  yalnız Türkçe sorgu; anlamsal DEĞİL) · birleşim CombSUM (anlamsal kaynak varken RRF) · rerank (ipucu 0.35 /
  yalnız-ipucu 0.2 · başlık 0.15 + tam örtüşme 0.15 · bigram 0.10; tazelik PUANA GİRMEZ, 0.01 adımında eşitse yeni
  önde) · sürüm kuralı `supersededById` · çok soruda round-robin · ince soruda son 2 MİSAFİR mesajı · bütçe 6k/12
  parça · 🚨 çelişki koruması ALAN BAZLI ve **kural tek kaynak `time-fields.ts`** (↓Kalıcı ürün kararları); bütçe
  çelişkiyi YUTAMAZ (`notes` + `confDropped`).
- **Yabancı dil sözlüğü** (`lexicon-foreign.ts`, DE/FR/ES/RU/AR): sorgu tarafında, HAM belirteç (Türkçe kök
  sökücüden GEÇMEZ); Latin tam kelime + kapalı ek kümesi (`*` önek, `=` tam kelime), Kiril önek, Arapça tek bitişik
  ek. Türkçe/İngilizce seçim birebir aynı (`sources.foreign:false` kıyası pinli; yeni girdi eklerken bu kimlik pini —
  `kb-retrieval-foreign.test.ts` — ve çarpışma tuzakları koşulur). Geri EKLENMEYECEK girdiler: RU
  машина/пробки · FR four/chat/café/partir/tekil drap · DE laut · ES parada.
- 🚨 **ANLAMSAL (embedding) KAYNAK: ÜRETİM YOLU VAR, ANAHTAR `KB_SEMANTIC_RETRIEVAL` VARSAYILAN KAPALI (09-23) — CANLIDA AÇIK (kurucu 09-26).**
  Yüzeyler tek girişten `retrieveKbForPrompt` (`ai/kb-retrieve.ts`) → `selectKbForPrompt`; puanı YALNIZ o verir
  (pin). Kapalıyken ağ çağrısı yok, sonuç birebir (davranışsal pin); açılmadan raporlarda "anlamsal retrieval"
  denmez. Açma = E4 + eşik ölçümü + kurucu onayı (`docs/EVAL-CALISTIRMA.md`). Kurallar: alt sorgu BAŞINA puan
  (`retrievalQueries` tek kaynak), her alt sorgu ait olduğu HAM cümle + virgülle bölündüyse kendisiyle sorulur
  (en yüksek kosinüs); sıcak yol 1,5 sn; soğuk KB bekletmez (arka plan ısıtma, saatlik tavan); YARIM HARİTA YOK;
  rerank'te anlamsal uyum bonusu (= kavram ipucu büyüklüğü; kâhin iki soruda %87→≥%90); kalıcı sağlayıcı arızası
  AYRI anahtarlı geçiş alarmı (`model-provider:embedding`); YAPILANDIRMA arızası da (1536 dışı boyut, `dimensions` / desteklenmeyen
  parametre 400'ü) aynı alarma `request` sınıfıyla gider (A7 #3; tek girdilik 400 gitmez), JSON olmayan gövde yeniden DENENMEZ. 🚨 **Mutlak alaka eşiği ("≥%80, en iyi 3–5") ÖLÇÜLÜP
  REDDEDİLDİ** — puan sorgu içinde göreli, negatif sorgu da 1,0–1,35 alır; her kesme cevap kaybettirir.
  Yerel çapraz-kodlayıcı ŞİMDİLİK HAYIR (gecikme/olay döngüsü/lisans; `docs/olcum/kb-retrieval-parafraz-…` 3. tur).
- **Ölçek harness'ı** `tests/unit/kb-retrieval-scale.test.ts` (38 konu, 30/100/300): ölçü inPrompt(METİN) = cevap
  CÜMLESİ blokta mı (kalem kimliği değil). Eşikler kaçırılan SORU sayısıyla pinli (hit@1 ≥.95, hit@3 ≥.96, inPrompt
  ≥.99, geri çekilme 0). Legacy inPrompt 100 kalemde %51, hibrit %99–100. Cevap kalitesi burada ÖLÇÜLMEZ
  (eşleştirilmiş gerçek-model eval `evals/kb-retrieval-paired.json`, kurucu/kredi ile koşulur).
- **Kök sökücü kuralları (ölçülmüş; tekrar denemeyin):** sabit nokta + TAMLAYAN eki (‑nin/‑nun) YALNIZ ilk turda
  ("havalimanından" ≠ havlu); `WEAK_QUERY_TERMS` kök uzayında yaşar (mekanik pin: her girdi kendi kökü, durak
  değil); zayıf kök ağırlığı 0.25, taşınan `min`. Reddedilen: `ndan/nda/ni` eki · `alim/elim` taban 4 · optatif
  ilk-tur kısıtı. Sözlükten ÇIKARILDI, geri gelmesin: "varış→var", "şu→su", "ki" eki, torba "olanaklar". Bilinen kök
  sınırları: markete→mark, kilidi→ki, duşu→du, görevliniz→gorevl. `hasEvidence` yüklemi (güçlü kök / n-gram ≥0.3 /
  anlamsal ≥0.3) — `base > 0` yetmez. 🚨 Ünlü-sonu iyelik "-m" sökümü REDDEDİLDİ (09-27: 164 belirteç / 122 yeni çakışma — akşam=aksi,
  modem=moda, konaklama=konak, toplam=top) ve sözlük dışı geri çekilme de (tetiklenmelerin çoğu gürültü); "şifremi / arabamı /
  kumandam" yalnız KAVRAM tespitinde tanınır ("-m"siz kök ≥5 harf ve bir kavram teriminin köküyse; `possessiveBareStems`; dil kapısı
  YOK — Türkçe olmayan 5.003 metinde etkisiz, kısa Türkçe "Kahvem bitti" İngilizce tespit ediliyordu).
  Sözlükte tek kelimelik terimin kökü DURAK sözcük olamaz (`lexiconProblems` pinli; "noise/waste/hastane" taban kök, "ısınmıyor"
  korumalı kök — dördü de yıllardır ölüydü). Getirmede "acil" kökü kavramı yalnız yüzey biçimi güvenlik sınıflandırıcısının tam
  sözcük listesindeyse tanır (`EMERGENCY_ACIL_FORMS`, parite pinli; "açılıyor" ≠ acil); belirteç vermeyen çağıran (saat alanı) değişmez.
- **Belirsiz tek kelime yalnız GENİŞLETME (`expandOnly`, kurucu onayı 09-26):** "sıcak / outage / kesinti / depo / eşya /
  alarm / merdiven" kavramı TEK BAŞINA tetiklemez (yanlış kavramın kalemi doğru kalemin önüne geçiyordu), kalıpla
  tespitte ("sıcak su", "su kesintisi", "duman alarmı") genişletmeye girer — geri `terms`e ALINMAZ. Saat alanı kuralının
  "başka konu" sezgisi bu sözcükleri `matchConcepts(…, {loose})` ile YİNE görür (davranış aynı, pinli). Kalan gürültü
  (sözcük kalemin METNİNDE geçiyorsa BM25 eşleşir: "Daire çok sıcak" → sıcak su kalemi) sözlükle çözülmez → anlamsal arama.
- **Sözlük kayıtları TİPLİ (kurucu onayı 09-26, "B + C + tipli eşleştirici"):** terim · `detectOnly` · `expandOnly` ·
  **`phrases` (birebir kalıp: durak sözcükler KORUNUR, içerik kök alınır — `phraseUnits`)**. Çok kelimeli `detectOnly`
  EN AZ iki içerik köküne inmek zorunda; tek kelimeye inen kayıt `lexiconProblems` testinde düşer ("çok sıcak" → sıcak,
  "no water" → water, "how to get there" → get gibi). Kalıp eşleşmesi metnin birimlerini ister: arama / saat alanı /
  çelişki kapısı `units` geçirir — yeni bir çağıran da geçirmek ZORUNDA. "checkin" kökü korunur (`PROTECTED_STEMS`;
  "check" artık girişi tetiklemez). Bilinen, BİLEREK bırakılan kök çakışmaları: "parking"→park, "giriş"→gir.
- 🚨 **OPENAI YENİDEN SIRALAYICI (#186, 09-26; kurucu "OpenAI ile", "Önce ücretli ölçüm, sonra siz", "yapalım, en mantıklı
  şekilde") — BAĞLANDI, anahtar `KB_RERANK_ENABLED` VARSAYILAN KAPALI — CANLIDA AÇIK, kurucu 09-26 (tek okuyucu `flag.ts`, açılış logu `[kb-rerank]`):**
  `semantic/rerank.ts` (anlam katmanının ağ kapısı; `retrieval/` modelsiz kalır) adaylardan "cevaplayan / ilgili" kimlikleri
  listeletir; seçiciye `rerankScores` YALNIZ SIRA sinyali (3→2→1→puansız→0, kararlı; aday eklemez/çıkarmaz, bütçe/çelişki/
  sürüm aynen). TEK giriş `retrieveKbForPrompt` → `prepareRerankScores`; YALNIZ `sem: ok` + `fb: none` iken (tavan teşhisi:
  embedding KAPALIYKEN cevap aday listesinde yok → çağrı YOK). İlk 20 aday alt sorgular arası sırayla (`unionTopCandidates`,
  ölçümle aynı); isteme cevapsız önceki mesajlar + güncel mesaj (güncel hep kalır), ad redakte — her mesaj ÖNCE redakte, SONRA
  kırpılır (#211: kesime denk gelen numara yarısı açık gidiyordu). Sıcak yol tavanı 2,5 sn;
  her arıza BUGÜNKÜ sonuç. Kanıt `rr/rrMs/rrA`. Ölçüm (gpt-5.1, 288 çağrı, 0 hata, 0 kayıp): parafraz %67→%78 (100 kalem),
  %50→%57 (300); iki soru %62→%74, %31→%41; p50 0,86 sn. Aday başına puan şeması REDDEDİLDİ (p50 1,7 sn).
  (`docs/TASARIM-2026-09-26-openai-yeniden-siralayici.md` §5.)
- 🚨 **#189 300 KALEM ÖLÇEĞİ (09-26 gece, `docs/TASARIM-2026-09-26-rag-300-olcek.md`; ölçer `tests/eval/rag-lab/` aşama bazlı
  kayıp, taban `base0926` sabit, holdout `evals/rag-scale/holdout.json` İÇERİĞİ OKUNMAZ — yalnız son kabul, toplu sayı):**
  yer tutucu ikamesi seçimden SONRA (seçim HAM metinle; sır kararı doldurulmuş metinle — misafir adı anlamsal önbelleği
  soğutuyordu) · vektör ısıtması YAZMA anında + açılışta (`embeddings/kb-warm.ts`; anahtar kapalı/legacy = no-op) · okuma
  tavanı 400 (plan tavanı mülk başına 60 aktif kalem → canlıda etkisiz) · gömme modeli env `OPENAI_EMBEDDING_MODEL`
  (varsayılan small; `text-embedding-3-*` → `dimensions` 1536; eşik MODELE göre `semanticThresholdFor`: large 0,25, diğer
  0,4; okuyucu YAPRAK `embeddings/model.ts`) · soru başına yeniden sıralama `KB_RERANK_PER_QUESTION` VARSAYILAN KAPALI
  (anlama isteği başına 40 + 10'luk taban, ≤3 PARALEL çağrı, birleşim en yüksek; kanıt `rrN`; kapalıyken ilk 20 tek çağrı
  BİREBİR, pinli) · anlama sorgusu alt sorguyla birebir aynıysa liste o isteğe işaretlenir. Dev ölçüm (tek çağrı): tek soru TR
  %69→%95, diğer diller %73→%99, iki soru %33→%50; ayrı çağrı (önbellekten eşleştirilmiş alt küme, ön tahmin) iki soru %86.
  Ölçülüp etkisiz çıkan (geri önerme): atla-paketle, kalem başına 5 parça, anlama payı 1/2, RRF taban, taban 20. Pencere
  kuruluşu seçenekleri (`RerankWindowOptions`, varsayılan birebir) — istek başına 50 modelsiz tavanda iki soruda pencere dışı
  6→2. Ölçer "yalnız önbellek" kipi `RAG_LAB_OFFLINE=1` (+ `_SKIP=1` eşleştirilmiş alt küme). 🚨 Ölçer sadakati (A9, 09-27): canlıyı
  ölçen taban `live` (ürün bayraklarından çözülür: bugün ilk 20 aday TEK çağrı; `prod` = soru başına pencere, canlı DEĞİL), rapor her
  yapılandırmanın çözülmüş parametrelerini ve blok / bilgi tabanı oranını yazar (%90'a yaklaşırsa "blokta" getirme başarısı değil),
  çelişki notu yalnız sorunun KENDİ iki saatini taşıyorsa kredi, üretim biçimli geçmiş `phist` (kabul koşusu `live+phist`). 🚨 GERÇEK BOYUT (09-27, soru başına
  60 kalem `EVAL_RAG_KB=perq`): en büyük kayıp BLOK BÜTÇESİ (6k/12) — 24k/40 ile iki soru %71→%98 (yeni gömme, sıralayıcısız); ≤30 kalem
  bugün zaten 24k'ya kadar tamamen gidiyor (uçurum). Kurucu 09-27 "hazırla, sonra aç" → `KB_RETRIEVAL_WIDE_BUDGET` VARSAYILAN
  KAPALI (tek karar noktası `kb-retrieve.ts`; 23k/80 — parça tavanı kurucu 09-27 "80'e çık": 40'ta blok karakterin yarısında dolup cevap kaçırıyordu; 24k DEĞİL: paketleyici satır başına +1 sayar, tam dolu 24k son parçayı
  düşürürdü, pinli; çağıranın bütçesi önceliklidir; kanıt `wb`). 🚨 OpenAI kredisi 09-26 gece BİTTİ: ayrı çağrı temiz ölçümü +
  holdout kabulü + cevap düzeyi ölçüm (± geniş blok) bekliyor; üç bayrağı açmak kurucu kararı. `strategy.answersFirst` ölçüm
  seçeneği (varsayılan KAPALI; 6k/12'de kayıp → varsayılan değil). Saat alanı yanlış alarmı KAPANDI (09-27, kurucu onayı; ↓Kalıcı
  ürün kararları "Saat alanı kuralı"): 60 kalemde yanlış mülk-saati çelişkisi %30 → %0 (geniş blokla %58 → %0; kalan %3,9 / %12,9
  dev setine bilerek konmuş GERÇEK çelişki). 🚨 **KABUL (kurucu kararı 09-27, Codex'le): %95 ZORUNLU GEÇME KURALI DEĞİL** — oran
  raporda gelişim çizgisi; kabul testi VAKA başına müşteriye giden sonuca bakar (doğru kanıta dayalı cevap · bilinmeyende dürüst
  bilmeme/devir · çelişkide kesin konuşmama · sıfır sır sızıntısı; biri bozulursa o vaka kırmızı; cevap düzeyi `rag-answer`); canlı
  gönderim kapısı AYRICA gerekir. Getirme düzeyinde (`rag-lab/acceptance.ts` `holdoutVerdict`) kırmızı = sızıntılı vaka + ölçülmemiş
  sızıntı + eksik koşu (2,5 sn tavan aşımı eksik DEĞİL). Ölçer önbellek anahtarı modele GİDEN isteği tanımlar (`replyRequestIdentity`
  + `cache-keys.ts`; cevap isteminin anı `REPLY_NOW` sabit — istem dakikayı taşır). İki sorulu cevapta her sorunun sayısı AYRI
  (`answerAnchorHits`). Kalem parça tavanı SORU BAŞINA — VARSAYILAN (kurucu 09-27 "1.yi tabiki aç"; `strategy.itemCapScope`; tek rehberde 4
  soru 0/10 → 9/10, dev setinde fark 0 `rag-lab-2026-09-27-13.md`; "message" = eski tavan, taban `base0926` orada sabit; belge §6e).
- **Alt sorgu yuvaları (#208, 09-27):** tavan (4) aşılınca yuvalar SERT bölümler (?, satır, ;) arasında SIRAYLA EŞİT dağıtılır,
  bölüm içinde yazılış sırası (tavan aşılmıyorsa parçalar birebir eskisi). ÖLÇÜLÜP REDDEDİLDİ: "soru cümleciği önce", "içerikli
  cümlecik önce" (bağlam cümleciği düşüyordu). Tekrar eden ek sorgu kararı yeniden sıralamadan ÖNCEKİ baş adaylarla ve ilk üç
  adayın HEPSİ özgün sorguların başındaysa (tek ortak baş aday yetmez).
- **A5 getirme düzeltmeleri (#208, 09-27; çevrimdışı ölçüm: sözcükselde getirme +0/−0, sahte "insana devret" notu çok soruda
  8→1, tek soru TR 9→0; anlamsal+anlamada çok soru 88→90):** çelişki ortağı her FARKLI saat değeri için TEK temsilci (12 bayat
  kopya bloğu doldurmaz; temsilci önce seçilenlerden) · dizin KURALLI sırada kurulur (güncellik ↓, kimlik — aynı küme, önbellek
  durumundan bağımsız aynı seçim) · özgün listenin ilk `maxChunks` adayı ek sorgu önce seçse de ÖZGÜN sayılır · hiçbir tarafı
  bloğa girmeyen çelişkiye not YAZILMAZ (bir tarafı girip öbürü sığmayınca yazılır) · hata dalı da `dropSuperseded` · sert bölme
  kısa `[…]`/`<…>` içinden kesmez. İsabetsiz soru dolgusu `strategy.noHitFill` ÖLÇÜLDÜ, varsayılan KAPALI (sözcükselde +16/−9,
  bloklar büyüdü; anlamsalda etkisiz).
- **Anlama katmanı sorguları** (`AI_UNDERSTANDING_ENABLED`, varsayılan kapalı): model sorulan her şeyi bağımsız,
  geçmişle çözülmüş Türkçe + özgün dil sorgusuna yazar (`extraQueries`); deterministik alt sorgulara BİRLEŞİM
  (sona, ayrı tavan 6, ÖNCE Türkçeler; hiçbir alt sorgunun yerine geçmez, kümeye kalem ekleyemez); 🚨 model
  sorguları bütçenin en fazla 1/3'ü KARAKTER+PARÇA olarak (çektiği çelişki partnerleri dahil); özgün sorgunun
  kapsadığı konuyu tekrar eden ek sorgu pay almaz; ek sorguya geçmiş kökü taşınmaz; özgün sorgu isabetsizse
  legacy kümesi KIRPILMAZ, isabetler öne ≤4 (legacy'deki kalem yalnız taşınır, yeni kalem yalnız PARÇA ≤3k
  karakter, saati çelişen parça eklenmez); Türkçe 3-gram sorgu BAŞINA; `greeting_thanks` sorgu üretmez; kapalıyken
  sonuç BİREBİR; sorgu METNİ kanıta girmez (`q` deterministik; `uq/uf/un/unMs/ui` yalnız sayı/kapalı küme).
  Retrieval sorgulara ihtiyaç duymuyorsa (küçük KB/legacy) katman BEKLENMEZ, cevapla paralel koşar, kapıdan önce
  `await kbSel.understanding`; kanıt `evidenceAfterUnderstanding()`.
- **İngilizce köprü sorgusu** (10-10, anahtar `AI_UNDERSTANDING_EN_QUERY_ENABLED` KAPALI, kurucu yokken karar #13; ölçüm
  `docs/olcum/RAG-AYRISTIRMA-2026-10-10.md`): Türkçe soru → İngilizce yazılmış kalem yönü %79'du (diğer yönler %98–100). Açıkken her istek
  `query_en` taşır, `understandingQueries`te ÜÇÜNCÜ geçiş (Türkçe → özgün → İngilizce; tavan 6 onların yerini almaz; İngilizce misafirde
  tekrar etmez). Kapalıyken şema / istem / önbellek anahtarı / sorgu listesi bayt bayt eski (pinli). Bilinen sınır: 4–5 sorulu Türkçe
  mesajda köprü ilk 1–2 isteğe yetişir. 🚨 Lab (`rag-lab`, `rag-answer`) anlama kipi 10-10'dan beri ÜRETİMİN bayraklarından
  (`labUnderstandingMode`); canlıyı ölçmek için koşuya canlı bayraklar verilir (`AI_CONVERSATION_ITEMS_ENABLED`, `AI_HOUSE_RULES_SHADOW`,
  `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED`) — eskiden sabit "öğe + kural" koşup kimliğe bayraklardan başka kip yazıyordu.
- **Önbellek anahtarı küme parmak izi** (id+updatedAt+içerik özeti), `max(updatedAt)` DEĞİL. Kanıt
  `kbEvidenceJson.retrieved[].c` + `.retrieval {q, fb, sel, cand, ms, srcs, sup, conf, fus}` — PII yok, misafire dönmez.
- **Retrieval politika DEĞİLDİR** (kötü niyetli kalem sözcüksel eşleşince gider; eleme ayrı onay). Güvenlik
  filtreleri yeni yolda AYNEN (`kb-retrieval-secret-scope.test.ts`, bayrak açık).
- **Host graf katmanı** `modules/intelligence/graph/property-graph.ts` (saf, yüzeye bağlı değil): her kenar
  `source/observedAt/certainty`; `recurringIssues` kanıt sınıfı `reported_only|task_open|task_done` ('confirmed'
  YOK); görev kanıtı YALNIZ bildirime bağlı görevlerden; misafir yoluna taşınmaz (pin). LightRAG/HippoRAG = ücretli → onay.
