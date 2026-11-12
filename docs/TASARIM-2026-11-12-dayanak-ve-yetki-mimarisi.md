# Tasarım — dayanaklı cevap hattı: "yazmıyorsa yok değildir" (2026-11-12)

Durum: TASARIM + ölçüm. Bu belgeyle birlikte yazılan kod yalnız ölçer ve anahtarı KAPALI bir istem katmanıdır; misafire gideni değiştiren
her adım aşağıda örnekli soru olarak duruyor (§9).

Kaynaklar: kurucu 11-12 sabah ("ona itaat etmek zorunda değilsin … en uzun vadeli sürdürülebilir yöntem") · Codex 11-12 raporu (üç kritik
nokta + altı maddelik mimari + ölçüm önerisi) · istem denetimi `docs/INCELEME-2026-11-12-istem-denetimi.md` · kurucunun 10-23 A akışı
("mesajı anlamlandır → gerçek ihtiyaçları ayır → her ihtiyaca kaynak bul → cevapları ayrı üret → uygun parçaları birleştir → yalnız gerçekten
cevaplanan işleri kapat").

## 1. Sorun (ölçülmüş)

Bilgi tabanında karşılığı olmayan soruda cevap modeli kesin bir cümle kuruyor ve cevap gidiyor:

| Misafir | Bilgi tabanı | Giden cevap |
|---|---|---|
| "Kahvaltı veriyor musunuz?" | kahvaltı kaydı yok | "Konaklamaya dahil kahvaltı servisi bulunmuyor." |
| "Dairede ütü var mı?" | ütü kaydı yok | "Dairede ütü bulunmaktadır." |
| "Yakında eczane var mı?" | "En yakın market 150 metre ileride." | "En yakın eczane yaklaşık 150 metre ileride." |

Geliştirme raporlarında (gpt-5.1) dürüst "bilgim yok" taslaklarının 22'sinden 0'ı, uydurma cümlelerin 17'sinden 10'u misafire gitti.
Sebebin yarısı istemin kendisi (denetim belgesi), yarısı yapı: bugünkü varsayılan hatta **hiçbir denetim cümleyi bilgi tabanıyla kıyaslamıyor.**

## 2. İlkeler

1. **Her ihtiyaç ayrı.** Misafirin her sorusu, kendi sözlerine bağlı ayrı bir kayıttır; birinin durumu ötekini değiştirmez.
2. **Cevap = kayıt + sürüm + destekleyen bölüm.** Giden her cümle, o dairenin onaylı bir kaydından birebir alınmış bir bölüme dayanır.
   Başlık ya da konu benzerliği dayanak değildir.
3. **Yazmıyorsa "yok" değildir.** "Bulunmuyor / sunmuyoruz / dahil değil" de bir iddiadır; ancak kayıtta açıkça yazıyorsa söylenir.
   Aynı kural ücret, mesafe, saat, koşul ve istisna için: bir şeyin kaydındaki değer başka bir şeye taşınmaz.
4. **Bilgi yetki değildir.** Kaynakta bilgi bulunması, o konuda otomatik karar verilebileceği anlamına gelmez (evcil hayvan, iade, erken
   giriş, uzatma, ödeme kendi onaylı politikalarından geçer).
5. **Yalnız izinli ihtiyaç için üretim.** Model önce bütün cevabı yazıp sonra ayıklanmaz; yalnız gönderilebilecek ihtiyaçların cevabını,
   ihtiyaç başına yazar.
6. **Yapıyı kod, anlamı okuyucu denetler.** Kod: kayıt kimliği, alıntının kayıtta geçmesi, rakam / saat / tutar, yetki, bilinen engeller.
   Okuyucu: "bu bölüm bu cümleyi destekliyor mu · sorulanı cevaplıyor mu · bekleyen başka bir konuya izin ima ediyor mu". Okuyucu "emin
   değilim" diyebilir; belirsizlikte parça tutulur. Okuyucu kesin bir engeli (yetki, güvenlik, sır) KALDIRAMAZ. Anlam denetimi büyüyen
   sözcük listelerine sıkıştırılmaz; sözcük listesi yalnız kesin engellerin yedeğidir. Bugünkü kodda BİLİNEN İSTİSNA: ödeme hükmünde okuyucu
   taslağı okuduysa ödeme sözcük kuralı ayrıca koşmaz (10-28 kararı — okuyucunun "hayır"ı tek başına geçirir); bu ilkeyle uyumlu hâle
   getirmek D3'ün (yetki tablosu) işidir. İkinci ders (11-12 ölçümü): kapalı bir listeyle YAPISAL olarak karar verilebilen şey okuyucuya
   bırakılmaz — "istek iki tesis adlandırıyor, parça birini hiç anmıyor" kodda tutulur.
7. **Denetlenen metin = gönderilen metin.** Denetimden sonra konuşma, kaynak ya da ev sahibinin durumu değiştiyse yeniden değerlendirilir.
8. **Ölçülmeden açılmaz; ölçümün kaydı saklanır.** Toplam sayı yetmez — başarısız koşunun çıktısı ve getirilen kaynaklar da saklanır.

## 3. Envanter — ne var, ne eksik (kodda doğrulandı)

Önemli tespit: bu mimarinin iskeleti **zaten yazılı** (cevap parçaları kipi, 10-23). Kapalı, çünkü kabul ölçümü yapılmadı. İkinci bir
sistem kurulmayacak; var olan tamamlanıp ölçülecek.

| İlke | Bugün var olan | Durum | Eksik |
|---|---|---|---|
| 1 İhtiyaç kimliği | Konuşma öğeleri: her istek ayrı satır, mesaja bağlı; hassas türler ev sahibinde tutulur | CANLI anahtar | — |
| 2 Açık dayanak | Parça kipi: istek başına `{durum, metin, alıntı}`; kod alıntıyı gösterilen kaynakta arar (`quoteGroundedIn`), sayı / saat / tutarı alıntıda arar | Yazılı, KAPALI | Alıntının hangi kayıttan (kimlik + sürüm) geldiği ize yazılmıyor; alıntı İLGİSİZ bir kayıttan gelebilir (anlamı okuyucuya kalıyor) |
| 3 Yazmıyorsa yok değildir | Parça kipinde "yok" cevabı da alıntı ister; ters olumluluk kodda tutulur (`polarity_mismatch`); `no_info` = boş parça, istek açık kalır | Yazılı, KAPALI | Varsayılan hatta HİÇBİR karşılığı yok (bugün eklenen istem katmanı dışında) |
| 4 Yetki | Tür → hassasiyet tablosu; doğrulanmış erken giriş / müsaitlik / uzatma; evcil hayvan politikası | Kısmen canlı | Tek tablo değil: "bilgi var ama karar ev sahibinde" ayrımı türden türe farklı yerde |
| 5 İzinli ihtiyaç için üretim | Parça kipi: yalnız "cevaplanacak" istekler için kayıt | Yazılı, KAPALI | Varsayılan hat "bütün cevabı yaz, kapı tutsun" |
| 6 Kod + okuyucu | Parça okuyucusu: istek başına `answers_request (evet / kısmen / hayır / emin değilim)`, `supported_by_notes`, `binding_ok`; düşerse bütün parçalar tutulur | Yazılı, KAPALI | "Bekleyen başka konuya izin ima ediyor mu" sorusu YOK (okuyucuya öteki istekler bilerek gösterilmiyor); destek hükmünde "emin değilim" yok |
| 7 Denetlenen = gönderilen | Tetik mesajına bağlı gönderim kimliği; gönderim anında "misafir / ev sahibi yeni yazdı" vetosu; onaylı parça aynen duruyor denetimi | CANLI (kuyruk yolu anahtarlı) | Kaynak (bilgi tabanı kaydı) değiştiyse yeniden değerlendirme yok |
| 8 Ölçüm | Canlı hat ölçeri, mühürlü set düzeni | Var | Kör koşu çıktısı saklanmıyordu (bugün düzeltildi) |

## 4. Hedef akış

```
misafir mesajı
  → anlama katmanı: istekler (misafirin sözleriyle) ─────────────── [var]
  → istek defteri: tür → YETKİ tablosu
        ev sahibinde kalır │ doğrulanmış politika │ bilgi tabanından cevaplanabilir ── [var, tablo dağınık → D3]
  → her cevaplanabilir istek için kaynak adayları
        ("R2 için kayıt bulunamadı" işareti dahil) ─────────────── [yok → D1c]
  → üretim: istek başına {durum: cevap | bilgi yok, metin, alıntı} ─ [var: parça kipi]
  → KOD: alıntı o kayıtta birebir geçiyor mu · rakam / saat / tutar alıntıda mı ·
         ters olumluluk · yetki · sır · bilinen engeller ─────────── [var; kayıt kimliği + sürüm izi → D2]
  → OKUYUCU (istek + parça + kayıt): destekliyor mu · sorulanı cevaplıyor mu ·
         bekleyen konuya izin ima ediyor mu · emin değilim ───────── [var; üçüncü soru → D1a]
  → birleştirme: yalnız doğrulanan parçalar; kod selamı / imza eklenir ─ [var]
  → gönderim anı: misafir / ev sahibi yazdı mı · kaynak değişti mi ──── [var; kaynak sürümü → D2]
  → defter: cevaplanan kapanır, ötekiler ev sahibinde AÇIK kalır + bildirim ─ [var]
```

Misafire "bilgim yok" ya da "ev sahibimize ilettim" GİTMEZ (kurucu kuralları 09-11, 09-30): cevabı olmayan soru sessizce ev sahibinde
açık kalır; cevabı olan soruların cevabı gider.

## 5. İş dilimleri (sıra ve gerekçe)

**D0 — istem katmanı (bugün yazıldı, anahtar KAPALI): `AI_NO_SOURCE_RULE_ENABLED`.** Sebebi istemde düzeltir; varsayılan hatta ve parça
kipinde aynı kuralı söyler. Yapısal güvence DEĞİLDİR (model yine uydurursa durdurmaz). Ölçüm §7.

**D1 — parça kipini kabule hazırlamak.**
- (a) Okuyucuya üçüncü soru: "parça, KENDİ isteği dışında bir şeye — özellikle ev sahibinde bekleyen konulara — onay / ret / söz / ima
  taşıyor mu". Girdiye bekleyen konuların listesi eklenir. Evcil hayvan dalındaki sözcük listesi kesin engelin yedeği olarak kalır, kararı
  okuyucu verir. (S3'ün "dolaylı izin" açığının anlam karşılığı; yalnız evcil hayvan değil, bekleyen her konu.)
- (b) Destek hükmü üç durumlu (evet / hayır / emin değilim); "emin değilim" tutar.
- (c) İstek başına kaynak adayı: istemde her isteğin altında getirilen kayıtlar, yoksa "bu istek için kayıt bulunamadı". Modelin yakın
  kaydı cevap sanmasının yapısal sebebi tek birleşik blok. Ölçülerek karar verilir (parça kipinde bugün de `no_info` çalışıyor).
- (d) Yeniden yazma notları (`part-rewrite`): "alıntı bulunamadı → notlardan bir cümle kopyala" notu uydurma parçaya alıntı arattırıyor;
  "ilgili cümle yoksa bilgi yok yaz" ile değişir.

**D2 — kaynak kimliği + sürümü.** Her doğrulanan parçanın alıntısının geldiği kayıt (kimlik + içerik özeti) karar kaydına yazılır.
Kuyruk yolunda gönderim anında o kayıtların özeti yeniden okunur; değiştiyse taslak iptal edilip tur yeniden değerlendirilir. Şema
değişikliği gerekirse migration turuna girer (karar kaydının JSON alanı yeterliyse gerekmez — uygulamada ölçülecek).

**D3 — yetki tablosu tek kaynak.** Tür başına: `ev sahibi karar verir` · `doğrulanmış politika karar verir` · `bilgi tabanı cevaplar`.
Bugünkü davranışı DEĞİŞTİRMEYEN bir derleme + pin (her tür tabloda; yeni tür eklenince test kırılır). "Bilgi var ama karar ev sahibinde"
(evcil hayvan ücreti, erken giriş ücreti) satırları açık yazılır.

**D4 — ölçüm düzeni.** Yeni açık set (`evals/grounding-dev.json`, Codex kategorileri) + ayrı yazarın görülmemiş seti + kurucu inceleme
sayfasında insan kontrolü. Altyapı kategorileri (model / okuyucu düşerse tut · kaynak değişti · ev sahibi araya girdi · aynı gönderim iki
kez) entegrasyon testidir, model ölçümü değil. Kör koşu ayrıntı dosyası yazar; koşulan set geliştirme setine taşınır, sonraki kabul yeni
setle. Kalıcı ölçü: **dürüstlük geçiş oranı** (dürüst taslakların ve uydurmaların kaçı gitti) her ölçüm raporunda.

**D5 — açma sırası ve ölçütü.** Parça kipi + okuyucu birlikte açılır (biri olmadan öteki eksik). Önerilen ölçüt, görülmemiş sette:
yanlış gönderim 0 · "açık kalmalı" ihtiyaçların tamamı açık · tek sorulu olağan cevapta gerileme yok · gereksiz tutma oranı kurucunun
kabul ettiği sınırın altında (bugünkü geliştirme ölçümü §7'de).

**D6 — defteri olmayan yüzeyler (QR misafir sohbeti, emin olunamayan tur).** Bugünkü kural kalır (tur tutulur / QR'da devir). QR'a istek
defteri getirmek ayrı karar (§9).

## 6. Codex'in önerisiyle karşılaştırma

Katıldığım: altı maddenin tamamı, "yazmıyorsa yok değildir" ilkesi, koşusu yapılmış kör setin açılması, yalnız toplam sayıya bakmamak.

Üstüne koyduğum:
1. "Destekleyen bölüm" modelin beyanı değil, **kodun birebir doğruladığı alıntı** (parça kipinde zaten böyle; D2 ile kayıt kimliği +
   sürümü de).
2. Modele **"bu istek için kayıt bulunamadı"** işareti (D1c) — bugün model bunu hiçbir yerden öğrenemiyor.
3. Okuyucuya bekleyen konuların **listesi** verilir (D1a) — bugün okuyucu öteki istekleri bilerek görmüyor, ima denetimi yapamıyor.
4. **Dürüstlük geçiş oranı** kalıcı ölçü (D4): sistemin dürüst cevabı tutup uydurmayı geçirdiği bu denetimde tesadüfen görüldü.
5. İstemin kendi çelişkileri (D0): Codex'in listesinde yok; uydurmanın yarısı oradan.

Ayrıştığım tek yer: "model yalnız izinli ihtiyaçların cevabını oluştursun" — katılıyorum, ama her ihtiyaç için AYRI model çağrısı
önermiyorum. Tek çağrıda istek başına kayıt (bugünkü parça kipi) aynı ayrımı verir, maliyeti ve gecikmeyi artırmaz; parçalar arası bulaşma
ölçülürse ayrı çağrıya geçilir.

## 7. Ölçüm (11-12; gpt-5.1; kimseye bir şey gitmedi)

Ayrıntı, senaryo sınıfları ve bulunan kod hataları: `docs/INCELEME-2026-11-12-istem-denetimi.md` §6. Özet (son kod, `7c2d5edb`):

**Geliştirme seti** (`evals/grounding-dev.json`, 43 senaryo; 34 cevaplanmalı / 28 açık kalmalı ihtiyaç):

| Yapılandırma | Doğru cevap (34) | Gereksiz tutma | Açık kaldı (28) | 🚨 Yanlış gönderim |
|---|---|---|---|---|
| Bugünkü hat | 24 | 10 | 19 | **9** |
| Bugünkü hat + D0 istem katmanı | 26 | 8 | 23 | **5** |
| Parça kipi + okuyucu | 30 | 4 | 28 | **0** |
| Parça kipi + okuyucu + D0 | 29 | 5 | 28 | **0** |

- İlke 3'ün ("yazmıyorsa yok değildir") bugünkü hatta karşılığı yok: 9 yanlışın 9'u bu ilkenin ihlali (uydurma "yok" / "var", çelişkide tek
  tarafı seçme, başka şeyin ücretini / mesafesini taşıma). D0 bunları azaltıyor (5), bitirmiyor.
- Parça kipi iki kolda da 0 yanlış. İlk ölçümde 14–17 doğru cevabı gereksiz tutuyordu; sebepler doğrulayıcı / okuyucu kodundaki hatalardı
  (denetim belgesi §6.2, dokuz satır; dördü aynı zamanda yanlış cevabı geçiren delik) — düzeltildi. Kalan tutmaların dördü tur düzeyi kemer
  (evcil hayvan ×3, erken giriş ×1).
- **Okuyucu tek okumayla kaçırabiliyor (ölçüldü).** "Havuz barı kaça kadar açık?" sorusuna model üç koşunun üçünde havuzun saatini yazdı;
  parça okuyucusu ikisinde "soruyu cevaplamıyor" dedi, birinde geçirdi ve cevap gitti. O sınıf (iki tesisli istek, parça birini anmıyor) artık
  kodda tutuluyor; ama dersi genel: anlam denetimi tek okumaya bağlı kalırsa küçük bir oranda kaçırır. Seçenek D1b (aşağıda).
- **D1c (istek başına kaynak adayı) için kanıt zayıfladı:** parça kipinde model yakın kaydı cevap sansa da alıntı şartı / okuyucu parçayı
  düşürüyor; D1c bugün doğruluk değil, gereksiz model çıktısını azaltma işi olur. Ertelenebilir.
- **D1a (okuyucuya "bekleyen konuya izin ima ediyor mu" sorusu) hâlâ açık:** bugün o ayrımı evcil hayvan / erken giriş TUR KEMERİ yapıyor; kemer
  kalkacaksa (S3) D1a onun yerine geçecek anlam denetimidir.
- **D1b (yeni seçenek): parça okuyucusunu iki kez okutmak** — biri "cevaplamıyor / yarım" derse parça tutulur ("bilgim yok" hakemindeki iki
  okuma düzeninin aynısı). Bedeli cevap başına bir çağrı ve biraz daha fazla tutma. Karar kör set sonucuna göre (kurucu sorusu D-4).
- **Okuyucu misafir mesajını görünce yanılıyor:** taslak bir soruya değinmediğinde (doğru davranış) "bilgim yok dedi" oyu verip kanıt olarak
  selamı ya da taslakta olmayan bir cümleyi gösteriyordu. Kodun kanıt şartı sıkılaştırıldı: okuyucunun "evet"i ancak taslakta GERÇEKTEN geçen,
  selamdan ibaret olmayan bir cümleyi gösteriyorsa sayılır; itirafı yalnız misafir mesajını gören okuma gördüyse kelime kuralı da görmelidir.

**Çok mesajlı tur** (`evals/turn-messages-dev.json`, 16 senaryo; 24 cevaplanmalı ihtiyaç): bugünkü hat 16 doğru cevap (5 ihtiyaçta yalnız son
mesaj cevaplandı); parça kipi + okuyucu + D0 ile anahtar kapalı 18, açık 22 · 22 (iki koşu); yanlış gönderim hiçbir kolda yok. Anahtar parça
kipi olmadan açıldığında önceki mesajdaki bilinmeyen soruya uydurma cevap çıkıyordu (ilk ölçüm: 2 yanlış) → anahtar artık yalnız parça kipinde
etkili (kod kemeri).

**Görülmemiş (kör) set: HENÜZ KOŞMADI.** 74 senaryoluk kabul seti mühürlü duruyor; koşu OpenAI hesabının kredisi bittiği için yapılamadı
(denetim belgesi §6.4 — komutlar hazır). D5'in (açma ölçütü) girdisi bu sonuçtur; o gelmeden parça kipi için "açılabilir" denmez.

## 8. Riskler

- **Okuyucu tek nokta.** Anlam denetimleri okuyucuya kalınca misafir metnindeki "denetçiye not" onu "evet"e çekebilir. Kodda kalan
  denetimler (alıntı kayıtta · değer alıntıda ve doğru etiket ailesinde, konusuna bağlı · ters olumluluk · konu bilinmiyor · iki tesisli
  istekte eksik tesis · yetki) okuyucudan bağımsız tutar; okuyucu girdisi çitlenmiş veridir. Kodun TUTMADIĞI ve okuyucuya kalan sınıf: konu
  alıntıda hiç geçmiyor (`subject_missing` — eldeki ölçümlerde 31 doğru parçada da yandığı için danışma), değer başka konuya bağlı, yön /
  nitelik eksik. Bu sınıfta okuyucunun tek okumayla kaçırdığı ölçüldü (§7).
- **Gereksiz tutma.** Parça kipi dürüst ama temkinli: geliştirme ölçümünde cevabı olan soruların bir kısmı tutuldu (§7). Tutulan her
  cevap ev sahibine iş demek; ölçüt kurucunun.
- **Maliyet / gecikme.** Parça kipi + okuyucu tur başına bir ek model çağrısı (okuyucu). Ölçüm raporlarında çağrı sayısı ve süre var.
- **İki hat.** Parça kipi açıldığında defteri olmayan turlar eski hatta kalır; iki hattın kuralları ayrışmasın diye D0 katmanı ikisinde de
  aynı cümleleri söyler.

## 9. Kurucuya sorular (örnekli)

Soruların örnekli hâli denetim belgesinde: `docs/INCELEME-2026-11-12-istem-denetimi.md` §8 (D-1 uydurma sorunu için yol · D-2 kör koşu için
OpenAI kredisi · D-3 çok mesajlı tur · D-4 parça okuyucusu iki okuma · D-5 evcil hayvan / erken giriş turu). Bu belgeye özgü iki karar:

**D-6 · Dilim sırası.** Önerim: (1) kör koşu → (2) D5 açma ölçütü birlikte yazılır (hangi sayı "açılabilir" demek) → (3) parça kipi + okuyucu +
D0 birlikte açılır → (4) çok mesajlı tur → (5) D2 kaynak kimliği + sürümü (şema işi — migration turuyla) → (6) D3 yetki tablosu → (7) D6 QR.
S2 (geç mesaj) ve S3 (evcil hayvan ayrımı) (3)'ten sonra.

**D-7 · QR misafir sohbeti.** Aynı cevap istemini kullanıyor, istek defteri ve dayanak kapıları orada yok; uydurma kalıbı QR'da daha az
kapıdan geçiyor. Parça kipini QR'a taşımak ayrı bir dilim (D6). Kanal tarafı açılıp ölçüldükten sonra mı, yoksa birlikte mi?
