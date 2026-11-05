# TASARIM — Doğrudan görevlendirme: dairenin temizlikçisi · WhatsApp ana kanal · "Yapamıyorum" · geç çıkış → temizlik saati (2026-11-06)

> Kurucu (11-05 gece, gece modu — "soru sormadan ilerle"): "daireye temizlikçiyi bir kez belirleyince, sonraki temizlikler ayrıca kabul
> beklemeden onun iş listesine düşsün" · "ana akış olarak prompt wp'dan temizlikçiye gitmeli … şimdilik mailden kurabilirsin, ileride
> kaldırırız ya da kaldırmayız" · "şu anki teklifli sistemi koddan silme ama geçici olarak askıya al" · "temizlik var çıkış günü … geç çıkış
> isteği onay aldı (12 → 14), orada hemen buna bağlanabilir temizlik saati" · (Codex, kurucunun aktardığı) "geçmiş konaklamadan kalan bir
> bakım işi … bütün sonraki girişleri kırmızı yapmamalı; AI yorumlayabilir ama açıklamasız kesin hüküm üretmemeli".
> Bu belge `docs/TASARIM-2026-11-05-ortak-mimari-hazirlik-personel-degisiklik-ihtiyac.md`'nin B bölümünü (personel / iş kabulü) GÜNCELLER:
> varsayılan **doğrudan görevlendirme**; teklif modu **askıda** (tasarım korunur, kod yazılmadı). Codex'in görsel ve teknik notları §6–§7.

## 0. Kısaca (önce → sonra)

**Önce (bugün, kodda doğrulandı):** sistem her rezervasyon için temizlik görevini **kimseye atamadan** açar (`automation.ts:1347
createReservationTasks`); ev sahibi her görevi tek tek atar; atama e-postası yalnız elle atamada gider (`api/tasks/[id]` PATCH); personel
hesabı oluşturan bir yol **yok** (yalnız demo verisinde personel var); geç çıkış onayı görevi hiç güncellemez; temizlikçinin "yapamıyorum"
demesinin yolu yok (yalnız not).

**Sonra:**
1. Ev sahibi mülk sayfasında **"Temizlikçi: Ayşe"** seçer (bir kez).
2. Yeni rezervasyon gelince sistem temizlik görevini **doğrudan Ayşe'ye** atar — kabul / ret adımı yok, Ayşe'nin "İşlerim" listesine düşer.
3. Ayşe'ye bildirim: **WhatsApp** (numarası doğrulanmışsa ve kanal açıksa) — değilse **e-posta** (bugünkü atama e-postası, geçici).
   Örnek: "Yeni temizlik göreviniz var: Lale 5 · 8 Kas Cumartesi · misafir 11:00'de çıkıyor."
4. Ayşe "Başladım" → "Bitti" der (bugünkü durumlar, not / fotoğraf).
5. Aksilik: **"Yapamıyorum"** (isteğe bağlı neden). Görev silinmez, bitmiş sayılmaz; durum "Yapılamıyor" olur, ev sahibi görür ("Girişler"de
   kırmızı satır, Görevler'de rozet), başka birine atayınca durum "Yapılacak"a döner.
6. Misafirin geç çıkışı onaylanınca (12:00 → 14:00) temizliğin **en erken başlama saati 14:00** olur: görevde, temizlikçinin listesinde ve
   "Girişler"de "misafir 14:00'te çıkacak (geç çıkış onaylı)" yazar; atanmış temizlikçiye bildirim gider. Saat kopyalanmaz, rezervasyondan
   ve onaydan **türetilir** (tek kaynak; rezervasyon değişirse kendiliğinden güncel). "Daireniz hazır" hükmü onaylı geç çıkışı zaten okuyor
   (çekirdek): 14:00'ten önce atılmış "bitti" kanıt sayılmaz.

## 1. Bugün ne var (envanter, kodda doğrulandı)

| Konu | Durum | Dayanak |
|---|---|---|
| Dairenin varsayılan temizlikçisi | YOK (alan / ayar yok) | `schema.prisma` Property; `defaultCleaner` / `assignee` aramaları boş |
| Sistem temizlik görevi | rezervasyonla açılır, **atanmaz**; vade = çıkış TARİHİ (yalnız-tarih çapası ya da iCal anı) | `automation.ts:1347-1478` |
| Rezervasyon tarihi değişince | yalnız SİSTEM görevi ve vadesi eski tarihe EŞİTSE taşınır | `tasks/follow-reservation.ts:28-47` |
| Geç çıkış onayı → görev | YOK | `decisions/`, `early-checkin/` görev yazmaz |
| Atama bildirimi | yalnız elle atamada e-posta ("Yeni Görev: …", görev başına saatte 3) | `api/tasks/[id]/route.ts:197-234` |
| Personel hesabı oluşturma | YOK (yalnız demo / tohum) | `api/auth/register` ve `admin/customers` yalnız `owner` |
| Personelin yapabildikleri | yalnız `/tasks`; yalnız KENDİ görevinin durumu / notu / fotoğrafı | `middleware.ts:86-96`, `api/tasks/[id]/route.ts:70-113` |
| WhatsApp | **ev sahibi kanalı VAR**: Meta Cloud API şablon gönderimi, wa.me koduyla doğrulanmış numara bağlama (kullanıcıya bağlı, şifreli E.164), onay metni sürümü, teslim durumu, gelen mesaj / düğme işleme | `host-channel/whatsapp/transport.ts`, `HostChannelBinding`, `host-channel/routing.ts` |
| Temizlik listesi paylaşımı | Görevler sayfasında "WhatsApp'ta paylaş" (wa.me, alıcıyı ev sahibi seçer) | `components/tasks/task-board.tsx:314-321, 589-604` |
| Otomatik giriş mesajı | `AutoMessageTemplate` (mülk + tür, bilgi tabanından AYRI) | `auto-messages/store.ts:23` |

## 2. Akış (v1 — kabul adımı YOK)

### 2.1 Dairenin temizlikçisi
- **Yer:** mülk sayfası → "Temizlik" kartı → "Bu dairenin temizlikçisi: [Ayşe ▾] / Kimse". Yalnız sahip / yönetici.
- **Kayıt:** `AutomationRule` (tetik `reservation_created`, eylem `assign_cleaning`, mülk + kişi) — erken giriş kuralının migration'sız
  deposuyla AYNI kalıp (`early-checkin/rules.ts`: doğrulanmış JSON, mülk satırı kilidi, mülk silinince kural da silinir). Anlamca da bir
  otomasyon kuralıdır ("rezervasyon gelince bu dairenin temizliğini Ayşe'ye ata").
- **Kişi kullanım anında doğrulanır:** aynı işletmede, rolü personel / yönetici, hesabı etkin. Değilse atama YAPILMAZ, görev bugünkü gibi
  atanmamış açılır ve "Girişler"de "atanmadı" görünür (sessiz yanlış atama yok).
- **Temizlikçi değişince:** yeni kural yalnız SONRAKİ görevlere uygulanır. Ekranda açık soru: "Lale 5'in gelecekteki 3 açık temizliği de
  Mehmet'e geçsin mi? [Evet] [Hayır, yalnız yeniler]" — gizli toplu değişiklik yok; "Evet" yalnız eski temizlikçide duran, başlanmamış,
  sistem görevlerini taşır.

### 2.2 Görev oluşumu
- `createReservationTasks` temizlik görevini kural varsa doğrudan kişiye atar (`assignedToId`) ve zaman çizelgesine "Sistem atadı (dairenin
  temizlikçisi)" kaydı düşer (kim / neden izlenebilir).
- Elle açılmış ya da elle atanmış görev DEĞİŞMEZ. Hazırlık (`checkin_prep`) görevi v1'de atanmaz (istenirse aynı kuralın ikinci eylemi).

### 2.3 Bildirim — WhatsApp ana kanal, e-posta geçici
- **Tek giriş noktası** `notifyStaff(userId, olay)` → kanal seçimi bugünkü `chooseHostChannel` kalıbıyla: WhatsApp (kişinin doğrulanmış
  numarası + anahtarlar + işletme listesi + saatlik tavan) yoksa e-posta. Olaylar: `assigned` (yeni görev), `reassigned_away` (görev başkasına
  geçti), `checkout_changed` (geç çıkış onayı / çıkış değişti), `cancelled` (rezervasyon iptal → görev kalktı).
- **WhatsApp:** mevcut ev sahibi altyapısı yeniden kullanılır — `HostChannelBinding` zaten kullanıcıya bağlı; personel kendi oturumunda
  "WhatsApp'ı bağla" der, wa.me kodunu gönderir, numara doğrulanır (WhatsApp kuralı: alıcının açık onayı; ev sahibinin personel adına numara
  yazması onay sayılmaz). Yeni şablon `lixus_temizlik_gorevi` (Meta onayı gerekir), hızlı cevap düğmeleri: **Başladım · Bitti · Yapamıyorum**
  → gelen düğme personelin KENDİ kimliğiyle görev güncellemesi olur (kimlikli "bitti" kanıtı korunur). Bugünkü ev sahibi rotası "personel
  asla" der — personel bağlama ayrı, dar kapsamlı bir rota olur (personelin numarası ev sahibi sorusu / kararı ALMAZ).
- **E-posta (geçici):** bugünkü atama e-postası şablonu, otomatik atamada da gider. İleride kaldırılıp kaldırılmayacağı kurucu kararı.
- **Toplu gönderim:** aynı gün aynı kişiye birden çok görev → tek mesaj (gün özeti); görev başına saatte 3 tavan sürer.
- Bütün yeni gönderimler anahtar arkasında **KAPALI** doğar (`STAFF_NOTIFY_ENABLED`, `STAFF_WHATSAPP_ENABLED`); ilk gerçek gönderim kurucuyla
  birlikte (kural: e-posta / kimlik akışı ilk denemeler birlikte).

### 2.4 Personel: "İşlerim" → Başladım → Bitti
Bugünkü `/tasks` personel görünümü (misafir adı yok, `staff-view.ts`). Görev kartında yeni satır: "Misafir 11:00'de çıkıyor" ya da "Misafir
14:00'te çıkacak (geç çıkış onaylı) — temizliğe 14:00'ten sonra başlayın".

### 2.5 "Yapamıyorum"
- Personel kendi görevinde "Yapamıyorum" der (isteğe bağlı neden, 200 karakter). Görevin durumu **`blocked` ("Yapılamıyor")** olur, zaman
  çizelgesine kişi + an + neden yazılır. Görev silinmez, BİTMİŞ SAYILMAZ (çekirdek yalnız kimlikli "bitti"yi kanıt sayar — değişmez).
- Ev sahibine görünür: Görevler'de kırmızı rozet, "Girişler"de ENGEL satırı: "Temizlik: Ayşe yapamıyor (12:05) — 'hastayım' · eksik:
  başka birine atama". Bildirim (anahtar açıkken): "Ayşe, Lale 5'in 8 Kas temizliğini yapamıyor: hastayım. Başka birine atayın."
- Ev sahibi başka birine atayınca durum "Yapılacak"a döner (yeni kişiye `assigned` bildirimi). Personel fikrini değiştirirse "Başladım"
  diyebilir (durum `in_progress`).

### 2.6 Geç çıkış → temizlik saati (türetilir)
- Çekirdek zaten "önceki çıkış = mülk saati · misafir beyanı · onaylı geç çıkış'tan en geçi" kuralını kullanıyor
  (`early-checkin/load.ts` `approvedLateCheckouts` + `laterTime`). Aynı yardımcı görev kartına, personel listesine ve "Girişler"e
  **"en erken başlama"** olarak taşınır — görev satırına saat YAZILMAZ (ikinci kaynak olmasın; vade tarihi rezervasyonu izlemeye devam eder).
- Onay anında atanmış temizlikçiye `checkout_changed` bildirimi (anahtar açıkken).
- 14:00'ten önce atılmış "bitti" kanıt sayılmaz (çekirdek: "çıkıştan önce" notu) — temizlikçi erken bitirirse ekranda "Bitti işareti
  çıkıştan önce" görünür, bugünkü kural.

### 2.7 Teklif modu (kabul / ret + cevap süresi) — ASKIDA
05 belgesi §3.1 adım 5–7 korunur, **kod yazılmadı**. İleride işletme ayarı ("işe kabul isteyen işletmeler") olarak döner. Döndüğünde Codex
notu bağlayıcı: cevap süresi sabit 4 saat değil, **işe yetişme saatine** göre (görevin en erken başlamasından makul süre önce kapanır); geç
kabul geri çekilmiş teklifi diriltmez; yalnız bir geçerli görevlendirme kalır.

## 3. Personel hesabı (ön koşul — bugün yok)
- **"Ekibe ekle":** ad + e-posta (+ isteğe bağlı daireler). Davet e-postası (işletme adı e-postada YOK — kimlik e-postası kuralı; davet eden
  ev sahibinin doğrulanmış e-postası yazar). Bağlantı: belirteç adresin `#` parçasında, sayfa daveti GÖSTERİR, katılım **açık onay + POST**
  ile tamamlanır → e-posta tarayıcılarının bağlantıyı açması daveti tüketmez (Codex). Tek kullanım, 72 saat, geri alınabilir.
- **Mevcut hesap:** aynı işletmede → yalnız kapsam güncellenir, şifre DEĞİŞMEZ (davet bağlantısı şifre sıfırlayamaz — Codex). Başka
  işletmede → v1'de katılamaz, taşınmaz ("Bu e-posta başka bir işletmenin hesabında. Farklı bir e-posta kullanın."). **Codex'in uzun vadeli
  önerisi doğru:** tek kimlik + işletme başına üyelik (rol + daire kapsamı); aynı temizlikçi iki ev sahibine çalışabilir. Bu, oturumun
  işletme seçmesini gerektirir (bugün `User.organizationId` tek) → ayrı tasarım M-2; v1 kısıtı açıkça yazılı.
- Migration gerekir (`StaffInvite`) → push için kurucu onayı + taze yedek (kural).

## 4. Görevden alma / ekipten çıkarma (Codex: "kartı soluklaştırmak yetmez")
Kodda doğrulandı (11-06): görevden alınan personel eski sekmeden **durum değiştiremez** (`api/tasks/[id]` 403 + koşullu yazım; test
`tasks-route.test.ts:99`), **fotoğrafı açamaz** (`api/storage/photo` atanmamışa 404; test `critical-flow-private-upload-session.test.ts:139`),
listesinde görmez (sorgu `assignedToId`; yalnız kod — test eklenecek). WhatsApp düğmesi de aynı sunucu kontrolünden geçer (görev hâlâ
kendisinde mi). Ekipten çıkarma: `deactivatedAt` + `sessionEpoch` artışı → bütün oturumlar düşer, WhatsApp bağlantısı `revoked`.

## 5. Bakım görevi girişi ne zaman engeller (Codex + kurucu)
- Bugün: dairedeki HER açık bakım / kontrol görevi (tarihsiz ya da varışa kadar vadeli, başka konaklamaya bağlı bakım dahil) hem "Girişler"i
  kırmızı yapar hem misafire otomatik "Daireniz hazır"ı durdurur.
- **"Girişler" (ev sahibi ekranı) için kural (bu turda):**
  - ENGEL: bu devre bağlı açık sorun (önceki / gelen konaklama) · vadesi varış gününe kadar olan tarihli bakım · önceliği **acil** bakım.
  - KONTROL EDİN (gri, "bilinmiyor"): **eski bir konaklamaya bağlı** ya da **tarihsiz** bakım — "3 Eki konaklamasından kalan açık bakım:
    Klima — bu girişi etkiliyor mu? Görevi kapatın ya da tarih verin". Kesin hüküm yok, açıklama var (kurucu / Codex).
  - BİLGİ: önceliği **düşük** bakım ("dolap kulpu" gibi).
- **Misafire giden otomatik "Daireniz hazır" kararı DEĞİŞMEDİ** (her açık bakımda bekler) — bu misafire gidene dokunur, ayrı soru K-4.

## 6. Codex'in görsel yorumları → yapılan
| Yorum | Yapılan |
|---|---|
| "Başka işletmede hesabın var" uzun vadeli çözüm değil | Doğru → §3: v1 kısıtı açık, uzun vadeli üyelik modeli M-2 tasarımı; soru K-2 |
| Otomatik yedeğe geçiş daha geniş karar | Teklif modu askıda (§2.7); v1'de yedek yok — "Yapamıyorum" ev sahibine gider, ev sahibi atar |
| Masaüstünde kartlar uzun, mobilde açıklama yer kaplıyor | "Girişler" sadeleşti: satır başına önce daire · giriş · durum · ilk eksik · kim; ayrıntı açılır; açıklama kısa |
| Önizlemelerde "7 Kasım Cuma" / "7 Kasım Cumartesi" | 7 Kasım 2026 Cumartesi. Elle yazılmış önizlemelerde gün yanlıştı (gerçek ekran koddan üretiliyor, doğru). Bundan sonra görseller kodla, aynı veriden üretilir |
| Son görselde yazı tipi farklı | Statik çizimde uygulamanın yazı tipi yüklenmemişti; yeni görseller uygulamanın kendi yazı tipi dosyalarıyla |
| Her açık bakım girişe engel değildir | §5 |
| KB'de giriş kaydı olması gönderilecek mesajın hazır olduğunu kanıtlamaz | Doğru (kodda: otomatik mesaj `AutoMessageTemplate`, bilgi tabanından ayrı) → "Girişler" erişim satırı artık otomatik giriş mesajının kendisine bakar (var mı, gözden geçirme gerekiyor mu, son gönderimde atlandı mı) |

## 7. Codex'in teknik doğrulama listesi → sonuç
| Madde | Sonuç |
|---|---|
| Temizlik kanıtı: doğru görev + doğru konaklama; çıkış saati değişirse / görev yeniden açılırsa / araya konaklama girerse eski kanıt geçmez | Kod doğru (çekirdek yalnız devrin görevinin EN SON kimlikli "bitti"sini, çıkış anından sonra sayar). Eksik entegrasyon testleri eklendi: geç çıkış onayı "bitti"den sonra · araya giren konaklama · aynı gün başka konaklamaya bağlı tarihli temizlik · yeniden açılma |
| Teklif süresi sabit 4 saat olmamalı | Teklif modu askıda; döndüğünde kural §2.7 |
| Davet güvenliği (tarayıcı tüketmesin, açık onay, şifre sıfırlanamasın) | §3 tasarımı |
| Görevden alma sunucuda | §4 — durum ve fotoğraf pinli; liste testi eklenecek |
| QR sınırı: kişi dairenin bütün hakkını tüketemesin; genel sınır + doğrulanmış cihaz hakkı birlikte | Ölçüldü: çözümden önceki "ıska" kovası bina ağında bütün sohbetleri durdurabiliyordu → kaldırıldı (Opus N1). Doğrulanmış (bağlı) cihaz için ayrı kova — bu turda |
| Yedek sayaç: belleğin sınırlı kaldığı ve doluyken yeni hak verilmediği | Pinli (anahtar tavanı, etkin kayıt silinmez, taşma yalnız sıkılaştırır); Opus N4 ile pencere sınıfı başına yuva |
| Sağlayıcı kabulü ≠ misafire teslim | Doğru: arayüz kabul edilen mesajı "İletildi" + çift tik ile gösteriyordu → "Gönderildi" + tek tik |

## 8. Dilimler ve sıra
1. **Migration'sız (bu gece):** Opus N1–N6 · "Gönderildi" ifadesi · temizlik kanıtı testleri · "Girişler": bakım ayrımı (§5), otomatik giriş
   mesajı, sade görünüm, geç çıkış saati · dairenin temizlikçisi kuralı + otomatik atama · "Yapamıyorum" · bildirim katmanı (e-posta, anahtar
   kapalı) · doğrulanmış QR cihaz kovası.
2. **Migration'lı (yerel dalda; push kurucu onayıyla):** personel daveti (`StaffInvite`), ekipten çıkarma (`User.deactivatedAt`), personel
   WhatsApp bağlama + şablon + düğmeler.
3. **Railway açılınca, kurucuyla:** ilk davet e-postası, ilk WhatsApp şablonu (Meta onayı), anahtarları sırayla açma.

## 9. Sorular (sabah)
- **K-1:** Dairenin temizlikçisi değişince açık gelecekteki görevler için ekranda soru ("geçsin mi?") — önerim bu (gizli toplu değişiklik
  yok). Uygun mu?
- **K-2:** Başka işletmede hesabı olan temizlikçi: v1'de "farklı e-posta" kısıtı + uzun vadeli üyelik modeli (M-2) tasarımı — sıra böyle mi,
  yoksa üyelik modeli önce mi?
- **K-3:** WhatsApp bildirimi için Meta şablonu ve iş numarası: mevcut ev sahibi numarası mı, temizlikçilere ayrı numara mı?
- **K-4:** Misafire giden otomatik "Daireniz hazır": bugün HER açık bakım görevinde bekliyor. Eski konaklamadan kalan / tarihsiz / düşük
  öncelikli bakımda da beklesin mi (bugünkü, güvenli), yoksa "Girişler"deki ayrımla aynı mı olsun? Örnek: 3 Eki'den kalan "dolap kulpu"
  (düşük öncelik) açıkken bugün temizlik 12:40'ta bitti → bugün: misafire otomatik "Daireniz hazır" GİTMEZ, ev sahibi elle yazar; ayrımla:
  GİDER. Önerim: bugünkü kalsın (güvenli taraf), ev sahibi listede gördüğü eski görevi kapatsın.
