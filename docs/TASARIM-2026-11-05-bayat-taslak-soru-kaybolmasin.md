# Tasarım — bayat yapay zekâ taslağı iptal edilince misafirin sorusu kaybolmasın (T7-OB-1 adım 2, 2026-11-05)

> Durum: **TASARIM — uygulanmadı, kurucu onayı bekliyor** (misafire giden davranışı değiştirir). Kapsam yalnız kalıcı kuyruk açıkken
> (`DURABLE_OUTBOX_ENABLED`, canlıda KAPALI); kuyruksuz satır içi gönderimde taslak beklemez, bu sorun yoktur.
> Kaynak: Codex'in üç durumu (kurucu aracılığıyla, 11-05 gece) + kod haritası (derin araştırma ajanı, kodda satır satır; iki temel iddia
> ana oturumda kodla doğrulandı — aşağıda ✔).

## 1. Bugün ne oluyor (kuyruk açıkken)

Pencere ancak taslak (A) bir teslim geçişinden sağ çıkınca açılır: rezervasyon başına dakikada 2 gönderim sınırı, aynı konuşmada önce
bekleyen satır, 429 / geçici 4xx, bağlantı park, teslim duraklatma.

- ✔ Bekleyen / gönderilmekte / sonucu belirsiz taslak, bir sonraki turun isteminde **teslim edilmiş gibi** durur (bilinçli: her turda
  fazladan model çağrısı olmasın — `automation.ts` `threadView` öncesi yorum). ✔ "Cevapsız mesajlar" penceresi o taslaktan sonra başlar.
- Sonra teslim anı vetosu A'yı iptal eder → ilk soru bir daha değerlendirilmez.

| # | Durum | Bugün | Olması gereken (Codex) |
|---|---|---|---|
| 1a | Misafir A kuyruktayken başka konuda yazdı ("Otopark var mı?" … "Bir de havlu lazım") | Yalnız havlu cevaplanır; **otopark sorusu kaybolur**, konuşma "Cevaplandı" | İkisi birlikte, güncel bağlamla yeniden değerlendirilir; eski metin gönderilmez |
| 1a′ | Aynı soruyu yeniden sordu | Tek cevap gider (ikinci taslak) | Aynı |
| 1b | Misafir A kuyruktayken "Teşekkürler" yazdı | Nezaket açıksa yalnız "Rica ederiz 😊"; kapalıysa "Cevap gerekmedi" — **soru kaybolur, listeden düşer** | Soru hâlâ açık → cevaplanır |
| 1c | A, devral / duraklat süresi yüzünden iptal; süre bitti | Aynı mesaj yeniden modellenir ama aynı anahtar kuyrukta "zaten var" → damgalanır, **cevap yok** (model çağrısı boşa) | Ya yeniden değerlendirilir ya da ev sahibine görünür bırakılır |
| 2a | Ev sahibi A'dan önce cevapladı | A iptal, misafir 1 cevap alır ✔ | Aynı (yeniden cevap yok) |
| 2b | Misafir "boşverin, gerek kalmadı" | Hiçbir kod vazgeçmeyi tanımıyor: model "boşverin"e cevap yazar, A iptal olunca soru ev sahibinde **açık** görünür | Yeniden cevap üretilmez |
| 3a | A'nın gönderimi zaman aşımı (belirsiz) | A asla kör tekrarlanmaz ✔; ~15 dk sonra "inceleme"ye düşer. Arada misafir yazarsa B, A'yı "teslim edilmiş" sayarak yazılır → A aslında gittiyse **aynı soruya iki cevap**, gitmediyse **soru kaybolur** | Önce teslim sonucu araştırılır; bilinmiyorsa yeni cevap üretilmez |

## 2. Öneri (migration YOK; mevcut alanlar + yeni sebep kodları)

- **D1 — bekleyen taslak varken yeni misafir mesajı (1a, 1b):** misafir taslağın tetiğinden SONRA yazdıysa bu tur model ÇAĞRILMAZ,
  geçici sebep `draft_superseded_pending` (damga yok). Teslim geçişi A'yı iptal eder; sonraki tur A süzülmüş olarak İLK soru + yeni mesajı
  BİRLİKTE değerlendirir (tek model çağrısı, tek cevap). Kapanış kısayolu artık soruyu yutamaz (soru yine cevapsız penceredir).
- **D2 — güvenlik ağı:** taslak "daha yeni mesaj" yüzünden iptal edilince konuşmanın "denendi" damgası (yalnız Yeni / bekleyen
  konuşmada) temizlenir → konuşma yeniden uygun olur.
- **D3 — aynı anahtar tuzağı (1c):** iptal edilmiş satırın anahtarı yeniden değerlendirmeyi sonsuza kadar engellemez: yeniden
  değerlendirilebilir iptallerde (duraklatma bitti) sürüm ekli anahtar (`…#2`); değilse sessiz damga yerine görünür not.
- **D4 — belirsiz teslim (3a):** bir yapay zekâ satırının sonucu belirsizken (`ambiguous` / `reconciling`) yeni cevap ÜRETİLMEZ (geçici
  sebep, model çağrısı yok). İncelemeye düşerse arada gelen misafir mesajı otomatik cevaplanmaz, ev sahibine kalır ("Gönderim sonucu
  doğrulanamadı…" — mevcut not). İsteğe bağlı (ayrı karar): senkron sağlayıcıda o mesajı bulduysa "teslim edildi" sayılsın.
- **D5 — vazgeçme (2b), yeni ürün davranışı:** turda yalnız vazgeçilen istekler varsa cevap gitmez, konuşma "Misafir vazgeçti" görünür.

## 3. Önce / sonra örnekleri

- **1a:** "Otopark var mı?" (A kuyrukta) → "Bir de havlu lazım". Önce: "Havlular dolabın üst rafında." (otopark yok) · Sonra: "Binanın önünde
  ücretsiz otopark var. Havlular dolabın üst rafında."
- **1b:** "Wi-Fi şifresi?" (A kuyrukta) → "Teşekkürler". Önce: "Rica ederiz 😊" · Sonra: "Wi-Fi şifresi: …"
- **3a:** A zaman aşımı, misafir "?" yazdı. Önce: ~15 dk sonra B gider (A da gittiyse iki cevap) · Sonra: sonuç belli olana kadar yeni
  cevap yok; incelemeye düşerse ev sahibine "Gönderim sonucu doğrulanamadı — kanalı kontrol edin".
- **2b:** "Otopark var mı?" → "Boşverin, gerek kalmadı". Önce: modelin "boşverin"e cevabı + soru ev sahibinde açık · Sonra (D5): cevap yok,
  "Misafir vazgeçti".

## 4. Testler (uygulamada zorunlu)
Her durum için iki yönlü: (i) aynı soruya İKİ cevap gitmedi, (ii) soru sessizce kaybolmadı (ya cevaplandı ya ev sahibine görünür).
1a / 1b / 1c / 2a / 2b / 3a için uçtan uca (kuyruk açık, sahte sağlayıcı, gerçek veritabanı); belirsiz teslimde kör tekrar sayısı 0.

## 5. Kurucuya sorular
- **O1:** D1–D4 bu şekilde yapılsın mı? (misafire giden: 1a / 1b'de ilk soru da cevaplanır; 3a'da belirsizlik varken otomatik cevap gitmez)
- **O2:** D5 (vazgeçme → cevap yok, "Misafir vazgeçti") istiyor musunuz, yoksa vazgeçme şimdilik model cevabıyla mı kalsın?
- **O3:** D4'ün isteğe bağlı kısmı: senkronun sağlayıcıda bulduğu mesaj "teslim edildi" sayılsın mı? (Codex ayrıca bakmalı — gövde
  eşleştirmesi eskiden bilinçli reddedilmişti.)
