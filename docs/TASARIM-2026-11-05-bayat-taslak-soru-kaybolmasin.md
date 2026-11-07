# Tasarım — bayat yapay zekâ taslağı iptal edilince misafirin sorusu kaybolmasın (T7-OB-1 adım 2, 2026-11-05)

> Durum: **UYGULANDI (11-05 gece) — kurucu kararı "Evet, ama ihtiyaç bazında"** (aşağıda §6; §2'deki D1–D5 ilk öneriydi, kurucu
> kararıyla değişti — D1'in "model çağrılmaz" kısmı ve D5'in konuşma düzeyi "Misafir vazgeçti"si UYGULANMADI). Kapsam yalnız kalıcı
> kuyruk açıkken (`DURABLE_OUTBOX_ENABLED`, canlıda KAPALI); kuyruksuz satır içi gönderimde taslak beklemez, bu sorun yoktur.
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

## 6. Kurucu kararı (11-05) ve uygulanan

**Karar (kurucunun sözleri, özet):** "Evet, ama ihtiyaç bazında." Bekleyen taslak gönderilmiş sayılmaz; iptal edilmiş taslak soruyu
sonsuza kadar kilitlemez; "denendi" damgasını silmek tek başına çözüm değildir — kuyrukta / gönderildi / iptal / belirsiz ayrı tutulur.
"Teşekkürler" tek başına vazgeçme değildir; "Havlu istemiyorum; Wi-Fi şifresini gönderin" → yalnız havlu geri çekilir. Belirsiz gönderimde
kör tekrar yok, ama konuşma süresiz kilitlenmez; yeni mesajlar kaydedilir, tehlike kontrolleri sürer; sonuç doğrulanamıyorsa ev sahibinin
inceleyip çözebileceği görünür durum kalır; süre geçti diye "gönderilmedi" sayılmaz. "Misafir vazgeçti" bütün konuşmanın durumu olmaz.

**Uygulanan (misafire giden metin DEĞİŞMEDİ; yeni metin yok — mevcut notlar ve rozetler):**

| # | Kod | Davranış |
|---|---|---|
| F1 | `automation.ts` (bağlam kesiti) + `conversation-items/store.ts` `reopenItemsOfOvertakenDraft` | Kuyrukta BEKLEYEN (`pending`) taslağı misafirin daha yeni mesajı geçtiyse bu tur onu gönderilmiş saymaz: ilk soru + yeni mesaj BİRLİKTE değerlendirilir, taslağın kapattığı öğeler yeniden açılır (`pending_host` — iptalde işçinin yazdığı durumla aynı; tur değerlendiremezse ihtiyaç ev sahibinde uyarıyla görünür kalır) → her ihtiyaç kendi kuralıyla (cevap · ev sahibine · geri çekme). "Geçti" ölçütü gönderim anı vetosunun KENDİSİ (taslağın cevapladığı tetik mesajından sonraki misafir mesajı) — iki ölçüt ayrışsaydı ya iki cevap giderdi ya soru kaybolurdu. Yolda (`sending`) taslak durdurulamaz → bilinçli dışarıda. Model yine çağrılır (D1'in "çağrılmaz" kısmı yok): tehlike kontrolleri modelden sonra da koşuyor. |
| F3 | `outbox/state.ts` `nextReplyIdempotencyKey` + `REEVALUABLE_CANCEL_CODES` | Aynı tetik için iptal edilmiş satır, yalnız YENİDEN DEĞERLENDİRİLEBİLİR sebeplerle (`ai_paused` — duraklatma / devralma bitti; `superseded_by_newer_message`) sürüm anahtarı açar ("…#r2"). Bayat iptaller (genel anahtar / abonelik / kanal kapalı — kurucu Y5 · N1 · W7; şikâyet / kapanış; rezervasyon iptali / bitişi; kiracı uyuşmazlığı; KVKK silmesi) eskisi gibi tekilleştirilir → bayat cevap gitmez. Tetik okuyucu sürüm ekini atar (veto aynı tetiğe bakar). |
| F4 | `automation.ts` (gönderimden hemen önce) + koşucu damgası | Konuşmada sonucu BİLİNMEYEN yapay zekâ cevabı varsa (`ambiguous` / `reconciling` / `review` — eşleştirici teslimi kendiliğinden ASLA doğrulamaz, beklemek bilgi getirmez) ve ev sahibi o satırdan SONRA yazmadıysa: tur TAM koşar (tehlike / yükseltme kapıları önce), mesaj kayıtlı, cevap OTOMATİK GİTMEZ, konuşma "Yeni" kalır, not "Gönderim sonucu doğrulanamadı — mesaj iletilmiş OLABİLİR. Elle yanıtlamadan önce konuşmayı kanal üzerinden kontrol edin." + satırın "Doğrulanamadı — inceleyin" rozeti. Bu mesaj için kalıcı hayır (her turda yeniden modelleme yok); misafir yeni yazınca yeniden değerlendirilir. **Çözüm ev sahibinde:** belirsiz satırdan sonra ev sahibinin yazdığı (ya da sağlayıcıdan ev sahibi yazarıyla gelen — belirsiz mesajımızın yankısı dahil) giden mesaj konuyu çözülmüş sayar → sonraki misafir mesajları normal cevaplanır (süresiz kilit yok). **Opus 11-05 eki:** cevap aslında gittiyse senkron sağlayıcıdaki kopyasını ev sahibi mesajı olarak yazmaz, yerel satırımızı sahiplenir (adopt-and-heal) → sağlayıcıda görünen satır artık tutmaz (yoksa en yaygın belirsiz durumda tutma süresiz sürerdi); kuyruk konuşma başına sıralı olduğu için yeni cevap önceki satır son durumuna varınca gider (satırın "İletildi" sayılması = O3, kurucu sorusu). Tutma, kapıda tutulan turla aynı kaydı yapar (hassas öğe + mesaj başına bugünkü tek e-posta, karar kartı, karar kaydı `delivery_unverified`). |

**Bilinçli kalanlar:** (a) `review` satırı bağlamda hâlâ "gönderilmemiş" sunulur (mevcut karar, `automation.ts` bağlam kesiti yorumu: ulaştığı kesin
olmayan cevabı modele "verilmiş" göstermemek) — F4 o hâlde otomatik cevabı tuttuğu için kör tekrar oluşmaz; ev sahibi yazdıktan sonra cevapsız pencere onun
mesajından başlar. (b) Satır içi (kuyruksuz) yol değişmedi: orada belirsiz gönderimin yankısı senkronla gelir (`write-service` koruması).
(c) D5 (konuşma düzeyi "Misafir vazgeçti") YOK — kurucu: vazgeçme yalnız ilgili ihtiyacı geri çeker (mevcut öğe defteri `withdrawn`).
(d) İsteğe bağlı O3 (senkronun bulduğu mesajı "teslim edildi" saymak) yapılmadı — gövde eşleştirmesi eskiden bilinçli reddedildi.

**Testler:** `tests/integration/outbox-stale-draft-need-based.test.ts` (kurucunun her örneği iki yönlü: tek cevap + soru kaybolmaz; model
düşünürken yazılan mesaj; duraklatma sonrası sürüm anahtarı; bayat iptal kontrolü; belirsiz / inceleme tutma; tehlike yine yükselir;
ev sahibi yazınca kilit kalkar; ev sahibinin ÖNCEKİ mesajı çözüm sayılmaz; koşucu damgası) + `tests/unit/outbox-state.test.ts`.
