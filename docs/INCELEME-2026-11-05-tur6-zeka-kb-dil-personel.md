# Tur 6 — mülk zekâsı, bilgi tabanı içerik hattı, misafir dili / çeviri, personel ve yüklemeler (2026-11-05)

> Nasıl: dört alan için birer arayıcı ajan, her alanın bulgularını AYRI bir çürütücü kendi deneme betiğiyle yeniden üretmeye çalıştı
> (8 ajan, veritabanısız). 18 bulgudan **1'i çürütüldü** (yinelenen konuşma birleştirmesinde çift sinyal — gerçekleşmiyor), 4'ünün abartılı
> kısmı düzeltildi; 2'si sizin onayınızı bekleyen eski bir maddenin (167b) parçası çıktı. Müşteriye / misafire giden metni değiştirmeyen ya
> da yazılı bir kuralınızı uygulayan düzeltmeler yapıldı; gerisi önce / sonra örnekli soru.

## 1. YAPILANLAR

| # | Ne | Önce → sonra (ölçüm) |
|---|---|---|
| INT-1 | **İlk senkron sahte "İptal tekrar ediyor" kuruyordu.** Hospitable ilk bağlandığında, aylar önce iptal edilmiş (süresi dolmuş talep / reddedilmiş istek dahil) rezervasyonlar "iptal" olayıyla BUGÜNE tarihleniyordu. | Bir dairede 4 eski iptal → panoda "İptal tekrar ediyor · 4 kez", mülk sayfasında "İptal 4 kez" **→ hiçbiri**. İlk görülen satır "yeni rezervasyon" olayıdır; iptal yalnız gözlenen geçişte (iCal / elle dosya ile aynı kural). |
| INT-3 | Mülk Hafızası kartında sinyal günü UTC'ye sabit biçimleyiciyle yazılıyordu. | Gece 00:00–02:59 (İstanbul) gelen şikâyet **bir önceki gün** görünüyordu → işletmenin gününde. |
| INT-4 | Silinen bilgi tabanı kaleminin metni (kapı kodu, Wi-Fi şifresi olabilir) emekli hafıza satırında süresiz kalıyordu (hiçbir ekran okumuyor). | Satır tarihçe olarak kalır (tasarım kararınız), **metin silinir**; eski satırlar bir sonraki geçişte temizlenir. |
| KB6-1 | Şablondan bilgi tabanı önerisi "{sifre}", "%KOD%" gibi doldurulmamış alanı **onaylı bilgi** yapıyordu (yapay zekâ onu gerçek değer sanır). | Öneri yapılmaz; {isim}/{daire} gibi çalışan belirteçler aynen. |
| KB6-2 | Öneri 2.000 karakterde **kesiliyordu** (kayıt sınırı 3.000): son kurallar kayboluyor, yarım kalan son cümle anlamı ters çevirebiliyordu ("Evcil hayvan kabul…"). | Tavan kayıt sınırının tek kaynağı (3.000); aşan şablon önerilmez — kesik bilgi asla saklanmaz. |
| KB6-3 | Öneri "Ekle"de plan sınırı reddi yalnız "Eklenemedi." diyordu. | Sunucunun mevcut açıklaması gösterilir ("Planınızın izin verdiği bilgi tabanı sınırına ulaştınız…") — ekleme formuyla aynı; yeni metin yok. |
| T6-SU-2 | **Görev notu durum değişince ya da fotoğraf eklenince panodan kayboluyordu** (kart yalnız en son güncellemeye bakıyordu; fotoğrafın aynı hatası daha önce düzeltilmişti). | Not, notu olan en son kayıttan. ⚠️ Yan etki: erken giriş "yeniden kontrol ediliyor" sistem notu da sonraki durum değişikliklerinde kartta kalır. |
| DIL-2 | **Türkçe "hasta / para" İspanyolca kanıtı sayılıyordu** (09-25 kuralınız: dillere ortak sözcük listede olmaz). "Annem hasta, para iadesi alabilir mi?" kesin İspanyolca → istem modele İspanyolca dayatıyor, doğru Türkçe cevabı dil kapısı tutuyordu (kanal + QR). | İki sözcük çıktı; Türkçe mesajlar artık İspanyolca sayılmaz, gerçek İspanyolca "es" kalır. Ölçülü veri pininde yanlış hüküm 0, İspanyolca kapsam 0,795 → 0,753 (taban 0,72). |
| DIL-3 | "Çevir" — kayıtlı dil hedefle aynıysa (kayıtlı dil KONUŞMANIN dilidir) İngilizce mesaj çevrilmeden "çeviri" diye gösteriliyordu. | Gerçekten çevrilir (gerçekten Türkçe olan metni model aynen döndürür). |
| DIL-5 | "AI öner" erken giriş taslağının dili yalnız modelin beyanından geliyordu (Türkçe yazan misafire İngilizce taslak). | Kanal oto-yanıtıyla aynı kural: misafirin mesajından emin olunan dil önce. Taslak yine yalnız ev sahibi "kullan" derse gider. |

Kanıt: her düzeltme kırmızı-önce (eski kodda 10 yeni test kırmızı); mutasyon **10/10** (DIL-2 ayrıca: geri alınınca pin kırmızı); DIL-2
için dil veri pini (1.498 metin) ve kapsam tabanı yeşil; tam kapı + build.

## 2. KURUCUYA SORULAR (önce → sonra)

**T6-1 — Kapanış nezaketi Türkçe "Tamam / Teşekkürler / Sağolun / İyi günler"e İngilizce cevap veriyor** (ayar: "teşekküre kısa cevap",
varsayılan kapalı). Türkçe harf (ç, ğ, ş…) yoksa dil İngilizce sayılıyor.
- ÖRNEK: misafir "Tamam tesekkurler" → **önce:** "You're very welcome. 😊" **Sonra (önerim):** "Rica ederiz. 😊" (yalnız Türkçeye özgü
  sözcüklerden oluşan kısa teşekkür Türkçe sayılır; İspanyolca "Gracias" için de İspanyolca satır). Yapalım mı?

**T6-2 — "el" (Türkçe el) de İspanyolca listesinde.** "El sabunu bitti, el havlusu lazım" gibi bir mesaj hâlâ İspanyolca sayılabilir.
Çıkarmak ölçülü İspanyolca kapsamını tabanın altına düşürüyor (0,712 < 0,72). Seçenekler: (a) "el" iki dilde de sayılır (ikisi de kanıt
olmaz; "El agua está inundando todo" gibi kısa İspanyolca belirsiz kalır) ya da (b) taban 0,70'e indirilip "el" çıkar. Önerim (a).

**T6-3 — Görev fotoğrafı yüklenemezse hep "Fotoğraf yüklenemedi." yazıyor** — 5 MB'tan büyük telefon fotoğrafında ev sahibi nedenini
öğrenemiyor, aynı dosyayı tekrar deniyor. Önerim: büyük dosyada "Fotoğraf 5 MB'tan büyük. Daha küçük bir fotoğraf seçin.", çok sık
denemede sunucunun mevcut "biraz bekleyin" metni. Yapalım mı?

**Hatırlatma — 167b (sizin onayınızı bekliyor, yeni değil):** "Yeni görev" formundaki saat sunucuda UTC okunuyor (İstanbul'da 10:00
yazılan görev panoda 13:00) ve atama e-postası saat dilimsiz. Bu turda iki çürütücü bunu yeniden üretti; düzeltme e-posta metnine dokunduğu
için onayınızla, ikisi birlikte.

**Bilinen (belgeli, soru değil):** İspanyol misafire otomatik erken giriş onayı İngilizce gidiyor (desteklenmeyen onay dili yedeği,
`ai-guvenlik.md`); isterseniz İspanyolca satırları ekleriz.

## 3. Bakılıp temiz çıkanlar (kısa)
- Zekâ: sinyal tekilleştirme, sırasız / yarıda kalan olay, KVKK süresi dolan misafir sinyali silme, kiracı kapsamı.
- Bilgi tabanı: onay durumları, kopyalamada kiracı kontrolü, talimat-ele-geçirme süzgeci, plan kilidi.
- Yüklemeler: imzalı adres, işletme anahtarı kontrolü, sihirli bayt, boyut; personel görünümü misafir adı / mesajı taşımıyor.
- Çeviri girdisi istem çitinden geçiyor; dil kapısı kod metnine uygulanmıyor (bilinçli).
