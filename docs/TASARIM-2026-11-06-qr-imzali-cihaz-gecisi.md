# QR sohbeti — imzalı cihaz geçişi (K-5, 2026-11-06)

> Kurucu 11-06 sabah (Codex metniyle): "Doğrulanmış cihaz ayrı kapasite + cihaz başı sınır. Çerez konaklama / erişim kontrolünün yerine
> geçmez. Süresi dolmuş / bağı kaldırılmış erişim reddedilir. Mevcut mekanizma yetiyorsa ikinci mekanizma kurulmaz." · "sen tamamını yap,
> acele etmeden, çok derin". Kod: `src/lib/guest-chat-pass.ts` + `src/app/api/chat/[token]/route.ts`. Migration YOK, misafire giden metin
> değişmedi.

## 1. Sorun (ölçülmüş, 11-05 gece)
- Bağlı cihazı tanımak bir veritabanı okumasıdır (`bindOrCheckStay`: `Reservation.chatBoundHash` = cihaz sırrının sha256'sı). Bu okuma
  ancak kaba IP tavanından (okuma 240/dk, gönderme 20/dk) SONRA yapılabiliyordu — tavansız okuma, okuma seli demektir.
- Sonuç: aynı IP'den (bina Wi-Fi'si, operatör NAT'ı) dakikada 240+ geçersiz istek kaba tavanı doldurunca o IP'deki BÜTÜN misafirlerin
  sohbeti donuyordu — sohbeti zaten açık, bağlı cihaz dahil. Gönderme tarafında 20 istek yetiyordu.

## 2. Karar: var olan cihaz çerezinin uzantısı (ikinci mekanizma YOK)
- `gcs_<daire>` çerezinin değeri `<cihaz sırrı>.<geçiş>.<imza>` olur. Sır ve veritabanı bağı AYNEN durur; `bindOrCheckStay` değişmedi.
- Geçiş = `{ konaklama, QR anahtarının özeti (16 hane), sırrın özeti (16 hane), son geçerlilik }`, `AUTH_SECRET` ile HMAC, ayrı imza alanı
  (`lixus/guest-chat-pass/v1` — uyarı adresi / ödeme dönüşü belirteçleri burada geçmez). Ömrü çerezle aynı (çıkış + 36 sa, en çok 60 gün).
- **Veritabanından önce:** geçerli geçiş (imza + süre + bu QR anahtarı) → istek kaba IP tavanına girmeden cihazın KENDİ kovasına gider
  (okuma 60/dk, gönderme 20/dk; anahtar = konaklama + sırrın özeti → cihaz başı sınır, çalınmış çerez çok IP'den çoğaltılamaz).
- **Veritabanından sonra (erişim kararı bugünkü gibi):** konaklama açık mı, bağ hâlâ bu sır mı. Geçiş ancak "aynı konaklama + aynı sır +
  bağ eşleşti" ise onaylanır. Onaylanmazsa (ev sahibi bağı sıfırladı, konaklama değişti, geçiş başka sırra taşınmış) geçiş bir şey
  kazandırmamış sayılır: istek kaba IP tavanından DA geçer, sonra doğrulanmamış istek gibi işlenir (başka cihaz / sohbet kodu sorusu).
- Süresi dolmuş, başka QR anahtarına ait, imzası tutmayan geçiş hiç yokmuş gibidir.
- Eski biçimli çerez (yalnız sır) aynen çalışır; bağ doğrulandığı ilk yanıtta geçişli biçime BİR KEZ yükseltilir (sır aynı).
- Cihaz kovası tek: geçişsiz ama veritabanında doğrulanmış istek de aynı kovayı kullanır (iki yoldan çift hak yok).
- Kova anahtarları yalnız İMZALI değerlerden kurulur → rastgele / uydurma çerezler sayaç satırı açmaz (F5 kuralı).
- `AUTH_SECRET` yoksa geçiş üretilmez ve kabul edilmez (çerez eski biçimde kalır, davranış bugünkü).

## 3. Reddedilen seçenekler
- **İkinci çerez (`gcp_…`):** ikinci mekanizma (Codex'in uyarısı); ayrıca iki çerezin ömrü / sıfırlanması ayrı ayrı yönetilirdi.
- **Bağ okumasını tavandan öne almak:** tavansız veritabanı okuması → sel doğrudan veritabanına biner.
- **IP izin listesi / doğrulama sorusu (captcha):** misafir için sürtünme; bina ağında herkes aynı IP.

## 4. Kalan riskler (bilerek)
- Sel SÜRERKEN ilk kez açan (henüz geçişi olmayan) cihaz bekler — ilk açılış kaba tavandan geçmek zorunda.
- Geçişi çalan, çerezi de çalmıştır (aynı değer): kazancı cihazın kendi kovası kadar (dakikada 60 okuma / 20 gönderme), erişimi bugünkü
  çerez hırsızlığıyla aynı. Çerez `httpOnly`.
- `AUTH_SECRET` değişirse bütün geçişler geçersiz olur → cihazlar eski yola düşer (kilitlenme yok), ilk doğrulanan yanıtta yenilenir.

## 5. Kanıt
- Birim: `tests/unit/guest-chat-pass.test.ts` (11) — imza / süre / anahtar / imza alanı / sır yokken / çerez tarama sınırı.
- Entegrasyon: `tests/integration/guest-chat-device-pass.test.ts` (9) — sel altında okuma ve gönderme, geçiş erişim vermez, sıfırlanmış
  bağ, süresi dolmuş geçiş, başka dairenin geçişi, tek cihaz kovası, eski biçimin yükseltilmesi, uydurma çerez sayaç açmaz.
- Kırmızı-önce: eski rotayla 5 kırmızı (olumlu davranışlar); 4 "gevşetme yok" kontrolü iki tarafta da yeşil.
- QR rotasına dokunan 59 test dosyası (649 test) yeşil.
- Mutasyon 17/17 öldürüldü (M0 yeşil; `c113a5d5`): okuma / gönderme geçiş yolu, bayat geçişin kaba tavana düşmesi (okuma, gönderme, kapanmış
  konaklama), bağ + sır onayı, süre, anahtar özeti, tarama sınırı, tek cihaz kovası, eski biçimin yükseltilmesi, geçişli çerezin yeniden
  yazılmaması, iki parçalı değerin sır sayılması, sır kısmının ayrılması, gönderme yolunun veritabanı onayı, sabit zamanlı imza karşılaştırması,
  çift kova düşümü. Mutasyon planı gönderme yolunda iki pinsiz dal gösterdi (sıfırlanmış bağ, biten konaklama) → testleri eklendi.
