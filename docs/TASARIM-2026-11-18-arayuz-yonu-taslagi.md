# Tasarım (ÖNERİ) 2026-11-18 — Arayüz yönü taslağı: "yapay zekâ yapmış gibi duran" ön yüzden çıkış

> **KOD YOK, karar değil.** Kurucu 11-18: "çok ufak bir operatör olarak benim sözüm var: amaç morluk üzerine kurmak değil; şu an yapay
> zekânın yaptığı belli olan ön yüz tasarımları için taslak çalışmaları." Kaynak: Codex 11-17 tasarım eki (AYNEN
> `docs/KURUCU-TALIMATI-2026-11-18-codex-raporu-ve-orkestrasyon.md` "NİHAİ Tasarım Eki") + bugünkü kodun envanteri (alt ajan, salt-okuma;
> sayılar `grep` satır sayısıdır). Görsel taslak kurucuya ayrıca gönderildi (kurgusal veri). Sorular §6'da AY-numaralı.

## 1. Bugünkü durum (envanter)

- **Mor zaten yok.** Mor / eflatun ailesi bütün `src` içinde tek satırda (operatör ekranında "demo" etiketi) ve e-posta şablonunda iki
  yerde. Panelin ana rengi lacivert; statik tanıtım sayfaları lacivert + çivit mavisi. Yani sorun renk değil.
- **"Şablon görünümü" izleri** (ana oturumda yeniden sayıldı): yapay zekâ simgeleri (parıltı, sihirli değnek, robot, roket, beyin)
  43 satır / 17 dosya · robot emojisi 4 yerde · büyük yuvarlatma (`rounded-2xl` ve üstü) 95 satır / 39 dosya · `animate-*` 113 satır /
  72 dosya · büyük gölgeler 10 satır. Özel nabız / parıltı animasyonlarının çoğu tanıtım sayfasında (alt ajan sayımı: 161 satır / 17
  dosya — yeniden sayılmadı).
- **Durum renkleri iki ayrı sistemle** yazılmış: rozetlerde anlamlı tonlar (başarılı / uyarı / hata / soluk), liste ve nokta
  göstergelerinde ham palet (zümrüt, kehribar, kırmızı, gök, arduvaz, turuncu, mavi). Aynı durum iki ekranda iki renk olabiliyor.
- **Sayılar:** hizalı rakam (`tabular-nums`) yalnız 13 satırda; saatler ve sayılar çoğu listede hizasız.
- Tek yazı tipi Inter; kartlar `rounded-xl` + gölge + 20 px iç boşluk; Panel "sayı kartları" ile açılıyor.

## 2. Neden "yapay zekâ yapmış" gibi duruyor (teşhis)

1. **Süs, nesnenin önünde.** Parıltı simgesi, robot emojisi, nabız atan düğme "burada yapay zekâ var" diyor; ev sahibinin görmek
   istediği ise daire, saat, kim, ne oldu.
2. **Her şey aynı ağırlıkta kart.** Büyük yuvarlatılmış, gölgeli kartlar ve sayı kutuları her şablonda var; neyin acil olduğunu
   biçim söylemiyor, yalnız renk söylüyor.
3. **Renk tek başına anlam taşıyor** ve iki sistem karışık; renk körü kullanıcı ve hızlı göz taraması için zayıf.
4. **Zaman hizasız.** Operasyon ekranının omurgası saattir; saatler satır içinde dağınık.
5. **Kanıt görünmüyor.** "Yapay zekâ bu cevaptan emin" rozeti modelin kendi beyanı; ev sahibine güven veren şey kaynak ve teslim
   bilgisidir ("kaynak: bilgi tabanı › Wi-Fi", "kanal kabul etti 12:41").

## 3. Önerilen yön — yedi ilke

1. **Nesne önce:** her satır "saat · daire · ne oldu · kanıt / eylem". Sayı kartı yalnız tıklanınca bir işe götürüyorsa kalır.
2. **Tek durum dili, dört sözcük:** Yolunda · Sürüyor · Karar sizde · Engel. Renk + işaret + sözcük birlikte (yalnız renk değil).
   Ham palet kullanımı kalkar; liste noktaları da aynı dört tondan gelir.
3. **Saat sütunu:** her listede sol sütun saat, hizalı rakamla. Devir gününde adımlar soldan sağa zaman sırasıyla.
4. **Yapay zekâ süssüz:** parıltı / değnek / robot simgeleri ve emoji kalkar. Yapay zekânın işi düz bir atıf satırıdır ("Lixus
   yanıtladı · 12:41") ve yanında kanıt. Marka adı yeter; her düğmede "AI" yazmaz.
5. **Sakin yüzey:** ince çizgi + 6 px yuvarlatma, gölge yok; kart yerine "kâğıt" (tek çerçeve içinde satırlar). Zemin sıcak nötr,
   mürekkep bugünkü lacivert. Vurgu rengi tek ve az (mor değil; bugünkü lacivert / mavi yeter).
6. **Hareket yalnız durum değişiminde:** nabız, nefes alan düğme, parıltı yok; geçiş 150 ms altı.
7. **Her işte dört bilgi:** sorumlu · sıradaki adım · saat · kanıt (Codex'in tasarım önerisiyle aynı: "her işte sorumlu, sonraki eylem,
   süre, son doğrulama görünmeli"; cevap üretimi, kanal kabulü ve fiziksel tamamlanma ayrı gösterilir).

## 4. Görsel taslak ne gösteriyor

Tek ekran, iki boyut (masaüstü + telefon), kurgusal veri: **"Bugün"** — (a) "Sizi bekleyen": yalnız gerçek istisnalar, her biri tek
cümle + tek ana eylem; (b) "Devir günü": daire başına tek takip satırı (çıkış → temizlik → erken giriş → giriş mesajı → giriş), her
adımda saat + kanıt, takılan adım kırmızı çizgi ve sözcükle; (c) "Sizin yerinize yapılanlar": saat · daire · iş · kanıt. Bu, ürün yönü
belgesindeki H-2 önerisinin (devir günü tek takip satırı) görsel karşılığıdır.

### 4.1 Kurucu cevabı (11-18 akşam) — masaüstü EVET, mobil yeniden

"Masaüstü yönüne evet, mobil düzenine bu hâliyle hayır": telefonda aynı beş adım her daire için alt alta açılıyor, birkaç dairede sayfa
uzuyordu. Yeni mobil kural (taslak güncellendi, iki görüntü kurucuya gönderildi):
- devir satırı kapalı başlar ve yalnız **daire · giriş saati · takılan adım · tek eylem** gösterir (yolunda giden satırda eylem yerine durum);
- zaman çizelgesi (çıkış → temizlik → erken giriş → giriş mesajı → giriş) satıra **dokununca** açılır, yeniden dokununca kapanır;
- masaüstünde çizelge hep açık (değişmedi).
"Sizi bekleyen" ve "Sizin yerinize yapılanlar" bölümleri iki boyutta da aynı.

## 5. Uygulama sırası önerisi (onaylanırsa; her biri küçük ve geri alınabilir)

| Adım | Ne | Risk |
|---|---|---|
| A1 | Durum dili tek kaynağa: dört ton + işaret + sözcük (`Badge` ve nokta göstergesi aynı yerden); ham palet kullanımları taşınır | düşük (görsel; metin değişirse onay ister) |
| A2 | Yapay zekâ süsleri: parıltı / değnek / robot simgeleri ve emoji → düz simge ya da hiç; "emin" rozeti → kaynak satırı (H5 sorusu) | düşük; rozet metni kurucu onayı |
| A3 | Saat sütunu + hizalı rakam: Girişler, Görevler, Gönderilenler, Panel listeleri | düşük |
| A4 | Yüzey: yuvarlatma ve gölge belirteçleri küçülür (tek yerden, `globals.css` + `ui/card`); zemin tonu | orta (her ekranı etkiler → ekran görüntüsü karşılaştırması şart) |
| A5 | "Bugün" ekranı bu dille yeniden kurulur (H-2 onayına bağlı) | orta |
| A6 | Tanıtım sayfaları (statik HTML + açılış bileşenleri) ayrı tur: gerçek ürün nesneleriyle anlatım | ayrı karar |

Her adım ekran görüntüsü önce / sonra ile gelir; erişilebilirlik (karşıtlık, klavye, ekran okuyucu) ölçülür.

## 6. Kurucuya sorular

- **AY-1 — Yön doğru mu?** Taslaktaki dil (ince çizgi, saat sütunu, dört durum sözcüğü, süssüz yapay zekâ) sizin "kendi sözüm" dediğiniz
  şeye yakın mı; neresi değil?
- **AY-2 — Dört durum sözcüğü:** "Yolunda · Sürüyor · Karar sizde · Engel" uygun mu? (Bugün ekranlarda: Cevaplandı / Sorunlu / Acil /
  Standart … ayrı sözlükler var; birleştirmek metin değişikliğidir.)
- **AY-3 — Marka:** kenar çubuğunda "Lixus AI" yerine yalnız "Lixus" (AI vurgusu tanıtımda kalır) — ister misiniz?
- **AY-4 — Koyu tema** bu turda da korunur mu (bugün yalnız panelde var)?
- **AY-5 — Sıra:** A1–A3 (küçük, güvenli) hemen; A4–A5 taslağı beğenirseniz; A6 ayrı tur — uygun mu?
