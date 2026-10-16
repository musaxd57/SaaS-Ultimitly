# Railway açılış listesi (10-15) — eklenecek / kontrol edilecek ortam değişkenleri

Kurucu 10-15: "Railway'i açınca ekleyeceğimiz bayrakları unutma." Bu dosya TEK liste; kaynak: koddaki her açma/kapama değişkeninin taraması
(65 bayrak, Haiku envanteri 10-15) + `CLAUDE.md` "Canlı durum" + kurucu kararları. Değer yazılmaz (sır yok); yalnız ad ve önerilen durum.

## 0. Açmadan önce (sıra önemli)

1. **Taze yedek:** son itilen dal migration 59–68 içeriyor (tek güncel liste: `docs/MIGRATION-MANIFEST.md`) (açılışta `prisma migrate deploy` hepsini uygular). Açmadan önce 09-19
   yedeği ESKİ — Railway açılınca ilk iş `pg_dump` (servis açılır açılmaz, trafik başlamadan) ve geri yükleme provası
   (`docs/OPS-2026-09-19-DURAKLATMA-VE-LOCAL-GELISTIRME.md`).
2. **`ENCRYPTION_KEY` aynı kalır** (rotasyon ASLA). Kasadaki değerle Railway'deki aynı mı — yalnız parmak izi ile karşılaştırın.
3. **Hospitable OAuth:** süresi dolmuş olabilir → Ayarlar → Bağlantılar'da yeniden bağlanın; `scripts/diagnose-hospitable-tokens.ts` salt-okuma.
4. **Paddle:** kapalıyken gelen webhook'lar kaçtı → abonelik durumunu Paddle panosuyla karşılaştırın (reconcile).
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

1. `QR_PIN_ENABLED` (kurucu 10-11: AÇILACAK).
2. `AI_DATE_RESOLUTION_ENABLED` + `AI_CONVERSATION_STATE_ENABLED` (güvenlik ölçüleri 0, gereksiz soru 0).
3. `AI_VERIFIED_AVAILABILITY_ENABLED` → `AI_VERIFIED_EXTENSION_ENABLED` → `AI_VERIFIED_QR_ENABLED`.
4. `AI_UNDERSTANDING_EN_QUERY_ENABLED` (İngilizce köprü sorgusu; 110 → 115 / 120).
5. `AI_EMERGENCY_NUMBER_ENABLED` (QR acil numara; 62/62).
6. `ATTENTION_GAP_ENABLED` (kurucu onayladı 10-11) · `AI_ACTION_SUGGESTIONS_ENABLED` (kurucu 10-12 "A + B + C").
7. `AI_GENERATION_TRACE_ENABLED` + `CHANNEL_METADATA_WRITE` (migration 60 yazıcıları).
8. Onay / belge bekleyenler: `TRIAL_IDENTITY_ENABLED` (önce aydınlatma metni) · `GUEST_ERASURE_ENABLED` (avukat) ·
   `RETENTION_MESSAGE_AGE_ANCHOR` (onay paketi) · `DURABLE_OUTBOX_ENABLED` (O1, kurucu 10-16: önce
   `DURABLE_OUTBOX_ORG_IDS=<kurucu org kimliği>` ile yalnız kurucu org; ilk gönderimler birlikte; geri dönüş = env'i sil, bekleyen satır yine
   bir kez gider — `DEPLOYMENT.md` §6) · `ICAL_DISAPPEARANCE_RECONCILE_ENABLED` ·
   `UNVERIFIED_SWEEP_ENABLED` (önce `UNVERIFIED_SWEEP_DRY_RUN=1`) · `ALERT_EMAIL_VERIFY_ENABLED` · `HOST_DECISIONS_ENABLED` (+ `HOST_DECISION_AI_TEXT_ENABLED`) ·
   `AI_ACTION_CLAIMS_ENABLED` · `KB_HISTORY_SUGGESTIONS_ENABLED` (Geçmişten öğren gelince gereksiz olabilir).
9. Kurucu inceleme notu (10-15 / 10-16; KURUCU-SORULARI §H): `AI_FAULT_GUARD_ENABLED` (arıza her yolda arıza: ev sahibine bırak + tek e-posta)
   · `AI_FIX_SUPPORT_GATE_ENABLED` (bilgi tabanında tarifi olmayan arıza adımı misafire gitmez; kanal + QR). İkisi de misafire gideni değiştirir
   → ilk denemeler birlikte; ölçümler §H2 / §H8.

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

`KB_RETRIEVAL_WIDE_BUDGET` (kurucu: "şimdilik kapalı") · `KB_RERANK_PER_QUESTION` · `APP_TRUST_BROWSER_TIMEZONE` · `BILLING_ALLOW_CANCELED_PLAN_CHANGE`
(geri alma kaçışı) · `ALLOW_LEGACY_LOCAL_UPLOADS` · `TRUST_X_REAL_IP` · `QR_INFORMATIONAL_BAND_ENABLED` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED` ·
`AI_STAY_DEFERRAL_PLAIN_ENABLED` · `AI_COURTESY_RULE_ENABLED` · `QR_ESCALATION_EMAIL_ENABLED` · `CHANNEL_LISTING_READ` / `CHANNEL_CONNECTION_READ`
(okuma geçişi, ayrı tur) · `DEMO_TENANT_*` (yalnız CLI).
⚠️ Bunların birkaçı ölçülmüş ve kurucuya sorulacak (ör. nezaket kuralı, QR acil e-postası) — karar listesinde ayrıca.

## 5. Yeni anahtarlar (bu turda eklenenler)

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
  açar; ikinci kopya / işçi servisi eklenince Railway Postgres'in 100 bağlantı sınırına yaklaşılır. Tek kopyada da zararsız.
- İkinci kopya AÇMAYIN: misafir mesajı işleme kapasitesini büyütmez (senkron tek kilit altında). Önce raporun §6 sırası (migration ön adımı,
  kapanış işleyicisi, işçi servisi) — kurucu kararıyla.
