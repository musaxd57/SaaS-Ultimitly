# Migration paketi 60 — tasarım ve onay önerisi (2026-10-09)

> **DURUM: ÖNERİ. Şemaya / `prisma/migrations/`e HİÇBİR şey eklenmedi.** Kural (CLAUDE.md): migration içeren push = taze `pg_dump`
> + kurucunun AÇIK onayı. Railway kapalı; dal açılınca son yeşil commit canlıya gider ve 59 (karar motoru) da henüz canlıda değil.
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
CREATE UNIQUE INDEX ON "ChannelListing" ("connectionId", "externalId");
CREATE INDEX ON "ChannelListing" ("propertyId");
```

- **Geçiş (expand → dual-write → okuma anahtarı → contract):** köprü senkronu ilanı eşlerken `Property.hospitableId` ile BİRLİKTE
  satır yazar (yalnız AKTİF bağlantı satırı varken — bugün canlıda yok, kurucu org env fallback'te). Okumalar anahtar arkasında
  (`CHANNEL_LISTING_READ`, varsayılan kapalı) satıra geçer. `hospitableId` DROP'u V0.7 kolon contract'ı ile aynı operatör planında.
- Backfill idempotent: aktif bağlantısı olan org'larda `hospitableId` dolu her mülk için satır (çıkarım yok — bağlantı satırı yoksa
  yazılmaz).
- Kiracı: `organizationId` + bağlantının org'u aynı olmalı (yazma servisinde kontrol + kiracılar arası davranışsal test).

## B. `Reservation.sourcePlatform`

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
CREATE INDEX ON "AiGeneration" ("organizationId", "createdAt");
CREATE INDEX ON "AiGeneration" ("conversationId");
```

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
CREATE INDEX ON "AiReviewLabel" ("generationId");
```

- Konsol: yalnız izin listesi + 2FA'lı süper-admin; yalnız GET + etiket yazma ucu; her görüntüleme ve reddedilen deneme `AuditLog`a
  (amaç metni zorunlu, IP / oturum) — yeni denetim tablosu gerekmez. Talimatın test listesi aynen uygulanır (sıradan admin erişemez,
  sorgu / gövde kimliğiyle kiracı süzgeci aşılamaz, etiket müşteri verisini değiştiremez, gönderim / durum değiştiren hiçbir uca
  ulaşılamaz).

## Uygulama sırası (onaydan sonra)

1. Tek migration `60_channel_listing_ai_trace` (A–E), taze PG'de 00→60 zinciri + sıfır drift, kanarya / scrub-scope pinleri.
2. Yazıcılar anahtarların arkasında (hepsi varsayılan KAPALI): ilan dual-write · platform · sağlık · üretim izi.
3. Konsol (salt-okuma) + etiket ucu + talimatın test listesi.
4. Push öncesi: taze `pg_dump` (`ops-backup-prod.ps1`) + `pg_restore -l` + SHA → kurucunun "push et" onayı → CI.

## Kurucuya sorular

1. Paketin tamamı (A–E) onaylı mı, yoksa önce yalnız A–C (Airbnb öncesi kimlik / kaynak / sağlık) mı?
2. §D-1: taslak ve gönderilen metin izde saklansın mı (önerim: evet, `Message` ile aynı saklama süpürgesi)?
3. Kalite konsolu bugün mü, yoksa Railway geri açılınca mı (canlı veri olmadan konsol boş görünür)?
