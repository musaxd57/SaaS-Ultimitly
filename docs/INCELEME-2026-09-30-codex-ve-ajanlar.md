# Codex'in üç partisi + kurucu kararları + inceleme ajanları (b1–b6) — 2026-09-30

Kurucu (09-30): "Codex'in üç partisini bağımsız doğrula, doğrulananlar için dar düzeltme + regresyon testi; müşteriye giden cevabı,
erişim politikasını ya da mali kayıt anlamını değiştirecek olanları önce sor" + sekiz karar (acil ağı, ad, `{daire}`, Sayın / Dear,
operatör dışa aktarımı + QR, kısa ad saklama, Ayarlar önizlemesi, Nodemailer). Aynı gün zamanlanmış tetik: 09-25 / 09-26 turlarının
inceleme ajanları (b1–b6) + kör Konuşma Anlama Durumu seti. Ajanlar yalnız okudu; her bulgu kodda ÇALIŞTIRILARAK doğrulandı, kodu
Claude yazdı. Düzeltmeler kırmızı-önce + mutasyon + tam kapılar. Ücretli çağrı YOK (kurucu: "fazla kredi tüketme").

Durum: **F** = düzeldi · **K** = kurucu kararı (↓ örnekli) · **N** = bilinen sınır / not · **X** = doğrulanmadı / yanlış.

## Codex — 1. parti (7 bulgu)

| # | Bulgu | Durum |
|---|---|---|
| 1 | Mükerrer sohbet temizliği yalnız METNE bakıp başka yönde / zamanda yazılmış "Merhaba"yı karşılanmış sayıyordu | F — kimlik / yön / zaman çokluğu (`conversations-cleanup.ts`) |
| 2 | iCal dışa aktarma günü UTC'den yazılıyordu (İstanbul 3–5 → 2–4, New York 4–6) | F — `calendarDateOf` + org dilimi |
| 3 | Parola değişince bekleyen sıfırlama isteği iptal olmuyordu | F — aynı işlemde iptal |
| 4 | Yeniden atanan görevi eski personel tamamlayabiliyordu (okuma ↔ yazma yarışı) | F — yazma anında koşullu (403) |
| 5 | Eski anahtarın geç gelen 401'i yeni bağlantıyı iptal edebiliyordu | F — başarısız anahtar karşılaştırılır |
| 6 | Gönderilemeyen (kuyrukta / başarısız / iptal) cevap raporda "yanıtlandı" sayılıyordu | F — yalnız teslim edilmiş giden mesaj |
| 7 | Metinden bilgi çıkarma ilk saati yanlış alana atıyordu ("Giriş 15:00, çıkış 11:00" → çıkış 15:00) | F — saat kendi cümleciğine bağlı |

## Codex — 2. parti (5 bulgu)

| # | Bulgu | Durum |
|---|---|---|
| 1 | Bozuk JSON sayfası "başka mesaj yok" sayılıp senkron imleci ilerliyordu (mesaj kaçırılıyordu) | F — tam / eksik ayrımı; eksikte imleç ilerlemez. **Ek bulgu:** aynı hata rezervasyon temizliğinde canlı rezervasyonu siliyordu → düzeldi |
| 2 | Rolü düşürülen yönetici sayfaları okumaya devam edebiliyordu | F — `requireAuth` rol uyuşmazlığında oturumu geçersiz sayar |
| 3 | Geçersiz saatli iCal tarihi (30 Şubat) başka güne dönüşüyordu | F — tüm biçimlerde gün / ay doğrulaması |
| 4 | Aynı CSV içindeki tekrar satırlar çift rezervasyon oluşturuyordu | F — dosya içi tekrar da izlenir |
| 5 | Negatif tutar sessizce pozitife çevriliyor (-100 → 100) | **K1** |

## Codex — 3. parti (7 bulgu + RAG sınırı)

| # | Bulgu | Durum |
|---|---|---|
| 1 | Yeni açılan 2FA eşzamanlı kapatma isteğiyle silinebiliyordu | F — koşullu kapatma + kurtarma kodu yenileme |
| 2 | AI düşünürken gelen mesaj / ev sahibi düzeltmesi atlanabiliyordu | F — cevap, okuduğu son mesaja bağlı; sonrasında gelen varsa gitmez |
| 3 | Selam temizleyici cevaptaki bilgiyi siliyordu ("Merhaba otopark ücretsiz.") | F (09-28'de kapanmıştı; Codex'in iki örneği pinlendi) |
| 4 | Görevden alınan personel fotoğrafa kayıtlı bağlantıyla erişebiliyor | **K2** |
| 5 | "Check-out is not at 11:00; it is at 12:00." → okuyucu 11:00 alıyor | **K3** |
| 6 | Cevap ölçeri modelin İŞLENMİŞ çıktısını saklıyordu | F — ham yanıt saklanır, işleme her koşuda bugünkü kodla |
| 7 | Farklı aboneliğin olayı mevcut aboneliği iptal edilmiş yazabiliyor | **K4** |
| RAG | Aday havuzu en yeni 400 kalem (1.000 kalemin en eskisindeki tek bilgi bulunmayabilir) | N — mimari sınır, regresyon değil |

## Kurucu kararları 1–8 (09-30) — uygulandı

| # | Karar | Uygulama |
|---|---|---|
| 1 | Acil ağı: kaza / polis / hurt daralsın (gerçek çekimler kalsın), yangın ifadeleri eklensin | F — "Kazağımı unuttum" acil değil, "Kaza yaptık, yardım gerekiyor" acil; "Emergency exit nerede?" yer sorusu; "Acil çıkış kilitli, içeride duman var" acil. **İnceleme bulgusu (aynı tur):** ilk sürüm "Acil çıkış kapısı kilitli" / "Fire exit is blocked" / "Yangın merdiveninin kapısı açılmıyor"u da acilden çıkarıyordu (canlıda acil) → kilit / engel sözcüğü varsa acil kalır. Yangın: alev aldı, alevler, ateş aldı / çıktı, tutuştu, caught fire, flames (çıplak "ateş" / "alev" YOK) |
| 2 | Ad: model rezervasyon adını görmez, kod selamı ekler, anlamlı sözcük silinmez | F — ad YALNIZ kimlik konumunda maskelenir ("adım / ben / I'm / my name is / Alex here / Name: / imza"; bizim metnimizde hitap). "Deniz manzarası", "15 Nisan" korunur. Tam gizlilik iddiası YOK. Tam ad iki doğal sırada da tam addır (ad önde saklanan "Mehmet Ali Kaya" → "Kaya Mehmet Ali"; soyad önde saklanan "Kaya Mehmet Ali" → "Mehmet Ali Kaya"; mutasyon turu buldu). İkinci tur (kendi selamımız) testli |
| 3 | `{daire}` çözülemezse yalnız o mesaj gitmez, ev sahibi görür | F — karşılama / giriş / çıkış GİTMEZ; yapay zekâ bağlamında "[DAİRE NO]" (uydurma yok), cevapta kalırsa veto; mülk sayfasında uyarı + düzeltme yolu |
| 4 | "Sayın {isim}," → "Sayın misafirimiz,"; "Dear {name}," → "Dear guest," | F — "Sevgili / Değerli" aynı sınıf; "Sayın {isim} Bey," eski kural ("Sayın Bey,") |
| 5 | Operatör dışa aktarımı + QR | F — yalnız kendi hesabından (bürünmede 403), 2FA, AMAÇ zorunlu (kapalı küme) + isteğe bağlı talep no, zorunlu kayıt (yazılamazsa 503, veri çıkmaz). bürünmüş operatör QR sohbetini açamaz / bağlayamaz (uçlar + sayfa), mülk sayfası destek görünümünde bağlantıyı / karekodu göstermez |
| 6 | Kısa ad saklama temizliği | F — yalnız kodun selam satırında ("Merhaba Su," temizlenir, "Su gelmiyor" kalır) |
| 7 | Ayarlar önizlemesi gerçek selam kurucusu | F — örnek rezervasyon güvenilir hitap adı taşır ("Merhaba Ada,") |
| 8 | Nodemailer 10.x | F — 10.0.13, dört danışma kapandı, triyaj kayıtları silindi, gerçek soketli SMTP testi yeşil. İlk gerçek deneme e-postası kurucuyla (**K15**) |

## İnceleme ajanları b1–b6 (09-25 / 09-26 turları)

| # | Bulgu (doğrulandı) | Durum |
|---|---|---|
| b1-1 | Aynı UID'nin iptal edilmiş örneği rezervasyonu her geçişte iptal ↔ onay arasında çalkalıyordu (dışa aktarılan takvim o geceleri kapatmıyordu) | F — geçişte kayıt başına İLK satır (dosyadan içe aktarmayla aynı kural) |
| b1-2 | UID'siz etkinlik her geçişte yeni rezervasyon açıyordu (günde ~96) | F — aynı kaynak + aynı tarih = aynı kayıt |
| b1-3 | İptalde silinen görevlerin fotoğrafları kovada sahipsiz kalıyordu | F — silme niyeti aynı işlemde |
| b1-4 | Birden çok kopya (replica) varken yavaş bir org imleci kilitleyip diğerlerini aç bırakabilir | N — bugün tek kopya |
| b1-5 | Silme kuyruğu vadesi veritabanı saatiyle yazılıyor, uygulama saatiyle okunuyordu (+ rastgele kırmızı test fikstürleri) | F |
| b1-6 | Küçük harfli "begin:vevent" ve yalnız CR satır sonu sessizce boş okunuyordu | F |
| b1-7 | Mülk silme, başka görevin de gösterdiği (eski satır) fotoğrafı siliyordu | F — yalnız artık hiçbir satırın göstermediği nesne |
| b2-1 | Gece yarısı: saat satırı "yarın = bugün", yazıldığı gün kuralı "yarın = ertesi gün" (bayrak kapalı) | F — yazıldığı gün kuralı gece yarısı istisnasını taşır |
| b2-2 | Senkronla gelen, bizim yazmadığımız giden mesaj "ev sahibi" sayılıyor | **K7** (b6-1 ile aynı) |
| b2-3 | Eylem beyanı örneğinde sahte Wi-Fi şifresi (bayrak kapalı) | F |
| b2-4 | Sahte yetki etiketi: 40 karakteri aşan damga ve 〔〕【】 ayraçlar geçiyordu | F — yalnız yetki adları (normal parantez "(ev sahibi için):" doğal not → dokunulmadı). Kalan yanlış pozitifler **K12** |
| b3-1 | Çıktı vetosu: 75 yeni söz / iddia cümlesinin 61'i geçiyor; 69 masum cümlenin 16'sı tutuluyor | **K10** |
| b3-2 | Yazılan çıkış saati: 68 "reddedilmeli" cümlenin 39'u kabul ediliyor ("Hi can we check out at 1pm") | **K11** |
| b3-4 | İddia desteği (gölge ölçüm) takvim tarihine göre değişiyor | N — karar değil, yalnız ölçüm |
| b4-1 | Tamamen küçük-kapital yazılmış metin ("ᴅᴀɪʀᴇᴅᴇ ʏᴀɴɢɪɴ ᴠᴀʀ") acil ve enjeksiyon ağlarını kör ediyordu | F |
| b4-2 | "history" kaynak beyanı ana yüzeylerde her zaman doğrulanıyordu (geçmiş güncel mesajı da içerir) | F — yalnız giden (ev sahibi / bizim) satır varken |
| b4-3 | Üslup profilinde talimat satırları süzülmüyordu | F — talimat / sahte etiket satırı düşer, üslup kalır |
| b4-4 | Kalite denetimi: 201 bulgu "Bulgu yok", 3.000+ karakter özet "verilmedi", 60 üstü sessiz kesim, "critical" düşük | F — tavan aşımı eksik rapor, özet kırpılır, gizlenen sayılır, bilinmeyen önem YÜKSEK |
| b5-1 | Prisma'nın kendi hata kaydedicisi başarısız sorgunun verisini (e-posta, telefon) log'a açık basıyordu | F — hata OLAY olarak alınır, yalnız yapısal özet |
| b5-2 | Prisma doğrulama / ham sorgu hatası metni log'a, Sentry'ye, alarm e-postasına veriyle gidiyordu | F — Prisma hatası yalnız yapısal özet (ad · kod · model.işlem · kısıt alanı) |
| b5-3 | Log pini bazı biçimleri görmüyor | N |
| b5-4 | Zafiyet kapısı danışmayı yalnız kimliğiyle eşliyor | N (öneri: paket + önem + 18 ay tavanı betikte) |
| b5-5 | Giriş belgeleri / yorumları eski | F |
| b6-1 | Otomatik karşılama / giriş / çıkış mesajlarımız senkronla "ev sahibi yazdı" olarak geri geliyor | **K7** (CANLI) |
| b6-2 | Öğeye bölünemeyen tur eski kapıya düşüyor (bekleyen IBAN'ı göremez) | N — bilinen sınır (D1–D6) |
| b6-3 | Modelin yeni turdaki risk etiketi ESKİ turun tutulan öğesine atfediliyor | **K8** |
| b6-4 | Öğe TÜRÜ istek kimliği gibi kullanılıyor (iki farklı şikâyet birleşiyor, yenisi e-posta almıyor) | **K9** |
| b6-5..7 | BEKLEYEN-RISK belgesi ve Host Copilot Faz 0 onay paketi güncel değil | **K18** |

**Mutasyon (bu turun düzeltmeleri, 28 + 5 mutant):** ilk koşuda 24/28 öldü; yaşayan dördü kapandı — Prisma kaydı testi sızdırmayan hata
türünü deniyordu (artık doğrulama hatası + ham sorgu "Failing row contains" / "Key (…)=(…)", ölçülerek seçildi), iCal CR katlama testi
değeri okunmayan alanı katlıyordu (artık kimliğin kendisi), üslup profili testi yalnız iki süzgecin ortak yakaladığı satırları taşıyordu,
ad maskesinin tam ters sıra satırı iki sözcükte eşdeğer / üç sözcükte yanlış sıraydı (ikinci doğal sırayla değişti, kırmızı-önce).

## Karar bekleyenler — önce / sonra örnekleriyle

**K1 — CSV'de negatif tutar (Codex 2-5).** Bugün: "-100" → 100, "(100)" → 100 (kayıtlı tutar yanlış). Öneri: satır açık hatayla
reddedilsin ("Satır 5: tutar negatif olamaz") — iade / düzeltme anlamı ayrıca kararlaştırılana kadar. Para anlamı olduğu için soruyorum.

**K2 — Görevden alınan personelin fotoğraf erişimi (Codex 3-4).** Bugün: personel kaydettiği fotoğraf bağlantısıyla, görev başkasına
geçtikten sonra da fotoğrafı açabiliyor (aynı işletme içinde; başka işletmeye sızma yok). Öneri: fotoğraf erişimi görev erişimiyle aynı
kural — personel yalnız kendisine atanmış görevin fotoğrafını açar, yönetici hepsini.

**K3 — Olumsuzlanan saat (Codex 3-5).** Bilgi tabanında "Check-out is not at 11:00; it is at 12:00." ve mülk ayarı 11:00. Bugün: okuyucu
11:00 alıyor → çelişki yok → yapay zekâ "çıkış 11:00" diyebilir. Öneri: olumsuzlanan saat okunmaz, düzeltme saati okunur → çelişki
görünür ("Uyuşmayan saatler") ve yapay zekâ çıkış saatini kesin söylemez (ev sahibine bırakır). Etki: böyle kalemlerde daha çok devir.

**K4 — Ödeme olayında abonelik kimliği (Codex 3-7).** Bugün: iki ödeme akışı açılıp webhook'lar ters sırada gelirse ESKİ aboneliğin iptal
olayı yeni aktif aboneliği iptal edilmiş yazabiliyor. Öneri: kayıtlı abonelikten farklı bir aboneliğin olayı planı değiştirmez; abonelik
değişimi yalnız yeni aboneliğin aktifleşmesiyle olur. Mali kayıt anlamı → soruyorum.

**K5 — Sağlık ("Çocuğun ateşi var").** Bugün: yangın değil (doğru), deterministik risk etiketi de yok → karar modelde. Seçenek: (a) böyle
kalsın; (b) "sağlık" sınıfı: otomatik gönderim yok, ev sahibine bildirim (acil e-posta değil). Öneri: (b).

**K6 — Acil ağının kalan yanlış alarmları.** "Polis merkezi nerede?", "Yangın söndürücü nerede?", "Acil değil ama havlu lazım" → bugün
acil (otomatik cevap yok + acil e-posta). Öneri: yer sorusu (merkez / söndürücü / ilk yardım dolabı nerede) ve "acil değil" olumsuzlaması
acil sayılmasın; yanlarında gerçek acil sözcük varsa ("Yangın söndürücü nerede, mutfak yanıyor!") acil kalsın.

**K7 — Otomatik mesajlarımız "ev sahibi yazdı" sayılıyor (b6-1 / b2-2, CANLI).** Senaryo: misafir IBAN ister → öğe sessizce ev sahibinde
tutulur → aynı gün bizim otomatik giriş mesajımız gider → senkron onu "ev sahibi" mesajı olarak alır → IBAN öğesi "Yanıtladınız" olur,
konuşma "cevaplandı" görünür, rozet düşer; ardından gelen "Teşekkürler" konuşmayı gizleyebilir. Öneri: gönderdiğimiz otomatik mesajın
sağlayıcı kimliğini (ve metin özetini) kaydedelim; senkron o mesajı "otomatik mesaj" olarak tanısın. Otomatik mesaj ev sahibi cevabı
SAYILMAZ (öğe açık kalır, konuşma durumu ve cevapsız pencere değişmez, "Teşekkürler" gizlemez), yapay zekâ geçmişinde "otomatik mesaj"
diye görünür. İki uygulama yolu: (a) migration'sız — konuşma varsa gönderimde yerel mesaj satırı (yazar "otomatik"); konuşma henüz
yoksa (karşılama genelde ilk mesajdan önce gider) eşleşme metin özetine kalır; (b) küçük yeni tablo (gönderilen otomatik mesaj: rezervasyon,
tür, sağlayıcı kimliği, metin özeti) — her durumu kapsar; migration = taze yedek + onayınız. Öneri: (b). Birden çok modüle dokunduğu ve
canlı davranışı değiştirdiği için onayınızı istiyorum.

**K8 — Öğe kapsamında risk atfı (b6-3).** Bugün: dünden tutulan bir ödeme öğesi varken, bugünkü mesajı model "platform dışı ödeme" diye
işaretlerse etiket eski öğeye atfediliyor; güvenli kısım cevaplanıyor, yeni mesaj için öğe açılmıyor. Seçenekler: (a) böyle kalsın;
(b) yeni mesaja da "olası tekrar" öğesi açılsın, cevap yine gitsin (sinyal kaybolmaz, konuşma kilitlenmez); (c) turun tamamı tutulsun
(daha önce reddettiğiniz konuşma düzeyi kapı). Öneri: (b).

**K9 — Öğe türü = istek kimliği (b6-4).** Bugün: "Klima çalışmıyor" (dün) ve "Komşular çok gürültülü" (bugün) ikisi de "şikâyet" → yenisi
eskisinin yerini alır ("Yeni mesajla birleşti"), klima şikâyeti açık listeden düşer, yeni şikâyet e-postası da gitmez (eskisinin bildirimini
devralır). Seçenekler: (a) böyle kalsın; (b) hassas öğeler otomatik birleşmesin, her yeni mesaj kendi e-postasını alsın ("mesaj başına acil
e-posta" kuralınızla aynı); (c) birleşsin ama yeni mesaj e-posta alsın. Öneri: (b).

**K10 — Çıktı vetosu boşlukları (b3-1; "misafir hiçbir 'soruyorum / döneceğim' mesajı almayacak" kuralınız).** Geçenler: "İsterseniz ev
sahibinize sorayım mı?", "Shall I ask the host for you?", "Mesajınızı şimdi ev sahibine gönderiyorum.", "I have sent your request to the
host." Masum ama tutulanlar: "Dün size haber verdim: havuz pazartesi kapalı." Öneri: #162 gibi yeni bir kör batarya turu (sıkılaştırma +
yanlış tutmaları gevşetme, her ikisi önce / sonra tablosuyla). Onay?

**K11 — Yazılan çıkış saati (b3-2).** "Hi can we check out at 1pm" bugün "misafirin yazdığı çıkış saati: 13:00" diye kaydediliyor (istem
"geç çıkış ONAYLANMADI" der ama saat yine misafirin beyanı sayılır). Öneri: soru işaretsiz istek / rica, başka aracın kalkışı, "yerine"
kalıpları (DE / ES) beyan sayılmasın. Onay?

**K12 — Sahte etiket yanlış pozitifleri (b2-4 / b4).** "[Misafir sayısı]: 3", "[Ev sahibi • Lale Hanım]" bugün enjeksiyon sayılıyor (cevap
taslakta kalır). Öneri: iki noktalı "[Misafir …]" biçiminde damga yalnız saat / tarih ise etiket sayılsın. Onay?

**K13 — Destek erişimi bilgilendirme metni (karar 5).** Taslak (avukat onayı gerekir): "Lixus destek ekibi hesabınızı yalnızca destek
talebiniz, hukuki yükümlülük ya da güvenlik incelemesi için, iki aşamalı doğrulamayla ve salt okunur olarak görüntüleyebilir. Her erişim
iç denetim kaydına yazılır. Veri dışa aktarımı yalnızca yazılı talep üzerine yapılır."

**K14 — QR incelemesi.** Bugün destek görünümünde QR konuşmaları "QR Misafir Sohbetleri" sayfasından okunuyor (cihaz bağlamaz). Misafirin
gördüğü ekranın ayrı bir önizlemesini ister misiniz?

**K15 — Nodemailer gerçek deneme e-postası.** Canlıda e-posta Resend'den gidiyor; Nodemailer yalnız SMTP yedeğinde yüklenir (Resend yolunda
modül hiç açılmaz), yani yükseltme canlı e-postayı etkilemez. Gerçek deneme için öneri: yerel ortamda (`scripts/ops-local-dev-setup.ps1`)
kendi SMTP hesabınızla (`EMAIL_HOST` / `EMAIL_USER` / `EMAIL_PASS`, `RESEND_API_KEY` boş) şifre sıfırlama e-postası isteyelim ve gelen
kutunuzda birlikte kontrol edelim. Canlı ayarlara dokunulmadı.

**K16 — Veriyi doğrudan veritabanından almak mı, kontrollü dışa aktarım mı?** Öneri: kontrollü dışa aktarım (yeni kurallarla). Doğrudan
veritabanı / Railway erişimi uygulamanın kayıt ve sır ayıklama katmanını atlar; Airbnb güvenlik incelemesinde "en az yetki" ve iz sürme
açısından savunulamaz.

**K17 — Adsız yapay zekâ anahtarı (`AI_CODE_GREETING_ENABLED`) hâlâ KAPALI.** Açma = önce 20 satırlık ücretli cevap kıyası + onayınız.

**K18 — Belgeler.** BEKLEYEN-RISK belgesi ve Host Copilot Faz 0 paketi ConversationItem (migration 56) ve K8 (salt okunur destek) öncesi
yazılmış; b6'nın bulgularıyla yeniden düzenlenmeli (gönderim / kayıt sırası, yarışlar, KVKK saklama). Onaydan önce güncellenecek.

## Kurucu kararları K1–K18 — sonuç (09-30 akşamı)

Durum sözcükleri: **F** = kodda, testli (kırmızı-önce + mutasyon) · **Y** = kodda ama YAYINLANMADI · **B** = karar / onay bekliyor.
Bir belgenin güncellenmesi kod ya da canlı izni DEĞİLDİR (K18); bekleyen hiçbir karar "onaylandı" diye yazılmaz.

| # | Karar | Durum |
|---|---|---|
| K1 | CSV negatif tutar | F — "-100" / "(100)" satırı açık hatayla reddedilir, başka satırlar etkilenmez |
| K2 | Fotoğraf erişimi = görev erişimi | F — personel yalnız ŞU AN kendisine atanmış görevin fotoğrafını açar |
| K3 | Olumsuzlanan saat | F — "not at 11:00; it is at 12:00" → 12:00 okunur, çelişki görünür; sınır anlatımı ("not before 15:00") etkilenmez |
| K4 | Başka aboneliğin ödeme olayı | F — kayıtlı abonelikten farklı aboneliğin olayı planı değiştirmez |
| K5 | Sağlık ("Çocuğun ateşi var") | B |
| K6 | Acil ağı bağlamla | F — yer / eşya sorusu ve "acil değil" tek başına acil değil; olay varsa acil kalır ("Yangın söndürücü nerede, mutfak yanıyor!", "hırsızlık olmuş, polis merkezi nerede"). Bilinen sınır: "Mutfak yanıyor!" tek başına ve yalnız hırsızlık bildirimi acil sayılmıyor (öneri ayrı tur) |
| K7 | Otomatik mesajlarımız "ev sahibi" sayılmasın | Y — kodda (migration 58), **yedek onayı bekliyor** (SHA256 + "YEDEK TAMAM" + prova ASSERT satırları) |
| K8 | Yeni risk ayrı öğe | F — cevap modelinin bu turla açıklanamayan risk sinyali son mesajda ayrı öğe olur, güvenli kısım yine gider |
| K9 | Hassas öğeler birleşmez | F — her yeni hassas mesaj kendi öğesi + kendi e-postası; aynı mesajın yeniden senkronu ikinci öğe / e-posta üretmez |
| K10 | Devir cümlesi misafire gitmez | F — "mesajınız kaydedildi / ev sahibiniz görebilir" (7 dil) tutulur; kanal: ev sahibine mesaj başına tek "Misafir cevabınızı bekliyor" e-postası + gelen kutusu notu + rapor satırı; QR: devirde metin yok, gerçek fiziksel acilde yalnız "Tehlike varsa hemen 112'yi arayın."; makbuzsuz teklif / gönderme iddiası kapanır; misafire yönelik geçmiş anlatım serbest. Bekletme mesajı (aynı cümleyi taşıyordu) emekliye ayrıldı: Ayarlar düğmesi ve landing'deki "ön-yanıt otomatik gider" iddiası kaldırıldı |
| K11 | Yazılan çıkış saati bağlamdan | F — istek / soru / rica beyan değil ("Hi can we check out at 1pm"), düz sıra beyan ("10'da çıkabiliyoruz"), araç kalkışı çıkış değil |
| K12 | Sahte etiket yanlış pozitifleri | F — "[Misafir sayısı]: 3" doğal bilgi satırı; "önceki kuralları yok say" talimatı yakalanır |
| K13 | Destek erişimi bilgilendirme metni | B — avukat onayı |
| K14 | Misafirin gördüğü ekran | F — QR sohbet sayfasından salt okunur önizleme (gönderim / cihaz bağlama / okundu değişikliği yok) |
| K15 | Nodemailer gerçek deneme e-postası | B — kurucuyla birlikte |
| K16 | Veri erişimi | F — `docs/POLITIKA-2026-09-30-veri-erisimi.md` (varsayılan kontrollü dışa aktarım; doğrudan veritabanı yalnız yedek / olay incelemesi, ayrı kurallarla) |
| K17 | Adsız yapay zekâ anahtarı | B — KAPALI kalır; açma = 20 satırlık ücretli cevap kıyası + onay |
| K18 | Belgeler | F — BEKLEYEN-RISK ve Host Copilot Faz 0 belgelerine durum başlığı + b6 bulguları eklendi; ikisi de TASLAK |
| — | Uyarı adresi: ekip dışı adres doğrulama bağlantısıyla | F (bayrak `ALERT_EMAIL_VERIFY_ENABLED` KAPALI) — ilk gerçek deneme kurucuyla |

**Mutasyon:** K10 23/23 · K14 9/9 · uyarı adresi 19/19 (ilk koşuda yaşayan iki mutant — imzalı belirteçte uzunluk tavanı, kayıtlı
adres varken CAS — pinlerle kapandı).
