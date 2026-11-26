# İnceleme 2026-10-07 — Codex `15c8663` salt-okuma bulguları (U16–U44 + yeni 1–11) — doğrulama ve düzeltme takibi

> Kurucu talimatı (10-07 gece, döngü): "önce mevcut kodda tekrar doğrula; doğrulanmayanları somut karşı kanıtla ayır … her doğrulanan
> bulguda eski girdi → yanlış sonuç → önerilen sonuç ve regresyon testi … ölçücü düzeltmeleri müşteri gönderim politikasını kendiliğinden
> değiştirmesin; %95 zorunlu kabul kapısı geri getirilmesin … müşteriye giden mesajı, görev üretimini, para/erişim anlamını değiştiren
> kapsamlar için kurucunun onayını al."
> Doğrulama: güncel ağaçta (HEAD `7869db9`) kod okuma + saf modüllerde `tsx` ile yeniden üretim (veritabanı / ağ yok). Düzeltmeler ayrı
> commit'lerde, kırmızı-önce + mutasyon. Bu belge her tur güncellenir.
> **10-07 gece durumu:** tur 2 + 3 + 4 kodda; onay gerektiren beş değişiklik HAZIR YAMA olarak `docs/hazir-yamalar/` (ana dala
> UYGULANMADI; `git apply` ile uygulanır) + `docs/SABAH-KARARLARI-2026-10-01.md` 63–68.

## Durum tablosu

| # | Konu | Doğrulama | Düzeltme | Not |
|---|---|---|---|---|
| U13 | Bürünmeden çıkış iptal edilmiş operatör oturumunu canlandırır | DOĞRULANDI (P1: uç hız sınırsız, tekrar denenebilir) | YAPILDI — `exitImpersonation` doğrulanmış sürümle imzalar; arada iptalde çıkış (`exit-impersonation.test.ts`) | tur 2 |
| U43 | Parola değiştirme, araya giren sıfırlamayı ezer | DOĞRULANDI (P2–P3: saldırgan zaten aynı zararı verebilir) | YAPILDI — yazma koşulunda oturum sürümü; sıfırlama bekleyen kodu siler; çift tıklamanın kaybedeni yine 400 (`identity-races.test.ts`) | tur 2 |
| U40 | 2FA açma, araya giren sıfırlamadan sonra oturum verir | DOĞRULANDI (dar pencere, P2) | YAPILDI — 2FA aç / kapat / kurtarma kodu sürüm koşullu (`identity-races.test.ts`) | tur 2 |
| U41 | Hesap silme, araya giren sıfırlamadan sonra sürer | DOĞRULANDI (P2–P3) | YAPILDI — silme işleminde sahip satırı FOR UPDATE + sürüm ön koşulu (`identity-races.test.ts`) | tur 2 |
| U44 | Doğrulanmamış hesap süpürgesi az önce etkinleşen hesabı siler | DOĞRULANDI (bayrak kapalı) | YAPILDI — süpürge işlem içinde aday koşullarını yeniden denetler (`unverified-sweep-race.test.ts`) | tur 2 |
| U42 | Hesap silme ↔ ödeme olayı yarışı (iki yön) | DOĞRULANDI | silme tarafı YAPILDI (org FOR UPDATE + faturalı abonelik işlem içinde, 409); ödeme tarafı HAZIR YAMA (Sabah 66) | tur 2 |
| U29 | Veritabanı arızasında gelen kutusu rol kapısız okur | KISMEN (bugün rol değiştiren yol yok; F06 ödünleşimi) | HAZIR YAMA (Sabah 67) — doğrulanamayan oturum sayfa açmaz | Sabah Kararları (F06 kuralını değiştirir) |
| U3 | Tehlike okuyucu: 32 tekrar tavanı · ekipman istisnası · "and" ötesi olumsuzluk | DOĞRULANDI (bildirilenden geniş) | YAPILDI — tavan seviyeyi düşürmez, bağlaç olumsuzluğu keser, ekipman yalnız ad niteleyince (`hazard-evidence.test.ts`) | kurucu önceliği; tur 2 |
| U17 | Otopark tahsisi muafiyeti olumsuz / komşu / koşullu KB'yi olumlu sayar | DOĞRULANDI (5 yanlış geçiş) | HAZIR YAMA (Sabah 63) | 24 EK'i daraltır → hazır dal + Sabah Kararları |
| Y5 | Görev tekilleştirme cihaz değil "bozuk" sözcüğüyle | DOĞRULANDI (gaz + yangın aynı gün de tek görev) | HAZIR YAMA (Sabah 64) | görev üretimi → hazır dal + Sabah Kararları |
| U26 | Kontrol listesi bayat formu | KISMEN (bildirilen senaryo 403; başka üç kayıp yolu var) | YAPILDI — tek madde (sıra + etiket) kilitli satıra; bayat liste 409; pano tek madde gönderir (`tasks-checklist-race.test.ts`) | tur 3 |
| U39 | Paddle bozuk tutar faturası | DOĞRULANDI | HAZIR YAMA (Sabah 65) | para akışı → hazır dal + Sabah Kararları |
| U30 | CSV negatif tutar biçimleri pozitife döner | DOĞRULANDI | YAPILDI — `\p{Pd}` + U+2212 eksi; parantez rakamların dışında (`csv-negative-amount.test.ts`) | K1'in uygulanması; tur 3 |
| U31 | CSV geçersiz tutar başka tutara çevrilir / tavana kırpılır | DOĞRULANDI | YAPILDI — rakamlar arası yalnız ayraç; bozuk / 100M üstü satır hatası | tur 3 |
| U32 | CSV tarihi sunucu saat dilimine bağlı | DOĞRULANDI (bugün sunucu UTC → gizli) | YAPILDI — `Date.UTC` + UTC alıcılar (TZ'li testle) | tur 3 |
| U33 | ICS ISO biçimi TZID'yi yok sayar | DOĞRULANDI | YAPILDI — ofsetsiz ISO saat temel biçimin TZID dalından (`ics-parse.test.ts`) | tur 3 |
| U36/Y11 | ICS dışa aktarım satır katlama UTF-16 / bayt | DOĞRULANDI | YAPILDI — kod noktası başına UTF-8 bayt (`ics-export.test.ts`) | tur 3 |
| U37 | Takvim olmayan gövde "boş takvim" sayılır | DOĞRULANDI | YAPILDI — ilk anlamlı satır `BEGIN:VCALENDAR` (`ical-frame.test.ts`) | tur 3 |
| U35 | fc…/fd…/fe8… alan adları özel IPv6 sanılır | DOĞRULANDI | YAPILDI — IPv6 önekleri yalnız `isIP === 6` (`private-host.test.ts`) | tur 3 |
| U38 | Takvim kaynağı tavanı paralel eklemede aşılır | DOĞRULANDI | YAPILDI — sayım + ekleme tek işlemde, mülk FOR UPDATE (`calendar-source-cap-race.test.ts`) | tur 3 |
| U34 | Gece yarısı yaz saati geçişi (Azor / Havana / Santiago) | DOĞRULANDI (belgeli sınır) | YAPILDI — gün başı günün GERÇEK ilk anı (418 dilim × 2020–2030: 0 uyuşmazlık; `timezone-dst-midnight` + `day-where-dst-midnight`) | tur 3 |
| Y6 | Sağlayıcı girişinde imkânsız / ters tarih | DOĞRULANDI | YAPILDI — katı ISO + takvim; çıkış ≤ giriş yazılmaz (`canonical-date.test.ts`) | tur 3 |
| Y7 | Aylık rapor yalnız-tarih değerine ham pencere | DOĞRULANDI | YAPILDI — `reservationDayRangeWhere` (`reports-month-dedupe.test.ts`) | tur 3 |
| Y8 | Rapor / pano tekilleştirmesi farklı mülkleri birleştirir | DOĞRULANDI | YAPILDI — yalnız sağlayıcı rezervasyonu daireler arası birleşir (`reports-month-dedupe.test.ts`) | tur 3 |
| Y9 | Sağlık ucu süren yoklamayı paylaşmaz | KISMEN (gerçek, etkisi düşük) | YAPILDI — süren yoklama paylaşılır (`health-probe-shared.test.ts`) | tur 3 |
| Y1 | Silinen misafirin özel metni yine gönderilir (kalıcı kuyruk) | DOĞRULANDI | YAPILDI — gönderimden hemen önce talepli satır yeniden okunur; `[erased]` → iptal (`outbox-erasure-claimed.test.ts`) | bayrak kapalı (`DURABLE_OUTBOX_ENABLED`); tur 2 |
| Y2 | Tekrar konuşma temizliği yeni gelen özgün mesajı siler | DOĞRULANDI | YAPILDI — tekrar başına işlem, iki satır FOR UPDATE, yeniden denetim (`conversations-cleanup-race.test.ts`) | CANLI yol (elle temizlik düğmesi); tur 2 |
| Y3 | Onarım yolu yeni soruyu "yanıtlandı" yapar | DOĞRULANDI (bildirilenden geniş) | YAPILDI — onarıcı cevabın mesajına çapalı (`outbox-healer-anchor.test.ts`) | bayrak kapalı; tur 3 |
| Y4 | Eski karar kartı yeni talebi kapatır | KISMEN (iki parça gerçek, (a) daha geniş) | YAPILDI — kaynak mesaj sırası `(createdAt, id)` (`decision-store.test.ts`) | bayrak kapalı (`HOST_DECISIONS_ENABLED`); tur 3 |
| U27/U28 | QR: hata yeni taslağı siler · eski 404 açık sohbeti kapatır | DOĞRULANDI | YAPILDI — yeni taslak korunur; sıra denetimi her dalda (`draft-preservation.test.tsx`) | CANLI (misafir ekranı); tur 3 |
| Y10 | Cevap kutusu gönderim sonrası yeni taslağı siler | DOĞRULANDI + kardeş bileşen | YAPILDI — yalnız gönderilen metin hâlâ alandaysa temizlenir (`draft-preservation.test.tsx`) | CANLI (ev sahibi ekranı); tur 3 |
| U16 | Konuşma durumu raporu aynı gün ezer | DOĞRULANDI | YAPILDI — `uniqueReportName` (`eval-report-naming.test.ts`) | ölçer; tur 4 |
| U18 | Yeniden sıralama eval'i boş boyut listesiyle yeşil | DOĞRULANDI | YAPILDI — `parseSizeList`; sıfır çağrılı rapor GEÇERSİZ (`eval-args.test.ts`) | ölçer; tur 4 |
| U19 | Veri üretici doğrulamadan önce yazar | DOĞRULANDI | YAPILDI — yazmadan önce sayı denetimi, geçici dosya + yeniden adlandırma (`eval-args.test.ts`) | ölçer; tur 4 |
| U20 | Cevap ölçeri yanlış alan / olumsuz / yarım aralığı doğru sayar | DOĞRULANDI | YAPILDI — katı sütun (ayrı, kapı değil) + `factsHit` rakam sınırı; vaka kabulüne bağlamak Sabah 68 | ölçer (gönderim kapısı DEĞİL); tur 4 |
| U21 | Ölçek / taban raporu metni ayarla çelişir (200 ↔ 400) | DOĞRULANDI | YAPILDI — metin sabitlerden / ölçümden (`kb-retrieval-scale` / `-baseline`) | ölçer; tur 4 |
| U22 | Canlı hat raporu cevabı 320 karakterde keser | DOĞRULANDI | YAPILDI — `reviewQuote` (`eval-report-naming.test.ts`) | ölçer; tur 4 |
| U23 | QR sır ölçümü yalnız senaryonun kendi listesine bakar | DOĞRULANDI | YAPILDI — setin bütün bilinen sırları her cevapta (`eval-known-secrets.test.ts`) | ölçer; tur 4 |
| U24 | "15:00" için iki açık sette zıt etiket | DOĞRULANDI (dev satırları) | YAPILDI — d-q017 `none` + `relabel` notu (`stay-change-label-consistency.test.ts`) | d-q017 eski kurala göre etiketli; tur 4 |
| U25 | `engines` Node 22.0'a izin verir, araçlar ≥22.13 ister | DOĞRULANDI | YAPILDI — `>=22.13.0 <23`, taban kilitten hesaplanıp pinli (`node-version-parity.test.ts`) | tur 4 |

## Ayrıntı — ölçüm araçları (U16–U25)

- **U20:** `tests/eval/rag-lab/answer-metrics.ts:41-58` (`replyHasAnchor` cevabın HERHANGİ bir sayısı geçerse tam isabet), aynısı
  `answer-acceptance.ts:77-81`; `reply-scoring.ts:52-56` `factsHit` düz alt dize (`factsHit(["11"], "Daire 110")` = doğru; "250 TL değil"
  = doğru). Doğru cevap "Havuz 09:00–20:00" iken "Havuz 09:00–11:00", "Havuz 09:00'da açık değil", "Çıkış saati 09:00" tam isabet sayılıyor.
  Düzeltme: aralıkta iki uç, sayısal olguda sayı sınırı, ayrı "katı" sütun (aynı cümlede konu sözcüğü, olumsuzluk yok) — trend, kapı değil.
- **U23:** `qr-live-pipeline.eval.test.ts:350` yalnız senaryonun `forbidden` listesi; `qr-live-dev.json`in 44 senaryosu aynı bilgi tabanını
  kullanıyor (üç sır), yalnız 4'ü sırrı arıyor. Düzeltme: veri setinin bilinen sırları her gösterilen cevapta + taslakta, sayı sınırıyla, ayrı
  satır. `live-pipeline:433`te onaylı konaklamaya sır meşru → yalnız onaysız konaklamada.
- **U18:** `rerank-llm.eval.test.ts:39-42` bilinmeyen boyutu sessizce atar; `999` → boş liste → `0 === 0`, rapor yok, yeşil. Düzeltme:
  bilinmeyen / boş seçim hata; sıfır çağrılı rapor GEÇERSİZ.
- **U19:** `rag-dataset-gen.eval.test.ts:249` yazar, `:251` doğrular; sonraki koşu `:247` `existsSync` ile atlar. Başarısız toplu iş `[]`
  döner, sayılmaz. Düzeltme: `*.tmp` + doğrula + yeniden adlandır; var olan dosyada yalnız SAYI denetimi (holdout içeriği okunmaz).
- **U16:** `conversation-state.eval.test.ts:105` ad = gün + model → `.md` ve ücretli ham `.json` ezilir; `live-pipeline:534`,
  `qr-live-pipeline:443` etiketsizken aynı. Düzeltme: var olan "-2, -3" kalıbı (`conversation-items.eval.test.ts:346`).
- **U24:** `stay-change.json:160-166` d-q017 "Giriş 16:00 yazıyor, 15:00'te girebilir miyiz?" (mülk 15:00) `early`; `stay-change-dev2.json:448-454`
  e-q049 aynı durum `none`. 10-02 kuralı (standart = yalnız mülkün kendi saati) → d-q017 eski. Düzeltme: d-q017 → `none` + not; açık dev
  setleri arası etiket tutarlılık kontrolü.
- **U21:** `kb-retrieval-scale.test.ts:18/48/406/439` "200" diyor, gerçek tavan `KB_RETRIEVAL_FETCH_CAP = 400` (`limits.ts:68`), test kendisi
  havuzun 400'ün altında olduğunu doğruluyor; `:407/:443` "anlamsal canlıda değil" (09-26'dan beri yanlış). `kb-retrieval-baseline.test.ts:120`
  "kötü niyetli kalem legacy'de sızar, hibritte değil" diyor, test `:56-58` ikisinde de sızdığını doğruluyor. Düzeltme: metin sabitlerden ve
  hesaplanan değerlerden üretilir.
- **U22:** `live-pipeline.eval.test.ts:616`, `qr-live-pipeline.eval.test.ts:502` 320 karakter, işaretsiz. Tam metin yan dosyada var.
  Düzeltme: tam cevap ya da "[+N karakter kesildi]" + yan dosya yolu.
- **U25:** `package.json:6` `>=22.0.0 <23`; jsdom 29 / eslint-visitor-keys `^22.13.0`. CI ve imaj en son 22.x — yalnız yerel 22.0–22.12
  etkilenir. Düzeltme: `>=22.13.0 <23`.

## Ayrıntı — mesajlaşma / kuyruk / istemci (Y1–Y4, U27, U28, Y10)

- **Y1 (P1):** `outbox/worker.ts:297-299` talep gövdeyi belleğe alır, `:933` o kopyayı gönderir; gövde yeniden OKUNMAZ. Silme (`erasure.ts:573-580`)
  yalnız `claimedBy: null` satırları iptal eder; talep edilmiş satırın gövdesi `[erased]` olur ama işçi bellekteki eski metni gönderir
  (`:553-559` yorumu bunun tersini varsayıyor). Veto (`:402-521`) silmeye bakmaz. Pencere: bir partideki (≤20 sıralı gönderim) bekleyen her satır.
  Düzeltme: veto sonrası, göndermeden hemen önce `{id, claimedBy, status: sending, body ≠ [erased]}` koşullu okuma + talep yenileme; 0 satır →
  gövde `[erased]` ise `cancelRow(…, "erased")`, değilse talep kaybedilmiş (hiçbir şey). Gönderilen = az önce okunan gövde.
- **Y2 (P1):** `conversations-cleanup.ts:155-171` işlemsiz tek okuma; `:196/:200` kapsama + aynı konaklama bu anlık görüntüyle; `:204-207`
  tekrar konuşmanın TÜM mesajlarını siler (okumadan sonra gelenler dahil; `Message→Conversation` Cascade). Araya senkronun yeni mesajı girerse
  sessizce kaybolur, `needsReview: 0`. Düzeltme: tekrar başına etkileşimli işlem, iki konuşma satırı `FOR UPDATE` (mesaj eklemenin yabancı anahtar
  denetimi `FOR KEY SHARE` alır → sıralanır), işlem İÇİNDE yeniden oku + kapsama / aynı konaklama / çakışma yeniden; tutmuyorsa `needsReview++`.
- **Y3 (P2):** normal yol yanıt mesajının `createdAt`'ine (`worker.ts:365-381`), onarıcı `sentAt`'e (`:1097-1117`) çapalı; onarıcı her turda
  son 48 saatteki gönderilmiş satırlara koşar (`:1287`) → normal yolun doğru "açık kalsın" kararını AYNI turda geri alır (geri çekilmeden sonra
  yeniden denenen elle cevapta her seferinde). Düzeltme: onarıcı aynı çapa (yanıt mesajının `createdAt`'i; `messageId` yoksa `sentAt`).
- **Y4 (P2):** `decisions/store.ts:159-169` `createdAt <= row.createdAt` (milisaniye) — eşit damgada iki kart birbirini kapatabilir; kart
  oluşturma sırası talep sırası değil (yavaş tur eski talebin kartını yeni kartın ardından açıp onu kapatır). `:226-235` politika çözümü aynı türün
  bütün bekleyen kartlarını SIRASIZ kapatır (13:00 otomatik onayı, sonradan gelen 12:00 talebini de kapatır). Düzeltme: kaynak MESAJ sırasına
  göre — yalnız kaynak mesajı `(createdAt, id)` olarak kesin daha eski olan bekleyen kartlar kapanır; iki fonksiyonda da.
- **U27:** `guest-chat/guest-chat.tsx:166-169` başarısızlıkta `setInput(text)` (yeni taslağı ezer). Düzeltme: `setInput(cur => cur.trim() ? cur : text)`.
- **U28:** `:72-75` 404/410'da `setClosed(true)` sıra denetiminden (`:98`, yalnız başarı yolunda) ÖNCE; temizlik (`:128`) sorgulamayı kalıcı
  durdurur; hata sayacı da sırasız. Düzeltme: `fetch` döner dönmez her daldan önce `seq !== loadSeq.current` denetimi (catch dahil).
- **Y10:** `guest-chats/reply-box.tsx:52` `setText("")`; kardeş `inbox/conversation-thread.tsx:280` `setComposer("")` (yazma alanı gönderimde
  kilitlenmiyor, `:325`); "Onayla ve gönder" (`:1100`) başarıda ayrı yazılmış taslağı da siliyor (yarış değil, her seferinde). Düzeltme: yalnız
  gönderilen metin hâlâ alandaysa temizle.

## Ayrıntı — kimlik yarışları (U13, U40–U44, U29)

Ortak kök: `requireSession` oturum sürümünü (`sessionEpoch`) isteğin BAŞINDA bir kez denetler; son yazma ya da yeni çerez ya hiçbir şeye ya
da SONRADAN yeniden okunan sürüme güvenir. Çözüm ilkesi: son yazmanın WHERE'ine başlangıçta denetlenen sürüm; yeni çerez o sürümle imzalanır.
- **U13:** `api.ts:68-72` operatör sürümünü denetler; `admin.ts:108-132` çıkışta sürümü YENİDEN okur ve onunla imzalar (bürünme çerezindeki
  `actorSessionEpoch` ile kıyaslamaz) → arada iptal edilmiş operatör oturumu tam yetkili (`mfa` taşınır) çerez alır. `/api/admin/exit` hız
  sınırsız + çağrıldığı bürünme çerezini iptal etmez → çalınmış çerezle sürekli denenebilir. Düzeltme: `actorSessionEpoch` yoksa ya da
  veritabanı sürümü ≠ çerezdeki → çerezi temizle, false; aksi hâlde DENETLENEN sürümle imzala.
- **U43:** `account/password/route.ts:202-213` son yazma yalnız `{id, pwChangeCodeHash}`; sıfırlama (`password-reset-challenge.ts:246-264`)
  değişim kodunu temizlemez; `:237` eski oturumu yeni sürümle imzalar. İki bcrypt (her biri 8 sn'ye kadar kuyrukta) geniş pencere. Düzeltme:
  WHERE'e `sessionEpoch: session.sessionEpoch`; sıfırlama işleminde `pwChangeCode*` temizlenir; 0 satır → 401.
- **U40:** `account/2fa/route.ts:213-216` yalnız `{id, twoFactorEnabledAt: null, twoFactorSecret}`; `:238` yeni sürümle imzalar. Aynı sınıf:
  kapatma (`:318`), `regenerateRecoveryCodesIfUnchanged` (`recovery-codes.ts:79`). Düzeltme: WHERE'e başlangıç sürümü; sıfırlama tamamlanmamış
  kurulumun sırrını temizler.
- **U41:** `account/delete/route.ts:43-47` bcrypt, `:83` `deleteAccountData`; işlem (`data-retention.ts:793-824`) kullanıcı / rol / sürümü yeniden
  denetlemez. Düzeltme: işlemin İLK adımı `SELECT … "User" WHERE id, organizationId, role='owner', sessionEpoch=$E FOR UPDATE`; yoksa iptal.
- **U44:** `unverified-sweep.ts:116-135` aday seçimi kilitsiz, denetimler işlem dışında, `:282` yeniden denetimsiz siler. Düzeltme: silme
  işleminde org + kullanıcı `FOR UPDATE` + aday koşullarını yeniden uygula; değiştiyse `state_changed` ile atla.
- **U42:** abonelik denetimi (`delete/route.ts:71,103-124`) işlem dışı; webhook org denetimi (`paddle/route.ts:167`) kilitsiz. (A) silme aktif
  aboneliği kademeli siler, Paddle faturalamaya devam eder; (B) silinmiş org'a gelen ödeme "bayat" sayılıp alarmsız düşer. Düzeltme: silme işleminde
  org `FOR UPDATE` + faturalı abonelik yeniden denetimi (409); webhook yazması org `FOR SHARE` ile, org yoksa "bağlanamayan ödeme" alarmı.
- **U29:** `auth/index.ts:132-151` arızada rolü yalnız bellekte personele indirir; `inbox/page.tsx:43,65` rol denetlemeden okur; ara katman
  çerezdeki rolü okur. Bugün rol değiştiren yol YOK → gerçekçi durum: kısmi veritabanı arızasında iptal edilmiş oturum, salt-okuma. Düzeltme
  (kişi kişi çıkış yok): yönetici olmayan arıza dalında sayfa hata ekranına düşer — F06 "normal oturum fail-open" kuralını değiştirir → kurucu.

## Ayrıntı — misafire giden / tehlike / görev / para (U3, U17, Y5, U26, U39)

- **U3:** `hazard-evidence.ts:425` `MENTION_CAP = 32`, `:438` sessiz `break` → "no fire "×31 + gerçek yangın = `clear`, ×32 = `mentioned`
  (Türkçe aynı; noktalama yoksa, ~256 karakter). Ekipman istisnası `:252-260` (stove / cooker / hob / ocak / Herd, ±3 sözcük) → "the stove caught
  fire", "mutfaktaki ocak alev aldı", "Herd brennt" = `mentioned` (perde = `clear`). Olumsuzluk penceresi `:451` "and"i aşar → "we have no power
  and smoke is coming out of the socket" = `mentioned`. Etki: QR güvenlik satırı gitmez (`chat/[token]/route.ts:640`), `:779` anılışta acil etiketi
  kalkar. Düzeltme: tavan seviyeyi asla DÜŞÜRMEZ; olumsuzluk "ve / and / und / et / y / и / و" sınırında biter; ekipman yalnız tehlike sözcüğü
  ADI nitelediğinde (yangın tüpü, fire extinguisher, gaz ocağı), ekipman bir yangın fiilinin ÖZNESİYKEN değil.
- **U17:** `availability-claims.ts:922-935` atama sözcüğü (`KB_ASSIGNMENT :870`, olumsuzluk / sahip / kip denetimi YOK) çevresinde 120 karakter
  pencere + otopark adı; `spanGrounded :938` yalnız numara. "size ayrılmış değildir", "komşu daireye ayrılmıştır", "4 numaralı daireye…", "5 numaralı
  yer dairenize… 2 numaralı yer komşunundur", "…tahsis edilebilir" → hepsi GİDER. Düzeltme: aynı numara + 2. şahıs sahip + aynı cümlecikte olumsuzluk
  / kip yok.
- **Y5:** `tasks/detect.ts:139` konu = ilk eşleşen arıza sözcüğü; `:197` anahtar; `create.ts:49` açık görev varken aynı anahtarı düşürür. "Klima
  bozuk" ↔ "Musluk bozuk", "TV not working" ↔ "Fridge not working", gaz ↔ yangın aynı gün, tüm olanak şikâyetleri tek anahtar. Düzeltme: konu =
  cihaz / eşya adı (`BREAKDOWN_DEVICES`), bulunamazsa kaynak mesaj kimliği.
- **U26:** bildirilen senaryo 403 döner (yanıltıcı ileti). Gerçek kayıplar: yönetici PATCH'i istemcinin bayat dizisini yazar (`tasks/[id]/route.ts:76`,
  `task-board.tsx:150-157`); personel işaretleri SIRAYA göre eşlenir (`:82`); `:32` okuma işlem dışında. Düzeltme: tek madde değişimi (indeks +
  beklenen etiket) işlem içinde kilitli satıra; uyuşmazsa 409.
- **U39:** `paddle/route.ts:421` `parseInt` ("100abc"→100, "1e3"→1, "-500"), `:446` eksik → 0; `:414-415` fatura varsa sonraki doğru olay
  düzeltemez. `amountMinor` yalnız dışa aktarımda. Düzeltme: yalnız `/^\d+$/`; geçersiz → satır yazılmaz + alarm (eksik para birimi emsali).

## Ayrıntı — veri / takvim / rapor (U30–U38, Y6–Y9)

- **U30:** `import/csv.ts:177` `[-\u2212\u2013]`, `:192` parantez yalnız hücrenin tamamını sararsa → "USD (100.00)", "₺(1.500,50)", "－100" pozitif.
  Düzeltme: ilk rakamdan önce "(" + son rakamdan sonra ")" ; `\p{Pd}` / U+2212 eksi (NFKC). Mevcut K1 satır hatası.
- **U31:** `csv.ts:158` rakam / nokta / virgül dışını siler ("100+50"→10050, "1e3"→13, "12abc34"→1234); rota `:640-643` 100M'a sessizce kırpar (elle
  yol reddeder, `validators.ts:119`). Düzeltme: ilk ve son rakam arası yalnız rakam / . / , / boşluk / '; değilse ya da >100M → `invalid_amount`.
- **U32:** `csv.ts:96` `new Date(y, m-1, d, 12)` sunucu yerel saati. Düzeltme: `Date.UTC(…, 12)` + UTC alıcıları (`ics.ts:50-58` gibi). Bugün UTC'de çıktı birebir.
- **U33:** `import/ics.ts:96-99` ofsetsiz ISO saati `new Date()` sunucu yereliyle okur, TZID'yi görmez. Düzeltme: temel biçimle aynı dal (`zonedWallClockToUtc`).
- **U36/Y11:** `export/ics.ts:43-55` 75/74 UTF-16 birimi; emoji yarıdan bölünür, 70 Çince karakter 209 bayt. Düzeltme: kod noktası başına UTF-8 bayt.
- **U37:** `import/sync.ts:268` gövdede herhangi bir yerde `/BEGIN:VCALENDAR/i` yeter → JSON / HTML hata gövdesi 0 etkinlik, `ok`, müsaitlik "boş".
  Düzeltme: ilk boş olmayan satır tam `BEGIN:VCALENDAR` + tam `END:VCALENDAR`; değilse `feed_not_icalendar`.
- **U35:** `net/private-host.ts:53` IPv6 önek testleri her ada uygulanır. Düzeltme: yalnız `net.isIP(h) === 6`.
- **U38:** `calendar-sources/route.ts:51-65` say → oluştur, kilitsiz. Düzeltme: mülk satırı `FOR UPDATE` ile tek işlem.
- **U34:** `timezone.ts:153-165` yerel gece yarısı yoksa günün başlangıcı bir saat erken (yorum biliyor); `day-where.ts` bunu kullanır. Düzeltme:
  hesaplanan başlangıç önceki yerel güne düşerse günün ilk anına ilerle.
- **Y6:** `channels/ingest.ts:165-170` `canonicalDate` çıplak `new Date(s)` ("2026-02-30"→2 Mart, "1"→2001); `write-service.ts:84` sıra denetimi
  yok. Düzeltme: katı ISO + takvim geçerliliği; çıkış ≤ giriş → satır yazılmaz (var olan tarihler korunur).
- **Y7:** `reports.ts:224-234` ham pencere (New York 1 Ekim düşer, 1 Kasım girer). Düzeltme: `reservationDayRangeWhere` (`calendarDateOf`).
- **Y8:** `reports.ts:177-188, 256-262`, `dashboard/page.tsx:94-105` org çapında `sourceReference` tekilleştirmesi; şema zaten
  `@@unique([propertyId, sourceReference])` → tekilleştirme YALNIZ farklı mülkleri birleştirir. Düzeltme: anahtar `propertyId|ref`.
- **Y9:** `health/route.ts:56-98` + `health-probe.ts:23` 3 sn önbellek, süren yoklama paylaşılmaz. Düzeltme: önbellek penceresi başına tek söz (promise), hata önbelleğe alınmaz.
