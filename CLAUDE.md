# CLAUDE.md — Lixus AI proje hafızası

> Her oturum başında okunur (HER alt ajana da yüklenir — kısa tut). Yalnız KURALLAR ve GÜNCEL DURUM.
> Gerekçeler/ölçümler/tarihçe: `docs/history/CLAUDE-2026-09-23-sadelestirme-2-oncesi-tam-metin.md` (219 KB, aynen) ·
> `docs/history/CLAUDE-2026-09-07-sadelestirme-oncesi-tam-metin.md` (239 KB'lık eski hâl, aynen)
> + `docs/history/CLAUDE-2026-07.md` / `CLAUDE-2026-08.md` + `git log`.
> Kanıt sözleşmesi: `docs/TEST-EVIDENCE-CONTRACT.md` (BAĞLAYICI). Plan: `ROADMAP.md`.
> **Yol planı (kurucu talimatı 2026-09-07, AYNEN): `docs/KURUCU-TALIMATI-2026-09-07-urun-vizyonu-ve-degismezler.md`**
> — ↓"Yol planı" bölümü onun özetidir, çelişkide o metin kazanır.
> Denetim turu: `docs/audit-2026-09-05/` (`SECURITY-ARCHITECTURE-REVIEW.md` · `CLAUDE-HANDOFF.md` · `DURUM.md`).
> V0: `docs/V0-CHANNEL-INDEPENDENCE-INVENTORY.md`.

## Ürün
**Lixus AI** (lixusai.com) — Türkiye odaklı, çok kiracılı SaaS; kısa dönem kiralama hostlarının
Airbnb/Booking misafir mesajlarını AI ile yanıtlar. Operatör: kurucunun kendi işletmesi (~10 daire). Türkçe
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
- 🚨 `KB_RETRIEVAL_MODE` bir ACİL DURDURMA düğmesidir: `legacy/off/0/false/no/disabled` eski davranış, başka HER
  değer (boş dâhil) hibrit. Gevşek yazım bilinçli; "tanınmayan → legacy" ölçülüp REDDEDİLDİ. Görünürlük:
  `kbRetrievalModeInfo().recognized` + boot `[kb-retrieval] mode=…` + `.env.example`.
- **TEK BOĞAZ `selectKbForPrompt`** — yetki/mülk/onay (`kb-fetch`) ve sır elemesi ÖNCE, `suggestReply` SONRA; dört
  AI yüzeyi geçer (pin). Hibrit legacy'den AZ bilgi taşımaz: küçük KB (🚨 ≤30 kalem VE ≤24k = legacy'nin KENDİ
  kümesi → seçim YOK; 09-23'e kadar ≤12 kalem/≤6k idi ve tipik host KB'sinde parafraz soruların cevabını
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
  ek. Türkçe/İngilizce seçim birebir aynı (`sources.foreign:false` kıyası pinli). Geri EKLENMEYECEK girdiler: RU
  машина/пробки · FR four/chat/café/partir/tekil drap · DE laut · ES parada.
- 🚨 **ANLAMSAL (embedding) KAYNAK: ÜRETİM YOLU VAR, ANAHTAR `KB_SEMANTIC_RETRIEVAL` VARSAYILAN KAPALI (09-23).**
  Yüzeyler tek girişten `retrieveKbForPrompt` (`ai/kb-retrieve.ts`) → `selectKbForPrompt`; puanı YALNIZ o verir
  (pin). Kapalıyken ağ çağrısı yok, sonuç birebir (davranışsal pin); açılmadan raporlarda "anlamsal retrieval"
  denmez. Açma = E4 + eşik ölçümü + kurucu onayı (`docs/EVAL-CALISTIRMA.md`). Kurallar: alt sorgu BAŞINA puan
  (`retrievalQueries` tek kaynak), her alt sorgu ait olduğu HAM cümle + virgülle bölündüyse kendisiyle sorulur
  (en yüksek kosinüs); sıcak yol 1,5 sn; soğuk KB bekletmez (arka plan ısıtma, saatlik tavan); YARIM HARİTA YOK;
  rerank'te anlamsal uyum bonusu (= kavram ipucu büyüklüğü; kâhin iki soruda %87→≥%90); kalıcı sağlayıcı arızası
  AYRI anahtarlı geçiş alarmı (`model-provider:embedding`). 🚨 **Mutlak alaka eşiği ("≥%80, en iyi 3–5") ÖLÇÜLÜP
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
  anlamsal ≥0.3) — `base > 0` yetmez.
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
- **Önbellek anahtarı küme parmak izi** (id+updatedAt+içerik özeti), `max(updatedAt)` DEĞİL. Kanıt
  `kbEvidenceJson.retrieved[].c` + `.retrieval {q, fb, sel, cand, ms, srcs, sup, conf, fus}` — PII yok, misafire dönmez.
- **Retrieval politika DEĞİLDİR** (kötü niyetli kalem sözcüksel eşleşince gider; eleme ayrı onay). Güvenlik
  filtreleri yeni yolda AYNEN (`kb-retrieval-secret-scope.test.ts`, bayrak açık).
- **Host graf katmanı** `modules/intelligence/graph/property-graph.ts` (saf, yüzeye bağlı değil): her kenar
  `source/observedAt/certainty`; `recurringIssues` kanıt sınıfı `reported_only|task_open|task_done` ('confirmed'
  YOK); görev kanıtı YALNIZ bildirime bağlı görevlerden; misafir yoluna taşınmaz (pin). LightRAG/HippoRAG = ücretli → onay.
- Mutasyon kontrol koşusu (M0) her turda ZORUNLU (09-09: fixture hatası 6 mutasyonu sahte "yakalandı" gösterdi).

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
- **Repo PUBLIC (kurucu 09-24, Actions dakikası 2000'i aştı)** → standart çalıştırıcılar ücretsiz. Private'a dönülürse
  ayda 2000 dk (push başına ~14 dk); CI durursa sebep kota olabilir. Repoya sır/gerçek veri/işletme adı YAZILMAZ.
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
- **Tek kaynak:** `src/lib/ai/prompts.ts` + `fallback.ts`; tüm yüzeyler (oto-yanıt, inbox öneri, Ayarlar testi, landing
  demo, QR) buradan. Demoya özel hiçbir şey yok.
- **3 seviye:** düşük risk → oto-gönder · orta (opt-in `autoHoldingReplyEnabled`, default kapalı) → deterministik
  bekletme mesajı + "Sorunlu" + e-posta · yüksek → sessiz taslak + host'a acil mail.
- **Kod kapısı `passesAutoReplySafetyGate`** (karar modele verilmez): source==openai + intent blocklist + kelime-ağı
  çapraz-kontrol (son mesaj + bekleyen mesajlar) + injection vetosu (geçmiş aynası istemle AYNI seçiciden) +
  bilinmeyen-intent clamp + yüksek-riskli `riskType` vetosu + `Number.isFinite(confidence)` + ≥0.75 + çıktı vetosu +
  `admitsMissingKnowledge`. Tek muafiyet: human_request devir.
- **Model çıktısı STRICT (F01):** `riskLevel` yalnız kapalı-küme string, eksik = tanınmayan = "high"; `confidence`
  yalnız sonlu number (boolean/string/null→0). Şema ihlali `reportError` (throttled). `riskType` 11'lik kapalı set;
  `usedSources` kodda doğrulanır (beyan ≠ doğrulanan); `missingInfo` 5×80.
- **GOLDEN SET** (`tests/unit/golden-scenarios.test.ts`): prompt/kelime-ağı değişince koşulur; yeni risk sınıfına
  hem tehdit hem övgü-tuzağı senaryosu.
- **Görünmez karakter = `\p{Default_Ignorable_Code_Point}` + U+2800** (liste değil); `\p{Mn}` tamamı EKLENMEZ.
  Dil paritesi `SAFETY_CRITICAL_WORDS` ↔ `KEYWORDS.complaint`. Kesme işareti kelime sınırıdır. Homoglif/NFKC katlama
  (`matchCandidates`) yalnız karma yazıda ve EK aday. `includesAnyFold` (3 katlama) YALNIZ kısıtlayıcı dedektörlerde;
  `isPositiveFeedback`/`isClosingAck` beyaz listelerine ASLA.
- **QR bağlamı:** `buildGuestChatContextWindow` (24 mesaj / 8.000 karakter, `(createdAt,id)` sırası, taşan açık konu
  PII'siz `openTopics` — devir sebebi değil). Her karar `RiskEvent` (`surface:"guest_chat"`, kapalı-küme gerekçe, PII
  yok, await). 🚨 **Geçmiş de taranır** (`history_injection`: yalnız injection; modele giden AYNI dizi). 🚨 Yeni
  gerekçe `risk-events.ts` REASONS'a da eklenir (pin `risk-event-reason-parity`); bağlantı davranışsal pinli.
- **QR misafir rotası:** mesaj penceresi `GUEST_CHAT_MESSAGE_WINDOW` 200 + tam sıra (cursor REDDEDİLDİ); istemcide
  görünürlük kapısı, terminal durumda `clearInterval`, 3 ardışık hatada uyarı. Devir metni gerçeğe uygun
  (`escalationReply()`: "kaydedildi; ev sahibiniz görebilir" — "ilettim" İDDİA EDİLMEZ); devir yapışkan değil.
- 🚨 **"BİLGİM YOK" MİSAFİRE ASLA GİTMEZ (kurucu kuralı 09-11, `ai/absence.ts`):** `admitsMissingKnowledge` iki
  kapıda (kanal → gönderilmez; QR → `absence_admission` devri). İstemdeki "temellendiremiyorsan yokluğu söyle"
  kuralı KALIR (uydurmayı engeller); gönderim kapıda kapanır. Ölçüt cevabın KENDİ itirafıdır, "kaynak yok" DEĞİL
  (mülk alanından gelen cevap kaynaksız görünür ama dayanaklıdır). Yüklem NESNE + OLUMSUZLAMA dilbilgisidir: `yok`
  nesneye bitişik, cümle sınırı boşluğu keser ama `15.00` bölünmez, İKİ katlama (standart + tr) ayrı pinli;
  belirsizlik ve savuşturma BİLİNÇLİ dışarıda. Eval harness'ı ürün yüklemini yeniden dışa aktarır (tek kaynak).
  Önizleme rotaları (`api/ai/test`, `api/demo/ai`) kapıya `reply` VERMEK zorunda (parite pinli).
- **Çıktı vetosu / makbuzsuz iddia:** ↓Kalıcı ürün kararları. `hasUnsourcedSpecificClaim` BUGÜN ÜRETİMDE KOŞMAZ
  (yalnız `QR_INFORMATIONAL_BAND_ENABLED` açıkken; varsayılan kapalı). QR bilgi bandı (0.45–0.75, kapalı): bant
  güvenlik dallarının ARDINDA; kaynaksız somut iddia gönderilmez (`unsourced_claim`); açma sırası eval → tek mülk.
- **Konuşma kuralları:** nezaket kapanışı yalnız BİLGİ konusunu kapatır; operasyonel konu yalnız çözüm bildirimiyle.
  Kapanış gündemdeki SON konuyu kapatır (yakınlık). `+1 ms` nedensellik kanıtı değildir (doğrusu
  `Message.replyToMessageId`, migration); QR bot cevabı misafirden +1 ms damgalanır, `id` kopma noktası korunur.
  Kalite denetçisi `lte` + `id` kopma noktası; `guest: null` tek başına proaktif kanıtı değil. Gölge pilotu QR'da
  çalışmaz (tasarım). Selam tekrarı: `isFirstOperatorReply` kodda.
- 🚨 **KB talimat-ele-geçirme süzgeci (`detectKbInstructionHijack`, 09-23):** `kb-fetch` tek boğazında, her boyutta,
  seçiciden ÖNCE; kalem isteme girmez, `dropped`a karışmaz, kanıtta `hj`, host'a "Yapay zekâ kullanmıyor" rozeti.
  Misafir kalıpları KB'ye UYGULANMAZ (16 host cümlesinin 10'u yanlış pozitif). Yalnız yapay zekâya yönelen biçimler
  (sahte rol/çit işareti, çıktı alanı, TEKİL emir / 2. çoğul iyelik, rol değişimi). Kör batarya 0/150 yanlış
  pozitif, genelleme 22/60 → "düz emir" sınıfı içerik süzgeciyle ayrılamaz (bilinen sınır, pinli).
- 🚨 **ANLAM KATMANI (09-24, kurucu: "kelimeye takılma, anlamı modelle çıkar"; `docs/ANLAM-KATMANI-2026-09-24.md`):**
  müsaitlik/konaklama değişikliği kararı `evaluateAvailability`te DÖRT katmanın birleşimi, hepsi yalnız SIKILAŞTIRIR:
  kelime ağı (`availability-claims.ts`, YALNIZ YEDEK — kör bataryada izinlerin 19/60'ı; BÜYÜTÜLMEZ, taban circirde
  `stay-change-backstop-floor.test.ts`) · cevap modelinin şema beyanı (`stayChangeAsked`+`replyStance`; iddia duruşu
  varsayılan ZORLANIR) · bağımsız bekçi (`semantic/guard.ts`, `AI_STAY_GUARD_ENABLED`) · anlama katmanı
  (`semantic/understand.ts`, `AI_UNDERSTANDING_ENABLED`). Model saati ÇIKARIR, kıyas KODDA (`slotTimesShifted`).
  🚨 **BELİRSİZLİK GÜVENLİ DEĞİLDİR (kurucu değişmezi 09-24):** HASSAS İSTEK + bekçi YOK (bayrak kapalı = düşmüş =
  aynı) ya da beyan YOK/tanınmıyor → otomatik gönderim YOK, devirde de. 🚨 **BİRLEŞİM DEĞİŞMEZİ (09-24 üçüncü tur):**
  hassas istek = kelime ağı ∨ beyan (`asked`/ret) ∨ cevap modelinin niyet etiketi ∨ anlama katmanı ∨ bekçi; HİÇBİR
  katmanın "istek yok"u başkasının isteğini SİLEMEZ; hassas istek ancak İKİ model ertelemesiyle (güvenilir `defers`
  beyanı + koşmuş bekçi) gider. Gölge kip YOK (`AI_STAY_POLICY` / `AI_INTENT_POLICY` okunmaz; geri almak = katmanın
  kendi bayrağı). Bedeli bilinçli: konu etiketi `early_checkin` olan bilgi sorusu da taslağa düşer ("yanlış otomatik
  izin çok kötü, gereksiz inceleme kabul edilebilir") — oranı eval'ın BİRLEŞİM tablosu + canlı `sc` ölçer. Tanınmayan duruş her zaman iddia. Kelime ağı yalnız ENGELLER:
  sessizliği de erteleme cümlesi de izin DEĞİL (erteleme = YALNIZ güvenilir `defers` beyanı + koşmuş bekçi). Hassas
  istek yoksa (bilgi sorusu) bekçisiz de gider — her arızada her mesaj durmaz. Yedek (şablon) cevapta "duruş
  bilinmiyor" kuralı yok. "kaydedildi" tek başına ve "ev sahibi onaylar" (kestirim) erteleme DEĞİL; erteleme
  dedektörü TEK biçim. Host'un teklif metni iddia taramasından yalnız erteleyen cevapta muaf (bekçi koştuysa
  onun hükmüyle; koşmadıysa beyan+cümle yalnız muafiyete yeter, izne değil — bekçi çağrılabilsin diye). 🚨 Standart çıkış bilgisi
  ("çıkış günü 11:00'e kadar kalabilirsiniz") izin DEĞİL ama YALNIZ: saat çıkışa BİREBİR eşit + cümlecikte
  tarih/gün/akşam/uzatma işareti yok + cevapta onay ("Sure/Tabii") yok; yalnız İZİN kalıplarına ("≤" kıyası 22
  gerçek izni gizliyordu — son denetim). 🚨 Üçüncü taraf dışlaması YALNIZ bitişik yapıyı ("book a taxi",
  "otopark müsait mi") siler, genel kalıp KALAN metinde yeniden aranır (nesne sözcüğü mesajın herhangi bir
  yerinde geçince susturmak gerçek istekleri düşürüyordu; kapalı sınıf, GENİŞLETİLMEZ). Bekçi `availability_unconfirmed` tutuşunda da koşar (iki model ertelemesi
  kaldırabilsin; kanal+QR). `RiskEvent.reason` kapının İLK düşen kontrolü (`autoReplyGateFailure`). Semantik
  katmana giden metinde yalnız GEÇERLİ tarih/saat dizisi korunur (`semantic/redact.ts`; noktalı/tireli telefon
  parçalanıp kaçmasın); ayraç çalışması `[<>]{2,}` silinir; 400 desteklenmeyen parametre/şema = kalıcı arıza
  sınıfı `request` (yalnız `semantic` kanalı); anlama katmanı düşerse kanıtta `u: failed`; semantik zaman aşımı
  tavanı 20 sn (QR `qr-in:` 120 sn TTL). Kanıtta `sc.ev` artık `sc.v`ye eşit (şema kararlılığı). Bekçi düşerse
  modelin konaklama sinyali varsa tutulur. Tek ağ kapısı `semantic/structured-call.ts` (Structured Outputs strict; alarm `semantic`
  kanalı), yapılandırma tek kaynak `semantic/config.ts`. Açma = eval (`evals/stay-change.json` YALNIZ `holdout`
  satırları; `dev` görüldü) + kurucu onayı; sıra belge §5. **09-25: eval + mühürlü final GEÇTİ → kurucu İKİ bayrağı
  CANLIDA AÇTI** (`AI_UNDERSTANDING_ENABLED=1` + `AI_STAY_GUARD_ENABLED=1`; `AI_SEMANTIC_*` BOŞ = ölçülen yapılandırma,
  semantik katmanlar `OPENAI_MODEL`e düşer; model değişimi = yeni kör set). Ayarlar AI testi bekçiyi KOŞMAZ (hassas istekte orada "gönderilmez" görünür; belgeli fark). 🚨 **Risk niyetleri** (acil > şikâyet > iptal-iade >
  insan; `semantic/intent-risk.ts`): kelime ağının kaçırdığı dolaylı dil ÖLÇÜLDÜ; kapının SON kontrolü (kanal:
  güvenden sonra; QR: iki geçiş çıkışından önce), yalnız sıkılaştırır, katman koştuysa HER ZAMAN karar verir (birleşim
  değişmezi; kanıt `ir`); modelin kendi devir cevabı insan talebinde muaf; kanalı YALNIZ bu niyet kapattıysa acil yükseltme
  (Sorunlu + acil + host e-postası, atomik claim; kurucu "sen seç" 09-24 → evet), rozet niyetin etiketi; kanal + QR +
  Ayarlar önizlemesi aynı yüklem, gerekçe `understanding_risk` REASONS'ta.
- 🚨 **DOĞRULANMIŞ ERKEN GİRİŞ (09-24, kurucu: "hassas istek = ENGEL değil, doğrulama iş akışı"; `lib/early-checkin`,
  `docs/ERKEN-GIRIS-DOGRULAMA-2026-09-24.md`, migration YOK):** yalnız tüm katmanların istek türü TEK `early_checkin`
  iken (`stayRequestKinds`; birleşim kuralı AYNEN). Saf çekirdek kapalı-küme kodlarla karar verir; otomatik = host
  kuralı `auto` (varsayılan KAPALI, `AutomationRule`, yönetici kapılı) + onaylanabilir + iki model (anlama + bekçi)
  AYNI saati okudu (yalnız istek gören modelin saati sayılır) + tek konu (anlama listesi VE cevap modelinin niyet
  etiketi `early_checkin`/`checkin`). Onay metni KODDA (6 dil, selamsız, GÜNÜ adlandırır); ücret YALNIZ host'un
  kaydından, model tutar üretmez. Kapı bu metinle BAŞTAN koşar: niyet `early_checkin`e sabit, GÜVEN modelinki (1'e
  çekilmez); müsaitlik muafiyeti YALNIZ birebir aynı metin + tek tür. Hazır = BU DEVRİN (çıkış günü) temizlik
  görevlerinin HEPSİ kapalı + bir kayıt önceki çıkış ANINDAN sonra ≥5 dk (tek kural `readiness.ts`); önceki çıkış =
  misafir bildirimi ile varsayılanın GEÇ olanı; aynı gün devir yoksa dün gece yalnız motorun taze "boş" hükmüyle;
  05:00 öncesi saat geç varıştır (`not_early`). Not çıktı vetosundan geçmezse kayıtta reddedilir. Ücret personele
  görünmez (form + görev notu). Bugün üretimde otomatik GİTMEZ (iki bayrak kapalı + kredi yok) → host'a kontrol listesi.
  Temizlik bitince: YALNIZ hazırlık yüzünden tutulmuş cevapsız istek BİR KEZ yeniden aday olur (`recheck.ts`; karar
  vermez, göndermez); döngü koruması giriş hazırlığı görevindeki NOT (karar kaydı aynı mesajın ikinci tutuşunu yazmaz).
  🚨 **KANIT MODELİ (09-24 ikinci tur, `docs/ERKEN-GIRIS-KANIT-MODELI-2026-09-24.md`):** dört durum `approvable ·
  pending · needs_host · not_early`, otomatik RED YOK (bilinmeyen "hayır" değildir). `pending` YALNIZ kanıt GELEBİLİRSE
  (hazırlık / varış günü; önceki misafirin beklenen çıkışı yalnız host `readyBeforeCheckout` rızasıyla bekler, çıkış
  saati bilinmiyorsa host). "Bitti" yalnız KİMLİKLİ + görevin EN SON durum kaydı; çıkıştan ÖNCEKİ hazır yalnız rıza +
  ayrılan konaklamanın ÇIKIŞ TEMİZLİĞİ görevi (yaşam döngüsü) + devir günü + "bitti"nin HEMEN ÖNCEKİ kaydı aynı kişinin
  "başladım"ı (≥15 dk) → çıkış kanıtı; misafirin "çıktık"ı onay kanıtı DEĞİL, beyanı yalnız sıkılaştırır. Yalnız
  OTOMATİK gönderimi durduranlar: başka güne işaret (TR ekli adlar, büyük İ, Arapça hareke, "next <gün>", ABD tarihi),
  misafirin yazdığı saatle çelişki (yarım/çeyrek anlatımları dahil), modellerin görmediği mesaj (100 karakter maske
  payı), saat okunamadı, kalıcı kuyruk açık (bayat "bugün" onayı), mülkte açık bakım, temizlikçinin bugünkü notu.
  Karar kaydı `ec` = durum + kodlar + dayanak kimlikleri (`dr/rm/rt/rh/n/dc`; metin/saat/tutar YOK, alan alan
  doğrulanır). Kural deposu tek `where`, mülk satırı kilitli kayıt, mülk silinince kural silinir.
  🚨 **PARA (dilim 8):** hassas istekte iki modelin doğruladığı ERTELEME de tutar/yüzde/indirim/muafiyet söyleyemez →
  `price_claim`. Birleşim: biçim dedektörü `ai/stay-money.ts` ∨ bekçinin fiyat sözü (`reply_price_terms`) ∨ bekçinin
  çıkardığı tutar (`reply_amounts`) host'un kaydında yoksa — kıyas KODDA. Host'un geç çıkış teklif tutarı YALNIZ geç çıkış
  isteğinde izinli (çeviride de); başka isteğe aktarımı para. Para sözlüğü tek kaynak `ai/money-lexicon.ts`; `claim-support`
  kapıya GİRMEZ. Öncelik: iddia → ertelenmemiş istek → para. Hassas olmayan cevapta para kontrolü YOK (genel tutar = P5).
  Bekçi redakte taslağı TAM göremezse hüküm vermez. Kör holdout (ayarsız): para %74, temiz %97 — kelime dedektörü
  YEDEK, serbest anlatım bekçinin işi; holdout'a göre AYAR YAPILMAZ (yeni kör set gerekir). **Bilgi sorusu** ("ücretli
  mi?"; anlama + bekçi koşup "istek yok", tek sinyal konu etiketi, kural `auto` + kayıtlı ücret) → koddan politika metni
  (`early_checkin_policy`); ek şart `earlyCheckinPolicyAllowed`: modeller mesajların TAMAMINI gördü + mesajda SAAT /
  başka gün YOK (somut istek); host notu politika metnine EKLENMEZ. **Yeniden değerlendirme turunda** yalnız doğrulanmış
  onay gider; kilit akışın koşmasına BAĞLI DEĞİL, mesaja bağlı (son mesaj `(createdAt, id)`, tarama ile aynı).
- **Misafirin yazdığı çıkış saati (`guestCheckoutTime`) BEYANDIR (C-9, tek kural `lib/guest-checkout-time.ts`):** istek
  de bu alana düşebilir. Resmi çıkıştan SONRAKİ (ya da karşılaştırılamayan) saat istemde "geç çıkış ONAYLANMADI";
  panoda resmi saat esas, misafirinki ikincil not. Hiçbir yüzey `guestCheckoutTime ?? resmi` ile esas saat SEÇMEZ (pin).
  Kayıt kalır: erken girişte yalnız sıkılaştırır.
- **Görev durumu + geçmiş kaydı TEK işlemde (C-17, `api/tasks/[id]`):** geçmiş yazılamazsa durum da değişmez ("bitti"
  kanıtsız kalmaz). Görev durumunu değiştiren YENİ yol aynı işlemde `TaskUpdate` yazar.
- **Yaşam döngüsü görevleri rezervasyon tarihini izler (C-16, `lib/tasks/follow-reservation.ts`):** tarih değişince AÇIK
  SİSTEM görevi, tarihi ESKİ rezervasyon tarihine BİREBİR eşitse aynı TX'te yeni tarihe; host'un taşıdığı / bitmiş /
  elle / mesajdan görev dokunulmaz. Tarih değiştiren YENİ bir yazma yolu eklenirse aynı fonksiyonu çağırır.
- 🚨 **TEMİZLİKÇİ GÖRÜNÜMÜ (09-24, `lib/tasks/staff-view.ts` TEK kural):** personel ve temizlik listesi (WhatsApp)
  misafir ADI / MESAJI görmez — sistem görevi → tür adı, yapay zekâ görevi → yalnız "Tür: konu" (rakamsız) + açıklama
  YOK, elle görev → aynen. Uygulandığı yerler: personel görev listesi + güncelleme cevabı, personele atama e-postası,
  görev kartı (`card-data.ts`), temizlik listesi (her oturumda). Yeni bir personel yüzeyi eklenirse AYNI fonksiyondan geçer.
- **KB sır kapısı:** `withoutSecretKbItems` (TAM tarama, 24k üstü fail-closed) + `QR_SECRET_CATEGORIES` +
  `verifiedActiveStay`; stil profili 4 yüzeyde süzülür. 🚨 Kapı KB KALEMLERİNİ süzer; mülk KİMLİK ALANLARI (ad/adres/
  şehir/saat) taranmadan gider (karakterizasyon pinli; kapatmak ayrı onay `docs/ONAY-qr-mulk-kimlik-…md`).
- **Yer tutucu:** `packKnowledgeBase` bloğa giren `[…]/<…>/___` (içinde harf) için KODDAN "DOLDURULMAMIŞ YER TUTUCU"
  notu yazar (başlık taraması GERİ ALINDI — etiketleri yer tutucu sanıyordu). İkame tek kaynak `kb-placeholders.ts`
  (`{isim}·{ad}·{name}` · `{daire}·{apartment}·{apt}`; tek geçiş `replace`+callback; `Object.hasOwn`). 🚨 QR'da
  GERÇEK AD KULLANILMAZ ("misafirimiz"); QR'da sır kapısı ham VE ikame sonrası çalışır. `{daire}` belirsizde ikame
  EDİLMEZ (`apartmentNumberOf`: güçlü etiket daire/apartment/apt/D: önce, zayıf no/# sonra; sayaç sözcüğü/3+ hane/
  birden çok sayı → null; sayısız ad → null; iki katlama; önde kelime sınırı).
- **İstem bütçesi:** `REPLY_SYSTEM_PROMPT` ~46k karakter ("~75KB" yorumu YANLIŞ); BÖLÜM 13 = 24 few-shot, istemin
  %35'i, 19'u pinsiz, 5'i sahte Wi-Fi şifresi öğretiyor — daraltma ÖLÇÜMLE (golden + eval), tek hamlede değil.
  Prompt cache sırası doğru; `cached_tokens` artık OKUNUYOR (09-23: kanıt `llm.cpt`). `REPLY_CHAR_CAP` 4.000 ≠
  `max_completion_tokens`.
- **İddia desteği GÖLGE ölçümü (`ai/claim-support.ts`, 09-23):** cevaptaki saat/tarih/para/kod/telefon/birimli
  miktar modelin gördüğü veride harfiyen var mı (ctx · op = bizim önceki mesajımız · echo = yalnız misafirin
  yazdığı, OTORİTE DEĞİL · const = acil numara · none). Kanıt `kbEvidenceJson.claims` (PII'siz: sayılar + kapalı-küme
  sınıflar) + `llm` (token/önbellek/model). 🚨 KARAR DEĞİL: hiçbir kapı içe aktarmaz (mekanik pin); engellemek P5 =
  kurucu onayı. Sistem istemi bağlama DAHİL DEĞİL (few-shot sahte "12345678" sızarsa desteksiz görünür). Kapsam:
  yalnız sayısal/kod/iletişim — sözel uydurma görünmez, `u = 0` "dayanaklı" demek değildir. Batarya: 139 dayanaklı
  cevapta 0 yanlış alarm, 45 uydurmanın 43'ü. Kanal oto-yanıtının karar kaydı doğrulanmış KB etiketlerini artık taşır
  (eskiden `used: []`).
- **Dil:** istem kuralları %100 Türkçe; `input.language` org ayarıdır ve istemde artık KULLANILMAZ (↓); `detectGuestLanguage`
  (şablon yolu) Almancayı İngilizce sanıyor (retrieval'ı etkilemiyor, ölçüldü).
- 🚨 **MİSAFİRİN DİLİNDE CEVAP (09-25, `ai/language-signal.ts`; kurucu: "5.1'in zayıf noktasını düzelt"):** 5.1 İngilizce
  misafirlerin 7/59'una Türkçe yazdı (biri otomatik gidiyordu). Dil YALNIZ EMİNKEN (tr/en/de/fr/es/ru/ar): dillere ortak
  sözcük listede yok, puan ≥2 ve ikincinin 2 katı; rakamlı belirteç / URL / özel ad kanıt değil (eval metinlerinde 1.498
  metinde 0 yanlış kesin hüküm, veri pinli; ¿¡ İspanyolca kanıtı). İstem eminken "MİSAFİRİN DİLİ (kodla tespit edildi)" +
  GÖREV satırında hatırlatma + (Türkçe olmayan misafirde) "istemdeki Türkçe kalıp cümleleri ÇEVİR" (5.1 Almanca cevaba
  Türkçe devir kalıbını aynen yapıştırdı); "(Sistem tercih dili: tr)" parantezi KALKTI (5.1'i Türkçeye çekiyordu). Kanal
  kapısının SON kontrolü `reply_language_mismatch`: misafir eminken cevabın TAMAMI ya da TEK CÜMLESİ emince başka dilde →
  taslak (hiçbir güvenlik gerekçesini gölgelemez; erken giriş akışı bu tutuşta da koşar, doğrulanmış onay yine gidebilir).
  Kural tek: son mesaj, değilse cevapsız mesajların tamamı (istem + kapı aynı). Ölçüm: TR dışı dil uyumu 52/59 → 58/59,
  sızıntı 0, olgu aynı. QR kapısında BİLİNÇLİ YOK (devir metni + arayüz yalnız Türkçe; pinli). Koddan kurulan metinler
  (erken giriş onayı/politika, bekletme, dipnot) modelin `detectedLanguage`ini kullanır; İspanyolca onay İngilizce kurulur
  → dil kapısında tutulur (bilinçli). Dil listesine sözcük eklerken diller arası çakışma + veri pini koşulur (setler
  GÖRÜLDÜ; kapsama rakamı kör ölçüm değil).
- Üslup: duygu beyanı/temenni/çelişki/dolgu-soru yasak; "siz"; ben-dili. Injection kara listesi yapısal olarak
  yetersiz; asıl koruma sır elemesi + source==openai (yapısal sınıflandırıcı ayrı tur).

## Canlı durum (Railway env'leri — özet)
| Env | Durum |
|---|---|
| `AUTO_REPLY_ENABLED=1` · `REGISTRATION_OPEN=1` · `TRIAL_EMAILS_ENABLED=1` · `LANDING_DEMO_ENABLED=1` · `GUEST_CHAT_ENABLED` · `DATA_RETENTION_MONTHS=24` | açık |
| `BILLING_ENFORCED=true` | deneme bitince ücretsiz sürüm (kilit yok), oto-mesaj kapanır; `PRIMARY_ORG_ID` muaf |
| Paddle PRODUCTION | canlı; gerçek ödeme + in-app upgrade/downgrade doğrulandı; `PADDLE_PLAN_CHANGE_ENABLED=1`; yıllık fiyat env'leri set |
| `OPENAI_MODEL=gpt-5.1` · `SHADOW_AI_ENABLED=1` (`SHADOW_AI_MODEL=gpt-5.6-luna`, `SHADOW_AI_ORG_IDS`=kurucu org, anahtar `OPENAI_API_KEY`'e düşer) · supply-ai OpenAI luna | Akash artık HİÇBİR yerde işleyen değil; `SUPPLY_AI_MODEL/BASE_URL` eski Akash değerleriyse SİL. KVKK metinlerindeki Akash satırları avukat paketinden önce güncellenmeli |
| Hospitable OAuth canlı; kurucu org aboneliği 402 (veri donmuş, bug değil) | `TRUST_CF_HEADER` EKLEME |
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
- 🚨 **MÜŞTERİYE GİDEN METİN SADE (kurucu 09-23):** teknik açıklama ("bayt", "ş 2 bayt sayılır", kova, TOTP…)
  ve gereksiz uzatma müşteriye GİTMEZ; yalnız ne yapması gerektiği söylenir, büyük platformların deyimiyle.
  Fiil seçimi de ürün dilidir: kullanıcı şifre "seçmez", OLUŞTURUR; hitap sitenin geri kalanı gibi "-in"
  ("…daha kısa bir şifre oluşturun."; "-iniz" değil). Kurucu seçimi 09-23, pinli.
- **Hospitable'a özgü yeni ekran/özellik YAPILMAZ (kurucu 09-23: "amacımız Hospitable'ı kaldırmak"):**
  bağlantı sağlığı gibi yüzeyler sağlayıcıdan bağımsız `ChannelConnection` üzerine kurulur (Airbnb Direct'i de taşır).
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
- 🚨 **OTURUM ÇEREZİ `__Host-guestops_session` (09-23 ikinci tur, kurucu onayı):** üretimde yeni adla yazılır;
  okuma `readSessionCookie` (önce yeni ad, 2026-10-15'e kadar eski ad); middleware + `setSessionCookie` eski çerezi
  siler; çıkış İKİ adı temizler; geliştirmede YALNIZ eski ad okunur/yazılır. 🚨 Oturum çerezini doğrudan
  `SESSION_COOKIE` adıyla OKUMA/YAZMA — `readSessionCookie` / `sessionCookieName`. 🚨 **FIRLATMA KAPISI:** bu
  sürümden itibaren `signSession` her oturuma `hv` iddiası yazar; eski ad YALNIZ `hv`siz (yayından önce eski kodun
  imzaladığı) oturumu taşıyabilir — yoksa yeniden adlandırılıp fırlatılan oturum middleware'de `__Host-`e yükseltilip
  kalıcılaşıyordu. `hv`i kaldırma/koşula bağlama. 2026-10-15 SONRASI eski adın okuma kodu silinebilir.
- **Epoch artıran kimlik işlemi BU CİHAZI yeniden imzalar:** 2FA AÇMA ve şifre DEĞİŞTİRME `sessionEpoch`i artırır
  (başka her oturum düşer) ve işlemi yapan cihazın çerezini yeni epoch ile yeniden imzalar + tanınan-cihaz
  çerezini yeniler (asla ölümcül değil). Şifre SIFIRLAMA oturum açmaz ama tamamlayan tarayıcıyı tanınan cihaz
  yapar (saldırı altında dolu hesap kovasından çıkış yolu). `mfa` iddiası bu işlemlerde YÜKSELTİLMEZ. 🚨 Yeni epoch
  **İŞLEMİN İÇİNDEN** okunur (işlem sonrası okuma araya giren başka bir artışı alıyordu).
- **Parola biçimi (③):** saklama NFC; doğrulama NFC → (girdi NFC değilse) ham; sahte yol aynı sayıda karşılaştırma.
  Yeni parola en fazla 72 BAYT (tek kaynak `password-policy.ts`, bcrypt'siz). Giriş yolu sınır uygulamaz.
  Eski maliyet-10 / ham biçim hash TAM başarılı girişte yükseltilir (`password-upgrade.ts`: CAS, kuyruksuz,
  epoch'a dokunmaz). 🚨 Maliyeti düşük hash'te BAŞARISIZ doğrulama sahte yolun **İŞİNE** tamamlanır: AYNI YUVADA
  maliyet 10 + 11 sahte karşılaştırma = tam bir maliyet-12 (ölçüldü: 318↔319 ms, eşzamanlıda 1,95↔1,90 sn).
  **UYKUYA GERİ DÖNME** — ilk sürüm yuvayı bırakıp ortalamaya kadar uyuyordu; eşzamanlı isteklerde sızdı (inceleme).
- **Hız sınırı kovası `rateLimitClientKey(req)`** (IPv6 → /64, IPv4-eşlemeli → IPv4). `clientIp` yalnız iz/onay
  kayıtları için (tam adres). Ham IP'den kova kurmak mekanik pinle YASAK. 🚨 **Halka açık takvim beslemesi**
  ağ başına geniş taşma kapısı (600/dk) + takvim BAŞINA 60/dk: Airbnb/Booking/Google sunucuları aynı /64'ten çok
  takvim çeker; tek kova 429 → bayat takvim → çift rezervasyon riski demekti. Yeni halka açık "sunucu çeker" ucu
  eklerken aynı soru sorulur. Ek /48 kovası REDDEDİLDİ (mobil operatör havuzları → toplu kilitleme riski).
- 🚨 **OTURUM İÇİ YENİDEN DOĞRULAMA GÜNDE 20 HATA — TEK ORTAK SAYAÇ** (`auth/reauth-guard.ts`,
  `reauth-fail-day:`): 2FA kurulumu (ŞİFRE) + 2FA kapatma/açma/kurtarma kodu (KOD) + hesap silme (ŞİFRE) aynı
  sayaca yazar; tavan dolunca DOĞRU şifre/kod da o gün reddedilir (yoksa tavan yalnız yavaşlatır). Girişin
  sayacından AYRI anahtar. Eskiden kurulum günde 1.440, silme 480 şifre tahmini bırakıyordu. Oturum varken
  şifre/kod soran YENİ bir ekran eklenirse aynı iki çağrıyı yapar (`reauthBlocked` önce, `noteReauthFailure`
  hatada). Sır/kurtarma kodu yanıtları `noStore`.
- **Giriş sonrası `?next=` API yolu olamaz** (`safe-redirect.ts`); çözülemeyen (bozuk yüzde kodlu) hedef de
  olamaz. Host izin listesi yalnız TAM `localhost`/`127.0.0.1` (+port).
- 🚨 **PAROLA ASLA KIRPILMAZ (09-23):** kayıt/giriş parolayı olduğu gibi alır; değiştirme ve sıfırlama da
  öyle (eskiden kırpıyordu → boşluklu parola sıfırlamadan sonra girişte kilitliyordu). Kod/token kırpılır.
- 🚨 **bcrypt EŞZAMANLILIK KAPISI (`auth/password.ts`):** bcryptjs saf JS — ölçüldü: 8 eşzamanlı karşılaştırma
  olay döngüsünü ~800 ms dondurur. Aynı anda en fazla 2 iş (env `PASSWORD_HASH_MAX_IN_FLIGHT`), 32'lik kuyruk,
  8 sn; taşarsa `PasswordHashBusyError` → `serverError` 503 (alarm YOK). Doğrulama/hash/SAHTE doğrulama AYNI
  kapıdan geçer (numaralandırma kâhini doğmaz). bcrypt'i kapı dışında çağırma.
- **Doğrulama e-postası ve DENEME (trial) e-postaları kişiselleştirilmez** (kayıtta yazılan ad = saldırganın
  metni; başkasının adresiyle kayıt olan onu o kişinin kutusuna taşırdı → içerik enjeksiyonu); yeniden gönderme günlük tavanı 6/adres. **Kimlik rotalarında JSON kontrolü IP kovasından ÖNCE**
  (login/register/forgot/resend; 415).
- **Süper-admin e-postası JWT iddiasından okunur** — bugün `User.email`i değiştiren HİÇBİR yol yok (ölçüldü).
  🚨 **E-posta değiştirme özelliği eklenirse** `requireSession`/`requireAuth` e-postayı DB'den okumalı (ön koşul).
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
- 🚨 **SAĞLAYICI HATASI SARMALA KÖR OKUNMAZ (09-23 olayı):** `err instanceof HospitableError` /
  `err.name === "HospitableError"` YASAK (izinli beş dosya: istemci, adaptör sarmalı, `provider-errors`,
  adaptörsüz iki bağlantı rotası — pin `provider-error-wrapper-pin.test.ts`). Okuma TEK yerden:
  `providerErrorStatus` / `isChannelSubscriptionInactive` (`@/lib/provider-errors`). **ÖRDEK TİPLEMESİ YOK**
  (OpenAI SDK hatası da `status: 402` taşır = kota; "Hospitable aboneliği" DEĞİL). Ingest sözlüğünde 402 =
  **`blocked`** (giden yönle AYNI sözcük; eskiden `unknown`). Yeni sarmal/adaptör eklerken: çağıranın özel
  dalları (402 sus · 401 revoke · 429 bekle) sarmaldan SONRA da eşleşiyor mu — davranışsal test şart.
- 🚨 **PERİYODİK İŞİN ALARMI GEÇİŞ TABANLIDIR (09-23, `src/lib/alert-state.ts`, migration YOK):** 2 dk'lık
  döngüde `reportError`ı DOĞRUDAN çağırmak kalıcı arızada günde ~130 e-posta demektir (kısıt bellek-içi, context
  başına 10 dk, yeniden başlatmada sıfırlanır). Yeni periyodik aşama `alertTracker(prefix)` kullanır: `fail(key,
  context, err)` ilk arıza / SINIF değişiminde bir kez + 24 sa hatırlatma; `ok(key)` başarıda temizler (yalnız
  AKTİF anahtara sorgu atar — sağlıklı yol geçiş başına 1 okuma, sayaçla pinli). Anahtar AŞAMA başınadır (bir
  aşamanın başarısı ötekinin alarmını silmesin); e-posta KONUSU değişmez. Hata sınıfı mesaj METNİ taşımaz.
  E-posta gitmediyse ya da KISITA takıldıysa 15 dk sonra yeniden dener; DB düşerse susmaz (eski yol).
  Bilinen sınır: hızlı dalgalanan arıza hâlâ yalnız 10 dk kısıtıyla sınırlı (histerezis ayrı iş).
- **Kimlik e-postası kurtarması HER geçişte** (`recoverEmailOutbox`), silme saatlik (`purgeEmailOutbox`):
  15 sn'lik poller yalnız drain eder; kurtarma saatlik kalırsa deploy ortasında düşen sıfırlama kodu hiç ulaşmaz.
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
- Yeni org 7/24 açık doğar. 🚨 **09-12 GÜNCELLEME — bu satır "şema varsayılanı DEĞİŞMEDİ" diyordu ve
  ARTIK YANLIŞ:** migration 55 `autoReplyEndHour` varsayılanını **9 → 0** yaptı, yani 7/24 artık
  ŞEMANIN kendi varsayılanı. Eski hâlde koruma yalnız UYGULAMA katmanındaydı (`NEW_ORG_AUTO_REPLY_WINDOW`
  kayıt rotalarında) ve org yaratan üçüncü bir yol (seed, davet, fikstür) eklendiği an sessizce gece-only
  bir org doğuruyordu; ayrıca düzeltmeden ÖNCE kurulmuş org'lara (kurucu org dâhil) hiç uygulanmamıştı.
  Sabit hâlâ duruyor ve niyeti belgeliyor. Kurucu muafiyeti `limitsForOrg`.
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

**Kanal sözleşmesi / müsaitlik / demo (09-24)**
- **Sağlayıcı kimliği ≠ OTA etiketi:** `ChannelProviderId` (`hospitable`, `airbnb_direct`) sözleşme kümesi;
  `OutboundProvider` CANLI küme (bugün yalnız `hospitable`) ve kayıt defteri/dispatch YALNIZ onu kabul eder →
  sözleşme aşamasındaki sağlayıcı derleme zamanında kaydedilemez. "airbnb" asla sağlayıcı kimliği olmaz.
- **Yetenek manifestosu** (`channels/manifests.ts`): her kaynak 13 yeteneğin HEPSİNİ ve her veri sınıfını ilan
  eder; Hospitable manifestosu adaptörün çalışma zamanı yetenek kümesiyle PARİTE pinli; `supported` yeteneği
  olan kaynakta veri politikası `requires_terms_review` KALAMAZ; kiracılar arası kullanım her yerde yasak.
  Yeni adaptör önce manifestoya `planned` girer, uyum kitini geçmeden `supported` olmaz.
- **Airbnb Direct adaptörü ağa ÇIKMAZ** (fetch/HTTP/env/DB/URL literal mekanik pinli); tahminî uç nokta/yük
  YAZILMAZ (değişmez 18). Okuma hatası `IngestError("unsupported")` → müşteriye genel metin (Hospitable DEMEZ).
- **Müsaitlik: tek tarih kuralı `calendarDateOf`** (tam 00:00Z/12:00Z = yalnız tarih; aksi an → mülk dilimi).
  Aynı günü karşılaştıran YENİ kod ham `Date` karşılaştırması YAPMAZ, bu kuralı kullanır (`getAdjacency`
  09-24'te bu yüzden düzeltildi). "Boş" yalnız KANITLA (her kapsama kaynağı taze); kanıt yoksa "bilinmiyor".
  Çakışma OLGUDUR — hiçbir kod çakışan satırı iptal/birleştirmez. Müsaitlik isteme/AI'ya bağlanırken yalnız
  `verified` sonuç otomatik cevaba dayanak olabilir (ayrı dilim, ayrı onay).
- **Demo hesabı** (`lib/demo-tenant/`): her kimlik `lxdemo-`; her silme `DEMO_ORG_ID` ile kapsanır (mekanik
  pin); reddetme = SIFIR yazma; sahte bağlantı/rezervasyon kodu/misafir iletişimi/sır YOK; şikâyet asla `new`
  doğmaz. Canlı koşu = kurucu onayı + taze `pg_dump`. Korumalar betik ÇALIŞTIRILARAK değil saf karar
  fonksiyonuyla (`cli.ts`) sınanır.
- **Retrieval yabancı sözlüğü** sorgu tarafındadır ve Türkçe kök sökücüden GEÇMEZ; yeni girdi eklerken
  Türkçe/İngilizce kimlik pini (`kb-retrieval-foreign.test.ts`) ve çarpışma tuzakları koşulur.

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

## Açık işler + bu alanların kalıcı kuralları
> Tur anlatıları, ölçüm tabloları ve "neden" gerekçeleri 09-23'te AYNEN arşive taşındı:
> `docs/history/CLAUDE-2026-09-23-sadelestirme-2-oncesi-tam-metin.md`. Aşağıdaki maddeler oradan
> damıtılmış KURALLARDIR; bir kuralı değiştirmeden önce arşivdeki gerekçesini oku.

**V0 kalanları:** kolon contract'ı okuyucuları (backfill · token teşhisi · connect rotası · credentials kolon
dalı) · webhook girişi (write service hazır) · bağlantı sağlığı sinyali · `toChannel` ham platform ·
`Property.hospitableId` global unique (kapsamlı kimlik) · `api/hospitable/diagnostics`.
`CHANNEL_CONNECTION_READ` DB'ye kaydedilmiş ilk gerçek bağlantı olmadan AÇILMAZ (prod'da DB token'lı org yok,
kurucu org env fallback'te); `hospitable*` kolon DROP'u okuma anahtarı ≥2 hafta canlıdan SONRA
(`docs/V0.7-CANLI-GECIS-OPERATOR-PLANI.md`). Prod'daki 17.436 mesaj / 1.538 rezervasyon `legacy` provenance
sınıfında, çıkarım backfill'i BİLEREK yok.
**GEREKSİNİM (uygulanmadı):** doğrudan kanal + iCal aynı mülkte; aynı kanalın iCal'i pasif/yedek, diğerleri
çalışır, iCal doğrudan veriyi ezmez (`docs/GEREKSINIM-dogrudan-kanal-ve-ical-birlikte-yasama.md`).
**AÇIK QR kalitesi:** boş KB'de devir emergent (eşik = güvenlik kapısı, GOLDEN SET ister); hakaret/kışkırtma
`general` kalıyor (`docs/ACIK-2026-09-08-qr-cevap-kalitesi.md`).

**Şikâyet sınıflandırıcı (`fallback.ts`; 8 inceleme turu, 09-10/11) — kurallar:**
- Olumsuz fiil kalıpları ÇAPALI (tesis adı + fiil; gövde "-yo" ile: gelmiyor/gelmiyo). Çıplak `gelmiyor · gitti ·
  kesildi · su yok · arıza · yanmıyor · bozuldu · blackout · no heat · elektrik yok · cereyan yok · ısınmıyor ·
  elektrik kesintisi · power cut` listeye GİRMEZ (tuzaklar pinli). "İnternet gelmiyor"/"wifi çekmiyor" BİLİNÇLİ wifi.
  Tam biçim, gövde değil (olumsuz/türetilmiş biçim övgüdür: "arızalanmadı", "tıkanıklığı yok").
- KOŞUL BİLDİRİM DEĞİLDİR: yalnız eşleşmenin HEMEN ARDINDAKİ ek okunur (`CONDITIONAL_TAIL` `^[ry]?s[ae]`);
  guard yalnız 09-10 kalıplarına (`NEGATIVE_VERB_COMPLAINTS`) — eski ağa uygulanmaz (gerçek yorum tehdidi düşüyordu).
- Arıza ailesi `hasDeviceBreakdown`: cihaz adı KELİME BAŞINDA + ÇEKİM doğrulaması (türetme eki elenir: kapı+cı,
  makine+li) + koşulsuz fiil + ÖZNE YUVASI (`reportSubjectSlot`, varsayılan RET): iyelik zinciri (tamlayan cihazsa
  kabul, fiil testinden ÖNCE), zarf öbeği kapalı sınıflarla (`TIME_WORDS`/`NUMBER_WORDS`, `ADVERBIAL_SUFFIX` iyelik
  almaz), ulaç ekleri (‑ınca/‑dığında/‑dıktan/‑madan), "ve" bağlacı özne DEĞİL, mastar dalı YOK. 🚨 CÜMLECİK şartı
  ölçülüp GERİ ALINDI (30/44 gerçek bildirimi düşürüyordu) — geri koyma. `VERBLIKE_NOUN_OVERRIDES` = t/d eşsesliliği.
- `BREAKDOWN_DEVICES` bir ENVANTERDİR (145 girdi; yazılmamış cihaz = oto-gönderim izni). `su`/`suy` CİHAZDIR;
  `router` = `modem` paritesi. 🚨 ÖLÇÜLÜP REDDEDİLDİ, GERİ EKLEME: fön · batarya · kablo · hoparlör · kasa · masa ·
  zil · küvet · çekmece · fan · cam · gider · uydu · raf · stor · halı · sigorta · kart · kamera · alarm · adaptör.
- Kesme birleştirmesi YALNIZ soldaki parça zaten cihaz adıysa ("Klima'mız" ✓, "Van'a/Kaş'a/Bor'u" ✗ — yer adları).
  `APOSTROPHES`: U+00B4 ÖLÜ (NFKC boşluk yapar), U+02BC/U+2032 var.
- `hasUnnegatedProblemWord` üçüncü okuma = `deconfuse(normalizeForMatch(…))` (görünmez karakter + homoglif);
  `matchCandidates`i olduğu gibi dolaşmak YANLIŞ (melez "yasamadık" övgüyü complaint yapar). Ham okumalar kalır
  ("Sorun  yok" complaint). `PROBLEM_CONDITIONAL_NEGATIONS` + ALINTI FRENİ (`" diye "`) + İngilizce "ı"lı ikiz;
  "sorun değil" daraltması REDDEDİLDİ (nezaket kapanışları).
- İzafet kalıpları (`POSSESSIVE_FACILITY_COMPLAINTS`) + SORU EKİ guard YALNIZ o alt kümede (harf sınırı şart).
  🚨 İZAFET ÇAPASI (daire-içi/dışı) ÖLÇÜLÜP REDDEDİLDİ — tekrar tasarlama (106 mesaj tablosu arşivde).
- Bilinen sınırlar pinli: sahiplik körlüğü (misafirin kendi cihazı, mimari) · belirtisiz tamlama FP ("şarj aleti") ·
  "Tatil düşümüz bozuldu" · bitişik yazım · DE/FR/ES/RU/AR paritesi borç (`docs/ACIK-2026-09-08-turkce-sikayet-…md`).

**Eval:** harness `evals/*.json` + `tests/eval/`, AYRI config `npm run eval` (`vitest.eval.config.ts`: globalSetup
YOK, anahtar boşaltılmaz; normal suite anahtarı ZORLA boşaltır — ikisi de pinli). İki kapı `RUN_REAL_EVAL=1` + anahtar.
EKSİK KOŞU "GEÇTİ" DİYE OKUNAMAZ (beklenen/tamamlanan/geçersiz ayrı). LLM grader YOK. Bulutta `NODE_USE_ENV_PROXY=1`
şart (Node fetch proxy'yi okumaz). Model kıyası `scripts/eval-compare-models.mjs` (her model AYRI SÜREÇ, markdown
parse edilmez, `EVAL_COMPARE_YES=1` ücretli kapı); gölge katmanı yalnız GÜVENLİK sınıflandırmasını kıyaslar, cevap
kalitesi bu harness'la ölçülür. 09-24 kredi yüklendi (OpenAI bakiyesi org geneli ve PEŞİN; panodaki harcama
"limit"i yalnız UYARI, durdurmaz) → ücretli koşu önce küçük deneme (`EVAL_STAY_LIMIT`, 20 satır ≈ 0,10 $) + kurucu onayı.
🚨 **MÜHÜRLÜ FİNAL SETİ (09-24, `docs/EVAL-MUHURLU-FINAL.md`):** konaklama eval'inin `dev` + `holdout` bölümleri
GÖRÜLDÜ (ayar + denetim ölçümleri) → açma kararı YALNIZ `evals/sealed/` altındaki kör yazılmış setle. İçerik açılmaz/
basılmaz/ajana verilmez; harness yalnız `EVAL_SEALED_FINAL=1` + gerçek model koşusunda okur (kısmi koşu hata);
SHA-256 `SEALS.json` ile pinli, adı yalnız izinli dosyalarda (`sealed-eval-access.test.ts`). Dondurulmuş SHA'da BİR
kez koşulur, sonra "yandı" (yeni kör set). **A seti 09-25'te `f584075`te koşuldu → YANDI** (kaçak 0/117 · bekçi izin
45/45, iddia 22/22 · gereksiz inceleme 7/63, hepsi kelime ağından; `docs/olcum/stay-change-FINAL-eval-2026-09-25.md`);
B'siz koşuldu (kurucu: bayraklar bugün) → B için yeni kör A ya da yalnız-B harness değişikliği. Yanmış kayıt pinli
(`burnedAt`/`runSha`/`report` zorunlu, baytlar değişmez). 🚨 **SET B — GERÇEK MİSAFİR MESAJLARI (09-24, kurucu: "salt okuma"):**
`scripts/eval-real-export.ts` kurucunun makinesinde canlı DB'ye bağlanır: tek işlem, İLK komut `SET TRANSACTION READ
ONLY` + `SHOW transaction_read_only` doğrulaması + yalnız SELECT (mekanik pin `eval-real.test.ts`); anonimleştirir
(`eval-real/anonymize.ts`; tarih/saat kuralı tek kaynak `semantic/date-time-tokens.ts`), aday süzgeci ürünün
dedektöründen BAĞIMSIZ; çıktı YALNIZ git'in yok saydığı `evals/private/` (pin). Kör etiket `scripts/eval-real-label.ts`
(tahmin/katman göstermez). Mühür `SEALS.json` `location: local-only` (dosya depoda OLAMAZ, pin); harness yalnız
`EVAL_SEALED_FINAL=1` + `EVAL_REAL_SET` + SHA eşleşmesiyle okur, rapora metin girmez. Geliştirici ve ajanlar içeriği
GÖRMEZ; metin OpenAI dışında hiçbir servise gitmez. Protokol `docs/EVAL-MUHURLU-FINAL.md`.
**Tüm geçmiş taraması** `scripts/eval-real-stats.ts` (Set B'nin AYNI pinli `readOnly` kapısı; model/kredi YOK; çıktı
YALNIZ SAYI — saf `eval-real/replay-stats.ts`, hazırlık/tarih kuralı ürünle aynı; kelime ağı sayımı ALT SINIRDIR).

**KB onay (A1, migration 53 CANLI):** `source`/`reviewState`; eski satırın onayı VARSAYILMAZ (varsayılan `legacy`,
`approved` yalnız POST'ta açık eylem). Erişim ALLOWLIST `legacy+approved`, TEK kapı `kb-review.ts`; `kb-fetch` AND'ler
(çağıran ezemez; `count` aynı filtre). Şablonlar modelden geçmez → gönderici + önizleme + Gönderilenler ortak
`GUEST_DELIVERABLE_KB_WHERE`. PATCH onay iddiası üretmez; COPY onay soyunu devralır; taslak hafızaya girmez.
**A2 izlenebilirlik (migration 54 CANLI):** `RiskEvent` 7 nullable kolon, 🚨 NULL = ÖLÇÜLMEDİ (0 değil);
`kbNewestUpdatedAt` tazelik işareti (sürüm kimliği değil); `kbEvidenceJson` = kalem kimliği + sürüm, İÇERİK YOK,
misafire ve modele gitmez; `declared` ≠ `verified` (uydurma atıf görünür). `classifyGrounding` ETİKET döndürür, hiçbir
sınıf `decisive` değil; "bilgi ekle" önerisi yalnız `absent`.
**A3/A4/A5:** kod + testler yerinde, YÜZEYLER KALDIRILDI (kurucu 09-11); panelin yanlışlıkla geri mount edilmesi pinli.
**Selam tekrarı:** `conversationState.isFirstOperatorReply` KODDA, konuşmanın TAMAMINA bakar (pencereye değil).

**Geçmiş host cevapları (Bacak B):** yüzey VE veri KAPALI (`KB_HISTORY_SUGGESTIONS_ENABLED` varsayılan kapalı →
mesaj sorgusu hiç koşmaz, `scanned:null`). Eşleştirme fail-closed (tek kategori bloğu, peş peşe cevap birleşir,
`PAIR_MAX_GAP_MS` 12 sa, gerçek çift, konuşma sayar), PII işaretlenir (silinmez; sır kapısı ölçülüp reddedildi).
GERİ AÇMA ön koşulları: yakınlık + araya giren outbound yok · gerçek çift · proaktif mesaj tespiti · tercihen
`Message.replyToMessageId` (migration) · UI `?propertyId=` gönderir ve `capped`i okur.
**Şablon → KB önerisi (`kb-from-templates.ts`, CANLI):** kategori allowlist YALNIZ `wifi`+`rules` (gerekçeler arşivde);
`{{guestName}}`→`{isim}`, başka her `{{…}}` → şablon REDDEDİLİR; `TEMPLATE_VAR_SOURCE` + `ANY_DOUBLE_BRACE` tek kaynak
(`template-apply.ts`); özgüllük sırası (mülke özel önce); "zaten dolu" yalnız AI-okunabilir kalemle; iki bacak ayrı
bileşen (`kb-template-suggestions.tsx` canlı / `kb-past-answers.tsx` kapalı). 🚨 Bir kartı/yüzeyi kaldırırken içindeki
HER bacağın tüketicisini say VE verinin üretildiği yeri kapat (render'ı değil).
**Şablon düzenleme/uygulama:** PATCH `propertyId` alanı var; create şemasındaki `.nullish().transform(v => v || null)`
PATCH'e KOPYALANMAZ (anahtarı null yapıp şablonu "Tüm mülkler"e taşır). Uygulama tek kaynak `template-apply.ts`, tek
geçiş, `Object.hasOwn`, `LEFTOVER_DOUBLE` yalnız düzgün belirteci siler.
**Panel yerleşimi (lg):** dış kap `lg:fixed lg:inset-0`, `fillsViewport` dikey flex, grid `lg:flex-1 lg:min-h-0`, kart
`lg:h-full`; `100vh` aritmetiği ve sabit `11rem` GERİ GELMEZ (pin `mobile-grid-min-width.test.ts`, TAM öznitelik eşitliği).

**Diğer açıklar:** Codex P2 (F09–F18) · `docs/DENETIM-2026-08-09.md` (27) · `docs/ACIK-ISLER-2026-08-08.md` (16) ·
`docs/MIGRATION-BEKLEYEN-ISLER.md`. Operatör: bucket görünürlüğü (imzasız URL 403) · `weekly-audit.yml` `main`'e ·
`security@lixusai.com` · retention onay paketi · `UNVERIFIED_SWEEP` (dry-run önce) · Railway Pro + PITR lansmandan 2-3
gün önce · eski org'ların aktif-saat penceresi (migration 55 varsayılanı 0/0; prod damgası bekliyor). LEGAL (avukat):
SELLER etiketi · yıllık peşinde cayma · alt-işleyen listesi (Akash çıkar) · VERBİS · erasure bayrağı · `LEGAL_VERSION`.
Güvenlik tasarım kararları bekleyen: kurtarma kilitleme (email+IP) · `paused` grace · reconcile'da yerel plan · bekleyen
mesajlarda yüksek-risk taraması · middleware noktalı yol · halka açık sayfada çerez yenileme · `PADDLE_WEBHOOK_SECRET`
boot kapısı · 09-23 §9.4'teki dokuz öneri (`docs/DENETIM-2026-09-23-alarm-seli-ve-guvenlik-turu.md`).

## 🚨 ÇALIŞMA BİÇİMİ (09-19 → 09-24 güncel): RAILWAY AYIN 1'İNE KADAR AKTİF, GELİŞTİRME LOCAL'DE
🚨 **09-24 kurucu: "Railway ayın 1'ine kadar aktif"** → dal push'u = CI yeşilse CANLI deploy (tarihli "duraklatıldı,
canlıya bir şey gitmedi" varsayımı YANLIŞTI). Aşağıdaki 09-19 duraklatma notu ayın 1'inden sonrası için geçerlidir.
Kurucu Railway **ücretli planından çıktı** (servis SİLİNMEDİ, proje bitmeye yakın geri açılacak).
Duraklatma öncesi tam yedek ALINDI ve **GERİ YÜKLENEBİLİRLİĞİ KANITLANDI** (aşağıda).
Kontrol listesi + geri açma adımları: `docs/OPS-2026-09-19-DURAKLATMA-VE-LOCAL-GELISTIRME.md`.
- **Local ortam tek komut:** `scripts/ops-local-dev-setup.ps1` (idempotent). Yerel küme
  `%LOCALAPPDATA%\lixus-dev-pg`, **PORT 5434**, DB `lixus_dev`, `.env.local` TAZE ÜRETİLMİŞ sırlarla
  (prod `ENCRYPTION_KEY` local'e KOPYALANMAZ — local DB'de şifreli prod verisi yok, kopyalamak yalnız
  sırrı yayar). Giriş `demo@guestops.ai / demo1234`. 🚨 **PORT 5434, 5433 DEĞİL:** 5433'ü test
  harness'ı sahipleniyor ve her `vitest run` onu `stop -m immediate` + `initdb` ile SIFIRLIYOR —
  dev DB'si oraya kurulsaydı ilk `npm test` onu silerdi. İki küme ayrı → `npm test` ve `npm run dev`
  aynı anda sorunsuz.
- 🚨 **PROD DUMP'I LOCAL'E YÜKLENMEZ** (bilinçli): içinde gerçek misafir adları/telefonları/17.462
  mesaj var; demo seed geliştirme için yeterli. Gerçek veriyle ölçüm AYRI karar (KVKK).
- **Yedek (09-19 10:42Z):** `lixus-prod-pause-2026-09-19-104239.{dump,sql,-manifest.txt}`; arşiv 1,48 MB
  SHA256 `F91DAF20…DCCB3F7`. **Prova: restore exit=0, 0,7 sn; satır sayıları manifestle BİREBİR**
  (org 9 · mülk 11 · rezervasyon 1542 · konuşma 1329 · mesaj 17462 · takvim 0); ASSERT migration=56,
  bitmemiş=0. ⚠️ **Şifreli-alan kanıtı ALINMADI (vakumlu):** `CalendarSource=0` — kurucu doğruladı,
  iCal beslemeleri BİLEREK kaldırılmış. Pratik sonuç: DB'de şifreli veri kalmamış görünüyor, yani
  **dump tek başına kurtarma için YETİYOR**; anahtar yine kasada, ayrı yerde.
- **Operatör araçlarında ölçülen dört kusur düzeltildi (hepsi araçların kendindeydi):** ① `initdb`
  hatası `*> $null` ile yutuluyordu (teşhis edilemez kurtarma aracı) → log + kuyruk basılır ·
  ② sürüm seçimi yalnız `.exe` varlığına bakıyordu, PG 18 **istemci-kurulumu** seçilip tam kurulu 17
  atlanıyordu → `share\postgres.bki` de aranır (`-NeedsServer`; yedek ALMA scriptleri bu şartı GEÇMEZ,
  onlara sunucu gerekmiyor) · ③ o ayrım iki aracı farklı sürüme ayırdı → yedek script'i uyarır
  (⚠️ "pg_dump 18 → pg_restore 17 düşer" TAHMİNİM YANLIŞ ÇIKTI, ölçüm 0,7 sn'de çalıştığını gösterdi;
  uyarı kesin hüküm değil RİSK NOTU olarak dürüstleştirildi) · ④ boş takvim tablosunda prova
  "şifreli alanlar DOĞRULANDI" diye YEŞİL basıyordu → `CalendarSource=0` iken artık VAKUMLU olduğunu
  açıkça yazar (tuzak dosyanın kendi yorumunda vardı, NİHAİ HÜKME yansımamıştı).
- **Duraklatmada duranlar:** QR misafir sohbeti (dairedeki sticker ölü sayfaya düşer) · oto-yanıt/senkron
  (540 günlük geri pencere toparlar) · e-posta kuyruğu · **Paddle webhook'ları (durum KAYABİLİR → geri
  dönüşte reconcile)** · Hospitable OAuth refresh (süresi dolabilir, KONTROL ET).

## Çalışma dersleri (turlardan damıtıldı — gerekçeler arşivde)
- 🚨 **Yıkıcı bir betik "denemek" için ASLA çalıştırılmaz** — koruma SAF karar fonksiyonuyla sınanır (09-23:
  `env:recover` denemesi commit edilmemiş ~30 dosyayı sildi). Uzun iş arasında yerel commit/yama yedeği.
- 🚨 **Mutasyon YALNIZ `scripts/mutation-run.mjs` ile** (09-24, dış inceleme: eski betikler ANA ağaçtaki dosyayı
  değiştiriyordu → yazılan kodla yarış): commit edilmiş SHA'nın ayrık worktree'si, ana ağaca hiç yazmaz, çapa tam
  1, sha ile geri yükleme. M0 kontrol koşusu ZORUNLU. Worktree DOSYA yarışını çözer, PG 5433 yarışını ÇÖZMEZ → tam
  suit ile aynı anda koşmaz (koşucu başka vitest görünce durur). Hayatta kalan mutant = eksik pin ya da ÖLÜ KOD
  (ya da gerekçesi yazılı EŞDEĞER mutant) — biri düzeltilir.
- **"Yüklem var, argüman yok"** sınıfı: saf fonksiyon doğru ama çağıran ona girdiyi vermiyor → bağlantı
  DAVRANIŞSAL test ister (QR `history_injection`, `suggestReply` alanı, önizleme `reply`).
- **Bir yüzeyi kapatırken RENDER'ı değil VERİNİN ÜRETİLDİĞİ yeri kapat**; bir kartı kaldırırken içindeki her
  bacağın tüketicisini say (Bacak B / şablon bacağı dersi).
- **Git çağıran test iki katmanlı:** `git -c safe.directory=<repo>` KOMUT kapsamında + git yoksa dosya sistemi
  taraması + fail-open yok (CI #1058/#1076). Pin git'in varlığını ŞART koşmaz.
- **Next.js `route.ts` yalnız bilinen rota alanlarını export eder** — sabitler yaprak modülde.
- Prisma temsilcisine `vi.spyOn` sonraki testlere sızar → DB arızası testi AYRI dosyada. Testte sabit tarih +
  `Date.now()` penceresi = zaman bombası (09-15). Yorumlarda `\uXXXX` kaçışı yazılmaz.
- **Tam suit koşarken başka vitest koşma** (PG 5433 sıfırlanır); eval config'i DB kullanmaz, paralel koşabilir.
- 🚨 **PUSH SONRASI CI SONUCU HER SEFER KONTROL EDİLİR** (kurucu 09-24): 739d83c'nin CI'si kırmızı kaldı ve 4 saat fark
  edilmedi → Railway "Wait for CI" yayını atladı, canlı eski sürümde kaldı. Kontrol `actions_list` (dal filtresi) →
  `list_workflow_jobs`. İşler 2–7 sn'de düşüp `runner_id: 0` ve log 404 ise KOD DEĞİL: Actions dakika/harcama limiti
  (repo private) → kurucuya GitHub → Settings → Billing. Yeniden deneme `rerun_failed_jobs`.
- **Dizi biçimli `$transaction([...])` sonucu KONUMLA okunmaz** (09-24): mülk silmeye kural silme adımı eklenince
  `const [, result]` kural sayısını okudu, kuralı olmayan her mülk silinip 404 döndü (yayın öncesi tam kapıda yakalandı).
  Sonucu kullanılan adım etkileşimli işlemde ADIYLA döner.
- **Bulutta Node fetch proxy'yi okumaz:** OpenAI/embedding çağıran tsx/eval koşuları `NODE_USE_ENV_PROXY=1` ister.
- **Ajan token maliyeti (kurucu 09-23):** her alt ajan CLAUDE.md'nin TAMAMINI + tüm araç tanımlarını yükler ve
  sayaç birikimlidir (her araç çağrısında bağlam yeniden okunur). Bu dosya KURAL + GÜNCEL DURUM olarak kalır;
  tur anlatısı `docs/history/`e gider. Ajanlar dar ve az tutulur; basit arama doğrudan yapılır.

## Kalıcı ürün kararları (turlardan damıtıldı)
- **Bağlam penceresi** `selectHistoryForPrompt` (tavan 25 mesaj + 6.000 karakter bütçe; bütçe sayıdan önce) ve
  🚨 GÜVENLİK PENCERESİ bütçeye tabi DEĞİL (son operatif mesajdan sonraki TÜM misafir mesajları). Kapının injection
  aynası AYNI seçiciden beslenir (ayrışan kopya = displacement açığı). Gövde KIRPILMAZ (kapının tarama yüzeyi).
- **Acil ≠ sıradan istek:** `escalationReply({critical})`, tetikleyici DAR `isPhysicalEmergency` (yangın/duman/gaz/
  su baskını/elektrik çarpması; öz-zarar ifadesi YOK) — `safety_emergency` kümesi misafire giden metin için fazla geniş.
- **"Sorunlu" AI'yı KALICI durdurur** (misafirin yeni mesajı açmaz; host elle durum değiştirir/yazar). `Conversation.
  priority` tamamen görsel. **"Beklemede" kaldırıldı** (belgelenmemiş AI kilidiydi; aday sorgusunda `waiting` var).
- **Misafir QR'ı kapalı/bozuksa** markalı `GuestNotice` (tek metin beş koşul, dış bağlantı yok, 200).
- **Otomatik giriş/çıkış/karşılama mesajları** doldurulmamış `[…]`/`{{…}}` taşıyorsa FAIL-CLOSED (gönderilmez,
  damgalanmaz; KB'de "Doldurulmamış alan" rozeti). Oto-yanıt anahtarı kapalıyken bu üç gönderici ÇALIŞIR (dürüst ad).
- **Çıktı vetosu** (`output-veto.ts`, iki kapıda): `placeholder_in_reply` + ETKEN `unverified_commitment`; edilgen
  dallar ölçümde kalır; `human_request` muaf. Bekletme mesajları (`HOLDING_ACK_TEXTS`) makbuzsuz iddia taşımaz.
- **Temellendirme kaydı:** geri çekilme kırpması + pack bütçesi `kbDropped`e SAYILIR (`capacity` ≠ `ungrounded`);
  `supersededById` düşüşü sayılmaz; kalite denetçisi `aiSourcesJson` görür (null ≠ "kaynak yok").
- **Bütçe:** "12 çağrı = 1 birim" Inbox önizlemesidir (Ayarlar kartı değil); oran fiyatlandırma kararı.
  `summarizeHostStyle` 0 birim; QR "önce tüket".
- **Reddedilenler (tekrar önerme):** semantik önbellek · misafir yüzeyinde streaming (kapı cevabın tamamını okur) ·
  Langfuse/LangSmith (yeni alt-işleyen) · tanınmayan `KB_RETRIEVAL_MODE` değerini legacy'ye düşürmek · "eşleşme
  yoksa boş dön" (yabancı misafiri devre iter) · embedding sağlayıcısında zod · "normalize'ı kaldır".
- **Embedding durumu:** E0 (eşik 0.3 + semantic varken RRF) ✅ · E1/E1b sağlayıcı (asla fırlatmaz, kısmi sonuç
  yok, `index`le sıra, L2, içerik anahtarlı LRU, toplam bütçe 9 sn, hata gövdesi alarma girmez; üretimde çağıranı
  tek izinli çağıran, mekanik pin) ✅ · bağlamsal parça metni (yalnız vektöre) ✅ · E2 tablo = migration 56 → onay paketi
  `docs/ONAY-E2-…md` · **E4 ölçüm düzeneği REPODA** (`tests/eval/embedding-e4.eval.test.ts`, `npm run eval` +
  `RUN_REAL_EVAL=1`; 643 metin ~20k token < 0,1 sent; kâhin testi anlamsal kanalın seçiciye ulaştığını pinler).
  Sözcüksel taban: >30 kalemlik KB'de parafraz cevabı isteme %24–64 (legacy %54–91); ≤30 kalemde artık legacy ile
  birebir. **E5 üretim yolu yazıldı (anahtar KAPALI, ↑Retrieval)**; açma E4 sonucu + ayrı onay. `embedTexts` kalıcı
  arızada (kredi/anahtar/model) yeniden DENEMEZ; sağlayıcının TEK izinli üretim çağıranı `semantic-retrieval.ts`
  (mekanik pin, göreli import da sayılır).
- **Saat alanı kuralı TEK KAYNAK `retrieval/time-fields.ts`** (retrieval çelişki koruması + istemin KB↔mülk
  bloğu + host "Uyuşmayan saatler"): erken giriş/geç çıkış ayrı alan, bina/otopark girişi + acil çıkış + çıkış GÜNÜ
  konaklama saati değil (başlık ödüncü de alınmaz), simetrik küme kuralı, mülk ayarı kümenin içindeyse uyumlu.
  İkinci bir saat/çelişki kuralı YAZILMAZ. Host raporu yalnız cümlecik saatini sayar; misafir yolu temkinli.
  🚨 **Çelişki KAPIDA tutulur (09-25, `ai/time-conflict-gate.ts`):** istemin çelişki listesi `suggestReply` sonucunda
  (`timeConflicts`) kapıya gider; çelişkili alana (niyet · misafir/cevap konusu · çelişen saat) değen cevap kanal + QR +
  Ayarlar/demo önizlemesinde `kb_time_conflict` — karar model güvenine BIRAKILMAZ (model 0.80 verdi). Doğrulanmış onay /
  politika metni de aynı listeyi taşır ve tutulur; kayıt gerekçesi o zaman `kb_time_conflict`. Raporlarda kendi satırı.
- 🚨 **TASLAK = EV SAHİBİNİN SESİ (09-25, `ai/host-voice.ts`):** istemin devir kalıbı ("mesajınız kaydedildi; ev sahibiniz
  görebilir" / "is the host's call …") otomatik giden mesajda ve QR'da AYNEN kalır; YALNIZ ev sahibine gösterilen taslakta
  (inbox "AI öner" cevabı + saklanan `aiSuggestedReply`, Ayarlar testinde gönderilmeyecek cevap) onun ağzına çevrilir
  ("kontrol edip size dönüş yapacağım"). Kapı, müsaitlik uyarısı ve erken giriş akışı ORİJİNAL metne bakar (erteleme
  tanıma o kalıba dayanır). Tanınmayan biçim olduğu gibi kalır. Yeni bir taslak yüzeyi aynı fonksiyondan geçer.
- 🚨 **MODEL KIYASI 09-25 — gpt-6-luna'ya GEÇİLMEDİ** (`docs/MODEL-KIYASI-2026-09-25-gpt-6-luna.md`): cevap kıyası
  (135 senaryo) doğru olgu 5.1 %98 ↔ Luna %84 — Luna bilgi tabanındaki ücreti söylemiyor ("ücret ev sahibinin
  kararı"), bu cevaplar OTOMATİK gidiyordu (KURAL-4 "fiyat ASLA yazma"yı harfiyen okuyor); gecikme 2× (p50 4,3 sn);
  konaklama katmanı dev 2 kaçak; token/dk sınırı 200k. Luna'nın artısı: misafir dili %98 (5.1 %88 → dil düzeltmesiyle %98, ↑) ve
  maliyet ~8× düşük. Geçiş yolu belgede (KURAL-4 netleştirme → iki modelde yeniden kıyas → kör set → gölge).
  🚨 `gpt-6-*` reasoning modeli sayılır (`model-family.ts`); bu kod canlıya çıkmadan `OPENAI_MODEL`e gpt-6 YAZILMAZ
  (eski kodla her cevap 400). Kıyas aracı `tests/eval/model-reply-compare.eval.test.ts` (`OPENAI_MODEL=<model>`,
  ücretsiz yeniden puanlama `EVAL_COMPARE_RESCORE`); aynı modelin paralel koşuları token/dk sınırına takılır → tek tek.
- **Model sağlayıcısı kalıcı arızası** (429+`insufficient_quota`, 401/403, 404/`model_not_found`) geçiş tabanlı
  alarma gider (`ai/provider-health.ts`); düz 429/5xx/ağ hatası eski yolda. Misafir her durumda fallback alır.
- **Müsaitlik host metni** "müsait/kiralanabilir/kalabilirsiniz" DEMEZ; en güçlü ifade "bağlı takvimlerinizde
  boş"; kesinlik yoksa TEK dipnot (neden + "misafire söz vermeden önce kanal takviminden kontrol edin").
- **Demo görüntü kararları tek kaynak `isDemoOrg`** (layout bandı, panel rehberi, Mesajlar düğmeleri, rapor
  ipucu, hazırlık listesi, ayarlar metni, operatör sayısı — yapısal pin `demo-ui-gating.test.ts`).
  **Arayüzde PMS adı yok** (hazırlık maddesi, takvim ipucu, "Mesajları çek", "bağlı değil" hataları); yalnız
  bağlantı kurma kartı ve hukuki sayfalar sağlayıcıyı adlandırır (avukat onayı).
- **Kanal sözleşmesi / müsaitlik / demo** kuralları ↑"Kalıcı kararlar" bölümünde.

## Durum
**09-25 ÖLÇÜM + YAYIN:** tam eval (599 istek + 747 cevap, ~3 $) ve mühürlü final (~1 $) GEÇERLİ; birleşimde tehlikeli
kaçak 0 (dev/holdout/final). Canlı `f584075` (C-17 + 7a/4a inceleme düzeltmeleri dahil; migration yok). CI 739d83c'de
Actions dakika sınırıyla düşmüştü → repo PUBLIC yapıldı. Bayrak açma kurucuda (↑AI güvenlik mimarisi).

**09-24 KANIT MODELİ DİLİMLERİ (8 · 6 · 7a/7b · 4a; hepsi migration'sız, kırmızı-önce + mutasyon + düşmanca inceleme):**
para (erteleme tutar/indirim söyleyemez) · bilgi sorusuna koddan politika metni + yeniden değerlendirme kilidi ·
misafirin çıkış saati onay gibi sunulmaz · görev tarihleri rezervasyonu izler. Kör holdout (para): %74 / temiz %97.
Kalan: temizlikçi davet (kimlik akışı → kurucu onayı), anlama `events[]` + "çıktık" kaydı, varsayılan temizlikçi.

**09-24 DOĞRULANMIŞ ERKEN GİRİŞ TURU:** hassas erken giriş isteği artık doğrulama iş akışını tetikler (önceki çıkış ·
çakışma · temizlik "bitti" kaydı · host'un en erken saati · host'un ücret kuralı · kapalı/taslak/otomatik); her şey
doğrulanmışsa KODDAN kurulan onay gider, eksik/çelişki → host'a kontrol listesi + hazır taslak. Mülk sayfasında
"Erken giriş" kuralı, inbox'ta kontrol paneli. Ayrıntı ↑AI güvenlik mimarisi.

**09-24 BELİRSİZLİK TURU (kurucu + dış inceleme):** hassas konaklama isteği + bekçi yok/düştü ya da beyan yok/
tanınmıyor/niyet etiketiyle çelişiyor → otomatik gönderim YOK (bekçi açılana kadar erken giriş/geç çıkış/uzatma
isteklerine otomatik cevap gitmez, taslak host'a; bilgi soruları gider). Anlama katmanının risk niyeti acil e-posta.
Üçüncü tur: BİRLEŞİM değişmezi (hiçbir katmanın "yok"u başkasının sinyalini silemez; iki gölge kip kaldırıldı; eval'a
birleşim yanlış alarm tablosu). Mutasyon koşucusu worktree'de (20 mutant, 18 öldü, 1 ölü kod silindi, 1 eşdeğer). Mühürlü final eval
seti. Deneme bandı: Ayarlar içinde sekme geçişi düzeldi, bant 4 saat kapatılabilir. Tasarım: çoklu istek + bilgi/
izin + tarih yuvaları + temizlikçi "hazır" tiki (`docs/TASARIM-2026-09-24-coklu-istek-ve-temizlik-hazir.md`).

**09-24 ANLAM KATMANI TURU (kurucu: Gemini eleştirisi — "kalıp genişletmek aşırı uyum; şema tabanlı niyet
çıkarıcı + sorgu yeniden yazma + LLM'lerle yap").** Migration'sız. Müsaitlik vetosunun kelime ağı kör bataryada
ölçüldü ve DONDURULDU (yalnız yedek); karar dört katmanlı anlam katmanı (↑AI güvenlik mimarisi). Cevap JSON'una
iki beyan alanı (24 few-shot dahil), bağımsız bekçi + anlama/sorgu yeniden yazma (Structured Outputs, bayraklar
KAPALI, kredi yok → ölçülmedi), eval seti `evals/stay-change.json` (dev + holdout) ve harness. Açma sırası
`docs/ANLAM-KATMANI-2026-09-24.md` §5.

**09-23 BEŞİNCİ TUR (kurucu: "Gemini tablosu — hibrit arama, çapraz-kodlayıcı, %80 skor eşiği, lost in the
middle; en gelişmiş hâli, Guesty gibi"; 4 ajan).** Migration'sız. Ölçülenler: mutlak skor eşiği REDDEDİLDİ (her
kesme cevap kaybettirir; puan göreli, negatif sorgu 1,0–1,35) · asıl açık ADAY ÜRETİMİ (58/275 cevap aday
listesinde yok) → embedding ÜRETİM YOLU yazıldı, anahtar `KB_SEMANTIC_RETRIEVAL` KAPALI (açma = E4 + onay) ·
alt sorgu başına + çoklu sorgu (ham cümle ∨ alt sorgu) · rerank'te anlamsal uyum bonusu (kâhin %87 → ≥%90) ·
yerel çapraz-kodlayıcı ŞİMDİLİK HAYIR (gecikme/olay döngüsü/lisans) · embedding kalıcı arızası geçiş alarmı
(ayrı anahtar) · mimari pinin göreli-import açığı kapandı · kanıtta `fus` 09-11'den beri düşüyordu, düzeldi.
Ayrıntı `docs/olcum/kb-retrieval-parafraz-2026-09-23.md` 3. tur; açma adımları `docs/EVAL-CALISTIRMA.md`.

**09-23 DÖRDÜNCÜ TUR (kurucu: "RAG'i milyar dolarlık şirket seviyesinde bitir"; dış AI eleştirisi; 4 ajan).**
Migration'sız, hepsi kırmızı-önce + mutasyon (20/20): inceleme ajanının 3 bulgusu (otopark/site girişi sahte
çelişki → her soru devrediliyordu · kategori ödüncü kaçan gerçek çelişki · iddia ölçümünde 31,9 sn → 15 ms) ·
KB talimat-ele-geçirme süzgeci + host rozeti · küçük-KB eşiği 24k (21–30 kalemde parafraz %35–61 → %100) ·
cevapsız önceki sorular sorguya (%10–12 → %97–99) · eşiği eğen test sarmalayıcısı kaldırıldı. Eleştirinin
"sayıyla karar" öncülü YANLIŞ (sayı VE karakter). Ayrıntı `docs/olcum/kb-retrieval-parafraz-2026-09-23.md`.

**09-23 ÜÇÜNCÜ TUR (RAG + embedding genel; demo hazır; yol planı).** Hepsi migration'sız, hepsi kırmızı-önce + mutasyon:
- **Cevap iddia desteği gölge ölçümü + token/önbellek gözlemi + kanal kanıt paritesi** (`217e45f`, `b9ae3d8`; ↑AI
  bölümü). Ölçüm kodunda karesel iş vardı (24k "şifre: X1" girdisi 2,8 sn senkron CPU → 80 ms). Mutasyon 34/34.
- **Küçük-KB eşiği legacy tavanı** (`85e1440`): tipik host KB'sinde (13–30 kalem) hibrit, kelime paylaşmayan
  sorularda cevabı düşürüyordu (TR %33–36 ↔ legacy %100) → artık birebir legacy. Büyük KB'de "zayıf kanıtta geri
  çekil" kuralı ölçülüp REDDEDİLDİ (ölçek sorularını da düşürüyordu) — orası embedding işi. Mutasyon 6/6.
- **E4 düzeneği repoda** (`22b31a0`); gerçek yol denendi, hesap kredisiz → koşu GEÇERSİZ (tasarlandığı gibi).
- Belgeler: demo aktivasyon adımları (`docs/DEMO-HESABI.md`), müsaitlik dilim 2 + ONAY BEKLEYEN müsaitlik vetosu
  (`docs/MUSAITLIK-MOTORU-2026-09-24.md`).

**09-23/24 TURU (kurucu: "demo her şeyiyle hazır; RAG + embedding genel; yol planından devam"; beş araştırma
ajanı).** Hepsi migration'sız:
- **OpenAI anahtarının KREDİSİ BİTMİŞ** (ölçüldü: chat + embeddings `insufficient_quota`). Canlıda aynı anahtar
  varsa Railway açılınca AI cevap üretemez → kurucu kredi yükler. Kalıcı sağlayıcı arızası (kota/anahtar/model)
  artık GEÇİŞ TABANLI alarm (`ai/provider-health.ts`; eskiden çağrı başına alarm = 09-23 seli). `9771353` PUSH EDİLDİ.
- **Müsaitlik motoru dilim 2** (`stay-edges.ts`): konuşma sayfasında host'a erken giriş / geç çıkış-uzatma
  gecesi / sonraki kayıtlı rezervasyon / örtüşme; "müsait" DENMEZ, en güçlü ifade "bağlı takvimlerinizde boş";
  AI'ya BAĞLANMADI. Bulgu (ajan, uygulanmadı — onay): "Bir gece daha kalabilir miyiz" otomatik gönderilebiliyor ve
  hiçbir kod kapısı müsaitlik iddiasına bakmıyor; istemin komşu bloğu "daire muhtemelen müsait" diyor;
  "extend our stay" `early_departure`a düşüyor. Öneri sırası: salt-engelleyici müsaitlik vetosu (bayrak kapalı) →
  gölge kayıt → inbox taslağı → oto-yanıt.
- **Saat alanları tek kaynak** (`retrieval/time-fields.ts`): istemdeki KB↔mülk çelişki bloğu mülkle UYUMLU bilgi
  tabanında sahte çelişki üretip ilgisiz soruları devrediyordu (ölçüm 3/3) → düzeldi; Bilgi Tabanı'nda host'a
  "Uyuşmayan saatler" (P4-b'nin ikinci yarısı). Host raporu yalnız cümleciğin kendi saatini sayar, misafir yolu
  temkinli (fark pinli).
- **Demo hesabı hazır** (canlıya KOŞULMADI): örnek veri bandı, kırık dürtüler gizli, tekrar eden arıza kartı ürünün
  kuralıyla, operatör sayısında yok; arayüzde PMS adı kalktı (ürün geneli). Aktivasyon adımları `docs/DEMO-HESABI.md`.
- **CLAUDE.md 219 KB → sadeleştirildi** (tur anlatıları aynen `docs/history/CLAUDE-2026-09-23-sadelestirme-2-oncesi-tam-metin.md`).
- Önceki turlar (09-24 kanal sözleşmesi + müsaitlik ilk dilim + çok dilli sözlük; 09-23 giriş/alarm denetimleri;
  09-18 dış denetim; 09-12 Codex AI raporu; 09-11 ürün turları): hüküm belgeleri `docs/DENETIM-*.md`, anlatılar arşivde.
