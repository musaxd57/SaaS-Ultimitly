# Durable Email Outbox — kimlik e-postaları (Tur-4, Codex-onaylı tasarım)

> Kapsam: `verify_email` (kayıt + yeniden gönder) · `pw_reset_code` (şifremi unuttum)
> · `pw_change_code` (oturum-içi şifre değiştirme). Bilinçli KAPSAM DIŞI:
> alert/escalation mailleri (acil; kendi dedupe/bound'ları var), trial-reminders
> (kendi claim+rollback deseni), report-error (bağımlılık döngüsü), leads/görev/test.

## Neden

1. **Zamanlama sızıntısı (Codex #7):** forgot-password'da bilinen kullanıcı yolu
   senkron Resend ağ çağrısı içeriyordu — bilinmeyen kullanıcıdan ölçülebilir
   şekilde yavaş. Sleep ile gizlemek yanlış; yapısal çözüm ağ bacağını istek
   yolundan çıkarmak.
2. **Güvenilirlik:** provider kesintisi bugün kayıtta 503, reset'te "kodu geri sil"
   demek. Outbox ile kesinti = gecikmiş teslim.

## Mimari (MessageOutbox m29-31 desenlerinin e-posta uyarlaması)

- **Tablo `EmailOutbox` (m44, additive):** `id` (önceden üretilen UUID — AAD'ye girer)
  · `userId` FK onDelete:Cascade · `kind` (kapalı set) · `version Int`
  · `payloadEnc String?` (AES-256-GCM v2, **AAD = `emailoutbox:v1:{id}:{userId}:{kind}`**;
  içerik `{secret, recipient}` — düz metin token/kod/adres kolonu YOK)
  · `status`: `pending | claimed | sending | sent | failed | canceled`
  · `attemptCount` · `nextAttemptAt` · `claimedBy`/`claimExpiresAt` · `expiresAt`
  (sırrın KENDİ TTL'i) · `sentAt` · `lastError` (scrub'lı) · damgalar
  · `@@unique([userId, kind, version])` · `@@index([status, nextAttemptAt])`.
- **Atomik enqueue:** sır üretimi + bcrypt TX DIŞINDA; TEK TX içinde NS-42 advisory
  xact-lock (`hashtext(userId:kind)`) altında → eski `pending|claimed` kardeşler
  `canceled`+payload NULL → User hash yazımı (çağıranın) → `version = max+1` satır.
  TX düşerse ne hash ne satır (dangling-kod temizliği yapısal olarak gereksiz).
- **Idempotency/koordinasyon anahtarı SIRDAN TÜREMEZ** (8 haneli kod offline
  brute-force'lanır): `version` sayacı + rastgele satır id'si.

## Güncellik kapısı (eski satır DİRİLEMEZ — Codex kapanış 1)

"Satırın sırrı hâlâ User'ın güncel canlı sırrı mı?" — sır karşılaştırmasız iki koşul
(denklik: hash ile satır hep aynı TX'te yazılır; hash'i ezen her yol daha yüksek
versiyonlu satır üretir; hash'i NULL'layan tüketme/expiry yolları liveness'a takılır):

1. **Versiyon güncelliği:** aynı (userId, kind) altında `version > satırınki` kardeş YOK.
2. **Liveness:** kind'a karşılık gelen User hash kolonu dolu VE süresi geçmemiş.

Kapı NS-42 kilidi altında kısa TX'te ÜÇ geçişte koşar:
- `claimed → sending` (gönderim-öncesi CAS; ek olarak payload'daki `recipient`
  snapshot'ı User'ın güncel adresiyle eşleşmeli — değişmişse `canceled`);
- `sending → pending` retry settle'ı (provider hatası sonrası) — bayatsa
  `canceled`+NULL, backoff'a ASLA girmez;
- claim-expiry recovery (çökmüş worker satırları) — güncelse `pending`, bayatsa `canceled`.

Kabul edilen tek kalıntı: CAS `sending`'e geçtikten sonra başlayan tek provider
çağrısı durdurulamaz → en fazla BİR bayat e-posta; kod zaten doğrulanmaz, e-posta
metni "en son gönderilen kod geçerlidir" der.

## Teslim otoritesi (Codex kapanış 3)

- **Dayanıklılık DB satırından gelir, timer'dan değil.** 15 sn'lik döngü ayrı bir
  Railway worker servisi DEĞİL; instrumentation.ts'te yaşayan uygulama-içi
  poller'dır (mevcut 2-dk cron gibi localhost fetch → `/api/cron/email-outbox`,
  CRON_SECRET'lı; globalThis tekil-başlatma guard'ı; SKIP LOCKED claim çoklu
  replikayı güvenli kılar).
- **İnline kick** (`kickEmailOutboxDrain`) yalnız gecikme optimizasyonu: await
  edilmez (bilinen-kullanıcı yoluna ölçülebilir süre eklemez), TÜM rejection'ları
  yutar (unhandled rejection üretemez), ölürse zarar yok.
- **2-dk cron** (runScheduledSync): kurtarma ağı — claim-expiry recovery + expiry
  cancel + temizlik + drain.
- `INTERNAL_CRON_DISABLED=1` kurulumlarında poller de kapalıdır; teslim gecikmesi
  dış cron aralığına çıkar (dış cron `/api/cron/sync` drain'i de çağırır).

## Sır yaşam süresi (Codex kapanış 4) & retry

- `payloadEnc` yalnız `pending|claimed|sending`'de yaşar; `sent`, `canceled`,
  expiry ve TERMINAL `failed` geçişlerinin settle yazımında NULL.
- Backoff 1m→5m→15m→60m, max 5 deneme; `expiresAt` (kod 10 dk / verify 24 sa)
  tavan — süresi geçmiş sır ASLA gönderilmez (`canceled`).
- Temizlik: `sent` 7 gün, `canceled|failed` 30 gün sonra silinir (sweep).

## Sözleşmeler

- Enumeration-safe generic 200'ler AYNEN; bilinen-kullanıcı yolunda ağ çağrısı yok,
  bilinmeyen yolda dummy bcrypt + hiç-eşleşmeyen no-op yazım (iş-profili simetrisi).
  Mutlak sabit-zaman İDDİA EDİLMEZ; elle dağılım ölçümü raporlanır, CI assert yok.
- **Register 201 ⟺ hesap + verify-hash + outbox satırı TEK TX'te commit oldu**
  (Codex kapanış 2). Kısmi durum şema gereği imkânsız; "mail kuyrukta" yalanı olamaz.
  Flag OFF'ta bugünkü senkron gönderim + 503 dalı birebir korunur.
- `EMAIL_OUTBOX_ENABLED` default KAPALI. Railway'e açılış: tüm fazlar deploy +
  Railway Active + İLK gerçek reset ve doğrulama e-postası birlikte test edilirken.
