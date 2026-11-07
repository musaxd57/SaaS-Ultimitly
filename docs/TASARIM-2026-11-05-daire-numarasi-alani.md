# Tasarım — `{daire}` ev sahibinin belirlediği alandan (kurucu 11-05: "B seçeneği daha sağlam") — ONAY BEKLİYOR

## 1. Bugün
- `{daire}` = mülkün İÇ adından okunan tek numara (`apartmentNumberOf`; kurucu kararı 09-30: okunamıyorsa tahmin yok, mesaj gitmez).
  İç ad misafire hiç çıkmaz, yalnız numara çıkar. Sorun yanlış numara: "Lale Apartman 2 Daire 5" → **2** (T5-3); kalıbı genişletmek
  her yeni ad biçiminde yeniden kovalamak demek.
- Mevcut misafire gösterilen alan **`guestDisplayName`** ("Misafire görünen daire adı", QR sohbet başlığı, istemde yer adı) — bu bir
  AD ("Deniz Manzaralı Daire"), numara değil. `{daire}`i ondan doldurmak tahmini geri getirir → **aynı anlamda iki alan oluşmuyor; ayrı
  alan gerekiyor.**
- `{daire}` 20 yerde çözülüyor (karşılama / giriş / çıkış gönderici + kuyruk işçisi + önizlemeler, nezaket cevabı, yapay zekâ istemine
  giden bilgi tabanı kalemleri, QR sohbeti, gönderilenler sayfası). Hepsi bugün yalnız mülk adını verir.

## 2. Öneri
- **Yeni alan** `Property.guestUnitNumber` (boş olabilen metin, en çok 20 karakter; ör. "5", "12B", "A-3"). Migration 92 (tek ADD COLUMN,
  boş olabilen, varsayılansız — dolu tabloda güvenli). Mülk formunda "Daire numarası (misafire gösterilir)".
- **Tek çözüm noktası:** `{daire}` = alan doluysa ALAN; boşsa bugünkü okuma (mülk adından). 20 çağrı yeri mülk adı yerine aynı küçük
  nesneyi (`{ name, guestUnitNumber }`) verir — tek yardımcıdan, "yüklem var argüman yok" hatasına karşı her yol için davranış testi.
- **Geçiş — sessiz değişiklik yok, tahmin otomatik doğru sayılmaz:**
  1. Alan boşken davranış BUGÜNKÜ gibi (mülk adından okunur). Alan otomatik DOLDURULMAZ.
  2. Mülk sayfasında, `{daire}` kullanan bir otomatik mesaj / bilgi kalemi varsa ve alan boşsa görünür kutu:
     - numara okunabiliyorsa: **"Mesajlarınızda {daire} şu an daire adından okunuyor: 5. Doğruysa kaydedin; değilse düzeltin."** + alan
       bu değerle ÖNERİLİ (kaydedilmez — ev sahibi "Kaydet"e basarsa alan dolar).
     - okunamıyorsa (bugün mesaj gitmiyor): mevcut uyarı + **"Daire numarasını girin; girilene kadar bu mesajlar gönderilmez."**
  3. Ev sahibi kaydettiği an `{daire}` o değer olur (önizleme gerçek gönderimle aynı doldurucu).
  4. (İleride, AYRI karar) bütün dairelerde alan dolunca "addan okuma" kaldırılabilir; o gün de önce hangi mesajların etkileneceği
     listelenir.

## 3. Önce / sonra
- "Lale Apartman 2 Daire 5", alan boş: önce ve geçişten sonra **"Daire numaranız 2."** (aynı) + mülk sayfasında "şu an daire adından
  okunuyor: 2" kutusu → ev sahibi "5" yazıp kaydeder → **"Daire numaranız 5."**
- "Lale" (numara yok), alan boş: önce ve sonra mesaj gitmez (aynı) + kutu "Daire numarasını girin…" → "5" girilince mesaj gider.

## 4. Sorular
- **D-1:** Alan adı ve yardım metni: "Daire numarası (misafire gösterilir)" — örnek "5, 12B". Uygun mu?
- **D-2:** Kutu metinleri (§2.2) uygun mu?
- **D-3:** Alan doluyken bilgi tabanı / yapay zekâ istemindeki `{daire}` de alandan mı gelsin? (önerim: evet — tek kural)
