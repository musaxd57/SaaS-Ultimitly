# TASARIM — Acil durdurmanın kapsamı görünür olsun (25 Kasım)

> Kaynak: `docs/KURUCU-TALIMATI-2026-11-25-codex-raporu-ve-opus-dalgasi.md` (Codex: "Bugünkü kuyruk duraklatması doğrudan gönderimi
> durdurmuyor; QR'ın ayrı anahtarı var. Operatör hangi yolun durduğunu tek yerde görsün. Başlamış gönderimi «iptal edildi» diye göstermesin.").
> Bu belge önce salt okunur bir GÖRÜNÜM önerir (davranış değişmez); eksik fren önerileri ayrı sorudur. Kod YOK. Yazan: Opus (OB), taban `07f679c5`.

## 1. Kısa sonuç

- Codex'in üç iddiası **doğru** (§2, iki sonda + kod).
  1. `OUTBOX_DELIVERY_PAUSED` yalnız kuyruğu durdurur: kuyruk kapalı işletmenin otomatik cevabı sağlayıcıya GİDER (sonda).
  2. QR'ı durduran tek şey `GUEST_CHAT_ENABLED` (ve daire düzeyi `chatEnabled`); genel otomatik mesaj anahtarı `AUTO_REPLY_ENABLED` kapalıyken ve
     kuyruk duraklatılmışken QR cevap verir (sonda: var olan QR testi bu ortamda yeşil, cevapta şifre var).
  3. Tek bir yerde "şu an hangi yol durdu" yok. **Ama hiç yok değil:** operatör panelindeki "Operasyon Teşhisi" kartı iki kuyruk anahtarını ve
     duraklatmanın doğrudan gönderimi etkilemediğini zaten yazıyor (`src/app/(app)/admin/page.tsx:704-720`). Eksik olan, öteki anahtarların (genel
     otomatik mesaj, QR, ev sahibi kanalı, e-posta) aynı yerde ve yol bazında görünmesi.
- "Başlamış gönderim iptal edildi" — kuyrukta bugün **olamaz**: iptal ile gönderim başlangıcı aynı satırda atomik karar verir (migration 98,
  `src/lib/outbox/dispatch.ts:6-17`). Duraklatma da başlamış (`sending`) satırı bitirir, sonucu yazar (`outbox/flag.ts:28-36`). Görünümde doğru söz
  depodaki teslim sonucu sözlüğünden gelir (`src/lib/delivery-outcome.ts`). Bir etiket sorusu var (§2.4).
- Öneri: (1) operatör paneline salt okunur **"Durdurma kapsamı"** tablosu — anahtar × yol, her hücre "durur / durmaz / yalnız yeni iş", veri
  sunucuda env + kod sabitlerinden; (2) duraklatma sırasında uçuştaki iş sayıları sözlükle uyumlu cümlelerle; (3) eksik frenler ayrı sorular
  (QR'ın genel anahtara bağlanması; tüm misafir gönderimlerini durduran tek şalter).

## 2. Envanter

### 2.1 Anahtarlar

| Anahtar | Tür / nasıl değişir | Kaynak |
|---|---|---|
| `OUTBOX_DELIVERY_PAUSED` | env, yalnız "1"; değiştirmek yeniden başlatma ister | `src/lib/outbox/flag.ts:37-39` |
| `DURABLE_OUTBOX_ENABLED` + `DURABLE_OUTBOX_ORG_IDS` | env; yalnız YENİ gönderimin yolunu seçer (durdurma değil) | `flag.ts:7-25` |
| `AUTO_REPLY_ENABLED` | env, yalnız "1"; "genel otomatik mesaj" ana şalteri | `automation.ts:4265-4271`, `:5351`, `:6150`, `:6376`, `:6634`, `:6973`, `worker.ts:788-791` |
| `GUEST_CHAT_ENABLED` | env, yalnız "1"; QR rotası 404 | `src/app/api/chat/[token]/route.ts:514`, `:689` |
| `Property.chatEnabled` | daire ayarı | `src/lib/guest-chat.ts:1560` |
| `Organization.autoReplyHospitable` + çalışma saatleri | işletme ayarı (panel) | `automation.ts:2233-2238`; kuyrukta gönderim anında `worker.ts:803` |
| `autoWelcome / autoCheckin / autoCheckout`, `autoClosingReplyEnabled` | işletme ayarı | `prisma/schema.prisma:134-140`; `automation.ts:1217` |
| Konuşma "Sorunlu" / AI durdurma (`autoReplyHoldUntil`) | konuşma | `automation.ts:2210`; `worker.ts:599-600` |
| Lixus aboneliği kapalı | ödeme durumu | kuyrukta `billing-hold.ts` (`worker.ts:961-964`); satır içi yolda nerede okunduğunu izlemedim — emin değilim |
| Kanal aboneliği (Hospitable 402) | sağlayıcı cevabı | kuyrukta `blocked` + `channel_paused`; satır içi yolda geri çekilme (`automation.ts:4687`) |
| `KB_RETRIEVAL_MODE` | env | **gönderim durdurmaz**; yalnız bilgi seçimini eski yönteme döndürür (`src/lib/ai/retrieval/flag.ts:6`, `:53`) |
| `HOST_CHANNEL_ENABLED`, `TEAM_CONTACTS_ENABLED`, `EMAIL_OUTBOX_ENABLED` | env; ev sahibi kanalı / ekip / e-posta kuyruğu | `src/lib/host-channel/routing.ts`, `src/lib/team-contacts/flag.ts:6`, `src/lib/outbox/health.ts:225` |

### 2.2 Yol × anahtar (✓ durdurur · ✗ durdurmaz · — ilgisiz)

Kanıt: **S** = sonda (bu tur, `lixus_o3`), **K** = kod okuması.

| Gönderim yolu | Kuyruk duraklat | `AUTO_REPLY_ENABLED` kapalı | `GUEST_CHAT_ENABLED` kapalı | İşletme otomatik cevap kapalı | Başlamış gönderime ne olur |
|---|---|---|---|---|---|
| Kanal otomatik cevap, kuyruk kapalı işletme (satır içi; üretim varsayılanı) | **✗ (S)** — sağlayıcı çağrıldı | ✓ (S) `globally_disabled`; zamanlanmış taramada model de çağrılmaz (K, `automation.ts:5351`) | — | ✓ tur başında (K); model düşünürken kapatılırsa **yine gider (S**, bkz. gönderim öncesi belge §2.2) | Satır içi istek bitmeden durdurulamaz; belirsizse "doğrulanamadı" (`automation.ts:4712-…`) |
| Kanal otomatik cevap, kuyruk açık işletme | ✓ (S) — satır `pending` kalır, sağlayıcı çağrısı 0 | ✓ (K) gönderim anında iptal `auto_reply_disabled` (`worker.ts:952`) | — | ✓ (K) gönderim anında iptal (`worker.ts:803`) | `sending` biter, sonucu yazılır; belirsiz → uzlaştırma, yeniden gönderilmez (`flag.ts:31-32`) |
| QR sohbet | **✗ (S)** | **✗ (S)** | ✓ (K) 404 | ✗ (K; QR kendi ayarına bakar: daire `chatEnabled`) | Cevap HTTP yanıtında gider; kayıt işlemi geri alınırsa cevap da gitmez (Ö-1 deseni) |
| Otomatik karşılama / giriş / çıkış, doğrudan | ✗ (K) | ✓ (K) `:6150`, `:6376`, `:6973` | — | ✓ türün kendi anahtarı (K) | Talep + damga; belirsiz → damga kalır, yeniden gönderilmez |
| Otomatik mesaj, kuyruk | ✓ (K) | ✓ (K) talep edilmez, bekler (iptal değil; `worker.ts:368-372`) | — | ✓ (K) gönderim anında iptal (`orgSwitchCancelReason`) | Aynı |
| Elle giriş mesajı ("Şimdi gönder") | ✓ yalnız kuyruk açık işletmede (K, `automation.ts:6724`) | ✓ (K) `paused` (`:6634`) | — | — | — |
| Karar mesajı (`HOST_DECISIONS_ENABLED` kapalı) | ✓ yalnız kuyruk açık işletmede (K, `host-send.ts:132`) | ✗ (insan kararı) | — | ✗ | — |
| Ev sahibinin elle cevabı | ✓ yalnız kuyruk açık işletmede (kuyruğa yazılır, işçi beklet) (K, `host-send.ts:142`) | ✗ (bilinçli: insan yazdı) | — | ✗ | Kuyruktaysa yukarıdaki gibi |
| Ev sahibi kanalı (WhatsApp bildirimleri / sorular) | ✗ (K) | ✗ (K) | — | ✗ | `HOST_CHANNEL_ENABLED` kendi şalteri |
| Ekip bildirimleri | ✗ (K) | ✗ (K) | — | ✗ | `TEAM_CONTACTS_ENABLED` |
| E-postalar (kimlik, uyarı) | ✗ (K, `flag.ts:33-34` açıkça yazıyor) | ✗ | — | ✗ | Kendi kuyruğu |

Sonda ayrıntısı (commit edilmedi; scratchpad `ob-probe/zz-probe-ob-t3.test.ts`):
- kuyruk kapalı + `OUTBOX_DELIVERY_PAUSED=1` → `sent=true queued=false providerCalls=1`;
- kuyruk açık (`*`) + duraklatma → `sent=true queued=true providerCalls=0`, kuyrukta tek `pending` satır;
- `AUTO_REPLY_ENABLED` boş, `applyChannelAutoReply` doğrudan çağrılınca → `sent=false skip=globally_disabled`, model 1 kez çağrıldı (zamanlanmış
  tarama bu çağrıya hiç girmez — `:5351`; yani bu bir maliyet hatası DEĞİL, yalnız doğrudan çağrı yolunda);
- `tests/integration/qr-cancelled-mid-turn.test.ts` `AUTO_REPLY_ENABLED=0 OUTBOX_DELIVERY_PAUSED=1` ortamında koşuldu → 2 / 2 yeşil, "KONTROL" testi
  cevapta `deniz2024` buldu (QR durmadı).

### 2.3 Bugün ekranda ne yazıyor — TEYİTLİ (kod)

- Operatör paneli "Operasyon Teşhisi": iki kuyruk anahtarı ayrı satırda; duraklatma satırı "DURAKLATILDI / akıyor" + "Gönderimi başlamış mesaj geri
  alınamaz; sonucu belirsiz mesaj yeniden gönderilmez, incelemeye alınır. Kuyruk kapalı işletmelerin anında gönderimleri ve kimlik e-postaları bu
  anahtardan etkilenmez." (`admin/page.tsx:704-720`). `AUTO_REPLY_ENABLED` yalnız kuyruk sağlığı açıklamasında geçiyor (`:701`), durumu
  gösterilmiyor. `GUEST_CHAT_ENABLED`, ev sahibi kanalı, e-posta kuyruğu anahtarları bu kartta yok.
- Gelen kutusu: iptal edilen kuyruk satırının sebebi `skippedReason` etiketleriyle (`src/lib/inbox-skip-labels.ts:42-46`: otomatik yanıt kapalı,
  abonelik, kanal kapalı).
- `globally_disabled` için etiket yok (`inbox-skip-labels.ts`te geçmiyor); zamanlanmış tarama bu sonucu damgalamıyor (`automation.ts:5474`) — ev sahibi
  konuşmada açıklama görmez. Bu bilinçli olabilir (genel şalter operatörün aracıdır); emin değilim.

### 2.4 "Başlamış gönderim" ve sözlük — TEYİTLİ (kod) + bir soru

- `requestOutboxCancel` (`dispatch.ts:96-115`) üç sayı döner: `canceled` (hemen iptal), `requested` (işçide, gönderim başlamadan iptal olacak),
  `dispatching` (isteği sağlayıcıya çıkmış — iptal EDİLEMEZ). Yorum: "Çağıran `dispatching > 0` ise bunu «iptal edildi» diye sunamaz."
- Teslim sonucu sözlüğü: `queued · channel_accepted · unverified · not_delivered · local_only · qr_visible` (`delivery-outcome.ts:11-23`);
  `sending` → `queued` (`outbox/state.ts:80-87`).
- Soru (hata olduğundan emin değilim): konuşma balonunda `canceled` etiketi her zaman "İptal edildi — yerine yeni bir gönderim oluşturuldu"
  (`src/components/inbox/conversation-thread.tsx:84`). Kuyruk satırı yeniden gönderim dışında da iptal olur (genel şalter, rezervasyon iptali, işletme
  anahtarı). Bu satırların balonu ekranda bu etiketle görünüyor mu, yoksa başka bir yerde süzülüyor mu — izlemedim. Görünüyorsa "yerine yeni bir
  gönderim oluşturuldu" yanlış bilgi olur. Ayrı küçük iş olarak doğrulanmalı.

## 3. Tasarım

### 3.1 Salt okunur "Durdurma kapsamı" (operatör paneli)

- Yer: var olan "Operasyon Teşhisi" kartı (`admin/page.tsx`), iki kuyruk satırının hemen üstünde yeni tablo. Ayrı sayfa değil (operatör zaten
  oraya bakıyor).
- Veri: sunucuda, istek anında; yalnız env + kod sabitleri (veritabanı yok, sır yok). Tek kaynak: yeni yaprak modül `lib/stop-scope.ts` — anahtar
  okuyucularını (`outboxDeliveryPaused`, `autoReplySwitchOn`, …) çağırır, satır / sütun tablosunu SABİT bir matristen kurar. Matris kodun yanında
  durur ve bir pin testi her hücreyi davranışsal testle eşler (yol × anahtar; bu belgedeki sondalar test olur). Böylece tablo yalan söyleyemez:
  biri bir yolu değiştirip matrisi güncellemezse test kırmızı.
- Görünüm (öneri metni, sade):

  | Gönderim | Şu an |
  |---|---|
  | Kanal otomatik cevapları | Gidiyor · (genel otomatik mesaj kapalıysa: "Durdu") |
  | Kuyruktaki mesajlar | "Duraklatıldı — 12 mesaj bekliyor, 1 mesajın gönderimi başlamıştı (sonucu bekleniyor)" |
  | Kuyruk kullanmayan işletmelerin anında gönderimleri | "Gidiyor — kuyruk duraklatması bunları durdurmaz" |
  | QR sohbet | Gidiyor · ("Kapalı — QR sayfaları açılmıyor") |
  | Otomatik karşılama / giriş / çıkış | … |
  | Ev sahibi kanalı · ekip · e-posta | … |

- İşletme düzeyi anahtarlar (otomatik cevap, karşılama …) burada SAYI olarak: "Otomatik cevabı kapalı işletme: 2 / 9" (müşteri listesine bağlantı).
  Tek tek işletme adı yok.

### 3.2 Uçuştaki iş için doğru söz

Duraklatma ya da iptal sonrası cümleler yalnız şu üç sayıdan kurulur (`requestOutboxCancel` / kuyruk durum sayımı) — "iptal edildi" yalnız
gerçekten iptal edilenler için:
- "N mesaj durduruldu (gönderilmedi)." → `not_delivered`
- "M mesaj gönderilmeden önce durdurulacak." → henüz `queued`
- "K mesajın gönderimi başlamıştı; durdurulamaz, sonucu bekleniyor." → `queued` (uçuşta), sonra `channel_accepted` ya da `unverified`
Satır içi yolda "iptal" kavramı yok; metin "Bu anahtar anında gönderimleri durdurmaz" der.

### 3.3 Eksik frenler (her biri ayrı soru — davranış değişikliği)

- F1: **QR genel otomatik mesaj şalterine de bağlansın mı?** Bugün `AUTO_REPLY_ENABLED` kapalıyken QR AI cevap verir. Bağlanırsa QR sayfası açık kalır,
  misafirin mesajı ev sahibine iletilir, AI cevabı gitmez; misafirin gördüğü şey QR'ın bugünkü devir yolundakiyle aynı olur (yeni metin yazılmaz — K10 "devir cümlesi misafire gitmez" kararı geçerli).
- F2: **Tüm misafir gönderimlerini durduran tek şalter** (`flag.ts:34`: "tüm gönderimleri durduran tek şalter ayrı bir karar" — depoda açık
  bırakılmış). Öneri: yeni bir anahtar değil, var olanların birleşimi: "Acil durdur" = `AUTO_REPLY_ENABLED` kapalı + kuyruk duraklat + QR AI kapalı;
  elle cevap ve e-posta kapsam dışı (insan yazar / kimlik akışı). Env değişimi yeniden başlatma ister — veritabanı tabanlı (anında) bir şalter ayrı
  karar ve migration (S3).
- F3: Model düşünürken işletme anahtarı / AI durdurma değişirse cevap gidiyor (gönderim öncesi belge §2.2) — oradaki S1 ile birlikte.

## 4. Kurucuya sorular (önce / sonra örnekli)

**S1 — Operatör panelinde salt okunur "Durdurma kapsamı" tablosu olsun mu?** (davranış değişmez, yalnız görünüm)
- Önce: kuyruğu duraklattınız; panel "Bekleyen gönderimler: DURAKLATILDI" diyor, kuyruk kullanmayan işletmelerin otomatik cevapları gitmeye devam
  ediyor; bunu ancak açıklama satırını okursanız anlıyorsunuz. QR'ın durumu hiç görünmüyor.
- Sonra: tabloda "Kuyruktaki mesajlar: Duraklatıldı — 12 bekliyor · Anında gönderimler: Gidiyor (bu anahtar durdurmaz) · QR sohbet: Gidiyor".
Böyle yapalım mı?

**S2 — Genel otomatik mesaj şalteri kapalıyken QR'daki AI da sussun mu?** (F1)
- Önce: `AUTO_REPLY_ENABLED` kapalı; misafir QR'dan "Wi-Fi şifresi ne?" yazar → AI "Wi-Fi ağımız LaleNet, şifresi deniz2024." cevabını verir.
- Sonra: aynı mesaj → AI cevabı gitmez; misafir, bugün AI'yı ev sahibine devredilmiş bir QR sohbetinde ne görüyorsa onu görür (yeni metin yok), mesaj size iletilir.
Böyle yapalım mı?

**S3 — "Acil durdur" tek düğme olsun mu, nerede?** (F2)
- Seçenek A (migration yok): env'leri birlikte değiştiren bir yönerge + panelde birleşik durum ("Acil durdurma: kısmen açık — QR hâlâ cevap veriyor").
  Değiştirmek yeniden başlatma ister (1–2 dk).
- Seçenek B (migration): panelde düğme, veritabanında tek satır; anında etkili, her gönderim yolu gönderimden hemen önce okur.
Önerim: önce A (görünüm), gerçek bir olay yaşanırsa B.

**S4 — Konuşma balonundaki "İptal edildi — yerine yeni bir gönderim oluşturuldu" etiketi.** Önce doğrulayıp (§2.4), yanlış yerde görünüyorsa
sebebe göre metin önereceğim (ör. "Gönderilmedi — otomatik yanıt kapalıydı"). İnceleyeyim mi?

## 5. Dilim sırası

1. `lib/stop-scope.ts` saf matris + davranışsal pin testleri (bu belgedeki iki sonda + kod okumasıyla işaretlenen hücreler teste dönüşür; "K" olan her
   hücre önce testle teyit edilir).
2. Panel tablosu (salt okunur) + uçuştaki iş sayıları (§3.2 metinleri, kurucu onaylı).
3. §2.4 etiket doğrulaması (küçük iş).
4. (Onaylanırsa) F1 QR bağı — anahtar arkasında.
5. (Onaylanırsa) F2 Seçenek B — migration turu.

## 6. Riskler / emin olunmayanlar

- R1: Matristeki "K" hücreleri kod okumasıdır; tabloyu canlıya koymadan önce her biri testle teyit edilmeli (dilim 1).
- R2: Lixus aboneliği kapalı işletmede satır içi otomatik cevabın nerede durduğunu izlemedim (kuyrukta `billing-hold.ts`) — emin değilim.
- R3: QR'ın abonelik / plan durumuna tepkisi (`limitsForOrg`, `route.ts:81`) izlenmedi — emin değilim.
- R4: Env tabanlı şalterler yeniden başlatma ister; "anında acil durdurma" bugün yok. Tablo bunu açıkça söylemeli ("değişiklik yeniden başlatmadan sonra
  geçerli").
- R5: `globally_disabled` sonucunun konuşmada iz bırakmaması bilinçli olabilir; değiştirmeyi önermiyorum, yalnız not.
