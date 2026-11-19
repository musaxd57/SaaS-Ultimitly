# Tasarım 2026-11-19 — UA-1: "Kayıtları karşılaştır"

> Kaynak: `docs/KURUCU-TALIMATI-2026-11-19-gece-raporuna-cevap.md` UA-1 (kurucunun aktardığı Codex cevabı): "Sadece 'İki dairede kayıtlı'
> yerine 'Bu rezervasyon Lale 3 ve Lale 5'te görünüyor' ve `Kayıtları karşılaştır`. Kaynakları yan yana gösterelim. Host yanlış elle girilen
> kopyayı oradan kaldırabilsin; kanaldan gelen kayıtta ise doğrudan silmek yerine kaynak bağlantısı düzeltilsin. Yoksa sonraki senkron aynı
> kaydı geri getirebilir. Çakışma çözülmeden kapı bilgisi gitmesin."

## 1. Bugün (envanter: Haiku 11-19, kodla doğrulandı)

- Rezervasyon `(propertyId, sourceReference)` çiftinde tekil; aynı kaynak kimliği iki dairede bulunabilir.
- İki daireye düşme yolları: iCal beslemesi A'dan silinip B'ye eklenir (A'daki satırlar "manual" olarak kalır, B'de yeni satır açılır) · aynı
  UID'li besleme / dosya iki daireye eklenir · elle girilen kayda kanaldan kopyalanan referans yazılır · (çıkarım) kanalda ilan taşınır.
- Kural tek yerde (`lib/booking-property-conflict.ts`): iki dairede ETKİN kayıt → karşılama / giriş bilgisi / çıkış mesajı TUTULUR
  (gönderici + kuyruk işçisi + Girişler). Kapı bilgisi bugün de gitmiyor; bu tasarım onu değiştirmez.
- Panel satırı: "Aynı rezervasyon iki dairede kayıtlı: A ve B" → bağlantı varış ayının takvimine gider. Orada hangi kaydın yanlış olduğu
  görünmez, kaldırma düğmesi yok.
- Silme ucu var (`DELETE /api/reservations/[id]`, sahip / yönetici) ama kaynağa bakmaz: kanaldan / takvimden gelen satır silinirse sonraki
  senkronda GERİ GELİR (iz yalnız KVKK silmesinde var).
- Kaynak → daire bağlantısı: takvim beslemesi `CalendarSource.propertyId` (değiştirilemez; daire sayfasında kaldır + doğru daireye ekle).
  Kanal ilanı ↔ daire eşlemesi otomatik ve arayüzden değiştirilemiyor (`hospitable-sync.ts linkProperty`; kanala özgü yeni ekran YAPILMAZ —
  kurucu 09-23).

## 2. Akış

**Panel satırı** (metin kurucunun aktardığı cevaptan AYNEN):
> **Bu rezervasyon Lale 3 ve Lale 5'te görünüyor**
> 5 Ara · Otomatik mesajlar bekletiliyor. · [Kayıtları karşılaştır]

Üç daire: "Lale 1, Lale 3 ve Lale 5'te". Bağlantı: `/reservations/compare/<satır anahtarı>` (anahtar = etkin satırların en küçük kimliği;
URL'de kaynak kimliği taşınmaz).

**Karşılaştırma sayfası:** aynı kaynak kimliğini taşıyan, bu işletmedeki bütün satırlar yan yana (mobilde alt alta). Her kart:
- Daire · Kaynak · Giriş → çıkış · Misafir · Durum · Son güncelleme.
- Kaynak sınıfı (saf fonksiyon, tek kural):
  - **elle** (takvim kaynağı yok, kanal bağlantısı yok; elle tek kayıt ya da dosya içe aktarımı): "Elle girildi" / "Dosyadan içe aktarıldı".
    Eylem: **Bu kaydı kaldır** → aynı satırda kısa onay ("Bu kayıt silinsin mi?" + Sil / Vazgeç; İK-3 ile aynı biçim) → var olan silme ucu.
  - **takvim** (takvim kaynağı var): "Takvimden geliyor: <besleme adı>". Silme YOK. Açıklama: "Bu kayıt <besleme adı> takviminden geliyor.
    Takvim yanlış daireye eklendiyse daire sayfasında kaldırıp doğru daireye ekleyin." + [Daire sayfasına git].
  - **kanal** (kanal bağlantısı var): "Kanaldan geliyor". Silme YOK. Açıklama: "Bu kayıt kanaldan geliyor. İlanın bağlı olduğu daire yanlışsa
    bize yazın, birlikte düzeltelim." + destek bağlantısı. (Sağlayıcıdan bağımsız ilan ↔ daire düzeltme yüzeyi D5 tasarımında.)
- Etkin olmayan satırlar (iptal / konaklaması bitmiş) soluk ve "Etkin değil" etiketiyle gösterilir, eylem yok (çakışmayı oluşturmuyorlar).
- Çakışma çözülünce (etkin daire sayısı < 2) sayfa "Kayıtlar artık tek dairede. Otomatik mesajlar olağan akışa döndü." der.

**Sunucu kuralı (savunma):** karşılaştırma sayfasından gelen kaldırma isteği yeni bir uçtan gider ve yalnız **elle** sınıfındaki satırı siler
(takvim / kanal satırına 409 + "Bu kayıt kaynağından geliyor; silinirse geri gelir."). Var olan genel silme ucunun davranışı DEĞİŞMEZ (başka
çağıranı var mı ayrıca taranır; değiştirmek ayrı karar).

## 3. Testler

- Saf kaynak sınıfı: elle / dosya / takvim / kanal (+ eksik alan → güvenli yön: kanal ya da takvim sayılır, silinemez).
- Sayfa yükleyicisi: başka işletmenin satır anahtarı → 404 (sebep sınanır) · aynı kaynak kimliği başka işletmede → görünmez · etkin olmayan
  satır etiketli · çakışma çözülmüş → bilgi cümlesi.
- Kaldırma ucu: elle satır silinir, sonra tutma kalkar (gönderici aynı rezervasyonun mesajını gönderilebilir görür — kural aynı yüklemden) ·
  takvim / kanal satırı 409, satır yerinde · personel 403 · bürünme yazma reddi · başka işletme 404.
- Panel satırı yeni metin + bağlantı; kart tavanı (öneri 3, fazlası "+N rezervasyon daha").
- Yeni dinamik rota → `cross-tenant-coverage`, rol kapısı pini, denetim kaydı `auditActor(` kalıbı.

## 4. Kurucuya (metin) — örnekli

Kurucunun aktardığı iki metin AYNEN kullanılır. Yeni metinler (soru UA-a): kaynak etiketleri ("Elle girildi", "Dosyadan içe aktarıldı",
"Takvimden geliyor: …", "Kanaldan geliyor"), takvim ve kanal açıklamaları, onay cümlesi, çözüldü cümlesi, 409 metni.
