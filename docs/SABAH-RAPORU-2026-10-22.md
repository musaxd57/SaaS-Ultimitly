# Sabah raporu — 2026-10-22 (gece 10-21 → 10-22, "gece modu: soru sormadan")

Kısa: misafire giden yapay zekâ cevabını değiştiren HİÇBİR şey açılmadı / uygulanmadı. Gece yapılanlar ev sahibi ekranı, güvenlik iç
düzeltmeleri, ölçüm ve testlerdi. Kararınızı bekleyenler aşağıda, her biri önce / sonra örnekli: `docs/arastirma-2026-10-15/KURUCU-SORULARI.md` §U.

## 1. Sizin kararınızı bekleyenler (öncelik sırasıyla)

| # | konu | neden önemli |
|---|---|---|
| U1 | QR sohbet kodu (PIN) kapalıyken eski misafir bağlantıyla yeni konaklamayı kapabiliyor | güvenlik: Wi-Fi şifresi + misafir adıyla görünme |
| U8 | Tehdit / iade / chargeback + masum soru içeren mesajda masum soru cevaplanıyor | sizin 10-21 sözünüz: "para vermeyeceğim → cevap yok" |
| U7 | "Şikayetçi değil / şikayetim yok" kelime kuralında şikâyet sayılıyor | kelime değil bağlam: masum soru gereksiz tutuluyor |
| U9 | Başka misafirin / arkadaşın bilgisi isteyen mesaja yapay zekâ kendi "paylaşamam" diyor, size kalmıyor | kör kırmızı takımda da çıktı |
| T-a | Tarafsızlık katmanını açalım mı (`AI_NO_APOLOGY_RULE_ENABLED`) | ölçüldü: özürlü taslak 9 → 0, gerileme yok |
| T-d | Ödeme yöntemi kuralı ~%90 yanlış tutuş (otopark / bisiklet ücreti) | plan belgesi, önce / sonra örnekli |
| U2–U6 | Misafir QR ekranı dili, sohbet kodu adı, daire adı, otomasyon anahtarı yeri, panel sırası | ekran / metin |

## 2. Gece yapılanlar (hepsi testli, tam kapı + CI yeşil)

- **Ev sahibi ekranı (UX + görsel inceleme):** olası tehlike konuşmasında yanlış "Otomatik yanıt beklemede" bandı düzeldi; bant sebebe
  göre tek eylem bağlantısı veriyor; kurulumun 1. adımı Airbnb / Booking bağlantısına götürüyor; Bilgi Tabanı başlığı otomatik mesajların
  yerini doğru söylüyor; "AI cevap öner" Ayarlar'daki tonla başlıyor; "Sorunlu" seçince yapay zekânın durduğu yazıyor; mülk silme onayı
  ne silineceğini söylüyor; telefonda form alanları 16 px (yakınlaşma yok), küçük düğmeler büyüdü; "Mülkü sil" sakinleşti; rezervasyon kartı
  konuşma ekranında öne alındı; rapor skorunda az veri notu; birçok sade metin düzeltmesi.
- **Güvenlik:** cevap modeli devre kesicisi işletme başına (bir işletmenin takılması ötekileri durdurmuyor) + Haiku'nun üç ek düzeltmesi;
  mutasyon 13/13.
- **Ölçüm (gerçek model, gerçek akış):** kırmızı takım geliştirme seti (80) + KÖR kırmızı takım seti (71, ayrı yazar, tek koşu): misafire
  giden yasak dize **0**, acil kaçağı **0**; tutulması gerekenlerin %97'si tutuldu, "serbest kalan" vakalarda gizli bilgi gitmedi.
  Ayrıntı `docs/olcum/TARAFSIZLIK-VE-KIRMIZI-TAKIM-2026-10-21.md`.

## 3. Bilinen açıklar (karar bekleyen değil, iş listesi)

- Gereksiz tutuş yüksek (kör sette 27 / 44): karışık mesajda masum soru da tutuluyor — güvenli yön; U8 kararı bu oranı belirler.
- Panelde kurulum rehberi ilk ekranı kaplıyor (U6), Ayarlar'da ana otomasyon anahtarı gömülü (U5) — yer değişikliği sizin onayınızla.
