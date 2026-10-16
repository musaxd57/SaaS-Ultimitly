# CLAUDE.md — Lixus AI proje hafızası

> Her oturum başında okunur (HER alt ajana da yüklenir — kısa tut). Yalnız KURALLAR ve GÜNCEL DURUM.
> Gerekçeler/ölçümler/tarihçe: `docs/history/CLAUDE-2026-10-02-sadelestirme-3-oncesi-tam-metin.md` (221 KB, aynen — 09-23 → 10-01
> tur anlatıları) · `docs/history/CLAUDE-2026-09-23-sadelestirme-2-oncesi-tam-metin.md` (219 KB, aynen) ·
> `docs/history/CLAUDE-2026-09-07-sadelestirme-oncesi-tam-metin.md` (239 KB'lık eski hâl, aynen)
> + `docs/history/CLAUDE-2026-07.md` / `CLAUDE-2026-08.md` + `git log`.
> Kanıt sözleşmesi: `docs/TEST-EVIDENCE-CONTRACT.md` (BAĞLAYICI). Plan: `ROADMAP.md`.
> **Yol planı (kurucu talimatı 2026-09-07, AYNEN): `docs/KURUCU-TALIMATI-2026-09-07-urun-vizyonu-ve-degismezler.md`**
> — ↓"Yol planı" bölümü onun özetidir, çelişkide o metin kazanır.
> Denetim turu: `docs/audit-2026-09-05/` (`SECURITY-ARCHITECTURE-REVIEW.md` · `CLAUDE-HANDOFF.md` · `DURUM.md`).
> V0: `docs/V0-CHANNEL-INDEPENDENCE-INVENTORY.md`.
> 🗂️ **Konu dosyaları (10-08, kurucu: ".md'ye yığma, taşı, silme"):** büyük bölümler AYNEN `docs/claude/`e taşındı; burada yalnız
> madde başlıkları + yol. O alanda iş yapmadan ÖNCE ilgili dosya okunur, kural orada da BAĞLAYICIDIR: `yol-plani.md` · `retrieval.md` ·
> `ai-guvenlik.md` · `kalici-kararlar.md` · `acik-isler.md` · `kalici-urun-kararlari.md` · `durum.md`. YENİ ayrıntı / tur anlatısı buraya
> DEĞİL ilgili konu dosyasına yazılır; buraya yalnız tek satırlık başlık + yol girer.

## Ürün
**Lixus AI** (lixusai.com) — Türkiye odaklı, çok kiracılı SaaS; kısa dönem kiralama hostlarının
Airbnb/Booking misafir mesajlarını AI ile yanıtlar. Operatör: kurucunun kendi işletmesi (~10 daire). Türkçe
öncelikli. Temel ilke: AI karar-verici değil yardımcı operatör — riskli mesaj hep insana kalır.
Hedef: Hospitable geçici köprü, uzun vadede bağımsız AI-native PMS (V0 belgesi).

## 🧭 Yol planı (kurucu talimatı 2026-09-07 — özet; tam metin `docs/KURUCU-TALIMATI-…md`)
> 📄 **Tam metin (bağlayıcı): `docs/claude/yol-plani.md`** — bu alanda kod / karar değiştirmeden önce oku. Aşağıda yalnız madde başlıkları.
> 📋 **Madde madde durum + çalışma sırası (10-09): `docs/YOL-PLANI-DURUM-2026-10-09.md`** (kurucu: "sıralama nasılsa öyle ilerle").
**FINAL PRODUCT CONSTRAINT:** Lixus başka PMS'lerin üzerinde AI wrapper DEĞİL; Airbnb Direct + Booking.com
**10 mimari ilke:** çekirdek Hospitable semantiği istemez · sağlayıcı değişince çekirdek yeniden yazılmaz ·
**20 teknik değişmez (test-pinli olacak):** (1) çekirdek/intelligence hiçbir sağlayıcı modülünü import
**Yürütme sırası (bu sıra prompttaki diğer sıraları ezer):** ① Codex denetimi kritik bulguları kodda
**Ürün fazları (V0 sonrası, bağımlılık sırasıyla):** V1 Property Memory + Signals → V2 Exception Feed
**Airbnb başvurusu öncesi 6 kapı** (09-24: boş `AirbnbDirectAdapter` sözleşmesi ✅ `docs/AIRBNB-DIRECT-SOZLESMESI.md` ·
**Gelecek AI gereksinimleri (V0 bitmeden UYGULANMAZ; ayrıntı tam metinde):** prompts.ts'e yalnız kod

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
> 📄 **Tam metin (bağlayıcı): `docs/claude/retrieval.md`** — bu alanda kod / karar değiştirmeden önce oku. Aşağıda yalnız madde başlıkları.
- 🚨 `KB_RETRIEVAL_MODE` bir ACİL DURDURMA düğmesidir: `legacy/off/0/false/no/disabled` eski davranış, başka HER
- TEK BOĞAZ `selectKbForPrompt`
- `src/lib/ai/retrieval/` LLM'siz + deterministik + DB'siz (pin): parçalayıcı (cümle sınırı, 600/900; parça =
- Yabancı dil sözlüğü
- 🚨 ANLAMSAL (embedding) KAYNAK: ÜRETİM YOLU VAR, ANAHTAR `KB_SEMANTIC_RETRIEVAL` VARSAYILAN KAPALI (09-23) — CANLIDA AÇIK (kurucu 09-26).
- Ölçek harness'ı
- Kök sökücü kuralları (ölçülmüş; tekrar denemeyin):
- Belirsiz tek kelime yalnız GENİŞLETME (`expandOnly`, kurucu onayı 09-26):
- Sözlük kayıtları TİPLİ (kurucu onayı 09-26, "B + C + tipli eşleştirici"):
- 🚨 **OPENAI YENİDEN SIRALAYICI (#186, 09-26; kurucu "OpenAI ile", "Önce ücretli ölçüm, sonra siz", "yapalım, en mantıklı
- 🚨 **#189 300 KALEM ÖLÇEĞİ (09-26 gece, `docs/TASARIM-2026-09-26-rag-300-olcek.md`; ölçer `tests/eval/rag-lab/` aşama bazlı
- Alt sorgu yuvaları (#208, 09-27):
- **A5 getirme düzeltmeleri (#208, 09-27; çevrimdışı ölçüm: sözcükselde getirme +0/−0, sahte "insana devret" notu çok soruda
- Anlama katmanı sorguları
- Önbellek anahtarı küme parmak izi
- Retrieval politika DEĞİLDİR
- Host graf katmanı

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
- **Repo görünürlüğü — 10-12 gece: PUBLIC** (kurucu tekrar public yaptı; GitHub API `private: false` doğrulandı. 09-24'te de PUBLIC
  yapılmıştı, "Actions dakikası 2000'i aştı"). 10-12 akşam private iken kota bitmişti: CI işleri çalıştırıcısız 1–2 sn'de düşüyor, iş
  günlüğü 404, yeniden tetikleme 403 → çözüm kurucuda (public'e dönmek ya da Billing'de harcama limiti). Önceki not: PUBLIC iken standart çalıştırıcılar ücretsiz. Private'a dönülürse
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
  `scripts/verify-env.mjs` tek env-doğrulama kaynağı. `/api/health` readiness; `?strict=1` ops. Yalnız "1" ile açılan bayraklar
  (`STRICT_ONE_FLAGS`, kaynakla pinli) başka yazımla ("true") verilirse açılışta UYARI (A7 #1; davranış aynı — KB_* "true"yu kabul eder).
- Multi-tenancy `Organization`; superadmin (`SUPERADMIN_EMAILS`) impersonation ile girer (JWT
  `actorUserId`). Tüm rotalar org-scoped (`api-route-scoping.test.ts` pinler).
- Auth: JWT + `sessionEpoch`; `withAuth/withManage/withOwner` (route-guard.ts); 2FA TOTP; `mfa` iddiası.
- Hospitable: per-tenant şifreli token (`getOrgHospitableToken` TEK fonksiyon; PAT veya OAuth refresh).
  `financials:read` YOK → gelir özelliği bilinçli KALDIRILDI. Env-token fallback yalnız `PRIMARY_ORG_ID`.
- Sync: `SystemLock` "scheduled-sync" + 2 dk in-process cron (`instrumentation.ts`) + `/api/cron/sync`
  (`CRON_SECRET`). Manuel sync `withSyncLock`.
- **Giden mesaj: Channel Layer (`src/lib/channels`, V0.1)** — `sendOnChannel` ve outbox worker
  `dispatchOutbound`'a gider; `hospitable.sendMessage`'ın tek çağıranı `channels/hospitable-outbound.ts`.
- Çeviri istemi (`ai/translate.ts`): sağlayıcıdan gelen kaynak dil sistem satırına YALNIZ dil kodu biçiminde girer (09-28).
- Model: OpenAI `gpt-5.1` (`OPENAI_MODEL`; `DEFAULT_OPENAI_MODEL` kod içi son çare). Değiştirme =
  gönderim hot-path'i rekalibrasyon; yalnız gerçek arıza + A/B. `ai/openai-compat.ts` TEK KAYNAK DEĞİL
  (`ai/index.ts` ve `translate.ts` OpenAI'yi doğrudan çağırır; `openai-request-contract.test.ts` pinler).
  Katman bazında model / çaba (10-01, kurucu "her katmanı ayrı doğrulayalım"): `AI_UNDERSTANDING_MODEL` · `AI_STAY_GUARD_MODEL` ·
  `KB_RERANK_MODEL` (+ `*_REASONING_EFFORT`) boşken `AI_SEMANTIC_*` ortak ayarı; `OPENAI_TRANSLATE_REASONING_EFFORT` /
  `OPENAI_STYLE_REASONING_EFFORT` yalnız reasoning modelinde gönderilir. Ölçüm raporu katman bazında model + gönderilen çaba + istem
  kimliği (SHA-256 ilk 12) taşır (`tests/eval/run-meta.ts`).

## AI güvenlik mimarisi (ürünün kalbi)
> 📄 **Tam metin (bağlayıcı): `docs/claude/ai-guvenlik.md`** — bu alanda kod / karar değiştirmeden önce oku. Aşağıda yalnız madde başlıkları.
- Tek kaynak:
- 🚨 UZUN MİSAFİR MESAJI (K10-t, kurucu kararı 09-28, tek kaynak `ai/message-length.ts`):
- 🚨 MİSAFİRDEN TÜREYEN METİN VERİ (K10-s, kurucu onayı 09-28):
- 3 seviye:
- Kod kapısı `passesAutoReplySafetyGate`
- Model çıktısı STRICT (F01):
- GOLDEN SET
- Görünmez karakter = `\p{Default_Ignorable_Code_Point}` + `\p{Cf}` + U+2800
- QR bağlamı:
- QR misafir rotası:
- 🚨 DOĞRULANMIŞ MÜSAİTLİK + UZATMA (10-09, anahtarlar KAPALI; `ai/verified-availability.ts`, `ai/verified-extension.ts`): yalnız KOD metni + bütün şartlar — tam metin `docs/claude/ai-guvenlik.md` sonu.
- TARİH OKUMASI (10-10, anahtar KAPALI; `ai/date-reading.ts`): tarihler kodla, her mesaj kendi yazıldığı ana göre; gece yarısı "yarın"ı belirsiz — tam metin `docs/claude/ai-guvenlik.md` sonu.
- 🚨 "BİLGİM YOK" MİSAFİRE ASLA GİTMEZ (kurucu kuralı 09-11, `ai/absence.ts`):
- Çıktı vetosu / makbuzsuz iddia:
- Konuşma kuralları:
- 🚨 **KONUŞMA KAYITLARI (CUS v1 dilim B, 09-25, `ai/conversation-state.ts`; bayrak `AI_CONVERSATION_STATE_ENABLED`
- 🚨 **EYLEM BEYANI (`claimedActions`, 09-25, `ai/action-claims.ts`; bayrak `AI_ACTION_CLAIMS_ENABLED` varsayılan KAPALI;
- 🚨 KB talimat-ele-geçirme süzgeci (`detectKbInstructionHijack`, 09-23):
- 🚨 ANLAM KATMANI (09-24, kurucu: "kelimeye takılma, anlamı modelle çıkar"; `docs/ANLAM-KATMANI-2026-09-24.md`):
- 🚨 **DOĞRULANMIŞ ERKEN GİRİŞ (09-24, kurucu: "hassas istek = ENGEL değil, doğrulama iş akışı"; `lib/early-checkin`,
- Misafirin yazdığı çıkış saati (`guestCheckoutTime`) BEYANDIR (C-9, tek kural `lib/guest-checkout-time.ts`):
- Görev durumu + geçmiş kaydı TEK işlemde (C-17, `api/tasks/[id]`):
- Yaşam döngüsü görevleri rezervasyon tarihini izler (C-16, `lib/tasks/follow-reservation.ts`):
- 🚨 TEMİZLİKÇİ GÖRÜNÜMÜ (09-24, `lib/tasks/staff-view.ts` TEK kural):
- 🚨 KAPI KANITI + SÖZCÜKSEL/ANLAMSAL AYRIM (09-25, `ai/gate-evidence.ts`, belge `docs/MESAJ-ANLAMA-CEKIRDEGI-2026-09-25.md`):
- 🚨 KAPANIŞA SESSİZLİK (kurucu kuralı 09-25, `ai/closing-turn.ts`):
- 🚨 ZAMAN BAĞLAMI TEK KAYNAK `ai/stay-timeline.ts` (09-25):
- 🚨 Ev sahibi metninde ödeme yöntemi/yeri TEK KAYNAK `payment-method-guard.ts` (09-25) — ŞÜPHEDE REDDET:
- KB sır kapısı
- Yer tutucu:
- İstem bütçesi:
- İddia desteği GÖLGE ölçümü (`ai/claim-support.ts`, 09-23):
- Dil:
- 🚨 MİSAFİRİN DİLİNDE CEVAP (09-25, `ai/language-signal.ts`; kurucu: "5.1'in zayıf noktasını düzelt"):
- Üslup: duygu beyanı/temenni/çelişki/dolgu-soru yasak; "siz"; ben-dili. Injection kara listesi yapısal olarak

## Canlı durum (Railway env'leri — özet)
| Env | Durum |
|---|---|
| `AUTO_REPLY_ENABLED=1` · `REGISTRATION_OPEN=1` · `TRIAL_EMAILS_ENABLED=1` · `LANDING_DEMO_ENABLED=1` · `GUEST_CHAT_ENABLED` · `DATA_RETENTION_MONTHS=24` | açık |
| `BILLING_ENFORCED=true` | deneme bitince ücretsiz sürüm (kilit yok), oto-mesaj kapanır; `PRIMARY_ORG_ID` muaf |
| Paddle PRODUCTION | canlı; gerçek ödeme + in-app upgrade/downgrade doğrulandı; `PADDLE_PLAN_CHANGE_ENABLED=1`; yıllık fiyat env'leri set |
| `OPENAI_MODEL=gpt-5.1` · `SHADOW_AI_ENABLED=1` (`SHADOW_AI_MODEL=gpt-5.6-luna`, `SHADOW_AI_ORG_IDS`=kurucu org, anahtar `OPENAI_API_KEY`'e düşer) · supply-ai OpenAI luna | Akash artık HİÇBİR yerde işleyen değil; `SUPPLY_AI_MODEL/BASE_URL` eski Akash değerleriyse SİL. KVKK metinlerindeki Akash satırları avukat paketinden önce güncellenmeli |
| `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=1` (09-25) · `AI_CONVERSATION_ITEMS_ENABLED=1` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` (#186) · `HOUSE_RULES_CARD_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=1` (09-26) | açık (kurucu beyanı; ölçümler ilgili maddelerde) |
| `AI_SEMANTIC_MODEL=gpt-5.1` · `OPENAI_TRANSLATE_MODEL=gpt-5.1` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_KB_FEE_RULE_ENABLED=1` (10-02) | kurucu beyanı ("bütün bayrakları ekledim"; Railway'de teyit edilmedi). Cevap modeli önerisi `OPENAI_MODEL=gpt-6-luna` + `OPENAI_REASONING_EFFORT=medium` + `OPENAI_STYLE_MODEL=gpt-6-luna` + `OPENAI_STYLE_REASONING_EFFORT=none` (`docs/SABAH-RAPORU-2026-10-01.md` §7) |
| Hospitable OAuth canlı; kurucu org aboneliği 402 (veri donmuş, bug değil) | `TRUST_CF_HEADER` EKLEME |
| `TRUSTED_PROXY_HOPS=2` · `SENTRY_DSN` + `ERROR_ALERT_EMAIL` · `EMAIL_OUTBOX_ENABLED=1` · `CALENDAR_URL_CONTRACT_ENABLED=1` (prod'da düz feed URL kalmadı) · `STORAGE_ENABLED=1` (Tigris `lixus-uploads`, virtual-hosted) | kanıtlı canlı |
| `PASSWORD_RESET_CHALLENGE_ENABLED` | artık okunmuyor (Faz 3), silinmesi davranışı değiştirmez |
| BİLİNÇLİ KAPALI | 🔔 **açılmayı bekleyen yapay zekâ anahtarları (kurucu 10-09: "bayrağı unutturma")**: `AI_VERIFIED_AVAILABILITY_ENABLED` (doğrulanmış müsaitlik, kanal) · `AI_VERIFIED_EXTENSION_ENABLED` (doğrulanmış uzatma, kanal; Airbnb rezervasyonu) · `AI_VERIFIED_QR_ENABLED` (ikisinin QR karşılığı) · `AI_DATE_RESOLUTION_ENABLED` (istemde tarih okuması; kör eval sonucu `docs/olcum/`) · `AI_UNDERSTANDING_EN_QUERY_ENABLED` (İngilizce köprü sorgusu, getirme; `docs/olcum/RAG-AYRISTIRMA-2026-10-10.md`) · `AI_EMERGENCY_NUMBER_ENABLED` (QR acil numara sorusu → yalnız numara, servis başına; `docs/claude/ai-guvenlik.md`) · `AI_FAULT_GUARD_ENABLED` (arıza her yolda arıza: kod arızayı ev sahibine bırakır + tek e-posta, 10-15) · `AI_FIX_SUPPORT_GATE_ENABLED` (bilgi tabanında tarifi / konusu olmayan cihaz için adım gitmez, kanal + QR, 10-15; ikisi `docs/arastirma-2026-10-15/KURUCU-SORULARI.md` §H) — açma = kurucu + ilk denemeler birlikte · `ATTENTION_GAP_ENABLED` (panoda yetim boşluk satırı; kurucu onayladı 10-11, tutarsız — açmak = env "1") · `AI_ACTION_SUGGESTIONS_ENABLED` (⑤ ilk dilim: görev / Wi-Fi / söz önerisi + tek tıkla onay; kurucu 10-12 "A + B + C" — açmak = env "1"; `docs/TASARIM-2026-10-11-otonom-ai-ilk-dilim-onerisi.md` §5) · `TRIAL_IDENTITY_ENABLED` (deneme kimliği, migration 61; açmadan önce aydınlatma metni) · `CHANNEL_METADATA_WRITE` / `AI_GENERATION_TRACE_ENABLED` (migration 60 yazıcıları) · `DURABLE_OUTBOX_ENABLED` · `ICAL_DISAPPEARANCE_RECONCILE_ENABLED` · `UNVERIFIED_SWEEP_*` · `RETENTION_MESSAGE_AGE_ANCHOR` (onay paketi: `docs/RETENTION-MESSAGE-AGE-ANCHOR-ONAY-PAKETI.md`) · `GUEST_ERASURE_ENABLED` (avukat imzası) · `QR_PIN_ENABLED` (kurucu 10-11: AÇILACAK — Railway açılınca env "1", ilk denemeler birlikte; QR ilk cihaz kilidini çözer) · `APP_TRUST_BROWSER_TIMEZONE` |

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
- 🚨 **ALT AJAN = HAIKU 5.5 (kurucu 10-08: "haiku 5.5'i subagentin olarak kullan, bol bol yardım etsin"):** tarama / envanter / ölçüm /
  doğrulama işleri `Agent` aracıyla `model: "haiku"` (çoğunlukla `subagent_type: Explore`) çalıştırılır; dar, net, kısa çıktılı görev
  verilir; bulgular kodla doğrulanır; kodu Claude yazar. Yasak dosyalar (sealed / private / holdout) ajana da AÇILMAZ.
- 🚨 **İNCELEME DÖNGÜSÜ (kurucu 10-15):** her dosya yazımı / değişiklik grubundan sonra Haiku 5.5 alt ajanı dar inceleme yapar; dilim bitince
  Opus 5.5 "en derin ve sert" büyük kontrol (bulgularını ilerledikçe dosyaya yazar — kesme olursa kaybolmasın). Derin araştırma / tasarım
  işleri Opus 5.5. Kesme ("Request interrupted") o turun alt ajanlarını durdurur → yeniden başlatılır. Railway açılana kadar kodla
  yapılabilecek her şey yapılır.
- **Kurucu cevap incelemesi (10-08):** ölçüm yan dosyalarından (`docs/olcum/*.json`) çıkan misafir mesajı → yapay zekâ cevabı çiftleri
  `scripts/review/build-review-set.py` ile toplanır, sayfa https://claude.ai/artifact/DFkiB4FkXrNagEtHnGTXXN (veri `review-set.json`,
  yorumlar sayfanın veritabanında `reviews/m<mesaj özeti>` — soru başına kararlı kimlik, eski `q…` / çift kimlikli kayıtlar da okunur: verdict good/fix/bad · better · note). Kurucu yorumları `ArtifactData list
  reviews` ile okunur; "daha iyi cevap" önerileri istem / eval işine girdi olur (karar değil — uygulamadan önce kurucuya sorulur). Yeni ölçüm
  sonrası set yeniden üretilip aynı adrese yayımlanır.
- 🚨 **ÖLÇÜMDE HATA → NEDEN ANALİZİ (kurucu 10-11: "hata olunca hemen nedenini gör, önerdiğin döngü gibi olsun"):** `tests/eval/failure-analysis.ts`
  — ① modelin açıklaması (İPUCU, sonradan gerekçe) ② karşı deneme (ifade çıkar, aynı katman yeniden; KANIT, modelin iddiası da sınanır)
  ③ düzeltme katmanı önerisi (test beklentisi · bilgi · istem · kod kuralı · model sınırı; seçen insan, misafire gideni değiştiren düzeltme
  kurucuya sorulur) ④ doğrulama (aynı vakalar + kör set). Ölçer hata verince kendiliğinden koşar (`<koşu>-neden.md`); katman başına
  bağdaştırıcı (anlama: `failure-analysis-understanding.ts`) — yeni ölçere de bağlanır. Ücretli koşu yine kurucu onayıyla.
- **`docs/TEST-EVIDENCE-CONTRACT.md` bağlayıcı**: K2 için kırmızı-önce · kaldırma mutasyonu · aşırı-uygulama
  kontrolü · integration · tam kapılar; rapor KOD/CI/DEPLOY/PROD ayrı; "test gerekmiyor" gerekçeli.
- **Codex protokolü:** doğruysa uygula, daha iyisini biliyorsan gerekçeyle reddet; son karar karşılıklı.
- **🚨 Tam suit koşarken BAŞKA vitest KOŞMA:** `tests/global-setup.ts` her `vitest run`'da PG 5433'ü `stop -m
  immediate` + `initdb` ile sıfırlar → paralel koşu süren suit'in DB'sini öldürür (ölçüldü: 42–59 sahte kırmızı
  dosya). Mutasyon script'leri de vitest'tir. Süreç öldürürken `pkill -f "vitest run"` YETMEZ (kendi kabuğunla
  eşleşir, `node (vitest)` ana süreciyle eşleşmez; yetim ana süreç bitince teardown'ı yeni koşunun PG'sini kapatır)
  → `pkill -f "node \(vitest"` + `ps | grep "[v]itest"` ile doğrula. Eval config'i (`vitest.eval.config.ts`) DB kullanmaz, tam
  suit ile paralel koşabilir.
- 🚨 **MÜŞTERİYE GİDEN METİN SADE (kurucu 09-23):** teknik açıklama ("bayt", "ş 2 bayt sayılır", kova, TOTP…)
  ve gereksiz uzatma müşteriye GİTMEZ; yalnız ne yapması gerektiği söylenir, büyük platformların deyimiyle.
  Fiil seçimi de ürün dilidir: kullanıcı şifre "seçmez", OLUŞTURUR; hitap sitenin geri kalanı gibi "-in"
  ("…daha kısa bir şifre oluşturun."; "-iniz" değil). Kurucu seçimi 09-23, pinli.
- **Hospitable'a özgü yeni ekran/özellik YAPILMAZ (kurucu 09-23: "amacımız Hospitable'ı kaldırmak"):**
  bağlantı sağlığı gibi yüzeyler sağlayıcıdan bağımsız `ChannelConnection` üzerine kurulur (Airbnb Direct'i de taşır).
- **Ajanlar yalnız araştırır/ölçer/doğrular; kodu Claude yazar.** Bol paralel ajan, bulguları kodla doğrula
  (yarısı yanlış), kısa format. Kurucunun AÇIK kararını uygula (yeniden sorma); klişe yok.
- 🚨 **SORMADAN SİSTEM KURULMAZ (kurucu 09-26: "rezil bir durum, bir daha olmasın"):** kurucunun isteğini YORUMLAYARAK
  yeni bir sistem / kapı / ürün davranışı kurulmaz — yorum gerekiyorsa ÖNCE kısa soru. Örnek: "kontrol etmeden cevap
  vermesin" onayı sorulmadan KONUŞMA DÜZEYİ bir kapıya çevrildi, istenen ÖĞE bazıydı (`6c0e6b4`, gönderilmedi). ChatGPT /
  Codex / ajan önerisi KARAR DEĞİLDİR ("ChatGPT de yanlış söylüyor olabilir, bana sor"): iddia kodda ölçülür, uygulanıp
  uygulanmayacağı kurucuya sorulur. **ÖNERİ BİÇİMİ (kurucunun sözleri):** "bunu böyle yapıyorum · büyük şirketler böyle
  yapıyor · önerim bu · ÖRNEK: şöyle bir mesaj gelirse şöyle cevap veriyor / şöyle davranıyor · böyle yapalım mı?" —
  kararı değiştiren her öneride somut mesaj → davranış örnekleri (önce / sonra) gösterilir. **09-27 inceltme (kurucu):** Codex /
  ajan önerisi HEMEN kabul edilmez, kodda ÇALIŞTIRILARAK doğrulanır; kolay + doğru + müşteriye gideni ETKİLEMİYORSA yapılır ve
  haber verilir; müşteriye gidecek cevaba dokunuyorsa önce/sonra örneğiyle SORULUR; daha iyisi biliniyorsa gerekçeyle itiraz
  edilir. Kurucunun sözü Codex'inkinden önce gelir. Takip tablosu: `docs/INCELEME-2026-09-27-codex-ve-10-ajan.md`.
- Kalıcı kararlar buraya, gerekçeler git log/arşive.

## Kalıcı kararlar (yeniden tartışma yok — gerekçe: arşiv + git log)
> 📄 **Tam metin (bağlayıcı): `docs/claude/kalici-kararlar.md`** — bu alanda kod / karar değiştirmeden önce oku. Aşağıda yalnız madde başlıkları.
**Denetim/kanıt — Codex 2026-09-05 (hedef `73dbfb4`; rapor `docs/audit-2026-09-05/`, tur durumu `DURUM.md`)**
- F08 test DB kapısı
- F01 model çıktısı STRICT
- F02 QR sır filtresi TAM TARAR
- F03 silme → kuyruk sözleşmesi:
- F04 OAuth refresh CAS
- F05 teslim ACK'i koşullu
- F06 sayfa yolu DB arızası:
- F07 retention bayrak-AÇIK seçici
- Kalan P2 (ayrı modül turları):
- Kaynak taraması tek yönlüdür → davranışsal test; `rejects.not.toThrow(/…/)` kullanma; senkron CPU
- Ret edilenler: ETag testi (hedef yok) · HTTP/2 parser testi · kanonik-posta-kutusu kayıt limiti ·
**Kimlik / oturum**
- 🚨 BÜRÜNME = SALT-OKUNUR DESTEK GÖRÜNÜMÜ (K8, kurucu kararı 09-28, `auth/impersonation.ts`):
- 🚨 OTURUM ÇEREZİ `__Host-guestops_session` (09-23 ikinci tur, kurucu onayı):
- Epoch artıran kimlik işlemi BU CİHAZI yeniden imzalar:
- Parola biçimi (③):
- Hız sınırı kovası `rateLimitClientKey(req)`
- 🚨 OTURUM İÇİ YENİDEN DOĞRULAMA GÜNDE 20 HATA — TEK ORTAK SAYAÇ
- Giriş sonrası `?next=` API yolu olamaz
- 🚨 PAROLA ASLA KIRPILMAZ (09-23):
- 🚨 bcrypt EŞZAMANLILIK KAPISI (`auth/password.ts`):
- Doğrulama e-postası ve DENEME (trial) e-postaları kişiselleştirilmez
- Süper-admin e-postası JWT iddiasından okunur
- 🚨 ROL DEĞİŞTİREN / PERSONEL DAVET EDEN akış eklenirse `sessionEpoch` ARTIRILIR (ön koşul, #211):
- 2FA aktifliğinin tek koşulu `twoFactorEnabledAt`; bayat secret arıza değil → `/admin` "2FA'yı sıfırla"
- Operatör yetkisi = allowlist + `mfa === true` (`isSuperAdmin`, tek boğaz noktası). `login` `mfa`yı
- "Beni hatırla" (trusted-device) iki epoch'a bağlı (2FA + `sessionEpoch`); şifre değişimi/sıfırlama ve 2FA
- E-posta doğrulama: token fragment'te (`#t=`) + `POST` + PAROLA şart (ön-ele-geçirme kapandı); GET'i geri
- Şifre sıfırlama m47 challenge modeli: bütçe challenge satırına ait, token fragment'te, `middleware.ts`
- `readJsonCapped` `Content-Type: application/json` ister (öz karşılaştırma; virgül ham değerde).
- Login: hesap kovası doluyken doğru parolayla da YALNIZ tanınan cihaz girer (09-23; bilinmeyen tarayıcı 429, sahibin yeni
- `GET /logout` CSRF'i, per-session `jti`, halka açık sayfada çerez yenileme → açık tasarım kararları.
**Tenant / rotalar**
- Uyarı adresi (09-30, bayrak `ALERT_EMAIL_VERIFY_ENABLED` KAPALI → bugünkü "yalnız ekip üyesi" kuralı):
- `api-route-scoping.test.ts`: her rota org-kapsamlı ya da gerekçeli public listesinde; `admin/*`
- Anonim rotalarda da JSON kontrolü IP kovasından ÖNCE (#211, 09-27):
- QR sayfası + GET `resolveGuestChat(…, { knowledgeBase: false })` (#211):
- Kiracılar arası davranışsal test reddin SEBEBİNİ sınar (#211):
- Rol kapısı pini (#211, `api-route-role-gate.test.ts`):
- `cron/sync` · `cron/email-outbox` · `leads` davranışsal pinli (`timingSafeEqual` yapısal pin dahil).
- Hız limiti: `pickClientHop` sağdan `TRUSTED_PROXY_HOPS` (Railway 2); az tahmin güvenli, fazla tehlikeli;
- Ayar değişikliği audit'li (alan adları, değerler değil). `properties/[id]` DELETE ve `admin/leads` PATCH
- API yanıtında gizli / iç alan yok:
- Yükleme: private mimari (imzalı GET, `orgIdFromKey` 404, sihirli bayt, SVG/HTML yok); prod'da yerel
- CSP: enforce'ta `form-action 'self'`, `script-src` enforce EDİLMEZ; report-only'ye `report-uri`
- iCal SSRF: pinned DNS, redirect yok (3xx hata), private/link-local/IPv6 multicast blok, yalnız 443
- Landing iframe'leri Google Fonts çekmez (self-hosted woff2, latin+latin-ext ikisi de şart); CSP
- `/_next/image` kapalı (`images.unoptimized`); `next/image` kullanılırsa önce `sharp` kontrol.
**Veri yaşam döngüsü / KVKK**
- Scrub kapsamı kuralı: misafir metni/adı taşıyan her kolon `anonymizeOldGuestData` VE `maskReservationRows`
- Erasure tombstone guard'ları HER ingress'te: hospitable-sync · iCal · elle `.ics/.csv` · QR
- Retention: süre-bazlı rejim ≠ açık silme rejimi; scrubbed satıra PII geri yazılmaz; cutoff'tan eski
- 🚨 MİSAFİR HİTAP ADI + ADIN KÖKENİ (migration 57, kurucu onayı 09-28, `lib/guest-name-source.ts`):
- 🚨 ADSIZ YAPAY ZEKÂ + KODLA SELAM ("D", kurucu onayı 09-28; anahtar `AI_CODE_GREETING_ENABLED` VARSAYILAN KAPALI, `ai/code-greeting.ts`):
- Kalite denetçisi (Claude = ikinci işleyen) girdisinde sır DEĞERLERİ maskelenir (#211):
- Ad silme `redactNameFromBody` Türkçe harf aileleriyle eşleşir (09-28):
- Redaksiyon yapısal (`lib/redact.ts` — YAPRAK modül, hiçbir şey import etmez; `report-error-core` yeniden dışa
- Hesap silme Invoice/Consent/AuditLog'u da siler (migration ister, açık). `Organization.plan` kolonu ölü.
- Takvim feed URL'i at-rest şifreli (`urlEnc`+AAD), prod'da düz URL yok; doğrulama yalnız `--post-contract`.
**Mesajlaşma / outbox / sync**
- 🚨 SAĞLAYICI HATASI SARMALA KÖR OKUNMAZ (09-23 olayı):
- 🚨 PERİYODİK İŞİN ALARMI GEÇİŞ TABANLIDIR (09-23, `src/lib/alert-state.ts`, migration YOK):
- Kimlik e-postası kurtarması HER geçişte
- Channel Layer (V0.1–V0.2, `src/lib/channels`):
- Provenance (V0.4, migration 50 — CANLI 09-07 19:29Z, kanıt envanter §11):
- Messaging capability (V0.5 — CANLI, envanter §12):
- Ingest (V0.6, migration 51 — CANLI 09-08 03:13Z, envanter §12):
- Bağlantı durumu + kimlik çözümü (V0.7 kod hazırlığı — CANLI 09-08, envanter §13):
- ChannelConnection (V0.3, migration 49 — CANLI 09-07, kanıt envanter §10):
- Claim-then-send her yolda; claim TTL 120 sn; definitive (4xx≠408) → release+retry, ambiguous → claim
- Durable outbox (bayrak kapalı): kapalı state seti, `ERASABLE_STATUSES` tek kaynak; teslim etkisi üç
- CLAIM-THEN-NOTIFY: atomik işaret + yan etki → yan etkinin SONUCU okunur; `emailService.send` bildirim
- Escalation üç yol (model · kelime alerts · `applyInboundMessageRules`); m48 triyaj ikinci model çağrısı
- Rezervasyon durumu (#211):
- Yaşam-döngüsü sorguları `calendarSourceId: null` (kanal iCal işaretçisi DEĞİL); elle `.ics` `channel:"ics"`;
- iCal abonelik senkronunda kayıt kimliği (09-30, inceleme b1):
- 🚨 EKSİK iCal OKUMASI HÜKÜM VERMEZ (F16, 09-26):
- Sync motoru: fencing token + TTL 15 dk; heartbeat ilerleme-tetikli; `renewLock` geçici hata ≠ kayıp; 🚨 org sırası
- Provider mesajı sessiz atlanır ve imleç ilerler (bilinçli; ölçüm sayacı var).
- Sağlayıcı dizesinden NUL silinir (09-28, `canonicalStr`):
- Günlük AI kotası oto-yanıtı da sayar; tavana çarpınca konuşma `new` kalır; kart "AI işlemi" der. Model cevap verip çıktı
- Yeni org 7/24 açık doğar. 🚨 **09-12 GÜNCELLEME — bu satır "şema varsayılanı DEĞİŞMEDİ" diyordu ve
- Plan sınırları POST/PATCH/COPY hepsinde; yalnız büyüme reddedilir; fail-open (kullanım kapısı).
- Şablon yer tutucu ikamesi TEK GEÇİŞ (`replace` + callback); sıralı split/join ASLA.
**Faturalandırma**
- Kayıtlı abonelikten FARKLI aboneliğin olayı planı değiştirmez (K4, 09-30: ters sırada gelen eski iptal yeni aboneliği ezmiyordu).
- Bağlanamayan ödeme sessiz kalmaz (10-01, 15 ajan A10 F1):
- previewToken HMAC + `jti` tek kullanım; apply öncesi re-preview (409 amountChanged); definitive/ambiguous
- Yıllık = aynı plan kodu (ayrı "pro_yillik" YOK); `annualAvailable` = 3 env; başlık aylık, alt satır
**Kanal sözleşmesi / müsaitlik / demo (09-24)**
- Sağlayıcı kimliği ≠ OTA etiketi:
- Yetenek manifestosu
- Airbnb Direct adaptörü ağa ÇIKMAZ
- Müsaitlik: tek tarih kuralı `calendarDateOf`
- Demo hesabı
**AI / QR / diğer ürün kararları**
- 🚨 **HOST KARAR MOTORU (10-02 gece, kurucu: "cevap vermek talebi çözmek değil"; anahtar `HOST_DECISIONS_ENABLED` VARSAYILAN KAPALI; migration 59
- QR: per-stay device binding; `isOpenNow` simetrik; `chatToken` rotasyonu YOK (bilinçli); PIN DoS tasarımı
- AI öneri paneli kapatılabilir, tercih KALICI DEĞİL. Bekleyen misafir mesajları dar taranıyor
- 🚨 K8 / K9 (kurucu kararı 09-30):
- 🚨 ŞİKÂYETE BAĞLI İSTEK CEVAPLANMAZ (kurucu kararı 10-01, ANAHTARSIZ; `conversation-items/core.ts complaintDependent`):
- 🚨 BEKLEYEN RİSK ÖĞE BAZINDA (kurucu 09-26):
- 🚨 **KONUŞMA ÖĞELERİ (öğe bazlı risk; 09-26, migration 56; `AI_CONVERSATION_ITEMS_ENABLED=1` CANLI — kurucu 09-26; tasarım
- Mülke özgü ev kuralları (#188, `docs/TASARIM-2026-09-26-ev-kurallari-politikasi.md`) ONAYLANDI ("en mantıklı şekilde"):
- Doluluk gece-katı; ikinci kutucuk `sameDayTurnovers`; üçüncüsünü önerme. Kullanıcının geri aldırdığı
- Tarayıcı saat dilimine güven `APP_TRUST_BROWSER_TIMEZONE` default kapalı. S3 virtual-hosted, noktalı
- Tedarik zinciri: zafiyet kapısı = sıfır TRİAJSIZ (`security/audit-baseline.json`, `expires` zorunlu),
- Operatör scriptleri (PG/Windows): en yüksek kurulu pg sürümü, tüm exe'ler aynı klasör, saf ASCII,
- SEO/landing dürüstlük: (app) noindex; mutlak iddia yok; "AI yanıtı" değil "AI işlemi".
- .eu açılışı: ayrı deployment (env: `APP_URL`, `APP_LOCALE`, `APP_BILLING_CURRENCY`, `APP_DEFAULT_TIMEZONE`,

## Açık işler + bu alanların kalıcı kuralları
> 📄 **Tam metin (bağlayıcı): `docs/claude/acik-isler.md`** — bu alanda kod / karar değiştirmeden önce oku. Aşağıda yalnız madde başlıkları.
**V0 kalanları:** kolon contract'ı okuyucuları (backfill · token teşhisi · connect rotası · credentials kolon
**GEREKSİNİM (uygulanmadı):** doğrudan kanal + iCal aynı mülkte; aynı kanalın iCal'i pasif/yedek, diğerleri
**AÇIK QR kalitesi:** boş KB'de devir emergent (eşik = güvenlik kapısı, GOLDEN SET ister); hakaret/kışkırtma
**Şikâyet sınıflandırıcı (`fallback.ts`; 8 inceleme turu, 09-10/11) — kurallar:**
- 🚨 Acil ağı BAĞLAMLA (K6, kurucu kararı 09-30, `neutralizeNonEmergency`):
- 🚨 Kısa acil sözcükleri TAM SÖZCÜK (09-26, kurucu onayı, #51):
- 🚨 Sözcük İÇİ / öbek çakışması acil DEĞİLDİR (10-02, kurucu onayı — Sabah Kararları 49):
- Kural konusu ağında Türkçe "parti" TAM SÖZCÜK (10-02, aynı sınıf):
- Olumsuz fiil kalıpları ÇAPALI (tesis adı + fiil; gövde "-yo" ile: gelmiyor/gelmiyo). Çıplak `gelmiyor · gitti ·
- KOŞUL BİLDİRİM DEĞİLDİR: yalnız eşleşmenin HEMEN ARDINDAKİ ek okunur (`CONDITIONAL_TAIL` `^[ry]?s[ae]`);
- Arıza ailesi `hasDeviceBreakdown`: cihaz adı KELİME BAŞINDA + ÇEKİM doğrulaması (türetme eki elenir: kapı+cı,
- `BREAKDOWN_DEVICES` bir ENVANTERDİR (145 girdi; yazılmamış cihaz = oto-gönderim izni). `su`/`suy` CİHAZDIR;
- Kesme birleştirmesi YALNIZ soldaki parça zaten cihaz adıysa ("Klima'mız" ✓, "Van'a/Kaş'a/Bor'u" ✗ — yer adları).
- `hasUnnegatedProblemWord` üçüncü okuma = `deconfuse(normalizeForMatch(…))` (görünmez karakter + homoglif);
- İzafet kalıpları (`POSSESSIVE_FACILITY_COMPLAINTS`) + SORU EKİ guard YALNIZ o alt kümede (harf sınırı şart).
- Bilinen sınırlar pinli: sahiplik körlüğü (misafirin kendi cihazı, mimari) · belirtisiz tamlama FP ("şarj aleti") ·
**Eval:** harness `evals/*.json` + `tests/eval/`, AYRI config `npm run eval` (`vitest.eval.config.ts`: globalSetup
**Tüm geçmiş taraması** `scripts/eval-real-stats.ts` (Set B'nin AYNI pinli `readOnly` kapısı; model/kredi YOK; çıktı
**KB onay (A1, migration 53 CANLI):** `source`/`reviewState`; eski satırın onayı VARSAYILMAZ (varsayılan `legacy`,
**A2 izlenebilirlik (migration 54 CANLI):** `RiskEvent` 7 nullable kolon, 🚨 NULL = ÖLÇÜLMEDİ (0 değil);
**A3/A4/A5:** kod + testler yerinde, YÜZEYLER KALDIRILDI (kurucu 09-11); panelin yanlışlıkla geri mount edilmesi pinli.
**Geçmiş host cevapları (Bacak B):** yüzey VE veri KAPALI (`KB_HISTORY_SUGGESTIONS_ENABLED` varsayılan kapalı →
**Şablon → KB önerisi (`kb-from-templates.ts`, CANLI):** kategori allowlist YALNIZ `wifi`+`rules` (gerekçeler arşivde);
**Şablon düzenleme/uygulama:** PATCH `propertyId` alanı var; create şemasındaki `.nullish().transform(v => v || null)`
**Panel yerleşimi (lg):** dış kap `lg:fixed lg:inset-0`, `fillsViewport` dikey flex, grid `lg:flex-1 lg:min-h-0`, kart
**🔔 Kurucu 10-10 (unutma):** ödeme idempotency boşlukları + deneme kötüye kullanımı / risk puanı → `docs/TASARIM-2026-10-10-odeme-idempotency-ve-deneme-kotuye-kullanim.md`
**🔔 GOAL BİTTİKTEN SONRA OKU (kurucu 10-10):** Correlation ID / takip numarası (önce ödeme zinciri; destek ekranında numarayla arama; İLK DİLİM ✅ 10-12, §6) → `docs/TASARIM-2026-10-10-correlation-id-takip-numarasi.md` — kurucu kararları §5 (kapsam önce ödeme · hata ekranında numara · migration onaylı · KALICI yalnız-ekle olay günlüğü, güvenlik şartlarıyla) · Load balancer / yatay ölçek (bugün gerekmiyor; 2 kopya ön koşulları + karar soruları) → `docs/TASARIM-2026-10-10-load-balancer-yatay-olcek.md`
**Diğer açıklar:** Codex P2 (F09–F18) · `docs/DENETIM-2026-08-09.md` (27) · `docs/ACIK-ISLER-2026-08-08.md` (16) ·

## 🚨 ÇALIŞMA BİÇİMİ (09-19 → 09-24 güncel): RAILWAY AYIN 1'İNE KADAR AKTİF, GELİŞTİRME LOCAL'DE
🚨 **10-02 AKŞAM: Railway aboneliği BİTTİ** (kurucu) → CANLI YOK; dal push'u yalnız CI'dan geçer, deploy olmaz (geri açılınca dalın son yeşil
commit'i gider — migration'lı RC'lerden önce taze yedek kuralı aynen). Kurucu yerelde çalışıyor (`.env.local`, yerel PG 5434); prod `ENCRYPTION_KEY`
yerelde YOK (doğru). Son itilen RC72 (`d905c41`, CI #1290 yeşil).
🚨 **10-02 sabah: Railway HÂLÂ AKTİF** (kurucu canlıya bayrak ekledi) → dal push'u = CI yeşilse CANLI deploy. (Akşam bitti ↑.)
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
  1, sha ile geri yükleme. M0 kontrol koşusu ZORUNLU (09-09: fixture hatası 6 mutasyonu sahte "yakalandı" gösterdi). Worktree DOSYA yarışını çözer, PG 5433 yarışını ÇÖZMEZ → tam
  suit ile aynı anda koşmaz (koşucu başka vitest görünce durur). Hayatta kalan mutant = eksik pin ya da ÖLÜ KOD
  (ya da gerekçesi yazılı EŞDEĞER mutant) — biri düzeltilir. 🚨 "Ölü kod" diye silinen parçadan SONRA ilgili test dosyası YENİDEN
  koşulur (09-28: yaşayan mutant başka bir sebeple yaşıyordu; silme iki pinli testi kırdı, RC38 tam kapıda kırmızı → yayınlanmadı).
- **"Yüklem var, argüman yok"** sınıfı: saf fonksiyon doğru ama çağıran ona girdiyi vermiyor → bağlantı
  DAVRANIŞSAL test ister (QR `history_injection`, `suggestReply` alanı, önizleme `reply`).
- **Bir yüzeyi kapatırken RENDER'ı değil VERİNİN ÜRETİLDİĞİ yeri kapat**; bir kartı kaldırırken içindeki her
  bacağın tüketicisini say (Bacak B / şablon bacağı dersi).
- **Git çağıran test iki katmanlı:** `git -c safe.directory=<repo>` KOMUT kapsamında + git yoksa dosya sistemi
  taraması + fail-open yok (CI #1058/#1076). Pin git'in varlığını ŞART koşmaz.
- **Next.js `route.ts` yalnız bilinen rota alanlarını export eder** — sabitler yaprak modülde.
- Prisma temsilcisine `vi.spyOn` sonraki testlere sızar → DB arızası testi AYRI dosyada. Testte sabit tarih +
  `Date.now()` penceresi = zaman bombası (09-15). Yorumlarda `\uXXXX` kaçışı yazılmaz.
- 🚨 **PUSH SONRASI CI SONUCU HER SEFER KONTROL EDİLİR** (kurucu 09-24): 739d83c'nin CI'si kırmızı kaldı ve 4 saat fark
  edilmedi → Railway "Wait for CI" yayını atladı, canlı eski sürümde kaldı. Kontrol `actions_list` (dal filtresi) →
  `list_workflow_jobs`. İşler 2–7 sn'de düşüp `runner_id: 0` ve log 404 ise KOD DEĞİL: Actions dakika/harcama limiti
  (repo private) → kurucuya GitHub → Settings → Billing. Yeniden deneme `rerun_failed_jobs`.
- **Dizi biçimli `$transaction([...])` sonucu KONUMLA okunmaz** (09-24): mülk silmeye kural silme adımı eklenince
  `const [, result]` kural sayısını okudu, kuralı olmayan her mülk silinip 404 döndü (yayın öncesi tam kapıda yakalandı).
  Sonucu kullanılan adım etkileşimli işlemde ADIYLA döner.
- **Bulutta Node fetch proxy'yi okumaz:** OpenAI/embedding çağıran tsx/eval koşuları `NODE_USE_ENV_PROXY=1` ister.
- 🚨 **MİSAFİR METNİNE UYGULANAN KALIPTA KARESEL İŞ YOK (ReDoS denetimi 09-28, ölçüldü):** başı çapasız + sınırsız tekrar
  (`\S+X`, `\p{L}{2,}…$`, `KÖK\p{L}*\s+`) ve sabit gövdeden ÖNCE gelen değişken uzunluklu geriye bakış, uzun tek sözcükte / boşluk
  dizisinde karesel → olay döngüsü kilitlenir (sınıflandırıcı 20.000 karakterde 66 sn, çıktı vetosu 4.000'de 2,6 sn; kanal mesajında
  uzunluk tavanı YOK, QR 2.000). Kurallar: sonek kalıbı yalnız son harflere (`suffixTail`), çapasız kökten sonra `\p{L}{0,24}`,
  öndeki `\S+` yerine `\S`, geriye bakıştan ÖNCE gövde ileriye bakışı, iki bitişik boşluk yıldızı yerine ikincisi isteğe bağlı
  ayraçta; düzenli ifadeyle çözülemeyen yerde doğrusal tarayıcı + düzenli ifade testte KÂHİN (`mixedCodeTokenMatches`, iddia
  ölçümü 100.000 karakterde 7,7 sn → 26 ms). Yeni kalıp eklerken 4.000–50.000 karakterlik tek sözcük / boşluk dizisi / tekrarlanan
  kök süre pini (`*-cost.test.ts`) + eski/yeni sonuç kıyası. 🚨 (10-01 gece, 15 ajan A14) BİTİŞİK İKİ boşluk niceleyicisi
  arasında isteğe bağlı ayraç (`\s*X?\s*`) boşluk dizisinde karesel → `\s*(?:X\s*)?`; TÜRETİLMİŞ eşleşme adayları (kesme / aksan söküm)
  boşluk dizisi YENİDEN üretir → `matchCandidates` adayında dizi teke iner (`collapseSpaceRuns`); bu yüzden yalnız aday yolundan erişilen
  kalıp yeniden yazımları mutasyonda gerekçeli EŞDEĞER, ham metin yolları (acil ağı, müsaitlik standart çıkış ayıklaması) süre pinli.
  Yazım toleransı (BM25) sınırlı OSA (`osaDistanceWithin` = min(osa, max+1)) + dizin başına önbellek; seçim birebir (30.000 çift kâhin).
- **Dönüş tipini / hata sözleşmesini değiştiren düzeltmede BÜTÜN çağıranlar ve onların testleri taranır** (10-07): `deleteAccountData`ın
  `{ deleted }` dönüşü ve parola onayının 401'i hedefli testlerde yeşildi, tam kapıda üç eski pin kırmızı çıktı (çift tıklamanın kaybedeni 400
  sözleşmesi dahil). Hedefli test yetmez; `grep` ile çağıran + test listesi çıkarılır.
- **Aynı işlemde AYNI zaman damgasıyla yazılan satırların sıralaması `id` ile kesinleşir** (09-27): konuşma öğeleri bir turda tek
  `createdAt` ile yazılıyor, `requestIndex` mesaj başına 0'dan başlıyordu → iki mesajın öğesi tam eşit, sıra rastgele (tam kapı bir kez
  kırmızı; "Açık işler" sırası da oynayabilirdi). Eşitlik bozucu `{ id: "asc" }` (cuid yazılış sırasında artar).
- **Ajan token maliyeti (kurucu 09-23):** her alt ajan CLAUDE.md'nin TAMAMINI + tüm araç tanımlarını yükler ve
  sayaç birikimlidir (her araç çağrısında bağlam yeniden okunur). Bu dosya KURAL + GÜNCEL DURUM olarak kalır;
  tur anlatısı `docs/history/`e gider. Ajanlar dar ve az tutulur; basit arama doğrudan yapılır.

## Kalıcı ürün kararları (turlardan damıtıldı)
> 📄 **Tam metin (bağlayıcı): `docs/claude/kalici-urun-kararlari.md`** — bu alanda kod / karar değiştirmeden önce oku. Aşağıda yalnız madde başlıkları.
- Bağlam penceresi
- Acil ≠ sıradan istek:
- "Sorunlu" AI'yı KALICI durdurur
- Misafir QR'ı kapalı/bozuksa
- Otomatik giriş/çıkış/karşılama mesajları
- 🚨 DEVİR / BİLDİRİM CÜMLESİ MİSAFİRE GİTMEZ (K10, kurucu kararı 09-30, "Hiçbir şey gitmesin"):
- 🚨 **"EV SAHİBİNİZİN KARARIDIR" MİSAFİRE GİTMEZ (kurucu kararı 10-01, `ai/host-decision-hold.ts`; anahtar `AI_HOST_DECISION_HOLD_ENABLED`
- Çıktı vetosu
- Temellendirme kaydı:
- Bütçe:
- Reddedilenler (tekrar önerme):
- Embedding durumu:
- Saat okuyucusunda KARESEL İŞ YOK (A3 09-27, `kb-time-fields-perf.test.ts`):
- Saat alanı kuralı TEK KAYNAK `retrieval/time-fields.ts`
- 🚨 TASLAK = EV SAHİBİNİN SESİ (09-25, `ai/host-voice.ts`):
- 🚨 MODEL KIYASI 09-25 — gpt-6-luna'ya GEÇİLMEDİ
- Model sağlayıcısı kalıcı arızası
- Müsaitlik host metni
- Demo görüntü kararları tek kaynak `isDemoOrg`
- Kanal sözleşmesi / müsaitlik / demo

## Durum
> 📄 **Tam metin (bağlayıcı): `docs/claude/durum.md`** — bu alanda kod / karar değiştirmeden önce oku. Aşağıda yalnız madde başlıkları.
**10-16 öğle (güncel):** kurucu kararları Faz 1 (migration 68 ana dalda · söz tekrarı · e-posta tekrar kimliği · ödeme S1/S2/S4 · O1 liste anahtarı `DURABLE_OUTBOX_ORG_IDS` + kapatma testleri · QR tamamlanmış kayıt 24 sa + bayat işçi koruması); Faz 2/3 + sorular I1–I3 → `docs/arastirma-2026-10-15/KURUCU-SORULARI.md` §I.
**10-15 gece:** idempotency bitişi (iptal yolları tek kilit) + kurucu D1/D4/D6/D7 kodda; D2/D3 migration 68 onayı bekliyor; inceleme notun için iki KAPALI anahtar (arıza her yolda arıza · kanıtsız arıza adımı) + Opus N1–N12; 10-16 gece Opus ikinci + üçüncü tur (§H8, soru H9) + kalıcı kuyruk envanteri / kuyruk sağlığı (soru H10, `docs/TASARIM-2026-10-16-transactional-outbox.md`); 10-16 sabah O1 hazırlık ENGEL'i kapandı (kuyruk yolu öğe kipinde devir kilidi kurmaz) — `docs/claude/durum.md`.
**10-15 öğleden sonra:** V sonrası beş araştırma + müşteriye dokunmayan tekrar güvenliği düzeltmeleri; sorular `docs/arastirma-2026-10-15/KURUCU-SORULARI.md` — `docs/claude/durum.md`.
**10-15 gündüz:** Geçmişten öğren (migration 65; taslak müşteride, karşılaştırma operatörde, daire tercihleri hazır seçenek; anahtarlar KAPALI) — `docs/claude/durum.md`.
**10-15 gece:** Y1–Y10 + Haiku ikinci tur itildi; hazır yamalar KB istek kimliği (migration 65) + G1/G1b; RAG köprü önerisi — `docs/claude/durum.md`.
**10-13 sabah:** G1–G11 kurucu cevapları uygulandı (G1 hazır yama, kredi bekliyor) + yeni sorular H1–H3 — `docs/KURUCU-YOKKEN-KARARLAR-2026-10-09.md`.
**10-12 gece:** S1 bavul kapısı · S2 QR iptal edilmiş rezervasyon · ⑤ ilk dilim öneriler (`AI_ACTION_SUGGESTIONS_ENABLED` KAPALI) · takip numarası ilk dilimi (migration 63) — `docs/claude/durum.md`.
**10-08 gece:** Codex `15c8663` bulguları (U16–U44 + yeni 1–11) döngüde dört turda işlendi ve İTİLDİ (`87ba35d`; takip tablosu
`docs/INCELEME-2026-10-07-codex-u16-u44.md`, her bulguda regresyon testi, yarışlar gerçek PostgreSQL'de). Kimlik yarışları (U13/U40/U41/U43/U44),
silinen metnin gönderimi (Y1), özgün mesaj kaybı (Y2), tehlike okuyucu (U3), takvim / CSV / ICS / gün başı / rapor / sağlık düzeltmeleri, ölçer
düzeltmeleri. Next.js 15.5.27 (iki yeni SSG/ISR danışması). Onay bekleyen beş değişiklik HAZIR YAMA (`docs/hazir-yamalar/`, ana dala UYGULANMADI)
+ Sabah Kararları 63–68. Railway hâlâ kapalı.
- Bekleyen onaylar, 10-07 ve öncesi durum paragrafları, Host Copilot, K1–K18: tam metinde.
