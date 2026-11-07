# Migration paketi 60 — tasarım ve onay önerisi (2026-10-09)

> **DURUM (10-09 akşam): kurucu "tamamını hazırla" dedi → kod YEREL dalda hazır (`wip/migration-60`), PUSH EDİLMEDİ.** Ayrıntı ↓"Uygulama
> durumu". Aşağıdaki ilk metin önerinin aynen kaydıdır.
> ~~DURUM: ÖNERİ. Şemaya / `prisma/migrations/`e HİÇBİR şey eklenmedi.~~ Kural (CLAUDE.md): migration içeren push = taze `pg_dump`
> + kurucunun AÇIK onayı. Railway kapalı; dal açılınca son yeşil commit canlıya gider ve 59 (karar motoru) da henüz canlıda değil.
> İnceleme 10-09 (Haiku): adsız indeks, eksik `sourcePlatform` SQL'i, iz metninin silme paritesi, okuma geçişinde geri düşüş düzeltildi.
> Kaynak: kurucu talimatı 09-07 (değişmez 2 / 3 / 9 / 14, "Founder AI Quality Console", "Generation trace") ve
> `docs/YOL-PLANI-DURUM-2026-10-09.md` §2f–h + §4. Hepsi talimatta "Airbnb Direct pilotundan önce" ya da "gelecek gereksinim".

## 0. Kısaca — ne isteniyor, ne değişir

| # | Değişiklik | Neden (talimat) | Misafire giden davranış | Risk |
|---|---|---|---|---|
| A | Yeni tablo `ChannelListing` (bağlantı kapsamlı ilan kimliği) | değişmez 3: dış kimlik global eşsiz sayılmaz | değişmez | düşük (yeni tablo; mevcut `Property.hospitableId` DURUR) |
| B | `Reservation.sourcePlatform` (nullable metin) | değişmez 2: ham kaynak bilgisi kaybolmaz | değişmez | düşük (nullable sütun) |
| C | `ChannelConnection` sağlık alanları (3 nullable sütun) | değişmez 9: bağlantı sağlığı tutarlı | değişmez | düşük |
| D | Yeni tablo `AiGeneration` (üretim izi) | "Generation trace" + kalite konsolu | değişmez (yalnız kayıt) | orta: misafir metni saklanır mı? (§D karar) |
| E | Yeni tablo `AiReviewLabel` (kurucu etiketleri) | "Founder AI Quality Console" — etiketler operasyon verisinden AYRI | değişmez | düşük |

Dolu tabloya `@unique` / zorunlu sütun / silme YOK (boot'ta patlamaz). Hepsi additive; geri alma = sütun / tablo kullanılmaz kalır.

## A. `ChannelListing` — bağlantı kapsamlı ilan kimliği

```sql
CREATE TABLE "ChannelListing" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "connectionId" TEXT NOT NULL REFERENCES "ChannelConnection"("id") ON DELETE CASCADE,
  "externalId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL REFERENCES "Property"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ChannelListing_connectionId_externalId_key" ON "ChannelListing" ("connectionId", "externalId");
CREATE INDEX "ChannelListing_propertyId_idx" ON "ChannelListing" ("propertyId");
```

- `connectionId ON DELETE CASCADE` bilinçli: bağlantı satırı kod içinde SİLİNMEZ (kopma / iptal belirteci boşaltır, satır kalır —
  `channels/connections.ts`); tek silme yolu org silmesi, orada org zinciri zaten her şeyi götürür. `RESTRICT` org silmesini
  kilitleyebilirdi (inceleme 10-09 #24 — reddedildi, gerekçe bu).

- **Geçiş (expand → dual-write → okuma anahtarı → contract):** köprü senkronu ilanı eşlerken `Property.hospitableId` ile BİRLİKTE
  satır yazar (yalnız AKTİF bağlantı satırı varken — bugün canlıda yok: `ChannelConnection` 09-07 prod sayımında boştu,
  `docs/V0.7-CANLI-GECIS-OPERATOR-PLANI.md` §0; kurucu org env fallback'te). Okumalar anahtar arkasında (`CHANNEL_LISTING_READ`,
  varsayılan kapalı) satıra geçer; 🚨 satırı olmayan mülkte okuma `Property.hospitableId`e DÜŞER (inceleme 10-09 #21 — yoksa tek canlı
  kiracı geçişte hiçbir ilan görmezdi). `hospitableId` DROP'u V0.7 kolon contract'ı ile aynı operatör planında.
- Backfill idempotent: aktif bağlantısı olan org'larda `hospitableId` dolu her mülk için satır (çıkarım yok — bağlantı satırı yoksa
  yazılmaz).
- Kiracı: `organizationId` + bağlantının org'u aynı olmalı (yazma servisinde kontrol + kiracılar arası davranışsal test).

## B. `Reservation.sourcePlatform`

```sql
ALTER TABLE "Reservation" ADD COLUMN "sourcePlatform" TEXT;
```

- Sağlayıcının ham platform dizesi (bugün `toChannel` "airbnb/booking/vrbo/direct/other"a indirip hamı atıyor). Yalnız ingest yazar,
  yalnız GÖSTERİM / teşhis okur — yetenek ASLA bundan çıkarılmaz (V0.9 pini kapsar). Nullable; eski satırlar NULL (= gözlenmedi).
- KVKK: kişisel veri değil; saklama sütun eklemeyi gerektirmez.

## C. `ChannelConnection` sağlığı

```sql
ALTER TABLE "ChannelConnection"
  ADD COLUMN "lastReadOkAt" TIMESTAMP(3),
  ADD COLUMN "lastReadErrorAt" TIMESTAMP(3),
  ADD COLUMN "lastReadErrorKind" TEXT; -- kapalı küme: IngestErrorKind
```

- Senkron her okuma geçişinde yazar; panel "Bağlantı sağlığı: iyi / sorunlu / okunamıyor" türetir (sağlayıcı adı yok). Müsaitlik
  motoru köprüye bağlı mülkte bugün "tazelik kaydı yok" diyor (`source_freshness_unrecorded`) → bu alanla köprü kaynağı da "taze"
  sayılabilir hâle gelir (motorun kararı değişir: boş gece "bilinmiyor" yerine kanıtla "boş" olabilir — **bu bir davranış değişikliği
  sayılır, ayrı onay**; alan eklenir, motor bağlanması ayrı dilim).

## D. `AiGeneration` — üretim izi (karar gerektirir)

Talimat: model + istem sürümü, RAG kaynak kimlikleri ve alıntıları, araç çağrıları ve sonuçları, kapı kararı, gecikme, token,
tahmini maliyet, taslak ve gönderilen mesaj, "silme / saklama paritesi".

```sql
CREATE TABLE "AiGeneration" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "propertyId" TEXT, "reservationId" TEXT, "conversationId" TEXT, "triggerMessageId" TEXT,  -- opak kimlik, FK yok (RiskEvent emsali)
  "surface" TEXT NOT NULL,            -- channel_auto · channel_suggest · qr · decision_text
  "model" TEXT NOT NULL, "promptVersion" TEXT NOT NULL, "retrievalVersion" TEXT, "toolContractVersion" INTEGER,
  "kbEvidenceJson" TEXT,              -- kimlik + sürüm (RiskEvent.kbEvidenceJson biçimi)
  "toolResultsJson" TEXT,             -- VerifiedToolResult[] (PII'siz)
  "decision" TEXT NOT NULL,           -- auto_sent · human_review · no_reply
  "gateReason" TEXT,
  "latencyMs" INTEGER, "promptTokens" INTEGER, "completionTokens" INTEGER, "reasoningTokens" INTEGER, "costMicroUsd" INTEGER,
  "draftText" TEXT, "sentText" TEXT,  -- ⚠️ §D-1 kararı
  "contextDiagnosticsJson" TEXT,      -- dahil mesaj kimlikleri, atlanan sayısı, bekleyen sayısı (PII yok)
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AiGeneration_organizationId_createdAt_idx" ON "AiGeneration" ("organizationId", "createdAt");
CREATE INDEX "AiGeneration_conversationId_idx" ON "AiGeneration" ("conversationId");
```

- 🚨 Metin saklanırsa (§D-1 a) `conversationId` OPAK KALAMAZ (inceleme 10-09 #20): konuşma silinince (ev sahibi silmesi, tekrar
  konuşma temizliği) iz metni geride kalırdı. → `conversationId` FK `ON DELETE CASCADE`; saklama süpürgesi ve misafir silmesi
  `draftText` / `sentText`i `Message` ile AYNI işlemde maskeler; `scrub-scope-parity` pinine eklenir. Metin saklanmazsa (b) opak kalır.

- **§D-1 (kurucu kararı):** taslak / gönderilen METİN saklansın mı? (a) Evet — konsol tam izi gösterir; metin `Message` ile AYNI
  saklama süpürgesinden geçer (24 ay, misafir silmede maskelenir — scrub-scope pinine eklenir). (b) Hayır — yalnız özet (SHA-256) +
  `Message` satırına bağlantı; konsol metni `Message`ten okur, gönderilmeyen taslak görünmez. **Önerim: (a)** — talimat "generated
  draft and actually delivered message" diyor; parite pinlerle korunur.
- Eğitim yasağı (talimat): bu tablo hiçbir dışa aktarma / ince ayar yoluna bağlanmaz (mekanik pin: `AiGeneration` okuyan modül
  listesi kapalı).

## E. `AiReviewLabel` — kurucu etiketleri (operasyon verisinden ayrı)

```sql
CREATE TABLE "AiReviewLabel" (
  "id" TEXT PRIMARY KEY,
  "generationId" TEXT NOT NULL REFERENCES "AiGeneration"("id") ON DELETE CASCADE,
  "reviewerUserId" TEXT,              -- süper-admin (opak)
  "label" TEXT NOT NULL,              -- kapalı küme: correct · hallucinated_fact · missed_context · repeated_greeting · wrong_tone ·
                                      -- temporal_error · stale_knowledge · retrieval_failure · tool_should_have_been_used ·
                                      -- unsafe_auto_send · escalation_failure
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AiReviewLabel_generationId_idx" ON "AiReviewLabel" ("generationId");
```

- Konsol: yalnız izin listesi + 2FA'lı süper-admin; yalnız GET + etiket yazma ucu; her görüntüleme ve reddedilen deneme `AuditLog`a
  (amaç metni zorunlu, IP / oturum `AuditLog.metadataJson` içinde — tablo yalnız bu JSON sütununu taşır) — yeni denetim tablosu
  gerekmez. Talimatın test listesi aynen uygulanır (sıradan admin erişemez,
  sorgu / gövde kimliğiyle kiracı süzgeci aşılamaz, etiket müşteri verisini değiştiremez, gönderim / durum değiştiren hiçbir uca
  ulaşılamaz).

## Uygulama sırası (onaydan sonra)

1. Tek migration `60_channel_listing_ai_trace` (A–E), ADLI indeksler (Prisma `_key` / `_idx` adlarıyla; adsız indeks drift üretir —
   inceleme 10-09 #19), taze PG'de 00→60 zinciri + sıfır drift, kanarya / scrub-scope pinleri. Dosya `prisma migrate diff` ile üretilir;
   bu belgedeki SQL taslaktır.
2. Yazıcılar anahtarların arkasında (hepsi varsayılan KAPALI): ilan dual-write · platform · sağlık · üretim izi.
3. Konsol (salt-okuma) + etiket ucu + talimatın test listesi.
4. Push öncesi: taze `pg_dump` (`ops-backup-prod.ps1`) + `pg_restore -l` + SHA → kurucunun "push et" onayı → CI.

## Kurucuya sorular

1. Paketin tamamı (A–E) onaylı mı, yoksa önce yalnız A–C (Airbnb öncesi kimlik / kaynak / sağlık) mı?
2. §D-1: taslak ve gönderilen metin izde saklansın mı (önerim: evet, `Message` ile aynı saklama süpürgesi)?
3. Kalite konsolu bugün mü, yoksa Railway geri açılınca mı (canlı veri olmadan konsol boş görünür)?

## Uygulama durumu (10-09 akşam — dal `wip/migration-60`, PUSH EDİLMEDİ)

Kurucu kararları (10-09): paketin tamamı · §D-1 (a) metin saklanır, mesajlarla aynı saklama · konsol hazırlanır. Her parça kırmızı-önce
+ mutasyon (ayrık worktree) + gerçek PostgreSQL entegrasyon testi ile; üç Haiku inceleme turu (bulgular kodla doğrulandı, bir kısmı
gerekçeyle reddedildi).

| Parça | Kod | Anahtar (hepsi VARSAYILAN KAPALI) | Test |
|---|---|---|---|
| Migration `60_channel_listing_ai_trace` | taze PG'de 00→60 zinciri, sıfır drift | — | kanarya + scrub-scope pinleri |
| D iz yazıcı | `ai/generation-trace.ts`; kanal oto-yanıtının 5 karar noktası `recordDecision` (RiskEvent + AYNI karar/gerekçe/kanıt) | `AI_GENERATION_TRACE_ENABLED` | birim + uçtan uca (11/11 mutant) |
| D KVKK | saklama iki dal + yaş çapası bacakları + misafir silmesi + konuşma birleştirme; etiket notu da | (anahtardan bağımsız: eski izler hep temizlenir) | 13 entegrasyon (9/9 mutant) |
| E konsol | `GET /api/admin/ai-quality` · `POST …/labels` · `/admin/ai-quality` sayfası | (yazım anahtarı açılınca dolar) | 20 entegrasyon (13/13 mutant) |
| A–C kanal metaverisi | `channels/metadata.ts`; senkron ilan eşlemesi + ham platform + okuma sağlığı | `CHANNEL_METADATA_WRITE` | 17 entegrasyon |

**Tasarımdan bilinçli sapmalar (kurucu onayına):**
1. **Konsol amacı KAPALI KÜME** (kalite / olay / şikâyet incelemesi + isteğe bağlı talep no), talimattaki "yazılı amaç" serbest metin
   DEĞİL — 09-30 operatör dışa aktarım kararının emsali: kayıt müşterinin KVKK ihracına girer, serbest metin kişisel veri taşıyabilir.
2. **Kayda operatörün IP'si / oturum kimliği YAZILMAZ** (bu belgenin §E'si "IP / oturum metadataJson içinde" diyordu): 08-01 denetim
   kuralı — `AuditLog.metadataJson` müşterinin ihracına girer, operatörün kişisel verisi üçüncü kişi verisidir. Kimlik opak `actorUserId`.
3. **`AiGeneration.conversationId` ZORUNLU** (tasarımda boş olabilirdi; Haiku: konuşmasız iz metni hiçbir süpürgeye düşmezdi). Bütün
   yüzeyler (kanal, QR, karar kartı) bir konuşmaya bağlı.
4. **İz org dışa aktarımına GİRMEZ** (eğitim / dışa aktarma yasağı; okuyan modül listesi kapalı, pinli). Not: misafir mesajları ihraçta
   var; izin ihraca girmesi istenirse bu ayrı karar.
5. **Kanal metaverisinin üç yazıcısı TEK anahtarda** (`CHANNEL_METADATA_WRITE`): aynı "expand → dual-write" aşaması, hepsi yalnız yazar.
6. **`lock_timeout` eklenmedi** (Haiku önerisi): 59 migration'da emsal yok; zaman aşımı Prisma'da "başarısız migration" kaydı bırakır
   ve açılışı elle kurtarma ister — kısa bir bekleme bundan iyidir; Railway açılışında trafik yok.

**Kalan (bu paketin dışında, ayrı onay):** okuma geçişleri (`CHANNEL_LISTING_READ` vb.) · müsaitlik motorunun sağlık kaydını kullanması
(davranış değişikliği) · QR / öneri / karar metni yüzeylerinin izi · konsolda istatistik görünümü.

**Push öncesi (kural):** taze `pg_dump` (`ops-backup-prod.ps1`) + `pg_restore -l` + SHA → kurucunun "push et" onayı → CI.
