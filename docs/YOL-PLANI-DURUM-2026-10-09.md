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
| ④ | Deterministik Availability Engine | 🟡 çekirdek + panel + konuşma sayfası ✅; **yapay zekâya bağlanmadı** (araç sonucu sözleşmesi yok) |
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
| g | Ham platform korunmuyor (`toChannel`) (2) | ❌ | `channels/hospitable-ingest.ts:43-50,106` | Evet |
| h | `Property.hospitableId` global unique (3) | ❌ | `prisma/schema.prisma:346` | Evet |

## 3. Airbnb başvurusu öncesi 6 kapı

| Kapı | Durum |
|---|---|
| 1 Channel independence + boş Airbnb Direct sözleşmesi | 🟡 sözleşme ✅; §2 kalanları |
| 2 Hospitable'sız Lixus | ✅ 10-09 (kurucu kararı): rehberin ilk adımı "Rezervasyonlarınızı bağlayın" kanal YA DA takvim bağlantısıyla tamamlanır; bağlantısız hesapta "Mesajları çek" gizli. Yapay zekâ günlük özeti: **ŞİMDİLİK YOK** (kurucu 10-09; V8 Ask Lixus ile tasarlanır). Eski bulgu: başlangıç rehberinde iCal adımı yok, rehber tamamlanamaz (`dashboard/page.tsx:107-167`); bağlantısız hesapta "mesajları çek" düğmesi ölü (`inbox/page.tsx:248`); "bağlantı kurulunca daireleriniz otomatik gelir" metinleri (`dashboard:121`, `properties:76-79`); yapay zekâ günlük özeti 08-08'de bilerek kaldırıldı (`dashboard:211-228`) — talimatla çelişiyor, **kurucu kararı** |
| 3 Güvenlik katmanı | 🟡 MFA, RBAC, denetim kaydı, şifreli sırlar, webhook imzası (Paddle), idempotency, hız sınırı, silme / dışa aktarma, yedek provası var; çeyreklik zafiyet taraması süreci ve güvenlik dosyası yazılmadı |
| 4 Demo hesabı | 🟡 üretici kodda (`docs/DEMO-HESABI.md`), canlıya koşulmadı (Railway kapalı) |
| 5 Gerçek kullanım kanıtı | ⛔ kurucu org Hospitable aboneliği 402, Railway kapalı |
| 6 Entegrasyon dosyası | ❌ yazılmadı |

Yasal metinler (`(legal)/entegrasyonlar`, ön bilgilendirme, gizlilik, koşullar) Hospitable'ı zorunlu gibi anlatıyor → avukat paketi; Claude değiştirmez.

## 4. Gelecek AI gereksinimleri (talimat: "V0 ve Availability Engine sonrası")

| Gereksinim | Durum |
|---|---|
| Ortak bağlam kurucu | 🟡 `selectHistoryForPrompt` (`prompts.ts:1068`) ortak; QR kendi penceresi (`guest-chat.ts:791`); tanı çıktısı yok; >25 bekleyen mesaj testi yok |
| `conversationState` | 🟡 `phase`, `hasPriorDeliveredReply`, `deliveredReplyCount`, `lastInteractionAt` yok; bayrak kapalı |
| Eylem makbuzu | 🟡 beyan + kapı var (bayrak kapalı); makbuz üreten yürütücü yok |
| Araç çağrısı / `verifiedToolResults` | ❌ |
| Tarih çözümü üst verisi | ❌ |
| Zaman bağlamı (geçen süre, oturum arası, yeni gün) | 🟡 gün etiketi var, aralık / oturum yok |
| Kurucu AI Kalite Konsolu | ❌ (yalnız `admin/quality-audit` POST) |
| Üretim izi (model, istem sürümü, gecikme, token, maliyet) | ❌ |
| 8 başlangıç senaryosu | 🟡 parça parça; birebir set yok |
| Açık taahhüt hafızası | ❌ |

## 5. Çalışma sırası (bu turdan itibaren)

1. ✅ **V0.8** (10-09, `6a654f0`) — §2a + §2b: kimlik bilgisi ve bağlantı durumu kanal katmanına; çekirdek sağlayıcı modülü import etmez (pin bütün `src/`). Migration yok, davranış birebir.
2. ✅ §2c pin (V0.9). ⏸ §2d operatör planına bağlı (↑).
3. ✅ Kapı 2 eksikleri (10-09): başlangıç rehberinde takvim (iCal) adımı, bağlantısız hesapta ölü düğme, yanıltıcı metinler (talimatın açık şartı; misafire giden mesaja dokunmaz).
4. §2f–h: üçü de migration (bağlantı sağlığı alanı · ham platform kolonu · bağlantı kapsamlı ilan kimliği tablosu) ve `channels/requirements.ts`te "canlı öncesi migration" diye listeli → tek migration paketi olarak kurucu onayına (taze `pg_dump` kuralı). §2e Airbnb sandbox'ına kadar kapalı.
5. ④ Availability Engine → yapay zekâya araç sonucu olarak bağlanması (sözleşme + kırmızı-önce).
6. Sonra V2 sonraki dilimleri ve §4.

Kurucu kararı bekleyen: yapay zekâ günlük özeti (08-08 kaldırma kararı ↔ talimat kapı 2).
