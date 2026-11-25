# Codex raporu 11-25 — teyit ve uygulama kaydı

> Talimat (AYNEN): `docs/KURUCU-TALIMATI-2026-11-25-codex-raporu-ve-opus-dalgasi.md`. Kurucu: "kodları opus 5.5'e yazdırt zorluları sen yaz her
> kodlarını kontrol et didik didik … codex yazdı bunları sende teyit edebiliyorsan et".
> Düzen: ödeme akışı + satır içi son kontrol ana oturumda yazıldı; kanal doğrulama + kimlik akışları Opus ajanı (OA) yazdı, ana oturum satır
> satır okudu; üç yeni kapının envanteri + tasarımı Opus ajanı (OB), kod yok. Her iddia ÇALIŞTIRILARAK teyit edildi (kırmızı-önce test).

## 1. İddialar — teyit ve sonuç

| # | Codex iddiası | Teyit | Sonuç |
|---|---|---|---|
| 1 | Belirsiz gönderimde gönderim başlangıcından önce (2 dk'ya kadar) damgalı aynı metin yeni gönderimin kanıtı sayılıyor | DOĞRU (13:59 damgalı metin kuyruk satırını "sent" yaptı; doğrudan yolda 201) | Düzeltildi: geri pay kalktı. Sağlayıcı kimliği kesin kanıt; metin eşleşmesi yalnız başlangıçta / sonrasında damgalı mesajda. Sağlayıcı saati geri kalırsa sonuç "teyit edilemedi" (güvenli yön); yeniden gönderim yok |
| 2 | Abonelik yazımı ile bekleyen ödeme kaydının kapanışı iki ayrı yazım | DOĞRU (kapanışa hata verilince abonelik yazılmış, kayıt "bekliyor" kaldı; sonraki olay toparladı; ikinci tahsilat yok) | Düzeltildi: ikisi tek veritabanı işleminde |
| 3 | İptal sonrası okuma "ödendi" dese de bilgi kayboluyor; 24 saat dolmuşsa ikinci ödeme ekranı açılıyor | DOĞRU (iki sınır senaryosu + dört durum, 6 kırmızı test) | Düzeltildi: iptal sonucu üç değerli; yer yalnız kanıtla boşalır; 24 saat ödeme kanıtı değil |
| 4 | Operatörün hassas işlemlerinde taze 2FA yok; hatırlanan cihaz oturumu MFA'lı sayılıyor | DOĞRU (sonda: hatırlanan cihazla kodsuz giriş `mfa: true`; oturum her istekte 14 gün uzuyor) | YENİ SİSTEM → tasarım + kurucu soruları (`docs/TASARIM-2026-11-25-operator-taze-2fa.md`) |
| 5 | Şifre sıfırlamada kayıt + e-posta kuyruğu ayrı işlem; kuyruk arızasında hesap varlığı sızar | DOĞRU (kayıtlı adres 500, kayıtsız 200; e-postasız kayıt kaldı). Ters yön de bulundu: eşitleyici yazım düşerse yalnız kayıtsız adres 500 | Düzeltildi: tek işlem; arızada iki dal aynı 200; operatöre haber |
| 6 | "Kod iste" ile "kodu doğrula" aynı IP kovası | DOĞRU (biri dolunca öteki 429) | Düzeltildi: iki kova (istek 5 + doğrulama 7 = eski toplam 12) |
| 7 | Girişte günlük 2FA bütçesinde kontrol ve sayım ayrı | DOĞRU (sayaç 18'deyken eşzamanlı 5 yanlış kodun beşi de doğrulamaya girdi) | Düzeltildi: hak doğrulamadan önce atomik ayrılır; doğru kodda / rette / veritabanı hatasında iade |
| 8 | Gönderimden hemen önce ortak yetki kontrolü yok (model düşünürken değişen bilgi) | KISMEN DOĞRU (sonda: satır içi yolda 11 değişikliğin çoğunda eski cevap gitti) — iki bacak aynı gün kapandı, kalanı tasarım | Bkz. §2 |
| 9 | Denetim özeti 60 kaynağın 44'ünü saklıyor | DOĞRU (4.000 karakter tavanı; üretimde isteme en çok 30 kalem / 12 parça girer → kırpma nadir) | Tasarımda: gönderim kararı için ayrı, kırpmasız kaynak-sürüm kıyası |
| 10 | Kuyruk duraklatması doğrudan gönderimi durdurmuyor; QR ayrı anahtar | DOĞRU (sonda) | YENİ YÜZEY → tasarım + sorular (`docs/TASARIM-2026-11-25-acil-durdurma-kapsami.md`) |

## 2. Satır içi oto-yanıt yolunda son kontrol

OB sondası (model çağrısının içinde değişiklik): bilgi tabanı kalemi değişti / pasife alındı / silindi · rezervasyon ya da konuşma başka daireye
taşındı · çıkış düne çekildi · işletme otomatik cevabı kapattı · AI durduruldu · ev sahibi elle yazdı → eski cevap gitti.

Ana oturum doğrulaması (hata olmayanı hata gibi göstermemek için):
- "Ev sahibi elle yazdı → iki cevap": Lixus panelinden yazılan cevapta OLUŞMAZ (panel konuşmayı "Cevaplandı" yapar, talep durum şartından
  düşer). Açık yalnız kanalın kendi uygulamasından yazılıp eşzamanlı senkronla içeri alınan cevaptaydı → **kapatıldı** (talebin kendisinde).
- "AI durduruldu": satır içi kipte `autoReplyHoldUntil` alanını eşzamanlı yazan yol yok (ev sahibinin durdurması "Sorunlu"dur — yakalanıyor).
- "İşletme otomatik cevabı kapattı" → **kapatıldı** (talebin kendisinde; `ignoreToggle` bugünkü gibi).
- Bilgi tabanı sürümü, daire taşınması, konaklamanın model düşünürken bitmesi: saniyelik pencere; misafire gideni değiştiren yeni davranış
  (yeniden üretim) → tasarım + gölge ölçüm + kurucu soruları (`docs/TASARIM-2026-11-25-gonderim-oncesi-yetki-kontrolu.md`).

## 3. Ödeme — yeni sözleşme (Codex tablosu)

| Paddle'ın doğruladığı durum | Lixus |
|---|---|
| Ödeme yok, eski işlem kapalı (iptal / yok) | Hemen yeni ödeme ekranı. 24 saat bekletme yok |
| Ödeme yok, aynı paket, işlem hâlâ açık (süresi dolmuş + iptal edilemedi olsa da, 24 saatin içinde) | Aynı ödeme ekranına devam; ikinci işlem yok |
| Ödeme alınmış (iptal sırasında ödendiyse de) | Yeni ödeme YOK; kayıt "ödeme alındı" → abonelik bağlanınca kapanır |
| Sonuç doğrulanamıyor (iptal düştü, durum açık / okunamıyor) | Yeni işlem YOK; her deneme + saatlik süpürge yeniden doğrular; üst sınırı aşınca operatöre geçiş tabanlı alarm (niyet başına bir kez). Operatör işlemi Paddle'da iptal edince sonraki deneme hemen yenisini açar |

Değişen eski kural (Opus 10-21 B2): üst sınırda iptali doğrulanmadan kapanış kalktı (kural 11-18: süreyle düşen kilit kalıcı gerçeği taşıyamaz).
Anahtar `PADDLE_CHECKOUT_INTENT_ENABLED` hâlâ KAPALI; Paddle taklit — gerçek sandbox denemesi açılışta (ödeme pilotundan önce).
Bilinen sınır: anahtar sonradan KAPATILIRSA üst sınırı aşmış açık niyet eski istemci yolunu kilitlemez (bilinçli geri alma yolu, değişmedi).

## 4. Test altyapısı bulgusu

Abonelik yazımı etkileşimli işleme alınınca genel Prisma temsilcisine kurulan üç casus işlem istemcisini görmedi: iki test kırmızı, biri
(ve aynı dosyadaki iki kardeşi) kancası hiç çalışmadan SAHTE YEŞİL kaldı. `tests/helpers/tx-intercept.ts` işlem istemcisine araya girer; her
kanca çalıştığını ayrıca iddia eder (CLAUDE.md "Çalışma dersleri" 11-04 kuralının somut hâli).

## 5. Kanıt

- Kırmızı-önce: ödeme 6 + 2, satır içi son kontrol 2, kanal doğrulama 3 (+ birim), şifre sıfırlama 3, IP kovaları 2 yön, 2FA yarışı 1 + 3 iade.
- Mutasyon (`scripts/mutation-run.mjs`): sonuçlar §6'da.
- Tam kapı + CI: §6'da.

## 6. Yayın

(tam kapı ve mutasyon bitince doldurulur)

## 7. Kurucuya sorular (özet — örnekli hâlleri tasarım belgelerinde)

- **Operatör taze 2FA:** kapsam (2FA sıfırlama · hesaba giriş · tam dışa aktarma), izin süresi (5 dk), hatırlanan cihazın operatör hesabında
  kodu atlatması.
- **Gönderim öncesi kontrol:** gölge ölçüm açılışla başlasın mı (30 gün); model düşünürken kapı kodu değişirse cevap bir kez yeniden üretilsin
  mi; uzun vadede kapı kodu / Wi-Fi ayrı alanda durup cevaba sunucu mu yerleştirsin.
- **Acil durdurma:** salt okunur kapsam tablosu; genel otomatik mesaj anahtarı kapalıyken QR'daki yapay zekâ da sussun mu; "acil durdur"
  tek şalteri (env yönergesi mi, veritabanında tek satır mı).
- **IP kovası bölüşümü:** ortak ağda kod isteme tavanı 12 → 5 (doğrulamaya 7 ayrıldı). Örnek: aynı ofisten 15 dakikada altı kişi "şifremi
  unuttum" derse altıncısı 429 alır; buna karşılık geçerli kodu olan kişi başkalarının istekleri yüzünden artık engellenmez.
