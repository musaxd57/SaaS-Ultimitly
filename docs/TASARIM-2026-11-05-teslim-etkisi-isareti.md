# Tasarım — teslim etkisi işareti (Tur 7 T7-OB-5, 2026-11-05, migration 91)

**Sorun (çürütücüyle doğrulandı):** kalıcı kuyruk açıkken teslim edilen cevaptan sonra 48 saat boyunca onarıcı her geçişte (2 dk) şu
koşulla çalışıyor: "satır gönderildi + konuşma Yeni / Bekliyor + teslimden sonra misafir mesajı yok → Cevaplandı yap". Ev sahibi teslimden
sonra konuşmayı bilerek "Yeni" yaparsa 2 dakika içinde yine "Cevaplandı" oluyor; 48 saat tekrar ediyor.

**Neden yeni kolon (gerekçe):** onarıcının ayırması gereken iki durum ("etki hiç uygulanmadı — çökme penceresi" ile "uygulandı, sonra ev
sahibi değiştirdi") bugünkü verilerde aynı görünüyor. Mevcut alanlar işe yaramıyor:
- `Conversation.updatedAt` her yazmada değişir (devir kilidi, senkron, öğeler) → çökme penceresinde de ilerler, onarım sessizce kapanırdı;
  ayrıca mevcut onarıcı testi (konuşma satırdan sonra kurulmuş) kırılırdı (çürütücü ölçtü).
- `MessageOutbox.reconciledAt` belirsiz gönderimin uzlaştırma anıdır — iki anlam tek kolona yüklenirdi.
- Pencereyi kısaltmak yalnız ezme süresini kısaltır, hatayı gidermez.

**Çözüm:** `MessageOutbox.deliveryEffectAt` (boş olabilen). Normal yol (`applyDeliveryEffect`) etkiyi uyguladıktan sonra damgalar; onarıcı
yalnız damgasız satırlara bakar ve sayfa sonunda damgalar → her satır en çok bir kez onarılır. Damga yazılamazsa (DB hıçkırığı) onarıcı bir
kez bakar (eski davranış, bir defalık). Migration öncesi satırlar boştur → açılıştan sonra en çok bir kez onarılır. Sayfalama, damgalanan
satır süzgeçten çıktığı için `cursor + skip` yerine açık "id > imleç" ile.

**Müşteriye görünen:** ev sahibinin elle seçtiği durum korunur (önce: 2 dk sonra "Cevaplandı" · sonra: "Yeni" kalır). Misafire giden yok.
