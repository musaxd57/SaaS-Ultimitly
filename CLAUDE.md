# CLAUDE.md — Lixus AI proje hafızası

> Her oturum başında okunur. Yalnız KURALLAR ve GÜNCEL DURUM. Gerekçeler/ölçümler/tarihçe:
> `docs/history/CLAUDE-2026-09-07-sadelestirme-oncesi-tam-metin.md` (239 KB'lık eski hâl, aynen)
> + `docs/history/CLAUDE-2026-07.md` / `CLAUDE-2026-08.md` + `git log`.
> Kanıt sözleşmesi: `docs/TEST-EVIDENCE-CONTRACT.md` (BAĞLAYICI). Plan: `ROADMAP.md`.
> **Yol planı (kurucu talimatı 2026-09-07, AYNEN): `docs/KURUCU-TALIMATI-2026-09-07-urun-vizyonu-ve-degismezler.md`**
> — ↓"Yol planı" bölümü onun özetidir, çelişkide o metin kazanır.
> Denetim turu: `docs/audit-2026-09-05/` (`SECURITY-ARCHITECTURE-REVIEW.md` · `CLAUDE-HANDOFF.md` · `DURUM.md`).
> V0: `docs/V0-CHANNEL-INDEPENDENCE-INVENTORY.md`.

## Ürün
**Lixus AI** (lixusai.com) — Türkiye odaklı, çok kiracılı SaaS; kısa dönem kiralama hostlarının
Airbnb/Booking misafir mesajlarını AI ile yanıtlar. Operatör: musaxd57 (Nuve, ~10 daire). Türkçe
öncelikli. Temel ilke: AI karar-verici değil yardımcı operatör — riskli mesaj hep insana kalır.
Hedef: Hospitable geçici köprü, uzun vadede bağımsız AI-native PMS (V0 belgesi).

## 🧭 Yol planı (kurucu talimatı 2026-09-07 — özet; tam metin `docs/KURUCU-TALIMATI-…md`)
**FINAL PRODUCT CONSTRAINT:** Lixus başka PMS'lerin üzerinde AI wrapper DEĞİL; Airbnb Direct + Booking.com
Direct + Vrbo Direct bağlantılı bağımsız **AI-native PMS / Short-Term Rental Operating System**. Hospitable
geçici köprü: Airbnb Direct production-ready olana kadar çalışan entegrasyon BOZULMAZ ve erken sökülmez,
ama yeni çekirdek Hospitable veri modeline/kimliklerine bağlanmaz. Final UX'te Hospitable hesabı zorunluluğu
yok; PMS connector'ları çoğaltmak strateji değil. Moat: persistent operasyon zekâsı + property/operasyon
hafızası + proaktif risk/kalite/gelir tespiti + kök neden/tekrar analizi + kanıtlanabilir AI kararları +
güvenli action execution + native kanal bağlantısı. Prompttaki isimler kavramsal örnek — mevcut abstraction
daha doğruysa korunur; minimum diff değil doğru çekirdek hedeflenir; big-bang rewrite yok.
**10 mimari ilke:** çekirdek Hospitable semantiği istemez · sağlayıcı değişince çekirdek yeniden yazılmaz ·
dış kimlikler çoklu kanal/hesap/tenant için güvenli kapsamlı · credential+connection yaşam döngüsü
entegrasyon sınırında · outbound hedef yetkili channel connection'dan çözülür · provider payload'ı
çekirdeğe sızmaz · geçiş boyunca prod çalışır · artımlı + geri alınabilir · Airbnb Direct ikinci
rewrite gerektirmeden eklenebilir · "Hospitable" adı kalktı diye refactor bitmiş sayılmaz.
**20 teknik değişmez (test-pinli olacak):** (1) çekirdek/intelligence hiçbir sağlayıcı modülünü import
etmez · (2) her dış kayıt connection/provider kapsamı + dış kimlik + provenance + capability + freshness +
ingest zamanı taşır · (3) dış kimlik global/property-only eşsiz sayılmaz; idempotency kapsamı bağlantıyı
içerir · (4) tek "her şeyi yapan" ChannelAdapter yok; yetenekler (bağlantı yaşam döngüsü, listing sync,
reservation/message ingest, outbound, webhook, availability, rates, reviews) ayrı ilan edilir · (5) iCal
reservation-only · (6) Hospitable+iCal aynı ilanı beslerse tahminî birleştirme YOK, sahiplik/öncelik ile ·
(7) canonical ingest: payload → doğrulama/normalizasyon → source-scoped idempotency → canonical TX →
versioned domain event/outbox; polling ve webhook aynı yazma servisi · (8) outbound: provider-neutral hedef,
capability gate, idempotency key, hata sınıfları (retryable/definitive/ambiguous/auth-revoked/outage);
belirsizde reconciliation · (9) credential org kaydına dağılmaz; bağlantı yaşam döngüsü (token, refresh,
expiry, scope, cursor, health, reconnect, revoked) tutarlı · (10) canonical Guest gerekirse snapshot ≠
profil; otomatik cross-channel merge yok, geri alınabilir · (11) Issue yalnız Task'tan farklı yaşam
döngüsü kanıtlanırsa · (12) Review tablosu ingestion kaynağı olmadan eklenmez · (13) Property Memory
canonical event'i tüketir; LLM metni kalıcı gerçek değil (evidence/confidence/observedAt/effectiveAt/
lastConfirmedAt/expiry/contradiction/human override) · (14) Airbnb-kaynaklı veri ile host/Lixus verisi
politika düzeyinde ayrı (saklama/türetme/silme/export/fesih) · (15) money impact sahte kesinlik üretmez
(assumption/evidence/confidence/aralık) · (16) tenant isolation her yeni yolda davranışsal test · (17)
connector conformance (duplicate/out-of-order/replay/cancel/modify/reconnect/refresh-revoke/outage/
ambiguous/tenant-cross) · (18) Airbnb sandbox+doküman olmadan tahminî endpoint/payload/sahte connector YOK
(yalnız provider-neutral sözleşme + fixture + conformance kiti) · (19) rollout: sandbox/demo → internal
tenant → küçük pilot → shadow/dual-run → reconciliation → kontrollü cutover → bridge freeze → kullanıcı
migrasyonu → bridge removal · (20) mimari pin: provider import / `hospitable*` alanı / channel string'inden
yetenek çıkarımı yasak.
**Yürütme sırası (bu sıra prompttaki diğer sıraları ezer):** ① Codex denetimi kritik bulguları kodda
doğrula+düzelt ✅ (8 P1, `docs/audit-2026-09-05/DURUM.md`) → ② test sözleşmesi ✅ → ③ **V0 Channel
Independence** (V0.1 ✅ outbound dispatch · V0.2 ✅ provider fake + conformance kiti · V0.3 ✅ `ChannelConnection`
canlı (migration 49 prod'da 09-07) · V0.4 ✅ provenance canlı (migration 50 prod'da 09-07) · V0.5 ✅ `messagingCapable`
canlı (`19d5527`, migration'sız) · V0.6 ✅ ingest write service + `IngestEvent` canlı (migration 51 prod'da 09-08
03:13Z) · V0.7 ✅ kod hazırlığı canlı (migration'sız; kolon DROP'u operatör planına bağlı:
`docs/V0.7-CANLI-GECIS-OPERATOR-PLANI.md`, ön koşul: okuma anahtarı ≥2 hafta)) → **V1 Property Memory + Signals KOD HAZIR,
yerel — migration 52 push kapısında (`docs/V1-PROPERTY-MEMORY-DESIGN.md`, envanter §14)** → ④ deterministik **Availability Engine** → ⑤ geniş
otonom AI yalnız yetki+guardrail+grounding+eval doğrulandıktan sonra. **V0 sırasında YAPILMAZ:**
Availability Engine, RAG/GraphRAG, Property Memory, Exception Feed, Revenue Brain, Proof AI, Ask Lixus,
Review/Issue tabloları. Yalnız dar, davranış-koruyan temel eklenebilir.
**Ürün fazları (V0 sonrası, bağımlılık sırasıyla):** V1 Property Memory + Signals → V2 Exception Feed
("Needs your attention", money impact) → V3 Actions + Tasks → V4 Proof AI → V5 Reservation Risk/Readiness →
V6 Review + Recurring Issue Brain → V7 Revenue Brain → V8 Ask Lixus → Action. Intelligence katmanı ayrı
bounded context (`/modules/intelligence`: memory/signals/incidents/recommendations/actions/scoring/agents/
audit), event dinler; AI bozulsa PMS çalışır. Konumlandırma: "AI Operating System for Short-Term Rentals".
**Airbnb başvurusu öncesi 6 kapı:** channel independence (boş `AirbnbDirectAdapter` sözleşmesi dahil) ·
Hospitable'sız Lixus'un büyük bölümü çalışır (iCal + kendi verisi; yalnız kanal-özel inbox köprü ister) ·
ciddi security katmanı (Airbnb şartları: data-security review, MFA, least-privilege, OWASP, ≥3 ayda tarama,
HTTPS, şifreleme) · demo tenant (demo@lixusai.com, 10–15 örnek property) · gerçek kullanım kanıtı (11 daire
+ birkaç dış host; property/reservation/AI-handled/uptime/task metrikleri; "100+ property" ZORUNLU DEĞİL) ·
entegrasyon dosyası (mimari, data-flow, saklama, privacy, security controls, demo credentials, scope'lar).
Kanal sırası gerçek dünyaya göre: Airbnb Direct → Vrbo/Expedia Direct → Booking.com Direct (yeni provider
intake "until further notice" kapalı, 2026-08-21). Uygulama içinde yalnız Airbnb/Booking/Vrbo düğmeleri, PMS
logosu yok.
**Gelecek AI gereksinimleri (V0 bitmeden UYGULANMAZ; ayrıntı tam metinde):** prompts.ts'e yalnız kod
tarafından üretilmiş doğrulanmış girdilerle: `conversationState` (phase/hasPriorDeliveredReply/
isFirstOperatorReply — selam tekrar yok) · `actionReceipt` olmadan "ilettim/oluşturdum/kontrol ettim" yok ·
canlı gerçekler (müsaitlik, rezervasyon, fiyat, ödeme, görev, aksiyon) yalnız `verifiedToolResults` (KB/RAG/
geçmiş/misafir iddiası otorite değil; stale/error kesin cevap olmaz) · `currentLocalDate`+org timezone koddan,
belirsiz tarihte en fazla bir soru · çelişen kaynakta kesin cevap tutulur, operatöre devir. **Kurucu AI
Kalite Konsolu:** salt-okuma (sunucuda zorlanır), yalnız allowlist+MFA superadmin, her görüntüleme/export
audit'li (amaç yazılı), tam trace (tenant/property/reservation/conversation, kronolojik girdiler, taslak vs
gönderilen, model/prompt sürümü, RAG kaynakları, araç çağrıları, karar/gate, latency/token/maliyet, insan
etiketleri); üretim verisi otomatik eğitime GİRMEZ; silme/saklama paritesi. **Bounded context builder:**
`.slice(-6)`→`-25` mekanik değil; tavan 25, hedef ~10–12; kronoloji + authorType (görünen ad değil); güncel
mesaj daima dahil (aşırı uzunsa fail-closed insana); son teslimden sonraki TÜM cevapsız misafir mesajları
güvenlik penceresinde (üretim penceresinden BAĞIMSIZ — displacement saldırısı); failed/canceled/unsent
outbound, taslak, duplicate import, sistem olayı dahil edilmez; `conversationState` kodda; eski bağlam için
provenance'lı yapılandırılmış hafıza; ölçülü char/token bütçesi; keyset sorgu; PII'siz teşhis; tek paylaşımlı
builder tüm yüzeylerde. **Temporal context:** createdAt + org dilimi ile geçen süre/oturum/gün türetimi
kodda; tekrar selam deterministik; eşikler ölçümle. **Date resolution:** açık metin → konuşma → göreli ifade
(org dilimi) → rezervasyon → tek belirgin gelecek yorum; metadata (tarih/tz/dayanak/güven/varsayım);
otomatik gönderim öncesi her tarih/müsaitlik iddiası araç sonucuyla eşleşmeli. **Eval:** sürümlü anonim
dataset (`evals/`), 3 sınıf (deterministik integration/security · model kalite · kritik akış e2e), LLM
grader tek başına güvenlik kanıtı değil, 8 başlangıç senaryosu (ilk temas · devam eden · ardışık mesajlar ·
kapanış · çözülmüş şikâyet · displacement · doğrulanmamış aksiyon iddiası · belirsiz müsaitlik); model
değişimi öncesi baseline + shadow kıyas. **Sistem öncelikleri:** Function Calling (ilk AI geliştirmesi) ·
Guardrails (şimdi güçlendirilmeli) · Query Router / Query Transformation / Halüsinasyon kontrolü (MVP) ·
ReAct (kademeli) · GraphRAG (ihtiyaç kanıtlanırsa). Ek: kaynaklı-sürümlü bilgi, hybrid retrieval+reranking
(eval ile), açık konu/taahhüt hafızası, generation trace, güvenli aksiyon yürütücüsü.

## Intelligence (V1 — YEREL, PUSH EDİLMEDİ; envanter §14, tasarım `docs/V1-PROPERTY-MEMORY-DESIGN.md`)
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
- **Repo PRIVATE** → GitHub Actions ayda 2000 dk (~250 push). CI durursa sebep kota olabilir.
- **Git:** commit author `user.email noreply@anthropic.com` / `user.name Claude`; yedek TAG değil BRANCH
  (`backup/stable-YYYY-MM-DD`); commit mesajında backtick yok → heredoc.
- **`crypto-core.key()` sırası `ENCRYPTION_KEY || AUTH_SECRET`.** `*-undecryptable` alarmında ÖNCE
  salt-okuma teşhis (`scripts/diagnose-hospitable-tokens.ts`), SONRA satır silme.
- **ENCRYPTION_KEY ROTASYONU ASLA** (token'lar + 8 takvim feed URL'i kırılır). Anahtar kasada, DB
  yedeğinden AYRI; DB yedeği tek başına kurtarma değildir.
- **APP_URL sabit taban:** e-posta linkleri/OAuth redirect `appBaseUrl()`; tarayıcı redirect'leri
  `baseUrlFromHost` (allowlist). Railway arkasında hiçbir rota `req.url`'den mutlak URL kurmaz.
- **`"https://www.lixusai.com"` literal'i yalnız app-config'de** (tek kaynak pini).

## Teknik mimari
- Next.js 15 App Router · Prisma 6 · PostgreSQL · Railway (branch `claude/great-edison-3zqpZ` oto-deploy,
  "Wait for CI" AÇIK → kırmızı CI deploy'u atlar). Boot: `migrate deploy && npm run start`; prestart
  `scripts/verify-env.mjs` tek env-doğrulama kaynağı. `/api/health` readiness; `?strict=1` ops.
- Multi-tenancy `Organization`; superadmin (`SUPERADMIN_EMAILS`) impersonation ile girer (JWT
  `actorUserId`). Tüm rotalar org-scoped (`api-route-scoping.test.ts` pinler).
- Auth: JWT + `sessionEpoch`; `withAuth/withManage/withOwner` (route-guard.ts); 2FA TOTP; `mfa` iddiası.
- Hospitable: per-tenant şifreli token (`getOrgHospitableToken` TEK fonksiyon; PAT veya OAuth refresh).
  `financials:read` YOK → gelir özelliği bilinçli KALDIRILDI. Env-token fallback yalnız `PRIMARY_ORG_ID`.
- Sync: `SystemLock` "scheduled-sync" + 2 dk in-process cron (`instrumentation.ts`) + `/api/cron/sync`
  (`CRON_SECRET`). Manuel sync `withSyncLock`.
- **Giden mesaj: Channel Layer (`src/lib/channels`, V0.1)** — `sendOnChannel` ve outbox worker
  `dispatchOutbound`'a gider; `hospitable.sendMessage`'ın tek çağıranı `channels/hospitable-outbound.ts`.
- Model: OpenAI `gpt-5.1` (`OPENAI_MODEL`; `DEFAULT_OPENAI_MODEL` kod içi son çare). Değiştirme =
  gönderim hot-path'i rekalibrasyon; yalnız gerçek arıza + A/B. `ai/openai-compat.ts` TEK KAYNAK DEĞİL
  (`ai/index.ts` ve `translate.ts` OpenAI'yi doğrudan çağırır; `openai-request-contract.test.ts` pinler).

## AI güvenlik mimarisi (ürünün kalbi)
- **Tek kaynak:** `src/lib/ai/prompts.ts` + `fallback.ts`; tüm yüzeyler (oto-yanıt, inbox öneri, Ayarlar
  testi, landing demo, QR) buradan. Demoya özel hiçbir şey yok.
- **3 seviye:** düşük risk → oto-gönder · orta (opt-in `autoHoldingReplyEnabled`, default kapalı) →
  deterministik bekletme mesajı + "Sorunlu" + e-posta · yüksek → sessiz taslak + host'a acil mail.
- **Kod kapısı `passesAutoReplySafetyGate`** (karar modele verilmez): source==openai + intent blocklist +
  kelime-ağı çapraz-kontrol (son mesaj + bekleyen mesajlar) + injection vetosu + bilinmeyen-intent clamp +
  yüksek-riskli `riskType` vetosu + `Number.isFinite(confidence)` + ≥0.75. Tek muafiyet: human_request devir.
- **Model çıktısı STRICT (F01):** `riskLevel` yalnız kapalı-küme string, eksik=tanınmayan="high";
  `confidence` yalnız sonlu number (boolean/string/null→0). Şema ihlali `reportError` (throttled).
- **riskType/evidence:** `riskType` 11'lik kapalı set; `usedSources` kodda doğrulanır; `missingInfo` 5×80.
- **GOLDEN SET** (`tests/unit/golden-scenarios.test.ts`, ~105 senaryo): prompt/kelime-ağı değişince
  koşulur; yeni risk sınıfına hem tehdit hem övgü-tuzağı senaryosu eklenir.
- **Görünmez karakter sınıfı = `\p{Default_Ignorable_Code_Point}` + U+2800** (liste değil); `\p{Mn}`'in
  tamamı EKLENMEZ. **Dil paritesi:** `SAFETY_CRITICAL_WORDS` ↔ `KEYWORDS.complaint` dil kapsamı paralel.
  **Kesme işareti kelime sınırıdır** (`'` ve `’`). **Homoglif/NFKC katlama** (`matchCandidates`) yalnız
  karma yazı sisteminde ve EK aday olarak; `normalizeForMatch`'e `\p{Mn}` konmaz.
- **Katlama kuralı:** `includesAnyFold` (3 katlama) YALNIZ kısıtlayıcı dedektörlerde; `isPositiveFeedback`/
  `isClosingAck` beyaz listelerine ASLA. Tedarik: yalnız `REQUEST_NEGATIONS/QUESTIONS` guard'larında.
- **QR asistanı bağlamı (AI kalite turu 09-08):** model artık KRONOLOJİK konuşma geçmişiyle çağrılır
  (pencere `guest-chat.ts` `buildGuestChatContextWindow`: MESAJ tavanı `QR_HISTORY_MESSAGE_CAP` 24 ≈12 tur +
  `QR_HISTORY_CHAR_CAP` 8.000 karakter, hangisi önce dolarsa keser; eşit damgada `(createdAt, id)` deterministik;
  pencere dışına taşan kapanmamış konular PII'siz `openTopics` kodlarıyla taşınır ve DEVİR SEBEBİ DEĞİLDİR;
  kapanış tespiti `looksLikeTopicClosure` — `isClosingAck` güvenlik beyaz listesi olduğu için genişletilmedi;
  yön `direction` alanından, sistem olayı/gövdesiz satır hariç, güncel mesaj geçmişte
  TEKRARLANMAZ) — `history: []` asimetrisi kapandı (inbox zaten veriyordu). Her yanıt kararı `RiskEvent`
  (`surface:"guest_chat"`) yazar: dokuz kapalı-küme gerekçe (`low_confidence`, `model_risk_level`,
  `model_unavailable`, `keyword_escalated`, …) + `gate_passed`; PII yok, await edilir (yarışsız), yazamazsa
  misafirin yanıtını BOZMAZ.
- **QR devir metni GERÇEĞE UYGUN** (`guest-chat.ts` `escalationReply()`): yalnız garanti edilen söylenir
  ("kaydedildi; ev sahibiniz sohbet ekranından görüntüleyebilir"). "İlettim" İDDİA EDİLMEZ — e-posta bayrak açıkken
  bile dedupe/5 dk cooldown/alıcı-yok/sağlayıcı hatasıyla bastırılabilir ve metin e-postadan ÖNCE yazıldığı için
  sonuç okunamaz. QR devri yapışkan DEĞİL (her mesaj yeniden değerlendirilir, model `history: []`).
- **QR eksik bilgide DÜRÜST CEVAP (dar bant, `QR_INFORMATIONAL_BAND_ENABLED` VARSAYILAN KAPALI):** her açıdan
  risksiz mesajda güven `0.45 ≤ c < 0.75` ise modelin cevabı gider (`informational_low_confidence`). Bandın ALTI
  hâlâ devir; bant güvenlik dallarının ARDINDA (şikayet/para/insan-talebi/injection bastırılmaz, iki yönlü pinli).
  🚨 **Düşük güven "dürüst bilmiyorum"un KANITI DEĞİL** — model aynı güvenle uydurabilir: `usedSources` BOŞ iken
  cevap somut şey iddia ediyorsa (rakam/saat/kod veya yer tarifi) gönderilmez → `unsourced_claim`. Bayrak açma
  sırası: eval → tek test mülkü + RiskEvent sayımı → genişletme (karar kurucunun).
- **Sohbet kapanışı ≠ sorun çözümü:** nezaket kapanışı ("teşekkürler") yalnız BİLGİ konusunu kapatır; operasyonel
  konu (`complaint · refund · early_departure · human_request`) yalnız ÇÖZÜM bildirimiyle ("düzeldi", "halloldu",
  "geldi") kapanır. Nezaket kapanışı konuyu dondurmaz — sonraki çözüm bildirimi hâlâ kapatır.
- **`+1 ms` NEDENSELLİK KANITI DEĞİLDİR:** yalnız okuma sırasını düzenler; "bu cevap ŞU soruya verildi" bağını
  kaydetmez ve eşzamanlı/peş peşe mesajlarda eşleşme hâlâ ÇIKARIMDIR. Doğru çözüm `Message.replyToMessageId`
  (migration, kalan iş).
- **QR nedensel sıra VERİDE:** bot cevabı misafir mesajından +1 ms damgalanır (aynı TX'te `CURRENT_TIMESTAMP`
  eşitliği kalktı). `id` kopma noktası KORUNUR — bu düzeltmeden önceki eşit damgalı satırların tek deterministik
  sırası odur. `id` bir VEKİLDİR, nedensellik kanıtı değil.
- **Açık konu kapanışı YAKINLIK kuralı:** kapanış cümlesi gündemdeki SON konuyu kapatır (yığın; misafirin HER
  konusu yer tutar). "klima → havlu → teşekkürler" klimayı KAPATMAZ. Kapanışın hangi konuya ait olduğu metinden
  çıkarılamaz; yakınlık tek dürüst sinyal, yanılırsa bedeli yalnız bir bağlam notudur.
- **Kalite denetçisi eşleştirmesi:** `lte` + `id` kopma noktası (QR misafir+bot satırı AYNI TX → aynı damga; eski
  `lt` misafir mesajını eliyordu → denetçi ürünü haksız yere "uydurma atıf" diye suçluyordu). `guest: null` TEK
  BAŞINA proaktif kanıtı DEĞİL: `guestContext` = matched | proactive | unmatched.
- **Gölge pilotu QR'da ÇALIŞMAZ (tasarım):** `recordShadowVerdict` yalnız `applyChannelAutoReply` içinde; QR
  konuşmaları `qr-chat:` önekiyle kanal sorgusundan dışlanır ve `status:"answered"` doğar. QR ile test edilince
  "gölge kaydı yok" BEKLENEN.
- **KB sır kapısı:** `withoutSecretKbItems` (içerik sezgiseli, TAM tarama, `SECRET_SCAN_MAX_CHARS` 24k üstü
  fail-closed) + `QR_SECRET_CATEGORIES` kategori bacağı + `verifiedActiveStay`; onaylı konaklamada kod
  vermek ürünün kendisidir. Kalıp bitişiklik şartı (4–8 hane, telefon-devamı koruması); serbest metin izni
  YOK (12 kalemin 6'sını eliyordu). Stil profili 4 yüzeyde de süzülür (`scrubStyleProfileForPublic`).
- Üslup: duygu beyanı/temenni/çelişki/dolgu-soru yasak; "siz"; ben-dili. Çok soruluda uzunluk kuralı ezilir.
- `REPLY_CHAR_CAP` 4.000 (aşılırsa güven 0.5, sessiz kesme yok) ≠ `max_completion_tokens` 2000.
- **Injection kara listesi yapısal olarak yetersiz** (düz parafrazların çoğu geçer); asıl koruma KB sır
  elemesi + source==openai. Yapısal sınıflandırıcı ayrı tur.

## Canlı durum (Railway env'leri — özet)
| Env | Durum |
|---|---|
| `AUTO_REPLY_ENABLED=1` · `REGISTRATION_OPEN=1` · `TRIAL_EMAILS_ENABLED=1` · `LANDING_DEMO_ENABLED=1` · `GUEST_CHAT_ENABLED` · `DATA_RETENTION_MONTHS=24` | açık |
| `BILLING_ENFORCED=true` | deneme bitince ücretsiz sürüm (kilit yok), oto-mesaj kapanır; `PRIMARY_ORG_ID` muaf |
| Paddle PRODUCTION | canlı; gerçek ödeme + in-app upgrade/downgrade doğrulandı; `PADDLE_PLAN_CHANGE_ENABLED=1`; yıllık fiyat env'leri set |
| `OPENAI_MODEL=gpt-5.1` · `SHADOW_AI_ENABLED=1` (`SHADOW_AI_MODEL=gpt-5.6-luna`, `SHADOW_AI_ORG_IDS`=Nuve, anahtar `OPENAI_API_KEY`'e düşer) · supply-ai OpenAI luna | Akash artık HİÇBİR yerde işleyen değil; `SUPPLY_AI_MODEL/BASE_URL` eski Akash değerleriyse SİL. KVKK metinlerindeki Akash satırları avukat paketinden önce güncellenmeli |
| Hospitable OAuth canlı; Nuve aboneliği 402 (veri donmuş, bug değil) | `TRUST_CF_HEADER` EKLEME |
| `TRUSTED_PROXY_HOPS=2` · `SENTRY_DSN` + `ERROR_ALERT_EMAIL` · `EMAIL_OUTBOX_ENABLED=1` · `CALENDAR_URL_CONTRACT_ENABLED=1` (prod'da düz feed URL kalmadı) · `STORAGE_ENABLED=1` (Tigris `lixus-uploads`, virtual-hosted) | kanıtlı canlı |
| `PASSWORD_RESET_CHALLENGE_ENABLED` | artık okunmuyor (Faz 3), silinmesi davranışı değiştirmez |
| BİLİNÇLİ KAPALI | `DURABLE_OUTBOX_ENABLED` · `ICAL_DISAPPEARANCE_RECONCILE_ENABLED` · `UNVERIFIED_SWEEP_*` · `RETENTION_MESSAGE_AGE_ANCHOR` (onay paketi: `docs/RETENTION-MESSAGE-AGE-ANCHOR-ONAY-PAKETI.md`) · `GUEST_ERASURE_ENABLED` (avukat imzası) · `QR_PIN_ENABLED` · `APP_TRUST_BROWSER_TIMEZONE` |

## Fiyat (kullanıcı onaylı, FLAT)
Başlangıç ₺449 (1-2 daire) · Pro ₺899 (3-7) · İşletme ₺1.699 (8-25; `propertyLimit=25`, "25+ → bize ulaşın").
Yıllık = aylık×10 (₺4.490/8.990/16.990). 14 gün tam Pro deneme, kart yok. Kartlar daire sayısı +
kullanım hacmi + destek ile ayrışır; özellik kilidi YOK. USD/TRY ₺46. `legal-entity.ts` dolu.

## Hospitable ortaklığı
Amaç: Lixus müşterisine "sadece-API" paketi (~$7/daire) → $29/ay Hospitable engelini kaldırmak. Gerçekler:
API yalnız ücretli planlarda; Hospitable partnerlerden OAuth vendor flow bekliyor (bizde ana yol; PAT
fallback: my.hospitable.com → Apps → API access → Access tokens, Read+Write). Patrick (07-02): Connect
kapandı, public API+OAuth tek yol, white-label şimdilik yok ("trafik gösterince pilot"); "tek ana hesap →
çoklu host" property-manager modeli mümkün (tenant izolasyonu yeniden tasarım ister — kullanıcı onayı).
Partner Portal partners.hospitable.com. Dürtme yok.

## Mevcut özellikler (tekrar ekleme)
Panel: dashboard (AI özet + onboarding), inbox (AI öner + risk rozeti), Mesajlar, QR Misafir Sohbetleri,
Gönderilenler (+`/sent/queue` outbox ops), Görevler (Kanban), Takvim, İptaller, Mülkler (+"Mülk Hafızası" kartı, V1), Bilgi Tabanı,
Şablonlar, Raporlar, sekmeli Ayarlar (Takvim akışı gizliliği, geç çıkış teklifi, 2FA, faturalandırma).
Mülk sayfası Kanal Takvimleri İKİ seçenek: **takvim bağlantısı** (URL, düzenli senkron) + **Dosyadan içe aktar**
(tek seferlik `.ics`; önizleme kaydetmeden mülk + eklenecek/güncellenecek/iptal/atlanacak sayısını gösterir;
`mode=preview` YAZMAZ ve ayrı kotadadır; dosya yalnız KENDİ satırına dokunur — `calendarSourceId` NULL + `channel`
"ics"; feed satırı `owned_by_feed` ile atlanır; eksik satır iptal EDİLMEZ; iptalli satır canlı dosyayla geri AÇILMAZ).
Operatör paneli: müşteri yönetimi + impersonation + Lead CRM + Operasyon Teşhisi + 2FA sıfırlama.
Landing: 3-seviye kartlar + canlı demo. KVKK: export, retention, erasure (bayraklı), kayıt onayı. VDP:
`/guvenlik` + `security.txt` (posta kutusu `security@lixusai.com` açılmalı).

## Çalışma tarzı
- **`docs/TEST-EVIDENCE-CONTRACT.md` bağlayıcı**: K2 için kırmızı-önce · kaldırma mutasyonu · aşırı-uygulama
  kontrolü · integration · tam kapılar; rapor KOD/CI/DEPLOY/PROD ayrı; "test gerekmiyor" gerekçeli.
- **Codex protokolü:** doğruysa uygula, daha iyisini biliyorsan gerekçeyle reddet; son karar karşılıklı.
- **🚨 Tam suit koşarken BAŞKA vitest KOŞMA:** `tests/global-setup.ts` her `vitest run`'da PG 5433'ü `stop -m
  immediate` + `initdb` ile sıfırlar → paralel koşu süren suit'in DB'sini öldürür (ölçüldü: 42–59 sahte kırmızı
  dosya). Mutasyon script'leri de vitest'tir. Süreç öldürürken `pkill -f "vitest run"` YETMEZ (kendi kabuğunla
  eşleşir, `node (vitest)` ana süreciyle eşleşmez; yetim ana süreç bitince teardown'ı yeni koşunun PG'sini kapatır)
  → `pkill -f "node \(vitest"` + `ps | grep "[v]itest"` ile doğrula.
- **Ajanlar yalnız araştırır/ölçer/doğrular; kodu Claude yazar.** Bol paralel ajan, bulguları kodla doğrula
  (yarısı yanlış), kısa format. Kararı uygula, soru sorma; klişe yok.
- Kalıcı kararlar buraya, gerekçeler git log/arşive.

## Kalıcı kararlar (yeniden tartışma yok — gerekçe: arşiv + git log)
**Denetim/kanıt — Codex 2026-09-05 (hedef `73dbfb4`; rapor `docs/audit-2026-09-05/`, tur durumu `DURUM.md`)**
Sekiz P1 KAPANDI (09-07), her biri ayrı commit, kırmızı-önce + iki yönlü mutasyon + tam kapılar. Kurallar:
- **F08 test DB kapısı** (`scripts/test-db-guard.mjs`): `TEST_DATABASE_URL` yolunda `db push --accept-data-loss`
  ÖNCESİ üç katman — loopback (ya da açık `TEST_DB_ALLOW_REMOTE=1`) + DB'nin kendi harness işareti
  (VERİTABANI YORUMU `lixus-test-harness:v1`; tabloya yazılsaydı `db push` silerdi) + işaretsiz DB yalnız
  BOŞSA sahiplenilir (dolu için tek seferlik `TEST_DB_ADOPT=1`). URL hiçbir mesaja basılmaz. CI'nin Linux
  provisioning yolu etkilenmez.
- **F01 model çıktısı STRICT** (`ai/index.ts`): `riskLevel` yalnız kapalı kümeden STRING — EKSİK = tanınmayan
  = "high"; `confidence` yalnız sonlu number, boolean/string/null → 0 (coercion YOK). Şema ihlali
  `reportError("openai-reply schema violation")` (throttled) + host'a sebep notu. Kapıda `Number.isFinite`.
  ⚠️ "Eksik → none" ile "tanınmayan → high" asimetrisi açığın ta kendisiydi; geri getirme.
- **F02 QR sır filtresi TAM TARAR** (`guest-chat.ts`): head/tail 4.000 kemeri KALKTI (18k'lik tek kalemin
  ortası taranmıyordu); `SECRET_SCAN_MAX_CHARS` 24.000 = validator tavanı + başlık; üstü hakkında hüküm
  verilmez → elenir. ReDoS ölçüldü: 24k adversarial × 6 kalıp × 3 katlama = 0.7–3.2 ms/kalem.
- **F03 silme → kuyruk sözleşmesi:** `conversations/[id]` ve `properties/[id]` DELETE aynı TX'te
  `ERASABLE_STATUSES` + `claimedBy:null` satırları `canceled` yapar (belt); worker `replyVeto` HER yanıt türü
  için önce "hedef var mı + aynı kiracı mı" sorar (`conversation_gone`/`message_gone`/`tenant_mismatch`),
  SONRA yalnız AI'ya durum vetosu (braces). 🚨 "Message yok = manuel, geçsin" dalı geri gelmez. Bilinen sınır
  pinli: claim+veto sonrası POST ile eşzamanlı silme geri alınamaz, satır dürüstçe `sent` kalır.
- **F04 OAuth refresh CAS** (`hospitable-credentials.ts`): persist `updateMany WHERE hospitableRefreshTokenEnc
  = refresh BAŞLARKEN okunan blob`; 0 satır = bağlantı değişti (disconnect/reconnect/kazanan refresh) → token
  DB'ye yazılmaz VE çağırana aktif diye verilmez (null). Generation kolonu YOK, blob'u değiştiren her yazma
  generation'dır. DB hatası ≠ CAS kaybı (hata dalında eski retry+alarm+taze token korunur).
- **F05 teslim ACK'i koşullu** (`worker.ts markConversationDelivered(row, now)`): yanıtın kendi Message'ından
  SONRA inbound varsa `answered` YAZILMAZ; AI satırı `problem` kilidini ASLA ezmez; host yanıtı eski inbound'un
  açtığı problem'i meşru kapatır; `lastMessageAt` yalnız `lt: now` ise ilerler. Tek UPDATE'te ilişki filtresi.
- **F06 sayfa yolu DB arızası:** `requireAuth` catch'i `session.mfa = false` (operatör yetkisi doğrulanamadıysa
  YOK; `/admin` kapısı `isSuperAdmin` bu yüzden kapanır) + impersonation oturumu doğrulanamazsa ÇIKIŞ. Normal
  müşteri oturumu fail-open (kitlesel çıkış yok). Eski "iddia olduğu gibi kalır" pini YANLIŞTI, ters çevrildi.
- **F07 retention bayrak-AÇIK seçici** (`RETENTION_MESSAGE_AGE_ANCHOR=1`): 8 yeniden-temizlenebilirlik bacağı
  (phone/email/externalId/checkoutTime/notes/konuşma adı/triyaj/görev açıklaması) + öksüz dalda triyaj.
  **BACAK KURALI = SONLANMA KURALI:** yalnız süpürgenin KENDİSİNİN null/sentinel yaptığı alan bacak olur;
  ad-redaksiyonlu metinler (`TaskUpdate.note`, outbound gövde) bacak OLAMAZ → işaret kolonu ister, BİLİNEN
  SINIR test-pinli. Bayrak kapalı davranış birebir eski. Bayrak açma onayı DEĞİL.
- **Kalan P2 (ayrı modül turları):** F09 CSP raporu path token'ı · F10 merkezi log redaksiyonu · F11 mülk
  silmede obje temizliği · F12 audit baseline şeması · F13 üslup profili ↔ tesis gerçeği · F14 sohbet
  hafızası/zaman · F15 kalite denetimi `{}` · F16 iCal completeness · F17 cron adaleti · F18 login savunma
  tasarımı. Hiçbiri dokunulmadı; Codex'in "Mevcut iyi temeller" ve V0 mimari önerileri raporda.
- Kaynak taraması tek yönlüdür → davranışsal test; `rejects.not.toThrow(/…/)` kullanma; senkron CPU
  zaman aşımıyla kesilemez; çapa `indexOf` −1 pinle; mutasyon `assert count==1`.
- Ret edilenler: ETag testi (hedef yok) · HTTP/2 parser testi · kanonik-posta-kutusu kayıt limiti ·
  `emailCanonical` kolonu · escalation claim'inin model yolunda geri alınması (regresyon çıktı) ·
  gölge pilotta teslimat takibi/per-org kota · supply türetmenin import TX'ine alınması.

**Kimlik / oturum**
- 2FA aktifliğinin tek koşulu `twoFactorEnabledAt`; bayat secret arıza değil → `/admin` "2FA'yı sıfırla"
  (bayat dalda epoch artmaz). Operatör müşteri hesabında 2FA kuramaz.
- Operatör yetkisi = allowlist + `mfa === true` (`isSuperAdmin`, tek boğaz noktası). `login` `mfa`yı
  2FA'dan yazar; `verify-email` `mfa:false`; impersonation iddiayı taşır. Sayfa yolu `requireAuth`: DB
  arızasında rol staff + `mfa=false`; impersonation çıkar; normal oturum fail-open.
- "Beni hatırla" (trusted-device) iki epoch'a bağlı (2FA + `sessionEpoch`); şifre değişimi/sıfırlama ve 2FA
  sıfırlama güveni düşürür; legacy çerez fail-closed. **Çıkış güven çerezini SİLMEZ** (kullanıcı kararı
  09-07; 08-09 sertleştirmesi geri alındı — cihaz güveni çıkışı aşar, kutuyu ortak bilgisayarda
  işaretlememek kullanıcının seçimi). Kutu işaretsizse her giriş kod ister = normal 2FA. Sıradan logout
  epoch bump'lamaz (S1; "her çıkışta tüm cihazlar düşsün" per-session `jti` ister = migration).
- E-posta doğrulama: token fragment'te (`#t=`) + `POST` + PAROLA şart (ön-ele-geçirme kapandı); GET'i geri
  getirme. "Zaten hesabın var" maili ayrı `kind`; enumeration korumaları korunur (`SEND_FAILED_503` ortak).
- Şifre sıfırlama m47 challenge modeli: bütçe challenge satırına ait, token fragment'te, `middleware.ts`
  iki liste (`AUTH_PATHS` / `SIGNED_IN_REDIRECT_PATHS`). Faz 3 bitti (eski kod yolu kalktı); Faz 4 (kolon
  drop) SÜRESİZ ERTELENDİ — `pwResetCodeAttempts: 0` yazması zamanlama paritesidir, SİLME. Zamanlama
  paritesi tek bcrypt (`dummyVerifyPassword`); `hashPassword` ile parite YAZMA. Açık UX: bağlantısız
  kod girişi çıkmaz (formda düzelt, rotada DEĞİL).
- `readJsonCapped` `Content-Type: application/json` ister (öz karşılaştırma; virgül ham değerde).
- Login: hesap kovası kilit silahı değil (doğru parola girer); 2FA hesap-başına kota var.
- `GET /logout` CSRF'i, per-session `jti`, halka açık sayfada çerez yenileme → açık tasarım kararları.

**Tenant / rotalar**
- `api-route-scoping.test.ts`: her rota org-kapsamlı ya da gerekçeli public listesinde; `admin/*`
  hepsi superadmin kapılı (`admin-superadmin-gate.test.ts` davranışsal); `REQUEST_DERIVED_ORG_ID` listesi.
- `cron/sync` · `cron/email-outbox` · `leads` davranışsal pinli (`timingSafeEqual` yapısal pin dahil).
- Hız limiti: `pickClientHop` sağdan `TRUSTED_PROXY_HOPS` (Railway 2); az tahmin güvenli, fazla tehlikeli;
  aralık dışı → 1; boot uyarır, durdurmaz. `clientIp` delil kayıtlarında da kullanılır (geçmiş satır
  düzeltilmez). Bütçe doğrulamadan SONRA tüketilir (import/backfill/diagnostics/AI kotası); `leads`
  istisna (anonim). 429 metni süreyi söyler.
- Ayar değişikliği audit'li (alan adları, değerler değil). `properties/[id]` DELETE ve `admin/leads` PATCH
  audit'siz (açık).
- Yükleme: private mimari (imzalı GET, `orgIdFromKey` 404, sihirli bayt, SVG/HTML yok); prod'da yerel
  diske düşüş 503 (`ALLOW_LEGACY_LOCAL_UPLOADS=1` kaçış). Bucket sağlayıcı görünürlüğü operatör adımı.
  `photoUrl` yalnız göreli.
- CSP: enforce'ta `form-action 'self'`, `script-src` enforce EDİLMEZ; report-only'ye `report-uri`
  (`/api/csp-report`: 8KB, 3 MIME, 30/saat/IP, allowlist alanlar, ham rapor saklanmaz, `reportError` YOK,
  daima 204). Enforce sırası: ≥2 hafta ölç → nonce turu → report-only doğrula → enforce.
- iCal SSRF: pinned DNS, redirect yok (3xx hata), private/link-local/IPv6 multicast blok, yalnız 443
  (`url.port` boş olmalı; `!== "443"` ölü kod), userinfo red, 10MB cap, toplam deadline. HTTPS zorunlu.
- Landing iframe'leri Google Fonts çekmez (self-hosted woff2, latin+latin-ext ikisi de şart); CSP
  karşılaması geri EKLENMEZ.
- `/_next/image` kapalı (`images.unoptimized`); `next/image` kullanılırsa önce `sharp` kontrol.

**Veri yaşam döngüsü / KVKK**
- Scrub kapsamı kuralı: misafir metni/adı taşıyan her kolon `anonymizeOldGuestData` VE `maskReservationRows`
  ikisine bağlanır (`scrub-scope-parity.test.ts` dosya düzeyinde; DAL düzeyi kör → dal pinleri ayrı).
- Erasure tombstone guard'ları HER ingress'te: hospitable-sync · iCal · elle `.ics/.csv` · QR
  (`resolveGuestChat`). Yeni sağlayıcı = beşinci ingress, kapı şart. `blocksGuestStay` yalnız sync'te.
- Retention: süre-bazlı rejim ≠ açık silme rejimi; scrubbed satıra PII geri yazılmaz; cutoff'tan eski
  mesaj re-import edilmez. `RETENTION_MESSAGE_AGE_ANCHOR` bayrağı: mesaj yaşı + yeniden-temizlenebilirlik
  bacakları; kapalı davranış birebir eski; açmadan önce onay paketi + taze `pg_dump`; smoke'ta "artık
  korunacak" sayısı düşerse DUR.
- Redaksiyon yapısal (`report-error-core.ts`): JSON ağacı gezilir, izin listesi deny'den önce, kv regex
  kalır, işlenemeyen aday `[REDACTED_UNPARSEABLE_JSON]`, oversized/budget koşulsuz sabit, `\uXXXX` çözülür.
- Hesap silme Invoice/Consent/AuditLog'u da siler (migration ister, açık). `Organization.plan` kolonu ölü.
- Takvim feed URL'i at-rest şifreli (`urlEnc`+AAD), prod'da düz URL yok; doğrulama yalnız `--post-contract`.

**Mesajlaşma / outbox / sync**
- **Channel Layer (V0.1–V0.2, `src/lib/channels`):** giden-mesaj çekirdeği (`messaging.ts`, `outbox/worker.ts`)
  `@/lib/hospitable` istemcisini import ETMEZ, yalnız `@/lib/channels`; `sendMessage(` src/ içinde TEK yerde =
  `channels/hospitable-outbound.ts` (pin `core-channel-independence.test.ts`). `qr-chat:` iç-thread kuralı
  tek kaynak `resolveOutboundRoute` (`INTERNAL_THREAD_PREFIX`). Sağlayıcı seçimi bugün orada açıkça
  `"hospitable"` (V0.3'te connection karar verir). Adaptör `kind`i HTTP durumundan tipler;
  `classifySendResult` `kind`i metin regex'inden ÖNCE alır (parite pinli). Kimlik bilgisi `undefined`
  olduğu gibi iletilir (istemci env fallback'i, kurucu legacy yolu); **token YOK ve env YOK ise adaptör
  ağa çıkmadan `definitive_failure`** (V0.2 uyum kiti bulgusu). `dispatchOutbound` fırlatmaz (adaptör yok /
  yetenek yok / kimlik↔sağlayıcı uyuşmazlığı → definitive). Ortak fake `tests/helpers/fake-channel.ts`
  (dedupe YOK, sahipsiz rezervasyon 404, timeout=teslim-olabilir) + kit `tests/helpers/outbound-conformance.ts`
  — **yeni adaptör aynı kiti geçmek zorunda**; fake'in varsayımları gerçek adaptörle (fetch stub) pinli.
- **Provenance (V0.4, migration 50 — CANLI 09-07 19:29Z, kanıt envanter §11):** `Reservation/Conversation/Message.connectionId` = KANITLANMIŞ bağlantı — yalnız ingest anında
  ya da NULL iken bir senkron satırı o bağlantıdan gerçekten gözlemleyince (NULL→X) yazılır; ASLA X→Y / X→NULL;
  **çıkarım backfill'i YOK**, "mevcut bağlantıyı aktar" tarihsel kanıt DEĞİL (pencere dışı legacy NULL kalır).
  `ingestedAt` = İLK ALINMA (yalnız create; update yolları dokunmaz; freshness DEĞİL — iCal `feedLastSeenAt`,
  thread `syncCursorAt`). `connectionEvidence` (ingest|observed|outbound) damganın NASIL yazıldığını taşır:
  env fallback ile alınıp sonradan gözlemlenen satır `observed` kalır, "ilk alınma bu bağlantıdan" iddiası
  ÇIKMAZ (iki kolon bunu taşıyamaz). iCal/QR/dosya/env fallback → `connectionId` NULL; elle giriş ve bizim
  çıktımız (AI/bot, doğrudan gönderim) → `ingestedAt` NULL. Sınıflar `channels/provenance.ts`
  (ingest/observed/outbound/unbound/legacy).
  Kolonlarda FK/index/default YOK. Dedupe: Conversation `connectionId single_non_null` (farklı dolu →
  `connection_conflict`, sessiz birleştirme yok), `ingestedAt keeper_wins` (zaman farkı ≠ çelişki, sayılır);
  Message `provenance_id` (→ `message_connection_conflict`, içerikten ayrı), `ingestedAt provenance` (kıyaslanmaz).
- **Messaging capability (V0.5 — CANLI, envanter §12):** "mesajlanabilir mi" TEK KAYNAK `channels/capability.ts`:
  `PROVIDER_MESSAGEABLE_RESERVATION_WHERE` (sourceReference dolu + calendarSourceId null + channel notIn [ics,
  manual]) ve `PROVIDER_THREAD_CONVERSATION_WHERE`/`isInternalThread`; automation.ts literal yazmaz (pin), gönderici
  ve önizleme aynı fragment'i yayar. Org düzeyi yetenek = kimlik çözümü (`getOrgHospitableToken`, env fallback dahil).
- **Ingest (V0.6, migration 51 — CANLI 09-08 03:13Z, envanter §12):**
  okuma yönü `channels/ingest.ts` sözleşmesi (canonical tipler, tipli `IngestError`, adaptör DEDUPE/SIRALAMA yapmaz);
  `@/lib/hospitable` okuma fonksiyonlarının src/ içindeki TEK çağıranı `channels/hospitable-ingest.ts` (+ sağlayıcı-adlı
  `api/hospitable/diagnostics`; pin). Yazma `ingest/write-service.ts` (`upsertCanonicalReservation`,
  `importCanonicalThread`; sağlayıcı tipi imzada YOK; polling ve gelecekteki webhook aynı servis). `IngestEvent` aynı
  TX'te, PII'SİZ (misafir metni/adı ve sağlayıcı kimliği taşımaz; kanarya dışı bilinçli). Değişmeyen senkron UPDATE
  yazmaz ve event üretmez. Fake `tests/helpers/fake-ingest.ts` + kit `tests/helpers/ingest-conformance.ts` — **yeni
  ingest adaptörü aynı kiti geçmek zorunda**; kit ≠ canlı doğrulama.
- **Bağlantı durumu + kimlik çözümü (V0.7 kod hazırlığı — CANLI 09-08, envanter §13):** `resolveHospitableCredential`
  TEK çözümleyici (`getOrgHospitableToken` sarmalayıcı): satır (anahtar açıksa) → org kolonları → env (kurucu).
  **Damgalı kuyruk satırı yalnız damgalandığı bağlantıdan gider** — bağlantı aktif değilse `connection_inactive`
  ile bekler, env'e SESSİZCE DÜŞMEZ; başka org'un satırı `connection_tenant_mismatch`. `getConnectionInfo`
  satırdan (yoksa kolondan), SAKLI veriden, sağlayıcıya çağrı YOK ("bağlantı var" ≠ "sağlıklı"); durumlar
  connected/env_fallback/disconnected/revoked/never_connected; kurucunun revoked bağlantısında env erişimi
  korunur (iki gerçek birlikte). Env fallback bir satır DEĞİL. Kolon DROP'u YOK; operatör planı ayrı belge.
- **ChannelConnection (V0.3, migration 49 — CANLI 09-07, kanıt envanter §10):** `(org, provider)` başına TEK satır, disconnect/reconnect AYNI satırı kullanır
  (kuyruk `connectionId` damgaları kopmaz); `generation` her kimlik-bilgisi yazımında artar = refresh CAS
  ikinci çapası (org blob + generation, ikisi de tek TX'te; biri 0 satır → gecikmiş refresh atılır).
  **Dual-write:** bağlan/kaldır/refresh/revoke org kolonları VE satır, aynı ciphertext (bir kez şifrelenir).
  **Okuma anahtarı `CHANNEL_CONNECTION_READ=1` DEFAULT KAPALI** (açıkken satır otorite; satırı olmayan org
  kolona düşer). **Backfill** idempotent, `scheduled-sync` her geçişte (ciphertext AYNEN kopya).
  **`auth_revoked`** (401/403): satır `pending`e park, deneme TÜKETİLMEZ; PAT ya da taze refresh'e rağmen
  401 → org CAS ile temizlenir + bağlantı `revoked` (`send_401/403`) + audit `channel.connection_revoked` +
  alarm; OAuth (10 dk içinde refresh yoksa) → süre şimdiye çekilir, sonraki okuma refresh eder, bağlantı
  aktif kalır. Worker: satırın `connectionId`si başka org'a aitse `connection_tenant_mismatch` (cancel/review).
  Sync yolu 401'de revoke ETMEZ (bilinçli; geçici arıza riski). Env fallback + `getConnectionInfo` kolon
  okuması V0.7'ye kadar kalır.
- Claim-then-send her yolda; claim TTL 120 sn; definitive (4xx≠408) → release+retry, ambiguous → claim
  tutulur (`delivery_unverified`, "iletilemedi" DEME); claim-store hatası 503; adopt-and-heal; çeviri
  fail-closed. Tek atış (`retries:0`); POST idempotent değil.
- Durable outbox (bayrak kapalı): kapalı state seti, `ERASABLE_STATUSES` tek kaynak; teslim etkisi üç
  parça (`markConversationDelivered` · `stampLifecycleSent` · `applyHandoffHold`) + healer; devir hold'u
  enqueue'de değil teslimde; 402 → `blocked`, sync başarısında bir kez `pending`. `autoReplyHoldUntil`
  KİLİTTİR, zamanlayıcı değil; `autoReplyAttemptedAt` konuşmanın `lastMessageAt`'inden alınır.
- CLAIM-THEN-NOTIFY: atomik işaret + yan etki → yan etkinin SONUCU okunur; `emailService.send` bildirim
  yollarında KULLANILMAZ (`sendReporting`); `reportError` `throttled/configured:false` başarısızlık değil.
- Escalation üç yol (model · kelime alerts · `applyInboundMessageRules`); m48 triyaj ikinci model çağrısı
  YOK, temizleme yok, `null` yazılır (undefined değil), `isTriageStale` rozeti.
- Yaşam-döngüsü sorguları `calendarSourceId: null` (kanal iCal işaretçisi DEĞİL); elle `.ics` `channel:"ics"`;
  CSV'de yalnız iptal ön eki eşlenir. Bozuk feed: hataya geçişte tek alarm, ham URL/host alarma girmez,
  `BEGIN:VCALENDAR` yoksa `feed_not_icalendar`. "N kaynak işlendi" = o geçişte vadesi gelen (kohort).
- Sync motoru: fencing token + TTL 15 dk; heartbeat ilerleme-tetikli; `renewLock` geçici hata ≠ kayıp;
  `linkProperty` org-kapsamlı; 540 gün geri pencere kısaltılmaz; gövdesiz sağlayıcı mesajı sayacı
  (`messagesUnimportable`); `str()` trimlemez → `!body.trim()`.
- Provider mesajı sessiz atlanır ve imleç ilerler (bilinçli; ölçüm sayacı var).
- Günlük AI kotası oto-yanıtı da sayar; tavana çarpınca konuşma `new` kalır; kart "AI işlemi" der.
- Yeni org 7/24 açık doğar (şema varsayılanı değişmedi); kurucu muafiyeti `limitsForOrg`.
- Plan sınırları POST/PATCH/COPY hepsinde; yalnız büyüme reddedilir; fail-open (kullanım kapısı).
- Şablon yer tutucu ikamesi TEK GEÇİŞ (`replace` + callback); sıralı split/join ASLA.

**Faturalandırma**
- previewToken HMAC + `jti` tek kullanım; apply öncesi re-preview (409 amountChanged); definitive/ambiguous
  Paddle hataları; pending kilidi; `resolveOrgId` providerRef-first; **`CheckoutConsent`e consumedAt EKLEME**;
  `occurred_at` vetosu; portal plan DEĞİŞTİRMEZ (in-app upgrade/downgrade canlı doğrulandı); `canceled`
  plan değiştiremez (`BILLING_ALLOW_CANCELED_PLAN_CHANGE=1` kaçış); geçersiz imza alarm; hızlı dal audit.
- Yıllık = aynı plan kodu (ayrı "pro_yillik" YOK); `annualAvailable` = 3 env; başlık aylık, alt satır
  yıllık tutar (zorunlu); üstü çizili fiyat YOK; yıllıkta plan değiştirme kapalı. Katalog dışı `priceId`
  reddedilir (katalog yapılandırılmışsa). Açık ticari: `paused` grace; reconcile'da plan otoritesi.

**AI / QR / diğer ürün kararları**
- QR: per-stay device binding; `isOpenNow` simetrik; `chatToken` rotasyonu YOK (bilinçli); PIN DoS tasarımı
  var uygulanmadı (bütçeyi cihaza taşıma REDDEDİLDİ). QR rotasında hata sınırı `reportError`.
- AI öneri paneli kapatılabilir, tercih KALICI DEĞİL. Bekleyen misafir mesajları dar taranıyor
  (`HIGH_STAKES_RISK_TYPES` yalnız son mesajda — açık, ↓açık işler).
- Doluluk gece-katı; ikinci kutucuk `sameDayTurnovers`; üçüncüsünü önerme. Kullanıcının geri aldırdığı
  UI: sidebar grupları, yatay tab-strip, zoom 0.95 geri alma — TEKRAR ÖNERME. Sidebar `mt-4` yük taşır.
- Tarayıcı saat dilimine güven `APP_TRUST_BROWSER_TIMEZONE` default kapalı. S3 virtual-hosted, noktalı
  bucket adı reddedilir. E-posta boot kapısı: Resend veya eksiksiz SMTP.
- Tedarik zinciri: zafiyet kapısı = sıfır TRİAJSIZ (`security/audit-baseline.json`, `expires` zorunlu),
  altyapı arızasında fail-closed + retry; Dependabot PR CI (`head_ref` guard); `schedule:` bu repoda
  çalışmaz (varsayılan dal `main`, `ci.yml` yok) → haftalık denetim CANLI DEĞİL (runbook
  `docs/ZAFIYET-KAPISI-ZAMANLAYICI-RUNBOOK.md`); Node 22 (24 değil); iki aşamalı non-root imaj
  (`chown -R node:node /app` yük taşır; `node:22-slim`de openssl apt şart).
- Operatör scriptleri (PG/Windows): en yüksek kurulu pg sürümü, tüm exe'ler aynı klasör, saf ASCII,
  `pg_ctl -s -w`, `initdb --locale=C`, drill `-ExpectCalendarSources` zorunlu.
- SEO/landing dürüstlük: (app) noindex; mutlak iddia yok; "AI yanıtı" değil "AI işlemi".
- .eu açılışı: ayrı deployment (env: `APP_URL`, `APP_LOCALE`, `APP_BILLING_CURRENCY`, `APP_DEFAULT_TIMEZONE`,
  `APP_TRUST_BROWSER_TIMEZONE=1`); Paddle webhook izolasyonu (ayrı hesap ya da org çözümü persist'ten önce)
  kararı ŞART; SEO yüzeyleri `.com`'a sabit (ayrı tur).

## Açık işler (özet — ayrıntı belgelerde)
- **V0 Channel Independence:** V0.1 ✅ (`2034aba`) · V0.2 ✅ (`bc185db`: ortak fake `tests/helpers/fake-channel.ts`
  + conformance kiti `tests/helpers/outbound-conformance.ts` — fake ↔ gerçek adaptör aynı 14 senaryo; envanter §9).
  **V0.3 ✅ CANLI** (`922f784`, migration 49 prod'da 09-07 15:49Z; pg_dump SHA + kanıt envanter §10). Backfill 0
  satır BEKLENEN: prod'da DB token'lı org yok, Nuve `PRIMARY_ORG_ID` env fallback'inde → `CHANNEL_CONNECTION_READ`
  DB'ye kaydedilmiş ilk gerçek bağlantı olmadan AÇILMAZ. **V0.4 ✅ CANLI** (`c378a97`, migration 50 prod'da 09-07
  19:29Z; prod'daki 17.436 mesaj/1538 rezervasyon `legacy` sınıfında, çıkarım backfill'i bilerek yok; envanter §11).
  **V0.5 ✅ CANLI** (`19d5527`, CI #958). **V0.6 ✅ CANLI** (`a2e60fe`, migration 51 prod'da 09-08 03:13Z; IngestEvent boş —
  Nuve 402'de donuk; envanter §12). **V0.7 ✅ kod hazırlığı CANLI** (`c1f8a2e`, migration'sız; envanter §13). Kolon
  DROP'u (`hospitable*`) V0.3 okuma anahtarı ≥2 hafta canlıda sorunsuz olmadan YOK — canlı geçiş adımları
  `docs/V0.7-CANLI-GECIS-OPERATOR-PLANI.md` (aşama 1: Nuve "mevcut bağlantıyı aktar"; 2: anahtar; 3: env; 4: drop).
  **V1 Property Memory + Signals KOD HAZIR — yerel commit, PUSH EDİLMEDİ** (migration 52; kapı §10 ile aynı; envanter
  §14; bootstrap'ı çağıran yüzey ve UI sonraki adım). V0 kod dilimleri bitti. Kalan V0 işleri kendi adlarıyla: kolon contract'ı için kalan
  okuyucular (backfill · token teşhisi · connect rotası · credentials kolon dalı) · webhook girişi (write service hazır) ·
  bağlantı sağlığı sinyali · `toChannel` ham platform · `Property.hospitableId` global unique (kapsamlı kimlik) ·
  `api/hospitable/diagnostics`. V1 Property Memory + Signals kurucu kararıyla başladı (09-08).
  Availability Engine / RAG / geniş otonom AI V0 bitmeden YOK.
- **GEREKSİNİM (kurucu 09-08, kayıt — uygulanmadı):** doğrudan kanal bağlantısı + iCal aynı mülkte birlikte; aynı
  kanalın iCal'i pasif/yedek (kayıtlı kalır, rezervasyon YAZMAZ), diğer kanalların iCal'i çalışır; iCal doğrudan veriyi
  ezmez/mükerrer yaratmaz; takvim birleşik. `docs/GEREKSINIM-dogrudan-kanal-ve-ical-birlikte-yasama.md` (Airbnb Direct +
  Availability Engine ile birlikte).
- **AÇIK (AI kalite turu, 09-08 QR transkripti):** boş KB'de konum/tesis sorusu → model çağrılıyor ama
  temellendiremiyor → `mustEscalate` son eşiği (`confidence < 0.75`) devir üretiyor; kod düzeyinde "bilgi yok →
  dürüst kısa cevap / tek netleştirme sorusu" dalı YOK (davranış emergent). Eşik AI güvenlik kapısının kendisi →
  GOLDEN SET + iki yönlü senaryo ister. Devir gerekçesi hiçbir yere yazılmıyor (canlı teşhis zorlaşıyor).
  Hakaret/kışkırtma `general` kalıyor. Eval adayları + yol ataması: `docs/ACIK-2026-09-08-qr-cevap-kalitesi.md`.
- **AÇIK (AI kalite turu, 09-08 ölçüldü):** Türkçe olumsuz fiil boşluğu — "sıcak su gelmiyor / su akmıyor /
  ısıtma gelmiyor / elektrikler gitti / kapı açılmıyor" `classifyFallback`'te `general` (şikayet DEĞİL); "sıcak su
  yok" ve İngilizce `no hot water`/`no heating` complaint. Dil paritesi kuralıyla çelişir; `general` sinyal üretmez.
  Düzeltme GOLDEN SET + iki yönlü senaryo ister → `docs/ACIK-2026-09-08-turkce-sikayet-siniflandirma-eksigi.md`.
- **KB onay sözleşmesi (A1) KOD HAZIR — YEREL, PUSH EDİLMEDİ (migration 53 push kapısında).**
  `KnowledgeBaseItem`: `source` (`legacy·host_manual·extracted_draft·suggestion_accepted`) · `reviewState`
  (`legacy·approved·draft`) · `approvedAt` · `sourceRef`/`supersededById` (A5 için, bugün yazan YOK, pinli).
  🚨 **Eski satırların kaynağı/onayı VARSAYILMAZ** (kurucu 09-08): kolon varsayılanı `legacy` ve ÖYLE KALIR —
  "kaynağını beyan etmeyen satır legacy'dir"; `approved` varsayılan değil, POST'ta AÇIKÇA yazılan eylemdir.
  Erişim ALLOWLIST (`legacy`+`approved`) ve TEK kapı `src/lib/kb-review.ts`: AI yolu `ai/kb-fetch.ts` içinde
  `AND`'lenir (çağıran EZEMEZ; `count` de aynı filtreyi kullanır → taslak "yer sınırından düştü" diye
  SAYILMAZ, yoksa yok olmayan bilgi için insana devredilirdi). Şablonlar modelden GEÇMEZ (misafire aynen
  gider) → gönderici + önizleme + Gönderilenler ekranı ortak `GUEST_DELIVERABLE_KB_WHERE` (parite).
  PATCH onay İDDİASI üretmez (zod'da alan yok; `isActive` düğmesi içerik incelemesi değildir), COPY onay
  soyunu DEVRALIR (taslak kopyalanarak onaylıya çevrilemez), taslak mülk hafızasına da girmez.
- **A2 temellendirme izlenebilirliği KOD HAZIR — YEREL, PUSH EDİLMEDİ (migration 54 push kapısında).**
  `RiskEvent`: `kbRetrieved · kbDropped · kbPendingApproval · kbNewestUpdatedAt · kbEvidenceJson ·
  srcDeclared · srcVerified` (hepsi nullable; 🚨 **NULL = ÖLÇÜLMEDİ, 0 DEĞİL** — ölçmeyen yol sahte
  "bilgi yokluğu" üretmez). 🚨 `kbNewestUpdatedAt` SÜRÜM KİMLİĞİ DEĞİL, tazelik işaretidir (iki farklı
  küme aynı max'ı verebilir); "hangi bilgiye dayandı" sorusunu `kbEvidenceJson` yanıtlar: kalem KİMLİĞİ
  + o andaki SÜRÜM + doğrulanmış etiketler, `PropertyMemory.evidenceJson` deyimiyle (yalnız kimlik,
  İÇERİK YOK). YETKİLİ İÇ DENETİM içindir; misafire dönen QR gövdesine girmez (davranışsal pin) ve
  kalem kimliği MODELE de gitmez (`packKnowledgeBase` davranışsal pin — yapısal pin bir mutasyonda
  hayatta kalmıştı).
  `kb-fetch` onay kapısında kalanı ve bilgi SÜRÜMÜNÜ de döndürür (sorgu sayısı artmadan `groupBy`).
  `ai/index.ts` modelin BEYANI (`declared`) ile gerçek girdiye karşı DOĞRULANANI (`verified`) ayrı
  taşır → `verifyUsedSources`'ın sessizce elediği **uydurma atıf** artık görünür. Okuma tarafı
  `lib/ai/grounding.ts`: `classifyGrounding` bir ETİKET + `decisive` bayrağı döndürür, HÜKÜM DEĞİL
  (bugün hiçbir sınıf `decisive`); yeni kalem önerisi YALNIZ `absent` sınıfında meşru —
  `awaiting_approval` (bilgi var, onaysız) · `ungrounded` (gitti, kullanılmadı) · `capacity` (tavan) ·
  `fabricated_citation` sınıflarında host'a "bilgi ekle" DENMEZ. 🚨 `absent` DAHİL hiçbir sınıf
  `decisive` değil → host'a giden şey KESİN TESPİT değil **İNCELEME ADAYI** (`reviewCandidate`);
  otomatik bilgi oluşturma YOK ve modül DB'ye hiç erişmediği için yapısal olarak imkânsız.
  Sayaçlar hiçbir gönderim kararına girmez.
- **DEĞERLENDİRME (Codex/kurucu 09-08; A3–A5 uygulanmadı):** host metninden alan önerisi (taslak, çelişkide
  host seçer; yer tutucu `{isim}` gerçeğe DÖNÜŞMEZ) · eksikleri GERÇEK sorulardan bulma (V1 `Signal` verisi
  zaten akıyor; kategori ↔ KB eşlemesi + tekilleştirme + bildirim yağmuru yok) · yapılandırılmış alan ↔
  retrieval ayrımı (çift kopya yasak; vektör GEREKLİLİK ölçülmeden eklenmez) · yetki filtresi retrieval'dan
  ÖNCE ve sır elemesi GEVŞETİLMEZ. 🚨 **A2 düzeltmesi:** `usedSources` TEK BAŞINA "bilgi yok" ile "retrieval
  başarısız"ı AYIRMAZ (modelin beyanıdır; hiç kalem verilmemiş de olabilir) → kodun bildiği ile beyan
  edilen YAN YANA kaydedilir (A2 ile UYGULANDI).
  Sıra ve gerekçeler: `docs/DEGERLENDIRME-2026-09-08-bilgi-tabani-doldurma-ve-retrieval.md`.
- **Codex P2 (F09–F18)** ilgili modül turlarında. `docs/DENETIM-2026-08-09.md` (27 açık),
  `docs/ACIK-ISLER-2026-08-08.md` (16), `docs/MIGRATION-BEKLEYEN-ISLER.md`.
- Operatör: bucket sağlayıcı görünürlüğü (imzasız URL 403 olmalı) · `weekly-audit.yml` `main`'e ·
  `security@lixusai.com` · retention bayrağı onay paketi · `UNVERIFIED_SWEEP` açılış sırası (dry-run önce) ·
  Railway Pro + PITR lansmandan 2-3 gün önce · mevcut org'ların aktif-saat penceresi (0/0 elle).
- LEGAL (avukat): SELLER etiketi "MERSİS/Vergi No" ama tüzel kişi İtalyan (metne dokunma) · yıllık peşin
  sözleşmede cayma hakkı · alt-işleyen listesi (Akash çıkarılacak) · KVKK standart sözleşme/VERBİS ·
  erasure bayrağı imza sonrası · `LEGAL_VERSION` bump avukat onayıyla.
- Güvenlik tasarım kararları bekleyen: kurtarma kilitleme (kova `email+IP` çiftine) · `paused` müşteri
  grace · reconcile'da yerel plan yazımı · bekleyen mesajlarda yüksek-risk taraması · middleware noktalı
  yol · halka açık sayfada çerez yenileme · `PADDLE_WEBHOOK_SECRET` boot kapısı.

## Durum
**Origin HEAD `4c1efea` (V0.6 + V0.7 canlı; CI 5/5 run #960; migration 51 prod'da 03:13Z; Railway healthcheck-gated
oto-deploy). V1 Property Memory + Signals CANLI: push `4c1efea..7aa228f` (altyapı `16f70f5` + ürün akışı `4e9b1b1`),
CI run #964 5/5, **migration 52 prod'da 09-08 06:11:42Z**, ilk geçiş KB hafızasını doldurdu (32/32), IngestEvent/Signal 0
(gerçek olay yok). **3734 test yeşil (335 dosya) · typecheck/lint/build/audit temiz.**
Son PUSH EDİLEN iş: arayüz düzeltmeleri + uygulama planı (`7155117`, CI run #992 success; ondan öncekiler
#990 `74f77f9`, #988 `79a271a` — hepsi success). **Yerelde, PUSH EDİLMEMİŞ: A1 KB onay sözleşmesi +
migration 53** (push kapısı: taze `pg_dump` + açık onay). **Canlı ürün akışı KISMEN doğrulandı** (plan
`docs/V1-CANLI-DOGRULAMA-OPERATOR-PLANI.md` §3): KB → kart ✅ · **tek rezervasyonlu dosya → iptal → sinyal → kart ✅
(09-08)**; QR mesajı, URL üzerinden iCal, toplu dosya, `date_change`, örüntü DOĞRULANMADI. Kart OLAY tarihini gösterir
(`Signal.occurredAt`), konaklama tarihini değil. **Açık bulgu:** Gist beslemesinde "1 atlandı"
(`docs/TESHIS-2026-09-08-ical-iptal-atlandi.md`). Açık vizyon parçaları (bakım sinyali V3 · güçlü yön V6 · proaktif
check-in V2/V5) belgede; V2'ye geçilmedi. **QR şikayet→sinyal ✅ arayüzden doğrulandı** (09-08, test mülkü
`cmtsiavia0001qs2qxar7n8d9`; ara DB kayıtları sorgulanmadı) — yalnız sinyal zinciri, **cevap kalitesi DEĞİL**
(`docs/ACIK-2026-09-08-qr-cevap-kalitesi.md`). Gist bulgusunun kök nedeni KANITLANMADI (içerik doğrulaması
yapılmadan kapatılmaz).
Prod smoke bu ortamdan yapılamaz; operatör adımları
`docs/audit-2026-09-05/DURUM.md` + `docs/V0-CHANNEL-INDEPENDENCE-INVENTORY.md` §10 (push kapısı).
