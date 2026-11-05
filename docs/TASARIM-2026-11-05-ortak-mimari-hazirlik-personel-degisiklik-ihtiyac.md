# TASARIM — Giriş hazırlığı · personel daveti ve iş kabulü · rezervasyon değişikliğinin etkisi · ihtiyaç ↔ görev (2026-11-05)

> Kurucu kararı (H1, 11-05): ilk kullanılabilir teslim konaklama bazlı, SALT-OKUMA giriş hazırlığı listesi; diğer üç başlık ertelenmez,
> dördünün ortak mimarisi baştan birlikte ele alınır; ortak temeller ve bağımsız işler paralel yürür; mevcut sağlam modüller yeniden
> yazılmaz; uçtan uca tamamlanabilir başlangıç. H-2 (erişim satırı) tasarımı Claude'a bırakıldı. H3: personel daveti tasarımı onaylandı —
> ekranlar, e-posta örnekleri, süre aşımı / ret / yedeğe geçiş ÖNCE gösterilecek.
> Kanıt: dört Haiku envanteri (görev · personel · hazırlık girdileri · ihtiyaç ↔ görev) + ana oturumda yeniden okuma; aşağıdaki her "bugün"
> cümlesi kodda doğrulandı.

## 0. Ortak sözlük ve kurallar (dört alanın hepsinde aynı)

| Kavram | Anlamı | Kaynağı |
|---|---|---|
| Konaklama | iptal edilmemiş rezervasyon (`statusClassOf` ≠ ignored) | `Reservation` |
| Devir | gelen konaklamadan önceki çıkış: aynı gün ayrılan, yoksa varıştan önceki son çıkış | `early-checkin/load.ts` (bugünkü kural, aynen) |
| Dayanak | bir durumun dayandığı kayıt: tür + kimlik + zaman | yeni sözleşme (§1 T1) |
| Atandı | görevde sorumlu kişi yazılı | `Task.assignedToId` |
| Kabul etti | sorumlu kişi işi üstlendiğini söyledi | YOK → §1 T2 |
| Başladı | kimlikli "başladım" kaydı | `TaskUpdate` `in_progress` |
| Bitti | kimlikli "bitti" kaydı (sunucu zamanı) | `TaskUpdate` `done` |
| İhtiyaç çözüldü | ev sahibi ihtiyacın karşılandığını işaretledi | `ConversationItem` `host_done` |

**Değişmez kurallar (kurucu):**
1. Eksik veri asla "hazır" sayılmaz; bilinmeyen = BİLİNMİYOR (gri), asla yeşil.
2. Her durum dayanağını, zamanını ve eksik kalan şartını söyler.
3. **Atanmış olmak hazırlık kanıtı değildir**; kabul etmek de değildir. Temizliğin tek kanıtı: devir anından SONRA kimlikli "bitti" kaydı
   (bugünkü çekirdek `readinessDetailOf` — oturma 5 dk, host rızasıyla kanıtlı erken işaret).
4. "Görev açıldı", "iş bitti", "ihtiyaç çözüldü" ayrı durumlardır; biri ötekini kendiliğinden kapatmaz.
5. Sistemin ürettiği görevle elle düzenlenen görev ayrışır; elle düzenlenen görev rezervasyon değişince sessizce eski tarihte kalmaz.

## 1. Ortak temeller

| # | Temel | Kullanan alan | Migration |
|---|---|---|---|
| T1 | **Durum + dayanak sözleşmesi** (saf): `Factor = { key, state: ok · blocking · unknown · info, label, basis[], missing[], at }` | A, sonra C / D | Yok |
| T2 | **Görev zaman çizelgesi**: `TaskUpdate`e `kind` + `detail` (atama, teklif, kabul, ret, süre aşımı, görevden alma, tarih değişikliği bugün KAYITSIZ) + `TaskOffer` (kime, sıra, son cevap anı, cevap) | B, C, D | Evet |
| T3 | **Görev zamanının kaynağı**: `Task.scheduleSource` (system · manual) + `scheduleSetAt` + `scheduleSetById` — bugün "elle değişmiş" yalnız "tarih eski güne eşit değil" çıkarımıyla anlaşılıyor | C, A | Evet |
| T4 | **Değişiklik etkisi kaydı** `TaskImpact`: rezervasyon değişikliğinin hangi görevi nasıl etkilediği, ne zaman, kim nasıl çözdü | C, A | Evet |
| T5 | **İhtiyaç ↔ görev bağı**: `Task.conversationItemId` (SetNull) — görevi doğuran ihtiyaç | D, A | Evet |
| T6 | **İşlem kaydı** (tekrar güvenliği; Codex 43fb93e R-1): işletme + işlem + istek kimliği tekil, istek özeti, sonuç | B, D, elle rezervasyon | Evet |
| T7 | **Personel üyeliği**: `StaffInvite`, `UserPropertyScope` (personelin daireleri), `User.deactivatedAt` | B | Evet |

T2–T7 tek bir migration paketinde (M-1; numara açılışta kesinleşir — 92 `{daire}` için ayrıldı). Hepsi YENİ tablo / NULL'lanabilir kolon
(dolu tabloya zorunlu kolon / tekil kısıt eklenmez — boot kuralı). Push'u sizin açık onayınızla + taze yedekle.

## 2. A — Giriş hazırlığı listesi (salt-okuma; migration YOK; İLK TESLİM)

**Yer:** yeni sayfa "Girişler" (yönetici / sahip; personel görmez). Bugün + sonraki 2 gün, işletme saat dilimiyle; konaklama başına bir
satır, varış saatine göre sıralı; daire süzgeci.

**Satır = faktörler** (her biri dayanak + zaman + eksik şart):

| Faktör | Engeller mi | Dayanak | Örnek |
|---|---|---|---|
| Devir temizliği | Evet | bugünkü çekirdek (`readinessDetailOf` + `markOfTask`, AYNEN) | "Bitti 12:40 · Ayşe · çıkıştan (11:00) sonra" / "Açık · Ayşe'ye atandı · başlanmadı" / "Başladı 11:20 · Ayşe" / "Bitti işareti çıkıştan önce (10:05)" / "Temizlik görevi yok" (bilinmiyor) |
| Açık sorun / bakım | Evet | bugünkü `openIssue` / `maintenanceOpen` kuralı; satır başına görev (çekirdeğin aynı kümesi) | "Açık bakım görevi: Klima arızası · atanan: Mehmet · vade 6 Kas 10:00" |
| Temizlik görevine not | Hayır (bilgi — ağırlık J-10) | çekirdeğin `cleaningNote`ı; en son kimlikli not kaydı (yazan + an, içerik OKUNMAZ) | "Temizlik görevine not yazıldı · Ayşe · 11:30 — görevde okuyun" |
| Çift rezervasyon | Evet | `otherOverlaps`; çakışmanın tarafı olan konaklamalar | "Çakışan konaklama: Ali Veli · 5 Kas – 8 Kas" |
| Varışta yerine getirilecek söz | Evet | `GuestCommitment` açık + vadesi varıştan önce | "Söz: bebek yatağı (açık, görev Ayşe'de)" |
| Açık ihtiyaçlar | Hayır (bilgi) | `ConversationItem` açık / ev sahibinde | "Misafir sordu: otopark (sizde)" |
| Erişim (H-2) | Hayır — ama "HAZIR"ı engeller | bilgi tabanında giriş talimatı kalemi VAR / YOK (değer okunmaz) | "Giriş talimatı bilgi tabanında var · kilide / kutuya yerleştiği kontrol edilmedi" |
| Zaman | Hayır (bilgi) | önceki çıkış = mülk varsayılanı · misafir beyanı · onaylı geç çıkış'tan en geçi (bugünkü kural); giriş = mülk saati ya da onaylı erken giriş | "Önceki çıkış 11:00 → giriş 15:00 (4 sa)" |

**Genel durum (en kötüsü kazanır):** HAZIR DEĞİL (bir engel) → BİLİNMİYOR (eksik dayanak) → **TEMİZLİK HAZIR** (temizlik kanıtlı, engel
yok, erişim kontrol edilmedi). **"HAZIR" etiketi v1'de YOK** — erişim doğrulaması (§3 B'deki kontrol listesi ya da kilit) gelene kadar.

**H-2 kararım ve gerekçesi:** erişim satırı GİZLENMEZ, "kontrol edilmedi" diye açıkça gösterilir. Gizlemek "her şey hazır" izlenimi
verirdi (kurucu kuralı 1'e aykırı); "kod var" demek de yanlış güven verir (kodun kilide girildiği bilinmez). Kod DEĞERİ hiçbir zaman okunmaz /
gösterilmez; yalnız "giriş talimatı kalemi var / yok". Erişim doğrulaması gelince (personel kontrol listesinde "kapı kodu denendi" işareti
ya da kilit entegrasyonu) aynı faktör `ok` olur ve genel durum "HAZIR"a çıkabilir — kod değişmeden kural genişler.

**Önce → sonra (ev sahibi):**
- Önce: yarın gelecek misafirin dairesi hazır mı diye görevler sayfası + her konuşma ayrı ayrı açılıyor; "Ayşe'ye atandı" hazırmış gibi
  okunabiliyor.
- Sonra:
  - `Cum 7 Kas · Lale 5 · 15:00 · HAZIR DEĞİL — Temizlik: Ayşe'ye atandı, başlanmadı (eksik: "bitti" kaydı, çıkış 11:00'den sonra) · Söz: bebek yatağı açık`
  - `Cmt 8 Kas · Lale 7 · 14:00 · BİLİNMİYOR — Temizlik görevi yok (eksik: devir temizliği görevi)`
  - `Paz 9 Kas · Lale 3 · 16:00 · TEMİZLİK HAZIR — Bitti 11:40 (Ayşe, çıkıştan sonra) · Erişim kontrol edilmedi`

**Teknik (UYGULANDI, `387f5228`):** saf değerlendirici (`src/lib/readiness-list/evaluate.ts`, DB yok) + yükleyici
(`src/lib/readiness-list/load.ts`) + sayfa `/arrivals` ("Girişler", menüde "Görevler"in altında). Temizlik hükmü için ikinci bir devir /
görev mantığı YAZILMADI: konaklama başına bugünkü tek-konaklama yükleyicisi (`loadEarlyCheckinFacts`, eşzamanlılık 4) çağrılır — misafire
giden "Daireniz hazır" kararıyla birebir aynı kanıt (test: dört kurulumda liste satırı = tek-konaklama hükmü). Söz / ihtiyaç / giriş
talimatı / kişi adları toplu sorgularla eklenir. Bir konaklamanın hatası sayfayı düşürmez (satır "okunamadı", hata raporlanır). Ölçek notu:
konaklama başına birkaç sorgu — 3 günlük pencerede tipik işletme için yeterli; yüzlerce girişte toplu yükleyiciye (aynı hükmü verdiği
kâhin testiyle) geçilir. Model çağrısı yok, yazma yok, migration yok.
Satırın gösterdiği görevler = hükmün okuduğu görevler (çekirdek `cleaningTaskIds` döndürür — ekleme; bağsız devir günü görevi dahil,
Haiku 11-05). Temizlikçinin o gün devre yazdığı not BİLGİ satırıdır (içerik okunmaz). Mutasyon: 22 mutanttan 21'i öldürüldü; yaşayan K22
(`status` bilinmiyor → "hazır") EŞDEĞER: değerlendirici "temizlik bitti" için hükmün yanında "bitti" işaretini de ister ve çekirdek işareti
YALNIZ hazır hükmünde verir (`readyMarkOf`) — "hazır ama işaretsiz" girdisi ulaşılamaz, çıktı birebir aynı kalır.
**Dayanak (Opus 11-05 F7, `b2bc1acf`):** engel / bilgi satırları artık HANGİ kayda dayandığını söyler — açık bakım / kontrol görevi adı +
atanan + vade, notu yazan + an, çakışan konaklamanın adı + tarihleri. Kimlikler çekirdekten (`loadEarlyCheckinFacts` → `basisIds`, yalnız
gösterim; hüküm aynı koşulla okunur), ayrıntılar org kapsamlı toplu sorgularla. Gösterilenden fazla açık bakım görevi (5'ten çok) "başkaları
da var" der. "Görevler" bağlantısı o dairenin görevlerine süzülü açılır.

## 3. B — Personel daveti ve iş kabulü

**Bugün (doğrulandı):** kullanıcı TEK işletmeye bağlı (`User.organizationId`); üyelik / davet tablosu, personel oluşturma rotası ve ekranı
YOK (personel yalnız demo verisinde); personelin daire kapsamı YOK; rol değiştiren yol yok (bu yüzden `sessionEpoch` artışı da yok);
personel yalnız `/tasks` görür ve yalnız KENDİSİNE atanmış görevi günceller; atama e-postası görev başına saatte 3.

### 3.1 Akış
1. **Davet:** sahip / yönetici e-posta + daireler (en az bir) girer → `StaffInvite` (e-posta küçük harf, rol `staff`, daireler, belirteç
   ÖZETİ, son geçerlilik, davet eden). Belirteç yalnız e-postadaki bağlantıda, adreste `#t=` parçasında (sunucu günlüğüne düşmez — bugünkü
   e-posta doğrulama kalıbı).
2. **Kabul:** bağlantı → sayfa daveti gösterir (işletme adı burada, "işletmenin kendi yazdığı ad" etiketiyle) → kişi ad + şifre oluşturur →
   tek işlemde: davet koşullu kullanılır (`kullanılmamış + geri alınmamış + süresi dolmamış`), kullanıcı oluşturulur (`staff`, e-posta
   doğrulanmış sayılır — bağlantı e-postaya sahipliği kanıtlar), daireler yazılır.
3. **Doğru hesapla kabul:** e-posta zaten bir hesapsa —
   - BAŞKA işletmenin hesabı → **reddedilir, taşınmaz** (kurucu kuralı). Metin: "Bu e-posta adresi başka bir işletmenin hesabında kullanılıyor.
     Davet için farklı bir e-posta adresi kullanın." Çok işletmeli üyelik ayrı tasarım.
   - AYNI işletmenin hesabı → davet yalnız daire kapsamını günceller; rol değişirse `sessionEpoch` artar (kural #211).
   - Oturum açık kişi ile davetin e-postası farklıysa → "Bu davet başka bir e-posta adresine gönderildi" (yanlış hesaba bağlanmaz).
4. **Geri alma:** davet kullanılmadan geri alınabilir; bağlantı "Bu davet artık geçerli değil" der.
5. **İş teklifi:** görev atanınca sorumluya **teklif** gider (`TaskOffer`: kişi, sıra, son cevap anı). Personel "İşlerim"de görür: **Kabul
   et** / **Reddet** (isteğe bağlı neden).
6. **Kabul → Başladım → Bitti** (bugünkü durumlar + not / fotoğraf; zaman çizelgesine kayıt).
7. **Ret ya da süre aşımı:** yedek varsa sıradakine teklif (otomasyon → sizin onayınızla açılır), yoksa ev sahibine uyarı ("Ayşe işi
   reddetti — başka birine atayın"). Hazırlık listesinde satır "Kabul bekleniyor (son: 21:00)" / "Reddedildi, atanmamış" der.
8. **Görevden alma:** ev sahibi kişiyi işten çeker → görev o kişinin listesinden ANINDA kalkar (API zaten yalnız atanmışa izin veriyor),
   zaman çizelgesine kayıt. **Personeli ekipten çıkarma:** `deactivatedAt` + `sessionEpoch` artışı → bütün oturumları düşer.

### 3.2 Eşzamanlılık
- Davet kabulü: koşullu tek güncelleme (iki sekme → biri kazanır, öteki "Bu davet zaten kullanıldı"); kullanıcı oluşturma aynı işlemde.
- Teklif kabulü / reddi / geri çekme / yeniden atama: teklif satırında koşullu güncelleme (`cevap yok` iken) + görevde sorumlu kontrolü;
  geç gelen "kabul" geri çekilmiş teklifi diriltmez.
- Mobil ağ tekrarları: işlem kaydı (T6) — aynı istek kimliği aynı sonucu döner.
- Süre aşımı taraması: kilitli tarama (bugünkü periyodik iş kalıbı) — aynı teklif iki kez "süre doldu" yazmaz.

### 3.3 Güvenlik
- Belirteç 256 bit, yalnız özeti saklanır; tek kullanım; süreli (önerim 72 saat); işletme başına günlük davet sınırı (önerim 20).
- Davet e-postası kimlik e-postasıdır → **serbest metin işletme adı e-postaya YAZILMAZ** (bugünkü kural: saldırganın işletme adı "Hesabınız
  askıya alındı…" olabilir). Seçenekler §6 J-5.
- Davet eden sahip / yönetici e-postası doğrulanmış olmalı; personel daveti personel oluşturamaz.

## 4. C — Rezervasyon değişikliğinin etkisi

**Bugün (doğrulandı):** tarih değişince yalnız `origin=system` + açık + tarihi ESKİ güne eşit görev taşınır (`follow-reservation.ts`);
elle tarihi değiştirilmiş görev, elle açılmış görev, AI görevi eski tarihte SESSİZCE kalır; tarih / atama değişikliği zaman çizelgesine
yazılmaz.

**Tasarım:** görevin zamanı kimden (T3) açıkça tutulur. Rezervasyon değişikliği işlenirken (bugünkü üç çağıran: iCal senkronu, yazma
servisi, dosyadan içe aktarım — aynı işlem içinde):
- sistem zamanlı açık görev → bugünkü gibi taşınır + `TaskImpact` "otomatik taşındı" (zaman çizelgesinde görünür);
- elle zamanlı / elle açılmış / AI görevi → TAŞINMAZ, `TaskImpact` AÇIK kayıt: görev kartında rozet + hazırlık listesinde ENGEL:
  "Rezervasyon değişti: çıkış 7 Kas → 9 Kas · bu temizlik elle 7 Kas 11:00'e sabitlenmiş" → **[Yeni tarihe taşı]** **[Böyle kalsın]**
  (karar, kim, ne zaman kaydedilir);
- iptal → bugünkü temizlik kuralı + elle görevler için açık etki kaydı ("Rezervasyon iptal edildi — bu iş hâlâ gerekli mi?").

**Önce → sonra:** misafir 2 gece uzattı; temizlikçi işi elle 11:30'a almıştı. Önce: görev 7 Kas 11:30'da kalır, kimse bilmez, temizlikçi
misafir içerideyken kapıya gelir. Sonra: görevde ve "Girişler"de kırmızı satır; ev sahibi tek tıkla 9 Kas'a taşır ya da bırakır.

## 5. D — İhtiyaç ↔ görev

**Bugün (doğrulandı):** konuşma öğesi (ihtiyaç) ile görev arasında bağ YOK; öğe "bitti" yalnız ev sahibi işaretiyle (ve karar kartıyla);
söz ↔ görev bağı VAR ve görev bitince söz kendiliğinden "yerine getirildi" olur (söz = yapılacak iş; bu bağ doğru, korunur).

**Tasarım:** ihtiyaç kartında **[Görev aç]** → görev `conversationItemId` ile doğar (T5; AI önerisinden doğan görev de bağı yazar). Kartta
zincir: "Görev açıldı (Ayşe'ye) → Ayşe kabul etti → Bitti 14:20 (Ayşe)" ve AYRI **[İhtiyaç çözüldü]** düğmesi (bugünkü `host_done`).
Görevin bitmesi ihtiyacı KAPATMAZ (kural 4); yalnız kartta "İş bitti — ihtiyaç çözüldü mü?" sorusu belirir.

**Önce → sonra:** misafir "televizyon çalışmıyor" yazdı. Önce: ev sahibi görev açar ama ihtiyaçla bağ yoktur; görev bitince ihtiyaç kartı
açık kalır ya da unutulup kapatılır, hangisinin neden kapandığı izlenemez. Sonra: kart "Görev: TV kontrolü — Mehmet, bitti 16:05" der;
ev sahibi misafirle teyit edip "İhtiyaç çözüldü"ye basar.

## 6. Sorular (karar sizde)

- **J-1:** Migration paketi M-1 (T2–T7: yalnız yeni tablo ve NULL'lanabilir kolonlar) yazılsın mı? (Push ayrıca onayınızla + taze yedek.)
- **J-2:** Hazırlıkta açık **söz** (vadesi varıştan önce) ENGEL, açık **soru / ihtiyaç** yalnız BİLGİ — böyle mi?
- **J-3:** Davet süresi 72 saat, tek kullanım, işletme başına günde 20 davet, v1'de yalnız "personel" rolü (yönetici daveti sonra) — uygun mu?
- **J-4:** Başka işletmede hesabı olan e-posta daveti kabul EDEMEZ (taşınmaz) — onaylıyor musunuz? (Çok işletmeli üyelik ayrı tur.)
- **J-5:** Davet e-postası: **(a)** "Bir işletme sizi Lixus AI'da ekibine davet etti" + davet edenin DOĞRULANMIŞ e-posta adresi; işletme adı
  yalnız kabul sayfasında, "işletmenin kendi yazdığı ad" etiketiyle (önerim) · **(b)** işletme adını e-postaya da yaz (kimlik e-postası
  kuralına aykırı; önermiyorum).
- **J-6:** Teklif cevap süresi: önerim "teklif + 4 saat, ama en geç görevden 6 saat önce"; ret / süre aşımında yedeğe geçiş otomatik mi, yoksa
  ev sahibine "yedeğe gönder" düğmesi mi? (Otomatik = otomasyon, ayrı onay.)
- **J-7:** "Personeli görevden alma" ile kastınız (1) kişiyi bir işten çekmek mi, (2) ekipten çıkarmak mı — tasarım ikisini de kapsıyor; ikisi
  de v1'de olsun mu?
- **J-8:** Rezervasyon değişince elle zamanlı görev için varsayılan: hiçbir şey yapma + açık uyarı (önerim) mi, yoksa sistem görevleri gibi
  taşı + bildir mi?
- **J-9:** İhtiyacın çözülmesi yalnız ev sahibinin işareti (önerim) — ileride "misafire sor: sorun çözüldü mü?" ayrıca konuşulur. Uygun mu?
- **J-10 (Opus F7):** Temizlik görevine yazılan not bugün Girişler'de BİLGİ satırı. Misafire giden otomatik "Daireniz hazır" ise not varken
  zaten GİTMEZ (çekirdek kuralı, değişmedi). Örnek: Ayşe 12:40'ta "bitti" der ve "Klozet kapağı kırık" yazar —
  - **(a) bugünkü:** `TEMİZLİK HAZIR` (yeşil) + `Temizlik görevine not yazıldı · Ayşe · 12:40 — görevde okuyun` (mavi bilgi).
  - **(b) muhafazakâr:** `BİLİNMİYOR` (gri) + aynı satır, "eksik: notun okunması". Ama "okudum" işareti olmadan not yazılan HER devir (ör. "çöpü
    çıkardım") gün boyu gri kalır → (b) seçilirse satıra **[Okudum]** düğmesi (kim, ne zaman kaydedilir) gerekir — küçük bir yazma yolu.
  - Önerim **(b) + [Okudum]**: okunmamış bir sorun bildirimi eksik veridir (kurucu kuralı: eksik veri hazır sayılmaz). Yeni bir yazma yolu
    olduğu için soruyorum. **Hangisi?**
  - Aynı sorunun ikinci yarısı: bağlı olduğu konaklamadan çok sonra açık kalmış ESKİ bir bakım görevi o dairenin her girişini HAZIR DEĞİL
    yapar (çekirdek kuralı; otomatik "hazır" mesajını da durdurur). Artık satırda görevin adı ve atananı yazıyor; görev kapanınca satır
    düzelir. **Bu kural böyle kalsın mı?** (Önerim: evet — açık bakım görevi gerçekten bakılması gereken bir şeydir; unutulmuşsa görünür olur.)

## 7. Sıra ve paralellik

1. **Şimdi (onay gerektirmeyen):** A — saf değerlendirici + toplu yükleyici + "Girişler" sayfası (salt-okuma, migration yok); kırmızı-önce,
   kâhin testi, mutasyon, ekran görüntüsü.
2. **J-1 onayı gelince:** M-1 migration'ı (taze PG'de sıfır sapma) → C ve D PARALEL (yazıcıları ayrı: C rezervasyon değişikliği yolunda,
   D ihtiyaç kartında) → A'nın satırları otomatik zenginleşir (etki kaydı, ihtiyaç zinciri).
3. **B:** ekran / e-posta önizlemeleri bu belgeyle birlikte (aşağıdaki görseller); onayınızdan sonra kod; ilk gerçek davet e-postası ve ilk
   kabul denemesi Railway açıldığında SİZİNLE birlikte (kimlik akışı kuralı).

## 8. Kapsam dışı (bu tur)
Kilit entegrasyonu · misafire otomatik bildirim · çok işletmeli üyelik · stok · villa / oda modeli · Airbnb kişisel veri dışa aktarımından
içe aktarım (kurucunun paylaştığı biçim — "Reservations" tablosu ve "Home Inquiries" JSON alanları — gelecekte `manual_file` kaynağına
eklenebilir; gerçek veri repoya girmez).
