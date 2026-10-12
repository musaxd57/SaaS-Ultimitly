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
| ⑤ | Geniş otonom AI | 🟡 **ilk dilim kodda (10-12, kurucu "A + B + C", anahtar `AI_ACTION_SUGGESTIONS_ENABLED` KAPALI)**: görev / Wi-Fi bilgi tabanı düzeltmesi / söz kaydı ÖNERİSİ, sahip + yönetici tek tıkla onaylar (`lib/ai-suggestions/`); misafire hiçbir şey gitmez, otomatik eylem YOK. Ölçüt (2 hafta, ≥ 10 karar, ≥ %90 düzenlemesiz onay) yalnız ölçülür — otomatiğe geçiş ayrı karar + anahtar. Geniş otonomi ⛔ (④ korumaları canlıda doğrulanmadan) |

Ürün fazları: V1 ✅ canlı · V2 🟡 ("Dikkat Gerektirenler" + çakışmada para aralığı) · V3–V8 başlamadı.
> **10-12 gece düzeltmesi (Haiku denetimi):** "V3–V8 başlamadı" eksik — ⑤ ilk dilim V3'ün kapsamına girer (yapay zekâ önerisinden tek tıkla onayla görev / söz / bilgi tabanı kalemi oluşturma, `lib/ai-suggestions/act.ts`; anahtar `AI_ACTION_SUGGESTIONS_ENABLED` KAPALI). V4–V8 başlamadı.
Talimat: "V0 gerçekten kurulmadan V1'e geçme" → önce §2 kapatılır.

## 2. V0 kalanları (kodda ölçüldü 10-09)

| # | Madde (değişmez) | Durum | Kanıt | Migration? |
|---|---|---|---|---|
| a | Çekirdek kimlik bilgisini kendisi çözüyor (değişmez 1, 4/9, 20) | ✅ **V0.8** (`channels/access.ts`) — eskiden: | `automation.ts:164` (5 çağrı), `host-send.ts:7`, `outbox/worker.ts:10`, `reservations-cleanup.ts:5`, 6 panel sayfası `getConnectionInfo` | Hayır |
| b | Mimari pin: çekirdekte sağlayıcı importu (20) | ✅ **V0.8**: bütün `src/` taranır, gerekçeli izin listesi (kalan: `scheduled-sync` yoklayıcı kaydı) | `tests/unit/core-channel-independence.test.ts` | Hayır |
| c | Mimari pin: kanal dizesinden yetenek çıkarımı (20) | ✅ **V0.9** pin (mutasyon 2/2); çekirdekte ihlal yoktu | `channels/capability.ts:35,46` tek kaynak ama pinsiz | Hayır |
| d | Org kolonlarını okuyan son yerler (V0.7 contract ön koşulu) | ⏸ BEKLİYOR: operatör planı Aşama 1–3 (canlıda bağlantı satırına geçiş + okuma anahtarı ≥2 hafta) önce gelir; Railway kapalı. Şimdi satır-tek-kaynağa almak satırı olmayan org'u kırar | `hospitable-token-diagnostics-core.ts:146-169`, `channels/connections.ts:218-241`, `scheduled-sync.ts:375,386` (10-12 gece güncel satır), `unverified-sweep.ts:169-216`, `demo-tenant/apply-core.ts:72-79`, `admin/page.tsx:51,183` (10-12 gece güncel satır) | Kod hayır; DROP evet (operatör planı) |
| e | Webhook girişi aynı yazma servisine (7) | ⏸ BİLİNÇLİ: köprüye webhook yazılmaz (`channels/manifests.ts:79`); Airbnb Direct'te `planned`. Sandbox / resmî doküman olmadan rota = kullanılmayan arayüz (talimat yasaklar, değişmez 18) | `api/webhooks/` yalnız `paddle` | Belki |
| f | Bağlantı sağlığı sinyali (sağlayıcıdan bağımsız) (9) | ✅ 10-10: `channels/health.ts` (okuma kaydından ok / bayat / hata; ölçüm yoksa hiçbir şey çizilmez) → Ayarlar satırı + Dikkat Gerektirenler satırı (kalıcı hata hemen, geçici hata yalnız bayatsa); yazıcı migration 60 `CHANNEL_METADATA_WRITE` arkasında (KAPALI) | `channels/health.ts`, `incidents/attention.ts` | migration 60 (itildi) |
| g | Ham platform korunmuyor (`toChannel`) (2) | 🟡 migration 60 İTİLDİ (10-10): `Reservation.sourcePlatform` + yazıcı (`sourcePlatformOf`, `CHANNEL_METADATA_WRITE` arkasında, KAPALI) | `channels/hospitable-ingest.ts:126`, `channels/ingest.ts:190` | — |
| h | `Property.hospitableId` global unique (3) | 🟡 migration 60 İTİLDİ (10-10): bağlantı kapsamlı `ChannelListing` + çift yazım (`CHANNEL_METADATA_WRITE`, KAPALI); OKUMA geçişi KODDA (10-10, `CHANNEL_LISTING_READ` KAPALI — satır yoksa `hospitableId`e düşer; açmak = kurucu onayı + çift yazım canlıda koşmuş olmalı); `hospitableId` tekilliği geçiş boyunca durur (DROP = operatör planı) | `channels/metadata.ts`, `prisma/schema.prisma:354` (`hospitableId @unique`; 1547 yorum satırı — 10-12 gece düzeltme) | DROP evet |

## 2b. 20 teknik değişmez — pin eşlemesi (10-10, Haiku taraması + kodda doğrulandı)

| Durum | Değişmezler |
|---|---|
| ✅ güçlü pin | 1 (`core-channel-independence` — ⚠️ "import yok" pinlidir, gerekçeli izin listesi: `scheduled-sync` yoklayıcı kaydı; uyum değil BÜYÜYEMEZ), 5 + 18 (`channel-manifest`, `airbnb-direct-adapter`), 7 (`ingest-write-service` + tek yazıcı pini — ⚠️ yalnız YOKLAMA yarısı: webhook girişi yok, köprüye yazılmaz, Airbnb Direct'te sandbox'a bağlı → §2e), 8 (`outbound-dispatch-guards`, `outbox`, `outbound-classification-parity`), 15 (`money-impact`, `attention-money`), 17 (iki uyum kiti + kit dışı yaşam döngüsü testleri; **10-12 gece:** giriş kiti tekrar oynatma / değişiklik / kiracı ayrımı / yeniden bağlanma vakalarıyla tamamlandı — sıra dışı teslimde iptal edilmiş satırın geri açılması ÇEKİRDEK politikası, kurucu sorusu G9) · ⚠️ 8'de belirsiz teslim satırı kendiliğinden çözülmez (`outbox/worker.ts` uzlaştırma bilinçli `found:false` — sağlayıcı "gönderildi mi" sorgusu sunmuyor; operatör kuyruğu) |
| 🟡 10-10 büyüyemez liste (UYUM DEĞİL — Haiku kapsam denetimi 10-11 doğru buldu) | **3** (dış kimlik bağlantı kapsamsız eşsiz değil — 4 bilinen ihlal SÜRÜYOR: `Property.hospitableId @unique`, Reservation / Conversation / Message bileşik eşsizleri; migration + Airbnb Direct ile kalkar; + 1 kapsam dışı gerekçeli) · **20** (çekirdekte `hospitable*` şema alanı — 7 gerekçeli dosya hâlâ okuyor; kanal dizesi yasağı V0.9) — `channel-invariants-ratchet.test.ts`, mutasyon 3/3 |
| ✅ 10-10 gece | **16**: kimlik parçalı HER API rotasının HER yöntemi bir kiracılar arası DAVRANIŞSAL teste eşli (`cross-tenant-coverage.test.ts`; eksik 7 tutamaç `cross-tenant-handlers-more`; muaf: operatör + iki anonim belirteç rotası; mutasyon 7/7) |
| ✅ 10-10 gece | **10** (otomatik kanallar arası birleştirme): konuşma kopya temizliği QR ipliğini aynı konaklamanın Airbnb ipliğiyle "kopya" sayıp boş olanı birleştiriyordu → kopya = AYNI kanal + aynı konaklama (`conversations-cleanup.test.ts`, mutasyon 2/2); toplu birleştirme betiği zaten sağlayıcı kimliğiyle gruplar |
| ✅ 10-11 gece | **6** (doğrudan kanal + iCal sahipliği; kurucu: "yalnız Airbnb Direct gelince", Hospitable köprüsü hariç): `channels/ical-authority.ts` + `syncCalendarSource` — aynı kanalın etkin doğrudan bağlantısı mülkü kapsıyorsa o kanalın iCal'i YEDEK (çekilir, `lastStatus: standby`, müsaitlikte tanık değil, rezervasyon yazmaz / iptal etmez, eski satır silinmez); kanal yalnız adresin alan adından (kesin liste); mutasyon 10+7+2, Haiku 1 tur. Bugün doğrudan bağlantı yok → davranış aynı. Geçiş adımı (değişmez 19) açıkları ↓ · **13** (karar 26; kurucu: "1 ile 2 beraber, bilerek işaretlenirse sorun yok"): `memory/contradictions.ts` — bilgi tabanı ↔ misafirin "bu bilgi yanlış" beyanı (son 30 günde ≥3 ayrı misafir; kurucu 10-11 düzeltmesi: arıza şikâyeti "Wi-Fi çalışmıyor" SAYILMAZ, yalnız "şifre yanlış / öyle bir ağ yok / otopark yok / adres yanlış"; `statesInfoWrong`, TR + EN) + bilgi tabanı ↔ bilgi tabanı / mülk ayarı (saat); yalnız ev sahibine, yapay zekâya gitmez (pin), "Bilerek böyle" (`humanOverrideAt`), kalem / mülk ayarı değişince yeniden değerlendirilir; mutasyon 13+3+7+2, Haiku 1 tur. ⚠️ Çelişki HESAPLANIR, `contradictedById` kalıcı yazılmaz (bilinçli: kalıcı kopya bayatlar; Haiku kapsam denetimi 10-11 önerisi gerekçeyle reddedildi); `expiresAt` süre politikası kurucu kararı — bilgi tabanı kalemi süresiz, örüntü hafızası 180 gün kayan pencere |
| 🟡 kısmi | 2 (bağlantı + ilk alınma pinli; tazelik bağlantı düzeyinde — `lastReadOkAt`, kaynak tazeliği karar #9; ham platform yazıcısı migration 60 bayrağı kapalı → Railway), 4 (ayrı ilan pinli; ayrı arayüz kanıtı Airbnb Direct ile), 9 (bağlantı yaşam döngüsü; sağlık sinyali ✅; eski kolonların kaldırılması operatör planı → Railway), 14 (veri politikası: Airbnb'nin kendi şartları + avukat; tahmin yasak, değişmez 18) |
| ⏸ Airbnb Direct geçiş adımı (değişmez 6 açıkları, kurucu kararı gerekir) | elle `.ics` yüklemesinin kanalı bilinmez (doğrudan bağlantı varken çift satır olabilir) · doğrudan bağlantı "aktif" ama okuyamıyorsa iCal'e dönülsün mü · bağlantı gelince ESKİ iCal satırlarının gizlenmesi / yedek işaretlenmesi (gereksinim madde 7) · koşu ortasında bağlantı açılırsa o koşu yazmaya devam eder (bir koşu gecikme) |
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
| Ortak bağlam kurucu | 🟡 `selectHistoryForPrompt` ortak; QR bilinçli farklı ve TEST-PİNLİ (her mesaj geldiği anda kendi kapısından geçer, birikme yok; pencere dışına taşan cevapsız şikâyet "açık konu" olarak taşınır — `qr-context-window.test.ts`; geçmiş şikâyet bağımsız soruyu engellemez = kurucu kararı); **>25 bekleyen mesaj kaydırma testi ✅ 10-09** — KANAL yolu (`pending-window-displacement`, mutasyon iki yönlü); **tanı çıktısı ✅ 10-12** (`ai/context-diagnostics.ts`: dahil kimlikler · atlanan · en eski an · karakter · bekleyen / dahil bekleyen · eski hafıza = istemin "KONUŞMA KAYITLARI" bloğu, istemle aynı koşul; metin YOK) → üretim izi `contextDiagnosticsJson` (kanal oto-yanıtı; Haiku denetimi 10-12: önceki "= üretim izi" iddiası yanlıştı, kolon yazılmıyordu) + **QR izi ✅ 10-12 öğle** (kurucu Ö5 "QR izini de yaz"; tanı QR penceresinin kendi kurucusundan — `buildGuestChatContextWindow`, taranan satırlar üzerinden; araç özeti QR'da yok). **madde 10 ✅ 10-12** (kurucu "Şimdi yap"; talimat "yalnız gereken satırlar, sınırlı sorgu"): kanal oto-yanıtı konuşmayı sondan 200'lük keyset sayfalarla okur, kesit her tüketiciye tam okumayla AYNI sonucu verecek kadar genişler (`channel-thread-window.ts`); kâhin testi gerçek istem metnini karşılaştırır, mutasyon 12/13 (1 gerekçeli eşdeğer); 2.000 mesajda tur 65,6 → 11,3 ms. Bilinçli tek fark + ayrıntı: `docs/TASARIM-2026-10-12-madde-10-sinirli-okuma.md`. Konuşma kayıtları / üretim izi açıkken de sınırlı: kesit öncesi toplamlar veritabanında sayılır (SQL ↔ JS özellik testi; Haiku'nun yakaladığı saat dilimi hatası düzeltildi), mutasyon 15/15. **Diğer yüzeyler ✅ 10-12 gece:** AI cevap öner rotası ve QR konuşma kayıtları aynı okuyucuya geçti (kâhin + hedefli senaryo; QR'da cevapsız uzun konuşmada 2.000 satır sınırı, yabancı konuşmada aşama sızmaz); mutasyon 28/28 |
| `conversationState` | 🟡 **sözleşme ✅ 10-09** (`ai/conversation-phase.ts` + `operator-replies.ts` `loadConversationPhase`): phase first_contact / ongoing / closing, hasPriorDeliveredReply, isFirstOperatorReply, deliveredReplyCount, unansweredGuestMessageCount, lastInteractionAt — konuşmanın TAMAMINDAN; misafire ULAŞMAMIŞ (iptal / başarısız / engellenmiş) giden mesaj selam sayımına girmez (`review` belirsiz → sayılır); otomatik şablon mesajı pencereyi sıfırlamaz; kapanış `closableAfter` ister. Kırmızı-önce + mutasyon + Haiku turu. **İsteme bağlanmadı** (kör eval + kurucu) |
| Eylem makbuzu | 🟡 beyan + kapı var (bayrak kapalı); makbuz üreten yürütücü yok |
| Araç çağrısı / `verifiedToolResults` | 🟡 sözleşme + müsaitlik aracı ✅ 10-09; modele araç olarak verilmesi kurucu onayı |
| Tarih çözümü üst verisi | ✅ 10-09 `ai/date-resolution.ts` (TR+EN; dayanak / güven / varsayım; 4 Haiku turu, 116 test, mutasyon 27/27); **istemde "tarih okuması" ✅ 10-10** (`ai/date-reading.ts`, anahtar `AI_DATE_RESOLUTION_ENABLED` kapalı; her mesaj kendi yazıldığı ana göre; gece yarısı "yarın"ı belirsiz; karar #10) |
| Zaman bağlamı (geçen süre, oturum arası, yeni gün) | 🟡 gün etiketi var; **aralık ✅ 10-09** (`interactionGap`: geçen dakika + org diliminde takvim günü farkı + yeni oturum = 6 saat sessizlik, kurucu kararı); isteme bağlanmadı |
| Kurucu AI Kalite Konsolu | ✅ migration 60 ile İTİLDİ (10-10; salt-okuma + etiket, 2FA'lı operatör, her görüntüleme kayıtlı — 10-12: kayıtta görüntülenen KONUŞMA kimlikleri de var) — Railway açılınca canlı. ⚠️ İz YALNIZ kanal oto-yanıtından yazılıyor; QR / "AI cevap öner" / demo izi tasarım belgesinde ayrı onaya bırakılmış (karar listesi) |
| Üretim izi (model, istem sürümü, gecikme, token, maliyet) | 🟡 migration 60 ile İTİLDİ (10-10); `AI_GENERATION_TRACE_ENABLED` KAPALI; KVKK paritesi + okuyucu pini; **10-12: bağlam tanısı + doğrulanmış araç ÖZETİ (araç · sürüm · durum · gerekçe · an; değer / kapsam yok) + araç sözleşme sürümü yazılıyor**; maliyet sütunu boş — fiyat tablosu ayrı karar; RAG ALINTISI / güven puanı YOK — bilgi tabanı metni sır taşıyabilir (kapı kodu / Wi-Fi), maskelemeyle eklenmesi ayrı karar |
| 8 başlangıç senaryosu | ✅ set `evals/founder-initial-8.json` + seçici; ücretli taban koşusu onay |
| Açık taahhüt hafızası | ✅ ilk dilim (kurucu kararı A, 10-10; migration 62): ev sahibinin işaretlediği söz + bağlı görev + Dikkat Gerektirenler satırı (`docs/TASARIM-2026-10-10-acik-taahhut-hafizasi-onerisi.md` §Uygulama). Yapay zekâ cevabına girdi: AYRI karar (müşteriye giden metin) |

## 5. Çalışma sırası (bu turdan itibaren)

1. ✅ **V0.8** (10-09, `6a654f0`) — §2a + §2b: kimlik bilgisi ve bağlantı durumu kanal katmanına; çekirdek sağlayıcı modülü import etmez (pin bütün `src/`). Migration yok, davranış birebir.
2. ✅ §2c pin (V0.9). ⏸ §2d operatör planına bağlı (↑).
3. ✅ Kapı 2 eksikleri (10-09): başlangıç rehberinde takvim (iCal) adımı, bağlantısız hesapta ölü düğme, yanıltıcı metinler (talimatın açık şartı; misafire giden mesaja dokunmaz).
4. ✅ §2f–h: üçü de migration (bağlantı sağlığı alanı · ham platform kolonu · bağlantı kapsamlı ilan kimliği tablosu) → tek paket olarak kurucu onayına sunuldu ve **migration 60 olarak itildi** (kurucu 10-10 "ŞİMDİ uygula + push; Railway açılmadan önce taze `pg_dump`"; ↓ §"Kurucu döndü"). Yazıcılar anahtar arkasında KAPALI (§2g `CHANNEL_METADATA_WRITE`; §2h açma = kurucu onayı + çift yazım canlıda koşmuş olmalı) → Railway. §2e Airbnb sandbox'ına kadar kapalı. (Satır 10-12'de güncellendi: "onaya" ifadesi bayattı.)
5. ④ Availability Engine → yapay zekâya araç sonucu olarak bağlanması (sözleşme + kırmızı-önce). Durum 10-12: **kod metni yolu ✅ 10-09** (doğrulanmış müsaitlik / uzatma, anahtarlar KAPALI — açma = kurucu + ilk denemeler); modele ARAÇ olarak verilmesi ayrı kurucu onayı.
6. Sonra V2 sonraki dilimleri ve §4.

~~Kurucu kararı bekleyen: yapay zekâ günlük özeti~~ → **KARAR VERİLDİ (kurucu 10-09): ŞİMDİLİK YOK; V8 Ask Lixus ile tasarlanır** (↑ kapı 2 satırı). (10-12'de düzeltildi: bu satır bayattı.)

## 6. 10-09 akşam — yapılanlar ve kurucu kararı bekleyenler

**Yapıldı (itildi, CI yeşil):** V0.8 kanal erişim katmanı · V0.9 kanal dizesi pini · kapı 2 (rehber + ölü düğme) · araç sonucu
sözleşmesi + müsaitlik aracı · tarih çözümü · kaydırma testi · kurucu 8 senaryo seti · Airbnb dosyası taslağı · migration 60 tasarımı.
Her orta / büyük değişiklik Haiku incelemesinden geçti (5 tur; bulguların çoğu kabul, gerekçeli retler commit mesajlarında).

**Haiku kapsam denetimi (10-11 gece, talimatın tamamı ↔ bu çizelge ↔ kod; 12 bulgu):** doğru → değişmez 1 / 3 / 7 / 20 satırları
"büyüyemez liste / kısmi" diye düzeltildi (↑); kritik akış matrisinin iki ⚠️ satırı testle kapandı (`critical-flow-inbound-to-delivery`,
`critical-flow-private-upload-session`, `docs/TEST-EVIDENCE-CONTRACT.md` §3). Gerekçeyle reddedilen → bekçinin 5 mesaj penceresi
(deterministik kapı bütün cevapsız mesajları görür — `pending-window-displacement`; model katmanına dayanan izin yolları "tamamı okunmadı"
iken kapanır — `earlyCheckinAutoBlockers` `not_fully_read`, `earlyCheckinPolicyAllowed`, `closing-turn` pencere denetimi) · migration 60
zinciri (her push'ta CI "migrate deploy 00→N + sıfır drift" işi koşar) · `contradictedById` kalıcı yazımı (↑) · "migration 60 onaysız itildi" (kurucu 10-10: "ŞİMDİ uygula + push; Railway açılmadan önce
taze `pg_dump`" — `docs/KURUCU-YOKKEN-KARARLAR-2026-10-09.md` §"Kurucu döndü"; `f5f9a57` mesajındaki "PUSH EDILMEDI" yazıldığı ana
aitti; Railway kapalı, canlıya gitmedi). Kurucu kararı olarak
kalan: kapı 2 yapay zekâ günlük özeti ve kalite konsolu "kapalı küme amaç + IP yok" sapmaları (talimat metni değişmedi; kararlar
`docs/KURUCU-YOKKEN-KARARLAR-2026-10-09.md`).

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

## 7. 10-10 → 10-12 kurucu onaylı işler (10-12 gece eklendi — Haiku denetimi: çizelgede satırları yoktu)

Talimat dışı, kurucunun ara kararlarıyla yapılanlar; ayrıntı ve kanıt `docs/KURUCU-YOKKEN-KARARLAR-2026-10-09.md` ve `docs/claude/durum.md`.

| İş | Durum |
|---|---|
| Deneme kötüye kullanımı (işletme kimliği + risk puanı + operatör listesi) | ✅ yalnız liste (kurucu "önce yalnız liste"); kartla doğrulama eşiği kurucu kararı bekliyor (`billing/trial-risk.ts`) |
| Ödeme kilidi ("Ödemeniz işleniyor") + ikinci aktif abonelik alarmı | ✅ (`webhooks/paddle/route.ts`) |
| Takip numarası (correlation ID) ilk dilim + arka plan işleri (migration 63) | ✅ |
| Acil numara kod metni (`AI_EMERGENCY_NUMBER_ENABLED` KAPALI) | ✅ kodda |
| QR tavanları (konaklama saatte 40, acil e-posta saatte 3, daire alt kotası) · Wi-Fi bağlı cihazda / kapı kodu yok · çıktı taraması | ✅ |
| S1 bavul kapısı · S2 iptal edilmiş rezervasyonda QR · S3 boş kayıt yazmaz | ✅ |
| B1 "Bilgi tabanına ekle" + Yerel Tavsiye hatırlatması | ✅ |
| Görev atama e-postası tavanı (görev başı saatte 3) · önizleme kotası konuşma başına | ✅ |
| ⑤ ilk dilim öneriler (`AI_ACTION_SUGGESTIONS_ENABLED` KAPALI) | ✅ kodda; "sonuç makbuzu" = onay denetim kaydı (`ai_suggestion.approved`, oluşturulan görev / söz / kalem kimlikleriyle) — ayrı makbuz tablosu YOK |
| Madde 10 sınırlı konuşma okuması (kanal · AI öner · QR kayıtları) | ✅ |
