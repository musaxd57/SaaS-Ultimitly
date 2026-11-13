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
1. **Akşam önce (ör. 19:00) — onay:** Ayşe'ye: "Yarın Lale 5 temizliği · misafir 11:00'de çıkıyor, yeni misafir 15:00'te geliyor. Gelebilir
   misiniz?" **[Gelirim] [Gelemem]**.
2. **Ayşe "Gelirim" →** görev Ayşe'de kalır. Ev sahibine hiçbir şey gelmez.
3. **Ayşe "Gelemem" ya da 21:00'e kadar cevap yok →** sistem KENDİLİĞİNDEN aynı teklifi yedek Fatma'ya yollar. Fatma "Gelirim" → görev
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

## 5. "İş başladı" ne demek (kurucu: hesap yeterli; fotoğraf şart değil)
- **Başladı** = atanan kişinin "Başladım"ı (WhatsApp düğmesi, ileride) ya da kimlikli "Bitti". Kimin bastığı numarasından / hesabından belli.
- Kontrol listesi işareti, not, ev sahibinin yeniden ataması ve eski "Yapılamıyor" kaydı **başladı sayılmaz** (kurucu 11-13: "sayılmasın").
- Başlamış görev sistem tarafından yedeğe DEVREDİLMEZ; sahip / yönetici yine değiştirebilir (bilinçli seçim, onaylı soru ile).

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
  açık onayı; ev sahibinin numara yazması onay sayılmaz).
- **Anahtarlar:** hepsi KAPALI doğar; ilk gerçek gönderim kurucuyla.

## 7. Dilimler
| Dilim | İçerik | Meta onayı gerekir mi | Migration |
|---|---|---|---|
| T1 | "Yapamıyorum" kaldırılır (UI + yeni yazım yolu); "başladı" tanımı §5 (Girişler'den atama + temizlikçi değişince aktarım) | hayır | hayır |
| T2 | Daire sayfasında **yedek temizlikçi** (dairenin temizlikçisinin yanında, aynı kural kaydında); Girişler / Panel'de "temizlikçi başlamadı" satırında tek dokunuşla yedeğe ata (WhatsApp gelene kadar ara çözüm) | hayır | hayır |
| T3 | Teklif motoru (kanaldan bağımsız) + ev sahibi için "kimse onay vermedi" istisnası; kanal olarak bugün e-posta (hesabı olanlar) | hayır | evet (teklif tablosu) |
| T4 | Ekip kişisi (telefonla, hesapsız) + WhatsApp düğmeleri (Gelirim / Gelemem / Başladım / Bitti) + fotoğraf eki | **evet** | evet |
| T5 | Telefonsuz temizlikçi için ev sahibine tek "bitti mi?" sorusu | hayır | hayır |

## 8. Açık noktalar (kurucuya değil, kod tasarımında çözülecek; kurucu kararı gerekirse ayrıca)
- Onay mesajının saati (19:00) ve son cevap saati (21:00) işletme saat dilimine göre; aynı gün açılan rezervasyonda süreler kısalır.
- Yedek de kabul etmezse ikinci yedek? (İlk sürüm: bir yedek; liste ileride.)
- WhatsApp ücreti (Meta, konuşma başına) ve numara (temizlikçiler için ayrı numara — K-3).
