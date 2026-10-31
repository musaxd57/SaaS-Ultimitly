# Yol planı (kurucu talimatı 2026-09-07 özeti)

> CLAUDE.md'den 2026-10-08'de AYNEN taşındı (kurucu: ".md'ye yığma, gerekli yerlere taşı, gerekli şeyleri silme").
> Bu dosyadaki kurallar CLAUDE.md'deki kadar BAĞLAYICIDIR. İlgili alanda iş yapmadan önce oku.

> 📋 **Madde madde güncel durum (kodda ölçüldü): `docs/YOL-PLANI-DURUM-2026-10-09.md`** — kurucu 10-09: "o mesajda sıralama nasılsa
> öyle ilerle, yaptıklarını tekrar yapma". Sıra: V0 kalanları (V0.8…) → kapı 2 eksikleri → Availability Engine'in AI'ya bağlanması → V2.

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
`docs/V0.7-CANLI-GECIS-OPERATOR-PLANI.md`, ön koşul: okuma anahtarı ≥2 hafta)) → **V1 Property Memory + Signals CANLI
(migration 52 prod'da 09-08 06:11Z; `docs/V1-PROPERTY-MEMORY-DESIGN.md`, envanter §14)** → **V2.1 "Dikkat Gerektirenler" CANLI (09-09, salt-okuma, migration'sız)** → ④ deterministik **Availability Engine**
(**İLK DİLİM 09-24**: saf çekirdek + yükleyici + panelde çakışan rezervasyon satırı; AI'ya BAĞLANMADI; `docs/MUSAITLIK-MOTORU-2026-09-24.md`) → ⑤ geniş
otonom AI yalnız yetki+guardrail+grounding+eval doğrulandıktan sonra. **V0 sırasında YAPILMAZ:**
Availability Engine, RAG/GraphRAG, Property Memory, Exception Feed, Revenue Brain, Proof AI, Ask Lixus,
Review/Issue tabloları. Yalnız dar, davranış-koruyan temel eklenebilir.
**Ürün fazları (V0 sonrası, bağımlılık sırasıyla):** V1 Property Memory + Signals → V2 Exception Feed
("Needs your attention", money impact) → V3 Actions + Tasks → V4 Proof AI → V5 Reservation Risk/Readiness →
V6 Review + Recurring Issue Brain → V7 Revenue Brain → V8 Ask Lixus → Action. Intelligence katmanı ayrı
bounded context (`/modules/intelligence`: memory/signals/incidents/recommendations/actions/scoring/agents/
audit), event dinler; AI bozulsa PMS çalışır. Konumlandırma: "AI Operating System for Short-Term Rentals".
**Airbnb başvurusu öncesi 6 kapı** (09-24: boş `AirbnbDirectAdapter` sözleşmesi ✅ `docs/AIRBNB-DIRECT-SOZLESMESI.md` ·
demo hesabı üreticisi ✅ kod, CANLIYA KOŞULMADI `docs/DEMO-HESABI.md`): channel independence (boş `AirbnbDirectAdapter` sözleşmesi dahil) ·
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
