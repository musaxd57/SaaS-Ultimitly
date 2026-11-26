# CLAUDE.md — Lixus AI proje hafızası

> Her oturum başında okunur (HER alt ajana da yüklenir — kısa tut). Yalnız KURALLAR ve GÜNCEL DURUM.
> Gerekçeler/ölçümler/tarihçe: `docs/history/CLAUDE-2026-11-20-sadelestirme-4-oncesi-tam-metin.md` (84 KB, aynen — Durum satırları
> 11-06 → 11-20 `docs/claude/durum.md`ye taşındı) · `docs/history/CLAUDE-2026-10-02-sadelestirme-3-oncesi-tam-metin.md` (221 KB, aynen — 09-23 → 10-01
> tur anlatıları) · `docs/history/CLAUDE-2026-09-23-sadelestirme-2-oncesi-tam-metin.md` (219 KB, aynen) ·
> `docs/history/CLAUDE-2026-09-07-sadelestirme-oncesi-tam-metin.md` (239 KB'lık eski hâl, aynen)
> + `docs/history/CLAUDE-2026-07.md` / `CLAUDE-2026-08.md` + `git log`.
> Kanıt sözleşmesi: `docs/TEST-EVIDENCE-CONTRACT.md` (BAĞLAYICI). Plan: `ROADMAP.md`.
> **Yol planı (kurucu talimatı 2026-09-07, AYNEN): `docs/KURUCU-TALIMATI-2026-09-07-urun-vizyonu-ve-degismezler.md`**
> — ↓"Yol planı" bölümü onun özetidir, çelişkide o metin kazanır.
> Denetim turu: `docs/audit-2026-09-05/` (`SECURITY-ARCHITECTURE-REVIEW.md` · `CLAUDE-HANDOFF.md` · `DURUM.md`).
> V0: `docs/V0-CHANNEL-INDEPENDENCE-INVENTORY.md`.
> 🗂️ **Konu dosyaları (10-08, kurucu: ".md'ye yığma, taşı, silme"):** büyük bölümler AYNEN `docs/claude/`e taşındı; burada yalnız
> madde başlıkları + yol. O alanda iş yapmadan ÖNCE ilgili dosya okunur, kural orada da BAĞLAYICIDIR: `yol-plani.md` · `retrieval.md` ·
> `ai-guvenlik.md` · `kalici-kararlar.md` · `acik-isler.md` · `kalici-urun-kararlari.md` · `durum.md` · (10-23) `canli-durum.md` ·
> `fiyat-ve-ozellikler.md` · `hospitable.md` · `calisma-ortami.md` · (10-29) `sozcuk-aglari.md` (sözcük ağları envanteri + e-posta / panel tablosu). YENİ ayrıntı / tur anlatısı buraya DEĞİL ilgili konu dosyasına yazılır;
> buraya yalnız tek satırlık başlık + yol girer (kurucu 10-22 gece: "her turda okumak yerine gerektiğinde oku").

## Ürün
**Lixus AI** (lixusai.com) — Türkiye odaklı, çok kiracılı SaaS; kısa dönem kiralama hostlarının
Airbnb/Booking misafir mesajlarını AI ile yanıtlar. Operatör: kurucunun kendi işletmesi (~10 daire). Türkçe
öncelikli. Temel ilke: AI karar-verici değil yardımcı operatör — riskli mesaj hep insana kalır.
Hedef: Hospitable geçici köprü, uzun vadede bağımsız AI-native PMS (V0 belgesi).

## 🧭 Yol planı (kurucu talimatı 2026-09-07 — özet; tam metin `docs/KURUCU-TALIMATI-…md`)
> 📄 **Tam metin (bağlayıcı): `docs/claude/yol-plani.md`** — bu alanda kod / karar değiştirmeden önce oku. Aşağıda yalnız madde başlıkları.
> 📋 **Madde madde durum + çalışma sırası (10-09): `docs/YOL-PLANI-DURUM-2026-10-09.md`** (kurucu: "sıralama nasılsa öyle ilerle").
**FINAL PRODUCT CONSTRAINT:** Lixus başka PMS'lerin üzerinde AI wrapper DEĞİL; Airbnb Direct + Booking.com
**10 mimari ilke:** çekirdek Hospitable semantiği istemez · sağlayıcı değişince çekirdek yeniden yazılmaz ·
**20 teknik değişmez (test-pinli olacak):** (1) çekirdek/intelligence hiçbir sağlayıcı modülünü import
**Yürütme sırası (bu sıra prompttaki diğer sıraları ezer):** ① Codex denetimi kritik bulguları kodda
**Ürün fazları (V0 sonrası, bağımlılık sırasıyla):** V1 Property Memory + Signals → V2 Exception Feed
**Airbnb başvurusu öncesi 6 kapı** (09-24: boş `AirbnbDirectAdapter` sözleşmesi ✅ `docs/AIRBNB-DIRECT-SOZLESMESI.md` ·
**Gelecek AI gereksinimleri (V0 bitmeden UYGULANMAZ; ayrıntı tam metinde):** prompts.ts'e yalnız kod

## Intelligence (V1 CANLI · V2.1 CANLI; envanter §14, tasarım `docs/V1-PROPERTY-MEMORY-DESIGN.md`)
- Bounded context `src/modules/intelligence` (sağlayıcı importu YOK, pin); tek girdi `IngestEvent`; PMS ona bağımlı
  değil (scheduled-sync'te alerts'ten sonra try/catch). `Signal` = mülk merkezli gözlem (RiskEvent AI kapısının
  karar günlüğüdür, farklı yaşam döngüsü); `PropertyMemory` = KB'den (source=kb_item, observedAt=kb.updatedAt) ve
  sinyal örüntüsünden (≥3 negatif/180 gün). LLM'siz: kelime ağı `classifyFallback`, güven mütevazı; metin/PII
  taşınmaz; occurredAt gerçek olay zamanı. Tüketici idempotent (unique dedupeKey + createMany skipDuplicates,
  event başına TX + dispatchedAt), sırasız/yarıda kalma güvenli. Geçmişe sahte event/ilk alınma ÜRETİLMEZ.
  KVKK: misafir-kaynaklı sinyal DATA_RETENTION_MONTHS sonrası purge; erasure SetNull; iki tablo kanarya dışı (karar yorumlu).
- Konuşma dedupe apply: `Signal` `HANDLED_REFERENCES.repoint`'te (FK SetNull ama silmeden ÖNCE keeper'a taşınır —
  iz kaybı yok); DMMF envanteri yeni `conversationId` taşıyan her modelde fail-closed durur, liste bilinçli güncellenir.
- **Kaynak sözleşmesi (ürün akışı turu, tasarım §7):** `IngestEvent`'in TEK yazıcısı `src/lib/ingest/events.ts`
  `recordIngestEvent` (+ write service toplu mesaj); `INGEST_SOURCES = hospitable · ical · manual_file · qr_chat` kapalı
  küme. iCal (`import/sync.ts`), elle `.ics/.csv` (`api/reservations/import`) ve QR (`api/chat/[token]`, yalnız misafir
  satırı → `message.received`) kendi TX'lerinde event yazar; yazma yolları write service'e TAŞINMADI. Yapay olay YOK:
  değişmeyen satır → event yok; elle tek rezervasyon rotası ve Task olayları bilinçli dışarıda. Tüketici `provider`
  okumaz. Geçiş sırası: iCal bacağından SONRA intelligence (hafıza → event → örüntü). KB rotaları hafızayı anında
  eşitler (`refreshPropertyMemoryBestEffort`; silinen kalem → retired). Okuma yüzeyi: mülk sayfası "Mülk Hafızası" kartı.
- **V2 para etkisi (ilk dilim 09-24, migration YOK; `docs/V2-PARA-ETKISI-2026-09-24.md`):** YALNIZ `calendar_conflict`
  satırında, YALNIZ ev sahibinin girdiği tipik gecelik aralıktan (`PropertyMemory` source `human`, sourceRef
  `nightly_rate_range`, 180 gün bayat). Sonuç ya ARALIK (alt < üst, dışa yuvarlama, varsayım kodları, güven asla
  `high`) ya da sayısız "bilinmiyor". `Reservation.totalAmount/currency` OKUNMAZ (pin); aralık yapay zekâya GİTMEZ
  (pin); paraya göre sıralama/portföy toplamı YOK (kurucu kararı). Kart olguları yalnız `kb_item`.

## Retrieval (RAG — VARSAYILAN AÇIK 09-11; tasarım `docs/RAG-GRAPHRAG-TASARIM-2026-09-09.md`; ölçüm raporları `docs/olcum/`)
> 📄 **Tam metin (bağlayıcı): `docs/claude/retrieval.md`** — bu alanda kod / karar değiştirmeden önce oku. Aşağıda yalnız madde başlıkları.
- 🚨 `KB_RETRIEVAL_MODE` bir ACİL DURDURMA düğmesidir: `legacy/off/0/false/no/disabled` eski davranış, başka HER
- TEK BOĞAZ `selectKbForPrompt`
- `src/lib/ai/retrieval/` LLM'siz + deterministik + DB'siz (pin): parçalayıcı (cümle sınırı, 600/900; parça =
- Yabancı dil sözlüğü
- 🚨 ANLAMSAL (embedding) KAYNAK: ÜRETİM YOLU VAR, ANAHTAR `KB_SEMANTIC_RETRIEVAL` VARSAYILAN KAPALI (09-23) — CANLIDA AÇIK (kurucu 09-26).
- Ölçek harness'ı
- Kök sökücü kuralları (ölçülmüş; tekrar denemeyin):
- Belirsiz tek kelime yalnız GENİŞLETME (`expandOnly`, kurucu onayı 09-26):
- Sözlük kayıtları TİPLİ (kurucu onayı 09-26, "B + C + tipli eşleştirici"):
- 🚨 **OPENAI YENİDEN SIRALAYICI (#186, 09-26; kurucu "OpenAI ile", "Önce ücretli ölçüm, sonra siz", "yapalım, en mantıklı
- 🚨 **#189 300 KALEM ÖLÇEĞİ (09-26 gece, `docs/TASARIM-2026-09-26-rag-300-olcek.md`; ölçer `tests/eval/rag-lab/` aşama bazlı
- Alt sorgu yuvaları (#208, 09-27):
- **A5 getirme düzeltmeleri (#208, 09-27; çevrimdışı ölçüm: sözcükselde getirme +0/−0, sahte "insana devret" notu çok soruda
- Anlama katmanı sorguları
- Önbellek anahtarı küme parmak izi
- Retrieval politika DEĞİLDİR
- Host graf katmanı

## 🚨 Değişmez kural
Çalışan ürün BOZULMAZ. Her değişiklik additive, testli (K2 = kırmızı-önce + iki yönlü mutasyon +
integration + tam kapılar), geri alınabilir. Para/e-posta/kimlik akışı: kullanıcı onayı + ilk
denemeler birlikte. `npm test` + build yeşil olmadan push YOK. PR yalnız kullanıcı isterse.
Bu dosyaya token/anahtar/parola yazma.

## ⚠️ DOKUNMA / DİKKAT
- **`senderName: "GuestOps AI"`** = mesaj sınıflandırma sihirli string'i (automation/reports/sent).
  DEĞİŞTİRME; görünür marka `displaySenderName()` ile map'lenir. Rapor sayımı `senderName OR aiAssisted`.
- **Konteyner reset:** dosyalar eksikse `git fetch origin claude/great-edison-3zqpZ` →
  `git reset --hard origin/claude/great-edison-3zqpZ` → `npm ci` → `npx prisma generate`.
  `reset --hard` YALNIZ bu konteynerde; operatörün klonunda ASLA (`git status --short` → `pull --ff-only`).
- **Migration ZORUNLU:** boot `prisma migrate deploy`. Şema değişince gerçek migration üret
  (`prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma
  --shadow-database-url postgresql://postgres@localhost:5432/shadow --script`; ASLA prod URL), taze PG'de
  sıfır-drift doğrula. Migration içeren push = taze `pg_dump` + açık onay.
- **Dolu tabloya `@unique` / required-no-default / drop EKLEME** (boot'ta patlar). Index + yeni tablo güvenli.
  Büyük tabloya index: `CONCURRENTLY` değerlendir; küçük tabloda düz index (INVALID index riski daha kötü).
- **Repo görünürlüğü — 10-12 gece: PUBLIC** (kurucu tekrar public yaptı; GitHub API `private: false` doğrulandı. 09-24'te de PUBLIC
  yapılmıştı, "Actions dakikası 2000'i aştı"). 10-12 akşam private iken kota bitmişti: CI işleri çalıştırıcısız 1–2 sn'de düşüyor, iş
  günlüğü 404, yeniden tetikleme 403 → çözüm kurucuda (public'e dönmek ya da Billing'de harcama limiti). Önceki not: PUBLIC iken standart çalıştırıcılar ücretsiz. Private'a dönülürse
  ayda 2000 dk (push başına ~14 dk); CI durursa sebep kota olabilir. Repoya sır/gerçek veri/işletme adı YAZILMAZ.
  🚨 11-11: private iken kırmızının İKİNCİ sebebi BELLEK (kota değil — işler dakikalarca koşar, `runner_id` dolu): private depoya küçük
  makine (7 GB) verilir, Node'un varsayılan tavanı ~2 GB'a düşer, tip denetimi (~2,5 GB) "heap out of memory" ile çöker. Tavan artık
  `ci.yml` adımlarında ve Dockerfile derleme aşamasında AÇIK (4 GB; pin `tests/unit/build-memory-limit.test.ts`). Bu konteynerde
  `NODE_OPTIONS` 8 GB olduğu için hata yerelde GÖRÜNMEZ → tip denetimi 4 GB'a yaklaşırsa `NODE_OPTIONS=--max-old-space-size=4096 npx tsc
  --noEmit --extendedDiagnostics` ile ölç ("Memory used").
- **Git:** commit author `user.email noreply@anthropic.com` / `user.name Claude`; yedek TAG değil BRANCH
  (`backup/stable-YYYY-MM-DD`); commit mesajında backtick yok → heredoc.
- **`crypto-core.key()` sırası `ENCRYPTION_KEY || AUTH_SECRET`.** `*-undecryptable` alarmında ÖNCE
  salt-okuma teşhis (`scripts/diagnose-hospitable-tokens.ts`), SONRA satır silme.
- **ENCRYPTION_KEY ROTASYONU ASLA** (token'lar + 8 takvim feed URL'i kırılır). Anahtar kasada, DB
  yedeğinden AYRI; DB yedeği tek başına kurtarma değildir.
- **APP_URL sabit taban:** e-posta linkleri/OAuth redirect `appBaseUrl()`; tarayıcı redirect'leri
  `baseUrlFromHost` (allowlist). Railway arkasında hiçbir rota `req.url`'den mutlak URL kurmaz.
- **`"https://www.lixusai.com"` literal'i yalnız app-config'de** (tek kaynak pini).
- 🚨 **KURUCUNUN GERÇEK İŞLETME ADI REPOYA YAZILMAZ (09-11):** 95 dosyada 296 geçiş vardı
  (fikstür mülk adları, örnek SSID'ler, yorumlarda "… canlı hesabı"). Hepsi temizlendi: fikstürlerde
  kurgusal **`Lale`**, canlı hesaba atıflarda **"kurucu org"**. Yeni fikstür yazarken gerçek müşteri /
  işletme adı KULLANMA. 🚨 **ARTIK MEKANİK PİN VAR** (`tests/unit/brand-name-absent.test.ts`):
  `git ls-files` üzerinden TAKİP EDİLEN her dosya taranır (iki varyant). Gerekçe ölçüldü —
  temizlikten SONRA ad `34fc701` ile fikstüre GERİ GELDİ ve push edildi; mutasyon turunda
  "adı geri koy" mutantı HAYATTA KALMIŞTI. ⚠️ Aranan kelime O DOSYAYA DA YAZILMAZ (iğne karakter
  kodlarından); anti-vakumluk ayrı satırda (repoda kesin bulunan bir kelime BULUNMALI, yoksa git
  bozulunca iddia sessizce boş liste döner). Kapsam ÇALIŞMA AĞACI — geçmiş commit'ler kapsam
  DIŞI (geçmiş yazımı ister; `origin/main` TEMİZ, iki eski dal ucu hâlâ taşıyor, karar kurucunun).
  ⚠️ `Lale` fikstür seçimi ÖLÇÜLDÜ: etiket (`daire/no/apt`) değil, sayaç
  (`kişilik/yatak`) değil, cihaz listesinde yok → `apartmentNumberOf`un "tek sayı" dalını eski adla
  BİREBİR aynı şekilde sınar (test davranışı değişmedi).

## Teknik mimari
- Next.js 15 App Router · Prisma 6 · PostgreSQL · Railway (branch `claude/great-edison-3zqpZ` oto-deploy,
  "Wait for CI" AÇIK → kırmızı CI deploy'u atlar). Boot: `verify-env && migrate deploy && npm run start` (ortam kontrolü migration'dan ÖNCE — 11-25, K19); prestart
  `scripts/verify-env.mjs` tek env-doğrulama kaynağı. `/api/health` readiness; `?strict=1` ops. Yalnız "1" ile açılan bayraklar
  (`STRICT_ONE_FLAGS`, kaynakla pinli) başka yazımla ("true") verilirse açılışta UYARI (A7 #1; davranış aynı — KB_* "true"yu kabul eder).
- Multi-tenancy `Organization`; superadmin (`SUPERADMIN_EMAILS`) impersonation ile girer (JWT
  `actorUserId`). Tüm rotalar org-scoped (`api-route-scoping.test.ts` pinler).
- Auth: JWT + `sessionEpoch`; `withAuth/withManage/withOwner` (route-guard.ts); 2FA TOTP; `mfa` iddiası.
- Hospitable: per-tenant şifreli token (`getOrgHospitableToken` TEK fonksiyon; PAT veya OAuth refresh).
  `financials:read` YOK → gelir özelliği bilinçli KALDIRILDI. Env-token fallback yalnız `PRIMARY_ORG_ID`.
- Sync: `SystemLock` "scheduled-sync" + 2 dk in-process cron (`instrumentation.ts`) + `/api/cron/sync`
  (`CRON_SECRET`). Manuel sync `withSyncLock`.
- **Giden mesaj: Channel Layer (`src/lib/channels`, V0.1)** — `sendOnChannel` ve outbox worker
  `dispatchOutbound`'a gider; `hospitable.sendMessage`'ın tek çağıranı `channels/hospitable-outbound.ts`.
- Çeviri istemi (`ai/translate.ts`): sağlayıcıdan gelen kaynak dil sistem satırına YALNIZ dil kodu biçiminde girer (09-28).
- Model: OpenAI `gpt-5.1` (`OPENAI_MODEL`; `DEFAULT_OPENAI_MODEL` kod içi son çare). Değiştirme =
  gönderim hot-path'i rekalibrasyon; yalnız gerçek arıza + A/B. `ai/openai-compat.ts` TEK KAYNAK DEĞİL
  (`ai/index.ts` ve `translate.ts` OpenAI'yi doğrudan çağırır; `openai-request-contract.test.ts` pinler).
  Katman bazında model / çaba (10-01, kurucu "her katmanı ayrı doğrulayalım"): `AI_UNDERSTANDING_MODEL` · `AI_STAY_GUARD_MODEL` ·
  `KB_RERANK_MODEL` (+ `*_REASONING_EFFORT`) boşken `AI_SEMANTIC_*` ortak ayarı; `OPENAI_TRANSLATE_REASONING_EFFORT` /
  `OPENAI_STYLE_REASONING_EFFORT` yalnız reasoning modelinde gönderilir. Ölçüm raporu katman bazında model + gönderilen çaba + istem
  kimliği (SHA-256 ilk 12) taşır (`tests/eval/run-meta.ts`).

## AI güvenlik mimarisi (ürünün kalbi)
> 📄 **Tam metin (bağlayıcı): `docs/claude/ai-guvenlik.md`** — bu alanda kod / karar değiştirmeden önce oku. Aşağıda yalnız madde başlıkları.
- Tek kaynak:
- 🚨 UZUN MİSAFİR MESAJI (K10-t, kurucu kararı 09-28, tek kaynak `ai/message-length.ts`):
- 🚨 MİSAFİRDEN TÜREYEN METİN VERİ (K10-s, kurucu onayı 09-28):
- 3 seviye:
- Kod kapısı `passesAutoReplySafetyGate`
- Model çıktısı STRICT (F01):
- GOLDEN SET
- Görünmez karakter = `\p{Default_Ignorable_Code_Point}` + `\p{Cf}` + U+2800
- QR bağlamı:
- QR misafir rotası:
- 🚨 DOĞRULANMIŞ MÜSAİTLİK + UZATMA (10-09, anahtarlar KAPALI; `ai/verified-availability.ts`, `ai/verified-extension.ts`): yalnız KOD metni + bütün şartlar — tam metin `docs/claude/ai-guvenlik.md` sonu.
- TARİH OKUMASI (10-10, anahtar KAPALI; `ai/date-reading.ts`): tarihler kodla, her mesaj kendi yazıldığı ana göre; gece yarısı "yarın"ı belirsiz — tam metin `docs/claude/ai-guvenlik.md` sonu.
- 🚨 "BİLGİM YOK" MİSAFİRE ASLA GİTMEZ (kurucu kuralı 09-11, `ai/absence.ts`):
- Çıktı vetosu / makbuzsuz iddia:
- Konuşma kuralları:
- 🚨 **KONUŞMA KAYITLARI (CUS v1 dilim B, 09-25, `ai/conversation-state.ts`; bayrak `AI_CONVERSATION_STATE_ENABLED`
- 🚨 **EYLEM BEYANI (`claimedActions`, 09-25, `ai/action-claims.ts`; bayrak `AI_ACTION_CLAIMS_ENABLED` varsayılan KAPALI;
- 🚨 KB talimat-ele-geçirme süzgeci (`detectKbInstructionHijack`, 09-23):
- 🚨 ANLAM KATMANI (09-24, kurucu: "kelimeye takılma, anlamı modelle çıkar"; `docs/ANLAM-KATMANI-2026-09-24.md`):
- 🚨 **DOĞRULANMIŞ ERKEN GİRİŞ (09-24, kurucu: "hassas istek = ENGEL değil, doğrulama iş akışı"; `lib/early-checkin`,
- Misafirin yazdığı çıkış saati (`guestCheckoutTime`) BEYANDIR (C-9, tek kural `lib/guest-checkout-time.ts`):
- Görev durumu + geçmiş kaydı TEK işlemde (C-17, `api/tasks/[id]`):
- Yaşam döngüsü görevleri rezervasyon tarihini izler (C-16, `lib/tasks/follow-reservation.ts`):
- 🚨 TEMİZLİKÇİ GÖRÜNÜMÜ (09-24, `lib/tasks/staff-view.ts` TEK kural):
- 🚨 KAPI KANITI + SÖZCÜKSEL/ANLAMSAL AYRIM (09-25, `ai/gate-evidence.ts`, belge `docs/MESAJ-ANLAMA-CEKIRDEGI-2026-09-25.md`):
- 🚨 KAPANIŞA SESSİZLİK (kurucu kuralı 09-25, `ai/closing-turn.ts`):
- 🚨 ZAMAN BAĞLAMI TEK KAYNAK `ai/stay-timeline.ts` (09-25):
- 🚨 Ev sahibi metninde ödeme yöntemi/yeri TEK KAYNAK `payment-method-guard.ts` (09-25) — ŞÜPHEDE REDDET:
- KB sır kapısı
- Yer tutucu:
- İstem bütçesi:
- İddia desteği GÖLGE ölçümü (`ai/claim-support.ts`, 09-23):
- Dil:
- 🚨 MİSAFİRİN DİLİNDE CEVAP (09-25, `ai/language-signal.ts`; kurucu: "5.1'in zayıf noktasını düzelt"):
- Üslup: duygu beyanı/temenni/çelişki/dolgu-soru yasak; "siz"; ben-dili. Injection kara listesi yapısal olarak

## Canlı durum (Railway env'leri)
> 📄 **Tam metin (bağlayıcı): `docs/claude/canli-durum.md`** — env / bayrak / model / canlıya açma işinden önce oku. Özet: Railway 10-02
> akşamdan beri KAPALI (canlı yok; push yalnız CI'dan geçer, deploy olmaz); cevap modeli `OPENAI_MODEL=gpt-5.1`; açılmayı bekleyen
> anahtarlar + sıra `docs/RAILWAY-ACILIS-2026-10-15.md` (koddaki her `*_ENABLED` orada adıyla geçer — pin `railway-doc-flags.test.ts`).

## Fiyat + mevcut özellikler
> 📄 **Tam metin: `docs/claude/fiyat-ve-ozellikler.md`** — fiyat / plan / landing işinden ve yeni özellik eklemeden önce oku (var olan
> özellik yeniden eklenmez).

## Hospitable
> 📄 **Tam metin: `docs/claude/hospitable.md`** — Hospitable / OAuth / senkron / webhook işinden önce oku. Özet: OAuth uygulaması Partner
> Portal'da PRODUCTION onaylı; webhook'lar açılabilir ama KULLANILMIYOR (kurmak yeni sistem → önce sor); amaç Hospitable'dan AYRILMAK,
> Hospitable'a özgü yeni ekran / özellik yapılmaz.

## Çalışma tarzı
- 🚨 **KODDAN ÖNCE UZUN DÜŞÜN (kurucu 10-22 gece):** "en iyi, en uzun vadeli yöntem ne olabilir" — kodlamaya başlamadan önce mevcut kodda ne
  var / ne eksik envanteri, araştırma, alternatif akışlar ve tasarım belgesi; acele çıktı yok. Tasarım `docs/TASARIM-*.md`'ye yazılır, müşteriye
  dokunan kısım önce/sonra örnekli soruya döner.
- 🚨 **ALT AJAN = HAIKU 5.5 (kurucu 10-08: "haiku 5.5'i subagentin olarak kullan, bol bol yardım etsin"):** tarama / envanter / ölçüm /
  doğrulama işleri `Agent` aracıyla `model: "haiku"` (çoğunlukla `subagent_type: Explore`) çalıştırılır; dar, net, kısa çıktılı görev
  verilir; bulgular kodla doğrulanır; kodu Claude yazar. Yasak dosyalar (sealed / private / holdout) ajana da AÇILMAZ.
- 🚨 **İNCELEME DÖNGÜSÜ (kurucu 10-15):** her dosya yazımı / değişiklik grubundan sonra Haiku 5.5 alt ajanı dar inceleme yapar; dilim bitince
  Opus 5.5 "en derin ve sert" büyük kontrol (bulgularını ilerledikçe dosyaya yazar — kesme olursa kaybolmasın). Derin araştırma / tasarım
  işleri Opus 5.5. Kesme ("Request interrupted") o turun alt ajanlarını durdurur → yeniden başlatılır. Railway açılana kadar kodla
  yapılabilecek her şey yapılır.
- 🚨 **ÇALIŞIRKEN GELEN YENİ MESAJ (kurucu 11-13):** eldeki iş yarıda KESİLMEZ. Kurucu "hemen / acil" demedikçe yeni mesaja hemen geçmek
  zorunlu değildir; aciliyetine göre değerlendirilir. Eldeki iş bırakılabileceği sağlam bir noktaya getirilir (yarım dosya, kırmızı test,
  karışık commit edilmemiş değişiklik bırakılmaz), sonra yeni mesaja geçilir. İki iş de unutulmaz: bekleyen iş ve nerede kaldığı görev
  listesine yazılır, sonra oradan sürdürülür. Yeni mesaj eldeki işi değiştiriyor ya da durduruyorsa iş boşuna sürdürülmez, en yakın sağlam
  noktada durulur.
- 🚨 **HATA AYIKLAMA / İNCELEME AJANI HATA ÜRETMEZ (kurucu 11-13):** hata bulmak İÇİN hata bulmaz; hata bulamaması onun hatası olmayabilir;
  HATA OLMAYANI HATA GİBİ GÖSTERMESİ ÇOK DAHA KÖTÜDÜR. Bu cümle hata ayıklama / inceleme ajanının istemine yazılır; bulgu dosya:satır + somut
  senaryo taşır, kanıtlanamayan "emin değilim" diye ayrı yazılır, "bulgu yok" geçerli sonuçtur; ana oturum her bulguyu kodda doğrular.
  Araştırma ajanı bu kuralın konusu DEĞİLDİR — kod hatası aramaz, araştırma yapar.
- **Hata ayıklama ajanı konu döndürür (kurucu 11-20: "P1 ve P2 bulamamaya başlayınca o spesifik yer için agentları başka konuya geçir,
  zorla hata buldurmuş gibi olmamıza gerek yok, kontrolleri sen güzelce sağla"):** bir alanda makul çabadan sonra P1 / P2 çıkmıyorsa alan
  "temiz (ne denendi)" diye kaydedilir ve ajan başka konuya geçirilir; P3'ler tek satır. Bulguların kontrolü ve doğrulaması ana oturumdadır.
- **Kurucu cevap incelemesi (10-08):** ölçüm yan dosyalarından (`docs/olcum/*.json`) çıkan misafir mesajı → yapay zekâ cevabı çiftleri
  `scripts/review/build-review-set.py` ile toplanır, sayfa https://claude.ai/artifact/DFkiB4FkXrNagEtHnGTXXN (veri `review-set.json`,
  yorumlar sayfanın veritabanında `reviews/m<mesaj özeti>` — soru başına kararlı kimlik, eski `q…` / çift kimlikli kayıtlar da okunur: verdict good/fix/bad · better · note). Kurucu yorumları `ArtifactData list
  reviews` ile okunur; "daha iyi cevap" önerileri istem / eval işine girdi olur (karar değil — uygulamadan önce kurucuya sorulur). Yeni ölçüm
  sonrası set yeniden üretilip aynı adrese yayımlanır.
- 🚨 **ÖLÇÜMDE HATA → NEDEN ANALİZİ (kurucu 10-11: "hata olunca hemen nedenini gör, önerdiğin döngü gibi olsun"):** `tests/eval/failure-analysis.ts`
  — ① modelin açıklaması (İPUCU, sonradan gerekçe) ② karşı deneme (ifade çıkar, aynı katman yeniden; KANIT, modelin iddiası da sınanır)
  ③ düzeltme katmanı önerisi (test beklentisi · bilgi · istem · kod kuralı · model sınırı; seçen insan, misafire gideni değiştiren düzeltme
  kurucuya sorulur) ④ doğrulama (aynı vakalar + kör set). Ölçer hata verince kendiliğinden koşar (`<koşu>-neden.md`); katman başına
  bağdaştırıcı (anlama: `failure-analysis-understanding.ts`) — yeni ölçere de bağlanır. Ücretli koşu yine kurucu onayıyla.
- **`docs/TEST-EVIDENCE-CONTRACT.md` bağlayıcı**: K2 için kırmızı-önce · kaldırma mutasyonu · aşırı-uygulama
  kontrolü · integration · tam kapılar; rapor KOD/CI/DEPLOY/PROD ayrı; "test gerekmiyor" gerekçeli.
- **Codex protokolü:** doğruysa uygula, daha iyisini biliyorsan gerekçeyle reddet; son karar karşılıklı. Codex'e itaat zorunlu DEĞİL (kurucu 11-05): önerisinin üstüne koy — daha doğru / eksiksiz çözümü uygula ve gerekçesini yaz; kurucu bunu her seferinde hatırlatmak zorunda kalmasın.
- **`npm test` = PARALEL KAPI (kurucu 10-16, `scripts/test-gate.mjs`):** veritabanlı kol tek sıra + veritabanısız kol 3 işçi AYNI ANDA,
  süre ölçen testler (`*-cost/-perf` + `performance.now()`/`toBeLessThan`) en sonda tek başına; sınıflama `tests/test-partition.mjs`
  (yeni `integration` dosyası varsayılan veritabanlı kol). Geri dönüş: `npm run test:serial` (eski seri düzen). Ölçüm `docs/arastirma-2026-10-15/test-paralellik.md`.
- **🚨 Tam suit koşarken BAŞKA vitest KOŞMA:** `tests/global-setup.ts` her `vitest run`'da PG 5433'ü `stop -m
  immediate` + `initdb` ile sıfırlar → paralel koşu süren suit'in DB'sini öldürür (ölçüldü: 42–59 sahte kırmızı
  dosya). Mutasyon script'leri de vitest'tir. Süreç öldürürken `pkill -f "vitest run"` YETMEZ (kendi kabuğunla
  eşleşir, `node (vitest)` ana süreciyle eşleşmez; yetim ana süreç bitince teardown'ı yeni koşunun PG'sini kapatır)
  → `pkill -f "node \(vitest"` + `ps | grep "[v]itest"` ile doğrula. Eval config'i (`vitest.eval.config.ts`) DB kullanmaz, tam
  suit ile paralel koşabilir.
- 🚨 **MÜŞTERİYE GİDEN METİN SADE (kurucu 09-23):** teknik açıklama ("bayt", "ş 2 bayt sayılır", kova, TOTP…)
  ve gereksiz uzatma müşteriye GİTMEZ; yalnız ne yapması gerektiği söylenir, büyük platformların deyimiyle.
  Fiil seçimi de ürün dilidir: kullanıcı şifre "seçmez", OLUŞTURUR; hitap sitenin geri kalanı gibi "-in"
  ("…daha kısa bir şifre oluşturun."; "-iniz" değil). Kurucu seçimi 09-23, pinli.
- 🚨 **MİSAFİRE GİDEN HER METİN EV SAHİBİNİN AĞZINDAN (kurucu 11-06: "3. tekil şahıs gibi konuşmak yasak, host yazıyor gibi düşün, bir
  daha böyle bir hata yapma"):** "ev sahibiniz …", "your host …" gibi üçüncü şahıs YASAK; ben / biz dili ("transfer hizmetimiz var").
  Tasarım belgelerindeki ÖRNEK misafir metinleri DAHİL (hata 11-06'da bir tasarım örneğinde yapıldı). Kod kuralı `ai/host-voice.ts`.
  Sabit QR metinleri pinli (`tests/unit/guest-chat-copy-host-voice.test.ts`). Yapay zekâ cevabında (kurucu 11-06 gece: "yasaklamadan en aza
  düşsün, cevapları bozmasın"): istem birinci çoğul ister + `reply_host_voice` kapısı tutar; bedeli ücretsiz ölçümle izlenir
  (`tests/eval/host-voice-replay.ts` — 10-30 sonrası cevapların %3,2'si YALNIZ bu kapıya takılıyor, çoğu "ev sahibiniz daha iyi bilir"
  ertelemesi); kapıyı gevşetmeden önce ölçüm.
- **Hospitable'a özgü yeni ekran/özellik YAPILMAZ (kurucu 09-23: "amacımız Hospitable'ı kaldırmak"):**
  bağlantı sağlığı gibi yüzeyler sağlayıcıdan bağımsız `ChannelConnection` üzerine kurulur (Airbnb Direct'i de taşır).
- **Ajanlar yalnız araştırır/ölçer/doğrular; kodu Claude yazar.** Bol paralel ajan, bulguları kodla doğrula
  (yarısı yanlış), kısa format. Kurucunun AÇIK kararını uygula (yeniden sorma); klişe yok.
- 🚨 **SORMADAN SİSTEM KURULMAZ (kurucu 09-26: "rezil bir durum, bir daha olmasın"):** kurucunun isteğini YORUMLAYARAK
  yeni bir sistem / kapı / ürün davranışı kurulmaz — yorum gerekiyorsa ÖNCE kısa soru. Örnek: "kontrol etmeden cevap
  vermesin" onayı sorulmadan KONUŞMA DÜZEYİ bir kapıya çevrildi, istenen ÖĞE bazıydı (`6c0e6b4`, gönderilmedi). ChatGPT /
  Codex / ajan önerisi KARAR DEĞİLDİR ("ChatGPT de yanlış söylüyor olabilir, bana sor"): iddia kodda ölçülür, uygulanıp
  uygulanmayacağı kurucuya sorulur. **ÖNERİ BİÇİMİ (kurucunun sözleri):** "bunu böyle yapıyorum · büyük şirketler böyle
  yapıyor · önerim bu · ÖRNEK: şöyle bir mesaj gelirse şöyle cevap veriyor / şöyle davranıyor · böyle yapalım mı?" —
  kararı değiştiren her öneride somut mesaj → davranış örnekleri (önce / sonra) gösterilir. **09-27 inceltme (kurucu):** Codex /
  ajan önerisi HEMEN kabul edilmez, kodda ÇALIŞTIRILARAK doğrulanır; kolay + doğru + müşteriye gideni ETKİLEMİYORSA yapılır ve
  haber verilir; müşteriye gidecek cevaba dokunuyorsa önce/sonra örneğiyle SORULUR; daha iyisi biliniyorsa gerekçeyle itiraz
  edilir. Kurucunun sözü Codex'inkinden önce gelir. Takip tablosu: `docs/INCELEME-2026-09-27-codex-ve-10-ajan.md`.
- Kalıcı kararlar buraya, gerekçeler git log/arşive.

## Kalıcı kararlar (yeniden tartışma yok — gerekçe: arşiv + git log)
> 📄 **Tam metin (bağlayıcı): `docs/claude/kalici-kararlar.md`** — bu alanda kod / karar değiştirmeden önce oku. Aşağıda yalnız madde başlıkları.
**Denetim/kanıt — Codex 2026-09-05 (hedef `73dbfb4`; rapor `docs/audit-2026-09-05/`, tur durumu `DURUM.md`)**
- F08 test DB kapısı
- F01 model çıktısı STRICT
- F02 QR sır filtresi TAM TARAR
- F03 silme → kuyruk sözleşmesi:
- F04 OAuth refresh CAS
- F05 teslim ACK'i koşullu
- F06 sayfa yolu DB arızası:
- F07 retention bayrak-AÇIK seçici
- Kalan P2 (ayrı modül turları):
- Kaynak taraması tek yönlüdür → davranışsal test; `rejects.not.toThrow(/…/)` kullanma; senkron CPU
- Ret edilenler: ETag testi (hedef yok) · HTTP/2 parser testi · kanonik-posta-kutusu kayıt limiti ·
**Kimlik / oturum**
- 🚨 BÜRÜNME = SALT-OKUNUR DESTEK GÖRÜNÜMÜ (K8, kurucu kararı 09-28, `auth/impersonation.ts`):
- 🚨 OTURUM ÇEREZİ `__Host-guestops_session` (09-23 ikinci tur, kurucu onayı):
- Epoch artıran kimlik işlemi BU CİHAZI yeniden imzalar:
- Parola biçimi (③):
- Hız sınırı kovası `rateLimitClientKey(req)`
- 🚨 OTURUM İÇİ YENİDEN DOĞRULAMA GÜNDE 20 HATA — TEK ORTAK SAYAÇ
- Giriş sonrası `?next=` API yolu olamaz
- 🚨 PAROLA ASLA KIRPILMAZ (09-23):
- 🚨 bcrypt EŞZAMANLILIK KAPISI (`auth/password.ts`):
- Doğrulama e-postası ve DENEME (trial) e-postaları kişiselleştirilmez
- Süper-admin e-postası JWT iddiasından okunur
- 🚨 ROL DEĞİŞTİREN / EKİPTEN ÇIKARAN akış ÜYELİK KUŞAĞINI artırır, `sessionEpoch` DEĞİL (#211, kurucu 11-06 Ü-4 — yalnız o işletmede düşer):
- 2FA aktifliğinin tek koşulu `twoFactorEnabledAt`; bayat secret arıza değil → `/admin` "2FA'yı sıfırla"
- Operatör yetkisi = allowlist + `mfa === true` (`isSuperAdmin`, tek boğaz noktası). `login` `mfa`yı
- "Beni hatırla" (trusted-device) iki epoch'a bağlı (2FA + `sessionEpoch`); şifre değişimi/sıfırlama ve 2FA
- E-posta doğrulama: token fragment'te (`#t=`) + `POST` + PAROLA şart (ön-ele-geçirme kapandı); GET'i geri
- Şifre sıfırlama m47 challenge modeli: bütçe challenge satırına ait, token fragment'te, `middleware.ts`
- `readJsonCapped` `Content-Type: application/json` ister (öz karşılaştırma; virgül ham değerde).
- Login: hesap kovası doluyken doğru parolayla da YALNIZ tanınan cihaz girer (09-23; bilinmeyen tarayıcı 429, sahibin yeni
- `GET /logout` CSRF'i, per-session `jti`, halka açık sayfada çerez yenileme → açık tasarım kararları.
**Tenant / rotalar**
- Uyarı adresi (09-30, bayrak `ALERT_EMAIL_VERIFY_ENABLED` KAPALI → bugünkü "yalnız ekip üyesi" kuralı):
- `api-route-scoping.test.ts`: her rota org-kapsamlı ya da gerekçeli public listesinde; `admin/*`
- Anonim rotalarda da JSON kontrolü IP kovasından ÖNCE (#211, 09-27):
- QR sayfası + GET `resolveGuestChat(…, { knowledgeBase: false })` (#211):
- Kiracılar arası davranışsal test reddin SEBEBİNİ sınar (#211):
- Rol kapısı pini (#211, `api-route-role-gate.test.ts`):
- `cron/sync` · `cron/email-outbox` · `leads` davranışsal pinli (`timingSafeEqual` yapısal pin dahil).
- Hız limiti: `pickClientHop` sağdan `TRUSTED_PROXY_HOPS` (Railway 2); az tahmin güvenli, fazla tehlikeli;
- Ayar değişikliği audit'li (alan adları, değerler değil). `properties/[id]` DELETE ve `admin/leads` PATCH
- API yanıtında gizli / iç alan yok:
- Yükleme: private mimari (imzalı GET, `orgIdFromKey` 404, sihirli bayt, SVG/HTML yok); prod'da yerel
- CSP: enforce'ta `form-action 'self'`, `script-src` enforce EDİLMEZ; report-only'ye `report-uri`
- iCal SSRF: pinned DNS, redirect yok (3xx hata), private/link-local/IPv6 multicast blok, yalnız 443
- Landing iframe'leri Google Fonts çekmez (self-hosted woff2, latin+latin-ext ikisi de şart); CSP
- `/_next/image` kapalı (`images.unoptimized`); `next/image` kullanılırsa önce `sharp` kontrol.
**Veri yaşam döngüsü / KVKK**
- Scrub kapsamı kuralı: misafir metni/adı taşıyan her kolon `anonymizeOldGuestData` VE `maskReservationRows`
- Erasure tombstone guard'ları HER ingress'te: hospitable-sync · iCal · elle `.ics/.csv` · QR
- Retention: süre-bazlı rejim ≠ açık silme rejimi; scrubbed satıra PII geri yazılmaz; cutoff'tan eski
- 🚨 MİSAFİR HİTAP ADI + ADIN KÖKENİ (migration 57, kurucu onayı 09-28, `lib/guest-name-source.ts`):
- 🚨 ADSIZ YAPAY ZEKÂ + KODLA SELAM ("D", kurucu onayı 09-28; anahtar `AI_CODE_GREETING_ENABLED` VARSAYILAN KAPALI, `ai/code-greeting.ts`):
- Kalite denetçisi (Claude = ikinci işleyen) girdisinde sır DEĞERLERİ maskelenir (#211):
- Ad silme `redactNameFromBody` Türkçe harf aileleriyle eşleşir (09-28):
- Redaksiyon yapısal (`lib/redact.ts` — YAPRAK modül, hiçbir şey import etmez; `report-error-core` yeniden dışa
- Hesap silme Invoice/Consent/AuditLog'u da siler (migration ister, açık). `Organization.plan` kolonu ölü.
- Takvim feed URL'i at-rest şifreli (`urlEnc`+AAD), prod'da düz URL yok; doğrulama yalnız `--post-contract`.
**Mesajlaşma / outbox / sync**
- 🚨 "KAYDEDİLDİ" ≠ "KANAL KABUL ETTİ" ≠ "İŞ ÇÖZÜLDÜ" (11-18, `lib/delivery-outcome.ts`):
- Cevap rotasında çeviriyle gönderim YOK; kaldırılan alan sessizce yok sayılmaz, reddedilir (11-18, `api/conversations/[id]/reply`):
- Karar mesajında bağlı ihtiyaç YALNIZ KANITLA kapanır (11-18 akşam, `decisions/decide.ts`) · giden mesaj satırı teslim yolunu taşır (`lib/delivery-path.ts`):
- Otomatik mesajın gönderilebildiği rezervasyon durumu TEK KAYNAK; kuyrukta onayı kalkmış rezervasyon İPTAL değil ERTELEME (11-18, `lib/lifecycle-status.ts`):
- Otomatik mesaj aday taraması: metinsiz daire sorguda elenir + kalıcı imleç + tavan alarmı; iki FARKLI dairede etkin kayıtlı rezervasyonun mesajı TUTULUR, sistem daire tahmin etmez (11-18 akşam, `lib/booking-property-conflict.ts`) · karar mesajı kuyruk açıkken de doğrudan gider, operatör freni geçerli (11-18):
- QR'da SÜREN istek "kaydedildi" DEĞİLDİR (`pending`, 11-18, `outbound-claim.ts`):
- 🚨 SAĞLAYICI HATASI SARMALA KÖR OKUNMAZ (09-23 olayı):
- 🚨 PERİYODİK İŞİN ALARMI GEÇİŞ TABANLIDIR (09-23, `src/lib/alert-state.ts`, migration YOK):
- Kimlik e-postası kurtarması HER geçişte
- Channel Layer (V0.1–V0.2, `src/lib/channels`):
- Provenance (V0.4, migration 50 — CANLI 09-07 19:29Z, kanıt envanter §11):
- Messaging capability (V0.5 — CANLI, envanter §12):
- Ingest (V0.6, migration 51 — CANLI 09-08 03:13Z, envanter §12):
- Bağlantı durumu + kimlik çözümü (V0.7 kod hazırlığı — CANLI 09-08, envanter §13):
- ChannelConnection (V0.3, migration 49 — CANLI 09-07, kanıt envanter §10):
- Claim-then-send her yolda; claim TTL 120 sn; definitive (4xx≠408) → release+retry, ambiguous → claim
- Durable outbox (bayrak kapalı): kapalı state seti, `ERASABLE_STATUSES` tek kaynak; teslim etkisi üç
- CLAIM-THEN-NOTIFY: atomik işaret + yan etki → yan etkinin SONUCU okunur; `emailService.send` bildirim
- Escalation üç yol (model · kelime alerts · `applyInboundMessageRules`); m48 triyaj ikinci model çağrısı
- Rezervasyon durumu (#211):
- Yaşam-döngüsü sorguları `calendarSourceId: null` (kanal iCal işaretçisi DEĞİL); elle `.ics` `channel:"ics"`;
- iCal abonelik senkronunda kayıt kimliği (09-30, inceleme b1):
- 🚨 EKSİK iCal OKUMASI HÜKÜM VERMEZ (F16, 09-26):
- Sync motoru: fencing token + TTL 15 dk; heartbeat ilerleme-tetikli; `renewLock` geçici hata ≠ kayıp; 🚨 org sırası
- Provider mesajı sessiz atlanır ve imleç ilerler (bilinçli; ölçüm sayacı var).
- Sağlayıcı dizesinden NUL silinir (09-28, `canonicalStr`):
- Günlük AI kotası oto-yanıtı da sayar; tavana çarpınca konuşma `new` kalır; kart "AI işlemi" der. Model cevap verip çıktı
- Yeni org 7/24 açık doğar. 🚨 **09-12 GÜNCELLEME — bu satır "şema varsayılanı DEĞİŞMEDİ" diyordu ve
- Plan sınırları POST/PATCH/COPY hepsinde; yalnız büyüme reddedilir; fail-open (kullanım kapısı).
- Şablon yer tutucu ikamesi TEK GEÇİŞ (`replace` + callback); sıralı split/join ASLA.
**Faturalandırma**
- 🚨 ÖDEME ALINDI, ABONELİK BEKLENİYOR — SÜREYLE KAPANMAZ (11-18, `lib/billing/checkout-paid.ts`):
- Yeniden işleme vadesi OLAYIN KENDİ SATIRINDA (11-18 akşam, migration 98) · dış sisteme yazmadan HEMEN önce yerel satır yeniden okunur (11-18):
- Kayıtlı abonelikten FARKLI aboneliğin olayı planı değiştirmez (K4, 09-30: ters sırada gelen eski iptal yeni aboneliği ezmiyordu).
- Bağlanamayan ödeme sessiz kalmaz (10-01, 15 ajan A10 F1):
- previewToken HMAC + `jti` tek kullanım; apply öncesi re-preview (409 amountChanged); definitive/ambiguous
- Yıllık = aynı plan kodu (ayrı "pro_yillik" YOK); `annualAvailable` = 3 env; başlık aylık, alt satır
**Kanal sözleşmesi / müsaitlik / demo (09-24)**
- Sağlayıcı kimliği ≠ OTA etiketi:
- Yetenek manifestosu
- Airbnb Direct adaptörü ağa ÇIKMAZ
- Müsaitlik: tek tarih kuralı `calendarDateOf`
- Demo hesabı
**AI / QR / diğer ürün kararları**
- 🚨 **HOST KARAR MOTORU (10-02 gece, kurucu: "cevap vermek talebi çözmek değil"; anahtar `HOST_DECISIONS_ENABLED` VARSAYILAN KAPALI; migration 59
- Görev: vade işletme saat diliminde okunur · elle görev istek kimliğiyle tekrar güvenli · pano atamada gördüğü atananı ön şart yollar (11-18):
- QR: per-stay device binding; `isOpenNow` simetrik; `chatToken` rotasyonu YOK (bilinçli); PIN DoS tasarımı
- AI öneri paneli kapatılabilir, tercih KALICI DEĞİL. Bekleyen misafir mesajları dar taranıyor
- 🚨 K8 / K9 (kurucu kararı 09-30):
- 🚨 ŞİKÂYETE BAĞLI İSTEK CEVAPLANMAZ (kurucu kararı 10-01, ANAHTARSIZ; `conversation-items/core.ts complaintDependent`):
- 🚨 BEKLEYEN RİSK ÖĞE BAZINDA (kurucu 09-26):
- 🚨 **KONUŞMA ÖĞELERİ (öğe bazlı risk; 09-26, migration 56; `AI_CONVERSATION_ITEMS_ENABLED=1` CANLI — kurucu 09-26; tasarım
- Mülke özgü ev kuralları (#188, `docs/TASARIM-2026-09-26-ev-kurallari-politikasi.md`) ONAYLANDI ("en mantıklı şekilde"):
- Doluluk gece-katı; ikinci kutucuk `sameDayTurnovers`; üçüncüsünü önerme. Kullanıcının geri aldırdığı
- Tarayıcı saat dilimine güven `APP_TRUST_BROWSER_TIMEZONE` default kapalı. S3 virtual-hosted, noktalı
- Tedarik zinciri: zafiyet kapısı = sıfır TRİAJSIZ (`security/audit-baseline.json`, `expires` zorunlu),
- Operatör scriptleri (PG/Windows): en yüksek kurulu pg sürümü, tüm exe'ler aynı klasör, saf ASCII,
- SEO/landing dürüstlük: (app) noindex; mutlak iddia yok; "AI yanıtı" değil "AI işlemi".
- .eu açılışı: ayrı deployment (env: `APP_URL`, `APP_LOCALE`, `APP_BILLING_CURRENCY`, `APP_DEFAULT_TIMEZONE`,

## Açık işler + bu alanların kalıcı kuralları
> 📄 **Tam metin (bağlayıcı): `docs/claude/acik-isler.md`** — bu alanda kod / karar değiştirmeden önce oku. Aşağıda yalnız madde başlıkları.
**V0 kalanları:** kolon contract'ı okuyucuları (backfill · token teşhisi · connect rotası · credentials kolon
**GEREKSİNİM (uygulanmadı):** doğrudan kanal + iCal aynı mülkte; aynı kanalın iCal'i pasif/yedek, diğerleri
**AÇIK QR kalitesi:** boş KB'de devir emergent (eşik = güvenlik kapısı, GOLDEN SET ister); hakaret/kışkırtma
**Şikâyet sınıflandırıcı (`fallback.ts`; 8 inceleme turu, 09-10/11) — kurallar:**
- 🚨 Acil ağı BAĞLAMLA (K6, kurucu kararı 09-30, `neutralizeNonEmergency`):
- 🚨 Kısa acil sözcükleri TAM SÖZCÜK (09-26, kurucu onayı, #51):
- 🚨 Sözcük İÇİ / öbek çakışması acil DEĞİLDİR (10-02, kurucu onayı — Sabah Kararları 49):
- Kural konusu ağında Türkçe "parti" TAM SÖZCÜK (10-02, aynı sınıf):
- Olumsuz fiil kalıpları ÇAPALI (tesis adı + fiil; gövde "-yo" ile: gelmiyor/gelmiyo). Çıplak `gelmiyor · gitti ·
- KOŞUL BİLDİRİM DEĞİLDİR: yalnız eşleşmenin HEMEN ARDINDAKİ ek okunur (`CONDITIONAL_TAIL` `^[ry]?s[ae]`);
- Arıza ailesi `hasDeviceBreakdown`: cihaz adı KELİME BAŞINDA + ÇEKİM doğrulaması (türetme eki elenir: kapı+cı,
- `BREAKDOWN_DEVICES` bir ENVANTERDİR (145 girdi; yazılmamış cihaz = oto-gönderim izni). `su`/`suy` CİHAZDIR;
- Kesme birleştirmesi YALNIZ soldaki parça zaten cihaz adıysa ("Klima'mız" ✓, "Van'a/Kaş'a/Bor'u" ✗ — yer adları).
- `hasUnnegatedProblemWord` üçüncü okuma = `deconfuse(normalizeForMatch(…))` (görünmez karakter + homoglif);
- İzafet kalıpları (`POSSESSIVE_FACILITY_COMPLAINTS`) + SORU EKİ guard YALNIZ o alt kümede (harf sınırı şart).
- Bilinen sınırlar pinli: sahiplik körlüğü (misafirin kendi cihazı, mimari) · belirtisiz tamlama FP ("şarj aleti") ·
**Eval:** harness `evals/*.json` + `tests/eval/`, AYRI config `npm run eval` (`vitest.eval.config.ts`: globalSetup
**Tüm geçmiş taraması** `scripts/eval-real-stats.ts` (Set B'nin AYNI pinli `readOnly` kapısı; model/kredi YOK; çıktı
**KB onay (A1, migration 53 CANLI):** `source`/`reviewState`; eski satırın onayı VARSAYILMAZ (varsayılan `legacy`,
**A2 izlenebilirlik (migration 54 CANLI):** `RiskEvent` 7 nullable kolon, 🚨 NULL = ÖLÇÜLMEDİ (0 değil);
**A3/A4/A5:** kod + testler yerinde, YÜZEYLER KALDIRILDI (kurucu 09-11); panelin yanlışlıkla geri mount edilmesi pinli.
**Geçmiş host cevapları (Bacak B):** yüzey VE veri KAPALI (`KB_HISTORY_SUGGESTIONS_ENABLED` varsayılan kapalı →
**Şablon → KB önerisi (`kb-from-templates.ts`, CANLI):** kategori allowlist YALNIZ `wifi`+`rules` (gerekçeler arşivde);
**Şablon düzenleme/uygulama:** PATCH `propertyId` alanı var; create şemasındaki `.nullish().transform(v => v || null)`
**Panel yerleşimi (lg):** dış kap `lg:fixed lg:inset-0`, `fillsViewport` dikey flex, grid `lg:flex-1 lg:min-h-0`, kart
**🔔 Kurucu 11-06 akşam (web sitesi tamamen bitince):** Ü-6 davetle "sahip" rolü + hukuk maddesi — şartlar `docs/claude/acik-isler.md`.
**🔔 Kurucu 11-05 gece (ayrı tur):** takvim serisini (RRULE) açma — şartlar (tekrarlanan doluluk misafir rezervasyonu sayılmaz) `docs/claude/acik-isler.md`.
**🔔 Kurucu 10-29 gece (unutma):** en önemli ev sahibi bildirimleri ileride WhatsApp'tan da → `docs/claude/acik-isler.md` (önce soru + tasarım).
**🔔 Kurucu 10-21 (işler bitince SIRADAKİ PLAN):** kelime değil bağlam (aday bulucu + bağlam hakemi, "bilgim yok" ölçüldü) · kırmızı takım seti · ev sahibini haksız duruma düşürmeme (özür / "haklısınız" / kusur kabulü misafire gitmez; "para vermeyeceğim" → cevap yok) → `docs/PLAN-2026-10-21-baglam-anlama-ve-kirmizi-takim.md` (sorular T-a, T-b).
**🔔 Kurucu 10-17 (sakın unutma):** Paddle canlı API anahtarı "Never expires" ile oluşturuldu (eskisi 13 Eylül'de doldu) → 1 yıl bitişli + Rotatable anahtarla değiştir, `api_key.expiring` uyarısını bağla — `docs/RAILWAY-ACILIS-2026-10-15.md` §0.4.
**🔔 Kurucu 10-10 (unutma):** ödeme idempotency boşlukları + deneme kötüye kullanımı / risk puanı → `docs/TASARIM-2026-10-10-odeme-idempotency-ve-deneme-kotuye-kullanim.md`
**🔔 GOAL BİTTİKTEN SONRA OKU (kurucu 10-10):** Correlation ID / takip numarası (önce ödeme zinciri; destek ekranında numarayla arama; İLK DİLİM ✅ 10-12, §6) → `docs/TASARIM-2026-10-10-correlation-id-takip-numarasi.md` — kurucu kararları §5 (kapsam önce ödeme · hata ekranında numara · migration onaylı · KALICI yalnız-ekle olay günlüğü, güvenlik şartlarıyla) · Load balancer / yatay ölçek (bugün gerekmiyor; 2 kopya ön koşulları + karar soruları) → `docs/TASARIM-2026-10-10-load-balancer-yatay-olcek.md`
**Diğer açıklar:** Codex P2 (F09–F18) · `docs/DENETIM-2026-08-09.md` (27) · `docs/ACIK-ISLER-2026-08-08.md` (16) ·

## Çalışma ortamı (Railway duraklatma, yerel geliştirme, yedek)
> 📄 **Tam metin (bağlayıcı): `docs/claude/calisma-ortami.md`** — Railway / yedek / yerel veritabanı / geri açma işinden önce oku. Özet:
> yerel dev PG **5434** (5433 test harness'ının, her `vitest run` sıfırlar); PROD DUMP'I LOCAL'E YÜKLENMEZ; migration'lı yayından önce
> taze yedek.

## Çalışma dersleri (turlardan damıtıldı — gerekçeler arşivde)
- 🚨 **Yıkıcı bir betik "denemek" için ASLA çalıştırılmaz** — koruma SAF karar fonksiyonuyla sınanır (09-23:
  `env:recover` denemesi commit edilmemiş ~30 dosyayı sildi). Uzun iş arasında yerel commit/yama yedeği.
- 🚨 **Mutasyon YALNIZ `scripts/mutation-run.mjs` ile** (09-24, dış inceleme: eski betikler ANA ağaçtaki dosyayı
  değiştiriyordu → yazılan kodla yarış): commit edilmiş SHA'nın ayrık worktree'si, ana ağaca hiç yazmaz, çapa tam
  1, sha ile geri yükleme. M0 kontrol koşusu ZORUNLU (09-09: fixture hatası 6 mutasyonu sahte "yakalandı" gösterdi). Worktree DOSYA yarışını çözer, PG 5433 yarışını ÇÖZMEZ → tam
  suit ile aynı anda koşmaz (koşucu başka vitest görünce durur). Hayatta kalan mutant = eksik pin ya da ÖLÜ KOD
  (ya da gerekçesi yazılı EŞDEĞER mutant) — biri düzeltilir. 🚨 "Ölü kod" diye silinen parçadan SONRA ilgili test dosyası YENİDEN
  koşulur (09-28: yaşayan mutant başka bir sebeple yaşıyordu; silme iki pinli testi kırdı, RC38 tam kapıda kırmızı → yayınlanmadı).
- **"Yüklem var, argüman yok"** sınıfı: saf fonksiyon doğru ama çağıran ona girdiyi vermiyor → bağlantı
  DAVRANIŞSAL test ister (QR `history_injection`, `suggestReply` alanı, önizleme `reply`).
- **Bir yüzeyi kapatırken RENDER'ı değil VERİNİN ÜRETİLDİĞİ yeri kapat**; bir kartı kaldırırken içindeki her
  bacağın tüketicisini say (Bacak B / şablon bacağı dersi).
- **Git çağıran test iki katmanlı:** `git -c safe.directory=<repo>` KOMUT kapsamında + git yoksa dosya sistemi
  taraması + fail-open yok (CI #1058/#1076). Pin git'in varlığını ŞART koşmaz.
- **Next.js `route.ts` yalnız bilinen rota alanlarını export eder** — sabitler yaprak modülde.
- Prisma temsilcisine `vi.spyOn` sonraki testlere sızar → DB arızası testi AYRI dosyada. Testte sabit tarih +
  `Date.now()` penceresi = zaman bombası (09-15). 🚨 Günün SAATİNE bakan kural eklenince gerçek saatle koşan testler o saatlerde kırılır,
  gündüz koşan kapı göstermez (10-18: gece yarısı kuralı 45 testi İstanbul 00:00–04:59'da kırıyordu) → kuralı "her zaman" sayan geçici
  değişiklikle ilgili testleri koş; kural yalnız kendi (saati sabit) testinde açık kalsın. Yorumlarda `\uXXXX` kaçışı yazılmaz.
  (11-11, CI 1781) "Sonra" kıyası KESİN büyükse ve test iki anı art arda `new Date()` ile kuruyorsa hızlı makinede ikisi aynı milisaniyeye
  düşer (yerelde üç tam kapı yeşil, CI'da bir kez kırmızı) → taklit içinde gerçek bekleme; teşhis: `vi.useFakeTimers({ toFake: ["Date"] })`
  ile saat dondurulunca hata birebir çıkar. Sınırın kendisi (eşitlik hangi tarafta) ayrı bir birim testiyle pinlenir.
  (11-13, tam kapı gece 01:28'de kırmızı) Saati KENDİSİ okuyan yolu sınayan test (`applyChannelAutoReply` → konaklama bitti mi; `now: new Date()`
  verilen karar kartı) konaklamayı SABİT tarihle kurmaz — yazıldığı gün gelecekte olan tarih takvim oraya gelince ürünü değiştirmeden kırmızıya
  döner (dört dosya: biri 13 Kasım gecesi patladı, üçü 16 Kasım 00:00'da patlayacaktı). Tarih `tests/helpers/stay-dates.ts`ten alınır; pin
  `tests/unit/stay-fixture-dates.test.ts`. Kapı gündüz yeşilse gece de yeşil sayılmaz: gece yarısını geçen koşu ayrı bilgi verir.
  Önceden görmek için `node scripts/time-travel.mjs <gün> [test dosyaları]` (testleri saat N gün ileride koşar; elle, yalnız Linux; bu da bir
  vitest koşusudur). 🚨 Üç saat BİRLİKTE kaymalı — uygulama, test veritabanı, Prisma motoru; biri kaymazsa ilgisiz testler kırmızıya döner
  (ölçüldü: kitaplık veritabanı kullanıcısına okunmazsa SESSİZCE yüklenmez; Prisma motoru önyüklemeyi görmez, kopyasına bağlanır). Ağa çıkan
  test (`npm audit`) kaymış saatte sertifika yüzünden düşer — bomba değildir. İkinci sınıf (+35 gün taramasında bulundu): GERİYE bakan
  pencere — takvim beslemesi 60 günden eski çıkışı dışarıda bırakır; bugün pencerenin içindeki sabit GEÇMİŞ tarih de zamanla düşer (4–7 Ekim
  fikstürü 6 Aralık'ta patlayacaktı). Pencereli bir yolu sınayan test konaklamayı `stayDay(n)` ile kurar; pin aynı dosyada.
- 🚨 **PUSH SONRASI CI SONUCU HER SEFER KONTROL EDİLİR** (kurucu 09-24): 739d83c'nin CI'si kırmızı kaldı ve 4 saat fark
  edilmedi → Railway "Wait for CI" yayını atladı, canlı eski sürümde kaldı. Kontrol `actions_list` (dal filtresi) →
  `list_workflow_jobs`. İşler 2–7 sn'de düşüp `runner_id: 0` ve log 404 ise KOD DEĞİL: Actions dakika/harcama limiti
  (repo private) → kurucuya GitHub → Settings → Billing. Yeniden deneme `rerun_failed_jobs`.
  🚨 **CI için kurucuya SORULMAZ (kurucu 11-11: "kendi kurallarına CI kontrollerini ekle, bana sorma, onayım var"):** koşu / iş listesi,
  günlük okuma, başarısız işleri (ya da koşuyu) yeniden tetikleme ve push sonrası hatırlatıcı kalıcı onaylıdır. İzin, depodaki
  `.claude/settings.json` listesindedir (beş araç; oturum onu AÇILIŞTA okur — oturum ortasında eklenen araç için aynı satır
  `~/.claude/settings.json`a da yazılır, o dosya konteynerle birlikte silinir). Kurucu yine soru görürse (11-11 gece: "sürekli onaylı
  gibi düşün") eksik araç adı bu listeye eklenir, kurucuya sorulmaz. Kırmızıda önce sebep ayrılır (bellek · kota / `runner_id: 0` ·
  gerçek test), sonra düzeltilir ya da yeniden tetiklenir — kurucuya yalnız SONUÇ ve ondan beklenen bir şey varsa (ör. depo
  görünürlüğü, Billing) yazılır.
- 🚨 **SÜRE PİNİ = "sınırın altında — ya da doğrusal ve 4 katının altında" (11-12, CI 1793; `tests/helpers/linear-cost.ts`,
  `docs/INCELEME-2026-11-12-ci-1793-sure-pini.md`):** private depoda CI küçük makinede koşar (~1,5 kat yavaş); doğrusal ama pahalı işi mutlak
  süreyle ölçen pin orada sahte kırmızı verir. Sınır büyütülmez, girdi küçültülmez, test yeniden denenmez: yeni süre pini `measureCost` ile ve
  girdi bir AİLE (boyut → girdi; hazır tabloda `scaled`) olarak yazılır; birkaç girdi TEK ölçümde toplanmaz (toplam, tek girdideki karesel
  payı seyreltir). Oran ölçerken aynı girdi art arda koşturulmaz (ürün kodundaki içerik önbelleği ikinci koşuyu ucuzlatır → ölçüm kör).
  Yeni pin yük altında denenir: `node scripts/timing-under-load.mjs 8` (işlemciyi dolduran 8 boş döngü + süre kolu ≈ 2,5 kat yavaş makine).
- 🚨 **ATLANAN TEST TABANI — ölçüm aracı test dosyasına "ortam değişkeni yoksa atla" diye yazılmaz (11-13, CI 1797):** CI son kapısı dosya
  başına atlanan test sayısını `tests/ci-skip-baseline.json` ile kıyaslar; yeni atlama kırmızıdır (taban büyütülmez — ücretli ölçüm dosyaları
  dışında gerekçe yok). Rapor / ölçüm üreticisi `npx tsx` betiği olur, kararı saf çekirdekte pinlenir (`tests/eval/raw-arm-report.ts` +
  `raw-arm-score.ts`). Yerel kapı artık CI'ın AYNI rapor denetimini koşar (`scripts/test-gate-verify.mjs`; özetin son satırı "rapor yeşil /
  KIRMIZI") — testler yeşil, denetim kırmızıysa `npm test` kırmızıdır. CI'da olup yerelde olmayan her denetim aynı sınıftır: kapıya eklenir.
  (11-13, CI 1801) Sır taraması da kapıda: `scripts/secret-scan.mjs` CI'ın gitleaks'ini aynı sürüm + sha256 ile (ci.yml'den) commit edilmiş
  ağaçta koşar, özette `sır` satırı; örnek anahtar `src/` / `public/` içinde gerçek biçimde yazılmaz (izin listesine eklenmez, gizlenir).
- **Dizi biçimli `$transaction([...])` sonucu KONUMLA okunmaz** (09-24): mülk silmeye kural silme adımı eklenince
  `const [, result]` kural sayısını okudu, kuralı olmayan her mülk silinip 404 döndü (yayın öncesi tam kapıda yakalandı).
  Sonucu kullanılan adım etkileşimli işlemde ADIYLA döner.
- **Bulutta Node fetch proxy'yi okumaz:** OpenAI/embedding çağıran tsx/eval koşuları `NODE_USE_ENV_PROXY=1` ister.
- 🚨 **MİSAFİR METNİNE UYGULANAN KALIPTA KARESEL İŞ YOK (ReDoS denetimi 09-28, ölçüldü):** başı çapasız + sınırsız tekrar
  (`\S+X`, `\p{L}{2,}…$`, `KÖK\p{L}*\s+`) ve sabit gövdeden ÖNCE gelen değişken uzunluklu geriye bakış, uzun tek sözcükte / boşluk
  dizisinde karesel → olay döngüsü kilitlenir (sınıflandırıcı 20.000 karakterde 66 sn, çıktı vetosu 4.000'de 2,6 sn; kanal mesajında
  uzunluk tavanı YOK, QR 2.000). Kurallar: sonek kalıbı yalnız son harflere (`suffixTail`), çapasız kökten sonra `\p{L}{0,24}`,
  öndeki `\S+` yerine `\S`, geriye bakıştan ÖNCE gövde ileriye bakışı, iki bitişik boşluk yıldızı yerine ikincisi isteğe bağlı
  ayraçta; düzenli ifadeyle çözülemeyen yerde doğrusal tarayıcı + düzenli ifade testte KÂHİN (`mixedCodeTokenMatches`, iddia
  ölçümü 100.000 karakterde 7,7 sn → 26 ms). Yeni kalıp eklerken 4.000–50.000 karakterlik tek sözcük / boşluk dizisi / tekrarlanan
  kök süre pini (`*-cost.test.ts`) + eski/yeni sonuç kıyası. 🚨 (10-01 gece, 15 ajan A14) BİTİŞİK İKİ boşluk niceleyicisi
  arasında isteğe bağlı ayraç (`\s*X?\s*`) boşluk dizisinde karesel → `\s*(?:X\s*)?`; TÜRETİLMİŞ eşleşme adayları (kesme / aksan söküm)
  boşluk dizisi YENİDEN üretir → `matchCandidates` adayında dizi teke iner (`collapseSpaceRuns`); bu yüzden yalnız aday yolundan erişilen
  kalıp yeniden yazımları mutasyonda gerekçeli EŞDEĞER, ham metin yolları (acil ağı, müsaitlik standart çıkış ayıklaması) süre pinli.
  Yazım toleransı (BM25) sınırlı OSA (`osaDistanceWithin` = min(osa, max+1)) + dizin başına önbellek; seçim birebir (30.000 çift kâhin).
  🚨 (10-30) Derlenmiş kipte ölçmek YETMEZ: V8 kalıbı ilk çalıştırmada / bellek temizliğinden sonra YORUMLAYICIDA koşturur, hızlı konum
  atlatma her zaman devrede değildir → gövdeden önce gelen geriye bakış orada karesel (çıktı vetosu 8.000 karakterde 4,3 sn; 09-28 ölçümü
  kaçırmıştı). Yeni kalıp `regex-worst-mode-cost.test.ts` yoluyla `--no-regexp-optimization` + `--regexp-interpret-all` kiplerinde de ölçülür.
- **Dönüş tipini / hata sözleşmesini değiştiren düzeltmede BÜTÜN çağıranlar ve onların testleri taranır** (10-07): `deleteAccountData`ın
  `{ deleted }` dönüşü ve parola onayının 401'i hedefli testlerde yeşildi, tam kapıda üç eski pin kırmızı çıktı (çift tıklamanın kaybedeni 400
  sözleşmesi dahil). Hedefli test yetmez; `grep` ile çağıran + test listesi çıkarılır.
  (11-11) Liste, değişen DOSYANIN ADINI okuyan kaynak pinlerini de kapsar (`grep -rlF "automation.ts" tests`): çağıran taraması bir davranış
  gerilemesini yakaladı, ama anahtarın çağrı sayısını sayan pin ancak tam kapıda kırmızı çıktı (40 dakika kayıp).
- 🚨 **Nullable kolonda `NOT: { kolon: değer }` NULL satırı da DIŞARIDA bırakır** (11-04, SQL `NOT (x = v)` NULL'da NULL): bekleyen (sahipsiz) satırları arayan sorgu hiçbirini görmüyordu, yedek e-posta HİÇ gitmezdi — mutasyon koşucusunun M0'ı yakaladı. `OR: [{ kolon: null }, { kolon: { not: değer } }]`. **Commit'ten ÖNCE ilgili test dosyaları koşulur** (aynı gün 8 commit testsiz birikmişti; ikinci hata Türkçe ek: kalıp kökte bitiyordu, testler yalnız İngilizcede yeşildi).
- **`beforeEach(() => sahte.mockReset())` YAZILMAZ (11-18):** ok işlevi sahte işlevin KENDİSİNİ döndürür; vitest dönen işlevi temizlik sanıp test
  SONUNDA çağırır — son taklit reddediyorsa test o hatayla düşer (hata satırı ilgisiz bir `new Error`ı gösterir). Gövde süslü parantezli yazılır.
- 🚨 **"SÜREYLE DÜŞEN KİLİT KALICI GERÇEĞİ TAŞIYAMAZ" + "EN ESKİ N'Yİ OKU, SONRA SÜZ" (11-18, Codex 11-17):** (a) "ödeme alındı" gibi kalıcı bir
  gerçek 10 dakikalık kilitte tutuluyordu → kilit düşünce ikinci ödeme açılıyordu; kalıcı gerçek kalıcı kayıt ister, yalnız kanıtla açılıp kapanır.
  (b) Sınırlı okuma + bellekte süzme, süzgece takılan N satırın arkasındakini kalıcı aç bırakır (yeniden işleme 200, otomatik mesaj 200, açık
  ihtiyaç 500): süzgeç SORGUYA iner; tavan kalıyorsa sessiz olmaz (alarm) ve ilerleme kalıcı imleçle sürer. (c) Dış sisteme yazmadan HEMEN
  önce yerel satır yeniden okunur (istek başındaki kimlik bayatlamış olabilir). (d) Süzgeci sorguya indirirken ya da imleç eklerken eski
  SIRANIN taşıdığı örtük kural kaybolabilir (otomatik mesajda "kopya satırlarda ilk satır belirler" — süzgeç ilk satırı eleyince kardeş
  satır öteki dairenin metniyle gidiyordu): eski ve yeni yol KOPYA / kardeş satır vakasıyla da kıyaslanır, örtük kural açık koda yazılır.
- **Paralel kod yazan ajanlar (11-18, kurucu: "Opus kod yazabilir, push etmez"):** her ajan ayrık çalışma ağacı + KENDİ test veritabanı
  (`TEST_DATABASE_URL`, ayrı PostgreSQL 5441; `tests/global-setup.ts` dış veritabanında 5433'e dokunmaz) → ajan testleri birbirini ve 5433'ü
  bozmaz. Mutasyon koşucusu / tam kapı yine TEK başına koşar: önce bekleme işareti (ajanlar test koşmayı durdurur), sonra koşu. Mutasyon
  `TEST_DATABASE_URL` ile ~4 kat hızlı (her mutantta `initdb` yok). Ajan çıktısı satır satır okunur ve ana oturumda yeniden test edilir —
  11-18'de ajanın eklediği tavan dalında açlık kusuru, öz kodda Opus incelemesiyle altı P3 bulundu. Ayrıntı `docs/claude/calisma-ortami.md`.
- **Genel Prisma temsilcisine kurulan casus İŞLEM istemcisinin (`tx`) çağrısını GÖRMEZ** (11-04): yazma kilitli işleme taşınınca yarış / çökme testleri sessizce kurulmaz oldu (tam kapıda kırmızı). Araya girme, kilitli bölgenin test kancasından (`__kbCapHooks`) kurulur; mutasyonla kancanın gerçekten tetiklendiği sınanır.
- **Aynı işlemde AYNI zaman damgasıyla yazılan satırların sıralaması `id` ile kesinleşir** (09-27): konuşma öğeleri bir turda tek
  `createdAt` ile yazılıyor, `requestIndex` mesaj başına 0'dan başlıyordu → iki mesajın öğesi tam eşit, sıra rastgele (tam kapı bir kez
  kırmızı; "Açık işler" sırası da oynayabilirdi). Eşitlik bozucu `{ id: "asc" }` (cuid yazılış sırasında artar).
- **Ajan token maliyeti (kurucu 09-23):** her alt ajan CLAUDE.md'nin TAMAMINI + tüm araç tanımlarını yükler ve
  sayaç birikimlidir (her araç çağrısında bağlam yeniden okunur). Bu dosya KURAL + GÜNCEL DURUM olarak kalır;
  tur anlatısı `docs/history/`e gider. Ajanlar dar ve az tutulur; basit arama doğrudan yapılır.

- **Yeni anahtar / migration eklerken ÜÇ PİN birlikte güncellenir (11-18 gece, tam kapıda kırmızı):** her `AI_*` anahtarı ölçüm koşu
  kimliği listesine (`tests/eval/run-meta.ts`), her `*_ENABLED` açılış belgesine + yalnız "1" ile açılanlar `scripts/env-check.mjs`e, her
  migration `docs/MIGRATION-MANIFEST.md` tablosuna ve açılış belgesindeki "migration 59–<son>" aralığına. Hedefli testte görünmez;
  commit'ten önce `tests/unit/eval-run-meta` · `railway-doc-flags` · `env-strict-flags` · `migration-manifest` koşulur. İstemi iki ayrı
  anda kuran test saati girdide sabitler (istem "saat SS:DD" taşır — dakika sınırında bir kez kırmızı).

## Kalıcı ürün kararları (turlardan damıtıldı)
> 📄 **Tam metin (bağlayıcı): `docs/claude/kalici-urun-kararlari.md`** — bu alanda kod / karar değiştirmeden önce oku. Aşağıda yalnız madde başlıkları.
- Bağlam penceresi
- Acil ≠ sıradan istek:
- "Sorunlu" AI'yı KALICI durdurur
- Misafir QR'ı kapalı/bozuksa
- Otomatik giriş/çıkış/karşılama mesajları
- 🚨 DEVİR / BİLDİRİM CÜMLESİ MİSAFİRE GİTMEZ (K10, kurucu kararı 09-30, "Hiçbir şey gitmesin"):
- 🚨 **"EV SAHİBİNİZİN KARARIDIR" MİSAFİRE GİTMEZ (kurucu kararı 10-01, `ai/host-decision-hold.ts`; anahtar `AI_HOST_DECISION_HOLD_ENABLED`
- Çıktı vetosu
- Temellendirme kaydı:
- Bütçe:
- Reddedilenler (tekrar önerme):
- Embedding durumu:
- Saat okuyucusunda KARESEL İŞ YOK (A3 09-27, `kb-time-fields-perf.test.ts`):
- Saat alanı kuralı TEK KAYNAK `retrieval/time-fields.ts`
- 🚨 TASLAK = EV SAHİBİNİN SESİ (09-25, `ai/host-voice.ts`):
- 🚨 MODEL KIYASI 09-25 — gpt-6-luna'ya GEÇİLMEDİ
- Model sağlayıcısı kalıcı arızası
- Müsaitlik host metni
- Demo görüntü kararları tek kaynak `isDemoOrg`
- Kanal sözleşmesi / müsaitlik / demo

## Durum
> 📄 **Tam metin (bağlayıcı): `docs/claude/durum.md`** — bu alanda kod / karar değiştirmeden önce oku. 11-06 → 11-20 tur satırları 11-20 öğlen
> oraya AYNEN taşındı (başlık "CLAUDE.md Durum satırları"); taşımadan önceki tam CLAUDE.md `docs/history/CLAUDE-2026-11-20-sadelestirme-4-oncesi-tam-metin.md`.
> Açık sorular tarih başlıklarıyla `docs/claude/acik-isler.md` ("11-11" … "11-20 gece"). YENİ tur anlatısı buraya DEĞİL `durum.md`ye; buraya yalnız
> tek satır + yol (ve yeni bir kural doğduysa ↓"Turlardan kurallar"a tek madde).

**Kurucu talimatları AYNEN — o işte her dilimden ÖNCE okunur:** `docs/KURUCU-TALIMATI-2026-11-18-codex-raporu-ve-orkestrasyon.md` (kurucu: "oraya
bakıp bakıp ilerle") · `docs/KURUCU-TALIMATI-2026-11-18-aksam-kararlar-ve-anlam-yonu.md` · `docs/KURUCU-TALIMATI-2026-11-19-gece-raporuna-cevap.md` ·
`docs/KURUCU-TALIMATI-2026-11-19-aksam-ajan-turu-cevabi.md` · `docs/KURUCU-TALIMATI-2026-11-20-sabah-cevaplar.md` ·
`docs/KURUCU-TALIMATI-2026-11-21-sabah-cevaplar.md` · `docs/KURUCU-TALIMATI-2026-11-25-codex-raporu-ve-opus-dalgasi.md` ·
`docs/KURUCU-TALIMATI-2026-11-25-uc-kucuk-is.md` · `docs/KURUCU-TALIMATI-2026-11-25-aksam-codex-ikinci-rapor.md`.
**Çalışma düzeni (kurucu 11-18):** Claude orkestratör; Opus 5.5 kod yazabilir ama push etmez, kodu hemen eleştirel incelenir; en zor kodu Claude
yazar; kontrollerde alt ajan; acele yok.

**Tarih çizelgesi (ayrıntı `docs/claude/durum.md`):** 11-06 temizlikçi K-1…K-5 · üyelik M-2 (migration 93 / 94; kurucu Ü-1 askı · Ü-3 kimlik
kaydı kişide · Ü-4 kuşak · Ü-5 bağ işletme başına; satırsız kişi girişte onarılır, ekipten çıkarılmış kişi DİRİLMEZ, ileride AYRI kimlik
belirteciyle hesap merkezi) · doğrudan görevlendirme ·
işletme belgesi Faz 1a (migration 95, anahtar KAPALI) · QR metinleri ev sahibinin ağzından — 11-11 Codex 11-10 bulguları · kurucu kararları S1–S8 —
11-12 S3 `AI_HELD_PET_SPLIT_ENABLED` (Opus: BU HÂLİYLE AÇILMAZ — dal yalnız doğrulanmış cevap parçalarında + aynı turun isteğinde açılır,
tek başına etkisiz) · istem denetimi + dayanak (`AI_NO_SOURCE_RULE_ENABLED` · `AI_ANSWER_PARTS_ENABLED` · `AI_TURN_MESSAGES_ENABLED`
KAPALI; kör koşular OpenAI kredisi bittiği için YAPILAMADI — sonuç görülmeden hiçbiri AÇILMAZ) · CI süre pini (`linear-cost.ts`) — 11-13 Fable istem denetimi ·
anlamsal karar mimarisi tasarımı · zaman yolculuğu aracı · "Bugün" ilk dilimi · temizlikçi T1–T3 (migration 96 / 97) · ödeme onayı üç kutu —
11-14 sızma testi tur 1 — 11-18 Codex 11-17 dalgaları (ödeme kanıtla kapanır · teslim sonucu sözlüğü · durum tek kaynak · iki dairede kayıt
tutulur) · söz okuyucusu (model okur, anahtar KAPALI) · migration 98 — 11-19 dalga C · ödeme "yalnız tam iadeyle" · kanal uzlaştırması (anahtar
KAPALI) · beş ajanlı optimizasyon / hata ayıklama turu — 11-20 şablon listesi 30'luk + sınır 500 · anlamsal arama bütçesi (üç anahtar KAPALI) ·
son kontrol (model düşünürken iptal → cevap gitmez) · kuyruk diriltme · Ö-1 · F-1 adım 1 · F-2 · Dikkat satırı üç satır · öğlen: CLAUDE.md
sadeleştirme 4 · ajan turu kapandı · sert kontrol (A1–A2 düzeltildi, A3 kurucu sorusu) · EMB pilotu · F-4 QR — özet `durum.md` (13) —
11-21 gece turu (CI 1841, metinler, gece sayısı geçici kuralı) — 11-25 Codex raporu: on iddia teyit, ödeme iptali üç değerli + tek işlem,
şifre sıfırlama / IP kovaları / günlük 2FA / kanal doğrulama düzeltmeleri, üç tasarım kurucu sorusunda — özet `durum.md` (14) · akşam: iki
ajanlı ürün fikirleri planı + üç küçük iş (çıkıştan önce açık konu · son bakım işi notu · temizlikçi gün sırası + ay sayımı) — `durum.md` (15) ·
gece: Codex ikinci rapor (26 madde, altı paket; hükümler talimat belgesinde) — `durum.md` (16).

**Turlardan kurallar (Durum satırlarından, AYNEN):**
- (11-11) Bağlantıyı / veriyi düşüren "kesin ret" kararı münhasırlık ister (kilit elde değilse ret belirsizdir — OAuth yenileme); uzunluk engeli
  güvenle değil açık işaretle taşınır (`lengthHeld`).
- (11-11 gece) Bir kaydı "durum defteri" yapmadan önce o kaydın öteki yoldaki ANLAMINA bak (kuyrukta "başarısız" son durumdur — doğrudan yol
  oraya yazsaydı kuyruk açılınca mesaj sonsuza dek beklerdi); işlem kimliği metne / sekmeye değil işin kendisine bağlanır.
- (11-12 sabah) Bir kemeri daraltmadan önce onun tesadüfen örttüğü başka hataları ölç; misafire gideni serbest bırakan değişiklik sözcük ağına
  değil kodun doğruladığı yapıya dayanır; anahtar kapalıyken 0, açıkken 1 olan yanlış "ilgisiz" diye etiketlenmez.
- (11-12 akşam) Yapısal karar okuyucuya bırakılmaz; bir düzeltmenin değiştirdiği fonksiyonun ÖTEKİ çağıranı da ölçülür; ölçer yanlış değeri
  "gereksiz tutma"ya yazmaz.
- (11-13 gece) Denetçi modelin bulgusu kodda ve AÇILIŞ bayraklarıyla izlenmeden doğru sayılmaz (40 bulgunun 4'ü bayrağı ters varsaymıştı);
  kurucu kararının bedelini yazan bulgu kusur değil ölçüm önerisidir.
- (11-13 gece) Kuyruğa giren yeni yol için işçinin veto kuralları ayrıca okunur ("sıraya alındı" cevabı "gidecek" demek değildir); hukuki kanıt
  "en iyi çaba" yazılmaz.
- (11-13 gece) Okuma süzgeci yazmadaki eksikliği gizleyebilir — saklı kaydın kendisi de test edilir.
- (11-13 gece) Kaynak çapalı yapısal pin çapanın varlığını da doğrular (yoksa çapa değişince sessizce boşa düşer).
- (11-14) Sistemik "reddet" düzeltmesinden önce aynı girdinin pinli "sessizce temizle" sözleşmesi aranır; kötü niyetli girdi süresi en kötü
  durumda ölçülür.
- (11-13 akşam) Onay metninde fiil belgeye göre seçilir (bilgi → onaylıyorum, sözleşme → kabul ediyorum, aydınlatma → yalnız bilgi satırı);
  istemci ve sunucu hangi kutunun gerektiğine AYNI saf kuraldan karar verir.
- (11-18) Kalıcı gerçek süreli kilitte tutulmaz; kapanış yalnız kanıtla.
- (11-18) Süren iş "kaydedildi" diye duyurulmaz; güvenlik sıkılaştırması var olan zamanlama eşitliğini zayıflatmamalı (yazma ↔ yazma).
- (11-18) Commit edilmemiş işi taşıyan dosyada `git checkout <dosya>` YAPILMAZ (geçici düzenleme ayrı kopyada ya da ters düzenlemeyle geri alınır).
- (11-18) Bir işi kuyruktan doğrudan yola alırken kuyruğun frenleri (duraklatma, veto) de taşınır.
- (11-18) Ajanın "bugün şöyle oluyor" iddiası kod okumasıysa önce / sonra örneği kurucuya gitmeden ÇALIŞTIRILARAK ölçülür (bir örnek yanlış
  çıktı); kaldırılan API alanı yok sayılmaz, reddedilir; "misafire giden küme aynı" iddiası yayındaki kodla AYNI testte ölçülür.
- 🚨 (11-18 akşam, kurucu, çok net) Anlam / amaç / niyet kararı kelime ya da yapı listesiyle VERİLMEZ, modele bırakılır; kod yalnız modelin
  dediğini hızlıca doğrular ve nedenini kaydeder; öneri hazırlarken "tırnak varsa şöyle" türü yapı kuralı ÖNERİLMEZ.
- (11-18 gece) İnceleme ajanının "ekranda şu görünüyor" varsayımı da kodda doğrulanır (düğme görünüyor sanılmıştı, gizliydi — sonuç daha
  kötüydü: ev sahibinin hiçbir yolu yoktu).
- 🚨 (11-19 (2), kalıcı karar) Belirsiz gönderimde Lixus kanal konuşmasını kendisi okur; mesajın orada görünmemesi YENİDEN GÖNDERME sebebi
  değildir (`CHANNEL_SEND_RECONCILE_ENABLED` KAPALI; `docs/claude/kalici-kararlar.md`).
- (11-19) Bir testin korumayı gerçekten ölçtüğü, korumayı geçici kaldırıp kırmızıya döndüğü görülerek doğrulanır (bir sayfa testi metinde
  etiketi başka yerden buluyordu, korumasız da yeşildi).
- (11-19) Yeni ağ okuması test kurulumunda ağı kesmez — varsayılan kapalı anahtar ya da sahte adaptör arkasında yazılır; sağlayıcının 200 +
  bozuk gövdesi "okunamadı" sayılır, olumlu sonuç sayılmaz.
- (11-19) Yaşayan mutant testin YANLIŞ SEBEPLE yeşil olduğunu gösterebilir — önceki testin `restoreAllMocks`ı taklitleri bozar; mutantı elle
  uygulayıp testin döndürdüğü sonucu oku.
- (11-20 öğlen) İki ayrı kuralın aynı şeyi söylediği yerde (gönderici ↔ ekran yazısı) yazı tarafı göndericinin KENDİ ön elemesini çağırır,
  kopyasını yazmaz (sert kontrol A1: kopya kural kuyruk sahipliğini unutmuştu).
- (11-20) Yeni bir "iptal" vetosu eklerken rezervasyon geri dönerse aynı anahtarın bir daha gönderilip gönderilemeyeceği sorulur (kuyruk yolu
  doğrudan yoldan ayrışmaz).
- (11-21, CI 1841) Prisma'nın sorgu olayı sonuçtan SONRA gelebilir ve havuzun `SELECT 1` yoklaması da olay üretir (ölçüldü) → sorgu sayan test
  sayacı kapatmadan önce `flushQueryEvents` (`tests/helpers/query-event-barrier.ts`) çağırır; sabit bekleme yazılmaz. (11-25, tam kapıda bir
  kez kırmızı) Aynı gecikme BAŞTA da olur: hazırlığın son sorgusunun olayı açılmış sayaca düşer → sayaç `beginQueryCount` ile açılır
  (pin `tests/unit/query-count-arming.test.ts`); bir sınıfın bir ucunu kapatınca öbür ucu da ölçülür.
- (11-25) Bir yazımı etkileşimli işleme alınca genel temsilciye kurulu casuslar SAHTE YEŞİL kalabilir (kırmızıya dönmez) → o modele casus kuran
  bütün testler taranır, araya girme `tests/helpers/tx-intercept.ts` ile kurulur ve her kanca ÇALIŞTIĞINI iddia eder.
- (11-25) Ajanın sondayla "bulduğu" hata, sondanın kurduğu durum üründe oluşabiliyor mu diye ölçülür (çıplak mesaj satırı eklemek panelden cevap
  yazmak DEĞİLDİR — panel konuşma durumunu da değiştirir).
- (11-25 akşam) İstek yoluna yeni okuma eklerken ardışık tur eklenmez: okuma, girdisi belli olur olmaz (gerekirse geniş aday kümesiyle)
  başlatılıp sonda beklenir (`request-path-queries` derinlik pini; sınır büyütülmez). Bir satır başka satırları yutuyorsa yutulanın taşıdığı
  bilgi (söz saati, onaylı saat) yeni satırda aranır.
- (11-26, CI 1855) Koşu anına göre kurulan zamanı ("şimdi + 5 saat") ekran yazısında sınayan testte yazı GÜNE göre değişir (bugün → yalnız
  saat, yarın → "yarın 09:00"); akşam koşan kapı yalnız "yarın" dalını görür. Böyle bir test eklenince öteki dal için saat sabitlenerek ya da
  günün başka bir saatinde bir kez koşulur; kalıp ürünün hiç yazmadığı bir sözcüğü ("bugün") beklemez.
