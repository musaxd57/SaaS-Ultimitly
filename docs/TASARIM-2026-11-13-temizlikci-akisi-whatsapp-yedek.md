# TASARIM 2026-11-13 gece — Temizlikçi akışı: uygulamasız, WhatsApp üzerinden, yedek temizlikçi kendiliğinden (AaaS)

> Kurucu 11-13 gece: "Temizlikçi kadın onla mı uğraşacak — belki 50 yaşında, telefon tutmayı bilmiyor, telefonu yok. Başladığı saatin
> tutulması host için iyi olabilir. Temizlikçi bizim web sitesine girmesine gerek kalmamalı; ismini bile bilmeden akışı bizim
> yürütebilmemiz lazım. En milyarlık çözüm nasıl olur — WhatsApp üzerine entegre sistem mi yapsak?" · "'Yapamıyorum' gereksiz, ucuz, saçma bir
> düğme — kaldır; sistem yedeği önersin" · "Yedek temizlikçi önerin çok mantıklı, ekle" · "Çocuk gibi her bölümü host'a uğraştırmamalı —
> SaaS değil AaaS" · "Temizlikçiyi yalnız en üstteki 2 yetki değiştirebilsin" · "Fotoğrafı kimin attığı için hesap yeterli".

## 1. Yetki sırası (kodda doğrulandı — `src/lib/constants.ts` `UserRole`, `route-guard.ts`)
1. **Sahip** (`owner`) — her şey; ödeme / faturalandırma / hesap silme yalnız sahip.
2. **Yönetici** (`manager`) — işletmeyi yönetir (görev atama, dairenin temizlikçisi, ayarlar); ödeme ekranlarına giremez.
3. **Personel** (`staff`, ör. temizlikçi) — yalnız kendi görevini ilerletir; atama / başlık / tarih değiştiremez.
(Lixus operatörü ayrı: işletmeye yalnız salt-okunur destek görünümüyle girer.)
**Temizlikçiyi değiştirmek (görev ataması + dairenin temizlikçisi) bugün de yalnız 1 ve 2** (`withManage`; personel atama değiştirirse 403).
Kurucunun kuralı zaten yürürlükte; yedek temizlikçi ve kendiliğinden devir de aynı kuralla: yedeği yalnız 1–2 seçer, sistemin kendi devri
denetim kaydına "sistem" olarak yazılır, 1–2 geri alabilir.

## 2. Teşhis — bugünkü akış neden "mağara çağı"
- Temizlikçi bir **kullanıcı hesabı** olmak zorunda (e-posta + şifre); görevini görmek, "Başladım" / "Bitti" demek için **siteye girmesi**
  gerekiyor. 50 yaşında, akıllı telefonu zor kullanan ya da telefonu olmayan biri için bu akış hiç çalışmaz.
- Aksilikte temizlikçinin "Yapamıyorum" demesi bekleniyor → ev sahibi bir uyarı görür, başka birini kendisi bulup atar. İş yine ev
  sahibinde.
- Sonuç: sistem işi YÜRÜTMÜYOR, ev sahibine iş ÇIKARIYOR.

## 3. Hedef akış (temizlikçi uygulama / site / şifre görmez)
Temizlikçi sistem için **bir telefon numarasıdır** (adı isteğe bağlı — bilinmiyorsa ekranda "Temizlikçi (…4521)"). Bütün iletişim
WhatsApp'ta, **düğmeli** mesajlarla; yazı yazması gerekmez.

**Örnek gün (Lale 5: misafir 11:00 çıkıyor, yeni misafir 15:00 geliyor; dairenin temizlikçisi Ayşe, yedeği Fatma):**
> ⚠️ §9 İ1 ile DEĞİŞTİ: dairenin kalıcı temizlikçisinde **sessizlik = geliyor**. Akşam mesajı bir HATIRLATMADIR (tek düğme [Gelemem]); yedeğe
> yalnız açık [Gelemem] ya da "başlama son saati" geçince gidilir. Aşağıdaki 1–3 bu düzeltmeyle okunur.
1. **Akşam önce (ör. 19:00) — hatırlatma:** Ayşe'ye: "Yarın Lale 5 temizliği · misafir 11:00'de çıkıyor, yeni misafir 15:00'te geliyor.
   Gelemeyecekseniz dokunun." **[Gelemem]**.
2. **Ayşe dokunmazsa →** görev Ayşe'de kalır (her gün gelen temizlikçi her akşam "Gelirim"e basmak zorunda kalmaz). Ev sahibine hiçbir şey gelmez.
3. **Ayşe "Gelemem" ya da sabah "başlama son saati"ne kadar "Başladım" yok →** sistem KENDİLİĞİNDEN teklifi yedek Fatma'ya yollar
   **[Gelirim] [Gelemem]**. Fatma "Gelirim" → görev
   Fatma'ya geçer, Ayşe'ye "Tamam, yarınki Lale 5 temizliği başka arkadaşımızda." Ev sahibi Panel'de yalnız bir bilgi satırı görür: "Ayşe
   gelemiyor; Lale 5 temizliğini Fatma aldı." **Ev sahibi hiçbir şey yapmaz.**
4. **Kimse kabul etmezse (yalnız o zaman) →** ev sahibine istisna: "Lale 5 temizliği için kimse onay vermedi (giriş 15:00). [Ayşe'yi ara]
   [Fatma'yı ara]" — sistemin çözemediği tek durum.
5. **Gün içinde:** sabah Ayşe'ye: "Bugün Lale 5 · misafir 11:00'de çıkıyor. Başlayınca dokunun." **[Başladım]** → başlama saati kayda
   geçer (ev sahibi Girişler'de "Ayşe 11:20'de başladı" görür). Bitince **[Bitti]** → bitiş saati; Girişler yeşile döner. İsterse bir
   fotoğraf yollar, göreve eklenir — ŞART DEĞİL.
6. **Telefonu olmayan / düğmeye basmayan temizlikçi:** sistem o kişiye mesaj atmaz; görev doğrudan atanır. Beklenen bitiş saatinde ev
   sahibine TEK soru: "Lale 5 temizliği bitti mi? (giriş 15:00) [Bitti]". Bir dokunuş.
7. **Geç çıkış onaylanırsa** (misafir 13:00'e kadar kalacak) → atanmış kişiye kendiliğinden: "Lale 5'te misafir 13:00'te çıkacak; temizliğe
   13:00'ten sonra başlayın." (bugünkü "türetilen en erken başlama" kuralı.)

**Kim neyi yapar:** temizlikçi yalnız düğmeye basar; sistem onay ister, cevapsızlığı / reddi yakalar, yedeğe devreder, saatleri kaydeder;
ev sahibi yalnız sistemin çözemediğini görür.

## 4. "Yapamıyorum" düğmesi → KALDIRILIR (kurucu onayı)
Yerine: (a) WhatsApp'taki **[Gelemem]** (iş başlamadan, akşam önce sorulan soruya cevap — "düğme" değil, sorulan soru); (b) yedeğe
kendiliğinden devir. Bugünkü verideki eski "Yapılamıyor" görevleri okunmaya devam eder (Girişler'de görünür, yeniden atanınca "Yapılacak"a
döner); yeni "Yapılamıyor" yazılamaz.

## 5. "İş başladı" ne demek (kurucu: hesap yeterli; fotoğraf şart değil) — §9 E7 ile DARALTILDI, T1'de bu hâliyle uygulandı
- **İş izi** = kişinin "Başladım" / "Onay bekliyor" / "Bitti" kaydı, kişinin notu, fotoğraf ya da kontrol listesinde işaretli madde. Kimin
  yaptığı hesabından (ileride numarasından) belli.
- **İş izi SAYILMAZ:** ev sahibinin (ya da sistemin) yeniden ataması — "Yapılacak'a döndü" kaydı — ve eski "Yapılamıyor" kaydı (kurucu 11-13
  S-E1: "sayılmasın"). Kurucunun sözü bu kayıt içindi; kişinin işareti / notu iz sayılmaya DEVAM eder (Opus 11-13 P2-8 ve K-1 kararları:
  maddelerin yarısını işaretlemiş kişi işin ortasında başkasına verilmez).
- Bu dar tanım YALNIZ Girişler ataması ve temizlikçi değişince aktarım içindir (`WORK_TRACE_TASK_UPDATE_WHERE`). İptal ONARIMININ silme kümesi
  GENİŞ kalır (`TOUCHING_TASK_UPDATE_WHERE` — şüphede silme yok, kurucu D5 10-15).
- Başlamış görev sistem tarafından yedeğe DEVREDİLMEZ; sahip / yönetici yine değiştirebilir (bilinçli seçim, onaylı soru ile).
- Bilinen sınır: ev sahibinin (kişinin değil) yazdığı not da iz sayılır — güvenli yönde (başkasına verilmez); kişi ayrımı kanıt modeliyle (T3).

## 6. Mimari (kısa)
- **Kişi kaydı:** "ekip kişisi" = ad (isteğe bağlı) + telefon (E.164) + WhatsApp izni (zaman damgası) + hangi işletme. Kullanıcı hesabı
  DEĞİL (giriş yok). Bugünkü personel hesapları kalır; bir kişi hem hesap hem numara olabilir (bağ). → **yeni tablo (migration)**.
- **Görev ataması:** görev ya bir hesaba ya bir ekip kişisine atanır (tek "kime atandı"). Bugünkü kodun her yeri hesaba atamayı okuyor →
  geçiş adım adım (önce yedek + teklif motoru hesaplarla, sonra ekip kişisi).
- **Teklif motoru (kanaldan bağımsız):** görev başına "teklif" kaydı (kime, ne zaman, son cevap anı, cevap) → kabul / ret / süre doldu →
  sıradaki aday (dairenin temizlikçisi → yedek). Tek kazanan (satır kilidi + koşullu güncelleme; geç kabul geri çekilmiş teklifi diriltmez —
  Codex 11-06 notu). Cevap süresi sabit değil, işe yetişme saatine göre (giriş saatinden makul süre önce kapanır).
- **WhatsApp kanalı:** var olan ev sahibi WhatsApp altyapısı (bağlama, şablon gönderimi, gelen düğme yönlendirmesi) + 11-06'da hazırlanan
  temizlikçi şablon başvurusu (`docs/WHATSAPP-SABLON-BASVURUSU-2026-11-06-temizlikci.md`; Meta onayı gerekir). Gelen düğme, numaranın
  kişisine ve teklif kimliğine bağlanır (başkasının teklifine basılamaz). İzin: kişinin ilk mesaja "Evet" demesi (WhatsApp kuralı: alıcının
  açık onayı; ev sahibinin numara yazması onay sayılmaz). ⚠️ §9 İ3 ile DEĞİŞTİ: ilk mesajı kişinin KENDİSİ atar (QR / `wa.me` kodu); kişi
  kaydı = giriş yapamayan personel kullanıcısı + kanal bağı (§9 İ5).
- **Anahtarlar:** hepsi KAPALI doğar; ilk gerçek gönderim kurucuyla.

## 7. Dilimler (§9 İ2 ile yeniden sıralandı)
| Dilim | İçerik | Meta onayı | Migration | Durum |
|---|---|---|---|---|
| T1 | "Yapamıyorum" kaldırılır (UI + yeni yazım yolu); "iş izi" dar tanımı §5 (Girişler'den atama + temizlikçi değişince aktarım) | hayır | hayır | ✅ `65f79bb1` (mutasyon 7/7) |
| T2 | Daire sayfasında **yedek temizlikçi** (aynı kural kaydında `backupUserId`; temizlikçi değişince / "Kimse"de kaybolmaz; temizlikçiyle aynı kişi olamaz); Girişler'de kişi değişecekken yedek ön seçili "(yedek)", atama yine "Atayın" ile | hayır | hayır | ✅ `dad2c203` |
| T3 | **Ekip kişisi + kanıt modeli:** giriş yapamayan personel kullanıcısı (İ5) + "personel kanal bağı" tablosu; kişinin kendi ilk WhatsApp mesajıyla bağlanma (İ3, QR / `wa.me` kodu) | hayır | **evet** (kurucu onayı) | ✅ kod (§10, anahtar KAPALI) |
| T4 | **Teklif motoru** (kanaldan bağımsız; yalnız [Gelemem] / son saat geçince yedeğe — İ1) + Panel'de "kimse onay vermedi" istisnası; sahte taşıyıcıyla test | hayır | **evet** (teklif tablosu) | tasarım |
| T5 | WhatsApp düğmeleri ([Gelemem] · [Gelirim] · [Başladım] · [Bitti]) + fotoğraf eki; şablon başvurusu YENİDEN yazılır (İ4) | **evet** | hayır | tasarım |
| T6 | Telefonsuz temizlikçi için ev sahibine tek "bitti mi?" sorusu (kişi kaydı T3'te) | hayır | hayır | tasarım |
Eski T3'ün "kanal olarak bugün e-posta" bacağı DÜŞTÜ (§9 D7: üretimde personel hesabı yok, e-postadaki onay bağlantısı siteye girmeyi gerektirir).

## 8. Açık noktalar (kurucuya değil, kod tasarımında çözülecek; kurucu kararı gerekirse ayrıca)
- Onay mesajının saati (19:00) ve son cevap saati (21:00) işletme saat dilimine göre; aynı gün açılan rezervasyonda süreler kısalır.
- Yedek de kabul etmezse ikinci yedek? (İlk sürüm: bir yedek; liste ileride.)
- WhatsApp ücreti (Meta, konuşma başına) ve numara (temizlikçiler için ayrı numara — K-3).

## 9. Opus tasarım incelemesi (11-13 gece) — benimsenen kararlar
Ajan raporu `scratchpad/handoff/OPUS-1113K-temizlikci-tasarim.md` (repoya alınmadı); her madde kodda doğrulandı.
- **İ1 — Kalıcı atama + istisnada teklif (tasarımda benimsendi; T4 kodlanmadan önce kurucuya örnekli tek soru — temizlikçiye ve ev sahibine
  dokunan davranış):** görev bugün de dairenin temizlikçisine doğrudan atanıyor (`automation.ts`
  `createReservationTasks`). Akşam yalnız hatırlatma + [Gelemem]; sessizlik = geliyor; sabah [Başladım]. Teklif kaydı YALNIZ [Gelemem] ya da
  başlama son saati geçince yedeğe açılır (tek aday, tek kabul). Gerekçe: "sessizlik = ret" hedef kişiyle (50 yaşında, mesaja her akşam
  bakmayan) sık yanlış yedek ve aynı kapıda iki kişi doğururdu; durum makinesi küçülür, geç kabul yarışı büyük ölçüde kalkar.
- **İ2 — Sıra:** kişi kaydı (T3) teklif motorundan ve WhatsApp'tan ÖNCE — üretimde personel hesabı açılamıyor (D7); hesap tabanlı teklifin
  kullanıcısı yok.
- **İ3 — İzin ve numara kişinin KENDİ ilk mesajıyla:** ev sahibinin ekranında kişiye özel QR / `wa.me/<temizlikçi numarası>?text=LIXUS-…`
  kodu (ev sahibi kanalının bugünkü doğrulama kodu kalıbı, `src/lib/host-channel/binding-code.ts`). Kazanç: izin Meta kuralına uygun (kullanıcı
  başlatır), numara Meta'dan gelir (yazım hatası / yanlış kişi / yeniden tahsis edilmiş numara riski kalkar), ilk ücretsiz pencere açılır.
  Ev sahibinin numara yazması gerekmez; numara değişince aynı adım tekrarlanır.
- **İ4 — Şablon başvurusu bu hâliyle Meta'ya GİTMEZ:** `docs/WHATSAPP-SABLON-BASVURUSU-2026-11-06-temizlikci.md` "Yapamıyorum" düğmelerini
  taşıyor, teklif şablonu ([Gelirim] [Gelemem]) ve iptal / tarih değişti şablonu yok, izin akışı hesaba / davete dayanıyor. Onaylı şablonu
  değiştirmek yeniden inceleme ister → doğru metinler T5'te bir kerede.
- **İ5 — Ekip kişisi = giriş yapamayan personel kullanıcısı (önerilen):** ayrı "atanan türü" yerine rezerve alan adlı yapay e-posta +
  kullanılamaz parola özeti (demo personeli bu kalıbı zaten kullanıyor) + ayrı "personel kanal bağı" tablosu. Kazanç: görev ataması, iş izi
  kuralı (`userId` dolu), "kim başladı" adı, fotoğraf erişimi, üyelik — hiçbiri iki türlü atanan için yeniden yazılmaz. Bedel: giriş / şifre
  sıfırlama / e-posta doğrulama bu kullanıcıları KESİN reddetmeli (pinli). Migration kurucu onayıyla.
- **E7 — §5'in kapsamı:** kurucunun "sayılmasın"ı S-E1 içindi (yeniden atama kaydı) → T1 DAR uygulandı; kişinin işareti / notu iz kalır.
- **Liste 13:** iptal onarımının silme kümesi gevşetilmedi (§5).
- **Opus'un doğru bulduğu, değişmeyen:** rol kuralı (temizlikçiyi yalnız sahip + yönetici değiştirir) zaten `withManage` ile yürürlükte;
  aynı gün iki temizlikte elle yazılan "bitti" / düğmesiz fotoğraf için kural (tek açık iş → ona; birden çoksa sor; hiç yoksa ekleme) T5'te
  yazılacak.

## 10. T3 uygulaması (11-13 gece; kurucu "migration onayın var") — anahtar `TEAM_CONTACTS_ENABLED` KAPALI
- **Kayıt (İ5):** ekip kişisi = `User` (rol `staff`, `loginDisabled = true`, yapay `team-<24 onaltılık>@team.invalid`, kimsenin bilmediği rastgele
  parolanın özeti, `emailVerifiedAt` dolu) + ANA üyelik (köken `team`). Görev ataması, dairenin temizlikçisi / yedeği, "kim başladı" hiç
  değişmeden çalışır. Kod `src/lib/team-contacts/` (saf `core.ts`, veritabanı `service.ts`, web kancası `inbound.ts`), migration 97.
- **KESİN ret (pinli):** giriş (bilinmeyen hesapla AYNI yol: sahte bcrypt + aynı hata + hesap kovası), şifre sıfırlama isteği (kod
  üretilmez, aynı 200), doğrulama e-postası yeniden gönderme, e-posta doğrulama bağlantısı. E-posta TEK BOĞAZ: `email-core` `.invalid` adrese
  sağlayıcıyı hiç çağırmaz (`undeliverable`); görev / "görevlendirmeniz değişti" e-postası ekip kişisinde baştan atlanır (tavan da harcanmaz).
- **Kanal bağı (İ3):** ev sahibi Ayarlar › Ekip kişileri'nde "WhatsApp kodu oluştur" → `EKIP-XXXXXX` + `wa.me/<temizlikçi numarası>?text=…`
  (72 saat). Kişi kodu KENDİ telefonundan temizlikçi numarasına gönderir; web kancası (`phone_number_id` = `TEAM_WHATSAPP_PHONE_NUMBER_ID`)
  bağı etkinleştirir, numara Meta'dan gelir ve şifreli saklanır, ilk mesaj izin anıdır (`optInAt`). Ev sahibi numara YAZMAZ.
  - Önek `EKIP-` (ev sahibi bağının `LIXUS-` kodundan ayrı): iki numara karışsa da kod yanlış akışa düşmez; temizlikçi numarasının mesajı ev
    sahibi akışına HİÇ girmez ve "yabancı numara" alarmı saymaz. Temizlikçi numarası kimliği ev sahibininkiyle aynıysa yok sayılır.
  - Numara işletme içinde tek kişide (başka kişiye geçerse eskisi `number_moved`); işletmeler arası SERBEST — bir temizlikçi birden çok ev
    sahibiyle çalışabilir (tekil dizin `organizationId + provider + addressHash`). Kişi başına tek etkin numara (`replaced`); yeni kod eskisini
    geçersiz kılar.
  - Bekleyen bağda numara yoktur; kod özetle aranır → yanlış kod satır bulmaz, deneme sayacı YOK. Bilinen sınır: tahmin alanı 32⁶ ≈ 10⁹,
    kod 72 saat yaşar, her deneme gerçek bir WhatsApp mesajı (Meta ücretli + hız sınırlı). İşletme başına saatte 30 kod sınırı.
- **Bu dilimde YOK (bilinçli):** temizlikçiye giden mesaj (onay cevabı dahil) ve "bitti" / fotoğraf / [Gelemem] işleme → T5; ekip kişisini
  silme (görev geçmişi kişiye bağlı; üyelikten çıkarma ayrı tur); telefonsuz kişi için ev sahibine soru → T6.
- **Açılış:** `TEAM_CONTACTS_ENABLED=1` yalnız adla ekleme + görev atamasını açar; WhatsApp bağı ayrıca `HOST_CHANNEL_ENABLED` + Meta'da ikinci
  numara + `TEAM_WHATSAPP_PHONE_NUMBER_ID` + `TEAM_WHATSAPP_NUMBER` ister (`docs/RAILWAY-ACILIS-2026-10-15.md`).

