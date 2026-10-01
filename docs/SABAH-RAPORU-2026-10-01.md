# Sabah raporu — 2026-10-01 (gece modu)

> Kararlar ayrı belgede: `docs/SABAH-KARARLARI-2026-10-01.md`. Bu rapor: doğrulanan K düzeltmeleri, kurucu talimatlarının
> uygulaması, Luna ölçümleri, maliyet, kapı / CI, canlıya geçiş için kalan adımlar ve eklenecek / değişecek ortam değişkenleri.

## 1. Codex K bulguları — güncel kodda yeniden doğrulama ve düzeltme

Hepsi güncel kodda (RC48 + 09-30 düzeltmeleri) yeniden üretildi; altısı da doğru çıktı, itiraz edilen yok. Her düzeltme ayrı commit,
"eski kodda kırmızı" kanıtı mutasyonla (düzeltme kaldırılınca ilgili test düşüyor).

| K | Codex bulgusu | Güncel kodda | Düzeltme | Kanıt |
|---|---|---|---|---|
| K10 | İki nokta eklenince makbuzsuz iletme iddiası geçiyor | DOĞRU — duyuru istisnası (`…yorum:`) alıcısı ev sahibi olan iletmeyi de muaf tutuyordu; İngilizce "I'll forward … to the host: …" aynı sınıf | Alıcısı ev sahibi / ekip olan ya da misafirin talebini nesne alan iletme iki noktayla da tutulur; "Sizi bilgilendiriyoruz: havuz kapalı" duyuru kalır. QR kararında da (Codex'in yeniden üretimi: otopark, güven 0.95 → artık devir) | 14 test; 3 mutant öldü |
| K4 | Eşzamanlı eski iptal yeni aboneliği bozuyor | DOĞRU — kimlik kontrolü bayat okumaya bakıyor, güncelleme yalnız kuruluş + zamana | Kimlik şartı UPDATE'in WHERE'inde (ilk kayıt çatışması dalında da); aktifleşen yeni abonelik eskisinin yerine geçmeye devam eder | Bayat okumayı birebir üreten test (4 senaryo); 4 mutant öldü |
| K11 | "Please let me / allow me to check out at 1pm" beyan sayılıyor | DOĞRU | Tekil izin istekleri (let / allow / permit me; DE "Darf ich / Kann ich", FR "Puis-je / Pourrais-je", ES "Puedo / Podría") istek; "We will check out at 1pm" beyan kalır | 26 test; 4 mutant öldü |
| K3 | Saat düzeltmesi başka olayın saatini çıkışa taşıyor | DOĞRU — olumsuzlanan alan sonraki "alansız" cümleciğe koşulsuz taşınıyordu | Taşıma yalnız GERÇEK düzeltme cümleciğine: saat dışındaki bütün sözcükler kapalı düzeltme dolgusundan ("12:00 olacaktır", "Doğrusu 12:00", "It will be 12:00"); sözcük yasağı değil, biçim. İkiz testler | 11 yeni test + iki yönlü saat bataryaları yeşil; 5 mutant öldü |
| K6 | Doktor / avukat / hastane anılması acil alarmını geri açıyor | DOĞRU | Meslek kimliği ("doktor olan arkadaşım", "avukat arkadaşımızla", "I'm a doctor") ve rutin bakım yeri ("hastanedeki rutin kontrol randevum") yalnız olay kontrolünde etkisiz; "mutfak yanıyor", "kapı kilitli, duman var", "doktor lazım, arkadaşım bayıldı", "hastaneye kaldırıldı" acil kalır | 19 test; çerçeve başına mutant öldü (3 yorum satırı eşdeğer; olay listesinde olmayan "hemşire / nurse" ölü kodu çıkarıldı) |
| K9 | Aynı mesajın iki hassas öğesi eşzamanlı iki e-posta | DOĞRU (koşullu) | Mesaj düzeyinde atomik talep (benzersiz kilit satırı); kaybeden çağrı öğe damgasını geri verir; e-posta gidemezse talep geri verilir | Yarışı deterministik üreten test (engelli Proxy) + 4 test; mutantlar öldü |

Codex'in "genel sonuç" notları (K1 negatif tutar, K2 fotoğraf erişimi, operatör dışa aktarımı) — tekrar kontrol edildi, değişiklik
gerekmedi.

## 2. Kurucu talimatlarının uygulaması (gece)

- **"Ev sahibinizin kararıdır" misafire gitmez** — `AI_HOST_DECISION_HOLD_ENABLED` (KAPALI). Açıkken: kararı ev sahibine bırakan
  cümle (7 dil) ve iki modelin doğruladığı konaklama ertelemesi gitmez; ev sahibine mesaj başına TEK "Misafir cevabınızı bekliyor"
  e-postası; öğe açık kalır; koddan kurulan doğrulanmış erken giriş onayı muaf. "Karar bekliyor" kartı + Onayla / Reddet = sabah
  kararı 1. Mutasyon 46 + 17 mutant, hepsi öldü.
- **Şikâyet yanlış parçalanması — kod koruması (anahtarsız, kurucu talimatı)**: bu turda tutulan şikâyet varken bağımsız bilgi türü
  olmayan istek cevaplanmaz; kapıya iki öğe doğrudan verilse de tutulur; cevaplanabilir istek yoksa cevap gitmez (ikinci kemer).
  "Wi-Fi ağı hangisi?" cevaplanır. Mutasyon 9 mutant öldü.
- **Kök neden istem katmanları** — `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED` (KAPALI): anlama katmanı şikâyete bağlı yardım sorusunu ayrı
  istek saymaz; cevap istemi şikâyetçiye kural hatırlatmaz, 112'yi yalnız gerçek can güvenliğinde önerir.
- **Ücret kuralı (kurucu ifadesi)** — `AI_KB_FEE_RULE_ENABLED` (KAPALI): "ASLA yazma" yasağı açıkken satırın YERİNE olumlu kurala
  döner.
- **Katman bazında model** — anlama / bekçi / sıralayıcı / çeviri / üslup ayrı model + düşünme ayarına alınabilir (boşken bugünkü
  ayar birebir); ölçüm raporları katman bazında model, gönderilen düşünme ayarı ve istem kimliğini (SHA) taşır.
- **K7 (migration 58)** — kurucunun yedeğiyle (SHA `4167864111E8…`, prova gerekmez) RC49'a alındı.

## 3. Luna ölçümleri

(koşular tamamlandıkça doldurulur)

## 4. Maliyet

(koşular tamamlandıkça doldurulur)

## 5. Kapı / CI

| Aday | Tam kapılar | Sonuç |
|---|---|---|
| RC49 (`fcb441d`: canlı `d80e7e2` + K7 migration 58 + K düzeltmeleri + şikâyet koruması + ücret / şikâyet takibi katmanları) | test 4 dosya / 11 test KIRMIZI; typecheck / lint / build / audit yeşil | **İTİLMEDİ.** 10 kırmızı yük altında zaman aşımı (üç dosya tek başına 49/49 yeşil, 0,7–1,8 sn). 1 gerçek eksik: yeni kapı ayrıntı kodu `items_complaint_dependent` kapı kanıtı pininde vakasızdı → vaka eklendi |
| RC50 (`20682de` = RC49 + katman ayarı + ölçer araçları + kapı kanıtı vakası + belgeler; ağaç ana dalla BİREBİR) | test 720 dosya / 11.428 test yeşil (9 dosya atlandı) · typecheck · lint · build · audit yeşil (başka ağır iş koşmadan) | 05:15'te itildi (`d80e7e2..20682de`, hızlı ileri). CI #1274: (sonuç aşağıda) |

## 6. Canlıya geçiş için kalan adımlar

(ölçümlerden sonra)

## 7. Eklenecek / değiştirilecek ortam değişkenleri

(ölçümlerden sonra)
