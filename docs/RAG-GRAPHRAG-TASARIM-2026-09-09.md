# RAG / GraphRAG — somut tasarım + ilk yerel dilim (2026-09-09)

> Kurucu/Codex talebi: mevcut kaynak/onay/kanıt altyapısını kullanarak retrieval tasarımı + **bağımsız ve mevcut
> yetki içindeki ilk dilimin yerelde uygulanması**. Migration, yeni ücretli servis ve güvenlik/gönderim politikası
> değişiklikleri **ayrı onaya** (bu belgenin §5'i). Canlıya alma YOK: bayrak `KB_RETRIEVAL_MODE` varsayılan KAPALI.
> Gerçek model eval'ini kurucu koşar. **P5 (kanıtsız iddia için kod kapısı) AÇIK kalır — RAG bu açığı kapatmaz (§7).**

---

## 0. Kısa hüküm

| Soru | Cevap |
|---|---|
| Bugün neden retrieval yok? | Bilgi tabanı mülk-kapsamlı ve küçük; `kb-fetch` en yeni 30 kalemi çekiyor, `packKnowledgeBase` 24k karakterde kesiyor. Küçük KB'de bu doğru. Sorun **uzun rehber metni** (host'un "Genel" kalemi) ve **30+ kalem**de çıkıyor: ilgili cümle ya tavandan düşüyor ya 7k karakterin ortasında kayboluyor. |
| İlk dilim ne? | **LLM'siz, deterministik hibrit seçici**: parçalama + Türkçe-öncelikli sözcüksel arama (BM25 + kök alma + alan sözlüğü + yazım toleransı) + deterministik yeniden sıralama + çok soru kapsama + konuşma bağlamı + kanıt. Yetki/onay/sır filtreleri **retrieval'ın ÖNÜNDE** kalır (yapısal pin). |
| Vektör/embedding? | **Arayüz + no-op** bugünden sabit (`retrieval/semantic.ts`); gerçek puanlayıcı **yeni ücretli servis** → onay. Ölçülmüş ihtiyaç olmadan eklenmez (kurucu ilkesi). |
| GraphRAG? | **Bu dilimde uygulanmadı.** DB-gerçek kenarlar envanteri + hangi sorulara yarayacağı + marjinal fayda ölçüm planı §6'da. |
| Canlı etkisi? | Bayrak kapalıyken seçici **aynı dizi referansını** döndürür (kimlik), `kb-fetch` aynı `take`, istem aynı metin; test-pinli. |

---

## 1. Mevcut yapı (doğrulanmış)

- **Kaynak/onay:** `KnowledgeBaseItem.source/reviewState/approvedAt`; AI yolu **yalnız** `fetchKnowledgeBaseForPrompt`
  (`KB_APPROVAL_GATE_WHERE` çağıranla `AND`'lenir; taslak modele gitmez; `count` aynı filtre).
- **Kapasite:** `KB_ITEM_CAP=30` (SQL `take`, `updatedAt desc`), `KB_CHAR_BUDGET=24_000` (`packKnowledgeBase`, açgözlü).
- **Sır elemesi (yüzey başına, retrieval'dan önce):** QR `QR_SECRET_CATEGORIES` (WHERE) + `withoutSecretKbItems`
  (tam tarama, 24k üstü fail-closed); oto-yanıt onaysız konaklamada aynı iki bacak; inbox öneri/test kartı süzmez
  (host yüzeyi, insan görür).
- **Kanıt (A2):** `RiskEvent.kbRetrieved/kbDropped/kbPendingApproval/kbNewestUpdatedAt/kbEvidenceJson/srcDeclared/srcVerified`;
  `buildKbEvidence` = `{retrieved:[{type:"kb_item",id,v}], used:[…]}` (PII yok); yazan yüzeyler QR + oto-yanıt.
- **Model beyanı:** `verifyUsedSources` `kb:<category>` etiketini yalnız kategori üyeliğiyle doğrular (içerik değil).
- **Türkçe metin araçları:** `foldTurkishLower/Tr/Ascii` (export), `normalizeForMatch`/`matchCandidates` (özel),
  `\p{Default_Ignorable_Code_Point}`+U+2800 görünmez sınıfı, kesme işareti kelime sınırı. Kök alıcı / eşanlam /
  durak kelime / BM25 / arama kütüphanesi **YOKTU**.
- **Bağlam:** QR `buildGuestChatContextWindow` (24 mesaj / 8k karakter, `openTopics` kapalı-küme niyet kodları:
  complaint/refund/early_departure/human_request — KB kategorisine eşlenmez); `countGuestAsks` çok-soru sayacı.
- **Graf ilişkileri (DB-gerçek FK):** Property→Reservation/Conversation/KnowledgeBaseItem/Task/Signal/PropertyMemory,
  Conversation→Message/Reservation, Signal→Property/Reservation/Conversation. **Opak kimlikler (FK yok):**
  `RiskEvent.triggerId/conversationId`, `Signal.sourceEntityId`, `IngestEvent.entityType/entityId`,
  `Task.sourceMessageId`, `KnowledgeBaseItem.sourceRef/supersededById`.
- **Deterministik araç adayları (belgeden tahmin ETMEZ):** `getAdjacency` (komşu rezervasyon), `getOpsStats`,
  `findAttentionItems` (V2.1), `findKbGaps` (A3), görev sorguları. `verifiedToolResults` sözleşmesi henüz istemde yok.

---

## 2. Bileşenler (ilk dilim — KODLANDI, bayrak kapalı)

```
src/lib/ai/retrieval/
  flag.ts         KB_RETRIEVAL_MODE tek okuma noktası (yaprak; kb-fetch + select paylaşır)
  text.ts         normalize (NFKC + görünmez sınıf + ASCII-Türkçe katlama + kesme = sınır), tokenize (SS:DD),
                  durak kelimeler, ek sökücü (TR + EN, simetrik), bigram Dice
  lexicon.ts      16 kavram (otopark/wifi/kimlik-bilgisi/çöp/giriş/çıkış/konum/kurallar/temizlik/yerel/iklim/
                  sıcak su/elektrik/beyaz eşya/tv/olanaklar) → sorgu genişletme (0.5) + kategori ipucu
  chunker.ts      deterministik parçalayıcı: cümle sınırı, hedef 600 / tavan 900; parça = content.slice (bitişik)
  bm25.ts         Okapi BM25 (k1 1.2, b 0.75), başlık ×2, BM25+ IDF; OSA düzenleme uzaklığıyla yazım toleransı
  semantic.ts     SemanticScorer sözleşmesi + no-op + harman (0.4) — gerçek puanlayıcı ONAY ister
  index-cache.ts  LRU 64 / TTL 10 dk; anahtar = küme parmak izi (id + updatedAt + içerik özeti) — max(updatedAt) DEĞİL
  select.ts       selectKbForPrompt: küçük-KB passthrough → alt sorgular → BM25 + ipucu + başlık + kalıp (+ anlamsal)
                  → alt sorgular arası round-robin → çelişki koruma (checkin/checkout saat parçaları) → bütçe
                  (6k karakter / 12 parça) → droppedItems + PII'siz kanıt; isabet yoksa GERİ ÇEKİLİR; hata = legacy
```

Değişen mevcut dosyalar: `ai/limits.ts` (+3 sabit), `ai/kb-fetch.ts` (`take` bayrağa göre 30 → 200), `ai/grounding.ts`
(`c` parça indeksi + `retrieval` özeti), `ai/types.ts` (`knowledgeBaseSelection`), `ai/prompts.ts` (`packKnowledgeBase`
seçilmiş-küme notu), dört AI yüzeyi (`automation.ts`, QR rotası, inbox öneri, test kartı) — hepsi tek satır
`selectKbForPrompt(...)` + seçilen küme/düşen sayısı.

### Veri akışı (hibrit AÇIK)

```
kb-fetch (mülk + isActive + ONAY KAPISI; take 200, updatedAt desc)
  → yüzeyin sır elemesi (QR: kategori + içerik; oto-yanıt: onaysız konaklamada aynı)   ← DEĞİŞMEDİ, seçicinin ÖNÜNDE
  → selectKbForPrompt(items, guestMessage, history)
      küçük KB (≤12 kalem ve ≤6k) → tamamı (small_kb)
      alt sorgular (?, satır, ";", ",", ve/ayrıca/and/also; ≤4; nezaket parçaları düşer)
      ince sorgu (<2 kök) → son 2 MİSAFİR mesajının kökleri 0.5 ağırlıkla (bizim cevaplarımız sorgu OLMAZ)
      BM25 (kök + genişletme + fuzzy) → aday şartı: güçlü kök isabeti YA DA kategori ipucu
      puan = BM25/max + 0.35·ipucu + 0.15·başlık + 0.10·bigram (+ anlamsal harman); taban max(0.1, 0.25·en iyi)
      round-robin birleşim (kalem başına ≤3 parça) → çelişki koruma → bütçe
      hiç aday yoksa → no_lexical_hits: TAMAMI gider (legacy)
  → suggestReply(knowledgeBase = seçilen parçalar, knowledgeBaseDropped += seçilmeyen kalem, knowledgeBaseSelection="retrieved")
      istem notu: "[NOT] … SORUYA GÖRE SEÇİLDİ; N kalem alınmadı. Sorulan konu yukarıda yoksa 'bilgi yok' DEME — insana devret."
  → RiskEvent: kbRetrieved = parça sayısı, kbDropped = toplam düşen, kbEvidenceJson.retrieved[].c = parça, .retrieval = {q, fb, sel, cand, ms}
```

### Değişmezler (test-pinli, iki yönlü mutasyonla doğrulandı: 20/20 yakalandı)

- Bayrak kapalı = **kimlik** (aynı dizi referansı, `droppedItems` 0, `selection` "all", kanıt null).
- Retrieval modülü **DB'ye erişmez, kalem ekleyemez, metni değiştiremez** (parça = `content.includes(chunk)`).
- Yetki/mülk/onay/sır filtreleri **retrieval'ın önünde** (QR: `ctx.knowledgeBase`; oto-yanıt: `kbVisible`).
- **Hibrit legacy'den az bilgi taşımaz:** isabet yoksa / selamlaşmada / hata anında tam küme gider (E1 dürüst "bilgi yok" korunur).
- **Çelişki gizlenmez:** giriş/çıkış kategorisinde saat taşıyan parçalar birlikte gider (`findTimeConflicts` P4-b iki kaynağı görür).
- Silinen/pasif/onaydan düşen kalem indekste **yaşayamaz** (küme parmak izi); içerik değişince (`updatedAt` aynı, yer tutucu
  ikamesiyle misafir ADI girmişse) parmak izi değişir → başka misafirin adı taşıyan parça başka sohbete dönmez.
- Kanıt PII'siz (yalnız kimlik, sürüm, parça indeksi, sayılar/kodlar); misafire dönen gövde kanıt taşımaz (QR rota testi).
- Bayrak **tek** yerde okunur (`retrieval/flag.ts`).

---

## 3. Baseline ölçümü (model YOK) — `docs/olcum/kb-retrieval-baseline-2026-09-09.md`

Üretici `tests/unit/kb-retrieval-baseline.test.ts` (CI'da kapı; `KB_RETRIEVAL_REPORT=1` ile rapor yazar).
13 senaryo, Codex sınıfları: uzun metin ortası (×2), Türkçe eşanlam, İngilizce soru, yanlış kategori, çok soru,
kaynak çelişkisi, kaynakta kötü niyetli talimat, yazım hatası, konuşma bağlamı, büyük harf, selamlaşma, isabet yok.

| Ölçüt | Sonuç |
|---|---|
| **Legacy'nin ölçülen açığı** | `long_middle_oldest`: 35 kalem, rehber en eski → en-yeni-30 tavanı rehberi düşürür → ilgili cümle modele **gitmez** (❌). Hibrit ✅ (879 karakter). |
| İsabet | Hibrit hiçbir senaryoda legacy'den az değil (pin). |
| Maliyet vekili (karakter) | İsabetli senaryolarda blok 2.9k–7.8k → 0.2k–0.9k (ortalama ~%85 azalma). Token ölçülmedi; tahmin yazılmadı. |
| Gürültü (ilgisiz kalem) | 20–30 → 0–2. |
| Kötü niyetli kaynak (ilgisiz soruda) | Legacy'de modele **gider**, hibritte gitmez — maruziyet farkı, **politika değil** (sözcüksel eşleşince yine seçilir). |
| Geri çekilme | Selamlaşma / isabet yok → blok legacy ile **birebir aynı**. |
| Gecikme | 1.7–8.9 ms / senaryo (indeks kurulumu dahil; önbellek soğuk). |

**Bu rapor modelin CEVABINI ölçmez.** Cevap kalitesi/kaynak beyanı/kanıtsız iddia ölçümü gerçek model eval'inin işidir
(`npm run eval`, kurucu koşar). Hibrit bayrağı eval'de test etmek için: `KB_RETRIEVAL_MODE=hybrid RUN_REAL_EVAL=1 …` —
mevcut 8 senaryo küçük KB'lerle çalışır (small_kb passthrough → **legacy ile aynı istem**); hibritin gerçek etkisi için
eval setine **uzun rehber + 30+ kalem** sınıfı eklenmeli (ayrı iş, §8).

---

## 4. Veri akışı garantileri (Codex şartları ↔ kod)

| Şart | Nerede |
|---|---|
| Onaylı içerik parçalanır (uzun "Genel" dahil) | `chunker.ts`; onay kapısı `kb-fetch` içinde (seçici onaysız kalem GÖREMEZ) |
| Anahtar kelime + anlamsal + yeniden sıralama | BM25 + sözlük + fuzzy (bu dilim); anlamsal = sözleşme + no-op (§5) |
| Konuşma bağlamı + çok soru | ince sorguda son 2 misafir mesajı; alt sorgu round-robin (E8 sınıfı) |
| Yetki/mülk/onay/tazelik filtreleri aramada, önbellekte, graf genişletmede korunur | arama: girdi zaten süzülmüş; önbellek: parmak izi süzülmüş kümenin kendisi (küme başına ayrı giriş); graf: uygulanmadı |
| Cevap başına kaynak sürümü | `kbEvidenceJson.retrieved[].{id,v,c}` |
| Silinen/pasif içerik türetilmiş indekste yaşamaz | küme parmak izi (test: silme + içerik değişimi) |
| Takvim/görev durumu belgeden tahmin edilmez | KB metni yalnız bilgi bloğudur; canlı gerçekler `verifiedToolResults` sözleşmesine (uygulanmadı, CLAUDE.md gereksinimi) |
| Misafir ↔ host kapsamı ayrı | seçici yüzeyin süzgecinden SONRA çalışır: QR (misafir) sır kategorisi + içerik; inbox/test kartı (host) süzmez — mevcut ayrım korunur |
| Kaynak çelişkisi | çelişki koruma kuralı + `findTimeConflicts` (P4-b) |

---

## 5. Migration / servis ihtiyacı tablosu (ONAY KAPILARI)

| Bileşen | Migration | Ücretli servis | Politika değişikliği | Durum |
|---|---|---|---|---|
| Hibrit sözcüksel seçici + parçalama + kanıt (`c`, `retrieval`) | YOK (`kbEvidenceJson` JSON alanı genişledi) | YOK | YOK (bayrak kapalı; açıkken istem notu wording'i değişir, kural aynı) | **KODLANDI, bayrak KAPALI** |
| `kb-fetch` okuma tavanı 30→200 (yalnız bayrak açıkken) | YOK | YOK | YOK (onay kapısı aynı) | KODLANDI |
| Anlamsal puanlayıcı (embedding) | Kalıcı vektör için **EVET** (`KbChunkEmbedding` ya da pgvector) — ilk adımda bellek-içi/önbellek ile **HAYIR** | **EVET** (OpenAI `text-embedding-3-small` ya da eşdeğeri; KB metni dış servise gider → KVKK alt-işleyen listesi) | YOK | **ONAY BEKLER** |
| Hibrit bayrağı canlıda açma | YOK | YOK | Modele giden bağlam değişir (daha az, daha ilgili) — eval + tek mülk pilotu şart | **ONAY BEKLER** (§8 sırası) |
| Kötü niyetli KB kalemini retrieval'da **eleme** (`detectPromptInjection` ile) | YOK | YOK | **EVET** (modele ne gitmez kararı) | ONAY BEKLER — bu dilimde yalnız ÖLÇÜLDÜ |
| GraphRAG (ilişki genişletme) | Kenar tablosu **gerekmez** (FK'lar var); opak kimlikler için **EVET** (`Task.sourceMessageId`, `Signal.sourceEntityId` → FK) | YOK | Misafire dönen cevapta operasyon verisi kullanımı = gönderim politikası → **EVET** | TASARIM (§6) |
| `verifiedToolResults` / `actionReceipt` (P2, P5) | YOK | YOK | **EVET** | AYRI TUR (CLAUDE.md gereksinimi) |

---

## 6. GraphRAG — tasarım ve ölçüm planı (UYGULANMADI)

**Ne değil:** metinden çıkarılan varlık grafı (LLM ile "otopark → bina → kapıcı" üçlüleri). Bunun kanıtı yok ve
Property Memory ilkesine aykırı (LLM metni kalıcı gerçek değil).

**Ne:** zaten DB'de olan ilişkilerden **deterministik bağlam genişletme**. İki katman, birbirinden AYRI etiketlenir:

| Katman | Kenar | Kaynak | Kanıt |
|---|---|---|---|
| **DB-gerçek** | Conversation→Reservation→Property; Property→KnowledgeBaseItem (onaylı); Property→Signal (son 90 gün, kategori); Property→PropertyMemory (evidence/confidence/expiry); Reservation→komşu Reservation (`getAdjacency`); Property→Task (açık) | FK / indeksli sorgu | `{type,id}` deyimi (`PropertyMemory.evidenceJson`) |
| **Çıkarım** | Signal↔KB kategorisi eşlemesi (A3 `findKbGaps`), sinyal örüntüsü→hafıza (≥3/180 gün), retrieval seçimi | kod kuralı | `certainty: "inferred"` (V2.1 deyimi) |

**Hangi sorulara yarar (hipotez, ölçülecek):**
1. "Çıkışı 13:00'e uzatabilir miyim?" → Reservation→komşu Reservation (bugün `adjacency` zaten istemde) — GraphRAG'ın
   marjinal faydası **sıfır**; mevcut yol yeterli.
2. "Klima yine çalışmıyor" → Property→Signal (aynı kategori tekrar) + PropertyMemory (bilinen arıza) → host'a "tekrar
   eden arıza" bağlamı (V2.1 zaten üretiyor) — misafire cevapta kullanımı **politika**.
3. "Havlu istemiştim, geldi mi?" → Task durumu — **deterministik araç** (`verifiedToolResults`), retrieval değil.
4. Çok mülklü host'ta "diğer dairede de böyle miydi?" → Property↔Property (aynı org) — misafir kapsamı DIŞI, host yüzeyi.

**Marjinal fayda ölçümü:** aynı harness deyimi (`tests/unit/kb-retrieval-baseline`): her soru sınıfı için
(a) yalnız KB retrieval, (b) KB + DB-gerçek genişletme; ölçüt: isabet, ek karakter, ek DB sorgusu, gecikme, ve
**"belgeden tahmin" ihlali sayısı** (takvim/görev durumu metinden çıkarılmış mı). Fayda gösterilmeden GraphRAG kodu
yazılmaz (CLAUDE.md: "GraphRAG ihtiyaç kanıtlanırsa").

---

## 7. P5 açık — RAG bunu kapatmaz

P5 = **kanıtsız eylem/söz iddiası için KOD KAPISI** (`unverifiedActionClaims` dedektörleri `tests/helpers/` içinde,
ürün koduna taşınmadı; `actionReceipt` uygulanmadı). Retrieval modele **daha doğru bilgi** verir; modelin
"ilettim / döneceğim" demesini **engellemez** — o, istem (P1, uygulandı) + kapı (P5, ONAY BEKLER) işidir. Hibrit
açılsa bile E1 sınıfı dürüstlük yalnız istem talimatına dayanır. Bu belge P5'i kapanmış saymaz.

---

## 8. Sıra (önerilen)

1. **Bu dilim** (bayrak kapalı) → CI → deploy (davranış aynen). ✅ kod hazır.
2. Eval setine **uzun rehber + 30+ kalem** sınıfı (anonim, sürümlü) — hibritin gerçek model üzerindeki etkisi ancak
   böyle ölçülür; mevcut 8 senaryo küçük KB → passthrough.
3. Kurucu: `KB_RETRIEVAL_MODE=hybrid` ile eval (baseline = aynı koşu bayraksız) → fark tablosu.
4. Tek test mülkü + RiskEvent `retrieval.fb` dağılımı (small_kb / none / no_lexical_hits / empty_query / error) →
   genişletme kararı kurucunun.
5. Anlamsal puanlayıcı **yalnız** sözcüksel isabet oranı ölçülüp yetersiz bulunursa (ücretli servis onayı + KVKK).
6. GraphRAG **yalnız** §6 ölçümü fayda gösterirse.

## 9. Bilinen sınırlar (dürüst)

- Kök alıcı kural tabanlı ve DAR; yanlış birleştirme mümkün ("kapı"/"kap"); simetrik olduğu için kaçırma üretmez,
  IDF nadir çarpışmaları söndürür. Ölçülmüş çarpışmalar: "varış→var" (sözlükten çıkarıldı), "şu→su" (durak listesinden
  çıkarıldı), "ki" eki (listeden çıkarıldı).
- Sözlük 16 kavram; eksik kavram = sözcüksel isabete düşer (geri çekilme değil, yalnız ipucu kaybı).
- Çok soru bölme virgülü de böler; "Merhaba, otopark var mı" → nezaket parçası düşer, sorun yok; "Klima çalışmıyor, çok
  sıcak" → iki alt sorgu aynı konuyu getirir (zararsız tekrar).
- Hibrit AÇIKKEN onaysız konaklama/QR sır süzgeçleri 30 yerine 200 kaleme kadar tarar (`withoutSecretKbItems` tam
  tarama, kalem başına ölçülü 0.7–3.2 ms) — plan tavanı 60 kalem olduğundan üst sınır ~200 ms; ölçüm §3 gecikmesi
  yalnız seçiciyi kapsar.
- Anlamsal harman ağırlığı (0.4) ölçülmedi — puanlayıcı yokken ölü kod; gerçek puanlayıcıyla yeniden ayarlanır.
