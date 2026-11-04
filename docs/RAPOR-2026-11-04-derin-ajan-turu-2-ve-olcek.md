# Derin ajan turu 2 + ölçek analizi — 2026-11-04 akşam

> Kurucu: "gene agentlar gönder çok derin sert uzun uzun" · "ölçeklenebilirlik için kod analizi yaptır, 2 tane çok derin AI yeterli".
> 5 derin ajan (A kod kapıları kırmızı takım · B ödeme · C rezervasyon / takvim / görev · D kimlik / KVKK / operatör · E güvenilirlik /
> performans) + her biri için ayrı çürütücü doğrulayıcı, ardından 2 çok derin ölçek ajanı (mimari / eşzamanlılık · veritabanı / sorgu /
> dizin — gerçek PostgreSQL'de 500 ve 5.000 dairelik sentetik veriyle ölçüm). Bütün bulgular kodla sınandı. Bu repo PUBLIC olduğu için
> güvenlik bulgularının ayrıntısı yazılmadı — yalnız özet; ham dosyalar oturumun çalışma klasöründe (repoya girmez).

## 0. Rakamlarla

| Ajan | Bulgu | Doğrulamada | En yüksek (düzeltilmiş) |
|---|---|---|---|
| A kapılar kırmızı takım (~900 ölçülmüş girdi) | 22 + 5 kaçırılan | 19 doğru · 3 kısmen · 0 yanlış | yüksek (A-1, A-2, A-3, A-4) |
| B ödeme | 5 + 8 şüphe + 4 kaçırılan | 3 doğru · 2 kısmen | orta (B-1) |
| C rezervasyon / takvim / görev | 13 + 3 kaçırılan | 11 doğru · 2 kısmen | orta (C-11, C-4, C-1) |
| D kimlik / KVKK / operatör | 5 + 5 karar notu + 3 kaçırılan | 3 doğru · 2 kısmen | orta (D-5) |
| E güvenilirlik / performans | 10 + 5 şüphe + 4 kaçırılan | çoğu doğru, 3 iddia yanlış | bugün orta, ölçekten önce yüksek (E-1) |
| Ölçek 1 — mimari | M-1…M-4 + kapasite modeli + 11 dilimlik plan | kodla doğrulandı (M-1 ölçüldü) | yüksek (M-1, M-2, M-4) |
| Ölçek 2 — veritabanı | DB-1…DB-14 (gerçek PostgreSQL ölçümü) | DB-1, DB-4 kodda doğrulandı | yüksek (DB-1) |

## 1. Bu turda YAPILANLAR (testli; mutasyonda yaşayan mutant kalmadı)

| Ne | Neden | Kurucu |
|---|---|---|
| **S1** — cevabımız yazılırken platformda yazılan misafir mesajı konuşmayı "Yeni" bırakır; acilse ev sahibine acil uyarı + Sorunlu. Yapay zekâ o geç mesaja kendiliğinden cevap vermez (ev sahibi Airbnb uygulamasından görüp cevaplamış olabilir — çift cevap riski). Bu konuşmalar oto-yanıt aday yuvasını yemesin diye "zaten cevaplandı" kararı damgalanır. | Tur 1 F2 | onay 11-04 |
| **S2** — `QR_ESCALATION_EMAIL_ENABLED=1` açılış listesinde | Tur 1 F3 | onay 11-04 |
| **B-2** — daire sayısı plan sınırını aşan hesap o planı alamaz / o plana düşemez ("Hesabınızda 7 daire var; Başlangıç planı en fazla 2 daire içindir. Daha büyük bir plan seçin ya da önce daire sayısını azaltın.") | Tur 2 B-2 | "kesinlikle hata" |
| **B-1** — eski aboneliğin sonraki aktif olayı (ör. dönem sonu iptali) yeni, ödeyen aboneliğin yerini almaz; KESİN eskiyse olay uygulanmaz + operatöre alarm. Bilinmezse bugünkü davranış. | Tur 2 B-1 | "kesinlikle hata" |
| **A-3** — "Ocağın hortumundan gaz sızıyor", "Gaz vanasından gaz kaçıyor", "Es riecht nach Rauch beim Herd": ekipman adı yanında geçti diye canlı kaçak artık "anılış" sayılmaz, kelime ağının acil etiketi model sorulmadan kalkmaz. "Gaz ocağı var mı?" yine zararsız. Kuralınız K-1029-C'yi uygular (sözcük ağı yalnız sıkılaştırır). | Tur 2 A-3 | kuralınızın uygulanması |
| **A-11** — kaçan "bilgim yok" biçimleri (Arapça "ليس لدي هذه المعلومات", "I don't have the answer to that", kesmesiz "I dont know", "I wasn't told", "Bu bilgi bana iletilmedi", "bilgilendirilmedim") artık misafire gitmez. Ölçüm külliyatındaki 11.998 gerçek model cevabında yeni tutuş 0 (yanlış tutma yok). "You were not given a key? Let me check." gibi misafire soru tutulmaz (pinli). | Tur 2 A-11 | kural 09-11'in uygulanması |
| **DB-1** — oto-yanıt aday sorgusunda sıralama veritabanından koda alındı: büyük veride bütün konuşma tablosunu en eskiden tarıyordu (sentetik 5.000 dairede işletme başına geçiş 320–420 ms → ~1 ms). Seçilen 25 konuşma ve sıra aynı. | Ölçek DB-1 | — (misafire giden değişmez) |
| **DB-4** — büyük işletmede (≈150+ daire) Raporlar sayfası çöküyordu (veritabanının 32.767 parametre sınırı); sorgu dilimlere bölündü. 33.000 mesajlı testle pinli. | Ölçek DB-4 | — |
| **M-4** — "acil uyarı geçişi yapay zekâdan ÖNCE koşar" kuralı yalnız satır sırasıyla sağlanıyordu; artık testle pinli (ölçek tasarımı döngüyü bölerse kırmızıya döner). | Ölçek M-4 | — |
| Açılış listesine `pool_timeout=20` | video notları | — |

İlk denemeler birlikte: B-1'in dayandığı Paddle alanı (`created_at`) sandbox'ta doğrulanacak.

Not (test düzeltmesi, ürün değil): tam kapıda S1 sonrası 3 test kırmızıya döndü. Sebep testin zaman kurgusuydu — cevabımız 3 hafta önceki sabit
tarihle yazılıyor, misafir mesajı ise "şimdi" içe alınmış sayılıyordu (gerçekte olamayacak sıra). İçe alınma anı testin anlattığı adım sırasına
göre yazıldı; iddiaların hiçbiri gevşemedi.

## 2. KURUCUYA SORULAR (müşteriye / misafire gideni ya da zamanlamayı değiştirir)

### T1 — Model çalışmadığında açık tehlike ev sahibine bildirilmiyor (A-1, A-2, A-4, K-1, K-2, K-3) — EN ÖNEMLİ
Otomatik cevap kapalıyken, mesai dışında ya da fatura duraklamasında model hiç çalışmaz; ev sahibine giden tek bildirim kelime yoludur.
Bu yol şunları görmüyor (ölçüldü):

| Misafir yazar | Bugün | Önerim |
|---|---|---|
| "Annem bayıldı, nefes almıyor" (7 dilde tıbbi acil) | ev sahibine hiçbir şey | acil e-posta (+ WhatsApp hibrit) + Sorunlu |
| "Ev yanıyor" · "Ocağın üstünde alev var söndüremiyoruz" · "Çocuğu akım çarptı" | tehlike okuyucusu "açık tehlike" diyor ama uyarı yolu ona bakmıyor → hiçbir şey | aynı |
| "Tüp gaz kaçırıyor" · "Ich rieche Gas" · "Gas is leaking from the stove" · "Musluktan su fışkırıyor" · "boru patladı" | hiçbir şey | aynı |

Dikkat edilecek yanlış alarm: "Bayıldım" (övgü), "Yerden ısıtma yok mu?" — öneri yalnız EYLEM / DURUM bildiren öbekle (10-31 kişisel tehlike
deseniyle aynı: koşul / soru / önlem cümlesi uyarı DEĞİL) + bugünkü yanlış alarm kör setinde 0 sınırı. Misafire giden metin DEĞİŞMEZ. Yapalım mı?

### T3 — QR'da kapı kodunun bazı yazımları rezervasyon öncesi süzgeçten geçiyor (A-16)
"45-90", "Kilit: 1234", yazıyla kod: ev sahibi kodu Giriş / Wi-Fi dışında bir kategoriye yazdıysa rezervasyon onaylanmadan QR'da misafire
gidebilir. Önerim: süzgecin biçim ailesini genişletmek (yalnız SIKILAŞTIRIR — kod içeren cevap tutulur). Yapalım mı?

### T4 — Misafire "187'yi arayın" / "acile gidin" gidebiliyor (A-12)
Kuralınız (10-11): misafire hiçbir durumda "112'yi / polisi / ambulansı arayın" yazılmaz. Veto 187 (doğalgaz), "112 ile iletişime geçin",
yazıyla numara ve "acile / hastaneye gidin"i kaçırıyor. Önerim: numara ailesi + "iletişime geçin" biçimi vetoya. "Acile gidin" yönlendirmesi
kuralın içinde mi?

### T5 — Otomatik mesajlar (C)
- **C-11:** misafir konaklamayı ikinci rezervasyonla uzatınca ilk rezervasyonun çıkış sabahı "bugün çıkış" mesajı gider + dolu daireye çıkış
  temizliği açılır. Önerim: aynı misafirin bitişik rezervasyonunda ara çıkış mesajı / temizliği yok.
- **C-1:** karşılama / giriş / çıkış göndericileri ilk 25 adayı alıp sonra eler; gönderilemeyen (metni olmayan daire) sırayı tutar → karşılama
  haftalarca gecikebilir. Oto-yanıttaki aynı düzeltme (uygunluk sorguda). Önerim: yap.
- **C-3:** konaklama başladıktan sonra iptal edilen rezervasyonun çıkış temizliği siliniyor → sonraki misafir temizlenmemiş daireye. Önerim:
  başlamış konaklamanın çıkış temizliği silinmez.
- **C-4:** Airbnb iptal edince iCal'den etkinlik kalkıyor, rezervasyon ve görevleri onaylı kalıyor; ev sahibi hiçbir şey görmüyor. Önerim:
  "takvimde artık yok" uyarısı (iptal ETMEDEN — yalnız görünür).
- **K2:** karşılama / giriş / çıkış şablonları "Sorunlu" konuşmaya da gidiyor ("su bastı" gecesinin sabahı "Bugün çıkış günü"). Sorum: Sorunlu
  konuşmada şablon mesajları dursun mu?
- **C-6:** giriş bilgisi mesajı İstanbul'da gece 03:00'te gidebiliyor. Önerim: 09:00–21:00 penceresi.

### T6 — Ödeme kalanları (B)
- **Operatör aracı yok:** "bağlanamayan ödeme" alarmı "aboneliği bağlayın" diyor ama bağlayacak araç yok. Önerim: operatör panelinde
  "aboneliği işletmeye bağla" (yalnız süper yönetici + 2FA + denetim kaydı).
- **Kaybolan iptal = süresiz erişim:** durum "active" kaldıkça dönem sonuna bakılmıyor; otomatik mutabakat yok. Önerim: günlük mutabakat —
  dönem sonu 3+ gün geçmiş "active" satırlar Paddle'dan okunur, uyuşmazlıkta YALNIZ operatöre alarm (müşteriye dokunmaz).
- **B-5:** 24 saati geçmiş onayla ödeme bağlanmaz ve müşteri ikinci kez ödeyebilir. Önerim: bağlanamayan ödemede işletmeye "ödemeniz kontrol
  ediliyor" kilidi.

### T7 — Kimlik / KVKK (D) — ayrıntı iç dosyada
- **D-5:** "Konuşmayı sil" görev başlığındaki misafir adını ve görev açıklamasındaki ham mesajı bırakıyor. Önerim: konuşma silinince bağlı
  görevlerde ad / mesaj maskelenir (görev kalır).
- **D-4:** 2FA kapatma / sıfırlama / kurtarma koduyla giriş hesap sahibine bildirilmiyor. Önerim: tek satırlık güvenlik e-postası.
- **D-1:** operatörün açtığı hesapta şifre operatörde kalıyor. Önerim: ilk girişte şifre değiştirme zorunluluğu + davet bağlantısı.

## 3. ÖLÇEK — 500 → 5.000 daire

### 3.1 Kısa cevap
- **Bugünkü yapı 500 daireyi taşımaz.** Her şey (mesaj içe aktarma, acil uyarı, oto-cevap, karşılama, takvim, süpürgeler) tek kilit altında
  tek sıralı döngüde. Model (ölçüm değil): 500 dairede akşam 19–22 acil uyarı gecikmesi p50 / p95 **39 / 77 dk**; OpenAI takılırsa **52 / 98 dk**.
  5.000 dairede gün sonu ~27 bin cevapsız mesaj.
- **Döngüyü ikiye ayırmak** (senkron + acil uyarı ayrı, model çağrıları ayrı), hiç paralellik eklemeden: acil p95 77 → **26 dk**, p50 39 → **9 dk**;
  OpenAI takılması acil uyarıyı artık etkilemez. 4 hızlı işçiyle acil p95 **~4,5 dk**; çoklu mülk isteği + toplu ön okuma ile **~2 dk**.
- **500 dairede asıl maliyet her daire için ayrı Hospitable rezervasyon isteği** (tur başına 500 × 0,6 sn = 300 sn) — veritabanı ya da model değil.
- **Veritabanı 500 dairede tıkanmıyor.** 5.000 dairede ilk boğulacak yer oto-yanıt aday sorgusuydu (DB-1 — DÜZELTİLDİ).
- **5.000 daire yoklamayla taşınamaz:** her iyileştirmeyle işçiler %100 dolu, döngü 4–5 dk. Hospitable web kancasıyla acil < 0,5 dk.
- **Gerçekçi büyük müşteri 25 daire** (en büyük ücretli paket); 200 dairelik satırlar yalnız sınırsız eski hesaplar ya da ileride kurumsal paket için.
- İlk 5 dilimin hiçbiri müşteriye giden METNİ değiştirmiyor; zamanlamayı değiştirenler aşağıda soru olarak.

### 3.2 Sizden karar / onay gerekenler (sırayla)
| # | Konu | Önce → sonra | Neden soruyorum |
|---|---|---|---|
| Ö-1 | **Kapanış sinyali** (M-1): kapsayıcıda 1 numaralı süreç `sh`; yayın sırasında kapanma sinyali Node'a hiç ulaşmıyor, her yayın zorla öldürmeyle bitiyor (ölçüldü). Düzeltme açılış satırının son adımını `exec node …` yapmak. | Bugün: yayın anında süren geçiş yarıda ölür, senkron kilidi 15 dk dolu kalır (o sürede içe aktarma + acil uyarı durur). Sonra: sinyal gelir, ardından zarif kapanış eklenebilir. | Açılış zinciri — Railway açılışında ilk test yayını birlikte. |
| Ö-2 | **Hospitable istek sayısı** (M-2): `per_page` hiç verilmiyor, çoklu mülk sorgusu destekleniyor ama kullanılmıyor; koddaki not "50 istek / 5 dk" diyor → ~19 daireden büyük tek işletme sınırı aşabilir. | Daire başına istek → 10 dairelik grup başına istek; 429'da kilit tutularak uyumak yerine işletme sonraki tura ertelenir. | Hospitable belgesiyle doğrulanmalı (sınır token başına mı, sayfa boyu kaç); ilk deneme kurucu org'da. |
| Ö-3 | **Uyarı filigranı** (M-4, ayrımın ön koşulu): döngü ayrılınca "kelime ağı uyarısı yapay zekâdan önce" garantisi işletme başına bir işaretle korunur. Filigran "uyarı DENENDİ" mi saysın, "tarama TAMAMLANDI" mı? | ÖRNEK: e-posta sağlayıcısı yavaşladı, uyarı geçişinin 60 sn tavanı doldu → "denendi" (bugünkü davranış): oto-cevap yine gider · "tamamlandı" (daha güvenli): o işletmenin oto-cevapları bir sonraki taramaya (≤ 2 dk) kalır. | Zamanlama değişir. Önerim: "tamamlandı". |
| Ö-4 | **Ayrı döngüler** (`SCHEDULER_V2_ENABLED`, bayrakla): hızlı (senkron + uyarı + karşılama/giriş/çıkış) · yapay zekâ · yavaş (süpürgeler). | ÖRNEK: 14:58'de 25 konuşma cevap bekliyor, giriş talimatı 15:00'te gitmeli → bugün oto-cevaplar bitene kadar bekler (dakikalar); sonra giriş talimatı zamanında gider. | Zamanlama değişir (daha erken). |
| Ö-5 | **Hospitable web kancası** (5.000 daire için zorunlu; CLAUDE.md "kurmak yeni sistem → önce sor"). | Mesaj içe aktarma olaya dayalı, yoklama yalnız 30 dk'lık uzlaştırma. | Yeni sistem. Amaç Hospitable'dan ayrılmak olduğu için sırası Airbnb Direct'e göre belirlenmeli. |
| Ö-6 | **Gönderilenler sayfası** (DB-3): zaman penceresi yok, işletmenin bütün geçmişini sıralıyor (25 dairede ~0,4 sn, yıllar içinde büyür). | Son 90 gün penceresi (sayfalama zaten var) ya da sayımı "son 90 gün" diye etiketlemek. | Ev sahibinin gördüğü liste değişir. |
| Ö-7 | **Görevler sayfası** (DB-7): açık sistem görevleri birikince sayfa 25 dairede 0,15 sn, 200 dairede 1,2–1,7 sn. | Geçmiş tarihli sistem görevleri katlansın mı / kendiliğinden kapansın mı? | Ev sahibinin görev listesi değişir. |
| Ö-8 | **Veri büyümesi** (DB-10): 9 büyük tablo hiç budanmıyor; 5.000 dairede yılda ~10,5 GB, en büyüğü kimsenin 3 günden eskisini okumadığı içe alma olay günlüğü. | Olay günlüğü 30 gün; risk / karar kayıtları için saklama süresi? | Saklama kararı (KVKK ile birlikte). |
| Ö-9 | **KVKK süpürgesi** (DB-8): saklama seçicisi her saat bütün eski geçmişi tarıyor; "mesaj yaşı" bayrağı açılınca her saat bütün mesaj tablosu. Öneri: süreye 1 gün gecikme eklemek. | Süre "N ay" yerine "N ay + 1 gün". | Avukat onayı. |
| Ö-10 | **Tutar onarımı** (DB-5): para kolonu geçiş döneminden kalan onarım her 2 dakikada bütün rezervasyon tablosunu tarıyor (5.000 dairede 126 ms/geçiş). Her geçişte koşması daha önce bilinçli alınmış ve testle pinlenmiş bir karar (Codex #26). | Geçiş dönemi kapandıysa onarım kaldırılır ya da saatliğe alınır. | Önceki karar; dokunmadım. |
| Ö-11 | **Konuşma öğesi dizini** (DB-6): saatlik silme işi dizinsiz (490 ms → 0,02 ms). | Yalnız-ekle dizin migration'ı. | Migration = taze yedek + açık onay. |
| Ö-12 | **Veritabanı zaman aşımları** (DB-11): sorgu / boşta-işlem zaman aşımı yok. | Railway açılınca 1 gün `pg_stat_statements` ile ölç, sonra `statement_timeout=30s`, `idle_in_transaction_session_timeout=5min`. | Veritabanı ayarı; açılışta birlikte. |
| Ö-13 | **Anlama katmanına devre kesici** (E-3): OpenAI takıldığında cevap çağrısı kesiciyle anında düşüyor ama anlama çağrısı her konuşmada 12 sn bekliyor (25 konuşma ≈ 6 dk / işletme / geçiş). | Anlama katmanı da aynı türden kesiciye bağlanır: takılmada sonuç bugünkü "zaman aşımı" ile aynı (anlama yok → güvenli taraf), yalnız bekleme kalkar. | Misafire giden değişmez; ama 10-21 kesici kararınızın kapsamını genişletir — yapayım mı? |

### 3.3 Müşteriye dokunmadan sıradaki işler (haber vererek yapılacak)
- **DB-9:** `distinct` kullanan 11 sorguda Prisma sınırı veritabanına koymuyor, bütün eşleşen satırları çekiyor (karşılama / giriş / çıkış adayları).
- **DB-2:** veritabanının ortak plan önbelleği küçük işletmeye büyüğün planını ödetiyor (rapor sorgusu 1 → 67–78 ms) — DB-1 ve DB-3'ten SONRA
  veritabanı ayarıyla (`plan_cache_mode`), önce ölçüm.
- **DB-13:** sürenin çoğu veritabanında değil Prisma'nın satırları nesneye çevirmesinde (geniş `include`); görevler sayfası ilk aday.
- **D-2** (ret kaydına hız sınırı) · **B mutabakat alarmı** (yalnız operatör) · **E-2a** (kuyruğa yazınca hızlı uyandırma, kuyruk açılmadan önce).
- Aynı sınıfta kalan: Gönderilenler sayfası ve rapor sayımındaki "teslim edilmemiş" `notIn` listesi — kuyruk bayrağı kapalıyken tablo boş;
  kuyruk açılmadan önce DB-4 gibi dilimlenmeli.
