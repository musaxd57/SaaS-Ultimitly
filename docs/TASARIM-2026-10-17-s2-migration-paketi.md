# Faz 2 ek paketleri — I1 · L5 · K1 · L2/L3 uygulama tasarımı (10-17, salt okuma)

> Çalışma ağacı `/home/user/SaaS-Ultimitly`, HEAD `b92e8154`. KOD YAZILMADI, test / prisma KOŞULMADI. Satır numaraları bu HEAD'e göre.
> Kurucu kararları: `docs/arastirma-2026-10-15/KURUCU-SORULARI.md:676-695` (§O). Önceki paketler (69–75) ve ortak envanter E1–E10:
> `docs/TASARIM-2026-10-16-faz2-migration-paketleri.md:14-37` — burada TEKRAR EDİLMEZ, yalnız "E3", "E5" diye anılır.
> Numara kuralı (`docs/MIGRATION-MANIFEST.md:3-4`): numara yalnız klasör oluşunca kesinleşir; aşağıdaki 76–79 yalnız ÖNERİ (69–75 hazır yamadan sonra).
> ⚠️ GERÇEKLEŞEN (10-17 öğleden sonra): I3 → `69_outbox_conversation_status_index`, L2 → `70_kb_superseded_at`. Aşağıdaki "76–79" ve
> "M-kb-surum (70)" göndermeleri eski öneri numaralarıdır; güncel tablo `docs/MIGRATION-MANIFEST.md`. L5 → `71_message_channel_sender_role`
> (§2.5'ten bilinçli fark: okuyucular YALNIZ `automation`ı dışlar, `unknown` bugünkü gibi ev sahibi sayılır — gerekçe `message-author.ts` L5 notu).
> Dil kuralı (Codex C6): yeni kolon / tablo için "kişisel veri yok" DENMEZ; "doğrudan tanımlayıcı / serbest metin taşımaz" denir.
> DOĞRULANMADI işareti: kodda / belgede kanıtlanamayan her iddia.

---

## 1. I1 — `GuestCommitment.topic` (söze kısa KONU)

### 1.1 Sorun (kodda doğrulandı)
- Öneri onayı `createGuestCommitment(..., { mergeSameSlot: true })` çağırır (`src/lib/ai-suggestions/act.ts:126-141`). Birleştirme ölçütü
  "aynı konuşma + aynı tür + aynı an + açık + görevli" (`src/lib/guest-commitments.ts:111-126`) — cihaz / konu YOK.
- Öneri listesi aynı ölçütle iki yerde gizler: tür + mesajdan sonra oluşmuş söz (`src/lib/ai-suggestions/load.ts:215`) ve tür + an + açık
  (`load.ts:220`). Sorgu konuyu okumaz (`load.ts:160-163`).
- Tür kapalı kümesi 4 değer (`src/lib/guest-commitments-core.ts:8`); klima da musluk da `maintenance` (`src/lib/ai-suggestions/core.ts:76-83`).
  → "klima 18:00" + "musluk 18:00" önerileri TEK söz / TEK görev; ikinci onay `reused` → `gone` (`act.ts:145`), ikinci öneri listeden kaybolur.
- Elle form (`src/app/api/conversations/[id]/commitments/route.ts:54-63`) `mergeSameSlot` göndermez → her tıklama ayrı söz (kurucu D3) — doğru.

### 1.2 Şema farkı (Prisma)
```prisma
model GuestCommitment {
  // … mevcut alanlar …
  /// Sözün KONUSU (I1, kurucu 10-17 "A"): kapalı küme kısa kod (`guest-commitments-core.ts` COMMITMENT_TOPICS — ör. ac · faucet · toilet ·
  /// shampoo). YALNIZ öneri yolu yazar (ev sahibinin mesajından, kodla); elle form NULL. NULL = "konu bilinmiyor" (elle söz, konusuz öneri,
  /// bu kolondan önceki satır). Serbest metin / misafir metni TAŞIMAZ.
  topic String?
}
```
```sql
-- 76_i1_commitment_topic (dolu tabloya boş kolon — güvenli; tablo yeniden yazılmaz)
ALTER TABLE "GuestCommitment" ADD COLUMN "topic" TEXT;
```
Dizin GEREKMEZ: arama konuşma başına (`@@index([conversationId])`, `schema.prisma:1695`), satır sayısı konuşma başına tek haneli.
Geriye doldurma YOK (eski satırların konusu bilinmiyor → NULL; birleştirme kuralı NULL'u ↓1.4'teki gibi ele alır).

### 1.3 Konu nereden gelir (tek saf kaynak)
- YENİ saf fonksiyon `commitmentTopicOf(kind, scopeText)` — `src/lib/guest-commitments-core.ts` (yaprak; DB yok, istemci de okur).
  Girdi: `detectHostPromise`'ın ZATEN hesapladığı söz parçası (`core.ts:229-251`: `withTopic` parçası, yoksa `scope`). `HostPromise`
  arayüzüne (`core.ts:95-105`) `topic: string | null` eklenir; `detectHostPromise` dönüşüne (`core.ts:264`) yazılır.
- Kural (ilk eşleşen kazanır, ikisi de mevcut kod):
  1. `maintenance`: `firstBreakdownDevice(scope)` (`src/lib/ai/fallback.ts:1424-1438`; envanter `:967+`, çekim → kök: "klimayı" → klima,
     "musluğu" → musluk) → `DEVICE_STEM_TO_TOPIC` haritası (klima→ac, kombi/petek/kalorifer/radyatör→heating, şofben/termosifon/boyler→hot_water,
     musluk/lavabo/sifon→faucet, tuvalet/klozet/rezervuar→toilet, duş/duşakabin→shower, buzdolabı→fridge, bulaşık→dishwasher, çamaşır→laundry,
     ocak/fırın→stove, mikrodalga→microwave, televizyon/tv/kumanda→tv, modem/router→wifi, kapı/kilit/anahtar→door, lamba/ışık/avize→light,
     pencere/perde/jaluzi/panjur→window, priz→socket, asansör→elevator, su→water). Haritada olmayan kök (makine, cihaz, motor…) → adım 2.
  2. Kök yoksa ya da haritada değilse (İngilizce ev sahibi): `deviceTopicsOf(topicsOf(scope))` (`src/lib/conversation-items/relation.ts:58-60,
     1147-1149`, getirme kavram kimlikleri ac · heating · hot_water · tv · fridge …) — TAM BİR kavram varsa o; "tap/faucet/sink/plumber" için
     kavram yok → haritaya küçük İngilizce ek (`tap|faucet|sink`→faucet, `toilet|flush`→toilet, `shower`→shower).
  3. `supplies`: `KIND_TOPICS` supplies kalıbının (`core.ts:86-91`) eşleşen alternatifi → kısa kod (tuvalet kağıdı/toilet paper→toilet_paper,
     şampuan→shampoo, sabun→soap, kahve→coffee, çay→tea, şeker→sugar, pil→battery, ampul→bulb, çöp poşeti→trash_bags, damacana/içme suyu→water).
  4. `towels` / `cleaning` → NULL (bilinçli: aynı saatte havlu + çarşaf tek teslimattır; tek temizlik ziyareti).
  5. Parçada İKİ farklı konu ("Klima ve musluk için usta 18:00'de gelecek") → NULL (tek ziyaret; ↓1.4 NULL kuralı mevcut sözlerle birleştirir).
- Neden bu sözlük: görev tekilleştirmesi ZATEN aynı cihaz okuyucusunu kullanıyor (`src/lib/tasks/detect.ts:348-355`, `cihaz:<kök>` anahtarı,
  kurucu 10-15 "Klima bozuk ile Musluk bozuk birleşmemeli") → söz ile görev aynı cihaz kavramını konuşur. Kod İngilizce kısa ASCII (ekranda
  `COMMITMENT_TOPIC_LABELS`: ac → "klima", faucet → "musluk"); Türkçe kök yerine kod: İngilizce mesajdan gelen "AC" ile Türkçe "klima" aynı
  konuya düşsün.
- Karesel iş: yeni düzenli ifade YOK (harita sözlük araması + mevcut okuyucular; ikisi de doğrusal, `fallback.ts` / `relation.ts` süre pinleri var).

### 1.4 Birleştirme kuralı (NULL dahil) — tek saf yüklem
YENİ `commitmentSlotMatches(existing, incoming)` (`guest-commitments-core.ts`): tür eşit ∧ an eşit ∧ (existing açık + görevli — bugünkü koşul)
∧ konu UYUMLU:

| Mevcut söz konusu | Gelen öneri konusu | Sonuç | Gerekçe |
|---|---|---|---|
| ac | ac | BİRLEŞ | aynı söz iki mesajda (bugünkü amaç) |
| ac | faucet | AYRI söz + görev | I1'in kendisi |
| NULL (elle form / eski) | ac | BİRLEŞ + mevcut söze `topic = ac` YAZILIR ("sahiplenme") | ev sahibi aynı sözü elle kaydettiyse ikinci görev açılmasın (kurucunun birleştirme amacı) |
| ac (sahiplenilmiş) | faucet | AYRI | sahiplenme sayesinde konusuz elle söz EN ÇOK BİR konuyu yutar |
| ac | NULL ("teknisyen 18:00'de gelecek") | BİRLEŞ (konu yazılmaz) | konusuz söz büyük olasılıkla aynı ziyaret |
| NULL | NULL | BİRLEŞ | bugünkü davranış |

- Aday birden çoksa sıra: önce konu EŞİT olan, sonra NULL konulu; eşitlikte `createdAt asc, id asc` (CLAUDE.md "aynı zaman damgası → id").
- Sahiplenme yazımı aynı işlemde, konuşma danışma kilidi altında (`guest-commitments.ts:97`) → eşzamanlı iki onay (ac + faucet) aynı NULL sözü
  ikisi birden yutamaz: ikincisi kilidi bekler, sahiplenilmiş satırı görür (`ac ≠ faucet`) → yeni söz.
- Sahiplenme koşullu yazım: `updateMany({ where: { id, topic: null }, data: { topic } })` (0 satır → yeniden oku; kilit altında olmaz ama savunma).
- Görev başlığı: YENİ sözde `Misafire söz: Arıza / bakım — klima` (`guest-commitments.ts:134`); sahiplenilen eski görevin başlığına DOKUNULMAZ
  (ev sahibinin işi). Denetim kaydına `topic` (kod, PII yok) eklenir (`guest-commitments.ts:152-157`).
- Kimlikli tekrar (`sameCommitmentRequest`, `guest-commitments.ts:61-63`) DEĞİŞMEZ: aynı öneri anahtarı (`sugg:<anahtar>`, `act.ts:139`) aynı
  mesajdan aynı konuyu üretir; konu ölçüte eklenmez (aynı kimlik farklı konu üretemez — saf fonksiyon).

### 1.5 Okuyan / yazan kod yolları
- Yazan: `src/lib/guest-commitments.ts:76-160` (`createGuestCommitment` girdisine `topic?: string | null`; `:111-126` birleştirme dalı
  `commitmentSlotMatches` ile; `:141-151` `topic` yazımı). Elle rota `commitments/route.ts:54-63` DEĞİŞMEZ (topic gönderilmez = NULL).
- Öneri: `src/lib/ai-suggestions/core.ts:95-105, 219-267` (topic üret), `load.ts:54` (görünüm `proposal.topic`), `load.ts:160-163` (sorguya `topic`),
  `load.ts:215` ve `:220` (aynı `commitmentSlotMatches` — onay tarafıyla BİREBİR; Opus 10-15 B1 "ölü Onayla düğmesi" dersi), `load.ts:226`
  (başlık: "Söz kaydet: Arıza / bakım (klima) — bugün 18:00"), `act.ts:126-141` (`topic: view.proposal.topic`).
- `load.ts:215` kuralı ("mesajdan SONRA aynı türde söz varsa öneri yok") da konu uyumuna bağlanır: klima sözü onaylandıktan sonra AYNI mesajdan
  değil BAŞKA mesajdan gelen musluk önerisi görünmeye devam eder.
- Okuyan (gösterim): "Dikkat Gerektirenler" söz satırı + gelen kutusu söz kartı — `COMMITMENT_TOPIC_LABELS` ile "Arıza / bakım · klima" (yalnız
  ev sahibi ekranı; misafire GİTMEZ). Dosya: `grep -rn "COMMITMENT_KIND_LABELS" src/components src/app` (çağıranlar uygulamada çıkarılır).
- Dışa aktarma: `src/lib/data-export.ts:289-292` seçimine `topic: true` (ev sahibinin işaretlediği söz — taşınabilir veri).

### 1.6 Değişmezler
- Elle form davranışı bayt bayt aynı (klima 18:00 + musluk 18:00 = iki söz; aynı kimlik = aynı söz).
- Öneri gösterimi ⇔ onay sonucu: bir öneri görünüyorsa onayı yeni söz AÇAR ya da konusuz/eşit konulu bir sözle birleşir; asla "görünür ama ölü".
- Konu yalnız ev sahibinin mesajından kodla (model yok); misafir metni okunmaz; konu misafire / isteme GİRMEZ (söz modülü istem kurmaz,
  `guest-commitments.ts:14`).
- Anahtar `AI_ACTION_SUGGESTIONS_ENABLED` KAPALI → bugün hiçbir müşteri etkilenmez (`load.ts:30-32`).

### 1.7 KVKK
`topic` kapalı küme cihaz / eşya kodu; misafir kimliği ya da metni taşımaz. Saklama söz satırıyla (`purgeExpiredGuestCommitments`,
`guest-commitments.ts:196-199`), misafir silmesi satırı siler (`src/lib/erasure.ts:610`). E3 kanaryası ETKİLENMEZ (`GuestCommitment`
`GUEST_MODELS`'te değil, `tests/unit/scrub-scope-parity.test.ts:27-37`). E2: model zaten `HANDLED_REFERENCES`'ta; yeni `conversationId` yok.
E1: model zaten EXPORTED (`tests/unit/data-export-coverage.test.ts:34`).

### 1.8 Kırmızı-önce testler
1. (entegrasyon, gerçek PG) Aynı konuşmada iki ev sahibi mesajı "Klimanız için teknisyen bugün 18:00'de gelecek" + "Musluk için usta bugün
   18:00'de gelecek" → iki öneri onayı. BUGÜN: 1 söz, 1 görev, ikinci `gone` · BEKLENEN: 2 söz (ac, faucet), 2 görev.
2. (entegrasyon) Klima onaylandıktan sonra `getConversationSuggestions` musluk önerisini HÂLÂ döndürür (bugün `load.ts:215/220` gizler).
3. (entegrasyon) Elle form ile Arıza/bakım 18:00 (NULL) → klima önerisi onayı → TEK söz, `topic = ac` yazıldı, görev sayısı 1 · ardından musluk
   önerisi → yeni söz (toplam 2).
4. (entegrasyon) Aynı konu iki mesajda ("klima 18:00" iki kez) → 1 söz (birleştirme amacı korunur).
5. (entegrasyon) Mevcut `ac` sözü + konusuz "Teknisyen 18:00'de gelecek" önerisi → birleşir, yeni görev YOK.
6. (eşzamanlılık, gerçek PG) NULL söz varken ac + faucet onayı `Promise.all` → 2 söz (biri NULL'u sahiplendi); aynı konu iki onay → 1 söz.
7. (saf) `commitmentTopicOf`: "Klimayı yarın 10'da teknisyen tamir edecek" → ac · "Musluğu yarın usta değiştirecek" → faucet · "The plumber
   will fix the tap tomorrow" → faucet · "Teknisyen yarın gelecek" → null · "Klima ve musluk için usta 18:00'de gelecek" → null · "Yarın şampuan
   getireceğim" → shampoo · "Havlu getireceğim" → null.
8. (saf, eşlik pini) Tablo 1.4'ün altı satırı `commitmentSlotMatches` üzerinde; `load.ts` ile `guest-commitments.ts` aynı fonksiyonu çağırır
   (davranışsal: görünen her öneri onayda "gone" dönmez — rastgele 200 senaryoda).
9. Elle form geriye uyum: bugünkü `tests/integration/*commitment*` pinleri değişmeden yeşil.
10. Mutasyon (`scripts/mutation-run.mjs`): yüklemden konu koşulunu kaldır → 1, 2 kırmızı · sahiplenme yazımını kaldır → 3'ün ikinci yarısı kırmızı ·
    NULL'u joker sayma → 3, 5 kırmızı.

### 1.9 Kurucuya soru (tek)
- **I1-S1 · Elle kaydettiğiniz konusuz söz + aynı saatte konulu öneri:** ÖRNEK — gelen kutusunda "Misafire söz ver" ile **Arıza / bakım,
  bugün 18:00** kaydettiniz (formda konu yok). Sonra misafire "Klima için teknisyen 18:00'de gelecek" yazdınız; öneri "Söz kaydet: Arıza / bakım
  (klima) — bugün 18:00" diyor.
  - (a) ÖNERİM: onaylayınca yeni görev AÇILMAZ, sizin sözünüze "klima" konusu yazılır, ekranda "Aynı saatte kaydettiğiniz Arıza / bakım
    sözüne bağlandı (klima)." Ardından "musluk 18:00" önerisini onaylarsanız AYRI söz + görev açılır.
  - (b) Konusuz elle söz hiçbir öneriyle birleşmesin → klima önerisi ikinci görev açar (aynı iş için iki görev olabilir).
  - (c) Elle forma isteğe bağlı "Konu" seçimi eklensin (yalnız Arıza / bakım ve Eksik eşyada) — (a)'nın tek kör noktası ("elle musluk kaydettim,
    öneri klima") da kapanır; formda bir alan daha olur.
  Hangisi? (Anahtar kapalı; bugün kimse etkilenmiyor.)

---

## 2. L5 — `Message.channelSenderRole` (kanalın bildirdiği gönderen rolü)

### 2.1 Sorun (kodda doğrulandı)
- Hospitable adaptörü yalnız "misafir mi?" sorar (`src/lib/channels/hospitable-ingest.ts:80-84`: `sender_type`/`sender_role` içinde "guest");
  misafir olmayan HER mesaj `outbound` (`:133`). Kanonik tipte rol YOK (`src/lib/channels/ingest.ts:75-83`); sözleşmede borç olarak yazılı:
  `authorRole: "guest_host_system_needed"` (`src/lib/channels/requirements.ts:46-48`).
- Yazma servisi giden her yeni satıra `authorType: "host"` yazar; yalnız bizim otomatik mesajımız (K7, gönderim izine bağlanan) `automation`
  olur (`src/lib/ingest/write-service.ts:446-456`). → Hospitable'ın kendi şablon / zamanlanmış / yapay zekâ mesajı = "ev sahibi".
- Etkisi (bugün): geçmişten öğren eşleştiricisi şablonu ev sahibi cevabı sayar (`src/lib/history-learn/pairs.ts:106`, `src/lib/kb-from-history.ts:146-156`),
  üslup profili şablondan örnek alır (`src/lib/automation.ts:4407-4428`), öneri motoru şablondaki Wi-Fi değerinden / "housekeeping will come"
  cümlesinden öneri üretir (`src/lib/ai-suggestions/load.ts:210, 268`). Ayrıca (2. faz konusu ↓2.8) şablon "cevap" sayılır: `isAutomationMessage`
  yalnız `authorType` okur (`src/lib/message-author.ts:43-45`) → kanal oto-yanıtı "already_answered" (`automation.ts:1857`, kesme `src/lib/channel-thread-window.ts:136-141`),
  konuşma öğeleri / karar kartları "ev sahibi yazdı" ile kapanır (`src/lib/conversation-items/store.ts:303-309, 359`, `src/lib/decisions/store.ts:370-377`).

### 2.2 Sağlayıcı alanları — DOĞRULANMADI
- Kodda okunan: `sender_type`, `sender_role`, `sender.full_name/first_name` (`hospitable-ingest.ts:82, 87`); fikstürlerde yalnız `guest`/`host`
  değerleri (ör. `tests/integration/hospitable-sync.test.ts`, `tests/unit/ingest-adapter-conformance.test.ts`). Otomasyonu ayıran alan
  (`source`? `automated`? `sender_type` değeri?) repoda YOK; Hospitable belgesi bu ortamdan açılamadı (developer.hospitable.com ve apis.io DNS
  hatası; arama özeti alan değerlerini vermedi). Topluluk talebi "API ile gönderilen mesaj hesap sahibine atfediliyor" diyor → bizim API ile
  gönderdiğimiz ev sahibi cevabı sağlayıcıda "otomasyon / entegrasyon" etiketli GELEBİLİR (↓2.4 sahiplenme kuralı bu yüzden).
- Doğrulama adımı (soru değil, uygulama ön koşulu): canlı bir hesapta `GET /api/hospitable/diagnostics` mesaj `shape` çıktısı
  (`src/app/api/hospitable/diagnostics/route.ts:115-123`, yalnız alan adları / tipleri) + bir şablon mesajının alanları. Kurucu org abonelik 402
  (veri donmuş, CLAUDE.md) → başka bağlı hesap ya da Hospitable desteğine yazılı soru. Doğrulanana kadar okuyucular ↓ "unknown"u ev sahibi SAYMAZ
  ama alan YOKSA (NULL) bugünkü davranış sürer → yanlış eşleme sessiz öğrenme kaybından başka zarar vermez.
- Alan doğrulanamazsa (Hospitable şablonu `sender_type: host` ile, ayırt edici alansız geliyorsa) L5 Hospitable için HİÇBİR şey ayıramaz; içerik
  sezgisi (aynı metnin çok konuşmada tekrarı) REDDEDİLDİ: ev sahibinin kopyala-yapıştır gerçek cevabını (en değerli öğrenme verisi) da düşürür.

### 2.3 Şema farkı (Prisma) + kanonik sözleşme
```prisma
model Message {
  // … mevcut alanlar …
  /// KANALIN BİLDİRDİĞİ GÖNDEREN ROLÜ (L5, kurucu 10-17: "sağlayıcı otomasyonu ile ev sahibinin mesajını ayır; Airbnb Direct'te rol kanal
  /// katmanında"). Kapalı küme `CHANNEL_SENDER_ROLES` (message-author.ts): guest · host (insan: sahip / ortak ev sahibi / ekip) · automation
  /// (insan olmayan: sağlayıcı şablonu, zamanlanmış mesaj, sağlayıcı yapay zekâsı, platform sistem mesajı) · unknown (alan var, değer tanınmadı).
  /// NULL = kanal rol bildirmedi / bizim yazdığımız satır (QR, elle cevap, oto-yanıt) / bu kolondan önceki satır → `authorType` tek otorite.
  /// Güvenlik kararı bundan TÜREMEZ (yalnız öğrenme / gösterim; `authorType` kuralı aynen, message-author.ts:4-8). Metin / kimlik taşımaz.
  channelSenderRole String?
}
```
```sql
-- 78_l5_message_channel_sender_role (dolu ve BÜYÜK tabloya boş kolon: PG 11+ meta-veri değişikliği, tablo yeniden yazılmaz, dizin yok)
ALTER TABLE "Message" ADD COLUMN "channelSenderRole" TEXT;
```
- Ad: `provider…` yerine `channel…` — değişmez 1 (çekirdek sağlayıcı semantiği istemez); Airbnb Direct de aynı kolonu doldurur. E4 kalıbına
  (`provider\w*Id`, `channel-invariants-ratchet.test.ts:45`) uymaz, tekil değil.
- `CanonicalMessage`'a (`ingest.ts:75-83`) `senderRole?: ChannelSenderRole | null` (isteğe bağlı → eski / sahte adaptörler derlenir). `requirements.ts:46`
  → `senderRole: CHANNEL_SENDER_ROLES` + `satisfies (keyof CanonicalMessage)[]` (alan yeniden adlandırılırsa sözleşme derlenmez — dosyanın kuralı).
  `docs/AIRBNB-DIRECT-SOZLESMESI.md`'ye satır: "doğrudan kanal gönderen rolünü (misafir / ev sahibi / otomasyon) vermeli".
- Hospitable eşlemesi (yalnız `hospitable-ingest.ts`, YENİ saf `senderRoleOf(m)`): misafir kuralı aynen (`:81-84`, `guest`) · bilinen otomasyon
  işaretleri (2.2 doğrulamasından çıkan alan / değerler; aday: `sender_type` ∈ automation/automated/system/bot/ai, `source` ∈ automated/scheduled/ai,
  boolean `automated`) → `automation` · insan ev sahibi değerleri (host/co_host/co-host/teammate/owner) → `host` · rol alanlarının HİÇBİRİ yok → `null`
  · alan var ama değer tanınmadı → `unknown`. Ham sağlayıcı değeri SAKLANMAZ (tanınmayanlar senkron sayacında sayılır — bugünkü `unimportable`
  sayacı emsali, `write-service.ts` dönüşü).

### 2.4 Yazan yollar
- `src/lib/ingest/write-service.ts:448-466` (`message.create`): `channelSenderRole: m.senderRole ?? null` — çekirdek yalnız kapalı kümeyi doğrular
  (tanımsız değer → "unknown"), sağlayıcı alan adı GÖRMEZ.
- 🚨 SAHİPLENME YOLU YAZMAZ: `write-service.ts:431-441` (yerel giden satıra `externalId` iliştirme) rol kolonuna DOKUNMAZ — o satır bizim
  gönderdiğimiz ev sahibi / yapay zekâ mesajı; sağlayıcı API ile gönderileni "entegrasyon" diye etiketlerse ev sahibinin gerçek cevabı öğrenmeden
  düşerdi. `authorType` orada zaten doğru.
- Geriye doldurma: migration'da YOK. Sıcak yolda dedupe isabetinde (`write-service.ts:468-470`) güncelleme YOK (her senkronda mesaj başına sorgu
  olurdu). İsteğe bağlı operatör betiği `scripts/backfill-channel-sender-role.ts` (kuru koşu varsayılan; konuşma başına sağlayıcıdan yeniden okur,
  yalnız `channelSenderRole IS NULL` + `externalId` eşleşen satırı yazar; sağlayıcı hız sınırına uyar) — ayrı onay, Railway açılınca. Kurucu
  org 402 → betik o hesapta çalışamaz; eski geçmiş NULL kalır (bugünkü davranış).

### 2.5 Okuyan yollar — 1. FAZ (bu paket; yalnız ÖĞRENME / ÖNERİ girdisi)
Yeni yardımcılar `src/lib/message-author.ts` (yaprak, `notAutomationMessageWhere` `:57-59` emsali):
`isChannelAutomation(m)` = rol `automation` · `countsAsHostEvidence(m)` = rol NULL ya da `host` (öğrenmede `unknown` da DÜŞER — "şüphede öğrenme
yok", `pairs.ts:41-42`) · `hostEvidenceWhere()` = `{ OR: [{ channelSenderRole: null }, { channelSenderRole: "host" }] }` (Prisma `not` NULL'u
dışlar — `message-author.ts:56` notu).
1. `src/lib/kb-from-history.ts:146-156` `isHostAuthored` → `countsAsHostEvidence` şartı (Geçmişten öğren + Bacak B ortak tek kapı).
2. `src/lib/history-learn/pairs.ts:70-72, 101-112`: sağlayıcı otomasyonu K7 şablonu gibi — bekleyen misafir bloğunu TÜKETMEZ, yapay zekâ
   cevabı da SAYILMAZ (bugün `isAiOutbound` "ev sahibi değil" diye onu yapay zekâ sayar → blok düşerdi). `unknown` rol de bloğu tüketmez + cevap
   olmaz (fail-closed). Sorgu seçimine kolon: `src/lib/history-learn/service.ts:235-247`, `HistoryMessage` tipi `kb-from-history.ts:58-73`.
3. `src/lib/automation.ts:4407-4428` üslup profili: `AND: [mevcut OR, hostEvidenceWhere()]`. ⚠️ Profil cevap istemine girer
   (`prompts.ts:1764-1781`) → misafire giden ÜSLUP dolaylı değişir; kurucunun L5 kararı bunu kapsıyor ("ev sahibinin mesajını ayır").
4. `src/lib/ai-suggestions/load.ts:157, 210` (söz önerisi) ve `:261, 268` (Wi-Fi önerisi): yazar `host` + `countsAsHostEvidence`.
5. Kalite denetçisi / raporlar / selam sayımı DEĞİŞMEZ (bu fazda).
6. Gösterim (isteğe bağlı, ev sahibi ekranı): gelen kutusu balonunda "Otomatik (kanal)" etiketi — bugünkü K7 "[OTOMATİK MESAJ]" görünümüyle aynı
   bileşen; dışa aktarma seçimine `channelSenderRole` (`src/lib/data-export.ts:191-197`).

### 2.6 Değişmezler
- Güvenlik / gönderim kararı `channelSenderRole`'den TÜREMEZ (1. fazda `isAutomationMessage`, `isAnsweringOutbound`, `notAutomationMessageWhere`
  DEĞİŞMEZ — pinli, ↓test 7).
- Çekirdek sağlayıcı alanını okumaz: `write-service.ts` / `message-author.ts` içinde `sender_type|sender_role` geçmez (yapısal pin,
  `tests/unit/core-channel-independence.test.ts` yanına).
- `direction` kuralı aynen; rol yalnız ek bilgi. `inbound` + rol `guest` dışı → çekirdek "unknown" yazar (tutarsız sağlayıcı satırı öğrenmeye girmez).

### 2.7 KVKK
Kapalı küme rol etiketi — misafirin metnini de kimliğini de taşımaz → iki süpürgeye EKLENMEZ. **E3 ZORUNLU:** `Message: 17 → 18`
(`tests/unit/scrub-scope-parity.test.ts:218`) + karar yorumu ("`Message.channelSenderRole` (String?, L5) → KAPSAM DIŞI: kapalı küme rol etiketi;
`guestNameSource` / `connectionEvidence` emsali"). E1: model zaten EXPORTED; seçime eklemek önerilir (test etkisi yok). E2/E4/E5/E6 DEĞİŞMEZ.

### 2.8 2. FAZ (kurucu sorusu ↓) — "cevap" sayılması
Tek değişiklikle bütün okuyucular: `isAutomationMessage` (`message-author.ts:43-45`) ve `notAutomationMessageWhere` (`:57-59`) rol
`automation`'ı da kapsar → K7 anlamı (misafire gitti ama CEVAP DEĞİL) sağlayıcı otomasyonuna da uygulanır: kanal oto-yanıtı kesmesi
(`channel-thread-window.ts:139`), konuşma kayıtları (`ai/conversation-state.ts:172-176`), kapanış (`ai/closing-turn.ts:229-236`), öğe / karar
"ev sahibi yazdı" (`HOST_OUTBOUND_WHERE` iki dosyada — `authorType: "host"` koşuluna rol koşulu eklenir), rapor cevap oranı (`reports.ts`).
Selam kuralı (`operator-replies.ts`) bilerek SAYAR (K7 ile aynı: misafir o selamı gördü).

### 2.9 Kırmızı-önce testler
1. (birim) `senderRoleOf`: guest/guest → guest · host/host → host · co-host → host · otomasyon işareti → automation · alan yok → null · "weird" → unknown.
   Uyum kiti (`tests/helpers/ingest-conformance.ts:54+`): sahte + gerçek adaptör aynı rol eşlemesini verir.
2. (entegrasyon, gerçek PG, sahte adaptör) senkron yeni satıra rolü yazar; SAHİPLENME: yerelde aynı gövdeli giden satır + sağlayıcı "automation" →
   satırın rolü NULL kalır, `authorType` host (kaldırma mutasyonu: sahiplenmede yazarsa kırmızı).
3. (saf) `buildLearnPairs`: misafir "Otopark var mı?" → sağlayıcı şablonu (authorType host, rol automation) → ev sahibi "Arkada ücretsiz" →
   BUGÜN çiftin cevabı şablon metni (blok şablonla tükenir) · BEKLENEN cevap ev sahibinin mesajı.
4. (saf) `isHostAuthored`: rol automation → false · unknown → false · NULL / host → bugünkü sonuç.
5. (entegrasyon) üslup profili sorgusu: rol automation / unknown satırları örneğe girmez; NULL + host girer (sahte model çağrısının gördüğü örnek
   sayısıyla).
6. (entegrasyon) öneri: sağlayıcı şablonunda "Wi-Fi şifresi: Yeni2025x" → `kb_wifi` önerisi YOK; "Housekeeping will come tomorrow at 10" → söz
   önerisi YOK; aynı metin rol host → öneri VAR.
7. (pin) 1. fazda `isAnsweringOutbound({direction:"outbound", authorType:"host", channelSenderRole:"automation"})` === true (2. faz bilinçli değişsin).
8. E3 kanaryası 18 + yorum; yapısal pin (çekirdekte sağlayıcı alan adı yok). Mutasyon: 4'teki rol koşulunu kaldır → 3, 4 kırmızı; sahiplenmede yaz → 2 kırmızı.

### 2.10 Kurucuya soru (tek)
- **L5-S1 · Kanalın otomatik mesajı "cevap" sayılsın mı?** ÖRNEK — misafir 13:55'te "Otopark var mı?" yazıyor; Hospitable'ın zamanlanmış
  "Giriş bilgileri" mesajı 13:56'da gidiyor; bizim senkron 13:57'de ikisini birlikte görüyor.
  - Bugün: şablon "ev sahibi cevabı" sayılır → yapay zekâ otopark sorusunu CEVAPLAMAZ ("zaten cevaplandı"); aynı saatte "Klima çalışmıyor" diye
    açık bir iş varsa "Dikkat Gerektirenler"den DÜŞER ("ev sahibi yazdı").
  - Önerim (2. faz): bizim kendi otomatik mesajlarımızdaki kuralın aynısı (K7, 09-30 onayınız) — kanalın otomatik mesajı misafire gitti ama cevap
    değil → yapay zekâ otopark sorusunu cevaplar, klima işi panoda açık kalır. Selam kuralı (ilk cevapta "Merhaba") bugünkü gibi sayar.
  - Risk: sağlayıcının yapay zekâsı açık bir hesapta gerçekten soruyu cevapladıysa bizimki de cevaplayabilir (çift cevap). Bu yüzden 2. faz,
    alan doğrulaması (2.2) yapılıp otomasyon türü (şablon mu, sağlayıcı yapay zekâsı mı) ayrılabildikten sonra.
  Böyle yapalım mı? (1. faz — öğrenme / üslup / öneri — kararınızla zaten kapsamda.)

---

## 3. K1 — deneme kötüye kullanımı: risk puanı + IP / ağ sinyali (otomatik kesme YOK)

### 3.1 Bugün (kodda doğrulandı)
- Puan saf modülde, veri saklamadan, operatör sayfası açılışında hesaplanır (`src/lib/billing/trial-risk.ts:30, 66-81, 90-113`); liste
  `src/app/(app)/admin/page.tsx:173-200` + kart `:261-295` ("hiçbir hesap otomatik etkilenmez").
- 🚨 K1 kararıyla ÇELİŞEN kod: deneme kimliği anahtar açılınca denemeyi KENDİLİĞİNDEN bitirir (`src/lib/billing/trial-identity.ts:181-182,
  282-293`; müşteri metni `:33`, takvim rotası `src/app/api/calendar-sources/[id]/sync/route.ts:22`, ayarlar `src/app/(app)/settings/page.tsx:169-171, 485`).
  Anahtar `TRIAL_IDENTITY_ENABLED` KAPALI → bugün kimse etkilenmedi. B kararı → bu dal SİNYALE çevrilir (↓3.5).
- IP: kayıt `clientIp(req)` ile TAM adresi alır (`src/app/api/auth/register/route.ts:56`) ve YALNIZ onay kanıtı olarak `User.acceptedIp`'e ham
  yazar (`:225`, şema `prisma/schema.prisma:236-248`). Hız sınırı kovası IPv6'da /64 (`src/lib/rate-limit.ts:190-210`). Risk puanı IP okumaz.
- `acceptedIp`'i puana katmak AMAÇ DEĞİŞİKLİĞİ (KVKK md. 4; araştırma `docs/arastirma-2026-10-15/deneme-kotuye-kullanim.md:97-98, 182-183`) →
  bu tasarım `acceptedIp`'i OKUMAZ (pin); risk için ayrı, anahtarlı, süreli iz yazar.

### 3.2 Şema farkı (Prisma)
```prisma
/// KAYIT AĞI İZİ (K1, kurucu 10-17 "IP'lere bakılsın; otomatik kesme yok"). Yeni hesap kaydında BİR satır. HAM IP YOK: tam adres ve ağ öneki
/// (IPv4 /24, IPv6 /48) ayrı ayrı anahtarlı özet (HMAC-SHA256; anahtar ENCRYPTION_KEY || AUTH_SECRET'ten AYRI tuzla türetilir — deneme
/// kimliği emsali trial-identity.ts:117-125). Takma adlı kimlik taşır (kişisel veri): amaç yalnız deneme kötüye kullanımı İNCELEMESİ (otomatik
/// karar yok), 90 gün sonra silinir. Hesap silinince iz süre dolana kadar kalır (`organizationId` boşa çekilir — sil-yeniden-aç görünsün).
model SignupNetworkTrace {
  id             String        @id @default(cuid())
  organizationId String?
  /// HMAC("ip|" + tam adres); NULL = adres okunamadı ("unknown")
  ipHash         String?
  /// HMAC("net|" + önek); NULL = adres okunamadı
  networkHash    String?
  /// v4_24 | v6_48 (kapalı küme)
  networkKind    String?
  /// Kayıt anında bilinen bulut / barındırma aralığında mı (repodaki sürümlü liste). NULL = bakılmadı (liste yok / alt dilim kapalı)
  hostingNetwork Boolean?
  /// Özet anahtarının parmak izi (sha256 ilk 16 hex) — anahtar değişirse eski satırlar karşılaştırmaya GİRMEZ (sessiz yanlış eşleşme yok)
  keyFp          String
  createdAt      DateTime      @default(now())
  /// createdAt + 90 gün (süpürge)
  expiresAt      DateTime
  organization   Organization? @relation(fields: [organizationId], references: [id], onDelete: SetNull)

  @@index([ipHash, createdAt])
  @@index([networkHash, createdAt])
  @@index([organizationId])
  @@index([expiresAt])
}

model Organization {
  // … mevcut …
  /// K1-B: deneme kimliği (ilan / takvim) başka hesapta görüldü — SİNYAL; deneme BİTİRİLMEZ. NULL = görülmedi.
  trialIdentityReusedAt DateTime?
  signupNetworkTraces   SignupNetworkTrace[]
}
```
```sql
-- 79_k1_signup_network_trace
ALTER TABLE "Organization" ADD COLUMN "trialIdentityReusedAt" TIMESTAMP(3);
CREATE TABLE "SignupNetworkTrace" ("id" TEXT NOT NULL, "organizationId" TEXT, "ipHash" TEXT, "networkHash" TEXT, "networkKind" TEXT,
  "hostingNetwork" BOOLEAN, "keyFp" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SignupNetworkTrace_pkey" PRIMARY KEY ("id"));
CREATE INDEX "SignupNetworkTrace_ipHash_createdAt_idx" ON "SignupNetworkTrace"("ipHash", "createdAt");
CREATE INDEX "SignupNetworkTrace_networkHash_createdAt_idx" ON "SignupNetworkTrace"("networkHash", "createdAt");
CREATE INDEX "SignupNetworkTrace_organizationId_idx" ON "SignupNetworkTrace"("organizationId");
CREATE INDEX "SignupNetworkTrace_expiresAt_idx" ON "SignupNetworkTrace"("expiresAt");
ALTER TABLE "SignupNetworkTrace" ADD CONSTRAINT "SignupNetworkTrace_organizationId_fkey" FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```
Dolu tabloya yalnız boş kolon (Organization) + yeni tablo → açılışta patlama yolu yok. Geriye doldurma YOK (eski kayıtların IP'si ham
`acceptedIp`'te; amaç değişikliği olmasın diye özetlenip taşınmaz — ↓soru K1-S1 (b)). `M-kart`'taki `TrialRiskAssessment` (MIGRATION-MANIFEST §2) bu
paketin YERİNE değil; kart kapısı K1-B kararıyla askıda — anlık puan saklanmaz, her açılışta hesaplanır (bugünkü ilke).

### 3.3 Yazan yollar
- Anahtar `SIGNUP_NETWORK_TRACE_ENABLED` (tam "1", VARSAYILAN KAPALI; yeni veri işleme → aydınlatma metni güncellenmeden açılmaz — `trial-identity.ts:18`
  emsali). Kapalıyken satır YAZILMAZ, puan IP sinyali üretmez.
- `src/app/api/auth/register/route.ts`: işlem COMMIT'inden SONRA (`:203-246` bloğunun ardı) en iyi çaba `recordSignupNetwork(org.id, ip)`; hata
  kaydı kayıt akışını ASLA düşürmez (fail-open, `reportError`). Var-olan-hesap dalı (`:150-180`, yeni işletme yok) ve P2002 kaybedeni (`:243-245`)
  satır YAZMAZ (işletme yok).
- YENİ yaprak `src/lib/billing/signup-network.ts`: `ipNetworkPrefix(ip)` (saf; `rate-limit.ts:195-210` `ipBucketKey` mantığı: IPv4-eşlemeli IPv6 →
  IPv4; IPv4 → a.b.c.0/24; IPv6 → ilk 3 grup /48; "unknown" / IP değil → null) · `hashSignupNetwork` (HMAC, `scryptSync(secret,
  "lixus-signup-network-v1")`) · `recordSignupNetwork` · `purgeSignupNetworkTraces` · `networkSignals(traces, now)` (saf).
- `src/lib/scheduled-sync.ts:916` yanına `hourly("signup-network-purge", …, () => purgeSignupNetworkTraces())` (`expiresAt < now`); anahtar
  kapalıyken de koşar (eski iz kalmasın — `trial-identity.ts:298` emsali).
- Altyapı koruması (Railway `TRUSTED_PROXY_HOPS` yanlışsa herkes aynı kenar adresine düşer — `register/route.ts:48-55` notu): son 24 saatte ≥10
  kaydın ≥%50'si AYNI `ipHash` → o özet "altyapı" sayılır, sinyal ÜRETMEZ + tek alarm (`alertOnTransition`, `src/lib/alert-state.ts:54-109`).

### 3.4 Sinyaller, ağırlıklar, eşikler (saf, `trial-risk.ts`)
| Sebep (yeni ✚) | Puan | Tanım | Yanlış pozitif notu |
|---|---|---|---|
| identity_reused | 60 | ilan / takvim başka hesapta görüldü (`trialIdentityReusedAt` ya da eski `trialEndReason`) | ilan el değiştirmiş olabilir |
| mailbox_shared | 40 | bugünkü (`trial-risk.ts:25-30`) | — |
| disposable_email | 30 | bugünkü | — |
| ✚ ip_shared | 20 | aynı TAM adres özeti, BAŞKA bir kayıtta (silinmiş hesap dahil) ±30 gün içinde | Türkiye mobil CGNAT / otel Wi-Fi'si — tek başına hep "düşük" |
| ✚ network_burst | 15 | aynı /24 ya da /48'de ±7 gün içinde ≥2 BAŞKA kayıt (toplam ≥3) | ofis / ajans ağı (meşru çok hesap) |
| ✚ hosting_network | 15 | kayıt adresi bilinen bulut aralığında (↓3.6, alt dilim) | Türkiye'de yaygın VPN / Cloudflare WARP — bilinçli zayıf |
| email_unverified | 10 | bugünkü | — |

- Bant (yalnız gösterim; otomatik işlem YOK): ≥60 "yüksek — incelemeyi önerir" · 30–59 "orta" · 1–29 "düşük". Liste bugünkü gibi puan > 0.
- 🚨 Değişmez (pin, bütün alt kümeler taranır): IP sinyallerinin toplamı (20+15+15 = 50) TEK BAŞINA "yüksek" banda ULAŞAMAZ.
- Bağlam: satırda "aynı ağdan son 7 günde 3 kayıt: Lale Ev (12 Eki), X (13 Eki), silinmiş hesap (14 Eki)" — operatör yalnız işletme adı / tarih görür;
  özet / IP GÖSTERİLMEZ.
- Okuma: operatör sayfası deneme işletmelerinin izlerini + aynı özetli izleri TEK sorguda (`ipHash IN … OR networkHash IN …`, `createdAt ≥ now − 90 gün`,
  `keyFp = güncel`) okur; hesap `networkSignals` saf fonksiyonda (DB'siz test).

### 3.5 "Otomatik kesme yok" (K1-B) + operatörün "engelle" eylemi
- `trial-identity.ts:181-182`: `enforce` dalı `endTrialForReusedIdentity` YERİNE `organization.updateMany({ where: { id, trialIdentityReusedAt: null,
  trialIdentityExempt: false }, data: { trialIdentityReusedAt: now } })` + denetim `trial.identity_reused_flagged`. Kurucu hesabı (`isFounderOrg`)
  yine muaf. `endTrialForReusedIdentity` (`:282-293`) ve takvim rotasının müşteri bildirimi (`sync/route.ts:22`) kaldırılır (anahtar kapalı →
  davranış farkı yok). `riskyTrials` `identityReused` okuması (`trial-risk.ts:106`) iki kaynağı da kabul eder (eski satırlar).
- YENİ rota `POST /api/admin/trial-block` (süper-admin + 2FA, bürünmede YASAK — `trial-identity-exempt/route.ts:18-26` deseni; hız sınırı; denetim
  `trial.blocked_by_operator`, metadata: puan + sebep kodları — IP / özet YOK): YALNIZ süren yerel deneme → `trialEndsAt = now`,
  `trialEndReason = "operator_blocked"` (kapalı küme genişler, migration yok; `schema.prisma:987-988`). Hesap SİLİNMEZ, veri durur, ücretsiz sürümle
  devam eder; ödeme yaparsa normal açılır.
- Geri alma: mevcut "Denemeyi geri ver" (`src/app/api/admin/trial-identity-exempt/route.ts:36-50`) `trialEndReason IN (identity_reused,
  operator_blocked)` kapsar; düğme (`src/components/admin/trial-exempt-button.tsx`) iki rozette de görünür.
- Müşteri metni: ayarlarda `trialNotice` (`settings/page.tsx:485`) `operator_blocked` için ↓soru K1-S2.
- E9: yeni rota `tests/unit/api-route-scoping.test.ts` (admin/* süper-admin kategorisi) + `tests/unit/api-route-role-gate.test.ts`.

### 3.6 Veri merkezi / VPN — dürüst cevap
- Bağımlılıksız GÜVENİLİR VPN tespiti YOK: tüketici VPN'leri (NordVPN, Proton…) kiralık veri merkezi aralıklarından çıkar, liste ücretli
  istihbarattır (MaxMind / IPinfo — araştırma `deneme-kotuye-kullanim.md:242`); Türkiye'de erişim engelleri yüzünden meşru VPN / WARP kullanımı yaygın
  (yanlış pozitif yüksek).
- Yapılabilen (alt dilim K1b, isteğe bağlı): büyük bulutların RESMİ yayımladığı aralıklar (AWS `ip-ranges.json`, Google `cloud.json`, Oracle,
  DigitalOcean, Azure servis etiketleri) repoya sürümlü veri dosyası (`src/lib/billing/hosting-ranges.json`, kaynak + indirme tarihi) + elle
  güncelleme betiği (`scripts/update-hosting-ranges.mjs`; CI'da ağ yok) + saf CIDR eşleştirici (IPv4/IPv6, bağımlılıksız, ikili arama). Yakalar:
  bulut sunucusundan betikli kayıt. Yakalamaz: tüketici VPN'i, Tor (çıkış listesi saatlik değişir — repoda bayatlar), konut vekil sunucuları.
  Ters DNS (PTR) REDDEDİLDİ: kayıt yolunda gecikme + sahibi istediği adı yazar.
- Alt dilim kapalıyken `hostingNetwork` NULL, sinyal yok.

### 3.7 KVKK
- `SignupNetworkTrace`: takma adlı kişisel veri (HMAC; anahtar bizde → IPv4 uzayı küçük olduğu için anahtar sızarsa geri döndürülebilir — "anonim"
  DENMEZ). Hukuki sebep: meşru menfaat (md. 5/2-f, kötüye kullanım önleme). Otomatik karar YOK (md. 11/1-g itiraz yükü doğmaz; yine de "Yardım alın" yolu).
- E1: EXCLUDED — "Kayıt ağı izi (HMAC, ham IP yok) — kötüye kullanım incelemesi, 90 gün; takma adlı kişisel veri, iç güvenlik" (`TrialIdentity`
  satırı `data-export-coverage.test.ts:62` emsali). Organization yeni kolonu: döküm seçimi açık listeyse eklenmez (iç sinyal).
- E5: `TrialIdentity` gibi BİLİNÇLİ SetNull istisnası (faz2 §0 E5 "Cascade ya da gerekçeli istisna" pinine satır). `deleteAccountData`
  (`src/lib/data-retention.ts:897-997`) değişmez; kural belgede: "hesap silinse de iz 90 günün sonunda silinir".
- E7: `tests/helpers/db.ts:30` yanına `signupNetworkTrace.deleteMany()` (SetNull satırı kademeyle gitmez). E8: ↑3.3. E10: `docs/saklama-ve-imha-politikasi.md`'ye satır.
- `User.acceptedIp` DOKUNULMAZ ve risk koduna GİRMEZ (yapısal pin: `src/lib/billing/trial-risk.ts` + `signup-network.ts` içinde `acceptedIp` geçmez).

### 3.8 Kırmızı-önce testler
1. (saf) `ipNetworkPrefix`: 203.0.113.7 → 203.0.113.0/24 · ::ffff:203.0.113.7 → aynı · 2001:db8:abcd:12::1 → 2001:db8:abcd::/48 · "unknown" → null · port / köşeli parantez.
2. (saf) `networkSignals`: aynı IP başka kayıt ±30 gün → ip_shared; 31. gün → yok; aynı /24'te 3 kayıt / 7 gün → network_burst; 2 kayıt → yok;
   farklı `keyFp` → sayılmaz; altyapı koruması (%50) → sinyal yok.
3. (saf, değişmez) IP sinyallerinin her alt kümesi < 60; mevcut ağırlıklar aynen (bugünkü `trial-risk` testleri yeşil kalır).
4. (entegrasyon, gerçek PG) kayıt → bir iz satırı, ham IP hiçbir kolonda yok (satırın bütün değerleri taranır); anahtar kapalı → satır yok; iz
   yazımı hata fırlatırsa kayıt yine 201 (fail-open).
5. (entegrasyon) hesap silme → iz `organizationId` NULL, satır durur; 90 gün sonra süpürge siler.
6. (entegrasyon) K1-B: anahtar açık, aynı ilan ikinci hesapta → BUGÜN `trialEndsAt = now` (kırmızı-önce bu davranışla) · BEKLENEN deneme sürüyor,
   `trialIdentityReusedAt` dolu, listede identity_reused 60.
7. (entegrasyon) `trial-block`: süper-admin → deneme biter, `operator_blocked`, denetim; bürünmede 403; süper-admin değil → 401; ödeyen hesapta
   etkisiz; "Denemeyi geri ver" ile döner.
8. (yapısal) `acceptedIp` risk kodunda yok; E1 / E9 listeleri.
9. Mutasyon: altyapı korumasını kaldır → 2'nin son vakası kırmızı · `keyFp` süzgecini kaldır → 2 kırmızı · B dalında `endTrial` geri gelirse → 6 kırmızı.

### 3.9 Kurucuya sorular (iki)
- **K1-S1 · Aydınlatma metni + saklama süresi (avukat paketine de girer):** önerdiğim cümle — "Ücretsiz denemenin kötüye kullanılmasını önlemek
  için kayıt sırasında IP adresinizden geri döndürülemez bir özet ve bağlandığınız ağın özeti oluşturulur; ham IP adresi bu amaçla saklanmaz.
  Bu bilgi yalnız ekibimizin incelemesinde kullanılır, otomatik karar verilmez ve 90 gün sonra silinir (hesabınızı silseniz de süre sonunda silinir)."
  (a) Süre 90 gün mü (önerim; silip yeniden açmayı 3 ay görür) yoksa 30 gün mü? (b) Bugün onay kanıtı olarak tuttuğumuz ham kayıt IP'sini
  (`acceptedIp`) bu amaçla KULLANMIYORUZ — doğru mu? ÖRNEK: Ayşe 1 Ekim'de kaydoldu, 5 Ekim'de hesabını silip aynı evden yeniden açtı → (90 gün)
  operatör listesinde "aynı adresten başka kayıt" görünür · (30 gün) görünür, 2 ay sonraki üçüncü kayıtta görünmez. Anahtar bu cümle sitede
  yayınlanmadan açılmaz.
- **K1-S2 · "Engelle" müşteriye nasıl görünsün?** Operatör "Denemeyi bitir"e basınca hesap ücretsiz sürüme düşer (veri durur, otomatik mesaj /
  yapay zekâ / QR kapanır — deneme bitmiş hesapla aynı). Ayarlarda görünecek metin önerim: "Ücretsiz denemeniz sona erdi. Devam etmek için bir plan
  seçin. Bir yanlışlık olduğunu düşünüyorsanız bize yazın." (sebep söylenmez — kaçışı öğretmemek için; "risk / puan / kötüye kullanım" sözcükleri
  GEÇMEZ). ÖRNEK: aynı ağdan 3 hesap açan X'in denemesini bitirdiniz → X ayarlarda bu cümleyi görür, "bize yazın" ile itiraz eder, siz "Denemeyi geri
  ver" dersiniz. Uygun mu? (Hesabı tümden kapatma — giriş engeli — önermiyorum: ödeme yapmak isteyen meşru müşteriyi de dışarıda bırakır.)

---

## 4. L2 / L3 — Geçmişten öğren onay akışı (çelişen kalem + tek konuşmalık bilgi)

### 4.1 Bugün (kodda doğrulandı)
- Onay mevcut bilgi tabanına HİÇ bakmaz: plan sayımı + yeni kalem (`src/lib/history-learn/service.ts:600-624`); çelişki yalnız TASLAKLAR arası
  (`extract.ts:524-528` `outdated`). KB↔KB uyarısı yalnız SAAT (`src/modules/intelligence/memory/contradictions.ts:9-12, 323-351`,
  `src/lib/kb-time-conflicts.ts`). Bacak B'nin dersi (`kb-from-history.ts:113-121, 353-359` "aynı mülk + kategori kalemi varsa önerme") yeni
  yola taşınmamış (araştırma H2, `docs/arastirma-2026-10-15/gecmisten-ogren-6-ilke.md:116-123`).
- Sürüm alanları VAR ama yazan yok: `KnowledgeBaseItem.supersededById` (`prisma/schema.prisma:832-834`), pin "bugün yazılmıyor"
  (`tests/unit/kb-review-contract.test.ts:85-99`); getirme "halefi kümede olan kalem düşer" kuralı hazır (`src/lib/ai/retrieval/rerank.ts:142-148`,
  `select.ts:855`). Pasif kalem zaten getirilmez ve Mülk Hafızası'nda emekli edilir (`src/modules/intelligence/memory/bootstrap.ts:39, 63`).
- Destek sayısı saklanıyor (`HistoryLearnDraft.supportConversations`, `schema.prisma:1743`; yazım `service.ts:314`) ama işaret kümesinde
  (`extract.ts:69-71`) "tek konuşma" yok → destek 1 taslak işaretsizse tek tıkla onaylanır (`service.ts:597`). Not taslakları ("Sizin notunuzdan")
  destek 1 ile yazılır (`service.ts:854`).

### 4.2 Şema farkı — L2 (L3 migration'SIZ)
```prisma
model KnowledgeBaseItem {
  // … mevcut …
  /// Bu kalemin yerine yenisi konduğu an (L2, kurucu 10-17 "güncel olanı seçince o doğru sayılsın"). `supersededById` ile BİRLİKTE yazılır
  /// (kalem pasif). Geri alınınca ikisi de NULL. `updatedAt` yerine ayrı alan: sonraki düzenleme / aç-kapa anı değiştirmesin — "eski değer"
  /// öğrenmesi (↓4.4) hangi kanıtın değişiklikten ÖNCE olduğunu bu andan okur.
  supersededAt DateTime?
}
```
```sql
-- 77_l2_kb_superseded_at (dolu tabloya boş kolon)
ALTER TABLE "KnowledgeBaseItem" ADD COLUMN "supersededAt" TIMESTAMP(3);
```
`HistoryLearnDraft`'a kolon GEREKMEZ: kullanıcının seçimi denetim kaydına (`drafts/[id]/route.ts:47-52` metadata'sına `resolution` +
`replacedKbItemId`) ve eski kalemin `supersededById/At`'ına yazılır; "tek konuşma" mevcut `supportConversations` + bayrak JSON'u.
M-kb-surum (70) ile ilişki: ikisi bağımsız; 70 uygulanmışsa ↓ yeni yazıcılar `version: { increment: 1 }` taşır (70'in "her yazıcı artırır" kaynak pini,
faz2 §2.5).

### 4.3 L2 — "aynı konu" tespiti (LLM'siz, saf)
YENİ `src/lib/history-learn/kb-overlap.ts` (saf): `kbOverlaps(draft, kbItems)` →
- Aday: aynı mülk, `isActive`, yapay zekânın okuduğu durum (`legacy|approved` — `src/lib/kb-review.ts:61` `GUEST_DELIVERABLE_KB_WHERE`), halefsiz.
- "Aynı konu": aynı kategori VE — dar kategorilerde (wifi · parking · trash) kategori yeter; ötekilerde (checkin · rules · cleaning · location · faq ·
  local_tips · general) başlık + içerik kavramları kesişir (`topicsOf`, `src/lib/conversation-items/relation.ts:58-60`; ör. "Sigara içilmez" ile
  "Evcil hayvan kabul edilmez" ikisi de `rules` ama kavram ayrı → aday DEĞİL).
- Değer karşılaştırması `valueTokens` (`extract.ts:247-252`, katlanmış): taslağın değerleri kalemde yok VE kalemin değerleri taslakta yok →
  `differs` ("lale2024 ↔ yeni2025" gösterilir); taslak değerleri ⊆ kalem → `same` ("bu bilgi zaten var"); değer yok → `topic`.
- En çok 3 aday, sıra `updatedAt desc, id asc`. Doğrusal (karesel iş yok — mevcut belirteç / kavram okuyucuları).

### 4.4 L2 — onay akışı
1. GET (`src/app/api/properties/[id]/history-learn/route.ts:46-115`) her bekleyen taslağa `kbMatches: [{ id, title, preview(≤280), kind:
   differs|same|topic, updatedAt|version }]` ekler (mülk kapsamlı tek KB sorgusu). Panel (`src/components/properties/history-learn-panel.tsx:227, 252`)
   taslağın üstünde "Bilgi tabanınızda bu konu var: «Wi-Fi» — yeni2025" gösterir.
2. Onay (`PATCH drafts/[id]`, `route.ts:20-54`) yeni alanlar: `resolution: "replace" | "separate"` + `replaceKbItemId` (+ 70 varsa `expectedVersion`).
   Servis (`reviewHistoryLearnDraft`, `service.ts:560-630`) eşleşmeleri İŞLEM İÇİNDE yeniden hesaplar: eşleşme var + `resolution` yok → YENİ sonuç
   `needs_resolution` (409, eşleşmelerle — `needs_confirm` deseni `route.ts:40-44`); "Vazgeç" istemcide (istek gitmez, taslak bekler).
3. `replace` (tek işlem): plan sınırı `active − 1` ile (yer değiştirme sayıyı büyütmez — `service.ts:601-602`) → taslak `approved` (CAS aynen) → yeni
   kalem (aynen `:608-621`) → eski kalem `updateMany({ where: { id: replaceKbItemId, propertyId: draft.propertyId, isActive: true, supersededById: null
   [, version] }, data: { isActive: false, supersededById: yeni.id, supersededAt: now [, version: { increment: 1 }] } })`; 0 satır → işlem GERİ ALINIR,
   409 `kb_changed` ("Bilgi tabanındaki kayıt bu arada değişti. Sayfayı yenileyip yeniden deneyin."). İşlem sonrası bugünkü
   `refreshPropertyMemoryBestEffort` + vektör ısıtma (`:627-628`) eskiyi hafızada emekli eder.
4. `separate`: bugünkü onay (iki kalem etkin — ev sahibinin açık seçimi).
5. GERİ AL: bilgi tabanı sayfasında pasif kalemde "18 Eki'de «Wi-Fi (yeni)» ile değiştirildi" + mevcut "Etkinleştir" anahtarı. KB PATCH
   (`src/app/api/kb/[id]/route.ts:65-90`) `isActive: true` + kalemde `supersededById` doluysa aynı yazımda `supersededById = NULL, supersededAt = NULL`
   (yoksa getirme kuralı `rerank.ts:148` yeniden etkinleştirilen eskiyi halefi yüzünden sessizce düşürürdü). Yeni kalem etkin kalır; ev sahibi
   isterse pasife alır. → `kb-review-contract.test.ts:85-99` pini BİLİNÇLİ güncellenir ("A5 geldiğinde güncellenir" notu).
6. "Model kendini geliştirsin" (kod, LLM'siz — müşteriye / misafire giden metin değişmez): yeni çalıştırmada (`service.ts:300-322` taslak yazımından
   önce) mülkün halefli pasif kalemleri okunur; taslağın değerleri BİR emekli kalemin değerleriyle aynı (⊆) ve taslağın en yeni kanıt ayı ≤
   `supersededAt` ayı → taslak `state: "superseded"` yazılır (ekranda çıkmaz). Kanıt değişiklikten SONRAysa (ev sahibi eski şifreyi yeniden
   söylemiş — belki geri dönmüş) taslak gelir + `outdated` işareti ("Eskisinin yerine koyduğunuz değer — 18 Eki"). Değersiz (yalnız metin) taslakta
   bu kural İŞLEMEZ (metin eşitliği güvenilmez → ev sahibi görür). Bu yorumu (gizleme) karar olarak HABER VERİLECEK, soru değil: misafire giden
   metne dokunmuyor, kurucunun "o artık doğru sayılsın" sözünün kodu.

### 4.5 L3 — "yalnız tek konuşmada" işareti (migration YOK)
- `DRAFT_FLAGS`'a `single_source` (`extract.ts:69-71`; `parseFlags` bilinmeyeni süzdüğü için eski / yeni sürüm karışık çalışır — `service.ts:632-639`).
- Kural (`gateDraft` bağlamına `supportConversations?` + `fromNote?`, `extract.ts:274-325`): destek = 1 VE not taslağı DEĞİL VE başka onay
  isteyen işaret YOK (time_bound / one_off / tentative zaten kutucuk istiyor — çift uyarı yok) VE metin MİSAFİRE ÖZEL BİR EYLEM anlatıyor:
  söz fiili (`PROMISE`, `src/lib/ai-suggestions/core.ts:49-53` — tek kaynak, kopyalanmaz) ya da birinci tekil / çoğul GEÇMİŞ eylem (bıraktım ·
  getirdim · gönderdim · hazırladım · ayarladım · koydum · ayırdım · I left · I brought · I've put — sabit sözcük listesi, doğrusal).
  Destek 1 ama olgu cümlesi ("Çöp konteyneri sokağın başında") → işaret YOK, tek tık (ev sahibi yorulmasın).
- İki yerde aynı fonksiyon: çıkarım yazımında (`service.ts:307-321`, destek `d.conversationIds.length`) ve onayda (`service.ts:594-596`, destek
  `draft.supportConversations`; düzenlenmiş metin eylemi çıkarırsa işaret düşer).
- Panel etiketi (ev sahibi ekranı): "Yalnız bir misafirle konuşmanızda geçti ve o misafire özel görünüyor — herkes için geçerli mi?" + mevcut kutucuk.
- Örnekler (önce → sonra): "Size bir şişe şarap bıraktım" (1 konuşma) → tek tık → kutucuk · "Çöp konteyneri sokağın başında" (1) → tek tık → tek
  tık · "Bu akşam kapıda bekleyeceğim" (1) → zaten time_bound kutucuğu → değişmez · "Wi-Fi şifresi Lale2024" (4 konuşma) → değişmez.
- Bilinen sınır: izin / teklif cümlesi ("Bavulunuzu 15:00'e kadar tutabiliriz") eylem kalıbına girmez → işaretsiz kalır (kaçan işaret güvenli yön:
  yine ev sahibinin onayı).
- Ölçüm (model yok): `docs/olcum/gecmisten-ogren-2026-10-15-4.md`'deki taslaklar üzerinde kaç taslağın işaret aldığı sayılır (hedef: olgu
  taslaklarının hiçbiri).

### 4.6 Değişmezler
- Taslak modele GİTMEZ (A1); onaysız hiçbir kalem değişmez; yer değiştirme TEK işlemde (yarım kalırsa iki kalem de eski hâlinde).
- Kalem silinmez (yalnız pasif + halef bağı) → geri alınabilir; bilgi tabanı silmesi HARD DELETE olarak kalır (FK yok, `schema.prisma:832-834`).
- Kiracı + mülk kapsamı: `replaceKbItemId` başka mülkün kalemi → 0 satır → 409 (başka işletmenin kalemi asla değişmez).
- `separate` bugünkü davranışın aynısı (geri uyum).

### 4.7 KVKK
Bilgi tabanı ev sahibinin verisi; yeni alan zaman damgası. E3 ETKİLENMEZ (KB `GUEST_MODELS`'te değil). E1: model EXPORTED; döküm seçimine
(`src/lib/data-export.ts:212-216`) `supersededById` + `supersededAt` eklenmesi önerilir (ev sahibinin kendi seçim geçmişi). E2/E4/E5/E6 DEĞİŞMEZ.
Denetim kaydı metni / değer TAŞIMAZ (yalnız kimlikler + `resolution`).

### 4.8 Kırmızı-önce testler
1. (entegrasyon, gerçek PG) KB'de etkin "Wi-Fi: yeni2025"; taslak "Wi-Fi şifresi lale2024" → onay (çözümsüz) → BUGÜN 200 + iki etkin Wi-Fi ·
   BEKLENEN 409 `needs_resolution` + eşleşme `differs`.
2. `replace` → yeni kalem etkin, eski pasif + `supersededById = yeni`, `supersededAt` dolu; getirme (`retrieveKbForPrompt`) yalnız yeniyi döndürür.
3. `separate` → iki etkin (bugünkü davranış pini).
4. Yarış: GET ile onay arasında eski kalem elle düzenlenip pasife alındı → 409 `kb_changed`, taslak hâlâ `pending`, yeni kalem YOK (işlem geri alındı).
5. Kiracı: `replaceKbItemId` başka mülk / işletme → 409, hiçbir kalem değişmez.
6. Plan sınırı: sınırda (25/25) `replace` başarılı (sayı artmıyor), `separate` → `plan_items`.
7. Geri al: pasif eski kalem PATCH `isActive: true` → `supersededById/At` NULL; getirme ikisini de görür (halef düşürmesi YOK).
8. Öğrenme: replace sonrası yeni çalıştırma, kanıtı değişiklikten önceki "lale2024" taslağı → `superseded` (ekranda yok); kanıtı sonraki → `pending` +
   `outdated`.
9. (saf) `kbOverlaps`: rules "Sigara" ↔ "Evcil hayvan" → aday yok; wifi ↔ wifi → aday; aynı değer → `same`; değersiz → `topic`.
10. (saf) L3: dört örnek (4.5) + not taslağı destek 1 → işaret yok + başka işaret varken eklenmez; düzenlemede eylem silinirse işaret düşer.
11. Pinler: `kb-review-contract.test.ts:85-99` bilinçli güncel (yalnız KB PATCH'in TEMİZLEME yazımı izinli); 70 uygulanmışsa yeni iki yazıcı `version`
    artırır (faz2 §2.5 kaynak pini kapsar).
12. Mutasyon: replace'te eski kalem koşulundan `isActive: true`'yu kaldır → 4 kırmızı · `active − 1` → 6 kırmızı · geri alda temizleme yok → 7 kırmızı ·
    L3 "başka işaret yoksa" koşulu → 10 kırmızı.

### 4.9 Kurucuya soru
YOK. L2 (üç düğme, eskisi pasif + geri alınabilir) ve L3 (yalnız gerçekten tek seferlik görünende işaret) kararlarınızın birebir kodu. Yorum içeren
tek nokta (4.4-6: yerine koyduğunuz eski değeri Geçmişten öğren bir daha önermez) yalnız ev sahibi ekranını etkiler → yapılıp haber verilir.
ÖRNEK haber metni: "Wi-Fi şifresini «yeni2025» ile değiştirdiğinizde eski «lale2024» önerisi bir daha gelmez; değişiklikten SONRA bir misafire
yine «lale2024» yazdıysanız öneri «eski değer» işaretiyle gelir."

---

## 5. Özet — migration sırası, bağımsızlık, testler, sorular

### 5.1 Önerilen klasörler (69–75 hazır yamasından SONRA; numara klasör oluşunca kesinleşir)
| Öneri no | Klasör | Değişiklik | Dolu tablo riski | Bağımlılık |
|---|---|---|---|---|
| 76 | `76_i1_commitment_topic` | `GuestCommitment.topic TEXT` | boş kolon | yok |
| 77 | `77_l2_kb_superseded_at` | `KnowledgeBaseItem.supersededAt TIMESTAMP(3)` | boş kolon | 70 (M-kb-surum) ile bağımsız; 70 varsa yeni iki yazıcı `version` artırır |
| 78 | `78_l5_message_channel_sender_role` | `Message.channelSenderRole TEXT` | boş kolon, büyük tablo (yalnız meta-veri) | yok; 2. faz ↔ alan doğrulaması (2.2) |
| 79 | `79_k1_signup_network_trace` | yeni tablo `SignupNetworkTrace` (4 dizin, FK SetNull) + `Organization.trialIdentityReusedAt` | yeni tablo + boş kolon | yok; ANAHTAR aydınlatma metninden sonra |

- Dördü de: dolu tabloya `@unique` / zorunlu-varsayılansız / drop YOK; mevcut migration'a dokunulmaz; geriye doldurma YOK (L5 için isteğe bağlı
  operatör betiği ayrı onay). Geri alma: kolonu okumayan sürüme dönmek (kolon boşta kalır); tam geri `DROP COLUMN` / `DROP TABLE`.
- Üretim: her klasör `prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url
  postgresql://postgres@localhost:5432/shadow --script` (ASLA prod URL) + taze PG'de sıfır fark + dolu-tablo provası (69–75 hazır yamasının
  yöntemi, `docs/hazir-yamalar/faz2-2026-10-16/README.md` "Doğrulama") + `docs/MIGRATION-MANIFEST.md` §2'ye ADLA satır (`M-soz-konu`,
  `M-kb-halef`, `M-gonderen-rol`, `M-kayit-agi`).
- Yayın gruplaması önerisi: 76 + 77 + 78 "küçük kolonlar" (69–71 ile aynı yayın olabilir; tek `pg_dump` + tek onay) · 79 ayrı (yeni veri işleme).
- Her paket BAĞIMSIZ uygulanabilir: ortak dosya çakışmaları yalnız `prisma/schema.prisma` (ayrı modeller) ve `tests/unit/scrub-scope-parity.test.ts`
  (yalnız 78). Kod tarafında 77 ile 70 aynı KB yazıcılarına dokunur → aynı turda ayrı commit, 70 önce.

### 5.2 Anahtarlar (hepsi KAPALI doğar / kalır)
`AI_ACTION_SUGGESTIONS_ENABLED` (I1 davranışı) · `HISTORY_LEARN_ENABLED` (L2/L3 davranışı) · `SIGNUP_NETWORK_TRACE_ENABLED` (YENİ, K1) · K1b veri
merkezi listesi ayrı alt dilim · L5 1. faz ANAHTARSIZ (kurucu kararı; misafire giden metin yalnız üslup profili üzerinden dolaylı) · L5 2. faz soru
cevabına bağlı.

### 5.3 Toplam test listesi (kırmızı-önce; K2 = kırmızı-önce + iki yönlü mutasyon + entegrasyon + tam kapı)
- I1 (10): §1.8 — iki konulu iki onay = iki söz (entegrasyon) · liste gizlememe · NULL sahiplenme · aynı konu birleşme · konusuz öneri birleşme ·
  eşzamanlılık · `commitmentTopicOf` 7 vaka · eşlik pini (öneri görünür ⇔ onay ölü değil) · elle form geri uyum · mutasyon (3 mutant).
- L5 (8): §2.9 — adaptör rol eşlemesi + uyum kiti · sahiplenme yolu rol yazmaz · çift eşleştirici şablonu cevap saymaz · `isHostAuthored` · üslup
  sorgusu · öneri motoru · 1. faz "cevap" semantiği pini · E3 kanaryası 18 + yapısal pin + mutasyon.
- K1 (9): §3.8 — ağ öneki saf · `networkSignals` pencereler / keyFp / altyapı koruması · IP-yalnız < 60 değişmezi · kayıt izi (ham IP yok, fail-open) ·
  hesap silme SetNull + 90 gün süpürge · K1-B denemeyi bitirmez (kırmızı-önce: bugün bitiriyor) · `trial-block` rota yetki / bürünme / geri ver ·
  `acceptedIp` yapısal pini + E1/E9 · mutasyon.
- L2/L3 (12): §4.8 — çözümsüz onay 409 · replace · separate · yarış 409 · kiracı · plan sınırı · geri al temizlemesi · eski değer öğrenmesi · `kbOverlaps`
  saf · L3 işaret kuralı · bilinçli pin güncellemeleri · mutasyon (4 mutant).
- Ortak: her paket için `prisma migrate diff` sıfır fark + dolu-tablo provası (test değil, yayın kanıtı); `npm test` paralel kapı + build yeşil.

### 5.4 Değişmez listeleri — paket başına özet
| Liste | I1 | L5 | K1 | L2/L3 |
|---|---|---|---|---|
| E1 dışa aktarma | seçime `topic` | seçime `channelSenderRole` (öneri) | `SignupNetworkTrace` EXCLUDED (gerekçeli) | seçime `supersededById/At` (öneri) |
| E2 konuşma birleştirme | değişmez (model zaten listede) | değişmez | değişmez | değişmez |
| E3 süpürge kanaryası | değişmez | **Message 17 → 18 + yorum** | değişmez | değişmez |
| E4 dış kimlik tekilliği | değişmez | değişmez | değişmez (tekil yok) | değişmez |
| E5 hesap silme | değişmez | değişmez | SetNull bilinçli istisna (TrialIdentity emsali) | değişmez |
| E6 misafir silme | söz satırıyla gider | mesaj satırıyla gider | — (ev sahibi verisi) | — |
| E7 test DB temizliği | — | — | `signupNetworkTrace.deleteMany()` | — |
| E8 süpürge | mevcut söz saklaması | — | 90 gün süpürge | mevcut taslak saklaması |
| E9 rota envanteri | — | — | `admin/trial-block` | — (yeni rota yok) |
| E10 saklama belgesi | — | — | satır | — |

### 5.5 Kurucuya sorulacaklar (EN AZ — 4 soru, her birinde örnek yukarıda)
1. **I1-S1** (§1.9): elle kaydedilmiş konusuz söz + aynı saatte konulu öneri → (a) birleşir ve konu yazılır [önerim] · (b) hiç birleşmez · (c) elle
   forma isteğe bağlı "Konu".
2. **L5-S1** (§2.10): kanalın (Hospitable) otomatik mesajı da bizim otomatik mesajlarımız gibi "cevap değil" sayılsın mı (yapay zekâ bekleyen soruyu
   cevaplar, açık iş panoda kalır) — alan doğrulamasından sonra [önerim evet].
3. **K1-S1** (§3.9): aydınlatma cümlesi + saklama 90 gün [önerim] / 30 gün + ham `acceptedIp` bu amaçla kullanılmaz (doğrulama).
4. **K1-S2** (§3.9): operatör "Denemeyi bitir" → müşterinin ayarlarda göreceği metin.
L2 / L3 için soru YOK (§4.9: yalnız ev sahibi ekranını etkileyen tek yorum yapılıp haber verilir).

### 5.6 Doğrulanamayanlar
- Hospitable mesaj nesnesinde otomasyonu ayıran alan ve değerleri (belge bu ortamdan açılamadı; fikstürler yalnız guest / host) — L5 2.2 adımı.
- Prisma 6'nın büyük `Message` tablosuna boş kolon eklerken kilit süresi (PG 11+ meta-veri değişikliği beklenir; canlı satır sayısı ~17.462 —
  CLAUDE.md 09-19 yedeği; ölçülmedi).
- `firstBreakdownDevice`'ın EV SAHİBİ cümlelerinde (misafir şikâyeti için yazıldı) konu isabeti — §1.8 test 7 ölçecek; kaçan konu NULL'a düşer
  (güvenli yön: bugünkü birleştirme).
- K1 ağırlıklarının gerçek yanlış pozitif oranı: canlı veri yok (Railway kapalı); ilk 30 gün yalnız liste + operatör kararı (otomatik işlem yok).
