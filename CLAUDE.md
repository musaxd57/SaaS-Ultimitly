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
(migration 52 prod'da 09-08 06:11Z; `docs/V1-PROPERTY-MEMORY-DESIGN.md`, envanter §14)** → **V2.1 "Dikkat Gerektirenler" CANLI (09-09, salt-okuma, migration'sız)** → ④ deterministik **Availability Engine** → ⑤ geniş
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

## Retrieval (RAG dilim 1+2+3 — 🚨 **VARSAYILAN AÇIK 09-11**, kurucu talimatı "RAG EKLE"; tasarım `docs/RAG-GRAPHRAG-TASARIM-2026-09-09.md`)
- 🚨 **Bayrak yön değiştirdi:** `KB_RETRIEVAL_MODE` artık AÇMA değil **ACİL DURDURMA** düğmesi —
  `legacy`/`off`/`0`/`false`/`no`/`disabled` eski davranışa döner, **başka her değer (boş dâhil) hibrit**.
  Kill switch bilinçli olarak GEVŞEK yazıldı: olay anında "kapattım sanıp kapatamamak", bilinmeyen bir
  değerin yanlışlıkla legacy'ye düşmesinden pahalıdır. Açma kararının dayanağı ölçüm
  (`docs/olcum/hibrit-yan-etki-2026-09-11.md`): gerileme 19.583 çiftte **%0,11** ve hepsi AYNI tartışmalı
  soru · blok boyutu legacy'nin %9–32'si · geri çekilme dalı `cappedForFallback` ile legacy tavanına indi
  (hibritin ÇOK gönderdiği tek yer kapandı) · ek gecikme soğuk 15 ms / sıcak 1,8 ms. ⚠️ Ölçülmeyen:
  cevap KALİTESİ (model yok) — gerçek eval hâlâ borç. `""` ile legacy bekleyen testler `"legacy"`ye çevrildi.
  🚨 **09-18: YÖN AYNEN KORUNDU, TEŞHİS EKLENDİ.** Dış denetim "tanınmayan değer legacy'ye düşsün"
  dedi; ÖLÇÜLDÜ ve REDDEDİLDİ (20 "açık olsun" değerinin 12–17'si sessizce legacy'ye düşerdi ↑Durum).
  Gerçek boşluk GÖRÜNÜRLÜKTÜ: `kbRetrievalModeInfo()` artık `recognized` bayrağı döndürür, boot
  `[kb-retrieval] mode=…` yazar (tanınmayan değerde `console.warn`), bayrak `.env.example`a girdi —
  etkin modu görmenin tek yolu artık "bir mesaj akınca `RiskEvent`e bak" DEĞİL.
- `src/lib/ai/retrieval/` LLM'siz + deterministik + DB'siz (pin): parçalayıcı (cümle sınırı, 600/900; parça =
  `content.slice`, metin DEĞİŞMEZ) · Türkçe-öncelikli BM25 (kök sökücü + ünsüz yumuşaması geri alma + ~45 DAR kavramlık
  sözlük [`terms` genişletir, `detectOnly` yalnız tespit] + OSA yazım toleransı) · **ikinci aday kaynağı karakter 3-gram
  kosinüsü (`sources.ts`, anlamsal DEĞİL; `ngram:"auto"` = YALNIZ Türkçe algılanan sorguda — 09-10 yeniden ölçüm: yazım
  hatasında katkı yok; ek varyasyonundaki eski gürültü düşüşü kök sökücü kaçağının TELAFİSİYDİ, kök düzelince auto ≈ kapalı
  (katkı ≈0, test-pinli); İngilizcede açık olmak gürültü ekler; varsayılan KORUNDU, "kapalı"ya çekme kararı kurucunun)** · **birleşim CombSUM
  (varsayılan, ölçümle) / RRF (`fusion.ts`)** · rerank (ipucu 0.35 / yalnız-ipucu 0.2 · başlık 0.15 + tam örtüşme 0.15 ·
  bigram 0.10; 🚨 **tazelik PUANA GİRMEZ** — `sortCandidates` puanı 0.01 adımına yuvarlar, eşitse yeni önde; Codex 09-09)
  · **sürüm kuralı `supersededById`** (halefi kümede olan düşer, halefi olmayan korunur) · round-robin çok soru · ince
  soruda son 2 MİSAFİR mesajı · **çelişki koruma ALAN BAZLI** (`extractFieldTimes`: her saat içinde geçtiği CÜMLECİĞİN
  saat-alanı kavramına [giriş/çıkış/sessiz saat/havuz/spor salonu/temizlik], yoksa başlığın alanına, belirsizde hiçbirine
  atfedilir; yalnız aynı alanın saatleri karşılaştırılır, kategori önemsiz — "Genel: havuz 09:00 / kahvaltı 08:00" çelişki
  DEĞİL, farklı kategorideki iki çıkış saati çelişki; partner çapanın hemen arkasına TAŞINIR) · bütçe 6k/12 parça; 🚨
  **bütçe çelişkiyi YUTAMAZ**: tüm tarafları sığmayan çelişki `notes` ile isteme `[NOT] … Kesin saat SÖYLEME — insana
  devret` olarak girer (`knowledgeBaseNotes`, 4 yüzey) + kanıt `confDropped` · **ANLAMSAL (embedding) RETRIEVAL YOK**:
  `SemanticScorer` yalnız sözleşme+no-op, hiçbir yüzey seçiciye `semantic` vermez (pin), kanıt `srcs` üretimde yalnız
  bm25/ngram; raporlarda "anlamsal retrieval" DENMEZ (embedding = ÜCRETLİ SERVİS → onay).
- **Ölçek harness'ı** `tests/unit/kb-retrieval-scale.test.ts` (sentetik 38 konu, 30/100/300 kalem, tr/eşanlam/yazım/**ek
  varyasyonu**/en, çeldirici, gömülü rehber; `docs/olcum/kb-retrieval-scale-2026-09-09.md`): 🚨 ölçü **inPrompt(METİN)** =
  cevap için gerekli CÜMLE blokta mı (kalem kimliği DEĞİL — kimlik blokta olup cümle olmayabilir, test-pinli); **CANLI
  yapılandırması** `kb-fetch` tavanını (en yeni 200) uygular: 30/100'de varsayılanla birebir, 300'de havuz 336→200 ama
  isabet düşmüyor (konu başına ~8 varyant — tavanın zararsızlığının kanıtı DEĞİL; tek kalemli konu tavan dışındaysa
  canlıda ULAŞILAMAZ, hedefli test). Legacy inPrompt 100 kalemde **%51**, hibrit %99–100 (09-10); hit@1 %96–97; geri çekilme
  0; güncelleme/silme 10/10; eşikler ölçülen değere pinli (hit@1 ≥.95 · hit@3 ≥.96 · inPrompt ≥.99 · geri çekilme 0; n-gram
  auto kapalıya göre en fazla 1 soru geride, blok açığa göre küçük). "Cevap kaynakla destekleniyor mu" burada ÖLÇÜLMEZ
  (→ eşleştirilmiş eval). Mutasyon: dilim 2 17/17 · dilim 3 20/20 · kaçak turu 09-10 (↓) (kontrol yeşil, iki yönlü).
- **Kaçak turu (09-10; teşhis ajan puan dökümüyle, kod Claude):** kök sökücü SABİT NOKTA (tur tavanı 3 simetriyi bozuyordu:
  "çıkışımızı"→ciki ≠ "çıkış"→cik → `no_lexical_hits` geri çekilmesi; "aşırı kök alma kaçırma üretmez" yalnız SİMETRİK
  sökümde doğru) · ünlü-sonu iyelik `-mız/-miz/-muz/-nız/-niz/-nuz` (taban 3: deniz/omuz/domuz sökülmez) · kaynaştırma "y"
  tabanı 3 ("çayı"→cay, "suyu"→su, "koyabilirim"→koy) + tek düzensiz kök `suy→su` · `WEAK_QUERY_TERMS` += `ko/ca` (kök
  artefaktı: çalarsa; "ko" kök düzeltmesiyle kaynaksız kaldı, listeye alınmadı) ve zayıf kök BM25 ağırlığı 0.25 (iki uç
  unit-pinli; taşınan zayıf kök de `min(carry, weak)` — inceleme 09-10) · ünsüz-sonu `-sı/-su/-dı/-du/-tı/-tu` kök 2 harfe
  inecekse sökülmez ("kodu"→kod, "duşu"→duş, "uydu"→uyd — tv "uydu" ↔ "uymuyor" çarpışması KÖKTE çözüldü, terim kaldı) ·
  sözlük: power↔socket AYRILDI, restaurant'tan "yemek" (ye; `detectOnly` "akşam yemeği"). 🚨 `detectOnly`'ye taşımak
  genişletmeyi KAPATMAZ
  (kalıpla tespit edilen kavram TÜM `terms`ini genişletir); "nerede yemek" kalıbı KOYMA ("nerede" durak → kalıp ["ye"]).
  Ölçüm (varsayılan, 30/100/300): hit@1 93/92/92 → **97/96/96** · inPrompt(metin) 99/98/97 → **100/99/100** · gürültü
  1.5/2.9/4.7 → 0.9/2.2/2.6 · geri çekilme 3/1/1 → **0** · morph 29/30·35/38·35/38 → tam · CANLI(300) inPrompt 98→100, blok
  1076→939. Rapor `docs/olcum/kb-retrieval-scale-2026-09-10.md`; kaçak pinleri `tests/unit/kb-retrieval-morphology.test.ts`
  (kırmızı-önce 18/19 düşüyordu); mutasyon 15/15 (dört turda: ölü sabit birleştirildi, "ko" çıkarıldı, ağırlık iki uç pini,
  n-gram kaynağı BM25 pinini bulandırıyordu → `ngram:false` ile ölçüldü, "uydu" eşdeğer mutant çıktı → terim geri kondu).
- **Kaçak turu İNCELEMESİ (09-10, ölçümlü ajan) — düzeltildi:** 🚨 **P1 sabit noktanın kendi kaçağı:** kısa ekler ARDIŞIK
  sökülüp gövdeyi yiyordu — "havalimanından/‑nda/‑nı" ve "havaalanından" `hav` = **HAVLU** kovasına düşüyordu (eski tur tavanı
  bunu KAZARA engelliyordu); transfer sorusunda seçilen ilk parça havlu kalemiydi. Düzeltme TEK DİLBİLGİSEL FREN:
  **TAMLAYAN eki (‑nin/‑nun) YALNIZ İLK TURDA** — tamlayan yüzey kelimesinde sondadır, yani sağdan soyarken ilk sökülen
  olmalıdır; bir HÂL eki söküldükten sonra görünen "…nin" gerçek tamlayan değil KAYNAŞTIRMA n'sidir ("havalimanı+n+dan").
  Sonuç TAM SİMETRİ (havalimanından/‑nda/‑nı ≡ havalimanı, havaalanından ≡ havaalanı) ve beş havalimanı sorgusunun beşi de
  doğru kalemi seçiyor. 🚨 **Ölçülüp REDDEDİLEN dört aday** (tekrar denenmesin): `ndan/nda/ni` eklemek 11 kelimeyi bozar
  (balkonu→balko) · `alim/elim` için taban 4 on yaygın fiili bozar (gidelim→gidel) · optatif ekleri ilk-tura kısıtlamak ve
  aynı ekin üst üste sökülmesini engellemek ULAŞILAMAZ (tamlayan freni zinciri daha erken keser; iki mutant da HAYATTA
  KALDI → pinlenemeyen kod tutulmadı). 🚨 **Harness KÖRDÜ:** airport morph sorusu `-nıza` biçimindeydi → `-ndan` yapıldı
  (fikstür-niyet pini var; ⚠️ ASCII `\b` Türkçe "ı"yı sınır sayar, ilk pin kendi mutantından geçiyordu). **P2:** `WEAK_QUERY_TERMS` KÖK uzayında yaşar ve kök sökücü değişince
  BAYATLAR — 09-10 turu "aldı/oldu/etti"yi zayıftan güçlüye geçirmişti; ayrıca ALTI ÖLÜ girdi ölçüldü ("lazim"→laz,
  "isti"→ist, "sorun"→sor, "yardim"→yard, "leave"→leav, "use"=durak) → düzeltildi + **mekanik pin** (her girdi kendi kökü
  olmalı, durak olamaz). Taşınan (`carried`) zayıf kök 0.5 iken own 0.25 idi = ilişki tersine dönmüştü → `min`. Ölçek eşikleri
  YÜZDE değil **kaçırılan SORU sayısı** (inPrompt n=100'de pay 0 soruydu); "eski %20 iddiası" pini iki boyutta ÖLÜ ASSERT'ti →
  tek çift yönlü farka indirildi. "uydu eşdeğer mutant" sonucu FİKSTÜR ARTEFAKTIYDI ("kanalları" zaten tv terimi) → ayırt edici
  cümle ("Uydu yayını var mı?"). **Kalan hit@1 kaçakları (cevap cümlesi BLOKTA, sıra 2–11):** rehber parçası BM25 uzunluk
  normunda kısa kaleme yeniliyor (guide_lost/water_cut; b=0.4 denendi, net ±0) · `fire→fir = fırın` diller arası kök
  çarpışması · TV/kumanda sözcüksel beraberlik (klima kalemi "kumanda + TV sehpası") · taksi↔araç · doorman_syn etiketi
  tartışmalı (kargo kalemi soruyu zaten cevaplıyor) → embedding "kalan başarısızlar" listesi (ücretli, ayrı onay).
  Bilinen kök sınırları (pre-existing, ölçüldü, DOKUNULMADI): "markete"→mark ≠ market (fuzzy tavanı 5 harf), "kilidi"→ki
  (d→t geri alma bilinçli yok), "duşu"→du ("su" eki), "görevliniz"→gorevl ≠ gorev.
- **Host graf katmanı** `src/modules/intelligence/graph/property-graph.ts` (saf, DB'siz, hiçbir yüzeye bağlı değil):
  DB-gerçek ilişkilerden tipli graf; **her kenar `source` + `observedAt` + `certainty`**; `recurringIssues` kanıt sınıfı
  `reported_only | task_open | task_done` — **'confirmed' YOK** (şikâyet ≠ doğrulanmış arıza, pin); sinyal konuşma
  üzerinden konaklamaya çözülür (düz taramanın sayamadığı). 🚨 **Görev kanıtı YALNIZ bildirime BAĞLI görevlerden** (Codex
  09-09): mesaj bağı `Task.sourceMessageId = Signal.sourceEntityId` → `observed`; aynı konaklama + aynı kategori →
  `inferred`; başka konaklamanın tamamlanmış işi / pencere dışı bildirimin görevi `unlinkedTasks` (kanıt DEĞİL); açık ve
  tamamlanan AYRI (`linkedOpenTasks/linkedDoneTasks/reportsWithoutTask/linkCertainty`). **Misafir yoluna taşınmaz**
  (retrieval + QR + guest-chat import etmez, pin). Sentetik mülk–mesaj–görev verisi `tests/helpers/graph-synthetic.ts`
  (altın üreticiden; çeldirici görevler; H1–H4; `docs/olcum/graph-baseline-2026-09-09.md`: H1–H3 birebir, H4 cihaz/varlık
  basit grafla CEVAPLANAMAZ = LightRAG/HippoRAG'ın tek aday katkısı). LightRAG/HippoRAG = LLM+gömme → ücretli → onay;
  deney aynı sentetik `messages[]` ile, gerçek misafir metni GEREKMEZ; protokol tasarım §6.2–6.3.
- **TEK BOĞAZ `selectKbForPrompt`** — yetki/mülk/onay (`kb-fetch`) ve yüzeyin sır elemesi ÇALIŞTIKTAN SONRA,
  `suggestReply`'dan ÖNCE; dört AI yüzeyi geçer (pin). Bayrak kapalı = **KİMLİK** (aynı dizi referansı, 0 düşen,
  kanıt null). Açıkken `kb-fetch` `take` 30→200 (onay kapısı aynı), istem notu "SORUYA GÖRE SEÇİLDİ … 'bilgi yok'
  DEME — insana devret" (kural aynı, wording dürüst). 🚨 **Hibrit legacy'den AZ bilgi taşımaz:** küçük KB (≤12 kalem
  ve ≤6k) · selamlaşma · sözcüksel isabet yok · hata → TAM küme gider (E1 dürüst "bilgi yok" korunur).
- Önbellek anahtarı **küme parmak izi** (id+updatedAt+içerik özeti), `max(updatedAt)` DEĞİL: silinen/pasif kalem
  indekste yaşayamaz; yer tutucu ikamesiyle içeriğe giren misafir ADI başka sohbete dönmez. Kanıt
  `kbEvidenceJson.retrieved[].c` (parça) + `.retrieval {q, fb, sel, cand, ms}` — PII yok; misafire dönmez.
- **Retrieval politika DEĞİLDİR:** kötü niyetli kalem ilgisiz soruda gitmez (ölçülen maruziyet farkı) ama sözcüksel
  eşleşince gider; eleme kararı AYRI ONAY. P5 (kanıtsız iddia kod kapısı) AÇIK — RAG kapatmaz. Baseline (model YOK):
  `docs/olcum/kb-retrieval-baseline-2026-09-09.md` (13 senaryo; legacy `long_middle_oldest` ❌ → hibrit ✅; blok ~%85 küçük).
- **Eşleştirilmiş legacy/hibrit GERÇEK-MODEL eval'i HAZIR (dilim 3), koşuyu KURUCU yapar:** `evals/kb-retrieval-paired.json`
  (v1, R1–R8: uzun rehber ortası · yazım hatası · EN soru · çok soru · çelişkili çıkış saati · bilgi yok · TR eşanlam ·
  konuşma bağlamı) + `tests/eval/kb-retrieval-paired.eval.test.ts` (aynı `npm run eval`, aynı iki kapı; rapor
  `docs/olcum/eval-retrieval-<tarih>.md`). Aynı KB iki modda `kb-fetch` AYNASINDAN geçer (legacy en yeni 30 / hibrit en
  yeni 200 + seçici); "gold istemde mi" KODDAN ölçülür ve ÇEVRİMDIŞI PİNLİ (eski kalemli R1/R2/R3/R7/R8: legacy ✗ / hibrit
  ✓; R4/R5 ✓/✓; R6 iki blok birebir). Kontrol dallanması: gold istemdeyse cevap ona DAYANMALI; istemde değilse "doğru
  görünen" cevap DESTEKSİZ (şans/uydurma) + yokluk söylenmeli. 🚨 Sentetik retrieval ölçümü (kaynak bloğa girdi mi) ile
  gerçek cevap kalitesi (cevap doğru mu) AYRI raporlanır, biri ötekinin yerine geçmez.
- **Güvenlik filtreleri yeni yolda AYNEN — davranışsal doğrulama** `tests/integration/kb-retrieval-secret-scope.test.ts`
  (bayrak AÇIK): QR'da wifi/checkin kategorisi + kod içeren kalem + taslak ne isteme ne kanıta girer; oto-yanıtta onaysız
  konaklama aynı, onaylı konaklamada giriş notu ürünün kendisi (legacy paritesi), taslak asla. Önbellek/rerank/graf
  kapsamı: küme parmak izi (iki mülk aynı soru → yalnız kendi kalemi), rerank saf, graf yabancı kimlik bağlamaz (testler).
- Sözlük/kök çarpışmaları ölçülüp düzeltildi: "varış→var" (sözlükten çıktı — İKİ KEZ, geri gelmesin), "şu→su" (durak
  değil), "ki" eki YOK, torba kavramlar bölündü ("olanaklar" → asansör/havuz/balkon/bebek/ütü/fön), genel sözcük
  ("kural") genişletmeye girmez. 🚨 `base > 0` "yalnız-ipucu" ayrımı için YETMEZ (n-gram hemen her parçaya 0.0x verir)
  → `hasEvidence` yüklemi (güçlü kök / n-gram ≥0.3 / anlamsal). Mutasyon kontrol koşusu (M0) her turda ZORUNLU: bir
  fixture hatası 6 mutasyonu sahte "yakalandı" göstermişti (09-09).

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
  (`surface:"guest_chat"`) yazar: kapalı-küme gerekçe (`low_confidence`, `model_risk_level`,
  `model_unavailable`, `keyword_escalated`, …) + `gate_passed`; PII yok, await edilir (yarışsız), yazamazsa
  misafirin yanıtını BOZMAZ. 🚨 **GEÇMİŞ DE TARANIR (`history_injection`, 09-12):** kapı 09-12'ye kadar
  yalnız GÜNCEL mesaja ve ada bakıyordu — kanal yolunda `dfd1683` ile kapattığım DISPLACEMENT açığının
  aynısı QR'da açıktı (misafir 1. turda injection yazar, devredilir ama mesaj KAYDEDİLİR; 2. turda zararsız
  soru yazar, pencere yükü modele taşır, kapı görmez; QR devri yapışkan olmadığı için 2. tur temiz sayılır).
  Kapı artık modele giden AYNI diziyi tarar (ikinci pencere HESAPLANMAZ — ayrışabilecek her kopya bu açığın
  kendisidir). Kapsam DAR: geçmişte yalnız injection; şikâyet/risk ağlarını eski mesajlara koşturmak normal
  sohbeti KALICI bloklardı. 🚨 **YENİ GEREKÇE = `risk-events.ts` REASONS'A DA EKLENİR** — `clampTo`
  tanımadığı değeri SESSİZCE `null` yapar (fail-safe doğru, ama teşhis körleşir); ölçüldü ve mekanik pin
  yazıldı (`tests/unit/risk-event-reason-parity.test.ts`). Bağlantı ayrıca DAVRANIŞSAL pinli
  (`tests/integration/qr-history-injection-wiring.test.ts`): mutasyon turu "rota geçmişi kapıya VERMEZ"
  mutantının yalnız unit pinlerle HAYATTA KALDIĞINI ölçtü — ve bu zaten kusurun kendi sınıfıydı (yüklem
  vardı, ARGÜMAN yoktu).
- 🚨 **QR MİSAFİR ROTASI: MESAJ PENCERESİ + POLL KAPILARI (09-18).** `GET /api/chat/[token]` mesajları
  `take` OLMADAN çekiyordu ve istemci 5 sn'de bir çağırıyor → `GUEST_CHAT_MESSAGE_WINDOW` 200 + TAM SIRA
  (`createdAt` + `id`; `desc` çekip kronolojiye çevirir). **Cursor ölçülerek reddedildi** (eşit damgada
  satır atlar; istemci zaten listeyi toptan değiştiriyor). İstemcide üç kapı: görünürlük
  (`visibilitychange`; arka plan sekmesi poll ETMEZ, sekmeye dönünce turu BEKLEMEZ) · terminal durumda
  `clearInterval` (`closed`/`boundElsewhere`) · ardışık 3 başarısızlıkta "yeni mesajlar alınamıyor"
  satırı (429 sessizce yutuluyordu). Maliyet ölçüsü: poll başına ~6 DB turu, **biri YAZMA**.
- **QR devir metni GERÇEĞE UYGUN** (`guest-chat.ts` `escalationReply()`): yalnız garanti edilen söylenir
  ("kaydedildi; ev sahibiniz sohbet ekranından görüntüleyebilir"). "İlettim" İDDİA EDİLMEZ — e-posta bayrak açıkken
  bile dedupe/5 dk cooldown/alıcı-yok/sağlayıcı hatasıyla bastırılabilir ve metin e-postadan ÖNCE yazıldığı için
  sonuç okunamaz. QR devri yapışkan DEĞİL (her mesaj yeniden değerlendirilir). ⚠️ Bu satırdaki eski
  "model `history: []`" ifadesi 09-08'de BAYATLADI (↑ pencere bacağı) ve 09-12'de silindi — devrin yapışkan
  olmaması, geçmişin modele GİTMEDİĞİ anlamına gelmez; tam tersine `history_injection` dalının gerekçesi budur.
- 🚨 **"BİLGİM YOK" MİSAFİRE ASLA GİTMEZ (KURUCU KURALI, 09-11) — `src/lib/ai/absence.ts`.**
  Kurucu: *"müşteriye hiçbir zaman bilgim yok mesajı gitmemeli; bilgi yoksa da cevap gitmemeli —
  host neden 'bilgim yok' mesajı göndersin ki?"* ÖLÇÜLEN DAVRANIŞ (2. gerçek koşu 09-09): güven
  **.8**, kaynak **0/0**, cevap "kayıtlı bilgim yok; mesajınız kaydedildi…" → kapı ≥0.75 olduğu
  için GEÇİYOR ve misafire gidiyordu. O cevabın işe yarar TEK parçası zaten devir metninin
  kendisi; devredince misafir onu ZATEN alır. `admitsMissingKnowledge` İKİ yüzeyde de kapı:
  `passesAutoReplySafetyGate` (kanal → hiç mesaj gitmez, host'un kutusuna düşer) ve QR
  `evaluateEscalation` (→ `absence_admission`, misafir deterministik devir metnini alır).
  🚨 **İSTEM KURALI KALDIRILMADI — bilinçli:** `prompts.ts` KURAL-3/KURAL-5 modele
  temellendiremediğinde yokluk söylemesini emreder ve o kural **UYDURMAYI ENGELLER**; silinseydi
  model uydururdu (işe yaramaz bir cevaptan çok daha kötü). Kural istemde kalır, GÖNDERİM kapıda
  kapanır — fail-safe doğru yönde: kapı delinirse misafir bozuk bir belirteç değil dürüst bir
  cümle görür. 🚨 **ÖLÇÜT CEVABIN KENDİ İTİRAFIDIR, "kaynak yok" DEĞİL:** `usedSources` yalnız KB
  kalemlerini sayar; "Giriş saati kaçta?" cevabı MÜLK ALANINDAN gelir, kaynaksız görünür ama
  DAYANAKLIDIR — "kaynak yoksa devret" deseydik ürünün EN SIK sorusu kırılırdı (test-pinli).
  ⚠️ **SAVUŞTURMA yokluk itirafı DEĞİLDİR** ("ev sahibinizle iletişime geçebilirsiniz") — kapı
  yalnız AÇIK beyanı yakalar; savuşturma ayrı bir sorundur (gerçek koşuda `gpt-5.6-luna` legacy
  modda tam bunu yapıyordu). **TEK KAYNAK:** eval harness'ı (`tests/helpers/absence-detector.ts`)
  yalnız yeniden-dışa-aktarımdır — eval, ürünün göndermeyeceği bir cevabı "geçti" sayamaz (pin).
  🚨 **E1 EVAL SÖZLEŞMESİ TERS ÇEVRİLDİ:** 09-09'da `acknowledgesAbsence` yokluk beyanını
  ÖDÜLLENDİRİYORDU; artık `notDeliverable` o metnin GÖNDERİLMEMESİNİ ölçüyor (`changed` alanında
  yazılı, sessiz gevşetme yok). ⚠️ Harness YALNIZ `suggestReply` = TASLAK çağırır; "gönderilmedi"
  DEĞİL "kapı bloklar mı" ölçülür (VEKİL) — hata metni buna göre dürüstleştirildi (eski metin
  "UYDURMA demektir" diye kesin hüküm veriyordu; ikinci olasılık dedektörün tanımadığı dürüst bir
  yokluk ifadesidir). Kardeş eval (`kb-retrieval-paired`) hâlâ legacy modda yokluk beyanı BEKLER ve
  bu DOĞRUDUR (retrieval ölçer, teslimat değil) — ama "legacy yeşil" ≠ "legacy yeterli": canlıda o
  cevap kapıda durur, bu hibrit bayrağının LEHİNE kanıttır (yorum satırı eklendi).
  🚨 **YÜKLEM AYNI GÜN YENİDEN YAZILDI** (inceleme ajanı, iddialar bağımsız doğrulandı: 9/9 FP ve
  15/15 kaçak birebir üretildi). Düz kalıp listesi İKİ YÖNDE de kırıktı: **işe yarar cevabı bloklama
  18/67 (%27) → 0**, **gerçekçi yokluk ifadesini kaçırma 29/38 → 0**. Dört ölçülmüş kusur: `\bno`
  SAĞ SINIRSIZDI ("**No**thing extra is needed; the information…" · "**No**te: all the check-in
  information…" · "no extra charge; the information pack…") · çıplak `not listed` ("The pool is not
  listed as **closed**") · `kayıtlı…bilgi` OLUMLU Türkçe kalıptır ("Kayıtlı rezervasyon bilgileriniz
  DOĞRU") · 🚨 `toLocaleLowerCase("tr")` İNGİLİZCEYİ BOZUYORDU (tr yerelinde `I`→`ı`: "I have no
  **I**nformation" → "ı have no ınformation" KAÇIYORDU). Yeni yapı kalıp listesi DEĞİL **NESNE +
  OLUMSUZLAMA dilbilgisi**: bilgi nesnesi (bilgi/kayıt/veri/not/detay/belge · information/record/
  detail/data/note) + yokluk yüklemi, SINIRLI mesafeyle. 🚨 `yok` nesneye **BİTİŞİK** (≤1 kelime) —
  yoksa "sorun yok"/"görevli yok" nezaket kapanışları yokluk sayılıyordu ("Bu bilgi rehberde yazıyor
  ama görevli yok." mesafe pini). 🚨 **Cümle sınırı boşluğu KESER** ama `15.00` BÖLÜNMEZ (eski
  `[^.!?]` sınıfı tam tersini yapıyor, Türkçe saat yazımı yüzünden gerçek yokluk cümlesini
  kaçırıyordu). **İKİ KATLAMA** (`foldTurkishLower` + `foldTurkishLowerTr`); ikisi de yük taşır ve
  AYRI pinlidir: `BILGIM YOK` yalnız standart, `KAYITLI DEĞİL`/`BULAMADIM` yalnız tr okumasında.
  ⚠️ **Belirsizlik ve savuşturma BİLİNÇLİ DIŞARIDA**: "emin değilim" netleştirme sorusuyla aynı
  kalıbı paylaşır ("Sorunuzu tam anladığımdan emin değilim, hangi tarihten…") → bloklamak ürünün
  MEŞRU davranışını keserdi; `confirm` de KAYIT nesnesine çapalı ("I'm unable to confirm whether
  parking is available" SAVUŞTURMADIR, ölçülmüş luna çıktısı).
  🚨 **ÖNİZLEME PARİTESİ (ikinci ölçülmüş kusur):** `api/ai/test` ve `api/demo/ai` kapıyı çağırıyor
  ama `reply` VERMİYORDU (alan opsiyonel → ne derleme ne test uyarıyordu) → Ayarlar kartı ve landing
  rozeti, gerçek göndericinin BLOKLADIĞI cevap için "kendiliğinden gönderilirdi" diyordu; iki rotanın
  da kendi yorumundaki "the exact production gate" iddiasının ihlali. Bağlandı, davranışsal pinli.
  Kanıt: kırmızı-önce 2+4 blok + **mutasyon 22/22**. ⚠️ İlk koşuda KONTROL KIRMIZIYDI (bir eval pini
  eski hata metnini arıyordu) → sonuçlar geçersiz sayıldı, düzeltilip tekrarlandı (M0 kuralı);
  sonrakinde iki mutant hayatta kaldı ve ikisi de gerçek pin eksiğini gösterdi.
- 🚨 **`hasUnsourcedSpecificClaim` BUGÜN ÜRETİMDE HİÇ KOŞMUYOR (ölçüldü 09-12).** Yüklem
  `guest-chat-gate.ts`te ve o `if` bloğu ayrıca `informationalBandEnabled()` istiyor;
  `QR_INFORMATIONAL_BAND_ENABLED` **yalnız testlerde** set ediliyor (5 test dosyası, 0 üretim/ops yolu).
  Yani "0.75 ÜSTÜ kaynaksız somut iddia atlanıyor" DOĞRU, ama **0.75 ALTI da atlanıyor** — bant kapalı
  olduğu için tamamı `low_confidence` ile devrediliyor. Kanal kapısında yüklem HİÇ YOK. Sonuç: iki kapının
  cevap METNİNE bakan TEK dalı `admitsMissingKnowledge`. (Çıktı vetosu tasarımı + ölçülmüş yanlış pozitif
  bataryası: `docs/DENETIM-2026-09-12-codex-ai-raporu.md` §A.)
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
- **Yer tutucu ≠ gerçek (E4, 4. koşu 09-09):** kb-manager hazır şablonu `[ŞİFRE]`/`[AĞ ADI]` alanlarını taşır ve host
  doldurmadan kaydedebilir. `packKnowledgeBase` bloğa giren kalemde `[…]`/`<…>`/`___` (içinde harf) görürse KODDAN
  `[NOT] DOLDURULMAMIŞ YER TUTUCU` yazar ("gerçek değer DEĞİLDİR; misafire yazma; KURAL-3"); `{isim}` BİLEREK dışarıda
  (ad ikamesi çağıranda — ↓ artık DÖRT yüzeyde de var).
- **Yer tutucu İKAMESİ tek kaynak `src/lib/kb-placeholders.ts` (09-10, saf/DB'siz):** `{isim}·{ad}·{name}` ve
  `{daire}·{apartment}·{apt}`. 🚨 **09-12: BEŞİNCİ ayrışan yüzey `api/ai/test` bulundu ve ortak modüle
  bağlandı** (kendi `match(/\d+/g)?.pop()` kuralıyla 7 ilan adının 7'sinde farklı sonuç veriyordu).
  Aynı ikame ÜÇ yerde kopyalanmıştı (oto-yanıt göndericisi · inbox `ai-suggest` ·
  Gönderilenler önizlemesi) ve DÖRDÜNCÜ yüzeyde — halka açık QR asistanında — HİÇ YOKTU: host'un karşılama şablonu
  KB'deyse misafire ham `{isim}` gidiyordu (ölçüldü). 🚨 **QR'da GERÇEK AD KULLANILMAZ** → `GUEST_NAME_FALLBACK`
  ("misafirimiz"): QR bağlantısı dairede asılıdır, sohbeti açan kişi rezervasyon sahibi olmayabilir (eş, arkadaş,
  temizlikçi) — yanlış hitap + PII sızıntısı; inbox/oto-yanıtta muhatap KANITLI, orada gerçek ad (ayrım bilinçli,
  test-pinli). 🚨 **SIR KAPISI İKİ KEZ:** QR'da `withoutSecretKbItems` HEM ham HEM ikame sonrası çalışır — ilk yazımda
  yalnız ham içerik taranıyordu ve ÖLÇÜLDÜ: mülk adı "Daire 4590" iken "Kapı: {daire}" kalemi modele **"Kapı: 4590"**
  gidiyordu (giriş adı + 4-8 hane = `SECRET_PATTERNS`in yakalamak için yazıldığı biçim), oto-yanıt yolu ise aynı kalemi
  eliyordu → iki yüzey arasında parite yoktu. Sızıntı üretmiyordu (enjekte edilen değerler nötr hitap + zaten misafire
  dönen daire numarası) ama "modele giden metin taranmıştır" değişmezi kırıktı. Eleme HEDEFLİ (aynı numarayı taşıyan
  karşılama kalemi KALIR), yön fail-closed. 🚨 **DEĞİŞMEZİN GERÇEK KAPSAMI DAR (09-11, ölçüldü ve pinlendi):** sır
  kapısı **KB KALEMLERİNİ** süzer; mülk KİMLİK ALANLARI (ad · adres · şehir · giriş/çıkış saati) istemin AYRI
  bölümünde HİÇBİR taramadan geçmeden modele gider. Yani "Giriş kodu 8821" KB'deyse elenir, mülk ADINDAYSA modele
  gider (`tests/unit/qr-property-fields-unscanned.test.ts` karakterizasyonu; adresin gitmesi açık DEĞİL — o misafirin
  zaten bildiği bilgi, açık olan o alanın TARANMAMASI). Kapatmak gönderim politikası değişikliği + ölçülmemiş bedel
  (meşru "Lale 4590" adları düşer, `{daire}` ikamesi mülk adından türüyor) → AYRI ONAY:
  `docs/ONAY-qr-mulk-kimlik-alanlari-sir-taramasi-2026-09-11.md` (öneri: host'a kayıt anında uyarı + belge; ad/adres
  taraması prod ölçümü olmadan AÇILMAZ). 🚨 **`{daire}` BELİRSİZDE İKAME EDİLMEZ:** `apartmentNumberOf` önce
  "daire/no/apt/#" ETİKETİNDEN sonraki sayıyı alır, yoksa TEK sayıyı; birden çok sayı varsa `null` → belirteç
  dokunulmadan kalır. Eski "son sayı" kuralı Türkiye ilan adlarında YANLIŞ numara söylüyordu (ölçüldü:
  "Lale 3 | 2+1 Deniz Manzaralı" → "1", "Lale 12 (2. kat)" → "2"). **09-11 turu dört ölçülmüş kusur daha kapattı:**
  etiket dalı `/i` ile yazıldığı için noktalı İ'yi kaçırıyordu ("DAİRE 5 - 2 Yatak Odalı" → null, host AÇIKÇA
  yazmışken) → İKİ KATLAMA; etiketlerin KELİME SINIRI yoktu ("Mila**no** 12 | Daire 3" → "12") → önde sınır (sonda
  BİLİNÇLİ yok, "Daire 5A" → "5" kalsın); ve TEK sayı tek başına daire numarası SAYILMAZ — sayıyı bir SAYAÇ sözcüğü
  izliyorsa ("Trabzon **4 Kişilik** Daire", ESKİDEN "4") ya da sayı 3 haneden uzunsa ("**2024** Yılı Dairesi",
  ESKİDEN "2024") artık `null` döner, ikame YAPILMAZ. 🚨 Önceki turun pini "2024"ü DOĞRU sayıyordu — yanlış beklenti kodlanmıştı, tersine çevrildi; karşı yön de
  pinli ("Bodrum Villa 8" → "8", "Kule 104" → "104"). `guestFirstNameOf` Türkçe katlamayla büyük/küçük
  harfe duyarsız ("rezervasyon 12345" da yer tutucudur), TAM eşleşme ("Misafirhan" gerçek ad). Tek geçiş `replace`+callback
  (`$&`/`$1` harfi harfine); değeri verilmeyen sınıf ve tanınmayan belirteç (`{kod}`) DOKUNULMAZ. 🚨 `/i` bayrağı
  noktalı **İ**'yi katlamaz → `{İSİM}` eski regex'te KAÇIYORDU; anahtar adı İKİ katlamadan geçer (tr + standart).
  `[ŞİFRE]`/`<adres>`/`___` sınıfı buraya GİRMEZ (doldurulmamış alan; uydurma değer yasak → `packKnowledgeBase` notu). Ölçüm dedektörü `placeholderVerdict` (tests/helpers):
  DEĞER konumu ("…[ŞİFRE] olarak görünüyor" = 4. koşunun gerçek cevabı, regresyon pinli) ya da reddetmeden anma =
  SIZINTI, açık red = "anıldı"; 🚨 **E4'te İKİSİ DE DÜŞER** (Codex ikinci tur: "misafire yer tutucu gösterilmez",
  alıntıya açılmadı; sınıf yalnız rapor kolonunda). Makbuzsuz söz dedektörü üçüncü şahsı ("iletecek") ve EDİLGEN
  biçimi ("size iletilir/paylaşılır", E5'in gerçek cevabı) de yakalar; "-abilir" vaat değil. 🚨 Çıktı kapısında yer
  tutucu vetosu YOK — GERÇEK QR ROTASINDA ÖLÇÜLDÜ (model mock'lu, DB'li): wifi/none/0.95/beyan 1-doğrulanan 0 ile
  ürün "[ŞİFRE]"yi misafire DÖNDÜRÜYOR (`unsourced_claim` yalnız 0.45–0.75 bandında). Onay raporu
  `docs/ONAY-yer-tutucu-cikti-vetosu-2026-09-09.md`; uygulanmadı.
- 🚨 **FEW-SHOT VAR ve FAZLALIK ÖLÇÜLDÜ (09-11, `docs/OLCUM-2026-09-11-few-shot-ve-istem-butcesi.md`):**
  `prompts.ts:482-584` BÖLÜM 13 = **24 tam örnek, 16.191 karakter = sistem isteminin %35,1'i**.
  `REPLY_SYSTEM_PROMPT` **46.135 karakter (53 KB)** — 🚨 `limits.ts:29` ve `prompts.ts:3-4`'teki
  **"~75KB" YANLIŞ** (o, dosyanın tamamı; %40 sapma, bütçe kararı ona dayanmasın). Bir çağrının
  **%96,4'ü STATİK**; misafire özgü içerik 1.786 karakter → few-shot **onun 9,1 KATI** ve hibrit RAG
  bütçesinin (`KB_RETRIEVAL_CHAR_BUDGET` 6.000) **2,70 katı**. 🚨 **BEŞ örnek modele sahte Wi-Fi
  şifresi öğretiyor** (`12345678`/`LaleApt`: ÖRNEK 1·8·11·13·24) — bu YENİ DEĞİL, `automation.ts:1589`
  ve `guest-chat.ts:331` rezervasyon-öncesi sır filtresini TAM BU YÜZDEN kodda yazmış. **19 örnek
  PİNSİZ** (yalnız 11/12/14/20/24 adıyla bağlı). ⚠️ Few-shot bir DAVRANIŞ ÇAPASIDIR — komple silmek
  o sınıfta modeli serbest bırakır; daraltma ölçümle, tek hamlede değil (GOLDEN SET + eval ŞART).
  Koşullu enjeksiyon deseni ZATEN VAR ve çalışıyor (`offerBlock` +1.383 · `conflictBlock` +804 ·
  `styleBlock` +752 · `adjacencyBlock` +659 …) — yalnız en büyük bloğa uygulanmamış.
  **Prompt cache sıralaması DOĞRU** (system önce, önek ~47.533 karakter) ama `cached_tokens`/`usage`
  HİÇBİR YERDE OKUNMUYOR → "önbelleklidir" GÖZLEM değil VARSAYIM.
- 🚨 **DİL BAZINDA RETRIEVAL: RUSÇA ve ARAPÇA'da HİÇ ÇALIŞMIYOR (09-11 ölçüldü).** Hibrit açıkken
  `ru`/`ar` sorgusu `no_lexical_hits` → seçici TÜM KB'ye düşüyor (fail-open, bilgi kaybı yok ama
  hibritin vaadi o dillerde GEÇERSİZ). Sebep: `retrieval/lexicon.ts` 47 kavram/302 terim **TR+EN**,
  kök sökücü Türkçe ekler + `EN_SUFFIXES {ing,ed,es,s}`. Almanca/Fransızca yalnız KAZAEN çalışıyor
  ("wlan" sözlükte, "checkout" normalleşiyor); `"Wo sind die Handtücher?"` de düşüyor. İkinci kusur:
  `detectGuestLanguage` (`fallback.ts:1598-1611`) **Almancayı İngilizce sanıyor** (`de` dalı
  `ich|sie|bitte|danke|hallo|…` listesine bağlı) → `select.ts:326` `queryIsTurkish`'i besliyor.
  İstemin KURALLARI %100 Türkçe (yabancı misafirde de model Türkçe talimat alır; yalnız cevabın dili
  iki satırla isteniyor). 🚨 `input.language` NEREDEYSE DEKORATİF: `en` vs `tr` istem farkı **−5
  karakter** ve o alan ALGILANAN dil değil org ayarı — QR/Ayarlar/demo'da sabit `"tr"`.
  **Embedding'in en güçlü gerekçesi tam burası** (sözcüksel eşleşme o dillerde yapısal olarak yok).
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
  satır BEKLENEN: prod'da DB token'lı org yok, kurucu org `PRIMARY_ORG_ID` env fallback'inde → `CHANNEL_CONNECTION_READ`
  DB'ye kaydedilmiş ilk gerçek bağlantı olmadan AÇILMAZ. **V0.4 ✅ CANLI** (`c378a97`, migration 50 prod'da 09-07
  19:29Z; prod'daki 17.436 mesaj/1538 rezervasyon `legacy` sınıfında, çıkarım backfill'i bilerek yok; envanter §11).
  **V0.5 ✅ CANLI** (`19d5527`, CI #958). **V0.6 ✅ CANLI** (`a2e60fe`, migration 51 prod'da 09-08 03:13Z; IngestEvent boş —
  kurucu org 402'de donuk; envanter §12). **V0.7 ✅ kod hazırlığı CANLI** (`c1f8a2e`, migration'sız; envanter §13). Kolon
  DROP'u (`hospitable*`) V0.3 okuma anahtarı ≥2 hafta canlıda sorunsuz olmadan YOK — canlı geçiş adımları
  `docs/V0.7-CANLI-GECIS-OPERATOR-PLANI.md` (aşama 1: kurucu org "mevcut bağlantıyı aktar"; 2: anahtar; 3: env; 4: drop).
  **V1 Property Memory + Signals CANLI** (migration 52 prod'da 09-08; envanter §14). V0 kod dilimleri bitti. Kalan V0 işleri kendi adlarıyla: kolon contract'ı için kalan
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
- **KAPANDI (09-10, yerel; inceleme turuyla daraltıldı):** Türkçe olumsuz fiil boşluğu — "sıcak su gelmiyor / su akmıyor /
  ısıtma gelmiyor / elektrikler gitti / kapı açılmıyor / sigorta attı / kombi bozuldu" artık `complaint` (`KEYWORDS.complaint`
  "TÜRKÇE OLUMSUZ FİİL BOŞLUĞU" bloğu + `hasDeviceBreakdown`). 🚨 Kalıplar ÇAPALI (tesis adı + fiil; gövde "-yo" ile yazılır ki
  "gelmiyor" da "gelmiyo" da tutsun; zarf biçimleri "su hiç/hâlâ gelmiyo" ayrıca). **Arıza ailesi CİHAZ KURALI** (`hasDeviceBreakdown`; 09-11'de ÜÇ turla daraltıldı, ↓3./4./5.):
  `bozuldu/bozulmuş/arızalı/arızalandı/arızalanmış` şikâyet sayılır ANCAK (i) mesajda `INFLECTION_ONLY`den geçen bir cihaz
  adı varsa, (ii) fiil koşul eki almamışsa (`CONDITIONAL_TAIL`) ve (iii) fiilin solundaki ÖZNE YUVASI açıksa
  (`reportSubjectSlot`). 🚨 "Cihaz adı geçiyor" TEK BAŞINA YETMEZ — "Klima iyi ama taksimiz bozuldu" complaint DEĞİL. Çıplak `gelmiyor/gitti/kesildi/su yok/arıza/yanmıyor/bozuldu/blackout/no heat/elektrik yok/cereyan yok/
  ısınmıyor/elektrik kesintisi/power cut` listeye GİRMEZ (inceleme 09-10 ölçtü: "blackout curtains", "Otoparkta elektrik yok mu,
  şarj için priz var mı?", "Yerden ısıtma yok mu", "Are power cuts common" complaint oluyordu → tuzaklar pinli, riskType satır
  başına TEK değer). "İnternet gelmiyor"/"wifi çekmiyor" BİLİNÇLİ wifi. ASCII ikizi yazılmaz (`includesAnyFold` kelimeyi de
  katlar; ⚠️ `PROBLEM_NEGATIONS` için geçerli DEĞİL). Bitişik eşleşme KORUNDU (gevşetme ölçüldü: olumsuzlama parçacığını
  isminden koparıyor); bilinen sınır pinli: "Elektrikler dün gece gitti", "Kapı bir türlü açılmıyor", çözülmüş bildirim.
  🚨 "Kapı açılmıyor" riskType `safety_emergency`nin sebebi kilit ağı DEĞİL, "açıl"→"acil" ASCII katlama çarpışması
  (`SAFETY_CRITICAL_WORDS` çıplak "acil"; "Havuz ne zaman açılıyor?" da acil) — ayrı iş #51. Kanıt:
  `complaint-negative-verbs.test.ts` (sözleşme + tuzak tabloları) + golden çiftleri + QR "E6 KELİME AĞI İKİNCİ SAVUNMA"
  (model `general/0.9` dese bile devir, `keyword_escalated`) + `language-parity` yeni satırlar (`it.todo` borç). Mutasyon:
  ilk sürüm 13/13 · inceleme paketi 21/21 (bir eşdeğer mutant → cümle eklendi); kırmızı-önce 35 (stash). **Borç:**
  elektrik/su kesintisi/kapı sınıfı DE/FR/ES/RU/AR paritesi. Belge: `docs/ACIK-2026-09-08-turkce-sikayet-siniflandirma-eksigi.md`.
- **İKİNCİ İNCELEME TURU (09-10, ölçümlü ajan) — 25 kırmızı düzeltildi:** 🚨 **Cihaz kuralı iki yerden sızıyordu.**
  (a) Cihaz adı ALTDİZİ aranıyordu → `foldTurkishAscii` ile BAŞKA kelimenin içinde yakalanıyordu: değişiklik→ışık ·
  düşün/düşük/düştü→duş · telefon→fön · sürpriz→priz · kutu/unutuldu→ütü · kombine→kombi · Ocak(ay)→ocak.
  → **KELİME BAŞI** eşleşmesi (aynı üç katlama); çekimli biçimler ("klimamız", "makinesi") korunur.
  (b) Fiil ∧ cihaz mesajın HERHANGİ bir yerinde olabiliyordu → "Klima harika. Ama planımız bozuldu, erken çıkıyoruz."
  şikâyetti. → o turda **AYNI CÜMLECİK** şartı kondu; ÜÇÜNCÜ TUR bunu ÖLÇTÜ ve GERİ ALDI (↓).
  🚨 **KOŞUL BİLDİRİM DEĞİLDİR:** "Su gelmiyorsa ne yapmamız gerekiyor?" / "Buzdolabı arızalanırsa kimi arayalım?" —
  oto-yanıtın ASIL İŞİ olan SSS soruları şikâyet sayılıyordu. Guard 3. şahıs koşul ekini eler (2. turda cümlecik
  kapsamlıydı, 3. turda EŞLEŞMEYE BAĞLANDI ↓). ⚠️ Guard YALNIZ 09-10 kalıplarına
  (`NEGATIVE_VERB_COMPLAINTS`, `KEYWORDS.complaint`ten AYRI liste) uygulanır — ESKİ ağa uygulamak DENENDİ ve ÖLÇÜLDÜ:
  "Böyle giderse bir yıldız veririm" (gerçek yorum tehdidi) `general`e düşüyordu → eski ağ DOKUNULMADI. 1. şahıs koşul
  ("alamazsam") guard'a girmez. 🚨 **TAM BİÇİM, GÖVDE DEĞİL:** "arızalan"/"tuvalet tıkan"/"kapı sıkış"/"musluk damlat"
  gövdeleri OLUMSUZ ve türetilmiş biçimleri de yakalıyordu ("arızalanmadı", "tıkanıklığı yok", "sıkışmıyor",
  "damlatmıyor" = ÖVGÜ) → olumlu tam biçimler. **Kaybı kapatılanlar:** "no heat" silinmişti → "no heat in/since/at all"
  (yanlış negatifti); oda çapası dardı → salon/mutfak/banyo/…odasında elektrik-ısıtma; `PROBLEM_NEGATIONS` belirtme hâli
  ("Hiçbir sorunU yaşamadık" complaint oluyordu).
- **ÜÇÜNCÜ İNCELEME TURU (09-11, ölçümlü ajan) — 2. turun CÜMLECİK şartı GERİ ALINDI (gerileme):** 🚨 Cümlecik şartı
  44 gerçekçi bildirimin **30'unu** düşürüyordu ve bedel GERÇEKTİ: `passesAutoReplySafetyGate` "Klimayı açtık,
  bozuldu." · "Buzdolabını kontrol ettim, tamamen bozulmuş." · "Kombiye baktım, arızalı görünüyor."ya **OTO-GÖNDERİM
  İZNİ** veriyordu (2. tur öncesi üçü de bloklanıyordu). Türkçede cihaz NESNE olarak ilk cümlecikte, fiil ikincide
  durur — bu şikâyetin OLAĞAN biçimi. Cümlecik yerine **iki DAR kapı**: (1) **ÖZNE KURALI** — fiilin HEMEN SOLUNDAKİ
  belirteç `NON_DEVICE_SUBJECTS` ise (plan/hava/mide/uçuş/program/rezervasyon/fiyat/moral/telefon/saat/bilet) şikâyet
  DEĞİL; (2) **ÇEKİM DOĞRULAMASI** — cihaz adından sonra yalnız ÇEKİM eki dizisi gelebilir ([çoğul][iyelik][hâl]),
  türetme eki gelemez: kapı+**cı**, kapı(ASCII "kapi")+**talizm**, makine+**li**, ocak+**başı**, fön+**ksiyon** elenir.
  İki kapı BİRLİKTE gerekir: "kombine" DİLBİLGİSEL olarak kombi+n+e'dir (2. tekil iyelik + yönelme) → çekim kapısı
  eleyemez, özne kuralı ("bilet") eler. 🚨 **KOŞUL kipini CÜMLE değil FİİL taşır:** cümlecik kapsamlı guard 24 gerçek
  bildirimin 17'sini düşürüyordu ("Su gelmiyor EĞER akşama kadar düzelmezse…" — "eğer" eşleşmeden SONRA geliyor) →
  yalnız eşleşmenin HEMEN ARDINDAKİ ek okunur (`^[ry]?s[ae]`: ‑sa/‑rsa/‑ysa); serbest "eğer" artık hüküm vermez.
  `CLAUSE_SPLIT` **`fallback.ts`ten** tamamen kalktı (aynı adlı sabit `retrieval/rerank.ts`te YAŞIYOR, ilgisiz; `\n` bacağı zaten ÖLÜYDÜ: `normalizeForMatch` satır sonunu boşluğa indiriyor).
  **Ölçülüp SİLİNEN iki kod (geri getirme):** `N_BUFFERED_CASE`/`LEXICAL_POSSESSIVE_DEVICES` ("buzdolabı+nı" için)
  ÖLÜYDÜ — n ile başlayan hâl eklerinin tamamı zaten 2. tekil iyelik dalından geçiyor; "fiil okumalarından koşulsuz
  olanı tercih et" dalı ULAŞILAMAZDI (arıza fiilleri tam biçim, tek okuma üretir). 🚨 **"ASCII bacağını yalnız Türkçe
  harfsiz belirteçte dene" kapısı DENENDİ ve UYGULANAMAZ:** `matchCandidates`in `stripCombining` adayı (görünmez-işaret
  saldırı sınıfı için) metni zaten diakritiksiz sunuyor → koruma yanılsaması olurdu; çarpışmaları eleyen şey ÇEKİM
  doğrulamasıdır. Bilinen sınır pinli: "Tatil düşümüz bozuldu." complaint ("dus"+"umuz" geçerli çekim). Ünsüz
  yumuşaması yalnız ölçülen vakada ("kilid"). Fiil de KELİME BAŞINDA aranır → bitişik yazım ("klimabozuldu")
  ayrıştırılmaz; bedeli iki yönlü pinli. Kanıt: kırmızı-önce 27 düşen + oto-yanıt kapısı bloğu (2 kırmızı);
  **mutasyon 21/21** (ilk koşuda 3 hayatta kaldı: ikisi ÖLÜ KOD'u gösterdi → silindi, biri eksik pini → satır eklendi).
- **DÖRDÜNCÜ İNCELEME TURU (09-11, ölçümlü ajan) — özne kuralı ALLOWLIST'ten VARSAYILAN RET'e:** 🚨 3. turun
  11 kelimelik `NON_DEVICE_SUBJECTS` listesi sınıfı KAPATMIYORDU — mesajında gerçek cihaz adı geçen 30 gerçekçi
  mesajın **24'ü** hâlâ yanlış `complaint` oluyordu (taksimiz · bavulumuz · tatilimiz · uyku düzenimiz · çayın tadı ·
  şarj aletimiz · cildim · canımız · valizimizin tekerleği…); Türkçede fiilin solundaki özne SINIRSIZ, liste uzatmak
  çözüm değil. Ayrıca **tek bir ZARF kuralı devre dışı bırakıyordu** ("Planımız TAMAMEN bozuldu" — 17 varyantın 16'sı)
  ve tüm pinler özne↔fiil bitişik biçimde olduğu için hiçbir test bunu görmüyordu. **Yeni kural (`reportSubjectSlot`):**
  fiilin solunda ÖZNE varsa ve CİHAZ DEĞİLSE bildirim sayılmaz; özne yokluğu ancak sol komşunun çekimli FİİL/ULAÇ
  olmasıyla (`VERB_LIKE`) ya da eksiz yüklem (`var/yok/değil`) olmasıyla ya da fiilin cümle başında olmasıyla anlaşılır;
  araya giren zarf/bağlaç ATLANIR (`SUBJECT_SLOT_FILLERS`). Ölçüm: **yanlış pozitif 24 → 2, kaçırılan bildirim 0.**
  🚨 **"Kalan iki FP" İFADESİ FAZLA DARDI** (6. tur düzeltmesi): kalan yanlış pozitifler AÇIK bir sınıftır —
  BELİRTİSİZ tamlamada iyelik zinciri devreye girmez ve `VERB_LIKE` t/d ile biten ismi fiil okur: "şarj **aleti**" ·
  "market **sepeti**" · "kurs **kaydı**" bugün yanlış `complaint` (bağımsız 15'lik bataryada 4). Yön GÜVENLİ (aşırı
  eskalasyon). 🚨 Kapatmak için "3. tekil iyelik kontrolünü `VERB_LIKE`ın önüne al" ÖNERİLDİ, ÖLÇÜLDÜ ve REDDEDİLDİ:
  10 yaygın geçmiş-zaman fiilinin 7'si ("çalışıyordu · onardı · açtı · denedi · baktı · getirdi · kapattı") iyelik
  sanılıyor ve 3/3 gerçek bildirim KAYBEDİLİYOR ("Kombiyi tamirci onardı, sonra bozuldu."). İki pinli FP (önceden var
  olan "gürültü" kelimesi · misafirin KENDİ cihazı) yalnız o sınıfın ÖRNEKLERİDİR, sınırı değil. ⚠️ **SAYILAR O BATARYAYA AİT** (5. tur düzeltmesi): "24 → 2"
  ve "kaçırılan bildirim 0" YALNIZ o 30/38 mesajlık batarya içindir; bağımsız bir batarya 15 gerçek bildirimin
  düştüğünü ölçtü (↓ beşinci tur). **Liste YENİDEN KURULDU (11 → 8: yedi girdi çıktı, `tat/tad/cilt/cild` EKLENDİ) + ADI DEĞİŞTİ (`VERBLIKE_NOUN_OVERRIDES`):**
  varsayılan-RET gelince plan/hava/mide/uçuş/program/rezervasyon/telefon ÖLÜ kaldı; geriye yalnız t/d EŞSESLİLİĞİ
  kaldı (saat+i ≡ ‑ti · tad+ı ≡ ‑dı · cild+im ≡ ‑dim · fiyat+ı · moral+im · bilet+i). 🚨 **Ünsüz yumuşamasında beş
  gövde daha eksikti ve KAPI ETKİSİ ÖLÇÜLDÜ** ("Musluğu açtık, bozuldu." · "Ocağı yakamadık, arızalı." OTO-GÖNDERİLİYORDU)
  → `ocağ · musluğ · bulaşığ · peteğ · ışığ` + `dolap/dolab` + cihaz PARÇASI `motor`. 🚨 **`fön` ÇIKARILDI** (ASCII "fon"
  beş gerçek sözcüğü cihaz sayıyordu; "fön makinesi" zaten `makine`). **Sahte yeşil:** üç TRAP satırında kararı özne
  kuralı veriyordu, çekim kapısı silinse de yeşil kalırlardı → kapıyı YALNIZ BAŞINA sınayan satırlar ("Kapıcıyı aradık,
  bozuldu."). Kanıt: kırmızı-önce 26 + **mutasyon 26/26** (bir hayatta kalan → doğal ayırt edici bulundu).
- **BEŞİNCİ İNCELEME TURU (09-11, ölçümlü ajan) — 4. turun ÖZNE YUVASI kuralının üç KÖR NOKTASI (gerileme):**
  Bağımsız bir batarya, 4. turun **15 gerçek arıza bildirimini düşürdüğünü** ve kapının onlara OTO-GÖNDERİM izni
  verdiğini ölçtü (c4b32b7 ile birebir kıyas). Sebep: "özne var + cihaz değil → RET" varsayılanı Türkçede özne
  yuvasının ÇOĞU ZAMAN cihaz olmadığı gerçeğiyle çatışıyor. Üç sınıf, üç DAR kapı:
  ① **İYELİK ZİNCİRİ** — kısmi arızanın olağan biçiminde yuvada cihazın PARÇASI durur ("Klimanın FANI bozuldu",
  "fırının KAPAĞI", "kilidinin DİLİ"). Parça adlarını cihaz listesine yazmak sınıfı kapatmaz (sonsuz); ayırt edici
  DİLBİLGİSİ: 3. tekil iyelikli ad solundaki TAMLAYANIN parçasıdır → tamlayan cihazsa KABUL. İki dal: tamlayan eki
  AÇIK ("klimaNIN fanı") ve belirtisiz tamlama ("klima kumandası"). 🚨 Zincir FİİL testinden ÖNCE bakılır — "babamın
  SIHHATİ" biçimsel olarak "-ti" fiil ekine benzer, zincir onu tamlayan cihaz değil diye REDDEDER (yanlış complaint
  üretiyordu). ② **ZARF ÖBEĞİ** — 58 kelimelik liste yalnız TEK kelimeyi atlıyordu: "Kombi BU SABAH bozuldu" ·
  "İKİ GÜNDÜR" · "SAAT ÜÇTE" · "ÖĞLEDEN SONRA" hepsi düşüyordu. Liste yerine BİÇİM: zaman ve sayı KAPALI sözcük
  sınıfları (`TIME_WORDS`/`NUMBER_WORDS`) + gösterme sıfatları. 🚨 **Zarf çekimi İYELİK ALMAZ**: "öğleDEN/üçTE"
  zarf, "günÜMÜZ/geceMİZ" ÖZNEdir → ayrı ek kümesi (`ADVERBIAL_SUFFIX`); tam çekim tablosu kullanmak "günümüz
  bozuldu"yu yanlış complaint yapıyordu. ③ **ULAÇ EKLERİ** — `‑ınca · ‑dığında · ‑dıktan · ‑madan` yoktu, yani
  3. turun düzelttiği cümle şeklinin ta kendisi başka eklerle düşüyordu ("Klimayı AÇINCA, bozuldu"). Ayrıca
  **MASTAR dalı (`‑mak/‑mek`) ÇIKARILDI**: "yemek/ekmek" gerçek isimlerdir ve fiil sanılıyordu (ölçüldü).
  **Ölçülüp SİLİNEN kod:** niceleyici sözcükler (hep/tüm/çoğu) ÖLÜ çıktı — "hepsi/ikisi" zaten iyelik zincirinden
  geçiyor. **`apartmentNumberOf` iki düzeltme daha:** etiket ÖNCELİĞİ ("No:12 D:5" → eski tek regex "12" = BİNA
  diyordu, doğrusu "5"; güçlü etiket `daire/apartment/apt/D:` önce, zayıf `no/#` sonra) ve 🚨 **sayısız adda `null`**
  (eskiden MÜLK ADININ TAMAMI dönüp ikame ediliyordu → "Kapı kodu: Cozy Seaside Flat" misafire gidiyordu).
  Kanıt: kırmızı-önce 25 + **mutasyon 26/26** (iki hayatta kalan: biri ölü niceleyici listesini, biri belirtisiz
  tamlama dalının pinsizliğini gösterdi).
- **ALTINCI İNCELEME TURU (09-11, DÖRT paralel ölçümlü ajan — satır satır) — üç OTO-GÖNDERİM açığı + sekiz test kusuru:**
  🚨 ① **Görünmez karakter `sorun/problem` ağını DELİYORDU:** tek bir U+00AD "Dairede bir so<U+00AD>run var."ı `general`
  yapıyor ve oto-gönderim izni çıkıyordu — dosyanın `normalizeForMatch` başlığında KENDİ belgelediği bypass sınıfı.
  Düzeltme `includesAnyFold`a ve 09-10/09-11 turlarında öteki bacaklara uygulanmış, `hasUnnegatedProblemWord` ATLANMIŞTI →
  normalize edilmiş ÜÇÜNCÜ okuma OR'landı (yalnız EŞLEŞME EKLER). ⚠️ HAM okumalar YERİNDE KALDI ve artık PİNLİ:
  "Sorun  yok" (çift boşluk) complaint kalır — boşlukla bozulmuş olumsuzlamaya güvenilmez (katlama kuralı).
  🚨 ② **İZAFET/TAMLAMA komple kaçıyordu:** `NEGATIVE_VERB_COMPLAINTS` 1. turdan beri ÇIPLAK YALIN HÂLDE donmuştu
  ("musluk akmıyo") ama Türkçede tesis adı neredeyse hep tamlamadır ve yumuşama + 3. tekil iyelik alır — "Mutfak
  **musluğu** akmıyor" · "Banyo **lavabosu** tıkandı" · "Oda **peteği** ısınmıyor": 17 çiftin 17'si düşüyor, 14'ü
  oto-gönderiliyordu. 4. tur `BREAKDOWN_DEVICES`e yumuşama gövdelerini eklerken KARDEŞ LİSTE güncellenmemişti (aynı cihaz
  "bozuldu" ile complaint, "akmıyor" ile general). İzafet/çoğul kalıpları eklendi. ⚠️ BİLİNEN SINIR: bu bacak hâlâ KALIP
  tabanlı; yazılmamış her tamlama kaçar (yapısal birleştirme ayrı tur).
  🚨 ③ **"ve" bağlacı özne sanılıyordu** ("Klimayı açtık VE bozuldu" → oto-gönderilir; "AMA" ile complaint) ve
  🚨 ④ **kesme işareti cihaz adını ekinden koparıyordu** ("Klima'mız bozuldu" → oto-gönderilir) → `deviceTokens` kesmeyi
  kelime İÇİNDE siler. Ayrıca gereksiz `"su"` filler girdisi çıktı (gerçek tesis adı, özne yuvasında atlanmamalı).
  **REDDEDİLEN düzeltme (ölçüldü):** `PROBLEM_NEGATIONS`taki "sorun değil/olmaz/sorunsuz" girdilerini TAM olumsuz biçime
  daraltmak — "…ama SORUN DEĞİL" gibi ÇOK YAYGIN nezaket kapanışları complaint'e döndü; kazanç nadir, bedel yaygın →
  eski hâl korundu, bilinen sınır test-pinli.
  **Yer tutucu (ajan B):** `apartmentNumberOf`ta sayaç ve hane kuralları ETİKETLİ yolda HİÇ çalışmıyordu ("Sahilde Daire
  6 Kişilik" → "6" kapasite; "No 2024" → yıl) → çapalı sayaç kontrolü + zayıf etikette hane sınırı; sayaç listesi TR-only
  iken etiket dalı İngilizceyi kabul ediyordu (15/15 yanlış numara) → İngilizce sözcükler; `guestFirstNameOf` TEK
  katlamaydı ("MISAFIR" → misafire "Merhaba MISAFIR,") → iki katlama; ölü `"m2"` girdisi çıktı. 🚨 **BAŞLIK da çözülür ve
  taranır:** `packKnowledgeBase` başlığı isteme YAZIYOR ama ikame de yer-tutucu notu da yalnız `content`e bakıyordu.
  **Test kusurları (ajan C, ölçülmüş):** iki TUZAK satırı "mesajda cihaz var" sözünü tutmuyordu · `fön` çıkarıldığı için
  iki satır ÖLÜ kalmıştı (silindi) · `VERBLIKE_NOUN_OVERRIDES`in 8 girdisinin 5'i PİNSİZDİ (ayırt edici biçimler yazıldı) ·
  kelime sınırı ve zayıf etiket dalı pinsizdi · QR ad bacağı aynı sabiti kullandığı için izole değildi · bir QR testinde
  anti-vacuity çapası yoktu · üçüncü kolonun (`riskType`) çoğu satırda TÜRETİLMİŞ olduğu yazıldı.
  Kanıt: kırmızı-önce 26 + **mutasyon 28/28** (bir hayatta kalan pinsiz bilinçli kararı gösterdi → pinlendi).
- **YEDİNCİ TUR (09-11, DÖRT paralel ölçümlü ajan) — (a) ENVANTER + (b) 6. TURUN İKİ GERİLEMESİ:**
  **(a) `BREAKDOWN_DEVICES` bir ENVANTERDİR, dilbilgisi değil** — yazılmamış her cihaz adı arıza fiiliyle gelse bile
  `general` kalır ve kapı OTO-GÖNDERİM İZNİ verir. İki partide ölçüldü: 1. partide 14 gerçekçi bildirimin 14'ü kaçıyordu,
  **13'ü oto-gönderim izni alıyordu**; 2. partide 16'nın 12'si. Dördü BAŞKA bir bacaktan complaint'ti ve asimetrinin
  kendisi kusurdu ("Çaydanlık bozuldu, ısıtmıyor" complaint / "Çaydanlığı fişe taktık, bozulmuş" general). **19 ad
  eklendi** (davlumbaz · aspiratör · jaluzi · panjur · diyafon · termostat · vantilatör · duşakabin · süpürge · pencere ·
  çaydanlık+**çaydanlığ** · havalandırma · boyler · kepenk+**kepeng** · rezervuar · interkom · avize · perde · router).
  🚨 `router` POLİTİKA DEĞİŞİKLİĞİ DEĞİL, `modem` ile PARİTEDİR (modem 1. turdan beri listedeydi; aynı cihazın iki adı
  farklı sınıf üretiyordu) — "İnternet gelmiyor"/"wifi çekmiyor" BİLİNÇLİ `wifi` kalır, test-pinli. 🚨 **`batarya`
  ÖLÇÜLÜP REDDEDİLDİ** (geri ekleme): hem banyo armatürü hem telefon pili → "Telefonumun bataryası bozuldu" /
  "Powerbank bataryamız bozuldu" = 2/2 yanlış pozitif; iyelik ZİNCİRİ kurtarmaz (belirtecin KENDİSİ cihaz sayılınca
  zincir dalına ulaşılmaz). Bedeli pinli: banyo armatürü bildirimi KAÇIYOR. `çay` da mutasyonla pinsiz çıktı → tüketim
  maddesi pini yazıldı. Bağımsız anti-sıkılaşma bataryası (130 mesaj + 42 sözcük çarpışma probu) bu 19 kelime için
  **0 yeni yanlış pozitif** ölçtü. Kanıt: kırmızı-önce 5 blok + **mutasyon 20/20**.
  **(b) İNCELEME — üç P1, ikisi 6. turun KENDİ gerilemesi:**
  🚨 ① **Homoglif bypass'ı hâlâ açıktı:** 6. tur üçüncü okumayı YALNIZ `normalizeForMatch` üzerinden aldı, `deconfuse`
  adayını ATLADI → tek bir Kiril "о" (U+043E) aynı oto-gönderim iznini yeniden açıyordu. `deconfuse(normalizeForMatch(…))`
  ile sarıldı. 🚨 **`matchCandidates`i olduğu gibi dolaşmak YANLIŞ** (ölçüldü, yapma): `stripCombining` "yaşamadık"ı MELEZ
  "yasamadık" yapar, o biçim ne TR ne ASCII olumsuzlama girdisiyle eşleşir → "Hiçbir sorun yaşamadık." ÖVGÜSÜ complaint'e
  döner. Yalnız `deconfuse`; 11 olumsuzlama pini korundu.
  🚨 ② **`"su"`yu filler'dan çıkarmak 6 GERÇEK BİLDİRİMİ düşürdü** ("Şofbeni açtık, su bozuldu." · "Duşta su bozuldu.").
  6. turun gerekçesi ("SU gerçek bir tesis adıdır") KODDA TERSİNE çalışıyordu: `su` cihaz listesinde OLMADIĞI için özne
  yuvasında "cihaz-DIŞI özne" sayılıp bildirimi REDDETTİRİYORDU. → `su` + `suy` (kaynaştırma gövdesi) **CİHAZ** yapıldı;
  6. turun pini YANLIŞ YÖNÜ kodluyordu, ters çevrildi. Çekim kapısı türetmeleri eliyor (sunum · susuz · surat · suçlu · sucuk).
  🚨 ③ **İzafet kalıpları ÇAPASIZ** — herhangi bir iyelik öbeğinde eşleşiyor ve 14 bilgi sorusunun 13'ünü complaint
  yapıyordu ("Havuzun suyu akmıyor **mu**, şelale gibi mi?" · "Sokak lambası yanmıyor **mu** gece?" · "Kahve makinemizin
  suyu akmıyor, biz getirmiştik"). → **SORU EKİ guard'ı** (`QUESTION_TAIL`, `CONDITIONAL_TAIL` emsaliyle) YALNIZ izafet
  alt kümesine (`POSSESSIVE_FACILITY_COMPLAINTS`). 🚨 Guard'ı TÜM ağa açmak ÖLÇÜLDÜ: beş gerçek şikâyet düşüyor
  ("Sıcak su gelmiyor mu acaba, duş alamadık.") → DAR tutuldu, mutasyon pinli. Harf sınırı (`(?!\p{L})`) ŞART: onsuz
  "mutfakta/mumla" soru eki sayılıp üç bildirimi susturuyor. `"duşu akmıyo"` ÖLÜ girdi çıktı (mevcut "su akmıyo" ASCII
  katlamada altdizi) → silindi.
  **`sorun/problem` KOŞUL AİLESİ** (ölçülen EN BÜYÜK yanlış pozitif sınıfı, 11 mesaj): İZİN sorusu ailesi ("sorun olur mu")
  08-01'den beri korunuyordu, KOŞUL ailesi unutulmuştu → "Bir sorun olursa sizi arayabilir miyiz?" oto-yanıtın VAR OLMA
  SEBEBİ olan soruyken insana devrediliyordu. Ayrı liste `PROBLEM_CONDITIONAL_NEGATIONS` + iki dar kural: 🚨 **ALINTI
  FRENİ** — `" diye "` görülürse koşul elemesi HİÇ uygulanmaz (fail-closed; fren olmadan 7 karışık mesajın 2'si `general`e
  düşüyordu: "Sorun olursa diye yazıyorum, perde rayından çıkmış."); boşluklu yazılır ("diyet" içinde de geçer, pinli).
  🚨 **İngilizce girdilerin "ı"lı İKİZİ ŞART** — `foldTurkishLowerTr` cümle başındaki "I"yı "ı" yapar, ikizsiz hâlde
  İngilizce koşul cümlesi complaint kalıyordu.
  **Yer tutucu — dört kusur:** 6. turun sayaç kuralı KANONİK TÜRK ADRESİNİ yok ediyordu ("No:12 D:5 Kat:3" → `null`,
  5. turun KENDİ vitrin örneği; "Apartment 12 Floor 3" → `null`) → **sayaç sözcüğü KENDİ SAYISINI alıyorsa modifikatör
  değil YENİ ETİKETTİR** · İngilizce ilan başlıklarında sayaç sayının SOLUNDA ("Cozy Studio **Sleeps 4**" → "Daireniz 4")
  → dar `COUNTER_BEFORE_NUMBER` · 🚨 **`packKnowledgeBase` BAŞLIK taraması GERİ ALINDI**: başlıklar ETİKET taşır ve
  `[...]` deseni etiketle yer tutucuyu ayırt edemez → "[ÖNEMLİ] Wi-Fi" · "[EN] Check-in" · "Kurallar [Güncellendi]" ·
  "Otopark &lt;yeni&gt;" (4/4) DOLU kalemler için modele "bu bilgi kayıtlarımda yok" (KURAL-3) talimatı üretiyordu; kazanç
  ÖLÇÜLDÜ ve SIFIR (`KB_PRESETS`in hiçbirinde parantezli BAŞLIK yok). İkame tarafı başlığı çözmeye DEVAM eder; sır kapısı
  zaten `title\ncontent` tarar · `APOSTROPHES`teki **U+00B4 ÖLÜ girdiydi** (NFKC onu BOŞLUK + U+0301 yapar, `deviceTokens`e
  hiç ulaşmaz) → silindi, sınır pinli; **U+02BC ve U+2032 EKLENDİ** (NFKC'den değişmeden geçiyor) · `guestFirstNameOf`
  yorumu ("'Misafir Ahmet' KORUNUR") KODLA ÇELİŞİYORDU, dosyanın kendi testi tersini pinliyor → düzeltildi.
  Kanıt: kırmızı-önce 9 blok + **mutasyon 21/23**; kalan ikisi ÖLÇÜLMÜŞ EŞDEĞER MUTANT ve ikisi de bir iddiayı KANITLIYOR
  (U+00B4'ün geri konması davranışı değiştirmiyor = "ölü girdi"; sol-sayaç kontrolünü etiketli yola eklemek ULAŞILAMAZ).
- **SEKİZİNCİ TUR (09-11, İKİ ölçümlü ajan) — ENVANTERİN KALAN BÜYÜK BOŞLUĞU + BİR KESME KUSURU.**
  51 aday İZOLE bildirim cümlesiyle ölçüldü: **49'u kaçıyordu** ve kapı oto-gönderim izni veriyordu
  ("Salondaki ampul bozuldu." · "Mutfak evyesi bozuldu." · "Duman dedektörü bozulmuş." · "Yürüyen
  merdiven bozuldu." · "Hidrofor arızalı." · "Elektrik panosu bozuldu."). **47 girdi eklendi**
  (44 ad + 3 yumuşama gövdesi `yatağ`/`koltuğ`/`gardırob`); liste 145 girdiye çıktı.
  🚨 **KESME BİRLEŞTİRMESİ TÜRKİYE YER ADLARINI CİHAZ ADINA ÇEVİRİYORDU** (6. turun kendi kusuru,
  bağımsız ajan ölçtü): kesme kelime İÇİNDE KOŞULSUZ siliniyordu, oysa Türkçe imlada kesme ÖZEL
  ADDAN SONRA eki AYIRIR — **"Van'a giderken bozuldu." → `vana` = VANA → complaint** (Van bir İL);
  **"Kaş'a giderken bozuldu." → ASCII `kasa`** (Kaş yoğun bir kiralama beldesi); "Bor'u gezdik,
  bozuldu." → `boru`. "Yolda bozulduk" Türkiye misafir trafiğinin OLAĞAN cümlesidir. Düzeltme TEK
  ŞARTLI: birleştirme yalnız kesmenin SOLUNDAKİ parça zaten bir CİHAZ ADIYSA yapılır — 6. turun
  "Klima'mız" kazanımı KORUNDU (test-pinli, iki yönlü), yön yalnız ELEMEDİR.
  🚨 **BEŞ KELİME ÖLÇÜLÜP ÇIKARILDI** (geri ekleme; `fön`→`fon` emsali, çarpışma kesmeden BAĞIMSIZ):
  `kasa` ("Markette kasa bozuldu") · `masa` ("Maşayı kullandık" ASCII ş→s; "masaya yatırmak" deyimi) ·
  `zil` ("Zile vardık" ilçe; "Telefonumun zili") · `küvet` ("Kuvetimiz kalmadı" — "kuvvet" yazım
  hatası) · `çekmece` ("Çekmece'ye taşındık" ilçe). Bedeli kabul edildi ve pinlendi: bu beşin gerçek
  bildirimleri KAÇAR. `vana` ve `boru` LİSTEDE KALDI — tek çarpışmaları kesmeydi, kaynağında kapandı.
  🚨 **`kablo` ve `hoparlör` de REDDEDİLDİ** — `batarya` ile aynı sınıf (baskın okuma misafirin kendi
  eşyası: "Telefon şarj kablomuz" · "Bluetooth hoparlörümüz"); bedeli: host'un uzatma kablosu / gömülü
  ses sistemi bildirimi kaçar. Başka ajanın ölçüp reddettikleri: `fan` (Fanta) · `cam` (cami) · `gider` ·
  `uydu` (uydum) · `raf` (rafine) · `stor` (store) · `halı` (ASCII "hali") · `sigorta` · `kart` ·
  `kamera` · `alarm` · `adaptör`.
  ⚠️ **SAHİPLİK KÖRLÜĞÜ MİMARİDİR, bu partiye ÖZGÜ DEĞİL** (ajan ölçtü): HEAD'in MEVCUT 16 cihazı da
  aynı kalıplarda **80/80** yanlış pozitif veriyor ("Getirdiğimiz kettle bozuldu." · "Arabamızın kilidi
  bozuldu."). Yeni kelimeler bu körlüğü MİRAS ALIR, açmaz. Ayrı tur: *1. çoğul iyelik + cihaz-dışı ad*
  biçimsel kuralı.
  Kanıt: kırmızı-önce 4 blok + **mutasyon 25/25** (kaldırma 8 · aşırı uygulama 9 · kesme iki yönlü 2 ·
  önceki tur kapsamı 6).
- 🚨 **İZAFET ÇAPASI ÖLÇÜLDÜ ve REDDEDİLDİ (8. tur, ayrı ajan — tekrar tasarlanmasın).**
  `POSSESSIVE_FACILITY_COMPLAINTS`in çapasızlığı için iki tasarım 106 mesajlık korpusta ölçüldü
  (48 gerçek bildirim · 27 bilgi sorusu · 22 sınırda · 15 ilan-adı tuzağı):

  | | HEAD | (A) daire-DIŞI dışlama | (B) daire-İÇİ içerme |
  |---|---|---|---|
  | bilgi sorusu yanlış pozitifi (27) | 27 | 13 | **2** |
  | 🚨 gerçek bildirime OTO-GÖNDERİM İZNİ (85) | **0** | 7 | 18 |
  | ilan-adı kaybı (15) | **0** | 1 | 7 |

  Dört ölçülmüş ret gerekçesi: ① ayrım SÖZCÜKSEL DEĞİL — "Havuzun suyu akmıyor" havuzlu mülkte host'un
  işi, havuzsuz mülkte bilgi sorusu; karar ancak mülkün olanak listesiyle verilir, `fallback.ts` ise
  saf/DB'siz (pin). ② çapa çoğu zaman tamlama zincirinin ARA HALKASI ("Sitenin havuzunun suyu");
  zinciri yürümeden yanlış pozitiflerin yarısı kapanmıyor, yürüyünce **ilan adları düşüyor (8/15)**
  ("Park Evleri'ndeki dairenin musluğu akmıyor" → oto-gönderilir). ③ Türkiye'de kısa dönem kiralama
  ilan adları TAM BU SÖZCÜKLERDEN kurulur (Deniz Apart · Park Evleri · Sahil Residence · Marina Sokak ·
  Göl Villa) — dışlama listesi = en yaygın ilan-adı belirteçleri listesi. ④ **dosyanın kendi kuralıyla
  çelişir:** 8. tur `havuz`u `BREAKDOWN_DEVICES`e ekledi; A ile "Havuz bozuldu." complaint ama "Havuzun
  suyu akmıyor." general — aynı nesne hakkında iki karşıt hüküm. 🚨 Dar varyant (A′) tek "0 oto-gönderim"
  seçeneğiydi ama güvenliği BİLİNEN BİR BUG'a dayanıyor (`açıl`→`acil` ASCII çarpışması, iş #51) — o bug
  düzeltilince üç bildirim sessizce oto-gönderime açılır. **YÖN KURALI HEAD'i kazandırdı.**
- **Eval MODEL KIYASI altyapısı (09-11, ücretli servis ÇAĞRILMADI):** `tests/eval/sidecar.ts` her koşunun yanına aynı
  kökle makine-okunur JSON yazar (`.md` → `.json`) ve iki yolu stdout'a basar; `scripts/eval-compare-models.mjs` her
  modeli AYRI SÜREÇTE koşup yan yana rapor üretir. 🚨 Markdown PARSE EDİLMEZ (rapor metni her turda değişiyor, bir tablo
  başlığı değişince kıyas sessizce yanlış sonuç üretirdi). 🚨 AYRI SÜREÇ ŞART: `suggestReply` modeli `OPENAI_MODEL`den
  okur ve bu değer süreç başına sabittir. 🚨 ÜCRETLİ KAPI: kaç gerçek çağrı yapacağını DATASET'ten okuyup yazar,
  `EVAL_COMPARE_YES=1` yoksa onay bekler. 🚨 Eksik kıyas "geçti" diye okunamaz (çıkış kodu 1). Kullanım:
  `RUN_REAL_EVAL=1 node scripts/eval-compare-models.mjs gpt-5.1 gpt-5.6-luna`. **Gölge katmanı (`shadow-ai.ts`) luna'yı
  kurucu org'da zaten koşuyor ama YALNIZ güvenlik sınıflandırmasını kıyaslıyor; CEVAP KALİTESİ bu harness'la ölçülür** —
  model değişimi İKİ kanıt ister, gölge yalnız birini verir.
- **KB onay sözleşmesi (A1) CANLI — migration 53 prod'da 09-08 16:42Z; §A doğrulandı (32 satır `legacy|legacy`, aktif = AI-okunabilir = 32).**
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
- **A2 temellendirme izlenebilirliği CANLI — migration 54 prod'da 09-08 19:30Z (7 nullable kolon; DB düzeyi `host_manual|approved` / `srcVerified` / `kbEvidenceJson` değerleri HENÜZ salt-okuma sorguyla doğrulanmadı — kurucu adımı).**
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
- **A3/A4/A5 CANLI (`d972b87`), MIGRATION İSTEMEDİ** (ihtiyaç raporu: `docs/MIGRATION-IHTIYAC-RAPORU-A1-A5.md`).
  **A3** `modules/intelligence/recommendations/kb-gaps.ts` (salt-okuma): `Signal` + KB onay durumu + `RiskEvent`
  A2 sayaçları; sinyal ↔ karar kaydı AYNI mesaj kimliğinden bağlanır (`sourceEntityId` = `triggerId`).
  Üç sınıf: `absent` (öneri) · `ungrounded` (TEŞHİS, yeni kalem YANLIŞ cevap) · `awaiting_approval`.
  Operasyonel niyet ve `amenity` eşlenmez (gerekçeler kodda). Tekilleştirilmiş, önem sıralı, BİLDİRİM YOK,
  hiçbiri `decisive`; "kapat/ertele" İLK DİLİMDE YOK (o migration ister). **A4** `KB_PRESETS` eksik
  satırına bağlı ("Şablonla doldur" → form dolar, HİÇBİR ŞEY KAYDEDİLMEZ; şablonsuz kategoride içerik
  UYDURULMAZ). **A5** `lib/kb-extract.ts` saf/LLM'siz + `kb-import-text.tsx`: çıkarım TARAYICIDA, önizleme
  kaydetmeden, kabul edilen kalem mevcut `POST /api/kb` yolundan (kaçış rotası açılmadı). 🚨 Yer tutucu
  gerçeğe DÖNÜŞMEZ ama sessizce yutulmaz; giriş/çıkış saati KB kalemi ÖNERİLMEZ (çift kopya yasağı).
  Ölçüm: `docs/olcum/kb-once-sonra.md` + `docs/olcum/host-akisi-once-sonra.md` (gerçek ekran görüntüleri).
- **GERÇEK MODEL EVAL'İ KURUCU TARAFINDAN KOŞULDU (09-09, `a52a30c`): 8/8 tamamlandı, 6 geçti, 2 düştü (E1 güven .8 kaynak 0/0 · E7 güven .95). Kök neden + plan `docs/EVAL-BULGULARI-2026-09-09-kok-neden-ve-duzeltme-plani.md`; P1–P5 politika değişiklikleri AYRI ONAYDA, uygulanmadı. Orijinal rapor dosyası repoda YOK (kurucudan bekleniyor).** Harness (bu ortamda `OPENAI_API_KEY` YOK): `evals/qr-kb-coverage.json`
  (sürümlü, 8 senaryo, anonim) + `tests/eval/`. 🚨 **AYRI YAPILANDIRMA ŞART — `npm run eval`**
  (`vitest.eval.config.ts`). Codex bulgusu (09-08): `npx vitest run tests/eval` YANLIŞTI, çünkü
  `vitest.config.ts` `env.OPENAI_API_KEY: ""` ile anahtarı ZORLA BOŞALTIR (normal suite için DOĞRU ve
  KORUNAN kapı) → eval o config'le sessizce ATLANIR ve "skipped" ile başarılı görünür; ayrıca
  `globalSetup` Linux PG ister, Windows'ta hiç başlamaz. Eval config: globalSetup YOK, `OPENAI_API_KEY`
  SET EDİLMEZ. İki config'in doğru davranışı config NESNELERİ okunarak pinli (metin taraması DEĞİL —
  ilk hâli kendi yorumuna takıldı). İKİ KAPI: `RUN_REAL_EVAL=1` VE gerçek anahtar; yoksa ATLANIR.
  🚨 **EKSİK KOŞU "GEÇTİ" DİYE OKUNAMAZ:** rapor BEKLENEN/TAMAMLANAN/GEÇTİ/DÜŞEN/GEÇERSİZ/KAYIT YOK
  sayılarını AYRI verir; geçersiz (fallback) ya da kayıt bırakmayan (timeout) senaryo varsa başlıkta
  koşu EKSİK damgalanır. Sınıflandırma saf fonksiyonda (`rowFor`/`errorRow`) → gerçek çağrı olmadan
  test edilebilir. LLM grader YOK. Çalıştırma: `docs/EVAL-CALISTIRMA.md`.
- **SELAM TEKRARI DÜZELTİLDİ (canlı kusur, kurucu/Codex 09-08):** asistan hemen sonraki cevapta yeniden
  "Merhaba" diyordu. Kök neden modelin hatası DEĞİLDİ: (a) `TONE_GUIDANCE.warm` KOŞULSUZ "misafiri
  adıyla selamla" diyordu, (b) "daha önce cevap verdin mi" bilgisi istemde HİÇ YOKTU — geçmiş
  giriyordu ama modelden bunu çıkarmasını beklemek tam da başarısız olan şeydi. Çözüm CLAUDE.md'nin
  kendi gereksinimi: `conversationState.isFirstOperatorReply` **KODDA** hesaplanır, modele AÇIK CÜMLE
  olarak söylenir. 🚨 Sayım bağlam PENCERESİNE değil KONUŞMANIN TAMAMINA bakar (pencere bir gösterim
  tavanıdır); sistem olayı ve gövdesiz satır cevap sayılmaz. Alan verilmezse istem hiçbir kısıt yazmaz
  (uydurma kural yok). QR + oto-yanıt yollarının İKİSİ de bağlandı (aynı istemi paylaşıyorlar).
- **DEĞERLENDİRME (Codex/kurucu 09-08):** host metninden alan önerisi (taslak, çelişkide
  host seçer; yer tutucu `{isim}` gerçeğe DÖNÜŞMEZ) · eksikleri GERÇEK sorulardan bulma (V1 `Signal` verisi
  zaten akıyor; kategori ↔ KB eşlemesi + tekilleştirme + bildirim yağmuru yok) · yapılandırılmış alan ↔
  retrieval ayrımı (çift kopya yasak; vektör GEREKLİLİK ölçülmeden eklenmez) · yetki filtresi retrieval'dan
  ÖNCE ve sır elemesi GEVŞETİLMEZ. 🚨 **A2 düzeltmesi:** `usedSources` TEK BAŞINA "bilgi yok" ile "retrieval
  başarısız"ı AYIRMAZ (modelin beyanıdır; hiç kalem verilmemiş de olabilir) → kodun bildiği ile beyan
  edilen YAN YANA kaydedilir (A2 ile UYGULANDI).
  Sıra ve gerekçeler: `docs/DEGERLENDIRME-2026-09-08-bilgi-tabani-doldurma-ve-retrieval.md`.
- **DEĞERLENDİRME (kurucu fikri 09-11, UYGULANMADI): geçmiş host cevaplarının yeniden kullanımı** —
  bugün host'un daha önce verdiği cevaplar HİÇBİR yerde bilgi kaynağı değil (host aynı soruyu 40 kez
  elle cevaplasa ürün bundan bir şey öğrenmiyor). 🚨 Bu "embedding" ile AYNI ŞEY DEĞİL ve embedding
  ŞART DEĞİL: `src/lib/ai/retrieval/` girdisi `{id,title,content,updatedAt}` listesidir, geçmiş cevap
  tam o biçime sokulabilir (ücretsiz, KVKK'sız, mevcut kod). Üç ZORUNLU kural: ① geçmiş cevap GERÇEK
  değil GÖZLEMDİR (canlı alanla çelişiyorsa DÜŞER; belki canlı gerçek iddia edemez) · ② yanlış cevabın
  ÇOĞALMASI (yalnız host'un yazdığı/onayladığı, devir/şikâyetle sonuçlanmamış cevaplar — A1'in
  `reviewState` sözleşmesinin aynısı) · ③ KVKK (sır kapısı + ad redaksiyonu + retention purge + erasure
  bu yüzeye de uygulanır). Ölçüm planı ve karar tablosu:
  `docs/DEGERLENDIRME-2026-09-11-gecmis-cevap-yeniden-kullanimi.md`. Sıra: hibrit bayrağından SONRA.
- 🚨 **İKİ BACAK AYNI KARTTA TAŞINMAZ (09-11, inceleme ajanı yakaladı — BENİM HATAM).** Bacak B'nin kartını
  kaldırırken, İÇİNDE yaşayan **şablon bacağı da ölü koda döndü**: `fromTemplates`ın tek tüketicisi o karttı,
  yani kurucunun açıkça istediği özellik ("şablondan bilgilerden veri alsın") AYNI PUSH içinde erişilemez
  oldu ve commit mesajı bunu söylemedi. Ayrı bileşen: `kb-template-suggestions.tsx` (çalışan bacak, CANLI) ↔
  `kb-past-answers.tsx` (tehlikeli bacak, KAPALI). Kartın çizildiği test-pinli — bir daha sessizce ölemez.
  **Ders: bir kartı kaldırırken içindeki HER bacağın tüketicisini say.**
- 🚨 **ÖZGÜLLÜK SIRASI (aynı inceleme):** org geneli şablon ÖNCE işlenirse tüm mülklerin yuvasını kapatır ve
  MÜLKE ÖZEL şablon bir daha önerilemez. ÖLÇÜLDÜ: org geneli "Wi-Fi bilgisini ev sahibinizden isteyiniz" +
  Daire'ye özel "Ağ: …, şifre 8821" → host'a GENEL metin gösteriliyordu. Sıralama artık `propertyId` önce,
  dil sonra. `Array.sort` kararlılığı ES2019'dan beri spec — çağıranın `createdAt` sırası korunur.
- 🚨 **`{{…}}` TEK KAYNAK + FAIL-CLOSED (aynı inceleme):** kalıp İKİ yerde AYRI yazılmıştı (`kb-from-templates`
  iç boşluğu kabul, `template-apply` etmiyor) → aynı metin bir yüzeyde çözülüp ötekinde SİLİNİYORDU. Tek sabit
  `TEMPLATE_VAR_SOURCE` (`template-apply.ts`). Ayrıca `\w` **ASCII**'dir: `{{misafirAdı}}` · `{{property.name}}`
  · `{{guest-name}}` hiçbir kapıya takılmıyordu, yani "başka her `{{…}}` reddedilir" kuralı tam da tanımadığı
  biçimlerde **FAIL-OPEN**'dı → `ANY_DOUBLE_BRACE` süpürgesi eklendi.
- 🚨 **TEMİZLİK HOST'UN METNİNİ YUTUYORDU (aynı inceleme, pre-existing):** `template-apply`in
  `LEFTOVER_DOUBLE` kalıbı `\{\{[^}]+\}\}` idi ve misafir kontrolündeki değerin içinden başlayıp şablonun
  İLERİDEKİ `}}`sine kadar yutuyordu. ÖLÇÜLDÜ: görünen ad `Ali{{` + "Merhaba {{guestName}}, kapı kodu 1234.
  {{wifiInfo}}" + wifi kalemi yok → yazma alanında yalnız **"Merhaba Ali"**. Kalıp `TEMPLATE_VAR_SOURCE`e
  daraltıldı (yalnız DÜZGÜN yazılmış belirteci siler), iki yönlü pinli.
- ⚠️ **Zayıflayan pin ve YANLIŞ commit iddiası (aynı inceleme):** `mobile-grid-min-width`teki mesaj sütunu
  iddiası `hasClassSet(["min-w-0"], forbidden ["space-y-4"])` biçimine çevrilmişti; aynı dosyadaki ÜÇÜNCÜ bir
  öznitelik (`min-w-0 flex-1`) iddiayı tatmin ediyordu → hedef sınıf silinse test YEŞİL kalırdı. Commit
  mesajındaki "kapsam düşmedi" o satır için YANLIŞTI. TAM öznitelik eşitliğine çevrildi.
- 🚨 **GEÇMİŞ HOST CEVAPLARI BACAĞI (Bacak B) — YÜZEYİ KAPATILDI (09-11) + VERİSİ DE KAPATILDI (09-18).**
  ⚠️ **09-11'de yalnız KART söküldü ve bu YETMEDİ** (↑Durum): rota bacağı koşulsuz hesaplayıp tarayıcıya
  göndermeye DEVAM ediyordu. Artık `KB_HISTORY_SUGGESTIONS_ENABLED` (varsayılan KAPALI) mesaj sorgusunu
  da durduruyor. `src/lib/kb-from-history.ts` + `api/kb/suggestions` duruyor, kart `kb-manager.tsx`ten SÖKÜLDÜ.
  Ürettiği çiftler YANLIŞTI ve yön TEHLİKELİYDİ: *"Otopark · örnek soru: do you have parking"* satırında
  gösterilen cevap bir **YORUM İSTEĞİ**, *"Konum · konum atabilir misiniz"* satırında ise **"müşteri
  hizmetlerine tam para iadesini kabul ettiğini söyleyin"**. Host "Bilgi tabanına ekle"ye bassa para iadesi
  talimatı `Konum` kategorisinde ONAYLI BİLGİ olur ve asistan misafire söylerdi. İKİ AYRI KUSUR:
  **(a) `precedingGuestMessage`in ZAMAN SINIRI YOK** — host'un çıkıştan GÜNLER sonra attığı proaktif mesaj
  (yorum isteği, karşılama) arada misafir mesajı olmadığı için günler önceki soruyla eşleşiyor;
  **(b) kart, kovayı İLK açan sorunun yanına EN YENİ cevabı basıyor**, yani gösterilen çift zaten gerçek
  bir çift DEĞİL. ⚠️ CLAUDE.md bunu ZATEN söylüyordu (*"`+1 ms` nedensellik kanıtı değildir … doğru çözüm
  `Message.replyToMessageId`"*) — uyarı okunup üstüne kurulmuş. **GERİ AÇMA ÖN KOŞULLARI:** ① soru↔cevap
  YAKINLIK penceresi + araya giren outbound yoksa şartı · ② gösterilen çift GERÇEK çift (en yeni cevabın
  KENDİ sorusu) · ③ PROAKTİF host mesajı tespiti (yorum isteği/karşılama cevap DEĞİLDİR) · ④ tercihen
  `Message.replyToMessageId` (migration). Ölçmeden geri açma.
- **A3 "Kurulum ve eksikler" ve A5 "Metinden bilgi çıkar" YÜZEYLERİ DE KALDIRILDI (kurucu, 09-11).**
  A3: 40 satırlık *"bu dairede bu konuda henüz kayıt yok"* listesi + "+32 konu daha" — kurucu iki kez söyledi
  (önce "ya kaldırılsın ya şablon gibi bağlamla kurulsun", sonra "kaldırıcaz mı, bok gibi"), karar KALDIR.
  A5: *"olmasa da olur, fazla işlevi yok"*. Üç modülün de kodu ve testleri YERİNDE; yüzey kapalı, geri açmak
  tek satır. `kb-gaps-panel.test.tsx` A4 entegrasyon bloğu, panelin yanlışlıkla geri MOUNT edilmesini
  yakalayan pine dönüştürüldü (anti-vakumluk: yönetim formunun hâlâ çizildiği ayrıca iddia edilir).
- **KNOWLEDGE HUB — ŞABLON BACAĞI (kurucu kararı 09-11, `src/lib/kb-from-templates.ts`, migration YOK).**
  Kurucu "AI'yı boş bilgiyle açtırma" KAPISINI REDDETTİ: *"zorunlu olmasın; adam platformunu bağladığında
  hemen otomatik mesajlarından, şablonundan veya kendi yazdığı cevaptan görsün"*. 🚨 Ölçülen boşluk:
  `MessageTemplate` misafire AYNEN gider ve MODELDEN HİÇ GEÇMEZ → host "Wi-Fi bilgisi" şablonu yazmışsa
  bilgi SİSTEMDE VAR ama asistan KULLANAMAZ. Bacak şablonu KB ÖNERİSİNE çevirir (salt-okuma; kabul mevcut
  `POST /api/kb` yolundan, `host_manual|approved`).
  🚨 **P1 (inceleme ajanı, kodla doğrulandı): `kbPlaceholderTokens` `{{…}}` sınıfını TANIMIYOR** —
  regex yalnız `[…]` / `<…>` / `___`. Düzeltilmeden önce bacak "Wi-Fi bilgileriniz: `{{wifiInfo}}`"
  metnini ONAYLI BİLGİ yapıyordu ve `{{wifiInfo}}` tam olarak KB'nin wifi kalemine İŞARETÇİ, yani üretilen
  kalem KENDİNE atıf yapıyordu. Kural: `{{guestName}}` → `{isim}` ÇEVRİLİR (ürünün dört yüzeyde de çözdüğü
  belirteç), BAŞKA HER `{{…}}` → şablon TAMAMEN REDDEDİLİR. Varsayılan 16 şablonun 16'sı `{{…}}` taşıyor →
  DB'ye seed edilse bile hiçbiri öneri olamaz (test-pinli, anti-vakumluk: allowlist kategorisindekiler ayrı
  ölçülür).
  🚨 **Kategori allowlist YALNIZ `wifi` + `rules`** — dışarıda kalanların ölçülmüş gerekçesi var:
  `complaint_response` (tek misafire verilen karar, bilgi değil) · `checkin`/`checkout` (saat MÜLK ALANIDIR
  → çift kopya + var olmayan çelişki, E7) · **`welcome`** (QR sır kapısının KATEGORİ bacağını zayıflatır:
  aynı metin `wifi`/`checkin`'de İKİ bacaktan elenir, `welcome`de yalnız içerik sezgiselinden) ·
  **`general`** (nezaket iskelesi + MAKBUZSUZ SÖZ — "en kısa sürede dönüş yapacağım" KB'ye girerse 09-09'da
  `prompts.ts`ten silinen sınıf arka kapıdan döner). Genişletme bir ÖLÇÜM sorusudur.
  Ayrıca: aynı mülk+kategoriye düşen İKİNCİ şablon önerilmez (TR/EN çifti; org dili kazanır) · "zaten dolu"
  hükmünü yalnız AI'nın OKUYABİLDİĞİ kalem verir (`KB_APPROVAL_GATE_WHERE`; onaysız taslak boşluğu kapatmış
  sayılmaz) · rota `?propertyId=` filtresini ŞABLON bacağında da uygular (org geneli hariç). Kanıt:
  kırmızı-önce + **mutasyon 20/20**.
- **ŞABLON DÜZENLEME (kurucu 09-11: "bunlar gözükmüyor düzenlenmiyr bile"):** `PATCH /api/templates/[id]`
  ZATEN VARDI, ekranda DÜĞME YOKTU (özel şablon yalnız silinip yeniden yazılabiliyordu). Eklendi: özel
  şablonda "Düzenle", varsayılanda **"Kendime uyarla"** (içerik forma dolar, kaydedince KENDİ şablonu olur;
  varsayılanlar koddaki sabitlerdir, düzenlenemez yalnız KOPYALANABİLİR), özel şablonu olmayan hostta
  varsayılanlar AÇIK başlar. 🚨 Rotanın kendi boşluğu da kapandı: şema `propertyId` alanını TANIMIYORDU,
  yani düzenleme formunun mülk seçimi SESSİZCE YUTULUYORDU. ⚠️ Create şemasındaki
  `.nullish().transform(v => v || null)` PATCH'e KOPYALANAMAZ — zod `undefined`'ı `null`'a çevirince anahtarı
  çıktıya KOYAR, yani yalnız `isActive` güncelleyen bir istek şablonu sessizce "Tüm mülkler"e taşırdı
  (regresyon kapanı test-pinli).
- **ŞABLON UYGULAMA TEK KAYNAK `src/lib/template-apply.ts` (saf; 09-11):** inbox'ın tek-parantez sınıfı
  YARIMDI — yalnız `{isim}`/`{ad}` çözülüyordu, `{name}`·`{daire}`·`{apartment}`·`{apt}` HİÇBİR yerde
  çözülmüyordu ve sondaki temizlik YALNIZ `{{…}}` sildiği için ham belirteç yazma alanına düşüyordu
  ("Kapı kodu: {daire}"). Ayrıca `{isim}` TAM ADA çözülüyordu ve adsız rezervasyonda "Merhaba
  Rezervasyon 12345," yazıyordu. Artık anahtar çözümü `kb-placeholders.ts`ten ödünç alınır (kural TEK
  YERDE), geçiş TEK kalır — ikinci bir geçiş misafir kontrolündeki `{{guestName}}` değerinden YENİ belirteç
  doğurabilirdi. `Object.hasOwn` kapısı: `{{constructor}}` prototip üyesine çözülüp yazma alanına
  "function Object…" basıyordu. Kırmızı-önce 6/6 (eski kod ölçüldü) + mutasyon.
- **PANEL YERLEŞİMİ (kurucu 09-11; İKİ TUR — ikincisi ölçümle):** `lg`de SAYFA KAYMAZ.
  🚨 **İLK ÇÖZÜMÜM KIRILGANDI ve kurucunun tarayıcısında ÇALIŞMADI:** dış kaba
  `h-[calc(100vh/0.95)] + overflow-hidden` vermiştim; BENİM Chromium'umda doğru ölçülüyordu.
  ⚠️ Sebep HÂLÂ HİPOTEZ (en olası: `zoom` × `vh` tarayıcı sürümüne bağlı) — elimdeki Chromium 141'de
  ESKİ kod da doğru ölçülüyor, yani arızayı ÜRETEMEDİM. Kararı haklı çıkaran şey sebep değil YÖNTEM:
  yeni yol `vh` aritmetiğine HİÇ dayanmaz. Dış kap `lg:fixed lg:inset-0` (zoomdan bağımsız tam
  viewport; `fixed` akıştan çıkınca `body`de kaydıracak içerik kalmaz) + `lg:overflow-hidden`
  emniyet kemeri. 🚨 **ASIL KUSUR BANDLARDI:** kart yüksekliği `calc(100vh/0.95 − 11rem)` sabitiydi
  ve ARADAKİ BANDLARI saymıyordu — ölçüldü: "Otomatik yanıt beklemede" tek başına `<main>`i 46 px,
  deneme bandıyla 109 px taşırıyor (yazma kutusunun altı katlanın altına iniyor) ve `11rem`in kendisi
  1rem fazlaydı. Sayı yerine YAPI: kabuk o yolda (`fillsViewport`, `/^\/inbox\/[^/]+$/`) dikey flex
  kurar → sayfadaki grid `lg:flex-1 lg:min-h-0` ile artanı alır → kart `lg:h-full` ile doldurur;
  yeni bir band eklense hesap bozulmaz. ÖLÇÜLDÜ (3 çözünürlük × bandsız/tek/iki band = 9 durum):
  `docScroll` 0, `mainOverflow` 0, composer daima katlanın üstünde; bandlar yalnız listeyi kısaltıyor.
  Composer 160→104px, AI satırı `p-4`→`px-4 py-2.5`, ton kutusu `h-9`→`h-8` (üçü de `h-8` olunca
  4px hizasızlık da kapandı). Şablon menüsü `lg`de YUKARI açılır (aşağı açılan ~92 px taşıyordu).
  🚨 **REGRESYON PİNİ EKLENDİ — YOKTU** (kurucunun İKİ KEZ bildirdiği kusurun testi yoktu, K2 ihlali):
  `fixed+inset-0`, doldurma kapsayıcısı, gridin artanı alması ve `100vh` aritmetiğinin GERİ GELMEMESİ
  pinli (`mobile-grid-min-width.test.ts`). Kenar çubuğu her zaman tam yükseklik; mobilde eski davranış
  AYNEN. Konuşma sayfası: misafir adı ve "mülk · kanal · giriş→çıkış" sayfa başlığından KARTIN BAŞLIK
  SATIRINA taşındı (ad durumun solunda, mülk önceliğin sağında), sağ ray sabit 20rem (yazma alanı geniş
  ekranda genişledi), mesaj listesi 44vh→52vh, yazma kutusu 80px→160px. **"Mülk" kartı KALDIRILDI**:
  adres çoğu hostta boş olduğu için kart pratikte tek satır (giriş/çıkış saati) gösteriyordu — o satır
  başlıkta, adres varsa aynı satırın `title` ipucunda (bilgi kaybı yok).
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

## 🚨 ÇALIŞMA BİÇİMİ DEĞİŞTİ (09-19): RAILWAY DURAKLATILDI, GELİŞTİRME LOCAL'DE
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

## Durum
**DIŞ DENETİM TURU (09-18, DÖRT paralel ölçümlü ajan) — hüküm belgesi
`docs/DENETIM-2026-09-18-dis-rapor-hukumleri.md`.** Kurucu dış bir rapor getirdi (10 bulgu; raporun
kendi notu: hedefli vitest grubu Windows'ta `spawn EPERM` ile koşmadı, yani **statik inceleme**).
🚨 **RAPOR KOPYALANMADI**: her bulgu kodda doğrulandı, **iki bulgunun ÖNERİSİ ölçümle REDDEDİLDİ**,
bir bulgunun ana iddiası **BAYAT** çıktı ve raporun GÖRMEDİĞİ iki kusur bulundu.
- 🚨 **"KARTI SÖKTÜM" VERİYİ DURDURMAMIŞTI (benim 09-11 kusurum, ajan ölçtü).** Geçmiş-cevap kartını
  `kb-manager.tsx`ten sökmüş ve buraya "yüzey kapatıldı" yazmıştım; **yalnız GÖSTERİM durmuştu**.
  Bugün CANLI olan `KbTemplateSuggestions` kartı AYNI `/api/kb/suggestions` rotasını çağırıyor, rota
  geçmiş bacağını **koşulsuz** hesaplıyor (3.000 satırlık mesaj sorgusu + sınıflandırma turu, `await`
  ile SERİ) ve `suggestions` dizisini gövdeye koyuyordu; istemci yalnız `fromTemplates` okuyup gerisini
  ATIYORDU. Yani şablon kartı ihtiyacı OLMAYAN bir bacağın tam maliyetini ödüyor, maskelenmemiş host
  cevapları + iç mesaj kimlikleri her taramada tele gidiyordu. **Ders: bir yüzeyi kapatırken RENDER'ı
  değil VERİNİN ÜRETİLDİĞİ YERİ kapat** (09-11'in "her bacağın tüketicisini say" dersinin TERS yönü).
  Kapı artık `KB_HISTORY_SUGGESTIONS_ENABLED` (**varsayılan KAPALI**): bayrak yokken mesaj sorgusu HİÇ
  koşmaz (davranışsal pin: `prisma.message.findMany` casusu) ve `scanned: null` döner (A2 deyimi:
  null = ÖLÇÜLMEDİ, 0 DEĞİL).
- ✅ **Bulgu 1 — EŞLEŞTİRME FAIL-CLOSED.** `Message.replyToMessageId` YOK, "bu cevap şu soruya verildi"
  bir ÇIKARIM. Üç ölçülmüş yanlış-eşleşme sınıfı, üçünde de bedel YANLIŞ KATEGORİDE ONAYLI BİLGİ:
  ① *araya giren farklı konu* — "Wi-Fi şifresi?" → "Otopark var mı?" → host "Şifre 12345678" ⇒ şifre
  **`parking`** kategorisine yazılıyordu → bekleyen misafir bloğu **TEK** bilgi kategorisi göstermeli,
  iki aday → olay DÜŞER (🚨 selamlama korunur: "Merhaba" hiçbir kategoriye eşlenmez) · ② *bölünmüş
  cevap* — host cevabı iki mesaja bölerse İKİ TEKRAR sayılıyor ve `minOccurrences=2` eşiği TEK OLAYLA
  geçiliyordu → peş peşe giden mesajlar TEK cevap (gövdeler birleşir) · ③ *proaktif mesaj* — zaman
  sınırı HİÇ YOKTU, 40 gün sonraki "değerlendirme bırakır mısınız?" günler önceki soruyla eşleşiyordu
  → `PAIR_MAX_GAP_MS` 12 saat. Ayrıca **gösterilen çift artık GERÇEK çift** (kova İLK soruyu saklayıp
  EN YENİ cevabı basıyordu) ve **`occurrences` KONUŞMA sayar**, mesaj değil.
- ✅ **Bulgu 2** `existingKb` geçmiş bacağına da verilir (eskiden yalnız şablon bacağına): host öneriyi
  ekleyip "Yeniden tara" deyince aynı öneri geri geliyor, ikinci kez eklenirse aynı mülk+kategoride
  ÇELİŞKİLİ iki aktif kalem oluşuyordu (retrieval çelişki koruması → misafire kesin cevap YOK).
- ✅ **Bulgu 3 — PII: SİLMİYORUZ, İŞARETLİYORUZ.** Ajan 25 gerçekçi host cevabı üretti: **20'sinde (%80)**
  gerçek PII/sır kalıyordu; `maskGuestName`in ÜÇ sessiz no-op dalı vardı (2 harfli ad → maskeleme KOMPLE
  kapalı · imlâ uyuşmazlığı · `guestName=null`). Artık tam ad + her parça maskelenir (tek başına kısa
  parça yine ikame EDİLMEZ — "Al bunu." bozulmasın) ve **`exampleQuestion` DA maskelenir** (rapor bunu
  görmedi: misafirin HAM metni host ekranına gidiyordu). 🚨 **Sır kapısını bu yola bağlamak ÖLÇÜLDÜ ve
  REDDEDİLDİ**: 25 metnin yalnız 5'ini yakalıyor (biri kazara alt dizi), üstelik REDAKTE ETMEZ öneriyi
  KOMPLE ELER — bu bacağın İŞİ "wifi şifresi X" cümlesini bilgiye çevirmek, sır silen filtre ürünün
  kendisini siler. Yerine `sensitiveClasses` (email·phone·iban·idNumber): içerik bozulmaz, uyarı
  KARARIN VERİLECEĞİ YERE konur (raporun kendi önerisi). ⚠️ Üçüncü kişilerin adları (komşu, görevli,
  ÖNCEKİ MİSAFİR) kapatılamaz — hiçbir katman bilmiyor, bilinen sınır.
- ✅ **Bulgu 4 — MİSAFİR SOHBETİ: CURSOR DEĞİL PENCERE.** `GET /api/chat/[token]` mesajları `take`
  OLMADAN çekiyordu ve istemci 5 sn'de bir çağırıyor. 🚨 **Raporun kaçırdığı asıl maliyet bant genişliği
  DEĞİL SUNUCU**: poll başına ~6 DB turu, **biri YAZMA** (hız-limiti UPSERT) → açık sohbet başına
  dakikada ~72 sorgu / 12 yazma. `GUEST_CHAT_MESSAGE_WINDOW` 200 + TAM SIRA. **Cursor ölçülerek
  reddedildi**: istemci listeyi toptan değiştiriyor (pencere tek başına yeter) · `createdAt` üzerinde
  cursor GÜVENSİZ (QR misafir/bot satırları eşit damgalı olabilir, cursor satır ATLAR) · doğru desen
  host tarafındaki `guest-chats/[id]`de ZATEN yazılı. Üç istemci kusuru daha ölçüldü: **görünürlük
  kapısı YOKTU** (ürünün kendi standardı `inbox/auto-refresh.tsx`te var) · **terminal durumda
  DURMUYORDU** (interval yalnız unmount'ta temizleniyor → konaklama bittikten günler sonra bile poll) ·
  **429 SESSİZCE YUTULUYORDU** (GET kotası 60/dk/IP, sohbet 12/dk → aynı IP'de beş cihaz tavanı
  doldurunca altıncısının sohbeti açıklamasız DONUYORDU). ⚠️ Aynı sınıf `inbox/[id]/page.tsx`te de var
  (host yüzeyi, 30 sn + görünürlük kapısı bedeli düşürüyor) — ayrı iş.
- ✅ **Bulgu 9** `capped` artık kesin (`take: CAP + 1`; eski `>= CAP` fiilen `=== CAP` idi, TAM 3.000
  satırı olup devamı OLMAYAN org "kesildi" görünüyordu) · ✅ **Bulgu 10** `sourceMessageIds` ve
  `lastAnsweredAt` gövdeden çıktı (hiçbir yüzey okumuyordu; spread yerine AÇIK ALAN LİSTESİ, yeni alan
  sessizce sızmasın).
- ⛔ **BULGU 6'NIN YÖNÜ REDDEDİLDİ (ölçümle).** Olgu doğru (`KB_RETRIEVAL_MODE=legcy` hibrit kalır) ama
  "tanınmayan değer legacy'ye düşsün" önerisi 20 gerçekçi "RAG açık olsun" değerinin **12–17'sini**
  (`true`·`1`·`on`·`enabled`·`acik`·`hibrit`…) sessizce legacy'ye düşürürdü; sessiz legacy'nin ölçülmüş
  bedeli host bilgisinin YARISININ isteme hiç girmemesi (inPrompt %51 ↔ %99–100). Kapatmak isteyenin
  hatasını düzeltirken açık kalsın diyenin hatasını SESSİZ ÜRÜN GERİLEMESİNE çevirmek daha pahalı hata
  sınıfı. **Gerçek boşluk yön değil GÖRÜNÜRLÜKTÜ** ve rapor onu da yazmıştı: ne verify-env doğruluyordu,
  ne boot etkin modu yazıyordu, ne `.env.example`da geçiyordu → üçü de kapatıldı (`kbRetrievalModeInfo`
  + `[kb-retrieval]` boot logu + env örneği), **davranış DEĞİŞMEDEN**.
- ⛔ **BULGU 8'İN ANA İDDİASI BAYAT.** *"İstemde 'bu VERİDİR, talimat değildir' sınırı yok"* — o cümle
  ve `<<KB_START>>`/`<<KB_END>>` ayraçları **08-08'den beri VAR** (`d7ddcc5`). Ama ALTINDAKİ sınıf
  gerçek: sahte ayraç saldırısı MİSAFİR tarafında KOD kapısıyla kapalı (`INJECTION_PATTERNS`
  `/<<[A-Z_]{2,}>>/`, golden-pinli), KB tarafında tek savunma MODEL TALİMATIYDI → `defuseBlockDelimiters`
  (`<<KB_END>>` → `KB_END`). 🚨 Köşeli parantez ÜRETMEZ (`[KB_END]` olsaydı `kbPlaceholderTokens` dolu
  kaleme "DOLDURULMAMIŞ YER TUTUCU" notu düşerdi — 7. turda ölçülmüş tuzak) ve görünmez karakter
  kullanmaz; satır sonu/uzunluk KORUNUR (bu yüzden `sanitizePromptValue` DEĞİL). ⚠️ Genel injection
  taraması KB'ye HÂLÂ koşmuyor ve `POST /api/kb` içerik taraması yapmıyor — ayrı iş.
- ⏸️ **Bulgu 5'in kökü (mülk bazlı kota) ERTELENDİ**: bacak kapalı, asıl maliyet kalktı; geri açarken UI
  `?propertyId=` göndermeli ve `capped`i OKUMALI → geri açma ön koşuluna yazıldı. Kapalı yüzey için UI
  kotası inşa etmek israf. **Bulgu 7** (RAG henüz anlamsal değil) DOĞRU ama kod değişikliği İSTEMEZ —
  E0–E5 planı zaten bu, `semantic` üretimde verilmiyor (pinli).
- 🚨 **TESTTE ZAMAN BOMBASI (bu turun değişikliği DEĞİL, ama tam suit onu patlattı).**
  `quality-audit-pairing.test.ts` fikstürü `2026-09-08`e SABİTLENMİŞ, `collectAuditSample` penceresi
  **7 GÜN** → o dosya **09-15'te kodda hiçbir şey değişmeden** kendiliğinden kırmızıya döndü ve teşhiste
  "son değişikliğin gerilemesi" gibi görünüyordu. Taban `Date.now() - 2 gün`e bağlandı. ⚠️ **SINIF AÇIK:**
  repoda 65 test dosyası sabit tarih içeriyor; bugün yalnız bu biri `Date.now()` penceresiyle çakışıyor
  ama kural mekanik olarak PİNLİ DEĞİL (ayrı iş).
- **Kanıt:** kırmızı-önce 8+3+1+3 blok (eski kodla ölçüldü, `cp`-yedek harness'ı) · **mutasyon 20/20** ·
  `npm test` **4915/413** · tsc 0 · lint 0 · build temiz · audit yeşil. ⚠️ M16 ilk turda ÖLÇÜLMEDİ (çapa
  iki yerde, harness "eşsiz değil" deyip atladı — hayatta kalan DEĞİL); replace-all ile ayrıca koşuldu.
  🚨 **NEXT.JS ROTA EXPORT DERSİ YİNE YAŞANDI:** `route.ts`ten yalnız bilinen rota alanları export
  edilebilir; `GUEST_CHAT_MESSAGE_WINDOW` ve bayrak sabitini rotaya koyunca `tsc` patladı. Ders repoda
  ZATEN yazılıydı (`chat/[token]/route.ts` yorumu) — sabitler baştan yaprak modülde durmalı
  (`src/lib/kb-suggestions-flag.ts`, `src/lib/guest-chat.ts`).

**Önceki: CODEX DENETİM TURU (09-12, SEKİZ ölçümlü ajan) — hüküm belgesi `docs/DENETIM-2026-09-12-codex-ai-raporu.md`.**
Kurucu dış bir denetim raporu getirdi (21 bulgu + 10 maddelik yol haritası) ve "dediklerine başla ve bitir"
dedi. 🚨 **RAPOR KOPYALANMADI, HER BULGU KODDA DOĞRULANDI** — rapor 09-11 12:05 UTC'ye bakıyor, araya
commit girdi (ölçüldü: 23): **bulgu 13 (RAG varsayılan kapalı) BAYAT** (aynı gün 19:29'da ters çevrilmişti), **bulgu 16'nın
ana iddiası BAYAT** (`a1c274d` kapatmıştı), **bulgu 11'in "~75 KB"ı YANLIŞ** (gerçek 46.135 karakter).
Çelişkide o belge kazanır.
- **Migration 55 PUSH EDİLDİ** (`6211bfa`, kurucu pg_dump SHA'sı + açık onay; CI #1074 success) —
  ⚠️ **PROD DAMGASI HENÜZ YOK**: kardeş migration'larda ("52 prod'da 09-08 06:11Z") olduğu gibi bir
  salt-okuma doğrulaması yapılmadı, dolayısıyla "CANLI" DENMİYOR. Boot `prisma migrate deploy` uygular;
  damga kurucunun doğrulamasıyla yazılacak. İçeriği: oto-yanıt aktif saat varsayılanı
  **0/9 → 0/0**. Ölçülen kusur: `hour >= 0 && hour < 9` yani AI günün yalnız 9 saatinde çalışıyor, **15
  saatinde SUSUYOR** ve susan 15 saat misafir trafiğinin tamamına yakını. Backfill DAR (yalnız eski şema
  varsayılanı 0/9); host'un bilinçli seçtiği her pencere DOKUNULMADAN kalır. Geri alma tam ters çevrilebilir
  DEĞİL, bedel migration başlığında yazılı ve test-pinli. ⚠️ Kurucu SQL'i PowerShell'e yapıştırıp hata aldı —
  **elle çalıştırmaya gerek YOK**, boot `prisma migrate deploy` uyguluyor.
- ✅ **Bulgu 17 — "AI'yı Deneyin" kartı ÜRETİMİ YANLIŞ TEMSİL EDİYORDU** (`de2f782`). `api/ai/test/route.ts`
  daire numarasını adın SON SAYISINDAN alıyordu; ortak modül bu kuralı 09-11'de ölçerek terk etmişti.
  **7 ilan adının 7'si ayrışıyordu** — `No:12 D:5 Kat:3` → "3" (KAT), `DAİRE 5 - 2 Yatak Odalı` → "2"
  (YATAK), `Cozy Seaside Flat` → MÜLK ADININ TAMAMI. Ayrıca `{İSİM}` çözülmüyor, BAŞLIK işlenmiyordu.
  Bedeli sinsi: kart DAYANAKSIZ bir kalite onayı üretiyordu. Davranış PİNSİZDİ.
- ✅ **Kurucu bildirimi — "QR sohbeti Mesajlar sekmesinde açılıyor"** (`de2f782`). Kusur liste sayfasında
  DEĞİL, **panelin "Dikkat Gerektirenler" kartındaydı**: sorgu `channel` alanını SEÇMİYORDU, href SABİT
  `/inbox/${id}` idi. Kozmetik değil — "AI yanıtlarını yeniden başlat", "siz yazarsanız AI susar" uyarısı ve
  Enter=gönder YALNIZ `/guest-chats/[id]`de var; host AI'ı geri açamadığı bir ekranda açıyordu.
- ✅ **§D P1 — QR displacement açığı** (`1f23e2c`, ↑ayrıntı). Rapor bunu GÖRMEDİ; ölçüm ajanı buldu.
- ✅ **§A ÇIKTI VETOSU CANLI** (`src/lib/ai/output-veto.ts`, saf/DB'siz; iki kapıda da).
  İki gerekçe: `placeholder_in_reply` (doldurulmamış alan cevabın İÇİNDE — 4. gerçek koşunun
  E4 metni artık DURUYOR) · `unverified_commitment` (ETKEN makbuzsuz iddia). Üç karakterizasyon
  testi DÜRÜSTÇE TERSİNE ÇEVRİLDİ (eski davranış yorumda AYNEN yazılı, sessiz gevşetme yok).
  🚨 **İLK BAĞLAMA FAZLA GENİŞTİ ve SUIT YAKALADI (3 kırmızı):** `human_request` devir akışında
  modelin cevabı "Talebinizi ev sahibimize ilettim…" diyor; veto onu durdurunca TASARLANMIŞ devir
  akışı SESSİZCE ÖLÜYORDU (`out.sent` false, hold hiç kurulmuyor, misafir hiçbir şey almıyor,
  host devir sinyalini kaybediyor). Muafiyet `intent === "human_request"` (kapının kendi belgelenmiş
  "TEK MUAFİYET" sözleşmesi; `isHandoffAck` ise ayrıca `riskType` ister = FAZLA DAR).
  ⚠️ **BEDEL AÇIK ve bu turda KAPATILMADI:** devir yolunda "ilettim" misafire GİTMEYE DEVAM EDİYOR
  → §B'nin işi, METNİ düzelterek çözülür. ⚠️ **UYDURMA EKSENİ de AÇIK:** "Otopark bina altında ve
  ücretsizdir" makbuzsuz SÖZ değil, kaynaksız somut İDDİA — o ayrı kapı (test-pinli).
- 🚨 **ÇIKTI VETOSU: ölçülen tasarım (uygulandı).** `tests/helpers/claim-detectors.ts` "P5 onaylanırsa ürün
  koduna taşınır" diyor; bağlamadan ÖNCE batarya koşuldu: **77 meşru cevapta 9 yanlış pozitif**, genişletilmiş
  tuzakta 20'nin 19'u. Kök neden Türkçe EDİLGEN ÇATI yüzeyde ayrışmıyor — *"Gürültü şikâyetleri site
  yönetimine bildirilir"* (MEŞRU SSS) ile *"Konu apartman yönetimine bildirilmiştir"* (makbuzsuz iddia)
  BİREBİR AYNI şablon. Ölçülmüş karar: ① lookahead genişletmesi BEDELSİZ (−2 FP, 0 kayıp) ② kapıya YALNIZ
  ETKEN dallar → **0 yanlış pozitif**; edilgen dallar ÖLÇÜMDE kalır. "Muhatap çapası" varyantı ölçülüp
  REDDEDİLDİ (iyelik eki gövdenin son harfine göre değişiyor = kural değil kaza). İngilizce kapsam SIFIR →
  ayrı tur (test-pinli: KUSUR pini değil KARARIN pini).
- ⛔ **Bulgu 14'ün ÖNERİSİ REDDEDİLDİ** ("eşleşme yoksa boş dön"): ru/ar/de sorguların TAMAMI
  `no_lexical_hits`e düşüyor ve bugün fail-open sayesinde doğru cevabı alıyorlar; öneri uygulansaydı bilgi
  YAZILI olduğu hâlde her yabancı misafir insana devredilirdi. Maruziyetin büyük kısmı zaten `cappedForFallback`
  ile rapordan 53 dk ÖNCE kapanmıştı. Gerçek model verisi (R6) ilgisiz kalemlerin modeli uydurmaya İTMEDİĞİNİ
  gösteriyor (iki modda da güven 0.35 → devir).
- ✅ **§B MAKBUZSUZ İDDİA KAPANDI** (`aa2a0e4`). İki yüzey, tek kusur. **(a) `HOLDING_ACK_TEXTS` altı dilde
  yeniden yazıldı:** eski metin hem "ilettim / I've passed / Ich habe … weitergeleitet" (AI'ın KENDİ eylem
  iddiası, `actionReceipt` hiç uygulanmadı) hem "en kısa sürede sizinle ilgilenecek / will follow up shortly"
  (ÜÇÜNCÜ ŞAHSIN gelecek eylemi) diyordu; üstelik model yolunda escalation e-postası `if (to)` bloğunun
  İÇİNDE, `maybeSendHoldingAck` DIŞINDA → alıcısız/bozuk e-postalı org'da host'a hiçbir şey gitmezken misafir
  o cümleyi okuyordu. 🚨 **Çağrı anında GARANTİ olan tek şey fonksiyonun kendi ön koşuludur**: çağıran
  konuşmayı ATOMİK olarak `problem`e claim ETMİŞ olmak zorunda — yani mesaj kayıtlı ve konuşma panelde
  öncelikli işaretli; bu e-postadan da modelden de bağımsız SERT bir olgu. Metin artık yalnız onu söylüyor
  (`escalationReply()` + `prompts.ts` çapasıyla aynı sınıf); özür + fotoğraf/ayrıntı isteği KORUNDU —
  dürüstleştirme mesajı işe yaramaz hâle getirmenin bahanesi değil. Yapısal: `HOLDING_ACK_LANGS` +
  `holdingAckText()` dışa açıldı, çünkü bu metinler **çıktı vetosundan GEÇMEZ** (veto yalnız MODELİN ürettiği
  metin içindir; tasarlanmış devir akışının kendi sabitine kapanamaz) → dürüstlük KAYNAĞINDA, kaynak taraması
  değil DAVRANIŞSAL pinle (`tests/unit/holding-ack-honesty.test.ts`). **(b) 🚨 DÖRT İNGİLİZCE FEW-SHOT ÖRNEĞİ
  ÖLÇÜLDÜ ve düzeltildi** — bir PİN BOŞLUĞUNUN sonucuydu: few-shot dürüstlük pini TR-only `unverifiedActionClaims`
  ile koşuyordu, oysa örneklerin bir kısmı İNGİLİZCE `reply` taşıyor, yani o satırlar fiilen HİÇ TARANMIYORDU.
  Üretim vetosu (`vetoOutgoingReply`, 09-12'de EN kapsamı açıldı) pine bağlanınca dördü de düştü:
  `early_checkin` "I've asked our team … I'll confirm" · `complaint` "I've flagged it to our team and we'll
  check it" · `checkin` "I've alerted our team to contact you right now" · `general` "I've passed this on, and
  our team will get back to you shortly" (sonuncusu kurucunun ADIYLA andığı cümle). **Kozmetik DEĞİL:** veto
  09-12'den beri CANLI → istem modele tam olarak ürünün BLOKLAYACAĞI cümleyi öğretiyordu, yani model onu
  üretir, kapı durdurur, misafir HİÇBİR ŞEY almaz. Etiketler (intent/riskLevel/riskType) DEĞİŞMEDİ (pinli).
  İki anti-vakumluk satırı eklendi (her iki dedektörün de gerçekten ateşlediği ayrıca iddia edilir).
  🚨 **Denetim ALTI ihlalci saymıştı; veto DÖRDÜNÜ görüyor** — kalan ikisi vetonun YAPISAL sınırında ve
  kaynağında (istemde) düzeltildi + regresyon pinli: ÖRNEK 11 (TR) "ekibimiz anında devreye girecek" —
  `devreye gir-` fiili vetoya **EKLENMEDİ** çünkü MEŞRU tesis cümlesi üretir ("Sigorta devreye girer",
  "Klima otomatik devreye giriyor"); aynı dilbilgisi hem vaadi hem olguyu taşıyor = §A'nın EDİLGEN ÇATI
  dersinin birebir aynısı. ÖRNEK 9 (AR) — vetonun **Arapça kapsamı YOK** (DE/FR/RU/AR hepsi dışarıda, ayrı
  ölçüm turu). Bu ikisi için doğru yer istemin kendisidir: modele öğretmezsek üretmesini beklemek için sebep
  de kalmaz. ⚠️ O iki pin METİN TARAMASIDIR ve bu bilerek kabul edildi (davranışsal pin ancak kapı
  genişletilirse mümkün, o da ayrı onay); anti-vakumluk olarak iki örneğin HÂLÂ yerinde olduğu da iddia edilir.
  Kanıt: kırmızı-önce 4+1 blok · **mutasyon 17/17** (altı dil geri alma · fotoğraf isteğini sil · dilleri tek
  metne çökert · fallback en→tr · dil listesinden düşür · altı few-shot geri alma · vetoyu hep-null yap).
- ✅ **§C TEMELLENDİRME KAPANDI** (`4c6bccc`+). Denetim "pack `omitted` atılıyor" demişti; ölçüm **daha
  büyük bir yalan** buldu. 🚨 **(1) GERİ ÇEKİLME KIRPMASI HİÇ SAYILMIYORDU:** hibritte `kb-fetch` 200 kalem
  çeker, sözcüksel isabet yoksa seçici "hepsini gönder"e düşer ve `cappedForFallback` 30'a indirir — ama
  `legacyResult` `droppedItems: 0` **SABİTLİYORDU**. 170 kalem isteme girmiyor, karar kaydı "hiç kalem
  düşmedi" diyor. Bedeli kozmetik DEĞİL: sayı `classifyGrounding`e gidiyor ve `dropped === 0` dalı etiketi
  **`ungrounded`** ("kalem vardı, model kullanmadı") yapıyordu; gerçek **`capacity`**. `select.ts`in kendi
  yorumu bu dalın kısa mesajların **%72'sinde** çalıştığını yazıyor. Kırpmanın KENDİSİ doğru ve DEĞİŞMEDİ
  (09-11 kararı); kırpma ile sayaç artık TEK YERDE (`cappedForFallback` → `{items, dropped}`) — ayrı yerde
  hesaplanmaları bu hatanın kendi sınıfıydı. **(2) PACK BÜTÇESİ:** `buildReplyUserPrompt`
  `packKnowledgeBase(...).text` alıp `omitted`ı atıyordu → istem modele "N kalem alınamadı" derken kayıt
  daha küçük sayı söylüyordu. İmza DEĞİŞTİRİLMEDİ (üretimde 1 çağıran ama testlerde 9 dosya/~40 çağrı
  `string` bekliyor, ölçüldü): yeni `buildReplyPrompt(input) → {text, kbOmitted}`, `buildReplyUserPrompt`
  onun ince `.text` sarmalayıcısı (iki yol AYRIŞAMAZ, pinli). Sayı `SuggestReplyResult.kbOmittedInPrompt`
  ile taşınır (`sourceAudit` deyimi: opsiyonel = ÖLÇÜLMEDİ, 0 DEĞİL). 🚨 **ÇİFT SAYIM TUZAĞI:**
  `packKnowledgeBase` `alreadyDropped`ı kendi düşüşüne EKLEYEREK döndürür → yüzeyin sayısına eklemek iki kez
  saymak olurdu; `applyPromptKbAudit` **DEĞİŞTİRİR** ve `kbRetrieved`i de düzeltir. **(3) ÖLÇÜLÜP REDDEDİLDİ:**
  `supersededById` düşüşü `droppedItems`e GİRMEZ — halefi kümede, bilgi modele gider; "düştü" demek "bilgi
  ulaşmadı" demek olurdu (kanıtta zaten `sup`). **(4) KALİTE DENETÇİSİ** artık `Message.aiSourcesJson`
  görüyor (kolon AYNI SATIRDA, ek sorgu yok). 🚨 `null` ≠ "kaynak yok": kolon yalnız kanal oto-yanıtında
  dolu, QR ve host-onaylı satırlarda DAİMA null → denetçiye bu AÇIKÇA söylenir (09-08'de `guest: null`ın
  "proaktif" diye okunup ürünü haksız suçlaması aynı sınıftı); `parseAiSources` fail-safe null + yalnız
  STRING öğe (dış modele serbest metin sızamaz). **(5) İKİ BAYAT YORUM** düzeltildi: `automation.ts`
  "sayaçlar modelin gördüğü bağlamla tutarlı" DİYORDU (ölçülerek yanlış); `grounding.ts`in "ÜST SINIR"
  uyarısı **LİSTE için hâlâ geçerli, SAYAÇ için artık değil** — ikisi ayrıştı ve yazıldı.
  ⚠️ Gönderim kararı DEĞİŞMEDİ; bu tur yalnız KARAR KAYDINI düzeltir. Kanıt: kırmızı-önce 3+10+5 blok ·
  **mutasyon 17/17** (ilk turda 2 hayatta kaldı ve İKİSİ de gerçek pin eksiğiydi: `cappedForFallback`
  tavan-altı hiç sınanmıyordu [10 kalemlik fikstür `small_kb` dalına düşüyor], ve `suggestReply`ın alanı
  taşıdığı hiç sınanmıyordu = **YÜKLEM VAR, ARGÜMAN YOK** — QR `history_injection` turunun aynı sınıfı).
- ✅ **§E BÜTÇE KAPANDI (09-12) — DENETİM RAPORUNUN KENDİ §E'sinde YANLIŞ YÜZEY VARDI.**
  🚨 "12 çağrı = 1 birim" olan yüzey **Ayarlar "AI'yı Deneyin" DEĞİL**, **Inbox "Oto-yanıt testi
  (önizleme)"** düğmesidir (`api/hospitable/auto-reply-test` → `previewChannelAutoReplies` `limit = 12`).
  Ayarlar kartı (`api/ai/test`) kod yolu izlenince **1 çağrı / 1 birim** ve ekranı da bunu yazıyor. Yanlış
  yüzeye bakan bir düzeltme doğru olanı bozardı. **12:1 takası DEĞİŞTİRİLMEDİ** — rota gerekçesini kendi
  yorumunda ilan ediyor ve oranı değiştirmek FİYATLANDIRMA kararıdır (kurucunun).
  **Düzeltilen (LATENT):** `consumeDailyAiBudgetForQr` her iki ret dalında `cap: qrCeiling` dönüyordu →
  ORTAK tavan dolduğunda bile "planınız günde 45" derdi; artık DOLAN kovanın tavanı döner. ⚠️ **Bugün
  CANLI kusur DEĞİLDİ** — QR rotası `dailyBudgetMessage`i hiç çağırmıyor; ölçüm ajanının "müşteriye
  gösterilen tavan uyuşmuyor" iddiası kodda YANLIŞ çıktı ve dürüstleştirildi.
  **Yazılan gerekçeler** (hepsi "asimetri var, sebebi yazılı değil" sınıfıydı): `summarizeHostStyle`
  0 birim (arka plan, org başına 24 saatte ≤1, basan kullanıcı yok; kotadan düşseydi host'un GÖRDÜĞÜ hakkı
  görünmez bir iş yerdi — ⚠️ gerekçe BUGÜN yazıldı, "hep böyleydi" diye okunmaz) · QR "önce tüket" (cron
  `peek` kullanır çünkü fallback bedavayken birim yakıyordu; QR kimliksiz/halka açık olduğu için
  "önce bak sonra tüket" penceresi suistimal penceresidir — bedeli yazılı: sağlayıcı düşünce 2 birim yanar).
  **DOKUNULMAYAN:** `.catch(() => {})` ile yutulan tüketim — `daily-budget.ts` "KULLANIM kapılarında
  fail-open" diyor, tutarlı. Kanıt: kırmızı-önce 1 blok + tam kapılar.
- ✅ **BAĞLAMSAL PARÇA METNİ (kurucu iş emri 09-12, madde 1)** — `src/lib/ai/embeddings/context-text.ts`,
  saf, **üretimde çağıranı YOK** (E3'te bağlanır, o da E2 onayına bağlı). Ölçülmüş gerekçe: sözcüksel
  tarafta sorun YOK (rerank başlık kökünü zaten 0.15 ile ödüllendiriyor, başlık ayrı alanda) ama
  **embedding yalnız verilen METNİ görür** → uzun rehberin ORTA parçası başlığı olmadan gömülürse zayıf
  eşleşir. 🚨 **`text` DEĞİŞTİRİLMEZ** — "parça = `content.slice`, metin DEĞİŞMEZ" pini İSTEME giden metin
  içindir; bağlam YALNIZ vektöre eklenir (ne gösterildiği ≠ ne gömüldüğü). Deterministik (önbellek anahtarı
  buna bağlı), başlık İKİ KEZ yazılmaz (parça zaten başlıkla başlıyorsa eklenmez — yoksa o terim yapay
  ağırlaşır), bağlam ve toplam tavanlı.
- 🚨 **KURUCUNUN DÖRT RAG ÖNERİSİ — İKİSİ REDDEDİLDİ (09-12, gerekçeler ölçülü):**
  ⛔ **Semantik önbellek**: "%95 benziyor mu" diye sorabilmek için yeni soruyu ÖNCE gömmek gerekir — yani
  kaçınılmak istenen çağrı zaten yapılır; sorgu gömme maliyeti mesaj başına ~0,00013 sent, %20-30'u sıfırdır.
  Asıl tasarruf CEVABI önbelleklemek olurdu ve cevap MÜLKE/rezervasyona/saate/KB sürümüne bağlıdır —
  soru metnine göre anahtarlamak mülkler arası sızıntı üretir. Redis altyapısı da yok.
  ⛔ **Streaming (misafir yüzeyi)**: tüm güvenlik mimarisi model BİTTİKTEN sonra karar veriyor
  (`admitsMissingKnowledge`, `vetoOutgoingReply`, güven eşiği cevabın TAMAMINI okur). Token akıtmak,
  kapının BLOKLAYACAĞI metni misafire çoktan göndermek demektir. Ayrıca kanal yolunda teknik olarak
  imkânsız (sağlayıcıya tek mesaj). ✅ Host'un inbox TASLAĞINDA streaming güvenli (host onaylıyor) — ayrı iş.
  ✅ **Eval/tracing ilkesi doğru ama ARAÇ hayır**: üç metriğin karşılığı zaten bizde (`srcVerified` ≈
  faithfulness · ölçek harness'ı `inPrompt` ≈ context precision · eşleştirilmiş eval ≈ answer relevance);
  eksik olan tek şey PANO. Langfuse/LangSmith = misafir konuşmasını YENİ bir üçüncü tarafa göndermek
  (alt-işleyen, KVKK) → kendi `RiskEvent` verimiz üstüne pano doğrusu.

**Önceki: ÜRÜN TURU 4 (09-11, ON ölçümlü ajan, saatlik `/loop`) — karar belgesi `docs/KARAR-2026-09-11-kurucu-is-emri-10-ajan.md`:**
🚨 **RAG VARSAYILAN AÇIK** (kurucu: "RAG EKLE"). `KB_RETRIEVAL_MODE` artık AÇMA değil **ACİL DURDURMA**
düğmesi — `legacy/off/0/false/no/disabled` eski davranış, başka her değer (boş dâhil) hibrit. Dayanak
`docs/olcum/hibrit-yan-etki-2026-09-11.md`; kill switch bilinçli GEVŞEK (olay anında kapatamamak, bilinmeyen
değerin legacy'ye düşmesinden pahalı). Ölçülmeyen: cevap KALİTESİ (model yok) — gerçek eval hâlâ borç.
🚨 **BAĞLAM PENCERESİ AÇILDI:** `prompts.ts` çıplak `.slice(-6)` ile kesiyordu ve GEREKÇESİ YOKTU — ölçüldü:
QR'ın 24 mesaj/8.000 karakterlik penceresinin mesaj bacağı **ÖLÜYDÜ** (7.–24. mesajlar tam burada atılıyordu);
oto-yanıt ve inbox öneri konuşmanın TAMAMINI taşıyıp aynı yerde kaybediyordu. Yeni `selectHistoryForPrompt`
(saf): tavan `HISTORY_MESSAGE_CAP` 25 + bütçe `HISTORY_CHAR_BUDGET` 6.000 (**bütçe sayıdan önce gelir** —
tek 4.000 karakterlik mesaj 25 kısa mesajdan pahalı) ve 🚨 **GÜVENLİK PENCERESİ BÜTÇEYE TABİ DEĞİL**: son
OPERATİF mesajdan sonraki cevapsız MİSAFİR mesajlarının TAMAMI daima girer (displacement saldırısı — uzun
zararsız metinle riskli cümleyi pencere dışına itme). Sınıflandırma yalnız `direction`, `senderName` DEĞİL.
🚨 **BU DEĞİŞİKLİK KAPIDA BİR AÇIK AÇTI ve inceleme turunda kapandı — DESEN KAYDA GEÇSİN:**
`passesAutoReplySafetyGate` `context.history`yi INJECTION için tarar ve o ayna `messages.slice(-6)` idi; istem
6 iken iki pencere BİREBİR eşitti. İstem 25'e çıkınca yalnız MODEL tarafı büyüdü → misafir N-10'uncu mesaja
injection yükünü koyup araya 9 zararsız mesaj sıkıştırırsa **model görür, kapı görmez** ve oto-gönderim
izni çıkardı (`pendingGuestMessages` kurtarmaz: o yalnız son GİDEN mesajdan sonrasını kapsar). Ayna artık
AYNI seçiciden beslenir; pin üç yönlü (yeni ayna vetoluyor · injection yokken gönderim sürüyor · **eski
6'lık ayna KAÇIRIYOR** = açığın gerçekliği ölçülü). 🚨 **GÖVDE KIRPILMAZ** — "pencere karakter bakımından
sınırsız" uyarısı doğru ama çözümü kırpmak DEĞİL: bu seçimin çıktısı aynı zamanda kapının tarama yüzeyidir,
kırpılan her karakter kapının GÖRMEDİĞİ bir yüzey demektir. Sınır MESAJ SAYISINDA; bedeli kodda yazılı.
🚨 `selectHistoryForPrompt` ilk yazımda **TÜM geçmişi düşürebiliyordu** (bütçe kontrolünde `picked.length > 0`
çapası yoktu; son mesaj OPERATİF + uzunsa `[]` dönüyordu → inbox "AI cevap öner" SIFIR bağlamla üretirdi);
kardeş pencere `buildGuestChatContextWindow` o çapayı zaten taşıyordu.
🚨 **ACİL ≠ SIRADAN İSTEK:** `escalationReply({critical})` — yangın ile "bir yastık daha" artık aynı cümleyi
almıyor; üç devir noktasının ÜÇÜ de aynı bayrağı taşır. Argümansız çağrı BİREBİR eski metin (eski pinler
ayakta); acil metin de aynı sözleşmeye tabi (makbuzsuz iddia yok, ünlem yok, kurumsal dil yok) — yönerge
misafire VERİLEN bir talimattır, bizim eylem iddiamız değil.
🚨 **TETİKLEYİCİ `isPhysicalEmergency` — `detectRiskType === "safety_emergency"` DEĞİL** (inceleme turu iki
kusur ölçtü): ① o küme öz-zarar ifadelerini de içeriyor, oysa `prompts.ts` o sınıf için AÇIKÇA "acil-talimat
İÇERMEZ, yönlendirmeyi EV SAHİBİNE söyle" diyor → kriz içindeki misafire "acil servisleri arayın" gidiyordu;
② `SAFETY_CRITICAL_WORDS` BİLEREK geniştir ve gerekçesi kendi yorumunda yazılı ("over-matching is the safe
side — it only ever withholds a holding-ack") — o maliyet modeli misafire GİDEN metin için GEÇERSİZ
("İnternet **düştü**", "Havuz ne zaman **açıl**ıyor?" [iş #51 ASCII çarpışması], "**Polis** merkezi nerede?",
"**Kaza** ile bardağı kırdım" hepsi eşleşiyordu). Yeni liste DAR (yangın/duman/gaz/su baskını/elektrik
çarpması), öz-zarar ifadesi İÇERMEZ (veto değil YAPISAL garanti) ve maliyet modeli TERSTİR: aşırı eşleşme
bedava değil → dar taraf güvenli taraf. Kaçırılan acil durum yine DEVREDİLİR + host alarm alır.
**QR host paneli:** Enter=gönder (misafir tarafında vardı, ödeyen müşterinin yüzeyinde yoktu; IME `isComposing`
güvenli) · 30 sn otomatik yenileme (liste + detay; Mesajlar'da 08'den beri vardı, QR atlanmıştı) · mesajlar
kendi kaydırma kabında + açılışta sona konumlanma (eskiden 200 balonun EN ESKİSİNDE duruyordu, composer
altta kalıyordu) · 🤖/👤/🙋 emoji → gerçek ikon, **AI'ın yüzü artık `BrandMark` = bizim logomuz** (kurucu:
"robot niye koydun") · yazma kutusunda ÖNCEDEN uyarı ("siz yanıtlarsanız AI susar") — o cümle üründe vardı
ama yalnız `resume-ai-button`da, yani iş işten geçtikten SONRA.
**Kaydırma çubuğu görünür:** başparmak `--border` idi, açık temada beyaz kart üzerinde kontrast **≈1,2:1**;
`::-webkit-scrollbar-track` HİÇ yazılmamıştı → oluk saydam, "kanal" hissi yok. Artık `--muted-foreground`
(iki temada da okunur olması için hesaplanmış tek ikincil renk) + gerçek oluk + hover.
**Landing demo:** 8 çip (eskiden 6 çip / saatte 6 istek = ziyaretçinin KENDİ sorusuna hak kalmıyordu),
`DEMO_HOURLY_LIMIT` 12 tek kaynak (rota + ekran metni aynı sabit), limit ekranda yazılı.
🚨 **BU SATIR BAYATTI ve §E turunda (09-12) DÜZELTİLDİ** — eskiden "bütçe doğrulamadan SONRA tüketilir
(boş istek hak yakmıyor)" yazıyordu ve **kendi kodumla çelişiyordu**: `api/demo/ai/route.ts` o sıra
değişikliğini AYNI TUR İÇİNDE geri almış ve gerekçesini yazmış ("depo kuralı KİMLİKLİ rotalar içindir;
`demo/ai` `leads` ile aynı sınıftadır — anonim rotada rate limit KOTA değil KÖTÜYE KULLANIM
KONTROLÜDÜR; sonraya alınca saldırgan sınırsız geçersiz gövdeyle rotayı dövüyordu"). Gerçek sıra:
**saatlik IP hakkı (12) ÖNCE tüketilir, boş/geçersiz istek DE hak yakar**; yalnız global günlük 300
sayacı doğrulamadan sonra artar. Yani eski cümlenin parantezi tersini söylüyordu.
🚨 **KURUCUNUN ÜÇ SORUSUNA CEVAP (gerekçeler karar belgesinde):** ① oto-mesaj varsayılanı **ÇEVRİLMEZ** —
`*EnabledAt` baseline'ı yalnız Ayarlar PATCH'i yazdığı için sessiz no-op olurdu ("Açık" der, sıfır mesaj
gider) ve `KB_PRESETS`in iki TRIGGER şablonu doldurulmamış `[AÇIK ADRES]` taşıyor + bu yol modelden HİÇ
geçmiyor → ham belirteç misafire gider; piyasa 8/8 "içerik VER, göndermeyi AÇMA" diyor. Asıl kusur
`kb-manager.tsx`'in KOŞULSUZ "otomatik gönderilir" vaadi. ② aktif saat: uyarı bandı EKLENMEZ (kurucu haklı),
ama şema varsayılanı 0/9 hâlâ tuzak ve **kurucu org dâhil** eski org'lar günün 15 saati susuyor → dar backfill
**migration + onay** bekliyor. ③ 🚨 **oto-yanıt anahtarı KAPALIYKEN karşılama/giriş/çıkış mesajları GİDİYOR**
(üç gönderici `autoReplyHospitable`'ı SELECT etmiyor bile, altı testle pinli) → anahtar Ayarlar'a KOPYALANIR
(dashboard onboarding'i `/settings`'e gönderiyor, anahtar orada DEĞİL = çıkmaz sokak), alt anahtarlar
KİLİTLENMEZ (salt-UI kilit YALAN söyler, sunucu kapısı canlı org'ları sessizce durdurur), çözüm DÜRÜST AD.
🚨 **"Sorunlu" AI'yı KALICI durdurur** (üç katman; misafirin yeni mesajı geri AÇMAZ — `preserve` listesi;
yalnız host elle durum değiştirince ya da elle cevap yazınca açılır). 🚨 **`Conversation.priority` TAMAMEN
GÖRSEL** — dört render noktası dışında hiçbir sorgu/sıralama/bildirim/karar/rapor okumuyor, "acil" şikâyet
e-postasına bile yazılmıyor (`email-templates.ts` alanı tanımlıyor, gövdede kullanmıyor); `urgent` ikonu
pratikte `problem` rozetinin ikinci kopyası (ikisini AYNI kod yazıyor). ⚠️ `PRIORITY` sabiti **Task**'ta
gerçekten iş yapıyor → silinemez, yalnız konuşma yüzeyinden sökülür.
🚨 **"BEKLEMEDE" KALDIRILDI** (kurucu "2.yap") — ve bedava bir kazanç: o durum **belgelenmemiş bir AI
KİLİDİYDİ** (`dueAutoReplyWhere` yalnız `status:"new"` seçiyordu, host işaretleyince oto-yanıt konuşmayı bir
daha HİÇ seçmiyordu ve hiçbir ekran bunu söylemiyordu — `problem` gibi rozet/veto YOK). Migration GEREKMEDİ
(kolon düz `TEXT`, Postgres enum yok). Tip birliğinde KALDI (`LEGACY_CONVERSATION_STATUSES`) çünkü DB'de eski
satırlar olabilir; **aday sorgusuna `waiting` EKLENDİ** ki o satırlar tuzakta kalmasın (iki claim sorgusu
zaten `{in:["new","waiting"]}` idi → kilit değil PARİTE). `closed` DOKUNULMADI.
🚨 **MİSAFİR 404'Ü KALKTI** (kurucu: "görsel olarak çok iyi UI şeyi yap"): beş koşul (global anahtar · bilinmeyen
token · silinmiş mülk · kapatılmış QR · bitmiş abonelik) ürünün B2B 404'üne düşüyordu ve o sayfanın İKİ çıkışı
da `/` idi — dairedeki QR'ı okutan misafir **satış sayfasına** iniyordu. Artık markalı `GuestNotice`; **tek metin,
beş koşul** (numaralandırma koruması: "bu token yok" ile "bu QR kapalı" ayrılmaz) ve **dış bağlantı YOK**
(misafire verilebilecek tek doğru yönlendirme ev sahibidir). Sayfa 200 döner (`noindex` zaten var).
Ayrıca misafir istemcisinde üç ölçülmüş kusur: **sessiz mesaj kaybı** (konaklama sayfa açıkken biterse rota
200+`{closed:true}` döner ve KAYDETMEZ, iyimser balon ekranda kalıyordu) · **kalıcı arıza geçici görünüyordu**
(QR kapatılınca GET 404 sessizce yutuluyor, misafir sonsuza kadar deniyordu) · sunucunun 409/413/429/503
metinleri tek jenerik cümleye çöküyordu · `min-h-screen` → `min-h-dvh`.
🚨 **OTO-MESAJ DÜRÜSTLÜĞÜ — ÜÇ PARÇA (09-11):** ① **misafir-görünür kusur kapandı:** `KB_PRESETS`in
"Giriş talimatı" ve "Çıkış" hazır şablonlarının İKİSİ de doldurulmamış `[AÇIK ADRES]` / `[ANAHTAR TESLİM
ŞEKLİ]` taşıyor, host doldurmadan kaydedebiliyor ve bu yol **MODELDEN HİÇ GEÇMİYOR** — yani ürünün `[…]`
koruması (`packKnowledgeBase`in `[NOT]` notu bir MODEL İSTEMİ notudur) devrede DEĞİLDİ, misafir
`Adres: [AÇIK ADRES]` okuyordu. Üç göndericinin ÜÇÜ de artık **fail-closed** (`hasUnfilledPlaceholders`,
gövde KURULDUKTAN sonra → `{isim}` çözülmüş olur); `*SentAt` damgalanmaz, host düzeltince normal gider.
`{{…}}` sınıfı da elenir (bu yolda hiç çözülmüyor). ② **KOŞULSUZ VAAT KALKTI:** "Bu metin misafire
otomatik gönderilir" org ayarına HİÇ bakmadan yazılıyordu (bileşen ayarı props olarak ALMIYOR bile) →
yerine kontrol edilebilir yönlendirme. ③ **Eleme SESSİZ DEĞİL:** doldurulmamış alan taşıyan tetikleyici
kaleme Bilgi Tabanı'nda "Doldurulmamış alan" rozeti — uyarı **düzeltmenin yapılacağı yerde**. Sayaç
`failures`'a İTİLMEZ (o dizi 6 saatlik kilit penceresini tüketen "teslim başarısız" alarmıdır ve burada
teslim DENENMEDİ bile); `unfilled` alanı **opsiyonel** — `undefined` = ÖLÇÜLMEDİ, `0` DEĞİL (A2 deyimi).
⚠️ **`kbPlaceholderTokens` `prompts.ts`ten `kb-placeholders.ts`e TAŞINDI:** `prompts.ts` `import
"server-only"` taşıyor, yani Bilgi Tabanı ekranı (client) onu import EDEMEZDİ; rozet ile gerçek davranış
ayrışmasın diye yüklem saf modüle indi. `ANY_DOUBLE_BRACE` de `template-apply.ts`e (tek kaynak, üç tüketici).
🚨 **MOBİL DEMO ÇERÇEVESİ (madde 10):** `.frame` SABİT 960px tasarım genişliğinde ve `rescale()`
`Math.min(w/960, 1)` ile yalnız ÜST sınır koyuyordu — **ALT SINIR YOKTU**. Ölçüldü (Chromium, `.msg` 12,5px):
1280px→12,50px · 430px→4,74 · **390px→4,22** · 360px→3,83. Düzeltme: `MIN_SCALE` 0.8 (→ **10,00px**,
390px'te **2,37×**) + sahne KIRPILIR (`overflow:hidden`) ve demo **KENDİ odağını takip ederek** panorama
yapar (`moveCursor` → `panTo`). 🚨 Yatay kaydırma ÇUBUĞU BİLİNÇLİ YOK: otomatik oynayan bir demoda elle
kaydırma animasyonu görüş alanı dışına çıkarır. Ölçülen: masaüstü ölçek 1.0 + panorama **tam 0** (birebir
eski davranış), mobilde panorama −165px'e kadar geziyor, sayfada yatay taşma 0.
🚨 **BOZUK BESLEME "HAZIR" DİYORDU (madde 11):** mülk kartı ölçütü satırın VARLIĞIYDI
(`Boolean(hospitableId) || _count.calendarSources > 0`) ve sorgu `lastStatus`/`lastSyncedAt` alanlarını
**ÇEKMİYORDU BİLE** → kalıcı bozuk besleme "5/5 hazır" YEŞİLİ üretiyor, ipucu "kanal bağlantısı tamam"
diyordu. Liste rozeti 4 durumun **0**'ını ayırıyordu (detay sayfası 2'sini ayırıyor — veri VARDI, liste
okumuyordu). Artık üçüncü hâl KIRMIZI ("Takvim beslemesi hatalı", "hazır" DEMEZ) ve "hiç senkron olmadı"
ayrı satır.
🚨 **RAPORLARDA ÜÇ DÜRÜSTLÜK KUSURU:** ① performans rozeti `tone="success"` SABİT literal'dı → **F
"Kritik" bile YEŞİL** basılıyordu (not gerçekten değişiyor: A≥90·B≥75·C≥60·D≥45·else F) → `GRADE_TONE`.
② "~N saat kazandırdı" = mesaj × **4 dk** ve sabitin tek dayanağı bir YORUMDU → adlandırıldı
(`MINUTES_PER_MESSAGE_ASSUMPTION`) ve cümle artık "mesaj başına 4 dk varsayımıyla" diyor (ölçüm gibi
sunmuyor). ③ "En Çok Sorulanlar" sorgusunda **hiçbir tarih filtresi yoktu** (tüm zamanlar) — kardeş rapor
30 gün kuruyor ve sayfa "Her kart kendi dönemini belirtir" DİYOR → `TOP_TOPICS_WINDOW_DAYS` 30 + başlıkta
yazılı.
🚨 **EMBEDDING PLANI ÖLÇÜLDÜ** (kurucu izni var): maliyet önemsiz (kurucu org'un TÜM KB'si **0,18 sent**,
en ağır müşteri 3 sent; sorgu tarafı mesaj başına 67 token = sohbet isteminin **%0,37**'si); depo **pgvector
DEĞİL** (aday kümesi ≤300 parça → brute-force 1,37 ms; pgvector Railway'de prod DB TAŞIMA projesi ister) →
yeni tablo + `Bytea`. 🚨 **ÖNCE İKİ ÜCRETSİZ DÜZELTME:** `SEMANTIC_QUALIFY_MIN` YOK (n-gram'da 0.3 var,
semantic'te `>0` yeter → kosinüs hep >0 → her parça `hasEvidence` → `no_lexical_hits` bir daha ASLA
tetiklenmez) ve CombSUM embedding ile ezilir (BM25 seyrek, kosinüs yoğun) → semantic varken **RRF**.
`SemanticScorer` arayüzü ÖLÜ ve yanlış şekilli (metni parametre alıyor → doküman vektörü önbelleklenemez);
seçicinin gerçek sözleşmesi `ReadonlyMap<chunkKey, 0..1>` değişmeden çalışır ve ağ çağrısını çağırana çıkarır
→ `select.ts` saf+senkron+DB'siz kalır, fail-open YAPISAL olur. 🚨 En güçlü gerekçe maliyet değil:
**Rusça/Arapça'da sözcüksel eşleşme YAPISAL OLARAK YOK**, DE/FR yalnız kazaen çalışıyor.
✅ **E0 YAPILDI** (ücretsiz, migration'sız, bugün davranış DEĞİŞMEZ çünkü üretimde `semantic` verilmiyor):
`SEMANTIC_QUALIFY_MIN` 0.3 (n-gram emsali) · anlamsal kaynak varken birleşim **RRF**e geçer · ölü
`SemanticScorer`/`noopSemanticScorer` SİLİNDİ · `SOURCE_WEIGHTS` yorumu düzeltildi ("RRF, ağırlık ↓" diyordu
ama `semantic: 1` bm25'e EŞİTTİ). 🚨 **Kanıta `fus` alanı eklendi** ("sum"|"rrf", etkin birleşim): o alan
olmadan RRF anahtarı DIŞARIDAN GÖZLEMLENEMİYORDU ve anahtarı silen mutasyon HAYATTA KALIYORDU — pin
vakumluydu, ölçüldü. Mutasyon 4/4 (eşik · anahtar sil · hep-rrf · kaynağı komple sil), kontrol yeşil.
⚠️ **İlk yazımda `SEMANTIC_QUALIFY_MIN` import EDİLMEMİŞTİ** ve `select.ts`in try/catch'i bunu sessizce
`fb:"error"` → "tüm kümeyi gönder" dalına çeviriyordu: yani embedding bağlandığı gün retrieval sessizce
KAPANIRDI. Testler yakaladı — o try/catch bir güvenlik ağı ama aynı zamanda bir SESSİZLİK kaynağı.
✅ **E1 YAPILDI — sağlayıcı sözleşmesi** (`src/lib/ai/embeddings/provider.ts`; migration YOK, **ücretli
servise TEK İSTEK GİTMEZ**): `embedTexts` / `embedText` / `cosineOfUnit` + `EMBEDDING_MODEL`
(`text-embedding-3-small`, 1536) · `EMBEDDING_BATCH_MAX` 64 · `EMBEDDING_INPUT_MAX_CHARS` 8.000 ·
timeout 8 sn. 🚨 **ÜRETİMDE HİÇBİR ÇAĞIRANI YOK ve bu MEKANİK PİNLİ** (`git ls-files` üzerinden import
taraması + anti-vakumluk): bağlama E3/E5'te AYRI onayla olur, sessizce bağlanamaz. Sözleşme:
① **ASLA FIRLATMAZ** — anahtar yok · timeout · 4xx/5xx · bozuk gövde · boyut uyuşmazlığı · NaN/Infinity ·
sıfır vektör hepsi `null`; çağıran bunu "anlamsal kaynak yok" diye okur ve sözcüksel davranışa döner
(fail-open YAPISAL; `select.ts`in sessiz try/catch'inden ders). ② **KISMİ SONUÇ DÖNMEZ** — yarım küme
çağıranda SESSİZ EŞLEŞME HATASI üretirdi. ③ 🚨 **SIRA `index` ALANINDAN KURULUR**, dizi sırasına körü
körüne güvenilmez ("2. parçanın vektörü" aslında 3. parçanınki olurdu ve hiçbir test görmezdi). ④ vektör
**L2 NORMALİZE** döner → kosinüs = nokta çarpımı (okuma tarafında karekök/bölme yok). ⑤ 🚨 **hata
GÖVDESİ alarma GEÇİLMEZ**, yalnız durum kodu: kardeş yol (`ai/index.ts`) gövdeyi geçirir ama orada istek
gövdesi İSTEMDİR; burada istek gövdesi KB metni + misafirin SORUSUDUR → hata ekosu PII taşıyabilir.
🚨 **KVKK'da YENİ BİR ŞEY YOK (kurucu 09-12 haklıydı, kodda doğrulandı):** misafir mesajı (`prompts.ts`
istem gövdesi) ve KB içeriği (`packKnowledgeBase`) ZATEN `api.openai.com`a gidiyor — embedding yeni veri
SINIFI da yeni SAĞLAYICI da eklemiyor; benim önceki "ayrı KVKK kararı" çerçevem DAYANAKSIZDI. Kanıt:
21 test (hepsi `fetch` mock'lu). **Sıradaki: E2 vektör tablosu = migration → taze `pg_dump` + açık onay.**
✅ **E1b SERTLEŞTİRME (kurucu iş emri 09-12 — beş madde): ÜÇÜ uygulandı, İKİSİ ÖLÇÜLEREK REDDEDİLDİ.**
① **LRU önbellek** — 🚨 anahtar İÇERİKTİR (model + SHA-256 metin özeti) → **bayatlama YAPISAL OLARAK
İMKÂNSIZ**, bu yüzden **TTL YOK** (TTL riski çözmez, yalnız isabeti düşürür). HAM METİN SAKLANMAZ (uzun
ömürlü Map'te misafirin cümlesi adıyla durmaz, test-pinli). Kısmi isabette yalnız EKSİK metinler sağlayıcıya
gider ve SIRA korunur. **Arıza önbelleğe GİRMEZ** (geçici kesinti kalıcı körlüğe dönerdi). Tavan 256 (~3 MB).
⚠️ **DÜRÜSTLÜK: bu ASIL para tasarrufu DEĞİL** — KB parçalarını iki kez ödememenin yolu içerik-hash'li
KALICI saklamadır (E2); buradaki kazanç GECİKMEDİR ve süreç ömrüyle sınırlıdır (deploy başına boşalır).
② **Tekrar deneme** — yalnız 408/429/5xx; 4xx (401 dâhil) TEK ATIŞ. 🚨 **TOPLAM BÜTÇE
`EMBEDDING_TOTAL_DEADLINE_MS` 9 sn, tekrar denemeler DÂHİL** ("3 deneme × 8 sn" 24 sn ederdi; bu kod bir
SOHBETİN içinde koşuyor). `Retry-After` okunur ama KALAN bütçeyi aşamaz. Politika saf `retryPlan`da.
③ **In-place normalizasyon** — ölçüldü (1536×64): `.map()` 1,16 ms → in-place **0,32 ms** (3,6×).
⛔ **ZOD REDDEDİLDİ:** ölçüldü — `zod.safeParse` 11,47 ms vs el yazımı 0,007 ms = **1544× yavaş**
(1536×64 = 98k eleman zod'un en kötü senaryosu); mevcut kontrol zaten strict. ⛔ **"NORMALIZE'I KALDIR"
REDDEDİLDİ:** "OpenAI zaten normalize döndürüyor" tam boyutta DOĞRU ama EKSİK — bu fonksiyon aynı zamanda
**GEÇERLİLİK KAPISI** (NaN/Infinity + sıfır vektör reddi) ve onlar sağlayıcının garantisi değil; `dimensions`
ile kısaltmada sonuç zaten normalize DEĞİL. 🚨 **TESTLER BİR KUSUR DAHA YAKALADI:** `EMBEDDING_MODEL` import
anında DONDURULUYORDU; kardeş yol (`ai/index.ts:98,:396`) env'i HER ÇAĞRIDA okuyor → `embeddingModel()`.
Kanıt: kırmızı-önce 15 blok · **mutasyon 13/13** (ilk turda 2 hayatta kaldı: "toplam bütçe kapısını sil"
mock'lu `fetch` milisaniyede bittiği için görünmüyordu → politika saf fonksiyona ÇIKARILDI; "NaN kapısını
sil" ise fikstür `[NaN,0,0,…]` olduğu için SIFIR VEKTÖR kapısınca yakalanıyordu = iki kapı ayırt
edilemiyordu → fikstüre sıfır olmayan ikinci eleman kondu). **E2 onay paketi:
`docs/ONAY-E2-embedding-vektor-tablosu-2026-09-12.md` (migration 56; `Bytes`, pgvector DEĞİL; `contentHash`
bayatlama kapısı; E5'ten ÖNCE E4 ölçümü ŞART).**
🚨 **REPODA GİT ÇAĞIRAN HER TEST İKİ KATMANLI OLMAK ZORUNDA (CI'da İKİNCİ KEZ ölçüldü — koşu #1076).**
E1 pinini düz `git ls-files` ile yazdım, yerelde yeşildi, **CI KIRMIZI verdi**: `fatal: detected dubious
ownership in repository at '/__w/…'` (checkout'u yapan kullanıcı ≠ testi koşan kullanıcı) → `4c5262c` CI'yı
geçemedi, "Wait for CI" açık olduğu için deploy da atlandı. ⚠️ **DERS REPODA ZATEN YAZILIYDI:**
`brand-name-absent.test.ts` AYNI hatayı koşu **#1058**'de ölçüp çözümünü kendi başlığına yazmıştı; ben yeni
bir git tabanlı pin yazarken o satırları OKUMADIM. Zorunlu idiom: ① `safe.directory` **KOMUT kapsamında**
(`git -c safe.directory=<repo> ls-files -z`) — global/system git ayarına ASLA dokunulmaz · ② git herhangi bir
sebeple çalışmazsa **dosya sistemi taraması** devreye girer · ③ **FAIL-OPEN YOK**: "tarama çalışmadı" sessizce
"eşleşme yok" diye okunamaz, anti-vakumluk ayrı iddia edilir. 🚨 Ve pinin KENDİSİ git'in varlığını ŞART
KOŞMAZ — ilk düzeltmemdeki "iki katman aynı sonucu veriyor" testi git'i zorunlu kılıyordu, yani düzeltmeye
çalıştığım ortam bağımlılığının ta kendisiydi (git'i `exit 128` döndüren stub'la ÖLÇÜLDÜ ve geri alındı).
Doğrulama yöntemi: sahte `git` stub'ı ile test İKİ ortamda da koşulur; mutasyon (gerçek üretim çağıranı ekle)
İKİ ortamda da yakalanmalı. Gerçek çalışma ağacına git ile bakan yalnız bu iki test var
(`conversation-dedupe-apply` kendi yarattığı geçici repoya bakar → kapsam dışı).

**Önceki: ÜRÜN TURU 3 (09-11, DÖRT ölçümlü ajan) — `8e414f8` · `3965ecb` · `2a41a60` · `089240e`:**
① 🚨 **MARKA ADI FİKSTÜRE GERİ GELMİŞTİ** (benim hatam, `34fc701` ile push edilmişti; ajan buldu) →
temizlendi + **mekanik pin** eklendi (kelime pin dosyasına da yazılmadan). `origin/main` TEMİZ; iki eski
uzak dal ucu hâlâ taşıyor (silinebilir, karar kurucunun). ② **PANEL YERLEŞİMİ İKİNCİ TUR** — kurucu
"hâlâ aşağı iniyor" dedi ve HAKLIYDI: asıl kusur `zoom`×`vh` değil, kart yüksekliğindeki `11rem`
sabitinin ARADAKİ BANDLARI saymamasıydı (ölçüldü: tek bandda `<main>` 46 px, iki bandda 109 px taşıyor).
Sihirli sayı kalktı, yerini esnek doldurma aldı; 9 durumda `docScroll=0` + `mainOverflow=0` ölçüldü.
Regresyon pini EKLENDİ (yoktu — K2 ihlali). ③ **Eval sözleşmesi vekilden GERÇEK KAPIYA** + 🚨 **İKİ
EKSEN**: ilk yazımım teslimat eksenini eklerken UYDURMA eksenini kapatıyordu (R6'da düşük güvenli saf
uydurma yeşil geçiyordu) → ürünün kendi `hasUnsourcedSpecificClaim` yüklemi ikinci eksen olarak bağlandı.
🚨 **CODEX BU TAŞIMAYI REDDETMİŞTİ** — karar gerekçeyle BOZULDU ve açıkça raporlandı (tasarım §0; eski
belgedeki madde silinmedi, "geçersizleşti" diye işaretlendi). **SON SÖZ KURUCUNUN.** Belgede ALTI yanlış
olgu düzeltildi (§8). Kanıt: kırmızı-önce + **mutasyon 15/16** (biri ölçülmüş eşdeğer ve anti-vakum
satırının işini kanıtlıyor) + tam kapılar yeşil (**npm test 4594/382** · tsc · lint · build · audit).
Migration YOK, bayrak değişikliği YOK, ücretli servis YOK.
⚠️ **DERS (kendi hatam):** mutasyon turu YALNIZ TEMİZ AĞAÇTA koşulur — `git checkout --` ile mutasyonu
geri alan harness commit EDİLMEMİŞ düzenlemeleri de siler (ve yeni/untracked dosyada mutasyonu geri
ALAMAZ). Bir tur iş yeniden yazıldı.
**Önceki: ÜRÜN TURU 2 (09-11, iki ölçümlü ajan) — kurucu ekran görüntüleriyle bildirdi, dördü kapandı:**
① **marka adı repodan silindi** (95 dosya / 296 geçiş → fikstürde `Lale`, canlı hesapta "kurucu org").
② **şablonlar düzenlenebilir** (PATCH rotası vardı, düğme yoktu) + varsayılandan "Kendime uyarla" +
PATCH'in yuttuğu `propertyId` alanı. ③ **şablon → KB önerisi** (`kb-from-templates.ts`) — inceleme ajanının
P1'i düzeltilerek: `{{…}}` işaretçisi taşıyan şablon REDDEDİLİR, allowlist `wifi`+`rules`e daraltıldı.
④ **panel yerleşimi**: masaüstünde sayfa kaymaz (kenar çubuğu tam yükseklik, kayan tek öge `<main>`),
konuşma kartı başlığında ad+mülk, yazma alanı 80→160px ve sağ ray 20rem'e sabitlendi, ölü "Mülk" kartı
kalktı. Ayrıca inbox şablon uygulamada ham `{daire}`/`{name}` sızıntısı ve `{{constructor}}` prototip
kusuru kapandı (`template-apply.ts`). ⑤ **İKİNCİ TUR (aynı gün, beş ekran görüntüsü):** 🚨 Bacak B yüzeyi
KAPATILDI (yanlış+tehlikeli çift — ↑ ayrıntı) · A3 "Kurulum ve eksikler" ve A5 "Metinden bilgi çıkar"
yüzeyleri kaldırıldı · "Misafir cevap bekliyor / AI ile cevapla" davet kartı silindi (düğmesi hemen
altındaki "AI cevap öner" ile AYNI `handleSuggest()`i çağırıyordu) · başlık satırındaki durum ROZETİ
silindi (seçim kutusuyla birebir aynı değeri 30 piksel ötede ikinci kez yazıyordu; KUTULAR KALIYOR — durum
gelen kutusu filtresini ve oto-yanıt yaşam döngüsünü sürer, "Sorunlu" oto-yanıtı KİLİTLER).
Migration YOK, bayrak değişikliği YOK, ücretli servis YOK.
🚨 **ROADMAP KONUMU (kurucu sordu, kodda doğrulandı):** V0.1–V0.7 ✅ · V1 ✅ · **V2 YARIM — yalnız V2.1**
(`incidents/attention.ts`; `grep moneyImpact` = 0 sonuç, para etkisi kodun KENDİ yorumunda bilinçli dışarıda:
"`Reservation.totalAmount` BRÜT tutardır, kayıp DEĞİL") · V3–V8 ve ④ Availability Engine BAŞLAMADI.
09-10/09-11'deki turlar roadmap fazı DEĞİL, AI kalite + güvenlik kapısı işiydi (talimatın ⑤ ön koşulu).
**Önceki: 7. TUR (09-11, otonom /loop, DÖRT+BİR ölçümlü ajan) — ÜÇ commit: `43098ab` envanter (19 cihaz adı; 30 gerçekçi
bildirimin 26'sı kaçıyordu, çoğu OTO-GÖNDERİLİYORDU; `batarya` ölçülüp REDDEDİLDİ) · `59a6bae` inceleme düzeltmeleri
(homoglif bypass'ı + 6. turun İKİ gerilemesi + `sorun` KOŞUL ailesi + yer tutucuda dört kusur) · `76490a2` eval MODEL
KIYASI altyapısı (ücretli servis ÇAĞRILMADI). Kanıt: kırmızı-önce 5+9 blok · mutasyon 20/20 + 21/23 (iki ölçülmüş
eşdeğer) · tam kapılar yeşil (npm test **4434/371** · tsc · lint · build · audit). Migration YOK, bayrak değişikliği YOK.**
🚨 **ANAHTAR BEKLENİYOR:** kurucu `OPENAI_API_KEY`i environment'a ekledi ama konteyner onu görmüyor (env açılışta
yükleniyor) → **session yeniden başlatılınca** `npm run eval` + `scripts/eval-compare-models.mjs` koşulabilir. Sıra:
eşleştirilmiş retrieval eval → `KB_RETRIEVAL_MODE=hybrid` tek mülk pilotu → genel; ayrıca `gpt-5.1` vs `gpt-5.6-luna`
kıyası (6 kat maliyet; gölge katmanı yalnız GÜVENLİK sınıflandırmasını kıyaslıyor, CEVAP KALİTESİ bu harness'la ölçülür).
**Önceki: RAG dilim 3 (Codex turu 3, 09-09) — dört bulgu düzeltildi (alan bazlı çelişki + sığmayan çelişki notu ·
bildirim↔görev bağı · canlı tavan + cevap-metni ölçüsü · tazelik yakın-eşitlik bozucu) + anlamsal sözleşme dürüstlüğü
(üretimde embedding YOK, pin) + n-gram ayrı ölçüm (`auto` varsayılanı ölçümle) + güvenlik filtresi davranışsal doğrulaması +
eşleştirilmiş legacy/hibrit eval hazırlığı (R1–R8, kurucu koşar) + sentetik GraphRAG kıyas verisi (H1–H3 birebir, H4
cevaplanamaz). Bayrak KAPALI, migration YOK, ücretli servis YOK, politika değişikliği YOK, P5 AÇIK. Yerel kapılar: suit +
tsc + lint + build + audit yeşil; mutasyon 20/20 (kontrol yeşil).**
**4. GERÇEK KOŞU (kurucu, 09-09 20:21 yerel, preflight klonu, `9699896` sonrası): EŞLEŞTİRİLMİŞ RETRIEVAL 16/16 ✅ (R1–R8 iki
modda; legacy dürüst yokluk + hibrit doğru cevap beklentisi tuttu) · QR kapsam 7/8 — E4 ❌ ("[ŞİFRE]" cevapta). İki rapor dosyası
(`eval-2026-09-09-*.md`, `eval-retrieval-2026-09-09-*.md`) repoda YOK — kurucudan bekleniyor; ham E4 cevabı görülmedi.
DÜZELTME: `81a5f22` PUSH EDİLDİ (kurucu onayı, fast-forward; CI #1030 5/5 success) + İKİNCİ TUR YERELDE (push beklesin — Codex): dedektör değer-konumu/red ayrımı + KB bloğu kod-üretimli
yer tutucu notu + üçüncü-şahıs ve edilgen söz boşluğu; Codex ikinci tur: gerçek E4 cevabı ("…[ŞİFRE] olarak görünüyor…")
regresyon pinli, reddederek alıntı da düşer, E5'e `noUnverifiedCommitment`; gerçek QR rotası karakterizasyonu (yer tutucu misafire
dönüyor); veto raporu ayrı, uygulanmadı. Karşı örnekler pinli; mutasyon 12/12 + ikinci tur; kırmızı-önce.**
**Origin HEAD: 09-11 turu PUSH EDİLDİ (kurucu 09-11 "tam kapıları koşarak push edebilirsin" izni).** `27eb5f3` (6. tur)
CI **#1032 success** ✅; ardından `43098ab` · `59a6bae` · `76490a2` (7. tur). Önceki `81a5f22` (CI #1030 5/5), `9699896`
(dilim 3, CI #1026 5/5), `12ddd8e` (dilim 2, CI #1022 5/5) ve `061d62e` (dilim 1) ACTIVE — kurucu teyidi 09-09.
Prod'da canlı: migration 52/53/54 (09-08), `a52a30c`+ (selam tekrarı canlı doğrulaması hâlâ bekliyor).
**3. GERÇEK KOŞU (kurucu, 09-09 13:46 yerel, preflight klonu `2cfa8d4`): 8/8 ✅ (E1 dürüstlük sözleşmesiyle).** Rapor dosyası
repoya henüz gelmedi (önceki iki koşununki de). Kurucunun preflight klonunda `npm install` 11 zafiyet gösterdi (node 24, engine
uyarısı) — CI'daki triaj kapısı `061d62e`'de yeşil; yerelde `npm ci` + `npm run audit:check` ile kıyaslanmalı, `audit fix --force` YOK.
**4005 test yeşil (361 dosya) · typecheck/lint/build/audit temiz.**
**09-09 turu (hepsi push edildi, migration YOK):** ① CI #1002 kırmızı — 7 yeni danışma, lock DEĞİŞMEMİŞTİ → `next 15.5.24 ·
sharp 0.35.4 · nodemailer 9.1.1`; baseline **gevşetilmedi, iki istisna SİLİNDİ** (6→4); SMTP yolu için ilk gerçek-soket testi;
`/_next/image` 200 dalı BİLEREK açılmadı (`images.unoptimized` güvenlik kontrolü) → kodek sentetik görüntüyle ölçüldü.
② **V2.1 "Dikkat Gerektirenler"** panel kartı (`modules/intelligence/incidents/attention.ts`): bozuk besleme · çıkışı yaklaşan
cevapsız · cevapsız yaşı · tekrar eden arıza; sakin günde HİÇ basmaz; `certainty observed|inferred`; misafir adı TAŞINMAZ;
🚨 cevapsızlık `lastMessageAt`ten DEĞİL görünür son mesajdan hesaplanır (`resume-ai` onu ilerletiyor). ③ **Eval ölçüm katmanı:**
eval yalnız `suggestReply` = TASLAK ölçüyordu; taslak ≠ kapı kararı ≠ ürünün cevabı (`tests/integration/qr-draft-vs-delivered.test.ts`,
kapı TAŞINMADI, model mock'lu — **koşullu karakterizasyon**: baseline'da intent/risk YOKTU, varsayıldı). Rapor Ö4: kırpma yok ·
karar girdileri · istenen ≠ bildirilen model · commit · istem parmak izi · aynı gün ezme yok. Dedektörler bilerek `tests/helpers/`
(ürün koduna taşımak = P5). **Kök neden: istem "ilettim/size döneceğim"i EMREDİYOR (`prompts.ts:20-21, 88, 115`), `actionReceipt`
uygulanmamış; E7'de saat için öncelik sözleşmesi VAR (`buildReplyUserPrompt`: mülk ayarı esastır — ilk "YOK" bulgum
yanlıştı, model kuralı uyguluyordu); **P4-b KARARI (09-09): çelişkide misafire kesin saat YOK → insan incelemesi;
host'a çelişki gösterimi ayrı** (istem düzeyinde, kapı/eşik değişmedi); E4/E5 yasak kaynaklı ama yanındaki
vaat (`:97, :100, :833`) kanıtsız.**
**P1 UYGULANDI (09-09, istem):** makbuzsuz eylem/söz emirleri kaldırıldı, çapa "Mesajınız kaydedildi; ev sahibiniz
görebilir."; KURAL-4 "değerlendirecek" → "ev sahibinizin kararıdır" (kurucu); escalation etiketleri değişmedi.
**P1-c (kaynaksız cevapta güven <0.75 talimatı) kurucu kararıyla EKLENMEDİ** — yeni eval görülmeden açılmaz.
**2. GERÇEK KOŞU (kurucu, 09-09 08:55, `7ohi`, P1/P4-b sonrası): 7/8 ✅.** E1 cevabı dürüst ("kayıtlı bilgim yok;
mesajınız kaydedildi…", güven .8, kaynak 0/0) — tek kırmızı eski `maxConfidence .75` beklentisiydi (P1-c ile çelişiyordu)
→ **E1 sözleşmesi güven → DÜRÜSTLÜK** (`noUnverifiedCommitment` + `acknowledgesAbsence` + uydurma listesi; dataset
`changed` alanı; karşı-örnekler pinli: söz veren/uydurma cevap aynı .8'de DÜŞER). E6 intent **ölçüldü** = complaint
(kapı devreder). E7 güven **.7** → P4-b çalışıyor. E7 `2/1` beyan/doğrulanan = A2 uydurma-atıf sınıfı, dokunulmadı.
Rapor dosyası (`eval-2026-09-09-085534-7ohi.md`) repoda YOK — kurucudan bekleniyor; tablo ekran görüntüsünden.
**RAG DİLİM 1 KODLANDI (09-09, bayrak KAPALI, migration YOK, ücretli servis YOK, politika değişikliği YOK):** `src/lib/ai/retrieval/`
(8 dosya) + 4 yüzey bağlama + kanıt/istem notu; 9 yeni test dosyası (unit 5 · integration 2 · helper 1 · harness 1),
**20 iki yönlü mutasyonun tamamı yakalandı** (ilk turda 2 hayatta kaldı → test güçlendirildi: çelişki koruma `maxChunks:2`,
bağlam taşıma tek adım, kategori-ipucu-yalnız senaryosu). Tasarım + onay tablosu `docs/RAG-GRAPHRAG-TASARIM-2026-09-09.md`.
**RAG DİLİM 2 KODLANDI (Codex turu 2, 09-09; bayrak KAPALI, migration/ücretli servis/politika YOK):** aday kaynakları
(BM25 + karakter n-gram + anlamsal sözleşme) → CombSUM/RRF birleşim → rerank (başlık tam örtüşme, yalnız-ipucu 0.2, tazelik)
→ `supersededById` sürüm kuralı → kategori-bağımsız çelişki koruma; kanıt `retrieval.{srcs,sup,conf}`; `kb-fetch`
`supersededById` seçer. Ölçek harness'ı 30/100/300 + host graf katmanı + LightRAG/HippoRAG protokolü. Sözlük ~45 dar
kavram (ölçülerek yeniden yapılandırıldı). Mutasyon turu sonuçları `docs/RAG-GRAPHRAG-TASARIM-2026-09-09.md` §3b.
**Bekleyen kurucu kararları:** P1–P5 (önerilen sıra P1→P4→P5→P3→P2) · orijinal eval raporu · yeni eval koşusu (intent/risk artık
kaydediliyor) · `a52a30c` ACTIVE + selam kontrolü · migration 53/54 §B salt-okuma sorguları · prod'da `EMAIL_HOST` set mi ·
**RAG (onay tablosu tasarım §5, somut kapsamla):** eval setine uzun-rehber/30+ kalem sınıfı → `KB_RETRIEVAL_MODE=hybrid` ile eval
→ tek mülk pilotu (`retrieval.fb/srcs/sup/conf` dağılımı) · n-gram kaynağı varsayılanı (katkı ≈0 ölçüldü) · embedding (ücretli +
KVKK: onaylı KB parçaları + misafir SORUSU dış API'ye) · kötü niyetli KB kalemini retrieval'da eleme (politika) · LightRAG/HippoRAG
deneyi (misafir MESAJ metni dış modele → KVKK) · HyDE/agentic yalnız kalan başarısızlarda.
Prod smoke bu ortamdan yapılamaz; operatör adımları `docs/audit-2026-09-05/DURUM.md` + `docs/V0-CHANNEL-INDEPENDENCE-INVENTORY.md` §10.
