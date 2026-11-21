# Railway açılış listesi (10-15) — eklenecek / kontrol edilecek ortam değişkenleri

Kurucu 10-15: "Railway'i açınca ekleyeceğimiz bayrakları unutma." Bu dosya TEK liste; kaynak: koddaki her açma/kapama değişkeninin taraması
(65 bayrak, Haiku envanteri 10-15) + `CLAUDE.md` "Canlı durum" + kurucu kararları. Değer yazılmaz (sır yok); yalnız ad ve önerilen durum.

## 0. Açmadan önce (sıra önemli)

0. **Önce yalnız veritabanı (gece-4 S10-08):** web servisi açılınca İLK iş `prisma migrate deploy` → yedek bundan SONRA alınırsa migration
   ÖNCESİ yedek olmaz. Sıra: Railway'de yalnız Postgres'i açın (web servisinin otomatik deploy'unu kapatın ya da kopya sayısını 0 tutun; dala
   push yapmayın) → aşağıdaki 1. adım (yedek + geri yükleme provası) → sonra web servisini açın. Kontrol: açmadan önce
   `SELECT count(*) FROM _prisma_migrations` = **59** (00…58), ilk deploy'dan sonra **92** (00…91; 11-05 taze veritabanında ölçüldü) — üyelik dalı (`m2/membership`) birleşince **93** ve **94** de gelir
   ama İKİ AYRI yayında: önce 93 (dilim 1) tek başına, sonra 94 + dilim 2 (sayım 92 → 93 → 94; 92 numarası `{daire}` tasarımına
   ayrıldı, klasörü yok — o migration önce gelirse her sayı +1). Sebep ve onarım ↓"Üyelik (M-2)". **95** (`95_business_licenses`,
   işletme belgesi Faz 1a, kurucu onayı 11-06): yalnız dört YENİ tablo — dolu tabloya dokunmaz; anahtarı kapalıyken hiçbir okuyucusu yok
   (↓"İşletme belgesi (Faz 1a)"); hepsi uygulanınca sayım **95** (00…95, 92 hariç).
   **Dolu veritabanı provası (gece-4 S10-10, 10-18):** 00…58 uygulanmış boş PG'ye 37 tablonun hepsine 40'ar yapay satır
   (`scripts/ops-migration-rehearsal-seed.py`, yabancı anahtarlarla bağlı) → 59…77 hatasız, 1,5 sn (10-18: 78 aynı prova veritabanında ayrıca uygulandı, 1,4 sn, sapma sıfır); `migrate diff` sapma sıfır. Statik tarama
   aynı sonucu verir: 59…78'deki bütün yabancı anahtarlar YENİ tablolarda, yeni kolonların hepsi boş bırakılabilir ya da varsayılanlı, benzersiz
   dizinler yeni tablo / yeni (boş) kolonlarda, veri güncelleyen ifade yok. Canlı veriyle prova değildir (gerçek veri yerelde yok — KVKK); yine de
   1. adımdaki yedek ŞART.
1. **Taze yedek:** son itilen dal migration 59–99 içeriyor (93–94 üyelik, 95 işletme belgesi, 96 taslak ↔ gönderim bağı, 97 ekip kişisi + personel kanal bağı, 98 yeniden deneme vadesi + teslim yolu + ödeme ↔ abonelik bağı kolonları, 99 iç not + anlam okuması gölge kaydı; 92 numarası boş — tek güncel liste: `docs/MIGRATION-MANIFEST.md`) (açılışta `prisma migrate deploy` hepsini uygular). Açmadan önce 09-19
   yedeği ESKİ — Railway açılınca ilk iş `pg_dump` (web servisi deploy olmadan, ↑0) ve geri yükleme provası
   (`docs/OPS-2026-09-19-DURAKLATMA-VE-LOCAL-GELISTIRME.md`).
   Migration 80 (kurucu T4, otomatik mesajlar ayrı bölüm): açılıştan sonra her dairenin "Otomatik mesajlar" kartına bakın — metinler bilgi
   tabanından AYNEN taşındı; `SELECT count(*) FROM "AutoMessageTemplate" WHERE "needsReview"` > 0 ise o kartlarda "kontrol edin" uyarısı var.
2. **`ENCRYPTION_KEY` aynı kalır** (rotasyon ASLA). Kasadaki değerle Railway'deki aynı mı — yalnız parmak izi ile karşılaştırın.
3. **Hospitable OAuth:** süresi dolmuş olabilir → Ayarlar → Bağlantılar'da yeniden bağlanın; `scripts/diagnose-hospitable-tokens.ts` salt-okuma.
   Kurucu org hâlâ `HOSPITABLE_API_TOKEN` ortam yedeğindeyse ve o token reddedilirse (Tur 7 T7-OB-2): kuyruktaki elle cevaplar artık sonsuz
   yeniden gönderilmez — ~6 denemede "Gönderilemedi" olur + uyarı; token düzeltilince `/sent/queue`dan "yeniden dene".
4. **Paddle:** kapalıyken gelen webhook'lar kaçtı → abonelik durumunu Paddle panosuyla karşılaştırın (reconcile).
   🚨 **CANLI API ANAHTARI (10-17):** eski canlı anahtarın süresi 13 Eylül 2026'da DOLDU (Paddle anahtarları varsayılan 90 gün, en çok 1 yıl;
   dolan anahtar yenilenemez) → 13 Eylül'den beri portal / paket değişikliği / durum okuma çağrıları çalışmıyordu (webhook etkilenmez). Kurucu
   10-17'de yeni anahtarı **"Never expires"** ile oluşturdu → Railway'de `PADDLE_API_KEY` yeni anahtarla değiştirilir, eski anahtar iptal edilir.
   ⏰ **UNUTMA (kurucu: "sakın unutmayalım"):** süresiz anahtar Paddle'ın önerdiği şey değil (bitiş uyarısı da gelmez). Yapılacak: anahtarı
   **1 yıl** bitişli, "Rotatable" işaretli yenisiyle değiştir + Paddle bildirimlerinde `api_key.expiring` / `api_key.expired` olaylarını aç
   (kod tarafı: operatör uyarı e-postası). İzinler (en az yetki, koddaki çağrılardan): Subscriptions Read + Write · Customer portal sessions Write
   · Prices Read · Products Read · Customers Read · Addresses Read. Diğerleri işaretsiz.
5. **Railway "Wait for CI" AÇIK** kalsın (kırmızı CI deploy'u atlar).
   **Derleme belleği (11-11):** `next build` içindeki tip denetimi ~2,5 GB ister; Dockerfile derleme aşaması tavanı açıkça 4 GB verir
   (çalışan kabı etkilemez). Railway derlemesi yine "heap out of memory" / bellek yetersizliğiyle düşerse derleme makinesinin belleği
   4 GB'ın altındadır — Railway planındaki derleme belleğine bakın. Depo private iken CI'ın kırmızısı da aynı sebepti (CI 1779).
6. 🔔 **KURUCU 10-30: "Decisions API bayraklarını unutturma, Railway'i açacağımız gün eklemeliyim":**
   - **Decisions API ile yeniden sıralayıcı:** `KB_RERANK_ENGINE=decisions` (boş = bugünkü sohbet sıralayıcısı) · model
     `KB_RERANK_DECISIONS_MODEL` (boşken `gpt-6-luna`). Ölçüm: p50 0,41 sn / p95 0,86 sn (sohbet 1,09 / 1,63); kalite sohbetin oynama
     aralığının alt ucunda. Açmadan önce 3 tekrar + uzun belge kör seti (`docs/arastirma-2026-10-28/decisions-api.md`). Ayrıntı ↓§3.
   - **OpenAI istem önbelleği (10-30, `ai/prompt-cache.ts`) VARSAYILAN AÇIK — env gerekmez.** Cevap / çeviri / üslup / anlam katmanı
     isteklerine amaç anahtarı (`prompt_cache_key`) + 24 saat saklama (`prompt_cache_retention`) eklenir; çıktı değişmez. Acil kapatma
     `OPENAI_PROMPT_CACHE_DISABLED=1`; yalnız saklamayı kısaltmak için `OPENAI_PROMPT_CACHE_RETENTION=in_memory`. Açılıştan sonra kontrol:
     karar kaydındaki kullanımda önbellekten okunan token (`cached_tokens`) sıfırdan büyük mü.
   - **WhatsApp ev sahibi soru kanalı (10-30, kurucu: "WP'yi hemen bağlamak istiyorum"; tasarım
     `docs/TASARIM-2026-10-30-whatsapp-ev-sahibi-dongusu.md` §9 kurulum listesi):** Meta kurulumu bitince kasadan →
     `WHATSAPP_ACCESS_TOKEN` (sistem kullanıcısı kalıcı belirteci) · `WHATSAPP_PHONE_NUMBER_ID` · `WHATSAPP_APP_SECRET` (web kancası imzası) ·
     `WHATSAPP_WEBHOOK_VERIFY_TOKEN` · `WHATSAPP_BUSINESS_NUMBER` (Lixus'un WhatsApp numarası, ülke koduyla — Ayarlar'daki "WhatsApp'ta aç"
     bağlantısı buna gider; yoksa Ayarlar kartı görünmez) · `HOST_CHANNEL_HMAC_SECRET` (en az 32 karakter rastgele; numara arama anahtarı + bağlama kodu özeti —
     yoksa numara bağlama KAPALI; ENCRYPTION_KEY gibi döndürülmez: döndürülürse eski bağlantılar ilk soruda kendiliğinden kapanır, e-postaya dönülür ve her ev sahibi numarasını Ayarlar'dan YENİDEN bağlamak zorundadır) · isteğe bağlı `WHATSAPP_GRAPH_VERSION` (boş = `v23.0`, kurulumda güncel sürüm teyit) ·
     `WHATSAPP_QUESTION_TEMPLATE` (boş = `lixus_misafir_sorusu`) · `WHATSAPP_ALERT_TEMPLATE` (boş = `lixus_acil_bildirim`) ·
     `WHATSAPP_TEMPLATE_LANG` (boş = `tr`) · şablonda değişkenli "Panelde aç" bağlantı düğmesi varsa sırası (0'dan, şablon başına):
     `WHATSAPP_QUESTION_URL_BUTTON_INDEX` / `WHATSAPP_ALERT_URL_BUTTON_INDEX` / `WHATSAPP_DECISION_URL_BUTTON_INDEX` (boş = düğme parametresi
     yok; tek rakam değilse WhatsApp yapılandırması geçersiz sayılır → her şey e-postaya düşer; karar şablonunda [Onayla] 0, [Reddet] 1 →
     bağlantı tipik `2`) · `WHATSAPP_DECISION_TEMPLATE` (boş = `lixus_karar_bekliyor`) · cevap kurucu modeli
     `AI_HOST_ANSWER_MODEL` / `AI_HOST_ANSWER_REASONING_EFFORT` (boş = cevap modelinin ayarı). Anahtarlar (hepsi yalnız "1", varsayılan
     KAPALI): `HOST_CHANNEL_ENABLED` (kanal) · `HOST_QUESTIONS_ENABLED` (bilgi soruları) · `HOST_QUESTION_DECISIONS_ENABLED` (karar düğmeleri —
     karar motoru `HOST_DECISIONS_ENABLED` de açık olmalı; erken giriş / geç çıkış kartı WhatsApp'a [Onayla] [Reddet] ile gider, önizleme +
     [Gönder] ile misafire; ücretli / saatsiz / uzatma kartı bugünkü e-postayla) ·
     `HOST_QUESTION_ALERTS_ENABLED` (acil bildirim — HİBRİT, kurucu 10-31: önce WhatsApp, 10 dk içinde okunmazsa ya da gönderilemezse acil
     e-posta da; yangın / gaz / elektrik / tıbbi / su baskını / mahsur-hırsız-tehdit / kategorisiz "ACİL" → ikisi birden hemen; mesaj başına
     bir, işletme başına saatte en çok 10; bildirime yazılan cevap misafire gitmez ve "okundu" sayılır. ⚠️ Mavi tiki kapalı ev sahibine e-posta
     10–12 dk sonra gelir. Meta uygulamasında web kancası alanı `messages` durum bildirimlerini de taşımalı) ·
     `HOST_QUESTION_KB_SAVE_ENABLED` (migration 89, kurucu 10-31: misafire giden WhatsApp cevabından sonra ayrı mesajla [Bilgi tabanına ekle]
     → önizleme [Kaydet] / [Yerine yaz] / [Ayrı ekle] / [Vazgeç]; konaklamaya özel / geçici / Wi-Fi-giriş bilgisi teklif edilmez; kalem
     yalnız [Kaydet]le yazılır; çıkarıcı "Geçmişten öğren" modeli `AI_HISTORY_LEARN_MODEL`) + liste `HOST_CHANNEL_ORG_IDS`
     (`*` = hepsi, boş = hiçbiri; ilk açılış kurucu org).
     **Kodda (10-30 gece):** migration 88 (iki yeni tablo) · numara bağlama · Tür A soru gönderimi ("Misafir cevabınızı bekliyor" bildirimine
     bağlı) · web kancası `POST/GET /api/webhooks/host-channel/whatsapp` (imza, bağlama kodu, "DUR") · Ayarlar › Bildirimler › "WhatsApp
     bildirimleri" kartı (numara + rıza → kod + "WhatsApp'ta aç"; rıza metni TASLAK, onay bekliyor). **Ev sahibinin WhatsApp CEVABININ soruya
     bağlanması (10-30 gece-4, cevap dilimi):** ev sahibi soruya WhatsApp'tan yazar → taslak → önizleme [Gönder] [Gönderme] → onayda misafire
     bugünkü gönderim çekirdeğiyle gider. `HOST_QUESTIONS_ENABLED` bu akışın TAMAMINI açar; ev sahibine giden metinler ve S1 (otomatik mi
     onaylı mı — ilk dilim yalnız onaylı) kurucu onayından SONRA açılır (rapor §4e). **Kurulum sırası:** ① env'ler + `HOST_CHANNEL_ENABLED=1` + `HOST_CHANNEL_ORG_IDS` ② yayın
     ③ SONRA Meta'da Callback URL + Verify token (anahtar kapalıyken el sıkışma 403 döner — uç uyur) ④ Ayarlar'dan numara bağlama (ekran
     dilimi). Anahtar açık ama `WHATSAPP_APP_SECRET` / `WHATSAPP_PHONE_NUMBER_ID` yoksa uç gelen mesajı 200 ile yutar + "host-channel-webhook-
     dormant" alarmı verir.

5. **Tur 7 CAL-1 sayımı (web servisi açıldıktan SONRA, salt okuma):** `DATABASE_URL=… npx tsx scripts/diagnose-own-feed-loop.ts` — kendi
   Lixus takvim bağlantısını içe aktarma kaynağı olarak eklemiş daire var mı, kopya rezervasyon oluşmuş mu. Betik HİÇBİR ŞEY değiştirmez;
   kayıt bulunursa etkilenen kaynakların opak kimliklerini ve önerilen işlemi yazar. Sonuç kurucuya gösterilir; temizlik **otomatik
   başlatılmaz**, ayrı ve onaylı bir adımdır (Codex + kurucu 11-05).

## 1. Canlı durumda AÇIK olması gerekenler (eksikse ekleyin; "1")

> 🚨 **11-13 ödeme onayı ön şartı (Opus P2-4):** ödeme ekranı "hemen başlasın / cayma hakkımı kaybediyorum" onayını ayrı kutuyla alıyor ve
> sözleşmeler istisnayı bu kutuya bağlıyor. Uygulama içi YÜKSELTMEDE (`PADDLE_PLAN_CHANGE_ENABLED`, fark anında tahsil) aynı kutu VAR
> (`f2b9283f`: kutu işaretlenmeden istek gitmez; sunucu `immediateStartConsent` alanı olmadan 400 döner, tek kullanımlık önizleme tüketilmez;
> onay denetim kaydına `billing.immediate_start_consent` + metin özetiyle yazılır). DEVAM ETTİRME yolunda (`PADDLE_RESUME_ENABLED`, yeni dönem
> hemen tahsil) kutu YOK → o anahtar (zaten kapalı kalanlar listesinde, kurucu SG3) bu kutu eklenmeden ya da avukatın b-6 cevabı gelmeden
> AÇILMAZ (`docs/claude/acik-isler.md` "11-13 akşam").

`AUTO_REPLY_ENABLED` · `GUEST_CHAT_ENABLED` · `REGISTRATION_OPEN` · `LANDING_DEMO_ENABLED` · `TRIAL_EMAILS_ENABLED` · `BILLING_ENFORCED` ·
`PADDLE_PLAN_CHANGE_ENABLED` · `SHADOW_AI_ENABLED` · `AI_UNDERSTANDING_ENABLED` · `AI_STAY_GUARD_ENABLED` · `AI_CONVERSATION_ITEMS_ENABLED` ·
`HOUSE_RULES_CARD_ENABLED` · `AI_HOUSE_RULES_SHADOW` · `KB_SEMANTIC_RETRIEVAL` · `KB_RERANK_ENABLED` · `EMAIL_OUTBOX_ENABLED` ·
`CALENDAR_URL_CONTRACT_ENABLED` · `STORAGE_ENABLED` · `AI_CODE_GREETING_ENABLED` · `AI_HOST_DECISION_HOLD_ENABLED` ·
`AI_ACCESS_CODE_COMPLETE_ENABLED` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED` · `AI_KB_FEE_RULE_ENABLED` · `QR_ESCALATION_EMAIL_ENABLED`
(10-02 kurucu beyanı olan beşi Railway'de teyit edilmedi — açılışta gözle bakın). ✅ `QR_ESCALATION_EMAIL_ENABLED=1` KURUCU ONAYLADI 11-04 (derin ajan
turu S2: "önerini beğendim"): QR misafir sohbetinde açık tehlike yazan misafir için bugün ne misafire ne ev sahibine bir şey gidiyordu (K10 + bayrak
kapalı; belgeler çelişiyordu — sabah raporu 10-01 "açın", bu belge "açmayın"). Açıkken QR'da ev sahibine kalan HER mesajda (tehlike, şikâyet, günlük
hak, iptal edilmiş konaklama…) ev sahibine "⚠️ Misafir sohbetinde size devredilen mesaj — {daire}" e-postası (kritik olayda — açık tehlike / acil / erişim kaybı — S2 onayıyla "⚠️ Acil misafir mesajı — {daire}", 11-05) (misafir metni / adı YOK; sebep + panel
bağlantısı); tehlike dışı olayda konaklama başına 5 dk'da bir, tehlikede konaklama başına saatte en çok 3 (`src/lib/guest-chat-alerts.ts`). Misafire
giden metin DEĞİŞMEZ. Alıcı: işletmenin uyarı adresi, yoksa en eski sahip hesabı. ⚠️ 10-28: `AI_KB_FEE_RULE_ENABLED` artık ÜÇ yeri birlikte açar
(kurucu kararı 4.13): cevap isteminin ücret kuralı + anlama katmanında "hizmet ücreti sorusu ödeme değildir" eki + kıdemli okuyucuda "yalnız fiyat
söylemek platform dışı ödeme değildir" satırı. Okuyucu satırı gerçek modelle ÖLÇÜLMEDİ (kredi bitti) — açmadan önce
`EVAL_SENIOR_SET=airbnb-fee-statements.json` ve `airbnb-message-policy.json` ölçülsün. Ayrıca `DATA_RETENTION_MONTHS=24`, `TRUSTED_PROXY_HOPS=2`,
`SENTRY_DSN`, `ERROR_ALERT_EMAIL`. `TRUST_CF_HEADER` EKLEMEYİN.

**ÖLÇÜM-TABANI** — canlı hat ölçümünün açılış kipi (`EVAL_PROFILE=launch`; `tests/eval/launch-profile.ts` ile BİREBİR, pinli —
`tests/unit/eval-launch-profile.test.ts`). Açılışta "1" verilecek ve kanal cevap hattını etkileyen anahtarlar (bu bölüm + §5'te "AÇILIŞTA 1"
yazanlar); buraya anahtar eklenince o dosyaya da eklenir, yoksa kapı kırmızı olur:
`AUTO_REPLY_ENABLED` · `KB_SEMANTIC_RETRIEVAL` · `KB_RERANK_ENABLED` · `AI_UNDERSTANDING_ENABLED` · `AI_STAY_GUARD_ENABLED` · `AI_CONVERSATION_ITEMS_ENABLED` · `AI_HOUSE_RULES_SHADOW` · `AI_CODE_GREETING_ENABLED` · `AI_HOST_DECISION_HOLD_ENABLED` · `AI_ACCESS_CODE_COMPLETE_ENABLED` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED` · `AI_KB_FEE_RULE_ENABLED` · `AI_NO_APOLOGY_RULE_ENABLED` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED` · `AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED`
(11-12 gece: son dördü o güne kadar HİÇBİR ölçüm kolunda açık değildi — 11-12 ve öncesinin canlı hat sayıları bu dört kural olmadan
alınmıştır; mühürlü kabul koşuları artık yalnız açılış kipinde başlar.)

## 2. Model ayarları (kurucu kararı 10-10; kod varsayılanı 5.1, değişiklik yalnız env)

| Değişken | Değer |
|---|---|
| `OPENAI_MODEL` / `OPENAI_REASONING_EFFORT` | `gpt-6-luna` / `low` |
| `AI_STAY_GUARD_MODEL` / `AI_STAY_GUARD_REASONING_EFFORT` | `gpt-6-luna` / `low` |
| `OPENAI_TRANSLATE_MODEL` / `OPENAI_TRANSLATE_REASONING_EFFORT` | `gpt-6-luna` / `medium` |
| `OPENAI_STYLE_MODEL` / `OPENAI_STYLE_REASONING_EFFORT` | `gpt-6-luna` / `none` |
| `AI_DECISION_TEXT_MODEL` | **`claude-haiku-5-5`** (kurucu 11-04 "Haikuya geçelim karar metni yazıcısında"; ölçüm istek 9: 5.1 ile eşit, 10× ucuz — `docs/olcum/HAIKU-5.5-RAKIP-KIYASI-2026-11-04.md` §6). 🚨 **`ANTHROPIC_API_KEY` ŞART** (yoksa yazıcı onaylı şablona düşer, bekçi yine OpenAI). `AI_DECISION_TEXT_REASONING_EFFORT` BOŞ (ölçülen `low`). Gizlilik sayfasına Anthropic alt işleyen olarak eklendi (LEGAL_VERSION 2026-11). |
| `STAFF_NOTIFY_ENABLED` | **KAPALI doğar** (kurucu 11-05 gece, `docs/TASARIM-2026-11-06-dogrudan-gorevlendirme-ve-whatsapp.md`). Personel / ev sahibi görev bildirimlerinin YENİ gönderimleri: "Yapamıyorum" → sahip / yöneticilere e-posta; dairenin temizlikçisine otomatik atama ve geç çıkış bildirimi. Bugünkü elle atama e-postası bu anahtardan bağımsız. İlk gerçek gönderim kurucuyla birlikte açılır (e-posta akışı kuralı); ana kanal ileride WhatsApp. |
| `QUALITY_AUDIT_ENABLED` | **KAPALI kalır** (Codex 11-05, 43fb93e incelemesi). Operatör kalite denetçisi maskelenmiş misafir mesajlarını Anthropic'e gönderir; gizlilik metni Anthropic'e misafir mesajı iletilmediğini söylüyor. Eskiden yalnız `ANTHROPIC_API_KEY`e bakıyordu — karar yazıcısı için anahtar eklenince kendiliğinden açılırdı. Açmadan önce gizlilik metni (avukat paketi) güncellenir + kurucu kararı. |
| `AI_SEMANTIC_MODEL` (anlama + sıralayıcı ortak) | `gpt-5.1` — `AI_UNDERSTANDING_MODEL` ve `KB_RERANK_MODEL` BOŞ |
| `AI_HISTORY_LEARN_MODEL` / `…_REASONING_EFFORT` (Geçmişten öğren, yeni) | boş bırakılabilir (kod varsayılanı `gpt-6-luna` / `low`) |

## 3. Açılmayı bekleyen anahtarlar (kurucu + ilk denemeler birlikte; önerilen sıra)

1. `QR_PIN_ENABLED` (kurucu 10-11: AÇILACAK). 🚨 **ÖNCE `QR_PIN_PEPPER` ekleyin** (rastgele, en az 32 karakter, `AUTH_SECRET` ile AYNI
   OLMAZ) — yoksa açılış denetimi (`scripts/verify-env.mjs`) üretimde süreci başlatmaz, servis çöker (gece-4 S10-04).
   ✅ Kurucu 10-22 U1 ("Olur 3'ü birden"): (a) açılışta "1" · (b) KODDA: sohbet kodu istenmeyen konaklamada Wi-Fi QR'da VERİLMEZ (anahtar
   kapalıyken HİÇBİR konaklamada Wi-Fi gitmez — bu anahtarı açmak Wi-Fi'yi QR'da geri getirir, yalnız kodla açılan konaklamada) · (c) KODDA:
   QR sohbet ekranında "Cihaz kilidini sıfırla". ⚠️ Açmadan önce "PIN DoS" (10 yanlış kodla 15 dk kilit) birlikte bakılacak (kurucu notu).
   Sohbet kodu Airbnb mesajıyla gider (Mülk → Rezervasyonlar → "Sohbet kodu oluştur" → "Airbnb mesajı kopyala"); metin filtre dostu.
2. `AI_DATE_RESOLUTION_ENABLED` + `AI_CONVERSATION_STATE_ENABLED` (güvenlik ölçüleri 0, gereksiz soru 0).
3. `AI_VERIFIED_AVAILABILITY_ENABLED` → `AI_VERIFIED_EXTENSION_ENABLED` → `AI_VERIFIED_QR_ENABLED`.
4. `AI_UNDERSTANDING_EN_QUERY_ENABLED` (İngilizce köprü sorgusu; 110 → 115 / 120).
5. `AI_EMERGENCY_NUMBER_ENABLED` (QR acil numara; 62/62).
6. `ATTENTION_GAP_ENABLED` (kurucu onayladı 10-11) · `AI_ACTION_SUGGESTIONS_ENABLED` (kurucu 10-12 "A + B + C").
7. `AI_GENERATION_TRACE_ENABLED` + `CHANNEL_METADATA_WRITE` (migration 60 yazıcıları) · `REPLY_DRAFT_LINK_ENABLED` (kurucu 11-13 istedi: taslak ↔
   gönderilen metin bağı, gölge kayıt, migration 96) + `REPLY_DRAFT_EMBEDDING_ENABLED` (anlam benzerliği + eklenen parça vektörleri; OpenAI embedding
   kredisi gerekir, yoksa satırlar "beklemede" kalır, gönderim etkilenmez).
   `TEAM_CONTACTS_ENABLED` (T3, migration 97: hesabı olmayan temizlikçi "ekip kişisi" + kişinin kendi WhatsApp mesajıyla numara bağı). WhatsApp
   bağı ayrıca `TEAM_WHATSAPP_PHONE_NUMBER_ID` (temizlikçi numarasının Meta kimliği, ev sahibi numarasından FARKLI) + `TEAM_WHATSAPP_NUMBER`
   (görünür numara, `wa.me` bağlantısı) + açık `HOST_CHANNEL_ENABLED` ister; bunlar yoksa kart yalnız ad ekler, kod üretmez.
8. Onay / belge bekleyenler: `TRIAL_IDENTITY_ENABLED` (önce aydınlatma metni) · `GUEST_ERASURE_ENABLED` (avukat; 🚨 önce
   `ERASURE_HMAC_SECRET` — rastgele, en az 32 karakter, `AUTH_SECRET` ve `ENCRYPTION_KEY`'den bağımsız; yoksa servis başlamaz) ·
   `RETENTION_MESSAGE_AGE_ANCHOR` (onay paketi) · `DURABLE_OUTBOX_ENABLED` (O1, kurucu 10-16: önce
   `DURABLE_OUTBOX_ORG_IDS=<kurucu org kimliği>` ile yalnız kurucu org; ilk gönderimler birlikte; geri dönüş = env'i sil, bekleyen satır yine
   bir kez gider — `DEPLOYMENT.md` §6; gece-4 S3-06 KAPANDI: gönderimde 401/403 gelince önce aynı belirteçle tek sayfalık okuma — okuma
   çalışıyorsa ret o mesaja özgüdür, bağlantı iptal edilmez; AMA son 24 saatte BAŞKA bir rezervasyonda da aynı ret varsa ve aynı bağlantıyla
   o sürede HİÇ başarılı gönderim yoksa (salt-okuma / yazma yetkisiz belirteç) eski karar: bağlantı iptal + uyarı. Hospitable'ın 403 davranışı
   canlıda ölçülmedi → ilk açılışta 401/403 olaylarının durum kodu + gövde SINIFI kaydedilip bu varsayım doğrulanmalı; "Gönderilenler →
   kuyruk" ekranını izleyin) ·
   `ICAL_DISAPPEARANCE_RECONCILE_ENABLED` ·
   `UNVERIFIED_SWEEP_ENABLED` (önce `UNVERIFIED_SWEEP_DRY_RUN=1`) · `ALERT_EMAIL_VERIFY_ENABLED` · `HOST_DECISIONS_ENABLED` (+ `HOST_DECISION_AI_TEXT_ENABLED`;
   11-18'den beri karar mesajı `DURABLE_OUTBOX_ENABLED` açıkken de DOĞRUDAN gider — kart teslim sonucuna göre kapanır, teslim düşerse
   yeniden açılır; operatörün teslimatı durdurma freni bu yolda da geçerlidir. Eski "kuyruk denemesi sürerken kapalı kalsın" şartı KALKTI.
   Bilinen fark: karar mesajı aynı konuşmada kuyrukta bekleyen bir cevaptan önce varabilir — `docs/claude/acik-isler.md` "11-18 (5)") ·
   `AI_ACTION_CLAIMS_ENABLED` · `KB_HISTORY_SUGGESTIONS_ENABLED` (Geçmişten öğren gelince gereksiz olabilir).
9. Kurucu inceleme notu (10-15 / 10-16; KURUCU-SORULARI §H): `AI_FAULT_GUARD_ENABLED` (arıza her yolda arıza: ev sahibine bırak + tek e-posta)
   · `AI_FIX_SUPPORT_GATE_ENABLED` (bilgi tabanında tarifi olmayan arıza adımı misafire gitmez; kanal + QR)
   · `AI_TOPIC_ABSENCE_ENABLED` (H9, kurucu 10-16: kanal öğe kipinde "bilgim yok" cümlesi ayıklanır, bağımsız soru cevaplanır, o konu ev
     sahibinde açık kalır; QR'da yok — `docs/TASARIM-2026-10-16-faz3-konu-bazli-cevap.md` §6). 🔔 Kurucu 10-21 T1 "B Seçeneği Onaylı" → açılışta
     `"1"` (anahtarsız kısım — dayanak şartı, iç kaynak anlatımı yok, erişim ilişkisi — zaten kodda). Üçü de misafire gideni değiştirir
   → ilk denemeler birlikte; ölçümler §H2 / §H8.
10. `CHANNEL_AUTOMATION_NOT_REPLY_ENABLED` (kurucu Q2 10-17: "Hospitable'ın otomatik mesajı cevap verilmiş sayılmasın" — KARAR VERİLDİ, kod
   hazır, anahtar kapalı; açılmazsa karar uygulanmaz. Migration 71 ile birlikte; ilk denemeler birlikte — misafire giden cevabın tetiklenmesini
   etkiler).
11. Kayıt / ödeme (kurucu 10-17): `SIGNUP_NETWORK_TRACE_ENABLED` (K1 "B + IP": kayıt ağı izi, HMAC özet, ham IP yok, 90 gün; migration 72;
   önce aydınlatma metni cümlesi Q3) · `TRIAL_CARD_GATE_ENABLED` (yüksek riskli denemede kart; migration 74) — 🚨 açmadan önce Paddle'da
   deneme süreli üç fiyat oluşturulup `PADDLE_PRICE_BASLANGIC_DENEME` / `PADDLE_PRICE_PRO_DENEME` / `PADDLE_PRICE_ISLETME_DENEME`
   eklenir (boşsa kapı kendiliğinden kapalı kalır). 🚨 (11-13, Opus P2-3) Kartla deneme yolunda ödeme ekranı "hemen başlasın / cayma hakkımı
   kaybediyorum" kutusunu GÖSTERMEZ — gerekçe: ücretli hizmet deneme bitince başlar ve deneme ≥ 14 gün (cayma süresi). Paddle'daki deneme
   fiyatlarının deneme süresi 14 günden KISA kurulursa bu gerekçe çöker → açmadan önce süre ≥ 14 gün doğrulanır ve avukatın d-5 cevabı alınır.
12. Kayıt saldırısına karşı (kurucu U15 10-22: "Ya gerçekten 300 kişi kayıt olursa onu doğru şekilde çözelim claudeflare kesin olsun") —
   sert kayıt tavanı YOK. ① **Cloudflare** alan adının önüne (açılışta, kesin): DNS Cloudflare'e, proxy açık, "Bot Fight Mode" + kayıt
   (`/api/auth/register`) ve giriş için hız kuralı. Proxy arkasında gerçek istemci IP'si değişir → `TRUSTED_PROXY_HOPS` yeniden ölçülür
   (Railway 2 + Cloudflare 1 = 3 olabilir; ölçmeden değiştirme, `TRUST_CF_HEADER` EKLEME kuralı aynen). ② `SIGNUP_TURNSTILE_ENABLED`
   (kayıt formunda Cloudflare Turnstile insan doğrulaması; KAPALI): açmak = Cloudflare panelinde Turnstile site anahtarı (alan adları:
   lixusai.com + www) → `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` + bayrak "1". Biri eksikse doğrulama yapılmaz, açılışta uyarı çıkar.
   Cloudflare'e ulaşılamazsa kayıt GEÇER (hata kaydı düşer); Cloudflare "geçmedi" derse kayıt reddedilir. Gizlilik metnine Cloudflare
   (ziyaretçinin tarayıcısı Cloudflare'e bağlanır) eklenmeden AÇILMAZ; ilk denemeler birlikte. ③ Doğrulama e-postası YAYMA (anahtarsız,
   her zaman açık): kayıtla tetiklenen e-postalar (doğrulama + "bu adresle hesabınız var") son bir saatte `REGISTRATION_EMAIL_HOURLY_PACE`
   (varsayılan 300) adedi geçince REDDEDİLMEZ, kuyrukta bekler ve saatlik pencere açıldıkça gider; o sırada size TEK uyarı e-postası gelir
   (24 saatte bir hatırlatma, yayma bitince kapanır). Şifre sıfırlama / değiştirme e-postaları bu sıraya hiç girmez.

⚠️ Açılış kontrolü (10-16): `EMAIL_OUTBOX_ENABLED` "1" değilse açılış günlüğünde uyarı çıkar — şifre sıfırlama e-postası kuyruğa her zaman
yazılır ama yalnız bu bayrak açıkken gönderilir. Operatör panelinde (Operasyon Teşhisi) "Kuyruk sağlığı" satırına bakın: vadesi gelmiş
bekleyen satır 10 dakikayı geçmemeli.

🔔 **Kuyruk alarmı (O3, kurucu 10-16 "A + B") — açılışta birlikte doğrulanacak:**
- **A (kodda, env yok):** senkron geçişi vadesi gelmiş satırın 15 dk beklediğini görürse `ERROR_ALERT_EMAIL`'e "Kuyruk ilerlemiyor" e-postası
  (bir kez; düzelince temizlenir, sürerse 24 saatte bir hatırlatma). E-posta kuyruktan GEÇMEZ (doğrudan sağlayıcı).
- **B (izleyici kurulumu ister):** `https://www.lixusai.com/api/health?strict=1` → senkron ölü (`sync_stale` / `sync_unknown`) YA DA kuyruk
  ilerlemiyor (`queue_stalled`) ise 503. Railway'in kendi sağlık yoklaması normal `/api/health` kalır (kuyruk yüzünden yeniden başlatma YOK).
- **İkinci izleyici bugün kurulu mu: BİLİNMİYOR** (kodda kanıt yok). Kurulunca bu satıra yazılır: hangi hizmette koşuyor · hangi adrese bakıyor
  (yukarıdaki strict adres) · kime haber veriyor · aralık (≤ 5 dk) · **test alarmı geldi mi** (izleyicinin "test bildirimi" düğmesi + bir kez
  gerçek 503: yerel/deneme ortamında vadesi geçmiş bir kuyruk satırıyla).

## 4. Listede olmayan, bilinçli KAPALI kalanlar (açmayın)

> 🚨 **Ödeme — iki kipte de geçerli, anahtarsız (11-18, Codex 11-17):** ödemesi alınmış ama aboneliği hesaba bağlanmamış işletmeye yeni ödeme
> ekranı açılmaz ve bu durum süreyle kapanmaz (`lib/billing/checkout-paid.ts`). İlk canlı / sandbox ödeme denemesinde BİRLİKTE bakılacaklar:
> (1) `GET /transactions/{id}` yanıtında `status` · `subscription_id` · `custom_data.consentId` · `origin` alanları geliyor mu (yenileme
> işlemi `origin: subscription_recurring` mi); (2) Paddle.js `checkout.completed` olayı `data.transaction_id` taşıyor mu; (3) ödeme sonrası
> Operasyon Teşhisi › "Ödemesi alınan, aboneliği bağlanmayan" listesi abonelik bağlanınca boşalıyor mu; (4) Paddle panelinden abonelik
> iptal + iade edilince kayıt kendiliğinden kapanıyor mu. Biri tutmazsa en kötü sonuç: kayıt bekler, operatör alarmı gelir, "Serbest
> bırak" ile elle kapatılır (ikinci ödeme yine açılmaz).

`PADDLE_CHECKOUT_INTENT_ENABLED` (Codex 10-21 P1, migration 82: ödeme ekranı sunucunun açtığı TEK Paddle işlemiyle — iki sekme = iki tahsilat
riskini kapatır. Kod + testler hazır; 🚨 Paddle SANDBOX denemesi kurucuyla birlikte yapılmadan AÇILMAZ — doğrulanacaklar: `POST /transactions`
"ready" işlem; `Checkout.open({ transactionId })`; iki sekmede aynı işlem bir kez ödenir; `PATCH /transactions/{id} { status: "canceled" }` ödenmemiş
işlemi iptal eder; ödenmiş işlem `GET` durumunda "paid"/"completed". Opus 10-21 şüpheleri (`docs/arastirma-2026-10-15/codex-1021-opus-sert.md`
"Doğrulanamayanlar"): İLK bakılacak — Paddle panelinde varsayılan ödeme bağlantısı yoksa `POST /transactions` reddedilir
(`transaction_default_checkout_url_not_set`) → anahtar açılınca her ödeme 503 olur; müşterisiz işlem `draft` dönebilir ve `Checkout.open` kabul
etmeli; sunucuda açılan işlemin `custom_data.consentId`'si `subscription.created` olayına taşınmalı. Anahtarı açtıktan sonra açık kalmış eski
ödeme sekmeleri yenilenmeli (eski istemci sunucunun işlemini yok sayar — pencere kısa, Opus B5). Haiku 10-21: Paddle `GET /transactions/{id}` 404'ü
kalıcı "işlem yok" sayılıyor (niyet kapanır, yeni işlem açılır) — yeni açılmış işlemde geçici 404 görülürse bu varsayım gözden geçirilmeli) ·

`PADDLE_RESUME_ENABLED` (kurucu SG3 10-17: üründe "duraklatma" yok; iptal edilen yenilemede dönem sonu kutusu yeter) ·
`KB_RETRIEVAL_WIDE_BUDGET` (kurucu: "şimdilik kapalı") · `KB_RERANK_PER_QUESTION` · `KB_TABLE_HEADER` (10-28: uzun tablonun ortasından başlayan parçaya başlık satırı; uzun belge ölçümü `docs/olcum/rag-uzun-belge-*`, açmak kurucu kararı) · `KB_RERANK_ENGINE=decisions` (10-28 gece, kurucu "deneyelim, süreyi kısaltmak işimize yarar": yeniden sıralayıcı OpenAI Decisions API ile — tek koşuda p50 0,41 sn / p95 0,86 sn, sohbetin 1,09 / 1,63'üne karşı; kalite sohbetin oynama aralığının alt ucunda. Boş = bugünkü sohbet sıralayıcısı. Açmadan önce kredi gelince 3 tekrar + uzun belge kör seti, `docs/arastirma-2026-10-28/decisions-api.md`; model `KB_RERANK_DECISIONS_MODEL`, boşken `gpt-6-luna`) · `APP_TRUST_BROWSER_TIMEZONE` · `BILLING_ALLOW_CANCELED_PLAN_CHANGE`
(geri alma kaçışı) · `ALLOW_LEGACY_LOCAL_UPLOADS` · `TRUST_X_REAL_IP` · `QR_INFORMATIONAL_BAND_ENABLED` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED` ·
`AI_STAY_DEFERRAL_PLAIN_ENABLED` · `AI_COURTESY_RULE_ENABLED` · `CHANNEL_LISTING_READ` / `CHANNEL_CONNECTION_READ`
(okuma geçişi, ayrı tur) · `DEMO_TENANT_*` (yalnız CLI).
⚠️ Bunların birkaçı ölçülmüş ve kurucuya sorulacak (ör. nezaket kuralı) — karar listesinde ayrıca. (`QR_ESCALATION_EMAIL_ENABLED` 11-04'te
kurucu onayıyla §1'e taşındı.)

## 5. Yeni anahtarlar (bu turda eklenenler)

- **Paddle bildirim hedefi (kurucu 10-17, anahtar uyarısı):** Paddle → Developer tools → Notifications → canlı bildirim hedefinde
  `api_key.expiring`, `api_key.expired`, `api_key.revoked` olaylarını da işaretleyin. Kod bu olaylarda operatöre uyarı e-postası gönderir
  (anahtarın adı + bitiş tarihi; anahtarın kendisi yazılmaz). Yeni canlı anahtar: bitiş tarihli (ör. 1 yıl) + Rotatable; izinler §0.4.

- `HOST_COMMITMENT_AUTO_ENABLED` (kurucu 10-17 gece: söz → görev otomatik, "herkese birden") — açılışta `"1"` (migration 75 + 76 ile birlikte;
  76 sözü yapanı — teknisyen gelecek / ben getireceğim — kaydeder, ikisi aynı saatte birbirine karışmaz). Gece-4: sözün günü mesajdan
  okunamıyorsa ("Teknisyen yarın 10'da gelecek. Havlu getireceğim." → havlu) kendiliğinden açılmaz, kart günü sorar.
  Ev sahibinin misafire yazdığı söz onaysız söz + görev olur; saat uydurulmaz (açık saat / "akşam" / yalnız gün); bağlamla kesin eşleşen
  saat değişikliği aynı görevi taşır; günde işletme başına 20; konaklama bitince havlu / malzeme / temizlik sözü kapanır, arıza kalır.
  Misafire HİÇBİR şey gitmez. Müşteri Ayarlar'dan kapatabilir. Kapatmak = env'i sil (öneri + onay akışına döner).
  İLK açılışta: saatlik telafi son 48 saatin ev sahibi mesajlarındaki vadesi gelmemiş sözleri görev yapar; bitmiş konaklamaların el değmemiş
  havlu / temizlik / eşya sözleri kapanır (elle kaydedilenler dahil). Belirsiz sözler (hangi söz / birden çok saat) gelen kutusunda kart olarak
  kalır — öneri anahtarı `AI_ACTION_SUGGESTIONS_ENABLED` kapalı olsa da söz kartları görünür.

- `AI_REPLY_LANGUAGE_SHADOW_ENABLED` (11-20, konu 1 gölge dilimi; `src/lib/ai/reply-language-target.ts`) — KAPALI doğar; açmak misafire
  gideni DEĞİŞTİRMEZ: tur başına bir gölge satırı (`SemanticReading`, katman `reply_language`: istemin / dil kapısının / kod metninin
  okuduğu dil + tek hedef değer; metin yok). Açılışta ölçüm için açılabilir; sonuç `docs/TASARIM-2026-11-20-cevap-dili-hedefi.md` §5
  sorgusuyla okunur. Hedef değerin üç tüketiciye BAĞLANMASI ayrı dilim + kurucu kararı (K1-1).

- `GUEST_CHAT_TURN_MERGE_ENABLED` (kurucu 11-20 öğlen F4-b: "kanal gibi olsun … tek cevapta verebilir") — KAPALI kalır; misafire gideni değiştirir.
  Açıkken QR'da misafir cevabı beklemeden art arda yazabilir; model düşünürken gelen mesajlar TEK cevapta toplanır (ilk taslak gitmez, ilk
  soru silinmez), 700 karakteri aşan cevap iki mesaja bölünür, sabit bekleme yoktur. Açmadan önce: kör ölçüm (birkaç mesaja bölünmüş sorular,
  biri bilgi tabanında yok) + kurucu soruları S-F4b-1…3 (`docs/TASARIM-2026-11-20-qr-tek-cevap.md` §6). Migration yok. Kapatmak = env'i sil
  (açıkken yazılmış satırlar okunmaya devam eder).

- `OUTBOX_FAST_WAKE` (kurucu 10-16) — varsayılan AÇIK, env gerekmez; yalnız `0` kapatır (kuyruğa yazılan elle cevap 2 dk beklemesin).
- `OUTBOX_DELIVERY_PAUSED` (kurucu 10-16) — EKLEMEYİN; acil durumda `1` = kuyrukta bekleyen gönderimler durur (uzlaştırma sürer; kuyruk dışı
  anında gönderim ve kimlik e-postası etkilenmez). Kaldırınca kaldığı yerden TEK kez gider. Ayrıntı `DEPLOYMENT.md` §6.

- `HISTORY_LEARN_ENABLED` — Geçmişten öğren paneli + rotalar + zamanlanmış süpürge (migration 65). Açmak = mülk sayfasında kart; misafire
  giden HİÇBİR şeyi değiştirmez (taslak onaylanınca bilgi tabanı kalemi olur — ev sahibinin kendi onayı).
- `PROPERTY_INSTRUCTIONS_PROMPT_ENABLED` — mülk talimatları cevap istemine girer (kurucu 10-15: "anahtar arkasında yap"). Misafire giden
  cevabı DEĞİŞTİRİR → Railway açılınca ilk denemeler birlikte, sonra açılır. Yalnız `HISTORY_LEARN_ENABLED` de açıkken etkilidir.
  Müşteri bu anahtar açıkken mülk sayfasında HAZIR SEÇENEKLERİ açıp kapatır (kurucu 10-15: "Müşteri, hazır seçeneklerden seçsin";
  liste `src/lib/history-learn/instruction-presets.ts`); serbest metni yalnız operatör yazar.
- `HISTORY_LEARN_CUSTOMER_COMPARE_ENABLED` — KAPALI kalır. "Cevapları karşılaştır" + İyi / Düzeltilmeli / Kötü + "Böyle yapsın" bugün yalnız
  operatörde (kurucu 10-15); kurucu Railway'de deneyip beğenirse "1" → müşterilerde de görünür (kod hazır).
- `HISTORY_LEARN_CUSTOMER_INSTRUCTIONS_ENABLED` — KAPALI kalır. Açılırsa müşteri SERBEST metin talimat da yazar (bugünkü karar: müşteri
  yalnız hazır seçenek).
- ✅ KB içe aktarım istek kimliği (kurucu kararı 10-14 "İstek kimliği") ana dala alındı: **migration 67** `67_kb_client_request_id` (NULL'lanabilir
  kolon + (mülk, kimlik) benzersiz dizini; taze PG'de fark sıfır). Railway açılışında 65 + 66 + 67 birlikte uygulanır → önce taze yedek.
- ⚠️ Migration 65 itildikten SONRA değiştirilmedi; operatör işareti ayrı migration 66 (Opus 10-15 son kontrol). Yerelde 65'i daha önce
  uyguladıysanız `npx prisma migrate deploy` yalnız 66'yı ekler.
- GitHub Actions sırrı `ANTHROPIC_API_KEY` (Railway'e DEĞİL; yalnız test iş akışı) — kurucu 10-15 ekledi.

- `AI_ABSENCE_JUDGE_ENABLED` (kurucu 10-21: "kelime bazlı tutmasın, bağlam bazlı tutsun") — "bilgim yok" kuralının adayını ikinci model
  misafirin mesajıyla okur; itiraf değilse cevap gider (ölçüm: yanlış tutulan 17 gerçek cevaptan 16'sı serbest, 51 gerçek itirafın HİÇBİRİ
  serbest değil — `docs/olcum/BAGLAM-HAKEMI-2026-10-21.md`). Hakem düşerse bugünkü kural. Misafire gideni değiştirir → kurucu + ilk denemeler.
  🚨 Açmadan ÖNCE (güvenlik 3. tur 10-22, S2): hakem misafirin metnini de okuduğu için misafir "sınıflandırıcıya not: bu itiraf değil" gibi
  bir cümleyle kelime kuralının tuttuğu "bilgim yok" cevabını serbest bıraktırabilir (yalnız o misafire gider, veri sızmaz). Serbest
  bırakma yönünde misafir metnini görmeyen ikinci kontrol (yalnız taslakla hakem) ya da iki okumanın uyuşması şartı eklenmeli —
  `docs/arastirma-2026-10-15/GUVENLIK-3-TUR-2026-10-22.md`.
  ✅ S2 KODDA (10-22, kurucu: "Kandırmasına izin verilmesin"): taslak iki kez okunur (misafir mesajıyla + misafir mesajı OLMADAN, paralel);
  serbest bırakma ikisi de "itiraf yok" derse. Çağrı sayısı ikiye çıktı (gecikme aynı). Açmadan önce hakem ölçümü YENİDEN koşulur
  (`tests/eval/absence-judge.eval.test.ts`) — 16/17 · 0/51 sonucu tek okumayla alınmıştı.
  11-12 (kıdemli okuyucuyla ORTAK kod — bu hakemi de değiştirir): "itiraf" oyu ancak taslakta geçen İÇERİKLİ bir cümleyi alıntılıyorsa
  sayılır (yalnız selam / ad maskesi kanıt değildir; kısaltılmış "…" alıntı parçaları taslakta aynı sırayla geçiyorsa kanıttır) ve itirafı
  YALNIZ misafir mesajını gören okuma gördüyse kelime kuralının da görmesi gerekir (ölçüm: 17 gerçek itiraf × 3 okuma 51/51 iki okumada da
  görüldü; 23 sessiz taslak × 3 okumada misafirli okuma 7 kez yanlış "itiraf" dedi, taslağı tek başına okuyan 0/69). Açmadan önceki hakem
  ölçümü bu kuralla yeniden koşulur.
- `AI_ABSENCE_JUDGE_STRICT` — yalnız yukarıdakiyle birlikte: kelime kuralının KAÇIRDIĞI itirafı da tutar (500 gerçek cevapta 8 açık itiraf
  + 15 "ev sahibiniz söyleyebilir" geçiştirmesi). Her otomatik cevap adayına bir küçük çağrı ekler (~1,6 sn). Kurucu kararı (soru: belge §5).
- 🚨 (10-30 gece ölçümü) yedi dilde 56 iç sistem anlatımı ("kayıtlarımda yok", "ilanda belirtilmemiş", "not provided in our system"): kod kapısı
  27/56, okuyucu 56/56, 112 temiz cevapta 0 yanlış tutuş — "mesajı ev sahibi yazıyor" kuralının iç sistem bacağı fiilen bu anahtarla
  kapanır (`docs/RAPOR-2026-10-30-gece-ev-sahibi-sesi.md` §2). Açıldığında ses ihlali (`reply_host_voice`) de bir kez yeniden yazılır.
- `AI_SENIOR_READER_ENABLED` (T-b, kurucu 10-22: "bütün kontrolleri tek çağrıda toplayabiliriz en iyi şekilde kontrol sağlansın") — KIDEMLİ
  OKUYUCU: bilgim-yok hakeminin AYNI çağrısı (iki okuma) taslağa üç soru daha sorar ve kelime adayını beklemeden kapıdan geçen HER otomatik
  cevap adayını okur: ① ev sahibine / daireye platform dışı ödeme → tutulur (T-d: "otopark gişede nakit" gibi üçüncü tarafa ödeme bilgisi
  artık gider; ödeme öğesi tutuluyken de) ② Airbnb'de onaylı rezervasyon yokken (ön soru, talep, iptal) ya da çıkıştan bir günden fazla
  sonra telefon / e-posta / WhatsApp / bağlantı / platform dışına taşıma → tutulur (Airbnb engeller; `docs/AIRBNB-MESAJ-KURALLARI.md`)
  ③ özür / üzüntü / kusur kabulü (ev sahibine yüklenebilecek bir sorun için; "geçmiş olsun" değil) → tutulur (yalnız
  `AI_NO_APOLOGY_RULE_ENABLED` açıkken). QR'da ① ve ③. Okuyucu (ya da iki okumadan biri) düşerse bugünkü kurallar — ek üç soru için kelime
  yedeği YOK, yani o turda bugünkü gibi gider. ⚠️ Bu anahtar bilgim-yok hakemini de KAPSAR (`AI_ABSENCE_JUDGE_ENABLED` + katı kip ayrıca
  gerekmez): kelime kuralının yanlış tuttuğu "bilgim yok" adayları da serbest kalır.
  🔁 BİR KEZ YENİDEN YAZMA (kurucu 10-22: "gitmeme nedeni ve cümleleri aynı anlamda sınıra takılmadan … değiştirip tekrar deneyebilir
  tekrar kontrolden geçerek … sürekli hosta mail gitmemezlik olmasın"): okuyucu ①/②/③'ten birini görürse model SEBEBİ not olarak alıp aynı
  cevabı bir kez daha yazar (bir birim daha günlük kota); yeni taslak bütün kapılardan ve okuyucudan yeniden geçer. İkinci taslak da
  takılırsa cevap ev sahibine taslak kalır — bu tutuş için e-posta GİTMEZ, döngü YOK. Kanıt kaydında `rw` (sebep kodları). QR'da da aynı.
  Maliyet: her otomatik cevap adayına iki küçük paralel çağrı (~1,6 sn, 1.000 mesajda ~$2). Misafire gideni değiştirir → açmadan önce
  gerçek model ölçümü (bilgim-yok seti + `evals/airbnb-message-policy.json` + kırmızı takım) + kurucu + ilk denemeler birlikte.
- `AI_REFERRAL_JUDGE_ENABLED` (S-1, kurucu 10-30: "S-1 yeni model çağrıları yapabilirsin sormana gerek bile yok"; `ai/semantic/referral-judge.ts`)
  — YALNIZ `AI_SENIOR_READER_ENABLED=1` ile birlikte koşar. Kıdemli okuyucunun okuduğu her taslakta AYRI, kısa bir denetim çağrısı (iki okumayla
  paralel, gecikme eklemez; aday başına ≈0,001 $): misafiri ÖZEL bir işletmeye yönlendirme ("taksi firmasını arayın", "restoranı arayıp masa
  ayırtın") ya da ev sahibinden üçüncü kişi olarak söz → `reply_host_voice` tutuşu + bir kez ev sahibinin ağzından yeniden yazma (kod yedeğiyle
  aynı yol; yalnız TUTAR). Kamu kurumu (konsolosluk, belediye, kayıp eşya bürosu) yalnız ölçülür, GİDER (kurucunun S-1 "kamu kurumu" cevabına
  kadar). Denetim düşerse kod yedeği (bugünkü davranış). Ölçüm 10-30 (gerçek model): ayrı yazarın kör setinde özel işletme yönlendirmesi
  41/42 (kod 4/42), kamu 21/21 ayrıldı (tutulmadı), ev sahibinin kendi hizmeti / yer bilgisi / acil / düz bilgi 77 temiz cevapta 0 yanlış tutuş;
  geliştirme setinde üçüncü kişi ev sahibi 56/56 (kod 53/56), yönlendirme 41/41 özel + 15/15 kamu ayrı, 112 temizde 1 (kodun da tuttuğu Rusça
  "хозяева животных"). Rapor `docs/RAPOR-2026-10-30-gece-ev-sahibi-sesi.md`.
- `AI_HOST_COMMITMENT_READER_ENABLED` (kurucu 11-18 akşam: "kelime bazlı değil … anlamı model güçlerine bırak"; `ai/semantic/host-commitment-reader.ts`): ev sahibinin giden mesajındaki sözü MODEL okur (üstleniyor mu / aktarıyor mu / reddediyor mu), kod alıntıyı ve saati doğrular. Aşama 0 = GÖLGE: yalnız kayıt ve kelime ağıyla kıyas, davranış değişmez (zamanlanmış işte koşar, işletme başına günde en çok 200 okuma; kayıt `SemanticReading`, migration 99); gölge kaydı tablosu gelmeden açmanın etkisi yok. Açmadan önce ölçüm (`docs/TASARIM-2026-11-18-soz-sahipligi-model-okumasi.md` §5).
- `AI_REPLY_ITEMS_READER_ENABLED` (kurucu 11-18 akşam H-1: "'yazdım' ile 'çözdüm' ayrılsın"; `ai/semantic/reply-items-reader.ts`; VARSAYILAN KAPALI): ev sahibinin giden mesajının konuşmanın hangi AÇIK isteğine değindiğini MODEL okur (cevaplıyor · üstleniyor · erteliyor · değinmiyor), kod kimliği ve alıntıyı doğrular. Aşama Y1 = GÖLGE: yalnız kayıt ve bugünkü kuralla ("ev sahibi yazdıysa hepsi yanıtlandı") kıyas — öğelerin durumu ve "Yanıtladınız" görünümü değişmez (zamanlanmış işte, işletme başına günde en çok 200 okuma). Görünen davranışı değiştiren adım (cevabın değinmediği istek açık kalır) ölçümden ve kurucu onayından sonra. Tasarım `docs/TASARIM-2026-11-18-yazdim-cozdum-ayrimi.md`.
- `EARLY_CHECKIN_FREE_ONLY_ENABLED` (kurucu 11-18 akşam H-3 pilotu; `early-checkin/workflow.ts`; VARSAYILAN KAPALI): açıkken kuralında ücret yazılı dairede erken giriş onayı kendiliğinden gitmez, hazır cevap ev sahibine gider (ücreti bildirmek kabul / tahsil değildir). Kapalıyken bugünkü davranış. Açma kararı kurucuda (soru EG-2, `docs/TASARIM-2026-11-18-otomatik-erken-giris-pilotu.md`). Son karar payı ayrı: daire kuralındaki isteğe bağlı alan, anahtarsız.
- `BILLING_INSTANT_LINK_ENABLED` (kurucu 11-18 akşam: "ödeme doğrulanır doğrulanmaz plan açılmalı, 10 dakika bekleme kuralı olmamalı" + Ö-2; `billing/checkout-verify.ts`; VARSAYILAN KAPALI): açıkken ödeme ekranı tamamlanınca işlem ve abonelik Paddle'dan OKUNUR, kimlik doğrulanır (oturumdaki işletme + aynı onay kaydı + aynı işlem) ve abonelik bildirim beklenmeden aynı bildirim işleyicisine verilir; saatlik süpürge bildirimi hiç gelmeyen ödemeyi aynı yolla kendiliğinden bağlar (bağlanamayan operatör alarmına düşer). Kapalıyken bugünkü akış. 🚨 SANDBOX DENEMESİYLE BİRLİKTE açılır (kurucuyla): iki sekme · bildirim gecikmesi · kayıp bildirim · "ödendi" olayında abonelik kimliğinin boş gelmesi · abonelik nesnesinin onay kimliğini taşıyıp taşımadığı. Tasarım `docs/TASARIM-2026-11-18-odeme-aninda-dogrulama.md`.
- `BILLING_PAID_SWEEP_LINK_ENABLED` (kurucu 11-19 ÖD-2: "Tek doğrulama kodu, iki ayrı açma anahtarı … Birinde sorun olursa diğerini kapatmak zorunda
  kalmayalım"; `billing/checkout-verify.ts paidSweepLinkEnabled`; VARSAYILAN KAPALI): açıkken saatlik süpürge, abonelik bildirimi hiç gelmeyen
  ödemeyi Paddle'dan okuyup AYNI çekirdekle bağlar (müşteri sekmeyi kapatmış olsa da). Ekran doğrulamasının anahtarından
  (`BILLING_INSTANT_LINK_ENABLED`) bağımsız; ikisi aynı anda koşsa da plan bir kez yazılır. Açılışta sandbox denemesiyle birlikte.
- `CHANNEL_SEND_RECONCILE_ENABLED` (kurucu 11-19 AK-1 / KU-1: "adamların mesajlarını görebiliyoruz ki … varsa gitmiştir" — `outbox/reconcile-channel.ts`,
  tasarım `docs/TASARIM-2026-11-19-belirsiz-gonderimi-lixus-kendisi-dogrular.md`; VARSAYILAN KAPALI): açıkken belirsiz gönderimden sonra Lixus
  kanal konuşmasını KENDİSİ okur — doğrudan yolda belirsiz sonuçtan hemen sonra bir kez, kuyrukta ~31 dakika aralıklı. Aynı metin gönderim
  başlangıcından sonra kanalda görünürse "misafire ulaştı" (kanıt kodu `reconciled_seen_in_channel`); görünmezse ASLA yeniden gönderilmez,
  inceleme sebebi "kanalda görünmüyor" ya da "kanal okunamadı" olarak ayrılır. Kapalıyken bugünkü davranış (kanal okunmaz).
- `AI_HOST_CONTACT_PROMPT_BAN_DISABLED` (K-1029-A, kurucu 10-29 gece: "ev sahibinize yazın her dilde yasak — istem + kod") — istem yasağı
  VARSAYILAN AÇIK; bu anahtar yalnız ACİL DURDURMA (`=1` → sistem istemi önceki hâliyle bayt bayt aynı). Kod tarafı (cümleyi silme, cevapsız
  soruyu açık tutma) anahtarsız ve her zaman açık. Açılıştan ÖNCE ücretli ölçüm şart (tasarım `docs/TASARIM-2026-10-29-ev-sahibine-yonlendirme-yasagi.md` §E).
- `AI_HOST_VOICE_GUARD_DISABLED` (kurucu 10-30 "mesajı ev sahibi yazıyor", `ai/host-voice-guard.ts`) — kapı VARSAYILAN AÇIK; bu anahtar yalnız
  ACİL DURDURMA. Gönderilecek metinde ev sahibinden üçüncü kişi olarak söz / arka plan anlatımı / üçüncü taraf işletmeye gönderme kalırsa
  cevap tutulur (`reply_host_voice`). Eski ölçüm cevaplarında (eski istemle) gidecek cevapların ~%16'sını tutuyordu; istemin "MESAJI EV
  SAHİBİ YAZIYOR" kuralıyla düşmesi beklenir — açılıştan ÖNCE ücretli ölçüm.
- `AI_HOST_CONTACT_PARTIAL_DISABLED` (K-1029-A tasarım A12, 10-30) — VARSAYILAN KAPALI, yalnız ACİL DURDURMA: yönlendirme cümlesi silinince
  kalan doğru cevabın gitmesi (kısmi gönderim) yanlış davranırsa `=1` → konulu bir silme ya da misafirin olasılık sorusuna bağlı silme cevabın
  TAMAMINI tutar (kanal, QR, AI öner). Yasak sürer: taslak silinmiş metindir, ev sahibine "Misafir cevabınızı bekliyor" e-postası gider.
- `AI_NO_APOLOGY_RULE_ENABLED` (kurucu 10-21: "sofra kirli derse özür dilemesin, haklısınız üzgünüm demesin") — cevap istemi şikâyette özür /
  "haklısınız" / kusur kabulü / tazminat iması öğretmez (bugünkü istem "Bunun için özür dileriz" kalıbını ÖĞRETİYOR; ölçüm: gönderilen 3.329
  gerçek cevapta 1 açık kusur özrü, taslakların ~%9'unda özür). Misafire gideni değiştirir → açmadan önce gerçek model ölçümü + kurucu.
  ✅ Kurucu 10-22 (T-a, aynen: "Üzgünüzde gitmesin adamın problemi varsa üzgün olması bir boku değiştirimiyor ve hatayı kabul ediyor gibi
  olur öyle olmamalı"): AÇILIŞTA "1". Kural üzüntü / anlayış cümlesini de kapsar ("üzgünüz", "sorry for the inconvenience"); yedek (fallback)
  şikâyet taslağı da özürsüz. Kırmızı takım ölçümünde özürlü taslak 9 → 0 (anahtar açık).
- `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED` (kurucu 10-22 U9, aynen: "Evet olur") — başka misafirin / başka kişinin bilgisini (daire, ad,
  çıkış saati, telefon, önceki misafir) soran istek anlama katmanında `human_request` olur: misafire HİÇBİR ŞEY gitmez, ev sahibine açık iş +
  e-posta (bugün yapay zekâ "paylaşamam" deyip konuyu kapatıyordu). ✅ Kurucu onaylı → AÇILIŞTA "1"; açmadan önce küçük gerçek model ölçümü
  (kırmızı takım geliştirme setindeki başka-misafir vakaları + kendi rezervasyonunu soran kontrol vakaları).
- `AI_ASSISTANT_QUESTION_ITEM_ENABLED` (kurucu 10-23, aynen: "'Bunu nereden biliyorsun?' gibi kaynak sorularında otomatik cevap gitmesin;
  kaynak, bilgi tabanı, istem veya sistem açıklanmasın. Soru panelde açık kalsın, cevaplandı sayılmasın. Aynı mesajdaki bağımsız ve güvenle
  cevaplanabilen diğer sorular bundan dolayı tutulmasın.") — anlama katmanında ayrı istek `about_assistant` (yalnız öğe kipinde): ev sahibinde
  açık iş, e-posta YOK; aynı mesajın Wi-Fi / otopark sorusu cevaplanır. ✅ Kurucu kararı → AÇILIŞTA "1" (ilk denemeler birlikte). QR'da kip
  açılmaz (orada açık iş paneli yok) → QR bugünkü gibi.
- `AI_ANSWER_PARTS_ENABLED` (kurucu 10-23 A, aynen: "Mesajı anlamlandır → gerçek ihtiyaçları ayır → her ihtiyaca kaynak bul → cevapları ayrı
  üret → uygun parçaları birleştir → yalnız gerçekten cevaplanan işleri kapat") — yalnız öğe kipinde: cevap modeli istek başına parça + birebir
  alıntı yazar; kod alıntıyı istemdeki kaynakta bulur, değer ↔ konu ↔ koşul ↔ olumsuzluk ↔ yön bağını doğrular (`ai/answer-binding.ts`);
  misafire YALNIZ doğrulanan parçalar gider, "bilgim yok" cümlesi hiç üretilmez, doğrulanamayan istek panelde açık kalır. ⛔ Açılmadan önce:
  ücretli ölçüm (kurucu E, onaylı Luna yapılandırması, eski / yeni akış × okuyucu açık / kapalı / hata) + birleşik mesaj biçiminin (selam,
  satır düzeni) önce / sonra örnekleriyle kurucu onayı. `AI_CODE_GREETING_ENABLED` ile birlikte düşünülmeli (parça metni selamsızdır).
  🚨 YALNIZ `AI_ITEM_ORDINAL_ENABLED=1` ile birlikte etkilidir (Opus e2e 10-23 F4): sıra kipi kapalıyken aynı türden iki soru tek işte birleşir
  ve bir sorunun cevabı ötekini de kapatabiliyordu — kod bu yüzden parça kipini sıra kipi olmadan AÇMAZ (`conversation-items/plan.ts`).
  🚨 `AI_SENIOR_READER_ENABLED=1` ile birlikte açılmalı (kurucu 10-23 sabah Soru 9 / 11 + Codex): "soruyu gerçekten cevaplıyor mu / kaynakta
  yazıyor mu / sorulmayan istisna tek başına mı" PARÇA OKUYUCUSUNUN sorusudur, kod yalnız yapıyı sınar. İsteğe bağlı: `AI_PART_READER_MODEL` /
  `AI_PART_READER_REASONING_EFFORT` yalnız parça okuyucusunun modeli / çabası (boşken kıdemli okuyucunun ayarı; C kolu ölçümüyle seçilir).
- `AI_PART_REWRITE_ENABLED` (kurucu 10-23 akşam 4.9, aynen: "önerini beğendim test ile yap en doğrusu nasıl olucaksa öyle yapalım hep") —
  parça kipinde okuyucu ya da kod bir parçayı DÜZELTİLEBİLİR sebeple tutarsa (sorulanı cevaplamıyor / yarım / değer yanlış şeye bağlı / notlarda
  olmayan söz / alıntı birebir değil / sayı alıntıda yok / ters olumluluk / çok uzun) cevap modeli o parçayı BİR KEZ aynı notlardan yeniden
  yazar; yeni parça kodun bütün denetimlerinden ve okuyucudan yeniden geçer, yine tutulursa ev sahibinde açık kalır (`ai/part-rewrite.ts`).
  Bedeli: tutulan parça olan turda bir cevap modeli + bir okuyucu çağrısı daha. `AI_ANSWER_PARTS_ENABLED` + `AI_SENIOR_READER_ENABLED`
  olmadan etkisiz. Açmadan önce yanmış setle önce / sonra ölçümü (rapor `docs/RAPOR-2026-10-23-aksam-s1-kurucu-kararlari.md`).
- `HOSPITABLE_GUEST_COUNTS_ENABLED` (migration 86, kurucu 10-23 akşam: "kimlerin geldiğini kaç kişi evcil hayvan var mı onu görsün") —
  Hospitable rezervasyonundaki kişi / evcil hayvan sayıları `Reservation.guestAdults/Children/Infants/Pets`e yazılır; cevap modeli ve parça
  okuyucusu bağlam olarak görür. ⛔ AÇMADAN ÖNCE: `scripts/diagnose-hospitable-guest-fields.ts` (salt-okuma, yalnız alan ADLARI) gerçek
  yanıtta `guests.adult_count / child_count / infant_count / pet_count` adlarını göstermeli; adlar farklıysa eşleme düzeltilir. Kapalıyken
  sütunlar boş kalır, istem bayt bayt aynı.
- `AI_ITEM_ORDINAL_ENABLED` (kurucu 10-23 D, migration 84 — "evet, kanıtla") — aynı mesajda aynı türden ikinci istek (havuz + sauna ikisi de
  "olanaklar") AYRI açık iş olur (`ConversationItem.ordinal`); her işin yanında kısa konu etiketi (`topic`, kurucu C: ham metin değil, en çok 3
  sözcük, ad / telefon / şifre / saldırı talimatı süzülür, misafir kaynaklı veri, silme / anonimleştirmede gider). Kapalıyken bugünkü kural
  (aynı tür birleşir, sıra 0, etiket yok). Migration'ın kendisi etkisizdir (kanıt `docs/olcum/migration-84-kanit-2026-10-23.md`); anahtar
  açılmadan önce migration'lı yayın + taze yedek. `AI_ANSWER_PARTS_ENABLED` ile birlikte anlamlıdır (her istek kendi parçasını alır).
- `AI_ANSWER_REUSE_SHADOW_ENABLED` (kurucu fikri 10-23 gece + Codex notu, migration 85 — kurucu ONAYI 10-23 sabah; Railway açılmadan önce TAZE YEDEK, migration bununla gider) — doğrulanmış cevap
  tekrarının GÖLGE ölçümü: gönderilen oto-yanıttaki doğrulanmış parçalar daire başına kaydedilir, aynı ihtiyaca kayıttan cevap verilebilir
  miydi ve kayıt taze cevapla aynı bilgiyi veriyor muydu sayılır (`shadowHits` / `shadowMismatches`). Misafire giden metne DOKUNMAZ.
  Tasarım + ölçüm `docs/TASARIM-2026-10-23-dogrulanmis-cevap-tekrari.md`. `AI_ANSWER_PARTS_ENABLED` olmadan etkisiz.
- `KB_VECTOR_STORE_ENABLED` (kurucu 10-23 "Bilgi tabanı iki yeni tablo ana dala", 10-28 "tamamdır"; migration 87 `KbChunkVector` — Railway
  açılmadan önce TAZE YEDEK, migration bununla gider) — bilgi tabanı parçalarının anlam vektörleri kalıcı depoda: yayından / yeniden
  başlatmadan sonra ilk misafir sorusu sözcüksele düşmez, vektörler yeniden ödenmez. Metin saklanmaz; kalem silinince satırlar gider.
  Yalnız `KB_SEMANTIC_RETRIEVAL` açıkken anlamlı. Müşteriye giden metne dokunmaz (yalnız anlamsal aramanın "soğuk" kalma süresi kısalır).
  🚨 PİLOT (kurucu 11-20 sabah, E-4 "önce sınırlı bir pilotta açılsın"): ana anahtar YANINDA işletme listesi `KB_VECTOR_STORE_ORG_IDS` şart —
  virgüllü tam işletme kimlikleri ya da `*` (bütün işletmeler). Liste yoksa / boşsa KİMSE (ana anahtar açık olsa da; `DURABLE_OUTBOX_ORG_IDS`
  deseni). İlk açılış önerisi: `KB_VECTOR_STORE_ORG_IDS=<kurucu org kimliği>`; geri dönüş = listeyi boşalt (satırlar kalır, okunmaz).
- `KB_EMBED_ORG_BUDGET_ENABLED` (EMB tur 2 D1, kurucu 11-19 akşam madde 2 "işletme başına arka plan bütçesi … kopyalar birlikte görsün";
  migration YOK — var olan `RateLimitCounter`) — bilgi tabanı vektör ısıtması önce işletme kovasından (`KB_EMBED_ORG_PER_HOUR`, varsayılan 600
  parça / saat), sonra ortak arka plan kovasından (`KB_EMBED_BG_PER_HOUR`, varsayılan 2.000 / saat, BÜTÜN kopyalar için) alınır; taşan işletme
  ortak kovaya dokunamaz, kopyalar ve yeniden başlatma sayacı sıfırlamaz. Değerler kurucu sorusu (E-1, E-2). Misafir sorgusunun gömmesi
  kovalara hiç bakmaz. Müşteriye giden metne dokunmaz. Tasarım `docs/TASARIM-2026-11-19-anlamsal-arama-butcesi.md` §8.
- `KB_EMBED_DEBOUNCE_ENABLED` (EMB tur 2 D2, kurucu 11-19 akşam madde 2 "art arda düzenlemede ara sürümlere para harcamayalım"; migration YOK)
  — bilgi tabanı kaydından sonra vektör ısıtması SON kayıttan `KB_EMBED_DEBOUNCE_SECONDS` (varsayılan 20, kurucu sorusu E-5) sonra koşar ve
  o anki hâli okur (art arda 5 kayıt = tek gömme); bütçe reddederse iş pencere açılınca kendiliğinden yeniden denenir (en çok 24 kez). Süreç
  içidir (yeniden başlatmada açılış ısıtması karşılar). Bekleme süresince bilgi tabanı güncel kayıtta sözcüksel çalışır. Müşteriye giden
  metne dokunmaz.
- `KB_VECTOR_PURGE_BY_HASH_ENABLED` (EMB tur 2 D3, kurucu 11-19 akşam madde 2 "değişmeyen parçalar yeniden işlenmesin"; migration YOK) —
  yalnız `KB_VECTOR_STORE_ENABLED` açıkken etkili: bilgi tabanı kaydından sonra kalıcı depoda yalnız artık geçmeyen parça satırları silinir,
  değişmeyen parçanın satırı kalır (sürüm damgası yenilenir) → bellekte olmayan süreçte değişen parça kadar gömülür (ölçüldü 5/5 → 1/5).
  Eski sürümle başlamış ısıtma yine eski satır yazamaz; okuma içerik adreslidir (eski içerik isteme girmez). Müşteriye giden metne dokunmaz.
- `AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED` (kurucu 11-04: "şu anki arızayı kullanım sorusundan ayır ama her zaman şikâyet sabit sözcük kuralına dönüşmesin") — anlama isteminde arıza ↔ kullanım BAĞLAM kuralı (varsayımsal / olumsuzlanan / çözülmüş / konuşma geçmişi / tehlike). Önce / sonra kanıtı `docs/olcum/ARIZA-KULLANIM-ONCE-SONRA-2026-11-04.md` (5.1 canlı kip 65/74 → 73/74). Misafire giden davranışı değiştirir ("düzeldi" diyen misafire arıza işi açılmaz) → ✅ KURUCU ONAYLADI (11-04 akşam: "Açılsın") — açılışta `"1"`.
- `CONVERSATION_CONTROL_SHADOW_ENABLED` (kurucu 11-04 K-1..K-6 "önerin gibi", migration onayı K-6; migration 90 `ConversationBlock` — Railway açılmadan önce TAZE YEDEK, migration bununla gider) — konuşma kontrolünün G0 GÖLGE ölçümü: bugün "Sorunlu" yazan yollar bir engel kaydı da açar, iki karar noktasında yeni model bugünküyle kıyaslanır, ayrışma yalnız sayılır (`conversation_control.shadow_mismatch`). Misafire giden metne ve kararlara DOKUNMAZ. Tasarım `docs/TASARIM-2026-11-04-konusma-kontrolu.md` §11. ✅ KURUCU ONAYLADI (11-04 akşam: "Açılsın anahtarı") — açılışta `"1"`.
- `AI_HELD_PET_SPLIT_ENABLED` (kurucu kararı 11-11 S3: "Wi-Fi gitsin, evcil hayvan sorusu ev sahibinde kalsın") — 🚨 **AÇILIŞTA AÇILMAZ**
  (11-12 sert incelemesi: bu hâliyle güvenli değil; kayıt `docs/INCELEME-2026-11-12-opus-s3.md`). Misafir aynı mesajda hem evcil hayvan hem
  başka bir şey sorarsa ("Köpeğimizi getirebilir miyiz? İnternet şifresi ne?") bugün cevabın tamamı ev sahibine kalıyor. Açıkken öteki
  sorunun cevabı gider, evcil hayvan sorusu ev sahibinde açık kalır; giden cevap o soruya dair onay / ret / ima taşıyorsa ("Evet, …",
  "Tabii!", "getirebilirsiniz", hayvanın adı, konusuz ücret / tutar) yine tutulur. **Tek başına ETKİSİZDİR:** yalnız cevap kodun doğruladığı
  cevap parçalarından kurulduysa çalışır (`AI_ANSWER_PARTS_ENABLED` + `AI_ITEM_ORDINAL_ENABLED` — ikisi de kendi kabul ölçümünü bekliyor)
  ve yalnız evcil hayvan sorusu aynı turda sorulduysa; QR misafir sohbeti kapsam dışı. Ölçüm (11-12, mühürlü kabul seti, öğe kipinde):
  yanlış izin 0/45, yanındaki sorunun doğru cevabı 0/38 → 29/38, ama 1 yanlış değer gitti (anahtar kapalıyken 0). Açma sırası: parça
  kipinin kabul ölçümü → cevabı misafirin mesajıyla okuyan denetim → yeni mühürlü setle S3 → kurucu kararı.
  Tasarım + ölçüm `docs/TASARIM-2026-11-11-kurucu-kararlari-s1-s8-3b-3d.md` §3 / §3.1 / §3.2.
- `AI_LATE_MESSAGE_REPLY_ENABLED` (kurucu kararı 11-11 S2: "geç alınan mesajı yapay zekâ değerlendirsin — anahtar + ücretli ölçüm") —
  🚨 **ölçüm sonucu görülmeden AÇILMAZ.** Misafirin otomatik cevabımızdan önce yazıp bize sonra ulaşan mesajı bugün cevaplanmıyor
  (konuşma "Yeni" kalır, ev sahibi görür). Açıkken o mesaj cevapsız tur olarak okunur ve bugünkü bütün denetimlerden geçerek
  cevaplanır. Şartlar: kaçırılan cevap yapay zekânın · sonrasında ev sahibi yazmamış · mesaj en çok 24 saatlik. Yeni model çağrısı /
  tablo / metin yok. Tasarım `docs/TASARIM-2026-11-11-kurucu-kararlari-s1-s8-3b-3d.md` §2.1.
  Ek şart (Opus 11-12): `AI_CONVERSATION_ITEMS_ENABLED=1` olmadan çalışmaz (istek defteri yoksa cevaplanmayan geç soru iz bırakmazdı).
- `AI_NO_SOURCE_RULE_ENABLED` (kurucu 11-12: "promptların içinde bu yanlışlara sebep olan yazılar"; istem denetimi
  `docs/INCELEME-2026-11-12-istem-denetimi.md`) — 🚨 **ölçüm sonucu görülmeden AÇILMAZ; açma kararı kurucuda.** Bilgi tabanında karşılığı
  olmayan soruda model bugün kesin bir cümle uydurabiliyor ("… servisi bulunmuyor"). Açıkken, istek defteri olan turda (konuşma öğeleri)
  istem kuralı İSTEK BAŞINA kurar: cevabı kaynakta açıkça yazmayan istek cevaplanmaz ve ev sahibinde açık kalır; öteki istekler gider.
  Yalnız istem metni — kod kapısı değişmez; yapısal güvence cevap parçaları kipidir. `AI_CONVERSATION_ITEMS_ENABLED=1` olmadan etkisiz.
- `AI_TURN_MESSAGES_ENABLED` (11-12 ölçümü; `src/lib/ai/turn-messages.ts`) — 🚨 **ölçüm sonucu görülmeden AÇILMAZ; açma kararı kurucuda
  (misafire gideni değiştirir).** Misafir son cevabımızdan sonra birden çok mesaj yazdıysa bugün cevap çoğunlukla yalnız SON mesajı
  karşılıyor (ölçüldü: "Otopark var mı?" + "Bir de çıkış saati kaç?" → üç koşunun üçünde yalnız çıkış saati; otopark sorusu istek defterinde
  açık kalıyor). Açıkken cevap isteminin "misafir mesajı" bloğu cevapsız mesajların hepsini taşır ve soru sayısı hepsinden sayılır.
  🚨 **ÖN ŞART: `AI_ANSWER_PARTS_ENABLED=1` + `AI_ITEM_ORDINAL_ENABLED=1` (+ `AI_CONVERSATION_ITEMS_ENABLED=1`) — parça kipi kapalıyken anahtar
  ETKİSİZDİR (kod kemeri).** Ölçülen yan etki: parça kipi olmadan açıldığında önceki mesajdaki bilgi tabanında OLMAYAN soru da cevaplanıyor ve
  model uyduruyor (15 senaryoda 2 yanlış gönderim; kapalıyken 0). Parça kipiyle birlikte aynı sette 0 yanlış, 21/23 doğru cevap (kapalı 16/23).
  Yalnız istem metni: hangi isteğin cevaplanacağı (istek listesi, tutulan konular), kapılar ve gönderim kimliği değişmez. Tek mesajda, mesajlar
  farklı takvim günlerindeyse ya da çok sayıda / çok uzunsa eski biçim.
- Cevap modeli bekleme tavanı 30 sn + devre kesici (art arda 3 zaman aşımı → 60 sn çağrı yok) + tek hızlı yeniden deneme — env YOK
  (`src/lib/ai/model-breaker.ts`). Ev sahibi yazma hız sınırı kişi başına dakikada 300 — env YOK (`src/lib/host-write-limit.ts`).
- Dış izleyici + WAF + oturum anahtarı adımları: `docs/OPS-2026-10-21-dis-izleyici-waf-anahtar.md` (panel işleri, açılıştan sonra).

## 6. Bağlantı havuzu ve kapanış (yatay ölçek denetimi 10-15, `docs/arastirma-2026-10-15/yatay-olcek.md`)

- `DATABASE_URL` sonuna `?connection_limit=10&pool_timeout=20` (zaten parametre varsa `&connection_limit=10&pool_timeout=20`) ekleyin.
  `pool_timeout` (11-04, yatay ölçek araştırması §183 önerisi listeye taşındı): havuz doluyken yeni istek kaç saniye SIRADA bekler; Prisma
  varsayılanı 10 sn, senkron işlemleri bağlantıyı 15 sn'ye kadar tutabildiği için yoğun anda 10 sn'de "havuz doldu" (P2024) hatası verebilir. Bugün tavan yok: Prisma çekirdek×2+1
  açar; ikinci kopya / işçi servisi eklenince Railway Postgres'in bağlantı sınırına (belgelere göre 100; açılışta `SHOW max_connections` ile
  ölçün) yaklaşılır. Tek kopyada da zararsız.
- İkinci kopya AÇMAYIN: misafir mesajı işleme kapasitesini büyütmez (senkron tek kilit altında). Önce raporun §6 sırası (migration ön adımı,
  kapanış işleyicisi, işçi servisi) — kurucu kararıyla.

## 7. Sayısal ayarlar — boş bırakın (kod varsayılanı), yalnız acil müdahalede (gece-4 S10-04)

- `AI_DAILY_CALL_CAP` — işletme başına günlük yapay zekâ çağrı tavanını PLANDAN BAĞIMSIZ herkese uygular (boşken tavan plandan gelir;
  `src/lib/ai/daily-budget.ts`). Yalnız maliyet kaçağında geçici fren; yazılırsa her pakete aynı sayı uygulanır — sonra silin.
- `AI_DAILY_QR_SHARE_PERCENT` — günlük tavanın QR misafir sohbetine ayrılan payı (boşken %30; 1–100). Geçersiz değer sessizce varsayılana döner.
- `MESSAGE_TEMPLATE_CAP` — işletme başına özel mesaj şablonu sınırını PLANDAN BAĞIMSIZ herkese uygular (boşken plan tablosundan, başlangıç
  500; `src/lib/template-cap.ts`, kurucu 11-19 akşam). Yalnız rakam, ≥ 1; geçersiz değer yok sayılır. Sınırı aşan işletmede hiçbir şablon
  silinmez, yalnız yeni ekleme durur.

## İşletme belgesi (Faz 1a) — VARSAYILAN KAPALI
- Tasarım `docs/TASARIM-2026-11-06-isletme-belgesi-dogrulama-ve-yetki.md`; migration 95 (yalnız yeni tablolar).
- Açmak için İKİSİ birden: `BUSINESS_LICENSES_ENABLED=1` (yalnız "1"; "true" kapalı sayılır, açılışta uyarı) + `LICENSE_HMAC_SECRET` (en az 32
  karakter rastgele; vergi numarası özetinin anahtarı). Sır yoksa ya da kısaysa özellik KAPALI kalır (açılışta uyarı). 🚨 `LICENSE_HMAC_SECRET`
  ASLA döndürülmez: değişirse bütün hak sahibi özetleri eşleşmez olur ("bir şirket tek hesapta" kuralı sessizce kırılır). Kasada ayrı saklanır.
- Kapsam: Pro + Business (faturalandırma zorunlu değilken ve kurucunun işletmesinde açık; denemede kapalı). Ev sahibi tarafı yalnız işletme
  sahibi + iki aşamalı doğrulamalı oturum. Operatör kuyruğu `/api/admin/licenses` (süper-admin + 2FA; bürünmede kapalı).
- Belge görüntüsü Lixus'a GELMEZ / saklanmaz; operatör resmî kaydı okur (yeniden üretilebilir sorgu kaydı), hak sahipliği kanıtını dışarıda
  inceler, kararı yazar. "Eşleşti" işareti son başarılı okumadan 30 gün sonra kendiliğinden kalkar → doğrulanmış her belge ayda bir yeniden
  okunur (kuyrukta "yeniden okunacak" listesi).

## Üyelik (M-2) — yayın sırası ve 503 `users_without_membership`
- Dilim 1 (migration 93: tablo + doldurma, okuyucu yok) TEK BAŞINA yayınlanır; yeni hesaplar o andan itibaren üyelikle açılır.
- Dilim 2 (migration 94 + oturumun üyelikten doğrulanması) SONRAKİ yayında: 94, dilim 1 yayını sırasında eski kodun açtığı (üyeliksiz) hesapları
  yakalar. İkisi aynı yayında giderse yayın anında açılan hesap giriş yapamaz ("Hesabınız şu an hiçbir işletmeye bağlı değil.").
  İstisna: Railway'in İLK açılışı (↑0. adım — web servisi kapalıyken önce veritabanı; eski kopya istek almıyor) iki dilimi birlikte
  taşıyabilir, boşluk oluşmaz. "İki ayrı yayın" kuralı canlı servisin sonraki yayınları ve geri dönüş içindir.
- İzleyici `/api/health?strict=1` → 503 `reason: "users_without_membership"`: üyelik satırı HİÇ olmayan kullanıcı var. Onarım YALNIZ
  YEREL KLONDAN, uygulama kökünde (üretim kabında betik / `src` / `tsx` yok — Railway Console'da koşmaz) ve hedef AÇIKÇA verilerek
  (`DATABASE_URL` verilmezse betik durur; yoksa yerel `.env` okunurdu). Railway → Postgres → Variables → `DATABASE_PUBLIC_URL`:
  1. Salt-okuma: `DATABASE_URL='<DATABASE_PUBLIC_URL>' npx tsx scripts/membership-backfill.ts` → ilk satır `HEDEF: <sunucu>:<kapı>/<db> (UZAK)`
     olmalı; sayı + hesapların açılış anı aralığı (kimlik / e-posta basılmaz).
  2. Taze `pg_dump`, sonra yazma: aynı komutun başına `MEMBERSHIP_BACKFILL_APPLY=1 MEMBERSHIP_BACKFILL_EXPECT=<1. adımın sayısı>` (94'ün
     AYNI ifadesi, dosyadan; sayı o arada değiştiyse yazmaz; çıkarılmış üyeliği dirilmez).
  3. Strict uç sonucu 30 sn önbellekte tutar → en geç 30 sn sonra gövdede `"membership":"ok"` görünür.
- Olumlu kontrol (her dilim 2 yayınından sonra): strict gövdesinde `"membership":"ok"`.
  🚨 İleride ekipten çıkarma / "askıda hesap" (Ü-1) gelince bu sayaç ve betik o tasarımla birlikte yeniden tanımlanır.
