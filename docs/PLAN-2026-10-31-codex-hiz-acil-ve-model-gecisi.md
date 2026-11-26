# Yol planı — Codex 10-31 akşam metni (hızlı mesaj akışı, anlık acil uyarı, tehlike kaydı, model geçişi)

> Kaynak: kurucunun 10-31 akşam mesajı (Codex'in yazdığı metin + kurucu notu). Kurucu notu (aynen özet): "Okudum, çok saçma bir şey
> göremedim; garip bir şey varsa bana tekrar sorabilirsin. Diğer 3 yer için ücretli koşu yapabilirsin. Tokenim bitecek, işlere başlasan da
> bitiremezsin — sohbette kalsın diye yazıyorum." Bu belge o metnin sentezi ve iş sırasıdır; uygulama yapılmadı (ölçüm hariç, §G).
>
> Bağlayıcı kurallar değişmez: müşteriye (misafire) gideni değiştiren her dilim önce/sonra örnekli SORULUR; yeni sistem (web kancası,
> kuyruk tablosu) kurmadan önce kısa soru; migration = onay + taze yedek; K2 kanıt sözleşmesi.

## 0. Kurucunun bu metinle verdiği yön (itiraz yok = yön kabul; ayrıntı yine sorulur)

| Konu | Codex tercihi | Durum |
|---|---|---|
| Tehlikenin ne / ne zaman / kimden geldiğini kaydetmek | Evet, önce GÖLGE kayıt; mevcut kararları değiştirmez | Yön kabul → §C |
| Kodun yakaladığı açık tehlikede uyarı | HEMEN başlasın; 2 dk'lık tur normal yol değil, KURTARMA yolu | Yön kabul → §B (önceki açık soru #3 kapandı) |
| "Priz yanıyor, ne yapalım?" | Açık tehlike; yardım sorusu bildirimi zayıflatmasın | Yön kabul → §D (Codex bulgusu #5 kapandı) |
| Haiku 5.5'i diğer 3 katmanda ölç | — | Kurucu onayı (ücretli) → §G |

## A. Anlık mesaj akışı (Codex "önemli kararlar" 1–4)

1. Mesajı göstermek için yapay zekâyı beklemeyiz: ev sahibi mesajı görür; cevap hazırlama + tehlike değerlendirmesi ayrı yürür.
2. Sağlayıcı bildirimi (web kancası) alınınca 2 dk'lık tura bırakılmaz: KALICI kayıttan sonra yalnız o konuşmanın işçisi uyandırılır.
   Bildirim yalnız "bu konuşmada değişiklik var" diyorsa işçi o konuşmayı API'den getirir; her olayda bütün işletme taranmaz.
3. Açık panel canlı güncellenir → sunucudan tarayıcıya bildirim (SSE) gerekir; yalnız yeni arka uç bağlantısı yetmez.
4. Hızlandırma hiçbir kapıyı atlamaz: yetki, abonelik, insan müdahalesi, güncellik, RAG, gönderim kontrolleri aynen.

Mevcut durum / çatışma: `docs/claude/hospitable.md` — Hospitable web kancaları açılabilir ama KULLANILMIYOR ("kurmak yeni sistem → önce
sor"); amaç Hospitable'dan ayrılmak. **Soru A-1:** web kancası Hospitable için mi kurulsun, yoksa yalnız Airbnb Direct / Booking
adaptörüne mi tasarlansın (Hospitable 2 dk turla kalır)? Kurulursa sağlayıcıdan bağımsız `ingest` kapısına bağlanır (V0 ilkesi).
**Soru A-2:** panel canlı güncelleme (SSE) — Railway tek kopya bugün; iki kopyaya geçişte yayın katmanı gerekir
(`docs/TASARIM-2026-10-10-load-balancer-yatay-olcek.md`). İlk dilim tek kopya varsayımıyla mı?

## B. Anlık acil uyarı (kodun yakaladığı açık tehlike)

"Hemen" = mesaj Lixus'a KALICI kaydedildikten sonra uyarı işi bekletilmeden başlar. Mesaj sağlayıcıdan henüz alınmadıysa bu o beklemeyi
kaldırmaz; sağlayıcı kabulü, telefona teslim, okunma ayrı aşamalardır.

Biçim (transactional outbox): kalıcı iş kaydı (mesajla AYNI işlemde) + hızlı uyandırma + tekrar güvenliği + cron kurtarma. Yalnız
`void gönder()` YETMEZ (süreç kapanınca kaybolur). Mevcut WhatsApp / e-posta teslim yolu korunur, öne hızlı giriş eklenir.
Bugün: kod tehlikeyi yakalarsa cevap tutulur, uyarı `sendDueAlerts` turuyla ≤2 dk içinde gider (10-31 testi "hırsız girdi").
Var olan yapı taşları: dayanıklı giden kuyruk + hızlı uyandırma (kurucu 10-16, `docs/claude/durum.md`), `SystemLock` tekrar hafızası.

Kabul testleri (Codex, aynen):
- Otomatik cevap KAPALIYKEN, mesai DIŞINDA ve konuşma zaten "Sorunlu" iken açık tehlike yine uyarı üretir.
- Mesaj kaydedildikten sonra süreç çökerse iş kaybolmaz.
- Hızlı yol ile cron aynı anda çalışınca ikinci bildirim oluşmaz.
- Aynı tehlike AĞIRLAŞIRSA ya da çözülüp YENİDEN yaşanırsa eski bildirim tarafından bastırılmaz.
Migration muhtemel (uyarı işi kaydı) → onay + taze yedek.

## C. Tehlike olay kaydı — gölge (ne / ne zaman / kimden)

Her tehlike değerlendirmesi için kayıt: nesne (yangın, gaz, kişi), zaman (şimdi / geçmiş / varsayım / alıntı), kaynak (misafir kendisi,
aktarılan söz, film / tabela), karar (açık / olası / değil) ve hangi katmanın verdiği. GÖLGE: hiçbir gönderim / tutma kararını değiştirmez;
ölçülür, sonra kurucuya önce/sonra örneğiyle karar sorulur. Bugünkü ilgili kod: `ai/hazard-evidence.ts`, `ai/person-danger.ts`,
`ai/life-safety.ts`. Saklama: misafir metni TAŞIMAZ (yalnız etiketler) → KVKK kapsamı dar; tablo gerekirse migration onayı.

## D. "Priz yanıyor, ne yapalım?" → açık tehlike

Bugün: soru biçimi "olası"ya iner (Codex #5, tasarım kararıydı). Yeni yön: yardım sorusu tehlike BİLDİRİMİNİ zayıflatmaz; tehlike
şimdiki zamanda ve misafirin kendi bildirimi ise açık. Varsayım ("yanarsa ne yapalım?"), genel bilgi ("priz yanarsa ne yapılır?") ve
geçmiş zaman olası / değil olarak kalır. Misafire giden etki: cevap tutulur + ev sahibine acil uyarı (bugün olası → Sorunlu + seyrek
e-posta). Uygulamadan önce önce/sonra örnek listesi kurucuya gösterilir (müşteriye dokunur).

## E. Acil uyarı raporu — uçtan uca sınanacaklar (Codex)

"Kodun kaçırdığını model yakalıyor" bütün koşullar için garanti değil: konuşma zaten Sorunlu, otomatik cevap kapalı, saat dışı gibi
anlama modelinden ÖNCE dönen yollar var. Sınanacak:
- Model çalışmıyor / zaman aşımı.
- Konuşma zaten Sorunlu → yeni tehlike.
- Otomatik cevap kapalı / saat dışı.
- AYNI türden ama gerçekten yeni tehlike (bugün: yeni TÜR yeniden uyarır, aynı olayın tekrarı uyarmaz — "aynı tür, yeni olay" ayrımı yok).
Not: cevabın TUTULMASI ile ev sahibine UYARI gitmesi aynı şey değil; kod-tek-başına sonuçları sistemin toplam yakalama oranı değildir.

## F. Model profili ve sağlayıcı bağdaştırıcısı (Haiku 5.5 geçişi için)

- Model profili: API biçimi, düşünme ayarı, token bütçesi, istem örnekleri modele göre. Gerçek sağlayıcı kimliği KAYDEDİLİR; Anthropic
  sonucu kayıtlarda OpenAI gibi görünmez (bugünkü ölçüm köprüsü `tests/eval/anthropic-reply-shim.ts` yalnız ölçer içindir).
- Nihai istem kontrolü: üç yasak daha eklemek yerine modele GERÇEKTEN giden birleşik istem incelenir; eski örnekler, ton talimatları ve
  yeni kurallar birbirini boşa düşürmemeli.
- Sınırlı düzeltme: dayanaklı cevaba gereksiz özür / devir kapanışı eklenmişse BİR kez kontrollü yeniden yazma; yeni metin bütün
  kapılardan yeniden geçer. Yetkisiz bilgi / dayanak eksikliği "başka model onaylayana kadar dene" yoluna GİRMEZ.
- Ölçülebilir geçiş: geliştirme setiyle iyileştirme → ayrı kör setle kabul → onaylı sınırlı kullanım. Ölçüler: doğru gönderim, gereksiz
  tutma, açık kalan ihtiyaç, gecikme, toplam maliyet (yalnız doğru taslak değil). Kod + model + insan değerlendirmesi birlikte.
- Cevap katmanı ilk ölçümü: `docs/olcum/HAIKU-5.5-CEVAP-KATMANI-2026-10-31.md`.

## G. Haiku 5.5 — diğer üç katman ölçümü (kurucu onayı 10-31, ücretli)

Katmanlar: anlama (`semantic/structured-call.ts`, Structured Outputs), çeviri (`translate.ts`), üslup özeti (`summarizeHostStyle`).
Ölçerler: `understanding-breakdown`, `translate-compare`, `style-profile-compare` (ürün fonksiyonu OLDUĞU GİBİ; köprü yalnız OpenAI
sohbet çağrısını Claude'a çevirir, şema `output_config.format`a). 5.1 tabanı yerelde aynı commit ailesinde. Sonuç raporu ayrı dosyada.

## Önerilen sıra

1. §G ölçümü (başladı) → rapor.
2. §E uçtan uca testleri (kod değişmeden; açık bulunan boşluk ayrı dilim).
3. §B anlık acil uyarı (kalıcı iş + hızlı uyandırma + kurtarma) — migration sorusu.
4. §D "priz yanıyor" — önce/sonra örnek listesi → onay → kod.
5. §C gölge tehlike kaydı.
6. §A anlık mesaj akışı — A-1 / A-2 cevaplarından sonra tasarım belgesi.
7. §F model profili — §G sonuçlarına göre.
