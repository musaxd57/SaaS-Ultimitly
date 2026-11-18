# Tasarım 2026-11-18 — Gerçek konuşma ve iç not ("Yeni konuşma" formunun yerine)

> Kurucu 11-18 akşam (AYNEN `docs/KURUCU-TALIMATI-2026-11-18-aksam-kararlar-ve-anlam-yonu.md`, "Sıfırdan Akış" tablosu): "Y-1 için komple ayrı
> bir gelişmiş tasarım yapalım … Y-1 metnini değiştirmeyelim; o metne ihtiyaç doğuran formu kaldıralım. İlk iş, gerçek konuşma ile iç notu
> ayırmak. Sonradan eklenen daireyi getirme ve eşleştirme ise Gelen Kutusu'nun değil, kanal bağlantısının işi. BU TASARIMIN ÜSTÜNE GELİŞTİR."
> Bu belge o tablonun üstüne kuruldu; kodun bugünkü hâli envanterle çıkarıldı (dosya adları §2). KOD HENÜZ YOK — dilimler §5.

## 1. Ürün kuralı

**"Gönder" yalnız gerçek bir alıcı varsa görünür.** Gerçek alıcı iki türdür: kanal konuşması (Airbnb / Booking — kanaldan eşitlenen
konuşma) ve QR sohbeti (misafir sohbet sayfasında görür). Bunun dışındaki hiçbir ekran misafire yazıyormuş gibi görünmez.

Bundan çıkan dört sonuç:
1. Lixus misafir konuşması UYDURMAZ. Konuşma ya kanaldan gelir ya QR'dan. Elle "Airbnb konuşması" açılamaz.
2. Ekibin kendi kaydı (telefon görüşmesi, kapıda söylenen, hatırlatma) **iç nottur**: misafire gitmez, cevap sayılmaz, hiçbir işi kapatmaz.
3. Eskiden elle açılmış yerel kayıtlar silinmez, bir kanala bağlanmaz; **"İç kayıt"** olarak korunur (salt okunur + iç not eklenebilir).
4. Daire ↔ ilan eşleştirmesi kanal bağlantısının işidir (Daireler › Kanaldan getir); Gelen Kutusu'ndan yapılmaz. Eşleşme belirsizse Lixus
   isim benzerliğinden tahmin etmez.

## 2. Bugün ne var (envanter)

- **Form:** Gelen Kutusu › "Yeni konuşma" (`inbox/page.tsx`, `inbox/new/page.tsx`, `components/inbox/conversation-form.tsx`): daire, isteğe
  bağlı rezervasyon, misafir adı, **kanal seçimi (Manuel / E-posta / Airbnb / Booking)**, "misafirden gelen ilk mesaj". `POST /api/conversations`
  bir konuşma + gelen mesaj yazar; kanal kimliği YAZILMAZ → konuşmanın gideceği yer yoktur. "Airbnb" seçmek hiçbir gönderim imkânı vermez.
- **Yazma kutusu:** hedefsiz konuşmada da "Gönder" düğmesi çalışır; üstünde "Bu konuşma bir kanala bağlı değil…" notu, gönderince
  "Cevabınız kaydedildi…" duyurusu (11-18 dalga 1'de eklenen dürüstlük metinleri — Y-1). Karar kartı da aynı konuşmada onaylanabiliyor.
- **İç not:** konuşmada / rezervasyonda ekip içi not alanı YOK (`Reservation.notes` ve `Property.notes` tek serbest alan; yazarı, zamanı yok).
- **Rezervasyon ayrıntı sayfası** yok; en yakın yüzey Girişler listesi (satırda "Konuşmayı açın" bağlantısı, konuşma varsa).
- **Rezervasyon ↔ konuşma:** kanal kimliğiyle değer eşlemesi; "rezervasyon var ama konuşma yok" durumu hiçbir yerde söylenmiyor.
- **İlan eşleştirme:** kullanıcıya dönük ekran yok. Senkron ilanı kendisi bağlar (`hospitable-sync.ts linkProperty`): kayıtlı ilan kimliği →
  bağı kopmuş AYNI ADLI daire → kimliği bayatlamış aynı adlı daire → yoksa YENİ daire açar.

## 3. Yeni akış (kurucunun tablosu → ekran ve davranış)

| Ev sahibi ne yapmak istiyor | Lixus'ta ne olur | Uygulama |
|---|---|---|
| Kanal misafirine yazmak | Gelen Kutusu'nda gerçek konuşmayı açar; Girişler satırındaki "Konuşmayı aç" aynı konuşmaya götürür | var (değişmez) |
| Rezervasyon var, konuşma görünmüyor | Girişler satırı: "Kanal konuşması henüz eşleşmedi". Kanal destekliyorsa "Mesajları çek" (var olan eşitleme düğmesi); desteklemiyorsa "Misafire kanalın kendi uygulamasından yazın". Boş sohbet üretilmez | dilim D4 |
| Kanalda yeni ilan var, Lixus'ta daire yok | Daireler › "Kanaldan getir": gelen ilanlar listelenir; her biri var olan bir daireyle EŞLEŞTİRİLİR ya da yeni daire olarak eklenir. Eşleşmeyen ilanın konuşmaları "eşleşme bekliyor" durur; mesaj gönderilmez | dilim D5 (ayrı karar, §6 Y1-c) |
| Telefon görüşmesini kaydetmek | Konaklamada "İç not ekle". Konaklama yoksa daireye not. Sırf not için misafir sohbeti açılmaz | dilim D1 |
| Eski yerel kayda bakmak | Kayıt "İç kayıt" etiketiyle durur: eski mesajlar okunur, altında yalnız "İç not ekle" vardır; "Gönder" yoktur | dilim D3 |

### 3.1 İç not — tanım

- **Nereye bağlanır:** konaklamaya (rezervasyon); konaklama yoksa daireye. Konuşma sayfasından eklenen not konuşmanın konaklamasına bağlanır
  ve o konuşmada da görünür (konuşma kimliği bağlam olarak saklanır).
- **Ne DEĞİLDİR:** mesaj değildir (konuşma akışına karışmaz, "son mesaj" sayılmaz) · cevap değildir (konuşmayı "Cevaplandı" yapmaz, açık ihtiyacı
  gizlemez) · söz değildir (nottan kendiliğinden görev açılmaz) · yapay zekâya girdi değildir (misafire giden cevapta kullanılmaz).
- **Ne taşır:** metin (kısa), yazan kişi (adı kopyalanır — kişi ekipten çıksa da not okunur), zaman.
- **Kim görür / yazar:** sahip + yönetici (ilk dilim). Personel görünümü ayrı karar (§6 Y1-a).
- **Nerede görünür:** konuşma sayfası (konaklamanın notları — misafir mesajlarından AYRI bir bölümde, sarı zeminli değil, sade "İç notlar"
  başlığıyla) · Girişler satırı (not sayısı + son not) · daire sayfası (daireye bağlı notlar).
- **Gizlilik:** not misafir adı / telefonu taşıyabilir → misafir verisi sayılır: veri saklama süresi dolunca ve silme talebinde silinir; dışa
  aktarıma girer. Konuşma birleştirmede (kopya temizliği) notlar korunan konuşmaya taşınır.

### 3.2 Yerel kayıtlar ("İç kayıt")

Elle açılmış, kanal kimliği olmayan, QR da olmayan konuşmalar:
- listede ve sayfada **"İç kayıt"** etiketi; varsayılan Gelen Kutusu görünümünden çıkar, "İç kayıtlar" süzgeciyle bulunur (§6 Y1-b);
- yazma kutusu yerine "İç not ekle"; "Gönder", yapay zekâ önerisi ve karar kartı gösterilmez (alıcı yok);
- "cevap bekleyen" sayaçlarına, Dikkat paneline ve otomatik akışlara girmez (misafir yok);
- sunucu da aynı kuralı uygular: hedefsiz konuşmaya cevap / karar isteği reddedilir (arayüz gizlese de istek gelebilir).
Böylece bugünkü "Cevabınız kaydedildi…" metinlerine ihtiyaç kalmaz (kurucu: "o metne ihtiyaç doğuran formu kaldıralım"); metinler koddan
form kaldırıldıktan sonra çıkarılır.

## 4. Şema (kurucu onayı var: "migrationları yapabilirsin")

Yeni tablo `InternalNote` (migration 99, yalnız ekleme): kimlik · işletme · daire · rezervasyon (isteğe bağlı) · konuşma (isteğe bağlı, bağlam)
· yazan kişi (isteğe bağlı bağ + ad kopyası) · metin · oluşturma anı. Dizinler: (işletme, daire, an) · rezervasyon · konuşma. Silme: işletme /
daire silinince birlikte; rezervasyon silinince not da silinir (misafire ait kayıt); konuşma silinince bağ boşalır.
Yeni misafir verisi tablosu olduğu için veri saklama süpürgesi, silme talebi, dışa aktarma ve kopya konuşma betiğinin envanterleri bilerek
güncellenir (kanarya testleri bunu zaten zorunlu kılıyor).

## 5. Dilimler (her biri küçük, geri alınabilir; sıra bağımlılığa göre)

| Dilim | Ne | Kim | Not |
|---|---|---|---|
| D1 | `InternalNote` tablosu + tek yazıcı + rota (ekle / listele / sil) + konuşma sayfasında "İç notlar" bölümü | Opus (orta) + ana oturum incelemesi | gizlilik envanterleri dahil |
| D2 | "Yeni konuşma" girişi, sayfası, formu ve `POST /api/conversations` kalkar (istek reddedilir) | Opus (kolay) | boş durum metinleri ve testleri güncellenir |
| D3 | Yerel kayıt = "İç kayıt": etiket, yazma kutusu yerine not, sayaçlardan çıkış, sunucuda ret; Y-1 metinleri koddan çıkar | ana oturum (gönderim çekirdeğine dokunur) | karar çekirdeğindeki "yerelde kaydedildi" dalı da kapanır |
| D4 | Girişler satırında "Kanal konuşması henüz eşleşmedi" + eşitleme düğmesi | Opus (kolay-orta) | yeni metin → kurucu onayı |
| D5 | Daireler › Kanaldan getir + açık eşleştirme | ayrı tasarım turu | senkronun bugünkü kendiliğinden bağlama davranışını değiştirir (§6 Y1-c) |

D1 → D2 → D3 sırası "ilk iş, gerçek konuşma ile iç notu ayırmak" talimatını karşılar. D4 ve D5 bağımsızdır.

## 6. Kurucuya sorular

- **Y1-a — iç notu kim görür?** Önerim ilk dilimde sahip + yönetici. Temizlikçi / personel görmesin (not misafir bilgisi taşıyabilir); ileride
  "ekibe açık not" ayrı bir işaret olabilir.
- **Y1-b — eski yerel kayıtlar nerede dursun?** Önerim: varsayılan Gelen Kutusu'ndan çıksın, "İç kayıtlar" süzgeciyle bulunsun. (Bugün kaç tane
  olduğu canlı açılınca sayılır.)
- **Y1-c — senkronun aynı adlı daireye kendiliğinden bağlaması:** bugün ilan kimliği tutmuyorsa senkron, bağı kopmuş / bayatlamış AYNI ADLI
  daireye bağlar, yoksa yeni daire açar. "İsim benzerliğinden tahmin yok" kuralı bunu da kapsıyor mu? Önerim: birebir aynı ad + kopmuş bağ
  durumunda bile ev sahibine sorulsun ("Bu ilan şu daire mi?"); onaylanana kadar ilanın konuşmaları eşleşme bekler. Bu, bugün kendiliğinden
  çalışan bir kurtarma yolunu onaya bağlar — karar sizin.
- **Y1-d — not silme / düzeltme:** önerim yazan kişi ve sahip silebilsin; düzeltme yok (yeni not yazılır).
- **Y1-e — metinler:** "İç not ekle" · "İç notlar" · "İç kayıt" · "Kanal konuşması henüz eşleşmedi" · "Misafire kanalın kendi uygulamasından
  yazın" — uygun mu?
