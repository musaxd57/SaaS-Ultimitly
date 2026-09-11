# KARAR — kurucu iş emri (2026-09-11), 10 ölçüm ajanı

> Kurucu `/loop`u saatlik kurdu ve üç soruyu bana bıraktı ("sen seç … agentlara sor").
> Bu belge **kararları** ve **dayanaklarını** taşır. Ajanlar yalnız ölçtü; kodu Claude yazdı;
> her iddia dosya:satır ile kodda doğrulandı.

---

## KURUCUNUN ÜÇ SORUSUNA CEVAP

### 1) Otomatik mesajlar varsayılan AÇIK olsun mu?

> *"sen seç nasıl olsa direk açık olsada riskli birşekilde en iyi şekilde ayarla agentlar bilgi
> başka markalar nasıl yapıyor baksın ona göre karar verin"*

**KARAR: HAYIR, varsayılanı çevirme. Asıl kusur varsayılan değil, BİLGİ TABANI'NDAKİ KOŞULSUZ VAAT.**

Üç ölçülmüş gerekçe:

1. **Varsayılanı çevirmek bugün SESSİZ BİR NO-OP.** `*EnabledAt` baseline kolonlarının tek yazıcısı
   `api/settings/route.ts:73-75` ve yalnız gerçek OFF→ON geçişinde yazıyor. Üç göndericinin üçü de
   baseline yoksa hiçbir şey yapmadan dönüyor (`automation.ts:2880-2881 · 3048-3049 · 3328-3329`).
   Şema varsayılanı `true` olsaydı **anahtar "Açık" derdi, sıfır mesaj giderdi** — bugünkü
   "Kapalı + gitmiyor" hâlinden DAHA KÖTÜ, çünkü yalan söyler.
2. **Baseline'ı da org-create'e eklemek GERÇEK BİR SIZINTI AÇAR.** `KB_PRESETS`in iki TRIGGER
   şablonunun İKİSİ de doldurulmamış köşeli parantez taşıyor (`kb-manager.tsx:46` → `[AÇIK ADRES]`,
   `[ZİL / KAPI KODU TARİFİ]`, `[ANAHTAR TESLİM ŞEKLİ]`; `:74` → `[ANAHTAR BIRAKMA YERİ]`). Bu yol
   **modelden HİÇ GEÇMEZ** (`kb-review.ts:54-55`: "içerikleri misafire AYNEN gönderilir"), dolayısıyla
   ürünün tek `[…]` koruması (`prompts.ts:828-841`, bir MODEL İSTEMİ notu) devrede değil →
   misafir ham `Adres: [AÇIK ADRES]` okur.
3. **Piyasa 8/8 aynı yönde**, ve bizde emsalden bir kapı EKSİK:

| Ürün | Kurulum varsayılanı | Koruma |
|---|---|---|
| Hospitable | 7–10 hazır şablon **oluşturulur**, her kural **pasif doğar** | kural bazlı toggle + "prepared" bekleme durumu |
| Guesty | otomasyon yok doğar | **"Save and activate" ↔ "Save as draft"** ayrı düğmeler |
| Hostaway | *"New automations are kept deactivated"* | otomasyon başına toggle |
| Lodgify | kapı kodu mesajı **varsayılan KAPALI** | bildirim başına zamanlama |
| Uplisting | hazır set var, **host enable eder** | ilan başına yapılandırma |
| Enso Connect | self-serve varsayılan yok | insanlı onboarding |
| Touch Stay | mesaj göndermez | teslim host'un PMS'inde kurulur |
| Smartbnb | = Hospitable | — |

Desen: **hazır içerik VER, göndermeyi AÇMA.** Hiçbir üründe "host içeriği doldurmadan misafire gider"
davranışı bulunamadı.

**YAPILACAK (ayrı dilim):** ① `kb-manager.tsx:395-399`'daki *"Bu metin misafire otomatik gönderilir."*
vaadi bayrak durumuna bağlanır (bileşen bugün org ayarını **props olarak almıyor bile**) · ② `[…]`/`{{…}}`
taşıyan kalem gönderici tarafında elenir (fail-closed) ve host'a söylenir · ③ ölü `previewWelcomes/
previewCheckins/previewCheckouts` (yazılmış, `src/` içinde **sıfır çağıranı var**) Ayarlar kartlarına bağlanır.

---

### 2) Aktif saat aralığı — host'a söylemeye gerek var mı?

> *"söylemesine gerek var mı? … önemli olan o adam oynatıyorsa değiştiriyorsa onluk sorun yoktur"*

**KARAR: Uyarı bandı EKLEME (kurucu haklı, gürültü olur). Ama VARSAYILAN DÜZELTİLMELİ — ve bu
migration ister, yani KURUCU ONAYI bekler.**

Ölçüm:
- Şema varsayılanı `autoReplyStartHour=0 / autoReplyEndHour=9` (`schema.prisma:130-131`) ve `isWithinActiveHours`
  bunu **"AI yalnız 00:00–08:59 arası çalışır"** diye okur (`automation.ts:811-815`) → günün **15 saati SUSAR**.
- Yeni org 7/24 doğuyor (`NEW_ORG_AUTO_REPLY_WINDOW = {0, 0}`, `constants.ts:247`) ama bu **yalnız uygulama
  katmanında ve yalnız iki rotada**; şema varsayılanı hâlâ gece-only ve **tuzak olarak duruyor**.
- 55 migration tarandı: bu iki kolona dokunan **hiçbir UPDATE/backfill yok** (`00_init/migration.sql:35-36`
  dışında hiçbir eşleşme). Yani 07-31 düzeltmesinden ÖNCE kurulan her org — **kurucu org dâhil**, kodun kendi
  yorumu bunu yazıyor (`automation.ts:2562-2563`) — hâlâ 0/9.
- Bedeli: saat 09:05'te gelen soru en erken ertesi gün 00:00'da cevaplanır (**~15 saat**); misafir o gece
  yarısından önce çıkarsa `reservation_ended` ile **hiç cevaplanmaz**. Bu arada landing üç yerde "7/24" diyor.

**Neden uyarı değil düzeltme:** kurucu "adam oynatıyorsa sorun yok" dedi — doğru okuma bu. Sorun host'un
*bilinçli seçimi* değil, **hiç ellemediğinde başına gelen şey**. O yüzden çözüm ekrana metin eklemek değil,
varsayılanı düzeltmek. ⚠️ **Migration + taze `pg_dump` + açık onay gerekir** (dar UPDATE: yalnız
`startHour=0 AND endHour=9` olan, yani hiç ellenmemiş satırlar; host'un seçtiği her pencere dokunulmaz).

Ücretsiz yan düzeltme (ayrı, migration'sız): bileşen adı `NightHoursForm` ve ikonu `Moon` — semantiği
**TERSİNE** okutuyor ("gece sussun"), üstelik varsayılanın kendisi bir gece penceresi olduğu için yanlış
okuma kendini doğruluyor.

---

### 3) Oto-yanıt anahtarı Ayarlar'a mı taşınsın? Alt anahtarlar kilitlensin mi?

> *"zaten oto yanıtı açmadan giriş çıkış mesajları gidebiliyor mu … sen seç agentlara sor."*

**Kurucunun sorusunun cevabı: EVET, GİDİYOR. Sezgisi doğruydu ve kafa karışıklığı gerçek.**

Ölçüm: üç göndericinin org sorgusu `autoReplyHospitable`'ı **SELECT ETMİYOR bile**
(`automation.ts:2866 · 3037 · 3310`). Kapı yalnız AI'ın misafir mesajına CEVAP VERME yolunda
(`automation.ts:1367 · 2546`). Bu tesadüf değil, **altı test dosyasıyla davranışsal olarak pinli**.
Dördüncü bir otomatik mesaj (bekletme ack'i) da aynı kapının dışında (`automation.ts:3668`).

**KARAR (üç parça):**

- **(a) Anahtar Ayarlar'a KOPYALANIR, taşınmaz.** Inbox'taki düğme bir olay anında AI'yı durdurmanın en hızlı
  yolu; silmek yeteneği siler. Bileşen durumsuz ve her PATCH sonrası `router.refresh()` yapıyor → iki mount
  ayrışamaz. **Bu ayrıca ölü bir onboarding adımını kapatır:** dashboard *"Otomatik yanıtı açın"* diyip
  `/settings`'e gönderiyor (`dashboard/page.tsx:167`) — **ve anahtar orada değil.** Çıkmaz sokak.
- **(b) Alt anahtarlar KİLİTLENMEZ.** Salt-UI kilit **YALAN SÖYLER** (mesajlar gitmeye devam eder) — tam olarak
  `dashboard/page.tsx:150-153`'ün yasakladığı hata sınıfı. Gerçek sunucu kapısı ise **sessiz bir davranış
  değişikliğidir**: bugün karşılama/giriş/çıkış gönderen ama AI cevabını açmamış her org'da o mesajlar
  **sessizce durur** (canlı dağılım bu ortamdan ölçülemez).
- **(c) Kafa karışıklığı KİLİTLE değil DÜRÜST ADLA çözülür.** Inbox'taki düğme "Oto-yanıt" değil
  **"AI misafir mesajlarını yanıtlasın"** demeli; üç otomatik mesaj kartının bağımsız olduğu yazılmalı.
  Gerçek bir master isteniyorsa `@default(true)` **YENİ** bir kolon açılır (mevcut `autoReplyHospitable`'ı
  master'a terfi ettirmek canlı org'ları sessizce durdurur — şema varsayılanı `false`).

---

## KURUCUNUN AÇIK SORULARINA CEVAP

### "Sorunlu yaparsa AI o kişiyle sohbeti bırakıyor mu? Bir daha yazıyor mu?"

**EVET, bırakıyor — ve KALICI.** Üç katman: aday kümesi yalnız `status:"new"` seçer
(`automation.ts:2494`) · erken dönüş (`:1344`) · gönderim vetosu (`worker.ts:434`).
**Misafirin yeni mesajı GERİ AÇMAZ** (`write-service.ts:269` `preserve` listesi `problem`'i içerir).
Geri açan iki yol: host durumu elle değiştirir, ya da **host elle cevap yazar** (`reply/route.ts:227`
koşulsuz `answered` yazar).

### "Önceliği hâlâ anlamadım, gerçekten yararlanıyor muyuz?"

**HAYIR — `Conversation.priority` TAMAMEN GÖRSEL.** Dört render noktası dışında (inbox ikonu, iki QR
rozeti, seçim kutusu) hiçbir sorguyu, sıralamayı, bildirimi, oto-yanıt kararını ya da raporu etkilemiyor.
`modules/intelligence/` içinde **sıfır** referansı var. "Acil" şikâyet e-postasına bile yazılmıyor:
`email-templates.ts:172-177` alanı **tanımlıyor ama gövdede hiç render etmiyor**.
Üstelik `urgent` ikonu pratikte `problem` rozetinin ikinci kopyası — ikisini yazan kod AYNI
(`automation.ts:1088` ve `:1822` ikisini birlikte yazıyor).
⚠️ `PRIORITY` sabiti **Task** tarafında GERÇEKTEN iş yapıyor (sıralama + e-posta) → sabit silinemez,
yalnız konuşma yüzeyinden sökülür.

### "Beklemede" (kurucu: "2.yap")

**Kaldırılıyor — ve bedava bir kazanç var:** "Beklemede" bugün **belgelenmemiş bir AI KİLİDİ**.
`dueAutoReplyWhere` yalnız `status:"new"` seçtiği için host "Beklemede" dediğinde oto-yanıt o thread'i
bir daha **hiç** seçmiyor; hiçbir yerde bu yazmıyor, `problem` gibi bir rozet/veto da yok.
Migration **GEREKMEZ** (kolon düz `TEXT`, Postgres enum yok — `00_init/migration.sql:165`).

---

## BU TURDA KODLANANLAR

| # | İş | Migration | Bayrak | Ücretli servis |
|---|---|---|---|---|
| 1 | **RAG VARSAYILAN AÇIK** — `KB_RETRIEVAL_MODE` artık acil durdurma düğmesi | yok | yön değişti | yok |
| 2 | QR host paneli: **Enter = gönder** · **30 sn otomatik yenileme** (liste + detay) · mesajlar **kendi kaydırma kabında** + en sona konumlanma · emoji → gerçek ikon (**AI'ın yüzü artık BİZİM LOGOMUZ**) · yazma kutusunda **önceden uyarı** ("siz yanıtlarsanız AI susar") | yok | yok | yok |
| 3 | **Acil durum ≠ sıradan istek** — `escalationReply({critical})`; ölçüt deterministik `detectRiskType` | yok | yok | yok |
| 4 | **Bağlam penceresi `.slice(-6)` kalktı** — tavan 25 + 6.000 karakter bütçe + **güvenlik penceresi bütçeye tabi değil** (displacement saldırısı) | yok | yok | yok |
| 5 | **Kaydırma çubuğu görünür** — başparmak `--border` (kontrast ≈1,2:1) → `--muted-foreground`; oluk artık GERÇEK bir kanal | yok | yok | yok |
| 6 | Landing demo: **8 çip**, saatlik hak 6 → 12 (çip sayısından büyük), limit **ekranda yazılı**, bütçe **doğrulamadan sonra** tüketilir | yok | yok | yok |

### 🚨 Bağlam penceresinin ölçülen darboğazı

`prompts.ts` geçmişi **çıplak `.slice(-6)`** ile kesiyordu ve gerekçesi hiçbir yerde yazmıyordu.
Üç yüzeyin üçü de yukarı akışta çok daha fazlasını taşıyor: oto-yanıt ve inbox öneri konuşmanın
**TAMAMINI**, QR ise özenle kurulmuş **24 mesaj / 8.000 karakterlik** bir pencere
(`guest-chat.ts buildGuestChatContextWindow`). Yani QR'ın penceresinin mesaj bacağı **ÖLÜYDÜ** —
7.–24. mesajlar tam burada atılıyordu ve o kodun kendi gerekçesi ("eski 12'lik tavan ≈6 tur
taşıyordu, yetersizdi") uygulanmıyordu.

Mekanik `-6 → -25` YAPILMADI: sayı değil **bütçe** karar verir (tek 4.000 karakterlik mesaj, 25 kısa
mesajdan pahalıdır) ve **güvenlik penceresi bütçenin dışındadır** — son operatif cevaptan sonraki
cevapsız misafir mesajlarının TAMAMI daima girer, yoksa saldırgan uzun zararsız bir metinle riskli
cümlesini pencereden dışarı iter ve kelime-ağı çapraz kontrolü onu göremez.

---

## EMBEDDING — KURUCU İZNİ VAR, SIRA ÖLÇÜMDE

> *"RAG EKLE ALLAH İÇİN SIKILDIM SANA AÇIKLAMAKTAN VE EMBEDDİNGDE FALANDA PROJEYİ UÇUR."*

Hibrit AÇILDI (yukarıda #1). Embedding için **ölçülmüş** plan:

**Maliyet önemsiz:** `text-embedding-3-small` $0,02/1M token. Kurucu org'un TÜM bilgi tabanını embed
etmek **0,18 sent**; en büyük plandaki en ağır müşteri **3 sent**. Sorgu tarafı mesaj başına 67 token =
sohbet isteminin (**~17.974 token**) **%0,37**'si. Gecikme 80–120 ms, zincirin %5'inin altında.

**Depo kararı: pgvector DEĞİL.** Aday kümesi sorgu başına **≤300 parça** (`kb-fetch` mülk başına çeker,
tavan 200 kalem, plan tavanı 60 kalem/mülk) → brute-force kosinüs **1,37 ms** (ölçüldü). ANN'in çözdüğü
problem bizde YOK; karşılığında Railway'de **prod DB taşıma projesi** istiyor (pgvector mevcut Postgres
servisine kurulamıyor, ayrı template + `pg_dump` + migrate). Yerine **yeni tablo + `Bytea`** (yeni tablo
= güvenli sınıf).

🚨 **ÖNCE İKİ ÜCRETSİZ DÜZELTME (embedding'den bağımsız, bugün yapılabilir):**
1. **`SEMANTIC_QUALIFY_MIN` yok.** n-gram için eşik var (`NGRAM_QUALIFY_MIN = 0.3`) ama semantic için
   `> 0` yeterli (`select.ts:244,253`). Kosinüs pratikte hep > 0 → **her parça `hasEvidence` olur**,
   `no_lexical_hits` geri çekilmesi bir daha ASLA tetiklenmez ve "yalnız-ipucu" ayrımı ölür.
2. **CombSUM embedding ile ezilir.** BM25 seyrek, kosinüs yoğun; min-max normalize edilince her parça
   ~0,6–1,0 katkı alır ve sözcüksel sıra silinir. Embedding kaynağı varken varsayılan **RRF** olmalı.

Ayrıca `SemanticScorer` arayüzü **ölü ve yanlış şekilli** (metni parametre alıyor → doküman vektörü
önbelleklenemez, parça KİMLİĞİ yok). Seçicinin gerçek sözleşmesi olan `ReadonlyMap<chunkKey, 0..1>`
**değişmeden** çalışır ve ağ çağrısını çağırana çıkarır → `select.ts` saf + senkron + DB'siz kalır,
fail-open **yapısal** olur (harita verilmezse bugünkü davranış birebir).

🚨 **Embedding'in en güçlü gerekçesi maliyet ya da hız DEĞİL:** `lexicon.ts` TR+EN'dir; **Rusça ve
Arapça'da sözcüksel eşleşme yapısal olarak YOK** (`no_lexical_hits` → tüm KB'ye fail-open), Almanca/
Fransızca yalnız KAZAEN çalışıyor. Bunu sözlük büyüterek kapatmak her dil için ayrı kök sökücü demek.

---

## AYRI ONAY BEKLEYENLER

| Konu | Neden bekliyor |
|---|---|
| Aktif saat varsayılanı `0/9 → 0/0` + dar backfill | **migration** → taze `pg_dump` + açık onay |
| `KbChunkEmbedding` tablosu (migration 55) | **migration** → aynı kapı |
| Embedding'in canlı yüzeylere bağlanması | misafir SORU METNİ dış API'ye → PII redaksiyonu + OpenAI ZDR kararı (kurucu adımı) |
| Oto-mesaj alt anahtarlarının gerçek sunucu kapısı | sessiz davranış değişikliği, altı test dosyası |
