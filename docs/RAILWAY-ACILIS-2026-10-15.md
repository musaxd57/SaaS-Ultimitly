# Railway açılış listesi (10-15) — eklenecek / kontrol edilecek ortam değişkenleri

Kurucu 10-15: "Railway'i açınca ekleyeceğimiz bayrakları unutma." Bu dosya TEK liste; kaynak: koddaki her açma/kapama değişkeninin taraması
(65 bayrak, Haiku envanteri 10-15) + `CLAUDE.md` "Canlı durum" + kurucu kararları. Değer yazılmaz (sır yok); yalnız ad ve önerilen durum.

## 0. Açmadan önce (sıra önemli)

0. **Önce yalnız veritabanı (gece-4 S10-08):** web servisi açılınca İLK iş `prisma migrate deploy` → yedek bundan SONRA alınırsa migration
   ÖNCESİ yedek olmaz. Sıra: Railway'de yalnız Postgres'i açın (web servisinin otomatik deploy'unu kapatın ya da kopya sayısını 0 tutun; dala
   push yapmayın) → aşağıdaki 1. adım (yedek + geri yükleme provası) → sonra web servisini açın. Kontrol: açmadan önce
   `SELECT count(*) FROM _prisma_migrations` = **59** (00…58), ilk deploy'dan sonra **80** (00…79).
   **Dolu veritabanı provası (gece-4 S10-10, 10-18):** 00…58 uygulanmış boş PG'ye 37 tablonun hepsine 40'ar yapay satır
   (`scripts/ops-migration-rehearsal-seed.py`, yabancı anahtarlarla bağlı) → 59…77 hatasız, 1,5 sn (10-18: 78 aynı prova veritabanında ayrıca uygulandı, 1,4 sn, sapma sıfır); `migrate diff` sapma sıfır. Statik tarama
   aynı sonucu verir: 59…78'deki bütün yabancı anahtarlar YENİ tablolarda, yeni kolonların hepsi boş bırakılabilir ya da varsayılanlı, benzersiz
   dizinler yeni tablo / yeni (boş) kolonlarda, veri güncelleyen ifade yok. Canlı veriyle prova değildir (gerçek veri yerelde yok — KVKK); yine de
   1. adımdaki yedek ŞART.
1. **Taze yedek:** son itilen dal migration 59–79 içeriyor (tek güncel liste: `docs/MIGRATION-MANIFEST.md`) (açılışta `prisma migrate deploy` hepsini uygular). Açmadan önce 09-19
   yedeği ESKİ — Railway açılınca ilk iş `pg_dump` (web servisi deploy olmadan, ↑0) ve geri yükleme provası
   (`docs/OPS-2026-09-19-DURAKLATMA-VE-LOCAL-GELISTIRME.md`).
2. **`ENCRYPTION_KEY` aynı kalır** (rotasyon ASLA). Kasadaki değerle Railway'deki aynı mı — yalnız parmak izi ile karşılaştırın.
3. **Hospitable OAuth:** süresi dolmuş olabilir → Ayarlar → Bağlantılar'da yeniden bağlanın; `scripts/diagnose-hospitable-tokens.ts` salt-okuma.
4. **Paddle:** kapalıyken gelen webhook'lar kaçtı → abonelik durumunu Paddle panosuyla karşılaştırın (reconcile).
   🚨 **CANLI API ANAHTARI (10-17):** eski canlı anahtarın süresi 13 Eylül 2026'da DOLDU (Paddle anahtarları varsayılan 90 gün, en çok 1 yıl;
   dolan anahtar yenilenemez) → 13 Eylül'den beri portal / paket değişikliği / durum okuma çağrıları çalışmıyordu (webhook etkilenmez). Kurucu
   10-17'de yeni anahtarı **"Never expires"** ile oluşturdu → Railway'de `PADDLE_API_KEY` yeni anahtarla değiştirilir, eski anahtar iptal edilir.
   ⏰ **UNUTMA (kurucu: "sakın unutmayalım"):** süresiz anahtar Paddle'ın önerdiği şey değil (bitiş uyarısı da gelmez). Yapılacak: anahtarı
   **1 yıl** bitişli, "Rotatable" işaretli yenisiyle değiştir + Paddle bildirimlerinde `api_key.expiring` / `api_key.expired` olaylarını aç
   (kod tarafı: operatör uyarı e-postası). İzinler (en az yetki, koddaki çağrılardan): Subscriptions Read + Write · Customer portal sessions Write
   · Prices Read · Products Read · Customers Read · Addresses Read. Diğerleri işaretsiz.
5. **Railway "Wait for CI" AÇIK** kalsın (kırmızı CI deploy'u atlar).

## 1. Canlı durumda AÇIK olması gerekenler (eksikse ekleyin; "1")

`AUTO_REPLY_ENABLED` · `GUEST_CHAT_ENABLED` · `REGISTRATION_OPEN` · `LANDING_DEMO_ENABLED` · `TRIAL_EMAILS_ENABLED` · `BILLING_ENFORCED` ·
`PADDLE_PLAN_CHANGE_ENABLED` · `SHADOW_AI_ENABLED` · `AI_UNDERSTANDING_ENABLED` · `AI_STAY_GUARD_ENABLED` · `AI_CONVERSATION_ITEMS_ENABLED` ·
`HOUSE_RULES_CARD_ENABLED` · `AI_HOUSE_RULES_SHADOW` · `KB_SEMANTIC_RETRIEVAL` · `KB_RERANK_ENABLED` · `EMAIL_OUTBOX_ENABLED` ·
`CALENDAR_URL_CONTRACT_ENABLED` · `STORAGE_ENABLED` · `AI_CODE_GREETING_ENABLED` · `AI_HOST_DECISION_HOLD_ENABLED` ·
`AI_ACCESS_CODE_COMPLETE_ENABLED` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED` · `AI_KB_FEE_RULE_ENABLED`
(son beşi 10-02 kurucu beyanı, Railway'de teyit edilmedi — açılışta gözle bakın). Ayrıca `DATA_RETENTION_MONTHS=24`, `TRUSTED_PROXY_HOPS=2`,
`SENTRY_DSN`, `ERROR_ALERT_EMAIL`. `TRUST_CF_HEADER` EKLEMEYİN.

## 2. Model ayarları (kurucu kararı 10-10; kod varsayılanı 5.1, değişiklik yalnız env)

| Değişken | Değer |
|---|---|
| `OPENAI_MODEL` / `OPENAI_REASONING_EFFORT` | `gpt-6-luna` / `low` |
| `AI_STAY_GUARD_MODEL` / `AI_STAY_GUARD_REASONING_EFFORT` | `gpt-6-luna` / `low` |
| `OPENAI_TRANSLATE_MODEL` / `OPENAI_TRANSLATE_REASONING_EFFORT` | `gpt-6-luna` / `medium` |
| `OPENAI_STYLE_MODEL` / `OPENAI_STYLE_REASONING_EFFORT` | `gpt-6-luna` / `none` |
| `AI_DECISION_TEXT_MODEL` | `gpt-5.1` |
| `AI_SEMANTIC_MODEL` (anlama + sıralayıcı ortak) | `gpt-5.1` — `AI_UNDERSTANDING_MODEL` ve `KB_RERANK_MODEL` BOŞ |
| `AI_HISTORY_LEARN_MODEL` / `…_REASONING_EFFORT` (Geçmişten öğren, yeni) | boş bırakılabilir (kod varsayılanı `gpt-6-luna` / `low`) |

## 3. Açılmayı bekleyen anahtarlar (kurucu + ilk denemeler birlikte; önerilen sıra)

1. `QR_PIN_ENABLED` (kurucu 10-11: AÇILACAK). 🚨 **ÖNCE `QR_PIN_PEPPER` ekleyin** (rastgele, en az 32 karakter, `AUTH_SECRET` ile AYNI
   OLMAZ) — yoksa açılış denetimi (`scripts/verify-env.mjs`) üretimde süreci başlatmaz, servis çöker (gece-4 S10-04).
2. `AI_DATE_RESOLUTION_ENABLED` + `AI_CONVERSATION_STATE_ENABLED` (güvenlik ölçüleri 0, gereksiz soru 0).
3. `AI_VERIFIED_AVAILABILITY_ENABLED` → `AI_VERIFIED_EXTENSION_ENABLED` → `AI_VERIFIED_QR_ENABLED`.
4. `AI_UNDERSTANDING_EN_QUERY_ENABLED` (İngilizce köprü sorgusu; 110 → 115 / 120).
5. `AI_EMERGENCY_NUMBER_ENABLED` (QR acil numara; 62/62).
6. `ATTENTION_GAP_ENABLED` (kurucu onayladı 10-11) · `AI_ACTION_SUGGESTIONS_ENABLED` (kurucu 10-12 "A + B + C").
7. `AI_GENERATION_TRACE_ENABLED` + `CHANNEL_METADATA_WRITE` (migration 60 yazıcıları).
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
   ⚠️ `DURABLE_OUTBOX_ENABLED` denemesi sürerken KAPALI kalsın — karar kartı kuyruğa girer girmez "onaylandı" kapanıyor, teslim düşerse
   kart yeniden açılmıyor: `docs/TASARIM-2026-10-16-transactional-outbox.md` RİSK) ·
   `AI_ACTION_CLAIMS_ENABLED` · `KB_HISTORY_SUGGESTIONS_ENABLED` (Geçmişten öğren gelince gereksiz olabilir).
9. Kurucu inceleme notu (10-15 / 10-16; KURUCU-SORULARI §H): `AI_FAULT_GUARD_ENABLED` (arıza her yolda arıza: ev sahibine bırak + tek e-posta)
   · `AI_FIX_SUPPORT_GATE_ENABLED` (bilgi tabanında tarifi olmayan arıza adımı misafire gitmez; kanal + QR)
   · `AI_TOPIC_ABSENCE_ENABLED` (H9, kurucu 10-16: kanal öğe kipinde "bilgim yok" cümlesi ayıklanır, bağımsız soru cevaplanır, o konu ev
     sahibinde açık kalır; QR'da yok — `docs/TASARIM-2026-10-16-faz3-konu-bazli-cevap.md` §6). Üçü de misafire gideni değiştirir
   → ilk denemeler birlikte; ölçümler §H2 / §H8.
10. `CHANNEL_AUTOMATION_NOT_REPLY_ENABLED` (kurucu Q2 10-17: "Hospitable'ın otomatik mesajı cevap verilmiş sayılmasın" — KARAR VERİLDİ, kod
   hazır, anahtar kapalı; açılmazsa karar uygulanmaz. Migration 71 ile birlikte; ilk denemeler birlikte — misafire giden cevabın tetiklenmesini
   etkiler).
11. Kayıt / ödeme (kurucu 10-17): `SIGNUP_NETWORK_TRACE_ENABLED` (K1 "B + IP": kayıt ağı izi, HMAC özet, ham IP yok, 90 gün; migration 72;
   önce aydınlatma metni cümlesi Q3) · `TRIAL_CARD_GATE_ENABLED` (yüksek riskli denemede kart; migration 74) — 🚨 açmadan önce Paddle'da
   deneme süreli üç fiyat oluşturulup `PADDLE_PRICE_BASLANGIC_DENEME` / `PADDLE_PRICE_PRO_DENEME` / `PADDLE_PRICE_ISLETME_DENEME`
   eklenir (boşsa kapı kendiliğinden kapalı kalır).

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

`PADDLE_RESUME_ENABLED` (kurucu SG3 10-17: üründe "duraklatma" yok; iptal edilen yenilemede dönem sonu kutusu yeter) ·
`KB_RETRIEVAL_WIDE_BUDGET` (kurucu: "şimdilik kapalı") · `KB_RERANK_PER_QUESTION` · `APP_TRUST_BROWSER_TIMEZONE` · `BILLING_ALLOW_CANCELED_PLAN_CHANGE`
(geri alma kaçışı) · `ALLOW_LEGACY_LOCAL_UPLOADS` · `TRUST_X_REAL_IP` · `QR_INFORMATIONAL_BAND_ENABLED` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED` ·
`AI_STAY_DEFERRAL_PLAIN_ENABLED` · `AI_COURTESY_RULE_ENABLED` · `QR_ESCALATION_EMAIL_ENABLED` · `CHANNEL_LISTING_READ` / `CHANNEL_CONNECTION_READ`
(okuma geçişi, ayrı tur) · `DEMO_TENANT_*` (yalnız CLI).
⚠️ Bunların birkaçı ölçülmüş ve kurucuya sorulacak (ör. nezaket kuralı, QR acil e-postası) — karar listesinde ayrıca.

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

## 6. Bağlantı havuzu ve kapanış (yatay ölçek denetimi 10-15, `docs/arastirma-2026-10-15/yatay-olcek.md`)

- `DATABASE_URL` sonuna `?connection_limit=10` (zaten parametre varsa `&connection_limit=10`) ekleyin. Bugün tavan yok: Prisma çekirdek×2+1
  açar; ikinci kopya / işçi servisi eklenince Railway Postgres'in bağlantı sınırına (belgelere göre 100; açılışta `SHOW max_connections` ile
  ölçün) yaklaşılır. Tek kopyada da zararsız.
- İkinci kopya AÇMAYIN: misafir mesajı işleme kapasitesini büyütmez (senkron tek kilit altında). Önce raporun §6 sırası (migration ön adımı,
  kapanış işleyicisi, işçi servisi) — kurucu kararıyla.

## 7. Sayısal ayarlar — boş bırakın (kod varsayılanı), yalnız acil müdahalede (gece-4 S10-04)

- `AI_DAILY_CALL_CAP` — işletme başına günlük yapay zekâ çağrı tavanını PLANDAN BAĞIMSIZ herkese uygular (boşken tavan plandan gelir;
  `src/lib/ai/daily-budget.ts`). Yalnız maliyet kaçağında geçici fren; yazılırsa her pakete aynı sayı uygulanır — sonra silin.
- `AI_DAILY_QR_SHARE_PERCENT` — günlük tavanın QR misafir sohbetine ayrılan payı (boşken %30; 1–100). Geçersiz değer sessizce varsayılana döner.
