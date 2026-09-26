# Codex denetimi 2026-09-05 — uygulama durumu (tur raporu)

> Hedef commit: `73dbfb4` (denetim). Bu dalda `73dbfb4 → 906f0d4` arası yalnız belge commit'leri
> vardı; kod birebir aynıydı. Düzeltme turu: 2026-09-07. Sözleşme: `docs/TEST-EVIDENCE-CONTRACT.md`.
> Rapor biçimi handoff §6: *Bulgu → kök neden → ön koşul → düzeltme → kırmızı-önce test → kaldırma
> mutasyonu → aşırı-kısıtlama kontrolü → integration/critical-flow → commit → CI → deploy → prod smoke → kalan risk.*

## Dört satırlık ayrım (KOD / CI / DEPLOY / PROD SMOKE)

| Katman | Durum |
|---|---|
| **KOD** | 8/8 P1 düzeltmesi yazıldı, her biri ayrı commit (↓tablo). Yerel kapılar: typecheck ✅ · `eslint .` ✅ (0 uyarı) · `scripts/audit-check.mjs` ✅ (üretim: 6 triajlı danışma, 0 triajsız) · tam `npm test` ✅ **3430 test / 301 dosya** (ilk koşuda 1 kırmızı: `audit-2026-08-07-round2` içindeki eski head/tail pini F02'nin kapattığı kusuru "koruma" diye pinliyordu → yeni sözleşmeye çevrildi: kesme YOK + fail-closed üst sınır + sınır ≥ KB tavanı) · `next build` ✅ (67 sn). e2e yerelde koşulmadı (CI job'ı). Migration-chain: bu turda migration YOK. |
| **CI** | Push sonrası doldurulacak (↓"CI sonucu"). |
| **DEPLOY** | Railway "Wait for CI" AÇIK → CI yeşilse oto-deploy. Bu turda **migration YOK**, **env değişikliği YOK**, **bayrak açılışı YOK**. |
| **PROD SMOKE** | Yapılmadı ve bu belgeden yapılmış gibi okunmamalı. Operatör smoke'u ↓"Prod'da doğrulanacaklar". |

## Bulgu tablosu

| # | Bulgu (Codex) | Kök neden (kod-doğrulandı) | Ön koşul | Düzeltme | Kırmızı-önce test | Kaldırma mutasyonu → kırmızı | Aşırı-uygulama → kontrol kırmızı | Integration / kritik akış | Commit |
|---|---|---|---|---|---|---|---|---|---|
| F08 | Test hazırlığı yanlış DB'de veri kaybettirebilir | `tests/global-setup.ts` her `TEST_DATABASE_URL`'de `db push --accept-data-loss`; `helpers/db.ts` her testte tüm tabloları boşaltır | Yanlış URL taşıyan kabuk / CI ayarı | `scripts/test-db-guard.mjs`: loopback ∨ `TEST_DB_ALLOW_REMOTE=1` + DB-yorumu işareti + boş-DB sahiplenme (`TEST_DB_ADOPT=1`); kapı push'tan ÖNCE | `tests/unit/test-db-guard.test.ts` (13): gerçek `setup()`, child_process mock — arızada `execSync` çağrılıyordu | kapı çağrısı silindi → 4 · loopback kontrolü silindi → 2 | işaretli DB de reddedildi → 3 | — (harness güvenliği) | `f2f2679` |
| F01 | Eksik AI güvenlik alanları oto-gönderime uygun | `String(riskLevel ?? "none")`, `Number(true)=1`, `Number("0.99")` | Model şema dışı cevap verir (Codex sentetik: `{confidence:true}` → gerçek kapı TRUE) | `ai/index.ts`: riskLevel yalnız kapalı-küme string (eksik=tanınmayan="high"); confidence yalnız sonlu number (aksi 0); `reportError` throttled + host notu; kapıda `Number.isFinite` | `tests/unit/ai-output-schema.test.ts` (10) + `tests/integration/ai-output-schema-autosend.test.ts` (2; gerçek parser + gerçek `applyChannelAutoReply`, yalnız OpenAI HTTP/gönderici/token/e-posta sahte — arızada `out.sent=true`, gönderici çağrılıyordu) | eksik→none geri → 3 · coercion geri → 3 · kapı finite → 1 | her riskLevel→high → 2 | Inbound→AI→gönderim (golden 411 test yeşil) | `bcb3a23` |
| F02 | QR sır filtresi ortayı taramıyor | `looksLikeSecret` 8k üstünde yalnız ilk+son 4k; KB tavanı 20k | 8k–20k arası tek kalem | tam tarama; `SECRET_SCAN_MAX_CHARS=24_000` üstü fail-closed; ReDoS ölçüldü 0.7–3.2 ms/kalem (24k adversarial) | `tests/unit/qr-secret-scan-coverage.test.ts` (8): 18.019 karakterlik kalemin ortasındaki kod GEÇİYORDU | eski kemer geri → 5 · üst sınır fail-open → 1 | 8k üstü her şey elendi → 2 | QR + rezervasyon-öncesi KB kapısı (17 dosya/160 test) | `a8df4f8` |
| F03 | Silinen konuşmanın bekleyen mesajı gönderiliyor | Rotalar kuyruğa dokunmuyor (FK yok); `aiSendVeto` `!msg → null` (= manuel, geçsin); holding_ack varlık kontrolü yok | Durable outbox bayrağı + bekleyen satır (prod'da bayrak KAPALI) | rotalar aynı TX'te `ERASABLE_STATUSES` satırlarını `canceled` (belt); worker `replyVeto` her tür için varlık + kiracı (braces) | `tests/integration/delete-cancels-outbox.test.ts` (12): gerçek rota + gerçek worker + DB; arızada sağlayıcı 8/8 çağrılıyordu | rota belt → 3 · conversation_gone→null → 2 · message_gone→null → 1 · kiracı → 1 | rota tüm org satırlarını iptal → 1 · worker her yanıtı vetoluyor → 2 | Inbound→outbox→teslim (103 test) | `6688e3f` |
| F04 | Geç dönen refresh kaldırılmış bağlantıyı diriltiyor | `persistOAuthTokenSet` `update({where:{id}})` koşulsuz | Refresh sırasında disconnect/reconnect | CAS: `updateMany WHERE hospitableRefreshTokenEnc = başlangıç blob'u`; 0 satır → null döner, yazmaz | `hospitable-credentials.test.ts` +3: arızada `access-LATE` dönüyor ve satır geri yazılıyordu | CAS koşulsuz → 2 · CAS kaybında token verildi → 2 | CAS hiç eşleşmez → 4 | OAuth (44 test) | `8a0ce62` |
| F05 | Eski gönderimin tamamlanması yeni şikâyeti kapatıyor | `markConversationDelivered` `status != closed → answered` koşulsuz; `lastMessageAt = now` | Veto→POST arasında yeni inbound/escalation | tek UPDATE'te ilişki filtresi (yanıttan sonra inbound yok); AI `problem` kilidini ezmez; `lastMessageAt` ileri-yön | `tests/integration/outbox-delivery-race.test.ts` (8): olay POST'un içinde; arızada `answered` | inbound guard → 2 · AI kilidi → 1 · ileri-yön → 1 | host da problem kapatamaz → 1 · hiç answered yazma → 1 | Teslim→audit (208 test) | `14db215` |
| F06 | Sayfa yolu DB hatasında eski MFA iddiasını koruyor | catch yalnız `role=staff`; `isSuperAdmin` `mfa` iddiasına bakar | DB blip + izinli kurucu oturumu | catch: `mfa=false` + impersonation → çıkış | `require-auth-failclosed.test.ts` +3 (eski "taviz" pini ters çevrildi): arızada `isSuperAdmin=true` | mfa clamp silindi → 2 · impersonation fail-closed silindi → 1 | iddia her zaman düştü → 2 | Session revocation / operatör kapısı (50 test) | `5602188` |
| F07 | Retention bayrağı tam yeniden-temizleme sağlamıyor | bayrak-açık seçici 2 bacak | `RETENTION_MESSAGE_AGE_ANCHOR=1` (prod'da KAPALI) | 8 bacak + öksüz triyaj; bacak kuralı = sonlanma kuralı; bayrak-kapalı birebir eski | `retention-message-age-anchor.test.ts` +8: arızada telefon/ad/triyaj/görev metni süresiz kalıyordu | telefon → 2 · ad → 1 · triyaj → 1 · görev → 1 · öksüz → 1 | her satırı sonsuza dek seç → 2 (sonlanma) · bacak bayrak-kapalıya sızdı → 1 (parite) | Retention/erasure (73 test) | `399d3c3` |

Mutasyon hijyeni: hepsi çalışma ağacında, `assert count==1` ile uygulandığı doğrulandı, ardından
geri yüklendi; hiçbiri commit'lenmedi. İki testim ilk yazımda vacuous çıktı ve düzeltildi
(F05 `lastMessageAt` geriye testi — satır vadeli değildi; F07 konuşma testi — ad+triyaj birlikte).

## Kalan risk (dürüstçe)

- **F03:** claim alınmış + veto geçilmiş satırın POST'u ile eşzamanlı silme geri alınamaz (ms
  penceresi; satır dürüstçe `sent`). Sağlayıcı idempotency anahtarı vermediği sürece kapanmaz.
- **F04:** gerçek iki-bağlantılı PostgreSQL yarışı koşulmadı; CAS tek SQL ifadesi olduğu için
  sıra yarışı sonucu değiştirmez — kanıt predicate düzeyinde + sıralı yeniden üretim.
- **F07:** ad-redaksiyonlu metinler (`TaskUpdate.note`, outbound gövde) yeniden seçim tetiklemez;
  kapatılması işaret kolonu (migration) ister. Bayrak prod'da KAPALI; açılış ayrı onay.
- **F01:** somut tesis/ücret/müsaitlik iddiasında kaynak/araç kanıtı zorunluluğu AI MVP turuna ait.
- **F02:** sır görünürlüğünün alan-bazlı erişim politikasına taşınması V0+ turuna ait (bugün:
  kategori bacağı + içerik sezgiseli + `verifiedActiveStay`).
- **F06:** normal müşteri oturumu DB arızasında fail-open kalır (bilinçli — kitlesel çıkış yok).

## P2 — bu turda DOKUNULMADI (ilgili modül turlarında)

~~F09 CSP raporu path token'ı~~ (KAPANDI 09-26, `979355b`: rapor alanları loga yalnız `lib/csp-report-fields.ts`ten — URL → origin + rota şablonu, `/c/<chatToken>` · `/api/chat/<token>` · `/api/calendar/<token>` → `:token`, ekran adına benzemeyen segment `:id`, en fazla 6 segment; http(s)/ws(s) dışı şema yalnız adı, uydurma şema `invalid`; kaynak anahtar kelimesi / directive / disposition kapalı küme; URL olmayan değer `invalid`; satır merkezî redaksiyondan geçer. Ölçüm değeri korunur: `/inbox`, `/gtag/js`, meşru directive'ler. Kırmızı-önce 8 test, mutasyon 15/15) · ~~F10 merkezi log redaksiyonu~~ (KAPANDI 09-26, `8454a6c` + `6811d9d`: redaksiyon
yaprak modüle `lib/redact.ts` birebir taşındı (338 satır; `report-error-core` yeniden dışa verir) + `formatErrorForLog`
(ad: ileti + cause, redakte, yığın yok, kısaltma redaksiyondan sonra). Beş yazıcı ölçüldü ve düzeldi: audit düşüşü
(ham `console.error(err)` kalktı, `reportError` zaten redakte loglar), hız limiti (sürücünün DETAIL satırındaki
`login-acct:<e-posta>`), gölge AI, e-posta istemcisi (dar kopya boşluklu telefonu geçiriyordu; döngüsel import sorunu yaprak
modülle bitti), zamanlayıcı tıkları (hata + cause). Mekanik pin TypeScript sözdizim ağacında (metin taraması değil); bilinen
sınırı (değişkene kopyalanan hata) davranışsal testler kapatır. Kırmızı-önce 5 davranışsal + pin (4 yer) + birim; mutasyon 13/13.
AÇIK — kurucu kararı: audit yazılamazsa eylem başına durdurma politikası (bugün tümü fail-open + alarm; superadmin hassas
okumasında izsiz erişimin reddi dahil) · Paddle "expected outcome" satırı incelendi, kendi kurduğumuz iletiyi taşır, dokunulmadı) · F11 mülk silmede obje temizliği · F12 audit baseline şeması (`expires` zorunlu) ·
~~F13 üslup profili ↔ tesis gerçeği~~ (KAPANDI 09-26, `4832ab5`: profil yalnız üslup, eski profil isteme girmez ve senkron düşse de yenilenir — `ai/style-profile.ts`; kırmızı-önce 10 test, mutasyon 20/20. Kalıntı `e97e508`: sistem istemi KURAL-1 ve `usedSources` rehberi hâlâ 3. bilgi kaynağı sayıyordu, "history" beyanı sohbet geçmişi boşken rehberle doğrulanıyordu; kırmızı-önce 4 test, mutasyon 5/5) · F14 sohbet hafızası/zaman (KODDA 09-26, `b2fc68a`, bayrak `AI_CONVERSATION_STATE_ENABLED` arkasında: geçmiş satırında güvenilir yazar + org diliminde yazıldığı an, cevaplanan mesajın anı, ayrıntılı kipte her mesaj tek satır — sahte etiket satır başında duramaz; bayrak kapalıyken istem bayt bayt eski. Kırmızı-önce 26 test, mutasyon 40/41 + 7/8 → yaşayan S7/H8 ikizlerle kapandı. Canlı kapıya sahte etiket sinyali `df1e483` (#176, bayraksız): kırmızı-önce 11 test, mutasyon 9/9; ikizler S7/H8 2/2. Önceki turlarda kapananlar: 25 mesaj + bütçe penceresi, QR geçmişi, takvim günü zaman çizelgesi. Anlama katmanı da yazıldığı anı görür `8e7e694` (F14b, aynı bayrak): kırmızı-önce 10 test, mutasyon 14/14. AÇIK: açık konuların pencere dışına düşmemesi = CUS v2 defteri (migration, onay); bayrağı açmak kör eval + kurucu onayı) · ~~F15 kalite denetimi `{}`~~ (KAPANDI 09-26: durum `evaluated/inconclusive/empty`, zorunlu alan + mesaj üyeliği, ekranın yeşil "uygun" yazısı yalnız tam değerlendirmede; kırmızı-önce 9 test, mutasyon 13/13) · ~~F16 iCal
completeness~~ (KAPANDI 09-26, `9fb93ad`: `parseIcsDetailed` eksik okumayı kapalı kümeyle döndürür — yarım dosya, 10.000 tavanı,
RRULE/RDATE/EXDATE/RECURRENCE-ID (açılmaz), tarihi okunamayan / ters / sıfır süreli / BEGIN-END'i bozuk etkinlik, aynı UID çelişen
iki hâl; kaynak `partial`, kayıp uzlaştırması eksik okumada kayıp saymaz ve tabanı ezmez, görülen satırın serisi sıfırlanır —
şüpheli düşüşte de; müsaitlik motoru kısmi kaynakla "boş" demez; dosya önizlemesi not gösterir. Kırmızı-önce ölçüldü: eski kodda
uzlaştırma açıkken 25 saat arayla iki yarım okuma görünmeyen gerçek rezervasyonu İPTAL ediyordu. Kırmızı-önce 42 test, mutasyon
41/41. Bilinen sınır: hacim düşüşü sezgisi yalnız uzlaştırma bayrağı açıkken koşar ve müsaitliğe taşınmaz; "Dikkat Gerektirenler"
kısmi beslemeyi göstermez) · F17 cron adaleti · F18 login savunma tasarımı.

## CI sonucu

**Run #934 (`34103840587`), HEAD `99294e7` — 5/5 job yeşil** (2026-09-07 09:03–09:12 UTC):
`verify` (typecheck · lint · tam test, 7 dk 44 sn) ✅ · `build` ✅ · `e2e` (Playwright smoke) ✅ ·
`migration-chain` (00→N taze DB + sıfır drift) ✅ · `security-audit` ✅. PR koşusu #935 beklendiği
gibi `skipped` (`head_ref` guard'ı). Bu satır CI sonucunu HEAD'e bağlar: HEAD ilerlerse
kanıt yenilenmeli.

**Deploy:** Railway "Wait for CI" AÇIK → yeşil CI oto-deploy'u başlatır. ACTIVE teyidi ve
↓prod smoke bu ortamdan görülemez (Railway erişimi yok) — operatör okur.

## Prod'da doğrulanacaklar (operatör; bu turda YAPILMADI)

1. Deploy ACTIVE olduktan sonra `/api/health` 200 ve `/admin` kurucu oturumuyla açılıyor (F06
   regresyon kontrolü: DB sağlıklıyken yetki korunmalı).
2. Ayarlar → "AI'yı Deneyin" bir cevap üretiyor (F01: geçerli cevaplar hâlâ `openai` kaynaklı
   ve güven değeri 0 değil). Sentry'de `openai-reply schema violation` YOK olmalı.
3. QR concierge'de uzun bir KB kalemi (ev kuralları) hâlâ modele gidiyor, sırlı kalem gitmiyor (F02).
4. Hospitable bağlantısı (Lale 402'de olduğu için refresh yolu canlıda gözlenemez) — F04 için
   canlı kanıt bir sonraki aktif abonelikle.
