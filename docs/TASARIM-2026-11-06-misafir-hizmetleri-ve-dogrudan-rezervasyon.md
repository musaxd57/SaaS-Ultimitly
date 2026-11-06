# TASARIM — Misafir hizmetleri ("ayrı ama bağlantılı akış") ve doğrudan rezervasyon (PLAN, kod YOK)

> **Kurucu 11-06 gece:** "Her zaman müşteriler sormak zorunda değil; öyle bir özellik olduğunu bilince kullanabilsin … web'in içinde ayrı
> bir akış gibi bir sistem koymak mantıklı olabilir, bunu planlayalım, çok niş ve güzel bir iş olur." · "Airbnb ve Booking kabul
> etmeyebilir … komple ayrı ama bağlantılı bir akış sistemi mi kursak … bu mesajları Airbnb'den sürekli yazmak tehlikeli olabilir." ·
> "İlerde S-3 gibi bir sistem olabilir … bol bol reklam verdiğimiz ve komisyonu en minimum tutarak … en az uğraşla en çok iş … sence peki?"
> **Bağlı belge:** `docs/TASARIM-2026-11-06-isletme-belgesi-dogrulama-ve-yetki.md` (belge → yetki; §16 iş fırsatı).
> **Bağlayıcı:** misafire giden her metin EV SAHİBİNİN AĞZINDAN (ben / biz; "ev sahibiniz …" YASAK — kurucu 11-06) · SORMADAN SİSTEM
> KURULMAZ · müşteriye giden metin önce / sonra örnekli onaya tabi.

## 0. Bir bakışta

1. **Kural (araştırma §1):** Airbnb ve Booking misafirinden platform dışında ÖDEME almak ve misafiri GELECEK rezervasyon için dışarı
   çekmek açıkça yasak; mesajdaki bağlantılar süzülüyor. Airbnb 20 Kasım 2026'dan itibaren misafirden e-posta / telefon istemeyi ve e-posta
   toplayan portalları da sınırlıyor. → **Airbnb / Booking mesajına hiçbir teklif, bağlantı ya da fiyat girmez** (kod kuralı; kurucunun
   kaygısı doğru).
2. **"Ayrı ama bağlantılı" akış = dairedeki QR sohbet sayfası** (Lixus'un kendi kanalı, zaten var): "Konaklamanız boyunca" bölümü — misafir
   sormadan görür. Ama **"nasıl alınır" satırı misafirin geldiği kanala göre KODLA seçilir:**
   - Airbnb misafiri → Airbnb'nin kendi yolu (ekstra ilanda önceden yazılır, Airbnb üzerinden rezervasyona eklenir; turlar Airbnb Deneyimi).
   - Booking misafiri → hizmet tesiste / varışta ödenir.
   - Doğrudan gelen misafir (ileride) → ev sahibinin kendi kanalı.
   - Lixus hiçbir durumda tahsil etmez (kurucu S-2).
3. **Doğrudan rezervasyon (S-3) — düzeltme:** önceki mesajımda önerdiğim "bir dahaki sefere doğrudan" adımı **Airbnb ve Booking misafiri
   için yapılamaz** (iki platform da bunu açıkça yasaklıyor; Airbnb dijital rehberleri de tarıyor). Doğrudan rezervasyon yalnız platform
   DIŞINDAN gelen misafir içindir: reklam, Google, sosyal medya, ev sahibinin kendi çevresi — kurucunun "bol bol reklam" fikri tam buraya
   oturuyor.
4. **Görüşüm (S-3):** evet, ama komisyonsuz (Pro / Business'a dahil) ve ödeme ev sahibinde. Komisyon alırsak ödemenin içine gireriz
   (aracılık, ödeme mevzuatı, fatura, iade); "komisyonsuz doğrudan rezervasyon" reklamda en güçlü cümle. İlanda izin numarası Bakanlık
   API'siyle doğrulanır, Bakanlık uyarısı otonom kaldırılır (kurucu S-7).

## 1. Araştırma özeti (11-06, Opus; ağ ayarı iki platform sayfasını doğrudan açtırmadı — resmî sayfa alıntıları + ikincil kaynak)

| Konu | Airbnb | Booking.com | Güven |
|---|---|---|---|
| Platform dışı ödeme | Yasak ("açıkça izin vermedikçe"); dar istisnalar (oteller, bazı vergiler / depozitolar) | Ön ödeme bazı ülkelerde yalnız kendi ödeme sistemiyle; ödemesiz politikada tesiste ödeme serbest | Yüksek / orta |
| Ücretli ekstra (transfer, erken giriş …) | İlanda önceden yazılır, Çözüm Merkezi'nden istenir; Çözüm Merkezi sayfası daireye ücretli ulaşımı izinli kalem sayıyor | Tesis olanağı olarak gösterilir, tesiste ödenir | Orta |
| Tur | Açık kural yok; platform içi yol Airbnb Deneyimleri (İstanbul'da TÜRSAB numaralı turlar yayında) | Mülkün tur satabileceği bir araç bulunamadı | Orta |
| Mesajda bağlantı / iletişim | Rezervasyondan önce bütün yazışma platformda; iletişim bilgisi ve dış atıf gizleniyor; rezervasyonu / ödemeyi dışarı taşıyan bağlantı yasak | Bütün iletişim platformda kalmalı; onaysız bağlantı süzülüyor, şüphede bağlantı yetkisi kapanıyor; PDF / QR eki gönderilemiyor | Yüksek / orta |
| Gelecek rezervasyonu dışarı çekme | **Açıkça yasak** (indirim, iptal ettirip dışarıda yeniden, rehberdeki "tekrar rezervasyon" bölümü dahil) | **Yasak** (sözleşme m.2.9 "misafire doğrudan pazarlama", çevrim dışı dahil; m.7.4 komisyondan kaçınma esaslı ihlal) | Yüksek |
| Yeni kural (Airbnb m.4169, 20 Kasım 2026) | Misafirden e-posta / telefon istemeyi, e-posta toplayan Wi-Fi portalını (oteller hariç), başka sitede yorum istemeyi sınırlıyor; ev kuralları politikası evdeki tabelaları da kapsıyor | — | Orta |
| Dairedeki QR / broşür | Açık kural yok; "tekrar rezervasyon" yasağı her kanalda geçerli; isteğe bağlı portal serbest ama girişi / temel olanağı kayda bağlamak yasak | Açık kural yok; "çevrim dışı pazarlama" ifadesi kapsayabilir ("özellikle hedefleme" — genel QR tartışmalı) | Düşük–orta |
| Konaklama sonrası iletişim | Misafir bilgisi pazarlamada kullanılamaz | Kullanılamaz; e-posta takma ad | Yüksek |
| Türk hukuku | 6563 m.6: ticari elektronik ileti önceden onay + İYS kaydı; yeni konaklama teklifi "hizmetin kullanımı" istisnasına girmez (değerlendirme) | Aynı | Yüksek (kanun) |

Yaptırım: mesaj silme → uyarı → ilan / hesap kısıtlama, askı, kapatma (Booking'de sözleşme bildirimsiz fesih). Tur / transfer sattığı için
ceza alan somut vaka bulunamadı; vakaların hepsi ödemeyi, iletişimi ya da bağlantıyı platform dışına taşımakla ilgili.

## 2. Önerilen akış — "Konaklamanız boyunca" (QR sohbet sayfası)

**Ne:** ev sahibinin tanımladığı hizmetler (ilk sürüm önerisi: transfer, tur, erken giriş / geç çıkış, kahvaltı) misafirin QR sayfasında
bir bölüm olarak görünür; misafir sormadan görür. Asistan (QR sohbeti) sorulunca aynı bilgiyi ev sahibinin ağzından verir.

**Kural seti (kodda, tek kaynak):**
- Hizmet görünür mü: ev sahibi açmış + (tur ise) belge kapısı geçiyor (A grubu; C grubu misafir vatandaşlığı bilinmediği için QR'da
  gösterilmez) + rezervasyon etkin.
- "Nasıl alınır" satırı rezervasyonun kanalına göre: Airbnb → "Airbnb mesajlarından bize yazın, rezervasyonunuza ekleyelim" · Booking →
  "Ödemesi varışta, dairede" · doğrudan → ev sahibinin kendi bağlantısı.
- Airbnb / Booking misafirine QR'da **dış ödeme bağlantısı YOK** (gri alan; avukat görüşüne kadar kapalı — Q1).
- Misafirden e-posta / telefon İSTENMEZ; hiçbir hizmet kayda bağlanmaz (Airbnb m.4169).
- "Tekrar rezervasyon / bir dahaki sefere doğrudan" bölümü YOK (Airbnb rehber taraması + iki platformun yasağı).
- Lixus misafire ayrıca pazarlama mesajı ATMAZ (6563).

**Örnek ekran (ev sahibinin ağzından; onaya tabi):**
- Airbnb misafiri: *"Havalimanı transferi — 1.200 TL. İsterseniz Airbnb mesajlarından bize yazın, rezervasyonunuza ekleyelim."*
- Booking misafiri: *"Havalimanı transferi — 1.200 TL. Ödemesi varışta, dairede."*
- QR sohbetinde soru: *"Havalimanından nasıl gelirim?"* → *"Havalimanından taksiyle yaklaşık 45 dakika sürüyor. İsterseniz transfer
  hizmetimiz de var: 1.200 TL. Airbnb mesajlarından bize yazmanız yeterli."*

**Ev sahibi tarafı (iş fırsatı kartı, belge tasarımı §16.1 ile):** "Son 90 günde misafirlerinizden 23'ü havalimanı transferi sordu" (anlama
katmanı sayar, metin taşınmaz) + "Transfer hizmeti ekleyin; Airbnb misafirleri için ilanınıza da yazmayı unutmayın" (Airbnb kuralı:
ekstra ilanda önceden yazılmalı).

## 3. Doğrudan rezervasyon (S-3) — en az uğraşla en çok iş
- **Kime:** yalnız platform dışından gelen misafir. Kaynak: reklam (Google / sosyal medya), ev sahibinin kendi çevresi, Google'da
  işletme adı arayan. Airbnb / Booking misafirine yönlendirme YOK.
- **Ne:** ev sahibinin kendi sayfası (önerim: ev sahibinin kendi alan adı; ilk sürümde Lixus alt adresi de olabilir — Q4) — fotoğraf,
  fiyat, takvim (Lixus'taki müsaitlik), "Rezervasyon talebi".
- **Ödeme:** ev sahibinde (S-2). İlk sürüm "talep → ev sahibi onaylar → ödeme ev sahibinin kendi yöntemiyle" (en az hukuk / uğraş);
  sonra ev sahibinin kendi ödeme sağlayıcısı bağlantısı.
- **Komisyon:** %0, Pro / Business'a dahil (önerim; kurucu "en minimum" dedi).
- **Zorunlular:** izin / belge numarası Bakanlık API'siyle doğrulanır ve sayfada görünür (belge tasarımı K-17); Bakanlık uyarısına otonom
  kaldırma (S-7); İYS onayı olmadan pazarlama iletisi yok.
- **Reklam:** Lixus'un genel reklamı ("komisyonsuz doğrudan rezervasyon") + ev sahibine hazır paylaşım bağlantısı.

## 4. Kırmızı çizgiler (kod kuralı olacak)
1. Airbnb / Booking mesajında ek hizmet teklifi, dış bağlantı, fiyat, doğrudan rezervasyon daveti YOK.
2. QR sayfasında Airbnb / Booking misafirine dış ödeme bağlantısı YOK (avukat görüşüne kadar).
3. Misafirden iletişim bilgisi istenmez; hiçbir şey kayda / e-postaya bağlanmaz.
4. "Tekrar rezervasyon" ya da indirim kodu yok.
5. Pazarlama iletisi yalnız 6563 onayı + İYS kaydıyla.
6. Misafire giden her metin ev sahibinin ağzından.

## 5. Aşamalar (öneri)
- **P0:** avukat — QR'daki genel bağlantı (gri alan), Booking sözleşmesi m.2.9 kapsamı, 6563 / İYS.
- **P1:** hizmet kaydı (ev sahibi) + QR'da "Konaklamanız boyunca" + kanala göre "nasıl alınır" + asistanın aynı bilgiyi vermesi.
- **P2:** iş fırsatı kartı (belge + talep sayıları).
- **P3:** doğrudan rezervasyon sayfası (Bakanlık API'si + otonom kaldırma şart).

## 6. Kurucuya sorular
- **Q1:** Airbnb / Booking misafirine QR'da yalnız "bilgi + platform içi yol" gösterelim, kendi ödeme bağlantınızı avukat görüşüne kadar
  hiç göstermeyelim mi? Önerim: evet.
- **Q2:** İlk sürümde hangi hizmetler: transfer, tur, erken giriş / geç çıkış, kahvaltı — başka?
- **Q3:** "Öneriler, plan" derken misafire gezi planı (ör. "3 günde Kapadokya") gibi bir şey mi kastediyorsunuz, yoksa ev sahibinin
  hizmetlerinin önerilmesi mi?
- **Q4:** Doğrudan rezervasyon sayfası ev sahibinin kendi alan adında mı (ör. laleapart.com), Lixus alt adresinde mi (lale.lixusai.com)?
