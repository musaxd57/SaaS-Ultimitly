# TASARIM — L1 "Geçmiş ev sahibi cevaplarını kontrol etsin" + L4 "Az değiştirilmiş taslaktan öğren" (10-17, Opus, YALNIZ OKUMA)

> Depo: /home/user/SaaS-Ultimitly, HEAD `301608ed`. Kaynak dosya DEĞİŞTİRİLMEDİ; vitest / prisma / ücretli model / ağ YOK.
> Kurucu kararları (10-17, `docs/arastirma-2026-10-15/KURUCU-SORULARI.md:686,689`, AYNEN özü):
> - **L1:** "mantıklı; sürekli onay istemesin (iki kip, hatasız); aynı şey farklı yazılmışsa daha güncel kazanır; iyi embedding; ilk başta
>   bütün mesajlar tutulup dizinlensin; güven zamanla azalsın (dün yazılan neredeyse kesin, 1 yıl önceki zayıf)".
> - **L4:** "ev sahibi taslağı az değiştirip gönderdiyse değiştirdiği yerleri o daire için öğrensin (%40'tan az değişim); milyar dolarlık
>   şirket çözümü".
> Önceki öneri (KURUCU-SORULARI §L1, `:625-633`; ilk dilim tasarımı `docs/arastirma-2026-10-15/gecmisten-ogren-6-ilke.md` §C `:181-281`)
> migration'sız, gömmesiz, canlı satırdan okuyan bir ilk dilimdi. Kurucunun 10-17 cevabı ("iyi embedding", "bütün mesajlar dizinlensin",
> "güven zamanla azalsın") KALICI bir dizin ister → bu belge o ilk dilimi migration'lı bir dizinle değiştirir; §C'nin aday kuralları
> (C2) aynen korunur.
> Etiketler: **[KOD]** kodda doğrulandı (dosya:satır) · **[TAHMİN]** ölçülmedi · **[SORU]** kurucu kararı gerekir.

## İçindekiler
0. Özet — beş karar noktası
1. Mevcut durum envanteri
2. L1 veri modeli + migration + geri doldurma + artımlı dizin + KVKK
3. "Güven zamanla azalsın" — formül, küme, "daha güncel kazanır", bilgi tabanıyla çakışma
4. "İki kip, sürekli onay istemesin, hatasız" — yorumlar + kurucu sorusu
5. L4 — taslak → gönderilen fark, ölçü, parçalar, ne öğrenilir, nereye, riskler, ≥%60 kuralıyla ilişki
6. Dilimleme + test planı + riskler + ReDoS
7. Kurucuya sorular (6)

---

## 0. Özet — beş karar noktası

1. **Dizin TABLOSU şart (migration):** bugün geçmiş ev sahibi cevabı cevap anında HİÇ kullanılmıyor (yalnız "Geçmişten öğren" taslağı →
   onay → bilgi tabanı) ve gömme vektörleri yalnız SÜREÇ BELLEĞİNDE (KB parçaları için). "Bütün mesajlar dizinlensin" + "iyi embedding"
   + "güven zamanla" → yeni tablo `HostAnswerEvidence` (maskeli soru/cevap kopyası + iki vektör + küme / halef + yazarlık sınıfı) ve
   `HostAnswerIndexState` (mülk başına imleç). Vektör `Bytes` (E2 onay paketinin seçimi, pgvector YOK).
2. **Yazarlık kapısı getirmenin İÇİNDE:** yalnız EV SAHİBİ İNSAN cevabı satır olur; yapay zekâ (aiAssisted, authorType ai, sihirli ad),
   otomatik şablon (K7), kanal otomasyonu (L5), teslim edilmemiş kuyruk mesajı, karışık dizi, ve — YENİ — taslağa bağlı DEĞİŞTİRİLMEMİŞ
   gönderim asla satır olmaz. L4 bağı (taslak kimliği) yankı sezgiselinin (≥%60) yerini, bağ OLAN satırlarda alır.
3. **Güven = tazelik × pekiştirme, küme içinde en yeni kazanır:** yarı ömür H=120 gün (1 gün %99, 90 gün %59, 1 yıl %12); aynı soru
   kümesinde en yeni cevap temsilcidir, farklı DEĞERLİ eski cevap halef alır (gösterilmez), aynı değerli eski cevap güveni artırır
   (gürültülü-VEYA). Bilgi tabanı aynı konuda varsa geçmiş cevap modele GİRMEZ; geçmiş cevap bilgi tabanından YENİ ve farklıysa ev
   sahibine tek tıkla "bilgi tabanını güncelle" (L2 akışı) — [SORU 2].
4. **"İki kip" belirsiz [SORU 1]:** önerim Kip A (yalnız "AI öner" taslağı, kaynak gösterimiyle; misafire giden DEĞİŞMEZ — ev sahibi
   zaten gönder'e basıyor, ek onay yok) varsayılan; Kip B (otomatik cevap bağlamı, yalnız güçlü + taze + bilgi tabanıyla çakışmasız +
   değersiz/sırsız cevap, bütün kapılar aynen) ayrı anahtar, ölçümden sonra. Kip B misafire gideni DEĞİŞTİRİR.
5. **L4 = bağ + fark + üç çıktı:** taslak satırı (`AiReplyDraft`) → gönderilen mesaj bağı (bugün YOK); sözcük düzeyi düzenleme oranı;
   atıf CÜMLE düzeyinde: yapay zekânın AYNEN kalan cümlesi hiçbir sınıfta kanıt değil, ev sahibinin içerikçe dokunduğu / eklediği cümle
   kanıt (L1'e `host_edited_ai` / `host`); %0 → hiçbir şey. Kurucu eşiği <%40 "DÜZELTME" (düzeltme defterine girer), ≥%40 "kendi cevabı".
   Tekrarlayan düzeltme (2+ farklı rezervasyon) → TEK onaylı "bilgi tabanına işle" kartı; konaklamaya özgü düzeltme (tarih / izin / ücret /
   ad) kalıcı olgu SAYILMAZ; daire alanı ve bilgi tabanına HİÇBİR şey kendiliğinden yazılmaz [SORU 4].

---

## 1. Mevcut durum envanteri

### 1.1 Eski ev sahibi cevapları bugün nerede kullanılıyor [KOD]

| Yüzey | Ne yapıyor | Kaynak | Cevap anında mı? |
|---|---|---|---|
| Cevap istemi KURAL-1 | "SADECE 3 KAYNAK": bilgi tabanı · mülk/rezervasyon · ev sahibinin **BU SOHBETTE** verdiği cevaplar | `src/lib/ai/prompts.ts:105-113` | evet, ama yalnız O konuşma |
| Geçmişten öğren (migration 65) | 540 gün / 6.000 mesaj okur → çift → maske → Luna → bilgi tabanı TASLAĞI → ev sahibi onayı → KB kalemi | `src/lib/history-learn/service.ts:66-68,231-339`; anahtar `HISTORY_LEARN_ENABLED` `:35-37` (KAPALI) | HAYIR (çevrimdışı, onaylı) |
| Karşılaştırma ("Böyle yapsın") | geçmiş soruya bugünkü kuru koşu cevabı ↔ ev sahibinin o zamanki cevabı; not → mülk talimatı + taslak | `service.ts:354-422,879-993` | HAYIR |
| Mülk talimatı | ev sahibi notu / hazır seçenek → istem bloğu | `history-learn/prompt-instructions.ts:23-25,48-73` (anahtar `PROPERTY_INSTRUCTIONS_PROMPT_ENABLED` KAPALI) | evet (üslup, olgu kaynağı DEĞİL `:14`) |
| Üslup profili | org genelinde host cevaplarından damıtılmış ÜSLUP | `automation.ts:4413-4469`; F13 "olgu kaynağı değildir" `docs/claude/ai-guvenlik.md:325-332` | evet (yalnız üslup) |
| Bacak B (`KB_HISTORY_SUGGESTIONS_ENABLED`) | sözcük ağıyla kategori → en yeni cevap → KB önerisi; `existingKb` varsa önerme | `src/lib/kb-from-history.ts:344-410` (`:353-371` KB önceliği; `:381-386` "en yeni önerilir, en sık değil") | HAYIR, KAPALI |

Sonuç: **aynı dairenin başka konuşmalarındaki ev sahibi cevapları cevap anında hiçbir yüzeye girmiyor.** "AI öner"in girdileri
(`src/app/api/conversations/[id]/ai-suggest/route.ts:162-212`): bilgi tabanı (konaklama sır kapsamı `:110`, soruya göre seçim
`:129-146`), mülk + rezervasyon, BU konuşmanın penceresi (`:57-61,190-195`), konuşma kayıtları (`:152-160`), üslup profili (`:206`), mülk
talimatı (`:207`), komşu rezervasyon (`:119-125`), geç çıkış teklif metni (`:209`). Taslak son misafir mesajının `aiSuggestedReply`
alanına YAZILIR (üstüne) `:217-225`; yanıt `{...result, reply: hostDraft, availabilityCheck, earlyCheckin}` `:291`. Panel `usedSources`'u
gösterir (`src/components/inbox/conversation-thread.tsx:1011-1015`) — L1'in "dayandığı eski cevap" kutusu buraya oturur. Kanal oto-yanıtı
"hazır taslağı" aynı alana yazar (`src/lib/automation.ts:3038-3050`). "AI öner" yolu üretim izi YAZMAZ: `channel_suggest` yüzeyi tanımlı
(`src/lib/ai/generation-trace.ts:30`) ama yazanı yok (grep: tek eşleşme tanım satırı).

### 1.2 Yazarlık — "ev sahibi insanı mı yazdı" bugün nasıl ayrılıyor [KOD]

| Sınıf | Alan / kural | Yer |
|---|---|---|
| Yapay zekâ (oto-yanıt / QR botu) | `authorType: "ai"`; NULL eski satırda `senderName ∈ {"GuestOps AI","Lixus AI"}` | `message-author.ts:103,117-123`; `kb-from-history.ts:30,157-159` |
| "Onayla ve gönder" (taslak aynen) | `aiAssisted: true` (istemciden: `reply/route.ts:52`; düğme `conversation-thread.tsx:1119`) | `kb-from-history.ts:153` |
| "Taslağı kullan" + "Gönder" | yazma alanını doldurur (`conversation-thread.tsx:1116`), "Gönder" `sendReply(composer)` → `aiAssisted=false` (`:1181,260-279`) → **ev sahibi gibi görünür** | yankı sezgiseli `pairs.ts:38-68` (taslak sözcüklerinin ≥%60'ı cevapta → çift düşer; <4 sözcüklük taslak sayılmaz; en çok 400 sözcük) |
| Bizim otomatik şablonumuz (K7) | `authorType: "automation"`; cevap değil, bloğu tüketmez | `message-author.ts:40-59`; `pairs.ts:118-121` |
| Kanalın kendi otomasyonu (L5, migration 71) | `channelSenderRole: "automation"`; `unknown` ev sahibi sayılır (bilinçli) | `message-author.ts:61-94`; şema `prisma/schema.prisma:715-720` |
| Sistem olayı | `systemEventType` dolu | `kb-from-history.ts:152` |
| Ev sahibi + yapay zekâ karışık dizi | çift DÜŞER (fail-closed) | `pairs.ts:124` |
| Teslim edilmemiş kuyruk mesajı | kuyruk satırı var ve hiçbiri `sent` değil → kanıt değil | `service.ts:254-258,581-589` |
| "Sorunlu" konuşma | çift üretilmez | `pairs.ts:92` |
| Senkronla gelen her giden satır | `authorType: inbound ? "guest" : isOurAutomation ? "automation" : "host"` — sağlayıcının yapay zekâsı / eski şablonu (rol yoksa) HOST görünür | `src/lib/ingest/write-service.ts:463` |
| Panelden ev sahibi gönderimi | `authorType: "host"`, `aiAssisted` istemciden | `src/lib/host-send.ts:69-81` (kuyruk), eşzamanlı yol `:102-` |

**Taslak ↔ gönderilen mesaj bağı YOK [KOD]:** istemci yalnız `{body, aiAssisted, requestId}` gönderir (`conversation-thread.tsx:278`);
taslağın kimliği yoktur (yalnız misafir mesajındaki `aiSuggestedReply` metni, her "AI öner"de üzerine yazılır `ai-suggest/route.ts:218-225`,
saklamada silinir `data-retention.ts:376`). Çeviri açıksa misafire giden `body` çevrilmiş metindir, ev sahibinin yazdığı özgün metin yalnız
`claimBody` olarak çift-gönderim kalkanına gider (`reply/route.ts:75-101`) ve SAKLANMAZ.

### 1.3 Gömme (embedding) altyapısı [KOD]

| Konu | Bugün | Yer |
|---|---|---|
| Sağlayıcı | OpenAI `/v1/embeddings`, anahtar `OPENAI_API_KEY`; asla fırlatmaz, kısmi sonuç yok, `index` ile sıra, L2 normalize | `src/lib/ai/embeddings/provider.ts:1-36,232-393` |
| Model | varsayılan `text-embedding-3-small`; env `OPENAI_EMBEDDING_MODEL`; `large` 1536'ya kısaltılmış ölçümde Türkçe parafraz 77→83/111, Türkçe dışı 76→93/111; fiyat small $0,02 / large $0,13 (1M token) | `embeddings/model.ts:7-30` |
| Boyut | 1536 SABİT; başka boyut reddedilir + alarm | `provider.ts:53,344-349` |
| Toplu çağrı | ≤64 metin, metin ≤8.000 karakter, toplam bütçe 9 sn (sıcak yol 1,5 sn) | `provider.ts:64,70,80`; `semantic-retrieval.ts:46` |
| Depolama | YALNIZ süreç belleği (LRU 4.096 parça ≈ 25 MB); her yeniden başlatmada yeniden ısıtma; saatlik 2.000 metin tavanı | `semantic-retrieval.ts:48-55,81-147` |
| Kalıcı tablo | YOK — E2 onay paketi (`KbChunkEmbedding`, `Bytes`, `contentHash`, pgvector YOK — 300 parçada kaba kuvvet 1,37 ms) UYGULANMADI | `docs/ONAY-E2-embedding-vektor-tablosu-2026-09-12.md:1-80` |
| Tek izinli çağıran pini | `ALLOWED_PRODUCTION_IMPORTERS = ["src/lib/ai/embeddings/semantic-retrieval.ts"]` — yeni çağıran testi kırar, BİLİNÇLİ eklenir | `tests/unit/embeddings-provider.test.ts:158-171` |
| Eşik | modele göre: large 0,25, diğer 0,4 (`hasEvidence` yüklemi; mutlak "≥%80" alaka eşiği ölçülüp REDDEDİLDİ) | `retrieval/semantic.ts:68-70`; `docs/claude/retrieval.md:40-41` |
| KVKK ilkesi (E2 §3) | "Misafir mesajı SAKLANMAZ — sorgu vektörü anlıktır" | `ONAY-E2…:66-80` (kural `:77`) |

**L1 için anlamı:** (a) kalıcı vektör deposu bugün yok — "bütün mesajlar dizinlensin" yeni tablo ister; (b) misafir SORUSUNUN vektörünü
saklamak E2'nin 3.2 kuralını DEĞİŞTİRİR → açık kurucu onayı + aydınlatma (↓§2.6, [SORU 5]); (c) yeni gömme çağıranı mimari pini
bilinçli günceller; (d) gömme yalnız SIRALAR / aday üretir, "doğruluk kanıtı" değildir (retrieval.md "Retrieval politika DEĞİLDİR" `:142`).

### 1.4 Ölçek (prod yedeği 09-19, CLAUDE.md "Yedek") + maliyet [TAHMİN]
- 9 işletme · 11 mülk · 1.329 konuşma · 17.462 mesaj. Giden mesajların ~%40'ı, onların ~%60'ı insan ev sahibi varsayımıyla ≈ 4.000 ev
  sahibi mesajı → 12 sa kuralıyla ≈ 2.500–3.500 çift [TAHMİN; Railway açılınca tanılama sorgusuyla ölçülür].
- Çift başına iki vektör (maskeli soru ≤300 + maskeli cevap ≤600 karakter; Türkçe ≈ 3 karakter/token [TAHMİN]) ≈ ortalama 100–300 token.
  3.500 çift × 300 token ≈ 1,05M token → **small ≈ $0,02 · large ≈ $0,14 tek sefer**; artımlı: günde onlarca çift → sent altı.
- Depolama: vektör 1536 × 4 B = 6.144 B; iki vektör ≈ 12,3 KB/çift → 3.500 çift ≈ **43 MB** (+ metin ≈ 3 MB). Bin müşteri ölçeğinde
  (müşteri başına ~4.000 çift) ≈ 49 GB → o ölçekte `dimensions` 512 / float16 / yalnız soru vektörü kararı gerekir (bugün değil).
- Sorgu: mülk başına küme temsilcisi ≈ yüzlerce satır × 6 KB (yalnız soru vektörü) ≈ 1–3 MB okuma + kaba kuvvet kosinüs <2 ms; süreç içi
  LRU (mülk + parmak izi anahtarlı) ile tekrar okuma yok.

---

## 2. L1 veri modeli + migration + geri doldurma + artımlı dizin + KVKK

### 2.1 Neden kopya + vektör tablosu (önceki "canlı satırdan oku" ilkesinden bilinçli sapma)
- Önceki ilk dilim (6-ilke §C1 `:194-203`) kopya tutmuyordu: saklama / silme kendiliğinden işliyordu. Ama (a) gömme vektörü bir yerde
  durmak zorunda ve vektör metnin türevidir; (b) "güven zamanla azalsın" + "daha güncel kazanır" çevrimdışı KÜMELEME ister (sorgu anında
  yüzlerce çifti yeniden maskelemek + kümelemek sıcak yola CPU yükler; kalem başına saat okuyucusu dersi `kalici-urun-kararlari.md:137-142`);
  (c) "bütün mesajlar" 540 gün / 6.000 mesaj tavanını (`service.ts:66-68`) aşar.
- Bedel: türev metin + vektör için AÇIK yaşam döngüsü (↓2.6) — `HistoryLearnDraft` emsali (`scrub-scope-parity.test.ts:240-257` "silinerek
  temizlenen türev metin modelleri").
- **Çift mi, tek cevap mı → ÇİFT.** Yeni misafir sorusunu ESKİ SORUYLA eşlemek en güçlü sinyal (soru ↔ soru benzerliği); yalnız cevabı
  dizinlemek "Evet, var." gibi cevapların konusunu kaybettirir (Codex ilke 1 "mesajı bağlamından koparma", 6-ilke `:31-59`). Cevap vektörü
  ayrıca tutulur: "aynı şey farklı yazılmış mı" kararı cevap ↔ cevap benzerliğidir (§3.3).
- **Maske:** mevcut `maskForLearning` (`mask.ts:329-331`: ad → `{isim}`, kapı / kutu / kilit kodu, e-posta, telefon, IBAN, TC, pasaport, kart,
  ayraç taklidi; maske ÖNCE kırpma SONRA) + konuşma başına ad listesi `guestNamesForConversations` (`service.ts:530-549`). Wi-Fi şifresi
  GİZLENMEZ (bilginin kendisi; sır kapsamı getirmede uygulanır ↓3.6-2).

### 2.2 Şema önerisi (migration `M-gecmis-dizin`, numara yazılırken — `docs/MIGRATION-MANIFEST.md` 74+ faz-2 paketleriyle sıralanır)
Yalnız YENİ tablo (dolu tabloya dokunulmaz; Organization / Property / Conversation'a yalnız Prisma geri-ilişki alanı, DB kolonu YOK).

```prisma
/// L1 (kurucu 10-17): BU DAİRENİN geçmiş ev sahibi cevap dizini. Satır = cevapsız misafir bloğu ↔ ev sahibi İNSANININ cevabı.
/// Tek yazıcı `lib/host-history/indexer.ts`, tek okuyucu `lib/host-history/select.ts`. Metin MASKELİ kopyadır (vektörün kaynağı);
/// misafir silmesi + saklama süpürgesi SİLER (türev sınıf). Yazıcı anahtarı `HOST_HISTORY_INDEX_ENABLED` KAPALI.
model HostAnswerEvidence {
  id                     String    @id @default(cuid())
  organizationId         String
  propertyId             String
  conversationId         String
  /// İlk cevap mesajının kimliği — çift başına tekil anahtar (yeniden dizinleme ikinci satır açmaz).
  answerKey              String
  questionMessageIdsJson String
  answerMessageIdsJson   String
  askedAt                DateTime
  answeredAt             DateTime
  /// host | host_edited_ai (kapalı küme). host_edited_ai: L4 — `answerMasked` YALNIZ ev sahibinin değiştirdiği cümleler.
  authorship             String
  /// fact | device_fix (kapalı küme; dışlanan türler SATIR OLMAZ — yalnız sayaç ↓IndexState)
  kind                   String
  /// pre_booking | pre_arrival | in_stay | post_stay | unknown — sorunun yazıldığı anda konaklama evresi
  stayPhase              String
  /// resolved | unresolved | unknown — cevaptan sonraki misafir mesajı (kelime ağı, LLM'siz; ↓§3.5)
  outcome                String    @default("unknown")
  /// panel (bizim gönderim yolumuzdan, teslim kanıtlı) | channel_host (kanal rolü "host") | unproven (rol yok / unknown) — Kip B şartı
  provenance             String
  questionMasked         String    // maskForLearning → ≤300 karakter (maske ÖNCE, kırpma SONRA)
  answerMasked           String    // maskForLearning → ≤600 karakter
  topicsJson             String    @default("[]") // topicsOf + kelime ağı kategori ipucu (YALNIZ ipucu, dışlayıcı değil)
  valuesJson             String    @default("[]") // güçlü değer belirteçleri (kb-overlap `foldedValues`): şifre / ağ adı / ücret / sayı
  /// Çevrimdışı küme: aynı soru. Halef = aynı kümede DAHA YENİ ve FARKLI değerli/anlamlı cevap (en yeni kazanır).
  clusterId              String?
  supersededById         String?
  /// Aynı kümede bu satırla UYUŞAN daha eski cevapların cevap anları (JSON, en çok 5) — pekiştirme (↓§3.2)
  agreeAnsweredAtJson    String    @default("[]")
  /// Ev sahibinin kaynak kutusundaki işareti: valid | outdated (outdated getirmeye girmez; valid tazeliği yeniler ↓§3.3)
  hostVerdict            String?
  hostVerdictAt          DateTime?
  embeddingModel         String?
  questionVector         Bytes?    // Float32 × 1536 = 6.144 B; NULL = henüz gömülmedi (o mülkte anlamsal puan YOK — yarım harita yok)
  answerVector           Bytes?    // kümeleme / çelişki için
  contentHash            String    // SHA-256(model + questionMasked + answerMasked): metin ya da model değişince yeniden gömülür (E2 §2)
  createdAt              DateTime  @default(now())
  updatedAt              DateTime  @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  property     Property     @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@unique([propertyId, answerKey])
  @@index([propertyId, supersededById, answeredAt])
  @@index([conversationId])
  @@index([organizationId])
}

/// Mülk başına dizin durumu (imleç + geri doldurma + ölçüm; metin YOK).
model HostAnswerIndexState {
  propertyId        String    @id
  organizationId    String
  cursorAt          DateTime?           // bu andan önce YERLEŞMİŞ çiftler dizinlendi
  backfillStartedAt DateTime?
  backfillDoneAt    DateTime?
  leaseUntil        DateTime?           // tek yürütücü (CAS kira; HistoryLearnRun deseni)
  mode              String    @default("draft") // draft (Kip A) | auto (Kip B) — daire başına, ev sahibi bir kez seçer (§4, SORU 1)
  pairCount         Int       @default(0)
  vectorCount       Int       @default(0)
  embedTokens       Int       @default(0)
  excludedJson      String    @default("{}") // tür başına dışlanan sayısı: ai_echo · stay_decision · attempt · no_info · door_code · injection · undelivered · anon
  errorCode         String?
  updatedAt         DateTime  @updatedAt

  property Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  @@index([organizationId])
}
```

SQL taslağı (özet; gerçek dosya `prisma migrate diff --from-migrations … --to-schema-datamodel … --shadow-database-url …/shadow --script`
ile üretilir, taze PG'de sıfır fark doğrulanır — CLAUDE.md "Migration ZORUNLU"): `CREATE TABLE "HostAnswerEvidence" (…, "questionVector"
BYTEA, "answerVector" BYTEA, …)`; `CREATE UNIQUE INDEX … ("propertyId","answerKey")`; üç dizin; FK'ler `ON DELETE CASCADE`;
`CREATE TABLE "HostAnswerIndexState"`. Dolu tabloya `@unique` / zorunlu kolon / drop YOK → açılışta patlama riski yok.

### 2.3 Hangi mesaj satır olur (yazarlık + içerik kapısı — dizinleyicide, getirmede İKİNCİ kez)
Eşleştirme `buildLearnPairs` (`pairs.ts:86-144`) ile AYNI kurallar (12 sa `kb-from-history.ts:238`, peş peşe ev sahibi mesajı tek cevap, yapay
zekâ bloğu tüketir, karışık dizi düşer, K7 / L5 şablon bloğu tüketmez, "sorunlu" konuşma dışarıda) + şu dışlamalar (her biri pinli):

| # | Dışlanan | Kural (mevcut fonksiyon) |
|---|---|---|
| D1 | Yapay zekâ cevabı | `aiAssisted` · `authorType` ai · NULL satırda sihirli ad "GuestOps AI"/"Lixus AI" (`kb-from-history.ts:150-161`; ⚠️ "GuestOps AI" dizgesi DEĞİŞTİRİLMEZ, yalnız okunur) |
| D2 | Bizim / kanalın otomasyonu | `authorType` automation (K7) · `channelSenderRole` automation (L5) (`message-author.ts:43-45,87-89`) |
| D3 | **Taslağa bağlı DEĞİŞTİRİLMEMİŞ gönderim / cümle** (YENİ, L4) | `AiReplyDraft.sentMessageId = m.id`: `unchanged` → satır yok; `light` / `rewrite` → yalnız ev sahibinin içerikçe dokunduğu / eklediği cümleler (`host_edited_ai` / `host`), aynen kalan yapay zekâ cümlesi HİÇ (§5.4) |
| D4 | Bağsız yankı (eski satır / başka yüzey) | yankı sezgiseli `echoesAiDraft` (`pairs.ts:57-68`) AYNEN — bağ yoksa tek savunma |
| D5 | Teslim edilmemiş | kuyruk satırı var, hiçbiri `sent` değil (`service.ts:581-589`); `pending/ambiguous` iken çift YERLEŞMEMİŞ sayılır, 7 gün sonra vazgeçilir |
| D6 | Anonim / boş gövde | `ANON_BODY` (`data-retention.ts:36`) |
| D7 | Konaklama kararı | misafir bloğu niyeti ∈ {early_checkin, late_checkout, refund, complaint, human_request, early_departure} (Bacak B gerekçesi `kb-from-history.ts:35-44`) · cevapta `TIME_BOUND_RE` / `ONE_OFF_RE` (`extract.ts:222-234`) · açık tarih (`resolveGuestDates`, `ai/date-resolution.ts:211`) · ödeme / platform dışı (`namesPaymentMethod`, `mentionsOffPlatform`) |
| D8 | Deneme | `TENTATIVE_RE` (`extract.ts:237-238`) · `outcome = unresolved` (↓§3.5) |
| D9 | "Bilgi yok" | `NO_INFO_RE` (`extract.ts:239-240`) · `admitsMissingKnowledge` |
| D10 | Kapı / kutu kodu | maskeden sonra `(kod gizlendi)` izi ya da `hasLockContextCode` (`mask.ts:268-271`) → çift DÜŞER (başka konaklamanın kodu) |
| D11 | Enjeksiyon | misafir metninde `detectPromptInjection` (`fallback.ts:1927`), cevapta `detectKbInstructionHijack` (`:2031`) |

Dışlanan türler SATIR OLMAZ (veri en aza indirme — kullanılmayacak metin / vektör saklanmaz); yalnız `excludedJson` sayacı. Getirmede
yazarlık + tür + sır kapsamı YENİDEN koşar (dizinleyicinin hatası tek savunma olmasın).

### 2.4 Geri doldurma ("ilk başta bütün mesajlar") — kurucu onay noktası
- **Kapsam:** mülkün BÜTÜN konuşmaları (540 gün / 6.000 tavanı YOK), konuşma konuşma sayfalı (`(createdAt,id)` sırası, 1.000 mesajlık sayfa).
  Saklama süresi geçmiş (anonim) misafir mesajı çift kuramaz → fiilen son ~24 ay (`DATA_RETENTION_MONTHS=24`, CLAUDE.md canlı tablo).
- **İki aşama:** (1) metin + yazarlık + tür + küme (LLM'siz, ücretsiz) → satırlar hemen sözcüksel getirmeye hazır; (2) gömme (ücretli) ayrı
  bütçeyle: `HOST_HISTORY_EMBED_TEXTS_PER_HOUR` (öneri 4.000; KB ısıtmasının 2.000'i `semantic-retrieval.ts:55` ile ayrı sayaç).
- **Onay:** işletme listesi anahtarı `HOST_HISTORY_BACKFILL_ORG_IDS` (DURABLE_OUTBOX_ORG_IDS deseni) — önce kurucu org. Operatör sayfasında
  KURU KOŞU: çift sayısı + tahmini token + tahmini $ (small/large) → "Başlat". Railway kapalıyken prod'da koşmaz; yerel demo veriyle prova.
- Gömme çağıranı yeni modül (`lib/host-history/vectors.ts`) → `ALLOWED_PRODUCTION_IMPORTERS`e BİLİNÇLİ ekleme (`embeddings-provider.test.ts:163`),
  `embedTexts(…, { quiet: true })` (arka plan; kalıcı arıza geçiş alarmı sağlayıcıda zaten var `provider.ts:383-388`).
- Model: satır `embeddingModel` taşır; sorgu vektörü aynı modelle (KB ile aynı model ise sağlayıcı LRU'su `provider.ts:106-148` aynı sorgu
  metnini ikinci kez ÖDEMEZ). "İyi embedding" için öneri: `text-embedding-3-large` (ölçülmüş kazanç `model.ts:11-16`; özellikle başka dilde
  sorulmuş eski soru ↔ Türkçe yeni soru) — [SORU 5].

### 2.5 Artımlı dizin (yeni mesaj)
- **Yerleşme kuralı:** çift ancak (a) cevaptan sonra yeni misafir mesajı geldiyse ya da (b) son cevap mesajı ≥30 dk eskiyse VE (c) cevap
  mesajları teslim edildiyse (D5) yazılır — ev sahibi cevabını iki mesaja bölerse yarım cevap dizinlenmez.
- **Tetik:** zamanlanmış senkron (`scheduled-sync.ts:881-882` "hourly" emsali; burada her turda en çok N mülk, kira CAS'ı) + panelden ev
  sahibi gönderiminden sonra en iyi çaba "bu konuşmayı yeniden hesapla" (yanıtı bekletmez).
- **Konuşma düzeyinde yeniden hesap (idempotent):** imleçten sonra mesajı olan her konuşmanın çiftleri baştan kurulur → `(propertyId,
  answerKey)` upsert; artık üretilmeyen çift (birleştirme, geç gelen ikinci cevap mesajı, anonimleştirme) SİLİNİR. Sonra yeni / değişen
  satırlar gömülür, sonra küme güncellenir (yalnız yeni satır × o mülkün temsilcileri — ikinci dereceden toplu karşılaştırma YOK; olay
  döngüsü her 50 satırda bırakılır).
- **Silme yarışı (Opus HL4 F7 dersi, `erasure.ts:617-622`):** yazma işlemi kaynak mesajları işlem İÇİNDE yeniden okur; herhangi biri
  `ANON_BODY` ya da yoksa satır YAZILMAZ (bellekteki eski metin geri yazılmaz).

### 2.6 KVKK — saklama · silme · dışa aktarma · birleştirme (hepsi pinli)
| Yüzey | Ne yapılır | Pin |
|---|---|---|
| Saklama (m.7) | `anonymizeOldGuestData` konuşma partisinde `hostAnswerEvidence.deleteMany({conversationId in convIds})` (+ öksüz dal; `RETENTION_MESSAGE_AGE_ANCHOR` açıkken `askedAt < cutoff`) | `scrub-scope-parity.test.ts:245-257` DELETE_ONLY listesine `hostAnswerEvidence` (+ L4 `aiReplyDraft`) |
| Misafir silmesi (m.11) | `erasure.ts:598-627` bloğunda aynı silme + o mülkün dizin kirası iptal (yoldaki yürütücü yazamaz) | aynı pin + gerçek PG entegrasyonu |
| Dışa aktarma | `HostAnswerEvidence`, `HostAnswerIndexState` → EXCLUDED ("türev; kaynağı mesajlar dökümde" — `HistoryLearnDraft` emsali `data-export-coverage.test.ts`) | sınıflandırma testi |
| Konuşma birleştirme | `scripts/apply-conversation-dedupe.ts:104-123` `HANDLED_REFERENCES.repoint`e ekle + mülkü yeniden kümelemeye işaretle (DMMF envanteri yeni `conversationId`'de fail-closed durur) | envanter testi |
| Hesap / mülk silme | FK Cascade | — |
| Öksüz satır | kaynak mesajı kalmayan satır saatlik süpürgede silinir (`service.ts:452-454` emsali) | entegrasyon |

- **Yeni veri sınıfı (açık söyleyelim):** maskeli MİSAFİR SORUSUNUN kopyası ve VEKTÖRÜ saklanır. E2 paketinin "misafir mesajı saklanmaz"
  kuralını (`docs/ONAY-E2-embedding-vektor-tablosu-2026-09-12.md:77`) bu tablo için değiştirir. Vektörden metnin kısmen geri kurulabildiğine dair yayımlanmış araştırma var (genel
  bilgi, bu oturumda doğrulanmadı) → vektör de metinle AYNI sınıf: aynı anda silinir, dışa / eğitime gitmez.
- **Aydınlatma metni (avukat paketi):** "Önceki misafir yazışmalarınız ad / telefon / e-posta / kod maskelenerek aynı dairenin yeni
  misafirlerine cevap TASLAĞI hazırlanmasında kullanılır; bu amaçla maskeli metin ve sayısal özeti (vektör) en çok saklama süresi boyunca
  tutulur, silme talebinizde silinir." — 6-ilke §C6'daki açık soruyla (`:265-266`) birleşir.
- Kalan risk: maske kişi adlarını yalnız BİLİNEN misafir adlarından tanır (üçüncü kişi adları bilinen sınır `kb-from-history.ts:202-203`);
  kopya ≤300/≤600 karakterle asgari.

---

## 3. "Güven zamanla azalsın" + "daha güncel kazanır" + bilgi tabanıyla çakışma

### 3.1 Tazelik: üstel yarı ömür
`r(Δ) = 2^(−Δ / H)`, Δ = bugün − `answeredAt` (gün; ev sahibi "hâlâ geçerli" dediyse `max(answeredAt, hostVerdictAt)`), **öneri H = 120 gün**.

| Cevabın yaşı | H=60 | **H=120 (öneri)** | H=180 |
|---|---|---|---|
| dün | 0,99 | **0,99** — "neredeyse kesin" | 1,00 |
| 1 hafta | 0,92 | **0,96** | 0,97 |
| 1 ay | 0,71 | **0,84** | 0,89 |
| 3 ay | 0,35 | **0,59** | 0,71 |
| 6 ay | 0,13 | **0,35** | 0,50 |
| 1 yıl | 0,02 | **0,12** — "zayıf" | 0,25 |
| 18 ay | 0,00 | **0,04** (gösterilmez) | 0,12 |

H=120 kurucunun iki çapasına ("dün neredeyse kesin", "1 yıl zayıf") uyar ve 18 ayı fiilen düşürür (saklama 24 ay zaten siler). Değer türüne göre
ayrı yarı ömür (Wi-Fi / şifre / ücret daha hızlı) ölçümden sonra — [SORU 3].

### 3.2 Pekiştirme: aynı cevabı farklı misafirlere yazmak güveni artırır
Küme temsilcisi (en yeni) r₀, aynı kümede UYUŞAN daha eski cevaplar r₁…r_k (farklı konuşmalardan, k ≤ 5):

`güven = 1 − (1 − r₀) · Π (1 − ½·rᵢ)` (gürültülü-VEYA; eski uyuşan cevap YARIM ağırlıkla — tazeliği yine yaşına göre)

Örnekler: tek cevap 1 yıl önce → 0,12 · 4 ay önce + 5/6/8 ay önce uyuşan üç cevap → 1 − 0,50·0,79·0,82·0,89 ≈ **0,71** · tek cevap dün → 0,99.
Etiket: **güçlü ≥ 0,60 · orta 0,30–0,60 · zayıf 0,10–0,30 · < 0,10 gösterilmez** (tek cevapta güçlü ≈ son 88 gün, orta ≈ 208 gün, zayıf ≈ 399 gün).
Bu bir ALAKA eşiği DEĞİL (mutlak alaka eşiği ölçülüp reddedildi, `retrieval.md:40-41`); alaka `hasEvidence` yüklemiyle ayrı verilir (↓3.6).

### 3.3 Küme ve "aynı şey farklı yazılmışsa daha güncel kazanır" (çevrimdışı, dizinleyicide)
- **Aynı soru mu:** aynı mülk ∧ soru vektörleri kosinüsü ≥ τ_q (öneri large 0,70 / small 0,80 — [TAHMİN], ücretsiz önbellekli setle ayarlanır) ∧
  konu kesişimi (`topicsOf`, `conversation-items/relation.ts:58`; dar kategoride kategori yeter — `kb-overlap.ts:36,86-92` kuralı). Vektör yoksa
  yalnız konu + kategori ipucu + değer kesişimi (L2 `sameTopic` aynısı).
- **Cevaplar uyuşuyor mu:** değer belirteçleri (`kb-overlap.ts:46-52` `foldedValues`): eskinin değerlerinin hepsi yenide → **uyuşur**; iki
  tarafta da diğerinde olmayan değer → **farklı** ("lale2024" ↔ "yeni2025"); değer yoksa cevap vektörü kosinüsü ≥ τ_a (öneri 0,85
  [TAHMİN]) → uyuşur, değilse farklı.
- **Karar:** temsilci = en yeni (eşitlikte kimlik). Uyuşan eski → `agreeAnsweredAtJson`. Farklı eski → `supersededById = temsilci` (modele
  GİTMEZ; ev sahibine kaynak kutusunda "eskiden farklı yazmıştınız" diye gösterilebilir). Bu, L2'nin "eski değer bir daha önerilmesin"
  kuralının (`kb-overlap.ts:132-155`) dizindeki karşılığıdır.
- **Yakın çelişki:** temsilci ile farklı bir eski cevap arasında ≤ 7 gün varsa (iki misafire iki farklı şey) küme `conflict` → Kip A'da ikisi
  tarihli + istem notu "ÇELİŞKİ: kesin söyleme" (6-ilke §C3 `:243-244`); Kip B o kümeyi HİÇ kullanmaz.
- Ev sahibi kaynak kutusunda "Bu artık geçerli değil" → `hostVerdict = outdated` (küme tamamen düşer); "Hâlâ geçerli" → `valid` (tazelik
  `hostVerdictAt`ten sayılır). Tek tık, ZORUNLU DEĞİL ("sürekli onay istemesin").

### 3.4 Bilgi tabanıyla çakışma — bilgi tabanı kazanır, ama eskimiş bilgi tabanı sessiz kalmaz
- **Getirmede:** aynı alt sorgu bilgi tabanında kanıtlı kalem bulduysa o alt sorgunun geçmiş adayı İSTEME GİRMEZ (6-ilke §C3 `:241-242`);
  ayrıca istemdeki bir KB kalemiyle aynı konu (L2 `kbOverlaps` kuralı) → aday düşer. Mülk alanıyla (giriş / çıkış saati) çelişen geçmiş
  cevap düşer (`time-fields.ts` tek kaynak; DEĞERLENDIRME 09-11 kural 1 `docs/DEGERLENDIRME-2026-09-11-gecmis-cevap-yeniden-kullanimi.md:34-40`).
- **Eskimiş bilgi tabanı işareti (öneri):** düşen aday KB kalemiyle `differs` VE `answeredAt > kalem.updatedAt` ise (ev sahibi bilgi tabanını son
  düzenledikten SONRA misafire farklı bir şey yazmış) → taslağa GİRMEZ, ama "AI öner" panelinde tek kart: "Bilgi tabanınız: 'Wi-Fi şifresi
  eski2025' (Mart) · Dün bir misafire: 'yeni2026' → [Bilgi tabanını güncelle] [O misafire özeldi]". "Güncelle" = L2 "eskisinin yerine koy"
  (`service.ts:698-745`) → kurucunun L2 kararı ("güncel olanı seçince o artık doğru sayılsın"); "özeldi" = `hostVerdict outdated`, bir daha
  sorulmaz. Alternatif (yeni geçmiş cevap kendiliğinden kazanır) → [SORU 2].

### 3.5 Sonuç sinyali (LLM'siz, "milyar dolarlık" kısmın ucuz yarısı)
Cevaptan sonraki 48 saat içindeki ilk misafir mesajı: arıza sürüyor (`faultSignal`, `relation.ts:1366`) → `unresolved` (çift D8 ile düşer — "denendi,
işe yaramadı"); düzelme ifadesi (`relation.ts:1321-1330` FAULT_RESOLVED; soru / sanı ayıklamasıyla) → `resolved`; diğer → `unknown`. Yalnız
`device_fix` türünde okunur.

### 3.6 Getirme hattı ("AI öner", Kip A) — tek okuyucu `lib/host-history/select.ts`
1. **Aday SQL:** `propertyId = konuşmanın mülkü ∧ organizationId = oturum ∧ conversationId ≠ bu konuşma ∧ supersededById IS NULL ∧
   hostVerdict IS DISTINCT FROM 'outdated' ∧ kind IN (fact, device_fix) ∧ authorship IN (host, host_edited_ai)`. Başka mülk ASLA (aynı
   fiziksel daire iki mülk satırıysa ikizi gelmez — güvenli yön, 6-ilke `:231-232`).
2. **Sır kapsamı bu konaklamaya göre:** her aday sözde KB kalemi `{category: konu ipucu, title: questionMasked, content: answerMasked}` olarak
   `kbForStayScope` (`guest-chat.ts:722-729`) + `withoutSecretKbItems`ten geçer → onaysız / rezervasyonsuz konuşmada Wi-Fi / giriş adayı yok.
3. **Alt sorgular** `retrievalQueries` (`retrieval/select.ts:470`, KB ile tek kaynak). Sözcüksel: mevcut modelsiz motor (BM25 + kök + 3-gram)
   sözde kalemlerle; anlamsal: KB adımının ZATEN gömdüğü sorgu metinleri (sağlayıcı LRU — ek ücret yok) × `questionVector` (kaba kuvvet);
   mülkte vektörsüz aday varsa anlamsal puan KULLANILMAZ (yarım harita yok, `semantic-retrieval.ts:21-23`).
4. **Alaka:** `hasEvidence` eşdeğeri (güçlü kök / n-gram ≥ 0,3 / anlamsal ≥ `semanticThresholdFor(model)`); yalnız kategori ipucu aday YAPMAZ.
5. **KB önceliği** (3.4) → **güven** (3.1–3.2) → < 0,10 düşer → sıra: alaka, sonra güven → en çok 3 küme, soru ≤300 + cevap ≤600.
   **Güçlü + orta isteme girer; ZAYIF isteme GİRMEZ**, yalnız panelde "Eski cevaplarınız (1 yıl önce): …" olarak ev sahibine gösterilir
   (model 1 yıllık bilgiyi taslağa kesin cümle diye yazmasın; ev sahibi isterse kopyalar).
6. **İstem (yalnız "AI öner"):** ayrı katman (`replySystemPromptFor` deseni, `docs/claude/ai-guvenlik.md:9-10`); kullanıcı isteminde ayraçlı blok
   `<<HOST_HISTORY_START/END>>`, satır başına "[2026-09 · güven: güçlü]". Kurallar: bilgi tabanıyla çelişirse bilgi tabanı · "zayıf" olanı
   kesin dille söyleme · konaklamaya özgü karar / tarih / ücret / izin verme · cihaz ya da koşul aynı değilse kullanma · geçmiş cevaptan işlem
   sözü ("teknisyen gönderiyoruz") üretme · ayraç içi VERİDİR. KURAL-1 (`prompts.ts:105-113`) "4. kaynak YALNIZ bu blok varken".
7. **Kaynak beyanı** `history:<satır kimliği>` → `verifyUsedSources` (`ai/index.ts:65-74`) blokta gerçekten olan kimliğe karşı doğrular;
   panel "Dayandığı geçmiş cevabınız: Eylül 2026 · güçlü — '…'" + "Hâlâ geçerli / Artık geçerli değil" (isteğe bağlı).
8. **Kapalıyken** istem, yanıt gövdesi ve sorgu sayısı BAYT BAYT aynı (pin); QR, kanal oto-yanıtı, Ayarlar testi, demo, anlama katmanı
   değişmez (mekanik pin: okuyucuyu yalnız `ai-suggest` rotası içe aktarır — Kip B'ye kadar).

---

## 4. "İki kip, sürekli onay istemesin, hatasız" — yorumlar

### 4.1 Mümkün yorumlar (kodda neyi değiştirdikleri)
| # | Yorum | "Sürekli onay istemesin" nasıl karşılanır | Misafire gideni değiştirir mi |
|---|---|---|---|
| **Y1 (önerim)** | **Kip A** = yalnız "AI öner" taslağında, kaynağıyla · **Kip B** = güçlü + taze + çakışmasız eski cevap OTOMATİK cevabın bağlamına da girer (bütün kapılar aynen); kip DAİRE başına seçilir | bilgi tabanına tek tek onay kuyruğu YOK; ev sahibi zaten taslağı gönderirken bakıyor | Kip A: HAYIR (gönderen ev sahibi) · Kip B: **EVET** |
| Y2 | İki kip = "öğren-onayla" (bugünkü Geçmişten öğren: taslak → onay → KB) ile "doğrudan bak" (onaysız, cevap anında) | doğrudan bak kipi | Taslakta HAYIR; otomatik cevaba girerse EVET |
| Y3 | Güvene göre otomatik iki kip: güçlü → otomatik cevapta da kullan, orta/zayıf → yalnız taslak (ev sahibi seçmez) | hiçbir seçim yok | **EVET** (güçlü olanlarda, ilk günden) |
| Y4 | Gölge → canlı: önce yalnız ölç (hiçbir yüzeyde görünmez, kayıt), sonra aç | — | Gölgede HAYIR |

"Hatasız" kelimesi kelimesine mümkün değil; tasarım hedefi **fail-closed**: şüphede geçmiş cevap kullanılmaz (bilgi tabanı kazanır, çelişkide
küme düşer, zayıf isteme girmez, konaklamaya özgü / deneme / kod / sır satır bile olmaz). Y1'de Kip B'ye geçmeden Y4'ün gölge ölçümü İÇ adım
olarak koşar (hangi misafir mesajlarında Kip B devreye girerdi + kapı sonucu — hiçbir şey gönderilmez).

### 4.2 Kip B'nin ek şartları (Kip A'dan SIKI)
- Yalnız kanal oto-yanıtı; **QR asla** (misafir dairede; ayrı karar).
- güven ≥ 0,60 · küme `conflict` değil · bilgi tabanında aynı konu yok · mülk alanıyla çelişki yok.
- **`kind = fact` yalnız; `device_fix` ASLA** — kurucu kuralı "BOZUKLAR İÇİN BİLGİ TABANINDA YAZMAYAN ÖNERİLER VEREMEZ"
  (`KURUCU-SORULARI.md:309-359`); arıza adımı kapısı (`relation.ts:1131-1145` `fixSupportContextOf` / `fixSupportHolds`) geçmiş cevabı DESTEK SAYMAZ (pin).
- Değer taşıyan cevap (ücret / saat / sayı) yalnız ≥2 farklı konuşmada uyuşmuşsa VE en yenisi ≤ 90 gün; **Wi-Fi / giriş / kod konusu hiç**
  (bilgi tabanının işi; sır kapısı).
- Kanıt kökeni `panel` ya da `channel_host` (rolü bilinmeyen eski senkron satırı Hospitable şablonu olabilir — L5 sınırı `message-author.ts:66-69`,
  Q2-c `KURUCU-SORULARI.md:773-775`).
- Bütün kapılar aynen (`passesAutoReplySafetyGate`, iddia / müsaitlik vetosu, konuşma öğeleri, "bilgim yok", kapanış…); misafir mesajının
  `aiSourcesJson`ına `history:<id>` (denetim izi).

### 4.3 Kurucu sorusu (biçim: bunu böyle yapıyorum · büyük şirketler · önerim · ÖRNEK · böyle yapalım mı?) → §7 SORU 1

---

## 5. L4 — az değiştirilmiş taslaktan öğrenme

### 5.1 Bugün [KOD]
- **Bağ yok:** taslağın kimliği yok; gönderim `{body, aiAssisted, requestId}` (`conversation-thread.tsx:278`); sunucu `aiAssisted`ı istemciden
  alır (`reply/route.ts:52`). Taslak metni yalnız misafir mesajının `aiSuggestedReply`ında (her "AI öner"de üstüne yazılır `ai-suggest/route.ts:218-225`;
  oto-yanıtın hazır taslağı `automation.ts:3044-3049`; saklamada silinir `data-retention.ts:376`).
- **Ters kural:** taslak sözcüklerinin ≥%60'ı cevapta → çift ev sahibi kanıtı SAYILMAZ, BÜTÜNÜYLE düşer (`pairs.ts:38-68`; kurucuya L4 sorusu
  `KURUCU-SORULARI.md:642-644`). Sonuç: ev sahibinin taslağa EKLEDİĞİ doğru cümle de kaybolur. Bacak B bu kuralı hiç bilmiyor (`kb-from-history.ts:150-161`).
- **Kullanılamayacak kaynak:** `AiGeneration.draftText/sentText` var (`schema.prisma:1633-1634`) ama (a) "AI öner" yolu yazmıyor (§1.1), (b) "EĞİTİM
  YASAĞI: okuyan modüller kapalı listede" (`generation-trace.ts:21-22`, `tests/unit/ai-generation-readers.test.ts`) → L4 kendi tablosunu kullanır.
- **Çeviri:** ev sahibinin yazdığı özgün metin saklanmaz (`reply/route.ts:75-101`) → fark gönderim anında hesaplanır, özgün metin SAKLANMAZ.

### 5.2 Bağ — yeni tablo `AiReplyDraft` (migration `M-taslak-bag`, `M-gecmis-dizin` ile aynı pakette olabilir)
```prisma
/// L4 (kurucu 10-17): ev sahibine gösterilen yapay zekâ TASLAĞI + gönderilen mesaja bağ + düzenleme farkı. Türev metin → 90 gün,
/// misafir silmesi / saklama SİLER. AiGeneration'dan AYRI (o tablo eğitim / dışa aktarma yasaklı ve "AI öner"de yazılmıyor).
model AiReplyDraft {
  id               String    @id @default(cuid())
  organizationId   String
  conversationId   String
  propertyId       String
  triggerMessageId String              // cevaplanan misafir mesajı (opak)
  source           String              // suggest | held_auto (kapalı küme)
  draftText        String              // ev sahibinin GÖRDÜĞÜ metin (hostVoiceDraft sonrası, ≤ 8.000)
  historyRefsJson  String    @default("[]") // isteme verilen HostAnswerEvidence kimlikleri (L1 ↔ L4 geri besleme)
  usedSourcesJson  String    @default("[]") // doğrulanmış kaynak beyanı (kb:… / history:…)
  sentMessageId    String?   @unique   // bu taslaktan doğan ev sahibi mesajı (bir taslak → bir mesaj)
  sentAt           DateTime?
  editClass        String?             // unchanged | light | rewrite
  changeRatio      Float?              // sözcük düzeyi düzenleme oranı 0..1
  hunksJson        String?             // MASKELİ parçalar ≤ 20 × ≤ 200 karakter: [{op, kind, from, to}] (op/kind kapalı küme)
  translated       Boolean   @default(false)
  createdAt        DateTime  @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
  @@index([propertyId, sentAt])
  @@index([organizationId, createdAt])
}
```
Ek kolon önerisi `HostAnswerEvidence.editRejectCount Int @default(0)` (taslaktan silinen geçmiş-cevap cümlesi sayacı, ↓5.4).

Akış:
1. **Yazıcılar:** `ai-suggest/route.ts` `hostDraft` hesaplanınca (`:217`) satır + yanıtta `draftId`; oto-yanıtın hazır taslağı (`automation.ts:3044`) satır
   + `prepared-draft.ts` `initialDraft`a `draftId`.
2. **İstemci:** "Taslağı kullan" / "Onayla ve gönder" → `draftOrigin = {id}`; yazma alanı boşaltılırsa, şablonla değiştirilirse
   (`conversation-thread.tsx:500`) ya da yeni öneri gelirse temizlenir. `requestId` yükü `draftId`yi de kapsar (yük-bağlı kimlik `:180-183` kuralı).
3. **Sunucu (`reply/route.ts`):** şema isteğe bağlı `draftId`; taslak `{id, organizationId, conversationId, sentMessageId: null}` ile bulunur (başka
   konuşmanın taslağı → yok sayılır, 400 DEĞİL — gönderimi bozmasın); fark `parsed.data.body` (çeviriden ÖNCEKİ özgün metin) ile hesaplanır;
   `sendHostMessage` `sent` / `queued` + mesaj dönünce CAS `updateMany({where:{id, sentMessageId:null}})`. Çift tık / yeniden deneme aynı mesajı
   döndürür → CAS etkisiz. Öğrenme yalnız TESLİM edilmiş mesajda (D5 kuralı) — kuyrukta bekleyen bağ kurulur ama tüketici teslimi bekler.

### 5.3 Ölçü — sözcük düzeyi düzenleme oranı ve parçalar
- **Belirteç:** `toLocaleLowerCase("tr")`, harf / rakam dışı ayraç (pairs.ts `wordSet` ile aynı ayraç `:51`, ama SIRALI); saat ("11:00") tek
  belirteç (doğrusal tarayıcı — düzenli ifade değil); en çok 400 belirteç / taraf (`ECHO_MAX_TOKENS` `pairs.ts:45`).
- **Fark:** belirteç dizilerinde Myers farkı (O((N+M)·D), 400 tavanla sınırlı; düzenli ifade YOK → ReDoS sınıfı dışı). `oran = D / max(N, M)`.
- **Sınıf:** `unchanged` (fark yok ya da yalnız büyük-küçük harf / noktalama / Türkçe harf katlaması — `foldTurkishAscii` eşitliği) · `light`
  (0 < oran < **0,40**, kurucu eşiği) · `rewrite` (≥ 0,40). 400 tavanı aşan metin: sınıf hesaplanır, parça ÇIKARILMAZ (bağsız davranış).
- **Parçalar (her sınıfta çıkarılır; sınıf yalnız NE öğrenileceğini belirler):** `replace` (from→to) · `insert` · `delete`; tür (LLM'siz):
  `value_fix` (iki tarafta da değer belirteci / saat — `valueTokens` `extract.ts:248-252`) · `insertion` (≥3 içerik sözcüğü eklendi) · `deletion`
  (≥3 içerik sözcüğü silindi) · `style` (yalnız katlama / noktalama / selam-kapanış / emoji) · `stay_specific` (parçanın cümlesinde
  `TIME_BOUND_RE` / `ONE_OFF_RE` `extract.ts:222-234`, açık tarih, kişisel eylem `extract.ts:300-319`, ödeme; ya da misafir niyeti D7 listesinde).
- **Örnek:** taslak "Merhaba, çıkış saatimiz 11:00'dir. İyi yolculuklar dileriz." → gönderilen "Merhaba, çıkış saatimiz 12:00'dir. İyi
  yolculuklar dileriz." → 8 belirteçte 1 değişim = %12,5 → `light`; parça `replace 11:00→12:00` `value_fix`; ev sahibinin dokunduğu cümle
  "Çıkış saatimiz 12:00'dir.".

### 5.4 Ne öğrenilir (olgu mu üslup mu) ve nereye yazılır
**Temel ilke (Codex ilke 2'nin cümle düzeyi hâli):** yapay zekânın AYNEN kalan cümlesi HİÇBİR sınıfta ev sahibi kanıtı değildir; ev sahibinin
içerik olarak dokunduğu (yalnız üslup değil) ya da eklediği cümle ev sahibi kanıtıdır. Kurucunun %40 eşiği "düzeltme" ile "kendi cevabı"nı ayırır:

| Sınıf | L1 dizinine | Düzeltme defterine (tekrar sayımı) | Misafire etkisi |
|---|---|---|---|
| unchanged (%0) | HİÇBİR şey (bugünkü `aiAssisted` dışlamasının bağlı hâli) | — | yok |
| light (<%40) | yalnız dokunulan / eklenen cümleler, `authorship = host_edited_ai` | EVET: value_fix / deletion / insertion | Kip A: yok |
| rewrite (≥%40) | dokunulan + eklenen cümleler, `authorship = host`; aynen kalan yapay zekâ cümleleri YİNE dışarıda | HAYIR (bu bir düzeltme değil, ev sahibinin kendi cevabı) | Kip A: yok |

Defterden çıkan öneriler (Dilim 3; tek onay, "sürekli onay istemesin"):
- **Tekrarlayan değer düzeltmesi:** aynı mülk + aynı konu + aynı `from→to` ≥ 2 FARKLI rezervasyonda, hiçbiri `stay_specific` değil → TEK kart
  "Taslaklarda çıkış 11:00 yazıyordu, son iki misafirde 12:00 yaptınız. [Bilgi tabanına işle] [Daire bilgisini aç] [Misafire özeldi]".
  Bilgi tabanı yolu = `HistoryLearnDraft` (çalıştırma türü `edit`, `kind` metin sütunu — migration yok) → L2 çakışma / "yerine koy" akışı
  (`service.ts:636-757`); mülk alanı (giriş / çıkış saati) ASLA kendiliğinden değişmez, form bağlantısı. "Misafire özeldi" → aynı `from→to` 180 gün
  önerilmez.
- **Tekrarlayan silme:** taslaktaki bir cümleyi ≥ 2 kez sildiyseniz ve cümle bir bilgi tabanı kalemine dayanıyorsa → "Bu bilgiyi taslaklardan
  2 kez sildiniz — bilgi tabanındaki 'Havuz' kalemi hâlâ doğru mu?" (yalnız ev sahibi ekranı). Geçmiş cevaba dayanıyorsa (`historyRefsJson` +
  değer / sözcük örtüşmesi) → o satırın `editRejectCount`ı; 2'de getirmeden çıkar.
- **Üslup:** yalnız KAPALI KÜME hazır seçenek önerisi (`instruction-presets.ts:25-50`; serbest metin talimat ÜRETİLMEZ): emojileri ≥3 kez sildiniz →
  "Emojisiz cevap"; taslakları 5'in 3'ünde %40+ kısalttınız → "Kısa cevap". Tek tık (`setPresetInstruction` `service.ts:816-847`); isteme girmesi yine
  `PROPERTY_INSTRUCTIONS_PROMPT_ENABLED`e bağlı. `host-voice.ts` DEĞİŞMEZ (deterministik devir kalıbı çevirici `:75-91`; fark ev sahibinin gördüğü
  metinle — `hostVoiceDraft` SONRASI — hesaplanır).

### 5.5 Riskler (yanlış öğrenme / kötüye kullanım)
| # | Risk | Önlem |
|---|---|---|
| R1 | Konaklamaya özgü düzeltme ("bu misafire 12:00") kalıcı olgu sanılır | `stay_specific` türü + D7 niyet listesi + ≥2 farklı rezervasyon + mülk alanı asla otomatik + "Misafire özeldi" düğmesi + L1'de mülk alanıyla çelişen satır düşer (§3.4) |
| R2 | Yapay zekânın uydurduğu olgu, ev sahibinin küçük imla düzeltmesiyle "ev sahibi kanıtı" olur | `style` parçası cümleyi "dokunulmuş" YAPMAZ (katlanmış eşitlik) |
| R3 | Kendini besleme (geçmiş cevaptan taslak → aynen gönderim → o cevap güçlenir) | `unchanged` hiçbir şey öğretmez; "yeniden doğrulandı" sayılması ayrı karar [SORU 6] |
| R4 | Yanlış bağ (şablon / başka metin yapıştırma) | şablon ve yeni öneri `draftOrigin`i temizler; tamamen yeni metin → `rewrite` → zaten ev sahibinin |
| R5 | Çeviri ile gönderim | fark çeviriden ÖNCEKİ metinle; diller farklıysa (taslak misafirin dilinde, ev sahibi Türkçe yazdı) defter KAPALI, yalnız `rewrite` kanıtı |
| R6 | Kişisel veri | parçalar `maskForLearning` (`mask.ts:329-331`) sonra kırpılır; `draftText` 90 gün; misafir silmesi / saklama SİLER (§5.6) |
| R7 | Teslim edilmeyen mesajdan öğrenme | yalnız `sent` kuyruk satırı ya da kuyruksuz teslim (`service.ts:581-589` kuralı) |
| R8 | Misafir metni zehirleme | misafir metni hiçbir sınıfta kanıt olmaz; taslak ↔ gönderilen yalnız EV SAHİBİ metni |
| R9 | Başka kullanıcı / operatör | gönderim `withManage` (`reply/route.ts:16`); bürünme salt-okunur (K8) |
| R10 | Eski hazır taslak (bağsız) | bağsız → bugünkü yankı sezgiseli (D4) |

### 5.6 KVKK (L4)
`AiReplyDraft`: `scrub-scope-parity.test.ts` DELETE_ONLY'e (`:245-257`) eklenir → misafir silmesi (`erasure.ts:598-627` bloğu) + saklama partisi +
90 günlük süpürge (`purgeOldHistoryLearnDrafts` emsali `service.ts:447-456`); dışa aktarma EXCLUDED "⚠️ KARAR (avukat): yapay zekâ taslağı —
`AiGeneration` ile aynı sınıf" (`data-export-coverage.test.ts`); konuşma birleştirmede `repoint`. Eğitim / dışa aktarma yolu YOK (AiGeneration
okuyucu pininin kardeşi: `aiReplyDraft` okuyucuları kapalı liste).

### 5.7 Mevcut ≥%60 kuralıyla ilişki
- Bağ VARSA bağ karar verir (cümle düzeyi atıf); yankı sezgiseli (`pairs.ts:57-68`) yalnız BAĞSIZ satırlar için kalır (eski satır, karar kartı,
  bağ öncesi hazır taslak). Tek fonksiyon `attributeHostSentences(message, draftLink | null)` hem Geçmişten öğren eşleştiricisi hem L1
  dizinleyicisi tarafından kullanılır (iki kopya kural olmasın).
- Pinler: bağlı + `unchanged` + 4 sözcükten kısa taslak ("Evet, var.") → kanıt DEĞİL (sezgisel `ECHO_MIN_DRAFT_WORDS` `pairs.ts:48` bunu
  kaçırırdı) · bağlı `light` → eklenen doğru cümle KORUNUR (sezgisel bütün çifti düşürürdü) · bağsız → bugünkü davranış bayt bayt aynı.

### 5.8 "Milyar dolarlık şirket çözümü" — dürüst not
Bildiğim kadarıyla (bu oturumda doğrulanmadı, genel bilgi): öneri → gönderim düzenleme oranı ve öneri kabul oranı, öneri üreten yapay zekâ
yüzeylerinin standart kalite ölçüsüdür (ör. kod tamamlama araçlarının yayımladığı "kabul oranı" çalışmaları); müşteri hizmetleri
yazılımlarında temsilci düzenlemesi doğrudan bilgi bankasına / modele YAZILMAZ — içerik boşluğu ya da öneri olarak yöneticinin önüne gelir;
kişiye özel ince ayar yerine eski iyi cevabı isteme örnek olarak koyan GETİRME yaygındır. Bu tasarım üçünü birden yapıyor: ölçü (`changeRatio`),
getirme (L1 `host_edited_ai`), tek onaylı öneri (defter). Belirli bir şirketin (Intercom, Zendesk, Hospitable, Guesty) L4'ü nasıl yaptığına dair
doğrulanmış bilgim YOK — iddia yazmıyorum.

---

## 6. Dilimleme + test planı + riskler + ReDoS

### 6.1 Dilimler (her biri ayrı commit grubu, anahtar KAPALI doğar; misafire giden yalnız Dilim 4'te değişir)

| Dilim | İçerik | Migration | Anahtar (tam "1") | Misafire / ev sahibine etki |
|---|---|---|---|---|
| **0** | SAF modüller: `host-history/decay.ts` (r, güven, etiket) · `cluster.ts` (aynı soru / uyuşma / halef — vektör girdi) · `kind.ts` (D7–D11) · `outcome.ts` · `attribution.ts` (L4 belirteç + Myers + sınıf + parça + cümle atfı) | YOK | — (çağıran yok) | yok |
| **1** | `M-gecmis-dizin` + `M-taslak-bag` (tek paket); dizinleyici (konuşma düzeyi yeniden hesap, kira, yerleşme kuralı, silme yarışı) + geri doldurma kuru koşu / başlat (operatör) + gömme doldurma (bütçeli); `AiReplyDraft` yazıcıları + `reply` rotasında `draftId` bağı; KVKK dört yüzey; mimari pin güncellemeleri | EVET | `HOST_HISTORY_INDEX_ENABLED` · `HOST_HISTORY_EMBED_ENABLED` · `HOST_HISTORY_BACKFILL_ORG_IDS` · `AI_DRAFT_LINK_ENABLED` | yok (isteme hiçbir şey girmez; yanıt gövdesi kapalıyken aynı) |
| **2** | **Kip A:** `select.ts` + istem katmanı + `verifyUsedSources` `history:` + panel kaynak kutusu + "Hâlâ geçerli / Artık geçerli değil" (yeni rota `withManage`, org kapsamlı) + eskimiş bilgi tabanı kartı (§3.4) + zayıf "eski cevaplarınız" kutusu | YOK | `HOST_HISTORY_EVIDENCE_ENABLED` | ev sahibinin taslağı değişir; misafire otomatik bir şey gitmez |
| **3** | **L4 çıktıları:** cümle atfı dizinleyiciye (`host_edited_ai`) + `pairs.ts` eşleştiricisi aynı fonksiyona · düzeltme defteri → tek onaylı kart (`HistoryLearnDraft` tür `edit` → L2) · silme işareti + `editRejectCount` · üslup → hazır seçenek önerisi | (`editRejectCount` Dilim 1 paketine konursa YOK) | `AI_DRAFT_EDIT_LEARN_ENABLED` | yalnız ev sahibi ekranı |
| **4** | **Kip B:** önce GÖLGE (oto-yanıt Kip B adaylarını + kapı sonucunu izine yazar, hiçbir şey göndermez; `AiGeneration.contextDiagnosticsJson` yalnız kimlik/sayı) → kurucuyla ilk denemeler → daire başına `mode = auto` | YOK | `HOST_HISTORY_AUTO_SHADOW` · `HOST_HISTORY_AUTO_ENABLED` | **EVET** (yalnız Kip B açılan dairede) |
| 5 | SORU 6 (yeniden doğrulama) · değer türüne göre yarı ömür · ölçek (512 boyut / float16) · QR kararı | ? | — | ölçümle |

Sıra gerekçesi: Dilim 1 olmadan Dilim 2'nin vektörü yok; Dilim 3, Dilim 1'in bağı olmadan ölçülemez; Kip B ancak Kip A'nın ölçümü + gölge sonrası.

### 6.2 Test planı (K2: `docs/TEST-EVIDENCE-CONTRACT.md` — kırmızı-önce · kaldırma + aşırı uygulama mutasyonu · gerçek PG · tam kapılar)
**Dilim 0 (birim, veritabanısız):** yarı ömür tablosu (§3.1 sayıları) · pekiştirme formülü uçları (k=0, k=5, aynı konuşmadan iki cevap = 1 sayılır) · küme
kararı (uyuşur / farklı / yakın çelişki; eşitlikte kimlik) · D7–D11 sınıflayıcı (aşırı uygulama: "tekrar deneyin" deneme DEĞİL `extract.ts:235-238`,
misafirin "yarın" demesi tek başına konaklama kararı DEĞİL, "Bu sefer de otopark ücretsiz" → `one_off` işareti tartışmalı → vaka listesine) · L4 sınıfı
(%0 / %12 / %39,9 / %40 / %57; yalnız Türkçe harf / noktalama farkı = unchanged; selam değişikliği = style) · cümle atfı (aynen kalan cümle asla
kanıt) · **süre pinleri** (`*-cost.test.ts`): belirteçleyici + Myers + sınıflayıcı 4.000–50.000 karakterlik tek sözcük / boşluk dizisi / tekrarlanan kök,
400 belirteç tavanında üst sınır.
**Dilim 1 (gerçek PostgreSQL — `tests/integration`, PG 5433; ⚠️ bu belge yazılırken KOŞULMADI):** migration taze PG'de sıfır fark · başka işletme /
başka mülk satırı ASLA (`api-route-scoping` + davranışsal; reddin SEBEBİ sınanır, #211) · geri doldurma iki kez → aynı satırlar (tekil anahtar) ·
eşzamanlı iki dizinleyici → kira tek yürütücü · D1–D11'in her biri için "satır yok" + sayaç · teslim edilmemiş kuyruk mesajı (pending → canceled)
öğrenilmez · silme yarışı (dizinleyici okudu → misafir silindi → yazma reddedilir) · saklama partisi + misafir silmesi + 90 gün süpürgesi siler ·
konuşma birleştirme `repoint` · `reply` bağı: çift tık / kuyruk tekrarında tek bağ, başka konuşmanın `draftId`si yok sayılır, çeviri yolunda fark özgün
metinle · anahtarlar kapalıyken hiçbir yazma ve `ai-suggest` yanıt gövdesi bayt bayt aynı.
**Mimari pinler:** `ALLOWED_PRODUCTION_IMPORTERS`e `host-history/vectors.ts` (`embeddings-provider.test.ts:163`) · `ai-generation-readers` listesi
DEĞİŞMEZ (L4 AiGeneration okumaz) · `aiReplyDraft` okuyucu kapalı listesi (yeni) · `scrub-scope-parity` DELETE_ONLY (+2) · `data-export-coverage`
EXCLUDED (+3) · `HANDLED_REFERENCES` envanteri (+2) · `api-route-role-gate` (yeni rotalar `withManage`).
**Dilim 2:** istem kapalıyken bayt bayt (öneri, oto-yanıt, QR, Ayarlar testi, demo) · okuyucuyu yalnız `ai-suggest` içe aktarır · KB önceliği (KB kanıtlı alt
sorguda geçmiş satırı istemde YOK) · onaysız rezervasyonda Wi-Fi satırı aday değil · zayıf isteme girmez · `history:` beyanı blokta olmayan kimlikte düşer ·
GOLDEN SET (`tests/unit/golden-scenarios.test.ts`, istem katmanı değiştiği için).
**Mutasyon (`scripts/mutation-run.mjs`, M0 kontrol koşusu ZORUNLU, tam suit ile aynı anda KOŞMAZ):** mülk süzgecini kaldır · `aiAssisted` / kanal
otomasyonu / teslim süzgecini kaldır · sır kapsamını kaldır · KB önceliğini kaldır · yarı ömrün işaretini çevir · halef (en yeni kazanır) kaldır ·
bağlı-unchanged dışlamasını kaldır · style parçasını içerik say · eşiği 0,40 → 0,60 · işlem içi `ANON_BODY` kontrolünü kaldır · silme / saklama
`deleteMany`yi kaldır. Hayatta kalan = eksik pin ya da gerekçeli eşdeğer.
**Ücretli ölçüm (kurucu onayıyla; `tests/eval/failure-analysis.ts` bağlanır):** 6-ilke §C7 (a)–(h) (`:268-276`) + en yeni kazanır (aynı soru, iki farklı
cevap) + KB ↔ geçmiş (KB kazanır + kart) + çok dilli (Almanca soru ↔ Türkçe eski cevap; large / small) + L4 (11→12 light, emoji silme, rewrite) +
Kip B gölge sayımı. Sayılar konu başına ayrı.

### 6.3 Riskler
- **Prod migration:** taze `pg_dump` + açık onay (CLAUDE.md "Migration ZORUNLU"); Railway kapalı → geri doldurma yalnız yerel demo veriyle prova.
- **Kanal rolü bilinmeyen eski satırlar** (L5 1. faz yalnız YENİ mesajlara yazar, Q2-c `KURUCU-SORULARI.md:773-775`): Hospitable şablonu ev sahibi
  cevabı gibi dizinlenebilir → Kip A'da ev sahibi görür; Kip B `provenance` şartıyla dışarıda; Railway açılınca sağlayıcıdan yeniden okuma betiği.
- **Olay döngüsü:** kümeleme / gömme doldurma parti parti, 50 satırda bir bırakır; senkron kilidi (TTL 15 dk) beklenmez (`service.ts:437-439` deseni).
- **Ölçek depolama** (§1.4) — bugün değil, 100+ müşteride karar.
- **Gömme kredisi biterse** sözcüksel getirme sürer (fail-open getirme), Kip B adayı vektörsüz satırda yine şartlı (fail-closed kullanım).
- **İstem bütçesi:** blok ≤ 3 × 900 karakter; istem bütçesi kuralı (`docs/claude/ai-guvenlik.md` "İstem bütçesi") ile birlikte ölçülür.
- **Reddedilen "semantik önbellek" ile karıştırılmamalı** (`kalici-urun-kararlari.md:122-124`): L1 eski cevabı misafire DÖNDÜRMEZ; modele kanıt olarak verir,
  çıktı bütün kapılardan geçer.

### 6.4 ReDoS kuralları (CLAUDE.md "MİSAFİR METNİNE UYGULANAN KALIPTA KARESEL İŞ YOK")
- Yeni düzenli ifade YAZILMAZ (belirteçleyici + saat birleştirme + cümle bölme doğrusal tarayıcı; fark Myers, tavanlı).
- Yeniden kullanılan kalıplar (`TIME_BOUND_RE`, `TENTATIVE_RE`, `ONE_OFF_RE`, `NO_INFO_RE`, `PERSONAL_ACTION_RE`, `FIRST_PERSON_FUTURE_RE`
  `extract.ts:222-319`) bugün yalnız model TASLAĞINA uygulanıyor; L1/L4 bunları ev sahibi metnine (uzunluk tavanı YOK) ve misafir bloğuna uygular →
  her biri için 50.000 karakter tek sözcük / boşluk dizisi / tekrarlanan kök süre pini ve eski / yeni sonuç kıyası.
- Maske (`maskForLearning`) zaten doğrusal (`mask.ts:120-121,178-179,191`); kural aynen: maske ÖNCE, kırpma SONRA (`mask.ts:20`).

---

## 7. Kurucuya sorular (6) — biçim: bunu böyle yapıyorum · büyük şirketler · önerim · ÖRNEK · böyle yapalım mı?

### SORU 1 · "İki kip" ne demek?
- **Bugün:** yapay zekâ cevap yazarken eski sohbetlerdeki cevaplarınıza bakmıyor; bakması için her bilgiyi "Geçmişten öğren"de tek tek onaylayıp
  bilgi tabanına koymanız gerekiyor.
- **Büyük şirketler (bildiğim kadarıyla, bu oturumda doğrulanmadı):** Intercom gibi destek yazılımlarında eski temsilci konuşmaları önce TEMSİLCİNİN
  yardımcısında kaynak olarak gösterilir (temsilci görür, kendisi gönderir); müşteriye kendiliğinden cevap veren yapay zekâ onaylı bilgi içeriğinden
  cevaplar. Zendesk'te de müşteriye giden yapay zekânın kaynağı bilgi bankası. Hospitable / Guesty'nin bunu nasıl yaptığını doğrulayamadım.
- **Önerim:** iki kip, DAİRE başına bir kez seçilir, sonra hiç onay sorulmaz.
  · **Kip A "Taslakta kullan" (varsayılan):** yalnız "AI öner" taslağında; altında dayandığı eski cevabınız (ay + güç). Misafire otomatik bir şey gitmez.
  · **Kip B "Otomatik cevapta da kullan":** yalnız güçlü (son ~3 ay ya da birkaç misafire aynı), bilgi tabanıyla çakışmayan, şifre / kod / arıza adımı
    içermeyen eski cevaplar otomatik cevaba da girer; bütün güvenlik kapıları aynı. Açmadan önce birkaç gün GÖLGE ölçüm (hiçbir şey gitmez, yalnız kayıt).
- **ÖRNEK 1** — misafir "Çöpleri nereye atıyoruz?"; bilgi tabanında çöp yok; 3 hafta önce başka misafire "Çöpleri bina girişinin solundaki gri
  konteynere atabilirsiniz" yazmıştınız.
  Bugün: otomatik cevap gitmez (size kalır); "AI öner" taslağı "Kontrol edip size dönüş yapacağım."
  Kip A: otomatik cevap yine gitmez; "AI öner" taslağı "Çöpleri bina girişinin solundaki gri konteynere atabilirsiniz." + altında "3 hafta önce bir
  misafire böyle yazmıştınız · güçlü" → siz gönderirsiniz.
  Kip B: misafire otomatik "Çöpleri bina girişinin solundaki gri konteynere atabilirsiniz." gider.
- **ÖRNEK 2** — "Wi-Fi şifresi ne?"; bilgi tabanında yok; 2 ay önce "şifre lale2024" yazmıştınız → Kip A: onaylı rezervasyonda taslakta (rezervasyon
  öncesi asla); Kip B: otomatik GİTMEZ (şifre bilgi tabanının işi).
- **ÖRNEK 3** — "Televizyon açılmıyor"; geçen ay "Kumandadan HDMI 1'i seçin" yazmıştınız → Kip A: taslakta; Kip B: GİTMEZ ("bozuklar için bilgi
  tabanında yazmayan öneri veremez" kuralınız).
- **Seçenekler:** (a) önerim · (b) yalnız Kip A (Kip B hiç yok) · (c) güvene göre kendiliğinden (güçlü olan otomatik gider, siz seçmezsiniz) · (d) "iki
  kip" başka bir şey demekti (ör. "öğren-onayla" ile "doğrudan bak") → bir cümleyle yazın. **Böyle yapalım mı (a)?**

### SORU 2 · Bilgi tabanı ile daha YENİ bir cevabınız çelişirse hangisi kazansın?
- **Bugün:** bilgi tabanı tek kaynak. Sözünüz "aynı şey farklı yazılmışsa daha güncel kazanır" eski cevaplarınız ARASINDA kesin uygulanır (en yeni
  kazanır, eskisi taslağa girmez). Bilgi tabanı ↔ eski cevap için iki yol var.
- **Büyük şirketler (bildiğim kadarıyla):** müşteriye giden cevapta onaylı bilgi bankası esas; konuşmada farklı yazılmış bilgi yöneticiye "içerik
  güncelleme önerisi" olarak düşer.
- **Önerim (a):** taslakta bilgi tabanı kazanır; ama bilgi tabanını son düzenlediğinizden SONRA bir misafire farklı bir şey yazdıysanız taslağın üstünde
  TEK kart: "Bilgi tabanınız: 'Wi-Fi şifresi eski2025' (Mart) · Dün bir misafire: 'yeni2026' → [Bilgi tabanını güncelle] [O misafire özeldi]". Güncelle =
  eskisi pasif, yenisi doğru (L2 kararınız); "özeldi" bir daha sorulmaz.
  (b) en yeni yazılan kendiliğinden kazanır (taslakta "yeni2026", bilgi tabanı dokunulmaz).
- **ÖRNEK:** misafir "Wi-Fi şifresi?" → (a) taslak "eski2025" + kart; "Güncelle"ye basınca bundan sonra her yerde "yeni2026" · (b) taslak "yeni2026",
  ama otomatik cevap ve QR bilgi tabanından hâlâ "eski2025" der → iki yüzey farklı konuşur ((b)'nin riski).
- **Böyle yapalım mı (a)?**

### SORU 3 · Güven ne hızla azalsın?
- **Önerim:** yarı ömür 120 gün → dün %99, 1 ay %84, 3 ay %59, 6 ay %35, 1 yıl %12 ("zayıf": taslağa GİRMEZ, yalnız "eski cevaplarınız" kutusunda
  görünür), 18 ay hiç gösterilmez. Aynı cevabı farklı misafirlere tekrar yazdıysanız güç artar (4 ay önce + daha eski 3 aynı cevap → güçlü).
- **Seçenekler:** (a) 120 gün (önerim) · (b) 180 gün (1 yıl %25 — daha uzun hatırlar) · (c) 60 gün (3 ay %35 — çabuk unutur) · (d) değerler
  (şifre / ücret / saat) 60 gün, yer / yol / kural 180 gün — önerim önce (a), iki ay ölçümden sonra (d)'ye bakalım.
- **ÖRNEK:** "Otopark ücretli mi?" — 10 ay önce "Bina arkasında, ücretsiz" yazmışsınız, başka cevap yok → (a) zayıf: taslakta kullanılmaz, kutuda "10 ay
  önce: ücretsiz" görünür · (b) orta: taslakta "Otopark bina arkasında, ücretsizdir" · (c) hiç görünmez.
- **Hangisi?**

### SORU 4 · L4 — düzenlediğiniz taslaktan tam olarak ne öğrenilsin?
- **Bugün (kod):** taslağın sözcüklerinin %60'ı ya da fazlası cevabınızda kalıyorsa cevabınızın TAMAMI yok sayılıyor — eklediğiniz doğru cümle de kayboluyor.
- **Büyük şirketler (genel bilgi, doğrulanmadı):** düzenleme oranı kalite ölçüsü olarak tutulur; temsilci düzeltmesi bilgi bankasına doğrudan yazılmaz,
  yöneticiye öneri olarak gelir.
- **Önerim:** taslak ile gönderdiğinizi cümle cümle karşılaştırırız. Hiç değiştirmediğiniz yapay zekâ cümlesi HİÇBİR durumda "sizin bilginiz" olmaz.
  Değiştirdiğiniz / eklediğiniz cümle sizin bilginizdir (o dairede eski cevabınız olur, zamanla zayıflar). %40'tan az değiştirdiyseniz bu bir
  DÜZELTMEdir: aynı düzeltmeyi İKİ farklı misafirde yaptıysanız size BİR kez sorarız ("bilgi tabanına işleyelim mi?"). %40 ve üstü kendi cevabınızdır
  (düzeltme sayılmaz, yine bilginiz). Yalnız imla / noktalama / selam değişikliği bilgi sayılmaz. Daire bilgisi (giriş / çıkış saati) ASLA kendiliğinden değişmez.
- **ÖRNEK 1:** taslak "Çıkış saatimiz 11:00'dir. İyi yolculuklar dileriz." → 11:00'ı 12:00 yaptınız (%12). Önce: hiçbir şey öğrenilmez. Sonra:
  "Çıkış saatimiz 12:00'dir." bu dairede eski cevabınız olur (ama daire bilginiz 11:00 dediği için taslağa girmez); ikinci misafirde de aynısını
  yaparsanız kart: "Taslaklarda 11:00 yazıyordu, iki misafirde 12:00 yaptınız — [Daire bilgisini aç] [Misafire özeldi]".
- **ÖRNEK 2:** taslak "Havuz 7/24 açıktır. Havlular dolapta." → "Havuz…" cümlesini sildiniz. "Havlular dolapta" sizin bilginiz SAYILMAZ (yapay
  zekânın cümlesi, aynen kaldı); iki kez silerseniz "bilgi tabanındaki Havuz kalemi hâlâ doğru mu?" uyarısı.
- **ÖRNEK 3:** "Size özel 12:00'ye kadar kalabilirsiniz" düzeltmesi → misafire özel sayılır, hiç öğrenilmez.
- **Böyle yapalım mı?**

### SORU 5 · Bütün geçmişin dizinlenmesi — maliyet, KVKK, ne zaman?
- **Ne olacak:** bütün dairelerin bütün geçmiş konuşmalarındaki ev sahibi cevapları (son ~24 ay — daha eskisi saklama süresiyle zaten silinmiş),
  misafir sorusuyla birlikte MASKELİ (ad, telefon, e-posta, kapı kodu gizli) kopya + sayısal özeti (vektör) olarak saklanır; misafir silme talebinde ve
  24 ayda silinir; dışa aktarılmaz, hiçbir modelin eğitimine gitmez.
- **Maliyet [tahmin]:** sizin hesap ~3.500 çift → small ≈ 2 sent, large ≈ 14 sent (tek sefer); sonrası günde sent altı; depo ≈ 45 MB.
- **Değişen eski karar:** E2 paketi (09-12) "misafir mesajı saklanmaz" diyordu → bu tablo için değişiyor. Aydınlatma metnine cümle (avukat paketi):
  "…maskelenerek aynı dairenin yeni misafirlerine cevap taslağı hazırlanmasında kullanılır…".
- **Önerim:** (1) gömme modeli **large** (Türkçe ve başka dillerde ölçülmüş daha iyi; başka dilde sorulmuş eski soruyu da bulur) · (2) önce yalnız
  sizin hesabınız; Railway açılınca kuru koşu (sayı + tahmini ücret ekranda) → siz "Başlat" deyince · (3) aydınlatma cümlesi avukattan dönmeden
  müşteri hesaplarında açılmaz.
- **ÖRNEK:** Ayşe 2025 Mayıs'ta "Otopark var mı?" sordu, siz "Bina arkasında ücretsiz" yazdınız → dizinde "Otopark var mı?" (ad yok) + "Bina arkasında
  ücretsiz" + vektör; Ayşe silme talep ederse bu satır da silinir.
- **Böyle yapalım mı? Model large mı small mı?**

### SORU 6 · Taslağı HİÇ değiştirmeden gönderdiğinizde, dayandığı eski cevabınız "bugün yeniden doğrulandı" sayılsın mı?
- **Bugün:** aynen gönderilen taslak hiçbir şey öğretmez (yapay zekânın sözü sayılır).
- **Fayda / risk:** "evet" derseniz 5 ay önceki "Otopark ücretsiz" cevabına dayanan taslağı aynen gönderince o bilgi tazelenir ve sonraki misafirde
  daha güçlü kullanılır; ama taslağı okumadan onaylarsanız yanlış bilgi kendini besler.
- **Seçenekler:** (a) hayır — tazelemek için kaynak kutusundaki "Hâlâ geçerli" tek tık (önerim, en güvenli) · (b) evet, yarım ağırlıkla · (c) evet, tam.
- **ÖRNEK:** taslak "Otopark bina arkasında, ücretsizdir" (altında "5 ay önce · orta") → "Onayla ve gönder". Sonraki misafirde: (a) yine "orta" (zamanla
  zayıflar) · (b) "güçlü"ye yakın · (c) "güçlü" (dün yazılmış gibi).
- **Hangisi?**

---

## Ek — sormadan yapılabilecekler (müşteriye / misafire gideni değiştirmez; CLAUDE.md 09-27 inceltmesi)
Dilim 0 saf modülleri ve testleri; Dilim 1'in KVKK / mimari pinleri (anahtarlar kapalı, migration onayı ayrıca gerekir — CLAUDE.md "Migration içeren
push = taze pg_dump + açık onay"); L4 bağı kurulunca Geçmişten öğren eşleştiricisinin bağlı satırda cümle atfına geçmesi (anahtar `HISTORY_LEARN_ENABLED`
kapalı, ev sahibi taslak ekranı etkilenir — haber verilir).
