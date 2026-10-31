> **TASLAK (09-30 gece) — Aşama 2 kapsam görüşmesi için.** Salt-okuma araştırma (ajan) + Claude'un nokta doğrulaması: örüntü hafızası
> her geçişte `status: "active"` yazıyor (`patterns.ts`), `recurringIssues`in çağıranı yok, personel oluşturan API ucu yok — üçü de kodda
> doğrulandı. Geliştirme BAŞLAMADI; kapsam kurucuyla netleşecek, kurucunun göndereceği 6 maddelik konuşma hafızası gereksinimi eklenecek.

# V0–V8 faz haritası: kod, test ve belge durumu (salt-okuma araştırma, 2026-09-30)

**Yöntem.** Faz tanımları `docs/KURUCU-TALIMATI-2026-09-07-urun-vizyonu-ve-degismezler.md`ten alındı (V-sırası 512–525. satırlar,
özellik metinleri 63–464. satırlar, V0 806–818. satırlar, değişmezler 899–982. satırlar). Belgedeki iddialar `src/`, `prisma/schema.prisma`
ve `tests/` üzerinde Grep/Read ile doğrulandı. Test koşulmadı, ağ çağrısı yapılmadı, depoda hiçbir dosya değiştirilmedi.

**Çalışma ağacı:** `wip/saat-alani-yanlis-alarm` @ `1abf4fd`. Yerel `origin/claude/great-edison-3zqpZ` ref'i `6a3bdfe` (09-30 18:19).
İki dal kopyalanmış commit'lerle ayrışmış (236 önde, 215 geride). `src` ve `prisma` içerik farkı 24 dosya; K7'nin 58 numaralı migration'ı
ve üç ölçüm bayrağı YALNIZ yerel dalda. Yerel ref bayat olabilir; yayındaki sürüm bu oturumdan doğrulanamadı. `ROADMAP.md` 07-22'den beri
güncellenmemiş, V-fazlarını içermiyor.

**Etiketler:** tamamlanmış · kısmen uygulanmış · bayrak arkasında · canlı doğrulanmamış · yalnız tasarım.
**Kanıt işaretleri:** [K] kodda okundu ya da grep'lendi · [T] test dosyası var (koşulmadı) · [B] YALNIZ belgeye dayanıyor
(prod ya da canlı iddiası; bu oturumda doğrulanamaz).

## 0. Tüm fazları etkileyen canlı bağlam [B]
- **Prod verisi yedek provalarında aynı kaldı.** 09-19, 09-26 ve 09-28 provalarının üçünde de sayılar aynı: rezervasyon 1.542, konuşma
  1.329, mesaj 17.462, takvim kaynağı 0 (CLAUDE.md "ÇALIŞMA BİÇİMİ"; `docs/TASARIM-2026-09-26-konusma-ogeleri.md` §6;
  `docs/TASARIM-2026-09-28-misafir-adi.md` §5). Buna göre 09-19'dan sonra (en az 09-28'e kadar) yayınlanan hiçbir mesaj ya da sinyal akışı
  gerçek trafikle çalışmış olamaz.
- Kurucu org'un Hospitable aboneliği 402 (veri donuk). `ChannelConnection` tablosu 0 satır (son belgelenen sayım 09-08). iCal beslemeleri
  bilerek kaldırılmış.
- Railway ayın 1'ine kadar aktif (kurucu, 09-24). Canlı doğrulama penceresi 10-01'de kapanıyor.
- Bazı bayrakların kod varsayılanı KAPALI, ama kurucu beyanına göre canlıda AÇIK: `AI_UNDERSTANDING_ENABLED` ve `AI_STAY_GUARD_ENABLED`
  (09-25); `AI_CONVERSATION_ITEMS_ENABLED`, `KB_SEMANTIC_RETRIEVAL`, `KB_RERANK_ENABLED`, `HOUSE_RULES_CARD_ENABLED` ve
  `AI_HOUSE_RULES_SHADOW` (09-26). Railway değişkenleri bu oturumdan görülemez.

## Özet
| Faz | Tek satırlık hüküm | Baskın etiketler |
|---|---|---|
| V0 | V0.1–V0.6 ve V0.7 kod hazırlığı yayında. Kolon kaldırma (contract), webhook, bağlantı sağlığı ve bağlantı kapsamlı kimlik yok. Okuma anahtarı hiç açılmadı | tamamlanmış · kısmen · bayrak arkasında |
| V1 | Şema, tüketici, KB hafızası ve Mülk Hafızası kartı canlı. QR ve tek satırlı dosya zinciri arayüzden doğrulandı. Örüntü, `date_change` ve URL ile iCal canlıda hiç görülmedi | tamamlanmış · canlı doğrulanmamış |
| V2 | V2.1 paneli canlı (4 satır türü). Çakışma, para etkisi ve tutulan istek satırları sonradan eklendi ama canlıda görülmedi. Puan, portföy toplamı, söz takibi ve gelir kaçağı yok | tamamlanmış · canlı doğrulanmamış · yalnız tasarım |
| V3 | Görev çekirdeği V-fazlarından önce vardı ve canlı. Tek güvenli eylem kural kapılı erken giriş onayı. Öneriden görev üreten motor ve Host Copilot yalnız tasarım | tamamlanmış · bayrak arkasında · yalnız tasarım |
| V4 | Görev güncellemesine fotoğraf eklenebiliyor (ön koşul). Referans durum, görüntü analizi ve puan yok | tamamlanmış (ön koşul) · yalnız tasarım |
| V5 | Yalnız erken giriş için hazırlık kanıtı ve ev sahibine komşu geceler var. Rezervasyon risk modeli yok | canlı doğrulanmamış · yalnız tasarım |
| V6 | Örüntü hafızası, panel satırı ve yüzeysiz bir graf fonksiyonu var. Yorum alımı yok | kısmen · canlı doğrulanmamış · yalnız tasarım |
| V7 | Yalnız ev sahibinin girdiği gecelik fiyat aralığı var (V2 için). Gelir beyni yok | yalnız tasarım |
| V8 | Kod yok. Host Copilot planında Faz 3 ve Faz 7 olarak geçiyor | yalnız tasarım |

## V0 — Channel Independence
**Tanım:** Çekirdek hiçbir sağlayıcının semantiğine bağlı değil. Kanal katmanı yetenek bazlı: bağlantı yaşam döngüsü, alım ve gönderim
ayrı ayrı ilan ediliyor. Hospitable geçici köprü; Airbnb Direct ikinci bir yeniden yazım gerektirmeden eklenebiliyor.

| öğe | durum | kanıt | not |
|---|---|---|---|
| V0.1 giden gönderim yönlendirmesi (`sendMessage`'ın tek çağıranı) | tamamlanmış | [K] `src/lib/channels/outbound.ts:64,122`, `channels/hospitable-outbound.ts` · [T] `tests/unit/core-channel-independence.test.ts`, `tests/integration/outbound-dispatch.test.ts` · [B] CI #938, envanter §8 | Envanter §8'e göre prod smoke "yapılmadı"; gerçek sağlayıcı gönderimi canlıda gözlenmedi |
| V0.2 sağlayıcı taklidi (fake) ve giden uyum kiti (14 senaryo) | tamamlanmış (yalnız test altyapısı) | [T] `tests/helpers/fake-channel.ts`, `tests/helpers/outbound-conformance.ts`, `tests/unit/outbound-adapter-conformance.test.ts` | Kit canlı doğrulama yerine geçmez; gerçek 401/403/429 gövdeleri hiç gözlenmedi [B] |
| V0.3 `ChannelConnection`, çift yazma, `auth_revoked` sınıfı, kiracı kontrolü | tamamlanmış (şema ve kod) · canlı doğrulanmamış (davranış) | [K] `prisma/schema.prisma:1194`, `src/lib/channels/connections.ts` · [T] `channel-connection-lifecycle`, `channel-connection-migration`, `outbox-connection` · [B] migration 49 prod'da 09-07 15:49Z | Prod'da DB'de token'ı olan org yok, tablo 0 satır. Çift yazma ve iptal akışı canlıda hiç çalışmadı. Envanter §10'un "YEREL, PUSH EDİLMEDİ" başlığı bayat |
| `CHANNEL_CONNECTION_READ` okuma anahtarı | bayrak arkasında | [K] `src/lib/hospitable-credentials.ts:55`, `scripts/env-check.mjs` `STRICT_ONE_FLAGS` | Hiç açılmadı. Ön koşul ilk DB bağlantısı (`docs/V0.7-CANLI-GECIS-OPERATOR-PLANI.md` Aşama 1–2) |
| V0.4 kaynak damgası (`connectionId`, `ingestedAt`, `connectionEvidence`) | tamamlanmış · canlı doğrulanmamış | [K] `channels/provenance.ts`, migration `50_provenance` · [T] `tests/unit/provenance-classes.test.ts`, `tests/integration/provenance-ingest.test.ts` · [B] prod'da 09-07 19:29Z | Eski 1.538 rezervasyon ve 17.436 mesaj `legacy` sınıfında (geriye dönük tahmini doldurma bilerek yapılmadı). Damgalı satır prod'da hiç sorgulanmadı |
| V0.5 `messagingCapable` tek kaynak | tamamlanmış | [K] `src/lib/channels/capability.ts:32,55` · [T] `tests/integration/messaging-capability.test.ts` · [B] `19d5527`, CI #958 | Davranışı değiştirmedi |
| V0.6 alım sözleşmesi, yazma servisi ve `IngestEvent` | tamamlanmış · canlı doğrulanmamış (sağlayıcı yolu) | [K] `channels/ingest.ts`, `channels/hospitable-ingest.ts`, `src/lib/ingest/write-service.ts:77,225` · [T] `ingest-adapter-conformance`, `ingest-write-service`, `tests/helpers/ingest-conformance.ts` · [B] migration 51 prod'da 09-08 03:13Z | Abonelik 402 olduğu için Hospitable'dan alım canlıda hiç çalışmadı. Lixus'un kendi kaynakları V1 satırında |
| V0.7 kod hazırlığı (tek kimlik çözümleyici, 5 bağlantı durumu; damgalı kuyruk satırı yalnız kendi bağlantısından gider) | kısmen uygulanmış | [K] `hospitable-credentials.ts:123` `resolveHospitableCredential`, `:438` `getConnectionInfo` · [T] `tests/integration/connection-state.test.ts` · [B] deploy `0a7a2a4`, 09-08 | `hospitable*` kolonları kaldırılmadı. Operatör planının Aşama 1–3'ü yapılmadı [B] |
| Kanal sözleşmesi (13 yetenek, manifesto, veri politikası) ve boş `AirbnbDirectAdapter` | tamamlanmış (yalnız sözleşme) | [K] `channels/capabilities.ts`, `manifests.ts`, `requirements.ts`, `providers.ts`, `airbnb-direct/adapter.ts` · [T] `tests/unit/channel-manifest.test.ts`, `airbnb-direct-adapter.test.ts` · `docs/AIRBNB-DIRECT-SOZLESMESI.md` | Ağa çıkmıyor ve kayıt defterine eklenemiyor (değişmez 18). Çalışma zamanında hiçbir şey yapmıyor |
| Kanaldan webhook girişi | yalnız tasarım | [K] `src/app/api/webhooks/` altında yalnız `paddle` var. Manifestoda `webhooks.receive` Hospitable için `unavailable`, Airbnb için `planned` | Yazma servisi hazır (değişmez 7) |
| Bağlantı sağlığı sinyali | yalnız tasarım | [K] `connections.ts`te sağlık alanı ya da fonksiyonu yok. CLAUDE.md "V0 kalanları" listesinde | |
| Bağlantı kapsamlı dış kimlik (değişmez 3) | kısmen uygulanmış | [K] `Property.hospitableId @unique` global (`schema.prisma:345`); `Reservation @@unique([propertyId, sourceReference])` bağlantıyı içermiyor (`:518`); `Organization.hospitable*` 5 kolon ve `autoReplyHospitable` duruyor (`:129,147-155`); `toChannel` ham platform adını geçiriyor (`hospitable-ingest.ts:43`) | Kaynak damgası var, ama tekrar-koruma (idempotency) anahtarı bağlantıyı içermiyor |
| Doğrudan kanal ile iCal'in aynı mülkte birlikte çalışması | yalnız tasarım | `docs/GEREKSINIM-dogrudan-kanal-ve-ical-birlikte-yasama.md` ("KAYIT, uygulanmadı") | |
| Demo hesabı (Airbnb başvurusunun 4. kapısı) | canlı doğrulanmamış | [K] `src/lib/demo-tenant/` · [T] `tests/integration/demo-tenant.test.ts` · `docs/DEMO-HESABI.md` "CANLIYA KOŞULMADI" | Canlıda çalıştırmak kurucu onayı ve taze `pg_dump` istiyor |

**Eksik (V0 tanımına göre):**
- Webhook girişi ve bağlantı sağlığı sinyali.
- Kolonların kaldırılması (V0.7 contract).
- Bağlantı kapsamlı kimlik ve tekrar-koruma.
- Org başına sağlayıcı başına tek bağlantı sınırı (çoklu hesap yok).
- Kalıcı misafir profili (canonical Guest, değişmez 10).
- Gerçek Airbnb, Vrbo ya da Booking adaptörü (bilinçli olarak yok; değişmez 18).
- "Hospitable olmadan çalışan Lixus" canlıda gösterilemiyor, çünkü prod'da takvim kaynağı 0 [B].

## V1 — Property Memory + Signals
**Tanım:** Her mülk için yaşayan bir hafıza. Hafıza canonical event'lerden türeyen sinyallerle beslenir. Her kalem kaynak, kanıt, güven ve
zaman taşır (değişmez 13).

| öğe | durum | kanıt | not |
|---|---|---|---|
| `Signal`, `PropertyMemory` ve `IngestEvent.changedFieldsJson` | tamamlanmış | [K] `schema.prisma:1260,1326`, migration `52_property_memory_signals` · [B] prod'da 09-08 06:11Z (envanter §14b) | |
| Tüketici (aynı olayı iki kez işlemez; sırasız gelen ya da yarıda kalan işlemde güvenli) ve zamanlanmış geçiş | tamamlanmış | [K] `src/modules/intelligence/consumer.ts`, `index.ts` `runIntelligencePass`, `src/lib/scheduled-sync.ts:704` · [T] `intelligence-consumer`, `scheduled-sync-intelligence-hook` | Hata olursa yakalanıyor (try/catch); PMS durmuyor |
| Bilgi tabanından hafızaya aktarım (ilk yükleme ve KB rotalarında anında eşitleme) | tamamlanmış | [K] `memory/bootstrap.ts`, `refreshPropertyMemoryBestEffort` · [B] prod'da 09-08: aktif `kb_item` hafızası 32 = aktif KB kalemi 32 | |
| Lixus'un kendi kaynaklarından olay: QR misafir mesajı → şikâyet sinyali; tek satırlı `.ics` iptali → iptal sinyali | tamamlanmış | [K] `src/lib/ingest/events.ts:30` (`hospitable·ical·manual_file·qr_chat`) · [T] `tests/integration/intelligence-native-sources.test.ts` · [B] `docs/V1-KALAN-CANLI-DOGRULAMALAR-2026-09-08.md` A ✅ ve C ✅ | Kanıt arayüzden alındı. `IngestEvent` ve `Signal` satırları prod'da hiç doğrudan sorgulanmadı |
| URL ile eklenen iCal beslemesi → sinyal | canlı doğrulanmamış | [B] Gist'teki "1 atlandı" sonucunun kök nedeni kanıtlanmadı (`docs/TESHIS-2026-09-08-ical-iptal-atlandi.md`). Prod'da takvim kaynağı 0 | |
| `date_change` sinyali | canlı doğrulanmamış | [K] `signals/derive.ts` · [B] V1-KALAN §C | |
| Örüntü hafızası (kategori başına 180 günde ≥3 olumsuz sinyal) | canlı doğrulanmamış | [K] `memory/patterns.ts:14-15` | Kategoriler kaba: complaint, refund, early_departure |
| Sinyal saklama temizliği; silmede ilişki boşaltılır (SetNull) | canlı doğrulanmamış | [K] `retention.ts`, `scheduled-sync.ts:813` | `DATA_RETENTION_MONTHS=24` olduğu için henüz silinecek sinyal yok [B] |
| Mülk sayfasındaki "Mülk Hafızası" kartı | tamamlanmış | [K] `src/app/(app)/properties/[id]/page.tsx:73,411` · [B] 09-08'de arayüzden doğrulandı | Salt okuma |
| Değişmez 13 alanları (çelişki, insan düzeltmesi, bitiş tarihi) | kısmen uygulanmış | [K] Alanlar şemada var. `contradictedById`e yazan kod yok. `humanOverrideAt`i yalnız gecelik fiyat yazıyor (`money/rates.ts:117`). `Signal.resolvedAt`e yazan kod yok | |
| Ev kuralları kartı ve gölge ölçüm (#188) | bayrak arkasında · canlı doğrulanmamış | [K] `src/lib/house-rules/` (`flag.ts`: `HOUSE_RULES_CARD_ENABLED`, `AI_HOUSE_RULES_SHADOW`) · [T] `house-rules.test.ts`, `house-rules-shadow-wiring.test.ts` · [B] kurucu beyanına göre canlıda açık | Yapay zekâ kuralları kullanmıyor. `core.ts`i çağıran yok |
| İnce kategori (ör. sıcak su) ya da LLM ile çıkarım | yalnız tasarım | `docs/V1-PROPERTY-MEMORY-DESIGN.md` §1 ve §8 (ön koşul: guardrail ve eval) | |
| Güçlü yönler (yorumlardan) ve bakım/görev kaynaklı sinyal | yalnız tasarım | V1 tasarımı §7–8 (sırasıyla V6'ya ve V3'e bırakıldı) | |

**Eksik:**
- Güçlü yönler (KNOWN STRENGTHS).
- İnce kategori.
- Bakım kaynaklı sinyal.
- Hafızada çelişki işaretleme ve insan düzeltmesi yüzeyi.
- Prod'da satır düzeyinde doğrulama (hiç yapılmadı).
- 09-19'dan beri canlı trafik yok [B].

## V2 — Exception Feed ("Needs your attention", para etkisi; V2.1 "Dikkat Gerektirenler")
**Tanım:** Ana ekran yalnız gerçekten önemli olanı gösterir. Her uyarı varsayımı ve güveni belirtilmiş, aralık olarak verilen bir para
etkisi taşır (değişmez 15).

| öğe | durum | kanıt | not |
|---|---|---|---|
| V2.1 paneli: `feed_broken`, `departing_unanswered`, `unanswered_aging`, `recurring_issue`. Salt okuma, sakin günde hiç görünmez, her satırda kesinlik derecesi (`certainty`) | tamamlanmış | [K] `src/modules/intelligence/incidents/attention.ts`, `src/components/attention-panel.tsx`, `src/app/(app)/dashboard/page.tsx:115,219` · [T] `tests/integration/attention-feed.test.ts`, `tests/unit/attention-qr-conversation-href.test.ts` · [B] CLAUDE.md "V2.1 CANLI (09-09)", `f1859d7` | Satırların canlıda gözlendiğine dair kayıt yok |
| `calendar_conflict` satırı (mülk başına tek satır, önem kanıta göre) | canlı doğrulanmamış | [K] `attention.ts:238,348-410`, `src/modules/availability/conflicts.ts:40` · [T] `attention-conflict-leg-failure`, `availability-engine` | `7695716` yerel origin ref'inde var |
| Para etkisi (yalnız çakışma satırında; ev sahibinin girdiği gecelik aralıktan; sonuç ARALIK, güven en fazla orta; bilinmiyorsa rakam yok) | canlı doğrulanmamış | [K] `money/impact.ts:109`, `money/rates.ts`, `api/properties/[id]/nightly-rate/route.ts` · [T] `tests/unit/money-impact.test.ts`, `tests/integration/attention-money.test.ts` · `docs/V2-PARA-ETKISI-2026-09-24.md` | Herhangi bir ev sahibinin aralık girdiğine dair kayıt yok |
| `held_request` satırı ve konuşma öğeleri ("Size bırakılan istek") | bayrak arkasında · canlı doğrulanmamış | [K] `src/lib/conversation-items/` (`flag.ts`: `AI_CONVERSATION_ITEMS_ENABLED` ve anlama katmanı birlikte açık olmalı), `store.ts:377` · [T] `conversation-items-*` (7 unit, 3 integration) · [B] migration 56 prod'da (09-28 provasında "ASSERT migration=57"); kurucu beyanına göre bayrak açık | Tasarım belgesinin başlığı hâlâ "bayrak KAPALI" diyor (çelişki). Belgedeki "CI + Railway teyidi aşağıya" bölümü boş kalmış |
| K7: otomatik mesajımız senkronla geri gelince "ev sahibi cevabı" sayılmasın (cevapsız ve tutulan satırların doğruluğu için) | kısmen uygulanmış | [K] `src/lib/automated-sends.ts`, `src/lib/message-author.ts`, migration `58_automated_message_send`, `attention.ts:218`. Hepsi YALNIZ yerel dalda · [B] `docs/INCELEME-2026-09-30-codex-ve-ajanlar.md` K7: "yedek onayı bekliyor" | Canlıdaki hata: ev sahibine tutulan IBAN öğesi, otomatik giriş mesajı gidince "Yanıtladınız" görünür |
| KB boşluğu önerileri (A3) | kısmen uygulanmış | [K] `recommendations/kb-gaps.ts:108`; `src/` içinde çağıranı yok · [T] `tests/integration/kb-gaps.test.ts` | Yüzey kurucu kararıyla kaldırıldı (09-11) |
| Öncelik puanı, "Bugün risk altında ₺…" portföy toplamı, paraya göre sıralama | yalnız tasarım | Kurucu metni 154–176. satırlar; V2 belgesi §5.1 (bilerek yapılmadı) · [K] `severity` yalnız sıralama anahtarı (`attention.ts:113-114`) | |
| Diğer satırlar için para etkisi (boş gece, iptal, geç çıkış satışı) | yalnız tasarım | V2 belgesi §1 ve §5.3 (V7 ve doğrulanmış müsaitlik gerekiyor) | |
| Misafire verilen sözün takibi (GUEST COMMITMENT) | yalnız tasarım | Kurucu metni 143–151. satırlar · [K] çıktı vetosu makbuzsuz sözü ENGELLİYOR, ama verilen sözü takip etmiyor | |
| Satırı kapatma ya da erteleme (ack) | yalnız tasarım | [K] `Signal.resolvedAt` alanı var, yazan kod yok | |
| "HIGH RISK" hazırlık satırı ve "[Create tasks]" düğmesi | yalnız tasarım | Kurucu metni 113–127. satırlar | Önce V5 ve V3 gerekiyor |

**Eksik:**
- Kurucunun verdiği üç örnek satırın (HIGH RISK, REVENUE LEAK, GUEST COMMITMENT) hiçbiri yok.
- Para etkisi her uyarıda değil, yalnız çakışmada var.
- Öncelik puanı ve portföy toplamı bilerek yapılmadı.
- Satırların durumu kalıcı değil (kapatılamıyor).
- Ek satırlar (çakışma, para, tutulan istek) canlı trafikte hiç görülmedi.

## V3 — Actions + Tasks
**Tanım:** Yapay zekâ öneriden operasyona geçer. Önerilen görevler tek tıkla ya da otomatik oluşur (sorumlu, vade, gerekli kanıt ve
gerekçeyle); eylemler güvenli biçimde yürütülür.

| öğe | durum | kanıt | not |
|---|---|---|---|
| Görev çekirdeği: Kanban, konaklama yaşam döngüsü görevleri, eksik temizlik görevlerini tamamlama, personel görünümü, durum ve geçmişin tek işlemde yazılması (C-17), görevin rezervasyon tarihini izlemesi (C-16) | tamamlanmış | [K] `schema.prisma:696-774`, `src/lib/tasks/*`, `src/app/api/tasks/*`, `src/app/(app)/tasks` · [T] `tasks-route`, `task-follows-reservation`, `tasks-staff-privacy`, `tasks-staff-view`, `task-origin` · [B] CLAUDE.md "Mevcut özellikler" | V-fazlarından önce vardı |
| Misafir mesajından operasyon görevi (bakım, ikmal, temizlik; aynı gün aynı konu tek görev) ve ek malzeme talebi | tamamlanmış | [K] `tasks/detect.ts`, `tasks/create.ts`, `src/lib/supply.ts` · [T] `task-from-message`, `task-detect`, `supply-plan` | Kelime ağıyla çalışıyor; sinyale ya da örüntüye bağı yok |
| Personel daveti ve rol atama akışı | yalnız tasarım | [K] Ürün içinde personel kullanıcısı oluşturan bir uç yok: `admin/customers` yalnız `owner` oluşturuyor, personel yalnız demo verisinde var · CLAUDE.md: "temizlikçi davet (kurucu onayı)" | Görev atama alanı gerçek kiracılarda fiilen boş |
| Doğrulanmış erken giriş onayı (kural `auto` + iki model aynı saati okudu + hazırlık kanıtı → metni kod kurar) | bayrak arkasında · canlı doğrulanmamış | [K] `src/lib/early-checkin/` (modlar `off/draft/auto`: `core.ts:30`), `api/properties/[id]/early-checkin-rule` · [T] `early-checkin`, `-evidence`, `-policy`, `-workflow`, `-scenarios`, `-recheck` · [B] CI 1150 ve 1152 (`docs/ERKEN-GIRIS-FINAL-RAPOR-2026-09-24.md` §V) | Bugünkü tek otomatik "güvenli eylem". Kural her mülk için varsayılan olarak kapalı; açan ev sahibi kaydı yok |
| Hazır taslak, "Açık işler" kartı, öğeyi tamamlama (PATCH) | bayrak arkasında | [K] `conversation-items/prepared-draft.ts`, `src/components/inbox/conversation-items-card.tsx`, `api/conversations/[id]/items/[itemId]/route.ts` | V2'deki bayrağın aynısı |
| Eylem beyanı `claimedActions` (makbuzu olmayan eylem iddiası tutulur) | bayrak arkasında | [K] `src/lib/ai/action-claims.ts:49` (`AI_ACTION_CLAIMS_ENABLED`) | Bu bir yürütücü değil, koruma. `actionReceipt` yalnız yorumda geçiyor (`output-veto.ts:39`) |
| `AutomationRule` üzerinden genel kural motoru | kısmen uygulanmış | [K] Şemada `triggerType` ve `actionJson` var. Tablo yalnız erken giriş ve ev kuralları için depo olarak kullanılıyor (`early-checkin/rules.ts`, `house-rules/store.ts`) | |
| AI Action Engine: öneriden görev (sorumlu, vade, gerekli kanıt, gerekçe); "Create all recommended tasks" | yalnız tasarım | Kurucu metni 178–208. satırlar | |
| Host Karar Motoru / Host Copilot (`DecisionRequest`) | yalnız tasarım | `docs/HOST-COPILOT-GEREKSINIMLERI-2026-09-25.md` ("UYGULANMADI"), `docs/ONAY-HOST-COPILOT-FAZ0-2026-09-25.md` ("ONAY BEKLİYOR", 09-30'da değişmedi) · [K] `DecisionRequest` ne `src/` ne `prisma/` içinde var | |
| Görev olaylarının `IngestEvent`e girmesi (`task.completed`, bakım sinyali) | yalnız tasarım | [K] `IngestEventKind` görev türü içermiyor (`src/lib/ingest/events.ts:44-53`) · V1 tasarımı §7 | |

**Eksik:**
- Öneriden görev üreten motor.
- Görevde "gerekli kanıt" alanı.
- Görevin gerekçe bağı (sinyal ya da örüntü → görev).
- Ev sahibi karar kartı.
- Personel daveti.
- Görev olayları intelligence katmanına akmıyor.

## V4 — Proof AI
**Tanım:** Görev fotoğraflı kanıtla tamamlanır. Fotoğraf, mülke özgü referans duruma karşı bir görüntü modeliyle değerlendirilir ve puan
alır.

| öğe | durum | kanıt | not |
|---|---|---|---|
| Görev güncellemesine fotoğraf (özel depolama, org kapsamı, yalnız göreve atanmış personel) | tamamlanmış (ön koşul) | [K] `TaskUpdate.photoUrl`, `src/app/api/tasks/[id]/route.ts:49-54` · [T] `storage-photo-lifecycle`, `upload-hardening` · [B] `STORAGE_ENABLED=1` "kanıtlı canlı" | Görevi tamamlamak için fotoğraf ŞART değil [K] |
| Görev kontrol listesi (`checklistJson`) | tamamlanmış | [K] `api/tasks/[id]/route.ts`, `src/lib/automation.ts:1047-1074` | |
| "Onay bekliyor" (`awaiting_review`) durumu | kısmen uygulanmış | [K] `src/lib/constants.ts:103-107`. Kanban'da sütunu yok, formda gizli (`task-board.tsx:35`, `task-form.tsx:124`) | Eski ("legacy") durum |
| Kimliği belli kişinin "bitti" kaydını kanıt sayan model (erken giriş için) | canlı doğrulanmamış | [K] `src/lib/early-checkin/readiness.ts` · `docs/ERKEN-GIRIS-KANIT-MODELI-2026-09-24.md` | Kanıt fotoğraf değil; kişi ve son durum kaydı |
| Referans durum, görüntü analizi, denetim puanı, fotoğrafsız tamamlanamama | yalnız tasarım | Yalnız kurucu metni (209–234. satırlar); `docs/` altında ayrı tasarım belgesi yok · [K] `src/` içinde görsel girdili model çağrısı yok | |

**Eksik:**
- V4'ün özü tamamen eksik: referans fotoğraf deposu, görüntü modeli çağrısı, puan, onay akışı.
- Ön koşul olan personel daveti (V3) yok.

## V5 — Reservation Risk / Readiness
**Tanım:** Her rezervasyona özgü bir hazırlık ve risk modeli. Girdiler: mülk geçmişi, misafir özellikleri, operasyon hazırlığı, açık
sözler, bilinen olaylar. Sonuç: hazır ya da değil.

| öğe | durum | kanıt | not |
|---|---|---|---|
| Erken giriş için hazırlık kanıtı; temizlik bitince isteğin yeniden değerlendirilmesi | canlı doğrulanmamış | [K] `early-checkin/readiness.ts`, `load.ts`, `recheck.ts`, `scheduled-sync.ts:623` · [T] `early-checkin-evidence`, `early-checkin-recheck`, `scheduled-sync-early-checkin-recheck` | Yalnız bir erken giriş isteği geldiğinde hesaplanıyor |
| Konuşma sayfasında önceki ve sonraki geceler (yalnız ev sahibi görür) | canlı doğrulanmamış | [K] `src/modules/availability/stay-edges.ts`, `stay-edges-load.ts`, `src/app/(app)/inbox/[id]/page.tsx:31` · [T] `availability-stay-edges` (unit ve integration) | Yapay zekâya bağlı değil. Prod'da takvim kaynağı 0 olduğu için boş gece "bilinmiyor" görünür [B] |
| Hazırlık sayfası (yaklaşan konaklamalar için ikmal planı ve AI özeti) | tamamlanmış | [K] `src/app/(app)/hazirlik`, `src/lib/supply.ts:115` `getPrepPlan`, `api/hazirlik/*`, `src/lib/nav.ts:30` · [T] `supply-plan`, `hazirlik-stock-route`, `supply-ai` | V-fazlarından önce vardı; risk puanı vermiyor |
| Mülk kurulum hazırlığı rozeti (KB ve kanal) | tamamlanmış | [K] `src/app/(app)/properties/page.tsx:37-60` | Rezervasyona özgü değil |
| `departing_unanswered` satırı | tamamlanmış | V2.1'in parçası | |
| Rezervasyon risk modeli ve puanı, misafir ihtiyacı tespiti, "giriş yaklaşıyor" proaktif uyarısı, açık sözler | yalnız tasarım | Kurucu metni 305–360. satırlar; V1 tasarımı §8 ("❌ V2/V5") · [K] kodda karşılığı yok | |

**Eksik:**
- Rezervasyona özgü hazırlık ya da risk puanı.
- Misafir ihtiyaçlarının tespiti.
- Yaklaşan giriş ile bilinen sorunu birleştiren uyarı.
- Hazırlığı gösteren bir yüzey.

## V6 — Review + Recurring Issue Brain
**Tanım:** Yorum zekâsı (5 yıldızlı yorumdaki gizli olumsuzluğu bulma) ve tekrar eden sorunları kümeleme (misafir bildirimi ve bakım
kaydı birlikte). Kök neden önerisi.

| öğe | durum | kanıt | not |
|---|---|---|---|
| Örüntü hafızası (V1) | canlı doğrulanmamış | [K] `memory/patterns.ts` | Ayrıntı V1'de |
| `recurring_issue` panel satırı (son 30 günde gözlenen örüntü) | canlı doğrulanmamış | [K] `attention.ts:73,332-346` | "otomatik sınıflandırma, doğrulayın" diye işaretli |
| Mülk grafı ve `recurringIssues` (bildirim ile görev kanıtını eşler: `reported_only`, `task_open`, `task_done`; "confirmed" sınıfı yok) | kısmen uygulanmış | [K] `graph/property-graph.ts:103,246`; `src/` içinde çağıranı yok · [T] `tests/unit/property-graph.test.ts`, `property-graph-synthetic.test.ts` | Saf fonksiyon; yüzeyi yok, bayrağı yok. Misafir yoluna girmez |
| Yorum alımı, `Review` tablosu, gizli olumsuzluk, yoruma cevap | yalnız tasarım | [K] Şemada `Review` yok (değişmez 12). Manifestoda `reviews.read` Hospitable için `unavailable`, Airbnb Direct için `planned` (`manifests.ts:81,107`) | Yorumların geleceği bir kaynak yok |
| Kök neden ajanı, eğilim (trend), kategoriler arası kümeleme, bakım görevleriyle birleştirme | yalnız tasarım | Kurucu metni 235–304. satırlar | |

**Eksik:**
- Yorum alımı (kaynağı yok).
- İnce kategori; bugünkü kategori genel "complaint" düzeyinde.
- Kök neden analizi.
- Graf fonksiyonunun bağlandığı bir yüzey.
- Bakım olaylarının sinyal olarak girmesi.

## V7 — Revenue Brain
**Tanım:** Boş gece, rezervasyon hızı (pacing), minimum konaklama ve gecelik ortalama fiyat (ADR) fırsatlarını tutar aralığı ve güvenle
öneren gelir beyni.

| öğe | durum | kanıt | not |
|---|---|---|---|
| Ev sahibinin girdiği tipik gecelik fiyat aralığı (`PropertyMemory source=human`, 180 günde bayatlar) | canlı doğrulanmamış | [K] `money/rates.ts`, `nightly-rate` rotası, `components/properties/nightly-rate-form` | Yalnız V2 çakışma tutarında kullanılıyor. Yapay zekâya gitmiyor (pin: `money-impact.test.ts`) |
| Kanaldan fiyat ve tutar verisi | yalnız tasarım | [K] Manifestoda Hospitable `rates.read: unavailable` (`manifests.ts:80`), Airbnb Direct `rates.read/write: planned` · [B] `financials:read` kapsamı yok; `totalAmount` pratikte boş; para birimi bilinmeyince "EUR" yazılıyor (V2 belgesi §1) | |
| Fırsat tespiti (sahipsiz boşluk, rezervasyon hızı, minimum konaklama, ADR, etkinlik tarihleri, rakip fiyatı) ve öneri + güven | yalnız tasarım | Kurucu metni 385–426. satırlar; V2 belgesi §5.3 | Ön koşul: doğrulanmış müsaitlik |

**Eksik:** V7'nin kendisi tamamen eksik. Kullanılabilir tek fiyat girdisi, ev sahibinin elle girdiği aralık.

## V8 — Ask Lixus → Action
**Tanım:** Ev sahibi doğal dille soru sorar. Cevap canlı veriye dayanır ve gerekçelidir. Cevaptan sonra onaylı bir eylem (görev ya da
karar) gelir.

| öğe | durum | kanıt | not |
|---|---|---|---|
| Doğal dil soru → gerekçeli cevap → onaylı eylem | yalnız tasarım | Host Copilot gereksinim belgesi §4 ve §14: Faz 3 (salt okuma sorgular), Faz 7 (gerçek eylem ve makbuz) · [K] `src/` içinde ev sahibine yönelik bir sohbet ya da sorgu ucu yok. `api/ai/test` yalnız cevap önizlemesi, `api/hazirlik/summary` tek amaçlı bir özet | Kurucu: "her şeyi bitirince bakarız" |

**Eksik:**
- V8'in tamamı.
- Önce V3'ün eylem yürütücüsü ve makbuzu gerekiyor.

## Çapraz öğeler: hangi faza ait?
**Availability Engine (④).** Katkı yeri: V2 (çakışma satırı), V5 (komşu geceler; erken girişte "dün gece boş" kanıtı) ve yapay zekâ kapısı.

| öğe | durum | kanıt | not |
|---|---|---|---|
| Saf çekirdek, tek tarih kuralı (`calendarDateOf`) ve yükleyici | canlı doğrulanmamış | [K] `src/modules/availability/core.ts:77,327`, `load.ts`. Tarih kuralı ürün yollarında kullanılıyor (automation, outbox worker, reports, guest-chat, prompts) · [T] `availability-core`, `availability-engine`, `availability-partial-source` · `docs/MUSAITLIK-MOTORU-2026-09-24.md` | Yerel origin ref'inde var. Prod'da takvim kaynağı 0, yani "boş" hükmü hiç üretilemez [B] |
| Müsaitlik vetosu (kelime ağı yalnız yedek; model beyanı, bekçi ve anlama katmanı) | canlı doğrulanmamış | [K] `src/lib/ai/availability-claims.ts` · [T] `availability-claims.test.ts`, `ai-suggest-availability.test.ts` · [B] mühürlü final eval geçti; iki bayrak 09-25'te açıldı | 09-19'dan beri canlı mesaj yok [B] |
| Motorun yapay zekâya araç olarak bağlanması (`verifiedToolResults`) | yalnız tasarım | [K] Yalnız yorumda geçiyor (`availability-claims.ts:39-47`) | |
| Besleme tazeliği kanıtı (`feedLastSeenAt`) | bayrak arkasında | `ICAL_DISAPPEARANCE_RECONCILE_ENABLED` bilerek kapalı. Bu yüzden besleme iddiaları "kanıtsız" sayılıyor | |
| Kanal yeteneği olarak `availability.read/write` | yalnız tasarım | Manifestoda Airbnb Direct için `planned` | |

- **Host Copilot:** V3 (karar kartı, Faz 1) ve V8'e (sorgular ve eylem, Faz 3 ve 7) ait. Durumu: yalnız tasarım; Faz 0 onayı bekliyor.
- **Konuşma öğeleri (`ConversationItem`):** V2'ye (`held_request` satırı) ve V3'e ait ("Açık işler", hazır taslak; Host Karar
  Motoru'nun zemini). Durumu: bayrak arkasında ve canlı doğrulanmamış.
- **Doğrulanmış erken giriş:** V3 (tek güvenli eylem) ve V5 (hazırlık kanıtı).

## V2 kalanları ve V3 için küçük, uçtan uca dilim adayları (yalnız aday listesi; karar kurucuda)
**Yeni dilim olmayan bekleyen iş:** K7'nin yayını (migration 58). Kod yerel dalda; taze yedek ve açık onay bekliyor. V2.1'deki cevapsız ve
tutulan satırların doğruluğunu doğrudan etkiliyor [B].

Aşağıdaki üç aday da müşteriye görünen yeni metin içeriyor. CLAUDE.md'ye göre metin önce/sonra örnekleriyle kurucuya sorulur; hiçbiri
sorulmadan kurulmaz.

**Aday A — Tekrar eden sorundan tek tıkla kontrol görevi (V2 → V3)**
- **Kullanıcı değeri:** Ev sahibi "Dikkat Gerektirenler"deki tekrar eden sorun satırından o daire için tek tıkla bakım/kontrol görevi
  açar; satır görevin açık mı bitmiş mi olduğunu gösterir.
- **Dayandığı kod:**
  - `attention.ts` `recurring_issue` satırı (örüntünün `evidenceJson`u).
  - `Task` modeli: `type: maintenance`, `dedupeKey` (indeksli), `description`, `origin`.
  - `POST /api/tasks` (`withManage`, `origin: "manual"`).
  - `tasks/create.ts`teki tek görev (dedupe) deseni.
  - `property-graph.ts` `recurringIssues`'taki kanıt sınıfları (bugün çağıransız).
- **Eksik:**
  - Satırdan görev oluşturan düğme ve kiracı kapsamlı bağ.
  - Örüntü ile görev arasında şemasız bağ (ör. `dedupeKey`de örüntü anahtarı).
  - Satırda görev durumunun okunması.
  - Görev başlığı ve açıklaması (müşteriye görünen metin).
  - Personel olmadığı için atama çoğu kiracıda boş kalır.
- **Kısıt:** Kategori kaba ("complaint"), yani görev metni ince bir teşhis iddia edemez.
- **Boyut:** S–M. **Migration:** gerekmiyor gibi görünüyor (mevcut kolonlar yeterli; doğrulanmalı).

**Aday B — Örüntüyü "giderildi" olarak işaretleme (V2 kalanı: satırı kapatma + değişmez 13'teki insan düzeltmesi)**
- **Kullanıcı değeri:** Ev sahibi sorunu giderince tekrar eden sorun satırını kapatır. Satır yalnız işaretten SONRA yeni olumsuz sinyal
  gelirse geri döner.
- **Dayandığı kod:**
  - `PropertyMemory` alanları `humanOverrideAt`, `humanOverrideUserId`, `status` (şemada var; bugün yalnız gecelik fiyat yazıyor:
    `money/rates.ts:117`).
  - `memory/patterns.ts` `refreshPatternMemory`.
  - `attention.ts`teki örüntü sorgusu.
  - Ev sahibinin girdiği kayıtlar veri dışa aktarımına `hostEnteredFacts` üzerinden giriyor (`src/lib/data-export.ts:74`).
- **Eksik:**
  - `refreshPatternMemory` her geçişte `status: "active"` yazıyor (`patterns.ts:55`) ve insan düzeltmesini siler. "İşaretten sonra gelen
    sinyal sayısı" kuralı gerekiyor.
  - Uç ve denetim kaydı.
  - Kart ya da panel düğmesi.
- **Boyut:** S–M. **Migration:** gerekmiyor gibi görünüyor.

**Aday C — "Yakında giriş var, tekrar eden sorun açık" satırı (V2/V5 köprüsü; kurucunun kendi örneği, talimat 99–104. satırlar)**
- **Kullanıcı değeri:** Önümüzdeki 24–48 saat içinde girişi olan ve aktif tekrar eden sorun örüntüsü bulunan daire için, örüntüden sonra
  kapanmış bir kontrol görevi yoksa panel uyarı verir.
- **Dayandığı kod:**
  - `attention.ts` (`ATTENTION_KINDS`e yeni tür, sakin gün kuralı).
  - `PropertyMemory` örüntüleri.
  - `Task` modeli (maintenance, `propertyId`, `reservationId`, `status`).
  - `src/lib/day-where.ts` (tek gün kuralı; ham `gte` kıyası yasak).
  - Panelin mevcut `arrivalsRaw` sorgusu (`dashboard/page.tsx:54`).
- **Eksik:**
  - Yeni satır türü, önem sırası ve metin.
  - "Kontrol yapıldı" kanıtının tanımı (hangi görev türü, hangi tarihten sonra).
  - Kaba kategori yüzünden "sıcak su testi" gibi özgül bir öneri yapılamaz.
- **Boyut:** S–M. **Migration:** gerekmiyor gibi görünüyor.

## Bu oturumda doğrulanamayanlar
- Railway'deki bayrak değerleri ve yayındaki commit.
- 09-28'den sonraki prod sayıları.
- Herhangi bir ev sahibinin gecelik aralık girip girmediği ya da erken giriş kuralını `auto` yapıp yapmadığı.
- Migration 56'nın yayınından sonraki CI ve Railway sonucu. Belgede boş kaldı; migration 56'nın uygulandığı yalnız dolaylı olarak, 09-28
  provasından biliniyor.
