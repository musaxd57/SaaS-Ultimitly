# WhatsApp şablon başvurusu — temizlikçi bildirimleri (2026-11-06)

> Kurucu 11-06 sabah: "wp için şirket business hesabından yapabiliriz, şablon başvurusunu hazırla bir dosyada" · "başka numaradan
> temizlikçilere mesaj atarız, ileride 2 farklı numara olur". Bu dosya Meta'ya (WhatsApp Manager) girilecek metinleri ve adımları içerir.
> Kod bu şablonlar onaylanınca bağlanır (anahtar `STAFF_WHATSAPP_ENABLED`, KAPALI doğar; ilk gönderim kurucuyla). Ev sahibi şablonları
> (`lixus_misafir_sorusu`, `lixus_karar_bekliyor`, `lixus_acil_bildirim`) ayrıdır: `docs/TASARIM-2026-10-30-whatsapp-ev-sahibi-dongusu.md`.

## 0. Numara düzeni (kurucu kararı)
| Numara | Kimden kime | Not |
|---|---|---|
| Lixus iş numarası 1 (mevcut) | Lixus → ev sahibi | Bugünkü ev sahibi kanalı. |
| Lixus iş numarası 2 (YENİ) | Lixus → temizlikçi | Bu başvuru. Aynı Meta İşletme hesabının (WABA) altına ikinci telefon numarası olarak eklenir. |

- Şablonlar Meta'da **WhatsApp işletme hesabı (WABA) düzeyinde** onaylanır; aynı WABA'daki iki numara da aynı onaylı şablonu gönderebilir.
  Yine de temizlikçi şablonları yalnız 2. numaradan gönderilir (kod bunu ayrı ayarla sabitler).
- **Ev sahibinin kişisel numarası hiçbir zaman gönderici değildir** (Codex'in uyarısı — doğru).
- Ayrı numaranın faydası: aynı kişi hem ev sahibi hem temizlikçi olabilir (kendi dairesini temizleyen ev sahibi). 1. numaraya gelen mesaj
  ev sahibi işidir, 2. numaraya gelen mesaj temizlik işidir — gelen "Bitti"nin hangi rolden geldiği numaradan bellidir.

## 1. Meta'da yapılacaklar (sırayla)
1. **Numara:** business.facebook.com → WhatsApp Yöneticisi → Hesap araçları → Telefon numaraları → **Telefon numarası ekle**. Daha önce
   WhatsApp'ta kullanılmamış (ya da WhatsApp hesabı silinmiş) bir numara olmalı; SMS / sesli arama ile doğrulanır.
2. **Görünen ad:** "Lixus Görevler" (Meta görünen adı ayrıca onaylar; marka adıyla tutarlı olmalı).
3. **Şablonlar:** Hesap araçları → Mesaj şablonları → **Şablon oluştur** → Kategori **Yardımcı (Utility)** → Dil **Türkçe** → aşağıdaki
   §2 metinleri AYNEN (değişkenler `{{1}}` biçiminde, örnek değerler §2'de).
4. **Bize iletilecekler (kasa / Railway ortam değişkeni; repoya YAZILMAZ):** 2. numaranın `phone_number_id`'si
   (`STAFF_WHATSAPP_PHONE_NUMBER_ID`) ve görünen numara (`STAFF_WHATSAPP_BUSINESS_NUMBER`, ülke koduyla). Erişim belirteci ve uygulama
   sırrı ev sahibi kanalıyla aynı (aynı uygulama) — yeni sır gerekmez. Web kancası aynı uç; gelen mesajın hangi numaraya geldiği
   `metadata.phone_number_id` alanından ayrılır.

## 2. Şablon metinleri (Meta'ya girilecek)
Kurallar (Meta incelemesi): gövde değişkenle başlamaz / bitmez · her değişkene örnek değer · pazarlama / indirim dili yok · emoji yok.
Kategori hepsinde **Yardımcı (Utility)**: alıcının kendi görevlendirmesinden doğan işlem bildirimi.

### 2.1 `lixus_yeni_temizlik` — yeni görev
- **Gövde:** `Yeni temizlik göreviniz var: {{1}}, {{2}}. Misafirin çıkışı {{3}}. İşe başlayınca aşağıdan “Başladım”a basın.`
- **Örnek değerler:** `{{1}}` = `Lale 5` · `{{2}}` = `7 Kasım Cumartesi` · `{{3}}` = `11:00`
- **Alt bilgi:** `Lixus AI · Durdurmak için DUR yazın`
- **Düğmeler (Hızlı yanıt):** `Başladım` · `Yapamıyorum`

### 2.2 `lixus_gorevlendirme_degisti` — görev başkasına geçti
- **Gövde:** `Görevlendirmeniz değişti: {{1}} için {{2}} tarihli temizlik artık sizin listenizde değil. Bir sorunuz varsa ev sahibinizle görüşün.`
- **Örnek:** `{{1}}` = `Lale 5` · `{{2}}` = `9 Kasım Pazartesi`
- **Alt bilgi:** `Lixus AI · Durdurmak için DUR yazın` · Düğme yok.

### 2.3 `lixus_cikis_saati_degisti` — geç çıkış onaylandı / çıkış değişti
- **Gövde:** `{{1}}, {{2}}: misafirin çıkış saati {{3}} oldu. Temizliğe bu saatten sonra başlayın.`
- **Örnek:** `{{1}}` = `Lale 5` · `{{2}}` = `7 Kasım Cumartesi` · `{{3}}` = `14:00`
- Düğme yok.

### 2.4 `lixus_temizlik_hatirlatma` — iş günü sabahı (isteğe bağlı)
- **Gövde:** `Bugün {{1}} temizliğiniz var. Misafirin çıkışı {{2}}. İşe başlayınca “Başladım”a basın.`
- **Örnek:** `{{1}}` = `Lale 5` · `{{2}}` = `11:00`
- **Düğmeler (Hızlı yanıt):** `Başladım` · `Yapamıyorum`

> "Bitti" düğmesi için ayrı şablon GEREKMEZ: temizlikçi "Başladım"a bastığında 24 saatlik konuşma penceresi açılır; o pencerede şablonsuz
> etkileşimli mesaj gönderilir: `Lale 5 temizliği başladı. Bitince “Bitti”ye basın.` [Bitti] [Yapamıyorum]. (Pencere içi mesajlar ücretsizdir.)

## 3. İzin (opt-in) — numarayı bilmek izin değildir
- Temizlikçinin numarasını ev sahibinin girmesi izin sayılmaz (Meta kuralı). Akış ev sahibi bağlamasıyla aynı: temizlikçi davetini kabul
  edince "WhatsApp bildirimlerini aç" der → `wa.me/<2. numara>?text=LIXUS-K7Q2` bağlantısı → temizlikçi kodu kendisi gönderir → numara
  doğrulanır, izin anı kaydedilir. **DUR** yazınca bağ kapanır, bildirim e-postaya döner.
- Bir temizlikçi birden çok ev sahibiyle çalışabilir (üyelik modeli, K-2): tek numara, tek bağ; her mesaj hangi daireyi / işletmeyi
  söyler (şablonlarda `{{1}}` daire adı).

## 4. Gelen "Bitti" nasıl kabul edilir (Codex'in notu — açıklama)
Codex "Bitti kabul edilmesin" demiyor; **"Bitti"nin hangi göreve ait olduğu tahmin edilmesin** diyor. Düzen:
- **Düğmeyle gelen "Bitti" / "Başladım" / "Yapamıyorum" doğrudan kabul edilir.** Her düğmenin gizli yükünde görevin kimliği var; sunucu
  denetler: mesajı gönderen numara bu temizlikçiye bağlı mı · görev hâlâ ona atalı mı · görev o işletmede mi. Üçü tutarsa durum değişir
  (panoya basmakla aynı; kimlikli "bitti" kaydı düşer). Yapay zekâ yok.
- **Elle yazılan "bitti":**
  - Açık tek işi varsa: `Lale 5 temizliği bitti olarak işaretlensin mi?` [Evet] [Hayır] — onaylayınca kabul.
  - Birden çok açık işi varsa: `Hangi iş bitti?` [Lale 3 · 7 Kas] [Lale 5 · 7 Kas] — seçince kabul.
  - Hiç açık işi yoksa: `Şu an açık bir işiniz görünmüyor.`
- Görev başkasına geçtiyse (eski mesajın düğmesine basıldıysa): `Bu görev artık sizin listenizde değil.` — işlem yapılmaz.
- Neden: "bitti" kaydı misafire giden kararları (erken giriş) ve Girişler'deki "TEMİZLİK HAZIR"ı belirler; yanlış göreve düşerse yanlış
  daire "hazır" görünür.

## 5. Maliyet (yaklaşık; Meta fiyatı ülkeye ve kategoriye göre)
- Pencere DIŞINDAKİ utility şablonu ücretlidir (Türkiye utility fiyatı düşük; görev başına 1 şablon). "Başladım" sonrası pencere
  içindeki mesajlar ücretsiz. 10 daire · ayda ~60 temizlik → ayda ~60 şablon.

## 6. Kodda bağlanacaklar (onay gelince — bu dosyanın kapsamı dışında, sıra)
1. `STAFF_WHATSAPP_ENABLED` + 2. numaranın kimliği (ortam).
2. Personel bağlama rotası (bugünkü ev sahibi rotası "personel asla" der; ayrı, dar kapsamlı) — üyelik modeline (K-2) bağlı.
3. Bildirim tek giriş `notifyStaff(userId, olay)`: WhatsApp bağı varsa şablon, yoksa e-posta (bugünkü).
4. Gelen düğme yükü → görev durumu (yetki sunucuda; §4).
