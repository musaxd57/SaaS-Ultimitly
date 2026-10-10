# Yol planı durum çizelgesi — 2026-10-09

> Kaynak: kurucu talimatı `docs/KURUCU-TALIMATI-2026-09-07-urun-vizyonu-ve-degismezler.md` (bağlayıcı; çelişkide o kazanır).
> Kurucu (10-09): "O mesajda sıralama nasılsa öyle ilerle; yaptıklarını tekrar yapma; kontrol edebilirsin; didik didik ilerle."
> Her satır kodda doğrulandı (dosya:satır). Hospitable Airbnb Direct production-ready olana kadar KALIR (talimat: "dakikasında değil").

## 1. Yürütme sırası (talimatın "CURRENT TASK AND EXECUTION ORDER" bölümü)

| Sıra | Madde | Durum |
|---|---|---|
| ① | Codex denetimi kritik bulguları | ✅ (`docs/audit-2026-09-05/DURUM.md`) |
| ② | Test sözleşmesi | ✅ `docs/TEST-EVIDENCE-CONTRACT.md` |
| ③ | V0 Channel Independence | 🟡 V0.1–V0.7 kod ✅ — **kalanlar §2** |
| ④ | Deterministik Availability Engine | 🟡 çekirdek + panel + konuşma sayfası ✅; **araç sonucu sözleşmesi ✅ 10-09** (`ai/tools/`, bayat / belirsiz kesin olamaz, kapsam zorunlu); isteme bağlama: kurucu onayıyla (10-09) **doğrulanmış müsaitlik / uzatma KOD METNİ ✅** (kanal + QR; anahtarlar KAPALI — açma = kurucu + ilk denemeler); karışık mesajda (müsaitlik + başka soru) bugün ev sahibine kalır |
| ⑤ | Geniş otonom AI | ⛔ ④ ve korumalar doğrulanmadan yok |

Ürün fazları: V1 ✅ canlı · V2 🟡 ("Dikkat Gerektirenler" + çakışmada para aralığı) · V3–V8 başlamadı.
Talimat: "V0 gerçekten kurulmadan V1'e geçme" → önce §2 kapatılır.

## 2. V0 kalanları (kodda ölçüldü 10-09)

| # | Madde (değişmez) | Durum | Kanıt | Migration? |
|---|---|---|---|---|
| a | Çekirdek kimlik bilgisini kendisi çözüyor (değişmez 1, 4/9, 20) | ✅ **V0.8** (`channels/access.ts`) — eskiden: | `automation.ts:164` (5 çağrı), `host-send.ts:7`, `outbox/worker.ts:10`, `reservations-cleanup.ts:5`, 6 panel sayfası `getConnectionInfo` | Hayır |
| b | Mimari pin: çekirdekte sağlayıcı importu (20) | ✅ **V0.8**: bütün `src/` taranır, gerekçeli izin listesi (kalan: `scheduled-sync` yoklayıcı kaydı) | `tests/unit/core-channel-independence.test.ts` | Hayır |
| c | Mimari pin: kanal dizesinden yetenek çıkarımı (20) | ✅ **V0.9** pin (mutasyon 2/2); çekirdekte ihlal yoktu | `channels/capability.ts:35,46` tek kaynak ama pinsiz | Hayır |
| d | Org kolonlarını okuyan son yerler (V0.7 contract ön koşulu) | ⏸ BEKLİYOR: operatör planı Aşama 1–3 (canlıda bağlantı satırına geçiş + okuma anahtarı ≥2 hafta) önce gelir; Railway kapalı. Şimdi satır-tek-kaynağa almak satırı olmayan org'u kırar | `hospitable-token-diagnostics-core.ts:146-169`, `channels/connections.ts:218-241`, `scheduled-sync.ts:371,382`, `unverified-sweep.ts:169-216`, `demo-tenant/apply-core.ts:72-79`, `admin/page.tsx:35,151` | Kod hayır; DROP evet (operatör planı) |
| e | Webhook girişi aynı yazma servisine (7) | ⏸ BİLİNÇLİ: köprüye webhook yazılmaz (`channels/manifests.ts:79`); Airbnb Direct'te `planned`. Sandbox / resmî doküman olmadan rota = kullanılmayan arayüz (talimat yasaklar, değişmez 18) | `api/webhooks/` yalnız `paddle` | Belki |
| f | Bağlantı sağlığı sinyali (sağlayıcıdan bağımsız) (9) | 🟡 yalnız saklı durum | `hospitable-connect-card.tsx:120-126` | Belki |
| g | Ham platform korunmuyor (`toChannel`) (2) | 🟡 migration 60 İTİLDİ (10-10): `Reservation.sourcePlatform` + yazıcı (`sourcePlatformOf`, `CHANNEL_METADATA_WRITE` arkasında, KAPALI) | `channels/hospitable-ingest.ts:126`, `channels/ingest.ts:190` | — |
| h | `Property.hospitableId` global unique (3) | 🟡 migration 60 İTİLDİ (10-10): bağlantı kapsamlı `ChannelListing` + çift yazım (`CHANNEL_METADATA_WRITE`, KAPALI); OKUMA geçişi KODDA (10-10, `CHANNEL_LISTING_READ` KAPALI — satır yoksa `hospitableId`e düşer; açmak = kurucu onayı + çift yazım canlıda koşmuş olmalı); `hospitableId` tekilliği geçiş boyunca durur (DROP = operatör planı) | `channels/metadata.ts`, `prisma/schema.prisma:1522` | DROP evet |

## 2b. 20 teknik değişmez — pin eşlemesi (10-10, Haiku taraması + kodda doğrulandı)

| Durum | Değişmezler |
|---|---|
| ✅ güçlü pin | 1 (`core-channel-independence`), 5 + 18 (`channel-manifest`, `airbnb-direct-adapter`), 7 (`ingest-write-service` + tek yazıcı pini), 8 (`outbound-dispatch-guards`, `outbox`, `outbound-classification-parity`), 15 (`money-impact`, `attention-money`), 17 (iki uyum kiti + kit dışı yaşam döngüsü testleri) |
| ✅ 10-10 büyüyemez liste | **3** (dış kimlik bağlantı kapsamsız eşsiz değil — 4 bilinen ihlal + 1 kapsam dışı gerekçeli) · **20** (çekirdekte `hospitable*` şema alanı — 7 gerekçeli dosya; kanal dizesi yasağı V0.9) — `channel-invariants-ratchet.test.ts`, mutasyon 3/3 |
| 🟡 kısmi | 2 (bağlantı + ilk alınma pinli; tazelik yok), 4 (ayrı ilan pinli), 6 (motor tarafı), 9 (bağlantı yaşam döngüsü; sağlık alanı migration 60), 10 (dolaylı), 13 (kanıt / observedAt pinli), 14 (veri politikası alanı), 16 (statik kapsam taraması + 8 davranışsal tutamaç) |
| — özellik yok | 11 (Issue), 12 (Review) |
| ⏸ süreç | 19 (rollout sırası — kod değil, kurucu / operatör süreci) |

## 3. Airbnb başvurusu öncesi 6 kapı

| Kapı | Durum |
|---|---|
| 1 Channel independence + boş Airbnb Direct sözleşmesi | 🟡 sözleşme ✅; §2 kalanları |
| 2 Hospitable'sız Lixus | ✅ 10-09 (kurucu kararı): rehberin ilk adımı "Rezervasyonlarınızı bağlayın" kanal YA DA takvim bağlantısıyla tamamlanır; bağlantısız hesapta "Mesajları çek" gizli. Yapay zekâ günlük özeti: **ŞİMDİLİK YOK** (kurucu 10-09; V8 Ask Lixus ile tasarlanır). Eski bulgu: başlangıç rehberinde iCal adımı yok, rehber tamamlanamaz (`dashboard/page.tsx:107-167`); bağlantısız hesapta "mesajları çek" düğmesi ölü (`inbox/page.tsx:248`); "bağlantı kurulunca daireleriniz otomatik gelir" metinleri (`dashboard:121`, `properties:76-79`); yapay zekâ günlük özeti 08-08'de bilerek kaldırıldı (`dashboard:211-228`) — talimatla çelişiyor, **kurucu kararı** |
| 3 Güvenlik katmanı | 🟡 MFA, RBAC, denetim kaydı, şifreli sırlar, webhook imzası (Paddle), idempotency, hız sınırı, silme / dışa aktarma, yedek provası var; çeyreklik zafiyet taraması / olay müdahalesi + KVKK ihlal bildirimi / erişim gözden geçirme süreçleri **TASLAK ✅ 10-10** (`docs/GUVENLIK-SURECLERI-2026-10-10.md`; kurucu + avukat onayı); zamanlanmış tarama = kurucu adımı (`main`e tek dosya) |
| 4 Demo hesabı | 🟡 üretici kodda (`docs/DEMO-HESABI.md`), canlıya koşulmadı (Railway kapalı) |
| 5 Gerçek kullanım kanıtı | ⛔ kurucu org Hospitable aboneliği 402, Railway kapalı |
| 6 Entegrasyon dosyası | 🟡 taslak ✅ `docs/AIRBNB-INTEGRATION-DOSSIER.md` (Haiku olgu denetimi uygulandı); [TBD]: kullanım rakamları, demo kimlik bilgisi |

Yasal metinler (`(legal)/entegrasyonlar`, ön bilgilendirme, gizlilik, koşullar) Hospitable'ı zorunlu gibi anlatıyor → avukat paketi; Claude değiştirmez.

## 4. Gelecek AI gereksinimleri (talimat: "V0 ve Availability Engine sonrası")

| Gereksinim | Durum |
|---|---|
| Ortak bağlam kurucu | 🟡 `selectHistoryForPrompt` ortak; QR bilinçli farklı (her mesaj anında cevaplanır, birikme yok); **>25 bekleyen mesaj kaydırma testi ✅ 10-09** (`pending-window-displacement`, mutasyon iki yönlü); tanı çıktısı = üretim izi (migration 60) |
| `conversationState` | 🟡 **sözleşme ✅ 10-09** (`ai/conversation-phase.ts` + `operator-replies.ts` `loadConversationPhase`): phase first_contact / ongoing / closing, hasPriorDeliveredReply, isFirstOperatorReply, deliveredReplyCount, unansweredGuestMessageCount, lastInteractionAt — konuşmanın TAMAMINDAN; misafire ULAŞMAMIŞ (iptal / başarısız / engellenmiş) giden mesaj selam sayımına girmez (`review` belirsiz → sayılır); otomatik şablon mesajı pencereyi sıfırlamaz; kapanış `closableAfter` ister. Kırmızı-önce + mutasyon + Haiku turu. **İsteme bağlanmadı** (kör eval + kurucu) |
| Eylem makbuzu | 🟡 beyan + kapı var (bayrak kapalı); makbuz üreten yürütücü yok |
| Araç çağrısı / `verifiedToolResults` | 🟡 sözleşme + müsaitlik aracı ✅ 10-09; modele araç olarak verilmesi kurucu onayı |
| Tarih çözümü üst verisi | ✅ 10-09 `ai/date-resolution.ts` (TR+EN; dayanak / güven / varsayım; 4 Haiku turu, 116 test, mutasyon 27/27); **istemde "tarih okuması" ✅ 10-10** (`ai/date-reading.ts`, anahtar `AI_DATE_RESOLUTION_ENABLED` kapalı; her mesaj kendi yazıldığı ana göre; gece yarısı "yarın"ı belirsiz; karar #10) |
| Zaman bağlamı (geçen süre, oturum arası, yeni gün) | 🟡 gün etiketi var; **aralık ✅ 10-09** (`interactionGap`: geçen dakika + org diliminde takvim günü farkı + yeni oturum = 6 saat sessizlik, kurucu kararı); isteme bağlanmadı |
| Kurucu AI Kalite Konsolu | ✅ migration 60 ile İTİLDİ (10-10; salt-okuma + etiket, 2FA'lı operatör, her görüntüleme kayıtlı) — Railway açılınca canlı |
| Üretim izi (model, istem sürümü, gecikme, token, maliyet) | 🟡 migration 60 ile İTİLDİ (10-10); `AI_GENERATION_TRACE_ENABLED` KAPALI; KVKK paritesi + okuyucu pini; maliyet sütunu boş — fiyat tablosu ayrı karar |
| 8 başlangıç senaryosu | ✅ set `evals/founder-initial-8.json` + seçici; ücretli taban koşusu onay |
| Açık taahhüt hafızası | ✅ ilk dilim (kurucu kararı A, 10-10; migration 62): ev sahibinin işaretlediği söz + bağlı görev + Dikkat Gerektirenler satırı (`docs/TASARIM-2026-10-10-acik-taahhut-hafizasi-onerisi.md` §Uygulama). Yapay zekâ cevabına girdi: AYRI karar (müşteriye giden metin) |

## 5. Çalışma sırası (bu turdan itibaren)

1. ✅ **V0.8** (10-09, `6a654f0`) — §2a + §2b: kimlik bilgisi ve bağlantı durumu kanal katmanına; çekirdek sağlayıcı modülü import etmez (pin bütün `src/`). Migration yok, davranış birebir.
2. ✅ §2c pin (V0.9). ⏸ §2d operatör planına bağlı (↑).
3. ✅ Kapı 2 eksikleri (10-09): başlangıç rehberinde takvim (iCal) adımı, bağlantısız hesapta ölü düğme, yanıltıcı metinler (talimatın açık şartı; misafire giden mesaja dokunmaz).
4. §2f–h: üçü de migration (bağlantı sağlığı alanı · ham platform kolonu · bağlantı kapsamlı ilan kimliği tablosu) ve `channels/requirements.ts`te "canlı öncesi migration" diye listeli → tek migration paketi olarak kurucu onayına (taze `pg_dump` kuralı). §2e Airbnb sandbox'ına kadar kapalı.
5. ④ Availability Engine → yapay zekâya araç sonucu olarak bağlanması (sözleşme + kırmızı-önce).
6. Sonra V2 sonraki dilimleri ve §4.

Kurucu kararı bekleyen: yapay zekâ günlük özeti (08-08 kaldırma kararı ↔ talimat kapı 2).

## 6. 10-09 akşam — yapılanlar ve kurucu kararı bekleyenler

**Yapıldı (itildi, CI yeşil):** V0.8 kanal erişim katmanı · V0.9 kanal dizesi pini · kapı 2 (rehber + ölü düğme) · araç sonucu
sözleşmesi + müsaitlik aracı · tarih çözümü · kaydırma testi · kurucu 8 senaryo seti · Airbnb dosyası taslağı · migration 60 tasarımı.
Her orta / büyük değişiklik Haiku incelemesinden geçti (5 tur; bulguların çoğu kabul, gerekçeli retler commit mesajlarında).

**Kurucu kararları (10-09 akşam):** (1) migration 60 TAMAMI hazırlanacak, iz metni mesajlarla aynı saklamayla (push = taze yedek + onay) ·
(2) müsaitlik "doğrulanınca otomatik gitsin" → ✅ UYGULANDI (anahtar kapalı; kod metni, iki Haiku turu — `docs/claude/ai-guvenlik.md` sonu) ·
(3) 8 senaryo koşuldu: Luna `low` (cevap + anlama) ve 5.1 ikisi de sızıntı 0 / yanlış susturma 0; belirsiz müsaitlikte yalnız Luna (durum
açık) tek hedefli soru sordu (`docs/olcum/founder-initial-8-eval-2026-10-09-*`). Kurucu: "anlama katmanını Luna'ya geçir" → env:
`AI_UNDERSTANDING_MODEL=gpt-6-luna` + `AI_UNDERSTANDING_REASONING_EFFORT=low` (sıralayıcı `AI_SEMANTIC_MODEL=gpt-5.1`'de kalır).

**Kurucu kararları (10-09 gece):** (a) konuşma durumu → isteme bağlamadan ÖNCE ücretli kör eval koşulur, önce/sonra örnekleri kurucuya ·
(b) yeni oturum eşiği = **6 saat sessizlik** (`NEW_SESSION_GAP_MINUTES`; takvim günü değişimi tek başına yeni oturum değil) · (c) kalite
konsolu kaydı = **kapalı küme amaç + IP yok** (talimattaki "yazılı amaç + IP" yerine; 09-30 / 08-01 kuralları — migration 60 sapma 1–2
ONAYLI) · (d) QR'de doğrulanmış müsaitlik: kurucu "açalım ama bayrak olsun, bayrağı unutturma; QR'de vermek mantıklı mı konuşalım" →
analiz kurucuya sunuldu, karar bekliyor.

**Önceki liste (karar sonrası durum):**
1. Migration paketi 60 → ✅ KOD HAZIR (10-09 gece): yama `docs/hazir-yamalar/2026-10-09-migration-60-kanal-metaverisi-ai-izi-kalite-konsolu.patch`
   (ana dala `git apply` ile temiz uygulanır; `prisma/migrations/` dışında → açılışta UYGULANMAZ). Yama üstünde tam suit 13.526 yeşil + build;
   mutasyonlar 9+11+13+10/… hepsi öldü; üç Haiku turu. Uygulama durumu + 6 bilinçli sapma: yamanın içindeki tasarım belgesi "Uygulama durumu".
   Push = taze `pg_dump` + kurucu "push et".
2. ✅ Doğrulanmış müsaitlik (kanal; QR sonraki dilim).
3. ✅ `founder-initial-8` taban koşusu.
4. `conversationState` `phase` / `lastInteractionAt` alanlarının isteme girmesi (kör eval ister).
5. Haftalık zafiyet taraması için varsayılan dalın (`main`) güncel tutulması.
6. ✅ (10-09 gece, kurucu yokken karar #9) Müsaitlik motorunda `claimBasis` kaynak tazeliğine bakmıyordu → panel çakışma önemi bayat
   kaynakta da "kesin 97". Motor 2: son okuması 6 saatten eski kaynağın satırı "taze iddia" değil (panel 70 / çıkarım); araç sözleşmesi 3.
7. V2 sonraki dilimleri / V3 eylemler / V5 hazırlık puanı: yeni ürün yüzeyleri — kapsam ve örnekle sorulacak.
